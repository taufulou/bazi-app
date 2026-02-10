'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  listPromoCodes,
  createPromoCode,
  updatePromoCode,
  type AdminPromoCode,
} from '../../lib/admin-api';
import styles from '../layout.module.css';

export default function AdminPromosPage() {
  const { getToken } = useAuth();
  const [promos, setPromos] = useState<AdminPromoCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    code: '',
    discountType: 'PERCENTAGE' as string,
    discountValue: 10,
    maxUses: 100,
    validFrom: new Date().toISOString().slice(0, 10),
    validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setPromos(await listPromoCodes(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggle = async (promo: AdminPromoCode) => {
    try {
      const token = await getToken();
      if (!token) return;
      const updated = await updatePromoCode(token, promo.id, { isActive: !promo.isActive });
      setPromos((prev) => prev.map((p) => (p.id === promo.id ? updated : p)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setCreating(true);
      const token = await getToken();
      if (!token) return;
      const newPromo = await createPromoCode(token, {
        ...form,
        validFrom: new Date(form.validFrom).toISOString(),
        validUntil: new Date(form.validUntil).toISOString(),
      });
      setPromos((prev) => [newPromo, ...prev]);
      setShowCreate(false);
      setForm({
        code: '',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxUses: 100,
        validFrom: new Date().toISOString().slice(0, 10),
        validUntil: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className={styles.loading}>Loading promo codes...</div>;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className={styles.pageTitle} style={{ margin: 0 }}>Promo Codes</h1>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => setShowCreate(true)}>
          Create Promo
        </button>
      </div>

      {error && (
        <div className={styles.error}>
          {error}
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      {showCreate && (
        <div className={styles.modalOverlay} onClick={() => setShowCreate(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={styles.modalTitle}>Create Promo Code</h2>
            <form onSubmit={handleCreate}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Code</label>
                <input
                  className={styles.input}
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                  required
                  placeholder="e.g. SUMMER2026"
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Discount Type</label>
                <select
                  className={styles.select}
                  value={form.discountType}
                  onChange={(e) => setForm((f) => ({ ...f, discountType: e.target.value }))}
                >
                  <option value="PERCENTAGE">Percentage</option>
                  <option value="FIXED_AMOUNT">Fixed Amount</option>
                </select>
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>
                  Discount Value {form.discountType === 'PERCENTAGE' ? '(%)' : '(USD)'}
                </label>
                <input
                  className={styles.input}
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.discountValue}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, discountValue: parseFloat(e.target.value) || 0 }))
                  }
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Max Uses</label>
                <input
                  className={styles.input}
                  type="number"
                  min="1"
                  value={form.maxUses}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, maxUses: parseInt(e.target.value) || 1 }))
                  }
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Valid From</label>
                  <input
                    className={styles.input}
                    type="date"
                    value={form.validFrom}
                    onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Valid Until</label>
                  <input
                    className={styles.input}
                    type="date"
                    value={form.validUntil}
                    onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
                  />
                </div>
              </div>
              <div className={styles.formActions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={`${styles.btn} ${styles.btnPrimary}`}
                  disabled={creating || !form.code}
                >
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Code</th>
            <th>Discount</th>
            <th>Uses</th>
            <th>Valid From</th>
            <th>Valid Until</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          {promos.map((promo) => (
            <tr key={promo.id}>
              <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{promo.code}</td>
              <td>
                {promo.discountType === 'PERCENTAGE'
                  ? `${promo.discountValue}%`
                  : `$${promo.discountValue}`}
              </td>
              <td>
                {promo.currentUses} / {promo.maxUses}
              </td>
              <td>{new Date(promo.validFrom).toLocaleDateString()}</td>
              <td>{new Date(promo.validUntil).toLocaleDateString()}</td>
              <td>
                <button
                  className={`${styles.toggle} ${promo.isActive ? styles.toggleOn : styles.toggleOff}`}
                  onClick={() => handleToggle(promo)}
                  aria-label={promo.isActive ? 'Deactivate' : 'Activate'}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
