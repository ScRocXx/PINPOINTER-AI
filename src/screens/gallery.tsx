import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  RefreshControl,
  ScrollView,
  SectionList,
  SectionListRenderItemInfo,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { CameraRoll, PhotoIdentifier } from '@react-native-camera-roll/camera-roll';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  Icon,
  IconButton,
  PressableScale,
  ProgressCard,
  Reveal,
  Screen,
  ScreenHeader,
  SectionHeader,
  Thumbnail,
  AppText,
} from '../components/ui';
import { PhotoViewer, ViewerItem } from '../components/PhotoViewer';
import { Colors, GUTTER, Radius, Space } from '../theme';
import { StringKey, formatDay, formatMonth, formatWhen, useStrings } from '../i18n';
import { RootStackParamList } from '../navigation/types';
import { usePinpointerShared } from '../hooks/PinpointerContext';
import { usePinnedItems } from '../hooks/usePinnedItems';
import { useScreenFocus } from '../hooks/useScreenFocus';
import { addRecentPhoto } from '../utils/RecentPhotos';
import { AppLogger } from '../utils/AppLogger';
import {
  DateFilter,
  DateSection,
  cameraRollTimes,
  chunk,
  filterWindow,
  groupIntoSections,
  inWindow,
} from '../utils/PhotoDates';
import {
  PhotoAccess,
  ensurePhotoAccess,
  getPhotoAccess,
  openAppSettingsAndWait,
} from '../utils/StoragePermissions';

/** The chips above the grid. */
export type PhotoFilter = DateFilter | 'screenshots' | 'important';

/** One photo in the grid. `takenAt` is in ms. */
export interface GalleryPhoto {
  uri: string;
  takenAt: number;
}

/** Photos per page from the phone's gallery: 16 rows of 3. */
export const PAGE_SIZE = 48;
const COLUMNS = 3;
const GAP = Space.xs + 2;
/** Android names the screenshots album this on every phone we know. */
export const SCREENSHOTS_ALBUM = 'Screenshots';

const FILTERS: ReadonlyArray<{ value: PhotoFilter; label: StringKey; icon?: 'star' | 'screenshot' }> = [
  { value: 'all', label: 'gallery.filterAll' },
  { value: 'today', label: 'gallery.filterToday' },
  { value: 'yesterday', label: 'gallery.filterYesterday' },
  { value: 'lastWeek', label: 'gallery.filterLastWeek' },
  { value: 'screenshots', label: 'gallery.filterScreenshots', icon: 'screenshot' },
  { value: 'important', label: 'gallery.filterImportant', icon: 'star' },
];

const EMPTY_TITLE: Record<PhotoFilter, StringKey> = {
  all: 'gallery.emptyAllTitle',
  today: 'gallery.emptyTodayTitle',
  yesterday: 'gallery.emptyYesterdayTitle',
  lastWeek: 'gallery.emptyLastWeekTitle',
  screenshots: 'gallery.emptyScreenshotsTitle',
  important: 'gallery.emptyImportantTitle',
};

/** CameraRoll gives seconds; the grid works in ms. */
const toPhoto = (edge: PhotoIdentifier): GalleryPhoto => {
  const seconds = edge.node.timestamp || edge.node.modificationTimestamp || 0;
  return { uri: edge.node.image.uri, takenAt: Math.round(seconds * 1000) };
};

const windowFor = (filter: PhotoFilter) =>
  filter === 'screenshots' || filter === 'important' ? filterWindow('all') : filterWindow(filter);

interface GridSection {
  key: string;
  title: string | null;
  data: GalleryPhoto[][];
}

/**
 * Photos: every photo on the phone, newest first, under Today, Yesterday,
 * the days of this week and then months. Chips narrow it to Today,
 * Yesterday, the last 7 days, screenshots or the photos marked Important.
 *
 * Tapping a photo opens the viewer (swipe for the next one), where it can be
 * shared, read, starred or opened in the phone's own gallery.
 */
export const GalleryScreen: React.FC = () => {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { t, ago } = useStrings();
  const focused = useScreenFocus();
  const { width } = useWindowDimensions();
  const { items: pinnedItems, isPinned } = usePinnedItems();
  const { syncCount, isSyncing, isPaused, handlePauseSync, handleResumeSync } = usePinpointerShared();

  const [filter, setFilter] = useState<PhotoFilter>('all');
  const [access, setAccess] = useState<PhotoAccess | null>(null);
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const cursor = useRef<string | undefined>(undefined);
  const hasMore = useRef(true);
  const busy = useRef(false);
  // Each reset gets a new id, so a page that arrives after the filter
  // changed is dropped instead of mixing two filters in one grid.
  const requestId = useRef(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const canSee = access === 'full' || access === 'limited';

  const checkAccess = useCallback(async () => {
    const next = await getPhotoAccess();
    setAccess(next);
    return next;
  }, []);

  const fetchPage = useCallback(async (reset: boolean) => {
    const current = filterRef.current;
    if (current === 'important') {
      return;
    }
    if (!reset && (busy.current || !hasMore.current)) {
      return;
    }
    const id = reset ? ++requestId.current : requestId.current;
    busy.current = true;
    setLoading(true);
    try {
      const window = windowFor(current);
      const page = await CameraRoll.getPhotos({
        first: PAGE_SIZE,
        after: reset ? undefined : cursor.current,
        assetType: 'Photos',
        ...cameraRollTimes(window),
        ...(current === 'screenshots' ? { groupName: SCREENSHOTS_ALBUM, groupTypes: 'Album' as const } : {}),
      });
      if (id !== requestId.current) {
        return;
      }
      const next = page.edges.map(toPhoto).filter(p => inWindow(p.takenAt, window));
      setPhotos(prev => {
        if (reset) {
          return next;
        }
        const seen = new Set(prev.map(p => p.uri));
        return [...prev, ...next.filter(p => !seen.has(p.uri))];
      });
      cursor.current = page.page_info.end_cursor;
      hasMore.current = !!page.page_info.has_next_page && page.edges.length > 0;
      setFailed(false);
    } catch (e) {
      if (id === requestId.current) {
        AppLogger.warn('Gallery', 'Could not load photos', e);
        setFailed(true);
      }
    } finally {
      if (id === requestId.current) {
        busy.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  /** New photos since the grid loaded go on top, without losing the scroll. */
  const refreshTop = useCallback(async () => {
    const current = filterRef.current;
    if (current === 'important' || busy.current) {
      return;
    }
    try {
      const window = windowFor(current);
      const page = await CameraRoll.getPhotos({
        first: PAGE_SIZE,
        assetType: 'Photos',
        ...cameraRollTimes(window),
        ...(current === 'screenshots' ? { groupName: SCREENSHOTS_ALBUM, groupTypes: 'Album' as const } : {}),
      });
      if (current !== filterRef.current) {
        return;
      }
      const fresh = page.edges.map(toPhoto).filter(p => inWindow(p.takenAt, window));
      setPhotos(prev => {
        const seen = new Set(prev.map(p => p.uri));
        const added = fresh.filter(p => !seen.has(p.uri));
        return added.length ? [...added, ...prev] : prev;
      });
    } catch (e) {
      AppLogger.warn('Gallery', 'Could not check for new photos', e);
    }
  }, []);

  // Access first; check again whenever the person comes back to the app
  // (they may have just allowed photos in Settings).
  useEffect(() => {
    checkAccess();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        checkAccess();
      }
    });
    return () => sub.remove();
  }, [checkAccess]);

  // A new filter (or access just granted) starts the grid again.
  useEffect(() => {
    if (!canSee) {
      return;
    }
    cursor.current = undefined;
    hasMore.current = true;
    setPhotos([]);
    setFailed(false);
    fetchPage(true);
  }, [canSee, fetchPage, filter]);

  // Back on this tab: add photos taken since.
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (focused && !wasFocused.current && canSee) {
      refreshTop();
    }
    wasFocused.current = focused;
  }, [canSee, focused, refreshTop]);

  const shown: GalleryPhoto[] = useMemo(() => {
    if (filter !== 'important') {
      return photos;
    }
    return pinnedItems.filter(p => p.kind === 'IMAGE').map(p => ({ uri: p.uri, takenAt: p.pinnedAt }));
  }, [filter, photos, pinnedItems]);

  const sectionTitle = useCallback(
    (s: DateSection): string => {
      switch (s.kind) {
        case 'today':
          return t('gallery.sectionToday');
        case 'yesterday':
          return t('gallery.sectionYesterday');
        case 'day':
          return formatDay(t, s.date);
        default:
          return formatMonth(t, s.date);
      }
    },
    [t],
  );

  const sections: GridSection[] = useMemo(() => {
    if (filter === 'important') {
      return shown.length ? [{ key: 'important', title: null, data: chunk(shown, COLUMNS) }] : [];
    }
    return groupIntoSections(shown, p => p.takenAt).map(g => ({
      key: g.key,
      title: sectionTitle(g),
      data: chunk(g.items, COLUMNS),
    }));
  }, [filter, sectionTitle, shown]);

  // Where each photo sits in `shown`, for the viewer and the stagger.
  const indexOf = useMemo(() => new Map(shown.map((p, i) => [p.uri, i])), [shown]);
  const tile = Math.floor((width - GUTTER * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  const openPhoto = useCallback(
    (uri: string) => {
      const i = indexOf.get(uri);
      if (i === undefined) {
        return;
      }
      setViewerIndex(i);
      addRecentPhoto(uri);
    },
    [indexOf],
  );

  const readText = useCallback(
    (uri: string) => {
      setViewerIndex(null);
      navigation.navigate('SmartClipboard', { scanUri: uri });
    },
    [navigation],
  );

  const allowPhotos = useCallback(async () => {
    await ensurePhotoAccess();
    await checkAccess();
  }, [checkAccess]);

  const allowAllPhotos = useCallback(async () => {
    await openAppSettingsAndWait();
    const next = await checkAccess();
    if (next === 'full') {
      fetchPage(true);
    }
  }, [checkAccess, fetchPage]);

  const onRefresh = useCallback(() => {
    if (filter === 'important') {
      return;
    }
    setRefreshing(true);
    cursor.current = undefined;
    hasMore.current = true;
    fetchPage(true);
  }, [fetchPage, filter]);

  const renderRow = useCallback(
    ({ item: row }: SectionListRenderItemInfo<GalleryPhoto[], GridSection>) => (
      <View style={styles.row}>
        {row.map(photo => {
          const i = indexOf.get(photo.uri) ?? 0;
          return (
            <Reveal key={photo.uri} index={i} playKey={filter} distance={8}>
              <PressableScale
                onPress={() => openPhoto(photo.uri)}
                pressedScale={0.95}
                accessibilityRole="button"
                accessibilityLabel={t('gallery.photoFrom', { when: formatWhen(t, ago, photo.takenAt) })}
                style={{ width: tile, height: tile }}
                testID={`gallery-photo-${i}`}
              >
                <Thumbnail uri={photo.uri} size={tile} radius={Radius.xs} testID={`gallery-thumb-${i}`} />
                {isPinned(photo.uri) ? (
                  <View style={styles.starBadge} testID={`gallery-star-${i}`}>
                    <Icon name="star" size={16} color={Colors.important} fillColor={Colors.importantStar} filled strokeWidth={1.6} />
                  </View>
                ) : null}
              </PressableScale>
            </Reveal>
          );
        })}
      </View>
    ),
    [ago, filter, indexOf, isPinned, openPhoto, t, tile],
  );

  const header = (
    <View>
      <ScreenHeader
        title={t('gallery.title')}
        subtitle={syncCount > 0 ? t('gallery.readyCount', { n: syncCount }) : undefined}
        actions={
          <IconButton
            icon="search"
            label={t('gallery.search')}
            variant="tonal"
            onPress={() => navigation.navigate('Pinpointer')}
            testID="gallery-search"
          />
        }
      />

      {isSyncing || isPaused ? (
        <ProgressCard
          title={t('progress.photosTitle')}
          detail={t('gallery.readyCount', { n: syncCount })}
          state={isPaused ? 'paused' : 'running'}
          actionLabel={t(isPaused ? 'progress.resume' : 'progress.pause')}
          onAction={isPaused ? handleResumeSync : handlePauseSync}
          note={t('progress.keepsGoing')}
          style={styles.gutter}
          testID="gallery-progress"
        />
      ) : null}

      {access === 'limited' ? (
        <Card style={[styles.gutter, styles.banner]} testID="gallery-limited">
          <View style={styles.bannerRow}>
            <View style={styles.bannerIcon}>
              <Icon name="photos" size={24} color={Colors.importantInk} strokeWidth={2} />
            </View>
            <View style={styles.flex}>
              <AppText variant="bodyStrong">{t('perm.limitedTitle')}</AppText>
              <AppText variant="small" color="textSecondary">
                {t('perm.limitedBody')}
              </AppText>
            </View>
          </View>
          <Button
            label={t('perm.allowAll')}
            onPress={allowAllPhotos}
            variant="secondary"
            size="compact"
            style={styles.bannerAction}
            testID="gallery-allow-all"
          />
        </Card>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        accessibilityLabel={t('gallery.filters')}
        testID="gallery-filters"
      >
        {FILTERS.map(f => (
          <Chip
            key={f.value}
            label={t(f.label)}
            icon={f.icon}
            selected={filter === f.value}
            onPress={() => setFilter(f.value)}
            testID={`gallery-filter-${f.value}`}
          />
        ))}
      </ScrollView>
    </View>
  );

  if (access === 'denied' || access === 'blocked') {
    return (
      <Screen testID="gallery-screen">
        <ScreenHeader title={t('gallery.title')} />
        <EmptyState
          icon="photos"
          title={t('onboarding.photosTitle')}
          body={t('onboarding.photosBody')}
          actionLabel={t('onboarding.allowPhotos')}
          onAction={allowPhotos}
          testID="gallery-no-access"
        />
      </Screen>
    );
  }

  const firstLoad = loading && shown.length === 0 && !refreshing;

  const empty = firstLoad || access === null ? (
    <View style={[styles.row, styles.placeholders]} testID="gallery-loading">
      {Array.from({ length: 9 }, (_, i) => (
        <View key={i} style={[styles.placeholder, { width: tile, height: tile }]} />
      ))}
    </View>
  ) : failed ? (
    <EmptyState
      icon="alert"
      title={t('gallery.loadError')}
      actionLabel={t('common.tryAgain')}
      onAction={() => fetchPage(true)}
      testID="gallery-error"
    />
  ) : (
    <EmptyState
      icon={filter === 'important' ? 'star' : filter === 'screenshots' ? 'screenshot' : 'photos'}
      title={t(EMPTY_TITLE[filter])}
      body={t(
        filter === 'all'
          ? 'gallery.emptyAllBody'
          : filter === 'important'
            ? 'gallery.emptyImportantBody'
            : 'gallery.emptyFilterBody',
      )}
      actionLabel={filter === 'all' ? undefined : t('gallery.seeAll')}
      onAction={filter === 'all' ? undefined : () => setFilter('all')}
      testID="gallery-empty"
    />
  );

  return (
    <Screen testID="gallery-screen">
      <SectionList
        sections={sections}
        keyExtractor={row => row.map(p => p.uri).join('|')}
        renderItem={renderRow}
        renderSectionHeader={({ section }) =>
          section.title ? <SectionHeader title={section.title} style={styles.sectionHeader} /> : null
        }
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          loading && shown.length > 0 && !refreshing ? (
            <ActivityIndicator
              color={Colors.primary}
              style={styles.footer}
              accessibilityLabel={t('gallery.loadingMore')}
              testID="gallery-loading-more"
            />
          ) : (
            <View style={styles.footer} />
          )
        }
        onEndReached={() => fetchPage(false)}
        onEndReachedThreshold={0.6}
        refreshControl={
          filter === 'important' ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[Colors.primary]} />
          )
        }
        stickySectionHeadersEnabled={false}
        // Section headers and footers count as items: 12 fills a first screen.
        initialNumToRender={12}
        maxToRenderPerBatch={6}
        windowSize={7}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
        testID="gallery-list"
      />

      <PhotoViewer
        items={shown as ViewerItem[]}
        index={viewerIndex}
        onClose={() => setViewerIndex(null)}
        onIndexChange={i => {
          const p = shown[i];
          if (p) {
            addRecentPhoto(p.uri);
          }
        }}
        onReadText={readText}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gutter: { marginHorizontal: GUTTER, marginBottom: Space.md },
  chips: { paddingHorizontal: GUTTER, paddingVertical: Space.xs, gap: Space.sm },
  sectionHeader: { marginTop: Space.lg, marginBottom: Space.xs },
  row: { flexDirection: 'row', gap: GAP, paddingHorizontal: GUTTER, marginBottom: GAP },
  placeholders: { flexWrap: 'wrap', marginTop: Space.lg },
  placeholder: { backgroundColor: Colors.sunken, borderRadius: Radius.xs },
  starBadge: {
    position: 'absolute',
    top: Space.xs + 2,
    right: Space.xs + 2,
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  banner: { gap: Space.md },
  bannerRow: { flexDirection: 'row', gap: Space.md, alignItems: 'flex-start' },
  bannerIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.xs + 2,
    backgroundColor: Colors.importantSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerAction: { alignSelf: 'flex-end' },
  footer: { paddingVertical: Space.xxl },
});
