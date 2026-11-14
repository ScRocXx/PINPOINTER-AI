/**
 * IndexingService — the one place indexing work runs.
 *
 * A plain TypeScript singleton (no React) with a single queue and a single
 * runner, so only one sync loop ever touches the database at a time. Before
 * this, quick sync's silent background pass, deep sync, PDF sync and the
 * embedding backfill were separate fire-and-forget loops started from hooks,
 * and could run together with interleaved transactions.
 *
 * - User jobs (quick/deep gallery sync, PDF sync) go ahead of background jobs
 *   (quick sync's second pass, embedding backfill). A running background job
 *   is asked to stop when a user job arrives; the backfill is queued again.
 * - A quick check goes ahead of a deep sync too: a running deep sync steps
 *   aside at its saved cursor, the quick check runs, and the deep sync carries
 *   on by itself. Its callers see one sync, still running, with one count.
 * - Asking for a job that is already queued or running returns that job's
 *   promise instead of starting a second copy; the new caller's progress
 *   callback joins the job's listeners.
 * - Every job remembers who asked for it: the app, the charging-time
 *   background run, or both. `stopBackgroundWork()` stops only work the app
 *   didn't ask for; `pause()` (the person's Pause) stops photo work for everyone.
 * - Hooks call the methods below and listen with `subscribe()`; they no
 *   longer own any loops.
 *
 * This is the seam where a native WorkManager runner can later take over, so
 * indexing survives the app being backgrounded and can wait for charging.
 */
import {
    backfillEmbeddings,
    performFullGallerySync,
    performQuickSync,
    performQuickSyncBackground,
} from '../utils/GallerySync';
import { performDocumentSync, type DocumentSyncResult } from '../utils/DocumentSync';
import { pruneMissingFiles } from '../utils/MissingFiles';
import { AppLogger } from '../utils/AppLogger';

export type JobKind = 'gallery-quick' | 'gallery-quick-background' | 'gallery-deep' | 'documents' | 'backfill' | 'prune';

/** Who asked for a job: the app (a person, or the app's own start-up work) or the charging-time background run. */
export type JobOrigin = 'app' | 'background';

export interface JobOptions {
    /** Defaults to 'app'. */
    origin?: JobOrigin;
}

type CancelRef = { current: boolean };

/** What the service is doing, for any UI that wants to show it. */
export interface IndexingSnapshot {
    running: JobKind | null;
    queued: JobKind[];
    galleryProcessed: number;
    docsProcessed: number;
    docsTotal: number;
}

export interface GallerySyncResult {
    processed: number;
    wasCancelled: boolean;
}

type ProgressListener = (...args: unknown[]) => void;

interface Job {
    kind: JobKind;
    cancel: CancelRef;
    run: (cancel: CancelRef, job: Job) => Promise<unknown>;
    /** Value a dropped (never-run, or set-aside) job resolves with. */
    droppedValue: () => unknown;
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    /** Every caller's progress callback, including callers that joined later. */
    progress: ProgressListener[];
    origins: Set<JobOrigin>;
    /** Set while a deep sync steps aside for a quick check: it is queued again, not finished. */
    yieldRequested: boolean;
}

const BACKGROUND_JOBS: ReadonlySet<JobKind> = new Set(['gallery-quick-background', 'backfill', 'prune']);
/** Jobs that "Pause" stops. PDF sync isn't paused by the gallery's pause button. */
const PAUSABLE_JOBS: ReadonlySet<JobKind> = new Set(['gallery-quick', 'gallery-quick-background', 'gallery-deep', 'backfill', 'prune']);

const isBackground = (kind: JobKind) => BACKGROUND_JOBS.has(kind);
const isBackgroundOnly = (job: Job) => job.origins.size === 1 && job.origins.has('background');
const wasCancelledResult = (value: unknown) =>
    typeof value === 'object' && value !== null && (value as { wasCancelled?: unknown }).wasCancelled === true;

type Listener = (snapshot: IndexingSnapshot) => void;

class IndexingServiceImpl {
    private queue: Job[] = [];
    private current: Job | null = null;
    private listeners = new Set<Listener>();
    private progress = { galleryProcessed: 0, docsProcessed: 0, docsTotal: 0 };
    private pumping = false;
    /** Bumped by reset(), so a runner left over from before stops. */
    private generation = 0;
    /** Bumped by pause(), so a backfill that made way isn't queued again after it. */
    private pauseCount = 0;
    /** Bumped by stopBackgroundWork(), likewise for background-only backfills. */
    private backgroundStopCount = 0;

    // ─── public API ─────────────────────────────────────────────────────────

    /**
     * Index the newest photos. Resolves once the first QUICK_SYNC_LIMIT are
     * done; the next batch is then queued as a background job. A running deep
     * sync steps aside for it and carries on afterwards.
     */
    quickGallerySync(onProgress?: (count: number) => void, options?: JobOptions): Promise<GallerySyncResult> {
        return this.enqueue<GallerySyncResult>('gallery-quick', () => ({ processed: 0, wasCancelled: true }), async (cancel, job) => {
            this.setProgress({ galleryProcessed: 0 });
            const result = await performQuickSync(
                (count) => { this.setProgress({ galleryProcessed: count }); this.emit(job, count); },
                cancel,
                { background: false },
            );
            if (!result.wasCancelled && result.nextCursor) {
                const cursor = result.nextCursor;
                this.enqueue<number>('gallery-quick-background', () => 0, (c) => performQuickSyncBackground(cursor, c), undefined, {
                    origin: this.originOf(job),
                }).catch((e) => AppLogger.warn('IndexingService', 'Quick sync background pass failed', e));
            }
            return { processed: result.processed, wasCancelled: result.wasCancelled };
        }, onProgress, options);
    }

    /**
     * Index every photo, resuming from `resumeFrom` (or the saved cursor).
     * If it steps aside for a quick check, it carries on from the saved
     * cursor and keeps counting from where it was.
     */
    deepGallerySync(
        onProgress?: (count: number, uri?: string) => void,
        resumeFrom?: string,
        options?: JobOptions,
    ): Promise<GallerySyncResult> {
        let processedBefore = 0; // photos done in earlier runs of this job (before it stepped aside)
        let firstRun = true;
        return this.enqueue<GallerySyncResult>('gallery-deep', () => ({ processed: processedBefore, wasCancelled: true }), async (cancel, job) => {
            const from = firstRun ? resumeFrom : undefined; // later runs read the saved cursor
            firstRun = false;
            const base = processedBefore;
            this.setProgress({ galleryProcessed: base });
            const result = await performFullGallerySync(
                (count, uri) => { this.setProgress({ galleryProcessed: base + count }); this.emit(job, base + count, uri); },
                cancel,
                from,
            );
            processedBefore = base + result.processed;
            return { processed: processedBefore, wasCancelled: result.wasCancelled };
        }, onProgress, options);
    }

    /** Find and index PDFs. `limit` caps how many are looked at (quick scan). */
    documentSync(limit?: number, onProgress?: (processed: number, total: number) => void, options?: JobOptions): Promise<DocumentSyncResult> {
        const dropped: DocumentSyncResult = { status: 'done', processed: 0, total: 0, wasCancelled: true };
        return this.enqueue<DocumentSyncResult>('documents', () => dropped, async (cancel, job) => {
            try {
                return await performDocumentSync(
                    limit,
                    (processed, total) => { this.setProgress({ docsProcessed: processed, docsTotal: total }); this.emit(job, processed, total); },
                    cancel,
                );
            } finally {
                this.setProgress({ docsProcessed: 0, docsTotal: 0 });
            }
        }, onProgress, options);
    }

    /** Add missing or outdated CLIP vectors, at the lowest priority. */
    backfill(options?: JobOptions): Promise<number> {
        return this.enqueue<number>('backfill', () => 0, (cancel) => backfillEmbeddings(cancel), undefined, options);
    }

    /** Remove files deleted from the phone from the index, at the lowest priority. */
    pruneMissing(options?: JobOptions): Promise<number> {
        return this.enqueue<number>('prune', () => 0, (cancel) => pruneMissingFiles(cancel), undefined, options);
    }

    /**
     * The person's Pause: stop the running photo job (deep sync saves its
     * cursor) and drop queued photo work, including syncs that hadn't started
     * yet. PDF sync carries on.
     */
    pause() {
        this.pauseCount++;
        if (this.current && PAUSABLE_JOBS.has(this.current.kind)) {
            this.current.cancel.current = true;
            this.current.yieldRequested = false;
        }
        this.dropQueued((job) => PAUSABLE_JOBS.has(job.kind));
        this.notify();
    }

    /**
     * The charging-time run has to stop (time is up, or the phone was
     * unplugged): stop only the work nobody in the app asked for. A sync the
     * person started, or joined, keeps going.
     */
    stopBackgroundWork() {
        this.backgroundStopCount++;
        if (this.current && isBackgroundOnly(this.current)) {
            this.current.cancel.current = true;
            this.current.yieldRequested = false;
        }
        this.dropQueued(isBackgroundOnly);
        this.notify();
    }

    isRunning(kind: JobKind): boolean {
        return this.current?.kind === kind;
    }

    getSnapshot(): IndexingSnapshot {
        return {
            running: this.current?.kind ?? null,
            queued: this.queue.map((j) => j.kind),
            ...this.progress,
        };
    }

    /** Listen for state changes. Returns an unsubscribe function. */
    subscribe(listener: Listener): () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /**
     * Resolves when the queue is empty and nothing is running.
     * @internal For tests.
     */
    async whenIdle(): Promise<void> {
        while (this.current || this.queue.length > 0) {
            await (this.current?.promise ?? this.queue[0]?.promise)?.catch(() => undefined);
        }
    }

    /**
     * Forget all state. Running work is asked to stop; queued work is dropped.
     * @internal For tests.
     */
    reset() {
        if (this.current) {
            this.current.cancel.current = true;
            this.current.yieldRequested = false;
        }
        this.dropQueued(() => true);
        this.current = null;
        this.pumping = false;
        this.generation++;
        this.listeners.clear();
        this.progress = { galleryProcessed: 0, docsProcessed: 0, docsTotal: 0 };
    }

    // ─── internals ──────────────────────────────────────────────────────────

    private enqueue<T>(
        kind: JobKind,
        droppedValue: () => T,
        run: (cancel: CancelRef, job: Job) => Promise<T>,
        onProgress?: (...args: never[]) => void,
        options?: JobOptions,
    ): Promise<T> {
        const origin = options?.origin ?? 'app';
        const listener = onProgress as ProgressListener | undefined;

        const existing = this.current?.kind === kind ? this.current : this.queue.find((j) => j.kind === kind);
        if (existing) {
            existing.origins.add(origin);
            if (listener) existing.progress.push(listener);
            return existing.promise as Promise<T>;
        }

        let resolve!: (value: unknown) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
        const job: Job = {
            kind,
            cancel: { current: false },
            run: run as Job['run'],
            droppedValue,
            promise,
            resolve,
            reject,
            progress: listener ? [listener] : [],
            origins: new Set([origin]),
            yieldRequested: false,
        };

        if (isBackground(kind)) {
            this.queue.push(job);
        } else {
            // User work goes ahead of background work; a quick check also
            // goes ahead of a deep sync that is waiting its turn.
            const goesBefore = (j: Job) => isBackground(j.kind) || (kind === 'gallery-quick' && j.kind === 'gallery-deep');
            const at = this.queue.findIndex(goesBefore);
            if (at === -1) this.queue.push(job);
            else this.queue.splice(at, 0, job);

            const running = this.current;
            if (running && isBackground(running.kind)) {
                // A running background job is asked to make way...
                running.cancel.current = true;
                if (running.kind === 'backfill') {
                    // ...and the backfill comes back afterwards, unless Pause
                    // (or, for background-only work, the background stop) came first.
                    const pauses = this.pauseCount;
                    const stops = this.backgroundStopCount;
                    const backgroundOnly = isBackgroundOnly(running);
                    running.promise.finally(() => {
                        if (this.pauseCount !== pauses) return;
                        if (backgroundOnly && this.backgroundStopCount !== stops) return;
                        this.backfill({ origin: backgroundOnly ? 'background' : 'app' })
                            .catch((e) => AppLogger.warn('IndexingService', 'Backfill failed', e));
                    }).catch(() => undefined);
                }
            } else if (running && running.kind === 'gallery-deep' && kind === 'gallery-quick') {
                // A deep sync steps aside for the quick check and carries on after it.
                running.yieldRequested = true;
                running.cancel.current = true;
            }
        }
        this.notify();
        this.pump().catch((e) => AppLogger.error('IndexingService', 'Queue runner failed', e));
        return promise as Promise<T>;
    }

    private async pump() {
        if (this.pumping) return;
        this.pumping = true;
        const generation = this.generation;
        try {
            let job: Job | undefined;
            while (generation === this.generation && (job = this.queue.shift())) {
                this.current = job;
                this.notify();
                try {
                    const value = await job.run(job.cancel, job);
                    if (job.yieldRequested && wasCancelledResult(value) && generation === this.generation) {
                        this.requeueAfterQuick(job);
                    } else {
                        job.resolve(value);
                    }
                } catch (e) {
                    job.reject(e);
                } finally {
                    if (this.current === job) this.current = null;
                    this.notify();
                }
            }
        } finally {
            if (generation === this.generation) this.pumping = false;
        }
    }

    /** A deep sync that stepped aside goes back in line right after the quick check, with a fresh cancel flag. */
    private requeueAfterQuick(job: Job) {
        job.yieldRequested = false;
        job.cancel = { current: false };
        const quickAt = this.queue.findIndex((j) => j.kind === 'gallery-quick');
        this.queue.splice(quickAt + 1, 0, job); // quickAt is -1 if the quick check was dropped: then first in line
    }

    private originOf(job: Job): JobOrigin {
        return isBackgroundOnly(job) ? 'background' : 'app';
    }

    private emit(job: Job, ...args: unknown[]) {
        for (const listener of job.progress) {
            try {
                listener(...args);
            } catch (e) {
                AppLogger.warn('IndexingService', 'Progress listener failed', e);
            }
        }
    }

    private dropQueued(predicate: (job: Job) => boolean) {
        const dropped = this.queue.filter(predicate);
        this.queue = this.queue.filter((j) => !predicate(j));
        dropped.forEach((j) => j.resolve(j.droppedValue()));
    }

    private setProgress(change: Partial<IndexingServiceImpl['progress']>) {
        this.progress = { ...this.progress, ...change };
        this.notify();
    }

    private notify() {
        if (this.listeners.size === 0) return;
        const snapshot = this.getSnapshot();
        this.listeners.forEach((listener) => {
            try {
                listener(snapshot);
            } catch (e) {
                AppLogger.warn('IndexingService', 'Listener failed', e);
            }
        });
    }
}

/** The app-wide indexing queue. */
export const IndexingService = new IndexingServiceImpl();
