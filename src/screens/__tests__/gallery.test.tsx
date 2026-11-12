/**
 * GalleryScreen (the Photos tab).
 *
 * - CameraRoll comes from the repo's root mock; each test says which photos
 *   the "phone" has. Timestamps are relative to the real clock, so the day
 *   headings stay right whenever the suite runs.
 * - Photo access, the shared Pinpointer state, what the indexing queue is
 *   doing, recent photos and the index lookup (for the viewer) are mocked.
 * - '@react-navigation/native' is mocked wholesale; Screen and
 *   useScreenFocus fall back to "focused" without a navigator.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { GalleryScreen, PAGE_SIZE } from '../gallery';
import { usePinpointerShared } from '../../hooks/PinpointerContext';
import { useIndexingProgress } from '../../hooks/useIndexingProgress';
import type { IndexingProgress } from '../../hooks/useIndexingProgress';
import { __forgetBlockedPhotos } from '../../hooks/useStorageAccess';
import { addRecentPhoto } from '../../utils/RecentPhotos';
import { ensurePhotoAccess, getPhotoAccess, openAppSettingsAndWait } from '../../utils/StoragePermissions';
import { pinItem, resetPinnedCacheForTests } from '../../utils/PinnedItems';
import { addDays, startOfDay } from '../../utils/PhotoDates';

jest.mock('@react-navigation/native', () => ({ useNavigation: jest.fn() }));
jest.mock('../../hooks/PinpointerContext', () => ({ usePinpointerShared: jest.fn() }));
jest.mock('../../hooks/useIndexingProgress', () => ({ useIndexingProgress: jest.fn() }));
jest.mock('../../utils/RecentPhotos', () => ({ addRecentPhoto: jest.fn(async () => {}) }));
jest.mock('../../database', () => ({ getDocumentByPath: jest.fn(() => null) }));
jest.mock('../../utils/StoragePermissions', () => ({
  getPhotoAccess: jest.fn(),
  ensurePhotoAccess: jest.fn(),
  openAppSettingsAndWait: jest.fn(),
}));

const getPhotos = CameraRoll.getPhotos as jest.Mock;
const navigate = jest.fn();
const shared = {
  isPaused: false,
  handlePauseSync: jest.fn(),
  handleResumeSync: jest.fn(),
  setIsSearching: jest.fn(),
};
let progress: IndexingProgress;
const idleProgress = (): IndexingProgress => ({
  photos: { done: 0, total: null, running: false, queued: false, quick: false },
  papers: { done: 0, total: null, running: false, queued: false },
});

const NOW = Date.now();
const TODAY = startOfDay(NOW);
const MIN = 60_000;

/** One CameraRoll edge; `ms` is when the photo was taken. */
const edge = (name: string, ms: number) => ({
  node: {
    id: name,
    type: 'image/jpeg',
    subTypes: [],
    sourceType: 'UserLibrary',
    group_name: ['Camera'],
    image: { uri: `content://media/${name}`, filename: null, filepath: null, extension: null, height: 1, width: 1, fileSize: null, playableDuration: 0, orientation: null },
    timestamp: ms / 1000,
    modificationTimestamp: ms / 1000,
    location: null,
  },
});

const page = (edges: ReturnType<typeof edge>[], next?: string) => ({
  edges,
  page_info: { has_next_page: !!next, end_cursor: next },
});

const PHONE = [
  edge('today', TODAY + MIN),
  edge('yesterday', addDays(TODAY, -1) + 12 * 60 * MIN),
  edge('fivedays', addDays(TODAY, -5) + 9 * 60 * MIN),
  edge('old', addDays(TODAY, -40)),
];

const uris = () =>
  screen
    .queryAllByTestId(/^gallery-thumb-\d+-image$/)
    .map(n => (n.props.source as { uri: string }).uri.replace('content://media/', ''));

const renderGallery = async () => {
  const view = await render(<GalleryScreen />);
  await waitFor(() => expect(getPhotos).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByTestId('gallery-loading')).toBeNull());
  return view;
};

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  getPhotos.mockReset();
  getPhotos.mockResolvedValue(page(PHONE));
  (getPhotoAccess as jest.Mock).mockResolvedValue('full');
  (ensurePhotoAccess as jest.Mock).mockResolvedValue(true);
  (openAppSettingsAndWait as jest.Mock).mockResolvedValue('full');
  (useNavigation as jest.Mock).mockReturnValue({ navigate });
  navigate.mockClear();
  Object.assign(shared, { isPaused: false });
  shared.handlePauseSync.mockClear();
  shared.handleResumeSync.mockClear();
  shared.setIsSearching.mockClear();
  progress = idleProgress();
  (useIndexingProgress as jest.Mock).mockImplementation(() => progress);
  __forgetBlockedPhotos();
  (usePinpointerShared as jest.Mock).mockReturnValue(shared);
  (addRecentPhoto as jest.Mock).mockClear();
  resetPinnedCacheForTests();
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GalleryScreen', () => {
  it('shows every photo newest first, under day and month headings', async () => {
    await renderGallery();
    expect(screen.getByRole('header', { name: 'Photos' })).toBeTruthy();
    expect(uris()).toEqual(['today', 'yesterday', 'fivedays', 'old']);
    expect(screen.getByRole('header', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Yesterday' })).toBeTruthy();
    const five = new Date(addDays(TODAY, -5));
    expect(screen.getAllByRole('header').map(h => h.props.children)).toEqual(
      expect.arrayContaining([expect.stringContaining(String(five.getDate()))]),
    );
    expect(getPhotos).toHaveBeenCalledWith({ first: PAGE_SIZE, after: undefined, assetType: 'Photos' });
  });

  it('Last 7 days asks only for this week and drops anything older', async () => {
    await renderGallery();
    getPhotos.mockClear();
    await fireEvent.press(screen.getByTestId('gallery-filter-lastWeek'));
    await waitFor(() => expect(uris()).toEqual(['today', 'yesterday', 'fivedays']));
    expect(getPhotos).toHaveBeenCalledWith(
      expect.objectContaining({ fromTime: addDays(TODAY, -6) - 1, assetType: 'Photos' }),
    );
    expect(getPhotos.mock.calls[0][0]).not.toHaveProperty('toTime');
  });

  it('Today and Yesterday use their own day', async () => {
    await renderGallery();
    await fireEvent.press(screen.getByTestId('gallery-filter-today'));
    await waitFor(() => expect(uris()).toEqual(['today']));
    await fireEvent.press(screen.getByTestId('gallery-filter-yesterday'));
    await waitFor(() => expect(uris()).toEqual(['yesterday']));
    expect(getPhotos).toHaveBeenLastCalledWith(
      expect.objectContaining({ fromTime: addDays(TODAY, -1) - 1, toTime: TODAY - 1 }),
    );
  });

  it('Screenshots asks for the Screenshots album', async () => {
    await renderGallery();
    await fireEvent.press(screen.getByTestId('gallery-filter-screenshots'));
    await waitFor(() =>
      expect(getPhotos).toHaveBeenLastCalledWith(expect.objectContaining({ groupName: 'Screenshots' })),
    );
  });

  it('Important shows the starred photos without asking the gallery', async () => {
    await pinItem({ uri: 'content://media/fivedays', kind: 'IMAGE' });
    await pinItem({ uri: '/papers/bill.pdf', kind: 'DOCUMENT' });
    await renderGallery();
    expect(screen.getByTestId('gallery-star-2')).toBeTruthy();
    getPhotos.mockClear();
    await fireEvent.press(screen.getByTestId('gallery-filter-important'));
    await waitFor(() => expect(uris()).toEqual(['fivedays']));
    expect(getPhotos).not.toHaveBeenCalled();
  });

  it('explains an empty filter and goes back to all photos', async () => {
    await renderGallery();
    getPhotos.mockResolvedValue(page([]));
    await fireEvent.press(screen.getByTestId('gallery-filter-today'));
    expect(await screen.findByText('No photos from today')).toBeTruthy();
    getPhotos.mockResolvedValue(page(PHONE));
    await fireEvent.press(screen.getByText('See all photos'));
    await waitFor(() => expect(uris()).toHaveLength(4));
    expect(screen.getByTestId('gallery-filter-all').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('says so when there are no photos at all', async () => {
    getPhotos.mockResolvedValue(page([]));
    await renderGallery();
    expect(screen.getByText('No photos yet')).toBeTruthy();
    expect(screen.queryByText('See all photos')).toBeNull();
  });

  it('loads the next page at the end of the list', async () => {
    getPhotos.mockResolvedValueOnce(page(PHONE.slice(0, 2), 'cursor-1'));
    await renderGallery();
    expect(uris()).toEqual(['today', 'yesterday']);
    getPhotos.mockResolvedValueOnce(page(PHONE.slice(1), undefined));
    await act(async () => {
      fireEvent(screen.getByTestId('gallery-list'), 'onEndReached');
    });
    await waitFor(() => expect(uris()).toEqual(['today', 'yesterday', 'fivedays', 'old']));
    expect(getPhotos).toHaveBeenLastCalledWith(expect.objectContaining({ after: 'cursor-1' }));
    // No more pages: the end of the list asks for nothing.
    getPhotos.mockClear();
    await act(async () => {
      fireEvent(screen.getByTestId('gallery-list'), 'onEndReached');
    });
    expect(getPhotos).not.toHaveBeenCalled();
  });

  it('drops a page that arrives after the filter changed', async () => {
    let finishFirst: (v: unknown) => void = () => {};
    getPhotos.mockImplementationOnce(() => new Promise(resolve => (finishFirst = resolve)));
    await render(<GalleryScreen />);
    await waitFor(() => expect(getPhotos).toHaveBeenCalledTimes(1));
    getPhotos.mockResolvedValue(page([PHONE[0]]));
    await fireEvent.press(screen.getByTestId('gallery-filter-today'));
    await waitFor(() => expect(uris()).toEqual(['today']));
    await act(async () => finishFirst(page(PHONE)));
    expect(uris()).toEqual(['today']);
  });

  it('opens a photo in the viewer and can read its text', async () => {
    await renderGallery();
    await fireEvent.press(screen.getByTestId('gallery-photo-1'));
    expect(addRecentPhoto).toHaveBeenCalledWith('content://media/yesterday');
    const viewer = screen.getByTestId('photo-viewer-panel');
    expect(within(viewer).getByText('Text in this photo')).toBeTruthy();
    await fireEvent.press(within(viewer).getByRole('button', { name: 'Read text' }));
    expect(navigate).toHaveBeenCalledWith('SmartClipboard', { scanUri: 'content://media/yesterday' });
  });

  it('asks for photo access when it has none', async () => {
    (getPhotoAccess as jest.Mock).mockResolvedValueOnce('blocked');
    await render(<GalleryScreen />);
    expect(await screen.findByText('Let Pinpointer look at your photos')).toBeTruthy();
    expect(getPhotos).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Allow photos'));
    expect(ensurePhotoAccess).toHaveBeenCalled();
    await waitFor(() => expect(uris()).toHaveLength(4));
  });

  it('offers all photos when only some are allowed', async () => {
    (getPhotoAccess as jest.Mock).mockResolvedValue('limited');
    await renderGallery();
    expect(screen.getByText('Pinpointer can see only some photos')).toBeTruthy();
    (getPhotoAccess as jest.Mock).mockResolvedValue('full');
    await fireEvent.press(screen.getByText('Allow all photos'));
    expect(openAppSettingsAndWait).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('gallery-limited')).toBeNull());
  });

  it('shows a way to try again when photos fail to load', async () => {
    getPhotos.mockRejectedValueOnce(new Error('MediaStore busy'));
    await render(<GalleryScreen />);
    expect(await screen.findByText('Your photos could not be loaded.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    await waitFor(() => expect(uris()).toHaveLength(4));
  });

  it('the search button opens search itself, on Home', async () => {
    await renderGallery();
    await fireEvent.press(screen.getByRole('button', { name: 'Search your photos' }));
    expect(shared.setIsSearching).toHaveBeenCalledWith(true);
    expect(navigate).toHaveBeenCalledWith('Pinpointer');
  });

  it('shows photo progress while photos are being read, with pause', async () => {
    progress.photos = { done: 1240, total: 2400, running: true, queued: false, quick: false };
    await renderGallery();
    // The heading says how many can be searched; the card says how far along.
    expect(screen.getByText('1,240 photos ready to search')).toBeTruthy();
    expect(screen.getByText('Getting your photos ready')).toBeTruthy();
    expect(screen.getByText('1,240 of 2,400')).toBeTruthy();
    await fireEvent.press(screen.getByText('Pause'));
    expect(shared.handlePauseSync).toHaveBeenCalled();
  });

  it('counts every photo that is ready, not just the last check', async () => {
    // A quick check of 50 photos just ended; 2,400 were ready long before.
    progress.photos = { done: 2400, total: 2400, running: false, queued: false, quick: false };
    await renderGallery();
    expect(screen.getByText('2,400 photos ready to search')).toBeTruthy();
    expect(screen.queryByTestId('gallery-progress')).toBeNull();
  });

  it('a paused check offers Resume', async () => {
    shared.isPaused = true;
    progress.photos = { done: 300, total: 2400, running: false, queued: false, quick: false };
    await renderGallery();
    await fireEvent.press(screen.getByText('Resume'));
    expect(shared.handleResumeSync).toHaveBeenCalled();
  });

  it('loads the grid again when "some photos" becomes "all photos"', async () => {
    (getPhotoAccess as jest.Mock).mockResolvedValue('limited');
    getPhotos.mockResolvedValue(page([PHONE[0]]));
    await renderGallery();
    expect(uris()).toEqual(['today']);
    (getPhotoAccess as jest.Mock).mockResolvedValue('full');
    getPhotos.mockResolvedValue(page(PHONE));
    await fireEvent.press(screen.getByText('Allow all photos'));
    await waitFor(() => expect(uris()).toHaveLength(4));
  });

  it('labels each photo with when it was taken', async () => {
    await renderGallery();
    expect(screen.getByRole('button', { name: 'Photo, yesterday' })).toBeTruthy();
  });
});
