/**
 * OcrTolerance.ts — keys that let search find words OCR misread.
 *
 * Measured with the app's own search keys (research/experiments/
 * ocr-misreads.exp.ts): one OCR misreading left a Hindi word findable only
 * about 47% of the time, and an English word about 2% ("rnedicine", "bi11").
 * Three extra keys per word bring that to ~100% for the misreadings they know,
 * at a small cost in extra matches:
 *
 *  - shape key: how the word LOOKS. Letters OCR confuses become one
 *    (ब/व, म/भ, घ/ध/द, त/ट, ष/प, थ/य; ी/ि, ू/ु; rn/m, 1/l/i, 0/o), and marks it
 *    drops are left out (nukta, halant, anusvara, chandrabindu).
 *  - folded sound key: the Bhasha sound key with the confusions that survive
 *    it folded too (b/v/m, g/d, a nasal before a consonant). Script-free, so it
 *    also serves a query typed in Hinglish.
 *  - joined neighbours: OCR splits words ("elec tricity", "बिज ली"); the sound
 *    key of two neighbours joined finds them again.
 *
 * Index side: buildSearchTail() stores them as `qv…`, `qf…` and `qj…` tokens.
 * Query side: tolerantTermsForQueryWord() gives the matching tokens; search
 * looks for these only after exact matches, and ranks them after.
 */
import { bhashaKey, containsIndic, normalizeIndic } from './IndicText';

/** Token prefixes in the search tail. */
export const SHAPE_PREFIX = 'qv';
export const FOLD_PREFIX = 'qf';
export const JOIN_PREFIX = 'qj';

const NUKTA = '़';
const VIRAMA = '्';
const ANUSVARA = 'ं';
const CHANDRABINDU = 'ँ';
/** Dependent vowel signs (matras). */
const MATRAS = new Set([...'ािीुूृॄेैोौॅॉॆॊ']);
/** Look-alike letters and vowel lengths, each to one representative. */
const SHAPE_CLASSES: Record<string, string> = {
    'व': 'ब', 'ध': 'द', 'घ': 'द', 'भ': 'म', 'ट': 'त', 'ष': 'प', 'थ': 'य',
    'ी': 'ि', 'ू': 'ु', 'ै': 'े', 'ौ': 'ो', 'ई': 'इ', 'ऊ': 'उ', 'ऐ': 'ए', 'औ': 'ओ',
};

/** Letters with their own nukta code point (क़ ख़ ग़ ज़ ड़ ढ़ फ़ य़) split into letter + nukta. */
const splitNukta = (s: string): string => s.replace(/[क़-य़]/g, ch => ch.normalize('NFD'));

const hasLetter = (s: string): boolean => /\p{L}/u.test(s);

/** A Soundex code ("B234") from enrichment, not a word: no keys for it. */
const isSoundexCode = (s: string): boolean => /^[a-z]\d{3}$/i.test(s);

const devanagariShape = (word: string): string => {
    const kept = [...splitNukta(word.normalize('NFC'))].filter(
        ch => ch !== NUKTA && ch !== VIRAMA && ch !== ANUSVARA && ch !== CHANDRABINDU,
    );
    // ख is often read as र + व.
    return [...kept.join('').replace(/रव/g, 'ख')].map(ch => SHAPE_CLASSES[ch] ?? ch).join('');
};

// Single characters first, then letter pairs: "c1ass" and "class" must end alike.
const latinShape = (word: string): string =>
    word
        .toLowerCase()
        .replace(/[1|i]/g, 'l')
        .replace(/0/g, 'o')
        .replace(/5/g, 's')
        .replace(/rn/g, 'm')
        .replace(/cl/g, 'd')
        .replace(/vv/g, 'w');

/**
 * How a word looks, with the letters OCR confuses made one. '' for words that
 * can't carry a key (no letter, too short, a Soundex code).
 */
export const shapeKey = (word: string): string => {
    const w = normalizeIndic(word ?? '').trim();
    if (!w || !hasLetter(w) || isSoundexCode(w)) return '';
    const key = containsIndic(w) ? devanagariShape(w) : latinShape(w);
    return [...key].length >= 2 ? key : '';
};

/** Fold the sound-key letters that OCR still confuses. */
export const foldSoundKey = (key: string): string =>
    key
        .replace(/[vmw]/g, 'b')
        .replace(/g/g, 'd')
        .replace(/n(?=[bcdfghjklmpqrstvwxyz])/g, '')
        .replace(/(.)\1+/g, '$1');

/** OCR-tolerant sound key for one word, in any script. '' when too short. */
export const foldedSoundKey = (word: string): string => {
    const w = normalizeIndic(word ?? '').trim();
    if (!w || isSoundexCode(w)) return '';
    const key = foldSoundKey(bhashaKey(containsIndic(w) ? w : latinShape(w)));
    return key.length >= 3 ? key : '';
};

/**
 * The word with one vowel sign left out, for each vowel sign in it: OCR drops
 * matras often, and the shape key keeps them (leaving them out of the key
 * would make far more words alike).
 */
export const matraDrops = (word: string): string[] => {
    const chars = [...splitNukta(normalizeIndic(word ?? '').normalize('NFC'))];
    const out = new Set<string>();
    chars.forEach((ch, i) => {
        if (MATRAS.has(ch)) out.add([...chars.slice(0, i), ...chars.slice(i + 1)].join(''));
    });
    return [...out];
};

/** One half of a split word is at most this many letters (the other may be longer). */
const MAX_SPLIT_PART = 4;

/**
 * Very common short words: next to them a word is almost never half of a
 * split one, and they are next to everything, so joins with them would
 * double the index for nothing.
 */
const COMMON_WORDS = new Set([
    'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'are', 'was', 'be', 'by', 'it', 'as',
    'no', 'not', 'with', 'from', 'this', 'that', 'you', 'your', 'we', 'our', 'my', 'me', 'he', 'she', 'his', 'her',
    'का', 'की', 'के', 'को', 'में', 'से', 'है', 'हैं', 'था', 'थे', 'थी', 'और', 'पर', 'भी', 'ने', 'तो', 'ही', 'हो', 'कि',
    'यह', 'वह', 'जो', 'एक', 'इस', 'उस', 'लिए', 'साथ', 'तक', 'या', 'न', 'नहीं',
]);

/**
 * Sound keys of neighbouring words joined, where one of them is short enough
 * to be half of a split word. Keys of 4+ letters only.
 */
export const joinedNeighbourKeys = (words: ReadonlyArray<string>): string[] => {
    const out = new Set<string>();
    for (let i = 0; i + 1 < words.length; i++) {
        const a = words[i];
        const b = words[i + 1];
        if (!hasLetter(a) || !hasLetter(b) || isSoundexCode(a) || isSoundexCode(b)) continue;
        if (containsIndic(a) !== containsIndic(b)) continue;
        if (COMMON_WORDS.has(a.toLowerCase()) || COMMON_WORDS.has(b.toLowerCase())) continue;
        if ([...a].length > MAX_SPLIT_PART && [...b].length > MAX_SPLIT_PART) continue;
        const key = bhashaKey(a + b);
        if (key.length >= 4) out.add(key);
    }
    return [...out];
};

/** English words this short are too ambiguous to look for as misreadings. */
const MIN_LATIN_SHAPE_LETTERS = 4;

/**
 * The tail tokens for a text's words: shape keys, folded sound keys (Indian
 * scripts only: the shape key already covers English misreadings, and the
 * folded key is what lets a Hinglish query find a misread Hindi word), and
 * joined neighbours.
 */
export const toleranceTokens = (words: ReadonlyArray<string>): string[] => {
    const shapes = new Set<string>();
    const folds = new Set<string>();
    for (const w of words) {
        const indic = containsIndic(w);
        if (indic || [...w].length >= MIN_LATIN_SHAPE_LETTERS) {
            const s = shapeKey(w);
            if (s && s !== w.toLowerCase()) shapes.add(SHAPE_PREFIX + s);
        }
        if (indic) {
            const f = foldedSoundKey(w);
            if (f && f !== bhashaKey(w)) folds.add(FOLD_PREFIX + f);
        }
    }
    const joins = joinedNeighbourKeys(words).map(k => JOIN_PREFIX + k);
    return [...shapes, ...folds, ...joins];
};

/** What one query word matches among misread words (all exact tokens). */
export interface TolerantTerms {
    /**
     * Shape keys (the word's own, and with each vowel sign left out), each as
     * a `qv…` token and as a plain word: a misread word that already looks
     * like its own shape key ("मुगतान") is stored without a `qv…` token.
     */
    shapes: string[];
    /** `qf…` and `qk…` with the folded sound key (a word whose key needs no folding has only `qk`). */
    folded: string[];
    /** `qj…`: the word's sound key, for a split word joined again. */
    joined: string[];
}

export const tolerantTermsForQueryWord = (word: string): TolerantTerms => {
    const keys = new Set<string>();
    const own = shapeKey(word);
    if (own) keys.add(own);
    if (containsIndic(word)) {
        for (const v of matraDrops(word)) {
            const s = shapeKey(v);
            if (s) keys.add(s);
        }
    }
    const shapes = new Set<string>();
    for (const k of keys) {
        shapes.add(SHAPE_PREFIX + k);
        shapes.add(k);
    }
    const f = foldedSoundKey(word);
    const key = bhashaKey(word);
    return {
        shapes: [...shapes],
        folded: f ? [FOLD_PREFIX + f, `qk${f}`] : [],
        joined: key.length >= 4 ? [JOIN_PREFIX + key] : [],
    };
};

/** True when `token` (a word in a result) is a misreading of `queryWord`, for marking it. */
export const looksLikeMisreadOf = (token: string, queryWord: string): boolean => {
    const t = shapeKey(token);
    if (t) {
        const q = shapeKey(queryWord);
        if (q && t === q) return true;
        if (containsIndic(queryWord) && matraDrops(queryWord).some(v => shapeKey(v) === t)) return true;
    }
    const ft = foldedSoundKey(token);
    return !!ft && ft === foldedSoundKey(queryWord);
};
