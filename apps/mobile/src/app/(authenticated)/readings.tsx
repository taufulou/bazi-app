import { useAuth } from '@clerk/clerk-expo';
import { useCallback, useEffect, useState } from 'react';
import { Text, Pressable, ScrollView, StyleSheet } from 'react-native';
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

/** 解讀 — free-preview 排盤 (chart only). Paid AI readings come in M3. */
export default function ReadingsScreen() {
  const { getToken, isSignedIn } = useAuth();
  const zh = useZh();
  const [chart, setChart] = useState<BaziChartData | null>(null);
  const [gender, setGender] = useState('male');
  const [chartMeta, setChartMeta] = useState<{ name: string; birthDate: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<BirthProfile[]>([]);
  const [isSubscriber, setIsSubscriber] = useState(false);
  // Id of the profile created via this preview session — reused so re-submitting
  // after 重新排盤 updates it instead of creating duplicates.
  const [previewSavedId, setPreviewSavedId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const [profiles, profile] = await Promise.all([
          fetchBirthProfiles(token),
          getUserProfile(token),
        ]);
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
  }, [isSignedIn, getToken]);

  const handleSubmit = useCallback(
    async (data: BirthDataFormValues, _profileId: string | null, saveIntent?: SaveProfileIntent) => {
      setLoading(true);
      setError('');
      // 1. Compute + render the chart FIRST — this is the free preview and must
      //    not be blocked by an optional profile save.
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
      // 2. Optionally persist the profile (signed-in + opted-in) — NON-FATAL. A
      //    save failure never hides the chart the user already sees.
      if (isSignedIn && saveIntent?.wantsSave) {
        try {
          const token = await getToken();
          if (token) {
            const payload = formValuesToPayload(data, saveIntent.relationshipTag, saveIntent.lunarBirthDate);
            // Reuse the id from a selected profile OR one we created earlier this
            // session → re-排盤 updates instead of creating duplicates.
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
