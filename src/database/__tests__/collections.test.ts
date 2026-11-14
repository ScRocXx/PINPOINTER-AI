/**
 * Home's collection queries and collection-name search, on the real
 * database modules over the in-memory op-sqlite mock.
 */
import * as connection from '../connection';
import { indexDocument } from '../documents';
import { searchDocuments } from '../search';
import { getCollectionPreview, getSimilarPhotos, getSimilarPhotosAsync } from '../collections';
import { indexEmbedding } from '../vectors';
import { countCheckedFiles, markOcrDone, markStageFailed, noteFileSeen } from '../fileState';
import { getCollection } from '../../utils/Collections';
import { __resetAll } from '@op-engineering/op-sqlite';

const CORPUS: Array<[string, string, 'IMAGE' | 'DOCUMENT', number]> = [
  ['Government of India Aadhaar unique identification', '/photos/aadhaar.jpg', 'IMAGE', 1000],
  ['INCOME TAX DEPARTMENT Permanent Account Number Card', '/photos/pan.jpg', 'IMAGE', 3000],
  ['Election Commission voter identity card EPIC', '/docs/voter.pdf', 'DOCUMENT', 2000],
  ['BSES electricity bill due date', '/photos/bses.jpg', 'IMAGE', 4000],
  ['Apollo pharmacy tablets', '/photos/tablets.jpg', 'IMAGE', 5000],
  ['beach sunset goa', '/photos/goa.jpg', 'IMAGE', 6000],
];

const index = () => {
  for (const [content, filePath, type, ts] of CORPUS) {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(ts);
    indexDocument(null, content, filePath, type, 'TEXT');
    spy.mockRestore();
  }
};

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  __resetAll();
  connection.closeDatabase();
  connection.setupDatabase();
  index();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getCollectionPreview', () => {
  test('counts every kind of ID card, photos and papers, and picks the newest photos', () => {
    const preview = getCollectionPreview(getCollection('id'));
    expect(preview.count).toBe(3);
    expect(preview.capped).toBe(false);
    // Papers count but have no thumbnail; photos come newest first.
    expect(preview.photos).toEqual(['/photos/pan.jpg', '/photos/aadhaar.jpg']);
  });

  test('keeps to the photo limit', () => {
    expect(getCollectionPreview(getCollection('id'), 1).photos).toEqual(['/photos/pan.jpg']);
  });

  test('a collection with nothing in it is empty, not an error', () => {
    expect(getCollectionPreview(getCollection('family'))).toEqual({ count: 0, capped: false, photos: [] });
  });

  test('a collection without words (Screenshots) means no query at all', () => {
    const spy = jest.spyOn(connection, 'getDb');
    expect(getCollectionPreview(getCollection('screenshot'))).toEqual({ count: 0, capped: false, photos: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  test('counts a file indexed twice once', () => {
    const db = connection.getDb() as unknown as { documents: Array<Record<string, unknown>> };
    const copy = db.documents.find(d => d.filePath === '/photos/bses.jpg');
    db.documents.push({ ...copy, id: 999 });
    expect(getCollectionPreview(getCollection('bill')).count).toBe(1);
  });

  test('a database error gives an empty preview', () => {
    jest.spyOn(connection, 'getDb').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(getCollectionPreview(getCollection('id'))).toEqual({ count: 0, capped: false, photos: [] });
  });

  test('uses plain LIKE when FTS is missing', () => {
    jest.spyOn(connection, 'isFtsAvailable').mockReturnValue(false);
    const spy = jest.spyOn(connection.getDb(), 'executeSync');
    const preview = getCollectionPreview(getCollection('id'));
    expect(preview.photos).toEqual(['/photos/pan.jpg', '/photos/aadhaar.jpg']);
    expect(String(spy.mock.calls[0][0])).toMatch(/content LIKE \?/);
  });
});

describe('getSimilarPhotos', () => {
  test('is empty without the vector index', () => {
    jest.spyOn(connection, 'isVecAvailable').mockReturnValue(false);
    expect(getSimilarPhotos(new Float32Array(512))).toEqual([]);
  });

  test('returns photo paths, closest first, only those that stand out', () => {
    const unit = (cosine: number, axis: number): Float32Array => {
      const v = new Float32Array(512);
      v[0] = cosine;
      v[axis] = Math.sqrt(1 - cosine * cosine);
      return v;
    };
    const query = unit(1, 1);
    const add = (path: string, type: 'IMAGE' | 'DOCUMENT', cosine: number, axis: number) =>
      indexEmbedding(indexDocument(null, 'words', path, type, 'TEXT')!, unit(cosine, axis));
    for (let i = 0; i < 24; i++) add(`/photos/far${i}.jpg`, 'IMAGE', 0.05, 2 + i);
    add('/photos/b.jpg', 'IMAGE', 0.3, 100);
    add('/photos/a.jpg', 'IMAGE', 0.4, 101);
    add('/docs/paper.pdf', 'DOCUMENT', 0.5, 102); // close, but not a photo
    expect(getSimilarPhotos(query, 9)).toEqual(['/photos/a.jpg', '/photos/b.jpg']);
    expect(getSimilarPhotos(query, 1)).toEqual([]); // the one nearest row is the paper
  });

  test('a vector query error gives no photos', () => {
    jest.spyOn(connection, 'isVecAvailable').mockReturnValue(true);
    jest.spyOn(connection.getDb(), 'executeSync').mockImplementation(() => {
      throw new Error('no vec0');
    });
    expect(getSimilarPhotos(new Float32Array(512))).toEqual([]);
  });
});

describe('getSimilarPhotosAsync', () => {
  const unit = (cosine: number, axis: number): Float32Array => {
    const v = new Float32Array(512);
    v[0] = cosine;
    v[axis] = Math.sqrt(1 - cosine * cosine);
    return v;
  };

  test('gives the same photos as getSimilarPhotos', async () => {
    const query = unit(1, 1);
    const add = (path: string, type: 'IMAGE' | 'DOCUMENT', cosine: number, axis: number) =>
      indexEmbedding(indexDocument(null, 'words', path, type, 'TEXT')!, unit(cosine, axis));
    for (let i = 0; i < 24; i++) add(`/photos/far${i}.jpg`, 'IMAGE', 0.05, 2 + i);
    add('/photos/b.jpg', 'IMAGE', 0.3, 100);
    add('/photos/a.jpg', 'IMAGE', 0.4, 101);
    add('/docs/paper.pdf', 'DOCUMENT', 0.5, 102);
    await expect(getSimilarPhotosAsync(query, 9)).resolves.toEqual(['/photos/a.jpg', '/photos/b.jpg']);
    await expect(getSimilarPhotosAsync(query, 1)).resolves.toEqual(getSimilarPhotos(query, 1));
  });

  test('is empty without the vector index or when the read connection fails', async () => {
    jest.spyOn(connection, 'isVecAvailable').mockReturnValue(false);
    await expect(getSimilarPhotosAsync(new Float32Array(512))).resolves.toEqual([]);
    jest.restoreAllMocks();
    jest.spyOn(connection.getReadDb(), 'execute').mockImplementation((() => Promise.reject(new Error('no vec0'))) as never);
    await expect(getSimilarPhotosAsync(new Float32Array(512))).resolves.toEqual([]);
  });
});

describe('searching for a collection by name', () => {
  const paths = (q: string) => searchDocuments(q).map(d => d.filePath).sort();

  test('"ID cards" finds Aadhaar, PAN and voter cards, not just the words', () => {
    expect(paths('ID cards')).toEqual(['/docs/voter.pdf', '/photos/aadhaar.jpg', '/photos/pan.jpg']);
  });

  test('the Hindi tile name finds the same files', () => {
    expect(paths('पहचान पत्र')).toEqual(paths('ID cards'));
  });

  test('works on the LIKE fallback too', () => {
    jest.spyOn(connection, 'isFtsAvailable').mockReturnValue(false);
    expect(paths('ID cards')).toEqual(['/docs/voter.pdf', '/photos/aadhaar.jpg', '/photos/pan.jpg']);
  });

  test('a query that only contains a collection word is a normal search', () => {
    expect(paths('aadhaar')).toEqual(['/photos/aadhaar.jpg']);
    expect(paths('goa sunset')).toEqual(['/photos/goa.jpg']);
  });

  test('a collection without concepts (Screenshots) falls back to the words', () => {
    expect(paths('Screenshots')).toEqual([]);
  });
});

describe('countCheckedFiles', () => {
  test('counts photos that were looked at, done or given up on, not pending ones', () => {
    noteFileSeen('content://1', 'IMAGE', 1);
    markOcrDone('content://1');
    noteFileSeen('content://2', 'IMAGE', 1);
    markStageFailed('content://2', 'ocr', 'bad');
    noteFileSeen('content://3', 'IMAGE', 1);
    noteFileSeen('/docs/a.pdf', 'DOCUMENT', 1);
    markOcrDone('/docs/a.pdf');
    expect(countCheckedFiles('IMAGE')).toBe(2);
    expect(countCheckedFiles('DOCUMENT')).toBe(1);
  });

  test('is 0 when the query fails', () => {
    jest.spyOn(connection, 'getDb').mockImplementation(() => {
      throw new Error('locked');
    });
    expect(countCheckedFiles('IMAGE')).toBe(0);
  });
});
