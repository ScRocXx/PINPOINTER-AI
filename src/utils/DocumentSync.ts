/**
 * PDF sync engine: finds PDFs in Download/ and Documents/ and runs each one
 * the files table says still needs work through the document pipeline.
 *
 * Plain TypeScript with no React, so IndexingService can run it in its queue.
 * The permission prompt stays in useDocumentSync (it is UI).
 */
import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import {
    isFileIndexed, beginTransaction, commitTransaction, rollbackTransaction,
    noteFileSeen, markOcrDone, markStageFailed,
} from '../database';
import { processPDF } from './DocumentPipeline';
import { prepareImportedPdfs } from './PdfImport';
import { AppLogger } from './AppLogger';

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

/**
 * Scans for PDFs and indexes the ones that still need it.
 * @param limit - only look at the first `limit` PDFs (quick scan); falsy = all
 * @param onProgress - (processed, total), called once at the start and after each PDF
 */
export const performDocumentSync = async (
    limit: number | undefined,
    onProgress: (processed: number, total: number) => void,
    cancelRef?: { current: boolean },
): Promise<DocumentSyncResult> => {
    const results = await scanForPDFs();
    if (results === null) return { status: 'blocked' };

    // Apply limit if provided (e.g., quick scan = 50, universal = all)
    const docsToProcess = limit ? results.slice(0, limit) : results;
    const total = docsToProcess.length;
    onProgress(0, total);

    let processed = 0;
    for (const doc of docsToProcess) {
        if (cancelRef?.current) return { status: 'done', processed, total, wasCancelled: true };
        if (!doc.path) continue;

        // Construct a proper file URI for External Rendering
        const fileUri = `file://${doc.path}`;

        // Skip PDFs that are done, or that failed too often and haven't changed since.
        const work = noteFileSeen(fileUri, 'DOCUMENT', doc.mtime ? doc.mtime.getTime() : undefined);
        if (!work.ocr) {
            processed++;
            onProgress(processed, total);
            continue;
        }

        // C3 fix: Transaction-per-document with real rollback
        // Prevents DB lock + total data loss on mid-sync errors
        beginTransaction();
        let failure: unknown = null;
        try {
            // Run the 5-phase PDF Intelligence Pipeline
            await processPDF(fileUri);
            // The pipeline logs and swallows save errors, so check the row landed.
            if (!isFileIndexed(fileUri)) throw new Error('PDF row was not written');
            commitTransaction();
            markOcrDone(fileUri, 'DOCUMENT');
            AppLogger.info('DocumentSync', `Pipeline complete for: ${doc.name}`);
        } catch (pipelineError) {
            failure = pipelineError;
            rollbackTransaction();
            AppLogger.error('DocumentSync', `Pipeline failed for: ${doc.name}`, pipelineError);
        } finally {
            // Outside the rolled-back transaction, so the failure is remembered.
            if (failure) markStageFailed(fileUri, 'ocr', failure, 'DOCUMENT');
            processed++;
            onProgress(processed, total);
        }
    }
    return { status: 'done', processed, total, wasCancelled: false };
};
