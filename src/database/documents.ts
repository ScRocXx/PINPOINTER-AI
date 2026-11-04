/**
 * Document CRUD: indexing, existence checks, counts, clearing, vault listing.
 */
import { maskSensitiveData } from '../utils/DataMasking';
import { AppLogger } from '../utils/AppLogger';
import { getDb, isFtsAvailable, isVecAvailable } from './connection';
import type { DocumentRecord } from './types';

/** A raw row as returned by op-sqlite query results. */
interface RawRow {
  id: number;
  title: string | null;
  content: string;
  filePath: string;
  type: string;
  detection_type: string;
  timestamp: number;
}

/**
 * Maps raw DB rows to DocumentRecord objects.
 * @internal Shared with search.ts; not part of the public barrel.
 */
export const processResults = (
  result: { rows?: Array<Record<string, unknown>> } | null | undefined
): DocumentRecord[] => {
  const rows = result?.rows ?? [];
  return rows.map((row) => {
    const r = row as unknown as RawRow;
    return {
      id: r.id,
      title: r.title,
      content: r.content,
      filePath: r.filePath,
      type: r.type,
      detection_type: r.detection_type,
      timestamp: r.timestamp,
    };
  }) as DocumentRecord[];
};

export const isFileIndexed = (path: string): boolean => {
  try {
    const db = getDb();
    const result = db.executeSync('SELECT id FROM document_index WHERE filePath = ? LIMIT 1', [path]);
    const rows = result?.rows || [];
    return rows.length > 0;
  } catch (e) {
    AppLogger.warn('DB', 'isFileIndexed check failed:', e);
    return false;
  }
};

export const indexDocument = (
  title: string | null = null,
  content: string,
  filePath: string,
  type: 'IMAGE' | 'DOCUMENT',
  detection_type: 'TEXT' | 'OBJECT'
): number | null => {
  // C2 fix: Mask PII (Aadhaar/PAN/phone) at the single chokepoint so no caller can bypass it
  content = maskSensitiveData(content ?? '');

  if (!content.trim() && !title?.trim()) {
    AppLogger.info('DB', 'Skipped empty indexing for:', filePath);
    return null;
  }

  try {
    const db = getDb();
    // Re-indexing gives the row a new id, so drop the old row's vector first;
    // otherwise it stays in vec_index as an orphan and takes up KNN slots.
    if (isVecAvailable()) {
      try {
        const existing = db.executeSync('SELECT id FROM document_index WHERE filePath = ? LIMIT 1', [filePath]);
        const oldId = (existing?.rows?.[0] as { id?: number } | undefined)?.id;
        if (oldId != null) db.executeSync('DELETE FROM vec_index WHERE document_id = ?', [oldId]);
      } catch (e) {
        AppLogger.warn('DB', 'Old vector cleanup failed:', e);
      }
    }
    // Always DELETE first to ensure FTS triggers fire correctly for updates
    db.executeSync('DELETE FROM document_index WHERE filePath = ?', [filePath]);
    db.executeSync(
      'INSERT INTO document_index (title, content, filePath, type, detection_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [title, content.trim(), filePath, type, detection_type, Date.now()]
    );
    const idResult = db.executeSync('SELECT last_insert_rowid() as id');
    const idRows = idResult?.rows || [];
    const insertedId = idRows.length > 0 ? (idRows[0] as { id: number }).id : null;
    AppLogger.info('DB', `Indexed ✅ [${type}] ${filePath} (id=${insertedId})`);
    return insertedId;
  } catch (e) {
    AppLogger.error('DB', 'Save Failed:', e);
    return null;
  }
};

/** Returns the total number of indexed documents */
export const getIndexedCount = (): number => {
  try {
    const db = getDb();
    const result = db.executeSync('SELECT COUNT(*) as cnt FROM document_index');
    const rows = result?.rows || [];
    return rows.length > 0 ? (rows[0] as { cnt: number }).cnt : 0;
  } catch (e) {
    AppLogger.warn('DB', 'Count Failed:', e);
    return 0;
  }
};

/** Clears all indexed documents — useful for a forced full re-index */
export const clearIndex = () => {
  try {
    const db = getDb();
    db.executeSync('DELETE FROM document_index');
    if (isFtsAvailable()) {
      try { db.executeSync('DELETE FROM fts_index'); } catch { }
    }
    if (isVecAvailable()) {
      try { db.executeSync('DELETE FROM vec_index'); } catch { }
    }
    AppLogger.info('DB', 'Index cleared');
  } catch (e) {
    AppLogger.error('DB', 'Clear Failed:', e);
  }
};

/** Returns all documents of type 'DOCUMENT' for the vault screen */
export const getAllDocuments = (): DocumentRecord[] => {
  try {
    const db = getDb();
    // NOTE: must be executeSync — the async execute() returns a Promise,
    // which processResults would read as "no rows" (empty vault on device).
    const result = db.executeSync(
      `SELECT id, title, content, filePath, type, detection_type, timestamp
       FROM document_index
       WHERE type = 'DOCUMENT'
       ORDER BY timestamp DESC`
    );
    return processResults(result);
  } catch (e) {
    AppLogger.warn('DB', 'getAllDocuments failed:', e);
    return [];
  }
};
