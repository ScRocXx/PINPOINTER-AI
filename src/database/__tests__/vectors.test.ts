/**
 * Tests for src/database/vectors.ts — sqlite-vec embedding storage.
 *
 * Strategy: exercise the real module against the in-memory op-sqlite mock
 * (routed by jest.config.js moduleNameMapper). The mock implements vec_index
 * INSERT/DELETE/SELECT/COUNT and no-ops DDL, so setupDatabase() leaves
 * isVecAvailable() true — the "vec unavailable" paths are forced with a
 * jest.spyOn on the connection module's isVecAvailable binding.
 * Raw stored bytes are read back through the mock's vec_index rows.
 */
import {
  findLookAlikes, getEmbeddingCount, getImagesMissingEmbeddings, hasEmbedding, indexEmbedding,
  standOutLimit, FAR_PERCENTILE, MAX_VECTOR_DISTANCE, MIN_PHOTOS_FOR_STAND_OUT, STAND_OUT_GAP,
} from '../vectors';
import { indexDocument } from '../documents';
import { closeDatabase, getDb, isVecAvailable, setupDatabase } from '../connection';
import * as connectionModule from '../connection';

type MockVectorRow = { document_id: number; embedding: Uint8Array };
type MockDbInstance = { vectors: MockVectorRow[]; __reset: () => void };

const DIM = 512;

/** Deterministic 512-dim embedding: seed selects the value pattern. */
const makeEmbedding = (seed = 0): Float32Array => {
  const arr = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) {
    arr[i] = (i + seed) * 0.25 - 64;
  }
  return arr;
};

/** The mock DB instance behind the connection singleton (same object the module uses). */
const mockDb = (): MockDbInstance => getDb() as unknown as MockDbInstance;

/** Raw rows the mock stored in vec_index. */
const storedVectors = (): MockVectorRow[] => mockDb().vectors;

const storedFor = (documentId: number): Uint8Array | undefined =>
  storedVectors().find((v) => v.document_id === documentId)?.embedding;

const storedBytes = (documentId: number): number[] =>
  Array.from(storedFor(documentId) ?? []);

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  // NOTE: jest.requireMock('@op-engineering/op-sqlite') returns a disconnected
  // copy of the mock (moduleNameMapper is bypassed), so __resetAll() there
  // does NOT clear the instance the connection singleton holds. Reset via the
  // mock's own documented __reset() helper on the live instance instead.
  mockDb().__reset();
  setupDatabase();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('indexEmbedding', () => {
  test('stores a 512-dim embedding so hasEmbedding returns true afterwards', () => {
    expect(indexEmbedding(7, makeEmbedding(1))).toBe(true);
    expect(hasEmbedding(7)).toBe(true);
  });

  test('increments getEmbeddingCount', () => {
    expect(getEmbeddingCount()).toBe(0);
    indexEmbedding(1, makeEmbedding());
    indexEmbedding(2, makeEmbedding(5));
    expect(getEmbeddingCount()).toBe(2);
  });

  test('re-indexing the same document id overwrites instead of duplicating (DELETE-first)', () => {
    const latest = makeEmbedding(2);
    indexEmbedding(3, makeEmbedding(1));
    indexEmbedding(3, latest);
    expect(getEmbeddingCount()).toBe(1);
    expect(hasEmbedding(3)).toBe(true);
    // The latest bytes win — no stale row lingers.
    expect(storedVectors().filter((v) => v.document_id === 3)).toHaveLength(1);
    expect(storedBytes(3)).toEqual(Array.from(new Uint8Array(latest.buffer)));
  });

  test('keeps each document id isolated', () => {
    indexEmbedding(1, makeEmbedding(1));
    indexEmbedding(2, makeEmbedding(2));
    indexEmbedding(3, makeEmbedding(3));
    expect(hasEmbedding(1)).toBe(true);
    expect(hasEmbedding(2)).toBe(true);
    expect(hasEmbedding(3)).toBe(true);
    expect(hasEmbedding(4)).toBe(false);
    expect(getEmbeddingCount()).toBe(3);
    expect(storedBytes(1)).not.toEqual(storedBytes(2));
    expect(storedBytes(2)).not.toEqual(storedBytes(3));
  });

  test('round-trips the exact bytes of the Float32Array buffer', () => {
    const emb = makeEmbedding(42);
    indexEmbedding(11, emb);
    expect(storedBytes(11)).toEqual(Array.from(new Uint8Array(emb.buffer)));
    expect(storedBytes(11)).toHaveLength(DIM * 4);
  });

  test('stores the full underlying ArrayBuffer when the view has a non-zero byteOffset', () => {
    // The module passes `embedding.buffer` (the whole buffer), not just the
    // view's slice — pin this so a future "fix" is a deliberate change.
    const buf = new ArrayBuffer(DIM * 4 + 64);
    const view = new Float32Array(buf, 64, DIM);
    for (let i = 0; i < DIM; i++) {
      view[i] = i;
    }
    indexEmbedding(12, view);
    expect(storedBytes(12)).toHaveLength(buf.byteLength);
    expect(storedBytes(12)).toEqual(Array.from(new Uint8Array(buf)));
  });

  test('does not crash on a non-512-dim array (the 512-dim requirement is documentary)', () => {
    expect(() => indexEmbedding(13, new Float32Array(4))).not.toThrow();
    expect(hasEmbedding(13)).toBe(true);
    expect(getEmbeddingCount()).toBe(1);
  });

  test('is a silent no-op when sqlite-vec is unavailable', () => {
    const getDbSpy = jest.spyOn(connectionModule, 'getDb');
    const warnSpy = jest.spyOn(console, 'warn');
    jest.spyOn(connectionModule, 'isVecAvailable').mockReturnValue(false);

    expect(indexEmbedding(20, makeEmbedding())).toBe(false);

    expect(getDbSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(hasEmbedding(20)).toBe(false);
    expect(getEmbeddingCount()).toBe(0);
    expect(storedVectors()).toHaveLength(0);
  });

  test('catches DB write failures and only warns', () => {
    jest
      .spyOn(connectionModule, 'getDb')
      .mockImplementationOnce(() => {
        throw new Error('disk I/O');
      });
    const warnSpy = jest.spyOn(console, 'warn');

    expect(indexEmbedding(21, makeEmbedding())).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith('[DB] Vector index failed:', expect.any(Error));
    expect(hasEmbedding(21)).toBe(false);
  });
});

describe('hasEmbedding', () => {
  test('returns false for an unknown document id', () => {
    expect(hasEmbedding(999)).toBe(false);
  });

  test('returns false for id 0 and negative ids', () => {
    expect(hasEmbedding(0)).toBe(false);
    expect(hasEmbedding(-5)).toBe(false);
  });

  test('returns true after indexEmbedding', () => {
    expect(hasEmbedding(30)).toBe(false);
    indexEmbedding(30, makeEmbedding());
    expect(hasEmbedding(30)).toBe(true);
  });

  test('returns false when sqlite-vec is unavailable even if rows exist', () => {
    indexEmbedding(31, makeEmbedding());
    expect(hasEmbedding(31)).toBe(true);
    jest.spyOn(connectionModule, 'isVecAvailable').mockReturnValue(false);
    expect(hasEmbedding(31)).toBe(false);
  });

  test('returns false when the DB read throws', () => {
    jest
      .spyOn(connectionModule, 'getDb')
      .mockImplementationOnce(() => {
        throw new Error('boom');
      });
    expect(hasEmbedding(32)).toBe(false);
  });
});

describe('getEmbeddingCount', () => {
  test('returns 0 when no embeddings are stored', () => {
    expect(getEmbeddingCount()).toBe(0);
  });

  test('returns N after indexing N distinct documents', () => {
    for (let i = 1; i <= 5; i++) {
      indexEmbedding(i, makeEmbedding(i));
    }
    expect(getEmbeddingCount()).toBe(5);
  });

  test('does not decrement when a document is re-indexed', () => {
    indexEmbedding(40, makeEmbedding(1));
    indexEmbedding(40, makeEmbedding(2));
    expect(getEmbeddingCount()).toBe(1);
  });

  test('returns 0 when sqlite-vec is unavailable', () => {
    indexEmbedding(41, makeEmbedding());
    expect(getEmbeddingCount()).toBe(1);
    jest.spyOn(connectionModule, 'isVecAvailable').mockReturnValue(false);
    expect(getEmbeddingCount()).toBe(0);
  });

  test('returns 0 when the DB read throws', () => {
    jest
      .spyOn(connectionModule, 'getDb')
      .mockImplementationOnce(() => {
        throw new Error('boom');
      });
    expect(getEmbeddingCount()).toBe(0);
  });
});

describe('lifecycle', () => {
  test('embeddings survive closeDatabase (lazy reopen returns the cached instance)', () => {
    indexEmbedding(50, makeEmbedding(3));
    expect(hasEmbedding(50)).toBe(true);
    closeDatabase();
    expect(hasEmbedding(50)).toBe(true);
    expect(getEmbeddingCount()).toBe(1);
  });

  test('reports sqlite-vec as available after setupDatabase', () => {
    expect(isVecAvailable()).toBe(true);
  });
});

describe('getImagesMissingEmbeddings', () => {
  test('returns image rows without a vector, newest first', () => {
    const a = indexDocument(null, 'a', '/a.jpg', 'IMAGE', 'TEXT')!;
    const b = indexDocument(null, 'b', '/b.jpg', 'IMAGE', 'TEXT')!;
    const c = indexDocument(null, 'c', '/c.jpg', 'IMAGE', 'TEXT')!;
    indexEmbedding(b, makeEmbedding(1));
    expect(getImagesMissingEmbeddings()).toEqual([
      { id: c, filePath: '/c.jpg' },
      { id: a, filePath: '/a.jpg' },
    ]);
  });

  test('ignores documents and honours limit and beforeId', () => {
    indexDocument('Doc', 'pdf', '/d.pdf', 'DOCUMENT', 'TEXT');
    const a = indexDocument(null, 'a', '/a.jpg', 'IMAGE', 'TEXT')!;
    const b = indexDocument(null, 'b', '/b.jpg', 'IMAGE', 'TEXT')!;
    expect(getImagesMissingEmbeddings(1)).toEqual([{ id: b, filePath: '/b.jpg' }]);
    expect(getImagesMissingEmbeddings(10, b)).toEqual([{ id: a, filePath: '/a.jpg' }]);
  });

  test('returns [] when sqlite-vec is unavailable', () => {
    indexDocument(null, 'a', '/a.jpg', 'IMAGE', 'TEXT');
    jest.spyOn(connectionModule, 'isVecAvailable').mockReturnValue(false);
    expect(getImagesMissingEmbeddings()).toEqual([]);
  });
});

describe('findLookAlikes', () => {
  /** A unit vector at `cosine` to the query (the first axis). */
  const atCosine = (cosine: number, axis: number): Float32Array => {
    const v = new Float32Array(DIM);
    v[0] = cosine;
    v[axis] = Math.sqrt(1 - cosine * cosine);
    return v;
  };
  const query = atCosine(1, 1);
  const distanceAt = (cosine: number) => Math.sqrt(2 - 2 * cosine);

  test('is empty without the vector index or without vectors', () => {
    expect(findLookAlikes(query)).toEqual([]);
    jest.spyOn(connectionModule, 'isVecAvailable').mockReturnValue(false);
    expect(findLookAlikes(query)).toEqual([]);
  });

  test('the limit is the far photo distance minus the gap', () => {
    expect(standOutLimit(1.4)).toBeCloseTo(1.4 - STAND_OUT_GAP);
    expect(FAR_PERCENTILE).toBeGreaterThan(0.5);
    expect(FAR_PERCENTILE).toBeLessThan(1);
  });

  test('returns only photos clearly closer than the far photos, closest first', () => {
    for (let i = 0; i < 30; i++) indexEmbedding(100 + i, atCosine(0.05, 2 + i));
    indexEmbedding(1, atCosine(0.3, 200));
    indexEmbedding(2, atCosine(0.4, 201));
    // Just inside the far distance minus the gap is not enough.
    const nearMiss = 1 - (distanceAt(0.05) - STAND_OUT_GAP + 0.01) ** 2 / 2;
    indexEmbedding(3, atCosine(nearMiss, 202));
    const found = findLookAlikes(query);
    expect(found.map(l => l.documentId)).toEqual([2, 1]);
    expect(found[0].distance).toBeCloseTo(distanceAt(0.4), 4);
  });

  test('photos all about as close as each other give nothing, even inside the fixed limit', () => {
    for (let i = 0; i < 30; i++) indexEmbedding(100 + i, atCosine(0.26 + i * 0.001, 2 + i));
    expect(distanceAt(0.26)).toBeLessThan(MAX_VECTOR_DISTANCE);
    expect(findLookAlikes(query)).toEqual([]);
  });

  test('respects the limit on how many are returned', () => {
    for (let i = 0; i < 30; i++) indexEmbedding(100 + i, atCosine(0.05, 2 + i));
    for (let i = 0; i < 5; i++) indexEmbedding(1 + i, atCosine(0.4 - i * 0.01, 200 + i));
    expect(findLookAlikes(query, 3).map(l => l.documentId)).toEqual([1, 2, 3]);
  });

  test('fewer photos than the minimum use the fixed limit', () => {
    indexEmbedding(1, atCosine(0.3, 2));
    indexEmbedding(2, atCosine(0.05, 3));
    expect(getEmbeddingCount()).toBeLessThan(MIN_PHOTOS_FOR_STAND_OUT);
    expect(findLookAlikes(query).map(l => l.documentId)).toEqual([1]);
  });

  test('falls back to the fixed limit when the far distance cannot be read', () => {
    for (let i = 0; i < 30; i++) indexEmbedding(100 + i, atCosine(0.26, 2 + i));
    const db = getDb();
    const real = db.executeSync.bind(db);
    jest.spyOn(db, 'executeSync').mockImplementation(((sql: string, params?: unknown[]) => {
      if (/vec_distance_l2/.test(sql)) throw new Error('no such function');
      return real(sql, params as never);
    }) as never);
    expect(findLookAlikes(query)).toHaveLength(30);
  });

  test('reads a query vector that is a view into a larger buffer', () => {
    for (let i = 0; i < 30; i++) indexEmbedding(100 + i, atCosine(0.05, 2 + i));
    indexEmbedding(1, atCosine(0.4, 200));
    const big = new Float32Array(DIM * 2);
    big.set(query, DIM);
    expect(findLookAlikes(big.subarray(DIM)).map(l => l.documentId)).toEqual([1]);
  });
});
