'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getChatAggregate, type ChatAggregateResponse } from '../../lib/admin-api';
import styles from '../layout.module.css';
import pageStyles from './page.module.css';

const TIER_LABELS: Record<string, string> = {
  FREE: 'Free',
  BASIC: 'Basic (15)',
  PRO: 'Pro (30)',
  MASTER: 'Master (60)',
};

export default function AdminChatPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<ChatAggregateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setData(await getChatAggregate(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <div className={styles.loading}>Loading chat metrics...</div>;
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

  const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const fmtInt = (n: number) => n.toLocaleString();
  const fmtFloat1 = (n: number) => n.toFixed(1);

  return (
    <div>
      <div className={pageStyles.pageHeader}>
        <h1 className={styles.pageTitle}>AI Chat Metrics</h1>
        <button
          className={`${styles.btn} ${styles.btnSecondary}`}
          onClick={fetchData}
        >
          ↻ Refresh
        </button>
      </div>

      <p className={pageStyles.privacyNote}>
        Aggregate metrics only. No message contents or per-user drill-down (PDPA Phase 1).
        Generated at {new Date(data.generatedAt).toLocaleString()}.
      </p>

      {/* ============ Sessions ============ */}
      <h2 className={pageStyles.sectionTitle}>Sessions</h2>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Sessions</div>
          <div className={styles.statValue}>{fmtInt(data.sessions.total)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Last 7 Days</div>
          <div className={styles.statValue}>{fmtInt(data.sessions.last7Days)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Last 24 Hours</div>
          <div className={styles.statValue}>{fmtInt(data.sessions.last24Hours)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>At Hard Cap (≥30)</div>
          <div className={styles.statValue}>{fmtInt(data.sessions.atHardCap)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Extended (paid extension)</div>
          <div className={styles.statValue}>{fmtInt(data.sessions.extended)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Avg Messages / Session</div>
          <div className={styles.statValue}>{fmtFloat1(data.sessions.avgMessagesPerSession)}</div>
        </div>
      </div>

      {/* ============ Messages ============ */}
      <h2 className={pageStyles.sectionTitle}>Messages</h2>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Messages</div>
          <div className={styles.statValue}>{fmtInt(data.messages.total)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>User Messages</div>
          <div className={styles.statValue}>{fmtInt(data.messages.user)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Assistant Messages</div>
          <div className={styles.statValue}>{fmtInt(data.messages.assistant)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Refunded</div>
          <div className={styles.statValue}>{fmtInt(data.messages.refunded)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Refund Rate</div>
          <div className={styles.statValue}>{fmtPct(data.messages.refundRate)}</div>
        </div>
      </div>

      {/* ============ Validators ============ */}
      <h2 className={pageStyles.sectionTitle}>Validators (3-Stage Post-Validator)</h2>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Auto-Fixed (banned phrase / citation prepended)</div>
          <div className={styles.statValue}>{fmtInt(data.validators.bannedPhraseOrCitationAutoFixed)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>LLM-Judge Sampled</div>
          <div className={styles.statValue}>{fmtInt(data.validators.llmJudgeSampled)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>LLM-Judge Failures</div>
          <div className={styles.statValue}>{fmtInt(data.validators.llmJudgeFail)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>LLM-Judge Fail Rate</div>
          <div className={styles.statValue}>{fmtPct(data.validators.llmJudgeFailRate)}</div>
        </div>
      </div>

      {/* ============ Tokens (cache health) ============ */}
      <h2 className={pageStyles.sectionTitle}>Tokens & Cache</h2>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Cache Hit Rate</div>
          <div className={styles.statValue}>{fmtPct(data.tokens.cacheHitRate)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Cache Read Tokens</div>
          <div className={styles.statValue}>{fmtInt(data.tokens.totalCacheRead)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Cache Creation Tokens</div>
          <div className={styles.statValue}>{fmtInt(data.tokens.totalCacheCreation)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Input Tokens</div>
          <div className={styles.statValue}>{fmtInt(data.tokens.totalInput)}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Output Tokens</div>
          <div className={styles.statValue}>{fmtInt(data.tokens.totalOutput)}</div>
        </div>
      </div>

      {/* ============ Monthly usage by tier ============ */}
      <h2 className={pageStyles.sectionTitle}>
        This Month — Free Quota Usage by Tier
      </h2>
      <p className={pageStyles.subtle}>
        Period start: {new Date(data.monthly.periodStart).toLocaleDateString()}
      </p>
      {data.monthly.byTier.length === 0 ? (
        <p className={pageStyles.empty}>No usage this month yet.</p>
      ) : (
        <table className={pageStyles.tierTable}>
          <thead>
            <tr>
              <th>Tier</th>
              <th>Active Users</th>
              <th>Total Chats Used</th>
              <th>Avg / User</th>
            </tr>
          </thead>
          <tbody>
            {data.monthly.byTier.map((t) => (
              <tr key={t.tier}>
                <td>{TIER_LABELS[t.tier] || t.tier}</td>
                <td>{fmtInt(t.activeUsers)}</td>
                <td>{fmtInt(t.totalChatsUsed)}</td>
                <td>
                  {t.activeUsers > 0
                    ? fmtFloat1(t.totalChatsUsed / t.activeUsers)
                    : '0'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ============ Cost by session-length bucket (Phase 1.11) ============ */}
      <h2 className={pageStyles.sectionTitle}>
        Cost Breakdown — 7-Day Rolling, By Session Length
      </h2>
      <p className={pageStyles.subtle}>
        Per-session avg cost. Long sessions cost more because history tokens
        scale with each turn (and history isn&apos;t cached).
      </p>
      <table className={pageStyles.tierTable}>
        <thead>
          <tr>
            <th>Session Length</th>
            <th>Sessions</th>
            <th>Avg Cost / Session</th>
            <th>Total Cost</th>
          </tr>
        </thead>
        <tbody>
          {data.costByBucket.buckets.map((b) => (
            <tr key={b.range}>
              <td>{b.range} 則</td>
              <td>{fmtInt(b.sessionCount)}</td>
              <td>${b.avgCostUsd.toFixed(4)}</td>
              <td>${b.totalCostUsd.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ============ Extensions ============ */}
      <h2 className={pageStyles.sectionTitle}>Credit Extensions</h2>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Sessions Extended</div>
          <div className={styles.statValue}>
            {fmtInt(data.extensions.sessionsExtendedCount)}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Credits Spent on Extensions</div>
          <div className={styles.statValue}>
            {fmtInt(data.extensions.totalCreditsSpent)}
          </div>
        </div>
      </div>
    </div>
  );
}
