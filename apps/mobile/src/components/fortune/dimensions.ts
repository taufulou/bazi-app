/**
 * dimensions.ts — Shared per-dim metadata for the daily fortune tab.
 * Port of apps/web/app/components/fortune/dimensions.ts (lucide-react-native icons).
 */
import {
  HeartHandshake,
  Briefcase,
  Wallet,
  Compass,
  Activity,
  type LucideIcon,
} from 'lucide-react-native';
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
 * Canonical 5-dim metadata (感情/事業/財運/出行/健康). Consumed by DimensionBars
 * + NarrativeCard. Icon mapping per web locked decision (2026-05-15).
 */
export const DIM_META: DimMeta[] = [
  { key: 'romance', zh: '感情', narrativeKey: 'daily_romance', Icon: HeartHandshake },
  { key: 'career', zh: '事業', narrativeKey: 'daily_career', Icon: Briefcase },
  { key: 'finance', zh: '財運', narrativeKey: 'daily_finance', Icon: Wallet },
  { key: 'travel', zh: '出行', narrativeKey: 'daily_travel', Icon: Compass },
  { key: 'health', zh: '健康', narrativeKey: 'daily_health', Icon: Activity },
];
