import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { countCheckedFiles, getCollectionPreview, getSimilarPhotos } from '../database';
import { encodeText } from '../services/EmbeddingService';
import { AppLogger } from '../utils/AppLogger';
import { COLLECTIONS, CollectionId, getCollection } from '../utils/Collections';
import { getRecentPhotos, subscribeRecentPhotos } from '../utils/RecentPhotos';

/** What one "Find quickly" tile shows. */
export interface CollectionTileState {
  /** Files found by their words. null: not counted (yet, or can't be). */
  count: number | null;
  /** More than `count` exist. */
  capped: boolean;
  /** Up to three of the person's own photos, newest or closest first. */
  photos: string[];
}

export interface HomeOverview {
  collections: Record<CollectionId, CollectionTileState>;
  /** Photos on the phone that Pinpointer may see. null until known. */
  photoTotal: number | null;
  /** Photos indexing has looked at. null until known. */
  photosChecked: number | null;
  /** Recently opened photos, newest first. */
  recent: string[];
}

export interface HomeOverviewOptions {
  /** Indexing is running: counts refresh as it goes. */
  busy: boolean;
  /** Changes while indexing runs; used to refresh the "checked" count. */
  progressTick?: number;
}

const PHOTOS_PER_TILE = 3;
const RECENT_LIMIT = 8;
/** While indexing runs, recount at most this often. */
const CHECKED_REFRESH_MS = 2000;
const TILES_REFRESH_MS = 8000;
/** Ask CLIP for Family photos after search's own encoder warm-up (1.5s). */
const SEMANTIC_DELAY_MS = 3000;
/** Collections found by look (CLIP) as well as by words. */
const SEMANTIC_COLLECTIONS: CollectionId[] = ['family'];

const emptyTiles = (): Record<CollectionId, CollectionTileState> => {
  const tiles = {} as Record<CollectionId, CollectionTileState>;
  for (const c of COLLECTIONS) tiles[c.id] = { count: null, capped: false, photos: [] };
  return tiles;
};

/** The phone's photo count and its Screenshots album, from MediaStore. Never asks for permission. */
const readAlbums = async (): Promise<{ total: number | null; screenshots: string[] }> => {
  try {
    const albums = await CameraRoll.getAlbums({ assetType: 'Photos' });
    if (!Array.isArray(albums)) return { total: null, screenshots: [] };
    const total = albums.reduce((sum, a) => sum + (typeof a.count === 'number' ? a.count : 0), 0);
    const shots = albums.find(a => /screenshot/i.test(a.title ?? ''));
    let screenshots: string[] = [];
    if (shots && shots.count > 0) {
      const page = await CameraRoll.getPhotos({
        first: PHOTOS_PER_TILE,
        groupName: shots.title,
        groupTypes: 'Album',
        assetType: 'Photos',
      });
      screenshots = (page?.edges ?? []).map(e => e.node.image.uri).filter(Boolean);
    }
    return { total: albums.length > 0 ? total : null, screenshots };
  } catch (e) {
    // No photo permission yet, or MediaStore busy: Home just shows less.
    AppLogger.info('Home', 'Albums not readable yet', e);
    return { total: null, screenshots: [] };
  }
};

/** Photos that look like a collection (Family), closest first. */
const readSimilar = async (id: CollectionId): Promise<string[]> => {
  const vector = await encodeText(getCollection(id).clip);
  return vector ? getSimilarPhotos(vector, PHOTOS_PER_TILE * 3) : [];
};

/**
 * Everything Home shows besides the shared Pinpointer state: the "Find
 * quickly" tiles built from the person's own photos, the photo totals for
 * the progress card, and recently opened photos.
 *
 * Cheap and bounded: one FTS query per tile, one MediaStore album list, one
 * CLIP text vector (cached, after search's warm-up). Work starts after the
 * first frame and refreshes as indexing runs and when it finishes.
 */
export const useHomeOverview = ({ busy, progressTick = 0 }: HomeOverviewOptions): HomeOverview => {
  const [collections, setCollections] = useState(emptyTiles);
  const [photoTotal, setPhotoTotal] = useState<number | null>(null);
  const [photosChecked, setPhotosChecked] = useState<number | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const alive = useRef(true);
  const similar = useRef<Partial<Record<CollectionId, string[]>>>({});
  const screenshots = useRef<string[]>([]);
  const lastChecked = useRef(0);
  const lastTiles = useRef(0);

  const mergeTiles = useCallback(() => {
    const next = emptyTiles();
    for (const c of COLLECTIONS) {
      const byWords = c.concepts.length + c.textPhrases.length > 0 ? getCollectionPreview(c, PHOTOS_PER_TILE) : null;
      const byLook = c.id === 'screenshot' ? screenshots.current : similar.current[c.id] ?? [];
      next[c.id] = {
        // Tiles found by look can't be counted honestly; show photos only.
        count: byWords && byLook.length === 0 ? byWords.count : null,
        capped: !!byWords?.capped && byLook.length === 0,
        photos: [...new Set([...byLook, ...(byWords?.photos ?? [])])].slice(0, PHOTOS_PER_TILE),
      };
    }
    if (alive.current) setCollections(next);
    lastTiles.current = Date.now();
  }, []);

  const loadChecked = useCallback(() => {
    if (alive.current) setPhotosChecked(countCheckedFiles('IMAGE'));
    lastChecked.current = Date.now();
  }, []);

  const loadAll = useCallback(async () => {
    loadChecked();
    mergeTiles();
    const [albums, recentPhotos] = await Promise.all([readAlbums(), getRecentPhotos()]);
    if (!alive.current) return;
    setPhotoTotal(albums.total);
    setRecent(recentPhotos.slice(0, RECENT_LIMIT).map(p => p.uri));
    if (albums.screenshots.join() !== screenshots.current.join()) {
      screenshots.current = albums.screenshots;
      mergeTiles();
    }
  }, [loadChecked, mergeTiles]);

  // First load once the first frame is up, then Family by look.
  useEffect(() => {
    alive.current = true;
    const frame = requestAnimationFrame(() => {
      loadAll().catch(e => AppLogger.warn('Home', 'Home overview failed', e));
    });
    const timer = setTimeout(async () => {
      for (const id of SEMANTIC_COLLECTIONS) {
        similar.current[id] = await readSimilar(id).catch(() => []);
      }
      if (alive.current && SEMANTIC_COLLECTIONS.some(id => (similar.current[id] ?? []).length > 0)) mergeTiles();
    }, SEMANTIC_DELAY_MS);
    return () => {
      alive.current = false;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [loadAll, mergeTiles]);

  // A photo opened anywhere (search, Photos, here) goes to the front at once.
  useEffect(
    () =>
      subscribeRecentPhotos(photos => {
        if (alive.current) setRecent(photos.slice(0, RECENT_LIMIT).map(p => p.uri));
      }),
    [],
  );

  // While indexing runs: keep the count and the tiles moving, gently.
  useEffect(() => {
    if (!busy) return;
    const now = Date.now();
    if (now - lastChecked.current >= CHECKED_REFRESH_MS) loadChecked();
    if (now - lastTiles.current >= TILES_REFRESH_MS) mergeTiles();
  }, [busy, progressTick, loadChecked, mergeTiles]);

  // When indexing finishes, recount everything.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      loadAll().catch(e => AppLogger.warn('Home', 'Home overview refresh failed', e));
    }
    wasBusy.current = busy;
  }, [busy, loadAll]);

  return { collections, photoTotal, photosChecked, recent };
};
