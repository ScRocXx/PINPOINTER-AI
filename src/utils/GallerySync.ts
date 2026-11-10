import { CameraRoll } from "@react-native-camera-roll/camera-roll";
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    indexDocument, beginTransaction, commitTransaction, rollbackTransaction, indexEmbedding,
    getImagesMissingEmbeddings, getDocumentId, noteFileSeen, markOcrDone, markEmbedDone, markStageFailed,
} from '../database';
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

// ─── Per-photo pipeline ─────────────────────────────────────────────────────

/** What happened to one photo during sync. */
export type PhotoOutcome = 'indexed' | 'embedded' | 'skipped' | 'failed';

type GalleryEdge = { node: { image: { uri: string }; modificationTimestamp?: number; timestamp?: number } };

/** The photo's modification time, used to notice edited photos. */
const mtimeOf = (edge: GalleryEdge): number | undefined => {
    const t = edge.node.modificationTimestamp ?? edge.node.timestamp;
    return typeof t === 'number' ? t : undefined;
};

/**
 * Set once any image encode succeeds this session. Until then a missing
 * embedding is blamed on the encoder (models missing, still loading), not the
 * photo, so it doesn't use up the photo's retry attempts.
 */
let encoderProven = false;

/** @internal Test helper. */
export const __resetEncoderProven = () => { encoderProven = false; };

/** Writes the vector and its state, or records why there isn't one. Sync DB work only. */
const recordEmbedding = (uri: string, docId: number, embedding: Float32Array | null | undefined): boolean => {
    if (embedding) {
        encoderProven = true;
        if (indexEmbedding(docId, embedding)) {
            markEmbedDone(uri);
            return true;
        }
        markStageFailed(uri, 'embed', 'vector write failed');
        return false;
    }
    if (encoderProven) markStageFailed(uri, 'embed', 'no embedding returned');
    return false;
};

/**
 * Runs whichever stages this photo still needs, according to its row in the
 * files table: full OCR + embedding for a new or changed photo, only the
 * embedding for a photo that has text but no vector, nothing for a finished
 * one. The ML work happens first; the DB writes then run in one short
 * transaction with no await inside, so other sync loops can't interleave.
 */
export const indexPhoto = async (uri: string, mtime?: number): Promise<PhotoOutcome> => {
    const work = noteFileSeen(uri, 'IMAGE', mtime);
    if (!work.ocr) {
        return work.embed ? embedPhoto(uri) : 'skipped';
    }

    let content: string;
    let detection: 'TEXT' | 'OBJECT';
    let embedding: Float32Array | null | undefined;
    try {
        const vision = await analyzeImage(uri);
        const rawText = vision.content ?? '';
        content = rawText.trim().length === 0 ? 'image' : await buildIndexableContent(rawText);
        detection = vision.detection_type as 'TEXT' | 'OBJECT';
        embedding = vision.embedding;
    } catch (e) {
        markStageFailed(uri, 'ocr', e);
        AppLogger.warn('GallerySync', `Failed to process ${uri}`, e);
        return 'failed';
    }

    beginTransaction();
    try {
        const docId = indexDocument(null, content || 'image', uri, 'IMAGE', detection);
        if (docId == null) throw new Error('indexDocument did not write a row');
        markOcrDone(uri);
        recordEmbedding(uri, docId, embedding);
        commitTransaction();
        return 'indexed';
    } catch (e) {
        rollbackTransaction();
        // Outside the rolled-back transaction, so the failure is remembered.
        markStageFailed(uri, 'ocr', e);
        AppLogger.warn('GallerySync', `Failed to save ${uri}`, e);
        return 'failed';
    }
};

/** Embedding only, for a photo whose text is already indexed. */
const embedPhoto = async (uri: string, knownDocId?: number): Promise<PhotoOutcome> => {
    const docId = knownDocId ?? getDocumentId(uri);
    if (docId == null) {
        // The text row is gone (e.g. cleared): start the photo over next time.
        markStageFailed(uri, 'ocr', 'indexed row missing');
        return 'failed';
    }
    const embedding = await encodeImage(uri);
    return recordEmbedding(uri, docId, embedding) ? 'embedded' : 'failed';
};

/** Maximum photos the gallery sync will process (-1 = stub, not yet implemented). */
export const getGallerySyncLimit = async (): Promise<number> => -1;
/**
 * How many photos Pinpointer can see, for "120 of 2,400" progress. Android
 * groups every photo into one album (its folder), so the album counts add up
 * to the whole gallery; with "Select photos" access only the picked ones are
 * counted. -1 when the count can't be read.
 */
export const getGalleryTotalCount = async (): Promise<number> => {
    try {
        const albums = await CameraRoll.getAlbums({ assetType: 'Photos' });
        return (albums ?? []).reduce((sum, album) => sum + (Number.isFinite(album?.count) ? album.count : 0), 0);
    } catch (e) {
        AppLogger.warn('GallerySync', 'Could not count photos', e);
        return -1;
    }
};

/**
 * QUICK SYNC — Lazy Approach.
 * Processes the most recent 50 photos while holding the UI.
 * Then silently spins off a background task to process the remaining 250 photos.
 */
export const performQuickSync = async (
    onProgress: (count: number) => void,
    cancelRef?: React.MutableRefObject<boolean>,
    options: { background?: boolean } = {},
): Promise<{ processed: number; wasCancelled: boolean; nextCursor?: string }> => {
    const { background = true } = options;
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

            await indexPhoto(edge.node.image.uri, mtimeOf(edge));

            totalProcessed++;
            onProgress(totalProcessed);
        }

        hasNextPage = pageResult.page_info.has_next_page;
        after = pageResult.page_info.end_cursor;
    }

    // Phase 2: Silent background processing of the next SILENT_BACKGROUND_LIMIT photos.
    // IndexingService passes background: false and queues this itself, so it
    // never runs alongside another sync loop.
    const nextCursor = hasNextPage && !cancelRef?.current ? after : undefined;
    if (background && nextCursor) {
        // Fire and forget (do not await)
        performQuickSyncBackground(nextCursor, cancelRef).catch((e) =>
            AppLogger.warn('QuickSync', 'Background pass failed', e));
    }

    // Return immediately to release the UI
    return { processed: totalProcessed, wasCancelled: false, nextCursor };
};

/**
 * The silent second half of quick sync: up to SILENT_BACKGROUND_LIMIT more
 * photos after `after`, in small batches with a pause between them. No
 * progress is reported, so the UI ignores it.
 */
export const performQuickSyncBackground = async (
    after: string | undefined,
    cancelRef?: React.MutableRefObject<boolean>,
): Promise<number> => {
    let hasNextPage = true;
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
            await indexPhoto(edge.node.image.uri, mtimeOf(edge));
            bgProcessed++;
        }

        hasNextPage = bgPageResult.page_info.has_next_page;
        after = bgPageResult.page_info.end_cursor;
        await sleep(500); // 500ms sleep between bg batches to keep UI fully responsive
    }
    AppLogger.info('QuickSync', `Finished silent background sync of ${bgProcessed} photos.`);
    return bgProcessed;
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
                await indexPhoto(uri, mtimeOf(edge));

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
 * Adds CLIP embeddings to photos that are already indexed but need one:
 * photos synced before semantic search worked, whose encoding failed fewer
 * than MAX_ATTEMPTS times, or whose vector is from an older model. Sync does
 * the same for photos it walks past; this covers the ones quick sync never
 * reaches.
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
                const outcome = await embedPhoto(row.filePath, row.id);
                if (outcome === 'embedded') {
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
