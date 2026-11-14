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
  indexPhoto,
  __resetEncoderProven,
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
  getFileState,
  markEmbedDone,
} from '../../database';
import { MAX_ATTEMPTS } from '../../database/fileState';
import { AppLogger } from '../AppLogger';
import { QUIET_AFTER_MS, __resetInteractionGate, noteInteraction } from '../../services/InteractionGate';

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
  __resetEncoderProven();
  __resetInteractionGate();
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

  test('continues past per-photo failures: failed photo left unindexed for retry, no transaction opened', async () => {
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
    // transaction discipline: the DB writes are wrapped only after analysis
    // succeeds, so the failed photo never opens a transaction
    expect(beginSpy).toHaveBeenCalledTimes(4);
    expect(commitSpy).toHaveBeenCalledTimes(4);
    expect(rollbackSpy).not.toHaveBeenCalled();
    // the failure is recorded so retries are capped
    expect(getFileState(uriFor(1))).toMatchObject({ ocr_status: 'failed', attempts: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      'GallerySync',
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
    expect(result).toEqual({ processed: 50, wasCancelled: false, nextCursor: 'cursor_50' });
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

describe('when each photo was taken', () => {
  test('stores the gallery\'s taken time (seconds) as ms, for date searches', async () => {
    getPhotosMock.mockResolvedValue({
      edges: [{ node: { image: { uri: uriFor(0) }, timestamp: 1699780000, modificationTimestamp: 1699790000 } }],
      page_info: { has_next_page: false, end_cursor: undefined },
    });
    const indexSpy = jest.spyOn(DatabaseDocuments, 'indexDocument');
    await performQuickSync(jest.fn(), undefined, { background: false });
    expect(indexSpy.mock.calls[0][5]).toBe(1699780000000);
  });
});

describe('stepping aside while the phone is in use', () => {
  test('the next photo waits while someone is scrolling, then indexing carries on', async () => {
    mockGallery(3);
    noteInteraction();
    const p = performQuickSync(jest.fn(), undefined, { background: false });

    await jest.advanceTimersByTimeAsync(QUIET_AFTER_MS / 2);
    expect(analyzeImageMock).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(QUIET_AFTER_MS);
    await expect(p).resolves.toMatchObject({ processed: 3, wasCancelled: false });
    expect(analyzeImageMock).toHaveBeenCalledTimes(3);
  });

  test('pausing while it waits stops deep sync and keeps the cursor', async () => {
    mockGallery(25);
    const cancel = { current: false };
    noteInteraction();
    const p = performFullGallerySync(jest.fn(), cancel);
    p.catch(() => {});
    await jest.advanceTimersByTimeAsync(100);
    cancel.current = true;
    await jest.advanceTimersByTimeAsync(1000);

    await expect(p).resolves.toEqual({ processed: 0, wasCancelled: true });
    expect(analyzeImageMock).not.toHaveBeenCalled();
  });
});

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

  test('recovers from per-photo errors: failed photo recorded and left for retry', async () => {
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
    expect(rollbackSpy).not.toHaveBeenCalled();
    expect(commitSpy).toHaveBeenCalledTimes(9);
    expect(getFileState(uriFor(3))).toMatchObject({ ocr_status: 'failed', attempts: 1 });
    expect(warnSpy).toHaveBeenCalledWith(
      'GallerySync',
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

    expect(indexSpy).toHaveBeenCalledWith(null, 'image', uriFor(0), 'IMAGE', 'OBJECT', null);
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

  test('a vector that fails to save is recorded as failed, not done', async () => {
    analyzeImageMock.mockResolvedValue(visionResult(uriFor(0), { embedding: new Float32Array(512) }));
    jest.spyOn(DatabaseVectors, 'indexEmbedding').mockReturnValue(false);
    mockGallery(1);

    await runFullSync(jest.fn());

    expect(isFileIndexed(uriFor(0))).toBe(true);
    expect(getFileState(uriFor(0))).toMatchObject({ ocr_status: 'done', embed_status: 'failed' });
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
  test('getGallerySyncLimit returns -1 (unlimited)', async () => {
    await expect(getGallerySyncLimit()).resolves.toBe(-1);
  });

  test('getGalleryTotalCount adds up the photo albums', async () => {
    (CameraRoll.getAlbums as jest.Mock).mockResolvedValueOnce([
      { id: '1', title: 'Camera', count: 2100, type: 'Album' },
      { id: '2', title: 'WhatsApp Images', count: 300, type: 'Album' },
    ]);
    await expect(getGalleryTotalCount()).resolves.toBe(2400);
    expect(CameraRoll.getAlbums).toHaveBeenCalledWith({ assetType: 'Photos' });
  });

  test('getGalleryTotalCount is 0 with no albums and skips bad counts', async () => {
    (CameraRoll.getAlbums as jest.Mock).mockResolvedValueOnce([]);
    await expect(getGalleryTotalCount()).resolves.toBe(0);
    (CameraRoll.getAlbums as jest.Mock).mockResolvedValueOnce([
      { id: '1', title: 'Camera', count: 5, type: 'Album' },
      { id: '2', title: 'Broken', count: Number.NaN, type: 'Album' },
    ]);
    await expect(getGalleryTotalCount()).resolves.toBe(5);
  });

  test('getGalleryTotalCount is -1 when the gallery cannot be read', async () => {
    (CameraRoll.getAlbums as jest.Mock).mockRejectedValueOnce(new Error('no permission'));
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

// ─── per-file state (files table) ───────────────────────────────────────────

describe('indexPhoto — per-file, per-stage state', () => {
  const vec = () => new Float32Array(512).fill(0.02);

  test('a new photo gets OCR, a text row and its vector, all recorded', async () => {
    analyzeImageMock.mockResolvedValue(visionResult(uriFor(0), { embedding: vec() }));

    expect(await indexPhoto(uriFor(0), 1000)).toBe('indexed');

    expect(isFileIndexed(uriFor(0))).toBe(true);
    expect(getEmbeddingCount()).toBe(1);
    expect(getFileState(uriFor(0))).toMatchObject({
      mtime: 1000, ocr_status: 'done', embed_status: 'done', attempts: 0,
    });
  });

  test('a finished photo is skipped without any ML work', async () => {
    analyzeImageMock.mockResolvedValue(visionResult(uriFor(0), { embedding: vec() }));
    await indexPhoto(uriFor(0), 1000);
    analyzeImageMock.mockClear();

    expect(await indexPhoto(uriFor(0), 1000)).toBe('skipped');
    expect(analyzeImageMock).not.toHaveBeenCalled();
    expect(encodeImageMock).not.toHaveBeenCalled();
  });

  test('a photo with text but no vector gets only the embedding, not OCR again', async () => {
    await indexPhoto(uriFor(0)); // encoder returned nothing: vector pending
    analyzeImageMock.mockClear();
    encodeImageMock.mockResolvedValue(vec());

    expect(await indexPhoto(uriFor(0))).toBe('embedded');

    expect(analyzeImageMock).not.toHaveBeenCalled();
    expect(encodeImageMock).toHaveBeenCalledWith(uriFor(0));
    expect(getEmbeddingCount()).toBe(1);
    expect(getFileState(uriFor(0))?.embed_status).toBe('done');
  });

  test('missing vectors before the encoder has ever worked do not use up retries', async () => {
    encodeImageMock.mockResolvedValue(null); // e.g. CLIP models not installed
    await indexPhoto(uriFor(0));
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) await indexPhoto(uriFor(0));

    expect(getFileState(uriFor(0))).toMatchObject({ embed_status: 'pending', attempts: 0 });
  });

  test('once the encoder has worked, a photo that keeps failing to encode is capped', async () => {
    analyzeImageMock.mockResolvedValueOnce(visionResult(uriFor(9), { embedding: vec() }));
    await indexPhoto(uriFor(9)); // proves the encoder works
    encodeImageMock.mockResolvedValue(null);
    await indexPhoto(uriFor(0)); // OCR ok, vector missing → attempt 1

    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await indexPhoto(uriFor(0));

    expect(getFileState(uriFor(0))).toMatchObject({ embed_status: 'failed', attempts: MAX_ATTEMPTS });
    expect(encodeImageMock).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
  });

  test(`a photo whose OCR keeps failing is retried ${MAX_ATTEMPTS} times, then left alone until edited`, async () => {
    analyzeImageMock.mockRejectedValue(new Error('corrupt image'));

    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await indexPhoto(uriFor(0), 1000);

    expect(analyzeImageMock).toHaveBeenCalledTimes(MAX_ATTEMPTS);
    expect(getFileState(uriFor(0))).toMatchObject({ ocr_status: 'failed', attempts: MAX_ATTEMPTS, last_error: 'corrupt image' });

    analyzeImageMock.mockResolvedValue(visionResult(uriFor(0)));
    expect(await indexPhoto(uriFor(0), 2000)).toBe('indexed');
  });

  test('an edited photo is OCRed again', async () => {
    await indexPhoto(uriFor(0), 1000);
    analyzeImageMock.mockResolvedValue(visionResult(uriFor(0), { content: 'new text' }));

    expect(await indexPhoto(uriFor(0), 2000)).toBe('indexed');
    expect(analyzeImageMock).toHaveBeenCalledTimes(2);
  });

  test('a failed save is rolled back and recorded', async () => {
    jest.spyOn(DatabaseDocuments, 'indexDocument').mockReturnValue(null);
    const rollbackSpy = jest.spyOn(DatabaseTransactions, 'rollbackTransaction');

    expect(await indexPhoto(uriFor(0))).toBe('failed');

    expect(rollbackSpy).toHaveBeenCalledTimes(1);
    expect(getFileState(uriFor(0))).toMatchObject({ ocr_status: 'failed', attempts: 1 });
  });

  test('sync passes each photo\'s modification time through', async () => {
    getPhotosMock.mockResolvedValue({
      edges: [{ node: { image: { uri: uriFor(0) }, modificationTimestamp: 1234, timestamp: 1000 } }],
      page_info: { has_next_page: false, end_cursor: undefined },
    });

    await performQuickSync(jest.fn());

    expect(getFileState(uriFor(0))?.mtime).toBe(1234);
  });

  test('backfill records the vector in file state', async () => {
    await indexPhoto(uriFor(0));
    encodeImageMock.mockResolvedValue(vec());
    const p = backfillEmbeddings();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(await p).toBe(1);
    expect(getFileState(uriFor(0))?.embed_status).toBe('done');
  });

  test('backfill re-encodes vectors from an older model', async () => {
    analyzeImageMock.mockResolvedValue(visionResult(uriFor(0), { embedding: vec() }));
    await indexPhoto(uriFor(0));
    markEmbedDone(uriFor(0), 'old-model');
    encodeImageMock.mockResolvedValue(vec());
    const p = backfillEmbeddings();
    await jest.advanceTimersByTimeAsync(60_000);

    expect(await p).toBe(1);
    expect(getEmbeddingCount()).toBe(1);
    expect(getFileState(uriFor(0))?.embed_model).not.toBe('old-model');
  });
});
