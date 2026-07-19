import { useAuth } from '@clerk/clerk-expo';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Plus, Star, Pencil, Trash2, ChevronLeft } from 'lucide-react-native';
import { colors, spacing, fontSize, radius, shadows, fonts } from '../theme';
import { useZh } from '../lib/language';
import BirthDataForm from '../components/BirthDataForm';
import {
  fetchBirthProfiles,
  createBirthProfile,
  updateBirthProfile,
  deleteBirthProfile,
  formValuesToPayload,
  profileToFormValues,
  type BirthProfile,
} from '../lib/birth-profiles-api';
import type { BirthDataFormValues, SaveProfileIntent } from '../lib/birth-profile-types';

type Mode = 'list' | 'create' | 'edit';

export default function ProfilesScreen() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const zh = useZh();
  const [mode, setMode] = useState<Mode>('list');
  const [profiles, setProfiles] = useState<BirthProfile[]>([]);
  const [editing, setEditing] = useState<BirthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      setProfiles(await fetchBirthProfiles(token));
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
    // getToken is a fresh ref each render (Clerk); keep `load` stable so the effect
    // below doesn't re-run (and re-fetch) on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isSignedIn) load();
  }, [isSignedIn, load]);

  const handleSave = useCallback(
    async (data: BirthDataFormValues, _pid: string | null, saveIntent?: SaveProfileIntent) => {
      setSaving(true);
      setError('');
      try {
        const token = await getToken();
        if (!token) return;
        const payload = formValuesToPayload(data, saveIntent?.relationshipTag, saveIntent?.lunarBirthDate);
        if (mode === 'edit' && editing) {
          await updateBirthProfile(token, editing.id, payload);
        } else {
          await createBirthProfile(token, payload);
        }
        await load();
        setMode('list');
        setEditing(null);
      } catch {
        setError(zh('儲存失敗，請稍後再試'));
      } finally {
        setSaving(false);
      }
    },
    [getToken, mode, editing, load, zh],
  );

  const handleDelete = useCallback(
    (profile: BirthProfile) => {
      Alert.alert(zh('刪除命盤'), zh(`確定要刪除「${profile.name}」嗎？`), [
        { text: zh('取消'), style: 'cancel' },
        {
          text: zh('刪除'),
          style: 'destructive',
          onPress: async () => {
            const prev = profiles;
            setProfiles((p) => p.filter((x) => x.id !== profile.id));
            try {
              const token = await getToken();
              if (token) await deleteBirthProfile(token, profile.id);
            } catch {
              setProfiles(prev); // revert
            }
          },
        },
      ]);
    },
    [profiles, getToken, zh],
  );

  const handleSetPrimary = useCallback(
    async (profile: BirthProfile) => {
      try {
        const token = await getToken();
        if (!token) return;
        await updateBirthProfile(token, profile.id, { isPrimary: true });
        await load();
      } catch {
        /* non-fatal */
      }
    },
    [getToken, load],
  );

  if (!isLoaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.red} />
      </View>
    );
  }
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  if (mode !== 'list') {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Pressable
          style={styles.backRow}
          onPress={() => {
            setMode('list');
            setEditing(null);
          }}
          accessibilityRole="button"
        >
          <ChevronLeft color={colors.red} size={20} />
          <Text style={styles.backText}>{zh('返回')}</Text>
        </Pressable>
        <BirthDataForm
          key={editing?.id ?? 'create'}
          onSubmit={handleSave}
          isLoading={saving}
          error={error}
          title={mode === 'edit' ? '編輯命盤' : '新增命盤'}
          subtitle="請填寫出生資料"
          submitLabel={mode === 'edit' ? '更新' : '儲存'}
          initialValues={editing ? profileToFormValues(editing) : undefined}
          forceSave
          initialRelationshipTag={editing?.relationshipTag}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{zh('我的命盤')}</Text>

      {loading ? (
        <ActivityIndicator color={colors.red} style={{ marginTop: spacing.xl }} />
      ) : profiles.length === 0 ? (
        <Text style={styles.empty}>{zh('尚未儲存任何命盤')}</Text>
      ) : (
        profiles.map((p) => (
          <View key={p.id} style={styles.card}>
            <View style={styles.cardMain}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardName}>{zh(p.name)}</Text>
                {p.isPrimary ? (
                  <View style={styles.primaryBadge}>
                    <Star color={colors.gold} size={12} fill={colors.gold} />
                    <Text style={styles.primaryText}>{zh('主要')}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.cardMeta}>
                {p.birthDate.substring(0, 10)}
                {p.hourKnown && p.birthTime ? ` ${p.birthTime}` : ` (${zh('時辰未知')})`} · {zh(p.birthCity)}
              </Text>
            </View>
            <View style={styles.cardActions}>
              {!p.isPrimary ? (
                <Pressable onPress={() => handleSetPrimary(p)} hitSlop={8} accessibilityLabel={zh('設為主要')}>
                  <Star color={colors.textMuted} size={20} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  setEditing(p);
                  setMode('edit');
                }}
                hitSlop={8}
                accessibilityLabel={zh('編輯')}
              >
                <Pencil color={colors.textSecondary} size={20} />
              </Pressable>
              <Pressable onPress={() => handleDelete(p)} hitSlop={8} accessibilityLabel={zh('刪除')}>
                <Trash2 color={colors.error} size={20} />
              </Pressable>
            </View>
          </View>
        ))
      )}

      <Pressable style={styles.addBtn} onPress={() => setMode('create')} accessibilityRole="button">
        <Plus color={colors.textOnRed} size={20} />
        <Text style={styles.addText}>{zh('新增命盤')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bgPrimary },
  title: { fontFamily: fonts.serifBold, fontSize: fontSize.title, fontWeight: '700', color: colors.textPrimary },
  empty: { fontSize: fontSize.base, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.warm,
  },
  cardMain: { flex: 1, gap: spacing.xs },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardName: { fontSize: fontSize.lg, fontWeight: '700', color: colors.textPrimary },
  primaryBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  primaryText: { fontSize: fontSize.xs, color: colors.gold, fontWeight: '600' },
  cardMeta: { fontSize: fontSize.sm, color: colors.textSecondary },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.red,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    marginTop: spacing.sm,
  },
  addText: { color: colors.textOnRed, fontSize: fontSize.base, fontWeight: '700' },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start', paddingVertical: spacing.sm },
  backText: { color: colors.red, fontSize: fontSize.base, fontWeight: '600' },
});
