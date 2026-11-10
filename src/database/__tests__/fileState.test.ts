/**
 * Tests for src/database/fileState.ts — per-file, per-stage indexing state —
 * and the versioned migration that creates and seeds the `files` table.
 *
 * Runs the real modules against the in-memory op-sqlite mock, which models
 * the files table, PRAGMA user_version and the backfill query.
 */
import {
  CURRENT_EMBED_MODEL,
  MAX_ATTEMPTS,
  getFileState,
  getIndexingStats,
  getReadyCounts,
  markEmbedDone,
  markEmbedSkipped,
  markOcrDone,
  markStageFailed,
  noteFileSeen,
  pendingWork,
  type FileState,
} from '../fileState';
import { clearIndex, indexDocument } from '../documents';
import { getImagesMissingEmbeddings, indexEmbedding } from '../vectors';
import { SCHEMA_VERSION, getDb, getSchemaVersion, setupDatabase } from '../connection';

type MockDb = { __reset: () => void; files: Map<string, FileState>; userVersion: number };
const mockDb = (): MockDb => getDb() as unknown as MockDb;

const vec = () => new Float32Array(512).fill(0.5);
const URI = 'file:///gallery/a.jpg';

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockDb().__reset();
  setupDatabase();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('migrations', () => {
  test('a fresh database ends at the current schema version', () => {
    expect(getSchemaVersion()).toBe(SCHEMA_VERSION);
  });

  test('upgrading seeds state for already-indexed files instead of redoing them', () => {
    mockDb().__reset(); // an old database: rows but no files table, user_version 0
    const withVec = indexDocument(null, 'bill text', 'file:///p1.jpg', 'IMAGE', 'TEXT')!;
    indexDocument(null, 'image', 'file:///p2.jpg', 'IMAGE', 'OBJECT');
    indexDocument('Bill', 'pdf text', 'file:///d1.pdf', 'DOCUMENT', 'TEXT');
    indexEmbedding(withVec, vec());

    setupDatabase();

    expect(getSchemaVersion()).toBe(SCHEMA_VERSION);
    expect(getFileState('file:///p1.jpg')).toMatchObject({
      ocr_status: 'done', embed_status: 'done', embed_model: CURRENT_EMBED_MODEL,
    });
    expect(getFileState('file:///p2.jpg')).toMatchObject({ ocr_status: 'done', embed_status: 'pending' });
    expect(getFileState('file:///d1.pdf')).toMatchObject({ kind: 'DOCUMENT', ocr_status: 'done', embed_status: 'skipped' });
  });

  test('runs each migration once: a second setup does not overwrite state', () => {
    noteFileSeen(URI, 'IMAGE');
    markStageFailed(URI, 'ocr', 'boom');

    setupDatabase();

    expect(getFileState(URI)).toMatchObject({ ocr_status: 'failed', attempts: 1 });
  });
});

describe('noteFileSeen', () => {
  test('a new photo needs OCR and, after that, an embedding', () => {
    expect(noteFileSeen(URI, 'IMAGE', 100)).toEqual({ ocr: true, embed: false });
    expect(getFileState(URI)).toMatchObject({ kind: 'IMAGE', mtime: 100, ocr_status: 'pending', embed_status: 'pending', attempts: 0 });

    markOcrDone(URI);
    expect(noteFileSeen(URI, 'IMAGE', 100)).toEqual({ ocr: false, embed: true });

    markEmbedDone(URI);
    expect(noteFileSeen(URI, 'IMAGE', 100)).toEqual({ ocr: false, embed: false });
  });

  test('a new PDF needs OCR and never an embedding', () => {
    expect(noteFileSeen('file:///d.pdf', 'DOCUMENT')).toEqual({ ocr: true, embed: false });
    markOcrDone('file:///d.pdf', 'DOCUMENT');
    expect(noteFileSeen('file:///d.pdf', 'DOCUMENT')).toEqual({ ocr: false, embed: false });
    expect(getFileState('file:///d.pdf')?.embed_status).toBe('skipped');
  });

  test('a file indexed outside sync is adopted instead of OCRed again', () => {
    const id = indexDocument(null, 'scanned', URI, 'IMAGE', 'TEXT')!;
    mockDb().files.clear();

    expect(noteFileSeen(URI, 'IMAGE')).toEqual({ ocr: false, embed: true });

    mockDb().files.clear();
    indexEmbedding(id, vec());
    expect(noteFileSeen(URI, 'IMAGE')).toEqual({ ocr: false, embed: false });
  });

  test('an edited file (new modification time) starts over', () => {
    noteFileSeen(URI, 'IMAGE', 100);
    markOcrDone(URI);
    markEmbedDone(URI);

    expect(noteFileSeen(URI, 'IMAGE', 200)).toEqual({ ocr: true, embed: false });
    expect(getFileState(URI)).toMatchObject({ mtime: 200, ocr_status: 'pending', embed_status: 'pending' });
  });

  test('fills in a missing modification time without redoing the file', () => {
    noteFileSeen(URI, 'IMAGE');
    markOcrDone(URI);
    markEmbedDone(URI);

    expect(noteFileSeen(URI, 'IMAGE', 300)).toEqual({ ocr: false, embed: false });
    expect(getFileState(URI)?.mtime).toBe(300);
  });

  test('an unchanged, finished file costs no write', () => {
    noteFileSeen(URI, 'IMAGE', 100);
    markOcrDone(URI);
    markEmbedDone(URI);
    const exec = jest.spyOn(getDb(), 'executeSync');

    noteFileSeen(URI, 'IMAGE', 100);

    expect(exec.mock.calls.some(([sql]) => /INSERT/i.test(String(sql)))).toBe(false);
  });

  test('falls back to "do the work" when state cannot be read', () => {
    jest.spyOn(getDb(), 'executeSync').mockImplementation(() => {
      throw new Error('db locked');
    });
    expect(noteFileSeen(URI, 'IMAGE')).toEqual({ ocr: true, embed: true });
    expect(noteFileSeen('file:///d.pdf', 'DOCUMENT')).toEqual({ ocr: true, embed: false });
  });
});

describe('retries and model upgrades', () => {
  test(`a failing file is retried until MAX_ATTEMPTS (${MAX_ATTEMPTS}) failures, then left alone`, () => {
    noteFileSeen(URI, 'IMAGE', 100);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      markStageFailed(URI, 'ocr', new Error(`fail ${i}`));
      expect(noteFileSeen(URI, 'IMAGE', 100).ocr).toBe(true);
    }
    markStageFailed(URI, 'ocr', new Error('last'));
    expect(noteFileSeen(URI, 'IMAGE', 100)).toEqual({ ocr: false, embed: false });
    expect(getFileState(URI)).toMatchObject({ attempts: MAX_ATTEMPTS, last_error: 'last' });
  });

  test('a capped file is tried again once it changes on disk', () => {
    noteFileSeen(URI, 'IMAGE', 100);
    for (let i = 0; i < MAX_ATTEMPTS; i++) markStageFailed(URI, 'ocr', 'x');
    expect(noteFileSeen(URI, 'IMAGE', 101).ocr).toBe(true);
  });

  test('success resets the attempt count', () => {
    noteFileSeen(URI, 'IMAGE');
    markStageFailed(URI, 'ocr', 'x');
    markOcrDone(URI);
    expect(getFileState(URI)).toMatchObject({ attempts: 0, last_error: null });
  });

  test('long error messages are trimmed', () => {
    noteFileSeen(URI, 'IMAGE');
    markStageFailed(URI, 'embed', 'e'.repeat(1000));
    expect(getFileState(URI)?.last_error).toHaveLength(200);
  });

  test('a vector from an older model needs re-encoding', () => {
    noteFileSeen(URI, 'IMAGE');
    markOcrDone(URI);
    markEmbedDone(URI, 'old-model');
    expect(noteFileSeen(URI, 'IMAGE')).toEqual({ ocr: false, embed: true });
  });

  test('skipped embeddings are never pending', () => {
    noteFileSeen(URI, 'IMAGE');
    markOcrDone(URI);
    markEmbedSkipped(URI);
    expect(noteFileSeen(URI, 'IMAGE')).toEqual({ ocr: false, embed: false });
  });

  test('pendingWork: embedding waits for OCR', () => {
    const base: FileState = {
      uri: URI, kind: 'IMAGE', mtime: null, ocr_status: 'failed', embed_status: 'pending',
      embed_model: null, attempts: 1, last_error: 'x',
    };
    expect(pendingWork(base)).toEqual({ ocr: true, embed: false });
  });
});

describe('getImagesMissingEmbeddings with file state', () => {
  const indexPhoto = (uri: string) => {
    noteFileSeen(uri, 'IMAGE');
    const id = indexDocument(null, 'text', uri, 'IMAGE', 'TEXT')!;
    markOcrDone(uri);
    return id;
  };

  test('returns photos whose embedding is pending, retryable, or from an old model', () => {
    const pending = indexPhoto('file:///pending.jpg');
    const retry = indexPhoto('file:///retry.jpg');
    markStageFailed('file:///retry.jpg', 'embed', 'x');
    const capped = indexPhoto('file:///capped.jpg');
    for (let i = 0; i < MAX_ATTEMPTS; i++) markStageFailed('file:///capped.jpg', 'embed', 'x');
    const old = indexPhoto('file:///old.jpg');
    indexEmbedding(old, vec());
    markEmbedDone('file:///old.jpg', 'old-model');
    const done = indexPhoto('file:///done.jpg');
    indexEmbedding(done, vec());
    markEmbedDone('file:///done.jpg');

    const ids = getImagesMissingEmbeddings(50).map((r) => r.id);

    expect(ids).toEqual([old, retry, pending]);
    expect(ids).not.toContain(capped);
    expect(ids).not.toContain(done);
  });

  test('still finds photos with no state row and no vector', () => {
    const id = indexDocument(null, 'text', 'file:///legacy.jpg', 'IMAGE', 'TEXT')!;
    mockDb().files.clear();
    expect(getImagesMissingEmbeddings(50).map((r) => r.id)).toEqual([id]);
  });
});

describe('getIndexingStats and clearIndex', () => {
  test('counts files by stage', () => {
    noteFileSeen('file:///1.jpg', 'IMAGE');
    noteFileSeen('file:///2.jpg', 'IMAGE');
    markOcrDone('file:///2.jpg');
    markEmbedDone('file:///2.jpg');
    noteFileSeen('file:///3.jpg', 'IMAGE');
    markStageFailed('file:///3.jpg', 'ocr', 'x');
    noteFileSeen('file:///4.jpg', 'IMAGE');
    markOcrDone('file:///4.jpg');
    markStageFailed('file:///4.jpg', 'embed', 'x');

    expect(getIndexingStats()).toEqual({
      total: 4, ocrDone: 2, ocrFailed: 1, embedDone: 1, embedPending: 2, embedFailed: 1,
    });
  });

  test('returns zeros when the query fails', () => {
    jest.spyOn(getDb(), 'executeSync').mockImplementation(() => {
      throw new Error('db locked');
    });
    expect(getIndexingStats().total).toBe(0);
  });

  test('clearIndex forgets per-file progress', () => {
    noteFileSeen(URI, 'IMAGE');
    markOcrDone(URI);
    clearIndex();
    expect(getFileState(URI)).toBeNull();
    expect(getIndexingStats().total).toBe(0);
  });
});

describe('getReadyCounts', () => {
  test('counts photos and papers whose text step is finished, failed ones included', () => {
    noteFileSeen('file:///1.jpg', 'IMAGE'); // still waiting
    noteFileSeen('file:///2.jpg', 'IMAGE');
    markOcrDone('file:///2.jpg');
    noteFileSeen('file:///3.jpg', 'IMAGE');
    markStageFailed('file:///3.jpg', 'ocr', 'unreadable');
    noteFileSeen('/docs/a.pdf', 'DOCUMENT');
    markOcrDone('/docs/a.pdf', 'DOCUMENT');
    noteFileSeen('/docs/b.pdf', 'DOCUMENT'); // still waiting

    expect(getReadyCounts()).toEqual({ photos: 2, papers: 1 });
  });

  test('is zero on an empty database', () => {
    expect(getReadyCounts()).toEqual({ photos: 0, papers: 0 });
  });

  test('returns zeros when the query fails', () => {
    jest.spyOn(getDb(), 'executeSync').mockImplementation(() => {
      throw new Error('db locked');
    });
    expect(getReadyCounts()).toEqual({ photos: 0, papers: 0 });
  });
});
