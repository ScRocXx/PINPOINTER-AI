/**
 * GallerySync.test.ts — unit tests for the gallery sync engine.
 *
 * Covers performQuickSync (foreground + fire-and-forget background phase),
 * performFullGallerySync (batched deep sync with cursor resume), and the
 * cursor / limit helpers.
 *
 * Fakes: timers (the engine sleeps 200–500ms between batches), CameraRoll,
 * AsyncStorage, VisionPipeline.analyzeImage, and the real in-memory
 * op-sqlite mock behind src/database/*.
 */
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  performQuickSync,
  performFullGallerySync,
  loadSavedCursor,
  clearSyncCursor,
  getGallerySyncLimit,
  getGalleryTotalCount,
  backfillEmbeddings,
  QUICK_SYNC_LIMIT,
} from '../GallerySync';
import { analyzeImage } from '../VisionPipeline';
import { encodeImage } from '../../services/EmbeddingService';
import * as DatabaseDocuments from '../../database/documents';
import * as DatabaseTransactions from '../../database/transactions';
import * as DatabaseVectors from '../../database/vectors';
import {
  setupDatabase,
  clearIndex,
  getIndexedCount,
  isFileIndexed,
  getEmbeddingCount,
  indexDocument,
} from '../../database';
import { AppLogger } from '../AppLogger';

jest.mock('../VisionPipeline', () => ({
  analyzeImage: jest.fn(),
}));

jest.mock('../../services/EmbeddingService', () => ({
  encodeImage: jest.fn(),
}));

const encodeImageMock = encodeImage as jest.Mock;

const getPhotosMock = CameraRoll.getPhotos as jest.Mock;
const analyzeImageMock = analyzeImage as jest.Mock;
const asyncStoreReset = AsyncStorage as unknown as { __reset: () => void };

// ─── test helpers ───────────────────────────────────────────────────────────

const uriFor = (i: number): string => `file:///gallery/photo_${i}.jpg`;

/**
 * Serve `total` photos through CameraRoll.getPhotos, paginated according to
 * the requested `first` / `after` cursor (cursor_N == photo index N).
 */
const mockGallery = (total: number): void => {
  getPhotosMock.mockImplementation(
    async (params: { first: number; after?: string; assetType?: string }) => {
      const start = params.after ? parseInt(params.after.replace('cursor_', ''), 10) : 0;
      const end = Math.min(start + params.first, total);
      const edges = [];
      for (let i = start; i < end; i++) {
        edges.push({ node: { image: { uri: uriFor(i) } } });
      }
      const has_next_page = end < total;
      return {
        edges,
        page_info: {
          has_next_page,
          end_cursor: has_next_page ? `cursor_${end}` : undefined,
        },
      };
    },
  );
};

const visionResult = (uri: string, overrides = {}) => ({
  detection_type: 'TEXT' as const,
  raw_text: `ocr text for ${uri}`,
  content: `ocr text for ${uri}`,
  search_index: ['ocr'],
  optimized_status: 'ok',
  embedding: null,
  ...overrides,
});

/** Run a full deep sync to completion under fake timers. */
const runFullSync = async (
  onProgress: (count: number, uri?: string) => void,
  cancelRef?: { current: boolean },
  resumeFrom?: string,
) => {
  const p = performFullGallerySync(onProgress, cancelRef, resumeFrom);
  // Attach a handler immediately so a mid-run rejection is never "unhandled"
  // while we advance timers; callers still observe it via `return p`.
  p.catch(() => {});
  await jest.advanceTimersByTimeAsync(60_000);
  return p;
};

// ─── setup ──────────────────────────────────────────────────────────────────

beforeAll(() => {
  setupDatabase();
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  asyncStoreReset.__reset();
  clearIndex();
  analyzeImageMock.mockImplementation(async (uri: string) => visionResult(uri));
  // default: empty gallery
  getPhotosMock.mockResolvedValue({
    edges: [],
    page_info: { has_next_page: false, end_cursor: undefined },
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// ─── performQuickSync ───────────────────────────────────────────────────────

describe('performQuickSync', () => {
  test('indexes every photo in a small gallery and reports the processed count', async () => {
    mockGallery(5);
    const onProgress = jest.fn();
    const indexSpy = jest.spyOn(DatabaseDocuments, 'indexDocument');

    const result = await performQuickSync(onProgress);

    expect(result).toEqual({ processed: 5, wasCancelled: false });
    expect(getIndexedCount()).toBe(5);
    expect(analyzeImageMock).toHaveBeenCalledTimes(5);
    // every photo was passed to indexDocument with its own uri, as an IMAGE
    expect(indexSpy.mock.calls.map((c) => c[2]).sort()).toEqual(
      [0, 1, 2, 3, 4].map((i) => uriFor(i)).sort(),
    );
    expect(indexSpy.mock.calls.every((c) => c[3] === 'IMAGE')).toBe(true);
    expect([0, 1, 2, 3, 4].every((i) => isFileIndexed(uriFor(i)))).toBe(true);
  });

  test('calls onProgress with strictly increasing counts', async () => {
    mockGallery(5);
    const onProgress = jest.fn();

    await performQuickSync(onProgress);

    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([1, 2, 3, 4, 5]);
  });

  test('requests photos in QUICK_BATCH_SIZE pages of 50', async () => {
    mockGallery(3);

    await performQuickSync(jest.fn());

    expect(getPhotosMock).toHaveBeenCalledWith({
      first: 50,
      after: undefined,
      assetType: 'Photos',
    });
  });

  test('skips already-indexed photos without re-analyzing them', async () => {
    const indexSpy = jest.spyOn(DatabaseDocuments, 'indexDocument');
    indexDocument(null, 'old content', uriFor(2), 'IMAGE', 'TEXT');
    indexSpy.mockClear(); // ignore the pre-index call above
    mockGallery(5);
    const onProgress = jest.fn();

    const result = await performQuickSync(onProgress);

    // skipped photos still count as processed (source increments regardless)
    expect(result.processed).toBe(5);
    const analyzedUris = analyzeImageMock.mock.calls.map((c) => c[0] as string);
    expect(analyzedUris).not.toContain(uriFor(2));
    expect(analyzedUris).toHaveLength(4);
    expect(getIndexedCount()).toBe(5);
    // the pre-existing row was never re-indexed, so its content is untouched
    expect(indexSpy.mock.calls.some((c) => c[2] === uriFor(2))).toBe(false);
    expect(isFileIndexed(uriFor(2))).toBe(true);
  });

  test('continues past per-photo failures: failed photo left unindexed for retry, transaction rolled back', async () => {
    analyzeImageMock.mockImplementation(async (uri: string) => {
      if (uri === uriFor(1)) throw new Error('OCR exploded');
      return visionResult(uri);
    });
    const warnSpy = jest.spyOn(AppLogger, 'warn');
    const beginSpy = jest.spyOn(DatabaseTransactions, 'beginTransaction');
    const commitSpy = jest.spyOn(DatabaseTransactions, 'commitTransaction');
    const rollbackSpy = jest.spyOn(DatabaseTransactions, 'rollbackTransaction');
    const indexSpy = jest.spyOn(DatabaseDocuments, 'indexDocument');
    mockGallery(5);

    const result = await performQuickSync(jest.fn());

    expect(result).toEqual({ processed: 5, wasCancelled: false });
    // the failed photo gets no placeholder row, so the next sync retries it
    expect(getIndexedCount()).toBe(4);
    expect(isFileIndexed(uriFor(1))).toBe(false);
    expect(indexSpy.mock.calls.some((c) => c[2] === uriFor(1))).toBe(false);
    expect(
      indexSpy.mock.calls.find((c) => c[2] === uriFor(0))?.[1],
    ).toContain('ocr text');
    // transaction discipline: 5 begins, 4 commits, 1 rollback
    expect(beginSpy).toHaveBeenCalledTimes(5);
    expect(commitSpy).toHaveBeenCalledTimes(4);
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      'QuickSync',
      expect.stringContaining(uriFor(1)),
      expect.any(Error),
    );
  });

  test('wraps each photo in a begin/commit transaction on the happy path', async () => {
    const beginSpy = jest.spyOn(DatabaseTransactions, 'beginTransaction');
    const commitSpy = jest.spyOn(DatabaseTransactions, 'commitTransaction');
    const rollbackSpy = jest.spyOn(DatabaseTransactions, 'rollbackTransaction');
    mockGallery(3);

    await performQuickSync(jest.fn());

    expect(beginSpy).toHaveBeenCalledTimes(3);
    expect(commitSpy).toHaveBeenCalledTimes(3);
    expect(rollbackSpy).not.toHaveBeenCalled();
  });

  test('caps the foreground phase at QUICK_SYNC_LIMIT and finishes the rest in the background', async () => {
    mockGallery(70);
    const onProgress = jest.fn();

    const result = await performQuickSync(onProgress);

    expect(QUICK_SYNC_LIMIT).toBe(50);
    expect(result).toEqual({ processed: 50, wasCancelled: false });
    expect(onProgress).toHaveBeenCalledTimes(50);
    expect(onProgress).toHaveBeenLastCalledWith(50);

    // background phase drains the remaining 20 once its sleeps elapse
    await jest.advanceTimersByTimeAsync(10_000);
    expect(getIndexedCount()).toBe(70);
  });

  test('returns immediately while the background phase is still running (fire-and-forget)', async () => {
    mockGallery(120);
    const onProgress = jest.fn();

    const result = await performQuickSync(onProgress);
    expect(result.processed).toBe(50);

    // flush queued microtasks but do NOT elapse any timers
    await jest.advanceTimersByTimeAsync(0);
    const countAfterForeground = getIndexedCount();
    expect(countAfterForeground).toBeGreaterThanOrEqual(50);
    expect(countAfterForeground).toBeLessThan(120); // background not finished yet

    await jest.advanceTimersByTimeAsync(60_000);
    expect(getIndexedCount()).toBe(120);
  });

  test('handles an empty gallery cleanly', async () => {
    const onProgress = jest.fn();

    const result = await performQuickSync(onProgress);

    expect(result).toEqual({ processed: 0, wasCancelled: false });
    expect(onProgress).not.toHaveBeenCalled();
    expect(getIndexedCount()).toBe(0);
  });

  test('honours a cancel request mid-run and never starts the background phase', async () => {
    // 60 photos => has_next_page stays true, so the cancel is observed at the
    // top of the page loop and reported as wasCancelled: true
    mockGallery(60);
    const cancelRef = { current: false };
    const onProgress = jest.fn((count: number) => {
      if (count >= 3) cancelRef.current = true;
    });

    const result = await performQuickSync(onProgress, cancelRef);

    expect(result).toEqual({ processed: 3, wasCancelled: true });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(getIndexedCount()).toBe(3); // no background work ran
  });

  test('cancel on the final gallery page exits the loop without the cancelled flag', async () => {
    // single page (has_next_page === false): the `break` leaves the page loop
    // and the while condition is already false, so the top-of-loop cancel
    // check never runs — processed count is still honoured
    mockGallery(20);
    const cancelRef = { current: false };
    const onProgress = jest.fn((count: number) => {
      if (count >= 3) cancelRef.current = true;
    });

    const result = await performQuickSync(onProgress, cancelRef);

    expect(result).toEqual({ processed: 3, wasCancelled: false });
    expect(getIndexedCount()).toBe(3);
  });

  test('returns immediately when already cancelled before starting', async () => {
    const result = await performQuickSync(jest.fn(), { current: true });

    expect(result).toEqual({ processed: 0, wasCancelled: true });
    expect(getPhotosMock).not.toHaveBeenCalled();
    expect(getIndexedCount()).toBe(0);
  });
});

// ─── performFullGallerySync ─────────────────────────────────────────────────

describe('performFullGallerySync', () => {
  test('indexes all photos across multiple 10-photo batches', async () => {
    mockGallery(25);
    const onProgress = jest.fn();

    const result = await runFullSync(onProgress);

    expect(result).toEqual({ processed: 25, wasCancelled: false });
    expect(getIndexedCount()).toBe(25);
    expect(analyzeImageMock).toHaveBeenCalledTimes(25);
  });

  test('reports (count, uri) progress for every photo', async () => {
    mockGallery(5);
    const onProgress = jest.fn();

    await runFullSync(onProgress);

    expect(onProgress).toHaveBeenCalledTimes(5);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, uriFor(0));
    expect(onProgress).toHaveBeenNthCalledWith(5, 5, uriFor(4));
  });

  test('paces itself: parks at the inter-batch sleep instead of rushing through', async () => {
    mockGallery(25);
    const onProgress = jest.fn();
    let settled = false;
    const p = performFullGallerySync(onProgress).then((r) => {
      settled = true;
      return r;
    });

    // advance less than DEEP_SLEEP_MS (200ms): first batch done, sync not finished
    await jest.advanceTimersByTimeAsync(50);
    expect(settled).toBe(false);
    expect(onProgress).toHaveBeenCalledTimes(10);

    await jest.advanceTimersByTimeAsync(60_000);
    const result = await p;
    expect(settled).toBe(true);
    expect(result.processed).toBe(25);
  });

  test('requests photos in DEEP_BATCH_SIZE pages of 10', async () => {
    mockGallery(3);

    await runFullSync(jest.fn());

    expect(getPhotosMock).toHaveBeenCalledWith({
      first: 10,
      after: undefined,
      assetType: 'Photos',
    });
  });

  test('skips already-indexed photos without re-analyzing them', async () => {
    indexDocument(null, 'old content', uriFor(0), 'IMAGE', 'TEXT');
    indexDocument(null, 'old content', uriFor(5), 'IMAGE', 'TEXT');
    mockGallery(10);

    const result = await runFullSync(jest.fn());

    expect(result.processed).toBe(10);
    const analyzedUris = analyzeImageMock.mock.calls.map((c) => c[0] as string);
    expect(analyzedUris).not.toContain(uriFor(0));
    expect(analyzedUris).not.toContain(uriFor(5));
    expect(analyzedUris).toHaveLength(8);
    expect(getIndexedCount()).toBe(10);
  });

  test('recovers from per-photo errors: rolled-back transaction, failed photo left for retry', async () => {
    analyzeImageMock.mockImplementation(async (uri: string) => {
      if (uri === uriFor(3)) throw new Error('OCR exploded');
      return visionResult(uri);
    });
    const warnSpy = jest.spyOn(AppLogger, 'warn');
    const rollbackSpy = jest.spyOn(DatabaseTransactions, 'rollbackTransaction');
    const commitSpy = jest.spyOn(DatabaseTransactions, 'commitTransaction');
    const indexSpy = jest.spyOn(DatabaseDocuments, 'indexDocument');
    mockGallery(10);

    const result = await runFullSync(jest.fn());

    expect(result).toEqual({ processed: 10, wasCancelled: false });
    expect(getIndexedCount()).toBe(9);
    expect(isFileIndexed(uriFor(3))).toBe(false);
    expect(indexSpy.mock.calls.some((c) => c[2] === uriFor(3))).toBe(false);
    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(commitSpy).toHaveBeenCalledTimes(9);
    expect(warnSpy).toHaveBeenCalledWith(
      'DeepSync',
      expect.stringContaining(uriFor(3)),
      expect.any(Error),
    );
  });

  test("indexes empty OCR output as the 'image' placeholder", async () => {
    analyzeImageMock.mockResolvedValue(
      visionResult(uriFor(0), { detection_type: 'OBJECT', raw_text: '   ', content: '   ' }),
    );
    const indexSpy = jest.spyOn(DatabaseDocuments, 'indexDocument');
    mockGallery(1);

    await runFullSync(jest.fn());

    expect(indexSpy).toHaveBeenCalledWith(null, 'image', uriFor(0), 'IMAGE', 'OBJECT');
    expect(isFileIndexed(uriFor(0))).toBe(true);
  });

  test('wraps each photo in a begin/commit transaction on the happy path', async () => {
    const beginSpy = jest.spyOn(DatabaseTransactions, 'beginTransaction');
    const commitSpy = jest.spyOn(DatabaseTransactions, 'commitTransaction');
    const rollbackSpy = jest.spyOn(DatabaseTransactions, 'rollbackTransaction');
    mockGallery(4);

    await runFullSync(jest.fn());

    expect(beginSpy).toHaveBeenCalledTimes(4);
    expect(commitSpy).toHaveBeenCalledTimes(4);
    expect(rollbackSpy).not.toHaveBeenCalled();
  });

  test('saves the cursor on cancel and resumes from it on the next run', async () => {
    mockGallery(20);
    const cancelRef = { current: false };
    const onProgress = jest.fn((count: number) => {
      if (count >= 15) cancelRef.current = true;
    });

    const cancelled = await runFullSync(onProgress, cancelRef);

    expect(cancelled).toEqual({ processed: 15, wasCancelled: true });
    expect(await loadSavedCursor()).toBe('cursor_10');

    // resume: picks up the saved cursor automatically, skips already-indexed
    const resumed = await runFullSync(jest.fn());
    expect(resumed).toEqual({ processed: 10, wasCancelled: false });
    expect(getIndexedCount()).toBe(20);
    // successful completion clears the cursor
    expect(await loadSavedCursor()).toBeUndefined();
  });

  test('accepts an explicit resumeFrom cursor', async () => {
    mockGallery(20);

    const result = await runFullSync(jest.fn(), undefined, 'cursor_10');

    expect(result).toEqual({ processed: 10, wasCancelled: false });
    expect(getIndexedCount()).toBe(10);
    const analyzedUris = analyzeImageMock.mock.calls.map((c) => c[0] as string);
    expect(analyzedUris[0]).toBe(uriFor(10));
  });

  test('saves the cursor and rethrows when getPhotos itself fails', async () => {
    getPhotosMock.mockRejectedValueOnce(new Error('camera roll exploded'));

    await expect(runFullSync(jest.fn())).rejects.toThrow('camera roll exploded');
    expect(getIndexedCount()).toBe(0);
  });

  test('clears any stale cursor after a successful run', async () => {
    await AsyncStorage.setItem('gallery_sync_cursor', 'cursor_stale');
    mockGallery(3);

    await runFullSync(jest.fn());

    expect(await loadSavedCursor()).toBeUndefined();
  });

  test('indexes the embedding when analyzeImage returns one', async () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3]);
    analyzeImageMock.mockResolvedValue(visionResult(uriFor(0), { embedding }));
    const embeddingSpy = jest.spyOn(DatabaseVectors, 'indexEmbedding');
    mockGallery(1);

    await runFullSync(jest.fn());

    expect(embeddingSpy).toHaveBeenCalledTimes(1);
    expect(embeddingSpy).toHaveBeenCalledWith(expect.any(Number), embedding);
    expect(getEmbeddingCount()).toBe(1);
  });

  test('returns immediately when already cancelled before starting', async () => {
    const result = await runFullSync(jest.fn(), { current: true });

    expect(result).toEqual({ processed: 0, wasCancelled: true });
    expect(getPhotosMock).not.toHaveBeenCalled();
  });
});

// ─── cursor helpers & misc ──────────────────────────────────────────────────

describe('cursor helpers', () => {
  test('loadSavedCursor returns undefined when nothing was saved', async () => {
    await expect(loadSavedCursor()).resolves.toBeUndefined();
  });

  test('clearSyncCursor removes a saved cursor', async () => {
    await AsyncStorage.setItem('gallery_sync_cursor', 'cursor_42');
    await expect(loadSavedCursor()).resolves.toBe('cursor_42');

    await clearSyncCursor();

    await expect(loadSavedCursor()).resolves.toBeUndefined();
  });
});

describe('sync limits', () => {
  test('getGallerySyncLimit and getGalleryTotalCount return -1 (unlimited)', async () => {
    await expect(getGallerySyncLimit()).resolves.toBe(-1);
    await expect(getGalleryTotalCount()).resolves.toBe(-1);
  });

  test('QUICK_SYNC_LIMIT is 50', () => {
    expect(QUICK_SYNC_LIMIT).toBe(50);
  });
});

describe('backfillEmbeddings', () => {
  const vec = () => new Float32Array(512).fill(0.01);

  const runBackfill = async (cancelRef?: { current: boolean }) => {
    const p = backfillEmbeddings(cancelRef);
    await jest.advanceTimersByTimeAsync(60_000);
    return p;
  };

  test('adds embeddings to indexed photos that have none', async () => {
    for (let i = 0; i < 3; i++) indexDocument(null, `photo ${i}`, uriFor(i), 'IMAGE', 'TEXT');
    encodeImageMock.mockResolvedValue(vec());

    const added = await runBackfill();

    expect(added).toBe(3);
    expect(getEmbeddingCount()).toBe(3);
    expect(encodeImageMock).toHaveBeenCalledWith(uriFor(0));
  });

  test('skips documents (PDFs) and photos that already have a vector', async () => {
    const withVec = indexDocument(null, 'has vector', uriFor(0), 'IMAGE', 'TEXT')!;
    DatabaseVectors.indexEmbedding(withVec, vec());
    indexDocument('Doc', 'pdf text', '/docs/a.pdf', 'DOCUMENT', 'TEXT');
    indexDocument(null, 'needs vector', uriFor(1), 'IMAGE', 'TEXT');
    encodeImageMock.mockResolvedValue(vec());

    const added = await runBackfill();

    expect(added).toBe(1);
    expect(encodeImageMock).toHaveBeenCalledTimes(1);
    expect(encodeImageMock).toHaveBeenCalledWith(uriFor(1));
  });

  test('does not loop on photos that fail to encode', async () => {
    for (let i = 0; i < 4; i++) indexDocument(null, `photo ${i}`, uriFor(i), 'IMAGE', 'TEXT');
    encodeImageMock.mockImplementation(async (uri: string) => (uri === uriFor(2) ? null : vec()));

    const added = await runBackfill();

    expect(added).toBe(3);
    expect(encodeImageMock).toHaveBeenCalledTimes(4);
  });

  test('gives up quickly when the encoder is unavailable', async () => {
    for (let i = 0; i < 30; i++) indexDocument(null, `photo ${i}`, uriFor(i), 'IMAGE', 'TEXT');
    encodeImageMock.mockResolvedValue(null);

    const added = await runBackfill();

    expect(added).toBe(0);
    expect(encodeImageMock).toHaveBeenCalledTimes(5);
  });

  test('stops when cancelled', async () => {
    for (let i = 0; i < 3; i++) indexDocument(null, `photo ${i}`, uriFor(i), 'IMAGE', 'TEXT');
    encodeImageMock.mockResolvedValue(vec());

    const added = await runBackfill({ current: true });

    expect(added).toBe(0);
    expect(encodeImageMock).not.toHaveBeenCalled();
  });

  test('only one backfill runs at a time', async () => {
    indexDocument(null, 'photo', uriFor(0), 'IMAGE', 'TEXT');
    encodeImageMock.mockResolvedValue(vec());

    const first = backfillEmbeddings();
    const second = await backfillEmbeddings();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(second).toBe(0);
    expect(await first).toBe(1);
  });
});
