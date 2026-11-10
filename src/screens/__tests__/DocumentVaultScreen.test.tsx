/**
 * DocumentVaultScreen (the Papers tab).
 *
 * - The database, the classifier (content → category), the shared Pinpointer
 *   state, where-we-look (usePdfPlaces) and the missing-file check are
 *   mocked, so each test says which papers the phone has.
 * - '@react-navigation/native' is mocked wholesale; Screen and
 *   useScreenFocus fall back to "focused" without a navigator.
 * - Toasts fall back to TalkBack announcements without a provider, so they
 *   are checked through AccessibilityInfo.
 */
import React from 'react';
import { AccessibilityInfo, NativeModules } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { DocumentVaultScreen, PAPERS_PAGE } from '../DocumentVaultScreen';
import { getAllDocuments, searchDocuments } from '../../database';
import type { DocumentRecord } from '../../database';
import { classifyDocument, type DocumentCategory } from '../../utils/DocumentClassifier';
import { usePinpointerShared } from '../../hooks/PinpointerContext';
import { usePdfPlaces } from '../../hooks/usePdfPlaces';
import { forgetIfGone } from '../../utils/MissingFiles';
import { resetPinnedCacheForTests } from '../../utils/PinnedItems';
import { translate } from '../../i18n/strings';

jest.mock('@react-navigation/native', () => ({ useNavigation: jest.fn() }));
jest.mock('../../database', () => ({ getAllDocuments: jest.fn(), searchDocuments: jest.fn(() => []) }));
jest.mock('../../utils/DocumentClassifier', () => ({ classifyDocument: jest.fn() }));
jest.mock('../../hooks/PinpointerContext', () => ({ usePinpointerShared: jest.fn() }));
jest.mock('../../hooks/usePdfPlaces', () => ({
  ...jest.requireActual('../../hooks/usePdfPlaces'),
  usePdfPlaces: jest.fn(),
}));
jest.mock('../../utils/MissingFiles', () => ({ forgetIfGone: jest.fn(async () => false) }));

type Vars = Record<string, string | number>;
const t = (key: Parameters<typeof translate>[1], vars?: Vars) => translate('en', key, vars);

const navigate = jest.fn();
const openPDF = NativeModules.StorageModule.openPDF as jest.Mock;
let announce: jest.SpyInstance;

const shared = {
  isSyncingDocs: false,
  docSyncCount: 0,
  totalDocs: 0,
  lastDocSyncTime: Date.now() - 60_000,
  handleDocumentSync: jest.fn(),
};

const places = {
  ready: true,
  standard: true,
  canAskStandard: true,
  canPick: true,
  folders: [] as { uri: string; name: string }[],
  refresh: jest.fn(),
  addFolder: jest.fn(),
  addFiles: jest.fn(),
  removeFolder: jest.fn(),
  allowStandard: jest.fn(),
};

// The category of a paper comes from its text: "cat:BANK_STATEMENT …".
(classifyDocument as jest.Mock).mockImplementation((content: string) => ({
  category: (content.match(/^cat:(\w+)/)?.[1] ?? 'GENERAL_DOCUMENT') as DocumentCategory,
  label: '',
  emoji: '',
  confidence: 90,
}));

let seq = 0;
const paper = (title: string, category: DocumentCategory, over: Partial<DocumentRecord> = {}): DocumentRecord => {
  seq += 1;
  return {
    id: seq,
    title,
    content: `cat:${category} ${title.toLowerCase()} text`,
    filePath: `/storage/emulated/0/Download/paper-${seq}.pdf`,
    type: 'DOCUMENT',
    detection_type: 'TEXT',
    timestamp: Date.now() - seq * 60_000,
    ...over,
  };
};

let DOCS: DocumentRecord[] = [];

const titles = () =>
  screen.queryAllByTestId(/^paper-\d+$/).map(row => within(row).getAllByText(/./)[0].props.children as string);

const renderPapers = async () => {
  const view = await render(<DocumentVaultScreen />);
  await waitFor(() => expect(getAllDocuments).toHaveBeenCalled());
  return view;
};

beforeEach(() => {
  seq = 0;
  DOCS = [
    paper('Aadhaar card', 'AADHAAR_CARD'),
    paper('Light bill March', 'ELECTRICITY_BILL'),
    paper('SBI statement', 'BANK_STATEMENT'),
    paper('Phone bill', 'PHONE_BILL'),
    paper('Rent agreement', 'GENERAL_DOCUMENT'),
  ];
  (getAllDocuments as jest.Mock).mockReset().mockImplementation(() => DOCS);
  (searchDocuments as jest.Mock).mockReset().mockReturnValue([]);
  (useNavigation as jest.Mock).mockReturnValue({ navigate });
  navigate.mockClear();
  openPDF.mockClear();
  Object.assign(shared, { isSyncingDocs: false, docSyncCount: 0, totalDocs: 0 });
  shared.handleDocumentSync.mockClear();
  (usePinpointerShared as jest.Mock).mockImplementation(() => shared);
  Object.assign(places, { ready: true, standard: true, canPick: true, folders: [] });
  places.addFolder.mockClear();
  places.addFiles.mockClear();
  (usePdfPlaces as jest.Mock).mockImplementation(() => places);
  (forgetIfGone as jest.Mock).mockReset().mockResolvedValue(false);
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  resetPinnedCacheForTests();
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('DocumentVaultScreen', () => {
  it('lists every paper with its kind and when it was added', async () => {
    await renderPapers();
    expect(screen.getByRole('header', { name: t('papers.title') })).toBeTruthy();
    expect(screen.getByText(t('papers.count', { n: 5 }))).toBeTruthy();
    expect(screen.getByRole('header', { name: t('papers.recent') })).toBeTruthy();
    expect(titles()).toEqual(['Aadhaar card', 'Light bill March', 'SBI statement', 'Phone bill', 'Rent agreement']);
    const first = screen.getByTestId('paper-0');
    expect(within(first).getByText(t('papers.kind.id'))).toBeTruthy();
    expect(within(first).getByText(/^Added /)).toBeTruthy();
    expect(screen.getByTestId('papers-ready')).toBeTruthy();
    expect(screen.getByText(t('progress.allPapersReady', { total: 5 }))).toBeTruthy();
  });

  it('shows six tiles with counts and narrows the list to one kind', async () => {
    await renderPapers();
    const bills = screen.getByTestId('papers-group-bills');
    expect(bills.props.accessibilityLabel).toBe(t('papers.categoryLabel', { name: t('papers.cat.bills'), n: 2 }));
    expect(screen.getByTestId('papers-group-medical').props.accessibilityState).toMatchObject({ disabled: true });

    await fireEvent.press(bills);
    expect(titles()).toEqual(['Light bill March', 'Phone bill']);
    expect(screen.getByRole('header', { name: t('papers.cat.bills') })).toBeTruthy();
    expect(screen.getByTestId('papers-group-bills').props.accessibilityState).toMatchObject({ selected: true });

    await fireEvent.press(screen.getByText(t('papers.showAll')));
    expect(titles()).toHaveLength(5);

    await fireEvent.press(screen.getByTestId('papers-group-bank'));
    expect(titles()).toEqual(['SBI statement']);
    await fireEvent.press(screen.getByTestId('papers-group-bank'));
    expect(titles()).toHaveLength(5);
  });

  it('does nothing when an empty tile is tapped', async () => {
    await renderPapers();
    await fireEvent.press(screen.getByTestId('papers-group-medical'));
    expect(titles()).toHaveLength(5);
  });

  it('finds papers by any word: the search engine first, then plain matches', async () => {
    (searchDocuments as jest.Mock).mockReturnValue([DOCS[3], { ...DOCS[0], type: 'IMAGE' }]);
    await renderPapers();
    await fireEvent.press(screen.getByTestId('papers-search-toggle'));
    expect(screen.queryByTestId('papers-groups')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('papers-search-input'), 'bill');
    await waitFor(() => expect(titles()).toEqual(['Phone bill', 'Light bill March']));
    expect(searchDocuments).toHaveBeenCalledWith('bill');
  });

  it('says so when nothing matches, and closing search shows everything again', async () => {
    await renderPapers();
    await fireEvent.press(screen.getByTestId('papers-search-toggle'));
    await fireEvent.changeText(screen.getByTestId('papers-search-input'), 'passport');
    await waitFor(() => expect(screen.getByTestId('papers-no-match')).toBeTruthy());
    expect(screen.getByText(t('papers.noMatchTitle', { q: 'passport' }))).toBeTruthy();

    await fireEvent.press(screen.getByTestId('papers-search-toggle'));
    expect(screen.queryByTestId('papers-search-input')).toBeNull();
    expect(titles()).toHaveLength(5);
  });

  it('opens a paper in the PDF reader', async () => {
    await renderPapers();
    await fireEvent.press(screen.getByTestId('paper-2-open'));
    await waitFor(() => expect(openPDF).toHaveBeenCalledWith(DOCS[2].filePath));
    expect(forgetIfGone).toHaveBeenCalledWith(DOCS[2].filePath, 'DOCUMENT');
  });

  it('drops a paper that is no longer on the phone', async () => {
    await renderPapers();
    (forgetIfGone as jest.Mock).mockResolvedValue(true);
    DOCS = DOCS.filter((_, i) => i !== 1);
    await fireEvent.press(screen.getByTestId('paper-1-open'));
    await waitFor(() => expect(announce).toHaveBeenCalledWith(t('error.fileGone')));
    expect(openPDF).not.toHaveBeenCalled();
    expect(titles()).not.toContain('Light bill March');
  });

  it('marks a paper Important with the star', async () => {
    await renderPapers();
    await fireEvent.press(screen.getByTestId('paper-0-star'));
    await waitFor(() => expect(announce).toHaveBeenCalledWith(t('viewer.markedImportant')));
    await waitFor(() => expect(screen.getByTestId('paper-0-star').props.accessibilityState).toMatchObject({ selected: true }));
    await fireEvent.press(screen.getByTestId('paper-0-star'));
    await waitFor(() => expect(announce).toHaveBeenCalledWith(t('viewer.removedImportant')));
  });

  it('shows the first page and loads more on "Show more"', async () => {
    DOCS = Array.from({ length: PAPERS_PAGE + 4 }, (_, i) => paper(`Paper ${i + 1}`, 'GENERAL_DOCUMENT'));
    await renderPapers();
    expect(titles()).toHaveLength(PAPERS_PAGE);
    await fireEvent.press(screen.getByText(t('search.showMore', { n: 4 })));
    expect(titles()).toHaveLength(PAPERS_PAGE + 4);
    expect(screen.queryByTestId('papers-more')).toBeNull();
  });

  it('says where it looks and opens the folders screen', async () => {
    places.folders = [{ uri: 'u', name: 'Bills' }];
    await renderPapers();
    expect(screen.getByText(t('papers.whereBothOne'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('papers-where'));
    expect(navigate).toHaveBeenCalledWith('PdfFolders');
  });

  it('adds a folder or PDFs from the sheet', async () => {
    await renderPapers();
    await fireEvent.press(screen.getByTestId('papers-add'));
    expect(screen.getByRole('header', { name: t('papers.addTitle') })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('papers-add-folder'));
    expect(places.addFolder).toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('papers-add'));
    await fireEvent.press(screen.getByTestId('papers-add-files'));
    expect(places.addFiles).toHaveBeenCalled();
  });

  it('goes to the folders screen to add when the pickers are missing', async () => {
    places.canPick = false;
    await renderPapers();
    await fireEvent.press(screen.getByTestId('papers-add'));
    expect(navigate).toHaveBeenCalledWith('PdfFolders');
    expect(screen.queryByTestId('papers-add-sheet')).toBeNull();
  });

  it('with no papers, offers to find them or add a folder', async () => {
    DOCS = [];
    await renderPapers();
    expect(screen.getByText(t('papers.emptyTitle'))).toBeTruthy();
    expect(screen.queryByTestId('papers-search-toggle')).toBeNull();
    expect(screen.queryByTestId('papers-groups')).toBeNull();
    await fireEvent.press(screen.getByText(t('progress.findNewPapers')));
    expect(shared.handleDocumentSync).toHaveBeenCalledWith();
    await fireEvent.press(screen.getByTestId('papers-empty-secondary'));
    expect(screen.getByTestId('papers-add-sheet')).toBeTruthy();
  });

  it('shows progress while papers are read, and the new list when done', async () => {
    Object.assign(shared, { isSyncingDocs: true, docSyncCount: 2, totalDocs: 8 });
    DOCS = [];
    const view = await renderPapers();
    expect(screen.getByTestId('papers-progress')).toBeTruthy();
    expect(screen.getByText(t('progress.papersTitle'))).toBeTruthy();
    expect(screen.queryByTestId('papers-empty')).toBeNull();

    DOCS = [paper('New scan', 'RECEIPT')];
    Object.assign(shared, { isSyncingDocs: false });
    await act(async () => view.rerender(<DocumentVaultScreen />));
    await waitFor(() => expect(titles()).toEqual(['New scan']));
    expect(screen.queryByTestId('papers-progress')).toBeNull();
  });

  it('keeps papers already read on screen during a check', async () => {
    Object.assign(shared, { isSyncingDocs: true, docSyncCount: 1, totalDocs: 3 });
    await renderPapers();
    expect(screen.getByTestId('papers-progress')).toBeTruthy();
    expect(titles()).toHaveLength(5);
  });

  it('without All files access, checks chosen folders quietly', async () => {
    places.standard = false;
    await renderPapers();
    await fireEvent.press(screen.getByText(t('progress.checkAgain')));
    expect(shared.handleDocumentSync).toHaveBeenCalledWith(undefined, true);
  });

  it('with nothing it may read, shows where it can look instead of a pop-up', async () => {
    places.standard = false;
    DOCS = [];
    await renderPapers();
    await fireEvent.press(screen.getByText(t('progress.findNewPapers')));
    expect(shared.handleDocumentSync).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('PdfFolders');
  });

  it('checks again from the ready card', async () => {
    await renderPapers();
    await fireEvent.press(screen.getByText(t('progress.checkAgain')));
    expect(shared.handleDocumentSync).toHaveBeenCalledWith();
  });
});
