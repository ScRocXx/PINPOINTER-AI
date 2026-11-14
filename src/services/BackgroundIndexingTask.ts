/**
 * The JS half of background indexing. Android's IndexingJobService starts
 * this headless task only while the phone is charging and the battery isn't
 * low, and only when the app isn't open (the app runs its own sync then).
 *
 * It resumes deep gallery sync from the saved cursor, removes files deleted
 * from the phone, then backfills missing embeddings, through the same
 * IndexingService queue the app uses. It stops
 * by itself after `budgetMs`, or as soon as native says the conditions no
 * longer hold; deep sync saves its cursor, so the next run carries on.
 *
 * Its jobs are marked as background work. If the person opens the app while
 * this runs and asks for the same sync, the job is theirs too, and stopping
 * this run leaves it going (IndexingService.stopBackgroundWork).
 */
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { setupDatabase } from '../database';
import { loadSavedCursor } from '../utils/GallerySync';
import { AppLogger } from '../utils/AppLogger';
import { hasPhotoAccess } from '../utils/StoragePermissions';
import { IndexingService } from './IndexingService';

/** Must match IndexingJobService.TASK_KEY. */
export const BACKGROUND_TASK_KEY = 'PinpointerBackgroundIndexing';
/** Must match IndexingJobService.STOP_EVENT. */
export const STOP_EVENT = 'PinpointerBackgroundIndexingStop';
/** Used when native passes no budget. */
const DEFAULT_BUDGET_MS = 8 * 60 * 1000;

/** Every job this run asks for is background work (see IndexingService.stopBackgroundWork). */
const BACKGROUND = { origin: 'background' } as const;

/** What one background run did, for logs and tests. */
export type BackgroundRunOutcome = 'no-permission' | 'stopped' | 'finished' | 'failed' | 'not-android';

// Checks, never requests: nobody is there to answer a prompt. Counts the
// Android 14+ "Select photos" (limited) grant too, so those users still get
// background indexing of the photos they picked.
const hasGalleryPermission = (): Promise<boolean> => hasPhotoAccess();

export const runBackgroundIndexing = async (data?: { budgetMs?: number }): Promise<BackgroundRunOutcome> => {
    if (Platform.OS !== 'android') return 'not-android';
    if (!(await hasGalleryPermission())) return 'no-permission';

    const budgetMs = data?.budgetMs && data.budgetMs > 0 ? data.budgetMs : DEFAULT_BUDGET_MS;
    let stopped = false;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        IndexingService.stopBackgroundWork();
    };
    const timer = setTimeout(stop, budgetMs);
    const subscription = DeviceEventEmitter.addListener(STOP_EVENT, stop);

    try {
        setupDatabase(); // the app's mount effect doesn't run in a headless start
        const cursor = await loadSavedCursor();
        const { processed, wasCancelled } = await IndexingService.deepGallerySync(undefined, cursor, BACKGROUND);
        AppLogger.info('BackgroundIndexing', `Gallery pass: ${processed} photos${wasCancelled ? ' (paused)' : ''}`);
        if (!stopped && !wasCancelled) {
            // Drop deleted files first, so the backfill doesn't spend time on them.
            const removed = await IndexingService.pruneMissing(BACKGROUND);
            AppLogger.info('BackgroundIndexing', `Removed ${removed} deleted files`);
            if (!stopped) {
                const added = await IndexingService.backfill(BACKGROUND);
                AppLogger.info('BackgroundIndexing', `Backfill added ${added} embeddings`);
            }
        }
        return stopped || wasCancelled ? 'stopped' : 'finished';
    } catch (e) {
        AppLogger.warn('BackgroundIndexing', 'Background run failed', e);
        return 'failed';
    } finally {
        clearTimeout(timer);
        subscription.remove();
    }
};

/**
 * Asks Android to run background indexing while charging. Safe to call on
 * every start: an existing schedule is kept as it is.
 */
export const scheduleBackgroundIndexing = async (): Promise<boolean> => {
    const scheduler = NativeModules.IndexingScheduler;
    if (Platform.OS !== 'android' || !scheduler?.schedule) return false;
    try {
        return Boolean(await scheduler.schedule());
    } catch (e) {
        AppLogger.warn('BackgroundIndexing', 'Could not schedule background indexing', e);
        return false;
    }
};
