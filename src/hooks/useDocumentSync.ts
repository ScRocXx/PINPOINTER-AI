import { useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { isFileIndexed, beginTransaction, commitTransaction, rollbackTransaction } from '../database';
import { processPDF } from '../utils/DocumentPipeline';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect } from 'react';
import { AppLogger } from '../utils/AppLogger';
import { ensureDocumentAccess } from '../utils/StoragePermissions';
import { prepareImportedPdfs, subscribeToSharedPdfs } from '../utils/PdfImport';

/**
 * Tracks document-sync state and crawls device storage for PDFs to index.
 *
 * Persists the last sync time in AsyncStorage and exposes the manual
 * `handleDocumentSync` trigger. Permission handling (including the Android
 * "All files access" settings screen) lives in utils/StoragePermissions.
 *
 * @returns Sync progress flags, counts, and control callbacks.
 */
export const useDocumentSync = () => {
    const [isSyncingDocs, setIsSyncingDocs] = useState(false);
    const [docSyncCount, setDocSyncCount] = useState(0);
    const [totalDocs, setTotalDocs] = useState(0);
    const [lastDocSyncTime, setLastDocSyncTime] = useState<number | null>(null);

    const loadPersistedState = useCallback(async () => {
        try {
            const timeStr = await AsyncStorage.getItem('doc_last_sync_time');
            if (timeStr) setLastDocSyncTime(parseInt(timeStr, 10));
        } catch (e) {
            AppLogger.error('DocumentSync', 'Failed to load persisted time', e);
        }
    }, []);

    useEffect(() => {
        loadPersistedState();
    }, [loadPersistedState]);

    const scanForPDFs = async (): Promise<RNFS.ReadDirItem[] | null> => {
        let pdfFiles: RNFS.ReadDirItem[] = [];
        const MAX_DEPTH = 4;

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

        // No PDFs in Download/ or Documents/
        if (pdfFiles.length === 0) {
            return null;
        }

        return pdfFiles;
    };

    // Latest handleDocumentSync, for the Share listener below.
    const syncRef = useRef<(limit?: number, fromShare?: boolean) => Promise<void>>(async () => {});
    const syncingRef = useRef(false);
    const rerunRef = useRef(false);

    const handleDocumentSync = async (limit?: number, fromShare = false) => {
        if (isSyncingDocs || syncingRef.current) {
            if (fromShare) rerunRef.current = true; // pick the shared PDF up right after
            return;
        }

        // Check the real permission (not "the scan found no PDFs"). If it is
        // missing, explain it and wait for the user to come back from Settings.
        // A shared PDF needs no permission, so don't ask then.
        if (!fromShare && !(await ensureDocumentAccess())) return;
        syncingRef.current = true;

        try {
            setIsSyncingDocs(true);
            const results = await scanForPDFs();

            // Access is granted, so null now just means there are no PDFs yet
            if (results === null) return;

            // Apply limit if provided (e.g., quick scan = 50, universal = all)
            const docsToProcess = limit ? results.slice(0, limit) : results;

            setTotalDocs(docsToProcess.length);
            setDocSyncCount(0);

            let processed = 0;

            for (const doc of docsToProcess) {
                if (!doc.path) continue;

                // Construct a proper file URI for External Rendering
                const fileUri = `file://${doc.path}`;

                // C3 fix: Transaction-per-document with real rollback
                // Prevents DB lock + total data loss on mid-sync errors
                beginTransaction();
                try {
                    // Skip if already in DB
                    if (isFileIndexed(fileUri)) {
                        commitTransaction();
                        processed++;
                        setDocSyncCount(processed);
                        continue;
                    }

                    // Run the 5-phase PDF Intelligence Pipeline
                    await processPDF(fileUri);
                    commitTransaction();
                    AppLogger.info('DocumentSync', `Pipeline complete for: ${doc.name}`);
                } catch (pipelineError) {
                    rollbackTransaction();
                    AppLogger.error('DocumentSync', `Pipeline failed for: ${doc.name}`, pipelineError);
                } finally {
                    processed++;
                    setDocSyncCount(processed);
                }
            }
        } catch (err) {
            AppLogger.error('DocumentSync', 'Background crawler failed:', err);
        } finally {
            syncingRef.current = false;
            setIsSyncingDocs(false);
            setDocSyncCount(0);
            setTotalDocs(0);

            const now = Date.now();
            setLastDocSyncTime(now);
            await AsyncStorage.setItem('doc_last_sync_time', now.toString());

            if (rerunRef.current) {
                rerunRef.current = false;
                syncRef.current(undefined, true);
            }
        }
    };
    syncRef.current = handleDocumentSync;

    // PDFs shared to Pinpointer from other apps: confirm, then index them.
    useEffect(() => subscribeToSharedPdfs((count) => {
        Alert.alert(
            count === 1 ? 'PDF added' : `${count} PDFs added`,
            `Pinpointer is reading ${count === 1 ? 'it' : 'them'} now. ${count === 1 ? 'It' : 'They'} will show up in search in a moment.`,
        );
        syncRef.current(undefined, true);
    }), []);

    return {
        isSyncingDocs,
        docSyncCount,
        totalDocs,
        lastDocSyncTime,
        handleDocumentSync,
        loadPersistedState
    };
};
