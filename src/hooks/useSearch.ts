import { useState, useEffect, useCallback, useRef } from 'react';
import { searchDocuments, searchDocumentsAsync, DocumentRecord } from '../database';
import { encodeText, warmUpText } from '../services/EmbeddingService';
import { AppLogger } from '../utils/AppLogger';
import { noteInteraction } from '../services/InteractionGate';
import { clipTextForQuery } from '../utils/ConceptTable';
import { queryWords } from '../utils/SearchKeys';
import {
    loadSearchHistory, saveSearch, deleteSearchItem,
    clearSearchHistory, SearchHistoryItem,
} from '../utils/SearchHistory';

const SEARCH_DEBOUNCE_MS = 200;
const HISTORY_DEBOUNCE_MS = 800;

/**
 * Hybrid results first, then any text-only matches (synonyms, Soundex, LIKE
 * fallback) the hybrid query didn't return, so the semantic step only adds.
 */
const mergeResults = (primary: DocumentRecord[], secondary: DocumentRecord[]): DocumentRecord[] => {
    const seen = new Set<string>();
    const merged: DocumentRecord[] = [];
    for (const doc of [...primary, ...secondary]) {
        if (seen.has(doc.filePath)) continue;
        seen.add(doc.filePath);
        merged.push(doc);
    }
    return merged;
};

/**
 * useSearch — handles search text, debounced DB queries, results, and history.
 *
 * 200ms after the last keystroke it shows text-index results immediately,
 * then adds semantic (CLIP) matches once the query vector is ready.
 * Queries are saved to the search history after 800ms.
 *
 * @param isDbReady Whether the SQLite database has finished initializing.
 * @returns Search state (text, results, pending flags, history) and handlers.
 */
export const useSearch = (isDbReady: boolean) => {
    const [searchText, setSearchText] = useState('');
    const [debouncedSearchText, setDebouncedSearchText] = useState('');
    const [searchResults, setSearchResults] = useState<DocumentRecord[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isSearchPending, setIsSearchPending] = useState(false);
    const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
    const lastResultRef = useRef<{ query: string; count: number } | null>(null);

    // Typing holds indexing back for a moment, like a touch (InteractionGate).
    useEffect(() => {
        if (searchText) noteInteraction();
    }, [searchText]);

    // Load history on mount
    useEffect(() => {
        if (!isDbReady) return;
        loadSearchHistory().then(setSearchHistory);
    }, [isDbReady]);

    // Load the CLIP text encoder when search opens, not at app start: it
    // loads while the person types (word results never wait for it), and
    // people who never search don't pay ~64 MB for it. EmbeddingService frees
    // it again after 10 minutes without a search.
    useEffect(() => {
        if (!isDbReady || !isSearching) return;
        warmUpText();
    }, [isDbReady, isSearching]);

    // Debounced search — 200ms after last keystroke.
    // Step 1 runs the text index right away (a few ms) and shows those results.
    // Step 2 encodes the query with CLIP and, if that works, re-runs the hybrid
    // query to add semantic matches. Typing never waits on the encoder.
    useEffect(() => {
        if (!isDbReady || !searchText.trim()) {
            setSearchResults([]);
            setIsSearchPending(false);
            return;
        }

        let isCurrent = true;
        setIsSearchPending(true);
        const timer = setTimeout(async () => {
            try {
                const textResults = searchDocuments(searchText);
                if (!isCurrent) return;
                lastResultRef.current = { query: searchText, count: textResults.length };
                setSearchResults(textResults);
                setDebouncedSearchText(searchText);
                setIsSearchPending(false);

                // Hindi and other Indian-script words never reach the
                // English-only CLIP tokenizer: known concepts become English,
                // unknown ones are dropped (null = skip semantic search).
                const clipText = clipTextForQuery(searchText, queryWords(searchText));
                const queryVector = clipText ? await encodeText(clipText) : null;
                if (!isCurrent || !queryVector) return;
                // The look-alike scan reads every photo's vector: off the JS
                // thread, so typing and scrolling stay smooth while it runs.
                const hybridResults = mergeResults(await searchDocumentsAsync(searchText, queryVector), textResults);
                if (!isCurrent) return;
                lastResultRef.current = { query: searchText, count: hybridResults.length };
                setSearchResults(hybridResults);
            } catch (e) {
                AppLogger.error('Search', 'search error:', e);
            } finally {
                if (isCurrent) {
                    setIsSearchPending(false);
                }
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            isCurrent = false;
            clearTimeout(timer);
        };
    }, [searchText, isDbReady]);

    // Save to history when user stops typing (debounced 800ms).
    // Reuses the result count from the search above instead of searching again.
    useEffect(() => {
        if (!searchText.trim() || !isDbReady) return;
        let isCurrent = true;
        const timer = setTimeout(async () => {
            try {
                const last = lastResultRef.current;
                const count = last && last.query === searchText ? last.count : 0;
                await saveSearch(searchText, count);
                if (!isCurrent) return;
                setSearchHistory(await loadSearchHistory());
            } catch (e) {
                AppLogger.error('Search', 'saveSearch error:', e);
            }
        }, HISTORY_DEBOUNCE_MS);
        return () => {
            isCurrent = false;
            clearTimeout(timer);
        };
    }, [searchText, isDbReady]);

    const handleSelectHistory = useCallback((query: string) => {
        setSearchText(query);
        setIsSearching(true);
    }, []);

    const handleDeleteHistory = useCallback(async (query: string) => {
        await deleteSearchItem(query);
        setSearchHistory(await loadSearchHistory());
    }, []);

    const handleClearHistory = useCallback(async () => {
        await clearSearchHistory();
        setSearchHistory([]);
    }, []);

    return {
        searchText, setSearchText, debouncedSearchText,
        searchResults,
        isSearching, setIsSearching, isSearchPending,
        searchHistory,
        handleSelectHistory, handleDeleteHistory, handleClearHistory,
    };
};
