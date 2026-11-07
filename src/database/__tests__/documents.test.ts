/**
 * Tests for src/database/documents.ts — document CRUD over the in-memory
 * op-sqlite mock.
 *
 * Strategy:
 * - The mock is applied automatically via jest moduleNameMapper; no
 *   jest.mock() call is needed.
 * - beforeEach: silence console, freeze Date.now, drop the connection
 *   singleton (closeDatabase), wipe mock state (__resetAll), then
 *   setupDatabase(). closeDatabase() MUST precede __resetAll() because
 *   connection.ts caches the db handle in a module-level singleton —
 *   resetting the mock's instance map alone would leave the stale handle
 *   (and its rows) behind, leaking data across tests.
 * - Under the mock, db.execute is synchronous (same as executeSync), so
 *   getAllDocuments() needs no await.
 */

import { closeDatabase, setupDatabase } from '../connection';
import {
  processResults,
  isFileIndexed,
  indexDocument,
  getIndexedCount,
  clearIndex,
  getAllDocuments,
  removeDocument,
  listIndexedFiles,
} from '../documents';
import { getFileState, noteFileSeen } from '../fileState';
import { searchDocuments } from '../search';
import { getEmbeddingCount, hasEmbedding, indexEmbedding } from '../vectors';
import type { DocumentRecord } from '../types';
import * as OpSqlite from '@op-engineering/op-sqlite';

// NOTE: jest.requireMock('@op-engineering/op-sqlite') resolves to a DIFFERENT
// module instance than the one connection.ts imports, so its __resetAll()
// would wipe a map nobody reads. This top-level import goes through the same
// moduleNameMapper as the source files, guaranteeing the identical mock
// module (and instance map) that connection.ts uses.
const { __resetAll } = OpSqlite as unknown as { __resetAll: () => void };

let consoleSpies: jest.SpyInstance[] = [];
let dateNowSpy: jest.SpyInstance;
let fakeNow = 1_700_000_000_000;
const tick = (ms = 1000): number => {
  fakeNow += ms;
  return fakeNow;
};

beforeEach(() => {
  consoleSpies = [
    jest.spyOn(console, 'log').mockImplementation(() => {}),
    jest.spyOn(console, 'warn').mockImplementation(() => {}),
    jest.spyOn(console, 'error').mockImplementation(() => {}),
  ];
  fakeNow = 1_700_000_000_000;
  dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);
  closeDatabase();
  __resetAll();
  setupDatabase();
});

afterEach(() => {
  dateNowSpy.mockRestore();
  consoleSpies.forEach((s) => s.mockRestore());
});

// ─── processResults ─────────────────────────────────────────────────────────

describe('processResults', () => {
  test('returns [] for a null result', () => {
    expect(processResults(null)).toEqual([]);
  });

  test('returns [] for an undefined result', () => {
    expect(processResults(undefined)).toEqual([]);
  });

  test('returns [] when the result has no rows property', () => {
    expect(processResults({})).toEqual([]);
  });

  test('maps rows 1:1 preserving every DocumentRecord field', () => {
    const rows = [
      {
        id: 1,
        title: 'Aadhaar Card',
        content: 'masked content',
        filePath: '/docs/a.jpg',
        type: 'IMAGE',
        detection_type: 'TEXT',
        timestamp: 123456789,
      },
      {
        id: 2,
        title: null,
        content: 'pdf text',
        filePath: '/docs/b.pdf',
        type: 'DOCUMENT',
        detection_type: 'OBJECT',
        timestamp: 987654321,
      },
    ];
    const out: DocumentRecord[] = processResults({ rows });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: 1,
      title: 'Aadhaar Card',
      content: 'masked content',
      filePath: '/docs/a.jpg',
      type: 'IMAGE',
      detection_type: 'TEXT',
      timestamp: 123456789,
    });
    expect(out[1].title).toBeNull();
    expect(out[1].type).toBe('DOCUMENT');
  });

  test('tolerates rows with missing fields (maps to undefined)', () => {
    const out = processResults({ rows: [{ id: 7 }] });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(7);
    expect(out[0].title).toBeUndefined();
    expect(out[0].content).toBeUndefined();
  });
});

// ─── indexDocument ──────────────────────────────────────────────────────────

describe('indexDocument', () => {
  test('returns a numeric id for a valid document', () => {
    const id = indexDocument('Title', 'some content', '/a.jpg', 'IMAGE', 'TEXT');
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  test('stores trimmed content, title, type, detection_type and a numeric timestamp', () => {
    tick();
    indexDocument('  My Doc  ', '   padded content   ', '/b.pdf', 'DOCUMENT', 'TEXT');
    const docs = getAllDocuments();
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc.content).toBe('padded content');
    expect(doc.title).toBe('  My Doc  ');
    expect(doc.type).toBe('DOCUMENT');
    expect(doc.detection_type).toBe('TEXT');
    expect(typeof doc.timestamp).toBe('number');
    expect(doc.timestamp).toBe(fakeNow);
    expect(typeof doc.id).toBe('number');
  });

  test('marks the file as indexed afterwards', () => {
    indexDocument('T', 'content', '/c.jpg', 'IMAGE', 'TEXT');
    expect(isFileIndexed('/c.jpg')).toBe(true);
  });

  test('stores a null title as null', () => {
    indexDocument(null, 'content here', '/nulltitle.jpg', 'IMAGE', 'TEXT');
    const found = searchDocuments('content');
    expect(found).toHaveLength(1);
    expect(found[0].title).toBeNull();
  });

  test('re-indexing the same filePath keeps count at 1 but issues a NEW id (DELETE-first update)', () => {
    const id1 = indexDocument('v1', 'first version', '/re.jpg', 'IMAGE', 'TEXT');
    tick();
    const id2 = indexDocument('v2', 'second version', '/re.jpg', 'IMAGE', 'TEXT');
    expect(id1).not.toBeNull();
    expect(id2).not.toBeNull();
    expect(id2).not.toBe(id1);
    expect(getIndexedCount()).toBe(1);
    expect(isFileIndexed('/re.jpg')).toBe(true);
  });

  test('re-indexed content is searchable and the old content is gone (FTS triggers fire)', () => {
    indexDocument('Doc', 'original zebra content here', '/re2.jpg', 'IMAGE', 'TEXT');
    expect(searchDocuments('zebra')).toHaveLength(1);
    indexDocument('Doc', 'updated giraffe content here', '/re2.jpg', 'IMAGE', 'TEXT');
    expect(searchDocuments('zebra')).toHaveLength(0);
    const hits = searchDocuments('giraffe');
    expect(hits).toHaveLength(1);
    expect(hits[0].filePath).toBe('/re2.jpg');
    expect(hits[0].content).toContain('giraffe');
  });

  test('returns null and stores nothing for empty content + null title', () => {
    expect(indexDocument(null, '', '/empty.jpg', 'IMAGE', 'TEXT')).toBeNull();
    expect(getIndexedCount()).toBe(0);
    expect(isFileIndexed('/empty.jpg')).toBe(false);
  });

  test('returns null for empty content + empty-string title', () => {
    expect(indexDocument('', '   ', '/empty2.jpg', 'IMAGE', 'TEXT')).toBeNull();
    expect(getIndexedCount()).toBe(0);
  });

  test('returns null for whitespace-only content + null title', () => {
    expect(indexDocument(null, '  \n\t  ', '/empty3.jpg', 'IMAGE', 'TEXT')).toBeNull();
    expect(getIndexedCount()).toBe(0);
  });

  test('indexes whitespace-only content when a real title is present', () => {
    const id = indexDocument('Real Title', '   ', '/wt.jpg', 'IMAGE', 'TEXT');
    expect(typeof id).toBe('number');
    expect(isFileIndexed('/wt.jpg')).toBe(true);
  });

  test('indexes empty content when a real title is present', () => {
    const id = indexDocument('Title Only', '', '/to.jpg', 'DOCUMENT', 'TEXT');
    expect(typeof id).toBe('number');
    expect(getIndexedCount()).toBe(1);
  });

  test('a null content argument does not crash (treated as empty)', () => {
    expect(indexDocument(null, null as unknown as string, '/nc.jpg', 'IMAGE', 'TEXT')).toBeNull();
    expect(getIndexedCount()).toBe(0);
  });

  test('PII chokepoint: Aadhaar numbers are masked in the stored row', () => {
    indexDocument(
      'Aadhaar',
      'My aadhaar is 1234 5678 9012 for verification',
      '/aadhaar.jpg',
      'DOCUMENT',
      'TEXT'
    );
    const docs = getAllDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].content).not.toContain('1234 5678 9012');
    expect(docs[0].content).toContain('****-****-9012');
  });

  test('PII chokepoint: PAN numbers are masked in the stored row', () => {
    indexDocument(null, 'PAN ABCDE1234F linked', '/pan.jpg', 'DOCUMENT', 'TEXT');
    const docs = getAllDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].content).not.toContain('ABCDE1234F');
    expect(docs[0].content).toContain('ABCDE****F');
  });

  test('PII chokepoint: phone numbers are masked in the stored row', () => {
    indexDocument(null, 'call me on 9876543210 tomorrow', '/phone.jpg', 'DOCUMENT', 'TEXT');
    const docs = getAllDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].content).not.toContain('9876543210');
    expect(docs[0].content).toContain('******3210');
  });

  test('PII chokepoint: masking applies to re-indexed content too', () => {
    indexDocument(null, 'clean content', '/pii2.jpg', 'DOCUMENT', 'TEXT');
    indexDocument(null, 'updated with 1234 5678 9012 inside', '/pii2.jpg', 'DOCUMENT', 'TEXT');
    const docs = getAllDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].content).not.toContain('1234 5678 9012');
  });

  test('bulk: 100 rapid sequential inserts are all retrievable with unique ids', () => {
    const ids = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const id = indexDocument(`Bulk ${i}`, `bulk content number ${i}`, `/bulk/${i}.jpg`, 'IMAGE', 'TEXT');
      expect(typeof id).toBe('number');
      ids.add(id as number);
    }
    expect(getIndexedCount()).toBe(100);
    expect(ids.size).toBe(100);
    expect(isFileIndexed('/bulk/0.jpg')).toBe(true);
    expect(isFileIndexed('/bulk/99.jpg')).toBe(true);
  });
});

// ─── isFileIndexed ──────────────────────────────────────────────────────────

describe('isFileIndexed', () => {
  test('returns false for an unknown path on an empty db', () => {
    expect(isFileIndexed('/nope.jpg')).toBe(false);
  });

  test('returns true after indexing, false for other paths', () => {
    indexDocument('T', 'content', '/a/b.jpg', 'IMAGE', 'TEXT');
    expect(isFileIndexed('/a/b.jpg')).toBe(true);
    expect(isFileIndexed('/a/other.jpg')).toBe(false);
  });

  test('matches paths exactly (no prefix/substring confusion)', () => {
    indexDocument('T', 'content', '/a/b.jpg', 'IMAGE', 'TEXT');
    expect(isFileIndexed('/a/b.jpg2')).toBe(false);
    expect(isFileIndexed('/a/b.jp')).toBe(false);
    expect(isFileIndexed('/a/B.JPG')).toBe(false);
  });

  test('returns false after clearIndex', () => {
    indexDocument('T', 'content', '/gone.jpg', 'IMAGE', 'TEXT');
    clearIndex();
    expect(isFileIndexed('/gone.jpg')).toBe(false);
  });
});

// ─── getIndexedCount ────────────────────────────────────────────────────────

describe('getIndexedCount', () => {
  test('returns 0 on an empty db', () => {
    expect(getIndexedCount()).toBe(0);
  });

  test('reflects N after N inserts', () => {
    indexDocument('A', 'aaa', '/1.jpg', 'IMAGE', 'TEXT');
    indexDocument('B', 'bbb', '/2.jpg', 'IMAGE', 'TEXT');
    indexDocument('C', 'ccc', '/3.pdf', 'DOCUMENT', 'TEXT');
    expect(getIndexedCount()).toBe(3);
  });

  test('re-indexing the same path does not inflate the count', () => {
    indexDocument('A', 'aaa', '/same.jpg', 'IMAGE', 'TEXT');
    indexDocument('A2', 'bbb', '/same.jpg', 'IMAGE', 'TEXT');
    indexDocument('A3', 'ccc', '/same.jpg', 'IMAGE', 'TEXT');
    expect(getIndexedCount()).toBe(1);
  });

  test('returns 0 after clearIndex', () => {
    indexDocument('A', 'aaa', '/1.jpg', 'IMAGE', 'TEXT');
    clearIndex();
    expect(getIndexedCount()).toBe(0);
  });
});

// ─── clearIndex ─────────────────────────────────────────────────────────────

describe('clearIndex', () => {
  test('removes every document (count 0, isFileIndexed false, vault empty)', () => {
    indexDocument('A', 'aaa', '/1.jpg', 'IMAGE', 'TEXT');
    indexDocument('B', 'bbb', '/2.pdf', 'DOCUMENT', 'TEXT');
    clearIndex();
    expect(getIndexedCount()).toBe(0);
    expect(isFileIndexed('/1.jpg')).toBe(false);
    expect(isFileIndexed('/2.pdf')).toBe(false);
    expect(getAllDocuments()).toEqual([]);
  });

  test('clears the FTS index too — previously searchable terms return nothing', () => {
    indexDocument('Doc', 'uniqueword aadhaar card content', '/f.jpg', 'IMAGE', 'TEXT');
    expect(searchDocuments('uniqueword')).toHaveLength(1);
    clearIndex();
    expect(searchDocuments('uniqueword')).toHaveLength(0);
  });

  test('calling twice in a row does not throw', () => {
    indexDocument('A', 'aaa', '/1.jpg', 'IMAGE', 'TEXT');
    expect(() => {
      clearIndex();
      clearIndex();
    }).not.toThrow();
    expect(getIndexedCount()).toBe(0);
  });

  test('is a no-op on an empty db', () => {
    expect(() => clearIndex()).not.toThrow();
  });

  test('clears stored embeddings too', () => {
    const id = indexDocument('A', 'aaa', '/1.jpg', 'IMAGE', 'TEXT')!;
    indexEmbedding(id, new Float32Array(512).fill(0.1));
    expect(getEmbeddingCount()).toBe(1);
    clearIndex();
    expect(getEmbeddingCount()).toBe(0);
  });
});

describe('indexDocument — vector cleanup on re-index', () => {
  test('re-indexing a file removes the old row\'s vector (no orphans)', () => {
    const oldId = indexDocument(null, 'first pass', '/p.jpg', 'IMAGE', 'TEXT')!;
    indexEmbedding(oldId, new Float32Array(512).fill(0.1));
    const newId = indexDocument(null, 'second pass', '/p.jpg', 'IMAGE', 'TEXT')!;
    expect(newId).not.toBe(oldId);
    expect(hasEmbedding(oldId)).toBe(false);
    expect(getEmbeddingCount()).toBe(0);
  });

  test('indexing a different file leaves other vectors alone', () => {
    const a = indexDocument(null, 'a', '/a.jpg', 'IMAGE', 'TEXT')!;
    indexEmbedding(a, new Float32Array(512).fill(0.1));
    indexDocument(null, 'b', '/b.jpg', 'IMAGE', 'TEXT');
    expect(hasEmbedding(a)).toBe(true);
  });
});

// ─── removeDocument / listIndexedFiles ──────────────────────────────────────

describe('removeDocument', () => {
  test('drops the row, its vector and its sync state, and nothing else', () => {
    const gone = indexDocument(null, 'deleted photo', '/gone.jpg', 'IMAGE', 'TEXT')!;
    indexEmbedding(gone, new Float32Array(512).fill(0.1));
    noteFileSeen('/gone.jpg', 'IMAGE', 1);
    const kept = indexDocument(null, 'kept photo', '/kept.jpg', 'IMAGE', 'TEXT')!;
    indexEmbedding(kept, new Float32Array(512).fill(0.2));

    removeDocument('/gone.jpg');

    expect(isFileIndexed('/gone.jpg')).toBe(false);
    expect(hasEmbedding(gone)).toBe(false);
    expect(getFileState('/gone.jpg')).toBeNull();
    expect(isFileIndexed('/kept.jpg')).toBe(true);
    expect(hasEmbedding(kept)).toBe(true);
  });

  test('is a no-op for a file that is not indexed', () => {
    indexDocument(null, 'a', '/a.jpg', 'IMAGE', 'TEXT');
    expect(() => removeDocument('/never.jpg')).not.toThrow();
    expect(getIndexedCount()).toBe(1);
  });
});

describe('listIndexedFiles', () => {
  test('pages through every row in id order', () => {
    const ids = ['/1.jpg', '/2.jpg', '/3.pdf'].map((p, i) =>
      indexDocument(null, `doc ${i}`, p, p.endsWith('.pdf') ? 'DOCUMENT' : 'IMAGE', 'TEXT')!,
    );

    const first = listIndexedFiles(0, 2);
    expect(first.map((r) => r.filePath)).toEqual(['/1.jpg', '/2.jpg']);
    const rest = listIndexedFiles(first[1].id, 2);
    expect(rest).toEqual([{ id: ids[2], filePath: '/3.pdf', type: 'DOCUMENT' }]);
    expect(listIndexedFiles(ids[2], 2)).toEqual([]);
  });
});

// ─── getAllDocuments ────────────────────────────────────────────────────────

describe('getAllDocuments', () => {
  test('returns [] on an empty db', () => {
    expect(getAllDocuments()).toEqual([]);
  });

  test('returns only DOCUMENT rows, excluding IMAGE rows', () => {
    indexDocument('Img1', 'image one', '/i1.jpg', 'IMAGE', 'TEXT');
    indexDocument('Doc1', 'doc one', '/d1.pdf', 'DOCUMENT', 'TEXT');
    indexDocument('Img2', 'image two', '/i2.jpg', 'IMAGE', 'OBJECT');
    indexDocument('Doc2', 'doc two', '/d2.pdf', 'DOCUMENT', 'TEXT');
    const docs = getAllDocuments();
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.type === 'DOCUMENT')).toBe(true);
    expect(docs.map((d) => d.filePath).sort()).toEqual(['/d1.pdf', '/d2.pdf']);
  });

  test('orders by timestamp DESC (newest first)', () => {
    indexDocument('Old', 'old doc', '/old.pdf', 'DOCUMENT', 'TEXT');
    tick(5000);
    indexDocument('New', 'new doc', '/new.pdf', 'DOCUMENT', 'TEXT');
    tick(5000);
    indexDocument('Mid', 'mid doc', '/mid.pdf', 'DOCUMENT', 'TEXT');
    // reset fakeNow backwards is not possible; instead verify relative order:
    // re-index /old.pdf with the latest timestamp so it must sort first
    tick(5000);
    indexDocument('Old v2', 'old doc updated', '/old.pdf', 'DOCUMENT', 'TEXT');

    const docs = getAllDocuments();
    expect(docs.map((d) => d.filePath)).toEqual(['/old.pdf', '/mid.pdf', '/new.pdf']);
  });

  test('maps every DocumentRecord field including the numeric id', () => {
    tick(42);
    const id = indexDocument('Vault Doc', 'vault content', '/vault.pdf', 'DOCUMENT', 'OBJECT');
    const docs = getAllDocuments();
    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc).toEqual({
      id,
      title: 'Vault Doc',
      content: 'vault content',
      filePath: '/vault.pdf',
      type: 'DOCUMENT',
      detection_type: 'OBJECT',
      timestamp: fakeNow,
    });
  });

  test('excludes re-indexed IMAGE rows that share a path pattern with DOCUMENT rows', () => {
    indexDocument('Shot', 'photo', '/mixed.jpg', 'IMAGE', 'TEXT');
    indexDocument('Paper', 'paper', '/mixed.pdf', 'DOCUMENT', 'TEXT');
    const docs = getAllDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0].filePath).toBe('/mixed.pdf');
  });
});
