'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { getAdminStats, type DashboardStats } from '../lib/admin-api';
import styles from './layout.module.css';
import pageStyles from './page.module.css';

export default function AdminDashboardPage() {
  const { getToken } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      const data = await getAdminStats(token);
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  if (loading) return <div className={styles.loading}>Loading dashboard...</div>;
  if (error) {
    return (
      <div className={styles.error}>
        {error}
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchStats}>
          Retry
        </button>
      </div>
    );
  }
  if (!stats) return null;

  const quickLinks = [
    { href: '/admin/services', label: 'Services', icon: '⚙️' },
    { href: '/admin/plans', label: 'Plans', icon: '💎' },
    { href: '/admin/users', label: 'Users', icon: '👥' },
    { href: '/admin/ai-costs', label: 'AI Costs', icon: '🤖' },
    { href: '/admin/audit-log', label: 'Audit Log', icon: '📋' },
  ];

  return (
    <div>
      <h1 className={styles.pageTitle}>Dashboard</h1>

      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Users</div>
          <div className={styles.statValue}>{stats.totalUsers.toLocaleString()}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Total Readings</div>
          <div className={styles.statValue}>{stats.totalReadings.toLocaleString()}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>Comparisons</div>
          <div className={styles.statValue}>{stats.totalComparisons.toLocaleString()}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statLabel}>New Users (7d)</div>
          <div className={styles.statValue}>{stats.recentUsers7d.toLocaleString()}</div>
        </div>
      </div>

      {stats.readingsByType.length > 0 && (
        <section className={pageStyles.section}>
          <h2 className={pageStyles.sectionTitle}>Readings by Type</h2>
          <div className={pageStyles.barChart} role="img" aria-label="Bar chart showing readings by type">
            {stats.readingsByType.map((r) => {
              const max = Math.max(...stats.readingsByType.map((x) => x.count));
              const pct = max > 0 ? (r.count / max) * 100 : 0;
              return (
                <div key={r.type} className={pageStyles.barRow}>
                  <span className={pageStyles.barLabel}>{r.type}</span>
                  <div className={pageStyles.barTrack}>
                    <div
                      className={pageStyles.barFill}
                      style={{ width: `${pct}%` }}
                      aria-label={`${r.type}: ${r.count}`}
                    />
                  </div>
                  <span className={pageStyles.barValue}>{r.count}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className={pageStyles.section}>
        <h2 className={pageStyles.sectionTitle}>Quick Links</h2>
        <div className={pageStyles.quickLinks}>
          {quickLinks.map((link) => (
            <Link key={link.href} href={link.href} className={pageStyles.quickLink}>
              <span>{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
