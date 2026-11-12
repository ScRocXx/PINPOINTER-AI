import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import {
  AppText,
  Button,
  Icon,
  PinMark,
  ProgressCard,
  Reveal,
  Screen,
  SearchField,
} from '../../components/ui';
import { StringKey, useStrings } from '../../i18n';
import { Colors, GUTTER, Radius, Space } from '../../theme';
import type { CollectionId } from '../../utils/Collections';
import type { PinnedItem } from '../../utils/PinnedItems';
import type { CollectionTileState } from '../../hooks/useHomeOverview';
import { CollectionTile, ImportantShelf, RecentRow, TILE_ORDER } from './HomeParts';

/** Newest photos a quick check looks at (GallerySync's QUICK_SYNC_LIMIT). */
export const QUICK_CHECK_SIZE = 50;

export interface PhotoIndexing {
  /** A check is running now. */
  running: boolean;
  /** A full check was paused (by the person, or it stopped). */
  paused: boolean;
  /** The running check only looks at the newest photos. */
  quick: boolean;
  /** Photos this run has done so far. */
  processed: number;
  /** Photos looked at so far, ever. null until known. */
  checked: number | null;
  /** Photos on the phone. null until known. */
  total: number | null;
  lastChecked: number | null;
}

export interface PaperIndexing {
  running: boolean;
  done: number;
  total: number;
  lastChecked: number | null;
}

export interface HomeViewProps {
  /** The big search bar was tapped: open search. */
  onOpenSearch: () => void;
  /** The mic: start listening, or stop when already listening. */
  onVoicePress: () => void;
  listening: boolean;
  /** Speech is being turned into words. */
  understanding: boolean;
  /** Voice search is loading, on its first use. */
  preparing?: boolean;

  photos: PhotoIndexing;
  papers: PaperIndexing;
  /** "Check again": look for new photos and papers. `everything` looks through all photos. */
  onCheck: (everything: boolean) => void;
  onPause: () => void;
  onResume: () => void;

  collections: Record<CollectionId, CollectionTileState>;
  onOpenCollection: (id: CollectionId) => void;

  pinned: PinnedItem[];
  onOpenPinned: (item: PinnedItem) => void;

  recent: string[];
  onOpenPhoto: (uri: string) => void;

  /** For the greeting. Defaults to now (injectable for tests and previews). */
  now?: Date;
}

/** Good morning / afternoon / evening, by the phone's clock. */
export const greetingKey = (hour: number): StringKey =>
  hour >= 4 && hour < 12 ? 'home.greetingMorning' : hour >= 12 && hour < 17 ? 'home.greetingAfternoon' : 'home.greetingEvening';

/** What the "getting ready" area shows. */
export type HomeStatus =
  | { kind: 'photosRunning'; value?: number }
  | { kind: 'photosPaused'; value?: number }
  | { kind: 'photosLeft'; left: number; value: number }
  | { kind: 'papersRunning'; value?: number }
  | { kind: 'checked' };

const fraction = (done: number, total: number): number => (total > 0 ? Math.min(1, done / total) : 0);

/**
 * One calm thing at a time: a running check, a paused one, photos still to
 * look through, or (most of the time) a plain "checked 2 hours ago" line.
 */
export const homeStatus = (photos: PhotoIndexing, papers: PaperIndexing): HomeStatus => {
  const known = photos.total !== null && photos.total > 0 && photos.checked !== null;
  const overall = known ? fraction(photos.checked as number, photos.total as number) : undefined;
  if (photos.running) {
    if (photos.quick) return { kind: 'photosRunning', value: fraction(photos.processed, QUICK_CHECK_SIZE) };
    return { kind: 'photosRunning', value: overall };
  }
  if (photos.paused) return { kind: 'photosPaused', value: overall };
  if (papers.running) {
    return { kind: 'papersRunning', value: papers.total > 0 ? fraction(papers.done, papers.total) : undefined };
  }
  if (known) {
    const left = (photos.total as number) - (photos.checked as number);
    if (left > 0) return { kind: 'photosLeft', left, value: overall as number };
  }
  return { kind: 'checked' };
};

/** The progress card, or the quiet "last checked" line. */
const HomeStatusArea: React.FC<
  Pick<HomeViewProps, 'photos' | 'papers' | 'onCheck' | 'onPause' | 'onResume'>
> = ({ photos, papers, onCheck, onPause, onResume }) => {
  const { t, ago } = useStrings();
  const status = homeStatus(photos, papers);
  const counted = photos.total !== null && photos.checked !== null && photos.total > 0;
  const done = counted ? Math.min(photos.checked as number, photos.total as number) : photos.processed;
  const total = photos.total ?? 0;

  switch (status.kind) {
    case 'photosRunning':
      return (
        <ProgressCard
          state="running"
          icon="photos"
          title={t('progress.photosTitle')}
          detail={
            counted && !photos.quick
              ? t('progress.count', { done, total })
              : t('progress.countSoFar', { done: photos.processed })
          }
          value={status.value}
          actionLabel={t('progress.pause')}
          onAction={onPause}
          testID="home-progress"
        />
      );
    case 'photosPaused':
      return (
        <ProgressCard
          state="paused"
          icon="photos"
          title={t('progress.photosTitle')}
          detail={counted ? t('progress.pausedCount', { done, total }) : t('progress.pausedSoFar', { done })}
          value={status.value}
          actionLabel={t('progress.resume')}
          onAction={onResume}
          note={t('progress.keepsGoing')}
          testID="home-progress"
        />
      );
    case 'photosLeft':
      return (
        <ProgressCard
          state="paused"
          icon="photos"
          title={t('home.photosLeft', { n: status.left })}
          detail={t('progress.count', { done, total })}
          value={status.value}
          actionLabel={t('home.checkNow')}
          onAction={() => onCheck(true)}
          note={t('progress.keepsGoing')}
          testID="home-progress"
        />
      );
    case 'papersRunning':
      return (
        <ProgressCard
          state="running"
          icon="papers"
          title={t('progress.papersTitle')}
          detail={papers.total > 0 ? t('progress.countShort', { done: papers.done, total: papers.total }) : undefined}
          value={status.value}
          testID="home-progress"
        />
      );
    case 'checked': {
      const lines = [
        photos.lastChecked ? t('home.photosChecked', { when: ago(photos.lastChecked) }) : t('home.notCheckedYet'),
        papers.lastChecked ? t('home.papersChecked', { when: ago(papers.lastChecked) }) : null,
      ].filter((l): l is string => !!l);
      return (
        <View style={styles.checked} testID="home-checked">
          <Icon
            name={photos.lastChecked ? 'check' : 'clock'}
            size={22}
            color={photos.lastChecked ? Colors.success : Colors.textSecondary}
            strokeWidth={2.25}
          />
          <View style={styles.flex}>
            {lines.map(line => (
              <AppText key={line} variant="small" color="textSecondary">
                {line}
              </AppText>
            ))}
          </View>
          <Button
            label={photos.lastChecked ? t('progress.checkAgain') : t('home.checkNow')}
            onPress={() => onCheck(false)}
            variant="ghost"
            size="compact"
            icon="refresh"
            testID="home-check"
          />
        </View>
      );
    }
  }
};

/**
 * Home: a calm start that answers "what are you looking for?". The big
 * search bar and mic first, then ready-made searches built from the
 * person's own photos, then what they starred. Indexing shows as one card
 * while it runs and as a quiet line when it doesn't.
 */
export const HomeView: React.FC<HomeViewProps> = ({
  onOpenSearch,
  onVoicePress,
  listening,
  understanding,
  preparing = false,
  photos,
  papers,
  onCheck,
  onPause,
  onResume,
  collections,
  onOpenCollection,
  pinned,
  onOpenPinned,
  recent,
  onOpenPhoto,
  now,
}) => {
  const { t } = useStrings();
  const hour = (now ?? new Date()).getHours();
  const placeholder = listening
    ? t('search.listening')
    : understanding
      ? t('search.understanding')
      : preparing
        ? t('search.voiceGettingReady')
        : t('home.searchHint');

  const rows: CollectionId[][] = [];
  for (let i = 0; i < TILE_ORDER.length; i += 2) rows.push(TILE_ORDER.slice(i, i + 2));

  return (
    <Screen testID="home">
      {/* The beam's light, very soft, behind the search: the screen's one gradient. */}
      <LinearGradient
        pointerEvents="none"
        colors={[Colors.foundSoft, Colors.primarySoft, Colors.canvas]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.4, y: 1 }}
        style={styles.wash}
        testID="home-wash"
      />
      <ScrollView
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        testID="home-scroll"
      >
        <Reveal index={0} style={styles.header}>
          <View style={styles.brand}>
            <PinMark size={34} background={Colors.foundSoft} />
            <AppText variant="title" accessibilityRole="header">
              {t('common.appName')}
            </AppText>
          </View>
          <View style={styles.privacy} accessible accessibilityLabel={t('onboarding.private')} testID="home-private">
            <Icon name="shield" size={18} color={Colors.found} strokeWidth={2.25} />
            <AppText variant="label" color="found" numberOfLines={1}>
              {t('common.onThisPhone')}
            </AppText>
          </View>
        </Reveal>

        <Reveal index={1} style={styles.hello}>
          <AppText variant="body" color="textSecondary">
            {t(greetingKey(hour))}
          </AppText>
          <AppText variant="display">{t('home.title')}</AppText>
        </Reveal>

        <Reveal index={2} style={styles.gutter}>
          <SearchField
            placeholder={placeholder}
            onPressFake={onOpenSearch}
            onVoicePress={understanding || preparing ? () => {} : onVoicePress}
            listening={listening}
            active={listening || understanding || preparing}
            testID="home-search"
          />
        </Reveal>

        <Reveal index={3} style={styles.gutter}>
          <HomeStatusArea photos={photos} papers={papers} onCheck={onCheck} onPause={onPause} onResume={onResume} />
        </Reveal>

        <View style={styles.section}>
          <AppText variant="heading" accessibilityRole="header" style={styles.sectionTitle}>
            {t('home.findQuickly')}
          </AppText>
          <View style={styles.grid} testID="find-quickly">
            {rows.map((row, r) => (
              <View key={row.join()} style={styles.gridRow}>
                {row.map((id, c) => {
                  const index = 4 + r * 2 + c;
                  const tile = collections[id];
                  return (
                    <Reveal key={id} index={index} style={styles.cell}>
                      <CollectionTile
                        id={id}
                        index={index}
                        photos={tile?.photos ?? []}
                        count={tile?.count ?? null}
                        capped={tile?.capped}
                        onPress={onOpenCollection}
                      />
                    </Reveal>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <ImportantShelf items={pinned} onOpen={onOpenPinned} />
        </View>

        {recent.length > 0 ? (
          <View style={styles.section}>
            <RecentRow uris={recent} onOpen={onOpenPhoto} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 360 },
  page: { paddingTop: Space.sm, paddingBottom: Space.huge, gap: Space.xl },
  gutter: { paddingHorizontal: GUTTER },
  header: {
    paddingHorizontal: GUTTER,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space.md,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Space.sm + 2, flexShrink: 1 },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs + 2,
    minHeight: 40,
    paddingHorizontal: Space.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
  },
  hello: { paddingHorizontal: GUTTER, gap: Space.xxs },
  checked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    paddingLeft: Space.xs,
  },
  section: { gap: 0 },
  sectionTitle: { paddingHorizontal: GUTTER, marginBottom: Space.md },
  grid: { paddingHorizontal: GUTTER, gap: Space.md },
  gridRow: { flexDirection: 'row', gap: Space.md },
  cell: { flex: 1 },
});
