import { useEffect, useRef, useState } from 'react';
import { IndexingService, IndexingSnapshot, JobKind } from '../services/IndexingService';
import { getReadyCounts, ReadyCounts } from '../database';
import { getGalleryTotalCount } from '../utils/GallerySync';
import { AppLogger } from '../utils/AppLogger';

/** How often the "ready" counts are re-read from the database while work runs. */
export const PROGRESS_REFRESH_MS = 500;

const GALLERY_JOBS: ReadonlySet<JobKind> = new Set(['gallery-quick', 'gallery-quick-background', 'gallery-deep']);
const isGalleryJob = (kind: JobKind | null): boolean => kind !== null && GALLERY_JOBS.has(kind);

export interface KindProgress {
  /**
   * Photos: how many have been read (or given up on) so far.
   * Papers: while running, how many of this pass are done; otherwise how
   * many PDFs are ready in total.
   */
  done: number;
  /**
   * Photos: every photo Pinpointer can see. Papers: this pass's PDFs while
   * running. null while unknown.
   */
  total: number | null;
  /** Work for this kind is running now. */
  running: boolean;
  /** Work for this kind is waiting its turn. */
  queued: boolean;
}

export interface PhotoProgress extends KindProgress {
  /** The running check only looks at the newest photos ("Check again"), not at all of them. */
  quick: boolean;
}

export interface IndexingProgress {
  photos: PhotoProgress;
  papers: KindProgress;
}

const sameShownState = (a: IndexingSnapshot, b: IndexingSnapshot): boolean =>
  a.running === b.running &&
  a.docsProcessed === b.docsProcessed &&
  a.docsTotal === b.docsTotal &&
  a.queued.length === b.queued.length &&
  a.queued.every((kind, i) => kind === b.queued[i]);

/** Pure: the progress to show, from the queue snapshot, the database counts and the photo count. */
export const toIndexingProgress = (
  snapshot: IndexingSnapshot,
  counts: ReadyCounts,
  photoTotal: number | null,
): IndexingProgress => {
  const papersRunning = snapshot.running === 'documents';
  return {
    photos: {
      done: counts.photos,
      total: photoTotal === null || photoTotal < 0 ? null : Math.max(photoTotal, counts.photos),
      running: isGalleryJob(snapshot.running),
      queued: snapshot.queued.some(isGalleryJob),
      quick: snapshot.running === 'gallery-quick',
    },
    papers: {
      done: papersRunning ? snapshot.docsProcessed : counts.papers,
      total: papersRunning && snapshot.docsTotal > 0 ? snapshot.docsTotal : null,
      running: papersRunning,
      queued: snapshot.queued.includes('documents'),
    },
  };
};

/**
 * Live "120 of 2,400" progress for any screen, whoever started the work
 * (first run, Home, the charging-time job). Listens to IndexingService and
 * re-reads the per-file counts at most every PROGRESS_REFRESH_MS, so it
 * stays cheap while photos tick by.
 *
 * The photo total is counted on mount, whenever gallery work finishes, and
 * whenever `recountKey` changes (pass the photo access, so allowing more
 * photos updates the total).
 */
export const useIndexingProgress = (recountKey?: unknown): IndexingProgress => {
  const [snapshot, setSnapshot] = useState<IndexingSnapshot>(() => IndexingService.getSnapshot());
  const [counts, setCounts] = useState<ReadyCounts>(() => getReadyCounts());
  const [photoTotal, setPhotoTotal] = useState<number | null>(null);
  const lastRead = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const readCounts = () => {
      timer = null;
      lastRead.current = Date.now();
      setCounts(getReadyCounts());
    };
    const unsubscribe = IndexingService.subscribe(next => {
      // galleryProcessed ticks on every photo but isn't shown; skip those.
      setSnapshot(prev => (sameShownState(prev, next) ? prev : next));
      if (timer) {
        return;
      }
      timer = setTimeout(readCounts, Math.max(0, PROGRESS_REFRESH_MS - (Date.now() - lastRead.current)));
    });
    setSnapshot(IndexingService.getSnapshot());
    readCounts();
    return () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  const galleryBusy = isGalleryJob(snapshot.running) || snapshot.queued.some(isGalleryJob);
  // Count the photos on mount, when the access key changes (even if a job
  // starts in the same moment) and when gallery work ends. A job starting
  // must not throw away a count already on its way, so only unmounting
  // drops a result, and only the newest count is kept.
  const countedFor = useRef<{ key: unknown } | null>(null);
  const countSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (galleryBusy && countedFor.current && countedFor.current.key === recountKey) {
      return;
    }
    countedFor.current = { key: recountKey };
    const seq = ++countSeq.current;
    getGalleryTotalCount()
      .then(total => {
        if (!mounted.current || seq !== countSeq.current) {
          return;
        }
        setPhotoTotal(total < 0 ? null : total);
        if (total < 0) {
          // Try again next time instead of "Counting…" for the whole session.
          countedFor.current = null;
        }
        setCounts(getReadyCounts());
      })
      .catch(e => AppLogger.warn('IndexingProgress', 'Could not count photos', e));
  }, [galleryBusy, recountKey]);

  return toIndexingProgress(snapshot, counts, photoTotal);
};
