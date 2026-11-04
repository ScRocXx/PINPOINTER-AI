import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from './AppLogger';

const RECENT_PHOTOS_KEY = 'recent_viewed_photos';
const MAX_RECENT = 24; // 4 × 6 grid

/** A photo the user recently viewed, tracked for the Recent Searches shelf. */
export interface RecentPhoto {
    uri: string;
    viewedAt: number;
}

/** Record a photo view (dedupes, most-recent-first, capped at MAX_RECENT). */
export const addRecentPhoto = async (uri: string): Promise<void> => {
    try {
        const existing = await getRecentPhotos();
        const filtered = existing.filter(p => p.uri !== uri);
        const updated: RecentPhoto[] = [{ uri, viewedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
        await AsyncStorage.setItem(RECENT_PHOTOS_KEY, JSON.stringify(updated));
    } catch (e) {
        AppLogger.warn('RecentPhotos', 'Failed to add recent photo', e);
    }
};

/** Load recently viewed photos, most-recent-first. */
export const getRecentPhotos = async (): Promise<RecentPhoto[]> => {
    try {
        const raw = await AsyncStorage.getItem(RECENT_PHOTOS_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        AppLogger.warn('RecentPhotos', 'Failed to load recent photos', e);
        return [];
    }
};
