/**
 * Tests for useGallerySync — gallery quick/deep sync orchestration hook.
 *
 * Collaborators are mocked for isolation:
 * - ../utils/GallerySync (performFullGallerySync / performQuickSync / loadSavedCursor)
 * - ../Database (getIndexedCount)
 * - ../utils/AppLogger
 * AsyncStorage uses the repo's in-memory mock. Platform.OS / Platform.Version
 * are overridden per-test via defineProperty and restored afterwards.
 */
import { renderHook, act } from '@testing-library/react-native';
import { Alert, Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useGallerySync } from '../useGallerySync';
import {
  performFullGallerySync,
  performQuickSync,
  loadSavedCursor,
  backfillEmbeddings,
} from '../../utils/GallerySync';
import { getIndexedCount } from '../../database';
import { AppLogger } from '../../utils/AppLogger';

jest.mock('../../utils/GallerySync', () => ({
  performFullGallerySync: jest.fn(),
  performQuickSync: jest.fn(),
  loadSavedCursor: jest.fn(),
  backfillEmbeddings: jest.fn(),
}));

jest.mock('../../database', () => ({
  getIndexedCount: jest.fn(),
}));

jest.mock('../../utils/AppLogger', () => ({
  AppLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/** Let every pending promise chain (no timers involved) settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const setPlatform = (os: 'android' | 'ios', version?: number) => {
  Object.defineProperty(Platform, 'OS', {
    value: os,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(Platform, 'Version', {
    value: version,
    configurable: true,
    writable: true,
  });
};

const fullSync = performFullGallerySync as jest.Mock;
const quickSync = performQuickSync as jest.Mock;
const loadCursor = loadSavedCursor as jest.Mock;
const backfill = backfillEmbeddings as jest.Mock;
const mockedGetIndexedCount = getIndexedCount as jest.Mock;
const mockedWarn = AppLogger.warn as jest.Mock;
const mockedError = AppLogger.error as jest.Mock;

type CancelRef = { current: boolean };

describe('useGallerySync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage as unknown as { __reset: () => void }).__reset();
    setPlatform('ios');

    quickSync.mockResolvedValue({ processed: 0, wasCancelled: false });
    fullSync.mockResolvedValue({ processed: 0, wasCancelled: false });
    loadCursor.mockResolvedValue(undefined);
    backfill.mockResolvedValue(0);
    mockedGetIndexedCount.mockReturnValue(0);

    jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => {});
    jest
      .spyOn(PermissionsAndroid, 'request')
      .mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
    // StoragePermissions checks first and asks for several permissions at
    // once; route each of those through the `request` mock above so the
    // tests below can keep driving the outcome with it.
    jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
    jest
      .spyOn(PermissionsAndroid, 'requestMultiple')
      .mockImplementation(async (perms) => {
        const out: Record<string, string> = {};
        for (const p of perms) {
          out[p] = await (PermissionsAndroid.request as jest.Mock)(p);
        }
        return out as never;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    setPlatform('ios', undefined);
  });

  describe('initial state', () => {
    it('exposes all-false / zero / null initial state', async () => {
      const { result } = await renderHook(() => useGallerySync());
      expect(result.current.isSyncing).toBe(false);
      expect(result.current.isPaused).toBe(false);
      expect(result.current.isDeepSync).toBe(false);
      expect(result.current.syncCount).toBe(0);
      expect(result.current.totalImages).toBe(0);
      expect(result.current.lastSyncTime).toBeNull();
    });

    it('exposes all handler functions', async () => {
      const { result } = await renderHook(() => useGallerySync());
      expect(typeof result.current.handleQuickSync).toBe('function');
      expect(typeof result.current.handleDeepSync).toBe('function');
      expect(typeof result.current.handlePauseSync).toBe('function');
      expect(typeof result.current.handleResumeSync).toBe('function');
      expect(typeof result.current.loadPersistedCount).toBe('function');
    });
  });

  describe('loadPersistedCount', () => {
    it('sets syncCount from getIndexedCount when > 0', async () => {
      mockedGetIndexedCount.mockReturnValue(128);
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.loadPersistedCount();
      });
      expect(mockedGetIndexedCount).toHaveBeenCalledTimes(1);
      expect(result.current.syncCount).toBe(128);
    });

    it('keeps syncCount at 0 when getIndexedCount returns 0', async () => {
      mockedGetIndexedCount.mockReturnValue(0);
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.loadPersistedCount();
      });
      expect(result.current.syncCount).toBe(0);
    });

    it('loads lastSyncTime from AsyncStorage', async () => {
      await AsyncStorage.setItem('gallery_last_sync_time', '1700000000000');
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.loadPersistedCount();
      });
      expect(result.current.lastSyncTime).toBe(1700000000000);
    });

    it('leaves lastSyncTime null when nothing is stored', async () => {
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.loadPersistedCount();
      });
      expect(result.current.lastSyncTime).toBeNull();
    });

    it('warns via AppLogger and does not throw when getIndexedCount throws', async () => {
      const boom = new Error('db locked');
      mockedGetIndexedCount.mockImplementation(() => {
        throw boom;
      });
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.loadPersistedCount();
      });
      expect(mockedWarn).toHaveBeenCalledWith(
        'GallerySync',
        'Failed to load persisted state',
        boom,
      );
      expect(result.current.syncCount).toBe(0);
      expect(result.current.lastSyncTime).toBeNull();
    });

    it('warns via AppLogger when AsyncStorage.getItem rejects', async () => {
      mockedGetIndexedCount.mockReturnValue(10);
      const boom = new Error('disk gone');
      (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(boom);
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.loadPersistedCount();
      });
      // DB count was applied before storage failed
      expect(result.current.syncCount).toBe(10);
      expect(mockedWarn).toHaveBeenCalledWith(
        'GallerySync',
        'Failed to load persisted state',
        boom,
      );
    });

    it('parses the stored timestamp string into a number', async () => {
      await AsyncStorage.setItem('gallery_last_sync_time', '1699999999999');
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.loadPersistedCount();
      });
      expect(typeof result.current.lastSyncTime).toBe('number');
      expect(result.current.lastSyncTime).toBe(1699999999999);
    });
  });

  describe('handleQuickSync — permission gating', () => {
    it('on iOS proceeds without touching PermissionsAndroid', async () => {
      setPlatform('ios');
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(PermissionsAndroid.request).not.toHaveBeenCalled();
      expect(quickSync).toHaveBeenCalledTimes(1);
    });

    it('on Android API 34 requests READ_MEDIA_IMAGES', async () => {
      setPlatform('android', 34);
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(PermissionsAndroid.request).toHaveBeenCalledWith(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
      );
      expect(quickSync).toHaveBeenCalledTimes(1);
    });

    it('on Android API 30 requests READ_EXTERNAL_STORAGE', async () => {
      setPlatform('android', 30);
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(PermissionsAndroid.request).toHaveBeenCalledWith(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      );
      expect(quickSync).toHaveBeenCalledTimes(1);
    });

    it('uses API 33 as the boundary for the media permission', async () => {
      setPlatform('android', 33);
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(PermissionsAndroid.request).toHaveBeenCalledWith(
        PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
      );

      jest.clearAllMocks();
      setPlatform('android', 32);
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(PermissionsAndroid.request).toHaveBeenCalledWith(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      );
    });

    it('does nothing when permission is denied', async () => {
      setPlatform('android', 34);
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue(
        PermissionsAndroid.RESULTS.DENIED,
      );
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(quickSync).not.toHaveBeenCalled();
      expect(result.current.isSyncing).toBe(false);
      expect(result.current.lastSyncTime).toBeNull();
      expect(Alert.alert).not.toHaveBeenCalled();
    });
  });

  describe('handleQuickSync — success path', () => {
    it('isSyncing is true while the sync is in flight, then false', async () => {
      let resolveSync!: (v: { processed: number; wasCancelled: boolean }) => void;
      quickSync.mockImplementation(
        () =>
          new Promise<{ processed: number; wasCancelled: boolean }>((r) => {
            resolveSync = r;
          }),
      );
      const { result } = await renderHook(() => useGallerySync());

      await act(async () => {
        result.current.handleQuickSync();
        await flush();
      });
      expect(result.current.isSyncing).toBe(true);
      expect(result.current.isPaused).toBe(false);

      await act(async () => {
        resolveSync({ processed: 3, wasCancelled: false });
        await flush();
      });
      expect(result.current.isSyncing).toBe(false);
    });

    it('passes an onProgress callback and a fresh cancelRef to performQuickSync', async () => {
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(quickSync).toHaveBeenCalledTimes(1);
      const [onProgress, cancelRef] = quickSync.mock.calls[0];
      expect(typeof onProgress).toBe('function');
      expect((cancelRef as CancelRef).current).toBe(false);
    });

    it('maps progress callbacks onto syncCount', async () => {
      let resolveSync!: (v: { processed: number; wasCancelled: boolean }) => void;
      quickSync.mockImplementation(
        () =>
          new Promise<{ processed: number; wasCancelled: boolean }>((r) => {
            resolveSync = r;
          }),
      );
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleQuickSync();
        await flush();
      });

      const onProgress = quickSync.mock.calls[0][0] as (count: number) => void;
      await act(async () => {
        onProgress(7);
      });
      expect(result.current.syncCount).toBe(7);
      await act(async () => {
        onProgress(19);
      });
      expect(result.current.syncCount).toBe(19);

      await act(async () => {
        resolveSync({ processed: 19, wasCancelled: false });
        await flush();
      });
    });

    it('persists lastSyncTime to state and AsyncStorage on success', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(result.current.lastSyncTime).toBe(1700000000000);
      expect(await AsyncStorage.getItem('gallery_last_sync_time')).toBe(
        '1700000000000',
      );
      nowSpy.mockRestore();
    });

    it('clears a previous deep-sync flag', async () => {
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
        await flush();
      });
      expect(result.current.isDeepSync).toBe(true);

      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(result.current.isDeepSync).toBe(false);
    });

    it('resets a previously-paused cancelRef to false before starting', async () => {
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handlePauseSync();
      });
      await act(async () => {
        await result.current.handleQuickSync();
      });
      const cancelRef = quickSync.mock.calls[0][1] as CancelRef;
      expect(cancelRef.current).toBe(false);
    });
  });

  describe('handleQuickSync — failure path', () => {
    it('logs, resets syncing, and shows the Sync Error alert', async () => {
      const boom = new Error('camera roll exploded');
      quickSync.mockRejectedValue(boom);
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(mockedError).toHaveBeenCalledWith(
        'GallerySync',
        'Quick sync failed',
        boom,
      );
      expect(result.current.isSyncing).toBe(false);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Sync Error',
        'Quick sync failed. Please try again.',
      );
      expect(result.current.lastSyncTime).toBeNull();
    });
  });

  describe('handleDeepSync', () => {
    it('sets isDeepSync synchronously', async () => {
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
      });
      expect(result.current.isDeepSync).toBe(true);
    });

    it('calls performFullGallerySync with (onProgress, cancelRef, undefined)', async () => {
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
        await flush();
      });
      expect(fullSync).toHaveBeenCalledTimes(1);
      const [onProgress, cancelRef, resumeFrom] = fullSync.mock.calls[0];
      expect(typeof onProgress).toBe('function');
      expect((cancelRef as CancelRef).current).toBe(false);
      expect(resumeFrom).toBeUndefined();
      await act(async () => {
        await flush();
      });
    });

    it('maps (count, uri) progress callbacks onto syncCount', async () => {
      let resolveSync!: (v: { processed: number; wasCancelled: boolean }) => void;
      fullSync.mockImplementation(
        () =>
          new Promise<{ processed: number; wasCancelled: boolean }>((r) => {
            resolveSync = r;
          }),
      );
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
        await flush();
      });

      const onProgress = fullSync.mock.calls[0][0] as (
        count: number,
        uri?: string,
      ) => void;
      await act(async () => {
        onProgress(3, 'file:///a.jpg');
      });
      expect(result.current.syncCount).toBe(3);

      await act(async () => {
        resolveSync({ processed: 3, wasCancelled: false });
        await flush();
      });
    });

    it('on success shows the Gallery Indexed alert and persists the sync time', async () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000001);
      fullSync.mockResolvedValue({ processed: 42, wasCancelled: false });
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
        await flush();
      });

      expect(result.current.isSyncing).toBe(false);
      expect(result.current.isPaused).toBe(false);
      expect(result.current.lastSyncTime).toBe(1700000000001);
      expect(await AsyncStorage.getItem('gallery_last_sync_time')).toBe(
        '1700000000001',
      );
      expect(Alert.alert).toHaveBeenCalledWith(
        'Gallery Indexed',
        'Done! 42 photos indexed for AI search.',
      );
      nowSpy.mockRestore();
    });

    it('on cancel sets isPaused without touching lastSyncTime or alerting success', async () => {
      let resolveSync!: (v: { processed: number; wasCancelled: boolean }) => void;
      fullSync.mockImplementation(
        () =>
          new Promise<{ processed: number; wasCancelled: boolean }>((r) => {
            resolveSync = r;
          }),
      );
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
        await flush();
      });
      expect(result.current.isSyncing).toBe(true);

      await act(async () => {
        resolveSync({ processed: 9, wasCancelled: true });
        await flush();
      });
      expect(result.current.isSyncing).toBe(false);
      expect(result.current.isPaused).toBe(true);
      expect(result.current.lastSyncTime).toBeNull();
      expect(await AsyncStorage.getItem('gallery_last_sync_time')).toBeNull();
      expect(Alert.alert).not.toHaveBeenCalledWith(
        'Gallery Indexed',
        expect.anything(),
      );
    });

    it('on error logs, marks paused, and shows the Sync Paused alert', async () => {
      const boom = new Error('deep sync blew up');
      fullSync.mockRejectedValue(boom);
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
        await flush();
      });
      expect(mockedError).toHaveBeenCalledWith(
        'GallerySync',
        'Deep sync failed',
        boom,
      );
      expect(result.current.isSyncing).toBe(false);
      // errors are treated as pause — the cursor was saved
      expect(result.current.isPaused).toBe(true);
      expect(Alert.alert).toHaveBeenCalledWith(
        'Sync Paused',
        'Progress saved. Tap Resume to continue.',
      );
    });

    it('does nothing when permission is denied', async () => {
      setPlatform('android', 34);
      (PermissionsAndroid.request as jest.Mock).mockResolvedValue(
        PermissionsAndroid.RESULTS.DENIED,
      );
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
        await flush();
      });
      expect(fullSync).not.toHaveBeenCalled();
      expect(result.current.isSyncing).toBe(false);
      // isDeepSync is still set before the permission check
      expect(result.current.isDeepSync).toBe(true);
    });
  });

  describe('handlePauseSync', () => {
    it('flips the shared cancelRef to true', async () => {
      let resolveSync!: (v: { processed: number; wasCancelled: boolean }) => void;
      quickSync.mockImplementation(
        () =>
          new Promise<{ processed: number; wasCancelled: boolean }>((r) => {
            resolveSync = r;
          }),
      );
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleQuickSync();
        await flush();
      });

      const cancelRef = quickSync.mock.calls[0][1] as CancelRef;
      expect(cancelRef.current).toBe(false);
      await act(async () => {
        result.current.handlePauseSync();
      });
      expect(cancelRef.current).toBe(true);

      await act(async () => {
        resolveSync({ processed: 0, wasCancelled: true });
        await flush();
      });
    });

    it('pausing mid-flight then cancelling marks the sync paused', async () => {
      let resolveSync!: (v: { processed: number; wasCancelled: boolean }) => void;
      fullSync.mockImplementation(
        () =>
          new Promise<{ processed: number; wasCancelled: boolean }>((r) => {
            resolveSync = r;
          }),
      );
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
        await flush();
      });
      expect(result.current.isSyncing).toBe(true);

      await act(async () => {
        result.current.handlePauseSync();
      });
      const cancelRef = fullSync.mock.calls[0][1] as CancelRef;
      expect(cancelRef.current).toBe(true);

      await act(async () => {
        resolveSync({ processed: 4, wasCancelled: true });
        await flush();
      });
      expect(result.current.isSyncing).toBe(false);
      expect(result.current.isPaused).toBe(true);
    });
  });

  describe('handleResumeSync', () => {
    it('passes the saved cursor as resumeFrom to performFullGallerySync', async () => {
      loadCursor.mockResolvedValue('cursor_10');
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleResumeSync();
      });
      expect(loadCursor).toHaveBeenCalledTimes(1);
      expect(fullSync).toHaveBeenCalledTimes(1);
      expect(fullSync.mock.calls[0][2]).toBe('cursor_10');
    });

    it('passes undefined through when no cursor was saved', async () => {
      loadCursor.mockResolvedValue(undefined);
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleResumeSync();
      });
      expect(fullSync).toHaveBeenCalledTimes(1);
      expect(fullSync.mock.calls[0][2]).toBeUndefined();
    });
  });
  describe('embedding backfill', () => {
    it('starts a backfill after a quick sync finishes', async () => {
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(backfill).toHaveBeenCalledTimes(1);
    });

    it('starts a backfill after a deep sync completes', async () => {
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
        await flush();
      });
      expect(backfill).toHaveBeenCalledTimes(1);
    });

    it('does not start a backfill when a deep sync is paused', async () => {
      fullSync.mockResolvedValue({ processed: 2, wasCancelled: true });
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        result.current.handleDeepSync();
        await flush();
      });
      expect(backfill).not.toHaveBeenCalled();
    });

    it('starts a delayed backfill on launch when photos are already indexed', async () => {
      jest.useFakeTimers();
      try {
        mockedGetIndexedCount.mockReturnValue(10);
        const { result } = await renderHook(() => useGallerySync());
        await act(async () => {
          await result.current.loadPersistedCount();
        });
        expect(backfill).not.toHaveBeenCalled();
        await act(async () => {
          jest.advanceTimersByTime(5000);
        });
        expect(backfill).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('a backfill that fails to start never breaks the sync flow', async () => {
      backfill.mockImplementation(() => {
        throw new Error('boom');
      });
      const { result } = await renderHook(() => useGallerySync());
      await act(async () => {
        await result.current.handleQuickSync();
      });
      expect(result.current.isSyncing).toBe(false);
      expect(Alert.alert).not.toHaveBeenCalledWith('Sync Error', expect.anything());
      expect(mockedWarn).toHaveBeenCalledWith('GallerySync', 'Backfill failed to start', expect.any(Error));
    });
  });
});
