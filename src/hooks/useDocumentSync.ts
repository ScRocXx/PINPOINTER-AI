import { useCallback, useEffect, useRef, useState } from 'react';
import { IndexingService } from '../services/IndexingService';
import { AppLogger } from '../utils/AppLogger';
import { ensureDocumentAccess } from '../utils/StoragePermissions';
import { subscribeToSharedPdfs } from '../utils/PdfImport';
import { getLastChecked, subscribeLastChecked } from '../utils/LastChecked';
import { useToast } from '../components/ui/Toast';
import { tNow } from '../i18n/current';

/**
 * Tracks document-sync state. The PDF crawl itself (utils/DocumentSync.ts)
 * runs in IndexingService's queue, one job at a time with gallery sync.
 *
 * The "last checked" time is stamped by IndexingService (so the first run
 * and the charging-time job count too) and followed here. Permission
 * handling (including the Android "All files access" settings screen)
 * lives in utils/StoragePermissions.
 *
 * `handleDocumentSync(limit, fromShare, ask)`:
 * - `fromShare`: a PDF was just shared or picked. No permission is needed,
 *   and if a check is already running one more runs right after it.
 * - `ask` (default: unless `fromShare`): explain and ask for PDF access when
 *   it is missing. Pass false for a check the person didn't start for PDFs
 *   ("Check again" on Home), so no pop-up interrupts them.
 *
 * @returns Sync progress flags, counts, and control callbacks.
 */
export const useDocumentSync = () => {
    const toast = useToast();
    const [isSyncingDocs, setIsSyncingDocs] = useState(false);
    const [docSyncCount, setDocSyncCount] = useState(0);
    const [totalDocs, setTotalDocs] = useState(0);
    const [lastDocSyncTime, setLastDocSyncTime] = useState<number | null>(null);

    const loadPersistedState = useCallback(async () => {
        const at = await getLastChecked('papers');
        if (at) setLastDocSyncTime(at);
    }, []);

    // The service stamps every finished check, whoever started it.
    useEffect(() => subscribeLastChecked((kind, at) => {
        if (kind === 'papers') setLastDocSyncTime(at);
    }), []);

    useEffect(() => {
        loadPersistedState();
    }, [loadPersistedState]);

    // Latest handleDocumentSync, for the Share listener below.
    const syncRef = useRef<(limit?: number, fromShare?: boolean, ask?: boolean) => Promise<void>>(async () => {});
    const syncingRef = useRef(false);
    const rerunRef = useRef(false);

    const handleDocumentSync = async (limit?: number, fromShare = false, ask = !fromShare) => {
        if (isSyncingDocs || syncingRef.current) {
            if (fromShare) rerunRef.current = true; // pick the shared PDF up right after
            return;
        }

        // Check the real permission (not "the scan found no PDFs"). If it is
        // missing, explain it and wait for the user to come back from Settings.
        // A shared PDF needs no permission, so don't ask then.
        if (ask && !(await ensureDocumentAccess())) return;
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

            if (rerunRef.current) {
                rerunRef.current = false;
                syncRef.current(undefined, true);
            }
        }
    };
    syncRef.current = handleDocumentSync;

    // PDFs shared to Pinpointer from other apps: confirm, then index them.
    useEffect(() => subscribeToSharedPdfs((count) => {
        toast.show(
            count === 1 ? tNow('papers.sharedOne') : tNow('papers.sharedMany', { n: count }),
            { icon: 'papers', duration: 4000 },
        );
        syncRef.current(undefined, true);
    }), [toast]);

    return {
        isSyncingDocs,
        docSyncCount,
        totalDocs,
        lastDocSyncTime,
        handleDocumentSync,
        loadPersistedState
    };
};
