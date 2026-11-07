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
 * - Asking for a job that is already queued or running returns that job's
 *   promise instead of starting a second copy.
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
import { AppLogger } from '../utils/AppLogger';

export type JobKind = 'gallery-quick' | 'gallery-quick-background' | 'gallery-deep' | 'documents' | 'backfill';

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

interface Job {
    kind: JobKind;
    cancel: CancelRef;
    run: (cancel: CancelRef) => Promise<unknown>;
    /** Value a dropped (never-run) job resolves with. */
    droppedValue: unknown;
    promise: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
}

const BACKGROUND_JOBS: ReadonlySet<JobKind> = new Set(['gallery-quick-background', 'backfill']);
/** Jobs that "Pause" stops. PDF sync isn't paused by the gallery's pause button. */
const PAUSABLE_JOBS: ReadonlySet<JobKind> = new Set(['gallery-quick', 'gallery-quick-background', 'gallery-deep', 'backfill']);

const isBackground = (kind: JobKind) => BACKGROUND_JOBS.has(kind);

type Listener = (snapshot: IndexingSnapshot) => void;

class IndexingServiceImpl {
    private queue: Job[] = [];
    private current: Job | null = null;
    private listeners = new Set<Listener>();
    private progress = { galleryProcessed: 0, docsProcessed: 0, docsTotal: 0 };
    private pumping = false;
    /** Bumped by reset(), so a runner left over from before stops. */
    private generation = 0;

    // ─── public API ─────────────────────────────────────────────────────────

    /**
     * Index the newest photos. Resolves once the first QUICK_SYNC_LIMIT are
     * done; the next batch is then queued as a background job.
     */
    quickGallerySync(onProgress?: (count: number) => void): Promise<GallerySyncResult> {
        return this.enqueue<GallerySyncResult>('gallery-quick', { processed: 0, wasCancelled: true }, async (cancel) => {
            this.setProgress({ galleryProcessed: 0 });
            const result = await performQuickSync(
                (count) => { this.setProgress({ galleryProcessed: count }); onProgress?.(count); },
                cancel,
                { background: false },
            );
            if (!result.wasCancelled && result.nextCursor) {
                const cursor = result.nextCursor;
                this.enqueue<number>('gallery-quick-background', 0, (c) => performQuickSyncBackground(cursor, c))
                    .catch((e) => AppLogger.warn('IndexingService', 'Quick sync background pass failed', e));
            }
            return { processed: result.processed, wasCancelled: result.wasCancelled };
        });
    }

    /** Index every photo, resuming from `resumeFrom` (or the saved cursor). */
    deepGallerySync(onProgress?: (count: number, uri?: string) => void, resumeFrom?: string): Promise<GallerySyncResult> {
        return this.enqueue<GallerySyncResult>('gallery-deep', { processed: 0, wasCancelled: true }, (cancel) => {
            this.setProgress({ galleryProcessed: 0 });
            return performFullGallerySync(
                (count, uri) => { this.setProgress({ galleryProcessed: count }); onProgress?.(count, uri); },
                cancel,
                resumeFrom,
            );
        });
    }

    /** Find and index PDFs. `limit` caps how many are looked at (quick scan). */
    documentSync(limit?: number, onProgress?: (processed: number, total: number) => void): Promise<DocumentSyncResult> {
        const dropped: DocumentSyncResult = { status: 'done', processed: 0, total: 0, wasCancelled: true };
        return this.enqueue<DocumentSyncResult>('documents', dropped, async (cancel) => {
            try {
                return await performDocumentSync(
                    limit,
                    (processed, total) => { this.setProgress({ docsProcessed: processed, docsTotal: total }); onProgress?.(processed, total); },
                    cancel,
                );
            } finally {
                this.setProgress({ docsProcessed: 0, docsTotal: 0 });
            }
        });
    }

    /** Add missing or outdated CLIP vectors, at the lowest priority. */
    backfill(): Promise<number> {
        return this.enqueue<number>('backfill', 0, (cancel) => backfillEmbeddings(cancel));
    }

    /** Stop the running gallery job (deep sync saves its cursor) and drop queued background work. */
    pause() {
        if (this.current && PAUSABLE_JOBS.has(this.current.kind)) {
            this.current.cancel.current = true;
        }
        this.dropQueued((job) => isBackground(job.kind));
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
        if (this.current) this.current.cancel.current = true;
        this.dropQueued(() => true);
        this.current = null;
        this.pumping = false;
        this.generation++;
        this.listeners.clear();
        this.progress = { galleryProcessed: 0, docsProcessed: 0, docsTotal: 0 };
    }

    // ─── internals ──────────────────────────────────────────────────────────

    private enqueue<T>(kind: JobKind, droppedValue: T, run: (cancel: CancelRef) => Promise<T>): Promise<T> {
        const existing = this.current?.kind === kind ? this.current : this.queue.find((j) => j.kind === kind);
        if (existing) return existing.promise as Promise<T>;

        let resolve!: (value: unknown) => void;
        let reject!: (error: unknown) => void;
        const promise = new Promise<unknown>((res, rej) => { resolve = res; reject = rej; });
        const job: Job = { kind, cancel: { current: false }, run, droppedValue, promise, resolve, reject };

        if (isBackground(kind)) {
            this.queue.push(job);
        } else {
            // User work goes ahead of background work...
            const firstBackground = this.queue.findIndex((j) => isBackground(j.kind));
            if (firstBackground === -1) this.queue.push(job);
            else this.queue.splice(firstBackground, 0, job);
            // ...and a running background job is asked to make way.
            if (this.current && isBackground(this.current.kind)) {
                const yielding = this.current;
                yielding.cancel.current = true;
                if (yielding.kind === 'backfill') {
                    yielding.promise.finally(() => {
                        this.backfill().catch((e) => AppLogger.warn('IndexingService', 'Backfill failed', e));
                    }).catch(() => undefined);
                }
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
                    job.resolve(await job.run(job.cancel));
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

    private dropQueued(predicate: (job: Job) => boolean) {
        const dropped = this.queue.filter(predicate);
        this.queue = this.queue.filter((j) => !predicate(j));
        dropped.forEach((j) => j.resolve(j.droppedValue));
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
