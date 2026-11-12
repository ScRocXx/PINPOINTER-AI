import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useToast } from '../components/ui';
import { useStrings } from '../i18n';
import { usePinpointerShared } from './PinpointerContext';
import {
  PdfFolder,
  canRequestAllFilesAccess,
  forgetPdfFolder,
  isPdfImportAvailable,
  listPdfFolders,
  pickPdfFiles,
  pickPdfFolder,
} from '../utils/PdfImport';
import {
  allFilesAccessApplies,
  ensureDocumentAccess,
  hasDocumentAccess,
  openAllFilesAccessAndWait,
} from '../utils/StoragePermissions';
import { AppLogger } from '../utils/AppLogger';

/** Where Pinpointer looks for PDFs, as the Papers screens show it. */
export interface PdfPlaces {
  /** False until the first check has finished. */
  ready: boolean;
  /** Downloads and Documents can be read (All files access, or Android 10 and older). */
  standard: boolean;
  /** This build can still ask for All files access (a Play build may not). */
  canAskStandard: boolean;
  /** The folder and file pickers exist (Android builds with DocumentAccessModule). */
  canPick: boolean;
  /** Folders the person chose that can still be read. */
  folders: PdfFolder[];
}

const INITIAL: PdfPlaces = { ready: false, standard: false, canAskStandard: true, canPick: false, folders: [] };

/**
 * The places Pinpointer reads PDFs from, plus the actions that change them.
 * Every change is confirmed with a toast and starts a document check, so new
 * papers show up without another tap. Checked again whenever the person
 * comes back to the app (they may have just changed a permission).
 */
export const usePdfPlaces = () => {
  const { t } = useStrings();
  const toast = useToast();
  const { handleDocumentSync } = usePinpointerShared();
  const [places, setPlaces] = useState<PdfPlaces>(INITIAL);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [standard, canAskStandard, folders] = await Promise.all([
        hasDocumentAccess(),
        canRequestAllFilesAccess(),
        listPdfFolders(),
      ]);
      if (alive.current) {
        setPlaces({ ready: true, standard, canAskStandard, canPick: isPdfImportAvailable(), folders });
      }
    } catch (e) {
      AppLogger.warn('PdfPlaces', 'Could not check where PDFs are read', e);
      if (alive.current) {
        setPlaces(p => ({ ...p, ready: true }));
      }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });
    return () => {
      alive.current = false;
      sub.remove();
    };
  }, [refresh]);

  // Picked PDFs and folders need no permission, so the check runs quietly
  // (the "fromShare" path of useDocumentSync).
  const lookForPapers = useCallback(() => {
    Promise.resolve(handleDocumentSync(undefined, true)).catch(e =>
      AppLogger.warn('PdfPlaces', 'Document check failed', e),
    );
  }, [handleDocumentSync]);

  /** System folder picker. Resolves with the folder, or null if cancelled. */
  const addFolder = useCallback(async (): Promise<PdfFolder | null> => {
    const folder = await pickPdfFolder();
    if (!folder) {
      return null;
    }
    await refresh();
    toast.show(t('papers.folderAdded', { name: folder.name }), { icon: 'folder' });
    lookForPapers();
    return folder;
  }, [lookForPapers, refresh, t, toast]);

  /** System file picker for PDFs. Resolves with how many were added. */
  const addFiles = useCallback(async (): Promise<number> => {
    const n = await pickPdfFiles();
    if (n > 0) {
      toast.show(n === 1 ? t('papers.onePdfAdded') : t('papers.pdfsAdded', { n }), { icon: 'papers' });
      lookForPapers();
    }
    return n;
  }, [lookForPapers, t, toast]);

  /** Stop reading a folder. PDFs already found stay searchable. */
  const removeFolder = useCallback(
    async (folder: PdfFolder): Promise<void> => {
      await forgetPdfFolder(folder.uri);
      await refresh();
      toast.show(t('folders.removed', { name: folder.name }), { icon: 'check' });
    },
    [refresh, t, toast],
  );

  /**
   * Opens the All files access switch (Android 11+), or asks for file access
   * on older phones, where that switch doesn't exist and waiting for it
   * would leave the button stuck. Looks for papers if access was given.
   */
  const allowStandard = useCallback(async (): Promise<boolean> => {
    const granted = allFilesAccessApplies() ? await openAllFilesAccessAndWait() : await ensureDocumentAccess();
    await refresh();
    if (granted) {
      Promise.resolve(handleDocumentSync()).catch(e => AppLogger.warn('PdfPlaces', 'Document check failed', e));
    }
    return granted;
  }, [handleDocumentSync, refresh]);

  return { ...places, refresh, addFolder, addFiles, removeFolder, allowStandard };
};

/** The one-line summary under "Where Pinpointer looks". */
export const describePlaces = (
  t: ReturnType<typeof useStrings>['t'],
  places: Pick<PdfPlaces, 'standard' | 'folders'>,
): string => {
  const n = places.folders.length;
  if (places.standard) {
    if (n === 0) return t('papers.whereStandard');
    return n === 1 ? t('papers.whereBothOne') : t('papers.whereBoth', { n });
  }
  if (n === 0) return t('papers.whereNone');
  return n === 1 ? t('papers.whereOneFolder') : t('papers.whereFolders', { n });
};
