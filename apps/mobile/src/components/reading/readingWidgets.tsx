/**
 * readingWidgets — dispatches the per-reading-type deterministic widgets into
 * the AIReadingDisplay orchestrator. Each widget is rendered as a JSX component
 * (NOT called as a function) so its internal `useZh()` hook gets a proper
 * component render context, and each self-gates to `null` for non-matching
 * sections.
 */
import * as React from 'react';
import type { ReadingType } from '@repo/shared';
import type {
  V2DeterministicData,
  LifetimeV2DeterministicData,
  CareerV2DeterministicData,
  AnnualV2DeterministicData,
  LoveV2DeterministicData,
} from '../../lib/readings-api';
import { CharacterCard, LifetimeDeterministicCard } from './lifetime-cards';
import { LuckPeriodChart, LuckPeriodTimeline, LuckPeriodHeader } from './luck-periods';
import { CareerWidgets, CareerForecastBadge } from './career-widgets';
import { AnnualWidgets, LoveWidgets } from './annual-love-widgets';

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

/** Per-section deterministic widget(s), rendered inside the section card after prose. */
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
          <LuckPeriodHeader sectionKey={sectionKey} det={det} />
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
    case 'annual':
      return <AnnualWidgets sectionKey={sectionKey} det={deterministic as AnnualV2DeterministicData} />;
    case 'love':
      return <LoveWidgets sectionKey={sectionKey} det={deterministic as LoveV2DeterministicData} />;
    default:
      return null;
  }
}
