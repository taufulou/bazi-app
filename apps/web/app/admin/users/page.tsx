'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  listUsers,
  getUserDetail,
  adjustUserCredits,
  type AdminUser,
  type AdminUserDetail,
  type PaginatedResponse,
} from '../../lib/admin-api';
import styles from '../layout.module.css';
import pageStyles from './page.module.css';

export default function AdminUsersPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<PaginatedResponse<AdminUser> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [creditAmount, setCreditAmount] = useState(0);
  const [creditReason, setCreditReason] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const fetchUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      const result = await listUsers(token, { page, search: search || undefined });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken, page, search]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchUsers();
  };

  const handleSelectUser = async (user: AdminUser) => {
    try {
      setDetailLoading(true);
      const token = await getToken();
      if (!token) return;
      const detail = await getUserDetail(token, user.id);
      setSelectedUser(detail);
      setCreditAmount(0);
      setCreditReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleAdjustCredits = async () => {
    if (!selectedUser || creditAmount === 0 || !creditReason) return;
    try {
      setAdjusting(true);
      const token = await getToken();
      if (!token) return;
      await adjustUserCredits(token, selectedUser.id, {
        amount: creditAmount,
        reason: creditReason,
      });
      // Refresh user detail
      const updated = await getUserDetail(token, selectedUser.id);
      setSelectedUser(updated);
      setCreditAmount(0);
      setCreditReason('');
      // Refresh list
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adjust credits');
    } finally {
      setAdjusting(false);
    }
  };

  if (loading && !data) return <div className={styles.loading}>Loading users...</div>;

  return (
    <div>
      <h1 className={styles.pageTitle}>Users</h1>
      {error && (
        <div className={styles.error} style={{ marginBottom: 16 }}>
          {error}
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input
          className={styles.input}
          style={{ maxWidth: 400 }}
          placeholder="Search by name or Clerk ID..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
          Search
        </button>
      </form>

      <div className={pageStyles.usersLayout}>
        <div className={pageStyles.usersList}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Tier</th>
                <th>Credits</th>
                <th>Readings</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {data?.data.map((user) => (
                <tr
                  key={user.id}
                  onClick={() => handleSelectUser(user)}
                  style={{ cursor: 'pointer' }}
                >
                  <td>{user.name || user.clerkUserId}</td>
                  <td>
                    <span
                      className={`${styles.badge} ${
                        user.subscriptionTier !== 'FREE' ? styles.badgeActive : styles.badgeInactive
                      }`}
                    >
                      {user.subscriptionTier}
                    </span>
                  </td>
                  <td>{user.credits}</td>
                  <td>{user._count.baziReadings}</td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {data && (
            <div className={styles.pagination}>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Prev
              </button>
              <span className={styles.paginationInfo}>
                Page {data.meta.page} of {data.meta.totalPages} ({data.meta.total} total)
              </span>
              <button
                className={`${styles.btn} ${styles.btnSecondary}`}
                disabled={page >= data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {(detailLoading || selectedUser) && (
          <div className={pageStyles.userDetail}>
            {detailLoading ? (
              <div className={styles.loading}>Loading user...</div>
            ) : selectedUser ? (
              <>
                <h2 className={pageStyles.detailTitle}>
                  {selectedUser.name || 'Unnamed User'}
                </h2>
                <div className={pageStyles.detailMeta}>
                  <div>
                    <strong>Clerk ID:</strong>{' '}
                    <code style={{ fontSize: 12 }}>{selectedUser.clerkUserId}</code>
                  </div>
                  <div>
                    <strong>Tier:</strong> {selectedUser.subscriptionTier}
                  </div>
                  <div>
                    <strong>Credits:</strong> {selectedUser.credits}
                  </div>
                  <div>
                    <strong>Free Reading:</strong>{' '}
                    {selectedUser.freeReadingUsed ? 'Used' : 'Available'}
                  </div>
                  <div>
                    <strong>Readings:</strong> {selectedUser._count.baziReadings} |{' '}
                    <strong>Comparisons:</strong> {selectedUser._count.baziComparisons}
                  </div>
                </div>

                <h3 className={pageStyles.detailSection}>Adjust Credits</h3>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    className={styles.input}
                    type="number"
                    placeholder="Amount (+/-)"
                    style={{ width: 120 }}
                    value={creditAmount || ''}
                    onChange={(e) => setCreditAmount(parseInt(e.target.value) || 0)}
                  />
                  <input
                    className={styles.input}
                    placeholder="Reason"
                    value={creditReason}
                    onChange={(e) => setCreditReason(e.target.value)}
                  />
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    disabled={adjusting || creditAmount === 0 || !creditReason}
                    onClick={handleAdjustCredits}
                  >
                    {adjusting ? '...' : 'Apply'}
                  </button>
                </div>

                {selectedUser.subscriptions.length > 0 && (
                  <>
                    <h3 className={pageStyles.detailSection}>Subscriptions</h3>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Plan</th>
                          <th>Status</th>
                          <th>Period End</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUser.subscriptions.map((sub) => (
                          <tr key={sub.id}>
                            <td>{sub.planTier}</td>
                            <td>
                              <span
                                className={`${styles.badge} ${
                                  sub.status === 'ACTIVE' ? styles.badgeActive : styles.badgeInactive
                                }`}
                              >
                                {sub.status}
                              </span>
                            </td>
                            <td>{new Date(sub.currentPeriodEnd).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {selectedUser.transactions.length > 0 && (
                  <>
                    <h3 className={pageStyles.detailSection}>Recent Transactions</h3>
                    <table className={styles.table}>
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Amount</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedUser.transactions.map((txn) => (
                          <tr key={txn.id}>
                            <td>{txn.type}</td>
                            <td>
                              {txn.currency} {txn.amount}
                            </td>
                            <td>{new Date(txn.createdAt).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
