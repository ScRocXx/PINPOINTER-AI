import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Modal, ScrollView, Share, StyleSheet, TextInput, Vibration, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AppText,
  Button,
  Card,
  Icon,
  IconButton,
  ListRow,
  LockOnCorners,
  PressableScale,
  Reveal,
  Screen,
  SectionHeader,
  Tag,
  useToast,
} from '../components/ui';
import { Colors, Elevation, GUTTER, MAX_FONT_SCALE, Radius, Space, Touch, Type } from '../theme';
import { useStrings } from '../i18n';
import { RootStackParamList } from '../navigation/types';
import { analyzeImage } from '../utils/VisionPipeline';
import { AppLogger } from '../utils/AppLogger';

/** What the screen shows: the start, reading, the words, none, or a failure. */
type Phase = 'start' | 'reading' | 'text' | 'noText' | 'error';

interface Clip {
  id: number;
  text: string;
}

/** Copies kept while the app is open, never saved (they may hold private numbers). */
const MAX_CLIPS = 5;
let sessionClips: Clip[] = [];

/** Tests only: forget the copies made so far. */
export const resetScanClipsForTests = () => {
  sessionClips = [];
};

/** Waits for the screen to slide in before heavy text reading starts. */
export const AUTO_SCAN_DELAY_MS = 400;

const PICKER = { mediaType: 'photo', quality: 0.5, maxWidth: 1024, maxHeight: 1024 } as const;

export const countWords = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Read text from a photo: take one or pick one, and Pinpointer reads the
 * words (Hindi and English) on the phone. The text can be fixed, copied or
 * shared. A photo with no words says so plainly (never "Success"), with a
 * way to try again. Opened with `scanUri` (from a photo), it starts reading
 * that photo at once.
 */
export const SmartClipboardScreen: React.FC = () => {
  const route = useRoute<RouteProp<RootStackParamList, 'SmartClipboard'>>();
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { t } = useStrings();
  const toast = useToast();

  const [phase, setPhase] = useState<Phase>(route.params?.scanUri ? 'reading' : 'start');
  const [imageUri, setImageUri] = useState<string | null>(route.params?.scanUri ?? null);
  const [text, setText] = useState('');
  const [clips, setClips] = useState<Clip[]>(sessionClips);
  const [photoOpen, setPhotoOpen] = useState(false);

  // Only the latest reading may change the screen, and none after leaving it.
  const request = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async (uri: string) => {
    const id = ++request.current;
    setImageUri(uri);
    setText('');
    setPhase('reading');
    try {
      const result = await analyzeImage(uri);
      if (!alive.current || id !== request.current) {
        return;
      }
      // Labels ("dog, grass") are not words to copy: only real text counts.
      if (result.detection_type === 'TEXT' && result.raw_text.trim()) {
        setText(result.raw_text.trim());
        setPhase('text');
        Vibration.vibrate(30);
      } else {
        setPhase('noText');
      }
    } catch (e) {
      AppLogger.error('Scan', 'Could not read the photo', e);
      if (alive.current && id === request.current) {
        setPhase('error');
      }
    }
  }, []);

  // Opened from a photo: read it once the screen has slid in.
  const scanUri = route.params?.scanUri;
  useEffect(() => {
    if (!scanUri) {
      return;
    }
    navigation.setParams({ scanUri: undefined });
    const timer = setTimeout(() => read(scanUri), AUTO_SCAN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [navigation, read, scanUri]);

  // The picker reports "no camera" or "not allowed" as a result, not an
  // error: say so, instead of a button that seems to do nothing.
  const takePhoto = async () => {
    try {
      const result = await launchCamera({ ...PICKER, saveToPhotos: false });
      const uri = result.assets?.[0]?.uri;
      if (uri) {
        read(uri);
      } else if (result.errorCode) {
        AppLogger.warn('Scan', `Camera did not open: ${result.errorCode}`, result.errorMessage);
        toast.show(t('scan.cameraFailed'), { icon: 'alert', duration: 5000 });
      }
    } catch (e) {
      AppLogger.error('Scan', 'Camera failed', e);
      toast.show(t('scan.cameraFailed'), { icon: 'alert', duration: 5000 });
    }
  };

  const pickPhoto = async () => {
    try {
      const result = await launchImageLibrary(PICKER);
      const uri = result.assets?.[0]?.uri;
      if (uri) {
        read(uri);
      } else if (result.errorCode) {
        AppLogger.warn('Scan', `Photos did not open: ${result.errorCode}`, result.errorMessage);
        toast.show(t('scan.pickFailed'), { icon: 'alert', duration: 5000 });
      }
    } catch (e) {
      AppLogger.error('Scan', 'Gallery picker failed', e);
      toast.show(t('scan.pickFailed'), { icon: 'alert', duration: 5000 });
    }
  };

  const copy = (value: string) => {
    const clean = value.trim();
    if (!clean) {
      return;
    }
    Clipboard.setString(clean);
    Vibration.vibrate(30);
    toast.show(t('common.copied'), { icon: 'copy' });
    sessionClips = [{ id: Date.now(), text: clean }, ...sessionClips.filter(c => c.text !== clean)].slice(0, MAX_CLIPS);
    setClips(sessionClips);
  };

  const share = async () => {
    const clean = text.trim();
    if (!clean) {
      return;
    }
    try {
      await Share.share({ message: clean });
    } catch (e) {
      AppLogger.warn('Scan', 'Share failed', e);
    }
  };

  const startOver = () => {
    request.current += 1;
    setPhase('start');
    setImageUri(null);
    setText('');
  };

  const close = () => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
    } else {
      navigation.navigate('Main');
    }
  };

  const words = countWords(text);

  return (
    <Screen wash padBottom testID="scan-screen">
      <View style={styles.header}>
        <IconButton icon="close" label={t('common.close')} onPress={close} style={styles.close} testID="scan-close" />
        <AppText variant="heading" accessibilityRole="header" align="center" numberOfLines={2} style={styles.flex}>
          {t('scan.title')}
        </AppText>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="scan-scroll">
        {phase === 'start' ? (
          <>
            <Reveal>
              <View style={[styles.stage, styles.stageStart]} testID="scan-start">
                <View style={styles.startFrame}>
                  <LockOnCorners size={30} thickness={4} radius={12} inset={0} delay={160} />
                  <Icon name="readText" size={56} color={Colors.primary} strokeWidth={1.6} />
                </View>
              </View>
            </Reveal>
            <AppText variant="body" color="textSecondary" style={styles.intro}>
              {t('scan.intro')}
            </AppText>
            <View style={styles.tags}>
              <Tag label={t('scan.languages')} tone="bank" icon="language" />
            </View>
            <View style={styles.actions}>
              <Button label={t('scan.takePhoto')} icon="camera" variant="beam" block onPress={takePhoto} testID="scan-camera" />
              <Button label={t('scan.pickPhoto')} icon="photos" variant="secondary" block onPress={pickPhoto} testID="scan-gallery" />
            </View>

            {clips.length > 0 ? (
              <>
                <SectionHeader title={t('scan.copiedBefore')} style={styles.clipsHeader} />
                <Card flush testID="scan-clips">
                  {clips.map((clip, i) => (
                    <ListRow
                      key={clip.id}
                      icon="copy"
                      title={clip.text}
                      accessibilityLabel={t('scan.copyAgain', { text: clip.text })}
                      onPress={() => copy(clip.text)}
                      chevron={false}
                      last={i === clips.length - 1}
                      testID={`scan-clip-${i}`}
                    />
                  ))}
                </Card>
              </>
            ) : null}
          </>
        ) : null}

        {phase !== 'start' && imageUri ? (
          <PressableScale
            onPress={() => setPhotoOpen(true)}
            pressedScale={0.985}
            disabled={phase === 'reading'}
            accessibilityRole="imagebutton"
            accessibilityLabel={t('scan.viewPhoto')}
            style={styles.stage}
            testID="scan-photo"
          >
            <Image source={{ uri: imageUri }} style={StyleSheet.absoluteFill} resizeMode="cover" testID="scan-photo-image" />
            {phase === 'noText' || phase === 'error' ? <View style={styles.dim} /> : null}
            {phase === 'reading' || phase === 'text' ? (
              <View style={styles.lockArea} pointerEvents="none">
                <LockOnCorners
                  key={phase}
                  searching={phase === 'reading'}
                  size={30}
                  thickness={4}
                  radius={12}
                  inset={0}
                  testID="scan-lock"
                />
              </View>
            ) : null}
          </PressableScale>
        ) : null}

        {phase === 'reading' ? (
          <View style={styles.reading} accessibilityLiveRegion="polite" testID="scan-reading">
            <AppText variant="bodyStrong" align="center">
              {t('scan.reading')}
            </AppText>
            <Tag label={t('scan.languages')} tone="bank" icon="language" />
          </View>
        ) : null}

        {phase === 'text' ? (
          <>
            <Reveal index={0}>
              <View style={styles.tags}>
                <Tag label={t('scan.languages')} tone="bank" icon="language" />
                <Tag
                  label={words === 1 ? t('scan.oneWord') : t('scan.words', { n: words })}
                  tone="found"
                  icon="check"
                  testID="scan-words"
                />
              </View>
            </Reveal>
            <Reveal index={1}>
              <Card style={styles.textCard} testID="scan-text-card">
                <AppText variant="heading" accessibilityRole="header">
                  {t('scan.textFound')}
                </AppText>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  multiline
                  scrollEnabled={false}
                  textAlignVertical="top"
                  accessibilityLabel={t('scan.textLabel')}
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  selectionColor={Colors.primary}
                  style={styles.textInput}
                  testID="scan-text"
                />
                <AppText variant="small" color="textMuted">
                  {t('scan.editHint')}
                </AppText>
              </Card>
            </Reveal>
            <Reveal index={2}>
              <View style={styles.actions}>
                <Button
                  label={t('common.copyText')}
                  icon="copy"
                  block
                  onPress={() => copy(text)}
                  disabled={!text.trim()}
                  testID="scan-copy"
                />
                {/* One per line: two side by side wrap at large text sizes. */}
                <Button label={t('common.share')} icon="share" variant="secondary" block onPress={share} disabled={!text.trim()} testID="scan-share" />
                <Button label={t('scan.another')} icon="camera" variant="ghost" block onPress={startOver} testID="scan-another" />
              </View>
            </Reveal>
          </>
        ) : null}

        {phase === 'noText' || phase === 'error' ? (
          <Reveal>
            <View style={styles.outcome} accessibilityLiveRegion="polite" testID={phase === 'noText' ? 'scan-no-text' : 'scan-error'}>
              <View style={styles.outcomeIcon}>
                <Icon name={phase === 'noText' ? 'readText' : 'alert'} size={30} color={Colors.textSecondary} strokeWidth={1.8} />
              </View>
              <AppText variant="heading" align="center" accessibilityRole="header">
                {t(phase === 'noText' ? 'scan.noTextTitle' : 'scan.errorTitle')}
              </AppText>
              <AppText variant="body" color="textSecondary" align="center">
                {t(phase === 'noText' ? 'scan.noTextBody' : 'scan.errorBody')}
              </AppText>
              <View style={[styles.actions, styles.outcomeActions]}>
                <Button
                  label={t('common.tryAgain')}
                  icon={phase === 'noText' ? 'camera' : 'refresh'}
                  block
                  onPress={phase === 'noText' || !imageUri ? takePhoto : () => read(imageUri)}
                  testID="scan-retry"
                />
                <Button label={t('scan.pickAnother')} icon="photos" variant="secondary" block onPress={pickPhoto} testID="scan-pick-another" />
              </View>
            </View>
          </Reveal>
        ) : null}
      </ScrollView>

      <PhotoModal uri={photoOpen ? imageUri : null} onClose={() => setPhotoOpen(false)} />
    </Screen>
  );
};

/** The whole photo on the night stage, to check what was read. */
const PhotoModal: React.FC<{ uri: string | null; onClose: () => void }> = ({ uri, onClose }) => {
  const { t } = useStrings();
  const insets = useSafeAreaInsets();
  if (!uri) {
    return null;
  }
  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose} testID="scan-photo-modal">
      <View style={styles.night}>
        <Image source={{ uri }} style={styles.nightImage} resizeMode="contain" accessibilityIgnoresInvertColors />
        <IconButton
          icon="close"
          label={t('common.close')}
          variant="onNight"
          onPress={onClose}
          style={[styles.nightClose, { top: insets.top + Space.sm }]}
          testID="scan-photo-close"
        />
      </View>
    </Modal>
  );
};

const STAGE_HEIGHT = 236;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: GUTTER - Space.xs,
    paddingTop: Space.sm,
    paddingBottom: Space.md,
  },
  close: { backgroundColor: Colors.surface, ...Elevation.rest },
  headerSpacer: { width: Touch.min },
  content: { paddingHorizontal: GUTTER, paddingBottom: Space.huge, gap: Space.lg },
  stage: {
    height: STAGE_HEIGHT,
    borderRadius: Radius.md,
    overflow: 'hidden',
    backgroundColor: Colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageStart: { backgroundColor: Colors.primarySoft },
  startFrame: { width: 196, height: 150, alignItems: 'center', justifyContent: 'center' },
  lockArea: { ...StyleSheet.absoluteFillObject, margin: Space.lg },
  dim: { ...StyleSheet.absoluteFillObject, backgroundColor: Colors.canvas, opacity: 0.45 },
  intro: { marginTop: -Space.xs },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
  actions: { gap: Space.md },
  clipsHeader: { marginHorizontal: -GUTTER, marginTop: Space.sm, marginBottom: -Space.sm },
  reading: { alignItems: 'center', gap: Space.md, paddingTop: Space.sm },
  textCard: { gap: Space.sm },
  textInput: {
    ...Type.body,
    color: Colors.text,
    minHeight: 120,
    padding: Space.md,
    borderRadius: Radius.sm,
    borderWidth: 1.5,
    borderColor: Colors.line,
    backgroundColor: Colors.canvas,
  },
  outcome: { alignItems: 'center', gap: Space.sm, paddingTop: Space.sm },
  outcomeIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    backgroundColor: Colors.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Space.xs,
  },
  outcomeActions: { alignSelf: 'stretch', marginTop: Space.lg },
  night: { flex: 1, backgroundColor: Colors.night, justifyContent: 'center' },
  nightImage: { width: '100%', height: '80%' },
  nightClose: { position: 'absolute', right: GUTTER },
});
