/**
 * SearchPipeline.ts — the steps one search takes, from the typed words to
 * the list shown, as plain functions:
 *
 *  1. `wordResults`: the word results (sync, a few ms), then `rescueWords`
 *     when the typed words find nothing and may hold a typo ("bijki bil" →
 *     "बिजली bill"). `searchWordsFirst` runs both.
 *  2. `pictureQueryFor`: what CLIP is shown for that query (Hindi concepts in
 *     English, the festival's look for a date, no "latest" words), or null.
 *  3. `withLookAlikes`: the word results merged with the photos that look
 *     like the query vector.
 *
 * useSearch runs them with its debounce and state; the search bench
 * (tools/search-bench) runs the very same functions, so what it measures is
 * what the search screen shows.
 */
import { searchDocuments, searchDocumentsAsync, understandQuery } from '../database';
import type { DocumentRecord, QueryMeaning } from '../database';
import { rescueQuery } from './SpellingService';
import { parseDateQuery, pictureTextFor } from '../utils/DateQuery';
import { clipTextForQuery } from '../utils/ConceptTable';
import { queryWords } from '../utils/SearchKeys';

export interface WordSearch {
    /** The query the results are for: the typed one, or its correction. */
    query: string;
    results: DocumentRecord[];
    /** What was typed, when the results are for a corrected query. */
    correctedFrom: string | null;
}

/** The word results for the typed query (sync, a few ms: what search shows right away). */
export const wordResults = (typed: string): WordSearch => ({
    query: typed,
    results: searchDocuments(typed),
    correctedFrom: null,
});

/** True when the typed words found nothing and may be a typo (a date that found nothing is not one). */
export const needsRescue = (words: WordSearch): boolean =>
    words.results.length === 0 && !parseDateQuery(words.query);

/**
 * The typed words corrected against the person's own index, and the results
 * for the correction ("bijki bil" → "बिजली bill"); the typed query with no
 * results when nothing could be corrected. `isCurrent` lets a caller stop
 * after the (async) rescue when a newer query has replaced this one: null.
 */
export const rescueWords = async (
    typed: string,
    isCurrent: () => boolean = () => true,
): Promise<WordSearch | null> => {
    const rescue = await rescueQuery(typed);
    if (!isCurrent()) return null;
    const rescued = rescue ? searchDocuments(rescue.query) : [];
    if (rescue && rescued.length > 0) return { query: rescue.query, results: rescued, correctedFrom: typed };
    return { query: typed, results: [], correctedFrom: null };
};

/** Steps 1 and the query's meaning, in one call (the bench uses this). */
export const searchWordsFirst = async (typed: string): Promise<WordSearch & { meaning: QueryMeaning }> => {
    let words = wordResults(typed);
    if (needsRescue(words)) words = (await rescueWords(typed)) ?? words;
    return { ...words, meaning: understandQuery(words.query) };
};

/**
 * The text CLIP is shown for `query`, or null to skip the look-alike step.
 * Hindi and other Indian-script words never reach the English-only CLIP
 * tokenizer: known concepts become English, unknown ones are dropped. A date
 * query shows CLIP its other words, or what the festival looks like
 * ("diwali lamps and lights"). "Latest" words are left out: they are an
 * order, not something a photo shows.
 */
export const pictureQueryFor = (query: string, meaning: QueryMeaning): string | null => {
    const words = meaning.recency ? meaning.recency.rest : null;
    const lookFor = meaning.dates
        ? pictureTextFor({ ...meaning.dates, rest: words ?? meaning.dates.rest })
        : words ?? query;
    return lookFor ? clipTextForQuery(lookFor, queryWords(lookFor)) : null;
};

/**
 * Look-alike results first (merged with words by rank), then any word
 * results that list didn't hold (synonyms, Soundex, LIKE fallback), so the
 * picture step only adds.
 */
export const mergeResults = (primary: DocumentRecord[], secondary: DocumentRecord[]): DocumentRecord[] => {
    const seen = new Set<string>();
    const merged: DocumentRecord[] = [];
    for (const doc of [...primary, ...secondary]) {
        if (seen.has(doc.filePath)) continue;
        seen.add(doc.filePath);
        merged.push(doc);
    }
    return merged;
};

/** The final list: words and look-alikes for `query`, plus the word results shown first. */
export const withLookAlikes = async (
    query: string,
    queryVector: Float32Array,
    shownFirst: DocumentRecord[],
): Promise<DocumentRecord[]> => mergeResults(await searchDocumentsAsync(query, queryVector), shownFirst);
