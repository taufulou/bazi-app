'use client';

/**
 * YearlyRiskOpportunityGrid — Phase 3 年運 核心風險&機會 section.
 *
 * Two columns:
 *   - 機會點 (green bulb) — engine `coreRiskOpportunity.opportunities[]`
 *   - 風險點 (red shield) — engine `coreRiskOpportunity.risks[]`
 *
 * Each entry pairs the engine month signal (month/monthLabel/auspiciousness/
 * energyScore/dim/dimZh/caveat) with the AI keyword + narrative from
 * `narrative.yearly_risk_opportunities[]` PAIRED BY ARRAY INDEX within each
 * slot type. The engine arrays are the source of truth for which months;
 * the AI array fills in keyword + prose. Pairing is index-based per locked
 * design — the AI prompt is instructed to emit entries in the same order.
 *
 * `flatYear` → a calm «今年運勢平穩，無顯著起伏» message instead of columns.
 * `caveat` → a 「機會中留意：{dimZh}」 advisory tag on the entry.
 *
 * Anti-hallucination: months + dims come only from the engine; the AI never
 * invents months (mirrors monthly's TimeGrid structured-data contract).
 */
import type {
  YearlyCoreRiskOpportunity,
  YearlyRiskOpportunityEntry,
  YearlyFortuneNarrative,
} from '../../lib/fortune-api';
import { parseBoldSegments } from './markdown';
import { useZh } from '../LanguageContext';
import styles from './YearlyRiskOpportunityGrid.module.css';

type AiEntry = NonNullable<
  YearlyFortuneNarrative['yearly_risk_opportunities']
>[number];

interface Props {
  coreRiskOpportunity: YearlyCoreRiskOpportunity;
  /** AI keyword + narrative per risk/opp month. Optional — when absent
   *  (engine-only / not-yet-streamed) entries show engine data only. */
  aiEntries?: AiEntry[];
}

function RichText({ text }: { text: string }) {
  const zh = useZh();
  const segments = parseBoldSegments(zh(text));
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'bold' ? (
          <strong key={i}>{seg.value}</strong>
        ) : (
          <span key={i}>{seg.value}</span>
        ),
      )}
    </>
  );
}

/** Pair engine entries with the AI entries of matching `type` by array index. */
function pairAi(
  entries: YearlyRiskOpportunityEntry[],
  aiEntries: AiEntry[] | undefined,
  slotType: 'opportunity' | 'risk',
): Array<{ engine: YearlyRiskOpportunityEntry; ai: AiEntry | undefined }> {
  const aiForType = (aiEntries ?? []).filter((a) => a.type === slotType);
  return entries.map((engine, idx) => ({ engine, ai: aiForType[idx] }));
}

function EntryCard({
  engine,
  ai,
}: {
  engine: YearlyRiskOpportunityEntry;
  ai: AiEntry | undefined;
}) {
  return (
    <li className={styles.entry} data-slot={engine.slot}>
      <div className={styles.entryHeader}>
        <span className={styles.entryMonth}>{engine.monthLabel}</span>
        <span className={styles.entryDim}>{engine.dimZh}</span>
        <span className={styles.entryLabel}>{engine.auspiciousness}</span>
      </div>
      {ai?.keyword && <p className={styles.entryKeyword}>{ai.keyword}</p>}
      {ai?.narrative && (
        <p className={styles.entryNarrative}>
          <RichText text={ai.narrative} />
        </p>
      )}
      {engine.caveat && (
        <span className={styles.caveatTag}>機會中留意：{engine.dimZh}</span>
      )}
    </li>
  );
}

export default function YearlyRiskOpportunityGrid({
  coreRiskOpportunity,
  aiEntries,
}: Props) {
  const { opportunities, risks, flatYear } = coreRiskOpportunity;

  return (
    <section
      className={styles.section}
      aria-labelledby="yearly-risk-opp-title"
    >
      <header className={styles.header}>
        <h3 id="yearly-risk-opp-title" className={styles.title}>
          核心風險 &amp; 機會
        </h3>
        <p className={styles.subtitle}>本年度最值得把握與留意的關鍵月份</p>
      </header>

      {flatYear ? (
        <p className={styles.flatYear}>
          <span className={styles.flatYearIcon} aria-hidden="true">
            🌿
          </span>
          今年運勢平穩，無顯著起伏。
        </p>
      ) : (
        <div className={styles.columns}>
          {/* 機會點 column */}
          <div className={styles.column} data-slot="opportunity">
            <h4 className={styles.columnTitle}>
              <span className={styles.columnIcon} aria-hidden="true">
                💡
              </span>
              機會點
            </h4>
            {opportunities.length > 0 ? (
              <ul className={styles.entryList} role="list">
                {pairAi(opportunities, aiEntries, 'opportunity').map(
                  ({ engine, ai }, i) => (
                    <EntryCard key={`${engine.month}-${i}`} engine={engine} ai={ai} />
                  ),
                )}
              </ul>
            ) : (
              <p className={styles.columnEmpty}>今年無特別突出的機會月份</p>
            )}
          </div>

          {/* 風險點 column */}
          <div className={styles.column} data-slot="risk">
            <h4 className={styles.columnTitle}>
              <span className={styles.columnIcon} aria-hidden="true">
                🛡️
              </span>
              風險點
            </h4>
            {risks.length > 0 ? (
              <ul className={styles.entryList} role="list">
                {pairAi(risks, aiEntries, 'risk').map(({ engine, ai }, i) => (
                  <EntryCard key={`${engine.month}-${i}`} engine={engine} ai={ai} />
                ))}
              </ul>
            ) : (
              <p className={styles.columnEmpty}>今年無特別需留意的風險月份</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
