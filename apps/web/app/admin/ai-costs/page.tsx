'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getAICosts, type AICosts } from '../../lib/admin-api';
import styles from '../layout.module.css';
import pageStyles from './page.module.css';

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
  UNCLASSIFIED: 'Unclassified',
};

const TIER_COLORS: Record<string, string> = {
  comprehensive: '#e8d5b7',
  periodic: '#9C27B0',
  daily: '#FF9800',
  qa: '#009688',
  unclassified: '#666',
};

const DAY_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '365 days' },
];

export default function AdminAICostsPage() {
  const { getToken } = useAuth();
  const [costs, setCosts] = useState<AICosts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async (daysParam: number) => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setCosts(await getAICosts(token, { days: daysParam }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData(days);
  }, [fetchData, days]);

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

  return (
    <div>
      <div className={pageStyles.pageHeader}>
        <h1 className={styles.pageTitle}>AI Costs</h1>
        <select
          className={pageStyles.daySelector}
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          {DAY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>Last {opt.label}</option>
          ))}
        </select>
      </div>

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

      {/* Tier Cards */}
      {costs.costByTier.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className={pageStyles.sectionTitle}>Cost by Tier</h2>
          <div className={pageStyles.tierGrid}>
            {costs.costByTier.map((t) => (
              <div
                key={t.tier}
                className={pageStyles.tierCard}
                style={{ borderLeftColor: TIER_COLORS[t.tier] || '#666' }}
              >
                <div className={pageStyles.tierLabel}>{t.label}</div>
                <div className={pageStyles.tierCost}>${t.totalCost.toFixed(2)}</div>
                <div className={pageStyles.tierMeta}>
                  {t.count.toLocaleString()} requests &middot; ${t.avgCost.toFixed(4)} avg
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Reading Type Table */}
      {costs.costByReadingType.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className={pageStyles.sectionTitle}>Cost by Reading Type</h2>
          <div className={pageStyles.tableWrapper}>
            <table className={`${styles.table} ${pageStyles.readingTypeTable}`}>
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
                {costs.costByReadingType.map((r) => {
                  const isUnclassified = r.readingType === 'UNCLASSIFIED';
                  const tierInfo = getTierForType(r.readingType);
                  return (
                    <tr
                      key={r.readingType}
                      className={isUnclassified ? pageStyles.unclassifiedRow : undefined}
                    >
                      <td style={{ fontWeight: 500 }}>
                        {READING_TYPE_LABELS[r.readingType] || r.readingType}
                      </td>
                      <td>
                        <span
                          className={pageStyles.tierBadge}
                          style={{ backgroundColor: TIER_COLORS[tierInfo.tier] || '#666' }}
                        >
                          {tierInfo.label}
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
          </div>
        </section>
      )}

      {/* Provider Table */}
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

      {/* Daily Cost Chart */}
      {costs.dailyCosts.length > 0 && (
        <section>
          <h2 className={pageStyles.sectionTitle}>Daily Costs</h2>
          <div className={pageStyles.dailyChart} role="img" aria-label="Daily AI costs bar chart">
            {(() => {
              const dailyMax = Math.max(...costs.dailyCosts.map((x) => x.totalCost));
              return costs.dailyCosts.map((d) => {
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
              });
            })()}
          </div>
        </section>
      )}
    </div>
  );
}

/** Helper to get tier info for a reading type */
function getTierForType(readingType: string): { tier: string; label: string } {
  const TIERS: Record<string, { tier: string; label: string }> = {
    LIFETIME:           { tier: 'comprehensive', label: 'Comprehensive' },
    CAREER:             { tier: 'comprehensive', label: 'Comprehensive' },
    LOVE:               { tier: 'comprehensive', label: 'Comprehensive' },
    HEALTH:             { tier: 'comprehensive', label: 'Comprehensive' },
    COMPATIBILITY:      { tier: 'comprehensive', label: 'Comprehensive' },
    ZWDS_LIFETIME:      { tier: 'comprehensive', label: 'Comprehensive' },
    ZWDS_CAREER:        { tier: 'comprehensive', label: 'Comprehensive' },
    ZWDS_LOVE:          { tier: 'comprehensive', label: 'Comprehensive' },
    ZWDS_HEALTH:        { tier: 'comprehensive', label: 'Comprehensive' },
    ZWDS_COMPATIBILITY: { tier: 'comprehensive', label: 'Comprehensive' },
    ZWDS_MAJOR_PERIOD:  { tier: 'comprehensive', label: 'Comprehensive' },
    ANNUAL:             { tier: 'periodic', label: 'Periodic' },
    ZWDS_ANNUAL:        { tier: 'periodic', label: 'Periodic' },
    ZWDS_MONTHLY:       { tier: 'periodic', label: 'Periodic' },
    ZWDS_DAILY:         { tier: 'daily', label: 'Daily' },
    ZWDS_QA:            { tier: 'qa', label: 'Q&A' },
  };
  return TIERS[readingType] || { tier: 'unclassified', label: 'Unclassified' };
}
