/**
 * End-to-end Indian-language search: what gets stored, how Hindi, Hinglish
 * and English queries find each other, PII in Indian digits, and the
 * migration that upgrades existing rows. Runs on the real database modules
 * over the in-memory op-sqlite mock, like search.test.ts.
 */
import * as connection from '../connection';
import { getAllDocuments, indexDocument } from '../documents';
import { searchDocuments } from '../search';
import { SEARCH_TAIL_MARK } from '../../utils/SearchKeys';
import type { DocumentRecord } from '../types';
// __resetAll is declared on the module by search.test.ts's augmentation
import { __resetAll, open } from '@op-engineering/op-sqlite';

interface MockDoc { id: number; title: string | null; content: string; filePath: string }
interface MockDb { documents: MockDoc[]; userVersion: number }
const mockDb = (): MockDb => open({ name: 'pinpoint.db' }) as unknown as MockDb;

const paths = (docs: DocumentRecord[]): string[] => docs.map(d => d.filePath);

const CORPUS: Array<[string | null, string, string, 'IMAGE' | 'DOCUMENT']> = [
  [null, 'BSES Electricity Bill consumer no due date', '/photos/bses.jpg', 'IMAGE'],
  [null, 'दवाई की पर्ची डॉक्टर शर्मा', '/photos/parchi.jpg', 'IMAGE'],
  [null, 'Apollo Pharmacy tablets paracetamol', '/photos/pharmacy.jpg', 'IMAGE'],
  [null, 'बैंक पासबुक खाता', '/photos/passbook.jpg', 'IMAGE'],
  [null, 'beach sunset goa', '/photos/goa.jpg', 'IMAGE'],
];

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  __resetAll();
  connection.closeDatabase();
  connection.setupDatabase();
  for (const [title, content, filePath, type] of CORPUS) {
    indexDocument(title, content, filePath, type, 'TEXT');
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('what indexDocument stores', () => {
  test('appends a search tail with sound keys and concept ids', () => {
    const row = mockDb().documents.find(d => d.filePath === '/photos/bses.jpg');
    expect(row?.content).toContain(SEARCH_TAIL_MARK);
    expect(row?.content).toContain('qcelectricity');
    expect(row?.content).toContain('qcbill');
  });

  test('results never show the tail', () => {
    for (const doc of searchDocuments('bill')) {
      expect(doc.content).not.toContain(SEARCH_TAIL_MARK);
      expect(doc.content).not.toMatch(/\bqk|\bqc/);
    }
  });

  test('masks an Aadhaar number written in Hindi digits', () => {
    indexDocument(null, 'आधार ४५६७ ८९०१ २३४५', '/photos/aadhaar.jpg', 'IMAGE', 'TEXT');
    const row = mockDb().documents.find(d => d.filePath === '/photos/aadhaar.jpg');
    expect(row?.content).toContain('****-****-2345');
    expect(row?.content).not.toContain('4567');
    expect(row?.content).not.toContain('४५६७');
  });
});

describe('Hindi, Hinglish and English find each other', () => {
  test('a Hindi query finds an English bill', () => {
    expect(paths(searchDocuments('बिजली बिल'))).toContain('/photos/bses.jpg');
  });

  test('a Hinglish query finds an English bill', () => {
    expect(paths(searchDocuments('bijli bill'))).toContain('/photos/bses.jpg');
  });

  test('typed Hinglish finds Hindi text', () => {
    expect(paths(searchDocuments('dawai'))).toContain('/photos/parchi.jpg');
    expect(paths(searchDocuments('parchi'))).toContain('/photos/parchi.jpg');
  });

  test('an English query finds Hindi text', () => {
    expect(paths(searchDocuments('medicine'))).toContain('/photos/parchi.jpg');
    expect(paths(searchDocuments('bank'))).toContain('/photos/passbook.jpg');
  });

  test('a Hindi query finds English text through the concept', () => {
    expect(paths(searchDocuments('दवाई'))).toEqual(
      expect.arrayContaining(['/photos/parchi.jpg', '/photos/pharmacy.jpg']),
    );
  });

  test('Hindi digits in a query match ASCII digits in text', () => {
    indexDocument(null, 'Bill 2024 March', '/photos/bill2024.jpg', 'IMAGE', 'TEXT');
    expect(paths(searchDocuments('बिल २०२४'))).toContain('/photos/bill2024.jpg');
  });

  test('unrelated queries still miss', () => {
    expect(paths(searchDocuments('बिजली'))).not.toContain('/photos/goa.jpg');
  });
});

describe('migration 2 (existing installs)', () => {
  test('adds tails to old rows, re-masks Hindi digits and keeps content readable', () => {
    const db = mockDb();
    // Simulate a row written by an older build: no tail, unmasked Hindi digits
    db.documents.push({ id: 900, title: null, content: 'बिजली ४५६७ ८९०१ २३४५', filePath: '/old.jpg' } as MockDoc);
    db.userVersion = 1;
    connection.closeDatabase();
    connection.setupDatabase();

    const row = mockDb().documents.find(d => d.filePath === '/old.jpg');
    expect(row?.content).toContain('qcelectricity');
    expect(row?.content).toContain('****-****-2345');
    expect(connection.getSchemaVersion()).toBe(connection.SCHEMA_VERSION);
    expect(paths(searchDocuments('electricity'))).toContain('/old.jpg');
  });

  test('vault listing shows content without the tail', () => {
    indexDocument('Bill', 'electricity bill', '/docs/bill.pdf', 'DOCUMENT', 'TEXT');
    const vault = getAllDocuments();
    expect(vault[0].content).toBe('electricity bill');
  });
});
