import { useState, useCallback } from 'react';
import { Platform, PermissionsAndroid, Alert } from 'react-native';
import { loadSavedCursor } from '../utils/GallerySync';
import { IndexingService } from '../services/IndexingService';
import { getIndexedCount } from '../database';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from '../utils/AppLogger';

/** Wait after app start before backfilling, so startup stays smooth. */
const BACKFILL_STARTUP_DELAY_MS = 5000;

/**
 * useGallerySync — the UI side of gallery sync: permission, progress, pause,
 * resume and alerts. The sync loops themselves run in IndexingService, which
 * queues them so only one runs at a time.
 */
export const useGallerySync = () => {
    const [isSyncing, setIsSyncing] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [isDeepSync, setIsDeepSync] = useState(false);
    const [syncCount, setSyncCount] = useState(0);
    const [totalImages] = useState(0);
    const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

    // Give already-indexed photos that lack a CLIP embedding one, in the
    // background. Safe to call repeatedly: the service runs one at a time.
    const startBackfill = useCallback(() => {
        try {
            IndexingService.backfill().catch((e) => AppLogger.warn('GallerySync', 'Backfill failed', e));
        } catch (e) {
            AppLogger.warn('GallerySync', 'Backfill failed to start', e);
        }
    }, []);

    // Load persisted count on mount
    const loadPersistedCount = useCallback(async () => {
        try {
            const count = getIndexedCount();
            if (count > 0) {
                setSyncCount(count);
                setTimeout(startBackfill, BACKFILL_STARTUP_DELAY_MS);
            }

            const timeStr = await AsyncStorage.getItem('gallery_last_sync_time');
            if (timeStr) setLastSyncTime(parseInt(timeStr, 10));
        } catch (e) {
            AppLogger.warn('GallerySync', 'Failed to load persisted state', e);
        }
    }, [startBackfill]);

    const requestPermission = async (): Promise<boolean> => {
        if (Platform.OS === 'android') {
            const permission = Platform.Version >= 33
                ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
                : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
            const granted = await PermissionsAndroid.request(permission);
            return granted === PermissionsAndroid.RESULTS.GRANTED;
        }
        return true; // iOS permissions handled by Info.plist
    };

    const runSync = useCallback(async (fromCursor?: string) => {
        try {
            const hasPermission = await requestPermission();
            if (!hasPermission) return;

            setIsSyncing(true);
            setIsPaused(false);

            const { processed, wasCancelled } = await IndexingService.deepGallerySync(
                (currentCount) => setSyncCount(currentCount),
                fromCursor,
            );

            setIsSyncing(false);
            if (wasCancelled) {
                setIsPaused(true);
            } else {
                setIsPaused(false);
                const now = Date.now();
                setLastSyncTime(now);
                await AsyncStorage.setItem('gallery_last_sync_time', now.toString());
                Alert.alert('Gallery Indexed', `Done! ${processed} photos indexed for AI search.`);
                startBackfill();
            }
        } catch (error) {
            AppLogger.error('GallerySync', 'Deep sync failed', error);
            setIsSyncing(false);
            setIsPaused(true); // treat error as pause — cursor was saved
            Alert.alert('Sync Paused', 'Progress saved. Tap Resume to continue.');
        }
    }, [startBackfill]);

    const handleQuickSync = useCallback(async () => {
        try {
            const hasPermission = await requestPermission();
            if (!hasPermission) return;

            setIsDeepSync(false);
            setIsSyncing(true);
            setIsPaused(false);

            await IndexingService.quickGallerySync((count) => setSyncCount(count));

            setIsSyncing(false);
            const now = Date.now();
            setLastSyncTime(now);
            await AsyncStorage.setItem('gallery_last_sync_time', now.toString());
            startBackfill();
        } catch (e) {
            AppLogger.error('GallerySync', 'Quick sync failed', e);
            setIsSyncing(false);
            Alert.alert('Sync Error', 'Quick sync failed. Please try again.');
        }
    }, [startBackfill]);

    const handleDeepSync = useCallback(() => {
        setIsDeepSync(true);
        runSync(undefined);
    }, [runSync]);

    const handlePauseSync = useCallback(() => {
        IndexingService.pause();
    }, []);

    const handleResumeSync = useCallback(async () => {
        const cursor = await loadSavedCursor();
        runSync(cursor);
    }, [runSync]);

    return {
        isSyncing, isPaused, isDeepSync, syncCount, totalImages, lastSyncTime,
        handleQuickSync, handleDeepSync, handlePauseSync, handleResumeSync,
        loadPersistedCount,
    };
};
