import { Linking, NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import type { DocumentRecord } from '../../../database';
import { forgetIfGone } from '../../../utils/MissingFiles';
import { describeResult, fileNameOf, paperKind } from '../resultInfo';
import { openResult } from '../openResult';

jest.mock('../../../utils/MissingFiles', () => ({ forgetIfGone: jest.fn(async () => false) }));

const record = (over: Partial<DocumentRecord>): DocumentRecord => ({
  id: 1,
  content: '',
  filePath: 'file:///x',
  type: 'IMAGE',
  detection_type: 'TEXT',
  timestamp: 1700000000000,
  ...over,
});

describe('paperKind', () => {
  it('gives each kind of paper its icon, tint and word', () => {
    expect(paperKind('AADHAAR_CARD')).toEqual({ icon: 'idCard', tint: 'id', label: 'papers.kind.id' });
    expect(paperKind('ELECTRICITY_BILL').label).toBe('papers.kind.bill');
    expect(paperKind('SALARY_SLIP').tint).toBe('bank');
    expect(paperKind('MEDICAL_REPORT').icon).toBe('medicine');
    expect(paperKind('TAX_RETURN').label).toBe('papers.kind.tax');
  });

  it('leaves a plain paper without a second word', () => {
    expect(paperKind('GENERAL_DOCUMENT')).toEqual({ icon: 'papers', tint: 'other', label: null });
  });
});

describe('fileNameOf', () => {
  it('reads a clean name from a path', () => {
    expect(fileNameOf('file:///storage/Download/Light_Bill%20March.PDF')).toBe('Light Bill March');
  });

  it('keeps a name with a stray % instead of crashing', () => {
    expect(fileNameOf('file:///storage/Download/50% off_offer.pdf')).toBe('50% off offer');
  });
});

describe('describeResult', () => {
  it('starts a photo snippet at the first matched word', () => {
    const info = describeResult(
      record({ content: 'Paid at the counter. Electricity bill for March, amount 1240.' }),
      'bill',
    );
    expect(info.isPhoto).toBe(true);
    expect(info.title).toBeNull();
    expect(info.wordsMatch).toBe(true);
    expect(info.snippet.startsWith('bill for March')).toBe(true);
    expect(info.terms).toContain('bill');
  });

  it('matches across scripts', () => {
    const info = describeResult(record({ content: 'भारत सरकार आधार कार्ड' }), 'aadhaar');
    expect(info.terms).toContain('आधार');
    expect(info.snippet.startsWith('आधार')).toBe(true);
  });

  it('keeps labels whole and marks them as what the photo shows', () => {
    const info = describeResult(record({ detection_type: 'OBJECT', content: 'Dog,  Grass' }), 'dog');
    expect(info.isLabels).toBe(true);
    expect(info.snippet).toBe('Dog, Grass');
  });

  it('says when a photo only looks similar', () => {
    const info = describeResult(record({ content: 'happy birthday' }), 'beach');
    expect(info.wordsMatch).toBe(false);
    expect(info.terms).toEqual([]);
  });

  it('gives a paper its stored title, kind and matched words from title and text', () => {
    const info = describeResult(
      record({
        type: 'DOCUMENT',
        title: 'Electricity bill March',
        content: 'Consumer number 4411. Amount due 1240.',
        filePath: 'file:///docs/scan_001.pdf',
      }),
      'bill amount',
    );
    expect(info.isPhoto).toBe(false);
    expect(info.title).toBe('Electricity bill March');
    expect(info.terms).toEqual(expect.arrayContaining(['bill', 'Amount']));
    expect(info.snippet.startsWith('Amount due')).toBe(true);
    expect(info.kind).not.toBeNull();
  });

  it('falls back to the file name when a paper has no title', () => {
    const info = describeResult(
      record({ type: 'DOCUMENT', title: '  ', content: 'x', filePath: 'file:///docs/Rent_Agreement.pdf' }),
      'rent',
    );
    expect(info.title).toBe('Rent Agreement');
  });

  it('masks an ID number in a file name used as the title', () => {
    const info = describeResult(
      record({ type: 'DOCUMENT', title: '', content: 'x', filePath: 'file:///docs/Aadhaar 1234 5678 9012.pdf' }),
      'aadhaar',
    );
    expect(info.title).not.toMatch(/1234 5678/);
    expect(info.title).toMatch(/9012$/);
  });
});

describe('openResult', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
  });

  it('lets a photo open once the file is known to be there', async () => {
    await expect(openResult(record({ filePath: 'content://media/1' }))).resolves.toBe('open');
    expect(forgetIfGone).toHaveBeenCalledWith('content://media/1', 'IMAGE');
    expect(NativeModules.StorageModule.openPDF).not.toHaveBeenCalled();
  });

  it('reports a deleted file as gone and opens nothing', async () => {
    (forgetIfGone as jest.Mock).mockResolvedValueOnce(true);
    await expect(openResult(record({ type: 'DOCUMENT', filePath: 'file:///docs/a.pdf' }))).resolves.toBe('gone');
    expect(NativeModules.StorageModule.openPDF).not.toHaveBeenCalled();
  });

  it('opens a paper in the PDF app', async () => {
    await expect(openResult(record({ type: 'DOCUMENT', filePath: 'file:///docs/a.pdf' }))).resolves.toBe('open');
    expect(NativeModules.StorageModule.openPDF).toHaveBeenCalledWith('/docs/a.pdf');
  });

  it('reports a paper it cannot see as failed, not gone, so it stays in search', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    await expect(openResult(record({ type: 'DOCUMENT', filePath: 'file:///docs/a.pdf' }))).resolves.toBe('failed');
    expect(NativeModules.StorageModule.openPDF).not.toHaveBeenCalled();
  });

  it('falls back to the system when the native opener is missing, and reports failures', async () => {
    const saved = NativeModules.StorageModule.openPDF;
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('no app'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // openResult reads StorageModule when the file loads, so swap the method.
      NativeModules.StorageModule.openPDF = undefined;
      await expect(openResult(record({ type: 'DOCUMENT', filePath: 'file:///docs/a.pdf' }))).resolves.toBe('failed');
      expect(open).toHaveBeenCalledWith('file:///docs/a.pdf');
    } finally {
      NativeModules.StorageModule.openPDF = saved;
    }
  });
});
