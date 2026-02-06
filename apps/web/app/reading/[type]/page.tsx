"use client";

import { useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import BirthDataForm, {
  type BirthDataFormValues,
} from "../../components/BirthDataForm";
import BaziChart from "../../components/BaziChart";
import AIReadingDisplay from "../../components/AIReadingDisplay";
import { calculateBaziDirect } from "../../lib/api";
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
  | "compatibility";

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
];

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

  // State
  const [step, setStep] = useState<ViewStep>("input");
  const [tab, setTab] = useState<ResultTab>("chart");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [chartData, setChartData] = useState<BaziChartData | null>(null);
  const [aiData, setAiData] = useState<AIReadingData | null>(null);
  const [formValues, setFormValues] = useState<BirthDataFormValues | null>(
    null,
  );

  // For now, treat all users as non-subscribers (paywall visible).
  // This will be replaced with real Clerk subscription check in Phase 5.
  const isSubscriber = false;

  const handleFormSubmit = useCallback(
    async (data: BirthDataFormValues) => {
      setFormValues(data);
      setIsLoading(true);
      setError(undefined);

      try {
        // Call the Python Bazi engine directly for chart calculation
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
        // In production, this calls the NestJS API which invokes Claude
        const mockAI = generateMockReading(readingType as ReadingTypeSlug);
        setAiData(mockAI);

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
    [readingType],
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
          <BirthDataForm
            onSubmit={handleFormSubmit}
            isLoading={isLoading}
            error={error}
            title={`${meta.nameZhTw} — 輸入出生資料`}
            subtitle={meta.description["zh-TW"]}
            submitLabel="開始分析"
          />
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
                📊 命盤排盤
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
            {tab === "chart" && chartData && (
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
// Mock AI reading data (placeholder until real API is connected)
// ============================================================

function generateMockReading(type: ReadingTypeSlug): AIReadingData {
  const sectionsByType: Record<ReadingTypeSlug, ReadingSectionData[]> = {
    lifetime: [
      {
        key: "personality",
        title: "命格性格分析",
        preview:
          "此命盤日主為庚金，性格剛毅果斷，具有領導才能。庚金之人為人正直，做事有魄力，不畏艱難。",
        full: "此命盤日主為庚金，性格剛毅果斷，具有領導才能。庚金之人為人正直，做事有魄力，不畏艱難。\n\n從十神分析來看，命局中比肩透出，代表您獨立自主，有強烈的自我意識和競爭心。傷官配印的格局讓您兼具創造力和學習能力，思維敏捷，善於創新。\n\n在人際關係上，您為人講義氣，重承諾，但有時過於直接，可能會得罪人而不自知。建議在溝通時多加圓融，以柔克剛，方能在人際互動中更為順遂。",
      },
      {
        key: "career",
        title: "事業發展分析",
        preview:
          "以庚金為日主，適合從事與金屬、科技、法律、軍警相關的行業。食神生財的格局，利於創業或技術工作。",
        full: "以庚金為日主，適合從事與金屬、科技、法律、軍警相關的行業。食神生財的格局，利於創業或技術工作。\n\n大運走正財運時，事業穩步上升，有望獲得實質的經濟回報。35-44歲期間正財運旺，是事業發展的黃金期，應把握此時機，積極拓展事業版圖。\n\n需注意的是，命中偏官暗藏，工作中可能遇到小人阻礙，但只要堅持正道，自能化險為夷。建議在事業上與屬土或屬金之人合作，可事半功倍。",
      },
      {
        key: "love",
        title: "感情婚姻分析",
        preview:
          "日柱庚辰，自坐正印，代表您的另一半溫和體貼、有學識。辰土為日主的庫地，感情運勢較為穩定。",
        full: "日柱庚辰，自坐正印，代表您的另一半溫和體貼、有學識。辰土為日主的庫地，感情運勢較為穩定。\n\n從桃花分析，您的桃花位在午火，年支已見午火，早年便有感情機遇。但午火同時為七殺，感情路上可能會遇到較為強勢的對象。\n\n最佳結婚時機在正財運期間（35-44歲），此時感情最為穩定成熟。伴侶宜選擇五行屬土或屬水之人，可互補不足，婚姻美滿。",
      },
      {
        key: "finance",
        title: "一生財運分析",
        preview:
          "庚金日主得月令生助，財星雖弱但食神生財，一生財運中等偏上。中年後財運逐漸走強。",
        full: "庚金日主得月令生助，財星雖弱但食神生財，一生財運中等偏上。中年後財運逐漸走強。\n\n命局中食神生財的組合，表示您擅長以技術或創意來賺取財富。正財為主要財源，代表收入穩定，靠正當勞動獲取報酬。\n\n35歲後大運走甲乙木（偏正財），財運明顯提升。但需注意忌神火旺之年（如丙午、丁巳年），可能有意外支出或投資損失，應保守理財。",
      },
      {
        key: "health",
        title: "先天健康分析",
        preview:
          "五行以金、土為主，火略偏旺。先天體質偏向呼吸系統和消化系統需要注意保養。",
        full: "五行以金、土為主，火略偏旺。先天體質偏向呼吸系統和消化系統需要注意保養。\n\n庚金對應肺與大腸，命局火旺克金，呼吸系統是先天較弱的環節。建議多做深呼吸運動，避免空氣污染的環境。\n\n土旺則消化功能一般偏強，但辰土未土同時見，濕氣較重，應注意脾胃保養，飲食宜清淡，少食生冷油膩。整體而言，健康運勢中等，注意養生即可長保安康。",
      },
    ],
    annual: [
      {
        key: "annual_overview",
        title: "年度總覽",
        preview:
          "今年流年運勢整體平穩，上半年較為順利，下半年需注意人際關係和財務管理。",
        full: "今年流年運勢整體平穩，上半年較為順利，下半年需注意人際關係和財務管理。\n\n流年天干與日主形成特殊組合，暗示今年將有重要的轉變機會。事業上可能面臨新的選擇，需要審慎考慮後再做決定。",
      },
      {
        key: "monthly_forecast",
        title: "每月運勢",
        preview: "春季（1-3月）：運勢上升期，適合開展新計劃。夏季（4-6月）：穩定發展期。",
        full: "春季（1-3月）：運勢上升期，適合開展新計劃。夏季（4-6月）：穩定發展期。\n\n秋季（7-9月）：注意人際關係，可能有口舌之爭。冬季（10-12月）：財運回升，適合投資理財。\n\n每月詳細分析需根據流月天干地支與命局的具體互動來判斷。",
      },
      {
        key: "key_opportunities",
        title: "關鍵機遇",
        preview: "今年最大的機遇在於事業轉型和人脈拓展。貴人方位在西北方。",
        full: "今年最大的機遇在於事業轉型和人脈拓展。貴人方位在西北方。\n\n有利月份為農曆三月和八月，可在此期間做出重要決策。注意避開農曆六月和十一月的衝突時期。",
      },
    ],
    career: [
      {
        key: "career_analysis",
        title: "事業深度分析",
        preview:
          "您的命局中正官與偏官交替出現，適合在穩定的組織中發展，也有獨立創業的潛力。",
        full: "您的命局中正官與偏官交替出現，適合在穩定的組織中發展，也有獨立創業的潛力。\n\n食神格局賦予您出色的技術能力和創造力，在技術密集型行業中尤為出色。結合大運走勢，35歲後是事業最佳發展期。",
      },
      {
        key: "favorable_industries",
        title: "利於發展的行業",
        preview:
          "金相關行業：科技、金融、機械製造；土相關行業：房地產、建築、農業。",
        full: "金相關行業：科技、金融、機械製造、汽車工業、珠寶首飾。\n\n土相關行業：房地產、建築、農業、餐飲、物流倉儲。\n\n水相關行業（食神方向）：傳媒、旅遊、貿易、航運、水利工程。\n\n以上行業與您的五行喜用神相符，從事相關工作可事半功倍。",
      },
      {
        key: "career_timing",
        title: "事業發展時機",
        preview:
          "25-34歲：偏財運期，適合嘗試新領域。35-44歲：正財運期，事業穩定上升期。",
        full: "25-34歲：偏財運期，適合嘗試新領域和投資理財。\n\n35-44歲：正財運期，事業穩定上升期，是積累財富的黃金時段。\n\n45-54歲：食神運期，可考慮轉型或顧問角色，發揮專業經驗。",
      },
    ],
    love: [
      {
        key: "ideal_partner",
        title: "理想伴侶特質",
        preview:
          "根據命局分析，您的理想伴侶五行以土為主，性格溫和穩重，有包容心。",
        full: "根據命局分析，您的理想伴侶五行以土為主，性格溫和穩重，有包容心。\n\n正印坐日支，代表另一半學識淵博、善解人意。適合的生肖為牛、龍、雞，這些生肖與您的地支形成有利組合。\n\n外貌特徵上，對方可能身材中等偏穩重，膚色偏黃或偏白，五官端正有氣質。",
      },
      {
        key: "marriage_timing",
        title: "姻緣時機",
        preview: "最佳結婚年齡在30-38歲之間，尤其是正財運旺盛的35歲前後。",
        full: "最佳結婚年齡在30-38歲之間，尤其是正財運旺盛的35歲前後。\n\n桃花旺盛的年份：逢午年、卯年易有感情機遇。\n\n需注意的年份：逢子年可能有感情波動，宜保持冷靜理性。\n\n整體而言，您的婚姻運勢穩定，只要選對時機和對象，婚後生活幸福美滿。",
      },
      {
        key: "relationship_advice",
        title: "感情建議",
        preview:
          "庚金性格較為直接，在感情中應學習柔軟和表達。多傾聽對方感受，可增進感情。",
        full: "庚金性格較為直接，在感情中應學習柔軟和表達。多傾聽對方感受，可增進感情。\n\n金生水為食神，在感情中適當展現幽默感和浪漫一面。避免過於理性和冷淡，適時表達愛意。\n\n夫妻宮坐辰土印星，代表家庭生活穩定溫馨。婚後宜多經營家庭，夫妻共同學習成長。",
      },
    ],
    health: [
      {
        key: "constitution",
        title: "先天體質分析",
        preview:
          "五行以金、土為主，先天體質偏燥。呼吸系統和皮膚是需要重點關注的部位。",
        full: "五行以金、土為主，先天體質偏燥。呼吸系統和皮膚是需要重點關注的部位。\n\n金主肺與大腸，火旺克金，肺功能先天偏弱。容易出現咳嗽、過敏性鼻炎等症狀。\n\n土主脾胃，命局土多但帶濕（辰未土），消化系統需注意調理，可能有胃脹、消化不良等問題。",
      },
      {
        key: "wellness_advice",
        title: "養生保健建議",
        preview:
          "宜多食白色食物（百合、梨、白蘿蔔）以潤肺；避免辛辣和油炸食品。",
        full: "宜多食白色食物（百合、梨、白蘿蔔）以潤肺；避免辛辣和油炸食品。\n\n適合的運動：太極拳、游泳、散步等溫和運動。金主收斂，劇烈運動反而不利健康。\n\n作息方面：秋季為金旺之時，宜早睡早起。夏季火旺克金，應特別注意防暑降溫。\n\n有利方位：西方和北方，居住或辦公朝此方向有助健康。",
      },
      {
        key: "health_timing",
        title: "健康注意時期",
        preview: "火旺之年（丙午、丁巳）需特別注意呼吸系統和皮膚問題。",
        full: "火旺之年（丙午、丁巳）需特別注意呼吸系統和皮膚問題。\n\n大運走火運時期，健康運勢相對較弱，應加強保養。\n\n40歲後隨著大運變化，體質會有所改善，但仍需堅持良好的生活習慣。建議每年定期體檢，重點關注肺部和消化系統。",
      },
    ],
    compatibility: [
      {
        key: "overall_compatibility",
        title: "整體契合度",
        preview:
          "合盤比較功能需要輸入兩人的出生資料。目前僅顯示個人命盤分析。",
        full: "合盤比較功能需要輸入兩人的出生資料。完整的合盤分析將在雙方資料都齊全後生成。\n\n合盤分析包含：日主五行互動、天干合化、地支刑沖合害、十神關係分析等多個維度的綜合評估。",
      },
      {
        key: "strengths",
        title: "優勢互補",
        preview: "請完成雙方資料輸入後查看詳細的優勢互補分析。",
        full: "請完成雙方資料輸入後查看詳細的優勢互補分析。\n\n優勢分析將從五行互補、性格互補、事業協作等角度進行深度解讀。",
      },
      {
        key: "challenges",
        title: "挑戰與磨合",
        preview: "請完成雙方資料輸入後查看潛在的挑戰與磨合建議。",
        full: "請完成雙方資料輸入後查看潛在的挑戰與磨合建議。\n\n挑戰分析將幫助雙方了解可能的衝突點，並提供化解之道。",
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
