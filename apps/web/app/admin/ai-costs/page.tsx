'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getAICosts, type AICosts } from '../../lib/admin-api';
import styles from '../layout.module.css';
import pageStyles from './page.module.css';

export default function AdminAICostsPage() {
  const { getToken } = useAuth();
  const [costs, setCosts] = useState<AICosts | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setCosts(await getAICosts(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <div className={styles.loading}>Loading AI costs...</div>;
  if (error) {
    return (
      <div className={styles.error}>
        {error}
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchData}>
          Retry
        </button>
      </div>
    );
  }
  if (!costs) return null;

  return (
    <div>
      <h1 className={styles.pageTitle}>AI Costs (Last 30 Days)</h1>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Cost</div>
          <div className={styles.statValue}>${costs.totalCost30d.toFixed(2)}</div>
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
              </tr>
            </thead>
            <tbody>
              {costs.costByProvider.map((p) => (
                <tr key={p.provider}>
                  <td style={{ fontWeight: 500 }}>{p.provider}</td>
                  <td>${p.totalCost.toFixed(4)}</td>
                  <td>{p.count.toLocaleString()}</td>
                  <td>${p.count > 0 ? (p.totalCost / p.count).toFixed(4) : '0.0000'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {costs.dailyCosts.length > 0 && (
        <section>
          <h2 className={pageStyles.sectionTitle}>Daily Costs</h2>
          <div className={pageStyles.dailyChart} role="img" aria-label="Daily AI costs bar chart">
            {costs.dailyCosts.map((d) => {
              const max = Math.max(...costs.dailyCosts.map((x) => x.totalCost));
              const pct = max > 0 ? (d.totalCost / max) * 100 : 0;
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
