import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Screen } from '../components/ui';
import { RootStackParamList } from '../navigation/types';
import { useDocumentAccess, usePhotoAccess } from '../hooks/useStorageAccess';
import { allFilesAccessApplies } from '../utils/StoragePermissions';
import { markFirstRunDone } from '../utils/FirstRun';
import { WelcomeStep } from './firstRun/WelcomeStep';
import { PhotosStep } from './firstRun/PhotosStep';
import { FilesStep } from './firstRun/FilesStep';
import { ReadyStep } from './firstRun/ReadyStep';

export type FirstRunStep = 'welcome' | 'photos' | 'files' | 'ready';

/** Every step this phone can need. PDFs have their own permission only on Android 11+. */
export const firstRunSteps = (): FirstRunStep[] =>
  allFilesAccessApplies() ? ['welcome', 'photos', 'files', 'ready'] : ['welcome', 'photos', 'ready'];

export interface FirstRunScreenProps {
  /** Instead of opening Home (tests, previews). */
  onFinish?: () => void;
}

/**
 * The first run: welcome, photo access, PDF access, then the first look
 * through the gallery. One thing per step, in plain words, and every step
 * can be skipped. A permission already given (say, after a reinstall) drops
 * its step before the person leaves the welcome. Android back goes one step
 * back; on the last step it opens Home, like "Start searching".
 */
export const FirstRunScreen: React.FC<FirstRunScreenProps> = ({ onFinish }) => {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const photos = usePhotoAccess();
  const docs = useDocumentAccess();
  const [steps, setSteps] = useState<FirstRunStep[]>(firstRunSteps);
  const [index, setIndex] = useState(0);
  const from = useRef(0);
  const finishing = useRef(false);

  // Drop steps for permissions already given, but only while still on the
  // welcome, so the dots never change under someone's finger.
  useEffect(() => {
    if (index !== 0) {
      return;
    }
    setSteps(
      firstRunSteps().filter(
        step => !(step === 'photos' && photos.access === 'full') && !(step === 'files' && docs.access === 'all'),
      ),
    );
  }, [docs.access, index, photos.access]);

  const goTo = useCallback(
    (next: number) => {
      from.current = index;
      setIndex(Math.max(0, Math.min(next, steps.length - 1)));
    },
    [index, steps.length],
  );

  const finish = useCallback(async () => {
    if (finishing.current) {
      return;
    }
    finishing.current = true;
    await markFirstRunDone();
    if (onFinish) {
      onFinish();
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
    }
  }, [navigation, onFinish]);

  const step = steps[index];

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (step === 'ready') {
        finish();
        return true;
      }
      if (index > 0) {
        goTo(index - 1);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [finish, goTo, index, step]);

  const dots = { index, count: steps.length, from: from.current };
  const direction: 1 | -1 = index >= from.current ? 1 : -1;
  const next = () => goTo(index + 1);
  const back = () => goTo(index - 1);

  return (
    <Screen testID="first-run-screen" padBottom>
      {step === 'welcome' ? (
        <WelcomeStep key="welcome" dots={dots} direction={direction} onNext={next} />
      ) : step === 'photos' ? (
        <PhotosStep key="photos" dots={dots} direction={direction} photos={photos} onNext={next} onBack={back} />
      ) : step === 'files' ? (
        <FilesStep key="files" dots={dots} direction={direction} docs={docs} onNext={next} onBack={back} />
      ) : (
        <ReadyStep key="ready" dots={dots} direction={direction} photos={photos} docs={docs} onFinish={finish} />
      )}
    </Screen>
  );
};
