/**
 * VoiceHotwords — the words the Hindi speech model listens for (sherpa-onnx
 * hotwords), in two groups:
 *
 *  - Built-in words: what people search for in any gallery (आधार, गैस,
 *    वोटर, पर्ची, दिवाली...), taken from the app's own concept table and
 *    festival names, so they work on a new phone and for people whose papers
 *    are all in English. Single words only, without spelling doubles
 *    (फोन / फ़ोन, जांच / जाँच).
 *  - The person's own words: Hindi words in at least two of their papers, with
 *    three letters or more (one-off OCR misreadings stay out), read from the
 *    search index itself (fts5vocab, on the read connection; nothing stored).
 *    A name, a shop or a company is exactly what a general model mishears
 *    ("एल आई सी" for "एलआईसी").
 *
 * The native side boosts the two differently (SpeechText.kt): own words 1.5,
 * built-in words 1.0. Measured on synthetic speech
 * (research/experiments/hindi-seeds.exp.py): a common word at 1.5 does harm
 * ("आधार" turned "आधार कार्ड" into "आधार कार" and "आधा किलो" into "आधार
 * किलो"), at 1.0 it does not and still helps; names need 1.5. So an own word
 * that sounds like a built-in word is left to the built-in list.
 */
import { NativeModules } from 'react-native';
import { loadVocabularyRange, type VocabularyRow } from '../database/vocabulary';
import { AppLogger } from '../utils/AppLogger';
import { CONCEPTS } from '../utils/ConceptTable';
import { festivalNames } from '../utils/DateQuery';
import { bhashaKey } from '../utils/IndicText';

/**
 * Most own words given to the model. With the built-in words (about 125) the
 * total stays near 200: up to 200 hotwords changed nothing that was right in
 * tests, 500 did (SpeechText.kt holds the final cap).
 */
export const MAX_OWN_HOTWORDS = 80;
export const MIN_DOCS = 2;
export const MIN_LETTERS = 3;
/** Re-read the words at most this often (the index grows while photos are read). */
export const REFRESH_AFTER_MS = 30 * 60 * 1000;
/** Words read from the index before choosing. */
const READ_LIMIT = 2000;

/** Devanagari letters and signs only: no digits, no danda, no other script, no space. */
const DEVANAGARI_WORD = /^[\u0900-\u0963\u0971-\u097F]+$/;

/** English words Hindi speakers say for papers, as the Hindi model writes them. */
const LOANWORDS = ['कार्ड', 'पॉलिसी', 'स्टेटमेंट', 'रिचार्ज', 'पेमेंट', 'स्क्रीनशॉट'];

let seeds: string[] | null = null;
let seedKeys: Set<string> | null = null;

/** One spelling for doubles that differ only by a nukta or chandrabindu (फ़ोन / फोन, जाँच / जांच). */
const plainSpelling = (word: string): string => word.normalize('NFD').replace(/\u093C/g, '').replace(/\u0901/g, '\u0902').normalize('NFC');

/**
 * The built-in words: the single Devanagari words of the concept table, then
 * loanwords, then festival names (the first ones matter most: the native cap
 * cuts from the end).
 */
export const seedHotwords = (): string[] => {
  if (seeds) return seeds;
  const out: string[] = [];
  const spellings = new Set<string>();
  const keys = new Set<string>();
  for (const raw of [...CONCEPTS.flatMap(c => c.words), ...LOANWORDS, ...festivalNames()]) {
    const word = raw.normalize('NFC');
    if (!DEVANAGARI_WORD.test(word)) continue;
    const spelling = plainSpelling(word);
    if (spellings.has(spelling)) continue;
    spellings.add(spelling);
    keys.add(bhashaKey(word) || word);
    out.push(word);
  }
  seeds = out;
  seedKeys = keys;
  return out;
};

const soundsLikeSeed = (word: string): boolean => {
  seedHotwords();
  return seedKeys!.has(bhashaKey(word) || word);
};

/** The person's own hotwords among the index's words (most common first), without the built-in ones. Pure. */
export const hotwordsFrom = (rows: ReadonlyArray<VocabularyRow>): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { term, docs } of rows) {
    if (docs < MIN_DOCS) continue;
    const word = term.normalize('NFC');
    if (!DEVANAGARI_WORD.test(word)) continue;
    if ((word.match(/\p{L}/gu) ?? []).length < MIN_LETTERS) continue;
    if (seen.has(word) || soundsLikeSeed(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= MAX_OWN_HOTWORDS) break;
  }
  return out;
};

let lastRefresh = 0;

/** Hands the Hindi model its words: the person's own, then the built-in ones. Resolves how many it took. */
export const refreshHotwords = async (now: number = Date.now()): Promise<number> => {
  lastRefresh = now;
  const own = hotwordsFrom(await loadVocabularyRange('\u0900', '\u0980', MIN_DOCS, READ_LIMIT));
  const builtIn = seedHotwords();
  const taken = await NativeModules.SherpaOnnxModule?.setHotwords?.(own, builtIn);
  const count = typeof taken === 'number' ? taken : own.length + builtIn.length;
  AppLogger.info('VoiceHotwords', `Hindi voice listens for ${count} words (${own.length} of your own)`);
  return count;
};

/** refreshHotwords, unless it ran in the last REFRESH_AFTER_MS. Never throws. */
export const refreshHotwordsIfStale = (now: number = Date.now()): void => {
  if (lastRefresh > 0 && now - lastRefresh < REFRESH_AFTER_MS) return;
  refreshHotwords(now).catch(e => AppLogger.warn('VoiceHotwords', 'Could not give the Hindi model its words', e));
};

/** @internal Test helper. */
export const __resetVoiceHotwords = () => {
  lastRefresh = 0;
};
