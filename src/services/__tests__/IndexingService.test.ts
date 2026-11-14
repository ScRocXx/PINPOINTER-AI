/**
 * Tests for IndexingService — the single indexing queue.
 *
 * The sync engines (GallerySync, DocumentSync) are mocked with controllable
 * promises, so each test decides when a job finishes and can check that no
 * two jobs ever run at the same time.
 */
import { IndexingService, type IndexingSnapshot } from '../IndexingService';
import {
  backfillEmbeddings,
  performFullGallerySync,
  performQuickSync,
  performQuickSyncBackground,
} from '../../utils/GallerySync';
import { performDocumentSync } from '../../utils/DocumentSync';

jest.mock('../../utils/GallerySync', () => ({
  backfillEmbeddings: jest.fn(),
  performFullGallerySync: jest.fn(),
  performQuickSync: jest.fn(),
  performQuickSyncBackground: jest.fn(),
}));
jest.mock('../../utils/DocumentSync', () => ({
  performDocumentSync: jest.fn(),
}));
jest.mock('../../utils/AppLogger', () => ({
  AppLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

type CancelRef = { current: boolean };

const quick = performQuickSync as jest.Mock;
const quickBg = performQuickSyncBackground as jest.Mock;
const deep = performFullGallerySync as jest.Mock;
const docs = performDocumentSync as jest.Mock;
const backfill = backfillEmbeddings as jest.Mock;

/** Let queued promise callbacks run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** A mock implementation that waits until released, tracking concurrency. */
let running = 0;
let maxRunning = 0;
const gate = <T,>(value: T) => {
  const releases: Array<() => void> = [];
  const cancels: CancelRef[] = [];
  const impl = (...args: unknown[]) => {
    const cancel = args.find((a) => typeof a === 'object' && a !== null && 'current' in (a as object)) as CancelRef;
    cancels.push(cancel);
    running++;
    maxRunning = Math.max(maxRunning, running);
    return new Promise<T>((resolve) => {
      releases.push(() => { running--; resolve(value); });
    });
  };
  return { impl, release: (i = 0) => releases[i](), releases, cancels };
};

beforeEach(() => {
  jest.clearAllMocks();
  IndexingService.reset();
  running = 0;
  maxRunning = 0;
  quick.mockResolvedValue({ processed: 0, wasCancelled: false });
  quickBg.mockResolvedValue(0);
  deep.mockResolvedValue({ processed: 0, wasCancelled: false });
  docs.mockResolvedValue({ status: 'done', processed: 0, total: 0, wasCancelled: false });
  backfill.mockResolvedValue(0);
});

describe('one job at a time', () => {
  test('jobs run one after another, never together', async () => {
    const d = gate({ processed: 5, wasCancelled: false });
    const p = gate({ status: 'done', processed: 1, total: 1, wasCancelled: false });
    deep.mockImplementation(d.impl);
    docs.mockImplementation(p.impl);

    const deepDone = IndexingService.deepGallerySync();
    const docsDone = IndexingService.documentSync();
    await settle();

    expect(deep).toHaveBeenCalledTimes(1);
    expect(docs).not.toHaveBeenCalled();
    expect(IndexingService.getSnapshot()).toMatchObject({ running: 'gallery-deep', queued: ['documents'] });

    d.release();
    await expect(deepDone).resolves.toEqual({ processed: 5, wasCancelled: false });
    await settle();
    expect(docs).toHaveBeenCalledTimes(1);
    p.release();
    await docsDone;
    expect(maxRunning).toBe(1);
    expect(IndexingService.getSnapshot().running).toBeNull();
  });

  test('asking for a job that is already queued or running returns the same promise', async () => {
    const d = gate({ processed: 1, wasCancelled: false });
    deep.mockImplementation(d.impl);

    const a = IndexingService.deepGallerySync();
    const b = IndexingService.deepGallerySync();
    await settle();

    expect(a).toBe(b);
    expect(deep).toHaveBeenCalledTimes(1);
    d.release();
    await a;
  });

  test('a failing job rejects its caller and the queue carries on', async () => {
    deep.mockRejectedValue(new Error('camera roll gone'));

    const failed = IndexingService.deepGallerySync();
    const next = IndexingService.documentSync();

    await expect(failed).rejects.toThrow('camera roll gone');
    await expect(next).resolves.toMatchObject({ status: 'done' });
  });
});

describe('priorities', () => {
  test('user jobs go ahead of queued background jobs', async () => {
    const d = gate({ processed: 1, wasCancelled: false });
    deep.mockImplementation(d.impl);
    const order: string[] = [];
    backfill.mockImplementation(async () => { order.push('backfill'); return 0; });
    docs.mockImplementation(async () => { order.push('documents'); return { status: 'done', processed: 0, total: 0, wasCancelled: false }; });

    const deepDone = IndexingService.deepGallerySync();
    IndexingService.backfill();
    const docsDone = IndexingService.documentSync();
    await settle();
    expect(IndexingService.getSnapshot().queued).toEqual(['documents', 'backfill']);

    d.release();
    await deepDone;
    await docsDone;
    await IndexingService.whenIdle();
    expect(order).toEqual(['documents', 'backfill']);
  });

  test('a running backfill makes way for a user job and is queued again afterwards', async () => {
    const b = gate(3);
    backfill.mockImplementationOnce(b.impl).mockResolvedValue(0);

    const firstBackfill = IndexingService.backfill();
    await settle();
    const deepDone = IndexingService.deepGallerySync();

    expect(b.cancels[0].current).toBe(true); // asked to stop
    b.release();
    await firstBackfill;
    await deepDone;
    await settle();
    await IndexingService.whenIdle();

    expect(deep).toHaveBeenCalledTimes(1);
    expect(backfill).toHaveBeenCalledTimes(2);
    expect(maxRunning).toBe(1);
  });
});

describe('quick sync', () => {
  test('resolves after the foreground pass and queues the background pass', async () => {
    quick.mockResolvedValue({ processed: 50, wasCancelled: false, nextCursor: 'cursor_50' });
    const bg = gate(250);
    quickBg.mockImplementation(bg.impl);

    const result = await IndexingService.quickGallerySync();
    await settle();

    expect(result).toEqual({ processed: 50, wasCancelled: false });
    expect(quick).toHaveBeenCalledWith(expect.any(Function), expect.any(Object), { background: false });
    expect(quickBg).toHaveBeenCalledWith('cursor_50', expect.any(Object));
    expect(IndexingService.getSnapshot().running).toBe('gallery-quick-background');
    bg.release();
    await IndexingService.whenIdle();
  });

  test('no background pass when the gallery was small or the sync was cancelled', async () => {
    quick.mockResolvedValue({ processed: 3, wasCancelled: false });
    await IndexingService.quickGallerySync();
    quick.mockResolvedValue({ processed: 3, wasCancelled: true, nextCursor: 'x' });
    await IndexingService.quickGallerySync();
    await settle();

    expect(quickBg).not.toHaveBeenCalled();
  });

  test('progress reaches both the caller and subscribers', async () => {
    quick.mockImplementation(async (onProgress: (n: number) => void) => {
      onProgress(1);
      onProgress(2);
      return { processed: 2, wasCancelled: false };
    });
    const onProgress = jest.fn();
    const seen: IndexingSnapshot[] = [];
    IndexingService.subscribe((s) => seen.push(s));

    await IndexingService.quickGallerySync(onProgress);

    expect(onProgress.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    expect(seen.some((s) => s.running === 'gallery-quick' && s.galleryProcessed === 2)).toBe(true);
    expect(seen[seen.length - 1].running).toBeNull();
  });
});

describe('pause', () => {
  test('stops the running gallery job and drops queued background work', async () => {
    const d = gate({ processed: 4, wasCancelled: true });
    deep.mockImplementation(d.impl);

    const deepDone = IndexingService.deepGallerySync(undefined, 'cursor_10');
    const queuedBackfill = IndexingService.backfill();
    await settle();
    IndexingService.pause();

    expect(d.cancels[0].current).toBe(true);
    await expect(queuedBackfill).resolves.toBe(0); // dropped, never run
    d.release();
    await expect(deepDone).resolves.toEqual({ processed: 4, wasCancelled: true });
    expect(deep).toHaveBeenCalledWith(expect.any(Function), expect.any(Object), 'cursor_10');
    expect(backfill).not.toHaveBeenCalled();
  });

  test('does not stop PDF sync', async () => {
    const p = gate({ status: 'done', processed: 1, total: 1, wasCancelled: false });
    docs.mockImplementation(p.impl);

    const done = IndexingService.documentSync(5);
    await settle();
    IndexingService.pause();

    expect(p.cancels[0].current).toBe(false);
    expect(docs).toHaveBeenCalledWith(5, expect.any(Function), expect.any(Object));
    p.release();
    await done;
  });

  test('each run gets a fresh cancel flag', async () => {
    await IndexingService.deepGallerySync();
    IndexingService.pause();
    await IndexingService.deepGallerySync();

    expect((deep.mock.calls[1][1] as CancelRef).current).toBe(false);
  });
});

describe('subscribe', () => {
  test('unsubscribe stops notifications, and a throwing listener does not break others', async () => {
    const good = jest.fn();
    const off = IndexingService.subscribe(good);
    IndexingService.subscribe(() => { throw new Error('bad listener'); });

    await IndexingService.documentSync();
    const calls = good.mock.calls.length;
    expect(calls).toBeGreaterThan(0);

    off();
    await IndexingService.documentSync();
    expect(good.mock.calls.length).toBe(calls);
  });

  test('document progress is published and cleared afterwards', async () => {
    docs.mockImplementation(async (_limit: unknown, onProgress: (p: number, t: number) => void) => {
      onProgress(0, 2);
      onProgress(1, 2);
      return { status: 'done', processed: 2, total: 2, wasCancelled: false };
    });
    const seen: IndexingSnapshot[] = [];
    IndexingService.subscribe((s) => seen.push(s));

    await IndexingService.documentSync();

    expect(seen.some((s) => s.docsProcessed === 1 && s.docsTotal === 2)).toBe(true);
    expect(IndexingService.getSnapshot()).toMatchObject({ docsProcessed: 0, docsTotal: 0 });
  });
});

/**
 * A deep sync mock that reports `step` photos, then waits until it is asked
 * to stop (it then "saves its cursor" and returns cancelled) or released.
 */
const stoppableDeep = (step = 3) => {
  const calls: Array<{ resumeFrom?: string; cancel: CancelRef }> = [];
  const releases: Array<() => void> = [];
  const impl = (onProgress: (count: number, uri?: string) => void, cancel: CancelRef, resumeFrom?: string) => {
    calls.push({ resumeFrom, cancel });
    onProgress(step, 'content://photo');
    return new Promise((resolve) => {
      const poll = setInterval(() => {
        if (cancel.current) { clearInterval(poll); resolve({ processed: step, wasCancelled: true }); }
      }, 1);
      releases.push(() => { clearInterval(poll); resolve({ processed: step, wasCancelled: false }); });
    });
  };
  return { impl, calls, release: (i: number) => releases[i](), runs: () => calls.length };
};

const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
  expect(check()).toBe(true);
};

describe('progress for every caller', () => {
  test('a caller that joins a running job gets its progress too', async () => {
    const d = stoppableDeep(4);
    deep.mockImplementation(d.impl);
    const firstRun = jest.fn();
    const home = jest.fn();

    const p1 = IndexingService.deepGallerySync(firstRun);
    await waitFor(() => d.runs() === 1);
    const p2 = IndexingService.deepGallerySync(home);
    expect(p2).toBe(p1);

    // Home joined after the first report; it hears the next one.
    (deep.mock.calls[0][0] as (n: number) => void)(5);
    expect(firstRun).toHaveBeenLastCalledWith(5, undefined);
    expect(home).toHaveBeenLastCalledWith(5, undefined);
    d.release(0);
    await p1;
  });

  test('a progress callback that throws does not stop the sync', async () => {
    quick.mockImplementation(async (onProgress: (n: number) => void) => {
      onProgress(1);
      return { processed: 1, wasCancelled: false };
    });
    const bad = jest.fn(() => { throw new Error('screen gone'); });
    await expect(IndexingService.quickGallerySync(bad)).resolves.toEqual({ processed: 1, wasCancelled: false });
    expect(bad).toHaveBeenCalled();
  });
});

describe('a quick check during a deep sync', () => {
  test('the deep sync steps aside, the quick check runs, then the deep sync carries on from its saved cursor', async () => {
    const d = stoppableDeep(3);
    deep.mockImplementation(d.impl);
    const order: string[] = [];
    quick.mockImplementation(async () => { order.push('quick'); return { processed: 2, wasCancelled: false }; });
    const deepProgress = jest.fn();
    const deepDone = jest.fn();

    IndexingService.deepGallerySync(deepProgress, 'cursor_from_caller').then(deepDone);
    await waitFor(() => d.runs() === 1);
    const quickResult = await IndexingService.quickGallerySync();

    expect(quickResult).toEqual({ processed: 2, wasCancelled: false });
    expect(d.calls[0].cancel.current).toBe(true); // asked to step aside
    await waitFor(() => d.runs() === 2);
    expect(order).toEqual(['quick']);
    expect(deepDone).not.toHaveBeenCalled(); // still one sync, still running
    expect(d.calls[1].resumeFrom).toBeUndefined(); // reads the cursor it saved
    expect(d.calls[1].cancel.current).toBe(false); // fresh cancel flag
    expect(IndexingService.getSnapshot().running).toBe('gallery-deep');

    // The count carries on from where it was: 3 before, 3 more now.
    expect(deepProgress).toHaveBeenLastCalledWith(6, 'content://photo');
    d.release(1);
    await waitFor(() => deepDone.mock.calls.length === 1);
    expect(deepDone).toHaveBeenCalledWith({ processed: 6, wasCancelled: false });
  });

  test('a quick check goes ahead of a deep sync that is still waiting its turn', async () => {
    const pdf = gate({ status: 'done', processed: 0, total: 0, wasCancelled: false });
    docs.mockImplementation(pdf.impl);
    const order: string[] = [];
    deep.mockImplementation(async () => { order.push('deep'); return { processed: 0, wasCancelled: false }; });
    quick.mockImplementation(async () => { order.push('quick'); return { processed: 0, wasCancelled: false }; });

    IndexingService.documentSync();
    await settle();
    IndexingService.deepGallerySync();
    IndexingService.quickGallerySync();
    expect(IndexingService.getSnapshot().queued).toEqual(['gallery-quick', 'gallery-deep']);
    pdf.release();
    await IndexingService.whenIdle();
    expect(order).toEqual(['quick', 'deep']);
  });

  test('a deep sync that was already finishing just finishes', async () => {
    let finish!: (v: unknown) => void;
    deep.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const deepResult = IndexingService.deepGallerySync();
    await settle();
    IndexingService.quickGallerySync();
    finish({ processed: 10, wasCancelled: false }); // done before it noticed the request
    await expect(deepResult).resolves.toEqual({ processed: 10, wasCancelled: false });
    await IndexingService.whenIdle();
    expect(deep).toHaveBeenCalledTimes(1);
  });

  test('Pause while the deep sync is set aside stops it for good, with the count so far', async () => {
    const d = stoppableDeep(3);
    deep.mockImplementation(d.impl);
    const q = gate({ processed: 0, wasCancelled: false });
    quick.mockImplementation(q.impl);

    const deepResult = IndexingService.deepGallerySync();
    await waitFor(() => d.runs() === 1);
    IndexingService.quickGallerySync();
    await waitFor(() => IndexingService.getSnapshot().running === 'gallery-quick');
    expect(IndexingService.getSnapshot().queued).toContain('gallery-deep');

    IndexingService.pause();
    await expect(deepResult).resolves.toEqual({ processed: 3, wasCancelled: true });
    expect(q.cancels[0].current).toBe(true);
    q.release();
    await IndexingService.whenIdle();
    expect(d.runs()).toBe(1);
  });
});

describe('Pause', () => {
  test('drops a photo sync that has not started yet', async () => {
    const pdf = gate({ status: 'done', processed: 0, total: 0, wasCancelled: false });
    docs.mockImplementation(pdf.impl);
    IndexingService.documentSync();
    await settle();
    const deepResult = IndexingService.deepGallerySync();
    const quickResult = IndexingService.quickGallerySync();

    IndexingService.pause();
    await expect(deepResult).resolves.toEqual({ processed: 0, wasCancelled: true });
    await expect(quickResult).resolves.toEqual({ processed: 0, wasCancelled: true });
    expect(pdf.cancels[0].current).toBe(false); // PDF sync carries on
    pdf.release();
    await IndexingService.whenIdle();
    expect(deep).not.toHaveBeenCalled();
    expect(quick).not.toHaveBeenCalled();
  });

  test('a backfill that made way does not come back after Pause', async () => {
    const b = gate(0);
    backfill.mockImplementationOnce(b.impl);
    const d = gate({ processed: 0, wasCancelled: false });
    deep.mockImplementation(d.impl);

    IndexingService.backfill();
    await settle();
    IndexingService.deepGallerySync();
    expect(b.cancels[0].current).toBe(true); // asked to make way
    IndexingService.pause(); // before it finished its current photo
    b.release();
    await IndexingService.whenIdle();
    await settle();
    await IndexingService.whenIdle();
    expect(backfill).toHaveBeenCalledTimes(1);
  });
});

describe('stopping the charging-time run', () => {
  test('stops background-only work, running and queued', async () => {
    const d = gate({ processed: 0, wasCancelled: false });
    deep.mockImplementation(d.impl);
    IndexingService.deepGallerySync(undefined, undefined, { origin: 'background' });
    await settle();
    const queuedBackfill = IndexingService.backfill({ origin: 'background' });

    IndexingService.stopBackgroundWork();
    expect(d.cancels[0].current).toBe(true);
    await expect(queuedBackfill).resolves.toBe(0);
    d.release();
    await IndexingService.whenIdle();
    expect(backfill).not.toHaveBeenCalled();
  });

  test('leaves a sync the person joined running', async () => {
    const d = gate({ processed: 7, wasCancelled: false });
    deep.mockImplementation(d.impl);
    const background = IndexingService.deepGallerySync(undefined, undefined, { origin: 'background' });
    await settle();
    const mine = IndexingService.deepGallerySync(); // the person opened the app and tapped Check
    expect(mine).toBe(background);

    IndexingService.stopBackgroundWork();
    expect(d.cancels[0].current).toBe(false);
    d.release();
    await expect(mine).resolves.toEqual({ processed: 7, wasCancelled: false });
  });

  test('leaves work the app asked for, running or queued', async () => {
    const pdf = gate({ status: 'done', processed: 0, total: 0, wasCancelled: false });
    docs.mockImplementation(pdf.impl);
    IndexingService.documentSync();
    await settle();
    IndexingService.backfill(); // the app's own start-up backfill

    IndexingService.stopBackgroundWork();
    expect(pdf.cancels[0].current).toBe(false);
    expect(IndexingService.getSnapshot().queued).toEqual(['backfill']);
    pdf.release();
    await IndexingService.whenIdle();
    expect(backfill).toHaveBeenCalledTimes(1);
  });

  test('a background-only backfill that made way does not come back after the stop', async () => {
    const b = gate(0);
    backfill.mockImplementationOnce(b.impl);
    IndexingService.backfill({ origin: 'background' });
    await settle();
    IndexingService.deepGallerySync(); // the app's user job
    IndexingService.stopBackgroundWork();
    b.release();
    await IndexingService.whenIdle();
    await settle();
    await IndexingService.whenIdle();
    expect(backfill).toHaveBeenCalledTimes(1);
    expect(deep).toHaveBeenCalledTimes(1); // the app's sync still ran
  });
});
