'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getAICosts, type AICosts, type CostByReadingType } from '../../lib/admin-api';
import { READING_TYPE_TIERS } from '@repo/shared';
import styles from '../layout.module.css';
import pageStyles from './page.module.css';

const DATE_RANGE_OPTIONS = [
  { value: 7, label: 'Last 7 days' },
  { value: 30, label: 'Last 30 days' },
  { value: 90, label: 'Last 90 days' },
  { value: 365, label: 'Last 365 days' },
];

/** Human-readable reading type names */
const READING_TYPE_LABELS: Record<string, string> = {
  LIFETIME: 'Bazi Lifetime',
  ANNUAL: 'Bazi Annual',
  CAREER: 'Bazi Career',
  LOVE: 'Bazi Love',
  HEALTH: 'Bazi Health',
  COMPATIBILITY: 'Bazi Compatibility',
  ZWDS_LIFETIME: 'ZWDS Lifetime',
  ZWDS_ANNUAL: 'ZWDS Annual',
  ZWDS_CAREER: 'ZWDS Career',
  ZWDS_LOVE: 'ZWDS Love',
  ZWDS_HEALTH: 'ZWDS Health',
  ZWDS_COMPATIBILITY: 'ZWDS Compatibility',
  ZWDS_MONTHLY: 'ZWDS Monthly',
  ZWDS_DAILY: 'ZWDS Daily',
  ZWDS_MAJOR_PERIOD: 'ZWDS Major Period',
  ZWDS_QA: 'ZWDS Q&A',
  UNCLASSIFIED: 'Legacy (Unclassified)',
};

function getTier(readingType: string): string {
  return READING_TYPE_TIERS[readingType]?.tier ?? 'unclassified';
}

export default function AdminAICostsPage() {
  const { getToken } = useAuth();
  const [costs, setCosts] = useState<AICosts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async (selectedDays: number) => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setCosts(await getAICosts(token, { days: selectedDays }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData(days);
  }, [fetchData, days]);

  const handleDaysChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDays(Number(e.target.value));
  };

  if (loading) return <div className={styles.loading}>Loading AI costs...</div>;
  if (error) {
    return (
      <div className={styles.error}>
        {error}
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => fetchData(days)}>
          Retry
        </button>
      </div>
    );
  }
  if (!costs) return null;

  // Pre-compute max for daily chart (O(n) instead of O(n^2))
  const dailyMax = costs.dailyCosts.length > 0
    ? Math.max(...costs.dailyCosts.map((x) => x.totalCost))
    : 0;

  return (
    <div>
      {/* Page Header with Date Selector */}
      <div className={pageStyles.pageHeader}>
        <h1>AI Cost Analytics</h1>
        <select
          className={pageStyles.dateSelector}
          value={days}
          onChange={handleDaysChange}
        >
          {DATE_RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Summary Stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Cost</div>
          <div className={styles.statValue}>${costs.totalCost.toFixed(2)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Avg Cost / Reading</div>
          <div className={styles.statValue}>${costs.avgCostPerReading.toFixed(4)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Tokens</div>
          <div className={styles.statValue}>{costs.totalTokens.toLocaleString()}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Cache Hit Rate</div>
          <div className={styles.statValue}>{(costs.cacheHitRate * 100).toFixed(1)}%</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Requests</div>
          <div className={styles.statValue}>{costs.totalRequests.toLocaleString()}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Input Tokens</div>
          <div className={styles.statValue}>{costs.totalInputTokens.toLocaleString()}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Output Tokens</div>
          <div className={styles.statValue}>{costs.totalOutputTokens.toLocaleString()}</div>
        </div>
      </div>

      {/* Cost by Tier */}
      {costs.costByTier.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className={pageStyles.sectionTitle}>Cost by Tier</h2>
          <div className={pageStyles.tierCards}>
            {costs.costByTier.map((t) => (
              <div key={t.tier} className={pageStyles.tierCard} data-tier={t.tier}>
                <div className={pageStyles.tierLabel}>{t.label}</div>
                <div className={pageStyles.tierCost}>${t.totalCost.toFixed(4)}</div>
                <div className={pageStyles.tierMeta}>
                  <span>{t.count.toLocaleString()} requests</span>
                  <span>${t.avgCost.toFixed(4)} avg</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Cost by Reading Type */}
      {costs.costByReadingType.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className={pageStyles.sectionTitle}>Cost by Reading Type</h2>
          <table className={pageStyles.readingTypeTable}>
            <thead>
              <tr>
                <th>Reading Type</th>
                <th>Tier</th>
                <th>Requests</th>
                <th>Total Cost</th>
                <th>Avg Cost</th>
                <th>Avg In Tokens</th>
                <th>Avg Out Tokens</th>
                <th>Avg Latency</th>
                <th>Cache Hit %</th>
              </tr>
            </thead>
            <tbody>
              {costs.costByReadingType.map((r: CostByReadingType) => {
                const tier = getTier(r.readingType);
                const isLegacy = r.readingType === 'UNCLASSIFIED';
                return (
                  <tr key={r.readingType} className={isLegacy ? pageStyles.legacyRow : undefined}>
                    <td>{READING_TYPE_LABELS[r.readingType] ?? r.readingType}</td>
                    <td>
                      <span className={pageStyles.tierBadge} data-tier={tier}>
                        {tier}
                      </span>
                    </td>
                    <td>{r.count.toLocaleString()}</td>
                    <td>${r.totalCost.toFixed(4)}</td>
                    <td>${r.avgCost.toFixed(4)}</td>
                    <td>{r.avgInputTokens.toLocaleString()}</td>
                    <td>{r.avgOutputTokens.toLocaleString()}</td>
                    <td>{r.avgLatencyMs.toLocaleString()}ms</td>
                    <td>{(r.cacheHitRate * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Cost by Provider */}
      {costs.costByProvider.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className={pageStyles.sectionTitle}>Cost by Provider</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Total Cost</th>
                <th>Requests</th>
                <th>Avg Cost</th>
                <th>Input Tokens</th>
                <th>Output Tokens</th>
              </tr>
            </thead>
            <tbody>
              {costs.costByProvider.map((p) => (
                <tr key={p.provider}>
                  <td style={{ fontWeight: 500 }}>{p.provider}</td>
                  <td>${p.totalCost.toFixed(4)}</td>
                  <td>{p.count.toLocaleString()}</td>
                  <td>${p.avgCost.toFixed(4)}</td>
                  <td>{p.totalInputTokens.toLocaleString()}</td>
                  <td>{p.totalOutputTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Daily Cost Trend */}
      {costs.dailyCosts.length > 0 && (
        <section>
          <h2 className={pageStyles.sectionTitle}>Daily Costs</h2>
          <div className={pageStyles.dailyChart} role="img" aria-label="Daily AI costs bar chart">
            {costs.dailyCosts.map((d) => {
              const pct = dailyMax > 0 ? (d.totalCost / dailyMax) * 100 : 0;
              const dateStr = new Date(d.date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              });
              return (
                <div key={d.date} className={pageStyles.dailyBar}>
                  <div
                    className={pageStyles.dailyBarFill}
                    style={{ height: `${pct}%` }}
                    aria-label={`${dateStr}: $${d.totalCost.toFixed(4)}`}
                    title={`${dateStr}: $${d.totalCost.toFixed(4)} (${d.count} requests)`}
                  />
                  <span className={pageStyles.dailyBarLabel}>{dateStr}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
