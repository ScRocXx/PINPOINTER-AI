/**
 * Tests for the background indexing headless task and its scheduler wrapper.
 * IndexingService is mocked; the task's job is to check permission, open the
 * database, run deep sync, drop deleted files, backfill, and stop on time or on request.
 */
import { DeviceEventEmitter, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import {
  STOP_EVENT,
  runBackgroundIndexing,
  scheduleBackgroundIndexing,
} from '../BackgroundIndexingTask';
import { IndexingService } from '../IndexingService';
import { setupDatabase } from '../../database';
import { loadSavedCursor } from '../../utils/GallerySync';

jest.mock('../IndexingService', () => ({
  IndexingService: { deepGallerySync: jest.fn(), pruneMissing: jest.fn(), backfill: jest.fn(), pause: jest.fn() },
}));
jest.mock('../../database', () => ({ setupDatabase: jest.fn() }));
jest.mock('../../utils/GallerySync', () => ({ loadSavedCursor: jest.fn() }));
jest.mock('../../utils/AppLogger', () => ({
  AppLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const deep = IndexingService.deepGallerySync as jest.Mock;
const prune = IndexingService.pruneMissing as jest.Mock;
const backfill = IndexingService.backfill as jest.Mock;
const pause = IndexingService.pause as jest.Mock;

const setPlatform = (os: string, version = 34) => {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
  Object.defineProperty(Platform, 'Version', { value: version, configurable: true, writable: true });
};

let checkSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('android');
  checkSpy = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);
  (loadSavedCursor as jest.Mock).mockResolvedValue('cursor_40');
  deep.mockResolvedValue({ processed: 12, wasCancelled: false });
  prune.mockResolvedValue(2);
  backfill.mockResolvedValue(3);
});

afterEach(() => {
  jest.useRealTimers();
  checkSpy.mockRestore();
  setPlatform('ios');
});

describe('runBackgroundIndexing', () => {
  test('opens the database, resumes deep sync from the saved cursor, drops deleted files, then backfills', async () => {
    await expect(runBackgroundIndexing({ budgetMs: 1000 })).resolves.toBe('finished');

    expect(setupDatabase).toHaveBeenCalled();
    expect(deep).toHaveBeenCalledWith(undefined, 'cursor_40');
    expect(prune).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(prune.mock.invocationCallOrder[0]).toBeLessThan(backfill.mock.invocationCallOrder[0]);
    expect(pause).not.toHaveBeenCalled();
  });

  test('does nothing without gallery permission, and never asks for it', async () => {
    checkSpy.mockResolvedValue(false);
    const request = jest.spyOn(PermissionsAndroid, 'request');

    await expect(runBackgroundIndexing()).resolves.toBe('no-permission');

    expect(checkSpy).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
    expect(request).not.toHaveBeenCalled();
    expect(deep).not.toHaveBeenCalled();
  });

  test('runs with only "Select photos" (limited) access on Android 14+', async () => {
    setPlatform('android', 34);
    checkSpy.mockImplementation(async (perm: string) =>
      perm === PermissionsAndroid.PERMISSIONS.READ_MEDIA_VISUAL_USER_SELECTED);

    await expect(runBackgroundIndexing()).resolves.toBe('finished');

    expect(checkSpy).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.READ_MEDIA_VISUAL_USER_SELECTED);
    expect(deep).toHaveBeenCalled();
  });

  test('uses the old storage permission before Android 13', async () => {
    setPlatform('android', 30);
    await runBackgroundIndexing();
    expect(checkSpy).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
  });

  test('pauses when the time budget runs out, and skips the backfill', async () => {
    jest.useFakeTimers();
    let finish!: (v: unknown) => void;
    deep.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));

    const run = runBackgroundIndexing({ budgetMs: 5000 });
    await jest.advanceTimersByTimeAsync(5000);
    expect(pause).toHaveBeenCalledTimes(1);

    finish({ processed: 4, wasCancelled: true });
    await expect(run).resolves.toBe('stopped');
    expect(prune).not.toHaveBeenCalled();
    expect(backfill).not.toHaveBeenCalled();
  });

  test('a stop during the clean-up skips the backfill', async () => {
    prune.mockImplementation(async () => {
      DeviceEventEmitter.emit(STOP_EVENT);
      return 0;
    });

    await expect(runBackgroundIndexing({ budgetMs: 60_000 })).resolves.toBe('stopped');
    expect(pause).toHaveBeenCalledTimes(1);
    expect(backfill).not.toHaveBeenCalled();
  });

  test('pauses when Android says the conditions stopped holding', async () => {
    let finish!: (v: unknown) => void;
    deep.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));

    const run = runBackgroundIndexing({ budgetMs: 60_000 });
    for (let i = 0; i < 50 && deep.mock.calls.length === 0; i++) await Promise.resolve();
    DeviceEventEmitter.emit(STOP_EVENT);
    expect(pause).toHaveBeenCalledTimes(1);

    finish({ processed: 1, wasCancelled: true });
    await expect(run).resolves.toBe('stopped');
    // the listener is removed afterwards
    DeviceEventEmitter.emit(STOP_EVENT);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  test('a failing sync is reported, not thrown', async () => {
    deep.mockRejectedValue(new Error('camera roll gone'));
    await expect(runBackgroundIndexing()).resolves.toBe('failed');
  });

  test('does nothing off Android', async () => {
    setPlatform('ios');
    await expect(runBackgroundIndexing()).resolves.toBe('not-android');
    expect(deep).not.toHaveBeenCalled();
  });
});

describe('scheduleBackgroundIndexing', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).IndexingScheduler;
  });

  test('asks the native scheduler on Android', async () => {
    const schedule = jest.fn().mockResolvedValue(true);
    (NativeModules as Record<string, unknown>).IndexingScheduler = { schedule };

    await expect(scheduleBackgroundIndexing()).resolves.toBe(true);
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  test('returns false when the native module is missing or fails', async () => {
    await expect(scheduleBackgroundIndexing()).resolves.toBe(false);
    (NativeModules as Record<string, unknown>).IndexingScheduler = {
      schedule: jest.fn().mockRejectedValue(new Error('no JobScheduler')),
    };
    await expect(scheduleBackgroundIndexing()).resolves.toBe(false);
  });
});
