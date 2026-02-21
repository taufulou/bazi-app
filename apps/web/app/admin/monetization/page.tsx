'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getMonetizationAnalytics, type MonetizationAnalytics } from '../../lib/admin-api';
import styles from '../layout.module.css';
import pageStyles from './page.module.css';

const SECTION_LABELS: Record<string, string> = {
  personality: 'Personality',
  career: 'Career',
  love: 'Love',
  finance: 'Finance',
  health: 'Health',
};

const TIER_COLORS: Record<string, string> = {
  BASIC: '#4ade80',
  PRO: '#e8d5b7',
  MASTER: '#9C27B0',
  FREE: '#666',
};

const REWARD_TYPE_LABELS: Record<string, string> = {
  CREDIT: 'Credit',
  SECTION_UNLOCK: 'Section Unlock',
  DAILY_HOROSCOPE: 'Daily Horoscope',
};

const REVENUE_TYPE_LABELS: Record<string, string> = {
  SUBSCRIPTION: 'Subscriptions',
  CREDIT_PURCHASE: 'Credit Packages',
  ONE_TIME: 'One-time Purchase',
};

const REVENUE_TYPE_COLORS: Record<string, string> = {
  SUBSCRIPTION: '#e8d5b7',
  CREDIT_PURCHASE: '#4ade80',
  ONE_TIME: '#60a5fa',
};

const DAY_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '365 days' },
];

export default function AdminMonetizationPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<MonetizationAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async (daysParam: number) => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setData(await getMonetizationAnalytics(token, { days: daysParam }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData(days);
  }, [fetchData, days]);

  if (loading) return <div className={styles.loading}>Loading monetization analytics...</div>;
  if (error) {
    return (
      <div className={styles.error}>
        {error}
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => fetchData(days)}>Retry</button>
      </div>
    );
  }
  if (!data) return null;

  const totalSubscribers = data.activeSubscriptionsByTier.reduce((s, t) => s + t.count, 0);

  return (
    <div>
      <div className={pageStyles.pageHeader}>
        <h1 className={styles.pageTitle}>Monetization Analytics</h1>
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

      {/* Revenue by Stream */}
      <section style={{ marginBottom: 32 }}>
        <h2 className={pageStyles.sectionTitle}>Revenue by Stream</h2>
        <div className={pageStyles.revenueGrid}>
          {data.revenueByType.map((r) => (
            <div
              key={r.type}
              className={pageStyles.revenueCard}
              style={{ borderLeftColor: REVENUE_TYPE_COLORS[r.type] || '#666' }}
            >
              <div className={pageStyles.revenueLabel}>{REVENUE_TYPE_LABELS[r.type] || r.type}</div>
              <div className={pageStyles.revenueValue}>${r.total.toFixed(2)}</div>
              <div className={pageStyles.revenueMeta}>{r.count} transactions</div>
            </div>
          ))}
          {data.revenueByType.length === 0 && (
            <div style={{ color: '#666', fontStyle: 'italic', padding: 16 }}>No revenue data in period</div>
          )}
        </div>
      </section>

      {/* Summary Stats */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Active Subscribers</div>
          <div className={styles.statValue}>{totalSubscribers}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>New Subscriptions</div>
          <div className={styles.statValue}>{data.newSubscriptions}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Cancelled</div>
          <div className={styles.statValue}>{data.cancelledSubscriptions}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Ad Rewards Claimed</div>
          <div className={styles.statValue}>{data.adRewardClaims.reduce((s, c) => s + c.count, 0)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Sections Unlocked</div>
          <div className={styles.statValue}>{data.sectionUnlockStats.reduce((s, u) => s + u.count, 0)}</div>
        </div>
      </div>

      {/* Active Subscriptions by Tier */}
      {data.activeSubscriptionsByTier.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className={pageStyles.sectionTitle}>Active Subscribers by Tier</h2>
          <div className={pageStyles.donutContainer}>
            <div className={pageStyles.donutLegend}>
              {data.activeSubscriptionsByTier.map((t) => (
                <div key={t.tier} className={pageStyles.legendItem}>
                  <span
                    className={pageStyles.legendDot}
                    style={{ backgroundColor: TIER_COLORS[t.tier] || '#666' }}
                  />
                  <span className={pageStyles.legendLabel}>{t.tier}</span>
                  <span className={pageStyles.legendCount}>
                    {t.count} ({totalSubscribers > 0 ? ((t.count / totalSubscribers) * 100).toFixed(0) : 0}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Ad Reward Claims */}
      {data.adRewardClaims.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className={pageStyles.sectionTitle}>Ad Reward Claims</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Reward Type</th>
                <th>Claims</th>
                <th>Credits Granted</th>
              </tr>
            </thead>
            <tbody>
              {data.adRewardClaims.map((c) => (
                <tr key={c.rewardType}>
                  <td style={{ fontWeight: 500 }}>{REWARD_TYPE_LABELS[c.rewardType] || c.rewardType}</td>
                  <td>{c.count}</td>
                  <td>{c.creditsGranted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Section Unlock Popularity */}
      {data.sectionUnlockStats.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className={pageStyles.sectionTitle}>Section Unlock Popularity</h2>
          <div className={pageStyles.sectionBars}>
            {(() => {
              const maxCount = Math.max(...data.sectionUnlockStats.map((s) => s.count));
              return data.sectionUnlockStats.map((s) => {
                const pct = maxCount > 0 ? (s.count / maxCount) * 100 : 0;
                return (
                  <div key={s.sectionKey} className={pageStyles.sectionBar}>
                    <span className={pageStyles.sectionBarLabel}>
                      {SECTION_LABELS[s.sectionKey] || s.sectionKey}
                    </span>
                    <div
                      className={pageStyles.sectionBarFill}
                      style={{ width: `${pct}%` }}
                    />
                    <span className={pageStyles.sectionBarCount}>{s.count}</span>
                  </div>
                );
              });
            })()}
          </div>
        </section>
      )}

      {/* Conversion Funnel */}
      <section style={{ marginBottom: 32 }}>
        <h2 className={pageStyles.sectionTitle}>Conversion Funnel</h2>
        <div className={pageStyles.funnelContainer}>
          {(() => {
            const f = data.conversionFunnel;
            const steps = [
              { label: 'Total Users', count: f.totalUsers },
              { label: 'With Readings', count: f.usersWithReadings },
              { label: 'Credit Buyers', count: f.creditPurchasers },
              { label: 'Subscribers', count: f.subscribers },
            ];
            const maxCount = Math.max(...steps.map((s) => s.count), 1);
            return steps.map((step, i) => {
              const pct = (step.count / maxCount) * 100;
              const prev = i > 0 ? steps[i - 1].count : 0;
              const rate = prev > 0 ? ((step.count / prev) * 100).toFixed(1) : '';
              return (
                <div key={step.label} className={pageStyles.funnelStep}>
                  <span className={pageStyles.funnelLabel}>{step.label}</span>
                  <div
                    className={pageStyles.funnelBar}
                    style={{ width: `${pct}%`, opacity: 1 - i * 0.15 }}
                  />
                  <span className={pageStyles.funnelCount}>{step.count.toLocaleString()}</span>
                  <span className={pageStyles.funnelRate}>{rate ? `${rate}%` : ''}</span>
                </div>
              );
            });
          })()}
        </div>
      </section>

      {/* Credit Package Purchases */}
      {data.creditPackagePurchases.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 className={pageStyles.sectionTitle}>Credit Package Purchases</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Package</th>
                <th>Revenue</th>
                <th>Purchases</th>
                <th>Avg Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.creditPackagePurchases.map((p) => (
                <tr key={p.description}>
                  <td style={{ fontWeight: 500 }}>{p.description}</td>
                  <td>${p.totalRevenue.toFixed(2)}</td>
                  <td>{p.count}</td>
                  <td>${p.avgAmount.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Ad Reward Daily Trend */}
      {data.adRewardDailyTrend.length > 0 && (
        <section>
          <h2 className={pageStyles.sectionTitle}>Ad Reward Daily Trend</h2>
          <div className={pageStyles.dailyChart} role="img" aria-label="Daily ad reward claims bar chart">
            {(() => {
              const maxVal = Math.max(...data.adRewardDailyTrend.map((x) => x.count));
              return data.adRewardDailyTrend.map((d) => {
                const pct = maxVal > 0 ? (d.count / maxVal) * 100 : 0;
                const dateStr = new Date(d.date).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                });
                return (
                  <div key={d.date} className={pageStyles.dailyBar}>
                    <div
                      className={pageStyles.dailyBarFill}
                      style={{ height: `${pct}%` }}
                      aria-label={`${dateStr}: ${d.count} claims`}
                      title={`${dateStr}: ${d.count} ad reward claims`}
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
