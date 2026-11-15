/**
 * VoiceHotwords — the Hindi words of the person's own papers, given to the
 * Hindi speech model so it listens for them (sherpa-onnx hotwords).
 *
 * A name, a shop, a medicine or a company the person has papers about is
 * exactly what a general model mishears ("बी एस सी एस" for "बीएसईएस"). The
 * words come from the search index itself (fts5vocab, on the read connection):
 * nothing is stored, and the same words then find the paper. Only words in at
 * least two papers (one-off OCR misreadings stay out), with three letters or
 * more, at most MAX_HOTWORDS: up to 200 changed nothing on 16 everyday
 * queries in two runs on synthetic speech; at 500 one turned "पर्ची" into
 * "पारची" (research/experiments/hindi-voice.exp.py). The native side applies
 * the same limits again (SpeechText.kt).
 */
import { NativeModules } from 'react-native';
import { loadVocabularyRange, type VocabularyRow } from '../database/vocabulary';
import { AppLogger } from '../utils/AppLogger';

export const MAX_HOTWORDS = 200;
export const MIN_DOCS = 2;
export const MIN_LETTERS = 3;
/** Re-read the words at most this often (the index grows while photos are read). */
export const REFRESH_AFTER_MS = 30 * 60 * 1000;
/** Words read from the index before choosing. */
const READ_LIMIT = 2000;

/** Devanagari letters and signs only: no digits, no danda, no other script. */
const DEVANAGARI_WORD = /^[ऀ-ॣॱ-ॿ]+$/;

/** The hotwords among the index's words (most common first). Pure. */
export const hotwordsFrom = (rows: ReadonlyArray<VocabularyRow>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { term, docs } of rows) {
    if (docs < MIN_DOCS) continue;
    const word = term.normalize('NFC');
    if (!DEVANAGARI_WORD.test(word)) continue;
    if ((word.match(/\p{L}/gu) ?? []).length < MIN_LETTERS) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= MAX_HOTWORDS) break;
  }
  return out;
};

let lastRefresh = 0;

/** Reads the words and hands them to the Hindi model. Resolves how many it took. */
export const refreshHotwords = async (now: number = Date.now()): Promise<number> => {
  lastRefresh = now;
  const words = hotwordsFrom(await loadVocabularyRange('ऀ', 'ঀ', MIN_DOCS, READ_LIMIT));
  const taken = await NativeModules.SherpaOnnxModule?.setHotwords?.(words);
  AppLogger.info('VoiceHotwords', `Hindi voice listens for ${typeof taken === 'number' ? taken : words.length} of your words`);
  return typeof taken === 'number' ? taken : words.length;
};

/** refreshHotwords, unless it ran in the last REFRESH_AFTER_MS. Never throws. */
export const refreshHotwordsIfStale = (now: number = Date.now()): void => {
  if (lastRefresh > 0 && now - lastRefresh < REFRESH_AFTER_MS) return;
  refreshHotwords(now).catch(e => AppLogger.warn('VoiceHotwords', 'Could not give the Hindi model your words', e));
};

/** @internal Test helper. */
export const __resetVoiceHotwords = () => {
  lastRefresh = 0;
};
