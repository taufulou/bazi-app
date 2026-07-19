/**
 * readingWidgets — dispatches the per-reading-type deterministic widgets into
 * the AIReadingDisplay orchestrator. Each widget is rendered as a JSX component
 * (NOT called as a function) so its internal `useZh()` hook gets a proper
 * component render context, and each self-gates to `null` for non-matching
 * sections.
 *
 * TWO slots, mirroring web (apps/web AIReadingDisplay.tsx:1958-2071):
 *   - `renderReadingSectionHeader` → star / verdict badge ABOVE the prose
 *   - `renderReadingExtras`        → the heavier deterministic data BELOW it
 */
import * as React from 'react';
import type { ReadingType } from '@repo/shared';
import type {
  V2DeterministicData,
  LifetimeV2DeterministicData,
  CareerV2DeterministicData,
  AnnualV2DeterministicData,
  LoveV2DeterministicData,
  ReadingSectionData,
} from '../../lib/readings-api';
import { CharacterCard, LifetimeDeterministicCard } from './lifetime-cards';
import { LuckPeriodChart, LuckPeriodTimeline, LuckPeriodHeader } from './luck-periods';
import { CareerWidgets, CareerForecastBadge } from './career-widgets';
import { AnnualWidgets, LoveWidgets } from './annual-love-widgets';
import { StarRating } from './primitives';

/** Lifetime timing sections — web renders the 大運 header (not a star) above prose. */
const LIFETIME_TIMING_SECTIONS = new Set(['current_period', 'next_period', 'best_period']);

/**
 * Career sections where web shows a go/no-go verdict or a summary badge INSTEAD
 * of a star (apps/web AIReadingDisplay.tsx:406 / :491). Every static career
 * section is in one of these sets, so in practice only the career *forecast*
 * sub-sections get a star — matching web.
 */
const CAREER_VERDICT_SECTIONS = new Set(['company_type_fit', 'entrepreneurship', 'partnership']);
const CAREER_SUMMARY_SECTIONS = new Set([
  'career_pattern',
  'suitable_positions',
  'career_directions_favorable',
  'career_directions_unfavorable',
  'career_allies',
]);

/** Standalone header widget (lifetime CharacterCard) rendered before sections. */
export function ReadingHeader({
  readingType,
  chartData,
}: {
  readingType: ReadingType;
  chartData: Record<string, unknown> | null;
}): React.ReactNode {
  if (readingType === 'lifetime') return <CharacterCard chartData={chartData} />;
  return null;
}

/**
 * Star / verdict badge for a section — rendered ABOVE the AI prose (web parity).
 * Sources differ per reading type:
 *  - lifetime: `section.score` star, or the 大運 header on timing sections
 *  - career:   `section.score` star, EXCEPT verdict/summary sections (web shows
 *              a badge there — that badge stays in the after-prose body)
 *  - annual/love: the whole badge widget (these carry no `section.score`; their
 *              star is derived from auspiciousness inside the widget)
 */
export function renderReadingSectionHeader({
  readingType,
  section,
  deterministic,
}: {
  readingType: ReadingType;
  section: ReadingSectionData;
  deterministic?: V2DeterministicData;
}): React.ReactNode {
  const score = section.score;

  switch (readingType) {
    case 'lifetime': {
      if (LIFETIME_TIMING_SECTIONS.has(section.key)) {
        if (!deterministic) return null;
        return (
          <LuckPeriodHeader
            sectionKey={section.key}
            det={deterministic as LifetimeV2DeterministicData}
          />
        );
      }
      return score != null ? <StarRating score={score} /> : null;
    }
    case 'career': {
      if (score == null) return null;
      if (CAREER_VERDICT_SECTIONS.has(section.key) || CAREER_SUMMARY_SECTIONS.has(section.key)) {
        return null;
      }
      return <StarRating score={score} />;
    }
    case 'annual':
      return deterministic ? (
        <AnnualWidgets sectionKey={section.key} det={deterministic as AnnualV2DeterministicData} />
      ) : null;
    case 'love':
      return deterministic ? (
        <LoveWidgets sectionKey={section.key} det={deterministic as LoveV2DeterministicData} />
      ) : null;
    default:
      return null;
  }
}

/**
 * Per-section deterministic data, rendered inside the section card AFTER prose.
 * annual/love return null — their whole widget is the pre-prose header above.
 */
export function renderReadingExtras({
  readingType,
  sectionKey,
  deterministic,
  chartData,
  isSubscriber,
}: {
  readingType: ReadingType;
  sectionKey: string;
  deterministic?: V2DeterministicData;
  chartData: Record<string, unknown> | null;
  isSubscriber: boolean;
}): React.ReactNode {
  if (!deterministic) return null;

  switch (readingType) {
    case 'lifetime': {
      const det = deterministic as LifetimeV2DeterministicData;
      return (
        <>
          <LifetimeDeterministicCard
            sectionKey={sectionKey}
            det={det}
            chartData={chartData}
            isSubscriber={isSubscriber}
          />
          {/* LuckPeriodHeader moved to the pre-prose header slot (web parity). */}
          {sectionKey === 'best_period' ? (
            <>
              <LuckPeriodChart periods={det.luckPeriodsEnriched} bestPeriod={det.bestPeriod} />
              <LuckPeriodTimeline periods={det.luckPeriodsEnriched} bestPeriod={det.bestPeriod} />
            </>
          ) : null}
        </>
      );
    }
    case 'career': {
      const det = deterministic as CareerV2DeterministicData;
      return (
        <>
          <CareerWidgets sectionKey={sectionKey} det={det} />
          <CareerForecastBadge sectionKey={sectionKey} det={det} />
        </>
      );
    }
    // annual + love: the badge widget is the section header (rendered before prose).
    case 'annual':
    case 'love':
      return null;
    default:
      return null;
  }
}
