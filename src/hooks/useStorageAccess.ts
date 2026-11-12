import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  DocumentAccess,
  PhotoAccess,
  allFilesAccessApplies,
  ensureDocumentAccess,
  getDocumentAccess,
  getPhotoAccess,
  openAllFilesAccessAndWait,
  openAppSettingsAndWait,
  requestPhotoAccess,
} from '../utils/StoragePermissions';
import { canRequestAllFilesAccess, pickPdfFiles, pickPdfFolder } from '../utils/PdfImport';
import { AppLogger } from '../utils/AppLogger';

/** Calls `refresh` whenever the app comes back to the foreground (from Settings, a dialog). */
const useRefreshOnReturn = (refresh: () => unknown) => {
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refresh();
      }
    });
    return () => sub.remove();
  }, [refresh]);
};

/** setState that does nothing once the component has gone. */
const useAliveRef = () => {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
};

/**
 * Android only says "won't ask again" when asked: a plain check reads the
 * same as "denied". So once a request comes back blocked, later checks keep
 * saying blocked (and callers open Settings) until photos are allowed.
 * Shared by every screen for the rest of the session.
 */
let photosBlocked = false;
const rememberBlocked = (raw: PhotoAccess): PhotoAccess => {
  if (raw === 'blocked') {
    photosBlocked = true;
  } else if (raw === 'full' || raw === 'limited') {
    photosBlocked = false;
  }
  return raw === 'denied' && photosBlocked ? 'blocked' : raw;
};

/** @internal Test helper. */
export const __forgetBlockedPhotos = () => {
  photosBlocked = false;
};

export interface PhotoAccessApi {
  /** null until the first check finishes. */
  access: PhotoAccess | null;
  refresh: () => Promise<PhotoAccess>;
  /** Shows the system photo dialog (on Android 14+ also when only some photos are allowed). */
  request: () => Promise<PhotoAccess>;
  /** Opens this app's Settings page and re-checks once the person is back. */
  openSettings: () => Promise<PhotoAccess>;
}

/**
 * What photos Pinpointer may read, kept current: checked on mount and every
 * time the app comes back to the front (the person may have changed it in
 * Settings). Never shows anything by itself.
 */
export const usePhotoAccess = (): PhotoAccessApi => {
  const [access, setAccess] = useState<PhotoAccess | null>(null);
  const alive = useAliveRef();

  const settle = useCallback(
    (raw: PhotoAccess) => {
      const next = rememberBlocked(raw);
      if (alive.current) {
        setAccess(next);
      }
      return next;
    },
    [alive],
  );

  const refresh = useCallback(async () => settle(await getPhotoAccess()), [settle]);
  const request = useCallback(async () => settle(await requestPhotoAccess()), [settle]);
  const openSettings = useCallback(async () => settle(await openAppSettingsAndWait()), [settle]);

  useEffect(() => {
    refresh().catch(e => AppLogger.warn('StorageAccess', 'Photo access check failed', e));
  }, [refresh]);
  useRefreshOnReturn(refresh);

  return { access, refresh, request, openSettings };
};

export interface DocumentAccessApi {
  /** null until the first check finishes. */
  access: DocumentAccess | null;
  /** False when this build can't ask for All files access (then offer a folder). */
  canAskAll: boolean;
  refresh: () => Promise<DocumentAccess>;
  /**
   * All files access: opens its switch in Settings (Android 11+), or asks for
   * file access on older phones. Resolves with the re-checked access.
   */
  allowAll: () => Promise<DocumentAccess>;
  /** The system folder picker. Resolves true when a folder was chosen. */
  chooseFolder: () => Promise<boolean>;
  /** The system file picker for PDFs. Resolves with how many were added. */
  pickFiles: () => Promise<number>;
}

/** What PDFs Pinpointer may read, kept current like `usePhotoAccess`. */
export const useDocumentAccess = (): DocumentAccessApi => {
  const [access, setAccess] = useState<DocumentAccess | null>(null);
  const [canAskAll, setCanAskAll] = useState(true);
  const alive = useAliveRef();

  const refresh = useCallback(async () => {
    const next = await getDocumentAccess();
    if (alive.current) {
      setAccess(next);
    }
    return next;
  }, [alive]);

  useEffect(() => {
    refresh().catch(e => AppLogger.warn('StorageAccess', 'PDF access check failed', e));
    canRequestAllFilesAccess()
      .then(ok => {
        if (alive.current) {
          setCanAskAll(ok);
        }
      })
      .catch(() => undefined);
  }, [alive, refresh]);
  useRefreshOnReturn(refresh);

  const allowAll = useCallback(async () => {
    if (allFilesAccessApplies()) {
      await openAllFilesAccessAndWait();
    } else {
      await ensureDocumentAccess();
    }
    return refresh();
  }, [refresh]);

  const chooseFolder = useCallback(async () => {
    const folder = await pickPdfFolder();
    await refresh();
    return !!folder;
  }, [refresh]);

  const pickFiles = useCallback(async () => {
    const added = await pickPdfFiles();
    await refresh();
    return added;
  }, [refresh]);

  return { access, canAskAll, refresh, allowAll, chooseFolder, pickFiles };
};
