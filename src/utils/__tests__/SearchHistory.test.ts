/**
 * Unit tests for src/utils/SearchHistory.ts
 *
 * Source behavior (verified by reading the module):
 * - loadSearchHistory: [] when empty; corrupted JSON -> [] (guarded, warns)
 * - saveSearch: ignores blank queries; trims; case-insensitive dedup that moves
 *   the query to the front (newest first); cap MAX_HISTORY = 30
 * - deleteSearchItem: case-insensitive removal, but does NOT trim the argument
 * - clearSearchHistory: removes the key entirely
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from '../AppLogger';
import {
    SearchHistoryItem,
    clearSearchHistory,
    deleteSearchItem,
    loadSearchHistory,
    saveSearch,
} from '../SearchHistory';

jest.mock('../AppLogger', () => ({
    AppLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        getRecent: jest.fn(),
        getErrors: jest.fn(),
    },
}));

const resetStore = () =>
    (AsyncStorage as unknown as { __reset: () => void }).__reset();

beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
});

describe('loadSearchHistory', () => {
    it('returns an empty array when nothing is stored', async () => {
        await expect(loadSearchHistory()).resolves.toEqual([]);
    });

    it('returns stored items in newest-first order', async () => {
        await saveSearch('invoice', 3);
        await saveSearch('passport photo', 1);
        const history = await loadSearchHistory();
        expect(history.map(h => h.query)).toEqual(['passport photo', 'invoice']);
    });

    it('returns [] and does not throw on corrupted stored JSON', async () => {
        await AsyncStorage.setItem('search_history', '{not valid json{{{');
        await expect(loadSearchHistory()).resolves.toEqual([]);
        expect(AppLogger.warn).toHaveBeenCalled();
    });
});

describe('saveSearch', () => {
    it('stores query, resultCount, and a timestamp', async () => {
        const before = Date.now();
        await saveSearch('electricity bill', 5);
        const after = Date.now();
        const [item] = await loadSearchHistory();
        expect(item.query).toBe('electricity bill');
        expect(item.resultCount).toBe(5);
        expect(item.timestamp).toBeGreaterThanOrEqual(before);
        expect(item.timestamp).toBeLessThanOrEqual(after);
    });

    it('prepends newer searches so history is newest-first', async () => {
        await saveSearch('first', 1);
        await saveSearch('second', 2);
        await saveSearch('third', 3);
        const queries = (await loadSearchHistory()).map(h => h.query);
        expect(queries).toEqual(['third', 'second', 'first']);
    });

    it('trims leading/trailing whitespace from the query', async () => {
        await saveSearch('   pan card   ', 1);
        const [item] = await loadSearchHistory();
        expect(item.query).toBe('pan card');
    });

    it('ignores empty and whitespace-only queries without writing to storage', async () => {
        await saveSearch('', 1);
        await saveSearch('    ', 2);
        await saveSearch('\t\n', 3);
        expect(AsyncStorage.setItem).not.toHaveBeenCalled();
        await expect(loadSearchHistory()).resolves.toEqual([]);
    });

    it('moves a re-searched query to the front instead of duplicating it', async () => {
        await saveSearch('invoice', 1);
        await saveSearch('receipt', 2);
        await saveSearch('invoice', 4);
        const history = await loadSearchHistory();
        expect(history.map(h => h.query)).toEqual(['invoice', 'receipt']);
        expect(history).toHaveLength(2);
    });

    it('dedupes case-insensitively and adopts the latest casing', async () => {
        await saveSearch('aadhaar card', 1);
        await saveSearch('AADHAAR CARD', 2);
        const history = await loadSearchHistory();
        expect(history).toHaveLength(1);
        expect(history[0].query).toBe('AADHAAR CARD');
    });

    it('treats the same query with different whitespace as a duplicate', async () => {
        await saveSearch('flight ticket', 1);
        await saveSearch('  FLIGHT TICKET  ', 1);
        expect(await loadSearchHistory()).toHaveLength(1);
    });

    it('refreshes resultCount and timestamp when a query is re-searched', async () => {
        await saveSearch('resume', 1);
        const firstTimestamp = (await loadSearchHistory())[0].timestamp;
        await new Promise(r => setTimeout(r, 5));
        await saveSearch('resume', 9);
        const [item] = await loadSearchHistory();
        expect(item.resultCount).toBe(9);
        expect(item.timestamp).toBeGreaterThanOrEqual(firstTimestamp);
    });

    it('enforces the 30-item cap by evicting the oldest entries', async () => {
        for (let i = 0; i < 35; i++) {
            await saveSearch(`query-${i}.`, 1);
        }
        const history = await loadSearchHistory();
        expect(history).toHaveLength(30);
        expect(history[0].query).toBe('query-34.'); // newest
        expect(history[29].query).toBe('query-5.'); // oldest surviving
        const queries = history.map(h => h.query);
        expect(queries).not.toContain('query-0.');
        expect(queries).not.toContain('query-4.');
    });

    it('does not grow past the cap when re-searching an existing query', async () => {
        for (let i = 0; i < 30; i++) {
            await saveSearch(`query-${i}.`, 1);
        }
        await saveSearch('query-0.', 1); // duplicate -> moves to front
        const history = await loadSearchHistory();
        expect(history).toHaveLength(30);
        expect(history[0].query).toBe('query-0.');
    });

    it('recovers from corrupted storage and writes valid JSON afterwards', async () => {
        await AsyncStorage.setItem('search_history', 'corrupted{{{');
        await saveSearch('medical report', 2);
        const history = await loadSearchHistory();
        expect(history).toHaveLength(1);
        expect(history[0].query).toBe('medical report');
        // Storage now holds valid JSON again
        const raw = await AsyncStorage.getItem('search_history');
        expect(() => JSON.parse(raw as string)).not.toThrow();
    });

    it('persists items across separate load calls', async () => {
        await saveSearch('invoice', 3);
        const first = await loadSearchHistory();
        const second = await loadSearchHistory();
        expect(second).toEqual(first);
        expect(second).toHaveLength(1);
    });
});

describe('deleteSearchItem', () => {
    it('removes the matching query from history', async () => {
        await saveSearch('invoice', 1);
        await saveSearch('receipt', 2);
        await deleteSearchItem('invoice');
        const history = await loadSearchHistory();
        expect(history.map(h => h.query)).toEqual(['receipt']);
    });

    it('removes case-insensitively', async () => {
        await saveSearch('Flight Ticket', 1);
        await deleteSearchItem('flight ticket');
        await expect(loadSearchHistory()).resolves.toEqual([]);
    });

    it('does not trim the delete argument (matches source behavior)', async () => {
        await saveSearch('bill', 1);
        await deleteSearchItem('  bill  ');
        // Source compares without trimming, so the entry survives
        expect(await loadSearchHistory()).toHaveLength(1);
    });

    it('leaves history unchanged when the query does not exist', async () => {
        await saveSearch('invoice', 1);
        await deleteSearchItem('nonexistent');
        const history = await loadSearchHistory();
        expect(history).toHaveLength(1);
        expect(history[0].query).toBe('invoice');
    });
});

describe('clearSearchHistory', () => {
    it('empties the stored history', async () => {
        await saveSearch('invoice', 1);
        await saveSearch('receipt', 2);
        await clearSearchHistory();
        await expect(loadSearchHistory()).resolves.toEqual([]);
    });

    it('does not throw when history is already empty', async () => {
        await expect(clearSearchHistory()).resolves.toBeUndefined();
    });
});

describe('searches typed slowly', () => {
    it('keeps the search the person reached, not each pause on the way', async () => {
        await saveSearch('aad', 0);
        await saveSearch('aadha', 2);
        await saveSearch('aadhaar', 5);
        const history = await loadSearchHistory();
        expect(history.map(h => h.query)).toEqual(['aadhaar']);
        expect(history[0].resultCount).toBe(5);
    });

    it('keeps an older, shorter search: that one was meant', async () => {
        const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await saveSearch('bill', 3);
        nowSpy.mockReturnValue(1_000_000 + 10 * 60 * 1000);
        await saveSearch('bill october', 1);
        nowSpy.mockRestore();
        expect((await loadSearchHistory()).map(h => h.query)).toEqual(['bill october', 'bill']);
    });

    it('keeps other searches made in the same minute', async () => {
        await saveSearch('pan', 1);
        await saveSearch('ration card', 2);
        expect((await loadSearchHistory()).map(h => h.query)).toEqual(['ration card', 'pan']);
    });
});

describe('SearchHistoryItem shape', () => {
    it('stores items conforming to the SearchHistoryItem interface', async () => {
        await saveSearch('invoice', 3);
        const [item]: SearchHistoryItem[] = await loadSearchHistory();
        expect(typeof item.query).toBe('string');
        expect(typeof item.timestamp).toBe('number');
        expect(typeof item.resultCount).toBe('number');
    });
});
