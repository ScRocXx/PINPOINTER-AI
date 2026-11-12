/**
 * SpeechModel — loads the on-device speech model (Whisper) when voice search
 * is first used, not at every app start.
 *
 * The model is about 160 MB of weights. Loading it 3 seconds after every
 * start held that memory for the whole session, on phones with 2–3 GB of RAM,
 * even for people who never tap the mic. Now:
 *
 * - `ensureSpeechModel()` loads it on the first tap on the mic (one load at a
 *   time, however many callers) and resolves true once voice search can start.
 * - Someone who has used voice search before gets it loaded shortly after
 *   start, as before, so their mic answers at once (`warmUpForVoiceUsers`).
 *
 * A plain TypeScript singleton (no React), like IndexingService: hooks and
 * screens subscribe to its state.
 */
import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from '../utils/AppLogger';

/** idle: not loaded yet, loads on first use. failed: the last load did not work. */
export type SpeechModelState = 'idle' | 'loading' | 'ready' | 'failed';

/** Set once this person has used voice search. */
export const VOICE_USED_KEY = 'pinpointer.voice.used';

let state: SpeechModelState = 'idle';
let loading: Promise<boolean> | null = null;
const listeners = new Set<(state: SpeechModelState) => void>();

const setState = (next: SpeechModelState) => {
  if (next === state) return;
  state = next;
  listeners.forEach((listener) => {
    try {
      listener(next);
    } catch (e) {
      AppLogger.warn('SpeechModel', 'Listener failed', e);
    }
  });
};

export const getSpeechModelState = (): SpeechModelState => state;

/** Listen for state changes. Returns an unsubscribe function. */
export const subscribeSpeechModel = (listener: (state: SpeechModelState) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Loads the speech model unless it is loaded already. Resolves true when
 * voice search can start, false when the model could not be loaded (a later
 * call tries again).
 */
export const ensureSpeechModel = (): Promise<boolean> => {
  if (state === 'ready') return Promise.resolve(true);
  if (loading) return loading;
  setState('loading');
  loading = (async () => {
    try {
      AppLogger.info('SpeechModel', 'Loading the speech model (Whisper Base)...');
      await NativeModules.SherpaOnnxModule.initSTT();
      setState('ready');
      return true;
    } catch (error) {
      AppLogger.error('SpeechModel', 'Failed to load the speech model', error);
      setState('failed');
      return false;
    } finally {
      loading = null;
    }
  })();
  return loading;
};

/** Remembers that this person uses voice search (see `warmUpForVoiceUsers`). */
export const noteVoiceSearchUsed = async (): Promise<void> => {
  try {
    await AsyncStorage.setItem(VOICE_USED_KEY, '1');
  } catch (e) {
    AppLogger.warn('SpeechModel', 'Could not remember voice search use', e);
  }
};

/**
 * Loads the model ahead of the first tap, only for people who have used
 * voice search before. Resolves true when a load was started.
 */
export const warmUpForVoiceUsers = async (): Promise<boolean> => {
  try {
    if ((await AsyncStorage.getItem(VOICE_USED_KEY)) !== '1') return false;
  } catch (e) {
    AppLogger.warn('SpeechModel', 'Could not read voice search use', e);
    return false;
  }
  ensureSpeechModel().catch(() => undefined);
  return true;
};

/** @internal Test helper. */
export const __resetSpeechModel = () => {
  state = 'idle';
  loading = null;
  listeners.clear();
};
