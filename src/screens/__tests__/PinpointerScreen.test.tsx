/**
 * Component tests for PinpointerScreen — the app's main search/dashboard screen.
 *
 * Strategy: the screen's only real collaborator is the shared pinpointer
 * context, which is replaced by a STATEFUL mock (a plain `state` object +
 * jest.fn setters that mutate it, re-read on every render). Navigation,
 * the Home overview (tiles, photo totals), Important stars, RecentPhotos,
 * database, and DocumentClassifier are mocked; the real search parts
 * (SearchOverlay, ResultItem, RecentSearches, NothingFound, ListeningPanel)
 * and the shared PhotoViewer render, so the search flows are exercised for
 * real. The parts have their own tests in `../pinpointer/__tests__`.
 *
 * RNTL v14: render/fireEvent/act/waitFor are async — everything awaited.
 */

jest.mock('../../hooks/PinpointerContext', () => ({
  usePinpointerShared: jest.fn(),
}));

jest.mock('@react-navigation/native', () => ({
  useNavigation: jest.fn(),
  useRoute: jest.fn(),
}));

// Home's own data (tiles from the database, photo totals from MediaStore)
// is tested in useHomeOverview's tests; here it is a fixed value per test.
jest.mock('../../hooks/useHomeOverview', () => ({
  useHomeOverview: jest.fn(),
}));

jest.mock('../../hooks/usePinnedItems', () => ({
  usePinnedItems: jest.fn(),
}));

jest.mock('../../utils/RecentPhotos', () => ({
  addRecentPhoto: jest.fn(),
}));

jest.mock('../../database', () => ({
  getDocumentByPath: jest.fn(() => null),
}));

jest.mock('../../utils/MissingFiles', () => ({
  forgetIfGone: jest.fn(async () => false),
}));

jest.mock('../../utils/DocumentClassifier', () => ({
  classifyDocument: jest.fn(() => ({ emoji: '📄', category: 'OTHER', confidence: 1 })),
}));

// ModelDownloadSheet calls useModelService() unconditionally, which throws
// outside a ModelServiceProvider — replace just that component.
jest.mock('../../components/ModelDownloadSheet', () => ({
  ModelDownloadSheet: () => null,
}));

import React from 'react';
import { AccessibilityInfo, Alert, NativeModules } from 'react-native';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  within,
} from '@testing-library/react-native';
import type { RenderResult } from '@testing-library/react-native';
import RNFS from 'react-native-fs';

import { PinpointerScreen } from '../PinpointerScreen';
import { usePinpointerShared } from '../../hooks/PinpointerContext';
import { useNavigation, useRoute } from '@react-navigation/native';
import { addRecentPhoto } from '../../utils/RecentPhotos';
import { forgetIfGone } from '../../utils/MissingFiles';
import { useHomeOverview } from '../../hooks/useHomeOverview';
import type { HomeOverview } from '../../hooks/useHomeOverview';
import { usePinnedItems } from '../../hooks/usePinnedItems';
import type { PinnedItem } from '../../utils/PinnedItems';
import type { DocumentRecord } from '../../database';
import type { SearchHistoryItem } from '../../utils/SearchHistory';

// ─── Stateful context harness ───────────────────────────────────────────────

interface ScreenState {
  searchText: string;
  searchResults: DocumentRecord[];
  isSearching: boolean;
  isSearchPending: boolean;
  searchHistory: SearchHistoryItem[];
  isRecording: boolean;
  isTranscribing: boolean;
  isModelLoading: boolean;
  isSyncing: boolean;
  isPaused: boolean;
  isDeepSync: boolean;
  syncCount: number;
  totalImages: number;
  lastSyncTime: number | null;
  isSyncingDocs: boolean;
  docSyncCount: number;
  totalDocs: number;
  lastDocSyncTime: number | null;
}

const baseState = (): ScreenState => ({
  searchText: '',
  searchResults: [],
  isSearching: false,
  isSearchPending: false,
  searchHistory: [],
  isRecording: false,
  isTranscribing: false,
  isModelLoading: false,
  isSyncing: false,
  isPaused: false,
  isDeepSync: false,
  syncCount: 0,
  totalImages: 0,
  lastSyncTime: null,
  isSyncingDocs: false,
  docSyncCount: 0,
  totalDocs: 0,
  lastDocSyncTime: null,
});

let state: ScreenState;
let actions: Record<string, jest.Mock>;
let overview: HomeOverview;
let pinned: PinnedItem[];
let toggleStar: jest.Mock;

const tile = (count: number | null = null, photos: string[] = []) => ({ count, capped: false, photos });
const baseOverview = (): HomeOverview => ({
  collections: {
    id: tile(),
    bill: tile(),
    medicine: tile(),
    bank: tile(),
    screenshot: tile(),
    family: tile(),
  },
  photoTotal: null,
  photosChecked: null,
  recent: [],
});
let mockNav: { navigate: jest.Mock; setParams: jest.Mock };

const makeActions = (): Record<string, jest.Mock> => ({
  setSearchText: jest.fn((v: string) => { state.searchText = v; }),
  setIsSearching: jest.fn((v: boolean) => { state.isSearching = v; }),
  startListening: jest.fn(),
  stopListening: jest.fn(),
  cancelListening: jest.fn(),
  handleScan: jest.fn(),
  handleQuickSync: jest.fn(),
  handleDeepSync: jest.fn(),
  handlePauseSync: jest.fn(),
  handleResumeSync: jest.fn(),
  handleDocumentSync: jest.fn(),
  handleSelectHistory: jest.fn(),
  handleDeleteHistory: jest.fn(),
  handleClearHistory: jest.fn(),
});

/** Fresh context value on every render, reading live state. */
const makeCtx = () => ({
  searchText: state.searchText,
  setSearchText: actions.setSearchText,
  searchResults: state.searchResults,
  isSearching: state.isSearching,
  setIsSearching: actions.setIsSearching,
  isSearchPending: state.isSearchPending,
  isRecording: state.isRecording,
  isTranscribing: state.isTranscribing,
  isModelLoading: state.isModelLoading,
  startListening: actions.startListening,
  stopListening: actions.stopListening,
  cancelListening: actions.cancelListening,
  handleScan: actions.handleScan,
  handleQuickSync: actions.handleQuickSync,
  handleDeepSync: actions.handleDeepSync,
  handlePauseSync: actions.handlePauseSync,
  handleResumeSync: actions.handleResumeSync,
  isSyncing: state.isSyncing,
  isPaused: state.isPaused,
  isDeepSync: state.isDeepSync,
  syncCount: state.syncCount,
  totalImages: state.totalImages,
  lastSyncTime: state.lastSyncTime,
  isSyncingDocs: state.isSyncingDocs,
  docSyncCount: state.docSyncCount,
  totalDocs: state.totalDocs,
  lastDocSyncTime: state.lastDocSyncTime,
  handleDocumentSync: actions.handleDocumentSync,
  searchHistory: state.searchHistory,
  handleSelectHistory: actions.handleSelectHistory,
  handleDeleteHistory: actions.handleDeleteHistory,
  handleClearHistory: actions.handleClearHistory,
});

// ─── Test data ──────────────────────────────────────────────────────────────

const imgResult = (overrides: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 1,
  content: 'my cat photo at home',
  filePath: 'file:///photos/cat.jpg',
  type: 'IMAGE',
  detection_type: 'TEXT',
  timestamp: 1700000000000,
  ...overrides,
});

const docResult = (overrides: Partial<DocumentRecord> = {}): DocumentRecord => ({
  id: 2,
  title: 'Aadhaar Card',
  content: 'aadhaar card details 9999',
  filePath: 'file:///docs/aadhaar.pdf',
  type: 'DOCUMENT',
  detection_type: 'TEXT',
  timestamp: 1700000001000,
  ...overrides,
});

const historyItem = (query: string, resultCount = 3): SearchHistoryItem => ({
  query,
  timestamp: 1700000000000,
  resultCount,
});

// ─── Helpers ────────────────────────────────────────────────────────────────

const renderScreen = async (): Promise<RenderResult> => {
  let result!: RenderResult;
  await act(async () => {
    result = await render(<PinpointerScreen />);
  });
  return result;
};

const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await fireEvent.press(element);
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  state = baseState();
  actions = makeActions();
  mockNav = { navigate: jest.fn(), setParams: jest.fn() };

  (usePinpointerShared as jest.Mock).mockImplementation(() => makeCtx());
  overview = baseOverview();
  pinned = [];
  toggleStar = jest.fn(async () => false);
  (useHomeOverview as jest.Mock).mockImplementation(() => overview);
  (usePinnedItems as jest.Mock).mockImplementation(() => ({ items: pinned, isPinned: () => false, toggle: toggleStar }));
  (useNavigation as jest.Mock).mockReturnValue(mockNav);
  (useRoute as jest.Mock).mockReturnValue({ params: {} });
  (RNFS.exists as jest.Mock).mockResolvedValue(true);
  (addRecentPhoto as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** The search field you type in (only there while search is open). */
const searchInput = () => screen.getByTestId('search-bar-input');

describe('PinpointerScreen — Home', () => {
  test('renders Home: the question, the search bar, Find quickly and Important', async () => {
    await renderScreen();
    expect(within(screen.getByTestId('home')).getByText('Pinpointer')).toBeTruthy();
    expect(screen.getByText('What are you looking for?')).toBeTruthy();
    expect(screen.getByLabelText('Try “Aadhaar” or “bijli bill”')).toBeTruthy();
    expect(screen.getByText('Find quickly')).toBeTruthy();
    expect(screen.getByText('ID cards')).toBeTruthy();
    expect(screen.getByText('Screenshots')).toBeTruthy();
    expect(screen.getByText('Tap the star on any photo to keep it here.')).toBeTruthy();
  });

  test('none of the old menu words are left', async () => {
    await renderScreen();
    for (const word of ['Scan Images', 'Scan docs', 'Universal Sync', 'Doc Vault', 'Ready to search your offline vault.']) {
      expect(screen.queryByText(word)).toBeNull();
    }
    expect(screen.queryByLabelText('Open menu')).toBeNull();
  });

  test('tapping the Home search bar opens search', async () => {
    await renderScreen();
    await press(screen.getByTestId('home-search-open'));
    expect(actions.setIsSearching).toHaveBeenCalledWith(true);
    expect(actions.setSearchText).not.toHaveBeenCalled();
  });

  test('a Find quickly tile searches for its whole collection', async () => {
    overview.collections.id = tile(12, ['content://media/1']);
    await renderScreen();
    await press(screen.getByLabelText('ID cards, 12 found, Aadhaar, PAN, voter ID'));
    expect(actions.setSearchText).toHaveBeenCalledWith('ID cards');
    expect(actions.setIsSearching).toHaveBeenCalledWith(true);
  });

  test('typing in the search box updates the search text', async () => {
    state.isSearching = true;
    await renderScreen();
    await act(async () => {
      await fireEvent.changeText(searchInput(), 'passport');
    });
    expect(actions.setSearchText).toHaveBeenCalledWith('passport');
  });

  test('search is not in the tree until it is opened', async () => {
    await renderScreen();
    expect(screen.queryByTestId('search-overlay')).toBeNull();
  });

  test('close search button exits searching mode', async () => {
    state.isSearching = true;
    await renderScreen();
    await press(screen.getByRole('button', { name: 'Close search' }));
    expect(actions.setIsSearching).toHaveBeenCalledWith(false);
    // The screen clears the query on a 300ms delay — drain it here so the
    // timer cannot leak into a later test and wipe its searchText.
    await waitFor(
      () => expect(actions.setSearchText).toHaveBeenCalledWith(''),
      { timeout: 2000 },
    );
  });
});

describe('PinpointerScreen — search history', () => {
  const withHistory = async (): Promise<RenderResult> => {
    state.isSearching = true;
    state.searchText = '';
    state.searchHistory = [historyItem('aadhaar'), historyItem('passport', 0)];
    return renderScreen();
  };

  test('shows recent searches when nothing is typed', async () => {
    await withHistory();
    expect(screen.getByText('Recent searches')).toBeTruthy();
    expect(screen.getByText('aadhaar')).toBeTruthy();
    expect(screen.getByText('passport')).toBeTruthy();
  });

  test('shows the empty-history message when there is no history', async () => {
    state.isSearching = true;
    state.searchText = '';
    state.searchHistory = [];
    await renderScreen();
    expect(screen.getByText('Your searches will show here.')).toBeTruthy();
  });

  test('tapping a history query selects it', async () => {
    await withHistory();
    await press(screen.getByText('aadhaar'));
    expect(actions.handleSelectHistory).toHaveBeenCalledWith('aadhaar');
  });

  test('Clear all asks first, then clears the history', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await withHistory();
    await press(screen.getByText('Clear all'));
    expect(actions.handleClearHistory).not.toHaveBeenCalled();
    const buttons = alertSpy.mock.calls[0][2] ?? [];
    await act(async () => {
      buttons.find(b => b.style === 'destructive')?.onPress?.();
    });
    expect(actions.handleClearHistory).toHaveBeenCalled();
  });

  test('the remove button on a row deletes that query', async () => {
    await withHistory();
    await press(screen.getByRole('button', { name: 'Remove aadhaar from recent searches' }));
    expect(actions.handleDeleteHistory).toHaveBeenCalledWith('aadhaar');
  });

  test('recent searches are hidden once text is typed', async () => {
    state.isSearching = true;
    state.searchText = 'aadhaar';
    state.searchHistory = [historyItem('aadhaar')];
    state.searchResults = [];
    await renderScreen();
    expect(screen.queryByTestId('recent-searches')).toBeNull();
  });
});

describe('PinpointerScreen — search results', () => {
  const withResults = async (): Promise<RenderResult> => {
    state.isSearching = true;
    state.searchText = 'cat';
    state.searchResults = [imgResult(), docResult()];
    return renderScreen();
  };

  test('renders a row per search result', async () => {
    await withResults();
    expect(screen.getAllByTestId('result-item')).toHaveLength(2);
    expect(screen.getByTestId('search-count')).toHaveTextContent('2 found');
  });

  test('rows say Photo or Paper in plain words', async () => {
    state.isSearching = true;
    state.searchText = 'x';
    state.searchResults = [
      imgResult({ id: 1, detection_type: 'TEXT' }),
      imgResult({ id: 3, detection_type: 'OBJECT', content: 'Dog, Grass', filePath: 'file:///photos/obj.jpg' }),
      docResult(),
    ];
    await renderScreen();
    expect(screen.getAllByText('Photo')).toHaveLength(2);
    expect(screen.getByText('Paper')).toBeTruthy();
    expect(screen.getByText('Shows: Dog, Grass')).toBeTruthy();
    expect(screen.queryByText(/Object|Tap to/)).toBeNull();
  });

  test('filter chips narrow the results and All restores them', async () => {
    await withResults();
    await press(screen.getByTestId('search-filter-IMAGE'));
    expect(screen.getAllByTestId('result-item')).toHaveLength(1);
    await press(screen.getByTestId('search-filter-DOCUMENT'));
    expect(screen.getAllByTestId('result-item')).toHaveLength(1);
    expect(screen.getByText('Aadhaar Card')).toBeTruthy();
    await press(screen.getByTestId('search-filter-ALL'));
    expect(screen.getAllByTestId('result-item')).toHaveLength(2);
  });

  test('tapping a photo opens the viewer and logs a recent photo', async () => {
    await withResults();
    expect(screen.queryByTestId('search-photo-viewer')).toBeNull();
    await press(screen.getAllByTestId('result-item')[0]);
    await waitFor(() => expect(screen.getByTestId('search-photo-viewer')).toBeTruthy());
    expect(addRecentPhoto).toHaveBeenCalledWith('file:///photos/cat.jpg');
    // The words Pinpointer read in the photo, with what was searched marked.
    expect(screen.getByText('Text in this photo')).toBeTruthy();

    await press(screen.getByTestId('search-photo-viewer-close'));
    await waitFor(() => expect(screen.queryByTestId('search-photo-viewer')).toBeNull());
  });

  test('a re-rank under the open viewer does not change the photo on show', async () => {
    const r = await withResults();
    await press(screen.getAllByTestId('result-item')[0]);
    await waitFor(() => expect(screen.getByTestId('search-photo-viewer')).toBeTruthy());
    state.searchResults = [
      imgResult({ id: 9, filePath: 'file:///photos/other.jpg', content: 'another cat' }),
      imgResult(),
    ];
    await r.rerender(<PinpointerScreen />);
    const photos = screen.getAllByTestId('search-photo-viewer-photo');
    expect(photos).toHaveLength(1);
    expect(photos[0].props.source).toEqual({ uri: 'file:///photos/cat.jpg' });
  });

  test('"Read text" in the viewer opens Scan on that photo', async () => {
    state.isSearching = true;
    state.searchText = 'dog';
    state.searchResults = [
      imgResult({ detection_type: 'OBJECT', content: 'Dog, Grass', filePath: 'file:///photos/dog.jpg' }),
    ];
    await renderScreen();
    await press(screen.getByTestId('result-item'));
    await waitFor(() => expect(screen.getByTestId('search-photo-viewer')).toBeTruthy());
    await press(screen.getByRole('button', { name: /Read text/ }));
    expect(mockNav.navigate).toHaveBeenCalledWith('SmartClipboard', { scanUri: 'file:///photos/dog.jpg' });
  });

  test('tapping a photo deleted from the phone removes it from search instead of opening it', async () => {
    (forgetIfGone as jest.Mock).mockResolvedValueOnce(true);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    await withResults();
    await press(screen.getAllByTestId('result-item')[0]);
    await waitFor(() => expect(screen.getAllByTestId('result-item')).toHaveLength(1));
    expect(forgetIfGone).toHaveBeenCalledWith('file:///photos/cat.jpg', 'IMAGE');
    expect(announce).toHaveBeenCalledWith('This file is no longer on your phone.');
    expect(addRecentPhoto).not.toHaveBeenCalled();
    expect(screen.queryByTestId('search-photo-viewer')).toBeNull();
  });

  test('tapping a paper opens the PDF via the native StorageModule', async () => {
    state.isSearching = true;
    state.searchText = 'aadhaar';
    state.searchResults = [docResult()];
    await renderScreen();
    await press(screen.getByTestId('result-item'));
    await waitFor(() => {
      expect(NativeModules.StorageModule.openPDF).toHaveBeenCalledWith('/docs/aadhaar.pdf');
    });
  });

  test('tapping a paper that cannot be opened says so and does not open it', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');
    state.isSearching = true;
    state.searchText = 'aadhaar';
    state.searchResults = [docResult()];
    await renderScreen();
    await press(screen.getByTestId('result-item'));
    await waitFor(() => expect(announce).toHaveBeenCalledWith('This paper could not be opened.'));
    expect(NativeModules.StorageModule.openPDF).not.toHaveBeenCalled();
    // Only forgetIfGone may decide a file was deleted: the row stays.
    expect(screen.getByTestId('result-item')).toBeTruthy();
  });
});

describe('PinpointerScreen — empty results', () => {
  test('shows the nothing-found page when the search returns nothing', async () => {
    state.isSearching = true;
    state.searchText = 'zzzz-no-such-thing';
    state.searchResults = [];
    state.isSearchPending = false;
    await renderScreen();
    expect(screen.getByText('Nothing found for “zzzz-no-such-thing” yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Look through all photos' })).toBeTruthy();
    expect(screen.queryByText(/Universal Sync/)).toBeNull();
  });

  test('"Look through all photos" closes search and starts both sync engines', async () => {
    state.isSearching = true;
    state.searchText = 'zzzz-no-such-thing';
    state.searchResults = [];
    await renderScreen();
    await press(screen.getByRole('button', { name: 'Look through all photos' }));
    expect(actions.setIsSearching).toHaveBeenCalledWith(false);
    expect(actions.handleDeepSync).toHaveBeenCalled();
    expect(actions.handleDocumentSync).toHaveBeenCalled();
    // Drain the 300ms delayed query-clear so it cannot leak into later tests.
    await waitFor(
      () => expect(actions.setSearchText).toHaveBeenCalledWith(''),
      { timeout: 2000 },
    );
  });

  test('says so when photos are still being read, instead of offering to look again', async () => {
    state.isSearching = true;
    state.searchText = 'zzz';
    state.isSyncing = true;
    state.syncCount = 10;
    state.totalImages = 300;
    await renderScreen();
    expect(screen.getByText(/still getting your photos ready \(10 of 300\)/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Look through all photos' })).toBeNull();
  });

  test('pending search shows "Looking…" instead of the empty state', async () => {
    state.isSearching = true;
    state.searchText = 'zzz';
    state.searchResults = [];
    state.isSearchPending = true;
    await renderScreen();
    expect(screen.getByTestId('search-pending')).toBeTruthy();
    expect(screen.queryByTestId('nothing-found')).toBeNull();
  });
});

describe('PinpointerScreen — getting ready (indexing)', () => {
  test('a running check shows the progress card in plain words, with Pause', async () => {
    state.isSyncing = true;
    state.isDeepSync = true;
    state.syncCount = 10;
    overview.photoTotal = 2400;
    overview.photosChecked = 1240;
    await renderScreen();
    expect(screen.getByText('Getting your photos ready')).toBeTruthy();
    expect(screen.getByText('1,240 of 2,400 · you can search now')).toBeTruthy();
    await press(screen.getByText('Pause'));
    expect(actions.handlePauseSync).toHaveBeenCalled();
  });

  test('a paused check offers Resume', async () => {
    state.isPaused = true;
    await renderScreen();
    await press(screen.getByText('Resume'));
    expect(actions.handleResumeSync).toHaveBeenCalled();
  });

  test('papers getting ready shows their own card', async () => {
    state.isSyncingDocs = true;
    state.docSyncCount = 5;
    state.totalDocs = 20;
    await renderScreen();
    expect(screen.getByText('Getting your papers ready')).toBeTruthy();
    expect(screen.getByText('5 of 20')).toBeTruthy();
  });

  test('at rest it is one plain "checked" line, and Check again looks for new photos and papers', async () => {
    state.lastSyncTime = Date.now() - 5 * 60 * 1000;
    state.lastDocSyncTime = Date.now() - 2 * 3600 * 1000;
    await renderScreen();
    expect(screen.getByText('Photos checked 5 min ago')).toBeTruthy();
    expect(screen.getByText('Papers checked 2 hours ago')).toBeTruthy();
    expect(screen.queryByTestId('home-progress')).toBeNull();
    await press(screen.getByText('Check again'));
    expect(actions.handleQuickSync).toHaveBeenCalled();
    expect(actions.handleDocumentSync).toHaveBeenCalledWith(50);
    expect(actions.handleDeepSync).not.toHaveBeenCalled();
  });

  test('never checked: says so and offers Check now', async () => {
    await renderScreen();
    expect(screen.getByText('Not checked for new photos yet')).toBeTruthy();
    await press(screen.getByText('Check now'));
    expect(actions.handleQuickSync).toHaveBeenCalled();
  });

  test('photos still to check: Check now looks through all of them', async () => {
    state.lastSyncTime = Date.now() - 60 * 1000;
    overview.photoTotal = 2400;
    overview.photosChecked = 1240;
    await renderScreen();
    expect(screen.getByText('1,160 photos still to check')).toBeTruthy();
    await press(screen.getByText('Check now'));
    expect(actions.handleDeepSync).toHaveBeenCalled();
    expect(actions.handleDocumentSync).toHaveBeenCalledWith(50);
  });
});

describe('PinpointerScreen — Important and recent photos', () => {
  test('a starred photo opens in the viewer and counts as recent', async () => {
    pinned = [{ uri: 'file:///photos/pan.jpg', kind: 'IMAGE', title: 'PAN card', pinnedAt: 1 }];
    await renderScreen();
    await press(screen.getByLabelText('PAN card, Starred'));
    await waitFor(() => expect(screen.getByTestId('search-photo-viewer')).toBeTruthy());
    expect(screen.getByTestId('search-photo-viewer-photo').props.source).toEqual({ uri: 'file:///photos/pan.jpg' });
    expect(addRecentPhoto).toHaveBeenCalledWith('file:///photos/pan.jpg');
  });

  test('a starred paper opens in the PDF app', async () => {
    const openPDF = jest.fn();
    NativeModules.StorageModule = { ...(NativeModules.StorageModule ?? {}), openPDF };
    pinned = [{ uri: 'file:///docs/bill.pdf', kind: 'DOCUMENT', title: 'Gas bill', pinnedAt: 1 }];
    await renderScreen();
    await press(screen.getByLabelText('Gas bill, Starred'));
    await waitFor(() => expect(openPDF).toHaveBeenCalledWith('/docs/bill.pdf'));
  });

  test('a starred file that was deleted leaves the shelf instead of opening', async () => {
    (forgetIfGone as jest.Mock).mockResolvedValueOnce(true);
    pinned = [{ uri: 'file:///photos/old.jpg', kind: 'IMAGE', pinnedAt: 1 }];
    await renderScreen();
    await press(screen.getByLabelText('Photo, Starred'));
    await waitFor(() => expect(toggleStar).toHaveBeenCalledWith(pinned[0]));
    expect(screen.queryByTestId('search-photo-viewer')).toBeNull();
  });

  test('recently opened photos open again in one tap', async () => {
    overview.recent = ['file:///photos/a.jpg', 'file:///photos/b.jpg'];
    await renderScreen();
    expect(screen.getByText('Recently opened')).toBeTruthy();
    await press(screen.getByLabelText('Photo, 2 of 2'));
    await waitFor(() => expect(screen.getByTestId('search-photo-viewer')).toBeTruthy());
    expect(screen.getByTestId('search-photo-viewer-photo').props.source).toEqual({ uri: 'file:///photos/b.jpg' });
  });
});

describe('PinpointerScreen — voice search from Home', () => {
  test('the Home mic starts listening', async () => {
    await renderScreen();
    await press(screen.getByTestId('home-search-voice'));
    expect(actions.startListening).toHaveBeenCalled();
  });

  test('while listening, the Home mic stops listening', async () => {
    state.isRecording = true;
    await renderScreen();
    expect(screen.getByLabelText('Listening… tap to stop')).toBeTruthy();
    await press(screen.getByTestId('home-search-voice'));
    expect(actions.stopListening).toHaveBeenCalled();
    expect(actions.startListening).not.toHaveBeenCalled();
  });

  test('while turning speech into words, the mic waits', async () => {
    state.isTranscribing = true;
    await renderScreen();
    expect(screen.getByLabelText('Understanding…')).toBeTruthy();
    await press(screen.getByTestId('home-search-voice'));
    expect(actions.startListening).not.toHaveBeenCalled();
    expect(actions.stopListening).not.toHaveBeenCalled();
  });
});

describe('PinpointerScreen — voice search in search', () => {
  test('the mic in search starts listening', async () => {
    state.isSearching = true;
    await renderScreen();
    await press(screen.getByRole('button', { name: 'Search by voice' }));
    expect(actions.startListening).toHaveBeenCalled();
  });

  test('while listening, the panel says so and both stop buttons stop', async () => {
    state.isSearching = true;
    state.isRecording = true;
    await renderScreen();
    expect(screen.getByText('Listening… tap to stop')).toBeTruthy();
    expect(screen.queryByTestId('recent-searches')).toBeNull();
    await press(screen.getByTestId('search-bar-voice'));
    expect(actions.stopListening).toHaveBeenCalledTimes(1);
    await press(screen.getByTestId('listening-panel-stop'));
    expect(actions.stopListening).toHaveBeenCalledTimes(2);
  });

  test('closing search while listening stops the mic, so search cannot reopen by itself', async () => {
    state.isSearching = true;
    state.isRecording = true;
    await renderScreen();
    await press(screen.getByRole('button', { name: 'Close search' }));
    expect(actions.cancelListening).toHaveBeenCalledTimes(1);
    expect(actions.setIsSearching).toHaveBeenCalledWith(false);
    await waitFor(() => expect(actions.setSearchText).toHaveBeenCalledWith(''), { timeout: 2000 });
  });

  test('closing search while the words are read drops them too', async () => {
    state.isSearching = true;
    state.isTranscribing = true;
    await renderScreen();
    await press(screen.getByRole('button', { name: 'Close search' }));
    expect(actions.cancelListening).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(actions.setSearchText).toHaveBeenCalledWith(''), { timeout: 2000 });
  });

  test('while the words are being read, it says "Understanding…" and the mic waits', async () => {
    state.isSearching = true;
    state.isTranscribing = true;
    await renderScreen();
    expect(screen.getByText('Understanding…')).toBeTruthy();
    await press(screen.getByTestId('search-bar-voice'));
    expect(actions.startListening).not.toHaveBeenCalled();
    expect(actions.stopListening).not.toHaveBeenCalled();
  });
});

describe('PinpointerScreen — navigation', () => {
  test('startUniversalSync route param triggers a deep sync once', async () => {
    (useRoute as jest.Mock).mockReturnValue({ params: { startUniversalSync: true } });
    await renderScreen();
    expect(actions.handleDeepSync).toHaveBeenCalled();
    expect(mockNav.setParams).toHaveBeenCalledWith({ startUniversalSync: false });
  });

  test('no route param means no automatic deep sync', async () => {
    await renderScreen();
    expect(actions.handleDeepSync).not.toHaveBeenCalled();
  });

  test('keeps the tab bar on Home', async () => {
    const setOptions = jest.fn();
    (useNavigation as jest.Mock).mockReturnValue({ ...mockNav, setOptions });
    await renderScreen();
    expect(setOptions).toHaveBeenLastCalledWith({ tabBarHidden: false });
  });

  test('hides the tab bar when it opens in search mode', async () => {
    const setOptions = jest.fn();
    (useNavigation as jest.Mock).mockReturnValue({ ...mockNav, setOptions });
    state.isSearching = true;
    await renderScreen();
    expect(setOptions).toHaveBeenLastCalledWith({ tabBarHidden: true });
  });

  test('works outside the tabs, where navigation has no setOptions', async () => {
    await renderScreen();
    expect(screen.getByText('What are you looking for?')).toBeTruthy();
  });
});


