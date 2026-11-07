/**
 * PdfImport — the ways Pinpointer gets PDFs without "All files access":
 *
 *  - a folder the user picked once (kept across restarts),
 *  - PDFs picked one by one (how files in Download are reached, since
 *    Android 11+ won't let any app pick the Download folder itself),
 *  - PDFs shared to Pinpointer from other apps.
 *
 * Native code (DocumentAccessModule) copies each PDF into
 * `<app files>/imported_pdfs/`, so the document scanner only has to add
 * that one folder and the rest of the pipeline works unchanged.
 */
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { AppLogger } from './AppLogger';

/** Read on each call, so a module registered after import is still found. */
const native = () => NativeModules.DocumentAccessModule;

/** Folder inside app storage that holds the copies. */
export const IMPORTED_PDF_DIR = `${RNFS.DocumentDirectoryPath}/imported_pdfs`;
/** Emitted by native when PDFs are shared to Pinpointer. */
export const SHARED_PDFS_EVENT = 'PinpointerSharedPdfs';

const FOLDER_DEPTH = 4;

export type PdfFolder = { uri: string; name: string };

/** True on Android builds that include the native module. */
export const isPdfImportAvailable = (): boolean =>
    Platform.OS === 'android' && !!native();

/** False when the build no longer declares All Files Access (e.g. a Play build without it). */
export const canRequestAllFilesAccess = async (): Promise<boolean> => {
    if (!isPdfImportAvailable()) return true; // older native build: keep the old behaviour
    try {
        return !!(await native().canRequestAllFilesAccess());
    } catch {
        return true;
    }
};

/** Folders the user picked that Pinpointer can still read. */
export const listPdfFolders = async (): Promise<PdfFolder[]> => {
    if (!isPdfImportAvailable()) return [];
    try {
        return (await native().listPdfFolders()) ?? [];
    } catch (e) {
        AppLogger.warn('PdfImport', 'Could not list picked folders', e);
        return [];
    }
};

/** Opens the system folder picker. Resolves with the folder, or null if cancelled. */
export const pickPdfFolder = async (): Promise<PdfFolder | null> => {
    if (!isPdfImportAvailable()) return null;
    try {
        return (await native().pickPdfFolder()) ?? null;
    } catch (e) {
        AppLogger.warn('PdfImport', 'Folder picker failed', e);
        return null;
    }
};

/** Opens the system file picker for PDFs. Resolves with how many were added. */
export const pickPdfFiles = async (): Promise<number> => {
    if (!isPdfImportAvailable()) return 0;
    try {
        const paths: string[] = (await native().pickPdfFiles()) ?? [];
        return paths.length;
    } catch (e) {
        AppLogger.warn('PdfImport', 'File picker failed', e);
        return 0;
    }
};

/** Stops using a picked folder. PDFs already indexed stay searchable. */
export const forgetPdfFolder = async (uri: string): Promise<void> => {
    if (!isPdfImportAvailable()) return;
    try {
        await native().forgetPdfFolder(uri);
    } catch (e) {
        AppLogger.warn('PdfImport', 'Could not forget folder', e);
    }
};

/**
 * Brings the copies of every picked folder up to date and returns the
 * folders the document scanner should add. Unchanged PDFs are not copied
 * again. A folder that can't be read (deleted, access removed) is skipped.
 */
export const prepareImportedPdfs = async (): Promise<string[]> => {
    if (!isPdfImportAvailable()) return [];
    for (const folder of await listPdfFolders()) {
        try {
            await native().importPdfFolder(folder.uri, FOLDER_DEPTH);
        } catch (e) {
            AppLogger.warn('PdfImport', `Skipping folder ${folder.name}`, e);
        }
    }
    return [IMPORTED_PDF_DIR];
};

/** PDFs shared to Pinpointer that haven't been handled yet. */
export const takeSharedPdfs = async (): Promise<string[]> => {
    if (!isPdfImportAvailable()) return [];
    try {
        return (await native().takeSharedPdfs()) ?? [];
    } catch {
        return [];
    }
};

/**
 * Calls `onShared(count)` for PDFs shared to Pinpointer, both those that
 * arrived before the app was ready and later ones. Returns an unsubscribe.
 */
export const subscribeToSharedPdfs = (onShared: (count: number) => void): (() => void) => {
    if (!isPdfImportAvailable()) return () => {};
    const handle = async () => {
        const paths = await takeSharedPdfs();
        if (paths.length > 0) onShared(paths.length);
    };
    const sub = DeviceEventEmitter.addListener(SHARED_PDFS_EVENT, handle);
    handle();
    return () => sub.remove();
};
