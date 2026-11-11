import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText, Chip, EmptyState, Icon } from '../../components/ui';
import { useStrings } from '../../i18n';
import { Colors, GUTTER, Space } from '../../theme';
import { maskSensitiveData } from '../../utils/DataMasking';
import { SearchHistoryItem } from '../../utils/SearchHistory';
import { SUGGESTIONS } from './RecentSearches';

export interface NothingFoundProps {
  query: string;
  /** Photos are still being read: say so instead of "nothing". */
  indexing?: { done: number; total?: number } | null;
  /** "Look through all photos". Hidden while that is already running. */
  onLookEverywhere: () => void;
  /** Recent searches that did find something, offered as a way out. */
  history: ReadonlyArray<SearchHistoryItem>;
  onSelect: (query: string) => void;
  bottomInset?: number;
  testID?: string;
}

/**
 * A kind "nothing found": it never blames the person. It says what to try,
 * says when Pinpointer is still getting photos ready, offers one clear
 * action, and gives a few searches that do work.
 */
export const NothingFound: React.FC<NothingFoundProps> = ({
  query,
  indexing,
  onLookEverywhere,
  history,
  onSelect,
  bottomInset = 0,
  testID = 'nothing-found',
}) => {
  const { t } = useStrings();
  const q = query.trim();
  const body = indexing
    ? indexing.total
      ? t('search.nothingIndexingBody', { done: indexing.done, total: indexing.total })
      : t('search.nothingIndexingBodyShort')
    : t('search.nothingBody');

  const worked = history
    .filter(h => h.resultCount > 0 && h.query.trim().toLowerCase() !== q.toLowerCase())
    .slice(0, 4)
    .map(h => ({ query: h.query, shown: maskSensitiveData(h.query) }));
  const tryList = worked.length > 0 ? worked : SUGGESTIONS.map(k => ({ query: t(k), shown: t(k) }));

  return (
    <ScrollView
      contentContainerStyle={[styles.content, { paddingBottom: Space.xxxl + bottomInset }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      testID={testID}
    >
      <EmptyState
        icon="search"
        searching={!!indexing}
        title={t('search.nothingTitle', { q })}
        body={body}
        actionLabel={indexing ? undefined : t('search.lookEverywhere')}
        onAction={indexing ? undefined : onLookEverywhere}
        testID={`${testID}-state`}
      />

      <View style={styles.tips}>
        {(['search.tipSpelling', 'search.tipShorter', 'search.tipLanguage'] as const).map(key => (
          <View key={key} style={styles.tip}>
            <Icon name="check" size={20} color={Colors.found} strokeWidth={2.25} />
            <AppText variant="body" color="textSecondary" style={styles.flex}>
              {t(key)}
            </AppText>
          </View>
        ))}
      </View>

      <AppText variant="label" color="textMuted" style={styles.tryTitle}>
        {worked.length > 0 ? t('search.yourRecent') : t('search.tryThese')}
      </AppText>
      <View style={styles.chips}>
        {tryList.map(item => (
          <Chip
            key={item.query}
            label={item.shown}
            icon={worked.length > 0 ? 'clock' : 'search'}
            onPress={() => onSelect(item.query)}
            testID={`${testID}-suggestion`}
          />
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { paddingHorizontal: GUTTER },
  flex: { flex: 1 },
  tips: { gap: Space.sm, marginTop: Space.xs, paddingHorizontal: Space.sm },
  tip: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  tryTitle: { marginTop: Space.xxl, marginBottom: Space.sm, marginLeft: Space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
});
