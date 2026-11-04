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

import { NativeModules } from 'react-native';
import { AppLogger } from '../utils/AppLogger';

const { MobileCLIPModule } = NativeModules;

/** Recent query embeddings, so retyping or picking a history item skips the encoder. */
const TEXT_CACHE_LIMIT = 64;
const textCache = new Map<string, Float32Array>();

const cacheKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

/** @internal Test helper. */
export const __clearTextCache = () => textCache.clear();

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
    if (cached) return cached;

    const rawArray: number[] = await MobileCLIPModule.encodeText(text);
    const vector = new Float32Array(rawArray);

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
 * Load the tokenizer and text encoder in the background so the first search
 * doesn't wait for the 64 MB model to load. Safe to call more than once.
 */
export const warmUpText = async (): Promise<boolean> => {
  try {
    if (!MobileCLIPModule?.warmUpText) return false;
    await MobileCLIPModule.warmUpText();
    return true;
  } catch (e) {
    AppLogger.warn('EmbeddingService', 'Text encoder warm-up failed', e);
    return false;
  }
};
