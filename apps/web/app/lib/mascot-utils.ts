import type { HeavenlyStem } from '@repo/shared';

const STEM_TO_PINYIN: Record<HeavenlyStem, string> = {
  '甲': 'jia', '乙': 'yi', '丙': 'bing', '丁': 'ding', '戊': 'wu',
  '己': 'ji', '庚': 'geng', '辛': 'xin', '壬': 'ren', '癸': 'gui',
};

const STEM_TO_NAME: Record<HeavenlyStem, string> = {
  '甲': '甲木', '乙': '乙木', '丙': '丙火', '丁': '丁火', '戊': '戊土',
  '己': '己土', '庚': '庚金', '辛': '辛金', '壬': '壬水', '癸': '癸水',
};

const VALID_STEMS = new Set<string>(['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']);

export type MascotView = 'full' | 'half';
export type MascotGender = 'male' | 'female';

export function isValidStem(stem: unknown): stem is HeavenlyStem {
  return typeof stem === 'string' && VALID_STEMS.has(stem);
}

export function getMascotImagePath(
  stem: string,
  gender: MascotGender,
  view: MascotView
): string | null {
  if (!isValidStem(stem)) return null;
  const pinyin = STEM_TO_PINYIN[stem];
  return `/mascots/${pinyin}-${gender}-${view}.png`;
}

export function getMascotAltText(stem: string, view: MascotView): string {
  if (!isValidStem(stem)) return '角色卡';
  const viewLabel = view === 'full' ? '全身' : '半身';
  return `${STEM_TO_NAME[stem]} 角色卡 ${viewLabel}圖`;
}

export function getStemPinyin(stem: HeavenlyStem): string {
  return STEM_TO_PINYIN[stem];
}
