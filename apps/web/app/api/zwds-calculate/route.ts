/**
 * Next.js API Route: POST /api/zwds-calculate
 *
 * Direct iztro chart calculation — no auth, no credits, no DB.
 * This mirrors how Bazi calls the Python engine directly for chart display.
 * For production AI readings, the frontend will call the NestJS API instead.
 */

import { NextRequest, NextResponse } from 'next/server';

interface ZwdsStar {
  name: string;
  type: 'major' | 'minor' | 'adjective';
  brightness?: string;
  mutagen?: string;
}

interface ZwdsPalace {
  name: string;
  index: number;
  isBodyPalace: boolean;
  heavenlyStem: string;
  earthlyBranch: string;
  majorStars: ZwdsStar[];
  minorStars: ZwdsStar[];
  adjectiveStars: ZwdsStar[];
  changsheng12: string;
  decadal: {
    startAge: number;
    endAge: number;
    stem: string;
    branch: string;
  };
  ages: number[];
}

interface ZwdsChartData {
  solarDate: string;
  lunarDate: string;
  chineseDate: string;
  birthTime: string;
  timeRange: string;
  gender: string;
  zodiac: string;
  sign: string;
  fiveElementsClass: string;
  soulPalaceBranch: string;
  bodyPalaceBranch: string;
  soulStar: string;
  bodyStar: string;
  palaces: ZwdsPalace[];
  horoscope?: {
    decadal: { name: string; stem: string; branch: string; mutagen: string[] };
    yearly: { name: string; stem: string; branch: string; mutagen: string[] };
    monthly?: { name: string; stem: string; branch: string; mutagen: string[] };
    daily?: { name: string; stem: string; branch: string; mutagen: string[] };
  };
}

/**
 * Convert HH:MM birth time to iztro time index (0-12).
 */
function birthTimeToIndex(birthTime: string): number {
  const hours = Number(birthTime.split(':')[0]);
  if (hours === 23) return 12; // Late zi
  if (hours >= 0 && hours < 1) return 0; // Early zi
  return Math.floor((hours + 1) / 2);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function transformStars(stars: any[], type: 'major' | 'minor' | 'adjective'): ZwdsStar[] {
  return (stars || []).map((star: any) => ({
    name: star.name,
    type,
    brightness: star.brightness || undefined,
    mutagen: star.mutagen || undefined,
  }));
}

function transformPalaces(iztoPalaces: any[]): ZwdsPalace[] {
  return iztoPalaces.map((palace: any, index: number) => ({
    name: palace.name,
    index,
    isBodyPalace: palace.isBodyPalace || false,
    heavenlyStem: palace.heavenlyStem,
    earthlyBranch: palace.earthlyBranch,
    majorStars: transformStars(palace.majorStars, 'major'),
    minorStars: transformStars(palace.minorStars, 'minor'),
    adjectiveStars: transformStars(palace.adjectiveStars, 'adjective'),
    changsheng12: palace.changsheng12 || '',
    decadal: {
      startAge: palace.decadal?.range?.[0] ?? 0,
      endAge: palace.decadal?.range?.[1] ?? 0,
      stem: palace.decadal?.heavenlyStem || '',
      branch: palace.decadal?.earthlyBranch || '',
    },
    ages: palace.ages || [],
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { birthDate, birthTime, gender, targetDate, lunarDate, isLeapMonth } = body;

    // Validate required fields
    if (!birthDate || !birthTime || !gender) {
      return NextResponse.json(
        { error: 'Missing required fields: birthDate (YYYY-M-D), birthTime (HH:MM), gender (male/female)' },
        { status: 400 },
      );
    }

    // Import iztro dynamically (server-side only)
    const { astro } = await import('iztro');

    const timeIndex = birthTimeToIndex(birthTime);
    const iztroGender = gender.toLowerCase() === 'male' ? '男' : '女';

    // Generate chart
    let astrolabe: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      if (lunarDate) {
        // Use lunar date directly for better accuracy
        const lunarParts = lunarDate.split('-');
        const lunarDateStr = `${parseInt(lunarParts[0])}-${parseInt(lunarParts[1])}-${parseInt(lunarParts[2])}`;
        astrolabe = astro.astrolabeByLunarDate(lunarDateStr, timeIndex, iztroGender, isLeapMonth ?? false, true, 'zh-TW');
      } else {
        // Parse birthDate to non-zero-padded format for iztro
        const dateParts = birthDate.split('-');
        const solarDate = `${parseInt(dateParts[0])}-${parseInt(dateParts[1])}-${parseInt(dateParts[2])}`;
        astrolabe = astro.astrolabeBySolarDate(solarDate, timeIndex, iztroGender, true, 'zh-TW');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return NextResponse.json(
        { error: `iztro chart generation failed: ${message}` },
        { status: 500 },
      );
    }

    // Transform to standardized schema
    const chartData: ZwdsChartData = {
      solarDate: astrolabe.solarDate,
      lunarDate: astrolabe.lunarDate,
      chineseDate: astrolabe.chineseDate,
      birthTime: astrolabe.time,
      timeRange: astrolabe.timeRange,
      gender: iztroGender,
      zodiac: astrolabe.zodiac,
      sign: astrolabe.sign,
      fiveElementsClass: astrolabe.fiveElementsClass,
      soulPalaceBranch: astrolabe.earthlyBranchOfSoulPalace,
      bodyPalaceBranch: astrolabe.earthlyBranchOfBodyPalace,
      soulStar: astrolabe.soul,
      bodyStar: astrolabe.body,
      palaces: transformPalaces(astrolabe.palaces),
    };

    // Add horoscope if target date provided
    const horoscopeDate = targetDate || new Date().toISOString().split('T')[0];
    try {
      const horoscope = astrolabe.horoscope(horoscopeDate);
      chartData.horoscope = {
        decadal: {
          name: horoscope.decadal.name,
          stem: horoscope.decadal.heavenlyStem,
          branch: horoscope.decadal.earthlyBranch,
          mutagen: horoscope.decadal.mutagen || [],
        },
        yearly: {
          name: horoscope.yearly.name,
          stem: horoscope.yearly.heavenlyStem,
          branch: horoscope.yearly.earthlyBranch,
          mutagen: horoscope.yearly.mutagen || [],
        },
        monthly: horoscope.monthly ? {
          name: horoscope.monthly.name,
          stem: horoscope.monthly.heavenlyStem,
          branch: horoscope.monthly.earthlyBranch,
          mutagen: horoscope.monthly.mutagen || [],
        } : undefined,
        daily: horoscope.daily ? {
          name: horoscope.daily.name,
          stem: horoscope.daily.heavenlyStem,
          branch: horoscope.daily.earthlyBranch,
          mutagen: horoscope.daily.mutagen || [],
        } : undefined,
      };
    } catch {
      // Don't fail the whole chart, just skip horoscope
    }

    return NextResponse.json(chartData);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `ZWDS calculation failed: ${message}` },
      { status: 500 },
    );
  }
}
