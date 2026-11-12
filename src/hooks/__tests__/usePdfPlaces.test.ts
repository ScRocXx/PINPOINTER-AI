/**
 * usePdfPlaces: where Pinpointer reads PDFs from, and the actions that
 * change it. PdfImport, StoragePermissions and the shared Pinpointer state
 * are mocked; toasts fall back to TalkBack announcements without a provider,
 * so they are checked through AccessibilityInfo.
 */
import { AccessibilityInfo, AppState } from 'react-native';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { describePlaces, usePdfPlaces } from '../usePdfPlaces';
import { usePinpointerShared } from '../PinpointerContext';
import {
  canRequestAllFilesAccess,
  forgetPdfFolder,
  isPdfImportAvailable,
  listPdfFolders,
  pickPdfFiles,
  pickPdfFolder,
} from '../../utils/PdfImport';
import {
  allFilesAccessApplies,
  ensureDocumentAccess,
  hasDocumentAccess,
  openAllFilesAccessAndWait,
} from '../../utils/StoragePermissions';
import { translate } from '../../i18n/strings';

jest.mock('../PinpointerContext', () => ({ usePinpointerShared: jest.fn() }));
jest.mock('../../utils/PdfImport', () => ({
  isPdfImportAvailable: jest.fn(),
  canRequestAllFilesAccess: jest.fn(),
  listPdfFolders: jest.fn(),
  pickPdfFolder: jest.fn(),
  pickPdfFiles: jest.fn(),
  forgetPdfFolder: jest.fn(),
}));
jest.mock('../../utils/StoragePermissions', () => ({
  hasDocumentAccess: jest.fn(),
  openAllFilesAccessAndWait: jest.fn(),
  allFilesAccessApplies: jest.fn(() => true),
  ensureDocumentAccess: jest.fn(),
}));

const sync = jest.fn(async () => {});
const BILLS = { uri: 'content://tree/bills', name: 'Bills' };
const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) => translate('en', key, vars);

let announce: jest.SpyInstance;
let appStateListener: ((s: string) => void) | undefined;

beforeEach(() => {
  jest.clearAllMocks();
  (usePinpointerShared as jest.Mock).mockReturnValue({ handleDocumentSync: sync });
  (isPdfImportAvailable as jest.Mock).mockReturnValue(true);
  (canRequestAllFilesAccess as jest.Mock).mockResolvedValue(true);
  (hasDocumentAccess as jest.Mock).mockResolvedValue(false);
  (listPdfFolders as jest.Mock).mockResolvedValue([]);
  (forgetPdfFolder as jest.Mock).mockResolvedValue(undefined);
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListener = listener as (s: string) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

const renderPlaces = async () => {
  const hook = await renderHook(() => usePdfPlaces());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
};

describe('usePdfPlaces', () => {
  it('reports what can be read once the first check finishes', async () => {
    (hasDocumentAccess as jest.Mock).mockResolvedValue(true);
    (listPdfFolders as jest.Mock).mockResolvedValue([BILLS]);
    const { result } = await renderPlaces();
    expect(result.current).toMatchObject({ standard: true, canAskStandard: true, canPick: true, folders: [BILLS] });
  });

  it('still becomes ready when the check fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    (listPdfFolders as jest.Mock).mockRejectedValue(new Error('boom'));
    const { result } = await renderPlaces();
    expect(result.current.folders).toEqual([]);
  });

  it('checks again when the person comes back to the app', async () => {
    const { result } = await renderPlaces();
    (hasDocumentAccess as jest.Mock).mockResolvedValue(true);
    await act(async () => appStateListener?.('active'));
    await waitFor(() => expect(result.current.standard).toBe(true));
  });

  it('adds a folder: confirms it and looks for papers quietly', async () => {
    (pickPdfFolder as jest.Mock).mockResolvedValue(BILLS);
    const { result } = await renderPlaces();
    (listPdfFolders as jest.Mock).mockResolvedValue([BILLS]);
    let added: unknown;
    await act(async () => {
      added = await result.current.addFolder();
    });
    expect(added).toEqual(BILLS);
    expect(result.current.folders).toEqual([BILLS]);
    expect(announce).toHaveBeenCalledWith(t('papers.folderAdded', { name: 'Bills' }));
    expect(sync).toHaveBeenCalledWith(undefined, true);
  });

  it('does nothing when the folder picker is cancelled', async () => {
    (pickPdfFolder as jest.Mock).mockResolvedValue(null);
    const { result } = await renderPlaces();
    await act(async () => {
      await result.current.addFolder();
    });
    expect(announce).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it('adds picked PDFs with a count in the toast', async () => {
    const { result } = await renderPlaces();
    (pickPdfFiles as jest.Mock).mockResolvedValueOnce(3).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await act(async () => {
      await result.current.addFiles();
    });
    expect(announce).toHaveBeenLastCalledWith(t('papers.pdfsAdded', { n: 3 }));
    await act(async () => {
      await result.current.addFiles();
    });
    expect(announce).toHaveBeenLastCalledWith(t('papers.onePdfAdded'));
    expect(sync).toHaveBeenCalledTimes(2);
    await act(async () => {
      await result.current.addFiles();
    });
    expect(announce).toHaveBeenCalledTimes(2);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('removes a folder and says so', async () => {
    (listPdfFolders as jest.Mock).mockResolvedValue([BILLS]);
    const { result } = await renderPlaces();
    (listPdfFolders as jest.Mock).mockResolvedValue([]);
    await act(async () => {
      await result.current.removeFolder(BILLS);
    });
    expect(forgetPdfFolder).toHaveBeenCalledWith('content://tree/bills');
    expect(result.current.folders).toEqual([]);
    expect(announce).toHaveBeenCalledWith(t('folders.removed', { name: 'Bills' }));
  });

  it('looks for papers only when All files access was turned on', async () => {
    const { result } = await renderPlaces();
    (openAllFilesAccessAndWait as jest.Mock).mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.allowStandard();
    });
    expect(sync).not.toHaveBeenCalled();

    (openAllFilesAccessAndWait as jest.Mock).mockResolvedValueOnce(true);
    (hasDocumentAccess as jest.Mock).mockResolvedValue(true);
    await act(async () => {
      await result.current.allowStandard();
    });
    expect(sync).toHaveBeenCalledWith();
    expect(result.current.standard).toBe(true);
  });

  it('on Android 10 and older asks for file access, since there is no All files switch to wait for', async () => {
    (allFilesAccessApplies as jest.Mock).mockReturnValue(false);
    (ensureDocumentAccess as jest.Mock).mockResolvedValue(true);
    (hasDocumentAccess as jest.Mock).mockResolvedValue(false);
    const { result } = await renderHook(() => usePdfPlaces());
    await waitFor(() => expect(result.current.ready).toBe(true));
    (hasDocumentAccess as jest.Mock).mockResolvedValue(true);
    await act(async () => {
      expect(await result.current.allowStandard()).toBe(true);
    });
    expect(openAllFilesAccessAndWait).not.toHaveBeenCalled();
    expect(ensureDocumentAccess).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith();
    (allFilesAccessApplies as jest.Mock).mockReturnValue(true);
  });
});

describe('describePlaces', () => {
  const folders = (n: number) => Array.from({ length: n }, (_, i) => ({ uri: `u${i}`, name: `F${i}` }));

  it('says what is read, in plain words', () => {
    expect(describePlaces(t, { standard: true, folders: [] })).toBe(t('papers.whereStandard'));
    expect(describePlaces(t, { standard: true, folders: folders(1) })).toBe(t('papers.whereBothOne'));
    expect(describePlaces(t, { standard: true, folders: folders(3) })).toBe(t('papers.whereBoth', { n: 3 }));
    expect(describePlaces(t, { standard: false, folders: [] })).toBe(t('papers.whereNone'));
    expect(describePlaces(t, { standard: false, folders: folders(1) })).toBe(t('papers.whereOneFolder'));
    expect(describePlaces(t, { standard: false, folders: folders(2) })).toBe(t('papers.whereFolders', { n: 2 }));
  });
});
