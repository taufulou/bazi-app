"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import BirthDataForm, {
  type BirthDataFormValues,
} from "../../components/BirthDataForm";
import BaziChart from "../../components/BaziChart";
import ZwdsChart from "../../components/ZwdsChart";
import AIReadingDisplay from "../../components/AIReadingDisplay";
import { calculateBaziDirect, getSubscriptionStatus, checkFreeReading } from "../../lib/api";
import type { ZwdsChartData } from "../../lib/zwds-api";
import { READING_TYPE_META } from "@repo/shared";
import styles from "./page.module.css";

// ============================================================
// Types
// ============================================================

type ReadingTypeSlug =
  | "lifetime"
  | "annual"
  | "career"
  | "love"
  | "health"
  | "compatibility"
  | "zwds-lifetime"
  | "zwds-annual"
  | "zwds-career"
  | "zwds-love"
  | "zwds-health"
  | "zwds-compatibility"
  | "zwds-monthly"
  | "zwds-daily"
  | "zwds-major-period"
  | "zwds-qa";

type ViewStep = "input" | "result";
type ResultTab = "chart" | "reading";

interface ReadingSectionData {
  key: string;
  title: string;
  preview: string;
  full: string;
}

interface AIReadingData {
  sections: ReadingSectionData[];
  summary?: { text: string };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type BaziChartData = any;

const VALID_TYPES: ReadingTypeSlug[] = [
  "lifetime",
  "annual",
  "career",
  "love",
  "health",
  "compatibility",
  "zwds-lifetime",
  "zwds-annual",
  "zwds-career",
  "zwds-love",
  "zwds-health",
  "zwds-compatibility",
  "zwds-monthly",
  "zwds-daily",
  "zwds-major-period",
  "zwds-qa",
];

// ============================================================
// Helpers
// ============================================================

function isZwdsType(type: string): boolean {
  return type.startsWith("zwds-");
}

// ============================================================
// Component
// ============================================================

export default function ReadingPage() {
  const params = useParams();
  const router = useRouter();
  const readingType = params.type as string;

  // Validate reading type
  if (!VALID_TYPES.includes(readingType as ReadingTypeSlug)) {
    return <InvalidTypePage />;
  }

  const meta = READING_TYPE_META[readingType as ReadingTypeSlug];
  const isZwds = isZwdsType(readingType);

  // State
  const [step, setStep] = useState<ViewStep>("input");
  const [tab, setTab] = useState<ResultTab>("chart");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [chartData, setChartData] = useState<BaziChartData | null>(null);
  const [zwdsChartData, setZwdsChartData] = useState<ZwdsChartData | null>(null);
  const [aiData, setAiData] = useState<AIReadingData | null>(null);
  const [formValues, setFormValues] = useState<BirthDataFormValues | null>(
    null,
  );

  // Phase 8B: Extra inputs for monthly/daily/Q&A
  const [targetMonth, setTargetMonth] = useState<number>(new Date().getMonth() + 1);
  const [targetDay, setTargetDay] = useState<string>(
    `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`
  );
  const [questionText, setQuestionText] = useState<string>("");

  const needsMonthPicker = readingType === "zwds-monthly";
  const needsDatePicker = readingType === "zwds-daily";
  const needsQuestion = readingType === "zwds-qa";

  // Check subscription status via Clerk auth + API
  const { getToken, isSignedIn } = useAuth();
  const [isSubscriber, setIsSubscriber] = useState(false);
  const [hasFreeReading, setHasFreeReading] = useState(false);

  useEffect(() => {
    async function checkSubscription() {
      if (!isSignedIn) {
        setIsSubscriber(false);
        return;
      }
      try {
        const token = await getToken();
        if (!token) return;

        const [subStatus, freeStatus] = await Promise.all([
          getSubscriptionStatus(token).catch(() => null),
          checkFreeReading(token).catch(() => null),
        ]);

        if (subStatus && subStatus.subscribed) {
          setIsSubscriber(true);
        }
        if (freeStatus && freeStatus.available) {
          setHasFreeReading(true);
        }
      } catch {
        // If API is not available, default to non-subscriber
        setIsSubscriber(false);
      }
    }
    checkSubscription();
  }, [isSignedIn, getToken]);

  const handleFormSubmit = useCallback(
    async (data: BirthDataFormValues) => {
      setFormValues(data);
      setIsLoading(true);
      setError(undefined);

      try {
        if (isZwds) {
          // Validate extra inputs for Phase 8B types
          if (needsQuestion && !questionText.trim()) {
            setError("請輸入您的問題");
            setIsLoading(false);
            return;
          }

          // ZWDS: Generate mock chart data for now
          // In production, this calls POST /api/zwds/readings via NestJS
          const mockChart = generateMockZwdsChart(data);
          setZwdsChartData(mockChart);

          // Generate mock AI reading data for ZWDS
          const mockAI = generateMockZwdsReading(readingType as ReadingTypeSlug);
          setAiData(mockAI);
        } else {
          // Bazi: Call the Python engine directly for chart calculation
          const result = await calculateBaziDirect({
            birth_date: data.birthDate,
            birth_time: data.birthTime,
            birth_city: data.birthCity,
            timezone: data.birthTimezone,
            gender: data.gender,
            target_year:
              readingType === "annual" ? new Date().getFullYear() : undefined,
          });

          setChartData(result);

          // Generate mock AI reading data for display
          const mockAI = generateMockReading(readingType as ReadingTypeSlug);
          setAiData(mockAI);
        }

        setStep("result");
        setTab("chart");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "排盤失敗，請稍後再試";
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [readingType, isZwds],
  );

  const handleRetry = () => {
    if (formValues) {
      handleFormSubmit(formValues);
    }
  };

  const handleBack = () => {
    if (step === "result") {
      setStep("input");
      setChartData(null);
      setZwdsChartData(null);
      setAiData(null);
    } else {
      router.push("/dashboard");
    }
  };

  return (
    <div className={styles.pageContainer}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backLink} onClick={handleBack}>
          ← {step === "result" ? "重新輸入" : "返回"}
        </button>
        <div className={styles.headerTitle}>
          <span className={styles.headerIcon}>{meta.icon}</span>
          {meta.nameZhTw}
        </div>
      </div>

      {/* Step Indicator */}
      <div className={styles.stepIndicator}>
        <div
          className={
            step === "input" ? styles.stepActive : styles.stepCompleted
          }
        >
          <span className={styles.stepNumber}>
            {step === "input" ? "1" : "✓"}
          </span>
          輸入資料
        </div>
        <div className={step === "result" ? styles.stepLineActive : styles.stepLine} />
        <div
          className={step === "result" ? styles.stepActive : styles.step}
        >
          <span className={styles.stepNumber}>2</span>
          查看結果
        </div>
      </div>

      {/* Content */}
      <div className={styles.contentArea}>
        {step === "input" && (
          <>
            <BirthDataForm
              onSubmit={handleFormSubmit}
              isLoading={isLoading}
              error={error}
              title={`${meta.nameZhTw} — 輸入出生資料`}
              subtitle={meta.description["zh-TW"]}
              submitLabel="開始分析"
            >
              {/* Phase 8B: Extra inputs for monthly/daily/Q&A */}
              {needsMonthPicker && (
                <div className={styles.extraInput}>
                  <label className={styles.extraInputLabel}>分析年月</label>
                  <div className={styles.extraInputRow}>
                    <select
                      className={styles.extraInputSelect}
                      value={new Date().getFullYear()}
                      disabled
                    >
                      <option value={new Date().getFullYear()}>{new Date().getFullYear()} 年</option>
                    </select>
                    <select
                      className={styles.extraInputSelect}
                      value={targetMonth}
                      onChange={(e) => setTargetMonth(Number(e.target.value))}
                    >
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>{m} 月</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {needsDatePicker && (
                <div className={styles.extraInput}>
                  <label className={styles.extraInputLabel}>分析日期</label>
                  <input
                    type="date"
                    className={styles.extraInputDate}
                    value={(() => {
                      const parts = targetDay.split("-");
                      return `${parts[0]}-${(parts[1] || "1").padStart(2, "0")}-${(parts[2] || "1").padStart(2, "0")}`;
                    })()}
                    onChange={(e) => {
                      const d = new Date(e.target.value);
                      if (!isNaN(d.getTime())) {
                        setTargetDay(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
                      }
                    }}
                  />
                </div>
              )}

              {needsQuestion && (
                <div className={styles.extraInput}>
                  <label className={styles.extraInputLabel}>您想問什麼？</label>
                  <textarea
                    className={styles.extraInputTextarea}
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value.slice(0, 500))}
                    placeholder="請輸入您的問題，例如：今年適合跳槽嗎？我的感情何時有進展？"
                    rows={3}
                    maxLength={500}
                  />
                  <div className={styles.extraInputHint}>
                    {questionText.length}/500 字
                  </div>
                </div>
              )}
            </BirthDataForm>
          </>
        )}

        {step === "result" && (
          <>
            {/* Tab bar: Chart / Reading */}
            <div className={styles.tabBar}>
              <button
                className={
                  tab === "chart" ? styles.tabActive : styles.tab
                }
                onClick={() => setTab("chart")}
              >
                {isZwds ? "🌟 紫微命盤" : "📊 命盤排盤"}
              </button>
              <button
                className={
                  tab === "reading" ? styles.tabActive : styles.tab
                }
                onClick={() => setTab("reading")}
              >
                📝 AI 解讀
              </button>
            </div>

            {/* Error state */}
            {error && (
              <div className={styles.errorMessage}>
                <div className={styles.errorIcon}>⚠️</div>
                <div className={styles.errorText}>{error}</div>
                <button className={styles.retryBtn} onClick={handleRetry}>
                  重新嘗試
                </button>
              </div>
            )}

            {/* Chart view */}
            {tab === "chart" && isZwds && zwdsChartData && (
              <ZwdsChart
                data={zwdsChartData}
                name={formValues?.name}
                birthDate={formValues?.birthDate}
                birthTime={formValues?.birthTime}
              />
            )}

            {tab === "chart" && !isZwds && chartData && (
              <BaziChart
                data={chartData}
                name={formValues?.name}
                birthDate={formValues?.birthDate}
                birthTime={formValues?.birthTime}
              />
            )}

            {/* Reading view */}
            {tab === "reading" && (
              <AIReadingDisplay
                data={aiData}
                readingType={readingType}
                isSubscriber={isSubscriber}
                isLoading={isLoading}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Invalid type page
// ============================================================

function InvalidTypePage() {
  return (
    <div className={styles.pageContainer}>
      <div className={styles.invalidType}>
        <div className={styles.invalidIcon}>🔮</div>
        <h2 className={styles.invalidTitle}>找不到此分析類型</h2>
        <p className={styles.invalidText}>
          請從控制台選擇一個有效的分析類型
        </p>
        <Link href="/dashboard" className={styles.dashboardLink}>
          返回控制台
        </Link>
      </div>
    </div>
  );
}

// ============================================================
// Mock ZWDS chart data (placeholder until real API is connected)
// ============================================================

function generateMockZwdsChart(formData: BirthDataFormValues): ZwdsChartData {
  const branches = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
  const stems = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
  const palaceNames = [
    "命宮", "兄弟", "夫妻", "子女", "財帛", "疾厄",
    "遷移", "僕役", "官祿", "田宅", "福德", "父母",
  ];

  const majorStarPool = [
    "紫微", "天機", "太陽", "武曲", "天同", "廉貞", "天府",
    "太陰", "貪狼", "巨門", "天相", "天梁", "七殺", "破軍",
  ];
  const brightnessLevels = ["廟", "旺", "得", "利", "平", "不", "陷"];
  const mutagenPool = ["祿", "權", "科", "忌"];

  // Distribute major stars across palaces
  let starIdx = 0;
  const palaces = palaceNames.map((name, i) => {
    const numMajor = i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0;
    const majorStars = [];
    for (let j = 0; j < numMajor && starIdx < majorStarPool.length; j++) {
      const hasMutagen = starIdx < 4;
      majorStars.push({
        name: majorStarPool[starIdx]!,
        type: "major" as const,
        brightness: brightnessLevels[starIdx % brightnessLevels.length]!,
        mutagen: hasMutagen ? mutagenPool[starIdx]! : undefined,
      });
      starIdx++;
    }

    return {
      name,
      index: i,
      isBodyPalace: i === 6,
      heavenlyStem: stems[i % 10]!,
      earthlyBranch: branches[i]!,
      majorStars,
      minorStars: i % 2 === 0 ? [
        { name: "文昌", type: "minor" as const, brightness: "旺" },
        { name: "左輔", type: "minor" as const },
      ] : [],
      adjectiveStars: i % 3 === 0 ? [
        { name: "天刑", type: "adjective" as const },
      ] : [],
      changsheng12: (["長生", "沐浴", "冠帶", "臨官", "帝旺", "衰", "病", "死", "墓", "絕", "胎", "養"] as const)[i]!,
      decadal: {
        startAge: 2 + i * 10,
        endAge: 11 + i * 10,
        stem: stems[(i + 2) % 10]!,
        branch: branches[(i + 2) % 12]!,
      },
      ages: [i + 1, i + 13, i + 25, i + 37, i + 49, i + 61, i + 73, i + 85],
    };
  });

  return {
    solarDate: formData.birthDate,
    lunarDate: "農曆二〇〇〇年正月初十",
    chineseDate: "庚辰年 戊寅月 甲子日",
    birthTime: "丑時",
    timeRange: "01:00~03:00",
    gender: formData.gender,
    zodiac: "龍",
    sign: "水瓶座",
    fiveElementsClass: "水二局",
    soulPalaceBranch: "戌",
    bodyPalaceBranch: "申",
    soulStar: "貪狼",
    bodyStar: "天相",
    palaces,
  };
}

// ============================================================
// Mock ZWDS AI reading data
// ============================================================

function generateMockZwdsReading(type: ReadingTypeSlug): AIReadingData {
  const zwdsSectionsByType: Partial<Record<ReadingTypeSlug, ReadingSectionData[]>> = {
    "zwds-lifetime": [
      {
        key: "personality",
        title: "命宮星曜分析",
        preview: "您的命宮坐紫微星於廟位，紫微為帝座之星，代表您天生具有領導氣質和王者風範。",
        full: "您的命宮坐紫微星於廟位，紫微為帝座之星，代表您天生具有領導氣質和王者風範。\n\n命宮同時見天機星，紫微天機同宮，代表智慧與權力並存。此格局之人聰明絕頂，善於謀劃，在事業上往往能成就一番大業。化祿入命宮，更增添命格的吉利，代表一生財祿豐厚，貴人運強。",
      },
      {
        key: "life_pattern",
        title: "人生格局分析",
        preview: "從十二宮位整體觀之，您的命盤呈「紫府朝垣」之格局，為紫微斗數中的上等格局之一。",
        full: "從十二宮位整體觀之，您的命盤呈「紫府朝垣」之格局，為紫微斗數中的上等格局之一。\n\n三方四正均有吉星坐守，且無煞星沖破，格局完整。事業宮見天府星廟旺，主事業穩健；財帛宮見武曲星化權，主財運亨通。福德宮天同星入廟，代表心性豁達、懂得享受生活。",
      },
      {
        key: "major_periods",
        title: "大限走勢分析",
        preview: "第一大限（2-11歲）走父母宮，天梁星坐守，少年時期受長輩庇護，學業運佳。",
        full: "第一大限（2-11歲）走父母宮，天梁星坐守，少年時期受長輩庇護。\n第二大限（12-21歲）走福德宮，天同星入廟，青年時期順遂。\n第三大限（22-31歲）走田宅宮，太陰星化科，有利置產。\n第四大限（32-41歲）走官祿宮，天府星廟旺化祿，事業黃金期。\n第五大限（42-51歲）走僕役宮，人際擴展期。",
      },
      {
        key: "overall_destiny",
        title: "一生命運總評",
        preview: "綜合十二宮位分析，您的命格屬上中等格局。命宮主星明亮，三方四正無煞星沖破。",
        full: "綜合十二宮位分析，您的命格屬上中等格局。命宮主星明亮，三方四正無煞星沖破，一生運勢平穩向上。\n\n最佳發展方向為管理或專業技術領域。建議在32-41歲大限期間積極發展事業，此為命盤中最有利的事業運期。整體而言，此命格一生衣食無憂，事業有成，家庭美滿。",
      },
    ],
    "zwds-annual": [
      {
        key: "annual_overview",
        title: "流年總覽",
        preview: "今年流年宮位走入事業宮，太陽星化祿，整體運勢向好。事業上有新的發展機會。",
        full: "今年流年宮位走入事業宮，太陽星化祿，整體運勢向好。\n\n流年四化：化祿入事業宮（主事業順遂）、化權入財帛宮（主財運提升）、化科入命宮（主聲譽提升）、化忌入夫妻宮（需注意感情波動）。",
      },
      {
        key: "monthly_forecast",
        title: "逐月運勢",
        preview: "農曆正月：開春順利，適合制定年度計劃。二月：貴人運旺，有升遷機會。",
        full: "農曆正月：開春順利。二月：貴人運旺。三月：財運最旺。四月：人際活躍。五月：注意健康。六月：感情運轉好。七月：小阻礙。八月：學習運佳。九月：財運回升。十月：貴人助力。十一月：注意溝通。十二月：年末收穫。",
      },
      {
        key: "key_opportunities",
        title: "年度關鍵機遇",
        preview: "今年最大機遇在農曆三月和十月，化祿化權同入財帛宮三方。",
        full: "今年最大機遇在農曆三月和十月，化祿化權同入財帛宮三方，是投資和事業擴張的最佳時機。\n\n貴人方位：西北方和正南方。需避開：農曆五月和七月。",
      },
      {
        key: "annual_advice",
        title: "年度建議",
        preview: "今年整體運勢偏旺，應積極把握機會。事業上宜主動出擊。",
        full: "今年整體運勢偏旺，應積極把握機會。事業宜主動出擊。財務方面正財運旺，適合穩健投資。感情方面化忌入夫妻宮，有伴侶者需多花時間溝通。健康注意肝膽和眼睛保養。",
      },
    ],
    "zwds-career": [
      {
        key: "career_palace",
        title: "事業宮分析",
        preview: "事業宮坐天府星於廟位，天府為南斗主星，主事業穩健、組織能力強。",
        full: "事業宮坐天府星於廟位，天府為南斗主星，主事業穩健、組織能力強。適合管理類或大型機構。\n\n天府星化祿更增吉利。三方四正形成強力支撐格局。",
      },
      {
        key: "wealth_palace",
        title: "財帛宮分析",
        preview: "財帛宮坐武曲星化權，武曲為財星第一主星。通過努力可獲豐厚回報。",
        full: "財帛宮坐武曲星化權，武曲為財星第一主星。適合從事金融、投資、會計等行業。此星代表技術型人才，擅長以專業技能換取高薪。",
      },
      {
        key: "career_direction",
        title: "事業發展方向",
        preview: "最適合的行業：金融、科技管理、政府機構、大型企業管理。",
        full: "一等行業（最契合）：金融投資、科技管理、政府機構。\n二等行業（次契合）：法律、醫療管理、教育行政。\n不建議：藝術創作、自媒體等需要靈活多變的行業。",
      },
      {
        key: "career_timing",
        title: "事業發展時機",
        preview: "大限走事業宮（32-41歲）為事業黃金期。天府化祿，事業運最旺。",
        full: "25-31歲：事業起步期。32-41歲：黃金期，全力拼搏可有大成就。42-51歲：穩定期。52歲後：宜轉向顧問角色。\n\n轉職最佳時機：大限交接年份。",
      },
    ],
    "zwds-love": [
      {
        key: "spouse_palace",
        title: "夫妻宮分析",
        preview: "夫妻宮坐太陰星於旺位，代表伴侶溫和有教養。感情運勢較為順遂。",
        full: "夫妻宮坐太陰星於旺位，太陰為中天主星，主感情細膩、溫柔體貼。婚姻生活平穩。\n\n三方四正：子女宮見貪狼（桃花星），交友宮見巨門，福德宮見天同。",
      },
      {
        key: "ideal_partner",
        title: "理想伴侶特質",
        preview: "您的理想伴侶：外表清秀、性格溫和、有藝術氣質或文學素養。",
        full: "外貌：清秀端正，氣質優雅。性格：溫和體貼、重視家庭。職業傾向：文教、藝術、設計。五行：以水和金為佳。適合生肖：鼠、猴、龍。",
      },
      {
        key: "love_timing",
        title: "感情時機",
        preview: "桃花運最旺：大限走子女宮（22-31歲），貪狼星帶桃花。",
        full: "桃花最旺：大限走子女宮（22-31歲）。最佳結婚時期：28-35歲。需注意：流年化忌入夫妻宮的年份。",
      },
      {
        key: "relationship_advice",
        title: "感情經營建議",
        preview: "太陰星在夫妻宮的人，感情上需要安全感。建議主動表達愛意。",
        full: "太陰星在夫妻宮的人，感情上需要安全感。建議：定期創造浪漫時刻、尊重伴侶獨處空間、避免過於計較得失、已婚後注意力放在家庭。",
      },
    ],
    "zwds-health": [
      {
        key: "health_palace",
        title: "疾厄宮分析",
        preview: "疾厄宮坐廉貞星，五行屬火，主心臟、血液循環系統。先天體質中等。",
        full: "疾厄宮坐廉貞星，需注意心血管健康和情緒管理。\n\n三方四正：命宮紫微天機（腦部、神經系統）、父母宮天梁（呼吸系統）。頭部神經和心血管是重點關注方向。",
      },
      {
        key: "element_health",
        title: "五行局健康分析",
        preview: "您的五行局為「水二局」，水主腎臟、膀胱。先天腎水充沛但需注意寒濕。",
        full: "「水二局」先天元氣相對較弱，需後天調養。養生要點：腎臟保養、保暖防寒（尤其腰部下肢）、適合太極拳或瑜伽。",
      },
      {
        key: "health_periods",
        title: "健康注意時期",
        preview: "大限走疾厄宮（42-51歲）是健康關鍵期，應加強體檢。",
        full: "22-31歲：注意用眼和頭部。32-41歲：注意腸胃消化。42-51歲：重點心血管，建議定期心臟檢查。52-61歲：注意骨骼關節。",
      },
      {
        key: "wellness_advice",
        title: "養生保健建議",
        preview: "建議重點關注心血管和腎臟保養。飲食以溫補為主，多攝取黑色食物。",
        full: "飲食：多黑色食物（黑芝麻、黑豆）補腎水，紅色食物（紅棗、枸杞）養心血。運動：太極拳、八段錦。情緒管理是健康關鍵。作息：宜早睡，子時入睡對腎臟最有益。",
      },
    ],
    "zwds-compatibility": [
      {
        key: "overall_compatibility",
        title: "整體契合度分析",
        preview: "紫微合盤比較功能需要輸入兩人的出生資料。目前僅顯示個人命盤分析。",
        full: "紫微合盤比較功能需要輸入兩人的出生資料。分析包含：命宮主星互動、夫妻宮交叉比對、交友宮契合度、福德宮精神匹配度。",
      },
      {
        key: "palace_interaction",
        title: "宮位互動分析",
        preview: "請完成雙方資料輸入後查看宮位互動分析。",
        full: "請完成雙方資料輸入後查看宮位互動分析。\n\n將比對命宮、夫妻宮、交友宮、福德宮等關鍵宮位星曜的相生相剋關係。",
      },
      {
        key: "star_compatibility",
        title: "星曜契合分析",
        preview: "請完成雙方資料輸入後查看星曜契合度。",
        full: "請完成雙方資料輸入後查看星曜契合度。\n\n將比較雙方命宮主星的五行屬性和特質。",
      },
      {
        key: "advice",
        title: "相處建議",
        preview: "請完成雙方資料輸入後查看相處建議。",
        full: "請完成雙方資料輸入後查看相處建議。\n\n將根據雙方命盤的優勢和挑戰提供經營關係之道。",
      },
    ],
    "zwds-monthly": [
      {
        key: "monthly_overview",
        title: "本月運勢總覽",
        preview: "本月流月宮位走入財帛宮，太陰星化祿，整體財運偏旺。",
        full: "本月流月宮位走入財帛宮，太陰星化祿，整體財運偏旺。\n\n流月四化：化祿入財帛宮（正財運旺）、化權入事業宮（工作有突破）、化科入命宮（人緣佳）、化忌入疾厄宮（注意休息）。本月整體運勢上升，宜積極把握機遇。",
      },
      {
        key: "monthly_career",
        title: "本月事業運",
        preview: "化權入事業宮，本月工作上有表現機會，適合提出新方案。",
        full: "化權入事業宮，本月工作上有表現機會，適合提出新方案或爭取晉升。上半月運勢較強，下半月趨於平穩。注意與同事的溝通協調。",
      },
      {
        key: "monthly_love",
        title: "本月感情運",
        preview: "化科入命宮，個人魅力提升，有利於社交和感情發展。",
        full: "化科入命宮，個人魅力提升。單身者本月桃花運中等，適合主動認識新朋友。有伴侶者感情穩定，可安排約會增進感情。",
      },
      {
        key: "monthly_health",
        title: "本月健康運",
        preview: "化忌入疾厄宮，本月需注意休息和作息規律。",
        full: "化忌入疾厄宮，本月需注意休息和作息規律。容易出現疲勞、失眠等問題。建議減少熬夜，適度運動，飲食清淡。特別注意腸胃和肝臟保養。",
      },
      {
        key: "monthly_advice",
        title: "本月行動建議",
        preview: "把握上半月的事業運勢，合理安排工作與休息。",
        full: "1. 把握上半月的事業運勢，積極表現\n2. 理財方面可小額投資，正財運佳\n3. 下半月注意身體，避免過度勞累\n4. 人際關係順暢，適合拓展社交圈",
      },
    ],
    "zwds-daily": [
      {
        key: "daily_fortune",
        title: "今日運勢",
        preview: "今日流日走入官祿宮，天府星化祿。",
        full: "今日流日走入官祿宮，天府星化祿，事業運佳。工作上有利好消息或貴人相助。財運中等，不宜大額支出。感情方面平穩。健康注意頸椎和肩膀。吉時：巳時、午時。",
      },
    ],
    "zwds-major-period": [
      {
        key: "period_overview",
        title: "大限運勢總覽",
        preview: "您目前正處於第三大限（22-31歲），大限宮位走入田宅宮，太陰星化科坐守。",
        full: "您目前正處於第三大限（22-31歲），大限宮位走入田宅宮，太陰星化科坐守。\n\n此大限整體運勢平穩向上，重點在置產、家庭根基的建立。太陰化科帶來學識和聲望的提升。大限四化與本命四化互動良好，屬於順遂的十年運。",
      },
      {
        key: "period_career",
        title: "大限事業運",
        preview: "大限事業宮見天同星入廟，事業穩定但缺乏衝勁。",
        full: "大限事業宮見天同星入廟，事業穩定但缺乏衝勁。適合在大機構中穩步發展，不宜冒險創業。此十年適合積累經驗和人脈，為下一個大限的事業爆發期做準備。最佳發展方向：管理、教育、諮詢類行業。",
      },
      {
        key: "period_relationships",
        title: "大限人際關係",
        preview: "大限交友宮見巨門星，人際關係上容易遇到口舌是非。",
        full: "大限交友宮見巨門星，人際關係上容易遇到口舌是非。建議注意言語表達，避免不必要的爭論。但巨門也主才華和口才，善加利用可在談判和溝通領域出色。夫妻宮太陽星化權，感情中主導性強。",
      },
      {
        key: "period_health",
        title: "大限健康運",
        preview: "大限疾厄宮見廉貞星，需注意心血管和情緒健康。",
        full: "大限疾厄宮見廉貞星，需注意心血管和情緒健康。建議定期體檢，保持運動習慣。情緒波動較大的年份（化忌飛入疾厄宮時）更需注意心理調適。整體而言，此大限健康運中等，無大礙但需預防。",
      },
      {
        key: "period_strategy",
        title: "大限發展策略",
        preview: "此大限的核心策略：穩紮穩打，為下一個十年蓄力。",
        full: "核心策略：穩紮穩打，為下一個十年蓄力。\n\n1. 前五年（22-26歲）：打基礎，學習專業技能\n2. 後五年（27-31歲）：穩步升遷，建立人脈\n3. 理財重點：此期適合儲蓄和穩健投資\n4. 大限末期注意：交接年（31歲）運勢波動，宜保守行事\n5. 為下一大限（32-41歲事業黃金期）做好準備",
      },
    ],
    "zwds-qa": [
      {
        key: "answer",
        title: "問題解答",
        preview: "根據您的紫微命盤與當前流年分析，以下為您的問題解答。",
        full: "根據您的紫微命盤與當前流年分析：\n\n您目前的流年化祿入事業宮，代表今年事業運勢正旺。結合大限運勢來看，當前正是積極行動的好時機。命盤中天府星坐守事業宮，主穩健發展，建議以穩中求進的策略為佳。",
      },
      {
        key: "analysis",
        title: "命盤分析",
        preview: "從相關宮位的星曜組合與四化飛星來看，提供以下深入分析。",
        full: "從相關宮位的星曜組合與四化飛星來看：\n\n1. 事業宮天府化祿：正財運強，適合穩健發展\n2. 財帛宮武曲化權：有主導權，可爭取更好的薪資待遇\n3. 流年化忌入夫妻宮：感情方面需多關注，避免因工作忽略伴侶\n4. 遷移宮太陽化科：外出發展有利，可考慮跨區域機會",
      },
      {
        key: "advice",
        title: "綜合建議",
        preview: "綜合命盤與流年運勢，給出以下具體建議。",
        full: "綜合建議：\n\n1. 把握當前事業運旺的時機，積極爭取機會\n2. 財務方面正財為主，不宜投機\n3. 注意工作與生活的平衡\n4. 最佳行動時機：本月中旬至下月上旬\n5. 貴人方位：西北方",
      },
    ],
  };

  return {
    sections: zwdsSectionsByType[type] || [],
    summary: {
      text:
        type === "zwds-compatibility"
          ? "紫微合盤比較需要兩人的出生資料。請先完成個人命盤分析。"
          : "根據您的紫微斗數命盤，AI 已為您生成以下詳細分析報告。",
    },
  };
}

// ============================================================
// Mock Bazi AI reading data (placeholder until real API is connected)
// ============================================================

function generateMockReading(type: ReadingTypeSlug): AIReadingData {
  const sectionsByType: Partial<Record<ReadingTypeSlug, ReadingSectionData[]>> = {
    lifetime: [
      {
        key: "personality",
        title: "命格性格分析",
        preview: "此命盤日主為庚金，性格剛毅果斷，具有領導才能。",
        full: "此命盤日主為庚金，性格剛毅果斷，具有領導才能。庚金之人為人正直，做事有魄力。\n\n命局中比肩透出，代表獨立自主，有強烈的自我意識和競爭心。傷官配印的格局讓您兼具創造力和學習能力。\n\n建議在溝通時多加圓融，以柔克剛。",
      },
      {
        key: "career",
        title: "事業發展分析",
        preview: "以庚金為日主，適合從事與金屬、科技、法律、軍警相關的行業。",
        full: "以庚金為日主，適合從事與金屬、科技、法律、軍警相關的行業。食神生財的格局，利於創業或技術工作。\n\n35-44歲期間正財運旺，是事業發展的黃金期。",
      },
      {
        key: "love",
        title: "感情婚姻分析",
        preview: "日柱庚辰，自坐正印，代表您的另一半溫和體貼、有學識。",
        full: "日柱庚辰，自坐正印，代表您的另一半溫和體貼、有學識。辰土為日主的庫地，感情運勢較為穩定。\n\n最佳結婚時機在正財運期間（35-44歲）。伴侶宜選擇五行屬土或屬水之人。",
      },
      {
        key: "finance",
        title: "一生財運分析",
        preview: "庚金日主得月令生助，財星雖弱但食神生財，一生財運中等偏上。",
        full: "庚金日主得月令生助，食神生財，一生財運中等偏上。中年後財運逐漸走強。\n\n35歲後大運走甲乙木（偏正財），財運明顯提升。注意忌神火旺之年，應保守理財。",
      },
      {
        key: "health",
        title: "先天健康分析",
        preview: "五行以金、土為主，火略偏旺。呼吸系統和消化系統需要注意保養。",
        full: "五行以金、土為主，火略偏旺。庚金對應肺與大腸，命局火旺克金，呼吸系統是先天較弱環節。\n\n土旺則消化功能一般偏強，但辰土未土同時見，濕氣較重，應注意脾胃保養。",
      },
    ],
    annual: [
      {
        key: "annual_overview",
        title: "年度總覽",
        preview: "今年流年運勢整體平穩，上半年較為順利，下半年需注意人際關係。",
        full: "今年流年運勢整體平穩，上半年較為順利，下半年需注意人際關係和財務管理。\n\n流年天干與日主形成特殊組合，暗示今年將有重要的轉變機會。",
      },
      {
        key: "monthly_forecast",
        title: "每月運勢",
        preview: "春季（1-3月）：運勢上升期。夏季（4-6月）：穩定發展期。",
        full: "春季（1-3月）：運勢上升期。夏季（4-6月）：穩定發展期。\n\n秋季（7-9月）：注意人際關係。冬季（10-12月）：財運回升。",
      },
      {
        key: "key_opportunities",
        title: "關鍵機遇",
        preview: "今年最大的機遇在於事業轉型和人脈拓展。貴人方位在西北方。",
        full: "今年最大的機遇在於事業轉型和人脈拓展。貴人方位在西北方。\n\n有利月份為農曆三月和八月。",
      },
    ],
    career: [
      {
        key: "career_analysis",
        title: "事業深度分析",
        preview: "您的命局中正官與偏官交替出現，適合在穩定組織中發展。",
        full: "您的命局中正官與偏官交替出現，適合在穩定組織中發展，也有獨立創業潛力。\n\n食神格局賦予您出色的技術能力和創造力。",
      },
      {
        key: "favorable_industries",
        title: "利於發展的行業",
        preview: "金相關行業：科技、金融、機械製造。土相關行業：房地產、建築。",
        full: "金相關行業：科技、金融、機械製造、汽車、珠寶。\n土相關行業：房地產、建築、農業、餐飲。\n水相關行業：傳媒、旅遊、貿易。",
      },
      {
        key: "career_timing",
        title: "事業發展時機",
        preview: "25-34歲：偏財運期。35-44歲：正財運期，事業穩定上升。",
        full: "25-34歲：偏財運期，適合嘗試新領域。\n35-44歲：正財運期，事業穩定上升期。\n45-54歲：食神運期，可考慮轉型。",
      },
    ],
    love: [
      {
        key: "ideal_partner",
        title: "理想伴侶特質",
        preview: "根據命局分析，您的理想伴侶五行以土為主，性格溫和穩重。",
        full: "根據命局分析，您的理想伴侶五行以土為主，性格溫和穩重，有包容心。\n\n適合的生肖為牛、龍、雞。",
      },
      {
        key: "marriage_timing",
        title: "姻緣時機",
        preview: "最佳結婚年齡在30-38歲之間。",
        full: "最佳結婚年齡在30-38歲之間，尤其是正財運旺盛的35歲前後。\n\n桃花旺盛的年份：逢午年、卯年。",
      },
      {
        key: "relationship_advice",
        title: "感情建議",
        preview: "庚金性格較為直接，在感情中應學習柔軟和表達。",
        full: "庚金性格較為直接，在感情中應學習柔軟和表達。多傾聽對方感受。\n\n夫妻宮坐辰土印星，代表家庭生活穩定溫馨。",
      },
    ],
    health: [
      {
        key: "constitution",
        title: "先天體質分析",
        preview: "五行以金、土為主，先天體質偏燥。呼吸系統和皮膚需重點關注。",
        full: "五行以金、土為主，先天體質偏燥。金主肺與大腸，火旺克金，肺功能先天偏弱。\n\n土主脾胃，命局土多但帶濕，消化系統需注意調理。",
      },
      {
        key: "wellness_advice",
        title: "養生保健建議",
        preview: "宜多食白色食物（百合、梨）以潤肺；避免辛辣油炸食品。",
        full: "宜多食白色食物以潤肺。適合的運動：太極拳、游泳、散步。\n\n秋季宜早睡早起。有利方位：西方和北方。",
      },
      {
        key: "health_timing",
        title: "健康注意時期",
        preview: "火旺之年需特別注意呼吸系統和皮膚問題。",
        full: "火旺之年（丙午、丁巳）需注意呼吸系統和皮膚問題。\n\n大運走火運時期，健康運勢相對較弱。40歲後體質會有所改善。",
      },
    ],
    compatibility: [
      {
        key: "overall_compatibility",
        title: "整體契合度",
        preview: "合盤比較功能需要輸入兩人的出生資料。",
        full: "合盤比較功能需要輸入兩人的出生資料。完整的合盤分析將在雙方資料都齊全後生成。",
      },
      {
        key: "strengths",
        title: "優勢互補",
        preview: "請完成雙方資料輸入後查看分析。",
        full: "請完成雙方資料輸入後查看詳細的優勢互補分析。",
      },
      {
        key: "challenges",
        title: "挑戰與磨合",
        preview: "請完成雙方資料輸入後查看分析。",
        full: "請完成雙方資料輸入後查看潛在的挑戰與磨合建議。",
      },
    ],
  };

  return {
    sections: sectionsByType[type] || [],
    summary: {
      text:
        type === "compatibility"
          ? "合盤比較需要兩人的出生資料。請先完成個人命盤分析。"
          : "根據您的八字命盤，AI 已為您生成以下詳細分析報告。",
    },
  };
}
