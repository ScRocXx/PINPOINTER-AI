import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from './AppLogger';

/**
 * "Important / ज़रूरी": photos and papers the person starred, shown on the
 * Home shelf. Stored on the phone only (AsyncStorage), newest first.
 *
 * `title` must already be masked: pass the title stored in the index (which
 * `indexDocument` masks), never raw OCR text.
 */
export interface PinnedItem {
  uri: string;
  kind: 'IMAGE' | 'DOCUMENT';
  title?: string;
  pinnedAt: number;
}

export const PINNED_STORAGE_KEY = 'pinpointer.pinned.v1';
export const MAX_PINNED = 60;

type Listener = (items: PinnedItem[]) => void;
const listeners = new Set<Listener>();

let cache: PinnedItem[] | null = null;

const isPinnedItem = (x: unknown): x is PinnedItem =>
  !!x &&
  typeof (x as PinnedItem).uri === 'string' &&
  ((x as PinnedItem).kind === 'IMAGE' || (x as PinnedItem).kind === 'DOCUMENT');

/** All starred items, newest first. */
export const getPinnedItems = async (): Promise<PinnedItem[]> => {
  if (cache) return cache;
  try {
    const raw = await AsyncStorage.getItem(PINNED_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(parsed) ? parsed.filter(isPinnedItem) : [];
  } catch (e) {
    AppLogger.warn('PinnedItems', 'Could not read starred items', e);
    cache = [];
  }
  return cache;
};

const save = async (items: PinnedItem[]): Promise<void> => {
  cache = items;
  listeners.forEach(l => l(items));
  try {
    await AsyncStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(items));
  } catch (e) {
    AppLogger.warn('PinnedItems', 'Could not save starred items', e);
  }
};

export const isPinned = async (uri: string): Promise<boolean> =>
  (await getPinnedItems()).some(p => p.uri === uri);

/** Star an item (moves it to the front if it was already starred). */
export const pinItem = async (item: Omit<PinnedItem, 'pinnedAt'>): Promise<void> => {
  const items = await getPinnedItems();
  const next = [{ ...item, pinnedAt: Date.now() }, ...items.filter(p => p.uri !== item.uri)].slice(0, MAX_PINNED);
  await save(next);
};

export const unpinItem = async (uri: string): Promise<void> => {
  const items = await getPinnedItems();
  if (!items.some(p => p.uri === uri)) return;
  await save(items.filter(p => p.uri !== uri));
};

/** Star or unstar. Resolves to the new state (true = starred). */
export const togglePinned = async (item: Omit<PinnedItem, 'pinnedAt'>): Promise<boolean> => {
  if (await isPinned(item.uri)) {
    await unpinItem(item.uri);
    return false;
  }
  await pinItem(item);
  return true;
};

/** Called with the full list after every change. Returns an unsubscribe. */
export const subscribePinned = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Test helper: forget the in-memory copy. */
export const resetPinnedCacheForTests = (): void => {
  cache = null;
  listeners.clear();
};
