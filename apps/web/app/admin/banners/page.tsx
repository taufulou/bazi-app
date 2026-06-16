'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  listBannerSlides,
  createBannerSlide,
  updateBannerSlide,
  deleteBannerSlide,
  uploadBannerImage,
  type AdminBannerSlide,
} from '../../lib/admin-api';
import {
  BANNER_LINK_OPTIONS,
  BANNER_IMAGE_GUIDANCE,
  type BannerLinkOption,
} from './link-options';
import styles from '../layout.module.css';
import banner from './page.module.css';

interface BannerFormData {
  label: string;
  imageUrlDesktop: string;
  imageUrlMobile: string;
  linkHref: string;
  altText: string;
  displayOrder: number;
  isActive: boolean;
}

const EMPTY_FORM: BannerFormData = {
  label: '',
  imageUrlDesktop: '',
  imageUrlMobile: '',
  linkHref: BANNER_LINK_OPTIONS[0]?.href ?? '/',
  altText: '',
  displayOrder: 0,
  isActive: true,
};

// Group link options by `group` for <optgroup> rendering.
const GROUPED_LINKS: Record<string, BannerLinkOption[]> = BANNER_LINK_OPTIONS.reduce(
  (acc, opt) => {
    (acc[opt.group] ??= []).push(opt);
    return acc;
  },
  {} as Record<string, BannerLinkOption[]>,
);

export default function AdminBannersPage() {
  const { getToken } = useAuth();
  const [slides, setSlides] = useState<AdminBannerSlide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<BannerFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setSlides(await listBannerSlides(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load banners');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const validForm = (d: BannerFormData): string | null => {
    if (!d.imageUrlDesktop) return '請上傳桌面版橫幅圖片';
    if (!d.imageUrlMobile) return '請上傳手機版橫幅圖片';
    if (!d.linkHref || !d.linkHref.startsWith('/')) return '請選擇連結目的地';
    return null;
  };

  const handleCreate = async () => {
    const v = validForm(formData);
    if (v) { setError(v); return; }
    try {
      setSaving(true);
      const token = await getToken();
      if (!token) return;
      await createBannerSlide(token, {
        label: formData.label || undefined,
        imageUrlDesktop: formData.imageUrlDesktop,
        imageUrlMobile: formData.imageUrlMobile,
        linkHref: formData.linkHref,
        altText: formData.altText || undefined,
        displayOrder: slides.length,
        isActive: formData.isActive,
      });
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
    const v = validForm(formData);
    if (v) { setError(v); return; }
    try {
      setSaving(true);
      const token = await getToken();
      if (!token) return;
      await updateBannerSlide(token, id, {
        label: formData.label || undefined,
        imageUrlDesktop: formData.imageUrlDesktop,
        imageUrlMobile: formData.imageUrlMobile,
        linkHref: formData.linkHref,
        altText: formData.altText || undefined,
        isActive: formData.isActive,
      });
      setEditingId(null);
      setFormData(EMPTY_FORM);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (s: AdminBannerSlide) => {
    try {
      const token = await getToken();
      if (!token) return;
      await updateBannerSlide(token, s.id, { isActive: !s.isActive });
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle');
    }
  };

  const handleDelete = async (s: AdminBannerSlide) => {
    if (!confirm(`刪除橫幅「${s.label || s.linkHref}」？此操作無法復原。`)) return;
    try {
      const token = await getToken();
      if (!token) return;
      await deleteBannerSlide(token, s.id);
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  /** Reorder: move slide at `index` up/down, then reindex displayOrder. */
  const handleMove = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= slides.length) return;
    const reordered = [...slides];
    const [moved] = reordered.splice(index, 1);
    if (!moved) return;
    reordered.splice(target, 0, moved);
    try {
      const token = await getToken();
      if (!token) return;
      // Reassign displayOrder = position for any slide whose order changed.
      await Promise.all(
        reordered.map((s, i) =>
          s.displayOrder === i
            ? Promise.resolve()
            : updateBannerSlide(token, s.id, { displayOrder: i }),
        ),
      );
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder');
    }
  };

  const startEdit = (s: AdminBannerSlide) => {
    setEditingId(s.id);
    setShowCreateForm(false);
    setFormData({
      label: s.label ?? '',
      imageUrlDesktop: s.imageUrlDesktop,
      imageUrlMobile: s.imageUrlMobile,
      linkHref: s.linkHref,
      altText: s.altText ?? '',
      displayOrder: s.displayOrder,
      isActive: s.isActive,
    });
  };

  if (loading) return <div className={styles.loading}>Loading banners...</div>;
  if (error && !slides.length && !showCreateForm) {
    return (
      <div className={styles.error}>
        {error}
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={fetchData}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 className={styles.pageTitle}>Dashboard Banners</h1>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => { setShowCreateForm(!showCreateForm); setEditingId(null); setFormData(EMPTY_FORM); setError(''); }}
        >
          {showCreateForm ? 'Cancel' : '+ New Banner'}
        </button>
      </div>

      <p className={banner.help}>
        圖片型橫幅，點擊整張即連結至所選頁面。建議尺寸 —
        桌面 <b>{BANNER_IMAGE_GUIDANCE.desktop.width}×{BANNER_IMAGE_GUIDANCE.desktop.height}</b>（{BANNER_IMAGE_GUIDANCE.desktop.ratio}，&lt;{BANNER_IMAGE_GUIDANCE.desktop.maxKb}KB），
        手機 <b>{BANNER_IMAGE_GUIDANCE.mobile.width}×{BANNER_IMAGE_GUIDANCE.mobile.height}</b>（{BANNER_IMAGE_GUIDANCE.mobile.ratio}，&lt;{BANNER_IMAGE_GUIDANCE.mobile.maxKb}KB）。WebP 或 JPEG。
      </p>

      {error && (
        <div className={styles.error} style={{ marginBottom: 16 }}>
          {error}
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setError('')}>Dismiss</button>
        </div>
      )}

      {showCreateForm && (
        <div className={styles.modal} style={{ marginBottom: 24 }}>
          <h2 className={styles.modalTitle}>Create Banner</h2>
          <BannerForm
            data={formData}
            onChange={setFormData}
            onSubmit={handleCreate}
            onCancel={() => { setShowCreateForm(false); setFormData(EMPTY_FORM); }}
            saving={saving}
            submitLabel="Create"
            getToken={getToken}
            onError={setError}
          />
        </div>
      )}

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Preview</th>
            <th>Label</th>
            <th>Link</th>
            <th>Order</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {slides.map((s, i) =>
            editingId === s.id ? (
              <tr key={s.id}>
                <td colSpan={6} style={{ padding: 16 }}>
                  <BannerForm
                    data={formData}
                    onChange={setFormData}
                    onSubmit={() => handleUpdate(s.id)}
                    onCancel={() => { setEditingId(null); setFormData(EMPTY_FORM); }}
                    saving={saving}
                    submitLabel="Save"
                    isEdit
                    getToken={getToken}
                    onError={setError}
                  />
                </td>
              </tr>
            ) : (
              <tr key={s.id}>
                <td>
                  <div className={banner.thumbRow}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className={banner.thumbDesktop} src={s.imageUrlDesktop} alt={s.altText ?? 'desktop'} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className={banner.thumbMobile} src={s.imageUrlMobile} alt={s.altText ?? 'mobile'} />
                  </div>
                </td>
                <td>{s.label || <span style={{ color: '#777' }}>—</span>}</td>
                <td style={{ fontFamily: 'var(--font-geist-mono), monospace', fontSize: 13 }}>
                  {labelForHref(s.linkHref)}
                </td>
                <td>
                  <div className={banner.orderCell}>
                    <span>{s.displayOrder}</span>
                    <button className={banner.moveBtn} disabled={i === 0} onClick={() => handleMove(i, -1)} aria-label="Move up">▲</button>
                    <button className={banner.moveBtn} disabled={i === slides.length - 1} onClick={() => handleMove(i, 1)} aria-label="Move down">▼</button>
                  </div>
                </td>
                <td>
                  <button
                    className={`${styles.toggle} ${s.isActive ? styles.toggleOn : styles.toggleOff}`}
                    onClick={() => handleToggleActive(s)}
                    aria-label={s.isActive ? 'Deactivate' : 'Activate'}
                  />
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className={`${styles.btn} ${styles.btnSecondary}`} style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => startEdit(s)}>Edit</button>
                    <button className={`${styles.btn} ${styles.btnSecondary}`} style={{ fontSize: 12, padding: '4px 10px', color: '#ff6b6b' }} onClick={() => handleDelete(s)}>Delete</button>
                  </div>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>

      {slides.length === 0 && (
        <div style={{ textAlign: 'center', padding: 40, color: '#a0a0a0' }}>
          尚無橫幅。點擊「+ New Banner」新增第一張。前台目前顯示內建漸層橫幅。
        </div>
      )}
    </div>
  );
}

function labelForHref(href: string): string {
  const opt = BANNER_LINK_OPTIONS.find((o) => o.href === href);
  return opt ? `${opt.label}` : href;
}

// ============================================================
// Banner form (create + edit)
// ============================================================

function BannerForm({
  data,
  onChange,
  onSubmit,
  onCancel,
  saving,
  submitLabel,
  isEdit,
  getToken,
  onError,
}: {
  data: BannerFormData;
  onChange: (d: BannerFormData) => void;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  submitLabel: string;
  isEdit?: boolean;
  getToken: () => Promise<string | null>;
  onError: (msg: string) => void;
}) {
  return (
    <div>
      <div className={banner.cropGrid}>
        <CropUpload
          title="桌面版（Desktop）"
          hint={`${BANNER_IMAGE_GUIDANCE.desktop.width}×${BANNER_IMAGE_GUIDANCE.desktop.height} · ${BANNER_IMAGE_GUIDANCE.desktop.ratio}`}
          rec={BANNER_IMAGE_GUIDANCE.desktop}
          value={data.imageUrlDesktop}
          getToken={getToken}
          onError={onError}
          onUploaded={(url) => onChange({ ...data, imageUrlDesktop: url })}
        />
        <CropUpload
          title="手機版（Mobile）"
          hint={`${BANNER_IMAGE_GUIDANCE.mobile.width}×${BANNER_IMAGE_GUIDANCE.mobile.height} · ${BANNER_IMAGE_GUIDANCE.mobile.ratio}`}
          rec={BANNER_IMAGE_GUIDANCE.mobile}
          value={data.imageUrlMobile}
          getToken={getToken}
          onError={onError}
          onUploaded={(url) => onChange({ ...data, imageUrlMobile: url })}
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>連結目的地</label>
        <select
          className={styles.select}
          value={data.linkHref}
          onChange={(e) => onChange({ ...data, linkHref: e.target.value })}
        >
          {Object.entries(GROUPED_LINKS).map(([group, opts]) => (
            <optgroup key={group} label={group}>
              {opts.map((o) => (
                <option key={o.href} value={o.href}>{o.label}（{o.href}）</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>標籤（僅供後台辨識，不顯示）</label>
        <input
          className={styles.input}
          value={data.label}
          placeholder="例如：2026 新春活動"
          onChange={(e) => onChange({ ...data, label: e.target.value })}
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>圖片替代文字（Alt，無障礙用）</label>
        <input
          className={styles.input}
          value={data.altText}
          placeholder="例如：八字流年運勢限時優惠"
          onChange={(e) => onChange({ ...data, altText: e.target.value })}
        />
      </div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={data.isActive}
            onChange={(e) => onChange({ ...data, isActive: e.target.checked })}
          />
          顯示於前台（Active）
        </label>
      </div>

      <div className={styles.formActions}>
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={onCancel} disabled={saving}>Cancel</button>
        <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={onSubmit} disabled={saving}>
          {saving ? 'Saving...' : submitLabel}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Single-crop upload field (file input + preview + dimension hint)
// ============================================================

function CropUpload({
  title,
  hint,
  rec,
  value,
  getToken,
  onUploaded,
  onError,
}: {
  title: string;
  hint: string;
  rec: { width: number; height: number };
  value: string;
  getToken: () => Promise<string | null>;
  onUploaded: (url: string) => void;
  onError: (msg: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [dimWarn, setDimWarn] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setDimWarn('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      onError('圖片格式須為 PNG / JPEG / WebP');
      return;
    }
    // Client-side dimension hint (non-blocking).
    try {
      const dims = await readImageDimensions(file);
      const recRatio = rec.width / rec.height;
      const gotRatio = dims.w / dims.h;
      if (Math.abs(gotRatio - recRatio) / recRatio > 0.15) {
        setDimWarn(`已上傳 ${dims.w}×${dims.h}，建議比例約 ${rec.width}×${rec.height}（顯示時會裁切）`);
      } else {
        setDimWarn(`已上傳 ${dims.w}×${dims.h}`);
      }
    } catch {
      /* ignore dimension read failure */
    }
    try {
      setUploading(true);
      const token = await getToken();
      if (!token) { onError('未登入'); return; }
      const url = await uploadBannerImage(token, file);
      onUploaded(url);
    } catch (err) {
      onError(err instanceof Error ? err.message : '上傳失敗');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={banner.crop}>
      <div className={banner.cropTitle}>{title}</div>
      <div className={banner.cropHint}>{hint}</div>
      <div className={banner.cropPreview}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt={`${title} preview`} />
        ) : (
          <span className={banner.cropPlaceholder}>無圖片</span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = ''; // allow re-selecting the same file
        }}
      />
      <button
        type="button"
        className={`${styles.btn} ${styles.btnSecondary}`}
        style={{ fontSize: 12, padding: '6px 12px', width: '100%' }}
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? '上傳中…' : value ? '更換圖片' : '上傳圖片'}
      </button>
      {dimWarn && <div className={banner.dimWarn}>{dimWarn}</div>}
    </div>
  );
}

function readImageDimensions(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}
