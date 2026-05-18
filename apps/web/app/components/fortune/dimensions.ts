/**
 * dimensions.ts — Shared per-dim metadata for the daily fortune page.
 *
 * Per UX Refinement Sprint (R1.9 + Round-2 N4):
 *   - `dimensions.ts` = per-dim metadata (icon component, narrative key, key)
 *   - `labels.ts`     = label-to-copy maps + tier color helpers + date format
 *
 * If a constant fits BOTH, put it in `labels.ts` (UX copy concern dominates).
 *
 * Icons via Lucide React (`lucide-react`), tree-shaken via Next.js 16's
 * `experimental.optimizePackageImports` config.
 */
import {
  HeartHandshake,
  Briefcase,
  Wallet,
  Compass,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import type { DailyFortuneNarrative } from '../../lib/fortune-api';

export type DimKey = 'romance' | 'career' | 'finance' | 'travel' | 'health';

export interface DimMeta {
  key: DimKey;
  zh: string;
  /** Narrative field key in `DailyFortuneNarrative` (e.g. 'daily_romance') */
  narrativeKey: keyof DailyFortuneNarrative;
  Icon: LucideIcon;
}

/**
 * Canonical 5-dim metadata. Consumed by:
 *  - `DimensionBars` (icons above vertical bars)
 *  - `NarrativeCard` (icons next to per-dim narrative headers)
 *  - any future per-dim aggregator
 *
 * Icon mapping confirmed via user locked decision (2026-05-15):
 *  - 感情 (romance) → HeartHandshake (warmer than plain Heart)
 *  - 事業 (career)  → Briefcase
 *  - 財運 (finance) → Wallet
 *  - 出行 (travel)  → Compass
 *  - 健康 (health)  → Activity
 */
export const DIM_META: DimMeta[] = [
  { key: 'romance', zh: '感情', narrativeKey: 'daily_romance', Icon: HeartHandshake },
  { key: 'career',  zh: '事業', narrativeKey: 'daily_career',  Icon: Briefcase },
  { key: 'finance', zh: '財運', narrativeKey: 'daily_finance', Icon: Wallet },
  { key: 'travel',  zh: '出行', narrativeKey: 'daily_travel',  Icon: Compass },
  { key: 'health',  zh: '健康', narrativeKey: 'daily_health',  Icon: Activity },
];
