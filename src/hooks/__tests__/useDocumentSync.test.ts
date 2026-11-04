/**
 * Tests for useDocumentSync — the PDF document sync engine hook.
 *
 * Strategy: the hook's collaborators are fully mocked —
 *   - '../../database' (isFileIndexed, begin/commit/rollbackTransaction)
 *   - '../utils/DocumentPipeline' (processPDF)
 *   - '../utils/AppLogger' (quiet + assertable)
 *   - 'react-native-fs' and '@react-native-async-storage/async-storage'
 *     come from the repo's root __mocks__ (in-memory).
 * Alert.alert is spied (RN preset leaves it a plain function); Linking and
 * StorageModule come from the preset / jest.setup.js stubs.
 * Platform.OS is forced to 'android' except in the iOS-specific tests.
 */
import { Alert, AppState, Linking, NativeModules, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';

import { useDocumentSync } from '../useDocumentSync';
import {
  beginTransaction,
  commitTransaction,
  isFileIndexed,
  rollbackTransaction,
} from '../../database';
import { processPDF } from '../../utils/DocumentPipeline';
import { AppLogger } from '../../utils/AppLogger';

jest.mock('../../database', () => ({
  isFileIndexed: jest.fn(),
  beginTransaction: jest.fn(),
  commitTransaction: jest.fn(),
  rollbackTransaction: jest.fn(),
}));
jest.mock('../../utils/DocumentPipeline', () => ({
  processPDF: jest.fn(),
}));
jest.mock('../../utils/AppLogger', () => ({
  AppLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const { StorageModule } = NativeModules;

// ─── helpers ────────────────────────────────────────────────────────────────
type DirItem = {
  name: string;
  path: string;
  isFile: () => boolean;
  isDirectory: () => boolean;
};
const pdfFile = (name: string, path: string): DirItem => ({
  name,
  path,
  isFile: () => true,
  isDirectory: () => false,
});
const dirItem = (name: string, path: string): DirItem => ({
  name,
  path,
  isFile: () => false,
  isDirectory: () => true,
});
const asItems = (items: DirItem[]) => items as unknown as RNFS.ReadDirItem[];

const DOWNLOAD = RNFS.DownloadDirectoryPath; // '/mock/DownloadDirectoryPath'
const DOCS_DIR = `${RNFS.ExternalStorageDirectoryPath}/Documents`;

const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
const consoleErrorSpy = jest
  .spyOn(console, 'error')
  .mockImplementation(() => {});

function alertButtons() {
  const calls = alertSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[0][2] as Array<{ text: string; style?: string; onPress?: () => void }>;
}

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage as unknown as { __reset: () => void }).__reset();
  (Platform as unknown as { OS: string }).OS = 'android';
  Object.defineProperty(Platform, 'Version', { value: 34, configurable: true, writable: true });
  (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(true);
  (RNFS.exists as jest.Mock).mockResolvedValue(true);
  (RNFS.readDir as jest.Mock).mockResolvedValue([]);
  (isFileIndexed as jest.Mock).mockReturnValue(false);
  (processPDF as jest.Mock).mockResolvedValue(undefined);
});

afterEach(() => {
  (Platform as unknown as { OS: string }).OS = 'ios';
});

// ─── mount / persisted state ────────────────────────────────────────────────
describe('mount & persisted state', () => {
  test('initial state is idle with zeroed counters', async () => {
    const { result } = await renderHook(() => useDocumentSync());
    expect(result.current.isSyncingDocs).toBe(false);
    expect(result.current.docSyncCount).toBe(0);
    expect(result.current.totalDocs).toBe(0);
    expect(result.current.lastDocSyncTime).toBeNull();
  });

  test('loads persisted last-sync time on mount', async () => {
    await AsyncStorage.setItem('doc_last_sync_time', '1700000000000');
    const { result } = await renderHook(() => useDocumentSync());
    await act(async () => {});
    expect(AsyncStorage.getItem).toHaveBeenCalledWith('doc_last_sync_time');
    expect(result.current.lastDocSyncTime).toBe(1700000000000);
  });

  test('stays null when nothing was persisted', async () => {
    const { result } = await renderHook(() => useDocumentSync());
    await act(async () => {});
    expect(result.current.lastDocSyncTime).toBeNull();
  });

  test('survives AsyncStorage failure on mount and logs it', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('db fail'));
    const { result } = await renderHook(() => useDocumentSync());
    await act(async () => {});
    expect(result.current.lastDocSyncTime).toBeNull();
    expect(AppLogger.error).toHaveBeenCalledWith(
      'DocumentSync',
      'Failed to load persisted time',
      expect.any(Error),
    );
  });

  test('loadPersistedState can be re-invoked to refresh the timestamp', async () => {
    const { result } = await renderHook(() => useDocumentSync());
    await act(async () => {});
    expect(result.current.lastDocSyncTime).toBeNull();

    await AsyncStorage.setItem('doc_last_sync_time', '1800000000000');
    await act(async () => {
      await result.current.loadPersistedState();
    });
    expect(result.current.lastDocSyncTime).toBe(1800000000000);
  });
});

// ─── happy-path sync (android) ──────────────────────────────────────────────
describe('handleDocumentSync — android happy path', () => {
  test('processes new PDFs with file:// URIs inside per-document transactions', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) =>
      p === DOWNLOAD
        ? asItems([pdfFile('a.pdf', `${DOWNLOAD}/a.pdf`), pdfFile('b.pdf', `${DOWNLOAD}/b.pdf`)])
        : asItems([]),
    );
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    expect(processPDF).toHaveBeenCalledTimes(2);
    expect(processPDF).toHaveBeenCalledWith(`file://${DOWNLOAD}/a.pdf`);
    expect(processPDF).toHaveBeenCalledWith(`file://${DOWNLOAD}/b.pdf`);
    expect(beginTransaction).toHaveBeenCalledTimes(2);
    expect(commitTransaction).toHaveBeenCalledTimes(2);
    expect(rollbackTransaction).not.toHaveBeenCalled();
    expect(AppLogger.info).toHaveBeenCalledWith(
      'DocumentSync',
      expect.stringContaining('Pipeline complete for: a.pdf'),
    );
  });

  test('skips already-indexed files but still commits their transaction', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) =>
      p === DOWNLOAD ? asItems([pdfFile('old.pdf', `${DOWNLOAD}/old.pdf`)]) : asItems([]),
    );
    (isFileIndexed as jest.Mock).mockReturnValue(true);
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    expect(isFileIndexed).toHaveBeenCalledWith(`file://${DOWNLOAD}/old.pdf`);
    expect(processPDF).not.toHaveBeenCalled();
    expect(beginTransaction).toHaveBeenCalledTimes(1);
    expect(commitTransaction).toHaveBeenCalledTimes(1);
    expect(rollbackTransaction).not.toHaveBeenCalled();
  });

  test('mixed run: indexed files skipped, new files processed', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) =>
      p === DOWNLOAD
        ? asItems([pdfFile('old.pdf', `${DOWNLOAD}/old.pdf`), pdfFile('new.pdf', `${DOWNLOAD}/new.pdf`)])
        : asItems([]),
    );
    (isFileIndexed as jest.Mock).mockImplementation((uri: string) =>
      uri.endsWith('old.pdf'),
    );
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    expect(processPDF).toHaveBeenCalledTimes(1);
    expect(processPDF).toHaveBeenCalledWith(`file://${DOWNLOAD}/new.pdf`);
    expect(commitTransaction).toHaveBeenCalledTimes(2);
  });

  test('reports progress mid-sync and resets state afterwards', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) =>
      p === DOWNLOAD
        ? asItems([pdfFile('a.pdf', `${DOWNLOAD}/a.pdf`), pdfFile('b.pdf', `${DOWNLOAD}/b.pdf`)])
        : asItems([]),
    );
    const resolvers: Array<() => void> = [];
    const started: string[] = [];
    (processPDF as jest.Mock).mockImplementation(
      (uri: string) =>
        new Promise<void>((resolve) => {
          started.push(uri);
          resolvers.push(resolve);
        }),
    );
    const { result } = await renderHook(() => useDocumentSync());

    let syncPromise!: Promise<void>;
    await act(async () => {
      syncPromise = result.current.handleDocumentSync();
      for (let i = 0; i < 200 && started.length < 1; i++) await Promise.resolve();
    });

    // mid-sync observables (act flushed effects, so result.current is fresh)
    expect(started).toEqual([`file://${DOWNLOAD}/a.pdf`]);
    expect(result.current.isSyncingDocs).toBe(true);
    expect(result.current.totalDocs).toBe(2);
    expect(result.current.docSyncCount).toBe(0);

    await act(async () => {
      resolvers[0]();
      for (let i = 0; i < 200 && started.length < 2; i++) await Promise.resolve();
    });
    expect(result.current.docSyncCount).toBe(1);

    await act(async () => {
      resolvers[1]();
      await syncPromise;
    });

    // finally-block reset
    expect(result.current.isSyncingDocs).toBe(false);
    expect(result.current.docSyncCount).toBe(0);
    expect(result.current.totalDocs).toBe(0);
  });

  test('persists last-sync time when the run completes', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    try {
      const { result } = await renderHook(() => useDocumentSync());
      await act(async () => {
        await result.current.handleDocumentSync();
      });
      expect(result.current.lastDocSyncTime).toBe(1700000000000);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'doc_last_sync_time',
        '1700000000000',
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('limit slices the document list (quick-scan mode)', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) =>
      p === DOWNLOAD
        ? asItems([
            pdfFile('1.pdf', `${DOWNLOAD}/1.pdf`),
            pdfFile('2.pdf', `${DOWNLOAD}/2.pdf`),
            pdfFile('3.pdf', `${DOWNLOAD}/3.pdf`),
          ])
        : asItems([]),
    );
    const { result } = await renderHook(() => useDocumentSync());
    const resolvers: Array<() => void> = [];
    (processPDF as jest.Mock).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    let syncPromise!: Promise<void>;
    await act(async () => {
      syncPromise = result.current.handleDocumentSync(2);
      for (let i = 0; i < 200 && resolvers.length < 1; i++) await Promise.resolve();
    });

    expect(result.current.totalDocs).toBe(2);

    // the pipeline is sequential: release doc 1 so doc 2 starts
    await act(async () => {
      resolvers[0]();
      for (let i = 0; i < 200 && resolvers.length < 2; i++) await Promise.resolve();
    });
    expect(processPDF).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolvers.forEach((r) => r());
      await syncPromise;
    });
    expect(result.current.isSyncingDocs).toBe(false);
  });

  test('limit=0 is falsy and processes everything (documents the quirk)', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) =>
      p === DOWNLOAD
        ? asItems([pdfFile('1.pdf', `${DOWNLOAD}/1.pdf`), pdfFile('2.pdf', `${DOWNLOAD}/2.pdf`)])
        : asItems([]),
    );
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync(0);
    });

    expect(processPDF).toHaveBeenCalledTimes(2);
  });

  test('second call while syncing returns early without re-scanning', async () => {
    const pendingReleases: Array<(items: RNFS.ReadDirItem[]) => void> = [];
    (RNFS.readDir as jest.Mock).mockImplementation(
      () =>
        new Promise<RNFS.ReadDirItem[]>((resolve) => {
          pendingReleases.push(resolve);
        }),
    );
    const { result } = await renderHook(() => useDocumentSync());

    let firstSync!: Promise<void>;
    await act(async () => {
      firstSync = result.current.handleDocumentSync();
      for (let i = 0; i < 200 && pendingReleases.length < 1; i++) {
        await Promise.resolve();
      }
    });
    expect(result.current.isSyncingDocs).toBe(true);

    const readDirCallsBefore = (RNFS.readDir as jest.Mock).mock.calls.length;
    await act(async () => {
      await result.current.handleDocumentSync();
    });

    // early return: no fresh scan, no additional pipeline invocation
    expect((RNFS.readDir as jest.Mock).mock.calls.length).toBe(readDirCallsBefore);
    expect(processPDF).not.toHaveBeenCalled();

    // release the first sync and let it finish cleanly (no dangling promises)
    await act(async () => {
      (RNFS.readDir as jest.Mock).mockResolvedValue(asItems([]));
      pendingReleases.forEach((r) => r(asItems([])));
      await firstSync;
    });
    expect(result.current.isSyncingDocs).toBe(false);
  });
});

// ─── error handling ─────────────────────────────────────────────────────────
describe('handleDocumentSync — error handling', () => {
  test('failed pipeline rolls back, logs, and the sync continues', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) =>
      p === DOWNLOAD
        ? asItems([pdfFile('bad.pdf', `${DOWNLOAD}/bad.pdf`), pdfFile('good.pdf', `${DOWNLOAD}/good.pdf`)])
        : asItems([]),
    );
    (processPDF as jest.Mock).mockImplementation(async (uri: string) => {
      if (uri.endsWith('bad.pdf')) throw new Error('ocr exploded');
    });
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    expect(processPDF).toHaveBeenCalledTimes(2);
    expect(rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(commitTransaction).toHaveBeenCalledTimes(1);
    expect(AppLogger.error).toHaveBeenCalledWith(
      'DocumentSync',
      expect.stringContaining('Pipeline failed for: bad.pdf'),
      expect.any(Error),
    );
    // run still completes and resets
    expect(result.current.isSyncingDocs).toBe(false);
    expect(result.current.lastDocSyncTime).toEqual(expect.any(Number));
  });

  test('isFileIndexed throwing is treated as a pipeline failure', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) =>
      p === DOWNLOAD ? asItems([pdfFile('a.pdf', `${DOWNLOAD}/a.pdf`)]) : asItems([]),
    );
    (isFileIndexed as jest.Mock).mockImplementation(() => {
      throw new Error('db locked');
    });
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    expect(processPDF).not.toHaveBeenCalled();
    expect(rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(commitTransaction).not.toHaveBeenCalled();
    expect(AppLogger.error).toHaveBeenCalledWith(
      'DocumentSync',
      expect.stringContaining('Pipeline failed for: a.pdf'),
      expect.any(Error),
    );
    expect(result.current.isSyncingDocs).toBe(false);
  });

  test('entries without a path are skipped entirely (no transaction)', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) =>
      p === DOWNLOAD
        ? asItems([
            { name: 'ghost.pdf', path: '', isFile: () => true, isDirectory: () => false },
            pdfFile('real.pdf', `${DOWNLOAD}/real.pdf`),
          ])
        : asItems([]),
    );
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    expect(processPDF).toHaveBeenCalledTimes(1);
    expect(processPDF).toHaveBeenCalledWith(`file://${DOWNLOAD}/real.pdf`);
    expect(beginTransaction).toHaveBeenCalledTimes(1);
  });
});

// ─── permission flow / empty scan ───────────────────────────────────────────
/** Captures the AppState listener StoragePermissions adds while the user is in Settings. */
function captureAppState() {
  const handlers: Array<(s: string) => void> = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
    handlers.push(h);
    return { remove: jest.fn() };
  }) as never);
  return {
    returnToApp: () => handlers.forEach((h) => { h('background'); h('active'); }),
  };
}

const flushAll = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('handleDocumentSync — empty scan & permission flow', () => {
  test('no PDFs found with access granted → no prompt, no pipeline work', async () => {
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    expect(processPDF).not.toHaveBeenCalled();
    expect(beginTransaction).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(result.current.isSyncingDocs).toBe(false);
  });

  test('last-sync time is persisted when the scan finds nothing', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000001);
    try {
      const { result } = await renderHook(() => useDocumentSync());
      await act(async () => {
        await result.current.handleDocumentSync();
      });
      expect(result.current.lastDocSyncTime).toBe(1700000000001);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        'doc_last_sync_time',
        '1700000000001',
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('without All Files Access it explains the steps and does not scan', async () => {
    (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(false);
    const { result } = await renderHook(() => useDocumentSync());

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.handleDocumentSync();
      await flushAll();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Allow Pinpointer to find your PDFs',
      expect.stringContaining('Allow access to manage all files'),
      expect.any(Array),
      expect.anything(),
    );
    const buttons = alertButtons();
    expect(buttons.map((b) => b.text)).toEqual(['Not now', 'Open Settings']);

    await act(async () => {
      buttons[0].onPress?.();
      await done;
    });
    expect(RNFS.readDir).not.toHaveBeenCalled();
    expect(StorageModule.openAllFilesAccessSettings).not.toHaveBeenCalled();
    expect(Linking.openSettings).not.toHaveBeenCalled();
    expect(result.current.isSyncingDocs).toBe(false);
  });

  test('"Open Settings" opens the All Files Access screen and syncs once the user is back with access', async () => {
    (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(false);
    const appState = captureAppState();
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) =>
      p === DOWNLOAD ? asItems([pdfFile('a.pdf', `${DOWNLOAD}/a.pdf`)]) : [],
    );
    const { result } = await renderHook(() => useDocumentSync());

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.handleDocumentSync();
      await flushAll();
    });
    await act(async () => {
      alertButtons()[1].onPress?.();
      await flushAll();
    });
    expect(StorageModule.openAllFilesAccessSettings).toHaveBeenCalledTimes(1);
    expect(Linking.openSettings).not.toHaveBeenCalled();
    expect(RNFS.readDir).not.toHaveBeenCalled(); // still waiting for the user

    (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(true);
    await act(async () => {
      appState.returnToApp();
      await done;
    });
    expect(processPDF).toHaveBeenCalledWith(`file://${DOWNLOAD}/a.pdf`);
  });

  test('coming back with access still off does not scan', async () => {
    (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(false);
    const appState = captureAppState();
    const { result } = await renderHook(() => useDocumentSync());

    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.handleDocumentSync();
      await flushAll();
    });
    await act(async () => {
      alertButtons()[1].onPress?.();
      await flushAll();
      appState.returnToApp();
      await done;
    });
    expect(RNFS.readDir).not.toHaveBeenCalled();
    expect(result.current.isSyncingDocs).toBe(false);
  });

  test('"Open Settings" falls back to Linking.openSettings when the native method is missing', async () => {
    (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(false);
    const appState = captureAppState();
    const sm = StorageModule as Record<string, unknown>;
    const original = sm.openAllFilesAccessSettings;
    delete sm.openAllFilesAccessSettings;
    try {
      const { result } = await renderHook(() => useDocumentSync());
      let done: Promise<void> = Promise.resolve();
      await act(async () => {
        done = result.current.handleDocumentSync();
        await flushAll();
      });
      await act(async () => {
        alertButtons()[1].onPress?.();
        await flushAll();
        appState.returnToApp();
        await done;
      });
      expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    } finally {
      sm.openAllFilesAccessSettings = original;
    }
  });
});

// ─── scanner behaviour ──────────────────────────────────────────────────────
describe('PDF scanner', () => {
  test('ios scans only the document directory', async () => {
    (Platform as unknown as { OS: string }).OS = 'ios';
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    const existsCalls = (RNFS.exists as jest.Mock).mock.calls.map((c) => c[0]);
    expect(existsCalls).toEqual([RNFS.DocumentDirectoryPath]);
    expect(alertSpy).not.toHaveBeenCalled(); // nothing found is not a permission problem
  });

  test('recurses into subdirs, skips hidden dirs, matches .pdf case-insensitively', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) => {
      if (p === DOWNLOAD)
        return asItems([
          pdfFile('UPPER.PDF', `${DOWNLOAD}/UPPER.PDF`),
          { name: 'notes.txt', path: `${DOWNLOAD}/notes.txt`, isFile: () => true, isDirectory: () => false },
          dirItem('.hidden', `${DOWNLOAD}/.hidden`),
          dirItem('sub', `${DOWNLOAD}/sub`),
        ]);
      if (p === `${DOWNLOAD}/.hidden`)
        return asItems([pdfFile('secret.pdf', `${DOWNLOAD}/.hidden/secret.pdf`)]);
      if (p === `${DOWNLOAD}/sub`)
        return asItems([pdfFile('nested.pdf', `${DOWNLOAD}/sub/nested.pdf`)]);
      return asItems([]);
    });
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    const uris = (processPDF as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(uris).toEqual([
      `file://${DOWNLOAD}/UPPER.PDF`,
      `file://${DOWNLOAD}/sub/nested.pdf`,
    ]);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('respects MAX_DEPTH of 4', async () => {
    const d1 = `${DOWNLOAD}/d1`;
    const d2 = `${d1}/d2`;
    const d3 = `${d2}/d3`;
    const d4 = `${d3}/d4`;
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) => {
      if (p === DOWNLOAD) return asItems([dirItem('d1', d1)]);
      if (p === d1) return asItems([dirItem('d2', d2)]);
      if (p === d2) return asItems([dirItem('d3', d3)]);
      if (p === d3)
        return asItems([
          pdfFile('shallow.pdf', `${d3}/shallow.pdf`),
          dirItem('d4', d4),
        ]);
      if (p === d4) return asItems([pdfFile('deep.pdf', `${d4}/deep.pdf`)]);
      return asItems([]);
    });
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    const uris = (processPDF as jest.Mock).mock.calls.map((c) => c[0] as string);
    // d4 is entered at depth 5 (> MAX_DEPTH) so its contents are never read
    expect(uris).toEqual([`file://${d3}/shallow.pdf`]);
  });

  test('EACCES in one directory does not stop the other directory', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) => {
      if (p === DOWNLOAD) throw new Error('EACCES: permission denied');
      if (p === DOCS_DIR)
        return asItems([pdfFile('doc.pdf', `${DOCS_DIR}/doc.pdf`)]);
      return asItems([]);
    });
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    expect(processPDF).toHaveBeenCalledTimes(1);
    expect(processPDF).toHaveBeenCalledWith(`file://${DOCS_DIR}/doc.pdf`);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('EACCES everywhere with access granted finishes quietly (no false permission prompt)', async () => {
    (RNFS.readDir as jest.Mock).mockRejectedValue(new Error('EACCES: denied'));
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    expect(processPDF).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test('non-EACCES read errors are swallowed per directory', async () => {
    (RNFS.readDir as jest.Mock).mockImplementation(async (p: string) => {
      if (p === DOWNLOAD) throw new Error('ENOENT: no such directory');
      if (p === DOCS_DIR)
        return asItems([pdfFile('doc.pdf', `${DOCS_DIR}/doc.pdf`)]);
      return asItems([]);
    });
    const consoleSpyCallsBefore = consoleErrorSpy.mock.calls.length;
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    expect(processPDF).toHaveBeenCalledTimes(1);
    // scanner swallows it; only the hook's own console.error paths would log
    expect(consoleErrorSpy.mock.calls.length).toBe(consoleSpyCallsBefore);
  });

  test('directories that do not exist are skipped without readDir', async () => {
    (RNFS.exists as jest.Mock).mockImplementation(async (p: string) => p === DOCS_DIR);
    const { result } = await renderHook(() => useDocumentSync());

    await act(async () => {
      await result.current.handleDocumentSync();
    });

    const readDirs = (RNFS.readDir as jest.Mock).mock.calls.map((c) => c[0] as string);
    expect(readDirs).not.toContain(DOWNLOAD);
    expect(readDirs).toContain(DOCS_DIR);
  });
});
