import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { useReducedMotion } from '../useReducedMotion';

describe('useReducedMotion', () => {
  let handler: ((value: boolean) => void) | undefined;
  const remove = jest.fn();

  beforeEach(() => {
    handler = undefined;
    remove.mockClear();
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_event: string, fn: (v: boolean) => void) => {
      handler = fn;
      return { remove };
    }) as unknown as typeof AccessibilityInfo.addEventListener);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads the setting on mount', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    const { result } = await renderHook(() => useReducedMotion());
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('follows changes and cleans up', async () => {
    const { result, unmount } = await renderHook(() => useReducedMotion());
    await act(async () => {});
    expect(result.current).toBe(false);
    await act(async () => handler?.(true));
    expect(result.current).toBe(true);
    await unmount();
    expect(remove).toHaveBeenCalled();
  });

  it('stays false when the check fails', async () => {
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockRejectedValue(new Error('nope'));
    const { result } = await renderHook(() => useReducedMotion());
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('asks Android once and shares the answer, however many parts animate', async () => {
    // The preset's mocks outlive spyOn/restore: count from here.
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockClear();
    (AccessibilityInfo.addEventListener as jest.Mock).mockClear();
    (AccessibilityInfo.isReduceMotionEnabled as jest.Mock).mockResolvedValue(true);
    // Three animated parts in one tree, like one photo tile.
    const { result, unmount } = await renderHook(() => [useReducedMotion(), useReducedMotion(), useReducedMotion()]);
    await waitFor(() => expect(result.current).toEqual([true, true, true]));
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(1);

    await act(async () => handler?.(false));
    expect(result.current).toEqual([false, false, false]);

    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
