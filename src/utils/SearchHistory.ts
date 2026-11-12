import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from './AppLogger';

const HISTORY_KEY = 'search_history';
const MAX_HISTORY = 30;
/** A shorter search saved this recently was the same search, still being typed. */
const TYPING_WINDOW_MS = 2 * 60 * 1000;

/** One saved search-history entry. */
export interface SearchHistoryItem {
    query: string;
    timestamp: number; // epoch ms
    resultCount: number;
}

/** Load full search history (newest first) */
export const loadSearchHistory = async (): Promise<SearchHistoryItem[]> => {
    try {
        const raw = await AsyncStorage.getItem(HISTORY_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        AppLogger.warn('SearchHistory', 'Failed to load history', e);
        return [];
    }
};

/** Save a search query to history (deduplicates + caps at MAX_HISTORY) */
export const saveSearch = async (query: string, resultCount: number): Promise<void> => {
    if (!query.trim()) return;
    try {
        const existing = await loadSearchHistory();
        const next = query.trim().toLowerCase();
        const now = Date.now();
        const filtered = existing.filter((h) => {
            const old = h.query.toLowerCase();
            // The same search again moves to the top.
            if (old === next) return false;
            // A slow typist pauses mid-word: "aad", then "aadha", then
            // "aadhaar". Keep the search they reached, not each step.
            return !(next.startsWith(old) && now - h.timestamp < TYPING_WINDOW_MS);
        });
        const updated: SearchHistoryItem[] = [
            { query: query.trim(), timestamp: now, resultCount },
            ...filtered,
        ].slice(0, MAX_HISTORY);
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (e) {
        AppLogger.error('SearchHistory', 'Failed to save search', e);
    }
};

/** Delete a single history item */
export const deleteSearchItem = async (query: string): Promise<void> => {
    try {
        const existing = await loadSearchHistory();
        const updated = existing.filter(
            h => h.query.toLowerCase() !== query.toLowerCase()
        );
        await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    } catch (e) {
        AppLogger.error('SearchHistory', 'Failed to delete item', e);
    }
};

/** Clear all history */
export const clearSearchHistory = async (): Promise<void> => {
    try {
        await AsyncStorage.removeItem(HISTORY_KEY);
    } catch (e) {
        AppLogger.error('SearchHistory', 'Failed to clear history', e);
    }
};
