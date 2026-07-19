/**
 * yearlyDimensions.ts — Per-dim metadata for 年運 (4 dims, no 出行). RN port.
 * Each dim carries a `keywordKey` for the AI star-card keyword.
 */
import { HeartHandshake, Briefcase, Wallet, Activity, type LucideIcon } from 'lucide-react-native';
import type { YearlyFortuneNarrative } from '../../lib/fortune-api';

export type YearlyDimKey = 'career' | 'finance' | 'romance' | 'health';

export interface YearlyDimMeta {
  key: YearlyDimKey;
  zh: string;
  narrativeKey: keyof YearlyFortuneNarrative;
  keywordKey: keyof YearlyFortuneNarrative;
  Icon: LucideIcon;
}

export const YEARLY_DIM_META: YearlyDimMeta[] = [
  { key: 'career', zh: '事業', narrativeKey: 'yearly_career', keywordKey: 'yearly_career_keyword', Icon: Briefcase },
  { key: 'finance', zh: '財運', narrativeKey: 'yearly_finance', keywordKey: 'yearly_finance_keyword', Icon: Wallet },
  { key: 'romance', zh: '感情', narrativeKey: 'yearly_romance', keywordKey: 'yearly_romance_keyword', Icon: HeartHandshake },
  { key: 'health', zh: '健康', narrativeKey: 'yearly_health', keywordKey: 'yearly_health_keyword', Icon: Activity },
];
