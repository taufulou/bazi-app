/**
 * Lifetime-reading deterministic widgets (RN). Ported from the web
 * AIReadingDisplay monolith:
 *   - CharacterCard (你的角色卡) — day-master mascot + 4-layer personality
 *     assembly + 神煞 chips (web ~line 1484 + reference tables ~1423).
 *   - LifetimeDeterministicCard — the DeterministicCard switch (web ~2390)
 *     narrowed to the 5 lifetime section→widget mappings, rendered bare so
 *     the caller can slot it inside an existing ReadingSectionCard.
 *
 * RN-only: expo-image for the remote mascot; everything else builds on the
 * shared reading primitives + theme tokens. Robust by design — any missing
 * chartData / det field degrades to less content, never a throw.
 */
import * as React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { colors, fonts, fontSize, spacing, radius, shadows } from '../../theme';
import { useZh } from '../../lib/language';
import { env } from '../../lib/env';
import type { LifetimeV2DeterministicData } from '../../lib/readings-api';
import { ChipGroup } from './primitives';

// ============================================================
// Reference tables (deterministic, guide-style) — ported verbatim
// ============================================================

const STEM_TO_PINYIN: Record<string, string> = {
  甲: 'jia', 乙: 'yi', 丙: 'bing', 丁: 'ding', 戊: 'wu',
  己: 'ji', 庚: 'geng', 辛: 'xin', 壬: 'ren', 癸: 'gui',
};

function isValidStem(stem: unknown): stem is string {
  return typeof stem === 'string' && Object.prototype.hasOwnProperty.call(STEM_TO_PINYIN, stem);
}

const DAY_MASTER_PERSONALITY: Record<string, { archetype: string; traits: string }> = {
  甲: { archetype: '參天大樹', traits: '正直堅毅、有領導力、不善變通、固執但值得信賴' },
  乙: { archetype: '藤蔓花草', traits: '柔韌靈活、善於適應、溫和細膩、但容易依賴他人' },
  丙: { archetype: '太陽烈火', traits: '熱情開朗、光明磊落、樂觀進取、但性急易燃易滅' },
  丁: { archetype: '燈燭星火', traits: '內斂溫暖、心思細密、善解人意、但容易多慮優柔' },
  戊: { archetype: '高山土壤', traits: '沉著穩重、講求實際、忠厚誠懇、但行動緩慢缺乏靈活' },
  己: { archetype: '田園沃土', traits: '包容務實、善於蓄積、謹慎低調、但有時過於保守' },
  庚: { archetype: '精鋼利刃', traits: '果斷剛毅、重義氣、行動力強、但過於剛硬易傷人' },
  辛: { archetype: '珠寶首飾', traits: '精緻敏銳、審美獨到、注重品質、但有潔癖和完美主義' },
  壬: { archetype: '江河大海', traits: '智慧深沉、思維開闊、足智多謀、但容易飄忽不定' },
  癸: { archetype: '雨露甘霖', traits: '聰慧靈敏、洞察力強、善於感知、但容易多疑內耗' },
};

const TEN_GOD_PERSONALITY: Record<
  string,
  { core: string; external: string; internal: string; motivation: string }
> = {
  比肩: { core: '獨立自主、重視平等、不喜依賴', external: '表現得自信獨立、不卑不亢', internal: '內心追求公平對等的關係', motivation: '渴望建立平等互助的人際圈' },
  劫財: { core: '積極進取、競爭意識強、敢冒險', external: '表現得積極主動、喜歡社交', internal: '內心有強烈的得失心', motivation: '追求突破限制、贏得認可' },
  食神: { core: '溫和聰慧、注重生活品味、有藝術天賦', external: '表現得隨和親切、談吐優雅', internal: '內心追求精神滿足、重視生活品質', motivation: '渴望自在表達、享受創造與分享的過程' },
  傷官: { core: '才華橫溢、叛逆不羈、追求完美', external: '表現得鋒芒畢露、言辭犀利', internal: '內心極度追求自我表達', motivation: '渴望被認可為獨一無二的存在' },
  偏財: { core: '慷慨大方、善於交際、投資直覺好', external: '表現得八面玲瓏、出手闊綽', internal: '內心對物質和自由有強烈渴望', motivation: '追求財富自由和多元體驗' },
  正財: { core: '勤勉踏實、理財能力佳、注重穩定', external: '表現得穩重可靠、有責任感', internal: '內心重視安全感和穩定收入', motivation: '渴望建立穩固的經濟基礎' },
  偏官: { core: '果敢強勢、領導力強、抗壓力佳', external: '表現得嚴肅有威嚴、行動迅速', internal: '內心有改變世界的野心', motivation: '渴望掌控局面、征服挑戰' },
  正官: { core: '正直守規、責任感強、注重名譽', external: '表現得端正有禮、自律嚴謹', internal: '內心重視社會認可和道德標準', motivation: '渴望成為受人尊敬的典範' },
  偏印: { core: '思維獨特、直覺敏銳、興趣廣泛', external: '表現得安靜內斂、有些神秘', internal: '內心世界豐富、追求精神層面探索', motivation: '渴望發現常人看不到的真理' },
  正印: { core: '仁慈寬厚、學習力強、重視傳承', external: '表現得溫和包容、有學者氣質', internal: '內心追求知識和智慧的累積', motivation: '渴望透過學習成長來幫助他人' },
};

const STRENGTH_MODIFIER: Record<string, string> = {
  very_strong: '能量極旺——行動力爆表但需防過剛',
  strong: '能量偏強——實力穩固但需注意調和',
  neutral: '能量中和——靈活應變是你的優勢',
  weak: '能量偏弱——借力使力是你的生存智慧',
  very_weak: '能量極弱——順勢而為反而能成大事',
};

const BRANCH_ZODIAC: Record<string, string> = {
  子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔',
  辰: '龍', 巳: '蛇', 午: '馬', 未: '羊',
  申: '猴', 酉: '雞', 戌: '狗', 亥: '豬',
};

const ZODIAC_PERSONALITY: Record<string, string> = {
  鼠: '機靈敏銳、善於觀察、適應力強，擅長在變化中找到機會',
  牛: '踏實穩重、耐力驚人、值得信賴，但有時過於固執',
  虎: '自信果斷、有領袖魅力、勇於冒險，但容易衝動',
  兔: '溫文儒雅、善於交際、品味不凡，但容易逃避衝突',
  龍: '氣場強大、志向遠大、天生領袖，但有時過於自信',
  蛇: '深謀遠慮、洞察力強、神秘魅力，但容易多疑',
  馬: '活力充沛、熱情奔放、追求自由，但容易三分鐘熱度',
  羊: '溫柔體貼、藝術天份、善良和順，但容易優柔寡斷',
  猴: '聰明靈活、創意無限、多才多藝，但容易心浮氣躁',
  雞: '精明幹練、眼光獨到、追求完美，但容易挑剔',
  狗: '忠誠正直、有正義感、值得信賴，但容易杞人憂天',
  豬: '樂觀豁達、寬容大度、享受生活，但容易缺乏警覺',
};

// ============================================================
// Mascot image (remote, expo-image) with emoji/stem fallback
// ============================================================

function mascotUri(stem: string | undefined, gender: 'male' | 'female'): string | null {
  const pinyin = isValidStem(stem) ? STEM_TO_PINYIN[stem] : null;
  const base = (env.assetsUrl || '').replace(/\/+$/, '');
  if (!pinyin || !base) return null;
  return `${base}/mascots/${pinyin}-${gender}-full.png`;
}

function MascotImage({
  stem,
  gender,
  alt,
}: {
  stem?: string;
  gender: 'male' | 'female';
  alt: string;
}) {
  const [errored, setErrored] = React.useState(false);
  const uri = mascotUri(stem, gender);

  if (!uri || errored) {
    // Never crash on a missing base URL / broken image — show the day-master
    // stem glyph (or a card emoji) large as a graceful fallback.
    return (
      <View style={cc.mascotFallback}>
        <Text style={cc.mascotFallbackGlyph}>{isValidStem(stem) ? stem : '🎴'}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={cc.mascotImage}
      contentFit="contain"
      cachePolicy="disk"
      accessibilityLabel={alt}
      onError={() => setErrored(true)}
    />
  );
}

// ============================================================
// CharacterCard — standalone top-level card (你的角色卡)
// ============================================================

export function CharacterCard({
  chartData,
}: {
  chartData: Record<string, unknown> | null;
}): React.ReactNode {
  const zh = useZh();
  if (!chartData) return null;

  const dm = chartData.dayMaster as
    | {
        strength?: string;
        pattern?: string;
        usefulGod?: string;
        tabooGod?: string;
      }
    | undefined;
  const fp = (chartData.fourPillars ?? undefined) as
    | Record<
        string,
        {
          stem?: string;
          branch?: string;
          tenGod?: string;
          hiddenStemGods?: Array<{ stem?: string; tenGod?: string }>;
          shenSha?: string[];
        }
      >
    | undefined;

  // Day-master stem: prefer the explicit field, fall back to the day pillar.
  const dayMasterStem =
    (chartData.dayMasterStem as string | undefined) ?? fp?.day?.stem;
  const gender = (chartData.gender as string) === 'female' ? 'female' : 'male';

  // Nothing meaningful to draw without a resolvable day master.
  const personality = isValidStem(dayMasterStem)
    ? DAY_MASTER_PERSONALITY[dayMasterStem]
    : undefined;
  if (!dayMasterStem && !personality) return null;

  // Layer 2: external impression from month pillar ten god.
  const monthGod = fp?.month?.tenGod;
  const externalTrait =
    monthGod === '比肩'
      ? personality
        ? `外在形象與本質一致——${personality.traits.split('、')[0]}`
        : undefined
      : monthGod
        ? TEN_GOD_PERSONALITY[monthGod]?.external
        : undefined;

  // Layer 3: internal character from day-branch hidden-stem main qi.
  const dayMainQiGod = fp?.day?.hiddenStemGods?.[0]?.tenGod;
  const internalTrait = dayMainQiGod ? TEN_GOD_PERSONALITY[dayMainQiGod]?.internal : undefined;

  // Layer 4: driving force from hour pillar ten god.
  const hourGod = fp?.hour?.tenGod;
  const motivationTrait = hourGod ? TEN_GOD_PERSONALITY[hourGod]?.motivation : undefined;

  // Zodiac from year branch.
  const yearBranch = fp?.year?.branch;
  const zodiac = yearBranch ? BRANCH_ZODIAC[yearBranch] : undefined;
  const zodiacTrait = zodiac ? ZODIAC_PERSONALITY[zodiac] : undefined;

  const strengthText = dm?.strength ? STRENGTH_MODIFIER[dm.strength] : undefined;

  // Key 神煞 — collect all, dedupe, cap at 5.
  const allShenSha: string[] = [];
  if (fp) {
    for (const pillar of Object.values(fp)) {
      if (pillar?.shenSha) allShenSha.push(...pillar.shenSha);
    }
  }
  const keyShenSha = [...new Set(allShenSha)].slice(0, 5);

  const stats: Array<{ label: string; value: string }> = [];
  if (dm?.pattern) stats.push({ label: '角色定位', value: dm.pattern });
  if (strengthText) stats.push({ label: '能量狀態', value: strengthText });
  if (dm?.usefulGod) stats.push({ label: '最強加持', value: dm.usefulGod });
  if (dm?.tabooGod) stats.push({ label: '隱藏地雷', value: dm.tabooGod });

  return (
    <View style={cc.card}>
      {/* Header */}
      <View style={cc.header}>
        <Text style={cc.title}>{zh('🎴 你的角色卡')}</Text>
        {zodiac ? (
          <View style={cc.zodiacBadge}>
            <Text style={cc.zodiacBadgeText}>{zh(`${zodiac}年生`)}</Text>
          </View>
        ) : null}
      </View>

      {/* Mascot hero */}
      <MascotImage stem={dayMasterStem} gender={gender} alt={zh('角色卡')} />

      {/* Archetype */}
      {personality ? (
        <View style={cc.archetype}>
          <Text style={cc.archetypeLabel}>{zh('核心屬性')}</Text>
          <Text style={cc.archetypeValue}>{zh(personality.archetype)}</Text>
        </View>
      ) : null}

      {/* Personality layers */}
      <View style={cc.layers}>
        {personality ? (
          <Layer label={zh('🌟 本質')} value={zh(personality.traits)} />
        ) : null}
        {externalTrait ? <Layer label={zh('🎭 外在印象')} value={zh(externalTrait)} /> : null}
        {internalTrait ? <Layer label={zh('💎 內在性格')} value={zh(internalTrait)} /> : null}
        {motivationTrait ? <Layer label={zh('🔥 核心驅動力')} value={zh(motivationTrait)} /> : null}
        {zodiacTrait ? <Layer label={zh(`🐾 生肖特質（${zodiac}）`)} value={zh(zodiacTrait)} /> : null}
      </View>

      {/* Stats */}
      {stats.length > 0 ? (
        <View style={cc.stats}>
          {stats.map((s) => (
            <View key={s.label} style={cc.statItem}>
              <Text style={cc.statLabel}>{zh(s.label)}</Text>
              <Text style={cc.statValue}>{zh(s.value)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Key 神煞 */}
      {keyShenSha.length > 0 ? (
        <View style={cc.shensha}>
          <Text style={cc.shenshaLabel}>{zh('特殊天賦/標記')}</Text>
          <ChipGroup items={keyShenSha.map((s) => zh(s))} tone="gold" />
        </View>
      ) : null}
    </View>
  );
}

function Layer({ label, value }: { label: string; value: string }) {
  return (
    <View style={cc.layer}>
      <Text style={cc.layerLabel}>{label}</Text>
      <Text style={cc.layerValue}>{value}</Text>
    </View>
  );
}

// ============================================================
// Shared deterministic-card building blocks (bare, no card chrome)
// ============================================================

/** Label + content row, with an optional explanation paragraph below. */
function DetRow({
  label,
  children,
  explain,
}: {
  label: string;
  children: React.ReactNode;
  explain?: string;
}) {
  return (
    <View style={det.row}>
      <Text style={det.label}>{label}</Text>
      {children}
      {explain ? <Text style={det.explain}>{explain}</Text> : null}
    </View>
  );
}

function LockedSummary({ text }: { text: string }) {
  return <Text style={det.blurred}>{text}</Text>;
}

// ============================================================
// finance_pattern → investments
// ============================================================

function InvestmentsCard({
  det: data,
  isSubscriber,
}: {
  det: LifetimeV2DeterministicData;
  isSubscriber: boolean;
}): React.ReactElement | null {
  const zh = useZh();
  if (!data.favorableInvestments || !data.unfavorableInvestments) return null;

  return (
    <View style={det.body}>
      <Text style={det.disclaimer}>
        {zh('投資有風險，此測算結果內容僅供參考，絕不構成任何投資建議或承諾')}
      </Text>
      <DetRow label={zh('有利投資')}>
        {isSubscriber ? (
          <ChipGroup items={data.favorableInvestments.map((i) => zh(i))} tone="positive" />
        ) : (
          <LockedSummary text={zh(`${data.favorableInvestments.length} 項有利投資方向`)} />
        )}
      </DetRow>
      <DetRow label={zh('不利投資')}>
        {isSubscriber ? (
          <ChipGroup items={data.unfavorableInvestments.map((i) => zh(i))} tone="negative" />
        ) : (
          <LockedSummary text={zh(`${data.unfavorableInvestments.length} 項需注意投資`)} />
        )}
      </DetRow>
    </View>
  );
}

// ============================================================
// career_pattern → career_data
// ============================================================

function CareerDataCard({
  det: data,
  chartData,
  isSubscriber,
}: {
  det: LifetimeV2DeterministicData;
  chartData: Record<string, unknown> | null;
  isSubscriber: boolean;
}): React.ReactElement | null {
  const zh = useZh();
  if (!data.careerDirections || !data.careerBenefactorsElement || !data.careerBenefactorsZodiac) {
    return null;
  }

  const fp = (chartData?.fourPillars ?? null) as { year?: { branch?: string } } | null;
  const yearBranch = fp?.year?.branch;
  const userZodiac = (yearBranch ? BRANCH_ZODIAC[yearBranch] : null) || null;

  return (
    <View style={det.body}>
      {/* Career directions */}
      {data.careerDirections.length > 0 ? (
        <DetRow label={zh('職業方向')}>
          {isSubscriber ? (
            <View style={det.dirList}>
              {data.careerDirections.map((dir) => {
                const industries = dir.industries.slice(0, 5).map((i) => zh(i));
                if (dir.industries.length > 5) {
                  industries.push(zh(`+${dir.industries.length - 5}`));
                }
                return (
                  <View key={dir.category} style={det.dirItem}>
                    <Text style={det.dirHeading}>
                      {zh(dir.anchor)}
                      {'  ·  '}
                      {zh(dir.category)}
                    </Text>
                    <ChipGroup items={industries} tone="neutral" />
                  </View>
                );
              })}
            </View>
          ) : (
            <LockedSummary text={zh(`${data.careerDirections.length} 大職業方向`)} />
          )}
        </DetRow>
      ) : null}

      {/* Favorable direction */}
      {data.favorableDirection ? (
        <DetRow
          label={zh('有利方位')}
          explain={
            isSubscriber
              ? data.favorableDirection === '中央'
                ? zh('根據你的命格，適合在出生地或家鄉附近發展。若已固定了工作的城市，選擇市中心區域會比較有利。')
                : zh(`根據你的命格，有利於職業發展的方位為出生地的${data.favorableDirection}。若已固定了工作的城市，則可選擇往該城市的${data.favorableDirection}發展。`)
              : undefined
          }
        >
          {isSubscriber ? (
            <ChipGroup items={[zh(data.favorableDirection)]} tone="positive" />
          ) : (
            <LockedSummary text={zh('方位資訊')} />
          )}
        </DetRow>
      ) : null}

      {/* Benefactors by element */}
      {data.careerBenefactorsElement.length > 0 ? (
        <DetRow
          label={zh('事業貴人五行')}
          explain={
            isSubscriber
              ? zh(`和五行屬性為${data.careerBenefactorsElement.join('、')}的人共事或合作，會比較有利於你的事業發展，能起到幫扶的作用。`)
              : undefined
          }
        >
          {isSubscriber ? (
            <ChipGroup items={data.careerBenefactorsElement.map((e) => zh(e))} tone="positive" />
          ) : (
            <LockedSummary text={zh('貴人五行')} />
          )}
        </DetRow>
      ) : null}

      {/* Benefactors by zodiac */}
      {data.careerBenefactorsZodiac.length > 0 ? (
        <DetRow
          label={zh('事業貴人生肖')}
          explain={
            isSubscriber
              ? zh(`${userZodiac ? `你的生肖為${userZodiac}，` : ''}在事業上與屬${data.careerBenefactorsZodiac.join('、屬')}的人共事比較合拍，互相生旺，對你的發展有扶助作用。`)
              : undefined
          }
        >
          {isSubscriber ? (
            <ChipGroup items={data.careerBenefactorsZodiac.map((z) => zh(z))} tone="positive" />
          ) : (
            <LockedSummary text={zh('貴人生肖')} />
          )}
        </DetRow>
      ) : null}
    </View>
  );
}

// ============================================================
// love_pattern → love_data
// ============================================================

function LoveDataCard({
  det: data,
  chartData,
  isSubscriber,
}: {
  det: LifetimeV2DeterministicData;
  chartData: Record<string, unknown> | null;
  isSubscriber: boolean;
}): React.ReactElement | null {
  const zh = useZh();
  if (!data.romanceYears || !data.partnerElement || !data.partnerZodiac) return null;

  const fp = (chartData?.fourPillars ?? null) as { year?: { branch?: string } } | null;
  const yearBranch = fp?.year?.branch;
  const userZodiac = (yearBranch ? BRANCH_ZODIAC[yearBranch] : null) || null;

  return (
    <View style={det.body}>
      {/* Romance years */}
      {data.romanceYears.length > 0 ? (
        <DetRow
          label={zh('桃花姻緣年份')}
          explain={
            isSubscriber
              ? zh('這些年份的流年與你的感情宮或配偶星產生共振，是感情出現機緣的高機率時段。單身者可積極把握社交機會。')
              : undefined
          }
        >
          {isSubscriber ? (
            <ChipGroup items={data.romanceYears.map(String)} tone="gold" />
          ) : (
            <LockedSummary text={zh(`未來有 ${data.romanceYears.length} 個桃花年份`)} />
          )}
        </DetRow>
      ) : null}

      {/* Warning years */}
      {data.romanceWarningYears && data.romanceWarningYears.length > 0 ? (
        <DetRow
          label={zh('⚠️ 感情波動年')}
          explain={
            isSubscriber
              ? zh('這些年份流年沖擊感情宮，感情較易出現波動或考驗。已有伴侶者須特別注意溝通與維繫，單身者感情宮被觸動，姻緣或有變化，但順逆須結合整體運勢判斷。')
              : undefined
          }
        >
          {isSubscriber ? (
            <ChipGroup items={data.romanceWarningYears.map(String)} tone="negative" />
          ) : (
            <LockedSummary text={zh(`有 ${data.romanceWarningYears.length} 個波動年份`)} />
          )}
        </DetRow>
      ) : null}

      {/* Partner element */}
      {data.partnerElement.length > 0 ? (
        <DetRow
          label={zh('擇偶建議五行')}
          explain={
            isSubscriber
              ? zh(`和五行屬性為${data.partnerElement.join('、')}的人在一起，對方的五行能量對你有扶助作用，感情較為和諧穩定。`)
              : undefined
          }
        >
          {isSubscriber ? (
            <ChipGroup items={data.partnerElement.map((e) => zh(e))} tone="positive" />
          ) : (
            <LockedSummary text={zh('五行建議')} />
          )}
        </DetRow>
      ) : null}

      {/* Partner zodiac */}
      {data.partnerZodiac.length > 0 ? (
        <DetRow
          label={zh('擇偶建議生肖')}
          explain={
            isSubscriber
              ? zh(`${userZodiac ? `你的生肖為${userZodiac}，` : ''}與屬${data.partnerZodiac.join('、屬')}的人在感情上比較投緣，相處融洽。`)
              : undefined
          }
        >
          {isSubscriber ? (
            <ChipGroup items={data.partnerZodiac.map((z) => zh(z))} tone="positive" />
          ) : (
            <LockedSummary text={zh('生肖建議')} />
          )}
        </DetRow>
      ) : null}
    </View>
  );
}

// ============================================================
// children_analysis / parents_analysis → family_data
// ============================================================

function FamilyDataCard({
  det: data,
  isSubscriber,
}: {
  det: LifetimeV2DeterministicData;
  isSubscriber: boolean;
}): React.ReactElement | null {
  const zh = useZh();
  const father = data.parentHealthYears?.father;
  const mother = data.parentHealthYears?.mother;
  if (!father || !mother) return null;

  const renderYears = (years: number[], count: number) => {
    if (!isSubscriber) return <LockedSummary text={zh(`${count} 個注意年份`)} />;
    if (years.length === 0) return <Text style={det.note}>{zh('近15年無特別注意年份')}</Text>;
    return <ChipGroup items={years.map(String)} tone="negative" />;
  };

  return (
    <View style={det.body}>
      <DetRow label={zh('父親健康注意年份')}>{renderYears(father, father.length)}</DetRow>
      <DetRow label={zh('母親健康注意年份')}>{renderYears(mother, mother.length)}</DetRow>
    </View>
  );
}

// ============================================================
// chart_identity → day_pillar_detailed
// ============================================================

function DayPillarDetailedCard({
  det: data,
  isSubscriber,
}: {
  det: LifetimeV2DeterministicData;
  isSubscriber: boolean;
}): React.ReactElement | null {
  const zh = useZh();
  const dpd = data.dayPillarDetailed;
  if (!dpd) return null;

  const blocks: Array<{ icon: string; label: string; value: string; locked: boolean }> = [
    { icon: '🏔', label: '核心意象', value: dpd.coreImage, locked: false },
    { icon: '🧭', label: '個性', value: dpd.personality, locked: !isSubscriber },
    { icon: '💼', label: '事業', value: dpd.career, locked: !isSubscriber },
    { icon: '💞', label: '人際', value: dpd.relationships, locked: !isSubscriber },
    { icon: '💡', label: '建議', value: dpd.advice, locked: !isSubscriber },
  ];

  return (
    <View style={det.body}>
      {dpd.title ? (
        <View style={det.dpdHeader}>
          <Text style={det.dpdTitle}>{zh(dpd.title)}</Text>
          {dpd.subtitle ? <Text style={det.dpdSubtitle}>{zh(dpd.subtitle)}</Text> : null}
        </View>
      ) : null}
      {blocks.map((b) => (
        <View key={b.label} style={det.dpdBlock}>
          <Text style={det.dpdBlockLabel}>{zh(`${b.icon} ${b.label}`)}</Text>
          {b.locked ? (
            <Text style={det.blurred}>{zh('訂閱後解鎖完整解讀')}</Text>
          ) : (
            <Text style={det.dpdBlockText}>{zh(b.value)}</Text>
          )}
        </View>
      ))}
    </View>
  );
}

// ============================================================
// Dispatcher — section key → deterministic widget (bare content)
// ============================================================

export function LifetimeDeterministicCard({
  sectionKey,
  det: data,
  chartData,
  isSubscriber,
}: {
  sectionKey: string;
  det: LifetimeV2DeterministicData;
  chartData: Record<string, unknown> | null;
  isSubscriber: boolean;
}): React.ReactNode {
  if (!data) return null;

  switch (sectionKey) {
    case 'finance_pattern':
      return <InvestmentsCard det={data} isSubscriber={isSubscriber} />;
    case 'career_pattern':
      return <CareerDataCard det={data} chartData={chartData} isSubscriber={isSubscriber} />;
    case 'love_pattern':
      return <LoveDataCard det={data} chartData={chartData} isSubscriber={isSubscriber} />;
    case 'children_analysis':
    case 'parents_analysis':
      return <FamilyDataCard det={data} isSubscriber={isSubscriber} />;
    case 'chart_identity':
      return <DayPillarDetailedCard det={data} isSubscriber={isSubscriber} />;
    default:
      return null;
  }
}

// ============================================================
// Styles
// ============================================================

const cc = StyleSheet.create({
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.warm,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent, flex: 1 },
  zodiacBadge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: `${colors.gold}1F`,
    borderWidth: 1,
    borderColor: colors.borderMedium,
  },
  zodiacBadgeText: { fontSize: fontSize.xs, fontWeight: '700', color: colors.textOnGold },
  mascotImage: { width: '100%', height: 280, borderRadius: radius.md },
  mascotFallback: {
    width: '100%',
    height: 200,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSecondary,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderStyle: 'dashed',
  },
  mascotFallbackGlyph: { fontFamily: fonts.serif, fontSize: 96, color: colors.textAccent },
  archetype: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgBannerWarm,
    borderRadius: radius.md,
  },
  archetypeLabel: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: '600', letterSpacing: 1 },
  archetypeValue: { fontFamily: fonts.serifBold, fontSize: fontSize.xl, fontWeight: '700', color: colors.textAccent },
  layers: { gap: spacing.md },
  layer: { gap: 2 },
  layerLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  layerValue: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 26 },
  stats: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  statItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.md },
  statLabel: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
  statValue: { fontSize: fontSize.sm, color: colors.textPrimary, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  shensha: { gap: spacing.xs, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
  shenshaLabel: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '600' },
});

const det = StyleSheet.create({
  body: { gap: spacing.md },
  row: { gap: spacing.xs },
  label: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  explain: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 22 },
  blurred: { fontSize: fontSize.sm, color: colors.textMuted, fontStyle: 'italic' },
  note: { fontSize: fontSize.sm, color: colors.textMuted },
  disclaimer: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18 },
  dirList: { gap: spacing.sm },
  dirItem: { gap: spacing.xs },
  dirHeading: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textAccent },
  dpdHeader: { gap: 2, paddingBottom: spacing.xs },
  dpdTitle: { fontFamily: fonts.serifBold, fontSize: fontSize.lg, fontWeight: '700', color: colors.textAccent },
  dpdSubtitle: { fontSize: fontSize.sm, color: colors.textMuted },
  dpdBlock: { gap: spacing.xs },
  dpdBlockLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.textSecondary },
  dpdBlockText: { fontSize: fontSize.base, color: colors.textPrimary, lineHeight: 26 },
});
