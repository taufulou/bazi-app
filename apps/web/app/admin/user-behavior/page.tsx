'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getUserBehaviorSummary, type UserBehaviorSummary } from '../../lib/admin-api';
import styles from '../layout.module.css';
import pageStyles from './page.module.css';

export default function UserBehaviorPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<UserBehaviorSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(30);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setData(await getUserBehaviorSummary(token, days));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <div className={styles.loading}>Loading user behavior data...</div>;
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
  if (!data) return null;

  return (
    <div>
      <h1 className={styles.pageTitle}>User Behavior Summary</h1>

      {data.error && (
        <div className={styles.error}>
          Failed to load some data. Values below may be incomplete.
        </div>
      )}

      {/* Period selector */}
      <div className={pageStyles.periodSelector}>
        {[7, 14, 30, 90].map((d) => (
          <button
            key={d}
            className={days === d ? pageStyles.periodBtnActive : pageStyles.periodBtn}
            onClick={() => setDays(d)}
          >
            {d} days
          </button>
        ))}
      </div>

      {/* ===== CONVERSION FUNNEL ===== */}
      <h2 className={pageStyles.sectionTitle}>Conversion Funnel</h2>
      <div className={pageStyles.funnelContainer}>
        <div className={pageStyles.funnelStep}>
          <div className={pageStyles.funnelStepLabel}>Total Users</div>
          <div className={pageStyles.funnelStepValue}>
            {data.funnel.totalUsers.toLocaleString()}
          </div>
        </div>
        <div className={pageStyles.funnelArrow}>
          &rarr;
        </div>
        <div className={pageStyles.funnelStep}>
          <div className={pageStyles.funnelStepLabel}>Created a Reading</div>
          <div className={pageStyles.funnelStepValue}>
            {data.funnel.usersWhoCreatedReading.toLocaleString()}
          </div>
          <div className={pageStyles.funnelRate}>
            {data.funnel.signupToReadingRate}%
          </div>
        </div>
        <div className={pageStyles.funnelArrow}>
          &rarr;
        </div>
        <div className={pageStyles.funnelStep}>
          <div className={pageStyles.funnelStepLabel}>Active Subscriber</div>
          <div className={pageStyles.funnelStepValue}>
            {data.funnel.usersWithActiveSubscription.toLocaleString()}
          </div>
          <div className={pageStyles.funnelRate}>
            {data.funnel.overallConversionRate}% overall
          </div>
        </div>
      </div>

      {/* ===== KEY METRICS ===== */}
      <h2 className={pageStyles.sectionTitle}>Key Metrics</h2>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>New Users ({days}d)</div>
          <div className={styles.statValue}>{data.growth.newUsersInPeriod}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Active Users (7d)</div>
          <div className={styles.statValue}>{data.engagement.activeUsers7d}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Active Users (30d)</div>
          <div className={styles.statValue}>{data.engagement.activeUsers30d}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Free Readings Used</div>
          <div className={styles.statValue}>{data.growth.freeReadingUsedCount}</div>
        </div>
      </div>

      {/* ===== ENGAGEMENT COMPARISON ===== */}
      <h2 className={pageStyles.sectionTitle}>Engagement: Subscriber vs Free</h2>
      <div className={pageStyles.insightCards}>
        <div className={pageStyles.insightCard}>
          <div className={pageStyles.insightLabel}>Avg Readings / Subscriber</div>
          <div className={pageStyles.insightValueGreen}>
            {data.engagement.avgReadingsPerSubscriber.toFixed(1)}
          </div>
        </div>
        <div className={pageStyles.insightCard}>
          <div className={pageStyles.insightLabel}>Avg Readings / Free User</div>
          <div className={pageStyles.insightValue}>
            {data.engagement.avgReadingsPerFreeUser.toFixed(1)}
          </div>
        </div>
        <div className={pageStyles.insightCard}>
          <div className={pageStyles.insightLabel}>Signup &rarr; Reading Rate</div>
          <div className={pageStyles.insightValueGreen}>
            {data.funnel.signupToReadingRate}%
          </div>
        </div>
        <div className={pageStyles.insightCard}>
          <div className={pageStyles.insightLabel}>Reading &rarr; Subscription Rate</div>
          <div className={pageStyles.insightValueGreen}>
            {data.funnel.readingToSubscriptionRate}%
          </div>
        </div>
        <div className={pageStyles.insightCard}>
          <div className={pageStyles.insightLabel}>Churn Rate</div>
          <div className={pageStyles.insightValueRed}>
            {data.churn.churnRate}%
          </div>
        </div>
        <div className={pageStyles.insightCard}>
          <div className={pageStyles.insightLabel}>Cancelled ({days}d)</div>
          <div className={pageStyles.insightValueRed}>
            {data.churn.cancelledInPeriod}
          </div>
        </div>
      </div>

      {/* ===== USERS BY TIER ===== */}
      <h2 className={pageStyles.sectionTitle}>Users by Subscription Tier</h2>
      <div className={pageStyles.tierGrid}>
        {data.usersByTier.map((t) => (
          <div key={t.tier} className={pageStyles.tierCard}>
            <div className={pageStyles.tierLabel}>{t.tier}</div>
            <div className={pageStyles.tierValue}>{t.count}</div>
          </div>
        ))}
      </div>

      {/* ===== READING TYPE POPULARITY ===== */}
      {data.readingTypePopularity.length > 0 && (
        <>
          <h2 className={pageStyles.sectionTitle}>Reading Type Popularity</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Reading Type</th>
                <th>Count</th>
                <th>Share</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const total = data.readingTypePopularity.reduce((s, r) => s + r.count, 0);
                return data.readingTypePopularity.map((r) => (
                  <tr key={r.type}>
                    <td style={{ fontWeight: 500 }}>{r.type}</td>
                    <td>{r.count.toLocaleString()}</td>
                    <td>{total > 0 ? ((r.count / total) * 100).toFixed(1) : 0}%</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
        </>
      )}

      {/* ===== READINGS PER DAY TREND ===== */}
      {data.readingsPerDay.length > 0 && (
        <>
          <h2 className={pageStyles.sectionTitle}>Readings Per Day</h2>
          <div className={pageStyles.barChartContainer} role="img" aria-label="Daily readings bar chart">
            {(() => {
              const max = Math.max(...data.readingsPerDay.map((x) => x.count));
              return data.readingsPerDay.map((d) => {
              const pct = max > 0 ? (d.count / max) * 100 : 0;
              const dateStr = new Date(d.date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              });
              return (
                <div key={d.date} className={pageStyles.bar}>
                  <div
                    className={pageStyles.barFill}
                    style={{ height: `${pct}%` }}
                    title={`${dateStr}: ${d.count} readings`}
                  />
                  <span className={pageStyles.barLabel}>{dateStr}</span>
                </div>
              );
            });
            })()}
          </div>
        </>
      )}

      {/* ===== READINGS BY HOUR ===== */}
      {data.readingsByHourOfDay.length > 0 && (
        <>
          <h2 className={pageStyles.sectionTitle}>Activity by Hour of Day</h2>
          <div className={pageStyles.barChartContainer} role="img" aria-label="Hourly activity chart">
            {(() => {
              const max = Math.max(...data.readingsByHourOfDay.map((x) => x.count));
              return data.readingsByHourOfDay.map((h) => {
              const pct = max > 0 ? (h.count / max) * 100 : 0;
              return (
                <div key={h.hour} className={pageStyles.bar}>
                  <div
                    className={pageStyles.barFillBlue}
                    style={{ height: `${pct}%` }}
                    title={`${h.hour}:00 — ${h.count} readings`}
                  />
                  <span className={pageStyles.barLabel}>{h.hour}:00</span>
                </div>
              );
            });
            })()}
          </div>
        </>
      )}

      {/* ===== READINGS PER USER DISTRIBUTION ===== */}
      {data.readingsPerUserDistribution.length > 0 && (
        <>
          <h2 className={pageStyles.sectionTitle}>Readings per User Distribution</h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th># Readings</th>
                <th># Users</th>
              </tr>
            </thead>
            <tbody>
              {data.readingsPerUserDistribution.map((r) => (
                <tr key={r.readingCount}>
                  <td>{r.readingCount}</td>
                  <td>{r.userCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ===== SUBSCRIPTION TREND ===== */}
      {data.subscriptionsByMonth.length > 0 && (
        <>
          <h2 className={pageStyles.sectionTitle}>Subscriptions by Month</h2>
          <div className={pageStyles.barChartContainer} role="img" aria-label="Monthly subscriptions chart">
            {(() => {
              const max = Math.max(...data.subscriptionsByMonth.map((x) => x.count));
              return data.subscriptionsByMonth.map((s) => {
              const pct = max > 0 ? (s.count / max) * 100 : 0;
              const monthStr = new Date(s.month).toLocaleDateString('en-US', {
                month: 'short',
                year: '2-digit',
              });
              return (
                <div key={s.month} className={pageStyles.bar}>
                  <div
                    className={pageStyles.barFill}
                    style={{ height: `${pct}%` }}
                    title={`${monthStr}: ${s.count} subscriptions`}
                  />
                  <span className={pageStyles.barLabel}>{monthStr}</span>
                </div>
              );
            });
            })()}
          </div>
        </>
      )}
    </div>
  );
}
