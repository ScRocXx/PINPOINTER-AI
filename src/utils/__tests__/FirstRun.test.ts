import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { FIRST_RUN_KEY, hasFinishedFirstRun, markFirstRunDone } from '../FirstRun';
import { useFirstRunGate } from '../../hooks/useFirstRun';
import { getIndexedCount } from '../../database';

jest.mock('../../database', () => ({ getIndexedCount: jest.fn(() => 0) }));

const indexed = getIndexedCount as jest.Mock;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  indexed.mockReturnValue(0);
});

describe('FirstRun', () => {
  it('shows the first run to someone new', async () => {
    await expect(hasFinishedFirstRun()).resolves.toBe(false);
  });

  it('remembers once it is done', async () => {
    await markFirstRunDone();
    expect(await AsyncStorage.getItem(FIRST_RUN_KEY)).toBe('1');
    await expect(hasFinishedFirstRun()).resolves.toBe(true);
  });

  it('skips it for people updating with photos already ready, and remembers that', async () => {
    indexed.mockReturnValue(42);
    await expect(hasFinishedFirstRun()).resolves.toBe(true);
    expect(await AsyncStorage.getItem(FIRST_RUN_KEY)).toBe('1');
  });

  it('never throws when storage fails', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(hasFinishedFirstRun()).resolves.toBe(false);
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    await expect(markFirstRunDone()).resolves.toBeUndefined();
  });
});

describe('useFirstRunGate', () => {
  it('checks, then shows the first run', async () => {
    const { result } = await renderHook(() => useFirstRunGate());
    await act(async () => {});
    expect(result.current).toBe('show');
  });

  it('skips once done', async () => {
    await markFirstRunDone();
    const { result } = await renderHook(() => useFirstRunGate());
    await act(async () => {});
    expect(result.current).toBe('skip');
  });

  it('goes straight to Home when anything goes wrong', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    indexed.mockImplementation(() => {
      throw new Error('db');
    });
    const { result } = await renderHook(() => useFirstRunGate());
    await act(async () => {});
    expect(result.current).toBe('skip');
  });
});
