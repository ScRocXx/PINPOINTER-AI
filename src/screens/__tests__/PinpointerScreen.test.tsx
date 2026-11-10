/**
 * Component tests for PinpointerScreen — the app's main search/dashboard screen.
 *
 * Strategy: the screen's only real collaborator is the shared pinpointer
 * context, which is replaced by a STATEFUL mock (a plain `state` object +
 * jest.fn setters that mutate it, re-read on every render). Navigation,
 * HomeScreen (drawer content), RecentPhotos, database, and
 * DocumentClassifier are mocked; the real SearchFilterChips and
 * SearchHistoryPanel components render so filter/history flows are
 * exercised for real.
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

// The drawer renders HomeScreen; keep it light and capture its props so the
// openDrawer/closeDrawer wiring can be asserted.
jest.mock('../HomeScreen', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    HomeScreen: (props: { onCloseDrawer?: () => void }) => {
      (globalThis as Record<string, unknown>).__capturedHomeProps = props;
      return <View />;
    },
  };
});

jest.mock('../../utils/RecentPhotos', () => ({
  addRecentPhoto: jest.fn(),
}));

jest.mock('../../database', () => ({
  extractSnippet: jest.fn((content: string) => content),
}));

jest.mock('../../utils/MissingFiles', () => ({
  forgetIfGone: jest.fn(async () => false),
}));

jest.mock('../../utils/DocumentClassifier', () => ({
  classifyDocument: jest.fn(() => ({ emoji: '📄', category: 'OTHER', confidence: 1 })),
}));

// ModelDownloadSheet calls useModelService() unconditionally, which throws
// outside a ModelServiceProvider — replace just that component, keeping the
// real SearchFilterChips / SearchHistoryPanel.
jest.mock('../../components/ModelDownloadSheet', () => ({
  ModelDownloadSheet: () => null,
}));

import React from 'react';
import { Alert, NativeModules } from 'react-native';
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
import { extractSnippet } from '../../database';
import { classifyDocument } from '../../utils/DocumentClassifier';
import type { DocumentRecord } from '../../database';
import type { SearchHistoryItem } from '../../utils/SearchHistory';

// ─── Stateful context harness ───────────────────────────────────────────────

interface ScreenState {
  searchText: string;
  searchResults: DocumentRecord[];
  isSearching: boolean;
  isSearchPending: boolean;
  searchHistory: SearchHistoryItem[];
  selectedImage: string | null;
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
  selectedImage: null,
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
let mockNav: { navigate: jest.Mock; setParams: jest.Mock };

const makeActions = (): Record<string, jest.Mock> => ({
  setSearchText: jest.fn((v: string) => { state.searchText = v; }),
  setIsSearching: jest.fn((v: boolean) => { state.isSearching = v; }),
  setSelectedImage: jest.fn((v: string | null) => { state.selectedImage = v; }),
  startListening: jest.fn(),
  stopListening: jest.fn(),
  handleScan: jest.fn(),
  handleShare: jest.fn(),
  handleEdit: jest.fn(),
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
  selectedImage: state.selectedImage,
  setSelectedImage: actions.setSelectedImage,
  isRecording: state.isRecording,
  isTranscribing: state.isTranscribing,
  isModelLoading: state.isModelLoading,
  audioLevel: 0,
  recordingDuration: 0,
  startListening: actions.startListening,
  stopListening: actions.stopListening,
  handleScan: actions.handleScan,
  handleShare: actions.handleShare,
  handleEdit: actions.handleEdit,
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

/** Host node in RNTL v14's tree (host elements only: View/Text/TextInput/…). */
interface HostNode {
  type: string;
  props: Record<string, unknown>;
}
/** RNTL v14 exposes queryAll(predicate) on the render result's container. */
const queryAllHost = (
  r: { container: unknown },
  predicate: (n: HostNode) => boolean,
): HostNode[] =>
  (r.container as unknown as { queryAll: (p: (n: HostNode) => boolean) => HostNode[] }).queryAll(
    predicate,
  );

const renderScreen = async (): Promise<RenderResult> => {
  let result!: RenderResult;
  await act(async () => {
    result = await render(<PinpointerScreen />);
  });
  return result;
};

const refresh = async (r: RenderResult): Promise<void> => {
  await r.rerender(<PinpointerScreen />);
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
  (useNavigation as jest.Mock).mockReturnValue(mockNav);
  (useRoute as jest.Mock).mockReturnValue({ params: {} });
  (RNFS.exists as jest.Mock).mockResolvedValue(true);
  (addRecentPhoto as jest.Mock).mockResolvedValue(undefined);
  (extractSnippet as jest.Mock).mockImplementation((content: string) => content);
});

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).__capturedHomeProps;
});

describe('PinpointerScreen — dashboard', () => {
  test('renders the dashboard header, search input, and sync buttons', async () => {
    await renderScreen();
    expect(screen.getAllByText('Pinpointer').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Search documents').length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText('Search on Pinpointer...').length).toBe(2);
    expect(screen.getByText('Scan Images')).toBeTruthy();
    expect(screen.getByText('Scan docs')).toBeTruthy();
    expect(screen.getByText('Ready to search your offline vault.')).toBeTruthy();
  });

  test('suggestion pill sets search text and enters searching mode', async () => {
    await renderScreen();
    await press(screen.getByText('Find Aadhaar'));
    expect(actions.setSearchText).toHaveBeenCalledWith('Aadhaar');
    expect(actions.setIsSearching).toHaveBeenCalledWith(true);
  });

  test('cat suggestion pill sets the cat query', async () => {
    await renderScreen();
    await press(screen.getByText('Image of my cat'));
    expect(actions.setSearchText).toHaveBeenCalledWith('cat');
    expect(actions.setIsSearching).toHaveBeenCalledWith(true);
  });

  test('typing in the search box updates the search text', async () => {
    await renderScreen();
    const input = screen.getAllByLabelText('Search documents')[1];
    await act(async () => {
      await fireEvent.changeText(input, 'passport');
    });
    expect(actions.setSearchText).toHaveBeenCalledWith('passport');
  });

  test('focusing the search input enters searching mode', async () => {
    await renderScreen();
    const input = screen.getAllByLabelText('Search documents')[1];
    await act(async () => {
      await fireEvent(input, 'focus');
    });
    expect(actions.setIsSearching).toHaveBeenCalledWith(true);
  });

  test('close search button exits searching mode', async () => {
    state.isSearching = true;
    await renderScreen();
    const closeBtn = screen.getByLabelText('Close search');
    await act(async () => {
      await fireEvent(closeBtn, 'pressIn');
    });
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

  test('shows the history panel with recent queries when search text is empty', async () => {
    await withHistory();
    expect(screen.getByText('🕘 Recent Searches')).toBeTruthy();
    expect(screen.getByText('aadhaar')).toBeTruthy();
    expect(screen.getByText('passport')).toBeTruthy();
  });

  test('shows the empty-history message when there is no history', async () => {
    state.isSearching = true;
    state.searchText = '';
    state.searchHistory = [];
    await renderScreen();
    expect(screen.getByText('No search history yet')).toBeTruthy();
  });

  test('tapping a history query selects it', async () => {
    await withHistory();
    await press(screen.getByText('aadhaar'));
    expect(actions.handleSelectHistory).toHaveBeenCalledWith('aadhaar');
  });

  test('tapping Clear all clears the history', async () => {
    await withHistory();
    await press(screen.getByText('Clear all'));
    expect(actions.handleClearHistory).toHaveBeenCalled();
  });

  test('tapping a row delete button deletes that query', async () => {
    await withHistory();
    const deleteButtons = screen.getAllByText('✕');
    expect(deleteButtons.length).toBeGreaterThan(0);
    await press(deleteButtons[0]);
    expect(actions.handleDeleteHistory).toHaveBeenCalledWith('aadhaar');
  });

  test('history panel is hidden once text is typed', async () => {
    state.isSearching = true;
    state.searchText = 'aadhaar';
    state.searchHistory = [historyItem('aadhaar')];
    state.searchResults = [];
    await renderScreen();
    expect(screen.queryByText('🕘 Recent Searches')).toBeNull();
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
    expect(screen.getByLabelText('View file: my cat photo at home ')).toBeTruthy();
    expect(screen.getByLabelText('View file: aadhaar card details 9999 ')).toBeTruthy();
  });

  test('shows the Top Results header when the ALL filter is active', async () => {
    await withResults();
    expect(screen.getByText('Top Results')).toBeTruthy();
  });

  test('result subtitles reflect image text, image object, and document types', async () => {
    state.isSearching = true;
    state.searchText = 'x';
    state.searchResults = [
      imgResult({ id: 1, detection_type: 'TEXT' }),
      imgResult({ id: 3, detection_type: 'OBJECT', content: 'object pic', filePath: 'file:///photos/obj.jpg' }),
      docResult(),
    ];
    await renderScreen();
    expect(screen.getByText('📝 Text • Tap to view')).toBeTruthy();
    expect(screen.getByText('🏷 Object • Tap to view')).toBeTruthy();
    expect(screen.getByText('📄 Document • Tap to open')).toBeTruthy();
  });

  test('document rows render the classifier emoji thumbnail', async () => {
    await withResults();
    expect(classifyDocument).toHaveBeenCalledWith('aadhaar card details 9999', 'aadhaar.pdf');
    const row = screen.getByLabelText('View file: aadhaar card details 9999 ');
    expect(within(row).getByText('📄')).toBeTruthy();
  });

  test('filter chips narrow results to photos', async () => {
    await withResults();
    await press(screen.getByText('Photos'));
    expect(screen.getByText('Found in Photos')).toBeTruthy();
    expect(screen.getByLabelText('View file: my cat photo at home ')).toBeTruthy();
    expect(screen.queryByLabelText('View file: aadhaar card details 9999 ')).toBeNull();
  });

  test('filter chips narrow results to documents', async () => {
    await withResults();
    await press(screen.getByText('Documents'));
    expect(screen.getByText('Found in Documents')).toBeTruthy();
    expect(screen.queryByLabelText('View file: my cat photo at home ')).toBeNull();
    expect(screen.getByLabelText('View file: aadhaar card details 9999 ')).toBeTruthy();
  });

  test('All chip restores the full result list', async () => {
    await withResults();
    await press(screen.getByText('Photos'));
    expect(screen.queryByLabelText('View file: aadhaar card details 9999 ')).toBeNull();
    await press(screen.getByText('All'));
    expect(screen.getByLabelText('View file: aadhaar card details 9999 ')).toBeTruthy();
    expect(screen.getByLabelText('View file: my cat photo at home ')).toBeTruthy();
  });

  test('tapping an image result opens the preview modal and logs a recent photo', async () => {
    const r = await withResults();
    await press(screen.getByLabelText('View file: my cat photo at home '));
    await waitFor(() => {
      expect(actions.setSelectedImage).toHaveBeenCalledWith('file:///photos/cat.jpg');
    });
    expect(addRecentPhoto).toHaveBeenCalledWith('file:///photos/cat.jpg');
    await refresh(r);
    expect(screen.getByLabelText('Close image')).toBeTruthy();
  });

  test('tapping a photo deleted from the phone removes it from search instead of opening it', async () => {
    (forgetIfGone as jest.Mock).mockResolvedValueOnce(true);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await withResults();
    await press(screen.getByLabelText('View file: my cat photo at home '));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('File Not Found', expect.stringContaining('removed from search'));
    });
    expect(forgetIfGone).toHaveBeenCalledWith('file:///photos/cat.jpg', 'IMAGE');
    expect(actions.setSelectedImage).not.toHaveBeenCalled();
  });

  test('closing the image modal clears the selected image', async () => {
    state.selectedImage = 'file:///photos/cat.jpg';
    await renderScreen();
    expect(screen.getByLabelText('Close image')).toBeTruthy();
    await press(screen.getByLabelText('Close image'));
    expect(actions.setSelectedImage).toHaveBeenCalledWith(null);
  });

  test('modal Scan action navigates to SmartClipboard with the image uri', async () => {
    state.selectedImage = 'file:///photos/cat.jpg';
    await renderScreen();
    await press(screen.getByLabelText('Scan image'));
    expect(actions.setSelectedImage).toHaveBeenCalledWith(null);
    expect(mockNav.navigate).toHaveBeenCalledWith('SmartClipboard', {
      scanUri: 'file:///photos/cat.jpg',
    });
  });

  test('modal Edit and Share actions call the context handlers', async () => {
    state.selectedImage = 'file:///photos/cat.jpg';
    await renderScreen();
    await press(screen.getByLabelText('Edit image'));
    expect(actions.handleEdit).toHaveBeenCalled();
    await press(screen.getByLabelText('Share image'));
    expect(actions.handleShare).toHaveBeenCalled();
  });

  test('tapping a document result opens the PDF via the native StorageModule', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(true);
    state.isSearching = true;
    state.searchText = 'aadhaar';
    state.searchResults = [docResult()];
    await renderScreen();
    await press(screen.getByLabelText('View file: aadhaar card details 9999 '));
    await waitFor(() => {
      expect(NativeModules.StorageModule.openPDF).toHaveBeenCalledWith('/docs/aadhaar.pdf');
    });
  });

  test('tapping a document whose file is missing shows a File Not Found alert', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValue(false);
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    state.isSearching = true;
    state.searchText = 'aadhaar';
    state.searchResults = [docResult()];
    await renderScreen();
    await press(screen.getByLabelText('View file: aadhaar card details 9999 '));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'File Not Found',
        'This file may have been deleted from your device.'
      );
    });
    expect(NativeModules.StorageModule.openPDF).not.toHaveBeenCalled();
  });
});

describe('PinpointerScreen — empty results', () => {
  test('shows the no-matches state when the search returns nothing', async () => {
    state.isSearching = true;
    state.searchText = 'zzzz-no-such-thing';
    state.searchResults = [];
    state.isSearchPending = false;
    await renderScreen();
    expect(screen.getByText('No matches found.')).toBeTruthy();
    expect(screen.getByLabelText('Start Universal Sync')).toBeTruthy();
  });

  test('Start Universal Sync closes search and triggers both sync engines', async () => {
    state.isSearching = true;
    state.searchText = 'zzzz-no-such-thing';
    state.searchResults = [];
    await renderScreen();
    await press(screen.getByLabelText('Start Universal Sync'));
    expect(actions.setIsSearching).toHaveBeenCalledWith(false);
    expect(actions.handleDeepSync).toHaveBeenCalled();
    expect(actions.handleDocumentSync).toHaveBeenCalled();
    // Drain the 300ms delayed query-clear so it cannot leak into later tests.
    await waitFor(
      () => expect(actions.setSearchText).toHaveBeenCalledWith(''),
      { timeout: 2000 },
    );
  });

  test('pending search shows a loader instead of the empty state', async () => {
    state.isSearching = true;
    state.searchText = 'zzz';
    state.searchResults = [];
    state.isSearchPending = true;
    const r = await renderScreen();
    await act(async () => {
      await fireEvent(screen.getAllByLabelText('Search documents')[1], 'focus');
    });
    expect(screen.queryByText('No matches found.')).toBeNull();
    // RN's jest preset mocks ActivityIndicator as a host element of the same name
    expect(queryAllHost(r, (n) => n.type === 'ActivityIndicator').length).toBeGreaterThan(0);
  });
});

describe('PinpointerScreen — sync dashboard', () => {
  test('syncing state shows the analyzing UI and a disabled Scanning button', async () => {
    state.isSyncing = true;
    state.syncCount = 10;
    await renderScreen();
    expect(screen.getByText('Analyzing images on-device...')).toBeTruthy();
    expect(screen.getByText('100% private. No data leaves this device.')).toBeTruthy();
    expect(screen.queryByText('Scan Images')).toBeNull();
  });

  test('Scan Images triggers a quick sync when idle', async () => {
    await renderScreen();
    await press(screen.getByText('Scan Images'));
    expect(actions.handleQuickSync).toHaveBeenCalled();
  });

  test('Scan docs triggers a document sync with batch size 50', async () => {
    await renderScreen();
    await press(screen.getByText('Scan docs'));
    expect(actions.handleDocumentSync).toHaveBeenCalledWith(50);
  });

  test('document syncing state shows the docs analyzing UI', async () => {
    state.isSyncingDocs = true;
    state.docSyncCount = 5;
    state.totalDocs = 20;
    await renderScreen();
    expect(screen.getByText('Analyzing docs on-device...')).toBeTruthy();
  });

  test('shows the last sync relative time on the sync buttons', async () => {
    state.lastSyncTime = Date.now() - 5 * 60 * 1000;
    state.lastDocSyncTime = Date.now() - 2 * 3600 * 1000;
    await renderScreen();
    expect(screen.getByText('last synced 5m ago')).toBeTruthy();
    expect(screen.getByText('last synced 2h ago')).toBeTruthy();
  });

  test('never-synced state shows the Never synced subtitle', async () => {
    state.lastSyncTime = null;
    state.lastDocSyncTime = null;
    await renderScreen();
    expect(screen.getAllByText('last synced Never synced').length).toBe(2);
  });
});

describe('PinpointerScreen — voice search', () => {
  test('mic button starts listening', async () => {
    await renderScreen();
    await press(screen.getAllByLabelText('Start voice search')[0]);
    expect(actions.startListening).toHaveBeenCalled();
  });

  test('recording state shows the stop button which stops listening', async () => {
    state.isRecording = true;
    await renderScreen();
    await press(screen.getAllByLabelText('Stop recording')[0]);
    expect(actions.stopListening).toHaveBeenCalled();
  });

  test('transcribing state shows the hourglass on the mic button', async () => {
    state.isTranscribing = true;
    await renderScreen();
    expect(screen.getAllByText('⏳').length).toBeGreaterThan(0);
    const micButtons = screen.getAllByLabelText('Start voice search');
    expect(micButtons.length).toBeGreaterThan(0);
    micButtons.forEach((b) => expect(b).toBeDisabled());
  });
});

describe('PinpointerScreen — drawer and navigation', () => {
  test('menu button opens the drawer and its close callback is wired', async () => {
    await renderScreen();
    await press(screen.getByLabelText('Open menu'));
    const captured = (globalThis as Record<string, unknown>).__capturedHomeProps as {
      onCloseDrawer?: () => void;
    };
    expect(typeof captured.onCloseDrawer).toBe('function');
    await act(async () => {
      captured.onCloseDrawer?.();
    });
  });

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
});


