import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePinnedItems } from '../usePinnedItems';
import { pinItem, resetPinnedCacheForTests } from '../../utils/PinnedItems';

beforeEach(() => {
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
  resetPinnedCacheForTests();
});

describe('usePinnedItems', () => {
  it('loads saved items, then follows changes made elsewhere', async () => {
    await pinItem({ uri: 'a', kind: 'IMAGE' });
    const { result } = await renderHook(() => usePinnedItems());
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.isPinned('a')).toBe(true);
    expect(result.current.isPinned('b')).toBe(false);

    await act(async () => {
      await pinItem({ uri: 'b', kind: 'DOCUMENT', title: 'Bill' });
    });
    expect(result.current.items.map(i => i.uri)).toEqual(['b', 'a']);
  });

  it('toggle stars and unstars', async () => {
    const { result } = await renderHook(() => usePinnedItems());
    let state = false;
    await act(async () => {
      state = await result.current.toggle({ uri: 'x', kind: 'IMAGE' });
    });
    expect(state).toBe(true);
    expect(result.current.isPinned('x')).toBe(true);
    await act(async () => {
      state = await result.current.toggle({ uri: 'x', kind: 'IMAGE' });
    });
    expect(state).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  it('stops listening after unmount', async () => {
    const { result, unmount } = await renderHook(() => usePinnedItems());
    await act(async () => {});
    await unmount();
    await act(async () => {
      await pinItem({ uri: 'late', kind: 'IMAGE' });
    });
    expect(result.current.items).toEqual([]);
  });
});
