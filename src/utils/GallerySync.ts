import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { indexDocument, isFileIndexed, beginTransaction, commitTransaction, rollbackTransaction, indexEmbedding, getImagesMissingEmbeddings } from '../database';
import { encodeImage } from '../services/EmbeddingService';
import { buildIndexableContent } from './TextEnrichment';
import { analyzeImage } from './VisionPipeline';
import { AppLogger } from './AppLogger';

/** Max photos processed in the quick sync pass (fast cap for UI loading). */
export const QUICK_SYNC_LIMIT = 50;
/** Max photos processed in the silent background pass (quick + background = 300 total). */
export const SILENT_BACKGROUND_LIMIT = 250;
const DEEP_BATCH_SIZE = 10;          // Smaller batches for deep sync (memory safe)
const QUICK_BATCH_SIZE = 50;         // Larger batches for quick sync (no sleep needed)
const DEEP_SLEEP_MS = 200;           // Sleep between deep sync batches

const CURSOR_KEY = 'gallery_sync_cursor';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const saveCursor = async (cursor: string | undefined) => {
    try {
        if (cursor) await AsyncStorage.setItem(CURSOR_KEY, cursor);
        else await AsyncStorage.removeItem(CURSOR_KEY);
    } catch (e) {
        AppLogger.warn('GallerySync', 'Failed to save cursor', e);
    }
};

/** Load the persisted gallery-sync cursor (photo id to resume from). */
export const loadSavedCursor = async (): Promise<string | undefined> => {
    try {
        const val = await AsyncStorage.getItem(CURSOR_KEY);
        return val ?? undefined;
    } catch (e) {
        AppLogger.warn('GallerySync', 'Failed to load cursor', e);
        return undefined;
    }
};

/** Clear the persisted gallery-sync cursor so the next sync starts over. */
export const clearSyncCursor = async () => {
    try {
        await AsyncStorage.removeItem(CURSOR_KEY);
    } catch (e) {
        AppLogger.warn('GallerySync', 'Failed to clear cursor', e);
    }
};

/** Maximum photos the gallery sync will process (-1 = stub, not yet implemented). */
export const getGallerySyncLimit = async (): Promise<number> => -1;
/** Total photo count visible to gallery sync (-1 = stub, not yet implemented). */
export const getGalleryTotalCount = async (): Promise<number> => -1;

/**
 * QUICK SYNC — Lazy Approach.
 * Processes the most recent 50 photos while holding the UI.
 * Then silently spins off a background task to process the remaining 250 photos.
 */
export const performQuickSync = async (
    onProgress: (count: number) => void,
    cancelRef?: React.MutableRefObject<boolean>,
): Promise<{ processed: number; wasCancelled: boolean }> => {
    let hasNextPage = true;
    let after: string | undefined;
    let totalProcessed = 0;

    // Phase 1: Foreground loading (Block UI up to QUICK_SYNC_LIMIT)
    while (hasNextPage && totalProcessed < QUICK_SYNC_LIMIT) {
        if (cancelRef?.current) return { processed: totalProcessed, wasCancelled: true };

        const pageResult = await CameraRoll.getPhotos({
            first: QUICK_BATCH_SIZE,
            after,
            assetType: 'Photos',
        });

        if (pageResult.edges.length === 0) break;

        for (const edge of pageResult.edges) {
            if (totalProcessed >= QUICK_SYNC_LIMIT || cancelRef?.current) {
                break;
            }

            const uri = edge.node.image.uri;
            if (!isFileIndexed(uri)) {
                beginTransaction();
                try {
                    const vision = await analyzeImage(uri);
                    const content = await buildIndexableContent(vision.content || 'image');
                    const docId = indexDocument(null, content || vision.content || 'image', uri, 'IMAGE', vision.detection_type as 'TEXT' | 'OBJECT');
                    if (docId && vision.embedding) {
                        indexEmbedding(docId, vision.embedding);
                    }
                    commitTransaction();
                } catch (e) {
                    rollbackTransaction();
                    AppLogger.warn('QuickSync', `Failed to process ${uri}`, e);
                    // No placeholder row: leaving it unindexed means the next sync retries it.
                }
            }

            totalProcessed++;
            onProgress(totalProcessed);
        }

        hasNextPage = pageResult.page_info.has_next_page;
        after = pageResult.page_info.end_cursor;
    }

    // Phase 2: Silent Background processing
    if (hasNextPage && !cancelRef?.current) {
        // Fire and forget (do not await)
        (async () => {
            let bgProcessed = 0;
            while (hasNextPage && bgProcessed < SILENT_BACKGROUND_LIMIT) {
                if (cancelRef?.current) break;

                const bgPageResult = await CameraRoll.getPhotos({
                    first: DEEP_BATCH_SIZE, // smaller batches in background
                    after,
                    assetType: 'Photos',
                });

                if (bgPageResult.edges.length === 0) break;

                for (const edge of bgPageResult.edges) {
                    if (bgProcessed >= SILENT_BACKGROUND_LIMIT || cancelRef?.current) {
                        break;
                    }

                    const uri = edge.node.image.uri;
                    if (!isFileIndexed(uri)) {
                        try {
                            const vision = await analyzeImage(uri);
                            const content = await buildIndexableContent(vision.content || 'image');
                            const docId = indexDocument(null, content || vision.content || 'image', uri, 'IMAGE', vision.detection_type as 'TEXT' | 'OBJECT');
                            if (docId && vision.embedding) {
                                indexEmbedding(docId, vision.embedding);
                            }
                        } catch (e) {
                            AppLogger.warn('QuickSync (BG)', `Failed to process ${uri}`, e);
                            // No placeholder row: leaving it unindexed means the next sync retries it.
                        }
                    }
                    bgProcessed++;
                    // intentionally not calling onProgress so the UI ignores it
                }

                hasNextPage = bgPageResult.page_info.has_next_page;
                after = bgPageResult.page_info.end_cursor;
                await sleep(500); // 500ms sleep between bg batches to keep UI fully responsive
            }
            AppLogger.info('QuickSync', `Finished silent background sync of ${bgProcessed} photos.`);
        })();
    }

    // Return immediately to release the UI
    return { processed: totalProcessed, wasCancelled: false };
};

/**
 * DEEP SYNC — processes ALL photos.
 * Batches of 10 with 200ms sleep between batches (memory safe for 10k+ galleries).
 * Crash-resumable via AsyncStorage cursor.
 */
export const performFullGallerySync = async (
    onProgress: (count: number, uri?: string) => void,
    cancelRef?: React.MutableRefObject<boolean>,
    resumeFrom?: string,
): Promise<{ processed: number; wasCancelled: boolean }> => {
    let hasNextPage = true;
    let after: string | undefined = resumeFrom ?? await loadSavedCursor();
    let totalProcessed = 0;

    try {
        while (hasNextPage) {
            if (cancelRef?.current) {
                await saveCursor(after);
                return { processed: totalProcessed, wasCancelled: true };
            }

            const pageResult = await CameraRoll.getPhotos({
                first: DEEP_BATCH_SIZE,
                after,
                assetType: 'Photos',
            });

            if (pageResult.edges.length === 0) break;

            for (const edge of pageResult.edges) {
                if (cancelRef?.current) {
                    await saveCursor(after);
                    return { processed: totalProcessed, wasCancelled: true };
                }

                const uri = edge.node.image.uri;
                if (!isFileIndexed(uri)) {
                    beginTransaction();
                    try {
                        const vision = await analyzeImage(uri);
                        const rawText = vision.content;

                        let content: string;
                        if (rawText.trim().length === 0) {
                            content = 'image';
                        } else {
                            content = await buildIndexableContent(rawText);
                        }
                        const docId = indexDocument(null, content, uri, 'IMAGE', vision.detection_type as 'TEXT' | 'OBJECT');
                        if (docId && vision.embedding) {
                            indexEmbedding(docId, vision.embedding);
                        }
                        commitTransaction();
                    } catch (e) {
                        rollbackTransaction();
                        AppLogger.warn('DeepSync', `Failed to process ${uri}`, e);
                        // No placeholder row: leaving it unindexed means the next sync retries it.
                    }
                }

                totalProcessed++;
                onProgress(totalProcessed, uri);
            }

            hasNextPage = pageResult.page_info.has_next_page;
            after = pageResult.page_info.end_cursor;
            await saveCursor(after);
            await sleep(DEEP_SLEEP_MS);
        }

        await clearSyncCursor();
        return { processed: totalProcessed, wasCancelled: false };
    } catch (error) {
        await saveCursor(after);
        throw error;
    }
};

// ─── Embedding backfill ─────────────────────────────────────────────────────

const BACKFILL_BATCH_SIZE = 20;
const BACKFILL_SLEEP_MS = 300;
/** Stop early when the encoder clearly isn't working (e.g. models missing). */
const BACKFILL_GIVE_UP_AFTER = 5;
let backfillRunning = false;

/**
 * Adds CLIP embeddings to photos that are already indexed but have none:
 * photos synced before semantic search worked, or whose encoding failed.
 * Sync skips already-indexed files, so without this they never get vectors.
 *
 * Runs newest first, in small batches with a pause between them. Only one
 * backfill runs at a time; a second call while one is running returns 0.
 */
export const backfillEmbeddings = async (
    cancelRef?: React.MutableRefObject<boolean>,
): Promise<number> => {
    if (backfillRunning) return 0;
    backfillRunning = true;
    let added = 0;
    let beforeId = Number.MAX_SAFE_INTEGER;
    let failuresBeforeFirstSuccess = 0;
    try {
        outer: while (!cancelRef?.current) {
            const batch = getImagesMissingEmbeddings(BACKFILL_BATCH_SIZE, beforeId);
            if (batch.length === 0) break;
            for (const row of batch) {
                if (cancelRef?.current) break;
                beforeId = row.id;
                const embedding = await encodeImage(row.filePath);
                if (embedding) {
                    indexEmbedding(row.id, embedding);
                    added++;
                } else if (added === 0 && ++failuresBeforeFirstSuccess >= BACKFILL_GIVE_UP_AFTER) {
                    AppLogger.warn('Backfill', 'Image encoder unavailable, skipping backfill for now.');
                    break outer;
                }
            }
            await sleep(BACKFILL_SLEEP_MS);
        }
        if (added > 0) AppLogger.info('Backfill', `Added embeddings to ${added} photos.`);
        return added;
    } catch (e) {
        AppLogger.warn('Backfill', 'Embedding backfill stopped early', e);
        return added;
    } finally {
        backfillRunning = false;
    }
};
