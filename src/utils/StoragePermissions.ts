/**
 * StoragePermissions — one place for every Android storage permission
 * Pinpointer needs, written so that the user always gets either a result
 * or a clear next step (never a silent no-op).
 *
 * Photos (Android 13+): READ_MEDIA_IMAGES, plus READ_MEDIA_VISUAL_USER_SELECTED
 * on Android 14+ so "Select photos" (limited access) is a real, lasting grant
 * instead of a temporary one that is revoked when the app is backgrounded.
 *
 * Documents: "All files access" (MANAGE_EXTERNAL_STORAGE) on Android 11+,
 * READ_EXTERNAL_STORAGE below that. The real grant state is read from
 * Environment.isExternalStorageManager() via StorageModule, instead of being
 * guessed from "the scan found no PDFs".
 *
 * After sending the user to Settings, the `...AndWait` helpers resolve with
 * the re-checked state as soon as the app is back in the foreground, so the
 * sync can continue without the user having to find the button again.
 */
import { Alert, AppState, AppStateStatus, Linking, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from './AppLogger';
import { tNow } from '../i18n/current';
import type { StringKey } from '../i18n/strings';
import { canRequestAllFilesAccess, isPdfImportAvailable, listPdfFolders, pickPdfFiles, pickPdfFolder } from './PdfImport';

const { StorageModule } = NativeModules;

/** Set when the user chose to keep "Select photos", so we don't ask on every sync. */
const LIMITED_OK_KEY = 'photo_limited_access_ok';

/** full = every photo; limited = only the photos the user picked. */
export type PhotoAccess = 'full' | 'limited' | 'denied' | 'blocked';

const ANDROID_14 = 34;
const ANDROID_13 = 33;
const ANDROID_11 = 30;

const apiLevel = (): number => Number(Platform.Version);

const photoPermissions = (): string[] => {
    const P = PermissionsAndroid.PERMISSIONS;
    if (apiLevel() >= ANDROID_14) return [P.READ_MEDIA_IMAGES, P.READ_MEDIA_VISUAL_USER_SELECTED];
    if (apiLevel() >= ANDROID_13) return [P.READ_MEDIA_IMAGES];
    return [P.READ_EXTERNAL_STORAGE];
};

const toPhotoAccess = (results: Record<string, string>): PhotoAccess => {
    const P = PermissionsAndroid.PERMISSIONS;
    const R = PermissionsAndroid.RESULTS;
    const main = apiLevel() >= ANDROID_13 ? P.READ_MEDIA_IMAGES : P.READ_EXTERNAL_STORAGE;
    if (results[main] === R.GRANTED) return 'full';
    if (results[P.READ_MEDIA_VISUAL_USER_SELECTED] === R.GRANTED) return 'limited';
    if (Object.values(results).includes(R.NEVER_ASK_AGAIN)) return 'blocked';
    return 'denied';
};

/** Current photo access, without showing any dialog. Safe in background tasks. */
export const getPhotoAccess = async (): Promise<PhotoAccess> => {
    if (Platform.OS !== 'android') return 'full'; // iOS: handled by Info.plist
    const results: Record<string, string> = {};
    for (const perm of photoPermissions()) {
        try {
            const ok = await PermissionsAndroid.check(perm as never);
            results[perm] = ok ? PermissionsAndroid.RESULTS.GRANTED : PermissionsAndroid.RESULTS.DENIED;
        } catch {
            results[perm] = PermissionsAndroid.RESULTS.DENIED;
        }
    }
    return toPhotoAccess(results);
};

/** True when there is any photo access (full or limited). */
export const hasPhotoAccess = async (): Promise<boolean> => {
    const access = await getPhotoAccess();
    return access === 'full' || access === 'limited';
};

/** Shows the system photo dialog (when Android still allows one). */
export const requestPhotoAccess = async (): Promise<PhotoAccess> => {
    if (Platform.OS !== 'android') return 'full';
    try {
        const results = await PermissionsAndroid.requestMultiple(photoPermissions() as never[]);
        return toPhotoAccess(results as Record<string, string>);
    } catch (e) {
        AppLogger.warn('StoragePermissions', 'Photo permission request failed', e);
        return 'denied';
    }
};

/**
 * Waits for the next time the app returns to the foreground. Used after
 * sending the user to a Settings screen. `cancel` stops listening when
 * nothing was opened after all.
 */
const waitForReturn = (): { back: Promise<void>; cancel: () => void } => {
    let left = false;
    let done: () => void = () => undefined;
    const back = new Promise<void>((resolve) => { done = resolve; });
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state !== 'active') {
            left = true;
        } else if (left) {
            sub.remove();
            done();
        }
    });
    return { back, cancel: () => sub.remove() };
};

/** Runs `open` (which leaves the app) and resolves once the user is back. */
const openThenWait = async (open: () => unknown): Promise<void> => {
    const { back, cancel } = waitForReturn();
    try {
        await open();
    } catch (e) {
        AppLogger.warn('StoragePermissions', 'Could not open Settings', e);
        cancel(); // nothing was opened, so don't wait for a return that won't come
        return;
    }
    await back;
};

/** Opens this app's page in Settings and resolves with the photo access once the user is back. */
export const openAppSettingsAndWait = async (): Promise<PhotoAccess> => {
    await openThenWait(() => Linking.openSettings());
    return getPhotoAccess();
};

/**
 * Alert with a cancel button and up to two more; resolves with the label of
 * the button tapped, or null for cancel / dismiss. Callers pass words from
 * the strings list, in the app's language.
 */
const choose = (title: string, message: string, options: string[], cancel = tNow('common.notNow')): Promise<string | null> =>
    new Promise((resolve) => {
        Alert.alert(title, message, [
            { text: cancel, style: 'cancel', onPress: () => resolve(null) },
            ...options.map((text) => ({ text, onPress: () => resolve(text) })),
        ], { cancelable: true, onDismiss: () => resolve(null) });
    });

/** Alert with a Cancel and a primary button; resolves true if the primary button was tapped. */
const ask = async (title: string, message: string, primary: string, cancel?: string): Promise<boolean> =>
    (await choose(title, message, [primary], cancel)) === primary;

/** "Intro.\n\n1. …\n2. …" in the app's language. */
const withSteps = (intro: string, steps: StringKey[]): string =>
    `${intro}\n\n${steps.map((key, i) => `${i + 1}. ${tNow(key)}`).join('\n')}`;

/** The Settings steps that turn photos on, in this phone's own words. */
const photoSettingsSteps = (): StringKey[] => {
    const wording = photoSettingsWording();
    return [
        'onboarding.settingsStep1',
        wording.list === 'photos' ? 'onboarding.photosStep2' : 'onboarding.photosStep2Files',
        wording.choice === 'allowAll' ? 'onboarding.photosStep3' : 'onboarding.photosStep3Allow',
    ];
};

/**
 * Makes sure Pinpointer can read photos, guiding the user to Settings when
 * the system dialog can no longer be shown. Resolves true when sync may run
 * (full access, or limited access the user chose to keep).
 */
export const ensurePhotoAccess = async (): Promise<boolean> => {
    let access = await getPhotoAccess();
    if (access === 'full') return true;
    if (access !== 'limited') access = await requestPhotoAccess();
    if (access === 'full') return true;

    if (access === 'limited') {
        const alreadyOk = await AsyncStorage.getItem(LIMITED_OK_KEY).catch(() => null);
        if (alreadyOk) return true;
        const fix = await ask(
            tNow('perm.limitedTitle'),
            withSteps(tNow('perm.limitedAlertBody'), photoSettingsSteps()),
            tNow('perm.openSettings'),
            tNow('perm.keepChoice'),
        );
        if (fix) {
            access = await openAppSettingsAndWait();
        } else {
            await AsyncStorage.setItem(LIMITED_OK_KEY, '1').catch(() => undefined);
        }
        return access === 'full' || access === 'limited';
    }

    if (access === 'blocked') {
        const fix = await ask(
            tNow('onboarding.photosBlockedTitle'),
            withSteps(tNow('perm.photosOffBody'), photoSettingsSteps()),
            tNow('perm.openSettings'),
        );
        if (!fix) return false;
        access = await openAppSettingsAndWait();
        return access === 'full' || access === 'limited';
    }

    return false; // 'denied': the user just said no in the system dialog
};

/** True once the person chose to keep "Select photos" (limited access). */
export const isLimitedAccessKept = async (): Promise<boolean> =>
    !!(await AsyncStorage.getItem(LIMITED_OK_KEY).catch(() => null));

/**
 * Remember that the person wants to keep limited photo access, so neither the
 * "only some photos" banner nor the sync alert asks again.
 */
export const keepLimitedAccess = async (): Promise<void> => {
    await AsyncStorage.setItem(LIMITED_OK_KEY, '1').catch(() => undefined);
};

/**
 * True when PDFs need their own permission ("All files access", Android 11+).
 * Below Android 11 the photo permission already covers files.
 */
export const allFilesAccessApplies = (): boolean => Platform.OS === 'android' && apiLevel() >= ANDROID_11;

/**
 * What this phone's Settings call the photo permission and its "yes":
 * "Photos and videos" → "Allow all" on Android 14+, "Allow" on 13, and
 * "Files and media" (or "Storage") → "Allow" on older phones.
 */
export const photoSettingsWording = (): { list: 'photos' | 'files'; choice: 'allowAll' | 'allow' } => {
  if (Platform.OS !== 'android' || apiLevel() >= ANDROID_14) {
    return { list: 'photos', choice: 'allowAll' };
  }
  return { list: apiLevel() >= ANDROID_13 ? 'photos' : 'files', choice: 'allow' };
};

/**
 * all = every PDF in Download/ and Documents/; folders = only folders the
 * person picked; none = no PDFs yet (shared and picked PDFs still work).
 */
export type DocumentAccess = 'all' | 'folders' | 'none';

/** What Pinpointer may read for PDFs, without showing anything. */
export const getDocumentAccess = async (): Promise<DocumentAccess> => {
    if (await hasDocumentAccess()) return 'all';
    return (await listPdfFolders()).length > 0 ? 'folders' : 'none';
};

/** True when Pinpointer may read PDFs in shared storage (Download, Documents). */
export const hasDocumentAccess = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    if (apiLevel() >= ANDROID_11) {
        try {
            return !!(await StorageModule?.hasAllFilesAccess?.());
        } catch {
            return false;
        }
    }
    try {
        return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
    } catch {
        return false;
    }
};

/** Opens the "All files access" toggle for this app and resolves with the re-checked state. */
export const openAllFilesAccessAndWait = async (): Promise<boolean> => {
    await openThenWait(() => (StorageModule?.openAllFilesAccessSettings
        ? StorageModule.openAllFilesAccessSettings()
        : Linking.openSettings()));
    return hasDocumentAccess();
};

/**
 * Makes sure Pinpointer can read PDFs, explaining the choices in plain
 * steps. Resolves true when the document scan may run.
 *
 * With "All files access" every PDF in Download/ and Documents/ is found.
 * Without it, PDFs come from folders the user picked, PDFs picked one by
 * one, and PDFs shared to Pinpointer (see PdfImport).
 */
export const ensureDocumentAccess = async (): Promise<boolean> => {
    if (await hasDocumentAccess()) return true;

    const SETTINGS = tNow('perm.openSettings');
    const FOLDER = tNow('papers.chooseFolder');
    const FILES = tNow('papers.pickPdfs');

    if (apiLevel() < ANDROID_11) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
        if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
        if (result !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return false;
        const fix = await ask(
            tNow('perm.filesOffTitle'),
            withSteps(tNow('perm.filesOffBody'), [
                'onboarding.settingsStep1',
                'onboarding.photosStep2Files',
                'onboarding.photosStep3Allow',
            ]),
            SETTINGS,
        );
        if (!fix) return false;
        await openThenWait(() => Linking.openSettings());
        return hasDocumentAccess();
    }

    const canPickFolders = isPdfImportAvailable();
    // Folders picked earlier are enough: sync quietly from those.
    if (canPickFolders && (await listPdfFolders()).length > 0) return true;

    if (!(await canRequestAllFilesAccess())) {
        const choice = await choose(
            tNow('perm.pdfsPickTitle'),
            `${tNow('perm.pdfsPickBody')}\n\n${tNow('papers.shareTip')}`,
            [FILES, FOLDER],
        );
        if (choice === FOLDER) return !!(await pickPdfFolder());
        if (choice === FILES) return (await pickPdfFiles()) > 0;
        return false;
    }

    const choice = await choose(
        tNow('onboarding.filesTitle'),
        withSteps(tNow('perm.pdfsAllBody'), [
            'onboarding.settingsStep1',
            'onboarding.filesGuide1',
            'onboarding.filesGuide2',
        ]) + (canPickFolders ? `\n\n${tNow('perm.pdfsOrFolder', { button: FOLDER })}` : ''),
        canPickFolders ? [FOLDER, SETTINGS] : [SETTINGS],
    );
    if (choice === FOLDER) return !!(await pickPdfFolder());
    if (choice === SETTINGS) return openAllFilesAccessAndWait();
    return false;
};
