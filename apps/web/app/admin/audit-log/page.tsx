'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { getAuditLog, type AuditLogEntry, type PaginatedResponse } from '../../lib/admin-api';
import styles from '../layout.module.css';
import pageStyles from './page.module.css';

export default function AdminAuditLogPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<PaginatedResponse<AuditLogEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setData(await getAuditLog(token, { page }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && !data) return <div className={styles.loading}>Loading audit log...</div>;

  return (
    <div>
      <h1 className={styles.pageTitle}>Audit Log</h1>
      {error && (
        <div className={styles.error} style={{ marginBottom: 16 }}>
          {error}
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Admin</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {data?.data.map((entry) => (
            <>
              <tr key={entry.id}>
                <td>{new Date(entry.createdAt).toLocaleString()}</td>
                <td style={{ fontWeight: 500 }}>{entry.action}</td>
                <td>
                  {entry.entityType}
                  <span style={{ color: '#a0a0a0', fontSize: 12, marginLeft: 4 }}>
                    {entry.entityId.slice(0, 8)}...
                  </span>
                </td>
                <td style={{ fontSize: 12, fontFamily: 'monospace' }}>
                  {entry.adminUserId.slice(0, 12)}...
                </td>
                <td>
                  <button
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    style={{ padding: '4px 10px', fontSize: 12 }}
                    onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  >
                    {expanded === entry.id ? 'Hide' : 'Show'}
                  </button>
                </td>
              </tr>
              {expanded === entry.id && (
                <tr key={`${entry.id}-detail`}>
                  <td colSpan={5}>
                    <div className={pageStyles.diffView}>
                      <div className={pageStyles.diffCol}>
                        <div className={pageStyles.diffLabel}>Old Value</div>
                        <pre className={pageStyles.diffPre}>
                          {entry.oldValue ? JSON.stringify(entry.oldValue, null, 2) : 'null'}
                        </pre>
                      </div>
                      <div className={pageStyles.diffCol}>
                        <div className={pageStyles.diffLabel}>New Value</div>
                        <pre className={pageStyles.diffPre}>
                          {entry.newValue ? JSON.stringify(entry.newValue, null, 2) : 'null'}
                        </pre>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>
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
  );
}
