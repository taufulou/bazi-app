'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  listCreditPackages,
  createCreditPackage,
  updateCreditPackage,
  type AdminCreditPackage,
} from '../../lib/admin-api';
import styles from '../layout.module.css';

interface PackageFormData {
  slug: string;
  nameZhTw: string;
  nameZhCn: string;
  creditAmount: number;
  priceUsd: number;
  isActive: boolean;
  sortOrder: number;
}

const EMPTY_FORM: PackageFormData = {
  slug: '',
  nameZhTw: '',
  nameZhCn: '',
  creditAmount: 0,
  priceUsd: 0,
  isActive: true,
  sortOrder: 0,
};

export default function AdminCreditPackagesPage() {
  const { getToken } = useAuth();
  const [packages, setPackages] = useState<AdminCreditPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<PackageFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setPackages(await listCreditPackages(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCreate = async () => {
    try {
      setSaving(true);
      const token = await getToken();
      if (!token) return;
      await createCreditPackage(token, formData);
      setShowCreateForm(false);
      setFormData(EMPTY_FORM);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (id: string) => {
    try {
      setSaving(true);
      const token = await getToken();
      if (!token) return;
      await updateCreditPackage(token, id, formData);
      setEditingId(null);
      setFormData(EMPTY_FORM);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (pkg: AdminCreditPackage) => {
    try {
      const token = await getToken();
      if (!token) return;
      await updateCreditPackage(token, pkg.id, { isActive: !pkg.isActive });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle');
    }
  };

  const startEdit = (pkg: AdminCreditPackage) => {
    setEditingId(pkg.id);
    setShowCreateForm(false);
    setFormData({
      slug: pkg.slug,
      nameZhTw: pkg.nameZhTw,
      nameZhCn: pkg.nameZhCn,
      creditAmount: pkg.creditAmount,
      priceUsd: pkg.priceUsd,
      isActive: pkg.isActive,
      sortOrder: pkg.sortOrder,
    });
  };

  if (loading) return <div className={styles.loading}>Loading credit packages...</div>;
  if (error && !packages.length) {
    return (
      <div className={styles.error}>
        {error}
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchData}>Retry</button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 className={styles.pageTitle}>Credit Packages</h1>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => { setShowCreateForm(!showCreateForm); setEditingId(null); setFormData(EMPTY_FORM); }}
        >
          {showCreateForm ? 'Cancel' : '+ New Package'}
        </button>
      </div>

      {error && (
        <div className={styles.error} style={{ marginBottom: 16 }}>
          {error}
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className={styles.modal} style={{ marginBottom: 24 }}>
          <h2 className={styles.modalTitle}>Create Credit Package</h2>
          <PackageForm
            data={formData}
            onChange={setFormData}
            onSubmit={handleCreate}
            onCancel={() => { setShowCreateForm(false); setFormData(EMPTY_FORM); }}
            saving={saving}
            submitLabel="Create"
          />
        </div>
      )}

      {/* Table */}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Slug</th>
            <th>Name (ZH-TW)</th>
            <th>Credits</th>
            <th>Price (USD)</th>
            <th>Per Credit</th>
            <th>Sort</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {packages.map((pkg) => (
            editingId === pkg.id ? (
              <tr key={pkg.id}>
                <td colSpan={8} style={{ padding: 16 }}>
                  <PackageForm
                    data={formData}
                    onChange={setFormData}
                    onSubmit={() => handleUpdate(pkg.id)}
                    onCancel={() => { setEditingId(null); setFormData(EMPTY_FORM); }}
                    saving={saving}
                    submitLabel="Save"
                    isEdit
                  />
                </td>
              </tr>
            ) : (
              <tr key={pkg.id}>
                <td style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 13 }}>{pkg.slug}</td>
                <td>{pkg.nameZhTw}</td>
                <td style={{ fontWeight: 600 }}>{pkg.creditAmount}</td>
                <td>${Number(pkg.priceUsd).toFixed(2)}</td>
                <td style={{ color: '#a0a0a0' }}>
                  ${(Number(pkg.priceUsd) / pkg.creditAmount).toFixed(2)}
                </td>
                <td>{pkg.sortOrder}</td>
                <td>
                  <button
                    className={`${styles.toggle} ${pkg.isActive ? styles.toggleOn : styles.toggleOff}`}
                    onClick={() => handleToggleActive(pkg)}
                    aria-label={pkg.isActive ? 'Deactivate' : 'Activate'}
                  />
                </td>
                <td>
                  <button
                    className={`${styles.btn} ${styles.btnSecondary}`}
                    style={{ fontSize: 12, padding: '4px 10px' }}
                    onClick={() => startEdit(pkg)}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            )
          ))}
        </tbody>
      </table>

      {packages.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#a0a0a0' }}>
          No credit packages yet. Click &quot;+ New Package&quot; to create one.
        </div>
      )}
    </div>
  );
}

// ============ Inline Form Component ============

function PackageForm({
  data,
  onChange,
  onSubmit,
  onCancel,
  saving,
  submitLabel,
  isEdit,
}: {
  data: PackageFormData;
  onChange: (d: PackageFormData) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  submitLabel: string;
  isEdit?: boolean;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Slug</label>
        <input
          className={styles.input}
          value={data.slug}
          onChange={(e) => onChange({ ...data, slug: e.target.value })}
          placeholder="e.g., starter-5"
          disabled={isEdit}
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Name (ZH-TW)</label>
        <input
          className={styles.input}
          value={data.nameZhTw}
          onChange={(e) => onChange({ ...data, nameZhTw: e.target.value })}
          placeholder="e.g., 入門包"
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Name (ZH-CN)</label>
        <input
          className={styles.input}
          value={data.nameZhCn}
          onChange={(e) => onChange({ ...data, nameZhCn: e.target.value })}
          placeholder="e.g., 入门包"
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Credit Amount</label>
        <input
          className={styles.input}
          type="number"
          min="1"
          value={data.creditAmount}
          onChange={(e) => onChange({ ...data, creditAmount: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Price (USD)</label>
        <input
          className={styles.input}
          type="number"
          min="0"
          step="0.01"
          value={data.priceUsd}
          onChange={(e) => onChange({ ...data, priceUsd: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Sort Order</label>
        <input
          className={styles.input}
          type="number"
          min="0"
          value={data.sortOrder}
          onChange={(e) => onChange({ ...data, sortOrder: parseInt(e.target.value) || 0 })}
        />
      </div>
      <div className={styles.formActions} style={{ gridColumn: '1 / -1' }}>
        <button
          className={`${styles.btn} ${styles.btnSecondary}`}
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={onSubmit}
          disabled={saving || !data.slug || !data.nameZhTw || !data.nameZhCn || data.creditAmount <= 0 || data.priceUsd <= 0}
        >
          {saving ? 'Saving...' : submitLabel}
        </button>
      </div>
    </div>
  );
}
