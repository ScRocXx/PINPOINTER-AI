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
 * Resolves on the next time the app returns to the foreground. Used after
 * sending the user to a Settings screen.
 */
const waitForReturn = (): Promise<void> => new Promise((resolve) => {
    let left = false;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state !== 'active') {
            left = true;
        } else if (left) {
            sub.remove();
            resolve();
        }
    });
});

/** Runs `open` (which leaves the app) and resolves once the user is back. */
const openThenWait = async (open: () => unknown): Promise<void> => {
    const back = waitForReturn();
    try {
        await open();
    } catch (e) {
        AppLogger.warn('StoragePermissions', 'Could not open Settings', e);
        return; // nothing was opened, so don't wait for a return that won't come
    }
    await back;
};

/** Opens this app's page in Settings and resolves with the photo access once the user is back. */
export const openAppSettingsAndWait = async (): Promise<PhotoAccess> => {
    await openThenWait(() => Linking.openSettings());
    return getPhotoAccess();
};

/** Alert with a Cancel and a primary button; resolves true if the primary button was tapped. */
const ask = (title: string, message: string, primary: string, cancel = 'Not now'): Promise<boolean> =>
    new Promise((resolve) => {
        Alert.alert(title, message, [
            { text: cancel, style: 'cancel', onPress: () => resolve(false) },
            { text: primary, onPress: () => resolve(true) },
        ], { cancelable: true, onDismiss: () => resolve(false) });
    });

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
            'Only some photos allowed',
            'Pinpointer can only search the photos you picked.\n\n' +
            'To search all your photos:\n1. Tap "Open Settings"\n2. Tap "Permissions", then "Photos and videos"\n3. Choose "Allow all"',
            'Open Settings',
            'Keep my choice',
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
            'Photos permission is off',
            'To find your photos, Pinpointer needs permission to see them. Your photos never leave this phone.\n\n' +
            '1. Tap "Open Settings"\n2. Tap "Permissions", then "Photos and videos"\n3. Choose "Allow all"',
            'Open Settings',
        );
        if (!fix) return false;
        access = await openAppSettingsAndWait();
        return access === 'full' || access === 'limited';
    }

    return false; // 'denied': the user just said no in the system dialog
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
 * Makes sure Pinpointer can read PDFs, explaining the "All files access"
 * toggle in plain steps. Resolves true when the document scan may run.
 */
export const ensureDocumentAccess = async (): Promise<boolean> => {
    if (await hasDocumentAccess()) return true;

    if (apiLevel() < ANDROID_11) {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE);
        if (result === PermissionsAndroid.RESULTS.GRANTED) return true;
        if (result !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return false;
        const fix = await ask(
            'Files permission is off',
            'To find your PDFs, Pinpointer needs permission to read files. Your files never leave this phone.\n\n' +
            '1. Tap "Open Settings"\n2. Tap "Permissions", then "Files and media"\n3. Choose "Allow"',
            'Open Settings',
        );
        if (!fix) return false;
        await openThenWait(() => Linking.openSettings());
        return hasDocumentAccess();
    }

    const fix = await ask(
        'Allow Pinpointer to find your PDFs',
        'Pinpointer searches the PDFs on this phone (for example in Downloads). They never leave the phone.\n\n' +
        '1. Tap "Open Settings"\n2. Turn on the switch next to "Allow access to manage all files"\n3. Press Back to return here',
        'Open Settings',
    );
    if (!fix) return false;
    return openAllFilesAccessAndWait();
};
