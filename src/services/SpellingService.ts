/**
 * SpellingService.ts — "Showing results for …": when a typed search finds
 * nothing, its words are corrected against the person's own index
 * (utils/SpellingRescue.ts) and the corrected query is searched instead.
 *
 * The vocabulary (up to VOCABULARY_LIMIT terms) is read on the read
 * connection when first needed, kept while searches happen, and dropped after
 * IDLE_DROP_MS without one, like the CLIP text model.
 */
import { loadVocabulary, textWithToken } from '../database/vocabulary';
import { bhashaKey, tokenizeWords } from '../utils/IndicText';
import { queryWords, searchWords, visibleContent } from '../utils/SearchKeys';
import { buildVocabulary, correctionsFor, type Vocabulary } from '../utils/SpellingRescue';
import { AppLogger } from '../utils/AppLogger';

/** Most terms kept in memory (words and sound keys, most common first). */
export const VOCABULARY_LIMIT = 40000;
/** Read the vocabulary again when it is older than this (new papers get indexed). */
const MAX_AGE_MS = 10 * 60 * 1000;
/** Free it after this long without a rescued search. */
export const IDLE_DROP_MS = 10 * 60 * 1000;

let cached: { vocab: Vocabulary; at: number } | null = null;
let loading: Promise<Vocabulary> | null = null;
let dropTimer: ReturnType<typeof setTimeout> | null = null;

const keepFor = () => {
    if (dropTimer) clearTimeout(dropTimer);
    dropTimer = setTimeout(() => {
        cached = null;
        dropTimer = null;
    }, IDLE_DROP_MS);
};

/** @internal Test helper. */
export const __resetSpelling = () => {
    cached = null;
    loading = null;
    if (dropTimer) clearTimeout(dropTimer);
    dropTimer = null;
};

const getVocabulary = async (): Promise<Vocabulary> => {
    if (cached && Date.now() - cached.at < MAX_AGE_MS) return cached.vocab;
    if (!loading) {
        loading = loadVocabulary(VOCABULARY_LIMIT)
            .then(rows => {
                const vocab = buildVocabulary(rows);
                cached = { vocab, at: Date.now() };
                return vocab;
            })
            .finally(() => {
                loading = null;
            });
    }
    return loading;
};

/** A word in the index with this sound key, as it is written there. */
const wordWithKey = async (key: string): Promise<string | null> => {
    const text = await textWithToken(`qk${key}`);
    if (!text) return null;
    return tokenizeWords(visibleContent(text)).find(t => bhashaKey(t) === key) ?? null;
};

export interface Rescue {
    /** The query to search instead: the typed words, with the corrected ones swapped. */
    query: string;
    corrections: Array<{ from: string; to: string }>;
}

/**
 * The typed query with each word that isn't in the index replaced by its best
 * correction, or null when nothing could be corrected.
 */
export const rescueQuery = async (query: string): Promise<Rescue | null> => {
    const wanted = searchWords(query);
    if (wanted.length === 0) return null;
    try {
        const vocab = await getVocabulary();
        keepFor();
        if (vocab.words.size === 0) return null;
        const swaps = new Map<string, string>();
        for (const w of wanted) {
            const [best] = correctionsFor(w, vocab, 1);
            if (!best) continue;
            const to = best.via === 'spelling' ? best.word ?? null : await wordWithKey(best.key ?? '');
            if (to && to.toLowerCase() !== w.toLowerCase()) swaps.set(w, to);
        }
        if (swaps.size === 0) return null;
        const corrected = queryWords(query).map(w => swaps.get(w) ?? w).join(' ');
        return { query: corrected, corrections: [...swaps].map(([from, to]) => ({ from, to })) };
    } catch (e) {
        AppLogger.warn('Spelling', 'Could not correct the search', e);
        return null;
    }
};
