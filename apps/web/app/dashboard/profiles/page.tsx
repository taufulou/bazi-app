"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import type { BirthProfile } from "../../lib/birth-profiles-api";
import {
  fetchBirthProfiles,
  createBirthProfile,
  updateBirthProfile,
  deleteBirthProfile,
  formValuesToPayload,
  profileToFormValues,
} from "../../lib/birth-profiles-api";
import type { BirthDataFormValues } from "../../components/BirthDataForm";
import BirthDataForm from "../../components/BirthDataForm";
import ProfileCard from "../../components/ProfileCard";
import styles from "./page.module.css";

type Mode = "list" | "create" | "edit";

export default function ProfileManagerPage() {
  const { getToken, isLoaded } = useAuth();

  const [profiles, setProfiles] = useState<BirthProfile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<Mode>("list");
  const [editingProfile, setEditingProfile] = useState<BirthProfile | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const clearNotifications = () => {
    setError(null);
    setSuccess(null);
  };

  const loadProfiles = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const data = await fetchBirthProfiles(token);
      setProfiles(data);
    } catch {
      // Backend unavailable or no profiles — show empty state silently
      setProfiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (isLoaded) {
      loadProfiles();
    }
  }, [isLoaded, loadProfiles]);

  // Auto-dismiss success messages
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [success]);

  const handleCreate = async (data: BirthDataFormValues, _profileId: string | null) => {
    clearNotifications();
    setIsSaving(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("未登入");
      await createBirthProfile(token, formValuesToPayload(data));
      setSuccess("已成功新增出生資料");
      setMode("list");
      await loadProfiles();
    } catch {
      setError("新增失敗，請稍後再試");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdate = async (data: BirthDataFormValues, _profileId: string | null) => {
    if (!editingProfile) return;
    clearNotifications();
    setIsSaving(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("未登入");
      await updateBirthProfile(token, editingProfile.id, formValuesToPayload(data));
      setSuccess("已成功更新出生資料");
      setMode("list");
      setEditingProfile(null);
      await loadProfiles();
    } catch {
      setError("更新失敗，請稍後再試");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (profile: BirthProfile) => {
    clearNotifications();
    // Optimistic removal
    const prevProfiles = profiles;
    setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
    try {
      const token = await getToken();
      if (!token) throw new Error("未登入");
      await deleteBirthProfile(token, profile.id);
      setSuccess(`已刪除「${profile.name}」`);
    } catch {
      // Revert on failure
      setProfiles(prevProfiles);
      setError("刪除失敗，請稍後再試");
    }
  };

  const handleSetPrimary = async (profile: BirthProfile) => {
    clearNotifications();
    try {
      const token = await getToken();
      if (!token) throw new Error("未登入");
      await updateBirthProfile(token, profile.id, { isPrimary: true });
      await loadProfiles();
      setSuccess(`已將「${profile.name}」設為主要資料`);
    } catch {
      setError("設定主要資料失敗，請稍後再試");
    }
  };

  const handleEdit = (profile: BirthProfile) => {
    clearNotifications();
    setEditingProfile(profile);
    setMode("edit");
  };

  const handleCancel = () => {
    clearNotifications();
    setMode("list");
    setEditingProfile(null);
  };

  // Loading
  if (!isLoaded || isLoading) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <Link href="/dashboard" className={styles.backLink}>
            &larr; 返回控制台
          </Link>
          <span className={styles.headerTitle}>出生資料管理</span>
        </header>
        <div className={styles.loadingState}>
          <div className={styles.spinner} />
          <p className={styles.loadingText}>載入中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <header className={styles.header}>
        <Link href="/dashboard" className={styles.backLink}>
          &larr; 返回控制台
        </Link>
        <span className={styles.headerTitle}>出生資料管理</span>
      </header>

      {/* Title Section */}
      <div className={styles.titleSection}>
        <h1 className={styles.pageTitle}>出生資料管理</h1>
        <p className={styles.pageSubtitle}>
          管理您的出生資料，快速開始各項命理分析
        </p>
      </div>

      {/* Notifications */}
      {error && <div className={styles.notificationError}>{error}</div>}
      {success && <div className={styles.notificationSuccess}>{success}</div>}

      {/* Inline Create/Edit Form */}
      {mode === "create" && (
        <div className={styles.formSection}>
          <div className={styles.formHeader}>
            <span className={styles.formTitle}>新增出生資料</span>
            <button className={styles.cancelBtn} onClick={handleCancel}>
              取消
            </button>
          </div>
          <BirthDataForm
            title=""
            subtitle=""
            submitLabel="儲存"
            onSubmit={handleCreate}
            isLoading={isSaving}
          />
        </div>
      )}

      {mode === "edit" && editingProfile && (
        <div className={styles.formSection}>
          <div className={styles.formHeader}>
            <span className={styles.formTitle}>
              編輯「{editingProfile.name}」
            </span>
            <button className={styles.cancelBtn} onClick={handleCancel}>
              取消
            </button>
          </div>
          <BirthDataForm
            key={editingProfile.id}
            title=""
            subtitle=""
            submitLabel="更新"
            initialValues={profileToFormValues(editingProfile)}
            onSubmit={handleUpdate}
            isLoading={isSaving}
          />
        </div>
      )}

      {/* Actions Bar (only in list mode) */}
      {mode === "list" && profiles.length > 0 && (
        <div className={styles.actionsBar}>
          <button
            className={styles.createBtn}
            onClick={() => {
              clearNotifications();
              setMode("create");
            }}
          >
            + 新增出生資料
          </button>
        </div>
      )}

      {/* Profile Grid */}
      {profiles.length > 0 ? (
        <div className={styles.profileGrid}>
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              onEdit={() => handleEdit(profile)}
              onDelete={() => handleDelete(profile)}
              onSetPrimary={() => handleSetPrimary(profile)}
            />
          ))}
        </div>
      ) : (
        !isLoading &&
        mode === "list" && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📋</div>
            <h3 className={styles.emptyTitle}>尚未儲存任何出生資料</h3>
            <p className={styles.emptyText}>
              新增出生資料後，您可以快速選擇開始各項命理分析
            </p>
            <button
              className={styles.emptyBtn}
              onClick={() => {
                clearNotifications();
                setMode("create");
              }}
            >
              + 新增出生資料
            </button>
          </div>
        )
      )}
    </div>
  );
}
