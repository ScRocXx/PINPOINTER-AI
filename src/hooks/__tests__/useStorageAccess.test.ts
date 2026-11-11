import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useDocumentAccess, usePhotoAccess } from '../useStorageAccess';
import * as Perms from '../../utils/StoragePermissions';
import * as Pdf from '../../utils/PdfImport';

jest.mock('../../utils/StoragePermissions', () => ({
  getPhotoAccess: jest.fn(async () => 'limited'),
  requestPhotoAccess: jest.fn(async () => 'full'),
  openAppSettingsAndWait: jest.fn(async () => 'full'),
  getDocumentAccess: jest.fn(async () => 'none'),
  allFilesAccessApplies: jest.fn(() => true),
  openAllFilesAccessAndWait: jest.fn(async () => true),
  ensureDocumentAccess: jest.fn(async () => true),
}));
jest.mock('../../utils/PdfImport', () => ({
  canRequestAllFilesAccess: jest.fn(async () => true),
  pickPdfFolder: jest.fn(async () => 'content://tree/Download'),
  pickPdfFiles: jest.fn(async () => 2),
}));

const perms = Perms as jest.Mocked<typeof Perms>;
const pdf = Pdf as jest.Mocked<typeof Pdf>;

let appStateHandler: ((s: string) => void) | null = null;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  appStateHandler = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: string) => void) => {
    appStateHandler = fn;
    return { remove };
  }) as unknown as typeof AppState.addEventListener);
});
afterEach(() => jest.restoreAllMocks());

describe('usePhotoAccess', () => {
  it('is unknown, then checked on mount', async () => {
    const { result } = await renderHook(() => usePhotoAccess());
    await act(async () => {});
    expect(result.current.access).toBe('limited');
    expect(perms.getPhotoAccess).toHaveBeenCalledTimes(1);
  });

  it('asks Android, or goes to Settings, and keeps the answer', async () => {
    const { result } = await renderHook(() => usePhotoAccess());
    await act(async () => {});
    perms.requestPhotoAccess.mockResolvedValueOnce('denied');
    await act(async () => {
      await expect(result.current.request()).resolves.toBe('denied');
    });
    expect(result.current.access).toBe('denied');
    await act(async () => {
      await result.current.openSettings();
    });
    expect(result.current.access).toBe('full');
  });

  it('checks again when the person comes back to the app', async () => {
    const { result, unmount } = await renderHook(() => usePhotoAccess());
    await act(async () => {});
    perms.getPhotoAccess.mockResolvedValueOnce('full');
    await act(async () => appStateHandler?.('background'));
    expect(perms.getPhotoAccess).toHaveBeenCalledTimes(1);
    await act(async () => appStateHandler?.('active'));
    expect(result.current.access).toBe('full');
    await unmount();
    expect(remove).toHaveBeenCalled();
  });
});

describe('useDocumentAccess', () => {
  it('checks access and whether this build may ask for all files', async () => {
    pdf.canRequestAllFilesAccess.mockResolvedValueOnce(false);
    const { result } = await renderHook(() => useDocumentAccess());
    await act(async () => {});
    expect(result.current.access).toBe('none');
    expect(result.current.canAskAll).toBe(false);
  });

  it('opens the All files switch on Android 11+, then checks again', async () => {
    const { result } = await renderHook(() => useDocumentAccess());
    await act(async () => {});
    perms.getDocumentAccess.mockResolvedValueOnce('all');
    await act(async () => {
      await expect(result.current.allowAll()).resolves.toBe('all');
    });
    expect(perms.openAllFilesAccessAndWait).toHaveBeenCalledTimes(1);
    expect(perms.ensureDocumentAccess).not.toHaveBeenCalled();
    expect(result.current.access).toBe('all');
  });

  it('asks for file access the old way before Android 11', async () => {
    perms.allFilesAccessApplies.mockReturnValue(false);
    const { result } = await renderHook(() => useDocumentAccess());
    await act(async () => {});
    await act(async () => {
      await result.current.allowAll();
    });
    expect(perms.ensureDocumentAccess).toHaveBeenCalledTimes(1);
    expect(perms.openAllFilesAccessAndWait).not.toHaveBeenCalled();
    perms.allFilesAccessApplies.mockReturnValue(true);
  });

  it('says whether a folder was chosen and how many PDFs were added', async () => {
    const { result } = await renderHook(() => useDocumentAccess());
    await act(async () => {});
    perms.getDocumentAccess.mockResolvedValue('folders');
    await act(async () => {
      await expect(result.current.chooseFolder()).resolves.toBe(true);
    });
    expect(result.current.access).toBe('folders');
    pdf.pickPdfFolder.mockResolvedValueOnce(null);
    await act(async () => {
      await expect(result.current.chooseFolder()).resolves.toBe(false);
      await expect(result.current.pickFiles()).resolves.toBe(2);
    });
    perms.getDocumentAccess.mockResolvedValue('none');
  });
});
