/**
 * The pieces of Home: a "Find quickly" tile built from the person's own
 * photos, the Important shelf and the recently opened row. Presentational
 * only (no database, no context), so they render in the browser preview.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import {
  AppText,
  Icon,
  IconName,
  LockOnCorners,
  PressableScale,
  Reveal,
  Thumbnail,
} from '../../components/ui';
import { useStrings, translate } from '../../i18n';
import type { StringKey } from '../../i18n';
import { Colors, Elevation, GUTTER, Radius, Space, staggerDelay, Tints, TintName } from '../../theme';
import type { CollectionId } from '../../utils/Collections';
import type { PinnedItem } from '../../utils/PinnedItems';

// ─── Find quickly ───────────────────────────────────────────────────────────

/** How each collection looks on Home. */
export const TILE_LOOK: Record<CollectionId, { icon: IconName; tint: TintName; labelKey: StringKey; hintKey: StringKey }> = {
  id: { icon: 'idCard', tint: 'id', labelKey: 'collection.id', hintKey: 'collection.idHint' },
  bill: { icon: 'bill', tint: 'bill', labelKey: 'collection.bills', hintKey: 'collection.billsHint' },
  medicine: { icon: 'medicine', tint: 'medicine', labelKey: 'collection.medicine', hintKey: 'collection.medicineHint' },
  bank: { icon: 'bank', tint: 'bank', labelKey: 'collection.bank', hintKey: 'collection.bankHint' },
  screenshot: {
    icon: 'screenshot',
    tint: 'screenshot',
    labelKey: 'collection.screenshots',
    hintKey: 'collection.screenshotsHint',
  },
  family: { icon: 'family', tint: 'family', labelKey: 'collection.family', hintKey: 'collection.familyHint' },
};

/** The order of the tiles: papers people hunt for first, then photos. */
export const TILE_ORDER: CollectionId[] = ['id', 'bill', 'medicine', 'bank', 'screenshot', 'family'];

const STRIP_HEIGHT = 112;
const PHOTO = 76;

export interface CollectionTileProps {
  id: CollectionId;
  /** Up to three of the person's photos in this collection. */
  photos: string[];
  /** Files found; null while counting or when it can't be counted. */
  count: number | null;
  capped?: boolean;
  /** Position in the grid, for the entrance stagger. */
  index: number;
  onPress: (id: CollectionId) => void;
}

/** Fan positions for 1, 2 or 3 photos: [x offset, rotation, scale]. */
const FAN: Record<number, Array<[number, number, number]>> = {
  1: [[0, -4, 1]],
  2: [
    [-18, -8, 0.92],
    [16, 5, 1],
  ],
  3: [
    [-34, -10, 0.86],
    [34, 10, 0.86],
    [0, -2, 1],
  ],
};

/**
 * A "Find quickly" tile. When the person has photos of this kind, three of
 * them fan out on the tile and the lock-on corners close in on the front one,
 * once: "found these". Otherwise the category icon sits on its tint.
 */
export const CollectionTile: React.FC<CollectionTileProps> = ({ id, photos, count, capped, index, onPress }) => {
  const { t } = useStrings();
  const look = TILE_LOOK[id];
  const tint = Tints[look.tint];
  const label = t(look.labelKey);
  const hint = t(look.hintKey);
  const countText =
    count === null ? null : count === 0 ? t('collection.none') : t(capped ? 'collection.countMore' : 'collection.count', { n: count });
  const shown = photos.slice(0, 3);
  const fan = FAN[shown.length] ?? [];

  return (
    <PressableScale
      onPress={() => onPress(id)}
      accessibilityRole="button"
      accessibilityLabel={[label, countText, hint].filter(Boolean).join(', ')}
      style={styles.tile}
      testID={`collection-${id}`}
    >
      <View style={[styles.strip, { backgroundColor: tint.bg }]}>
        {shown.length > 0 ? (
          shown.map((uri, i) => {
            const [dx, rotate, scale] = fan[i];
            const front = i === shown.length - 1;
            return (
              <View
                key={uri}
                style={[
                  styles.photoFrame,
                  { transform: [{ translateX: dx }, { rotate: `${rotate}deg` }, { scale }] },
                ]}
              >
                <Thumbnail uri={uri} size={PHOTO} radius={Radius.xs} fallbackIcon={look.icon} testID={`collection-${id}-photo`} />
                {front ? (
                  <LockOnCorners size={14} thickness={2.5} radius={5} inset={6} delay={staggerDelay(index) + 120} />
                ) : null}
              </View>
            );
          })
        ) : (
          <Icon name={look.icon} size={44} color={tint.ink} strokeWidth={1.75} />
        )}
        {count !== null && count > 0 ? (
          <View style={styles.badge} testID={`collection-${id}-count`}>
            <AppText variant="labelStrong" numberOfLines={1}>
              {capped ? `${count}+` : String(count)}
            </AppText>
          </View>
        ) : null}
      </View>
      <View style={styles.tileText}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {label}
        </AppText>
        <AppText variant="small" color="textSecondary" numberOfLines={2}>
          {count === 0 ? countText : hint}
        </AppText>
      </View>
    </PressableScale>
  );
};

// ─── Important / ज़रूरी ──────────────────────────────────────────────────────

const SHELF_ITEM = 112;

export interface ImportantShelfProps {
  items: PinnedItem[];
  onOpen: (item: PinnedItem) => void;
}

/** "Important / ज़रूरी": the photos and papers the person starred. */
export const ImportantShelf: React.FC<ImportantShelfProps> = ({ items, onOpen }) => {
  const { t, lang } = useStrings();
  return (
    <View testID="important-shelf">
      <View style={styles.shelfHeader}>
        <Icon name="star" size={24} filled color={Colors.important} fillColor={Colors.importantStar} />
        <AppText variant="heading" accessibilityRole="header">
          {t('home.important')}
        </AppText>
        {lang === 'en' ? (
          // The Hindi word too, for people who read it first.
          <AppText variant="body" color="textSecondary">
            {translate('hi', 'home.important')}
          </AppText>
        ) : null}
      </View>
      {items.length === 0 ? (
        <View style={styles.shelfEmpty} testID="important-empty">
          <View style={styles.shelfEmptyIcon}>
            <Icon name="star" size={22} color={Colors.importantInk} strokeWidth={2} />
          </View>
          <AppText variant="small" color="textSecondary" style={styles.flex}>
            {t('home.importantEmpty')}
          </AppText>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shelfRow}
          testID="important-list"
        >
          {items.map((item, i) => {
            const title = item.title || t(item.kind === 'DOCUMENT' ? 'search.paper' : 'search.photo');
            return (
              <Reveal key={item.uri} index={i}>
                <PressableScale
                  onPress={() => onOpen(item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${title}, ${t('home.importantStar')}`}
                  style={styles.shelfItem}
                  testID="important-item"
                >
                  <View>
                    <Thumbnail
                      uri={item.kind === 'IMAGE' ? item.uri : null}
                      size={SHELF_ITEM}
                      fallbackIcon={item.kind === 'DOCUMENT' ? 'papers' : 'photos'}
                      style={item.kind === 'DOCUMENT' ? styles.paperThumb : undefined}
                    />
                    <View style={styles.star}>
                      <Icon name="star" size={16} filled color={Colors.important} fillColor={Colors.importantStar} />
                    </View>
                  </View>
                  <AppText variant="label" numberOfLines={1}>
                    {title}
                  </AppText>
                </PressableScale>
              </Reveal>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
};

// ─── Recently opened ────────────────────────────────────────────────────────

const RECENT_SIZE = 84;

export interface RecentRowProps {
  uris: string[];
  onOpen: (uri: string) => void;
}

/** The last photos the person opened, one tap away. */
export const RecentRow: React.FC<RecentRowProps> = ({ uris, onOpen }) => {
  const { t } = useStrings();
  if (uris.length === 0) return null;
  return (
    <View testID="recent-row">
      <AppText variant="heading" accessibilityRole="header" style={styles.sectionTitle}>
        {t('home.recent')}
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recentRow}>
        {uris.map((uri, i) => (
          <PressableScale
            key={uri}
            onPress={() => onOpen(uri)}
            accessibilityRole="button"
            accessibilityLabel={`${t('viewer.photo')}, ${t('viewer.position', { i: i + 1, n: uris.length })}`}
            testID="recent-photo"
          >
            <Thumbnail uri={uri} size={RECENT_SIZE} />
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tile: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.line,
    overflow: 'hidden',
    ...Elevation.rest,
  },
  strip: {
    height: STRIP_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoFrame: {
    position: 'absolute',
    padding: 2,
    borderRadius: Radius.xs + 2,
    backgroundColor: Colors.surface,
    ...Elevation.rest,
  },
  badge: {
    position: 'absolute',
    top: Space.sm,
    right: Space.sm,
    minWidth: 32,
    height: 28,
    paddingHorizontal: Space.sm + 2,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: {
    paddingHorizontal: Space.md + 2,
    paddingTop: Space.sm + 2,
    paddingBottom: Space.md,
  },
  shelfHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: GUTTER,
    marginBottom: Space.md,
    minHeight: 48,
  },
  shelfEmpty: {
    marginHorizontal: GUTTER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.md,
    padding: Space.lg,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.lineStrong,
    backgroundColor: Colors.surface,
  },
  shelfEmptyIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.importantSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shelfRow: { paddingHorizontal: GUTTER, gap: Space.md },
  shelfItem: { width: SHELF_ITEM, gap: Space.xs + 2 },
  paperThumb: { backgroundColor: Colors.importantSoft },
  star: {
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
  sectionTitle: { paddingHorizontal: GUTTER, marginBottom: Space.md },
  recentRow: { paddingHorizontal: GUTTER, gap: Space.sm + 2 },
});
