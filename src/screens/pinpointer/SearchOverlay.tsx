import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  FlatList,
  Keyboard,
  ListRenderItemInfo,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, Chip, EmptyState, IconButton, Tag, useToast } from '../../components/ui';
import { DocumentRecord } from '../../database';
import { useStrings } from '../../i18n';
import { Colors, Duration, Ease, GUTTER, Space, Touch } from '../../theme';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { usePinnedItems } from '../../hooks/usePinnedItems';
import { alsoSearchedAs } from '../../utils/MatchTerms';
import { SearchHistoryItem } from '../../utils/SearchHistory';
import { ListeningPanel } from './ListeningPanel';
import { NothingFound } from './NothingFound';
import { RecentSearches } from './RecentSearches';
import { ResultItem } from './ResultItem';
import { openResult } from './openResult';

export type ResultFilter = 'ALL' | 'IMAGE' | 'DOCUMENT';

export interface SearchOverlayProps {
  /** Search is open. It rises in when this turns on and leaves when it turns off. */
  visible: boolean;
  searchText: string;
  results: ReadonlyArray<DocumentRecord>;
  isSearchPending: boolean;
  history: ReadonlyArray<SearchHistoryItem>;
  onSelectHistory: (query: string) => void;
  onDeleteHistory: (query: string) => void;
  onClearHistory: () => void;
  onBack: () => void;
  /** "Nothing found": look through every photo on the phone. */
  onLookEverywhere: () => void;
  /** Open the viewer on `photos[index]`: the photo results, in the order shown. */
  onOpenPhoto: (photos: ReadonlyArray<DocumentRecord>, index: number) => void;
  isRecording: boolean;
  isTranscribing: boolean;
  onStopListening: () => void;
  /** Back while listening: stop without searching. */
  onCancelListening: () => void;
  /** Photos still being read, so "nothing found" can say so. */
  indexing?: { done: number; total?: number } | null;
  /** The editable search field (with the mic). */
  searchBar: React.ReactNode;
  testID?: string;
}

const FILTERS: { id: ResultFilter; label: 'search.filterAll' | 'search.filterPhotos' | 'search.filterPapers' }[] = [
  { id: 'ALL', label: 'search.filterAll' },
  { id: 'IMAGE', label: 'search.filterPhotos' },
  { id: 'DOCUMENT', label: 'search.filterPapers' },
];

const keyOf = (item: DocumentRecord): string => item.filePath || String(item.id);

/**
 * The search screen: back, the search field, and under it one of
 * - the listening panel, while the mic is on or the words are being read,
 * - recent searches, before anything is typed,
 * - the results, with Photos / Papers filters and the words also searched,
 * - a kind "nothing found" page.
 *
 * Tapping a result checks the file is still there first; a deleted one leaves
 * the list with a short note. It mounts only while open, so the home screen
 * carries none of it.
 */
export const SearchOverlay: React.FC<SearchOverlayProps> = props => {
  const { visible } = props;
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) setMounted(true);
    const anim = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : visible ? Duration.base : Duration.quick,
      easing: visible ? Ease.standard : Ease.exit,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
    return () => anim.stop();
  }, [visible, progress, reduceMotion]);

  if (!mounted) return null;

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [28, 0] });
  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[StyleSheet.absoluteFill, styles.overlay, { opacity: progress, transform: [{ translateY }] }]}
      testID={props.testID ?? 'search-overlay'}
    >
      <SearchContent {...props} />
    </Animated.View>
  );
};

const SearchContent: React.FC<SearchOverlayProps> = ({
  visible,
  searchText,
  results,
  isSearchPending,
  history,
  onSelectHistory,
  onDeleteHistory,
  onClearHistory,
  onBack,
  onLookEverywhere,
  onOpenPhoto,
  isRecording,
  isTranscribing,
  onStopListening,
  onCancelListening,
  indexing,
  searchBar,
}) => {
  const { t } = useStrings();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { isPinned } = usePinnedItems();
  const [filter, setFilter] = useState<ResultFilter>('ALL');
  // Results found deleted when tapped, for this query only.
  const [gone, setGone] = useState<{ q: string; paths: ReadonlySet<string> }>({ q: '', paths: new Set() });
  const opening = useRef(false);

  const query = searchText.trim();
  const voice = isRecording || isTranscribing;

  // The keyboard would cover the listening panel.
  useEffect(() => {
    if (isRecording) Keyboard.dismiss();
  }, [isRecording]);

  // Back while listening stops listening and stays in search.
  useEffect(() => {
    if (!visible || !isRecording) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancelListening();
      return true;
    });
    return () => sub.remove();
  }, [visible, isRecording, onCancelListening]);

  const live = useMemo(() => {
    const paths = gone.q === searchText ? gone.paths : null;
    return paths && paths.size > 0 ? results.filter(r => !paths.has(r.filePath)) : results;
  }, [results, gone, searchText]);

  const counts = useMemo(() => {
    let photos = 0;
    for (const r of live) if (r.type === 'IMAGE') photos++;
    return { ALL: live.length, IMAGE: photos, DOCUMENT: live.length - photos };
  }, [live]);

  // Filters only help when there are both kinds; a filter left empty shows all.
  const showFilters = counts.IMAGE > 0 && counts.DOCUMENT > 0;
  const active: ResultFilter = showFilters && counts[filter] > 0 ? filter : 'ALL';
  const shown = useMemo(
    () => (active === 'ALL' ? live : live.filter(r => r.type === active)),
    [live, active],
  );

  const also = useMemo(() => (query ? alsoSearchedAs(query) : []), [query]);

  // Read through a ref so `open` (and every row) keeps one identity while
  // results re-rank or a filter changes.
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const open = useCallback(
    async (item: DocumentRecord) => {
      if (opening.current) return;
      opening.current = true;
      try {
        const outcome = await openResult(item);
        if (outcome === 'gone') {
          setGone(prev => {
            const paths = new Set(prev.q === searchText ? prev.paths : []);
            paths.add(item.filePath);
            return { q: searchText, paths };
          });
          toast.show(t('error.fileGone'), { icon: 'alert' });
          return;
        }
        if (item.type === 'IMAGE') {
          // A failed check still shows the photo: the viewer copes if it can't load.
          const photos = shownRef.current.filter(r => r.type === 'IMAGE');
          onOpenPhoto(photos, Math.max(0, photos.indexOf(item)));
        } else if (outcome === 'failed') {
          toast.show(t('papers.openFailed'), { icon: 'alert' });
        }
      } finally {
        opening.current = false;
      }
    },
    [searchText, onOpenPhoto, toast, t],
  );

  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<DocumentRecord>) => (
      <ResultItem item={item} query={query} index={index} pinned={isPinned(item.filePath)} onPress={open} />
    ),
    [query, isPinned, open],
  );

  let body: React.ReactNode;
  if (voice) {
    body = <ListeningPanel listening={isRecording} understanding={isTranscribing} onStop={onStopListening} />;
  } else if (!query) {
    body = (
      <RecentSearches
        history={history}
        onSelect={onSelectHistory}
        onDelete={onDeleteHistory}
        onClearAll={onClearHistory}
        bottomInset={insets.bottom}
      />
    );
  } else if (live.length === 0) {
    body = isSearchPending ? (
      <EmptyState icon="search" searching title={t('search.searching')} style={styles.pending} testID="search-pending" />
    ) : (
      <NothingFound
        query={query}
        indexing={indexing}
        onLookEverywhere={onLookEverywhere}
        history={history}
        onSelect={onSelectHistory}
        bottomInset={insets.bottom}
      />
    );
  } else {
    const n = shown.length;
    body = (
      <>
        {showFilters ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.filterBar}
            contentContainerStyle={styles.filters}
            testID="search-filters"
          >
            {FILTERS.map(f => {
              const label = t(f.label);
              return (
                <Chip
                  key={f.id}
                  label={t('search.filterCount', { label, n: counts[f.id] })}
                  accessibilityLabel={t('search.filterLabel', { label, n: counts[f.id] })}
                  selected={active === f.id}
                  onPress={() => setFilter(f.id)}
                  testID={`search-filter-${f.id}`}
                />
              );
            })}
          </ScrollView>
        ) : null}
        <FlatList
          data={shown as DocumentRecord[]}
          renderItem={renderItem}
          keyExtractor={keyOf}
          style={styles.fill}
          contentContainerStyle={[styles.list, { paddingBottom: Space.xxxl + insets.bottom }]}
          ItemSeparatorComponent={Gap}
          ListHeaderComponent={
            <View style={styles.listHead}>
              <AppText
                variant="label"
                color="textSecondary"
                accessibilityLiveRegion="polite"
                testID="search-count"
              >
                {isSearchPending ? t('search.searching') : n === 1 ? t('search.foundOne') : t('search.found', { n })}
              </AppText>
              {also.length > 0 ? (
                <View style={styles.also} testID="search-also">
                  <AppText variant="small" color="textMuted">
                    {t('search.alsoSearched')}
                  </AppText>
                  {also.map(word => (
                    <Tag key={word} label={word} tone="neutral" />
                  ))}
                </View>
              ) : null}
            </View>
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          initialNumToRender={6}
          maxToRenderPerBatch={6}
          windowSize={7}
          removeClippedSubviews
          showsVerticalScrollIndicator={false}
          testID="search-results"
        />
      </>
    );
  }

  return (
    <View style={[styles.fill, { paddingTop: insets.top }]}>
      {visible ? <StatusBar barStyle="dark-content" backgroundColor={Colors.canvas} /> : null}
      <View style={styles.header}>
        <IconButton icon="back" label={t('search.close')} onPress={onBack} testID="search-back" />
        <View style={styles.fill}>{searchBar}</View>
      </View>
      {body}
    </View>
  );
};

const Gap = () => <View style={styles.gap} />;

const styles = StyleSheet.create({
  overlay: { backgroundColor: Colors.canvas, zIndex: 10, elevation: 10 },
  fill: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingLeft: Space.xs,
    paddingRight: GUTTER,
    paddingTop: Space.sm,
    paddingBottom: Space.sm,
    minHeight: Touch.comfortable + Space.lg,
  },
  filterBar: { flexGrow: 0 },
  filters: { gap: Space.sm, paddingHorizontal: GUTTER, paddingBottom: Space.sm },
  list: { paddingHorizontal: GUTTER },
  listHead: { gap: Space.sm, paddingTop: Space.xs, paddingBottom: Space.md },
  also: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Space.xs + 2 },
  gap: { height: Space.sm + 2 },
  pending: { marginTop: Space.xxl, marginHorizontal: GUTTER },
});
