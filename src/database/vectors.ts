/**
 * sqlite-vec embedding storage: per-document 512-dim vectors.
 */
import { getDb, isVecAvailable } from './connection';
import { AppLogger } from '../utils/AppLogger';
import { CURRENT_EMBED_MODEL, MAX_ATTEMPTS } from './fileState';

// ─── Which photos count as "looks like the query" ──────────────────────────
// vec_index uses L2 distance on unit vectors, so distance = sqrt(2 - 2·cosine).
//
// One fixed limit can't do this job. Measured with the app's INT8 MobileCLIP2
// models on 1,000 everyday photos plus 300 screenshots:
//   - nonsense ("hzjsbsjd") sits close to every photo (average distance
//     ~1.27), so a limit of 1.26 let a median of 150 photos through;
//   - real words sit further from everything (average ~1.33-1.40), so the
//     same limit rejected every match for "food" and "glasses".
// What separates a match is how far it stands out from the photos that
// clearly don't match THIS query. The yardstick is the query's distance to
// the 90th-percentile photo (a far one, but not an outlier); a photo counts
// only if it is STAND_OUT_GAP closer than that. On the sample this showed a
// photo for 3 of 200 nonsense strings (one photo each) and kept precision
// and recall for real words at or above the old limit. A percentile, not the
// average, so a gallery where most photos match (say, mostly family photos)
// still finds them.
// Tune STAND_OUT_GAP on a phone: larger = stricter, fewer look-alikes.
export const FAR_PERCENTILE = 0.9;
export const STAND_OUT_GAP = 0.12;

/** Below this many photos a percentile means little; use the fixed limit. */
export const MIN_PHOTOS_FOR_STAND_OUT = 20;

/**
 * The fixed limit (cosine ≳ 0.21), used only for very small galleries or
 * when the far photo can't be read.
 */
export const MAX_VECTOR_DISTANCE = 1.26;

/** The furthest a photo may be from the query and still count as a look-alike. */
export const standOutLimit = (farDistance: number): number => farDistance - STAND_OUT_GAP;

/** A photo whose picture is close to a query. */
export interface LookAlike {
  documentId: number;
  distance: number;
}

const lookAlikeLimit = (blob: Uint8Array): number => {
  const count = getEmbeddingCount();
  if (count < MIN_PHOTOS_FOR_STAND_OUT) return MAX_VECTOR_DISTANCE;
  try {
    const result = getDb().executeSync(
      `SELECT vec_distance_l2(embedding, vec_f32(?)) AS distance
       FROM vec_index ORDER BY distance LIMIT 1 OFFSET ?`,
      [blob, Math.floor((count - 1) * FAR_PERCENTILE)],
    );
    const far = Number((result?.rows?.[0] as { distance?: number } | undefined)?.distance);
    if (Number.isFinite(far) && far > 0) return standOutLimit(far);
  } catch (e) {
    AppLogger.warn('DB', 'Could not read the far photo distance, using the fixed limit:', e);
  }
  return MAX_VECTOR_DISTANCE;
};

/**
 * The photos that look like `queryVector`, closest first, at most `limit`.
 * Only photos that stand out for this query are returned (see above), so a
 * query nothing matches returns an empty list instead of the nearest photos.
 */
export const findLookAlikes = (queryVector: Float32Array, limit = 50): LookAlike[] => {
  if (!isVecAvailable()) return [];
  try {
    const blob = new Uint8Array(queryVector.buffer, queryVector.byteOffset, queryVector.byteLength);
    const maxDistance = lookAlikeLimit(blob);
    const result = getDb().executeSync(
      `SELECT document_id, distance FROM vec_index
       WHERE embedding MATCH vec_f32(?) AND k = ?
       ORDER BY distance`,
      [blob, Math.max(1, Math.floor(limit))],
    );
    const rows = (result?.rows ?? []) as unknown as Array<{ document_id: number; distance: number }>;
    return rows
      .filter(r => r.distance <= maxDistance)
      .map(r => ({ documentId: r.document_id, distance: r.distance }));
  } catch (e) {
    AppLogger.warn('DB', 'findLookAlikes failed:', e);
    return [];
  }
};

/** Store a 512-dim float32 embedding vector for a document. Returns false when it wasn't stored. */
export const indexEmbedding = (documentId: number, embedding: Float32Array): boolean => {
  if (!isVecAvailable()) return false;
  try {
    const db = getDb();
    db.executeSync('DELETE FROM vec_index WHERE document_id = ?', [documentId]);
    db.executeSync(
      'INSERT INTO vec_index (document_id, embedding) VALUES (?, vec_f32(?))',
      [documentId, new Uint8Array(embedding.buffer)]
    );
    AppLogger.info('DB', `Vector indexed ✅ doc_id=${documentId}`);
    return true;
  } catch (e) {
    AppLogger.warn('DB', 'Vector index failed:', e);
    return false;
  }
};

/** Check if a document has an embedding stored */
export const hasEmbedding = (documentId: number): boolean => {
  if (!isVecAvailable()) return false;
  try {
    const db = getDb();
    const result = db.executeSync(
      'SELECT document_id FROM vec_index WHERE document_id = ? LIMIT 1',
      [documentId]
    );
    const rows = result?.rows || [];
    return rows.length > 0;
  } catch {
    return false;
  }
};

/** Get embedding count for stats */
export const getEmbeddingCount = (): number => {
  if (!isVecAvailable()) return 0;
  try {
    const db = getDb();
    const result = db.executeSync('SELECT COUNT(*) as cnt FROM vec_index');
    const rows = result?.rows || [];
    return rows.length > 0 ? (rows[0] as { cnt: number }).cnt : 0;
  } catch {
    return 0;
  }
};

/** An indexed image that has no embedding yet. */
export interface MissingEmbedding {
  id: number;
  filePath: string;
}

/**
 * Image rows that still need a vector: photos indexed before CLIP worked,
 * whose encoding failed fewer than MAX_ATTEMPTS times, or whose vector came
 * from an older model. Rows with no `files` state (indexed outside sync) count
 * when they have no vector. Used by the embedding backfill.
 * Newest first; pass the last id seen as `beforeId` to page past rows that
 * failed to encode, so the backfill never loops on them.
 */
export const getImagesMissingEmbeddings = (limit = 50, beforeId = Number.MAX_SAFE_INTEGER): MissingEmbedding[] => {
  if (!isVecAvailable()) return [];
  try {
    const db = getDb();
    const result = db.executeSync(
      `SELECT d.id AS id, d.filePath AS filePath FROM document_index d
       LEFT JOIN files f ON f.uri = d.filePath
       WHERE d.type = 'IMAGE' AND d.id < ?
         AND ((f.uri IS NULL AND d.id NOT IN (SELECT document_id FROM vec_index))
           OR (f.ocr_status = 'done' AND (f.embed_status = 'pending'
             OR (f.embed_status = 'failed' AND f.attempts < ?)
             OR (f.embed_status = 'done' AND (f.embed_model IS NULL OR f.embed_model != ?)))))
       ORDER BY d.id DESC
       LIMIT ?`,
      [beforeId, MAX_ATTEMPTS, CURRENT_EMBED_MODEL, limit]
    );
    const rows = (result?.rows || []) as unknown as MissingEmbedding[];
    return rows.map(r => ({ id: r.id, filePath: r.filePath }));
  } catch (e) {
    AppLogger.warn('DB', 'getImagesMissingEmbeddings failed:', e);
    return [];
  }
};
