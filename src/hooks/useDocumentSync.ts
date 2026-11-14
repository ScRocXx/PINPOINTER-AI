import { useRef, useState } from 'react';
import { Alert } from 'react-native';
import { IndexingService } from '../services/IndexingService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect } from 'react';
import { AppLogger } from '../utils/AppLogger';
import { ensureDocumentAccess } from '../utils/StoragePermissions';
import { subscribeToSharedPdfs } from '../utils/PdfImport';

/**
 * Tracks document-sync state. The PDF crawl itself (utils/DocumentSync.ts)
 * runs in IndexingService's queue, one job at a time with gallery sync.
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
            const result = await IndexingService.documentSync(limit, (processed, total) => {
                setTotalDocs(total);
                setDocSyncCount(processed);
            });
            // Access was checked above, so a 'blocked' result now just means
            // there are no PDFs yet: nothing more to do.
            if (result.status === 'blocked') AppLogger.info('DocumentSync', 'No PDFs found yet');
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
    // One identity for the whole life of the hook, so screens that read it
    // through a selector don't re-render on every progress tick.
    const stableDocumentSync = useCallback(
        (limit?: number, fromShare = false) => syncRef.current(limit, fromShare),
        [],
    );

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
        handleDocumentSync: stableDocumentSync,
        loadPersistedState
    };
};
