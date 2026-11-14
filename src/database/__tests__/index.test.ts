/**
 * Compatibility contract for the database public API.
 *
 * This is the "zero breaking changes" guard for the Database.ts →
 * src/database/ refactor. The barrel (src/database/index.ts) must expose
 * EXACTLY the 15 functions + 1 type that the original src/Database.ts
 * exported, and the deprecated src/Database.ts shim must re-export the
 * identical references. If a refactor adds, renames, or drops an export,
 * these tests fail on purpose — update the barrel AND this file together.
 */

import * as Database from '../index';
import type { DocumentRecord } from '../index';
// NOTE: this import goes through jest moduleNameMapper to the SAME in-memory
// mock instance the source modules use — so __resetAll() truly resets state.
// (jest.requireMock() double-evaluates the mock file and clears dead state.)
import { __resetAll } from '@op-engineering/op-sqlite';

// The original src/Database.ts public function API, plus
// getImagesMissingEmbeddings (embedding backfill), removeDocument /
// listIndexedFiles (dropping deleted files) and the per-file indexing state
// functions (fileState.ts, including getReadyCounts for first-run progress),
// plus Home's read-only collection queries (collections.ts), alphabetically sorted.
// (DocumentRecord is a type-only export and does not appear at runtime.)
const EXPECTED_EXPORTS = [
  'beginTransaction',
  'clearIndex',
  'closeDatabase',
  'commitTransaction',
  'countCheckedFiles',
  'extractSnippet',
  'getAllDocuments',
  'getDocumentByPath',
  'getDocumentId',
  'getEmbeddingCount',
  'getCollectionPreview',
  'getFileState',
  'getImagesMissingEmbeddings',
  'getIndexedCount',
  'getIndexingStats',
  'getReadyCounts',
  'hasEmbedding',
  'indexDocument',
  'indexEmbedding',
  'isFileIndexed',
  'listIndexedFiles',
  'listContentAfter',
  'updateDocumentContent',
  'markEmbedDone',
  'markEmbedSkipped',
  'markOcrDone',
  'markStageFailed',
  'noteFileSeen',
  'removeDocument',
  'rollbackTransaction',
  'searchDocuments',
  'searchDocumentsAsync',
  'setupDatabase',
  'getSimilarPhotos',
  'getSimilarPhotosAsync',
].sort();

// Internal helpers that must NOT leak through the public barrel.
const INTERNAL_HELPERS = ['getDb', 'getReadDb', 'isFtsAvailable', 'isVecAvailable', 'processResults'];

const barrelNs = Database as unknown as Record<string, unknown>;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // Drop the mock's cached DB instances AND the connection.ts singleton so
  // each test starts from a pristine database.
  __resetAll();
  Database.closeDatabase();
  Database.setupDatabase();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('database barrel — public API contract', () => {
  test('exposes exactly the expected export names (no more, no less)', () => {
    expect(Object.keys(barrelNs).sort()).toEqual(EXPECTED_EXPORTS);
  });

  test('every barrel export is a function', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(typeof barrelNs[name]).toBe('function');
    }
  });

  test('DocumentRecord type is exported from the barrel (compile-time check)', () => {
    const record: DocumentRecord = {
      content: 'x',
      filePath: '/x',
      type: 'IMAGE',
      detection_type: 'TEXT',
      timestamp: 0,
    };
    expect(record.filePath).toBe('/x');
  });
});

describe('no internal leakage through the public API', () => {
  test.each(INTERNAL_HELPERS)('barrel does not expose %s', (name) => {
    expect(barrelNs[name]).toBeUndefined();
  });
});

describe('end-to-end smoke through the barrel', () => {
  test('setup → index → search → count → clear lifecycle works', () => {
    const id = Database.indexDocument(
      'Compat Smoke Doc',
      'a searchable compatibility smoke document',
      '/compat/smoke.jpg',
      'IMAGE',
      'TEXT'
    );
    expect(typeof id).toBe('number');

    expect(Database.isFileIndexed('/compat/smoke.jpg')).toBe(true);
    expect(Database.getIndexedCount()).toBe(1);

    const hits = Database.searchDocuments('searchable');
    expect(hits.length).toBeGreaterThan(0);
    const record: DocumentRecord = hits[0];
    expect(record.filePath).toBe('/compat/smoke.jpg');

    const snippet = Database.extractSnippet(record.content, 'searchable');
    expect(snippet).toContain('searchable');

    Database.clearIndex();
    expect(Database.getIndexedCount()).toBe(0);
    expect(Database.isFileIndexed('/compat/smoke.jpg')).toBe(false);
  });

  test('transaction and vector helpers are callable through the barrel', () => {
    Database.beginTransaction();
    const id = Database.indexDocument('Tx Doc', 'transaction smoke content', '/compat/tx.jpg', 'IMAGE', 'TEXT');
    Database.commitTransaction();
    expect(Database.getIndexedCount()).toBe(1);

    // No embedding was stored for this doc (vectors module is a no-crash passthrough here).
    expect(Database.hasEmbedding(id as number)).toBe(false);
    expect(Database.getEmbeddingCount()).toBe(0);

    Database.beginTransaction();
    Database.indexDocument('Rollback Doc', 'will be rolled back', '/compat/rb.jpg', 'IMAGE', 'TEXT');
    Database.rollbackTransaction();
    expect(Database.getIndexedCount()).toBe(1);
  });
});
