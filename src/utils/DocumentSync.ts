/**
 * PDF sync engine: finds PDFs in Download/ and Documents/ and runs each one
 * the files table says still needs work through the document pipeline.
 *
 * Plain TypeScript with no React, so IndexingService can run it in its queue.
 * The permission prompt stays in useDocumentSync (it is UI).
 */
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { isFileIndexed, noteFileSeen, markOcrDone, markStageFailed } from '../database';
import { processPDF } from './DocumentPipeline';
import { prepareImportedPdfs } from './PdfImport';
import { AppLogger } from './AppLogger';
import { isQuiet, waitForQuiet } from '../services/InteractionGate';

const MAX_DEPTH = 4;

/** Result of one document sync run. */
export type DocumentSyncResult =
    | { status: 'blocked' }                         // no PDFs found (access is checked by the hook first)
    | { status: 'done'; processed: number; total: number; wasCancelled: boolean };

/**
 * Recursively lists PDFs in the standard user folders (depth 4, hidden
 * folders skipped). Returns null when nothing was found, which on Android
 * usually means scoped storage blocked the scan.
 */
export const scanForPDFs = async (): Promise<RNFS.ReadDirItem[] | null> => {
    const pdfFiles: RNFS.ReadDirItem[] = [];

    const scanRecursive = async (dirPath: string, currentDepth: number) => {
        if (currentDepth > MAX_DEPTH) return;
        try {
            const items = await RNFS.readDir(dirPath);
            for (const item of items) {
                if (item.isDirectory()) {
                    if (item.name.startsWith('.')) continue; // Skip hidden folders
                    await scanRecursive(item.path, currentDepth + 1);
                } else if (item.isFile() && item.name.toLowerCase().endsWith('.pdf')) {
                    pdfFiles.push(item);
                }
            }
        } catch {
            // Ignore per-directory scan errors (e.g. EACCES under scoped
            // storage); remaining directories are still scanned.
        }
    };

    // Target standard user-accessible directories
    const targetDirs = Platform.OS === 'android'
        // + copies of PDFs from picked folders, picked files and Share
        ? [RNFS.DownloadDirectoryPath, `${RNFS.ExternalStorageDirectoryPath}/Documents`, ...(await prepareImportedPdfs())]
        : [RNFS.DocumentDirectoryPath];

    for (const dir of targetDirs) {
        try {
            const exists = await RNFS.exists(dir);
            if (exists) {
                await scanRecursive(dir, 1);
            }
        } catch {
            // Ignore per-directory errors (e.g. EACCES under scoped storage).
        }
    }

    // If Android Scoped Storage blocked everything or the user has no documents
    return pdfFiles.length === 0 ? null : pdfFiles;
};

const fileUriOf = (doc: RNFS.ReadDirItem) => `file://${doc.path}`;

/**
 * Scans for PDFs and indexes the ones that still need it, newest first.
 * @param limit - index at most `limit` PDFs that still need work (quick scan); falsy = all.
 *   Finished PDFs don't count, so each quick scan moves on to new ones.
 * @param onProgress - (processed, total) over the PDFs being indexed, called
 *   once at the start and after each PDF
 */
export const performDocumentSync = async (
    limit: number | undefined,
    onProgress: (processed: number, total: number) => void,
    cancelRef?: { current: boolean },
): Promise<DocumentSyncResult> => {
    const results = await scanForPDFs();
    if (results === null) return { status: 'blocked' };

    // Skip PDFs that are done, or that failed too often and haven't changed since.
    const pending = results
        .filter((doc) => doc.path)
        .sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0))
        .filter((doc) => noteFileSeen(fileUriOf(doc), 'DOCUMENT', doc.mtime ? doc.mtime.getTime() : undefined).ocr);
    const docsToProcess = limit ? pending.slice(0, limit) : pending;
    const total = docsToProcess.length;
    onProgress(0, total);

    let processed = 0;
    for (const doc of docsToProcess) {
        if (cancelRef?.current) return { status: 'done', processed, total, wasCancelled: true };
        // A PDF takes seconds of OCR: start the next one when nobody is using the phone.
        if (!isQuiet()) await waitForQuiet(() => !!cancelRef?.current);
        if (cancelRef?.current) return { status: 'done', processed, total, wasCancelled: true };
        const fileUri = fileUriOf(doc);
        // No transaction here: the pipeline awaits OCR for seconds, and its
        // only write is one synchronous indexDocument call at the end.
        try {
            await processPDF(fileUri);
            // The pipeline logs and swallows save errors, so check the row landed.
            if (!isFileIndexed(fileUri)) throw new Error('PDF row was not written');
            markOcrDone(fileUri, 'DOCUMENT');
            AppLogger.info('DocumentSync', `Pipeline complete for: ${doc.name}`);
        } catch (pipelineError) {
            markStageFailed(fileUri, 'ocr', pipelineError, 'DOCUMENT');
            AppLogger.error('DocumentSync', `Pipeline failed for: ${doc.name}`, pipelineError);
        }
        processed++;
        onProgress(processed, total);
    }
    return { status: 'done', processed, total, wasCancelled: false };
};
