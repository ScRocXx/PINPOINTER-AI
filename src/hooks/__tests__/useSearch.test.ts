/**
 * useSearch.test.ts — exhaustive tests for the useSearch hook.
 *
 * The hook is tested in full isolation: ../Database, ../services/EmbeddingService
 * and ../utils/SearchHistory are module-mocked, so no real DB, no real ML models.
 *
 * Real behaviors pinned down (read from src/hooks/useSearch.ts):
 * - searchDocuments is SYNCHRONOUS (called without await) -> mockReturnValue
 * - encodeText is async -> mockResolvedValue / deferred implementations
 * - 200ms debounce for search, 800ms debounce for history save
 * - text-only search runs first and its results show immediately; the hybrid
 *   search runs only once encodeText resolves with a vector
 * - history save reuses the last result count (no second search)
 * - isCurrent staleness guard on both debounced effects
 * - mount effect has NO catch on loadSearchHistory
 */
import { renderHook, act } from '@testing-library/react-native';
import { useSearch } from '../useSearch';
import type { DocumentRecord } from '../../database';
import type { SearchHistoryItem } from '../../utils/SearchHistory';

import { searchDocuments } from '../../database';
import { encodeText, warmUpText } from '../../services/EmbeddingService';
import {
    loadSearchHistory,
    saveSearch,
    deleteSearchItem,
    clearSearchHistory,
} from '../../utils/SearchHistory';

jest.mock('../../database', () => ({
    searchDocuments: jest.fn(),
    // The hybrid step awaits this; it hands over to the searchDocuments mock,
    // so each test sets one mock for both steps.
    searchDocumentsAsync: jest.fn(async (q: string, v?: Float32Array) =>
        (jest.requireMock('../../database') as { searchDocuments: (q: string, v?: Float32Array) => unknown }).searchDocuments(q, v)),
}));

jest.mock('../../services/EmbeddingService', () => ({
    encodeText: jest.fn(),
    warmUpText: jest.fn(),
}));

jest.mock('../../services/SpellingService', () => ({
    rescueQuery: jest.fn(async () => null),
}));

jest.mock('../../utils/SearchHistory', () => ({
    loadSearchHistory: jest.fn(),
    saveSearch: jest.fn(),
    deleteSearchItem: jest.fn(),
    clearSearchHistory: jest.fn(),
}));

const mockSearchDocuments = searchDocuments as unknown as jest.Mock;
const mockRescue = (jest.requireMock('../../services/SpellingService') as { rescueQuery: jest.Mock }).rescueQuery;
const mockEncodeText = encodeText as unknown as jest.Mock;
const mockWarmUpText = warmUpText as unknown as jest.Mock;
const mockLoadSearchHistory = loadSearchHistory as unknown as jest.Mock;
const mockSaveSearch = saveSearch as unknown as jest.Mock;
const mockDeleteSearchItem = deleteSearchItem as unknown as jest.Mock;
const mockClearSearchHistory = clearSearchHistory as unknown as jest.Mock;

const doc = (id: number, title: string): DocumentRecord => ({
    id,
    title,
    content: `content for ${title}`,
    filePath: `/docs/${id}.pdf`,
    type: 'DOCUMENT',
    detection_type: 'TEXT',
    timestamp: 1_700_000_000_000 + id,
});

const historyItem = (query: string, resultCount = 1): SearchHistoryItem => ({
    query,
    timestamp: 1_700_000_000_000,
    resultCount,
});

const VECTOR = new Float32Array([0.1, 0.2, 0.3]);

let consoleSpy: jest.SpyInstance;

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockEncodeText.mockResolvedValue(VECTOR);
    mockWarmUpText.mockResolvedValue(true);
    mockSearchDocuments.mockReturnValue([]);
    mockLoadSearchHistory.mockResolvedValue([]);
    mockSaveSearch.mockResolvedValue(undefined);
    mockDeleteSearchItem.mockResolvedValue(undefined);
    mockClearSearchHistory.mockResolvedValue(undefined);
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.useRealTimers();
    consoleSpy.mockRestore();
});

/** Flush pending promise continuations (e.g. loadSearchHistory().then(...)). */
const flush = async () => {
    await act(async () => {});
};

/** Type text, then advance timers by `ms`, flushing async work. */
const typeAndWait = async (
    result: { current: ReturnType<typeof useSearch> | null },
    text: string,
    ms: number,
) => {
    await act(() => {
        result.current!.setSearchText(text);
    });
    await act(async () => {
        jest.advanceTimersByTime(ms);
    });
};

describe('useSearch — history loading on mount', () => {
    test('loads search history on mount when db is ready', async () => {
        const items = [historyItem('invoice'), historyItem('aadhaar')];
        mockLoadSearchHistory.mockResolvedValue(items);
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        expect(mockLoadSearchHistory).toHaveBeenCalledTimes(1);
        expect(result.current.searchHistory).toEqual(items);
    });

    test('does not load history when db is not ready', async () => {
        const { result } = await renderHook(() => useSearch(false));
        await flush();
        expect(mockLoadSearchHistory).not.toHaveBeenCalled();
        expect(result.current.searchHistory).toEqual([]);
    });

    test('loads history when isDbReady flips false -> true', async () => {
        const { rerender } = await renderHook(
            ({ ready }: { ready: boolean }) => useSearch(ready),
            {
                initialProps: { ready: false },
            },
        );
        await flush();
        expect(mockLoadSearchHistory).not.toHaveBeenCalled();
        await rerender({ ready: true });
        await flush();
        expect(mockLoadSearchHistory).toHaveBeenCalledTimes(1);
    });
});

describe('useSearch — debounced search (200ms)', () => {
    test('typing triggers encodeText + searchDocuments after 200ms', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'invoice', 200);
        expect(mockEncodeText).toHaveBeenCalledWith('invoice');
        expect(mockSearchDocuments).toHaveBeenNthCalledWith(1, 'invoice');
        expect(mockSearchDocuments).toHaveBeenNthCalledWith(2, 'invoice', VECTOR);
    });

    test('text results show before the query vector is ready', async () => {
        const textDocs = [doc(1, 'Invoice Jan')];
        const hybridDocs = [doc(2, 'Beach photo'), doc(1, 'Invoice Jan')];
        mockSearchDocuments.mockImplementation((_q: string, v?: Float32Array) => (v ? hybridDocs : textDocs));
        let resolveVector: (v: Float32Array | null) => void = () => {};
        mockEncodeText.mockImplementation(() => new Promise((r) => { resolveVector = r; }));
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'invoice', 200);
        // Encoder still running: text results are already on screen
        expect(result.current.searchResults).toEqual(textDocs);
        expect(result.current.isSearchPending).toBe(false);
        await act(async () => { resolveVector(VECTOR); });
        expect(result.current.searchResults).toEqual(hybridDocs);
    });

    test('text-only matches the hybrid query missed are kept after it', async () => {
        const likeOnly = doc(5, 'Aadhar (synonym match)');
        mockSearchDocuments.mockImplementation((_q: string, v?: Float32Array) => (v ? [doc(2, 'Beach')] : [likeOnly]));
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'aadhaar', 200);
        expect(result.current.searchResults).toEqual([doc(2, 'Beach'), likeOnly]);
    });

    test('loads the text encoder when search opens, not at app start', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await act(async () => { jest.advanceTimersByTime(60_000); });
        expect(mockWarmUpText).not.toHaveBeenCalled();

        await act(async () => { result.current.setIsSearching(true); });
        expect(mockWarmUpText).toHaveBeenCalledTimes(1);

        // Typing doesn't ask again; closing and reopening search does
        // (cheap when loaded: it only restarts the 10-minute countdown).
        await typeAndWait(result, 'cat', 200);
        expect(mockWarmUpText).toHaveBeenCalledTimes(1);
        await act(async () => { result.current.setIsSearching(false); });
        await act(async () => { result.current.setIsSearching(true); });
        expect(mockWarmUpText).toHaveBeenCalledTimes(2);
    });

    test('does not load the text encoder before the database is ready', async () => {
        const { result } = await renderHook(() => useSearch(false));
        await act(async () => { result.current.setIsSearching(true); });
        expect(mockWarmUpText).not.toHaveBeenCalled();
    });

    test('no search fires before the 200ms debounce elapses', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'invoice', 199);
        expect(mockEncodeText).not.toHaveBeenCalled();
        expect(mockSearchDocuments).not.toHaveBeenCalled();
        await act(async () => {
            jest.advanceTimersByTime(1);
        });
        expect(mockEncodeText).toHaveBeenCalledWith('invoice');
    });

    test('results and debouncedSearchText are set from searchDocuments', async () => {
        const docs = [doc(1, 'Invoice Jan'), doc(2, 'Invoice Feb')];
        mockSearchDocuments.mockReturnValue(docs);
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        expect(result.current.debouncedSearchText).toBe('');
        await typeAndWait(result, 'invoice', 200);
        expect(result.current.searchResults).toEqual(docs);
        expect(result.current.debouncedSearchText).toBe('invoice');
    });

    test('null query vector: only the text search runs', async () => {
        mockEncodeText.mockResolvedValue(null);
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'hello', 200);
        expect(mockSearchDocuments).toHaveBeenCalledTimes(1);
        expect(mockSearchDocuments).toHaveBeenCalledWith('hello');
    });

    test('empty query never searches and clears results', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, '', 1000);
        expect(mockEncodeText).not.toHaveBeenCalled();
        expect(mockSearchDocuments).not.toHaveBeenCalled();
        expect(result.current.searchResults).toEqual([]);
        expect(result.current.isSearchPending).toBe(false);
    });

    test('whitespace-only query never searches', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, '   ', 1000);
        expect(mockSearchDocuments).not.toHaveBeenCalled();
        expect(result.current.searchResults).toEqual([]);
    });

    test('no search when db is not ready, even with text', async () => {
        const { result } = await renderHook(() => useSearch(false));
        await flush();
        await typeAndWait(result, 'invoice', 1000);
        expect(mockEncodeText).not.toHaveBeenCalled();
        expect(mockSearchDocuments).not.toHaveBeenCalled();
        expect(result.current.searchResults).toEqual([]);
        expect(result.current.isSearchPending).toBe(false);
    });

    test('clearing the query clears results and pending state', async () => {
        mockSearchDocuments.mockReturnValue([doc(1, 'Invoice')]);
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'invoice', 200);
        expect(result.current.searchResults).toHaveLength(1);
        await act(() => {
            result.current.setSearchText('');
        });
        await flush();
        expect(result.current.searchResults).toEqual([]);
        expect(result.current.isSearchPending).toBe(false);
        // no additional DB call for the empty query (2 = text + hybrid for 'invoice')
        expect(mockSearchDocuments).toHaveBeenCalledTimes(2);
    });

    test('isSearchPending is true while debouncing, false after completion', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await act(() => {
            result.current.setSearchText('invoice');
        });
        expect(result.current.isSearchPending).toBe(true);
        await act(async () => {
            jest.advanceTimersByTime(200);
        });
        expect(result.current.isSearchPending).toBe(false);
    });

    test('encodeText rejection: text results kept, error logged, pending cleared', async () => {
        mockEncodeText.mockRejectedValue(new Error('model missing'));
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'invoice', 200);
        expect(mockSearchDocuments).toHaveBeenCalledTimes(1);
        expect(mockSearchDocuments).toHaveBeenCalledWith('invoice');
        expect(consoleSpy).toHaveBeenCalledWith(
            '[Search] search error:',
            expect.any(Error),
        );
        expect(result.current.isSearchPending).toBe(false);
        expect(result.current.searchResults).toEqual([]);
    });

    test('searchDocuments throwing synchronously is caught', async () => {
        mockSearchDocuments.mockImplementation(() => {
            throw new Error('db gone');
        });
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'invoice', 200);
        expect(consoleSpy).toHaveBeenCalledWith(
            '[Search] search error:',
            expect.any(Error),
        );
        expect(result.current.isSearchPending).toBe(false);
        expect(result.current.searchResults).toEqual([]);
    });
});

describe('useSearch — staleness / rapid typing', () => {
    test('rapid typing only searches the latest query', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await act(() => {
            result.current.setSearchText('a');
        });
        await act(() => {
            jest.advanceTimersByTime(100);
        });
        await act(() => {
            result.current.setSearchText('ab');
        });
        await act(async () => {
            jest.advanceTimersByTime(200);
        });
        expect(mockEncodeText).toHaveBeenCalledTimes(1);
        expect(mockEncodeText).toHaveBeenCalledWith('ab');
        expect(mockSearchDocuments).toHaveBeenCalledTimes(2);
        expect(mockSearchDocuments).toHaveBeenNthCalledWith(1, 'ab');
        expect(mockSearchDocuments).toHaveBeenNthCalledWith(2, 'ab', VECTOR);
    });

    test('in-flight encodeText for a stale query is discarded (isCurrent guard)', async () => {
        const resolvers: Array<(v: Float32Array | null) => void> = [];
        mockEncodeText.mockImplementation(
            () =>
                new Promise<Float32Array | null>((resolve) => {
                    resolvers.push(resolve);
                }),
        );
        const { result } = await renderHook(() => useSearch(true));
        await flush();

        // t=0: type 'a', let its 200ms timer fire so encodeText('a') is in flight
        await act(() => {
            result.current.setSearchText('a');
        });
        await act(async () => {
            jest.advanceTimersByTime(200);
        });
        expect(mockEncodeText).toHaveBeenCalledWith('a');
        expect(resolvers).toHaveLength(1);
        // the text search for 'a' already ran
        expect(mockSearchDocuments).toHaveBeenCalledTimes(1);
        expect(mockSearchDocuments).toHaveBeenCalledWith('a');

        // change query -> cleanup marks the 'a' run as stale
        await act(() => {
            result.current.setSearchText('ab');
        });

        // late resolution of the stale 'a' encode must not run the hybrid query
        resolvers[0](new Float32Array([9]));
        await flush();
        expect(mockSearchDocuments).toHaveBeenCalledTimes(1);

        // the 'ab' timer fires and completes normally
        await act(async () => {
            jest.advanceTimersByTime(200);
        });
        expect(mockEncodeText).toHaveBeenCalledWith('ab');
        resolvers[1](new Float32Array([8]));
        await flush();
        expect(mockSearchDocuments).toHaveBeenCalledTimes(3);
        expect(mockSearchDocuments).toHaveBeenNthCalledWith(2, 'ab');
        expect(mockSearchDocuments).toHaveBeenLastCalledWith(
            'ab',
            expect.any(Float32Array),
        );
        expect(result.current.searchResults).toEqual([]);
        expect(result.current.debouncedSearchText).toBe('ab');
    });

    test('unmount clears pending timers: no search after unmount', async () => {
        const { result, unmount } = await renderHook(() => useSearch(true));
        await flush();
        await act(() => {
            result.current.setSearchText('invoice');
        });
        await unmount();
        await act(async () => {
            jest.advanceTimersByTime(2000);
        });
        expect(mockEncodeText).not.toHaveBeenCalled();
        expect(mockSearchDocuments).not.toHaveBeenCalled();
        expect(mockSaveSearch).not.toHaveBeenCalled();
    });
});

describe('useSearch — history save (800ms debounce)', () => {
    test('saveSearch fires after 800ms with query and result count', async () => {
        mockSearchDocuments.mockReturnValue([doc(1, 'A'), doc(2, 'B'), doc(3, 'C')]);
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'invoice', 800);
        expect(mockSaveSearch).toHaveBeenCalledTimes(1);
        expect(mockSaveSearch).toHaveBeenCalledWith('invoice', 3);
    });

    test('saveSearch not called before 800ms elapse', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'invoice', 799);
        expect(mockSaveSearch).not.toHaveBeenCalled();
        await act(async () => {
            jest.advanceTimersByTime(1);
        });
        expect(mockSaveSearch).toHaveBeenCalledTimes(1);
    });

    test('history list is refreshed from storage after save', async () => {
        const fresh = [historyItem('invoice', 2)];
        mockLoadSearchHistory.mockResolvedValue(fresh);
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        // mount consumed the first resolved value; re-arm for the post-save reload
        mockLoadSearchHistory.mockResolvedValue([historyItem('invoice', 2)]);
        await typeAndWait(result, 'invoice', 800);
        expect(mockLoadSearchHistory).toHaveBeenCalledTimes(2);
        expect(result.current.searchHistory).toEqual([historyItem('invoice', 2)]);
    });

    test('history save reuses the search result count instead of searching again', async () => {
        mockSearchDocuments.mockReturnValue([doc(1, 'A'), doc(2, 'B')]);
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'invoice', 800);
        expect(mockEncodeText).toHaveBeenCalledTimes(1);
        expect(mockSearchDocuments).toHaveBeenCalledTimes(2); // text + hybrid only
        expect(mockSaveSearch).toHaveBeenCalledWith('invoice', 2);
    });

    test('no history save for empty query', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, '', 2000);
        expect(mockSaveSearch).not.toHaveBeenCalled();
    });

    test('no history save when db is not ready', async () => {
        const { result } = await renderHook(() => useSearch(false));
        await flush();
        await typeAndWait(result, 'invoice', 2000);
        expect(mockSaveSearch).not.toHaveBeenCalled();
    });

    test('saveSearch rejection is caught and logged', async () => {
        mockSaveSearch.mockRejectedValue(new Error('disk full'));
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'invoice', 800);
        expect(consoleSpy).toHaveBeenCalledWith(
            '[Search] saveSearch error:',
            expect.any(Error),
        );
    });
});

describe('useSearch — history handlers', () => {
    test('handleSelectHistory sets text and searching flag, then searches', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await act(() => {
            result.current.handleSelectHistory('old query');
        });
        expect(result.current.searchText).toBe('old query');
        expect(result.current.isSearching).toBe(true);
        await act(async () => {
            jest.advanceTimersByTime(200);
        });
        expect(mockSearchDocuments).toHaveBeenCalledWith(
            'old query',
            expect.any(Float32Array),
        );
    });

    test('setIsSearching toggles the searching flag', async () => {
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        expect(result.current.isSearching).toBe(false);
        await act(() => {
            result.current.setIsSearching(true);
        });
        expect(result.current.isSearching).toBe(true);
        await act(() => {
            result.current.setIsSearching(false);
        });
        expect(result.current.isSearching).toBe(false);
    });

    test('handleDeleteHistory deletes and reloads history', async () => {
        mockLoadSearchHistory.mockResolvedValue([historyItem('keep')]);
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        expect(result.current.searchHistory).toEqual([historyItem('keep')]);

        mockLoadSearchHistory.mockResolvedValue([]);
        await act(async () => {
            await result.current.handleDeleteHistory('keep');
        });
        expect(mockDeleteSearchItem).toHaveBeenCalledWith('keep');
        expect(mockLoadSearchHistory).toHaveBeenCalledTimes(2);
        expect(result.current.searchHistory).toEqual([]);
    });

    test('handleClearHistory clears storage and local state', async () => {
        mockLoadSearchHistory.mockResolvedValue([historyItem('a'), historyItem('b')]);
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        expect(result.current.searchHistory).toHaveLength(2);

        await act(async () => {
            await result.current.handleClearHistory();
        });
        expect(mockClearSearchHistory).toHaveBeenCalledTimes(1);
        expect(result.current.searchHistory).toEqual([]);
    });

    test('handler identities are stable across re-renders (useCallback)', async () => {
        const { result, rerender } = await renderHook(() => useSearch(true));
        await flush();
        const first = {
            select: result.current.handleSelectHistory,
            del: result.current.handleDeleteHistory,
            clear: result.current.handleClearHistory,
        };
        await rerender(undefined);
        expect(result.current.handleSelectHistory).toBe(first.select);
        expect(result.current.handleDeleteHistory).toBe(first.del);
        expect(result.current.handleClearHistory).toBe(first.clear);
    });
});

describe('useSearch — spelling rescue', () => {
    test('when the typed words find nothing, shows results for the corrected words and says what was typed', async () => {
        const found = [doc(1, 'Medicine slip')];
        mockSearchDocuments.mockImplementation((q: string) => (q === 'medicine' ? found : []));
        mockRescue.mockResolvedValueOnce({ query: 'medicine', corrections: [{ from: 'medicne', to: 'medicine' }] });
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'medicne', 200);
        await flush();
        expect(mockRescue).toHaveBeenCalledWith('medicne');
        expect(result.current.searchResults).toEqual(found);
        expect(result.current.debouncedSearchText).toBe('medicine');
        expect(result.current.correctedFrom).toBe('medicne');
        // The look-alike step uses the corrected words too.
        expect(mockEncodeText.mock.calls[0][0]).toContain('medicine');
        expect(mockEncodeText.mock.calls[0][0]).not.toContain('medicne');
    });

    test('does not correct anything when the typed words find something', async () => {
        mockSearchDocuments.mockReturnValue([doc(2, 'Bill')]);
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'bill', 200);
        await flush();
        expect(mockRescue).not.toHaveBeenCalled();
        expect(result.current.correctedFrom).toBeNull();
    });

    test('keeps "nothing found" when the correction finds nothing either', async () => {
        mockSearchDocuments.mockReturnValue([]);
        mockRescue.mockResolvedValueOnce({ query: 'ticket', corrections: [{ from: 'tikcet', to: 'ticket' }] });
        const { result } = await renderHook(() => useSearch(true));
        await flush();
        await typeAndWait(result, 'tikcet', 200);
        await flush();
        expect(result.current.searchResults).toEqual([]);
        expect(result.current.correctedFrom).toBeNull();
        expect(result.current.debouncedSearchText).toBe('tikcet');
    });
});
