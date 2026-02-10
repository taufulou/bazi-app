'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import { listPlans, updatePlan, type AdminPlan } from '../../lib/admin-api';
import styles from '../layout.module.css';

export default function AdminPlansPage() {
  const { getToken } = useAuth();
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setPlans(await listPlans(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (plan: AdminPlan) => {
    try {
      const token = await getToken();
      if (!token) return;
      const updated = await updatePlan(token, plan.id, { isActive: !plan.isActive });
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleEdit = (plan: AdminPlan) => {
    setEditing(plan.id);
    setEditData({
      priceMonthly: plan.priceMonthly,
      priceAnnual: plan.priceAnnual,
      readingsPerMonth: plan.readingsPerMonth,
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      const token = await getToken();
      if (!token) return;
      const updated = await updatePlan(token, editing, editData);
      setPlans((prev) => prev.map((p) => (p.id === editing ? updated : p)));
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  };

  if (loading) return <div className={styles.loading}>Loading plans...</div>;

  return (
    <div>
      <h1 className={styles.pageTitle}>Plans</h1>
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
            <th>Name</th>
            <th>Monthly</th>
            <th>Annual</th>
            <th>Readings/mo</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.id}>
              <td>{plan.slug}</td>
              <td>{plan.nameZhTw}</td>
              <td>
                {editing === plan.id ? (
                  <input
                    className={styles.input}
                    type="number"
                    step="0.01"
                    style={{ width: 100 }}
                    value={editData.priceMonthly as number}
                    onChange={(e) =>
                      setEditData((d) => ({ ...d, priceMonthly: parseFloat(e.target.value) || 0 }))
                    }
                  />
                ) : (
                  `$${plan.priceMonthly}`
                )}
              </td>
              <td>
                {editing === plan.id ? (
                  <input
                    className={styles.input}
                    type="number"
                    step="0.01"
                    style={{ width: 100 }}
                    value={editData.priceAnnual as number}
                    onChange={(e) =>
                      setEditData((d) => ({ ...d, priceAnnual: parseFloat(e.target.value) || 0 }))
                    }
                  />
                ) : (
                  `$${plan.priceAnnual}`
                )}
              </td>
              <td>
                {editing === plan.id ? (
                  <input
                    className={styles.input}
                    type="number"
                    style={{ width: 80 }}
                    value={editData.readingsPerMonth as number}
                    onChange={(e) =>
                      setEditData((d) => ({
                        ...d,
                        readingsPerMonth: parseInt(e.target.value) || 0,
                      }))
                    }
                  />
                ) : (
                  plan.readingsPerMonth === -1 ? 'Unlimited' : plan.readingsPerMonth
                )}
              </td>
              <td>
                <button
                  className={`${styles.toggle} ${plan.isActive ? styles.toggleOn : styles.toggleOff}`}
                  onClick={() => handleToggle(plan)}
                  aria-label={plan.isActive ? 'Deactivate' : 'Activate'}
                />
              </td>
              <td>
                {editing === plan.id ? (
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
                    onClick={() => handleEdit(plan)}
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
