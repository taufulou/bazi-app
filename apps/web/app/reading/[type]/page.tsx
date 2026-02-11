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
import { getSubscriptionStatus, checkFreeReading } from "../../lib/api";
import {
  createBirthProfile,
  updateBirthProfile,
  formValuesToPayload,
  fetchBirthProfiles,
  type BirthProfile,
} from "../../lib/birth-profiles-api";
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

  // Auth — wait for Clerk to resolve before deciding initial step
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const [step, setStep] = useState<ViewStep | null>(null);

  useEffect(() => {
    if (isLoaded && step === null) {
      setStep("input");
    }
  }, [isLoaded, step]);

  // State
  const [tab, setTab] = useState<ResultTab>("chart");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [chartData, setChartData] = useState<BaziChartData | null>(null);
  const [zwdsChartData, setZwdsChartData] = useState<ZwdsChartData | null>(null);
  const [aiData, setAiData] = useState<AIReadingData | null>(null);
  const [formValues, setFormValues] = useState<BirthDataFormValues | null>(null);

  // Profile state
  const [savedProfiles, setSavedProfiles] = useState<BirthProfile[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Fetch saved profiles for signed-in users (for name dropdown)
  useEffect(() => {
    if (!isSignedIn) return;
    (async () => {
      try {
        const token = await getToken();
        if (token) {
          const profiles = await fetchBirthProfiles(token);
          setSavedProfiles(profiles);
        }
      } catch {
        /* silent — user types manually */
      }
    })();
  }, [isSignedIn, getToken]);

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
          if (needsQuestion && !questionText.trim()) {
            setError("請輸入您的問題");
            setIsLoading(false);
            return;
          }

          const dateParts = data.birthDate.split("-") as [string, string, string];
          const solarDate = `${parseInt(dateParts[0])}-${parseInt(dateParts[1])}-${parseInt(dateParts[2])}`;

          const zwdsResponse = await fetch("/api/zwds-calculate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              birthDate: solarDate,
              birthTime: data.birthTime,
              gender: data.gender,
              targetDate: needsDatePicker ? targetDay : undefined,
            }),
          });

          if (!zwdsResponse.ok) {
            const errData = await zwdsResponse.json().catch(() => ({}));
            throw new Error(errData.error || `紫微排盤失敗 (${zwdsResponse.status})`);
          }

          const realChart = await zwdsResponse.json();
          setZwdsChartData(realChart);

          const mockAI = generateMockZwdsReading(readingType as ReadingTypeSlug);
          setAiData(mockAI);
        } else {
          const baziResponse = await fetch("/api/bazi-calculate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              birth_date: data.birthDate,
              birth_time: data.birthTime,
              birth_city: data.birthCity,
              birth_timezone: data.birthTimezone,
              gender: data.gender,
              target_year:
                readingType === "annual" ? new Date().getFullYear() : undefined,
            }),
          });

          if (!baziResponse.ok) {
            const errData = await baziResponse.json().catch(() => ({}));
            throw new Error(errData.error || `排盤失敗 (${baziResponse.status})`);
          }

          const baziResult = await baziResponse.json();
          setChartData(baziResult.data || baziResult);

          const mockAI = generateMockReading(readingType as ReadingTypeSlug);
          setAiData(mockAI);
        }

        setStep("result");
        setTab("chart");
      } catch (err) {
        let message = "排盤失敗，請稍後再試";
        if (err instanceof Error) {
          message = err.message === "Failed to fetch"
            ? "無法連線到排盤服務，請確認服務是否啟動"
            : err.message;
        }
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [readingType, isZwds, needsQuestion, questionText, needsDatePicker, targetDay],
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

  // Loading state while Clerk auth resolves
  if (step === null) {
    return (
      <div className={styles.pageContainer}>
        <div className={styles.loadingSkeleton}>
          <div className={styles.skeletonSpinner} />
          載入中...
        </div>
      </div>
    );
  }

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
        <div className={step === "input" ? styles.stepActive : styles.stepCompleted}>
          <span className={styles.stepNumber}>
            {step === "input" ? "1" : "✓"}
          </span>
          輸入資料
        </div>
        <div className={step === "result" ? styles.stepLineActive : styles.stepLine} />
        <div className={step === "result" ? styles.stepActive : styles.step}>
          <span className={styles.stepNumber}>2</span>
          查看結果
        </div>
      </div>

      {/* Content */}
      <div className={styles.contentArea}>
        {step === "input" && (
          <BirthDataForm
            onSubmit={handleFormSubmit}
            isLoading={isLoading}
            error={error}
            title={`${meta.nameZhTw} — 輸入出生資料`}
            subtitle={meta.description["zh-TW"]}
            submitLabel="開始分析"
            savedProfiles={isSignedIn ? savedProfiles : undefined}
            showSaveOption={isSignedIn === true}
            onSaveProfile={async (data, tag, existingProfileId) => {
              setSaveError(null);
              try {
                const token = await getToken();
                if (token) {
                  if (existingProfileId) {
                    await updateBirthProfile(token, existingProfileId, formValuesToPayload(data, tag));
                  } else {
                    await createBirthProfile(token, formValuesToPayload(data, tag));
                  }
                  // Re-fetch profiles so dropdown is up-to-date on back navigation
                  const updated = await fetchBirthProfiles(token);
                  setSavedProfiles(updated);
                }
              } catch {
                setSaveError("儲存資料失敗，您可以稍後在「管理出生資料」中手動新增。");
              }
            }}
          >
            {needsMonthPicker && (
              <div className={styles.extraInput}>
                <label className={styles.extraInputLabel}>分析年月</label>
                <div className={styles.extraInputRow}>
                  <select className={styles.extraInputSelect} value={new Date().getFullYear()} disabled>
                    <option value={new Date().getFullYear()}>{new Date().getFullYear()} 年</option>
                  </select>
                  <select className={styles.extraInputSelect} value={targetMonth} onChange={(e) => setTargetMonth(Number(e.target.value))}>
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
                <div className={styles.extraInputHint}>{questionText.length}/500 字</div>
              </div>
            )}

            {saveError && <p className={styles.saveWarning}>{saveError}</p>}
          </BirthDataForm>
        )}

        {step === "result" && (
          <>
            <div className={styles.tabBar}>
              <button className={tab === "chart" ? styles.tabActive : styles.tab} onClick={() => setTab("chart")}>
                {isZwds ? "🌟 紫微命盤" : "📊 命盤排盤"}
              </button>
              <button className={tab === "reading" ? styles.tabActive : styles.tab} onClick={() => setTab("reading")}>
                📝 AI 解讀
              </button>
            </div>

            {error && (
              <div className={styles.errorMessage}>
                <div className={styles.errorIcon}>⚠️</div>
                <div className={styles.errorText}>{error}</div>
                <button className={styles.retryBtn} onClick={handleRetry}>重新嘗試</button>
              </div>
            )}

            {tab === "chart" && isZwds && zwdsChartData && (
              <ZwdsChart data={zwdsChartData} name={formValues?.name} birthDate={formValues?.birthDate} birthTime={formValues?.birthTime} />
            )}
            {tab === "chart" && !isZwds && chartData && (
              <BaziChart data={chartData} name={formValues?.name} birthDate={formValues?.birthDate} birthTime={formValues?.birthTime} />
            )}
            {tab === "reading" && (
              <AIReadingDisplay data={aiData} readingType={readingType} isSubscriber={isSubscriber} isLoading={isLoading} />
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
        <p className={styles.invalidText}>請從控制台選擇一個有效的分析類型</p>
        <Link href="/dashboard" className={styles.dashboardLink}>返回控制台</Link>
      </div>
    </div>
  );
}

// ============================================================
// Mock data functions (kept for AI reading display until API keys configured)
// ============================================================

function generateMockZwdsReading(type: ReadingTypeSlug): AIReadingData {
  const zwdsSectionsByType: Partial<Record<ReadingTypeSlug, ReadingSectionData[]>> = {
    "zwds-lifetime": [
      { key: "personality", title: "命宮星曜分析", preview: "您的命宮坐紫微星於廟位，紫微為帝座之星，代表您天生具有領導氣質和王者風範。", full: "您的命宮坐紫微星於廟位，紫微為帝座之星，代表您天生具有領導氣質和王者風範。\n\n命宮同時見天機星，紫微天機同宮，代表智慧與權力並存。" },
      { key: "life_pattern", title: "人生格局分析", preview: "從十二宮位整體觀之，您的命盤呈「紫府朝垣」之格局。", full: "從十二宮位整體觀之，您的命盤呈「紫府朝垣」之格局，為紫微斗數中的上等格局之一。" },
      { key: "major_periods", title: "大限走勢分析", preview: "第一大限（2-11歲）走父母宮，天梁星坐守，少年時期受長輩庇護。", full: "第一大限（2-11歲）走父母宮。\n第二大限（12-21歲）走福德宮。\n第三大限（22-31歲）走田宅宮。\n第四大限（32-41歲）走官祿宮，事業黃金期。" },
      { key: "overall_destiny", title: "一生命運總評", preview: "綜合十二宮位分析，您的命格屬上中等格局。", full: "綜合十二宮位分析，您的命格屬上中等格局。命宮主星明亮，一生運勢平穩向上。" },
    ],
    "zwds-annual": [
      { key: "annual_overview", title: "流年總覽", preview: "今年流年宮位走入事業宮，太陽星化祿，整體運勢向好。", full: "今年流年宮位走入事業宮，太陽星化祿，整體運勢向好。" },
      { key: "monthly_forecast", title: "逐月運勢", preview: "農曆正月：開春順利。二月：貴人運旺。", full: "農曆正月：開春順利。二月：貴人運旺。三月：財運最旺。" },
      { key: "key_opportunities", title: "年度關鍵機遇", preview: "今年最大機遇在農曆三月和十月。", full: "今年最大機遇在農曆三月和十月，化祿化權同入財帛宮三方。" },
      { key: "annual_advice", title: "年度建議", preview: "今年整體運勢偏旺，應積極把握機會。", full: "今年整體運勢偏旺，應積極把握機會。事業宜主動出擊。" },
    ],
    "zwds-career": [
      { key: "career_palace", title: "事業宮分析", preview: "事業宮坐天府星於廟位，主事業穩健。", full: "事業宮坐天府星於廟位，天府為南斗主星，主事業穩健、組織能力強。" },
      { key: "wealth_palace", title: "財帛宮分析", preview: "財帛宮坐武曲星化權，武曲為財星第一主星。", full: "財帛宮坐武曲星化權，適合從事金融、投資、會計等行業。" },
      { key: "career_direction", title: "事業發展方向", preview: "最適合的行業：金融、科技管理、政府機構。", full: "一等行業：金融投資、科技管理。二等行業：法律、醫療管理。" },
      { key: "career_timing", title: "事業發展時機", preview: "大限走事業宮（32-41歲）為事業黃金期。", full: "25-31歲：事業起步期。32-41歲：黃金期。42-51歲：穩定期。" },
    ],
    "zwds-love": [
      { key: "spouse_palace", title: "夫妻宮分析", preview: "夫妻宮坐太陰星於旺位，代表伴侶溫和有教養。", full: "夫妻宮坐太陰星於旺位，主感情細膩、溫柔體貼。" },
      { key: "ideal_partner", title: "理想伴侶特質", preview: "您的理想伴侶：外表清秀、性格溫和。", full: "外貌：清秀端正。性格：溫和體貼。適合生肖：鼠、猴、龍。" },
      { key: "love_timing", title: "感情時機", preview: "桃花運最旺：大限走子女宮（22-31歲）。", full: "桃花最旺：22-31歲。最佳結婚時期：28-35歲。" },
      { key: "relationship_advice", title: "感情經營建議", preview: "太陰星在夫妻宮的人，感情上需要安全感。", full: "建議：定期創造浪漫時刻、尊重伴侶獨處空間。" },
    ],
    "zwds-health": [
      { key: "health_palace", title: "疾厄宮分析", preview: "疾厄宮坐廉貞星，五行屬火，主心臟循環。", full: "疾厄宮坐廉貞星，需注意心血管健康和情緒管理。" },
      { key: "element_health", title: "五行局健康分析", preview: "您的五行局為「水二局」，水主腎臟。", full: "「水二局」先天元氣相對較弱，需後天調養。" },
      { key: "health_periods", title: "健康注意時期", preview: "大限走疾厄宮（42-51歲）是健康關鍵期。", full: "22-31歲：注意用眼。32-41歲：注意腸胃。42-51歲：重點心血管。" },
      { key: "wellness_advice", title: "養生保健建議", preview: "建議重點關注心血管和腎臟保養。", full: "飲食：多黑色食物補腎水。運動：太極拳、八段錦。" },
    ],
    "zwds-compatibility": [
      { key: "overall_compatibility", title: "整體契合度分析", preview: "紫微合盤比較功能需要輸入兩人的出生資料。", full: "紫微合盤比較功能需要輸入兩人的出生資料。" },
      { key: "palace_interaction", title: "宮位互動分析", preview: "請完成雙方資料輸入後查看分析。", full: "請完成雙方資料輸入後查看宮位互動分析。" },
      { key: "star_compatibility", title: "星曜契合分析", preview: "請完成雙方資料輸入後查看。", full: "請完成雙方資料輸入後查看星曜契合度。" },
      { key: "advice", title: "相處建議", preview: "請完成雙方資料輸入後查看。", full: "請完成雙方資料輸入後查看相處建議。" },
    ],
    "zwds-monthly": [
      { key: "monthly_overview", title: "本月運勢總覽", preview: "本月流月宮位走入財帛宮，太陰星化祿。", full: "本月流月宮位走入財帛宮，太陰星化祿，整體財運偏旺。" },
      { key: "monthly_career", title: "本月事業運", preview: "化權入事業宮，本月工作上有表現機會。", full: "化權入事業宮，適合提出新方案或爭取晉升。" },
      { key: "monthly_love", title: "本月感情運", preview: "化科入命宮，個人魅力提升。", full: "化科入命宮，個人魅力提升，有利社交和感情。" },
      { key: "monthly_health", title: "本月健康運", preview: "化忌入疾厄宮，本月需注意休息。", full: "化忌入疾厄宮，注意休息和作息規律。" },
      { key: "monthly_advice", title: "本月行動建議", preview: "把握上半月的事業運勢。", full: "1. 把握上半月事業運勢\n2. 理財方面可小額投資\n3. 下半月注意身體\n4. 人際關係順暢" },
    ],
    "zwds-daily": [
      { key: "daily_fortune", title: "今日運勢", preview: "今日流日走入官祿宮，天府星化祿。", full: "今日流日走入官祿宮，天府星化祿，事業運佳。吉時：巳時、午時。" },
    ],
    "zwds-major-period": [
      { key: "period_overview", title: "大限運勢總覽", preview: "您目前正處於第三大限（22-31歲）。", full: "您目前正處於第三大限（22-31歲），大限宮位走入田宅宮，太陰星化科坐守。" },
      { key: "period_career", title: "大限事業運", preview: "大限事業宮見天同星入廟，事業穩定。", full: "大限事業宮見天同星入廟，適合在大機構中穩步發展。" },
      { key: "period_relationships", title: "大限人際關係", preview: "大限交友宮見巨門星。", full: "大限交友宮見巨門星，人際關係上注意口舌是非。" },
      { key: "period_health", title: "大限健康運", preview: "大限疾厄宮見廉貞星。", full: "大限疾厄宮見廉貞星，需注意心血管和情緒健康。" },
      { key: "period_strategy", title: "大限發展策略", preview: "此大限核心策略：穩紮穩打。", full: "核心策略：穩紮穩打，為下一個十年蓄力。" },
    ],
    "zwds-qa": [
      { key: "answer", title: "問題解答", preview: "根據您的紫微命盤與當前流年分析。", full: "根據您的紫微命盤與當前流年分析，您目前的流年化祿入事業宮，代表事業運正旺。" },
      { key: "analysis", title: "命盤分析", preview: "從相關宮位的星曜組合來看。", full: "1. 事業宮天府化祿：正財運強\n2. 財帛宮武曲化權：有主導權\n3. 遷移宮太陽化科：外出發展有利" },
      { key: "advice", title: "綜合建議", preview: "綜合命盤與流年運勢。", full: "1. 把握事業運旺時機\n2. 財務正財為主\n3. 注意工作生活平衡" },
    ],
  };

  return {
    sections: zwdsSectionsByType[type] || [],
    summary: { text: type === "zwds-compatibility" ? "紫微合盤比較需要兩人的出生資料。" : "根據您的紫微斗數命盤，AI 已為您生成以下詳細分析報告。" },
  };
}

function generateMockReading(type: ReadingTypeSlug): AIReadingData {
  const sectionsByType: Partial<Record<ReadingTypeSlug, ReadingSectionData[]>> = {
    lifetime: [
      { key: "personality", title: "命格性格分析", preview: "此命盤日主為庚金，性格剛毅果斷。", full: "此命盤日主為庚金，性格剛毅果斷，具有領導才能。庚金之人為人正直，做事有魄力。" },
      { key: "career", title: "事業發展分析", preview: "以庚金為日主，適合科技、法律相關行業。", full: "以庚金為日主，食神生財格局，利於創業。35-44歲是事業黃金期。" },
      { key: "love", title: "感情婚姻分析", preview: "日柱庚辰，自坐正印，另一半溫和體貼。", full: "日柱庚辰，自坐正印。最佳結婚時機在正財運期間。" },
      { key: "finance", title: "一生財運分析", preview: "庚金日主食神生財，財運中等偏上。", full: "庚金日主食神生財，一生財運中等偏上。35歲後財運明顯提升。" },
      { key: "health", title: "先天健康分析", preview: "五行以金、土為主，注意呼吸系統。", full: "五行以金、土為主。庚金對應肺與大腸，需注意保養。" },
    ],
    annual: [
      { key: "annual_overview", title: "年度總覽", preview: "今年流年運勢整體平穩。", full: "今年流年運勢整體平穩，上半年順利，下半年注意人際關係。" },
      { key: "monthly_forecast", title: "每月運勢", preview: "春季運勢上升。夏季穩定發展。", full: "春季上升。夏季穩定。秋季注意人際。冬季財運回升。" },
      { key: "key_opportunities", title: "關鍵機遇", preview: "今年最大機遇在於事業轉型。", full: "今年最大機遇在事業轉型和人脈拓展。貴人方位：西北方。" },
    ],
    career: [
      { key: "career_analysis", title: "事業深度分析", preview: "命局正官偏官交替，適合穩定組織發展。", full: "正官偏官交替出現，適合在穩定組織中發展，也有創業潛力。" },
      { key: "favorable_industries", title: "利於發展的行業", preview: "金相關：科技、金融。土相關：房地產。", full: "金：科技、金融。土：房地產、建築。水：傳媒、旅遊。" },
      { key: "career_timing", title: "事業發展時機", preview: "35-44歲正財運期是黃金期。", full: "25-34歲偏財運期。35-44歲正財運期。45-54歲食神運期。" },
    ],
    love: [
      { key: "ideal_partner", title: "理想伴侶特質", preview: "理想伴侶五行以土為主，溫和穩重。", full: "五行以土為主，性格溫和穩重。適合生肖：牛、龍、雞。" },
      { key: "marriage_timing", title: "姻緣時機", preview: "最佳結婚年齡30-38歲。", full: "最佳結婚年齡30-38歲。桃花旺盛年份：逢午年、卯年。" },
      { key: "relationship_advice", title: "感情建議", preview: "庚金性格直接，應學習柔軟表達。", full: "庚金性格直接，在感情中應多傾聽。夫妻宮坐辰土印星，家庭穩定。" },
    ],
    health: [
      { key: "constitution", title: "先天體質分析", preview: "五行金土為主，體質偏燥。", full: "五行金土為主。金主肺，火旺克金，肺功能先天偏弱。" },
      { key: "wellness_advice", title: "養生保健建議", preview: "宜多食白色食物潤肺。", full: "宜多食白色食物。適合運動：太極拳、游泳。" },
      { key: "health_timing", title: "健康注意時期", preview: "火旺之年注意呼吸系統。", full: "火旺之年注意呼吸系統和皮膚。40歲後體質改善。" },
    ],
    compatibility: [
      { key: "overall_compatibility", title: "整體契合度", preview: "合盤比較需要兩人資料。", full: "合盤比較功能需要輸入兩人的出生資料。" },
      { key: "strengths", title: "優勢互補", preview: "請完成雙方資料輸入。", full: "請完成雙方資料輸入後查看分析。" },
      { key: "challenges", title: "挑戰與磨合", preview: "請完成雙方資料輸入。", full: "請完成雙方資料輸入後查看建議。" },
    ],
  };

  return {
    sections: sectionsByType[type] || [],
    summary: { text: type === "compatibility" ? "合盤比較需要兩人的出生資料。" : "根據您的八字命盤，AI 已為您生成以下詳細分析報告。" },
  };
}
