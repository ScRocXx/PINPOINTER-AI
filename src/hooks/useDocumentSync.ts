import { useState } from 'react';
import { Alert, Linking, NativeModules } from 'react-native';
import { IndexingService } from '../services/IndexingService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect } from 'react';
import { AppLogger } from '../utils/AppLogger';

const { StorageModule } = NativeModules;

/**
 * Tracks document-sync state. The PDF crawl itself (utils/DocumentSync.ts)
 * runs in IndexingService's queue, one job at a time with gallery sync.
 *
 * Persists the last sync time in AsyncStorage and exposes the manual
 * `handleDocumentSync` trigger plus a settings deep-link helper for the
 * Android "All files access" permission.
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

    const requestAccessAndOpenSettings = () => {
        Alert.alert(
            "Full Storage Access Required",
            "To automatically find and sync all your documents, Pinpoint needs 'All Files Access' permission on Android 11+.\n\nPlease tap 'Open Settings', find Pinpoint, and enable 'Allow management of all files'.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Open Settings",
                    onPress: () => {
                        if (StorageModule && StorageModule.openAllFilesAccessSettings) {
                            StorageModule.openAllFilesAccessSettings();
                        } else {
                            Linking.openSettings();
                        }
                    }
                }
            ]
        );
    };

    const handleDocumentSync = async (limit?: number) => {
        if (isSyncingDocs) return;

        try {
            setIsSyncingDocs(true);
            const result = await IndexingService.documentSync(limit, (processed, total) => {
                setTotalDocs(total);
                setDocSyncCount(processed);
            });

            // Intercept permission block and redirect to Android Settings
            if (result.status === 'blocked') {
                setIsSyncingDocs(false);
                requestAccessAndOpenSettings();
                return;
            }
        } catch (err) {
            AppLogger.error('DocumentSync', 'Background crawler failed:', err);
        } finally {
            setIsSyncingDocs(false);
            setDocSyncCount(0);
            setTotalDocs(0);

            const now = Date.now();
            setLastDocSyncTime(now);
            await AsyncStorage.setItem('doc_last_sync_time', now.toString());
        }
    };

    return {
        isSyncingDocs,
        docSyncCount,
        totalDocs,
        lastDocSyncTime,
        handleDocumentSync,
        loadPersistedState
    };
};
