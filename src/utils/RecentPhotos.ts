import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from './AppLogger';

const RECENT_PHOTOS_KEY = 'recent_viewed_photos';
const MAX_RECENT = 24; // 4 × 6 grid

/** A photo the user recently viewed, tracked for the Recent Searches shelf. */
export interface RecentPhoto {
    uri: string;
    viewedAt: number;
}

type Listener = (photos: RecentPhoto[]) => void;
const listeners = new Set<Listener>();
/** One write at a time: swiping through photos must not lose a view. */
let queue: Promise<void> = Promise.resolve();

/** Hear about every newly opened photo (Home's "Recently opened"). Returns an unsubscribe function. */
export const subscribeRecentPhotos = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

/** Record a photo view (dedupes, most-recent-first, capped at MAX_RECENT). */
export const addRecentPhoto = (uri: string): Promise<void> => {
    queue = queue.then(async () => {
        try {
            const existing = await getRecentPhotos();
            const filtered = existing.filter(p => p.uri !== uri);
            const updated: RecentPhoto[] = [{ uri, viewedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
            await AsyncStorage.setItem(RECENT_PHOTOS_KEY, JSON.stringify(updated));
            listeners.forEach(listener => listener(updated));
        } catch (e) {
            AppLogger.warn('RecentPhotos', 'Failed to add recent photo', e);
        }
    });
    return queue;
};

/** Load recently viewed photos, most-recent-first. */
export const getRecentPhotos = async (): Promise<RecentPhoto[]> => {
    try {
        const raw = await AsyncStorage.getItem(RECENT_PHOTOS_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? (parsed as RecentPhoto[]) : [];
    } catch (e) {
        AppLogger.warn('RecentPhotos', 'Failed to load recent photos', e);
        return [];
    }
};
