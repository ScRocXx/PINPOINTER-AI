/**
 * Tests for src/utils/Duplicates.ts: reading a photo's fingerprint through
 * PhotoReader, and showing byte-identical copies once in results.
 */
import { NativeModules } from 'react-native';
import { collapseCopies, fingerprintOf } from '../Duplicates';
import type { DocumentRecord } from '../../database/types';

const doc = (filePath: string): DocumentRecord => ({
  id: filePath.length,
  content: 'gas cylinder receipt',
  filePath,
  type: 'IMAGE',
  detection_type: 'TEXT',
  timestamp: 1000,
});

afterEach(() => {
  delete (NativeModules as Record<string, unknown>).PhotoReader;
  jest.restoreAllMocks();
});

describe('fingerprintOf', () => {
  test('returns what PhotoReader says', async () => {
    const fingerprint = jest.fn(async () => '0a1b:2048');
    (NativeModules as Record<string, unknown>).PhotoReader = { fingerprint };
    await expect(fingerprintOf('content://media/1')).resolves.toBe('0a1b:2048');
    expect(fingerprint).toHaveBeenCalledWith('content://media/1');
  });

  test('is null without the native reader (older builds, tests)', async () => {
    await expect(fingerprintOf('content://media/1')).resolves.toBeNull();
  });

  test('is null when the file cannot be read, or the answer is empty', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    (NativeModules as Record<string, unknown>).PhotoReader = {
      fingerprint: jest.fn(async () => {
        throw new Error('gone');
      }),
    };
    await expect(fingerprintOf('content://media/1')).resolves.toBeNull();
    (NativeModules as Record<string, unknown>).PhotoReader = { fingerprint: jest.fn(async () => '') };
    await expect(fingerprintOf('content://media/1')).resolves.toBeNull();
  });
});

describe('collapseCopies', () => {
  const docs = ['/wa/received.jpg', '/camera/bill.jpg', '/wa/sent.jpg', '/downloads/received.jpg'].map(doc);

  test('keeps each copy once, where it first ranks', () => {
    const fps = new Map([
      ['/wa/received.jpg', 'x:1'],
      ['/wa/sent.jpg', 'x:1'],
      ['/downloads/received.jpg', 'x:1'],
      ['/camera/bill.jpg', 'y:1'],
    ]);
    expect(collapseCopies(docs, fps).map(d => d.filePath)).toEqual(['/wa/received.jpg', '/camera/bill.jpg']);
  });

  test('files without a fingerprint always stay, even when they say the same thing', () => {
    const fps = new Map([['/wa/received.jpg', 'x:1']]);
    expect(collapseCopies(docs, fps)).toHaveLength(4);
    expect(collapseCopies(docs, new Map())).toBe(docs);
  });
});
