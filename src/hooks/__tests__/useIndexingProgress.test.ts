import { act, renderHook } from '@testing-library/react-native';
import { PROGRESS_REFRESH_MS, toIndexingProgress, useIndexingProgress } from '../useIndexingProgress';
import { IndexingSnapshot } from '../../services/IndexingService';
import { getReadyCounts } from '../../database';
import { getGalleryTotalCount } from '../../utils/GallerySync';

let mockListener: ((s: IndexingSnapshot) => void) | null = null;
const mockUnsubscribe = jest.fn();
const idle: IndexingSnapshot = { running: null, queued: [], galleryProcessed: 0, docsProcessed: 0, docsTotal: 0 };
let mockSnapshot: IndexingSnapshot = idle;

jest.mock('../../services/IndexingService', () => ({
  IndexingService: {
    getSnapshot: () => mockSnapshot,
    subscribe: (fn: (s: IndexingSnapshot) => void) => {
      mockListener = fn;
      return mockUnsubscribe;
    },
  },
}));
jest.mock('../../database', () => ({ getReadyCounts: jest.fn(() => ({ photos: 0, papers: 0 })) }));
jest.mock('../../utils/GallerySync', () => ({ getGalleryTotalCount: jest.fn(async () => 2400) }));

const counts = getReadyCounts as jest.Mock;
const photoTotal = getGalleryTotalCount as jest.Mock;
const snap = (over: Partial<IndexingSnapshot>): IndexingSnapshot => ({ ...idle, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  mockListener = null;
  mockSnapshot = idle;
  counts.mockReturnValue({ photos: 0, papers: 0 });
  photoTotal.mockResolvedValue(2400);
});

describe('toIndexingProgress', () => {
  it('counts photos ready out of every photo', () => {
    const p = toIndexingProgress(snap({ running: 'gallery-deep', queued: ['documents'] }), { photos: 120, papers: 3 }, 2400);
    expect(p.photos).toEqual({ done: 120, total: 2400, running: true, queued: false });
    expect(p.papers).toEqual({ done: 3, total: null, running: false, queued: true });
  });

  it('never shows more ready than there are photos', () => {
    expect(toIndexingProgress(idle, { photos: 50, papers: 0 }, 40).photos.total).toBe(50);
  });

  it('leaves the total unknown when it could not be counted', () => {
    expect(toIndexingProgress(idle, { photos: 5, papers: 0 }, -1).photos.total).toBeNull();
    expect(toIndexingProgress(idle, { photos: 5, papers: 0 }, null).photos.total).toBeNull();
  });

  it('shows this pass of PDFs while they are being read', () => {
    const p = toIndexingProgress(snap({ running: 'documents', docsProcessed: 4, docsTotal: 9 }), { photos: 0, papers: 30 }, 0);
    expect(p.papers).toEqual({ done: 4, total: 9, running: true, queued: false });
  });

  it('counts quick and background gallery jobs as photo work', () => {
    expect(toIndexingProgress(snap({ queued: ['gallery-quick-background'] }), { photos: 0, papers: 0 }, 1).photos.queued).toBe(true);
    expect(toIndexingProgress(snap({ running: 'backfill' }), { photos: 0, papers: 0 }, 1).photos.running).toBe(false);
  });
});

describe('useIndexingProgress', () => {
  afterEach(() => jest.useRealTimers());

  it('reads the counts and the photo total on mount', async () => {
    counts.mockReturnValue({ photos: 120, papers: 2 });
    const { result } = await renderHook(() => useIndexingProgress());
    await act(async () => {});
    expect(result.current.photos).toMatchObject({ done: 120, total: 2400 });
    expect(result.current.papers.done).toBe(2);
  });

  it('re-reads the counts at most every half second while work runs', async () => {
    jest.useFakeTimers();
    const { result } = await renderHook(() => useIndexingProgress());
    await act(async () => {});
    const readsAfterMount = counts.mock.calls.length;

    counts.mockReturnValue({ photos: 10, papers: 0 });
    await act(async () => {
      for (let i = 0; i < 20; i++) mockListener?.(snap({ running: 'gallery-deep', galleryProcessed: i }));
    });
    expect(result.current.photos.running).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(PROGRESS_REFRESH_MS);
    });
    expect(counts.mock.calls.length - readsAfterMount).toBe(1);
    expect(result.current.photos.done).toBe(10);
  });

  it('counts the photos again when gallery work ends or access changes', async () => {
    const { rerender } = await renderHook(({ key }: { key: string }) => useIndexingProgress(key), {
      initialProps: { key: 'limited' },
    });
    await act(async () => {});
    expect(photoTotal).toHaveBeenCalledTimes(1);

    await act(async () => mockListener?.(snap({ running: 'gallery-deep' })));
    await act(async () => mockListener?.(idle));
    expect(photoTotal).toHaveBeenCalledTimes(2);

    await rerender({ key: 'full' });
    await act(async () => {});
    expect(photoTotal).toHaveBeenCalledTimes(3);
  });

  it('counts once at the start when photos are already being read', async () => {
    mockSnapshot = snap({ running: 'gallery-deep' });
    const { result } = await renderHook(() => useIndexingProgress());
    await act(async () => {});
    expect(photoTotal).toHaveBeenCalledTimes(1);
    expect(result.current.photos.total).toBe(2400);
  });

  it('stops listening when it goes', async () => {
    const { unmount } = await renderHook(() => useIndexingProgress());
    await unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
