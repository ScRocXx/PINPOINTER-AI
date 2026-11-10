import React from 'react';
import { StyleSheet, View } from 'react-native';
import {
  AppText,
  Button,
  Card,
  Icon,
  ListRow,
  LockOnCorners,
  PinMark,
  ProgressRing,
  Reveal,
} from '../../components/ui';
import { formatCount, useStrings } from '../../i18n';
import { Colors, Elevation, Radius, Space } from '../../theme';
import { StepDotsProps, StepFrame } from './StepFrame';

const RING = 208;
const RING_THICKNESS = 14;

const PHOTOS_TINT = { bg: Colors.primarySoft, ink: Colors.onPrimarySoft };
const PAPERS_TINT = { bg: Colors.sunken, ink: Colors.text };
const CHARGING_TINT = { bg: Colors.successSoft, ink: Colors.success };

export interface ReadyViewProps {
  dots: StepDotsProps;
  direction?: 1 | -1;
  photos: {
    /** Pinpointer may read photos (all, or the ones picked). */
    allowed: boolean;
    /** Photos read so far. */
    done: number;
    /** Every photo it can see; null while counting. */
    total: number | null;
    /** Photos are being read, or waiting their turn. */
    busy: boolean;
    /** The first look through every photo has finished. */
    finished: boolean;
  };
  papers: {
    allowed: boolean;
    /** While running: done in this pass; otherwise PDFs ready. */
    done: number;
    /** This pass's PDFs while running. */
    total: number | null;
    running: boolean;
    /** Waiting behind the photos. */
    waiting: boolean;
  };
  /** The "only some photos" banner, when it applies. */
  banner?: React.ReactNode;
  onAllowPhotos: () => void;
  onAllowPapers: () => void;
  onFinish: () => void;
}

/**
 * The last step as a picture of the numbers it's given: a beam ring with
 * "1,240 of 2,400 photos", a short line, and one row each for photos,
 * papers and charging-time work. No data of its own (see ReadyStep).
 */
export const ReadyView: React.FC<ReadyViewProps> = ({
  dots,
  direction,
  photos,
  papers,
  banner,
  onAllowPhotos,
  onAllowPapers,
  onFinish,
}) => {
  const { t } = useStrings();
  const { done, total, busy } = photos;
  const allDone = photos.finished || (!busy && total !== null && total > 0 && done >= total);
  const shownTotal = allDone ? Math.max(done, total ?? 0) : total;
  const noPhotos = photos.allowed && !busy && !photos.finished && total === 0;
  const showRing = photos.allowed && !noPhotos;

  const title = !photos.allowed
    ? t('onboarding.readyTitleOff')
    : noPhotos
      ? t('onboarding.noPhotosTitle')
      : allDone
        ? t('progress.allPhotosReady', { total: shownTotal ?? done })
        : t('progress.photosTitle');
  const body = !photos.allowed
    ? t('onboarding.readyBodyOff')
    : noPhotos
      ? t('onboarding.noPhotosBody')
      : allDone
        ? t('onboarding.doneBody')
        : t('onboarding.readyBody');

  const photoRow = !photos.allowed
    ? t('onboarding.rowOff')
    : allDone
      ? t('onboarding.rowPhotosDone', { total: shownTotal ?? done })
      : total === null || (done === 0 && !busy)
        ? t('onboarding.rowReadingStart')
        : t('onboarding.rowReading', { done, total });

  const papersRow = !papers.allowed
    ? t('onboarding.rowOff')
    : papers.running && papers.total
      ? t('onboarding.rowPapersReading', { done: papers.done, total: papers.total })
      : papers.waiting || papers.running || busy
        ? t('onboarding.rowPapersWaiting')
        : papers.done > 0
          ? t('onboarding.rowPapersDone', { n: papers.done })
          : t('onboarding.rowPapersNone');

  return (
    <StepFrame
      testID="first-run-ready"
      direction={direction}
      dots={dots}
      actions={<Button label={t('onboarding.startSearching')} onPress={onFinish} block testID="first-run-finish" />}
    >
      <View style={styles.hero}>
        {showRing ? (
          <ProgressRing
            value={allDone ? 1 : total ? done / total : 0}
            size={RING}
            thickness={RING_THICKNESS}
            accessibilityLabel={
              total === null ? t('onboarding.counting') : t('onboarding.ringLabel', { done, total: shownTotal ?? total })
            }
            testID="first-run-ring"
          >
            <View style={styles.ringFace} />
            {allDone ? (
              <View style={styles.ringCenter} testID="first-run-ring-done">
                <Icon name="check" size={64} color={Colors.success} strokeWidth={2.5} />
                <LockOnCorners inset={18} />
              </View>
            ) : (
              <View style={styles.ringCenter}>
                <AppText variant="numeral" align="center" testID="first-run-count">
                  {total === null ? '…' : formatCount(done)}
                </AppText>
                <AppText variant="small" color="textSecondary" align="center" style={styles.ringLabel}>
                  {total === null ? t('onboarding.counting') : t('onboarding.ringOf', { total })}
                </AppText>
              </View>
            )}
          </ProgressRing>
        ) : (
          <View style={styles.markBox} testID="first-run-mark">
            <PinMark size={96} background={Colors.sunken} />
            <LockOnCorners inset={-8} delay={200} />
          </View>
        )}
      </View>

      <View style={styles.text}>
        <AppText variant="title" align="center" accessibilityRole="header" accessibilityLiveRegion="polite">
          {title}
        </AppText>
        <AppText variant="body" color="textSecondary" align="center">
          {body}
        </AppText>
      </View>

      {banner}

      <Reveal index={1}>
        <Card flush>
          <ListRow
            icon="photos"
            iconTint={PHOTOS_TINT}
            title={t('tab.photos')}
            subtitle={photoRow}
            trailing={
              photos.allowed ? undefined : (
                <Button
                  label={t('onboarding.allow')}
                  onPress={onAllowPhotos}
                  variant="secondary"
                  size="compact"
                  testID="first-run-row-allow-photos"
                />
              )
            }
            testID="first-run-row-photos"
          />
          <ListRow
            icon="papers"
            iconTint={PAPERS_TINT}
            title={t('tab.papers')}
            subtitle={papersRow}
            trailing={
              papers.allowed ? undefined : (
                <Button
                  label={t('onboarding.allow')}
                  onPress={onAllowPapers}
                  variant="secondary"
                  size="compact"
                  testID="first-run-row-allow-papers"
                />
              )
            }
            testID="first-run-row-papers"
          />
          <ListRow
            icon="refresh"
            iconTint={CHARGING_TINT}
            title={t('progress.keepsGoing')}
            subtitle={t('progress.keepsGoingBody')}
            last
          />
        </Card>
      </Reveal>
    </StepFrame>
  );
};

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingTop: Space.lg },
  ringFace: {
    position: 'absolute',
    top: RING_THICKNESS,
    left: RING_THICKNESS,
    right: RING_THICKNESS,
    bottom: RING_THICKNESS,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    ...Elevation.rest,
  },
  ringCenter: { alignItems: 'center', justifyContent: 'center' },
  ringLabel: { maxWidth: RING - 2 * RING_THICKNESS - Space.xxl },
  markBox: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: Colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { gap: Space.sm + 2 },
});
