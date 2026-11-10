import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  MAX_PINNED,
  PINNED_STORAGE_KEY,
  getPinnedItems,
  isPinned,
  pinItem,
  resetPinnedCacheForTests,
  subscribePinned,
  togglePinned,
  unpinItem,
} from '../PinnedItems';

const photo = (n: number) => ({ uri: `content://media/${n}`, kind: 'IMAGE' as const, title: `Photo ${n}` });

beforeEach(() => {
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
  resetPinnedCacheForTests();
  jest.clearAllMocks();
});

describe('PinnedItems', () => {
  it('starts empty', async () => {
    expect(await getPinnedItems()).toEqual([]);
    expect(await isPinned('x')).toBe(false);
  });

  it('pins newest first and saves to storage', async () => {
    await pinItem(photo(1));
    await pinItem(photo(2));
    const items = await getPinnedItems();
    expect(items.map(i => i.uri)).toEqual([photo(2).uri, photo(1).uri]);
    expect(items[0].pinnedAt).toEqual(expect.any(Number));
    const saved = JSON.parse((await AsyncStorage.getItem(PINNED_STORAGE_KEY)) as string);
    expect(saved).toHaveLength(2);
  });

  it('moves a re-pinned item to the front without duplicating it', async () => {
    await pinItem(photo(1));
    await pinItem(photo(2));
    await pinItem(photo(1));
    expect((await getPinnedItems()).map(i => i.uri)).toEqual([photo(1).uri, photo(2).uri]);
  });

  it('keeps at most MAX_PINNED items', async () => {
    for (let i = 0; i < MAX_PINNED + 5; i++) {
      await pinItem(photo(i));
    }
    const items = await getPinnedItems();
    expect(items).toHaveLength(MAX_PINNED);
    expect(items[0].uri).toBe(photo(MAX_PINNED + 4).uri);
  });

  it('unpins, and ignores items that were never pinned', async () => {
    await pinItem(photo(1));
    jest.clearAllMocks();
    await unpinItem('content://media/404');
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    await unpinItem(photo(1).uri);
    expect(await isPinned(photo(1).uri)).toBe(false);
  });

  it('toggles and reports the new state', async () => {
    expect(await togglePinned(photo(1))).toBe(true);
    expect(await togglePinned(photo(1))).toBe(false);
    expect(await getPinnedItems()).toEqual([]);
  });

  it('tells subscribers about every change until they leave', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribePinned(listener);
    await pinItem(photo(1));
    expect(listener).toHaveBeenLastCalledWith([expect.objectContaining({ uri: photo(1).uri })]);
    unsubscribe();
    await pinItem(photo(2));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('reads saved items back after a restart and drops broken entries', async () => {
    await AsyncStorage.setItem(
      PINNED_STORAGE_KEY,
      JSON.stringify([{ uri: 'a', kind: 'DOCUMENT', pinnedAt: 1 }, { uri: 5 }, null, { uri: 'b', kind: 'VIDEO' }]),
    );
    expect((await getPinnedItems()).map(i => i.uri)).toEqual(['a']);
  });

  it('survives unreadable storage', async () => {
    await AsyncStorage.setItem(PINNED_STORAGE_KEY, '{not json');
    expect(await getPinnedItems()).toEqual([]);
    resetPinnedCacheForTests();
    await AsyncStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify({ uri: 'a' }));
    expect(await getPinnedItems()).toEqual([]);
  });

  it('keeps working in memory when saving fails', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await pinItem(photo(1));
    expect(await isPinned(photo(1).uri)).toBe(true);
  });
});
