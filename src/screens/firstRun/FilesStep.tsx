import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText, Button, IconButton } from '../../components/ui';
import { useStrings } from '../../i18n';
import { Space } from '../../theme';
import type { DocumentAccessApi } from '../../hooks/useStorageAccess';
import { PapersArt } from './FirstRunArt';
import { CheckPoints, Notice, NumberedSteps } from './Points';
import { StepDotsProps, StepFrame } from './StepFrame';

export interface FilesStepProps {
  dots: StepDotsProps;
  direction?: 1 | -1;
  docs: DocumentAccessApi;
  onNext: () => void;
  onBack: () => void;
}

type Busy = null | 'all' | 'folder' | 'files';

/**
 * Step 3 (Android 11+): PDFs. Android calls this "All files access" and
 * shows it as a bare switch in Settings, so the step says exactly what the
 * next screen will look like before sending anyone there. Choosing one
 * folder is offered alongside, and is the only way when the build can't ask
 * for All files access.
 */
export const FilesStep: React.FC<FilesStepProps> = ({ dots, direction, docs, onNext, onBack }) => {
  const { t } = useStrings();
  const [busy, setBusy] = useState<Busy>(null);
  const [stillOff, setStillOff] = useState(false);

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<boolean>) => {
    setBusy(kind);
    let ok = false;
    try {
      ok = await action();
    } finally {
      setBusy(null);
    }
    if (ok) {
      onNext();
    } else if (kind === 'all') {
      setStillOff(true);
    }
  };

  const allowAll = () => run('all', async () => (await docs.allowAll()) === 'all');
  const chooseFolder = () => run('folder', docs.chooseFolder);
  const pickFiles = () => run('files', async () => (await docs.pickFiles()) > 0);

  const actions = docs.canAskAll ? (
    <>
      <Button label={t('onboarding.allowFiles')} icon="open" onPress={allowAll} loading={busy === 'all'} block testID="first-run-allow-files" />
      <Button
        label={t('onboarding.chooseFolder')}
        icon="folder"
        onPress={chooseFolder}
        loading={busy === 'folder'}
        variant="secondary"
        block
        testID="first-run-choose-folder"
      />
      <Button label={t('common.notNow')} onPress={onNext} variant="ghost" block testID="first-run-skip-files" />
    </>
  ) : (
    <>
      <Button
        label={t('onboarding.chooseFolderOnly')}
        icon="folder"
        onPress={chooseFolder}
        loading={busy === 'folder'}
        block
        testID="first-run-choose-folder"
      />
      <Button
        label={t('onboarding.pickPdfs')}
        icon="papers"
        onPress={pickFiles}
        loading={busy === 'files'}
        variant="secondary"
        block
        testID="first-run-pick-pdfs"
      />
      <Button label={t('common.notNow')} onPress={onNext} variant="ghost" block testID="first-run-skip-files" />
    </>
  );

  return (
    <StepFrame
      testID="first-run-files"
      direction={direction}
      dots={dots}
      top={<IconButton icon="back" label={t('common.back')} onPress={onBack} testID="first-run-back" />}
      actions={actions}
    >
      {stillOff ? null : <PapersArt />}
      <View style={styles.text}>
        <AppText variant="title" accessibilityRole="header">
          {t('onboarding.filesTitle')}
        </AppText>
        <AppText variant="body" color="textSecondary">
          {docs.canAskAll ? t('onboarding.filesBody') : t('onboarding.filesFolderBody')}
        </AppText>
      </View>
      {stillOff ? (
        <Notice title={t('onboarding.filesStillOff')} testID="first-run-files-still-off" />
      ) : (
        <CheckPoints
          points={
            docs.canAskAll
              ? [t('onboarding.filesPoint1'), t('onboarding.filesPoint2'), t('onboarding.filesPoint3')]
              : [t('onboarding.filesPoint2'), t('onboarding.filesPoint3')]
          }
        />
      )}
      {docs.canAskAll ? (
        <Notice title={t('onboarding.filesGuideTitle')} icon="settings" testID="first-run-files-guide">
          <NumberedSteps steps={[t('onboarding.filesGuide1'), t('onboarding.filesGuide2')]} />
        </Notice>
      ) : null}
    </StepFrame>
  );
};

const styles = StyleSheet.create({
  text: { gap: Space.sm + 2 },
});
