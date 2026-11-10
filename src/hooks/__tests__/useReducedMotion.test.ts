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
});
