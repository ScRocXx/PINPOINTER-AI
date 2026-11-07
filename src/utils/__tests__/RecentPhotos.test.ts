/**
 * Unit tests for src/utils/RecentPhotos.ts
 *
 * Source behavior (verified by reading the module):
 * - addRecentPhoto: exact-URI dedup (case-sensitive), moves to front
 *   (newest first), cap MAX_RECENT = 24, viewedAt = Date.now()
 * - getRecentPhotos: [] when empty; corrupted JSON -> [] (guarded, warns)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from '../AppLogger';
import { RecentPhoto, addRecentPhoto, getRecentPhotos } from '../RecentPhotos';

jest.mock('../AppLogger', () => ({
    AppLogger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        getRecent: jest.fn(),
        getErrors: jest.fn(),
    },
}));

const resetStore = () =>
    (AsyncStorage as unknown as { __reset: () => void }).__reset();

beforeEach(() => {
    resetStore();
    jest.clearAllMocks();
});

describe('getRecentPhotos', () => {
    it('returns an empty array when nothing is stored', async () => {
        await expect(getRecentPhotos()).resolves.toEqual([]);
    });

    it('returns [] and does not throw on corrupted stored JSON', async () => {
        await AsyncStorage.setItem('recent_viewed_photos', 'not-json{{{');
        await expect(getRecentPhotos()).resolves.toEqual([]);
        expect(AppLogger.warn).toHaveBeenCalled();
    });
});

describe('addRecentPhoto', () => {
    it('stores the uri with a viewedAt timestamp', async () => {
        const before = Date.now();
        await addRecentPhoto('file:///photos/a.jpg');
        const after = Date.now();
        const [photo] = await getRecentPhotos();
        expect(photo.uri).toBe('file:///photos/a.jpg');
        expect(photo.viewedAt).toBeGreaterThanOrEqual(before);
        expect(photo.viewedAt).toBeLessThanOrEqual(after);
    });

    it('orders photos newest-first', async () => {
        await addRecentPhoto('a.jpg');
        await addRecentPhoto('b.jpg');
        await addRecentPhoto('c.jpg');
        const uris = (await getRecentPhotos()).map(p => p.uri);
        expect(uris).toEqual(['c.jpg', 'b.jpg', 'a.jpg']);
    });

    it('moves an already-viewed uri to the front without duplicating it', async () => {
        await addRecentPhoto('a.jpg');
        await addRecentPhoto('b.jpg');
        await addRecentPhoto('a.jpg');
        const uris = (await getRecentPhotos()).map(p => p.uri);
        expect(uris).toEqual(['a.jpg', 'b.jpg']);
    });

    it('refreshes viewedAt when a uri is re-added', async () => {
        await addRecentPhoto('a.jpg');
        const firstViewedAt = (await getRecentPhotos())[0].viewedAt;
        await new Promise(r => setTimeout(r, 5));
        await addRecentPhoto('a.jpg');
        const [photo] = await getRecentPhotos();
        expect(photo.viewedAt).toBeGreaterThanOrEqual(firstViewedAt);
    });

    it('dedupes with exact (case-sensitive) uri matching per source', async () => {
        await addRecentPhoto('Photo.jpg');
        await addRecentPhoto('photo.jpg');
        const uris = (await getRecentPhotos()).map(p => p.uri);
        // Source filters by strict equality, so casing differences are distinct
        expect(uris).toEqual(['photo.jpg', 'Photo.jpg']);
    });

    it('enforces the 24-item cap by evicting the oldest', async () => {
        for (let i = 0; i < 30; i++) {
            await addRecentPhoto(`photo-${i}.jpg`);
        }
        const photos = await getRecentPhotos();
        expect(photos).toHaveLength(24);
        expect(photos[0].uri).toBe('photo-29.jpg'); // newest
        expect(photos[23].uri).toBe('photo-6.jpg'); // oldest surviving
        const uris = photos.map(p => p.uri);
        expect(uris).not.toContain('photo-0.jpg');
        expect(uris).not.toContain('photo-5.jpg');
    });

    it('does not grow past the cap when re-adding an existing uri', async () => {
        for (let i = 0; i < 24; i++) {
            await addRecentPhoto(`photo-${i}.jpg`);
        }
        await addRecentPhoto('photo-0.jpg'); // duplicate -> moves to front
        const photos = await getRecentPhotos();
        expect(photos).toHaveLength(24);
        expect(photos[0].uri).toBe('photo-0.jpg');
    });

    it('recovers from corrupted storage and writes valid JSON afterwards', async () => {
        await AsyncStorage.setItem('recent_viewed_photos', 'corrupted{{{');
        await addRecentPhoto('fresh.jpg');
        const photos = await getRecentPhotos();
        expect(photos).toHaveLength(1);
        expect(photos[0].uri).toBe('fresh.jpg');
        const raw = await AsyncStorage.getItem('recent_viewed_photos');
        expect(() => JSON.parse(raw as string)).not.toThrow();
    });

    it('persists photos across separate get calls', async () => {
        await addRecentPhoto('a.jpg');
        const first = await getRecentPhotos();
        const second = await getRecentPhotos();
        expect(second).toEqual(first);
        expect(second).toHaveLength(1);
    });

    it('does not collide with the search-history storage key', async () => {
        await addRecentPhoto('a.jpg');
        const keys = await AsyncStorage.getAllKeys();
        expect(keys).toContain('recent_viewed_photos');
        expect(keys).not.toContain('search_history');
    });
});

describe('RecentPhoto shape', () => {
    it('stores photos conforming to the RecentPhoto interface', async () => {
        await addRecentPhoto('file:///photos/a.jpg');
        const [photo]: RecentPhoto[] = await getRecentPhotos();
        expect(typeof photo.uri).toBe('string');
        expect(typeof photo.viewedAt).toBe('number');
    });
});
