import { useState, useCallback, useEffect } from 'react';
import { loadSavedCursor } from '../utils/GallerySync';
import { IndexingService } from '../services/IndexingService';
import { getIndexedCount } from '../database';
import { AppLogger } from '../utils/AppLogger';
import { ensurePhotoAccess } from '../utils/StoragePermissions';
import { getLastChecked, subscribeLastChecked } from '../utils/LastChecked';
import { useToast } from '../components/ui/Toast';
import { tNow } from '../i18n/current';

/** Wait after app start before backfilling, so startup stays smooth. */
const BACKFILL_STARTUP_DELAY_MS = 5000;

/**
 * useGallerySync — the UI side of gallery sync: permission, pause, resume
 * and a short note when a check ends. The sync loops themselves run in
 * IndexingService, which queues them so only one runs at a time.
 *
 * `isSyncing` and `syncCount` only know about checks started here. Screens
 * that show progress use `useIndexingProgress`, which sees every check
 * (the first run's and the charging-time job's too).
 */
export const useGallerySync = () => {
    const toast = useToast();
    const [isSyncing, setIsSyncing] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isDeepSync, setIsDeepSync] = useState(false);
    const [syncCount, setSyncCount] = useState(0);
    const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

    // The service stamps every finished check, whoever started it.
    useEffect(() => subscribeLastChecked((kind, at) => {
        if (kind === 'photos') setLastSyncTime(at);
    }), []);

    // Give already-indexed photos that lack a CLIP embedding one, in the
    // background. Safe to call repeatedly: the service runs one at a time.
    const startBackfill = useCallback(() => {
        try {
            IndexingService.backfill().catch((e) => AppLogger.warn('GallerySync', 'Backfill failed', e));
        } catch (e) {
            AppLogger.warn('GallerySync', 'Backfill failed to start', e);
        }
    }, []);

    // Load persisted count on mount
    const loadPersistedCount = useCallback(async () => {
        try {
            const count = getIndexedCount();
            if (count > 0) {
                setSyncCount(count);
                setTimeout(startBackfill, BACKFILL_STARTUP_DELAY_MS);
            }

            const at = await getLastChecked('photos');
            if (at) setLastSyncTime(prev => prev ?? at);
        } catch (e) {
            AppLogger.warn('GallerySync', 'Failed to load persisted state', e);
        }
    }, [startBackfill]);

    // Asks for photo access and, when Android won't show its dialog any more
    // (denied twice, or "Select photos" on Android 14+), guides the user to
    // Settings instead of silently doing nothing.
    const requestPermission = (): Promise<boolean> => ensurePhotoAccess();

    const runSync = useCallback(async (fromCursor?: string) => {
        try {
            const hasPermission = await requestPermission();
            if (!hasPermission) return;

            setIsSyncing(true);
            setIsPaused(false);

            const { wasCancelled } = await IndexingService.deepGallerySync(
                (currentCount) => setSyncCount(currentCount),
                fromCursor,
            );

            setIsSyncing(false);
            if (wasCancelled) {
                setIsPaused(true);
            } else {
                setIsPaused(false);
                // A short note, not a pop-up: this can end minutes later, on any screen.
                toast.show(tNow('progress.photosDone'), { icon: 'check' });
                startBackfill();
            }
        } catch (error) {
            AppLogger.error('GallerySync', 'Deep sync failed', error);
            setIsSyncing(false);
            setIsPaused(true); // treat error as pause — cursor was saved
            toast.show(tNow('progress.stopped'), { icon: 'alert', duration: 5000 });
        }
    }, [startBackfill, toast]);

    const handleQuickSync = useCallback(async () => {
        try {
            const hasPermission = await requestPermission();
            if (!hasPermission) return;

            setIsDeepSync(false);
            setIsSyncing(true);
            setIsPaused(false);

            const { wasCancelled } = await IndexingService.quickGallerySync((count) => setSyncCount(count));

            setIsSyncing(false);
            // Paused: not a finished sync, and no backfill behind the user's back.
            if (wasCancelled) return;
            startBackfill();
        } catch (e) {
            AppLogger.error('GallerySync', 'Quick sync failed', e);
            setIsSyncing(false);
            toast.show(tNow('progress.checkFailed'), { icon: 'alert', duration: 5000 });
        }
    }, [startBackfill, toast]);

    const handleDeepSync = useCallback(() => {
        setIsDeepSync(true);
        runSync(undefined);
    }, [runSync]);

    const handlePauseSync = useCallback(() => {
        IndexingService.pause();
    }, []);

    const handleResumeSync = useCallback(async () => {
        const cursor = await loadSavedCursor();
        runSync(cursor);
    }, [runSync]);

    return {
        isSyncing, isPaused, isDeepSync, syncCount, lastSyncTime,
        handleQuickSync, handleDeepSync, handlePauseSync, handleResumeSync,
        loadPersistedCount,
    };
};
