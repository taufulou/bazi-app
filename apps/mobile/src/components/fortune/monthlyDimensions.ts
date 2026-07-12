/**
 * monthlyDimensions.ts — Per-dim metadata for 月運 (4 dims, no 出行).
 * Port of the web component. 出行 OMITTED (DAY-only doctrine).
 */
import { HeartHandshake, Briefcase, Wallet, Activity, type LucideIcon } from 'lucide-react-native';
import type { MonthlyFortuneNarrative } from '../../lib/fortune-api';

export type MonthlyDimKey = 'career' | 'finance' | 'romance' | 'health';

export interface MonthlyDimMeta {
  key: MonthlyDimKey;
  zh: string;
  narrativeKey: keyof MonthlyFortuneNarrative;
  takeawayKey: keyof MonthlyFortuneNarrative;
  Icon: LucideIcon;
}

export const MONTHLY_DIM_META: MonthlyDimMeta[] = [
  { key: 'career', zh: '事業', narrativeKey: 'monthly_career', takeawayKey: 'monthly_career_takeaway', Icon: Briefcase },
  { key: 'finance', zh: '財運', narrativeKey: 'monthly_finance', takeawayKey: 'monthly_finance_takeaway', Icon: Wallet },
  { key: 'romance', zh: '感情', narrativeKey: 'monthly_romance', takeawayKey: 'monthly_romance_takeaway', Icon: HeartHandshake },
  { key: 'health', zh: '健康', narrativeKey: 'monthly_health', takeawayKey: 'monthly_health_takeaway', Icon: Activity },
];
