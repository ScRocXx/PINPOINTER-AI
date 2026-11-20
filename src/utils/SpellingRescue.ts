/**
 * SpellingRescue.ts — corrects a typed word against the words in the
 * person's OWN papers and photos, not a generic dictionary (which knows
 * neither "Telmisartan", nor the shop's name, nor "bijlee").
 *
 * Measured (research/experiments/typos.exp.ts): one phone-keyboard typo found
 * the intended paper only 22–31% of the time; correcting against the index
 * vocabulary recovered 96–99% as the first suggestion, and correct words were
 * never "corrected". Two ways to a correction:
 *
 *  - spelling: an indexed word within 1 edit (words up to 4 letters) or 2,
 *    in the same script;
 *  - sound: an indexed Bhasha sound key within 1 edit of the word's key. This
 *    catches Hinglish typos ("bijki" → बिजली) that are far in spelling.
 *
 * Pure: the vocabulary comes from database/vocabulary.ts and is cached by
 * services/SpellingService.ts.
 */
import { bhashaKey, containsIndic } from './IndicText';
import type { VocabularyRow } from '../database/vocabulary';

/** Tokens of the hidden search tail (sound keys, concepts, OCR keys), not words. */
const TAIL_TOKEN = /^q[kcvfj]/;
const KEY_PREFIX = 'qk';

export interface Vocabulary {
    /** Indexed words → how many papers and photos contain them. */
    words: Map<string, number>;
    wordsByLength: Map<number, string[]>;
    /** Indexed sound keys (without the `qk`) → how many contain them. */
    keys: Map<string, number>;
    keysByLength: Map<number, string[]>;
}

const addByLength = (map: Map<number, string[]>, s: string) => {
    const list = map.get(s.length);
    if (list) list.push(s);
    else map.set(s.length, [s]);
};

export const buildVocabulary = (rows: ReadonlyArray<VocabularyRow>): Vocabulary => {
    const vocab: Vocabulary = { words: new Map(), wordsByLength: new Map(), keys: new Map(), keysByLength: new Map() };
    for (const { term, docs } of rows) {
        const t = term.toLowerCase();
        if (t.startsWith(KEY_PREFIX)) {
            const key = t.slice(KEY_PREFIX.length);
            if (key.length >= 2 && !vocab.keys.has(key)) {
                vocab.keys.set(key, docs);
                addByLength(vocab.keysByLength, key);
            }
            continue;
        }
        if (TAIL_TOKEN.test(t) || !/\p{L}/u.test(t) || t.length < 2 || vocab.words.has(t)) continue;
        vocab.words.set(t, docs);
        addByLength(vocab.wordsByLength, t);
    }
    return vocab;
};

/**
 * Edit distance (insert, delete, change, swap two neighbours) between a and
 * b, or max + 1 as soon as it is clearly larger than `max`.
 */
export const editDistanceWithin = (a: string, b: string, max: number): number => {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prevPrev: number[] = [];
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prevPrev[j - 2] + 1);
            row.push(v);
            if (v < rowMin) rowMin = v;
        }
        if (rowMin > max) return max + 1;
        prevPrev = prev;
        prev = row;
    }
    return prev[b.length] <= max ? prev[b.length] : max + 1;
};

/** True when search would find `word` as it is (the word, or its sound key, is indexed). */
export const isKnownWord = (word: string, vocab: Vocabulary): boolean => {
    const w = word.toLowerCase();
    if (vocab.words.has(w)) return true;
    const key = bhashaKey(w);
    return !!key && vocab.keys.has(key);
};

export interface Correction {
    via: 'spelling' | 'sound';
    /** The indexed word (spelling). */
    word?: string;
    /** The indexed sound key (sound): a word with it is looked up separately. */
    key?: string;
    /** Edits away; a sound correction counts half an edit more. */
    distance: number;
    docs: number;
}

/** Shortest word worth correcting. */
const MIN_LETTERS = 3;

/** The best corrections for one typed word, best first; none when it is already indexed. */
export const correctionsFor = (word: string, vocab: Vocabulary, limit = 3): Correction[] => {
    const w = word.toLowerCase();
    if (w.length < MIN_LETTERS || isKnownWord(w, vocab)) return [];
    const indic = containsIndic(w);
    const out: Correction[] = [];

    const max = w.length <= 4 ? 1 : 2;
    for (let len = w.length - max; len <= w.length + max; len++) {
        for (const t of vocab.wordsByLength.get(len) ?? []) {
            if (containsIndic(t) !== indic) continue;
            const d = editDistanceWithin(w, t, max);
            if (d <= max) out.push({ via: 'spelling', word: t, distance: d, docs: vocab.words.get(t) ?? 0 });
        }
    }

    const key = bhashaKey(w);
    if (key.length >= MIN_LETTERS) {
        for (let len = key.length - 1; len <= key.length + 1; len++) {
            for (const k of vocab.keysByLength.get(len) ?? []) {
                const d = editDistanceWithin(key, k, 1);
                if (d <= 1) out.push({ via: 'sound', key: k, distance: d + 0.5, docs: vocab.keys.get(k) ?? 0 });
            }
        }
    }

    return out.sort((x, y) => x.distance - y.distance || y.docs - x.docs).slice(0, limit);
};
