'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  listPromptTemplates,
  updatePromptTemplate,
  type AdminPromptTemplate,
} from '../../lib/admin-api';
import styles from '../layout.module.css';
import pageStyles from './page.module.css';

const TEMPLATE_VARS = [
  '{{dayMaster}}',
  '{{fourPillars}}',
  '{{fiveElements}}',
  '{{tenGods}}',
  '{{luckPeriods}}',
  '{{shenSha}}',
  '{{gender}}',
  '{{targetYear}}',
];

export default function AdminPromptsPage() {
  const { getToken } = useAuth();
  const [templates, setTemplates] = useState<AdminPromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AdminPromptTemplate | null>(null);
  const [editData, setEditData] = useState({
    systemPrompt: '',
    userPromptTemplate: '',
    outputFormatInstructions: '',
  });
  const [saving, setSaving] = useState(false);
  const [filterType, setFilterType] = useState('');
  const [filterProvider, setFilterProvider] = useState('');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const token = await getToken();
      if (!token) return;
      setTemplates(await listPromptTemplates(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSelect = (t: AdminPromptTemplate) => {
    setSelected(t);
    setEditData({
      systemPrompt: t.systemPrompt,
      userPromptTemplate: t.userPromptTemplate,
      outputFormatInstructions: t.outputFormatInstructions,
    });
  };

  const handleSave = async () => {
    if (!selected) return;
    try {
      setSaving(true);
      const token = await getToken();
      if (!token) return;
      const updated = await updatePromptTemplate(token, selected.id, editData);
      setTemplates((prev) => prev.map((t) => (t.id === selected.id ? updated : t)));
      setSelected(updated);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (t: AdminPromptTemplate) => {
    try {
      const token = await getToken();
      if (!token) return;
      const updated = await updatePromptTemplate(token, t.id, { isActive: !t.isActive });
      setTemplates((prev) => prev.map((x) => (x.id === t.id ? updated : x)));
      if (selected?.id === t.id) setSelected(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const readingTypes = [...new Set(templates.map((t) => t.readingType))];
  const providers = [...new Set(templates.map((t) => t.aiProvider))];

  const filtered = templates.filter(
    (t) =>
      (!filterType || t.readingType === filterType) &&
      (!filterProvider || t.aiProvider === filterProvider),
  );

  if (loading) return <div className={styles.loading}>Loading prompt templates...</div>;

  return (
    <div>
      <h1 className={styles.pageTitle}>Prompt Templates</h1>
      {error && (
        <div className={styles.error} style={{ marginBottom: 16 }}>
          {error}
          <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={() => setError('')}>
            Dismiss
          </button>
        </div>
      )}

      <div className={pageStyles.filters}>
        <select
          className={styles.select}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          style={{ width: 200 }}
        >
          <option value="">All Reading Types</option>
          {readingTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          className={styles.select}
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
          style={{ width: 160 }}
        >
          <option value="">All Providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      <div className={pageStyles.promptLayout}>
        <div className={pageStyles.promptList}>
          {filtered.map((t) => (
            <div
              key={t.id}
              className={`${pageStyles.promptItem} ${selected?.id === t.id ? pageStyles.promptItemActive : ''}`}
              onClick={() => handleSelect(t)}
            >
              <div className={pageStyles.promptItemHeader}>
                <span className={pageStyles.promptType}>{t.readingType}</span>
                <span
                  className={`${styles.badge} ${t.isActive ? styles.badgeActive : styles.badgeInactive}`}
                >
                  {t.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className={pageStyles.promptItemMeta}>
                {t.aiProvider} &middot; v{t.version}
              </div>
            </div>
          ))}
        </div>

        <div className={pageStyles.promptEditor}>
          {selected ? (
            <>
              <div className={pageStyles.editorHeader}>
                <h2 className={pageStyles.editorTitle}>
                  {selected.readingType} / {selected.aiProvider} v{selected.version}
                </h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button
                    className={`${styles.toggle} ${selected.isActive ? styles.toggleOn : styles.toggleOff}`}
                    onClick={() => handleToggle(selected)}
                    aria-label={selected.isActive ? 'Deactivate' : 'Activate'}
                  />
                  <button
                    className={`${styles.btn} ${styles.btnPrimary}`}
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>

              <div className={pageStyles.templateVars}>
                <span className={pageStyles.varsLabel}>Variables:</span>
                {TEMPLATE_VARS.map((v) => (
                  <code key={v} className={pageStyles.varTag}>
                    {v}
                  </code>
                ))}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>System Prompt</label>
                <textarea
                  className={styles.textarea}
                  style={{ minHeight: 200 }}
                  value={editData.systemPrompt}
                  onChange={(e) =>
                    setEditData((d) => ({ ...d, systemPrompt: e.target.value }))
                  }
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>User Prompt Template</label>
                <textarea
                  className={styles.textarea}
                  style={{ minHeight: 150 }}
                  value={editData.userPromptTemplate}
                  onChange={(e) =>
                    setEditData((d) => ({ ...d, userPromptTemplate: e.target.value }))
                  }
                />
              </div>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Output Format Instructions</label>
                <textarea
                  className={styles.textarea}
                  style={{ minHeight: 100 }}
                  value={editData.outputFormatInstructions}
                  onChange={(e) =>
                    setEditData((d) => ({
                      ...d,
                      outputFormatInstructions: e.target.value,
                    }))
                  }
                />
              </div>
            </>
          ) : (
            <div className={pageStyles.editorPlaceholder}>
              Select a template to edit
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
