'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { listServices, updateService, type AdminService } from '../../lib/admin-api';
import styles from '../layout.module.css';

export default function AdminServicesPage() {
  const { getToken } = useAuth();
  const [services, setServices] = useState<AdminService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<AdminService>>({});

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setServices(await listServices(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (svc: AdminService) => {
    try {
      const token = await getToken();
      if (!token) return;
      const updated = await updateService(token, svc.id, { isActive: !svc.isActive });
      setServices((prev) => prev.map((s) => (s.id === svc.id ? updated : s)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleEdit = (svc: AdminService) => {
    setEditing(svc.id);
    setEditData({ nameZhTw: svc.nameZhTw, creditCost: svc.creditCost, sortOrder: svc.sortOrder });
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      const token = await getToken();
      if (!token) return;
      const updated = await updateService(token, editing, editData);
      setServices((prev) => prev.map((s) => (s.id === editing ? updated : s)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  if (loading) return <div className={styles.loading}>Loading services...</div>;

  return (
    <div>
      <h1 className={styles.pageTitle}>Services</h1>
      {error && (
        <div className={styles.error}>
          {error}
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Slug</th>
            <th>Name (zh-TW)</th>
            <th>Credits</th>
            <th>Sort</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {services.map((svc) => (
            <tr key={svc.id}>
              <td>{svc.slug}</td>
              <td>
                {editing === svc.id ? (
                  <input
                    className={styles.input}
                    value={editData.nameZhTw ?? ''}
                    onChange={(e) => setEditData((d) => ({ ...d, nameZhTw: e.target.value }))}
                  />
                ) : (
                  svc.nameZhTw
                )}
              </td>
              <td>
                {editing === svc.id ? (
                  <input
                    className={styles.input}
                    type="number"
                    style={{ width: 80 }}
                    value={editData.creditCost ?? 0}
                    onChange={(e) =>
                      setEditData((d) => ({ ...d, creditCost: parseInt(e.target.value) || 0 }))
                    }
                  />
                ) : (
                  svc.creditCost
                )}
              </td>
              <td>
                {editing === svc.id ? (
                  <input
                    className={styles.input}
                    type="number"
                    style={{ width: 60 }}
                    value={editData.sortOrder ?? 0}
                    onChange={(e) =>
                      setEditData((d) => ({ ...d, sortOrder: parseInt(e.target.value) || 0 }))
                    }
                  />
                ) : (
                  svc.sortOrder
                )}
              </td>
              <td>
                <button
                  className={`${styles.toggle} ${svc.isActive ? styles.toggleOn : styles.toggleOff}`}
                  onClick={() => handleToggle(svc)}
                  aria-label={svc.isActive ? 'Deactivate' : 'Activate'}
                />
              </td>
              <td>
                {editing === svc.id ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleSave}>
                      Save
                    </button>
                    <button
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    onClick={() => handleEdit(svc)}
                  >
                    Edit
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
