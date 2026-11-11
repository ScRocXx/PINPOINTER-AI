/**
 * Read-only queries behind Home: how many files each "Find quickly"
 * collection holds, a few of its newest photos, and photos that look like a
 * CLIP query (for collections without words, like Family).
 *
 * Every query is bounded, reads only paths/types/timestamps (never content)
 * and returns an empty result on any error, so Home can't break on a bad DB.
 */
import { AppLogger } from '../utils/AppLogger';
import type { Collection } from '../utils/Collections';
import { collectionTerms } from './collectionTerms';
import { getDb, isFtsAvailable, isVecAvailable } from './connection';
import { MAX_VECTOR_DISTANCE } from './search';

/** Collections are counted up to this many files; more shows as "999+". */
export const COLLECTION_COUNT_CAP = 999;

export interface CollectionPreview {
  /** Distinct files (photos and papers) in the collection, up to the cap. */
  count: number;
  /** True when there may be more than `count`. */
  capped: boolean;
  /** Newest photos first, at most `photoLimit`. */
  photos: string[];
}

const EMPTY: CollectionPreview = { count: 0, capped: false, photos: [] };

interface PreviewRow {
  filePath: string;
  type: string;
  timestamp: number | null;
}

/**
 * Count the files in `collection` and pick its newest photos. Uses the same
 * terms as a search for the collection's name, so a tile's count matches
 * what that search finds by words.
 */
export const getCollectionPreview = (collection: Collection, photoLimit = 3): CollectionPreview => {
  const terms = collectionTerms(collection);
  if (!terms) return EMPTY;
  // One row more than the cap tells us whether there are more. Newest index
  // rows first, so a collection over the cap still shows recent photos.
  const limit = COLLECTION_COUNT_CAP + 1;
  try {
    const db = getDb();
    const result = isFtsAvailable()
      ? db.executeSync(
          `SELECT d.filePath, d.type, d.timestamp
           FROM fts_index f
           JOIN document_index d ON d.id = f.rowid
           WHERE f.fts_index MATCH ?
           ORDER BY f.rowid DESC
           LIMIT ${limit}`,
          [terms.fts],
        )
      : db.executeSync(
          `SELECT filePath, type, timestamp FROM document_index
           WHERE ${terms.like.map(() => 'content LIKE ? COLLATE NOCASE').join(' OR ')}
           ORDER BY id DESC
           LIMIT ${limit}`,
          terms.like,
        );
    const rows = (result?.rows ?? []) as unknown as PreviewRow[];

    const seen = new Set<string>();
    const photos: PreviewRow[] = [];
    for (const row of rows) {
      if (!row?.filePath || seen.has(row.filePath)) continue;
      seen.add(row.filePath);
      if (row.type === 'IMAGE') photos.push(row);
    }
    photos.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    const capped = seen.size > COLLECTION_COUNT_CAP;
    return {
      count: Math.min(seen.size, COLLECTION_COUNT_CAP),
      capped,
      photos: photos.slice(0, photoLimit).map(p => p.filePath),
    };
  } catch (e) {
    AppLogger.warn('DB', 'getCollectionPreview failed:', e);
    return EMPTY;
  }
};

/**
 * Photos whose CLIP vector is close to `queryVector`, closest first. Empty
 * when the vector index isn't available. Same cutoff as search.
 */
export const getSimilarPhotos = (queryVector: Float32Array, limit = 12): string[] => {
  if (!isVecAvailable()) return [];
  try {
    const blob = new Uint8Array(queryVector.buffer);
    const result = getDb().executeSync(
      `WITH knn AS (
         SELECT document_id, distance FROM vec_index
         WHERE embedding MATCH vec_f32(?) AND k = ?
       )
       SELECT d.filePath
       FROM knn JOIN document_index d ON d.id = knn.document_id
       WHERE knn.distance <= ? AND d.type = 'IMAGE'
       ORDER BY knn.distance ASC`,
      [blob, Math.max(1, Math.floor(limit)), MAX_VECTOR_DISTANCE],
    );
    const rows = (result?.rows ?? []) as unknown as Array<{ filePath?: string }>;
    return [...new Set(rows.map(r => r.filePath).filter((p): p is string => !!p))];
  } catch (e) {
    AppLogger.warn('DB', 'getSimilarPhotos failed:', e);
    return [];
  }
};
