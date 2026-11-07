/**
 * SearchKeys.ts — the "search tail" stored after each document's text, and
 * the matching query terms.
 *
 * Index side: indexDocument() appends, after an invisible marker, one
 * `qk<key>` token per unique Bhasha key and one `qc<id>` token per concept
 * found in the text. Query side: every query word expands to the same tokens.
 * The marker keeps the tail out of everything the UI shows.
 */
import { CONCEPT_PREFIX, conceptsForText, conceptsForWord } from './ConceptTable';
import { bhashaKey, bhashaKeysFor, romanize, tokenizeWords, containsIndic, normalizeIndic } from './IndicText';

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

/** The tail tokens for a text: Bhasha keys, then concept ids. */
export const buildSearchTail = (text: string): string => {
    const words = tokenizeWords(text);
    const keys = bhashaKeysFor(text).map(k => KEY_PREFIX + k);
    const concepts = conceptsForText(words).map(id => CONCEPT_PREFIX + id);
    return [...keys, ...concepts].join(' ');
};

/**
 * Content with a fresh search tail. Idempotent: an existing tail is replaced.
 * The title is read for keys and concepts too, but not copied into content.
 */
export const withSearchTail = (content: string, title?: string | null): string => {
    const body = visibleContent(content);
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
