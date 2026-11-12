import React, { useEffect, useRef, useState } from 'react';
import { PhotoAccessBanner } from '../../components/PhotoAccessBanner';
import type { DocumentAccessApi, PhotoAccessApi } from '../../hooks/useStorageAccess';
import { useIndexingProgress } from '../../hooks/useIndexingProgress';
import { IndexingService } from '../../services/IndexingService';
import { AppLogger } from '../../utils/AppLogger';
import { allFilesAccessApplies } from '../../utils/StoragePermissions';
import type { StepDotsProps } from './StepFrame';
import { ReadyView } from './ReadyView';

export { ReadyView } from './ReadyView';
export type { ReadyViewProps } from './ReadyView';

export interface ReadyStepProps {
  dots: StepDotsProps;
  direction?: 1 | -1;
  photos: PhotoAccessApi;
  docs: DocumentAccessApi;
  /** PDFs were picked one by one on the PDF step (they don't count as folder access). */
  pickedPdfs?: boolean;
  onFinish: () => void;
}

/**
 * Runs `pass` now, and again each time `key` changes while a pass is going.
 * IndexingService joins a second ask to the running job, so a pass that
 * started before more photos (or folders) were allowed would miss them.
 */
const useWideningRun = (
  key: string | null,
  enabled: boolean,
  pass: () => Promise<{ wasCancelled: boolean } | void>,
  onDone: () => void,
  label: string,
) => {
  const keyRef = useRef(key);
  keyRef.current = key;
  const running = useRef(false);
  const alive = useRef(true);
  const latest = useRef({ pass, onDone });
  latest.current = { pass, onDone };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || running.current) {
      return;
    }
    running.current = true;
    (async () => {
      try {
        let ranFor: string | null;
        do {
          ranFor = keyRef.current;
          const result = await latest.current.pass();
          if (result && result.wasCancelled) {
            return;
          }
        } while (alive.current && keyRef.current !== ranFor);
        if (alive.current) {
          latest.current.onDone();
        }
      } catch (e) {
        AppLogger.warn('FirstRun', label, e);
      } finally {
        running.current = false;
      }
    })();
  }, [enabled, key, label]);
};

/**
 * Step 4: the first look through the gallery starts here, and the step
 * shows it in plain numbers ("1,240 of 2,400 photos"). Searching works from
 * the first photo, so "Start searching" is always there: the work carries on
 * after this screen (IndexingService), then while charging, even with the
 * app closed. PDFs start after the photos.
 */
export const ReadyStep: React.FC<ReadyStepProps> = ({ dots, direction, photos, docs, pickedPdfs = false, onFinish }) => {
  const photosAllowed = photos.access === 'full' || photos.access === 'limited';
  const docsAllowed = docs.access === 'all' || docs.access === 'folders' || pickedPdfs;
  const progress = useIndexingProgress(photos.access);
  const [photosFinished, setPhotosFinished] = useState(false);

  // More photos allowed means a new first look: not "all ready" any more.
  useEffect(() => {
    setPhotosFinished(false);
  }, [photos.access]);

  useWideningRun(
    photos.access,
    photosAllowed,
    () => IndexingService.deepGallerySync(),
    () => {
      setPhotosFinished(true);
      IndexingService.backfill().catch(e => AppLogger.warn('FirstRun', 'Backfill failed', e));
    },
    'First look through photos stopped',
  );
  useWideningRun(
    docs.access,
    docsAllowed,
    () => IndexingService.documentSync().then(() => undefined),
    () => undefined,
    'First look through PDFs stopped',
  );

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
      // Below Android 11 the photo permission covers files, so ask for that.
      onAllowPapers={() => (!allFilesAccessApplies() || docs.canAskAll ? docs.allowAll() : docs.chooseFolder())}
      onFinish={onFinish}
    />
  );
};
