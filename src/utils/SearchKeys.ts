/**
 * SearchKeys.ts — the "search tail" stored after each document's text, and
 * the matching query terms.
 *
 * Index side: indexDocument() appends, after an invisible marker, one
 * `qk<key>` token per unique Bhasha key and one `qc<id>` token per concept
 * found in the text, the OCR-tolerant keys, the Hinglish and English words for
 * Hindi text ("कमल" → kamal lotus flower) and the Soundex codes of the Latin
 * words. Query side: every query word expands to the same tokens. The marker
 * keeps the tail out of everything the UI shows: what the person sees and
 * copies is only the words that were read.
 */
import { CONCEPT_PREFIX, conceptsForText, conceptsForWord } from './ConceptTable';
import { containsDevanagari, enrichHindi, lookupEnglish } from './HindiTranslit';
import { bhashaKey, bhashaKeysFor, romanize, tokenizeWords, containsIndic, normalizeIndic } from './IndicText';
import { toleranceTokens } from './OcrTolerance';
import { soundex } from './Soundex';

/** U+2063 INVISIBLE SEPARATOR: FTS5 treats it as a word break, users never see it. */
export const SEARCH_TAIL_MARK = '\u2063';

/** Token prefix for Bhasha keys in the search index. */
export const KEY_PREFIX = 'qk';

/** Content without its search tail (what the UI should show). */
export const visibleContent = (content: string | null | undefined): string => {
    if (!content) return '';
    const i = content.indexOf(SEARCH_TAIL_MARK);
    return i < 0 ? content : content.slice(0, i).trimEnd();
};

/**
 * Bump when buildSearchTail() changes, so rows indexed before get the new
 * tail in the background (utils/SearchRekey.ts). 2: OCR-tolerant keys.
 * 3: the Hindi gloss and Soundex codes moved from the visible text into the
 * tail (withSearchTail takes them out of old rows' text).
 */
export const SEARCH_KEYS_VERSION = 3;

/** Hinglish and English words for the Devanagari in `text` ("कमल" → kamal, lotus, flower). */
const glossWords = (text: string): string[] =>
    containsDevanagari(text) ? tokenizeWords(`${romanize(text)} ${lookupEnglish(text)}`) : [];

const LATIN_WORD = /^[a-z]+$/i;

/** Soundex codes of the plain Latin words, each once (the LIKE fallback matches on them). */
const soundexCodes = (words: ReadonlyArray<string>): string[] => {
    const codes = new Set<string>();
    for (const w of words) {
        if (!LATIN_WORD.test(w)) continue;
        const code = soundex(w);
        if (code.length === 4) codes.add(code);
    }
    return [...codes];
};

/**
 * The tail tokens for a text: Bhasha keys, concept ids, the keys that find
 * OCR misreadings (shape, folded sound, joined neighbours: OcrTolerance),
 * then the Hinglish and English gloss of Hindi words and the Soundex codes.
 * Keys and concepts are read from the text and its gloss, as they were when
 * the gloss was part of the stored text.
 */
export const buildSearchTail = (text: string): string => {
    const gloss = glossWords(text);
    const all = gloss.length > 0 ? `${text} ${gloss.join(' ')}` : text;
    const words = tokenizeWords(all);
    const keys = bhashaKeysFor(all).map(k => KEY_PREFIX + k);
    const concepts = conceptsForText(words).map(id => CONCEPT_PREFIX + id);
    const textWords = new Set(tokenizeWords(text).map(w => w.toLowerCase()));
    const glossOnly = [...new Set(gloss.map(w => w.toLowerCase()))].filter(w => !textWords.has(w));
    return [...keys, ...concepts, ...toleranceTokens(words), ...glossOnly, ...soundexCodes(words)].join(' ');
};

const SOUNDEX_CODE = /^[A-Z][0-6]{3}$/;

/**
 * An old row's text without what older versions appended to it: Soundex
 * codes ("Hello World H400 W643") and, for Hindi, the Hinglish and English
 * gloss ("कमल kamal lotus flower"). Both now live in the tail. Only exact
 * leftovers go: a code must be the Soundex of a word in the same text, and a
 * gloss must be exactly what enrichHindi() made of the words before it.
 * Anything else is left as it is.
 */
export const withoutOldEnrichment = (body: string): string => {
    const tokens = body.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return body;
    const codesOfWords = new Set(tokens.filter(t => LATIN_WORD.test(t)).map(soundex));
    let kept = tokens.filter(t => !(SOUNDEX_CODE.test(t) && codesOfWords.has(t)));
    if (containsDevanagari(body)) kept = withoutGloss(kept);
    return kept.length === tokens.length ? body : kept.join(' ');
};

/** The words before an exact enrichHindi() gloss at the end of `tokens`, else `tokens`. */
const withoutGloss = (tokens: string[]): string[] => {
    const firstRoman = romanize(tokens[0]).split(/\s+/).filter(Boolean)[0];
    for (let k = 1; k < tokens.length; k++) {
        // The gloss starts with the romanized first word: skip every other split.
        if (firstRoman && tokens[k] !== firstRoman) continue;
        const words = tokens.slice(0, k);
        const enriched = enrichHindi(words.join(' ')).split(/\s+/).filter(Boolean);
        if (enriched.length === tokens.length && enriched.every((t, i) => t === tokens[i])) return words;
    }
    return tokens;
};

/**
 * Content with a fresh search tail. Idempotent: an existing tail is replaced,
 * and an old row's appended codes and gloss leave the visible text (see
 * withoutOldEnrichment). The title is read for keys and concepts too, but not
 * copied into content.
 */
export const withSearchTail = (content: string, title?: string | null): string => {
    const body = withoutOldEnrichment(visibleContent(content));
    const tail = buildSearchTail(`${title ?? ''} ${body}`);
    return tail ? `${body} ${SEARCH_TAIL_MARK} ${tail}` : body;
};

/** Everything one query word can match: itself, its sound key, its concepts. */
export interface QueryWordTerms {
    word: string;
    /** Romanized form for Indian-script words (matches Hinglish OCR enrichment). */
    roman: string | null;
    key: string | null;
    concepts: string[];
}

export const termsForQueryWord = (word: string): QueryWordTerms => {
    const roman = containsIndic(word) ? romanize(word).toLowerCase() : null;
    const k = bhashaKey(word);
    return {
        word,
        roman: roman && roman !== word ? roman : null,
        key: k ? KEY_PREFIX + k : null,
        concepts: conceptsForWord(word).map(id => CONCEPT_PREFIX + id),
    };
};

/**
 * Splits a raw query into clean words in ANY script. (The old `[^\w\s-]`
 * filter in search.ts is ASCII-only and deleted every Hindi letter, so Hindi
 * queries reached the index empty.)
 */
export const queryWords = (query: string): string[] =>
    normalizeIndic(query)
        .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
        .split(/\s+/)
        .filter(w => w.length > 0);

/** Words that say nothing about what is being looked for. */
const FILLER_WORDS = new Set([
    'a', 'an', 'the', 'of', 'in', 'on', 'at', 'with', 'for', 'and', 'or', 'to', 'from', 'my', 'is', 'are',
    'ka', 'ki', 'ke', 'ko', 'mein', 'aur', 'wala', 'wali', 'wale', 'mera', 'meri', 'mere',
    'का', 'की', 'के', 'को', 'में', 'और', 'वाला', 'वाली', 'वाले', 'मेरा', 'मेरी', 'मेरे',
    // Questions the answer line replies to ("bijli bill kitna", "policy kab tak"):
    // the paper doesn't contain them.
    'kitna', 'kitni', 'kitne', 'kab', 'tak', 'how', 'much', 'when', 'कितना', 'कितनी', 'कितने', 'कब', 'तक',
]);

/** "photo of X", "X ki photo": the word asks for a photo, it isn't written in one. */
const PICTURE_WORDS = new Set([
    'photo', 'photos', 'picture', 'pictures', 'pic', 'pics', 'image', 'images', 'foto', 'tasveer',
    'फोटो', 'फ़ोटो', 'तस्वीर',
]);
const OF_WORDS = new Set(['of', 'ki', 'ka', 'ke', 'की', 'का', 'के']);

/**
 * The words of a query that must be found in a document's text: queryWords
 * without filler ("of", "the", "ki") and without a picture word that only
 * asks for a photo ("photo of biryani", "biryani ki photo" → biryani).
 * Matching "of" as a word found every screenshot with "of" or "office" in it.
 * A query made only of such words is kept, so typing "the" on the way to
 * "thermometer" still searches.
 */
export const searchWords = (query: string): string[] => {
    const all = queryWords(query);
    const lower = all.map(w => w.toLowerCase());
    const asksForPhoto = (i: number): boolean =>
        PICTURE_WORDS.has(lower[i]) && (OF_WORDS.has(lower[i + 1]) || OF_WORDS.has(lower[i - 1]));
    const notFiller = all.filter((_, i) => !FILLER_WORDS.has(lower[i]));
    const kept = all.filter((_, i) => !FILLER_WORDS.has(lower[i]) && !asksForPhoto(i));
    if (kept.length > 0) return kept;
    return notFiller.length > 0 ? notFiller : all;
};
