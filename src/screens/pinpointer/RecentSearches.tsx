import React, { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Button, Chip, Icon, IconButton, PressableScale, Reveal } from '../../components/ui';
import { StringKey, useStrings } from '../../i18n';
import { Colors, GUTTER, Radius, Space, Touch } from '../../theme';
import { maskSensitiveData } from '../../utils/DataMasking';
import { SearchHistoryItem } from '../../utils/SearchHistory';

export interface RecentSearchesProps {
  history: ReadonlyArray<SearchHistoryItem>;
  onSelect: (query: string) => void;
  onDelete: (query: string) => void;
  onClearAll: () => void;
  /** Bottom padding for the gesture bar. */
  bottomInset?: number;
  /** Fixed "now" for tests. */
  now?: number;
  testID?: string;
}

/** Searches people make most often: shown before there's any history. */
export const SUGGESTIONS: StringKey[] = ['search.suggestId', 'search.suggestBill', 'search.suggestMedicine', 'search.suggestBank'];

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/**
 * What the search screen shows before anything is typed: recent searches
 * (today first, then earlier), each with what it found and a remove button,
 * and a few searches to try. Queries are masked again here, so an Aadhaar
 * number saved before masking existed never shows in full.
 */
export const RecentSearches: React.FC<RecentSearchesProps> = ({
  history,
  onSelect,
  onDelete,
  onClearAll,
  bottomInset = 0,
  now = Date.now(),
  testID = 'recent-searches',
}) => {
  const { t, ago } = useStrings();

  const groups = useMemo(() => {
    const today = startOfDay(now);
    const rows = history.map(h => ({ ...h, shown: maskSensitiveData(h.query) }));
    return [
      { key: 'today', title: t('search.historyToday'), rows: rows.filter(r => r.timestamp >= today) },
      { key: 'earlier', title: t('search.historyEarlier'), rows: rows.filter(r => r.timestamp < today) },
    ].filter(g => g.rows.length > 0);
  }, [history, now, t]);

  const confirmClear = () =>
    Alert.alert(t('search.clearHistoryTitle'), t('search.clearHistoryBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('search.clearHistory'), style: 'destructive', onPress: onClearAll },
    ]);

  let rowIndex = 0;
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={[styles.content, { paddingBottom: Space.xxxl + bottomInset }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      testID={testID}
    >
      {groups.length > 0 ? (
        <>
          <View style={styles.header}>
            <AppText variant="heading" accessibilityRole="header" style={styles.flex}>
              {t('search.recent')}
            </AppText>
            <Button label={t('search.clearHistory')} variant="ghost" size="compact" onPress={confirmClear} testID={`${testID}-clear`} />
          </View>
          {groups.map(group => (
            <View key={group.key} style={styles.group}>
              <AppText variant="label" color="textMuted" style={styles.groupTitle}>
                {group.title}
              </AppText>
              <View style={styles.card}>
                {group.rows.map((row, i) => {
                  const when = ago(row.timestamp);
                  const meta =
                    row.resultCount > 0
                      ? t('search.historyMeta', { when, n: row.resultCount })
                      : t('search.historyMetaNone', { when });
                  const index = rowIndex++;
                  return (
                    <Reveal key={row.query} index={index}>
                      <View style={[styles.row, i < group.rows.length - 1 ? styles.divider : null]}>
                        <PressableScale
                          onPress={() => onSelect(row.query)}
                          pressedScale={0.985}
                          accessibilityRole="button"
                          accessibilityLabel={`${row.shown}, ${meta}`}
                          style={styles.rowMain}
                          testID={`${testID}-row`}
                        >
                          <View style={styles.clock}>
                            <Icon name="clock" size={22} color={Colors.textSecondary} strokeWidth={2} />
                          </View>
                          <View style={styles.flex}>
                            <AppText variant="bodyStrong" numberOfLines={1}>
                              {row.shown}
                            </AppText>
                            <AppText variant="small" color="textMuted" numberOfLines={1}>
                              {meta}
                            </AppText>
                          </View>
                        </PressableScale>
                        <IconButton
                          icon="close"
                          label={t('search.removeHistory', { q: row.shown })}
                          size={Touch.min}
                          iconSize={20}
                          iconColor={Colors.textSecondary}
                          onPress={() => onDelete(row.query)}
                          testID={`${testID}-remove`}
                        />
                      </View>
                    </Reveal>
                  );
                })}
              </View>
            </View>
          ))}
        </>
      ) : (
        <View style={styles.empty} testID={`${testID}-empty`}>
          <View style={styles.emptyIcon}>
            <Icon name="clock" size={28} color={Colors.primary} strokeWidth={1.9} />
          </View>
          <AppText variant="body" color="textSecondary" style={styles.flex}>
            {t('search.noHistory')}
          </AppText>
        </View>
      )}

      <AppText variant="label" color="textMuted" style={styles.tryTitle}>
        {t('search.tryThese')}
      </AppText>
      <View style={styles.chips}>
        {SUGGESTIONS.map(key => (
          <Chip key={key} label={t(key)} icon="search" onPress={() => onSelect(t(key))} testID={`${testID}-suggestion`} />
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1 },
  content: { paddingHorizontal: GUTTER, paddingTop: Space.sm },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: Touch.min, marginBottom: Space.xs },
  group: { marginBottom: Space.lg },
  groupTitle: { marginBottom: Space.xs, marginLeft: Space.xs },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingRight: Space.xs, backgroundColor: Colors.surface },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.line },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    minHeight: Touch.comfortable + Space.sm,
    paddingVertical: Space.sm,
    paddingLeft: Space.lg,
  },
  clock: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tryTitle: { marginTop: Space.xxl, marginBottom: Space.sm, marginLeft: Space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
});
