/**
 * PaperGroups: the six Papers tiles built on the classifier's categories.
 * The classifier is mocked so each test says what a paper "is".
 */
import type { DocumentRecord } from '../../database';
import { classifyDocument } from '../DocumentClassifier';
import {
  PAPER_GROUPS,
  PAPER_GROUP_LOOK,
  countByGroup,
  fileNameOf,
  groupOfCategory,
  matchesQuery,
  toPaper,
} from '../PaperGroups';

jest.mock('../DocumentClassifier', () => ({ classifyDocument: jest.fn() }));

const classify = classifyDocument as jest.Mock;

const doc = (over: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 1,
  title: 'Electricity bill',
  content: 'units consumed 120',
  filePath: '/storage/emulated/0/Download/bill%20march.pdf',
  type: 'DOCUMENT',
  detection_type: 'TEXT',
  timestamp: 1_700_000_000_000,
  ...over,
});

beforeEach(() => {
  classify.mockReset();
  classify.mockReturnValue({ category: 'GENERAL_DOCUMENT', label: 'Document', emoji: '', confidence: 50 });
});

describe('groupOfCategory', () => {
  it('puts the classifier categories into six plain groups', () => {
    expect(groupOfCategory('AADHAAR_CARD')).toBe('id');
    expect(groupOfCategory('PASSPORT')).toBe('id');
    expect(groupOfCategory('ELECTRICITY_BILL')).toBe('bills');
    expect(groupOfCategory('RECEIPT')).toBe('bills');
    expect(groupOfCategory('BANK_STATEMENT')).toBe('bank');
    expect(groupOfCategory('SALARY_SLIP')).toBe('bank');
    expect(groupOfCategory('MEDICAL_REPORT')).toBe('medical');
    expect(groupOfCategory('TAX_RETURN')).toBe('tax');
    expect(groupOfCategory('GENERAL_DOCUMENT')).toBe('other');
  });

  it('has a look (name, tag, icon, tint) for every tile, in tile order', () => {
    expect(PAPER_GROUPS).toEqual(['id', 'bills', 'bank', 'medical', 'tax', 'other']);
    for (const g of PAPER_GROUPS) {
      expect(PAPER_GROUP_LOOK[g].label).toMatch(/^papers\.cat\./);
      expect(PAPER_GROUP_LOOK[g].kind).toMatch(/^papers\.kind\./);
    }
  });
});

describe('fileNameOf', () => {
  it('takes the last part of a path and decodes it', () => {
    expect(fileNameOf('/a/b/bill%20march.pdf')).toBe('bill march.pdf');
    expect(fileNameOf('content://x/y/z.pdf')).toBe('z.pdf');
  });

  it('keeps a name that is not valid percent-encoding', () => {
    expect(fileNameOf('/a/100%.pdf')).toBe('100%.pdf');
  });
});

describe('toPaper', () => {
  it('uses the stored (masked) title and the classifier group', () => {
    classify.mockReturnValue({ category: 'ELECTRICITY_BILL', label: 'Bill', emoji: '', confidence: 90 });
    const p = toPaper(doc());
    expect(p.group).toBe('bills');
    expect(p.title).toBe('Electricity bill');
    expect(classify).toHaveBeenCalledWith('units consumed 120', 'bill march.pdf');
  });

  it('falls back to the file name without ".pdf" when there is no title', () => {
    expect(toPaper(doc({ title: '  ' })).title).toBe('bill march');
  });
});

describe('countByGroup', () => {
  it('counts papers per tile, with zeros for empty tiles', () => {
    classify
      .mockReturnValueOnce({ category: 'PAN_CARD' })
      .mockReturnValueOnce({ category: 'PAN_CARD' })
      .mockReturnValueOnce({ category: 'INVOICE' });
    const papers = [doc({ id: 1 }), doc({ id: 2 }), doc({ id: 3 })].map(toPaper);
    expect(countByGroup(papers)).toEqual({ id: 2, bills: 1, bank: 0, medical: 0, tax: 0, other: 0 });
  });
});

describe('matchesQuery', () => {
  const paper = () => toPaper(doc({ title: 'Light bill', content: 'Consumer number 4411' }));

  it('matches the title, file name or text, in any case', () => {
    expect(matchesQuery(paper(), 'LIGHT')).toBe(true);
    expect(matchesQuery(paper(), 'march')).toBe(true);
    expect(matchesQuery(paper(), '4411')).toBe(true);
    expect(matchesQuery(paper(), 'passport')).toBe(false);
  });

  it('matches everything for an empty query', () => {
    expect(matchesQuery(paper(), '   ')).toBe(true);
  });
});
