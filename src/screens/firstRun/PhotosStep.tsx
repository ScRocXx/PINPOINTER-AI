import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, IconButton } from '../../components/ui';
import { useStrings } from '../../i18n';
import { Space } from '../../theme';
import type { PhotoAccessApi } from '../../hooks/useStorageAccess';
import { photoSettingsWording } from '../../utils/StoragePermissions';
import { PhotosArt } from './FirstRunArt';
import { CheckPoints, Notice, NumberedSteps } from './Points';
import { StepDotsProps, StepFrame } from './StepFrame';

export interface PhotosStepProps {
  dots: StepDotsProps;
  direction?: 1 | -1;
  photos: PhotoAccessApi;
  onNext: () => void;
  onBack: () => void;
}

/** ask: first time; denied: they said no once; blocked: Android won't show the dialog again. */
type Phase = 'ask' | 'denied' | 'blocked';

/**
 * Step 2: photo access, explained before Android's dialog appears. "Select
 * photos" (Android 14+) is accepted as it is; the next step and Home offer
 * to allow the rest. A "no" never traps anyone: Not now always moves on.
 */
export const PhotosStep: React.FC<PhotosStepProps> = ({ dots, direction, photos, onNext, onBack }) => {
  const { t } = useStrings();
  const wording = photoSettingsWording();
  const [phase, setPhase] = useState<Phase>(photos.access === 'blocked' ? 'blocked' : 'ask');
  const [busy, setBusy] = useState(false);

  // The first check can finish after the step opens.
  useEffect(() => {
    if (photos.access === 'blocked') {
      setPhase('blocked');
    }
  }, [photos.access]);

  const allow = async () => {
    setBusy(true);
    let result;
    try {
      result = phase === 'blocked' ? await photos.openSettings() : await photos.request();
    } finally {
      setBusy(false);
    }
    if (result === 'full' || result === 'limited') {
      onNext();
    } else {
      // Back from Settings without turning it on still reads as "denied", but
      // Android won't show its dialog again, so keep the Settings steps.
      setPhase(result === 'blocked' || phase === 'blocked' ? 'blocked' : 'denied');
    }
  };

  return (
    <StepFrame
      testID="first-run-photos"
      direction={direction}
      dots={dots}
      top={<IconButton icon="back" label={t('common.back')} onPress={onBack} testID="first-run-back" />}
      actions={
        <>
          <Button
            label={phase === 'blocked' ? t('perm.openSettings') : t('onboarding.allowPhotos')}
            icon={phase === 'blocked' ? 'open' : undefined}
            onPress={allow}
            loading={busy}
            block
            testID="first-run-allow-photos"
          />
          <Button label={t('common.notNow')} onPress={onNext} variant="ghost" block testID="first-run-skip-photos" />
        </>
      }
    >
      {/* Once Android says no, the steps matter more than the picture. */}
      {phase === 'ask' ? <PhotosArt /> : null}
      <View style={styles.text}>
        <AppText variant="title" accessibilityRole="header">
          {t('onboarding.photosTitle')}
        </AppText>
        <AppText variant="body" color="textSecondary">
          {t('onboarding.photosBody')}
        </AppText>
      </View>
      {phase === 'ask' ? (
        <CheckPoints
          points={[t('onboarding.photosPoint1'), t('onboarding.photosPoint2'), t('onboarding.photosPoint3')]}
        />
      ) : phase === 'denied' ? (
        <Notice
          title={t('onboarding.photosDeniedTitle')}
          body={t('onboarding.photosDeniedBody')}
          testID="first-run-photos-denied"
        />
      ) : (
        <Notice
          title={t('onboarding.photosBlockedTitle')}
          body={t('onboarding.photosBlockedBody')}
          icon="settings"
          testID="first-run-photos-blocked"
        >
          <NumberedSteps
            steps={[
              t('onboarding.settingsStep1'),
              t(wording.list === 'photos' ? 'onboarding.photosStep2' : 'onboarding.photosStep2Files'),
              t(wording.choice === 'allowAll' ? 'onboarding.photosStep3' : 'onboarding.photosStep3Allow'),
            ]}
          />
        </Notice>
      )}
    </StepFrame>
  );
};

const styles = StyleSheet.create({
  text: { gap: Space.sm + 2 },
});
