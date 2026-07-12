import { useAuth } from '@clerk/clerk-expo';
import { useCallback, useEffect, useState } from 'react';
import { Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { colors, spacing, fontSize, radius } from '../../theme';
import { useZh } from '../../lib/language';
import BirthDataForm from '../../components/BirthDataForm';
import BaziChart from '../../components/BaziChart';
import { calculateBazi } from '../../lib/bazi-api';
import type { BaziChartData } from '../../lib/bazi-types';
import { ApiError, getUserProfile } from '../../lib/api';
import {
  fetchBirthProfiles,
  createBirthProfile,
  updateBirthProfile,
  formValuesToPayload,
  type BirthProfile,
} from '../../lib/birth-profiles-api';
import type { BirthDataFormValues, SaveProfileIntent } from '../../lib/birth-profile-types';

/**
 * 免費排盤 — chart-only free preview (no AI). Reached from the 解讀 hub.
 * Ported verbatim from the M1 readings-tab flow (which became the hub in M3.2).
 */
export default function PaipanScreen() {
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const zh = useZh();
  const [chart, setChart] = useState<BaziChartData | null>(null);
  const [gender, setGender] = useState('male');
  const [chartMeta, setChartMeta] = useState<{ name: string; birthDate: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<BirthProfile[]>([]);
  const [isSubscriber, setIsSubscriber] = useState(false);
  const [previewSavedId, setPreviewSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const [profiles, profile] = await Promise.all([fetchBirthProfiles(token), getUserProfile(token)]);
        if (cancelled) return;
        setSavedProfiles(profiles);
        setIsSubscriber(profile.subscriptionTier !== 'FREE');
      } catch {
        /* non-fatal — the free preview still works */
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken omitted (unstable Clerk ref → fetch loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const handleSubmit = useCallback(
    async (data: BirthDataFormValues, _profileId: string | null, saveIntent?: SaveProfileIntent) => {
      setLoading(true);
      setError('');
      // 1. Compute + render the chart FIRST — the free preview must not be blocked
      //    by an optional profile save.
      try {
        const result = await calculateBazi({
          birth_date: data.birthDate,
          birth_time: data.hourKnown ? data.birthTime : null,
          hour_known: data.hourKnown,
          birth_city: data.birthCity,
          birth_timezone: data.birthTimezone,
          gender: data.gender,
        });
        setGender(data.gender);
        setChartMeta({ name: data.name, birthDate: data.birthDate });
        setChart(result);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : zh('排盤失敗，請稍後再試'));
        setLoading(false);
        return;
      }
      // 2. Optionally persist the profile — NON-FATAL.
      if (isSignedIn && saveIntent?.wantsSave) {
        try {
          const token = await getToken();
          if (token) {
            const payload = formValuesToPayload(data, saveIntent.relationshipTag, saveIntent.lunarBirthDate);
            const targetId = saveIntent.existingProfileId ?? previewSavedId;
            if (targetId) {
              await updateBirthProfile(token, targetId, payload);
            } else {
              const created = await createBirthProfile(token, payload);
              setPreviewSavedId(created.id);
            }
            setSavedProfiles(await fetchBirthProfiles(token));
          }
        } catch {
          /* non-fatal — the chart is already shown; saving is best-effort */
        }
      }
      setLoading(false);
    },
    [isSignedIn, getToken, zh, previewSavedId],
  );

  if (isLoaded && !isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {chart ? (
        <>
          <Pressable style={styles.backRow} onPress={() => setChart(null)} accessibilityRole="button">
            <ChevronLeft color={colors.red} size={20} />
            <Text style={styles.backText}>{zh('重新排盤')}</Text>
          </Pressable>
          <BaziChart
            data={chart}
            name={chartMeta?.name}
            birthDate={chartMeta?.birthDate}
            gender={gender}
            isSubscriber={isSubscriber}
          />
        </>
      ) : (
        <BirthDataForm
          onSubmit={handleSubmit}
          isLoading={loading}
          error={error}
          title="八字排盤"
          subtitle="輸入出生資料，免費查看您的命盤"
          submitLabel="開始排盤"
          savedProfiles={isSignedIn ? savedProfiles : undefined}
          showSaveOption={isSignedIn}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgPrimary },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl * 2 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  backText: { color: colors.red, fontSize: fontSize.base, fontWeight: '600' },
});
