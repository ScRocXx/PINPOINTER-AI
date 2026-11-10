import React, { useEffect, useRef, useState } from 'react';
import { PhotoAccessBanner } from '../../components/PhotoAccessBanner';
import type { DocumentAccessApi, PhotoAccessApi } from '../../hooks/useStorageAccess';
import { useIndexingProgress } from '../../hooks/useIndexingProgress';
import { IndexingService } from '../../services/IndexingService';
import { AppLogger } from '../../utils/AppLogger';
import type { StepDotsProps } from './StepFrame';
import { ReadyView } from './ReadyView';

export { ReadyView } from './ReadyView';
export type { ReadyViewProps } from './ReadyView';

export interface ReadyStepProps {
  dots: StepDotsProps;
  direction?: 1 | -1;
  photos: PhotoAccessApi;
  docs: DocumentAccessApi;
  onFinish: () => void;
}

/**
 * Step 4: the first look through the gallery starts here, and the step
 * shows it in plain numbers ("1,240 of 2,400 photos"). Searching works from
 * the first photo, so "Start searching" is always there: the work carries on
 * after this screen (IndexingService), then while charging, even with the
 * app closed. PDFs start after the photos.
 */
export const ReadyStep: React.FC<ReadyStepProps> = ({ dots, direction, photos, docs, onFinish }) => {
  const photosAllowed = photos.access === 'full' || photos.access === 'limited';
  const docsAllowed = docs.access === 'all' || docs.access === 'folders';
  const progress = useIndexingProgress(photos.access);
  const [photosFinished, setPhotosFinished] = useState(false);
  const started = useRef<{ photos: string | null; docs: string | null }>({ photos: null, docs: null });

  // Start (or widen) the work whenever access is given, here or on an earlier
  // step. Asking twice joins the running job instead of starting another.
  useEffect(() => {
    if (!photosAllowed || started.current.photos === photos.access) {
      return;
    }
    started.current.photos = photos.access;
    let alive = true;
    IndexingService.deepGallerySync()
      .then(result => {
        if (result.wasCancelled) {
          return;
        }
        if (alive) {
          setPhotosFinished(true);
        }
        IndexingService.backfill().catch(e => AppLogger.warn('FirstRun', 'Backfill failed', e));
      })
      .catch(e => AppLogger.warn('FirstRun', 'First look through photos stopped', e));
    return () => {
      alive = false;
    };
  }, [photos.access, photosAllowed]);

  useEffect(() => {
    if (!docsAllowed || started.current.docs === docs.access) {
      return;
    }
    started.current.docs = docs.access;
    IndexingService.documentSync().catch(e => AppLogger.warn('FirstRun', 'First look through PDFs stopped', e));
  }, [docs.access, docsAllowed]);

  return (
    <ReadyView
      dots={dots}
      direction={direction}
      photos={{
        allowed: photosAllowed,
        done: progress.photos.done,
        total: progress.photos.total,
        busy: progress.photos.running || progress.photos.queued,
        finished: photosFinished,
      }}
      papers={{
        allowed: docsAllowed,
        done: progress.papers.done,
        total: progress.papers.total,
        running: progress.papers.running,
        waiting: progress.papers.queued,
      }}
      banner={<PhotoAccessBanner inline onAccessChange={() => photos.refresh()} testID="first-run-limited" />}
      onAllowPhotos={() => (photos.access === 'blocked' ? photos.openSettings() : photos.request())}
      onAllowPapers={() => (docs.canAskAll ? docs.allowAll() : docs.chooseFolder())}
      onFinish={onFinish}
    />
  );
};
