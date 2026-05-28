/**
 * monthlyDimensions.ts — Per-dim metadata for Phase 2 月運 (Monthly Fortune).
 *
 * Mirror of `dimensions.ts` (DAY scope) scaled down to MONTH scope.
 *
 * Phase A Sub-Agent B research lock (2026-05-28):
 *   - 4 dims only: career / finance / romance / health
 *   - 出行 OMITTED — DAY-only doctrine per 三命通會 神煞篇 (驛馬 is day-pillar
 *     trigger, not monthly theme)
 *   - Canonical zh-TW labels: 事業 / 財運 / 感情 / 健康
 *
 * Icons reused from `dimensions.ts` (Briefcase / Wallet / HeartHandshake /
 * Activity) for visual consistency across scopes. Compass (出行) excluded.
 */
import {
  HeartHandshake,
  Briefcase,
  Wallet,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import type { MonthlyFortuneNarrative } from '../../lib/fortune-api';

export type MonthlyDimKey = 'career' | 'finance' | 'romance' | 'health';

export interface MonthlyDimMeta {
  key: MonthlyDimKey;
  zh: string;
  /** Narrative field key in `MonthlyFortuneNarrative` (e.g. 'monthly_career') */
  narrativeKey: keyof MonthlyFortuneNarrative;
  /** Optional takeaway pull-quote sibling field key (e.g. 'monthly_career_takeaway') */
  takeawayKey: keyof MonthlyFortuneNarrative;
  Icon: LucideIcon;
}

/**
 * Canonical 4-dim metadata for monthly. Order matches narrative section flow
 * (career most-anchored to month pillar → finance → romance → health most-
 * transient).
 */
export const MONTHLY_DIM_META: MonthlyDimMeta[] = [
  {
    key: 'career',
    zh: '事業',
    narrativeKey: 'monthly_career',
    takeawayKey: 'monthly_career_takeaway',
    Icon: Briefcase,
  },
  {
    key: 'finance',
    zh: '財運',
    narrativeKey: 'monthly_finance',
    takeawayKey: 'monthly_finance_takeaway',
    Icon: Wallet,
  },
  {
    key: 'romance',
    zh: '感情',
    narrativeKey: 'monthly_romance',
    takeawayKey: 'monthly_romance_takeaway',
    Icon: HeartHandshake,
  },
  {
    key: 'health',
    zh: '健康',
    narrativeKey: 'monthly_health',
    takeawayKey: 'monthly_health_takeaway',
    Icon: Activity,
  },
];
