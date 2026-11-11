/**
 * Tests for usePinpointer — the thin composition hook wiring search, sync,
 * voice, scan, share, and edit.
 *
 * All four sub-hooks (useSearch, useGallerySync, useDocumentSync,
 * useVoiceRecording) plus Database, VisionPipeline, image-picker, and
 * AppLogger are mocked so these tests assert ONLY the composition logic:
 * wiring, the onTranscription cleanup, handleScan, handleShare, handleEdit,
 * and the mount/unmount lifecycle.
 *
 * NOTE: @testing-library/react-native v14 made renderHook/render async —
 * every call site awaits them.
 */
import { renderHook, act } from '@testing-library/react-native';
import { Platform, Alert, Share, Linking, NativeModules } from 'react-native';
import { usePinpointer } from '../usePinpointer';

jest.mock('../useSearch', () => ({ useSearch: jest.fn() }));
jest.mock('../useGallerySync', () => ({ useGallerySync: jest.fn() }));
jest.mock('../useDocumentSync', () => ({ useDocumentSync: jest.fn() }));
jest.mock('../useVoiceRecording', () => ({ useVoiceRecording: jest.fn() }));
jest.mock('react-native-image-picker', () => ({ launchImageLibrary: jest.fn() }));
jest.mock('../../database', () => ({ indexDocument: jest.fn() }));
jest.mock('../../utils/VisionPipeline', () => ({ analyzeImage: jest.fn() }));
jest.mock('../../utils/AppLogger', () => ({
    AppLogger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { useSearch } from '../useSearch';
import { useGallerySync } from '../useGallerySync';
import { useDocumentSync } from '../useDocumentSync';
import { useVoiceRecording } from '../useVoiceRecording';
import { launchImageLibrary } from 'react-native-image-picker';
import { indexDocument } from '../../database';
import { analyzeImage } from '../../utils/VisionPipeline';
import { AppLogger } from '../../utils/AppLogger';

const mockUseSearch = useSearch as jest.Mock;
const mockUseGallerySync = useGallerySync as jest.Mock;
const mockUseDocumentSync = useDocumentSync as jest.Mock;
const mockUseVoiceRecording = useVoiceRecording as jest.Mock;
const mockLaunchImageLibrary = launchImageLibrary as jest.Mock;
const mockIndexDocument = indexDocument as jest.Mock;
const mockAnalyzeImage = analyzeImage as jest.Mock;

// The RN jest preset leaves Share/Alert/Linking as real implementations —
// spy on them so calls are observable (spies survive jest.clearAllMocks).
const mockAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
const mockShare = jest.spyOn(Share, 'share').mockImplementation(async () => ({} as never));
const mockOpenURL = jest.spyOn(Linking, 'openURL').mockImplementation(async () => {});

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
            totalImages: 100,
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
            audioLevel: 0,
            recordingDuration: 0,
            startListening: jest.fn(),
            stopListening: jest.fn(),
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
        expect(result.current.totalImages).toBe(100);
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
        expect(result.current.audioLevel).toBe(0);
        expect(result.current.recordingDuration).toBe(0);
        expect(result.current.startListening).toBe(voiceState.startListening);
        expect(result.current.stopListening).toBe(voiceState.stopListening);
    });

    test('own image-viewer state starts null and updates via setSelectedImage', async () => {
        const { result } = await renderHook(() => usePinpointer());
        expect(result.current.selectedImage).toBeNull();
        await act(() => {
            result.current.setSelectedImage('file:///a.jpg');
        });
        expect(result.current.selectedImage).toBe('file:///a.jpg');
        await act(() => {
            result.current.setSelectedImage(null);
        });
        expect(result.current.selectedImage).toBeNull();
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

describe('usePinpointer — handleScan', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUseSearch.mockReturnValue({ setSearchText: jest.fn(), setIsSearching: jest.fn() });
        mockUseGallerySync.mockReturnValue({ loadPersistedCount: jest.fn() });
        mockUseDocumentSync.mockReturnValue({ loadPersistedState: jest.fn() });
        mockUseVoiceRecording.mockReturnValue({ cleanupRecording: jest.fn() });
    });

    const renderAndScan = async () => {
        const { result } = await renderHook(() => usePinpointer());
        await act(async () => {
            await result.current.handleScan();
        });
        return result;
    };

    test('happy path: picks image, reads text, indexes it, says it is ready to find', async () => {
        mockLaunchImageLibrary.mockResolvedValue({ assets: [{ uri: 'file:///photo.jpg' }] });
        mockAnalyzeImage.mockResolvedValue({ detection_type: 'TEXT', content: 'Hello World' });

        await renderAndScan();

        expect(mockLaunchImageLibrary).toHaveBeenCalledWith({
            mediaType: 'photo', quality: 0.5, maxWidth: 1024, maxHeight: 1024,
        });
        expect(mockAnalyzeImage).toHaveBeenCalledWith('file:///photo.jpg');
        expect(mockIndexDocument).toHaveBeenCalledWith(
            null,
            expect.stringContaining('Hello'),
            'file:///photo.jpg',
            'IMAGE',
            'TEXT',
        );
        expect(mockAlert).toHaveBeenCalledWith(
            'Ready to find',
            'You can now search for the words in this photo.',
        );
    });

    test('no readable text: nothing is indexed and it says no words were found', async () => {
        mockLaunchImageLibrary.mockResolvedValue({ assets: [{ uri: 'file:///blank.jpg' }] });
        mockAnalyzeImage.mockResolvedValue({ detection_type: 'EMPTY', content: '' });

        await renderAndScan();

        expect(mockIndexDocument).not.toHaveBeenCalled();
        expect(mockAlert).toHaveBeenCalledWith('No words found', expect.stringContaining('clearer photo'));
        expect(mockAlert).not.toHaveBeenCalledWith('Ready to find', expect.any(String));
    });

    test('only objects (no words) is not a success either', async () => {
        mockLaunchImageLibrary.mockResolvedValue({ assets: [{ uri: 'file:///dog.jpg' }] });
        mockAnalyzeImage.mockResolvedValue({ detection_type: 'OBJECT', content: 'Dog Grass' });

        await renderAndScan();

        expect(mockIndexDocument).not.toHaveBeenCalled();
        expect(mockAlert).toHaveBeenCalledWith('No words found', expect.any(String));
    });

    test('cancelled picker is a silent no-op', async () => {
        mockLaunchImageLibrary.mockResolvedValue({ didCancel: true });

        await renderAndScan();

        expect(mockAnalyzeImage).not.toHaveBeenCalled();
        expect(mockIndexDocument).not.toHaveBeenCalled();
        expect(mockAlert).not.toHaveBeenCalled();
    });

    test('result without assets is a silent no-op', async () => {
        mockLaunchImageLibrary.mockResolvedValue({});

        await renderAndScan();

        expect(mockAnalyzeImage).not.toHaveBeenCalled();
        expect(mockIndexDocument).not.toHaveBeenCalled();
        expect(mockAlert).not.toHaveBeenCalled();
    });

    test('asset without uri is a silent no-op', async () => {
        mockLaunchImageLibrary.mockResolvedValue({ assets: [{}] });

        await renderAndScan();

        expect(mockAnalyzeImage).not.toHaveBeenCalled();
        expect(mockIndexDocument).not.toHaveBeenCalled();
    });

    test('picker rejection surfaces OCR error alert and logs', async () => {
        const err = new Error('picker exploded');
        mockLaunchImageLibrary.mockRejectedValue(err);

        await renderAndScan();

        expect(AppLogger.error).toHaveBeenCalledWith('Pinpointer', 'OCR scan failed', err);
        expect(mockAlert).toHaveBeenCalledWith('This photo could not be read', 'Please try again, or pick another photo.');
        expect(mockIndexDocument).not.toHaveBeenCalled();
    });

    test('analyzeImage rejection surfaces OCR error alert and logs', async () => {
        const err = new Error('vision exploded');
        mockLaunchImageLibrary.mockResolvedValue({ assets: [{ uri: 'file:///x.jpg' }] });
        mockAnalyzeImage.mockRejectedValue(err);

        await renderAndScan();

        expect(AppLogger.error).toHaveBeenCalledWith('Pinpointer', 'OCR scan failed', err);
        expect(mockAlert).toHaveBeenCalledWith('This photo could not be read', 'Please try again, or pick another photo.');
        expect(mockIndexDocument).not.toHaveBeenCalled();
    });
});

describe('usePinpointer — handleShare / handleEdit', () => {
    const originalOS = Platform.OS;
    const storageModule = NativeModules.StorageModule as { shareImage?: jest.Mock };
    const originalShareImage = storageModule.shareImage;

    beforeEach(() => {
        jest.clearAllMocks();
        mockUseSearch.mockReturnValue({ setSearchText: jest.fn(), setIsSearching: jest.fn() });
        mockUseGallerySync.mockReturnValue({ loadPersistedCount: jest.fn() });
        mockUseDocumentSync.mockReturnValue({ loadPersistedState: jest.fn() });
        mockUseVoiceRecording.mockReturnValue({ cleanupRecording: jest.fn() });
        storageModule.shareImage = originalShareImage;
    });

    afterEach(() => {
        jest.replaceProperty(Platform, 'OS', originalOS);
        storageModule.shareImage = originalShareImage;
    });

    const selectImage = async (uri: string | null) => {
        const { result } = await renderHook(() => usePinpointer());
        await act(() => {
            result.current.setSelectedImage(uri);
        });
        return result;
    };

    test('handleShare does nothing when no image is selected', async () => {
        const result = await selectImage(null);
        await act(() => {
            result.current.handleShare();
        });
        expect(mockShare).not.toHaveBeenCalled();
        expect(storageModule.shareImage).not.toHaveBeenCalled();
    });

    test('handleShare on android uses StorageModule.shareImage with file:// stripped', async () => {
        jest.replaceProperty(Platform, 'OS', 'android');
        const result = await selectImage('file:///sdcard/pic.jpg');
        await act(() => {
            result.current.handleShare();
        });
        expect(storageModule.shareImage).toHaveBeenCalledWith('/sdcard/pic.jpg');
        expect(mockShare).not.toHaveBeenCalled();
    });

    test('handleShare on android falls back to mockShare when shareImage is missing', async () => {
        jest.replaceProperty(Platform, 'OS', 'android');
        delete storageModule.shareImage;
        const result = await selectImage('file:///sdcard/pic.jpg');
        await act(() => {
            result.current.handleShare();
        });
        expect(mockShare).toHaveBeenCalledWith({ url: 'file:///sdcard/pic.jpg' });
    });

    test('handleShare on ios uses mockShare', async () => {
        jest.replaceProperty(Platform, 'OS', 'ios');
        const result = await selectImage('file:///pic.jpg');
        await act(() => {
            result.current.handleShare();
        });
        expect(mockShare).toHaveBeenCalledWith({ url: 'file:///pic.jpg' });
    });

    test('handleEdit opens the selected image URL', async () => {
        const result = await selectImage('file:///pic.jpg');
        await act(() => {
            result.current.handleEdit();
        });
        expect(mockOpenURL).toHaveBeenCalledWith('file:///pic.jpg');
    });

    test('handleEdit does nothing when no image is selected', async () => {
        const result = await selectImage(null);
        await act(() => {
            result.current.handleEdit();
        });
        expect(mockOpenURL).not.toHaveBeenCalled();
    });
});
