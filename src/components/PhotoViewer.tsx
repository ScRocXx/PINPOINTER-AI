import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Linking,
  ListRenderItemInfo,
  Modal,
  NativeModules,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText, HighlightedText, Icon, IconButton, IconName, PressableScale, useToast } from './ui';
import { Colors, Duration, Ease, Elevation, GUTTER, Radius, Space, Spring, Touch } from '../theme';
import { formatWhen, useStrings } from '../i18n';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { usePinnedItems } from '../hooks/usePinnedItems';
import { getDocumentByPath } from '../database';
import { AppLogger } from '../utils/AppLogger';

/** One photo the viewer can show. */
export interface ViewerItem {
  uri: string;
  /** When the photo was taken, in ms. */
  takenAt?: number;
  /**
   * The words already known for this photo (a search result's masked
   * content). Left out, the viewer reads them from the index.
   */
  text?: string;
}

export interface PhotoViewerProps {
  /** The photos to swipe through (newest first, as in the grid). */
  items: ReadonlyArray<ViewerItem>;
  /** Which one to open. null keeps the viewer closed. */
  index: number | null;
  onClose: () => void;
  /** Called with the photo now on screen (after a swipe). */
  onIndexChange?: (index: number) => void;
  /** "Read text": open Scan on this photo. Hidden when not given. */
  onReadText?: (uri: string) => void;
  /** Words to mark in "Text in this photo" (what the person searched for). */
  highlightTerms?: ReadonlyArray<string>;
  testID?: string;
}

/** Mask from DataMasking ("XXXX XXXX 4821"): show the "numbers hidden" note. */
const MASKED = /X{4}/;

/**
 * The photo viewer: the photo on a dark stage, a white panel with four big
 * actions (Share, Copy or Read text, Important, Gallery) and the words
 * Pinpointer read in the photo. Swipe left and right for the next photo.
 *
 * It opens with the photo growing into place and the panel rising after it;
 * Reduce Motion shows it at once.
 */
export const PhotoViewer: React.FC<PhotoViewerProps> = ({
  items,
  index,
  onClose,
  onIndexChange,
  onReadText,
  highlightTerms,
  testID = 'photo-viewer',
}) => {
  const visible = index !== null && index >= 0 && index < items.length;
  const { t, ago } = useStrings();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const { isPinned, toggle } = usePinnedItems();

  const [mounted, setMounted] = useState(visible);
  const [current, setCurrent] = useState(index ?? 0);
  const progress = useRef(new Animated.Value(0)).current;
  const starScale = useRef(new Animated.Value(1)).current;

  // Opening at a new photo jumps there.
  useEffect(() => {
    if (index !== null) {
      setCurrent(index);
    }
  }, [index]);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
    if (reduceMotion) {
      progress.setValue(visible ? 1 : 0);
      if (!visible) {
        setMounted(false);
      }
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? Duration.slow : Duration.quick,
      easing: visible ? Ease.standard : Ease.exit,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
      }
    });
    return () => anim.stop();
  }, [progress, reduceMotion, visible]);

  const item = items[Math.min(current, Math.max(items.length - 1, 0))] as ViewerItem | undefined;
  const uri = item?.uri ?? '';
  const given = item?.text;
  const record = useMemo(
    () => (uri && mounted && given === undefined ? getDocumentByPath(uri) : null),
    [given, mounted, uri],
  );
  const text =
    given !== undefined ? given.trim() : record?.detection_type === 'TEXT' ? (record.content ?? '').trim() : '';
  const known = given !== undefined || !!record;
  const pinned = !!uri && isPinned(uri);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1));
      if (next !== current && next >= 0 && next < items.length) {
        setCurrent(next);
        onIndexChange?.(next);
      }
    },
    [current, items.length, onIndexChange, width],
  );

  const share = useCallback(() => {
    if (!uri) return;
    try {
      if (Platform.OS === 'android' && NativeModules.StorageModule?.shareImage) {
        NativeModules.StorageModule.shareImage(uri.replace('file://', ''));
      } else {
        Share.share({ url: uri });
      }
    } catch (e) {
      AppLogger.warn('PhotoViewer', 'Share failed', e);
    }
  }, [uri]);

  const copy = useCallback(() => {
    if (!text) return;
    Clipboard.setString(text);
    toast.show(t('common.copied'), { icon: 'copy' });
  }, [t, text, toast]);

  const openInGallery = useCallback(() => {
    if (!uri) return;
    Linking.openURL(uri).catch(e => {
      AppLogger.warn('PhotoViewer', 'Could not open the photo', e);
      toast.show(t('viewer.openFailed'), { icon: 'alert' });
    });
  }, [t, toast, uri]);

  const togglePinned = useCallback(async () => {
    if (!uri) return;
    if (!reduceMotion) {
      starScale.setValue(0.7);
      Animated.spring(starScale, { toValue: 1, ...Spring.press, useNativeDriver: true }).start();
    }
    const now = await toggle({ uri, kind: 'IMAGE', title: record?.title ?? undefined });
    toast.show(t(now ? 'viewer.markedImportant' : 'viewer.removedImportant'), { icon: 'star' });
  }, [record?.title, reduceMotion, starScale, t, toast, toggle, uri]);

  const renderPage = useCallback(
    ({ item: page }: ListRenderItemInfo<ViewerItem>) => (
      <View style={[styles.page, { width }]}>
        <Image
          source={{ uri: page.uri }}
          resizeMode="contain"
          resizeMethod="resize"
          style={styles.photo}
          testID={`${testID}-photo`}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('viewer.photo')}
        />
      </View>
    ),
    [t, testID, width],
  );

  if (!mounted || !item) {
    return null;
  }

  const when = item.takenAt ? formatWhen(t, ago, item.takenAt) : undefined;
  const position = items.length > 1 ? t('viewer.position', { i: current + 1, n: items.length }) : undefined;
  const subtitle = [when, position].filter(Boolean).join(' · ');
  const photoScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });
  const panelY = progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [80, 60, 0] });

  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose} testID={testID}>
      {/* Only while open: the tab's own Screen sets it back on close. */}
      {visible ? <StatusBar barStyle="light-content" backgroundColor="transparent" translucent /> : null}
      <Animated.View style={[styles.stage, { opacity: progress }]}>
        <View style={[styles.header, { paddingTop: insets.top + Space.sm }]}>
          <IconButton icon="close" label={t('common.close')} variant="onNight" onPress={onClose} testID={`${testID}-close`} />
          <View style={styles.headerText}>
            <AppText variant="bodyStrong" color="onNight" accessibilityRole="header" numberOfLines={1}>
              {t('viewer.photo')}
            </AppText>
            {subtitle ? (
              <AppText variant="small" color="onNightMuted" numberOfLines={1}>
                {subtitle}
              </AppText>
            ) : null}
          </View>
          <View style={styles.headerSpacer} />
        </View>

        <Animated.View style={[styles.photoArea, { transform: [{ scale: photoScale }] }]}>
          <FlatList
            data={items as ViewerItem[]}
            renderItem={renderPage}
            keyExtractor={p => p.uri}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={Math.min(index ?? current, Math.max(items.length - 1, 0))}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={onScrollEnd}
            windowSize={3}
            initialNumToRender={1}
            maxToRenderPerBatch={1}
            removeClippedSubviews
            testID={`${testID}-pager`}
          />
        </Animated.View>

        <Animated.View
          style={[styles.panel, { paddingBottom: Space.lg + insets.bottom, transform: [{ translateY: panelY }] }]}
          testID={`${testID}-panel`}
        >
          <View style={styles.handle} />
          <View style={styles.actions}>
            <RoundAction icon="share" label={t('common.share')} onPress={share} testID={`${testID}-share`} />
            {text ? (
              <RoundAction icon="copy" label={t('common.copyText')} onPress={copy} testID={`${testID}-copy`} />
            ) : onReadText ? (
              <RoundAction
                icon="readText"
                label={t('viewer.readText')}
                hint={t('viewer.readTextHint')}
                onPress={() => onReadText(uri)}
                testID={`${testID}-read`}
              />
            ) : null}
            <Animated.View style={[styles.actionSlot, { transform: [{ scale: starScale }] }]}>
              <RoundAction
                icon="star"
                label={t('common.important')}
                hint={t(pinned ? 'viewer.unmarkImportant' : 'viewer.markImportant')}
                selected={pinned}
                onPress={togglePinned}
                testID={`${testID}-important`}
              />
            </Animated.View>
            <RoundAction
              icon="open"
              label={t('common.gallery')}
              hint={t('viewer.openGallery')}
              onPress={openInGallery}
              testID={`${testID}-gallery`}
            />
          </View>

          <View style={styles.textBlock}>
            <AppText variant="heading" accessibilityRole="header">
              {t('viewer.textInPhoto')}
            </AppText>
            {text ? (
              <>
                <ScrollView style={styles.textBox} contentContainerStyle={styles.textBoxContent} nestedScrollEnabled>
                  {highlightTerms && highlightTerms.length > 0 ? (
                    <HighlightedText text={text} terms={highlightTerms} variant="body" selectable testID={`${testID}-text`} />
                  ) : (
                    <AppText variant="body" selectable testID={`${testID}-text`}>
                      {text}
                    </AppText>
                  )}
                </ScrollView>
                {MASKED.test(text) ? (
                  <View style={styles.note}>
                    <Icon name="lock" size={18} color={Colors.textMuted} strokeWidth={2} />
                    <AppText variant="small" color="textMuted">
                      {t('viewer.hiddenNumbers')}
                    </AppText>
                  </View>
                ) : null}
              </>
            ) : (
              <AppText variant="body" color="textSecondary" testID={`${testID}-no-text`}>
                {known ? t('viewer.noText') : t('viewer.notReadYet')}
              </AppText>
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

interface RoundActionProps {
  icon: IconName;
  label: string;
  /** Spoken after the label ("Opens Scan on this photo"). */
  hint?: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
}

/** A 56dp round button with its word under it, as on the spec's viewer. */
const RoundAction: React.FC<RoundActionProps> = ({ icon, label, hint, selected, onPress, testID }) => (
  <PressableScale
    onPress={onPress}
    pressedScale={0.92}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityHint={hint}
    accessibilityState={selected === undefined ? undefined : { selected }}
    style={styles.action}
    testID={testID}
  >
    <View style={[styles.actionCircle, selected ? styles.actionCircleOn : null]}>
      <Icon
        name={icon}
        size={24}
        color={selected ? Colors.important : Colors.text}
        strokeWidth={selected ? 1.6 : 1.9}
        filled={selected}
        fillColor={Colors.importantStar}
      />
    </View>
    <AppText variant={selected ? 'labelStrong' : 'label'} color={selected ? 'importantInk' : 'text'} numberOfLines={1}>
      {label}
    </AppText>
  </PressableScale>
);

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: Colors.night },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Space.md,
    paddingBottom: Space.sm,
    gap: Space.sm,
  },
  headerText: { flex: 1, alignItems: 'center' },
  headerSpacer: { width: Touch.min },
  photoArea: { flex: 1 },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  photo: { width: '100%', height: '100%' },
  panel: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingHorizontal: GUTTER,
    paddingTop: Space.sm,
    gap: Space.lg,
    ...Elevation.raised,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: Colors.lineStrong,
  },
  actions: { flexDirection: 'row', justifyContent: 'space-around', gap: Space.sm },
  actionSlot: { flex: 1 },
  action: { flex: 1, alignItems: 'center', gap: Space.xs + 2, minHeight: Touch.comfortable },
  actionCircle: {
    width: Touch.comfortable,
    height: Touch.comfortable,
    borderRadius: Radius.pill,
    backgroundColor: Colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionCircleOn: { backgroundColor: Colors.importantSoft },
  textBlock: { gap: Space.sm },
  textBox: { maxHeight: 168, backgroundColor: Colors.canvas, borderRadius: Radius.sm },
  textBoxContent: { paddingHorizontal: Space.lg, paddingVertical: Space.md },
  note: { flexDirection: 'row', alignItems: 'center', gap: Space.xs + 2 },
});
