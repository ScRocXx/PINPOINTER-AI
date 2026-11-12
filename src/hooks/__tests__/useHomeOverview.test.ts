/**
 * useHomeOverview: what Home shows besides the shared Pinpointer state.
 *
 * The database, CLIP's text encoder, the camera roll and recent photos are
 * mocked, so these tests pin down the wiring: which tile gets which photos
 * and counts, when things refresh, and that nothing asks for permission or
 * breaks when a source fails.
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { useHomeOverview, HomeOverviewOptions } from '../useHomeOverview';
import { countCheckedFiles, getCollectionPreview, getSimilarPhotos } from '../../database';
import { encodeText } from '../../services/EmbeddingService';
import { getRecentPhotos } from '../../utils/RecentPhotos';
import type { Collection } from '../../utils/Collections';

jest.mock('../../database', () => ({
  countCheckedFiles: jest.fn(),
  getCollectionPreview: jest.fn(),
  getSimilarPhotos: jest.fn(),
}));

jest.mock('../../services/EmbeddingService', () => ({
  encodeText: jest.fn(),
}));

jest.mock('../../utils/RecentPhotos', () => ({
  getRecentPhotos: jest.fn(),
}));

const mockChecked = countCheckedFiles as jest.Mock;
const mockPreview = getCollectionPreview as jest.Mock;
const mockSimilar = getSimilarPhotos as jest.Mock;
const mockEncode = encodeText as jest.Mock;
const mockRecent = getRecentPhotos as jest.Mock;
const mockAlbums = CameraRoll.getAlbums as jest.Mock;
const mockPhotos = CameraRoll.getPhotos as jest.Mock;

const PREVIEWS: Record<string, { count: number; capped: boolean; photos: string[] }> = {
  id: { count: 4, capped: false, photos: ['file:///aadhaar.jpg', 'file:///pan.jpg'] },
  bill: { count: 999, capped: true, photos: ['file:///bill.jpg'] },
  medicine: { count: 0, capped: false, photos: [] },
  bank: { count: 2, capped: false, photos: [] },
  family: { count: 3, capped: false, photos: ['file:///wedding.jpg'] },
};

const album = (title: string, count: number) => ({ title, count });
const edges = (...uris: string[]) => ({ edges: uris.map(uri => ({ node: { image: { uri } } })) });

/** Render the hook and wait for its first load (it starts after the first frame). */
const mount = async (initialProps: HomeOverviewOptions = { busy: false }) => {
  const view = await renderHook((props: HomeOverviewOptions) => useHomeOverview(props), { initialProps });
  await waitFor(() => expect(mockRecent).toHaveBeenCalled());
  await act(async () => {});
  return view;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockChecked.mockReturnValue(120);
  mockPreview.mockImplementation((c: Collection) => PREVIEWS[c.id] ?? { count: 0, capped: false, photos: [] });
  mockSimilar.mockReturnValue([]);
  mockEncode.mockResolvedValue(null);
  mockRecent.mockResolvedValue([]);
  mockAlbums.mockResolvedValue([]);
  mockPhotos.mockResolvedValue(edges());
});

afterEach(() => {
  jest.useRealTimers();
});

describe('useHomeOverview', () => {
  describe('before anything is known', () => {
    it('starts with every tile empty and nothing counted', async () => {
      mockRecent.mockReturnValue(new Promise(() => {}));
      const { result } = await renderHook(() => useHomeOverview({ busy: false }));
      expect(Object.keys(result.current.collections).sort()).toEqual(
        ['bank', 'bill', 'family', 'id', 'medicine', 'screenshot'],
      );
      expect(result.current.photoTotal).toBeNull();
      expect(result.current.recent).toEqual([]);
    });
  });

  describe('tiles found by words', () => {
    it('shows each collection\'s count and newest photos', async () => {
      const { result } = await mount();
      expect(result.current.collections.id).toEqual({
        count: 4,
        capped: false,
        photos: ['file:///aadhaar.jpg', 'file:///pan.jpg'],
      });
      expect(result.current.collections.medicine).toEqual({ count: 0, capped: false, photos: [] });
      expect(result.current.collections.bank.count).toBe(2);
    });

    it('passes on "there are more" for a full collection', async () => {
      const { result } = await mount();
      expect(result.current.collections.bill).toEqual({ count: 999, capped: true, photos: ['file:///bill.jpg'] });
    });

    it('asks for three photos per tile and never queries a collection without words', async () => {
      await mount();
      const asked = mockPreview.mock.calls.map(([c, limit]: [Collection, number]) => [c.id, limit]);
      expect(asked).toEqual(expect.arrayContaining([['id', 3], ['bill', 3], ['medicine', 3], ['bank', 3], ['family', 3]]));
      expect(asked.some(([id]) => id === 'screenshot')).toBe(false);
    });
  });

  describe('photos on the phone', () => {
    it('adds up the albums for the total and reads how many were checked', async () => {
      mockAlbums.mockResolvedValue([album('Camera', 2000), album('WhatsApp Images', 400)]);
      const { result } = await mount();
      await waitFor(() => expect(result.current.photoTotal).toBe(2400));
      expect(result.current.photosChecked).toBe(120);
      expect(mockChecked).toHaveBeenCalledWith('IMAGE');
      expect(mockAlbums).toHaveBeenCalledWith({ assetType: 'Photos' });
    });

    it('leaves the total unknown when there are no albums', async () => {
      const { result } = await mount();
      expect(result.current.photoTotal).toBeNull();
    });

    it('leaves the total unknown when photos cannot be read (no permission yet)', async () => {
      mockAlbums.mockRejectedValue(new Error('Permission denied'));
      const { result } = await mount();
      expect(result.current.photoTotal).toBeNull();
      expect(result.current.collections.id.count).toBe(4);
    });

    it('ignores an album without a count', async () => {
      mockAlbums.mockResolvedValue([album('Camera', 10), { title: 'Odd' }]);
      const { result } = await mount();
      await waitFor(() => expect(result.current.photoTotal).toBe(10));
    });
  });

  describe('the Screenshots tile', () => {
    it('is filled from the phone\'s Screenshots album, without a count', async () => {
      mockAlbums.mockResolvedValue([album('Camera', 50), album('Screenshots', 7)]);
      mockPhotos.mockResolvedValue(edges('content://media/1', 'content://media/2', 'content://media/3'));
      const { result } = await mount();
      await waitFor(() => expect(result.current.collections.screenshot.photos).toHaveLength(3));
      expect(result.current.collections.screenshot).toEqual({
        count: null,
        capped: false,
        photos: ['content://media/1', 'content://media/2', 'content://media/3'],
      });
      expect(mockPhotos).toHaveBeenCalledWith({
        first: 3,
        groupName: 'Screenshots',
        groupTypes: 'Album',
        assetType: 'Photos',
      });
    });

    it('stays empty when the phone has no Screenshots album', async () => {
      mockAlbums.mockResolvedValue([album('Camera', 50)]);
      const { result } = await mount();
      await waitFor(() => expect(result.current.photoTotal).toBe(50));
      expect(result.current.collections.screenshot).toEqual({ count: null, capped: false, photos: [] });
      expect(mockPhotos).not.toHaveBeenCalled();
    });

    it('does not read an empty Screenshots album', async () => {
      mockAlbums.mockResolvedValue([album('Screenshots', 0)]);
      await mount();
      expect(mockPhotos).not.toHaveBeenCalled();
    });
  });

  describe('recently opened', () => {
    it('shows the newest eight', async () => {
      mockRecent.mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ uri: `file:///r${i}.jpg`, viewedAt: 100 - i })));
      const { result } = await mount();
      await waitFor(() => expect(result.current.recent).toHaveLength(8));
      expect(result.current.recent[0]).toBe('file:///r0.jpg');
      expect(result.current.recent[7]).toBe('file:///r7.jpg');
    });
  });

  describe('Family, found by look', () => {
    it('adds look-alike photos after search\'s warm-up and drops the count', async () => {
      jest.useFakeTimers();
      const vector = new Float32Array([0.1, 0.2]);
      mockEncode.mockResolvedValue(vector);
      mockSimilar.mockReturnValue(['file:///mum.jpg', 'file:///wedding.jpg', 'file:///kids.jpg', 'file:///picnic.jpg']);

      const { result } = await renderHook(() => useHomeOverview({ busy: false }));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(500);
      });
      expect(result.current.collections.family).toEqual({ count: 3, capped: false, photos: ['file:///wedding.jpg'] });
      expect(mockEncode).not.toHaveBeenCalled();

      await act(async () => {
        await jest.advanceTimersByTimeAsync(3000);
      });
      expect(mockEncode).toHaveBeenCalledWith('family photo');
      expect(mockSimilar).toHaveBeenCalledWith(vector, 9);
      expect(result.current.collections.family).toEqual({
        count: null,
        capped: false,
        photos: ['file:///mum.jpg', 'file:///wedding.jpg', 'file:///kids.jpg'],
      });
    });

    it('keeps the tile found by words when CLIP is not available', async () => {
      jest.useFakeTimers();
      const { result } = await renderHook(() => useHomeOverview({ busy: false }));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });
      expect(mockSimilar).not.toHaveBeenCalled();
      expect(result.current.collections.family).toEqual({ count: 3, capped: false, photos: ['file:///wedding.jpg'] });
    });

    it('survives the encoder failing', async () => {
      jest.useFakeTimers();
      mockEncode.mockRejectedValue(new Error('model missing'));
      const { result } = await renderHook(() => useHomeOverview({ busy: false }));
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });
      expect(result.current.collections.family.count).toBe(3);
    });

    it('does not ask CLIP after Home is gone', async () => {
      jest.useFakeTimers();
      const { unmount } = await renderHook(() => useHomeOverview({ busy: false }));
      await unmount();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(4000);
      });
      expect(mockEncode).not.toHaveBeenCalled();
    });
  });

  describe('while photos are being checked', () => {
    it('recounts as progress arrives, but not more than every two seconds', async () => {
      jest.useFakeTimers();
      const { result, rerender } = await renderHook((props: HomeOverviewOptions) => useHomeOverview(props), {
        initialProps: { busy: true, progressTick: 0 },
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
      });
      const before = mockChecked.mock.calls.length;

      mockChecked.mockReturnValue(150);
      await rerender({ busy: true, progressTick: 1 });
      expect(mockChecked.mock.calls.length).toBe(before);
      expect(result.current.photosChecked).toBe(120);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(2100);
      });
      await rerender({ busy: true, progressTick: 2 });
      expect(mockChecked.mock.calls.length).toBe(before + 1);
      expect(result.current.photosChecked).toBe(150);
    });

    it('refreshes the tiles less often than the count', async () => {
      jest.useFakeTimers();
      const { result, rerender } = await renderHook((props: HomeOverviewOptions) => useHomeOverview(props), {
        initialProps: { busy: true, progressTick: 0 },
      });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(100);
      });
      mockPreview.mockImplementation((c: Collection) => ({ count: c.id === 'id' ? 9 : 0, capped: false, photos: [] }));

      await act(async () => {
        await jest.advanceTimersByTimeAsync(2100);
      });
      await rerender({ busy: true, progressTick: 1 });
      expect(result.current.collections.id.count).toBe(4);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(6000);
      });
      await rerender({ busy: true, progressTick: 2 });
      expect(result.current.collections.id.count).toBe(9);
    });

    it('does nothing on progress when no check is running', async () => {
      const { rerender } = await mount({ busy: false, progressTick: 0 });
      const before = mockChecked.mock.calls.length;
      await rerender({ busy: false, progressTick: 5 });
      expect(mockChecked.mock.calls.length).toBe(before);
    });
  });

  describe('when a check finishes', () => {
    it('reads everything again', async () => {
      const { result, rerender } = await mount({ busy: true });
      mockChecked.mockReturnValue(2400);
      mockAlbums.mockResolvedValue([album('Camera', 2400)]);
      mockRecent.mockClear();

      await rerender({ busy: false });
      await waitFor(() => expect(result.current.photoTotal).toBe(2400));
      expect(result.current.photosChecked).toBe(2400);
      expect(mockRecent).toHaveBeenCalledTimes(1);
    });

    it('does not reload when a check starts', async () => {
      const { rerender } = await mount({ busy: false });
      mockRecent.mockClear();
      await rerender({ busy: true });
      await act(async () => {});
      expect(mockRecent).not.toHaveBeenCalled();
    });
  });

  describe('after Home is gone', () => {
    it('does not update state from a late answer', async () => {
      let finish: (value: unknown[]) => void = () => {};
      mockAlbums.mockReturnValue(new Promise(resolve => { finish = resolve; }));
      const { result, unmount } = await renderHook(() => useHomeOverview({ busy: false }));
      await waitFor(() => expect(mockAlbums).toHaveBeenCalled());
      await unmount();
      await act(async () => {
        finish([album('Camera', 10)]);
      });
      expect(result.current.photoTotal).toBeNull();
    });
  });
});
