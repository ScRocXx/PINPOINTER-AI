/**
 * Tests for usePinpointer — the thin composition hook wiring search, sync
 * and voice.
 *
 * All four sub-hooks (useSearch, useGallerySync, useDocumentSync,
 * useVoiceRecording) are mocked so these tests assert ONLY the composition
 * logic: wiring, the onTranscription cleanup, and the mount/unmount lifecycle.
 *
 * NOTE: @testing-library/react-native v14 made renderHook/render async —
 * every call site awaits them.
 */
import { renderHook, act } from '@testing-library/react-native';
import { usePinpointer } from '../usePinpointer';

jest.mock('../useSearch', () => ({ useSearch: jest.fn() }));
jest.mock('../useGallerySync', () => ({ useGallerySync: jest.fn() }));
jest.mock('../useDocumentSync', () => ({ useDocumentSync: jest.fn() }));
jest.mock('../useVoiceRecording', () => ({ useVoiceRecording: jest.fn() }));

import { useSearch } from '../useSearch';
import { useGallerySync } from '../useGallerySync';
import { useDocumentSync } from '../useDocumentSync';
import { useVoiceRecording } from '../useVoiceRecording';

const mockUseSearch = useSearch as jest.Mock;
const mockUseGallerySync = useGallerySync as jest.Mock;
const mockUseDocumentSync = useDocumentSync as jest.Mock;
const mockUseVoiceRecording = useVoiceRecording as jest.Mock;

/** Captures the onTranscription callback the hook hands to useVoiceRecording. */
const getOnTranscription = (): ((text: string) => void) => {
    expect(mockUseVoiceRecording).toHaveBeenCalled();
    return mockUseVoiceRecording.mock.calls[0][0] as (text: string) => void;
};

describe('usePinpointer — composition wiring', () => {
    let searchState: Record<string, unknown>;
    let galleryState: Record<string, unknown>;
    let docState: Record<string, unknown>;
    let voiceState: Record<string, unknown>;

    beforeEach(() => {
        jest.clearAllMocks();

        searchState = {
            searchText: 'bill',
            setSearchText: jest.fn(),
            debouncedSearchText: 'bill',
            searchResults: [{ id: 1 }],
            isSearching: true,
            setIsSearching: jest.fn(),
            isSearchPending: false,
            searchHistory: [],
            handleSelectHistory: jest.fn(),
            handleDeleteHistory: jest.fn(),
            handleClearHistory: jest.fn(),
        };
        galleryState = {
            isSyncing: false,
            isPaused: false,
            isDeepSync: false,
            syncCount: 42,
            lastSyncTime: 123456,
            handleQuickSync: jest.fn(),
            handleDeepSync: jest.fn(),
            handlePauseSync: jest.fn(),
            handleResumeSync: jest.fn(),
            loadPersistedCount: jest.fn(),
        };
        docState = {
            isSyncingDocs: false,
            docSyncCount: 7,
            totalDocs: 10,
            lastDocSyncTime: 999,
            handleDocumentSync: jest.fn(),
            loadPersistedState: jest.fn(),
        };
        voiceState = {
            isRecording: false,
            isTranscribing: false,
            isModelLoading: false,
            startListening: jest.fn(),
            stopListening: jest.fn(),
            cancelListening: jest.fn(),
            cleanupRecording: jest.fn(),
        };

        mockUseSearch.mockReturnValue(searchState);
        mockUseGallerySync.mockReturnValue(galleryState);
        mockUseDocumentSync.mockReturnValue(docState);
        mockUseVoiceRecording.mockReturnValue(voiceState);
    });

    test('passes DB-ready flag true to useSearch', async () => {
        await renderHook(() => usePinpointer());
        expect(mockUseSearch).toHaveBeenCalledWith(true);
    });

    test('exposes search state and handlers from useSearch', async () => {
        const { result } = await renderHook(() => usePinpointer());
        expect(result.current.searchText).toBe('bill');
        expect(result.current.searchResults).toEqual([{ id: 1 }]);
        expect(result.current.isSearching).toBe(true);
        expect(result.current.isSearchPending).toBe(false);
        expect(result.current.searchHistory).toEqual([]);
        expect(result.current.setSearchText).toBe(searchState.setSearchText);
        expect(result.current.setIsSearching).toBe(searchState.setIsSearching);
        expect(result.current.handleSelectHistory).toBe(searchState.handleSelectHistory);
        expect(result.current.handleDeleteHistory).toBe(searchState.handleDeleteHistory);
        expect(result.current.handleClearHistory).toBe(searchState.handleClearHistory);
    });

    test('does not leak debouncedSearchText (destructured but not returned)', async () => {
        const { result } = await renderHook(() => usePinpointer());
        expect('debouncedSearchText' in result.current).toBe(false);
    });

    test('exposes gallery sync state and handlers from useGallerySync', async () => {
        const { result } = await renderHook(() => usePinpointer());
        expect(result.current.isSyncing).toBe(false);
        expect(result.current.isPaused).toBe(false);
        expect(result.current.isDeepSync).toBe(false);
        expect(result.current.syncCount).toBe(42);
        expect(result.current.lastSyncTime).toBe(123456);
        expect(result.current.handleQuickSync).toBe(galleryState.handleQuickSync);
        expect(result.current.handleDeepSync).toBe(galleryState.handleDeepSync);
        expect(result.current.handlePauseSync).toBe(galleryState.handlePauseSync);
        expect(result.current.handleResumeSync).toBe(galleryState.handleResumeSync);
    });

    test('exposes document sync state and handlers from useDocumentSync', async () => {
        const { result } = await renderHook(() => usePinpointer());
        expect(result.current.isSyncingDocs).toBe(false);
        expect(result.current.docSyncCount).toBe(7);
        expect(result.current.totalDocs).toBe(10);
        expect(result.current.lastDocSyncTime).toBe(999);
        expect(result.current.handleDocumentSync).toBe(docState.handleDocumentSync);
    });

    test('exposes voice state and handlers from useVoiceRecording', async () => {
        const { result } = await renderHook(() => usePinpointer());
        expect(result.current.isRecording).toBe(false);
        expect(result.current.isTranscribing).toBe(false);
        expect(result.current.isModelLoading).toBe(false);
        expect(result.current.startListening).toBe(voiceState.startListening);
        expect(result.current.stopListening).toBe(voiceState.stopListening);
        expect(result.current.cancelListening).toBe(voiceState.cancelListening);
    });

    test('loads persisted state on mount and cleans up recording on unmount', async () => {
        const { unmount } = await renderHook(() => usePinpointer());
        expect(galleryState.loadPersistedCount).toHaveBeenCalledTimes(1);
        expect(docState.loadPersistedState).toHaveBeenCalledTimes(1);
        await unmount();
        expect(voiceState.cleanupRecording).toHaveBeenCalledTimes(1);
    });
});

describe('usePinpointer — onTranscription cleanup', () => {
    let setSearchText: jest.Mock;
    let setIsSearching: jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        setSearchText = jest.fn();
        setIsSearching = jest.fn();
        mockUseSearch.mockReturnValue({
            searchText: '', setSearchText, debouncedSearchText: '',
            searchResults: [], isSearching: false, setIsSearching, isSearchPending: false,
            searchHistory: [], handleSelectHistory: jest.fn(),
            handleDeleteHistory: jest.fn(), handleClearHistory: jest.fn(),
        });
        mockUseGallerySync.mockReturnValue({ loadPersistedCount: jest.fn() });
        mockUseDocumentSync.mockReturnValue({ loadPersistedState: jest.fn() });
        mockUseVoiceRecording.mockReturnValue({ cleanupRecording: jest.fn() });
    });

    const transcribe = async (text: string) => {
        await renderHook(() => usePinpointer());
        await act(() => {
            getOnTranscription()(text);
        });
    };

    test.each([
        ['Search for my Aadhar Card.', 'aadhar card'],
        ['search for a cat', 'cat'],
        ['search for my bill', 'bill'],
        ['find my invoice', 'invoice'],
        ['find a receipt', 'receipt'],
        ['look for my keys', 'keys'],
        ['look for the wallet', 'the wallet'],
        ['where is my passport', 'passport'],
        ['where is the charger', 'charger'],
        ['show me my photos', 'photos'],
        ['show me a video', 'video'],
    ])('strips voice prefix: %p → %p', async (input, expected) => {
        await transcribe(input);
        expect(setSearchText).toHaveBeenCalledWith(expected);
        expect(setIsSearching).toHaveBeenCalledWith(true);
    });

    test('lowercases and trims text without any prefix', async () => {
        await transcribe('  HELLO World  ');
        expect(setSearchText).toHaveBeenCalledWith('hello world');
    });

    test.each([
        ['My Bill?', 'my bill'],
        ['note!', 'note'],
        ['reminder.', 'reminder'],
    ])('strips trailing STT punctuation: %p → %p', async (input, expected) => {
        await transcribe(input);
        expect(setSearchText).toHaveBeenCalledWith(expected);
    });

    test('falls back to raw text when only a prefix was spoken', async () => {
        await transcribe('search ');
        expect(setSearchText).toHaveBeenCalledWith('search');
    });

    test('lone "search" without trailing space is kept as-is', async () => {
        await transcribe('search');
        expect(setSearchText).toHaveBeenCalledWith('search');
    });

    test('first matching prefix in list order wins', async () => {
        // "search for a " appears before the shorter "search " in the list
        await transcribe('search for a cat');
        expect(setSearchText).toHaveBeenCalledWith('cat');
    });
});
