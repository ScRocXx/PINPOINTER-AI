/**
 * SpeechModel — loads the on-device speech model when voice search is first
 * used, not at every app start, in the app's language: Whisper for English
 * (about 160 MB), the small Hindi model for Hindi (about 28 MB). Asking for
 * the other language frees the first (one model in memory at a time).
 *
 * Whisper is about 160 MB of weights. Loading it 3 seconds after every
 * start held that memory for the whole session, on phones with 2–3 GB of RAM,
 * even for people who never tap the mic. Now:
 *
 * - `ensureSpeechModel(lang)` loads it on the first tap on the mic (one load
 *   at a time, however many callers) and resolves true once voice search can
 *   start. The Hindi model then gets the person's own words (VoiceHotwords).
 * - Someone who has used voice search before gets it loaded shortly after
 *   start, as before, so their mic answers at once (`warmUpForVoiceUsers`).
 *
 * A plain TypeScript singleton (no React), like IndexingService: hooks and
 * screens subscribe to its state.
 */
import { NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from '../utils/AppLogger';
import { refreshHotwordsIfStale } from './VoiceHotwords';

/** idle: not loaded yet, loads on first use. failed: the last load did not work. */
export type SpeechModelState = 'idle' | 'loading' | 'ready' | 'failed';

/** The language voice search listens in: the app's language. */
export type VoiceLanguage = 'en' | 'hi';

/** Set once this person has used voice search. */
export const VOICE_USED_KEY = 'pinpointer.voice.used';

let state: SpeechModelState = 'idle';
let loading: Promise<boolean> | null = null;
/** The language of the loaded model, and of the one loading. */
let loadedLang: VoiceLanguage | null = null;
let loadingLang: VoiceLanguage | null = null;
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

/** True when voice search can start in `lang` right away. */
export const isSpeechModelReady = (lang: VoiceLanguage): boolean => state === 'ready' && loadedLang === lang;

/** Listen for state changes. Returns an unsubscribe function. */
export const subscribeSpeechModel = (listener: (state: SpeechModelState) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * Loads the speech model for `lang` unless it is loaded already. Resolves true
 * when voice search can start, false when the model could not be loaded (a
 * later call tries again).
 */
export const ensureSpeechModel = (lang: VoiceLanguage = 'en'): Promise<boolean> => {
  if (isSpeechModelReady(lang)) {
    if (lang === 'hi') refreshHotwordsIfStale();
    return Promise.resolve(true);
  }
  if (loading) {
    if (loadingLang === lang) return loading;
    // The other language is loading: let it finish, then load this one.
    return loading.then(() => ensureSpeechModel(lang));
  }
  setState('loading');
  loadingLang = lang;
  loading = (async () => {
    try {
      AppLogger.info('SpeechModel', `Loading the speech model (${lang === 'hi' ? 'Hindi' : 'Whisper Base'})...`);
      await NativeModules.SherpaOnnxModule.initSTT(lang);
      loadedLang = lang;
      setState('ready');
      if (lang === 'hi') refreshHotwordsIfStale();
      return true;
    } catch (error) {
      AppLogger.error('SpeechModel', 'Failed to load the speech model', error);
      loadedLang = null;
      setState('failed');
      return false;
    } finally {
      loading = null;
      loadingLang = null;
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
export const warmUpForVoiceUsers = async (lang: VoiceLanguage = 'en'): Promise<boolean> => {
  try {
    if ((await AsyncStorage.getItem(VOICE_USED_KEY)) !== '1') return false;
  } catch (e) {
    AppLogger.warn('SpeechModel', 'Could not read voice search use', e);
    return false;
  }
  ensureSpeechModel(lang).catch(() => undefined);
  return true;
};

/** @internal Test helper. */
export const __resetSpeechModel = () => {
  state = 'idle';
  loading = null;
  loadedLang = null;
  loadingLang = null;
  listeners.clear();
};
