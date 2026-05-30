/**
 * yearlyDimensions.ts — Per-dim metadata for Phase 3 年運 (Yearly Fortune).
 *
 * Mirror of `monthlyDimensions.ts` (MONTH scope) for YEAR scope.
 *
 * Locked design (Phase 3 / Seer parity):
 *   - 4 dims only: career / finance / romance / health (no 出行 — DAY-only)
 *   - Canonical zh-TW labels: 事業 / 財運 / 感情 / 健康
 *   - Each dim carries a `keywordKey` (e.g. 'yearly_career_keyword') for the
 *     AI-generated star-card keyword + a `narrativeKey` for the prose block.
 *
 * Icons reused from `dimensions.ts` (Briefcase / Wallet / HeartHandshake /
 * Activity) for visual consistency across scopes.
 */
import {
  HeartHandshake,
  Briefcase,
  Wallet,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import type { YearlyFortuneNarrative } from '../../lib/fortune-api';

export type YearlyDimKey = 'career' | 'finance' | 'romance' | 'health';

export interface YearlyDimMeta {
  key: YearlyDimKey;
  zh: string;
  /** Narrative field key in `YearlyFortuneNarrative` (e.g. 'yearly_career') */
  narrativeKey: keyof YearlyFortuneNarrative;
  /** Optional AI keyword sibling field key (e.g. 'yearly_career_keyword') —
   *  shown on the star card under the dim label. */
  keywordKey: keyof YearlyFortuneNarrative;
  Icon: LucideIcon;
}

/**
 * Canonical 4-dim metadata for yearly. Order matches narrative section flow
 * (career → finance → romance → health), same order Seer surfaces.
 */
export const YEARLY_DIM_META: YearlyDimMeta[] = [
  {
    key: 'career',
    zh: '事業',
    narrativeKey: 'yearly_career',
    keywordKey: 'yearly_career_keyword',
    Icon: Briefcase,
  },
  {
    key: 'finance',
    zh: '財運',
    narrativeKey: 'yearly_finance',
    keywordKey: 'yearly_finance_keyword',
    Icon: Wallet,
  },
  {
    key: 'romance',
    zh: '感情',
    narrativeKey: 'yearly_romance',
    keywordKey: 'yearly_romance_keyword',
    Icon: HeartHandshake,
  },
  {
    key: 'health',
    zh: '健康',
    narrativeKey: 'yearly_health',
    keywordKey: 'yearly_health_keyword',
    Icon: Activity,
  },
];
