/**
 * EmbeddingService.ts — MobileCLIP2-S0 ONNX inference bridge.
 *
 * Wraps the native MobileCLIPModule to provide:
 *   - encodeImage(path) → Float32Array (512-dim, ~40-65ms background)
 *   - encodeText(query) → Float32Array (512-dim, ~15-25ms at search time)
 *   - warmUpText()      → loads the text encoder ahead of the first search
 *
 * Models are lazy-loaded on first call to avoid blocking app startup.
 * Native calls run on dedicated encoder threads (see MobileCLIPModule.kt).
 */

import { NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { AppLogger } from '../utils/AppLogger';

const { MobileCLIPModule } = NativeModules;

/** Recent query embeddings, so retyping or picking a history item skips the encoder. */
const TEXT_CACHE_LIMIT = 64;
const textCache = new Map<string, Float32Array>();

const cacheKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** @internal Test helper. */
export const __clearTextCache = () => textCache.clear();

// ─── Text model lifetime ─────────────────────────────────────────────────────
// The text encoder (about 64 MB) loads when search opens, not at app start,
// and is freed after TEXT_IDLE_UNLOAD_MS without a search, so a 2 GB phone
// gets the memory back. The next search loads it again (1-3 s on a slow
// phone; word results never wait for it).

/** Free the text encoder after this long without a search. */
export const TEXT_IDLE_UNLOAD_MS = 10 * 60 * 1000;

let textReady = false;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const readyListeners = new Set<() => void>();

const setTextReady = (ready: boolean) => {
  if (ready === textReady) return;
  textReady = ready;
  if (!ready) return;
  readyListeners.forEach(listener => {
    try {
      listener();
    } catch (e) {
      AppLogger.warn('EmbeddingService', 'Text model listener failed', e);
    }
  });
};

const unloadIdleText = async () => {
  idleTimer = null;
  setTextReady(false);
  try {
    if (MobileCLIPModule?.unloadText) {
      await MobileCLIPModule.unloadText();
      AppLogger.info('EmbeddingService', 'Text encoder freed after 10 minutes without a search');
    }
  } catch (e) {
    AppLogger.warn('EmbeddingService', 'Text encoder unload failed', e);
  }
};

/** A search just used the text encoder: restart the idle countdown. */
const noteTextUsed = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(unloadIdleText, TEXT_IDLE_UNLOAD_MS);
};

/** True while the text encoder is loaded (between a search and the idle unload). */
export const isTextModelReady = (): boolean => textReady;

/**
 * Called each time the text encoder finishes loading (first search, or the
 * first search after an idle unload). Returns an unsubscribe function.
 */
export const onTextModelReady = (listener: () => void): (() => void) => {
  readyListeners.add(listener);
  return () => {
    readyListeners.delete(listener);
  };
};

/** @internal Test helper. */
export const __resetTextModelState = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  textReady = false;
  readyListeners.clear();
};

/** Generate a 512-dim image embedding (runs vision encoder, ~40-65ms) */
export const encodeImage = async (imagePath: string): Promise<Float32Array | null> => {
  try {
    if (!MobileCLIPModule) {
      AppLogger.warn('EmbeddingService', 'MobileCLIPModule not available');
      return null;
    }
    const rawArray: number[] = await MobileCLIPModule.encodeImage(imagePath);
    return new Float32Array(rawArray);
  } catch (e) {
    AppLogger.warn('EmbeddingService', 'Image encoding failed', e);
    return null;
  }
};

/** Generate a 512-dim text embedding for search queries (runs text encoder, ~15-25ms) */
export const encodeText = async (text: string): Promise<Float32Array | null> => {
  try {
    if (!MobileCLIPModule) {
      AppLogger.warn('EmbeddingService', 'MobileCLIPModule not available');
      return null;
    }
    const key = cacheKey(text);
    const cached = textCache.get(key);
    if (cached) {
      if (textReady) noteTextUsed();
      return cached;
    }

    const rawArray: number[] = await MobileCLIPModule.encodeText(text);
    const vector = new Float32Array(rawArray);
    setTextReady(true);
    noteTextUsed();

    textCache.set(key, vector);
    if (textCache.size > TEXT_CACHE_LIMIT) {
      const oldest = textCache.keys().next().value;
      if (oldest !== undefined) textCache.delete(oldest);
    }
    return vector;
  } catch (e) {
    AppLogger.warn('EmbeddingService', 'Text encoding failed', e);
    return null;
  }
};

/**
 * Load the tokenizer and text encoder in the background. Search calls it when
 * it opens, so the model loads while the person types. Safe to call more than
 * once: when it is already loaded this only restarts the idle countdown.
 */
export const warmUpText = async (): Promise<boolean> => {
  try {
    if (!MobileCLIPModule?.warmUpText) return false;
    await MobileCLIPModule.warmUpText();
    setTextReady(true);
    noteTextUsed();
    return true;
  } catch (e) {
    AppLogger.warn('EmbeddingService', 'Text encoder warm-up failed', e);
    return false;
  }
};

/** The CLIP model files inside the APK (gitignored, made by scripts/export_mobileclip.py). */
export const CLIP_MODEL_ASSETS = ['models/clip/vision_encoder_int8.onnx', 'models/clip/text_encoder_int8.onnx'] as const;

/**
 * True when this build carries the CLIP models, so "search by what's in a
 * photo" works. Without them search falls back to the words in photos.
 * Only looks for the files; nothing is loaded.
 */
export const areClipModelsAvailable = async (): Promise<boolean> => {
  if (!MobileCLIPModule) return false;
  if (Platform.OS !== 'android' || typeof RNFS.existsAssets !== 'function') return true;
  try {
    const found = await Promise.all(CLIP_MODEL_ASSETS.map((path) => RNFS.existsAssets(path)));
    return found.every(Boolean);
  } catch (e) {
    AppLogger.warn('EmbeddingService', 'Could not look for the CLIP models', e);
    return false;
  }
};
