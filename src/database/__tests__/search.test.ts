/**
 * Tests for src/database/search.ts — FTS5 search, LIKE fallback, hybrid
 * vector search, synonym expansion, soundex phonetics, relevance ranking,
 * deduplication, and snippet extraction.
 *
 * Strategy: runs against the REAL database modules (connection + documents)
 * backed by the repo's in-memory op-sqlite mock (__mocks__/op-sqlite.js).
 * Mock behaviors these tests rely on:
 *   - DDL is a no-op → isFtsAvailable()/isVecAvailable() are true after setup
 *   - FTS5 MATCH → case-insensitive substring over title+content (AND/OR honored)
 *   - LIKE → the generated WHERE clause is actually evaluated
 *   - open() caches per DB name → reset via __resetAll + closeDatabase
 * To reach the LIKE/ranking code while FTS is available, tests either use
 * queries FTS cannot match (synonym-only hits) or spy isFtsAvailable → false.
 */
import * as connection from '../connection';
import { indexDocument } from '../documents';
import { getEmbeddingCount, indexEmbedding } from '../vectors';
import { soundex } from '../../utils/Soundex';
import { extractSnippet, searchDocuments, MAX_VECTOR_DISTANCE } from '../search';
import type { DocumentRecord } from '../types';

// Top-level import: jest's moduleNameMapper routes this to the SAME mock
// instance the source modules use. (jest.requireMock() would double-evaluate
// the mock and clear dead state while real data leaks between tests.)
import { __resetAll } from '@op-engineering/op-sqlite';

declare module '@op-engineering/op-sqlite' {
  // Test-only export provided by __mocks__/op-sqlite.js (routed via jest
  // moduleNameMapper). Augmentation so tsc accepts the import above; the
  // real native module has no such export. Runtime is unaffected.
  // eslint-disable-next-line @typescript-eslint/no-shadow
  export const __resetAll: () => void;
}

interface CorpusDoc {
  title: string | null;
  content: string;
  filePath: string;
  type: 'DOCUMENT' | 'IMAGE';
  detection: 'TEXT' | 'OBJECT';
}

// Fixed corpus. Chosen so that:
//  - no content triggers DataMasking (no long digit runs / PAN patterns)
//  - no title/content contains the substring "dl" (keeps the "dl" synonym
//    test on the LIKE path instead of FTS)
const CORPUS: CorpusDoc[] = [
  { title: 'Aadhaar Card', content: 'identity proof issued to resident', filePath: '/docs/aadhaar.pdf', type: 'DOCUMENT', detection: 'TEXT' },
  { title: 'PAN Card', content: 'permanent account number details', filePath: '/docs/pan.pdf', type: 'DOCUMENT', detection: 'TEXT' },
  { title: 'March Invoice', content: 'tax invoice for march services', filePath: '/docs/invoice.pdf', type: 'DOCUMENT', detection: 'TEXT' },
  { title: null, content: 'beach sunset photo from goa trip', filePath: '/photos/goa.jpg', type: 'IMAGE', detection: 'OBJECT' },
  { title: 'Driving Licence', content: 'license to drive renewed', filePath: '/docs/dl.pdf', type: 'DOCUMENT', detection: 'TEXT' },
  { title: 'Salary June', content: 'monthly salary slip for june', filePath: '/docs/salary.pdf', type: 'DOCUMENT', detection: 'TEXT' },
  { title: 'Passport', content: 'travel document for abroad', filePath: '/docs/passport.pdf', type: 'DOCUMENT', detection: 'TEXT' },
  { title: 'Notes', content: 'aadhaar number noted', filePath: '/docs/notes.pdf', type: 'DOCUMENT', detection: 'TEXT' },
];

const FIXED_TS = 1720000000000;

const paths = (docs: DocumentRecord[]): string[] => docs.map((d) => d.filePath);

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  __resetAll();
  connection.closeDatabase(); // drop the singleton so getDb re-opens the fresh mock
  connection.setupDatabase();
  // Pin timestamps so ranking ties are deterministic.
  const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(FIXED_TS);
  for (const d of CORPUS) {
    indexDocument(d.title, d.content, d.filePath, d.type, d.detection);
  }
  dateSpy.mockRestore();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('searchDocuments — input validation', () => {
  test('empty query returns []', () => {
    expect(searchDocuments('')).toEqual([]);
  });

  test('whitespace-only query returns []', () => {
    expect(searchDocuments('   \n\t  ')).toEqual([]);
  });

  test('query that sanitizes to nothing returns [] without crashing', () => {
    // "()" → trimmed non-empty, but safeQuery becomes "" → LIKE on "()"
    expect(searchDocuments('()')).toEqual([]);
    expect(searchDocuments('!!!')).toEqual([]);
  });
});

describe('searchDocuments — FTS5 path', () => {
  test('finds a term present in content', () => {
    expect(paths(searchDocuments('goa'))).toEqual(['/photos/goa.jpg']);
  });

  test('finds a term present only in the title', () => {
    // "licence" appears in the title but the content only has "license"
    expect(paths(searchDocuments('licence'))).toEqual(['/docs/dl.pdf']);
  });

  test('multi-word query AND-matches: doc with both words wins, partial doc excluded', () => {
    // /docs/notes.pdf has "aadhaar" but not "card"
    expect(paths(searchDocuments('aadhaar card'))).toEqual(['/docs/aadhaar.pdf']);
  });

  test('matching is case-insensitive', () => {
    expect(paths(searchDocuments('AADHAAR'))).toEqual([
      '/docs/aadhaar.pdf',
      '/docs/notes.pdf',
    ]);
  });

  test('special characters are stripped before matching', () => {
    expect(paths(searchDocuments('aadhaar!!'))).toEqual(paths(searchDocuments('aadhaar')));
  });

  test('results are full DocumentRecords', () => {
    const [hit] = searchDocuments('passport');
    expect(hit).toMatchObject({
      title: 'Passport',
      content: 'travel document for abroad',
      filePath: '/docs/passport.pdf',
      type: 'DOCUMENT',
      detection_type: 'TEXT',
    });
    expect(typeof hit.id).toBe('number');
    expect(typeof hit.timestamp).toBe('number');
  });
});

describe('searchDocuments — LIKE fallback with synonym expansion', () => {
  test('"bill" finds the invoice doc via the invoice synonym group (FTS cannot match)', () => {
    // FTS `"bill"*` matches nothing; LIKE expands bill → invoice/bill/tax invoice
    expect(paths(searchDocuments('bill'))).toEqual(['/docs/invoice.pdf']);
  });

  test('"dl" finds the driving licence doc via synonym expansion', () => {
    expect(paths(searchDocuments('dl'))).toEqual(['/docs/dl.pdf']);
  });

  test('"payslip" finds the salary slip doc via synonym expansion', () => {
    expect(paths(searchDocuments('payslip'))).toEqual(['/docs/salary.pdf']);
  });

  test('"pancard" finds the PAN card doc via the "pan card" synonym', () => {
    expect(paths(searchDocuments('pancard'))).toEqual(['/docs/pan.pdf']);
  });

  test('synonyms do not leak across groups: "passport" matches only the passport doc', () => {
    expect(paths(searchDocuments('passport'))).toEqual(['/docs/passport.pdf']);
  });

  test('a query with no synonym group and no match returns []', () => {
    expect(searchDocuments('xylophone')).toEqual([]);
  });
});

describe('searchDocuments — phonetic (soundex) matching', () => {
  test('finds a doc containing the soundex code of the query word', () => {
    const code = soundex('kathmandu');
    expect(code).toHaveLength(4);
    indexDocument('Travel', `booking reference ${code} confirmed`, '/docs/travel.pdf', 'DOCUMENT', 'TEXT');
    // "kathmandu" itself appears nowhere, so FTS misses; LIKE matches %<code>%
    expect(paths(searchDocuments('kathmandu'))).toEqual(['/docs/travel.pdf']);
  });

  test('does not false-positive on an unrelated word with a different soundex code', () => {
    const code = soundex('kathmandu');
    indexDocument('Travel', `booking reference ${code} confirmed`, '/docs/travel.pdf', 'DOCUMENT', 'TEXT');
    expect(soundex('everest')).not.toBe(code);
    expect(searchDocuments('everest')).toEqual([]);
  });
});

describe('searchDocuments — relevance ranking (LIKE path)', () => {
  beforeEach(() => {
    // Force the LIKE path so rankResults actually runs (FTS returns early).
    jest.spyOn(connection, 'isFtsAvailable').mockReturnValue(false);
  });

  test('title match outranks content-only match', () => {
    // docA: "aadhaar" in title (50 + 15); notes.pdf: "aadhaar" in content (30 + 10)
    expect(paths(searchDocuments('aadhaar'))).toEqual([
      '/docs/aadhaar.pdf',
      '/docs/notes.pdf',
    ]);
  });

  test('synonym query ranks a title word above a content word', () => {
    // Neither doc contains "uidai"/"invoice" literally in FTS terms; both match
    // via synonym expansion. X has "invoice" in the title (+15), Y only in
    // content (+10).
    indexDocument('Aadhaar Invoice', 'monthly statement', '/docs/aadhaar-invoice.pdf', 'DOCUMENT', 'TEXT');
    indexDocument('Statement', 'aadhaar invoice copy', '/docs/statement.pdf', 'DOCUMENT', 'TEXT');
    expect(paths(searchDocuments('uidai invoice'))).toEqual([
      '/docs/aadhaar-invoice.pdf',
      '/docs/statement.pdf',
    ]);
  });

  test('exact phrase match outranks scattered word matches', () => {
    indexDocument('E', 'my tax bill is due', '/docs/taxbill.pdf', 'DOCUMENT', 'TEXT');
    indexDocument('F', 'tax planning and bill payments', '/docs/taxplan.pdf', 'DOCUMENT', 'TEXT');
    // taxbill: phrase(30)+words(20)=50; taxplan: words only=20; invoice: "tax"+10
    // via the aggressive "tax"→invoice/bill synonym expansion
    expect(paths(searchDocuments('tax bill'))).toEqual([
      '/docs/taxbill.pdf',
      '/docs/taxplan.pdf',
      '/docs/invoice.pdf',
    ]);
  });
});

describe('searchDocuments — dedup and limits', () => {
  test('dedupes multiple rows sharing a filePath, keeping the top-ranked one', () => {
    jest.spyOn(connection, 'isFtsAvailable').mockReturnValue(false);
    const db = connection.getDb();
    const insert =
      'INSERT INTO document_index (title, content, filePath, type, detection_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)';
    // Bypass indexDocument's DELETE-first pattern to create true duplicates.
    db.executeSync(insert, ['Dup One', 'uniqueword alpha', '/docs/dup.pdf', 'DOCUMENT', 'TEXT', FIXED_TS]);
    db.executeSync(insert, ['Dup Two', 'uniqueword beta', '/docs/dup.pdf', 'DOCUMENT', 'TEXT', FIXED_TS]);
    const res = searchDocuments('uniqueword');
    expect(res).toHaveLength(1);
    expect(res[0].filePath).toBe('/docs/dup.pdf');
  });

  test('caps results at 50', () => {
    for (let i = 0; i < 55; i++) {
      indexDocument(`Limit ${i}`, `limittest document number ${i}`, `/docs/limit-${i}.pdf`, 'DOCUMENT', 'TEXT');
    }
    expect(searchDocuments('limittest')).toHaveLength(50);
  });
});

describe('searchDocuments — hybrid vector path', () => {
  test('queryVector returns hybrid hits without crashing', () => {
    // The mock resolves the hybrid WITH query via its FTS substring matcher;
    // docs containing "aadhaar" (aadhaar.pdf, notes.pdf) come back as hits.
    const res = searchDocuments('aadhaar', new Float32Array(512));
    expect(Array.isArray(res)).toBe(true);
    expect(res).toHaveLength(2);
  });

  test('queryVector with no matching terms falls through gracefully to []', () => {
    expect(searchDocuments('zzz-no-match-qqq', new Float32Array(512))).toEqual([]);
  });

  test('vector matches are limited by a distance cutoff', () => {
    const db = connection.getDb();
    const spy = jest.spyOn(db, 'executeSync');
    searchDocuments('aadhaar', new Float32Array(512));
    const hybridCall = spy.mock.calls.find(([sql]) => /rrf_score/.test(String(sql)));
    expect(hybridCall).toBeDefined();
    expect(String(hybridCall![0])).toMatch(/WHERE distance <= \?/);
    expect(hybridCall![1]).toEqual([expect.any(Uint8Array), MAX_VECTOR_DISTANCE, expect.any(String)]);
    expect(MAX_VECTOR_DISTANCE).toBeGreaterThan(0);
    expect(MAX_VECTOR_DISTANCE).toBeLessThan(Math.SQRT2); // stricter than "any non-opposite vector"
  });
});

describe('searchDocuments — error resilience', () => {
  test('returns [] when getDb throws', () => {
    jest.spyOn(connection, 'getDb').mockImplementation(() => {
      throw new Error('db down');
    });
    expect(searchDocuments('aadhaar')).toEqual([]);
  });

  test('returns [] when a query throws mid-search', () => {
    const failingDb = {
      executeSync: () => {
        throw new Error('sql down');
      },
    };
    jest
      .spyOn(connection, 'getDb')
      .mockReturnValue(failingDb as unknown as ReturnType<typeof connection.getDb>);
    expect(searchDocuments('aadhaar')).toEqual([]);
  });
});

describe('test isolation — mock state resets between tests', () => {
  test('stores an embedding (count becomes 1 within this test)', () => {
    indexEmbedding(4242, new Float32Array(512));
    expect(getEmbeddingCount()).toBe(1);
  });

  test('sees zero embeddings: state from the previous test did not leak', () => {
    // Would fail if __resetAll() cleared a different mock instance than the
    // one the database modules use (the jest.requireMock double-eval trap).
    expect(getEmbeddingCount()).toBe(0);
  });
});

describe('extractSnippet', () => {
  test('match in the middle → windowed with ... on both sides', () => {
    const content = 'x'.repeat(100) + 'needle' + 'y'.repeat(100);
    const expected = '...' + 'x'.repeat(40) + 'needle' + 'y'.repeat(40) + '...';
    expect(extractSnippet(content, 'needle')).toBe(expected);
  });

  test('match at the start → no leading ...', () => {
    const content = 'needle ' + 'z'.repeat(100);
    const expected = 'needle ' + 'z'.repeat(39) + '...';
    const res = extractSnippet(content, 'needle');
    expect(res).toBe(expected);
    expect(res.startsWith('...')).toBe(false);
  });

  test('match near the end → leading ... only', () => {
    const content = 'x'.repeat(200) + 'needle';
    const expected = '...' + 'x'.repeat(40) + 'needle';
    const res = extractSnippet(content, 'needle');
    expect(res).toBe(expected);
    expect(res.endsWith('...')).toBe(false);
  });

  test('no match in long content → first 80 chars + ...', () => {
    const content = 'a'.repeat(100);
    expect(extractSnippet(content, 'zzz')).toBe('a'.repeat(80) + '...');
  });

  test('no match in short content → content as-is, no ...', () => {
    expect(extractSnippet('short text', 'zzz')).toBe('short text');
  });

  test('empty content or query → empty string', () => {
    expect(extractSnippet('', 'needle')).toBe('');
    expect(extractSnippet('some content', '')).toBe('');
    expect(extractSnippet('', '')).toBe('');
  });

  test('custom snippetLen is respected', () => {
    const content = 'x'.repeat(100) + 'needle' + 'y'.repeat(100);
    const expected = '...' + 'x'.repeat(10) + 'needle' + 'y'.repeat(10) + '...';
    expect(extractSnippet(content, 'needle', 20)).toBe(expected);
  });

  test('newlines in the window are replaced with spaces', () => {
    const content = 'line one\nline two needle here\nline three';
    expect(extractSnippet(content, 'needle')).toBe('line one line two needle here line three');
  });

  test('multi-word query centers on the earliest matching word', () => {
    // Long enough that the 80-char window truncates the tail.
    const content = 'the second word appears before the first word here ' + 'z'.repeat(100);
    const res = extractSnippet(content, 'second first');
    expect(res.startsWith('the second')).toBe(true);
    expect(res.startsWith('...')).toBe(false);
    expect(res.endsWith('...')).toBe(true);
    expect(res).toContain('second');
  });

  test('matching is case-insensitive', () => {
    expect(extractSnippet('The Quick Brown Fox', 'QUICK')).toBe('The Quick Brown Fox');
  });

  test('whole short content with a match returns the content unchanged', () => {
    expect(extractSnippet('hello world', 'world')).toBe('hello world');
  });
});
