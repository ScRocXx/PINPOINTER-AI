/**
 * Tests for PdfImport — picked folders, picked files and Share to Pinpointer.
 * DocumentAccessModule is installed on NativeModules per test; without it
 * every function must be a harmless no-op (iOS, or an older native build).
 */
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';

import {
    IMPORTED_PDF_DIR,
    SHARED_PDFS_EVENT,
    canRequestAllFilesAccess,
    forgetPdfFolder,
    isPdfImportAvailable,
    listPdfFolders,
    pickPdfFiles,
    pickPdfFolder,
    prepareImportedPdfs,
    subscribeToSharedPdfs,
    takeSharedPdfs,
} from '../PdfImport';

jest.mock('../AppLogger', () => ({
    AppLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const nativeMock = () => ({
    canRequestAllFilesAccess: jest.fn(async () => true),
    listPdfFolders: jest.fn(async () => [{ uri: 'content://tree/Documents', name: 'Documents' }]),
    pickPdfFolder: jest.fn(async () => ({ uri: 'content://tree/Bills', name: 'Bills' })),
    pickPdfFiles: jest.fn(async () => ['/files/imported_pdfs/a-1.pdf', '/files/imported_pdfs/b-2.pdf']),
    forgetPdfFolder: jest.fn(async () => true),
    importPdfFolder: jest.fn(async () => 3),
    takeSharedPdfs: jest.fn(async () => [] as string[]),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
});

let native: ReturnType<typeof nativeMock>;
const modules = NativeModules as Record<string, unknown>;

const setOS = (os: 'android' | 'ios') =>
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });

beforeEach(() => {
    native = nativeMock();
    modules.DocumentAccessModule = native;
    setOS('android');
});

afterEach(() => {
    delete modules.DocumentAccessModule;
    setOS('ios');
    jest.restoreAllMocks();
});

// PdfImport reads NativeModules.DocumentAccessModule when it is first
// imported, so load a fresh copy for the "no module" cases.
const loadWithoutModule = () => {
    delete modules.DocumentAccessModule;
    let mod: typeof import('../PdfImport') | undefined;
    jest.isolateModules(() => {
        mod = require('../PdfImport');
    });
    return mod!;
};

describe('without the native module', () => {
    it('is a no-op everywhere', async () => {
        const m = loadWithoutModule();
        expect(m.isPdfImportAvailable()).toBe(false);
        expect(await m.listPdfFolders()).toEqual([]);
        expect(await m.pickPdfFolder()).toBeNull();
        expect(await m.pickPdfFiles()).toBe(0);
        expect(await m.prepareImportedPdfs()).toEqual([]);
        expect(await m.takeSharedPdfs()).toEqual([]);
        expect(await m.canRequestAllFilesAccess()).toBe(true); // keep the old All Files flow
        const unsubscribe = m.subscribeToSharedPdfs(jest.fn());
        expect(typeof unsubscribe).toBe('function');
        unsubscribe();
    });
});

describe('with the native module', () => {
    it('keeps copies in app storage', () => {
        expect(IMPORTED_PDF_DIR).toBe(`${RNFS.DocumentDirectoryPath}/imported_pdfs`);
    });

    it('is only available on Android', () => {
        expect(isPdfImportAvailable()).toBe(true);
        setOS('ios');
        expect(isPdfImportAvailable()).toBe(false);
    });

    it('reports whether All Files Access is still in the build', async () => {
        expect(await canRequestAllFilesAccess()).toBe(true);
        native.canRequestAllFilesAccess.mockResolvedValue(false);
        expect(await canRequestAllFilesAccess()).toBe(false);
    });

    it('lists, picks and forgets folders', async () => {
        expect(await listPdfFolders()).toEqual([{ uri: 'content://tree/Documents', name: 'Documents' }]);
        expect(await pickPdfFolder()).toEqual({ uri: 'content://tree/Bills', name: 'Bills' });
        await forgetPdfFolder('content://tree/Bills');
        expect(native.forgetPdfFolder).toHaveBeenCalledWith('content://tree/Bills');
    });

    it('treats a cancelled or failing picker as nothing picked', async () => {
        native.pickPdfFolder.mockResolvedValue(null as never);
        expect(await pickPdfFolder()).toBeNull();
        native.pickPdfFolder.mockRejectedValue(new Error('NO_ACTIVITY'));
        expect(await pickPdfFolder()).toBeNull();
        native.pickPdfFiles.mockRejectedValue(new Error('PICKER_BUSY'));
        expect(await pickPdfFiles()).toBe(0);
    });

    it('counts the PDFs picked one by one', async () => {
        expect(await pickPdfFiles()).toBe(2);
    });

    it('refreshes every picked folder before a scan and returns the copies folder', async () => {
        native.listPdfFolders.mockResolvedValue([
            { uri: 'content://tree/A', name: 'A' },
            { uri: 'content://tree/B', name: 'B' },
        ]);
        expect(await prepareImportedPdfs()).toEqual([IMPORTED_PDF_DIR]);
        expect(native.importPdfFolder).toHaveBeenCalledWith('content://tree/A', 4);
        expect(native.importPdfFolder).toHaveBeenCalledWith('content://tree/B', 4);
    });

    it('skips a folder that can no longer be read and still returns the copies folder', async () => {
        native.listPdfFolders.mockResolvedValue([
            { uri: 'content://tree/Gone', name: 'Gone' },
            { uri: 'content://tree/B', name: 'B' },
        ]);
        native.importPdfFolder.mockRejectedValueOnce(new Error('FOLDER_UNREADABLE'));
        expect(await prepareImportedPdfs()).toEqual([IMPORTED_PDF_DIR]);
        expect(native.importPdfFolder).toHaveBeenCalledTimes(2);
    });

    it('still scans earlier copies when no folder is picked', async () => {
        native.listPdfFolders.mockResolvedValue([]);
        expect(await prepareImportedPdfs()).toEqual([IMPORTED_PDF_DIR]);
        expect(native.importPdfFolder).not.toHaveBeenCalled();
    });

    it('hands over PDFs shared before the app was ready, then later ones', async () => {
        const listeners: Array<() => void> = [];
        const remove = jest.fn();
        jest.spyOn(DeviceEventEmitter, 'addListener').mockImplementation(((event: string, cb: () => void) => {
            expect(event).toBe(SHARED_PDFS_EVENT);
            listeners.push(cb);
            return { remove } as never;
        }) as never);
        native.takeSharedPdfs
            .mockResolvedValueOnce(['/files/imported_pdfs/early.pdf'])
            .mockResolvedValueOnce(['/x/1.pdf', '/x/2.pdf']);
        const onShared = jest.fn();

        const unsubscribe = subscribeToSharedPdfs(onShared);
        await flush();
        expect(onShared).toHaveBeenCalledWith(1);

        listeners[0]();
        await flush();
        expect(onShared).toHaveBeenLastCalledWith(2);

        unsubscribe();
        expect(remove).toHaveBeenCalled();
    });

    it('does not report an empty share', async () => {
        jest.spyOn(DeviceEventEmitter, 'addListener').mockReturnValue({ remove: jest.fn() } as never);
        const onShared = jest.fn();
        subscribeToSharedPdfs(onShared);
        await flush();
        expect(onShared).not.toHaveBeenCalled();
        expect(await takeSharedPdfs()).toEqual([]);
    });
});
