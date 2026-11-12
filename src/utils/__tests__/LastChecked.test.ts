/**
 * LastChecked: when photos and papers were last checked, stamped by
 * IndexingService whoever started the check, and followed by the hooks.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLastChecked, markChecked, subscribeLastChecked } from '../LastChecked';
import { IndexingService } from '../../services/IndexingService';
import { performFullGallerySync, performQuickSync } from '../GallerySync';
import { performDocumentSync } from '../DocumentSync';
import { AppLogger } from '../AppLogger';

jest.mock('../GallerySync', () => ({
  backfillEmbeddings: jest.fn(async () => 0),
  performFullGallerySync: jest.fn(),
  performQuickSync: jest.fn(),
  performQuickSyncBackground: jest.fn(async () => 0),
}));
jest.mock('../DocumentSync', () => ({ performDocumentSync: jest.fn() }));
jest.mock('../MissingFiles', () => ({ pruneMissingFiles: jest.fn(async () => 0) }));
jest.mock('../AppLogger', () => ({
  AppLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const deep = performFullGallerySync as jest.Mock;
const quick = performQuickSync as jest.Mock;
const docs = performDocumentSync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  IndexingService.reset();
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
});

describe('LastChecked', () => {
  it('is null until something was checked', async () => {
    expect(await getLastChecked('photos')).toBeNull();
    expect(await getLastChecked('papers')).toBeNull();
  });

  it('keeps photos and papers apart, under the keys older versions used', async () => {
    await markChecked('photos', 1000);
    await markChecked('papers', 2000);
    expect(await getLastChecked('photos')).toBe(1000);
    expect(await getLastChecked('papers')).toBe(2000);
    expect(await AsyncStorage.getItem('gallery_last_sync_time')).toBe('1000');
    expect(await AsyncStorage.getItem('doc_last_sync_time')).toBe('2000');
  });

  it('tells listeners at once, and stops after unsubscribe', async () => {
    const heard = jest.fn();
    const stop = subscribeLastChecked(heard);
    await markChecked('photos', 5);
    expect(heard).toHaveBeenCalledWith('photos', 5);
    stop();
    await markChecked('photos', 6);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('a failing listener or a full disk never breaks the check', async () => {
    const stop = subscribeLastChecked(() => {
      throw new Error('listener broke');
    });
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await expect(markChecked('papers', 7)).resolves.toBeUndefined();
    expect(AppLogger.warn).toHaveBeenCalledTimes(2);
    stop();
  });

  it('reads junk as "never"', async () => {
    await AsyncStorage.setItem('gallery_last_sync_time', 'not a number');
    expect(await getLastChecked('photos')).toBeNull();
  });
});

describe('IndexingService stamps every finished check', () => {
  it('a full look through the photos, whoever asked for it', async () => {
    deep.mockResolvedValue({ processed: 2400, wasCancelled: false });
    await IndexingService.deepGallerySync();
    expect(await getLastChecked('photos')).toEqual(expect.any(Number));
  });

  it('a quick check of the newest photos', async () => {
    quick.mockResolvedValue({ processed: 50, wasCancelled: false });
    await IndexingService.quickGallerySync();
    expect(await getLastChecked('photos')).toEqual(expect.any(Number));
  });

  it('not a paused one: it did not finish', async () => {
    deep.mockResolvedValue({ processed: 10, wasCancelled: true });
    quick.mockResolvedValue({ processed: 3, wasCancelled: true });
    await IndexingService.deepGallerySync();
    await IndexingService.quickGallerySync();
    expect(await getLastChecked('photos')).toBeNull();
  });

  it('not a failed one', async () => {
    deep.mockRejectedValue(new Error('MediaStore busy'));
    await expect(IndexingService.deepGallerySync()).rejects.toThrow('MediaStore busy');
    expect(await getLastChecked('photos')).toBeNull();
  });

  it('papers, when PDFs were read through to the end', async () => {
    docs.mockResolvedValue({ status: 'done', processed: 3, total: 3, wasCancelled: false });
    await IndexingService.documentSync();
    expect(await getLastChecked('papers')).toEqual(expect.any(Number));
    expect(await getLastChecked('photos')).toBeNull();
  });

  it('not papers that could not be read, or a check that was stopped', async () => {
    docs.mockResolvedValueOnce({ status: 'blocked' });
    await IndexingService.documentSync();
    docs.mockResolvedValueOnce({ status: 'done', processed: 1, total: 9, wasCancelled: true });
    await IndexingService.documentSync();
    expect(await getLastChecked('papers')).toBeNull();
  });
});
