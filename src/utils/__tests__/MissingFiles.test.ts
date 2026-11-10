/**
 * Tests for MissingFiles — removing photos and PDFs deleted from the phone.
 *
 * Real database code over the in-memory op-sqlite mock; RNFS.stat (root
 * __mocks__) decides which files exist; PermissionsAndroid.check and
 * StorageModule.hasAllFilesAccess decide what we may look at.
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import * as OpSqlite from '@op-engineering/op-sqlite';

import { forgetIfGone, pruneMissingFiles } from '../MissingFiles';
import { IMPORTED_PDF_DIR } from '../PdfImport';
import { closeDatabase, setupDatabase } from '../../database/connection';
import { indexDocument, isFileIndexed } from '../../database/documents';

jest.mock('../AppLogger', () => ({
  AppLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const { __resetAll } = OpSqlite as unknown as { __resetAll: () => void };
const statMock = RNFS.stat as jest.Mock;
const hasAllFiles = NativeModules.StorageModule.hasAllFilesAccess as jest.Mock;

const PHOTO = 'content://media/external/images/media/1';
const GONE_PHOTO = 'content://media/external/images/media/2';
const DOWNLOAD_PDF = 'file:///storage/emulated/0/Download/gone.pdf';
const OWN_PDF = `file://${IMPORTED_PDF_DIR}/gone-1a.pdf`;

/** Files in `gone` don't exist; everything else does. */
const existsExcept = (gone: string[]) =>
  statMock.mockImplementation(async (path: string) => {
    if (gone.includes(path)) throw new Error('File does not exist');
    return { size: 1 };
  });

let check: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true, writable: true });
  Object.defineProperty(Platform, 'Version', { value: 34, configurable: true, writable: true });
  // Full photo access by default
  check = jest.spyOn(PermissionsAndroid, 'check').mockImplementation(async (perm: string) =>
    perm === PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES);
  hasAllFiles.mockResolvedValue(true);
  closeDatabase();
  __resetAll();
  setupDatabase();
  for (const uri of [PHOTO, GONE_PHOTO]) indexDocument(null, `photo ${uri}`, uri, 'IMAGE', 'TEXT');
  for (const uri of [DOWNLOAD_PDF, OWN_PDF]) indexDocument('PDF', `pdf ${uri}`, uri, 'DOCUMENT', 'TEXT');
});

afterEach(() => {
  check.mockRestore();
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true, writable: true });
});

describe('pruneMissingFiles', () => {
  test('removes deleted photos and PDFs and keeps the rest', async () => {
    existsExcept([GONE_PHOTO, DOWNLOAD_PDF, OWN_PDF]);

    await expect(pruneMissingFiles()).resolves.toBe(3);

    expect(isFileIndexed(PHOTO)).toBe(true);
    expect(isFileIndexed(GONE_PHOTO)).toBe(false);
    expect(isFileIndexed(DOWNLOAD_PDF)).toBe(false);
    expect(isFileIndexed(OWN_PDF)).toBe(false);
  });

  test('with only "Select photos" access, photos are never checked or removed', async () => {
    check.mockImplementation(async (perm: string) =>
      perm === PermissionsAndroid.PERMISSIONS.READ_MEDIA_VISUAL_USER_SELECTED);
    existsExcept([PHOTO, GONE_PHOTO]);

    await expect(pruneMissingFiles()).resolves.toBe(0);

    expect(isFileIndexed(PHOTO)).toBe(true);
    expect(isFileIndexed(GONE_PHOTO)).toBe(true);
    expect(statMock).not.toHaveBeenCalledWith(PHOTO);
  });

  test('without All Files Access, only copies in app storage are checked', async () => {
    hasAllFiles.mockResolvedValue(false);
    existsExcept([DOWNLOAD_PDF, OWN_PDF]);

    await expect(pruneMissingFiles()).resolves.toBe(1);

    expect(isFileIndexed(DOWNLOAD_PDF)).toBe(true);
    expect(isFileIndexed(OWN_PDF)).toBe(false);
  });

  test('errors other than "does not exist" keep the row', async () => {
    statMock.mockRejectedValue(new Error('Permission Denial: reading MediaProvider'));

    await expect(pruneMissingFiles()).resolves.toBe(0);

    expect(isFileIndexed(GONE_PHOTO)).toBe(true);
  });

  test('stops when cancelled', async () => {
    const cancel = { current: false };
    statMock.mockImplementation(async () => {
      cancel.current = true;
      throw new Error('File does not exist');
    });

    await expect(pruneMissingFiles(cancel)).resolves.toBe(1);
    expect(statMock).toHaveBeenCalledTimes(1);
  });
});

describe('forgetIfGone', () => {
  test('removes a deleted file and says so', async () => {
    existsExcept([GONE_PHOTO]);
    await expect(forgetIfGone(GONE_PHOTO, 'IMAGE')).resolves.toBe(true);
    expect(isFileIndexed(GONE_PHOTO)).toBe(false);
  });

  test('keeps a file that is still there', async () => {
    existsExcept([]);
    await expect(forgetIfGone(PHOTO, 'IMAGE')).resolves.toBe(false);
    expect(isFileIndexed(PHOTO)).toBe(true);
  });
});
