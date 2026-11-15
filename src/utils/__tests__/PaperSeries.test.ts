/**
 * Tests for src/utils/PaperSeries.ts: "latest" words in a query, the date
 * printed on a paper, the account number a series shares, and newest-first.
 */
import {
  isRecencyWord,
  newestFirst,
  paperDate,
  parseRecency,
  saysAnyOf,
  seriesKey,
  whenOf,
} from '../PaperSeries';
import type { DocumentRecord } from '../../database/types';

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
const NOW = at(2025, 11, 15);

let nextId = 1;
const paper = (content: string, extra: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: nextId++,
  content,
  filePath: `/docs/${nextId}.pdf`,
  type: 'DOCUMENT',
  detection_type: 'TEXT',
  timestamp: at(2025, 11, 1),
  takenAt: null,
  ...extra,
});

describe('parseRecency', () => {
  test.each([
    ['latest electricity bill', 'electricity bill', false],
    ['pichla bill', 'bill', false],
    ['Latest, bill', 'bill', false],
    ['most recent bank statement', 'bank statement', false],
    ['आख़िरी बिल', 'बिल', false],
    ['आखिरी बिल', 'बिल', false],
    ['सबसे नया बिजली बिल', 'बिजली बिल', true],
    ['sab se naya bill', 'bill', true],
    ['New India Assurance', 'India Assurance', true],
  ])('%s → "%s" (weak only: %s)', (query, rest, weakOnly) => {
    expect(parseRecency(query)).toMatchObject({ rest, weakOnly });
  });

  test('no "latest" words, no recency', () => {
    expect(parseRecency('electricity bill')).toBeNull();
    expect(parseRecency('')).toBeNull();
  });

  test('"latest photos" and "naye papers" ask for the newest of one kind', () => {
    expect(parseRecency('latest photos')).toMatchObject({ rest: '', only: 'IMAGE' });
    expect(parseRecency('naye papers')).toMatchObject({ rest: '', only: 'DOCUMENT', weakOnly: true });
    expect(parseRecency('latest')).toMatchObject({ rest: '' });
    expect(parseRecency('latest')?.only).toBeUndefined();
  });

  test('isRecencyWord', () => {
    expect(isRecencyWord('Latest')).toBe(true);
    expect(isRecencyWord('पिछला')).toBe(true);
    expect(isRecencyWord('naya')).toBe(true);
    expect(isRecencyWord('bill')).toBe(false);
  });
});

describe('saysAnyOf', () => {
  test('whole words of the title and text, any script', () => {
    expect(saysAnyOf(paper('The New India Assurance Co. Ltd'), ['new'])).toBe(true);
    expect(saysAnyOf(paper('Newark office'), ['new'])).toBe(false);
    expect(saysAnyOf(paper('नया कनेक्शन'), ['नया'])).toBe(true);
    expect(saysAnyOf(paper('bill', { title: 'Last date notice' }), ['last'])).toBe(true);
  });
});

describe('paperDate', () => {
  test('the bill date comes before the due date', () => {
    expect(paperDate(paper('BSES Bill Date: 05/10/2025 Due Date: 20/10/2025'), NOW)).toBe(at(2025, 10, 5));
  });

  test('the bill month, when no day is printed', () => {
    expect(paperDate(paper('Bill Month: OCT-2025 Amount 1,240'), NOW)).toBe(at(2025, 10, 1));
    expect(paperDate(paper('Bill for the month of September 2025'), NOW)).toBe(at(2025, 9, 1));
    expect(paperDate(paper('Billing month 08/2025'), NOW)).toBe(at(2025, 8, 1));
  });

  test('else the due date, else the billing period', () => {
    expect(paperDate(paper('Pay by 12 Nov 2025'), NOW)).toBe(at(2025, 11, 12));
    expect(paperDate(paper('Billing period 01-09-2025 to 30-09-2025'), NOW)).toBe(at(2025, 9, 1));
  });

  test('in Hindi', () => {
    expect(paperDate(paper('बिल दिनांक 05/10/2025 देय तिथि 20/10/2025'), NOW)).toBe(at(2025, 10, 5));
  });

  test('an unlabelled date is not trusted', () => {
    expect(paperDate(paper('Thank you 05/10/2025 for your order'), NOW)).toBeNull();
    expect(paperDate(paper(''), NOW)).toBeNull();
  });

  test('a misread year far after the photo is dropped', () => {
    const photo = paper('Bill Date: 05/10/2052', { takenAt: at(2025, 10, 6) });
    expect(paperDate(photo, NOW)).toBeNull();
    // A due date a few weeks after the photo is fine.
    expect(paperDate(paper('Due Date: 20/10/2025', { takenAt: at(2025, 10, 6) }), NOW)).toBe(at(2025, 10, 20));
  });

  test('whenOf falls back to when the photo was taken, then to when it was indexed', () => {
    expect(whenOf(paper('no date here', { takenAt: at(2025, 7, 1) }), NOW)).toBe(at(2025, 7, 1));
    expect(whenOf(paper('no date here', { timestamp: at(2025, 6, 1) }), NOW)).toBe(at(2025, 6, 1));
  });
});

describe('seriesKey', () => {
  test.each([
    ['Consumer No: 150123456 Bill Date 05/10/2025', '150123456'],
    ['Consumer Name: R. Kumar Consumer No. 150123456', '150123456'],
    ['CA No. 1501 23456', '150123456'],
    ['Consumer No: 15O123456', '150123456'],
    ['Consumer No: ******3210', '******3210'],
    ['Card No XXXX XXXX XXXX 1234 Statement Date 02/11/2025', 'XXXXXXXXXXXX1234'],
    ['Policy No. P/211114/01/2025/012345', 'P211114012025012345'],
    ['उपभोक्ता संख्या: 4512 3456 7890', '451234567890'],
    ['K No: 210345678901', '210345678901'],
  ])('%s → %s', (text, key) => {
    expect(seriesKey(paper(text))).toBe(key);
  });

  test('no labelled number, no series', () => {
    expect(seriesKey(paper('Apollo pharmacy tablets 500 mg'))).toBeNull();
    expect(seriesKey(paper('Bank Note 12345 printed'))).toBeNull();
    expect(seriesKey(paper('Account No: pending'))).toBeNull();
  });
});

describe('newestFirst', () => {
  const bses = (month: number) => paper(`BSES Consumer No: 150123456 Bill Date: 05/${month}/2025`);

  test('the newest of each series first, then the older ones', () => {
    const aug = bses(8);
    const sep = bses(9);
    const oct = bses(10);
    const policy = paper('Star Health Policy No. 1122334455 Issue Date 10/03/2025');
    const receipt = paper('Receipt', { takenAt: at(2025, 7, 1) });
    const order = newestFirst([aug, policy, oct, receipt, sep], NOW).map(d => d.id);
    expect(order).toEqual([oct, receipt, policy, sep, aug].map(d => d.id));
  });

  test('two connections: each one\'s latest bill leads', () => {
    const a = (m: number) => paper(`Consumer No: 111222333 Bill Date: 05/${m}/2025`);
    const b = (m: number) => paper(`Consumer No: 999888777 Bill Date: 07/${m}/2025`);
    const [a10, a9, b9, b8] = [a(10), a(9), b(9), b(8)];
    expect(newestFirst([b8, a9, b9, a10], NOW).map(d => d.id)).toEqual([a10, b9, a9, b8].map(d => d.id));
  });

  test('papers with the same date keep their search order', () => {
    const x = paper('one', { takenAt: at(2025, 5, 1) });
    const y = paper('two', { takenAt: at(2025, 5, 1) });
    expect(newestFirst([y, x], NOW).map(d => d.id)).toEqual([y.id, x.id]);
    expect(newestFirst([], NOW)).toEqual([]);
  });
});
