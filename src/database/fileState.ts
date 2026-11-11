/**
 * Per-file indexing state: one row in `files` per photo or PDF, recording
 * how far that file has got through the pipeline.
 *
 * Two stages are tracked separately:
 *   - ocr   — text extracted and the row written to document_index
 *   - embed — CLIP vector written to vec_index (photos only)
 *
 * Sync asks `noteFileSeen()` which stages a file still needs, so a photo
 * whose OCR worked but whose embedding failed gets only the embedding redone,
 * a file that keeps failing stops being retried after MAX_ATTEMPTS, and a new
 * embedding model re-encodes old vectors without a full wipe.
 *
 * About 100 bytes per file; every write is a single INSERT OR REPLACE.
 */
import { AppLogger } from '../utils/AppLogger';
import { getDb, isVecAvailable } from './connection';

/** Bump when the image encoder changes, so old vectors get re-encoded. */
export const CURRENT_EMBED_MODEL = 'mobileclip2-s0';

/** A file that failed this many times is left alone until it changes on disk. */
export const MAX_ATTEMPTS = 3;

export type FileKind = 'IMAGE' | 'DOCUMENT';
export type StageStatus = 'pending' | 'done' | 'failed' | 'skipped';
export type Stage = 'ocr' | 'embed';

/** One row of the `files` table. */
export interface FileState {
  uri: string;
  kind: FileKind;
  mtime: number | null;
  ocr_status: StageStatus;
  embed_status: StageStatus;
  embed_model: string | null;
  attempts: number;
  last_error: string | null;
}

/** Which stages a file still needs. */
export interface PendingWork {
  ocr: boolean;
  embed: boolean;
}

/** Counts for a progress or health display. */
export interface IndexingStats {
  total: number;
  ocrDone: number;
  ocrFailed: number;
  embedDone: number;
  embedPending: number;
  embedFailed: number;
}

const COLUMNS = 'uri, kind, mtime, ocr_status, embed_status, embed_model, attempts, last_error, updated_at';
const SELECT_ONE = `SELECT ${COLUMNS} FROM files WHERE uri = ?`;
const UPSERT = `INSERT OR REPLACE INTO files (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const INSERT_IF_MISSING = `INSERT OR IGNORE INTO files (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const MAX_ERROR_LENGTH = 200;

const errorText = (error: unknown): string => {
  const text = error instanceof Error ? error.message : String(error ?? 'unknown error');
  return text.slice(0, MAX_ERROR_LENGTH);
};

const write = (state: FileState, sql = UPSERT) => {
  getDb().executeSync(sql, [
    state.uri,
    state.kind,
    state.mtime,
    state.ocr_status,
    state.embed_status,
    state.embed_model,
    state.attempts,
    state.last_error,
    Date.now(),
  ]);
};

const freshState = (uri: string, kind: FileKind, mtime: number | null): FileState => ({
  uri,
  kind,
  mtime,
  ocr_status: 'pending',
  embed_status: kind === 'IMAGE' ? 'pending' : 'skipped',
  embed_model: null,
  attempts: 0,
  last_error: null,
});

const retryable = (status: StageStatus, attempts: number): boolean =>
  status === 'pending' || (status === 'failed' && attempts < MAX_ATTEMPTS);

/** Which stages `state` still needs. Pure; exported for tests. */
export const pendingWork = (state: FileState): PendingWork => {
  const ocr = retryable(state.ocr_status, state.attempts);
  const embed =
    state.kind === 'IMAGE' &&
    state.ocr_status === 'done' &&
    (retryable(state.embed_status, state.attempts) ||
      (state.embed_status === 'done' && state.embed_model !== CURRENT_EMBED_MODEL));
  return { ocr, embed };
};

/** Reads one file's state, or null when sync has never seen it. */
export const getFileState = (uri: string): FileState | null => {
  try {
    const row = getDb().executeSync(SELECT_ONE, [uri])?.rows?.[0];
    return row ? (row as unknown as FileState) : null;
  } catch (e) {
    AppLogger.warn('DB', 'getFileState failed:', e);
    return null;
  }
};

/**
 * A file indexed outside sync (a one-off scan, or before this table existed)
 * already has its text row: keep it instead of OCRing the file again.
 */
const adoptIndexedRow = (uri: string, kind: FileKind, mtime: number | null): FileState | null => {
  const db = getDb();
  const doc = db.executeSync('SELECT id FROM document_index WHERE filePath = ? LIMIT 1', [uri])?.rows?.[0] as
    | { id?: number }
    | undefined;
  if (doc?.id == null) return null;
  let embedded = false;
  if (kind === 'IMAGE' && isVecAvailable()) {
    try {
      embedded = (db.executeSync('SELECT document_id FROM vec_index WHERE document_id = ? LIMIT 1', [doc.id])?.rows ?? []).length > 0;
    } catch {
      embedded = false;
    }
  }
  return {
    ...freshState(uri, kind, mtime),
    ocr_status: 'done',
    embed_status: kind === 'DOCUMENT' ? 'skipped' : embedded ? 'done' : 'pending',
    embed_model: embedded ? CURRENT_EMBED_MODEL : null,
  };
};

/**
 * Records that sync found `uri` and returns which stages it still needs.
 * A new file starts with every stage pending. A file whose modification time
 * changed since it was indexed starts over. Already-known, unchanged files
 * cost one read and no write.
 */
export const noteFileSeen = (uri: string, kind: FileKind, mtime?: number | null): PendingWork => {
  const seenMtime = typeof mtime === 'number' && Number.isFinite(mtime) ? mtime : null;
  try {
    const existing = getFileState(uri);
    if (!existing) {
      const state = adoptIndexedRow(uri, kind, seenMtime) ?? freshState(uri, kind, seenMtime);
      write(state);
      return pendingWork(state);
    }
    if (seenMtime !== null && existing.mtime !== null && existing.mtime !== seenMtime) {
      const state = freshState(uri, kind, seenMtime);
      write(state);
      return pendingWork(state);
    }
    if (seenMtime !== null && existing.mtime === null) {
      write({ ...existing, mtime: seenMtime });
    }
    return pendingWork(existing);
  } catch (e) {
    AppLogger.warn('DB', 'noteFileSeen failed:', e);
    // Can't read state: fall back to "do the work", the old behaviour for unknown files.
    return { ocr: true, embed: kind === 'IMAGE' };
  }
};

const update = (uri: string, change: (s: FileState) => FileState, kind: FileKind = 'IMAGE') => {
  try {
    const current = getFileState(uri) ?? freshState(uri, kind, null);
    write(change(current));
  } catch (e) {
    AppLogger.warn('DB', 'File state update failed:', e);
  }
};

/** OCR finished and the document_index row is written. */
export const markOcrDone = (uri: string, kind: FileKind = 'IMAGE') =>
  update(uri, (s) => ({ ...s, ocr_status: 'done', attempts: 0, last_error: null }), kind);

/** The vector is written to vec_index by `model`. */
export const markEmbedDone = (uri: string, model: string = CURRENT_EMBED_MODEL) =>
  update(uri, (s) => ({ ...s, embed_status: 'done', embed_model: model, attempts: 0, last_error: null }));

/** This file will never get an embedding (PDFs, or semantic search turned off). */
export const markEmbedSkipped = (uri: string, kind: FileKind = 'IMAGE') =>
  update(uri, (s) => ({ ...s, embed_status: 'skipped' }), kind);

/** A stage failed for this file. After MAX_ATTEMPTS failures it is no longer retried. */
export const markStageFailed = (uri: string, stage: Stage, error: unknown, kind: FileKind = 'IMAGE') =>
  update(
    uri,
    (s) => ({
      ...s,
      ...(stage === 'ocr' ? { ocr_status: 'failed' as const } : { embed_status: 'failed' as const }),
      attempts: s.attempts + 1,
      last_error: errorText(error),
    }),
    kind,
  );

/** Counts by stage, for showing progress and spotting broken models. */
export const getIndexingStats = (): IndexingStats => {
  const stats: IndexingStats = { total: 0, ocrDone: 0, ocrFailed: 0, embedDone: 0, embedPending: 0, embedFailed: 0 };
  try {
    const rows = getDb().executeSync(
      'SELECT ocr_status, embed_status, COUNT(*) AS cnt FROM files GROUP BY ocr_status, embed_status',
    )?.rows ?? [];
    for (const raw of rows) {
      const r = raw as unknown as { ocr_status: StageStatus; embed_status: StageStatus; cnt: number };
      stats.total += r.cnt;
      if (r.ocr_status === 'done') stats.ocrDone += r.cnt;
      if (r.ocr_status === 'failed') stats.ocrFailed += r.cnt;
      if (r.embed_status === 'done') stats.embedDone += r.cnt;
      if (r.embed_status === 'pending') stats.embedPending += r.cnt;
      if (r.embed_status === 'failed') stats.embedFailed += r.cnt;
    }
  } catch (e) {
    AppLogger.warn('DB', 'getIndexingStats failed:', e);
  }
  return stats;
};

/** How many photos and papers have been looked at (read, or given up on). */
export interface ReadyCounts {
  photos: number;
  papers: number;
}

/**
 * Files whose text step is finished, per kind: done, skipped, or failed.
 * A failed file still counts, so progress reaches the end even when a few
 * photos can't be read. Cheap enough to call while a sync runs.
 */
export const getReadyCounts = (): ReadyCounts => {
  const counts: ReadyCounts = { photos: 0, papers: 0 };
  try {
    const rows = getDb().executeSync(
      'SELECT kind, ocr_status, COUNT(*) AS cnt FROM files GROUP BY kind, ocr_status',
    )?.rows ?? [];
    for (const raw of rows) {
      const r = raw as unknown as { kind: FileKind; ocr_status: StageStatus; cnt: number };
      if (r.ocr_status === 'pending') continue;
      if (r.kind === 'IMAGE') counts.photos += r.cnt;
      else if (r.kind === 'DOCUMENT') counts.papers += r.cnt;
    }
  } catch (e) {
    AppLogger.warn('DB', 'getReadyCounts failed:', e);
  }
  return counts;
};

/**
 * How many photos (or papers) indexing has looked at: done, skipped, or
 * given up on after MAX_ATTEMPTS. With the phone's photo total this gives
 * Home's "1,240 of 2,400" without counting a failure as still to do.
 */
export const countCheckedFiles = (kind: FileKind): number => {
  try {
    const row = getDb().executeSync(
      "SELECT COUNT(*) AS cnt FROM files WHERE kind = ? AND ocr_status != 'pending'",
      [kind],
    )?.rows?.[0] as { cnt?: number } | undefined;
    return typeof row?.cnt === 'number' ? row.cnt : 0;
  } catch (e) {
    AppLogger.warn('DB', 'countCheckedFiles failed:', e);
    return 0;
  }
};

/**
 * Migration helper: gives every already-indexed file a state row, so an
 * upgrade doesn't re-OCR the whole gallery. Photos with a vector count as
 * embedded with the current model; photos without one get it backfilled.
 * @internal Called from connection.ts migrations.
 */
export const seedFileStateFromIndex = (vecAvailable: boolean) => {
  const db = getDb();
  const docs = (db.executeSync('SELECT id, filePath, type FROM document_index')?.rows ?? []) as unknown as Array<{
    id: number;
    filePath: string;
    type: string;
  }>;
  if (docs.length === 0) return;
  const withVector = new Set<number>();
  if (vecAvailable) {
    const vecRows = (db.executeSync('SELECT document_id FROM vec_index')?.rows ?? []) as unknown as Array<{
      document_id: number;
    }>;
    vecRows.forEach((r) => withVector.add(r.document_id));
  }
  for (const doc of docs) {
    if (!doc.filePath) continue;
    const kind: FileKind = doc.type === 'DOCUMENT' ? 'DOCUMENT' : 'IMAGE';
    const embedded = withVector.has(doc.id);
    write(
      {
        uri: doc.filePath,
        kind,
        mtime: null,
        ocr_status: 'done',
        embed_status: kind === 'DOCUMENT' ? 'skipped' : embedded ? 'done' : 'pending',
        embed_model: embedded ? CURRENT_EMBED_MODEL : null,
        attempts: 0,
        last_error: null,
      },
      INSERT_IF_MISSING,
    );
  }
  AppLogger.info('DB', `Seeded indexing state for ${docs.length} files`);
};
