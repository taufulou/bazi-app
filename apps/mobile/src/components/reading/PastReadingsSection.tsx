import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '@clerk/clerk-expo';
import { READING_TYPE_META } from '@repo/shared';
import { colors, spacing, fontSize, radius, fonts } from '../../theme';
import { useZh } from '../../lib/language';
import { getReadingHistoryByType, type ReadingHistoryItem } from '../../lib/readings-api';

/**
 * Collapsible "你的{type}記錄" list above the birth-data form, mirroring web
 * PastReadingsSection.tsx. Hidden entirely when the user has zero past readings
 * of this type. Tapping a row calls onOpen(id) so the parent re-hydrates the
 * reading in place (via GET /readings/:id) — no navigation stacking.
 */
type Status = 'loading' | 'success' | 'error';
const PAGE_SIZE = 50;

function fmtDate(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function PastReadingsSection({
  readingType,
  onOpen,
}: {
  readingType: string;
  onOpen: (id: string) => void;
}) {
  const zh = useZh();
  const { getToken, isSignedIn } = useAuth();
  const [status, setStatus] = useState<Status>('loading');
  const [readings, setReadings] = useState<ReadingHistoryItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [tick, setTick] = useState(0);

  const meta = READING_TYPE_META[readingType as keyof typeof READING_TYPE_META];
  const typeLabel = meta?.nameZhTw ?? readingType;

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    (async () => {
      setStatus('loading');
      try {
        const token = await getToken();
        if (!token || cancelled) return;
        const result = await getReadingHistoryByType(token, readingType, 1, PAGE_SIZE);
        if (cancelled) return;
        setReadings(result.data);
        setTotalCount(result.meta.total);
        setStatus('success');
      } catch {
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // getToken omitted (unstable Clerk ref → fetch loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, readingType, tick]);

  const handleLoadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const token = await getToken();
      if (!token) return;
      const nextPage = Math.floor(readings.length / PAGE_SIZE) + 1;
      const result = await getReadingHistoryByType(token, readingType, nextPage, PAGE_SIZE);
      const seen = new Set(readings.map((r) => r.id));
      const additions = result.data.filter((r) => !seen.has(r.id));
      setReadings((prev) => [...prev, ...additions]);
      setTotalCount(result.meta.total);
    } catch {
      /* leave state; user can retry */
    } finally {
      setLoadingMore(false);
    }
  };

  // Hidden when not signed in or genuinely empty (matches web).
  if (!isSignedIn) return null;
  if (status === 'success' && totalCount === 0) return null;

  return (
    <View style={styles.section}>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
        <Text style={styles.title}>
          {zh('你的')}{zh(typeLabel)}{zh('記錄')}
          {status === 'success' && totalCount > 0 ? (
            <Text style={styles.count}> · {zh('共')}{totalCount}{zh('筆')}</Text>
          ) : null}
        </Text>
        {status === 'error' ? (
          <Pressable onPress={() => setTick((t) => t + 1)} hitSlop={8} accessibilityLabel={zh('重試')}>
            <Text style={styles.retry}>↻</Text>
          </Pressable>
        ) : null}
      </Pressable>

      {expanded && status === 'success' && readings.length > 0 ? (
        <View style={styles.list}>
          {readings.map((r) => {
            const name = r.birthProfile?.name ?? zh('未命名');
            const birth = fmtDate(r.birthProfile?.birthDate);
            return (
              <Pressable
                key={r.id}
                style={styles.rowCard}
                onPress={() => onOpen(r.id)}
                accessibilityRole="button"
              >
                <Text style={styles.rowIcon}>{meta?.icon ?? '🔮'}</Text>
                <View style={styles.rowBody}>
                  <Text style={styles.rowLine1} numberOfLines={1}>
                    {name}
                    {birth ? <Text style={styles.rowMeta}> · {birth}</Text> : null}
                    {readingType === 'annual' && r.targetYear ? (
                      <Text style={styles.yearBadge}>  {r.targetYear}{zh('年')}</Text>
                    ) : null}
                  </Text>
                  <Text style={styles.rowLine2}>{zh('讀於')} {fmtDate(r.createdAt)}</Text>
                </View>
                <Text style={styles.rowArrow}>→</Text>
              </Pressable>
            );
          })}
          {readings.length < totalCount ? (
            <Pressable
              style={styles.loadMore}
              onPress={handleLoadMore}
              disabled={loadingMore}
              accessibilityRole="button"
            >
              <Text style={styles.loadMoreText}>
                {loadingMore
                  ? zh('載入中…')
                  : `${zh('載入更多（還有')} ${totalCount - readings.length} ${zh('筆）')}`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  chevron: { fontSize: fontSize.xs, color: colors.textMuted, width: 14 },
  title: { flex: 1, fontSize: fontSize.base, fontFamily: fonts.serifBold, fontWeight: '700', color: colors.textPrimary },
  count: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '400' },
  retry: { fontSize: fontSize.lg, color: colors.red },
  list: { gap: spacing.sm, marginTop: spacing.sm },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  rowIcon: { fontSize: fontSize.xl },
  rowBody: { flex: 1, gap: 2 },
  rowLine1: { fontSize: fontSize.base, color: colors.textPrimary, fontWeight: '600' },
  rowMeta: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: '400' },
  yearBadge: { fontSize: fontSize.sm, color: colors.red, fontWeight: '700' },
  rowLine2: { fontSize: fontSize.xs, color: colors.textMuted },
  rowArrow: { fontSize: fontSize.base, color: colors.textMuted },
  loadMore: { alignItems: 'center', paddingVertical: spacing.md },
  loadMoreText: { fontSize: fontSize.sm, color: colors.red, fontWeight: '600' },
});
