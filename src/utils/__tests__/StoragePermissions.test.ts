/**
 * Tests for StoragePermissions — photo and document access on Android.
 *
 * PermissionsAndroid.check / requestMultiple / request are spied per test.
 * Alerts are spied and their buttons pressed by label. AppState listeners
 * are captured so a test can simulate the user coming back from Settings.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, AppState, Linking, NativeModules, PermissionsAndroid, Platform } from 'react-native';

import {
    ensureDocumentAccess,
    ensurePhotoAccess,
    getPhotoAccess,
    hasDocumentAccess,
    hasPhotoAccess,
    requestPhotoAccess,
} from '../StoragePermissions';

jest.mock('../AppLogger', () => ({
    AppLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const P = PermissionsAndroid.PERMISSIONS;
const R = PermissionsAndroid.RESULTS;
const { StorageModule } = NativeModules;

const setPlatform = (os: 'android' | 'ios', version?: number) => {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
    Object.defineProperty(Platform, 'Version', { value: version, configurable: true, writable: true });
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let granted: Set<string>;
let requestResults: Record<string, string>;
let alertSpy: jest.SpyInstance;
let appStateHandlers: Array<(s: string) => void>;

/** Presses the alert button with this label (most recent alert). */
const press = (label: string) => {
    const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as Array<{ text: string; onPress?: () => void }>;
    const button = buttons.find((b) => b.text === label);
    if (!button) throw new Error(`No "${label}" button in ${JSON.stringify(buttons.map((b) => b.text))}`);
    button.onPress?.();
};

/** Simulates the user leaving for Settings and coming back. */
const returnToApp = () => appStateHandlers.forEach((h) => { h('background'); h('active'); });

beforeEach(() => {
    jest.clearAllMocks();
    (AsyncStorage as unknown as { __reset: () => void }).__reset();
    setPlatform('android', 34);
    granted = new Set();
    requestResults = {};
    appStateHandlers = [];

    jest.spyOn(PermissionsAndroid, 'check').mockImplementation(async (p) => granted.has(p));
    jest.spyOn(PermissionsAndroid, 'requestMultiple').mockImplementation(async (perms) => {
        const out: Record<string, string> = {};
        for (const p of perms) out[p] = requestResults[p] ?? R.DENIED;
        return out as never;
    });
    jest.spyOn(PermissionsAndroid, 'request').mockImplementation(async (p) => (requestResults[p] ?? R.DENIED) as never);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => {
        appStateHandlers.push(h);
        return { remove: jest.fn() };
    }) as never);
    (Linking.openSettings as jest.Mock).mockResolvedValue(undefined);
    (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(false);
});

afterEach(() => {
    jest.restoreAllMocks();
    setPlatform('ios', undefined);
});

describe('photo access state', () => {
    it('is full on iOS without asking Android', async () => {
        setPlatform('ios');
        expect(await getPhotoAccess()).toBe('full');
        expect(await requestPhotoAccess()).toBe('full');
        expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
    });

    it('asks for READ_MEDIA_IMAGES and partial access together on Android 14+', async () => {
        requestResults[P.READ_MEDIA_IMAGES] = R.GRANTED;
        expect(await requestPhotoAccess()).toBe('full');
        expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledWith([
            P.READ_MEDIA_IMAGES,
            P.READ_MEDIA_VISUAL_USER_SELECTED,
        ]);
    });

    it('asks only for READ_MEDIA_IMAGES on Android 13', async () => {
        setPlatform('android', 33);
        await requestPhotoAccess();
        expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledWith([P.READ_MEDIA_IMAGES]);
    });

    it('asks for READ_EXTERNAL_STORAGE on Android 12 and below', async () => {
        setPlatform('android', 32);
        requestResults[P.READ_EXTERNAL_STORAGE] = R.GRANTED;
        expect(await requestPhotoAccess()).toBe('full');
        expect(PermissionsAndroid.requestMultiple).toHaveBeenCalledWith([P.READ_EXTERNAL_STORAGE]);
    });

    it('reports "Select photos" as limited, which still counts as access', async () => {
        granted.add(P.READ_MEDIA_VISUAL_USER_SELECTED);
        expect(await getPhotoAccess()).toBe('limited');
        expect(await hasPhotoAccess()).toBe(true);
    });

    it('reports never-ask-again as blocked', async () => {
        requestResults[P.READ_MEDIA_IMAGES] = R.NEVER_ASK_AGAIN;
        requestResults[P.READ_MEDIA_VISUAL_USER_SELECTED] = R.NEVER_ASK_AGAIN;
        expect(await requestPhotoAccess()).toBe('blocked');
    });

    it('treats a failing request as denied', async () => {
        (PermissionsAndroid.requestMultiple as jest.Mock).mockRejectedValue(new Error('no activity'));
        expect(await requestPhotoAccess()).toBe('denied');
    });
});

describe('ensurePhotoAccess', () => {
    it('returns true straight away when all photos are already allowed', async () => {
        granted.add(P.READ_MEDIA_IMAGES);
        expect(await ensurePhotoAccess()).toBe(true);
        expect(PermissionsAndroid.requestMultiple).not.toHaveBeenCalled();
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('returns false without an extra alert when the user just tapped "Don\'t allow"', async () => {
        expect(await ensurePhotoAccess()).toBe(false);
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('explains limited access and keeps syncing the picked photos on "Keep my choice"', async () => {
        granted.add(P.READ_MEDIA_VISUAL_USER_SELECTED);
        const result = ensurePhotoAccess();
        await flush();
        expect(alertSpy).toHaveBeenCalledWith('Only some photos allowed', expect.stringContaining('Allow all'), expect.any(Array), expect.anything());
        press('Keep my choice');
        expect(await result).toBe(true);
        expect(Linking.openSettings).not.toHaveBeenCalled();
    });

    it('does not ask again on the next sync after "Keep my choice"', async () => {
        granted.add(P.READ_MEDIA_VISUAL_USER_SELECTED);
        const first = ensurePhotoAccess();
        await flush();
        press('Keep my choice');
        await first;
        alertSpy.mockClear();

        expect(await ensurePhotoAccess()).toBe(true);
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('sends a limited user to Settings and re-checks when they come back', async () => {
        granted.add(P.READ_MEDIA_VISUAL_USER_SELECTED);
        const result = ensurePhotoAccess();
        await flush();
        press('Open Settings');
        await flush();
        expect(Linking.openSettings).toHaveBeenCalledTimes(1);

        granted.add(P.READ_MEDIA_IMAGES);
        returnToApp();
        expect(await result).toBe(true);
    });

    it('guides a blocked user to Settings instead of doing nothing', async () => {
        requestResults[P.READ_MEDIA_IMAGES] = R.NEVER_ASK_AGAIN;
        const result = ensurePhotoAccess();
        await flush();
        expect(alertSpy).toHaveBeenCalledWith('Photos permission is off', expect.stringContaining('Open Settings'), expect.any(Array), expect.anything());
        press('Open Settings');
        await flush();
        granted.add(P.READ_MEDIA_IMAGES);
        returnToApp();
        expect(await result).toBe(true);
    });

    it('returns false when a blocked user taps "Not now"', async () => {
        requestResults[P.READ_MEDIA_IMAGES] = R.NEVER_ASK_AGAIN;
        const result = ensurePhotoAccess();
        await flush();
        press('Not now');
        expect(await result).toBe(false);
        expect(Linking.openSettings).not.toHaveBeenCalled();
    });

    it('returns false when the user comes back from Settings still blocked', async () => {
        requestResults[P.READ_MEDIA_IMAGES] = R.NEVER_ASK_AGAIN;
        const result = ensurePhotoAccess();
        await flush();
        press('Open Settings');
        await flush();
        returnToApp();
        expect(await result).toBe(false);
    });

    it('does not hang when Settings cannot be opened', async () => {
        requestResults[P.READ_MEDIA_IMAGES] = R.NEVER_ASK_AGAIN;
        (Linking.openSettings as jest.Mock).mockRejectedValue(new Error('no settings app'));
        const result = ensurePhotoAccess();
        await flush();
        press('Open Settings');
        expect(await result).toBe(false); // resolves without any AppState change
    });
});

describe('document access', () => {
    it('reads the real All Files Access state on Android 11+', async () => {
        (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(true);
        expect(await hasDocumentAccess()).toBe(true);
        (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(false);
        expect(await hasDocumentAccess()).toBe(false);
    });

    it('treats a missing or failing native check as no access', async () => {
        (StorageModule.hasAllFilesAccess as jest.Mock).mockRejectedValue(new Error('boom'));
        expect(await hasDocumentAccess()).toBe(false);
    });

    it('uses READ_EXTERNAL_STORAGE below Android 11', async () => {
        setPlatform('android', 29);
        granted.add(P.READ_EXTERNAL_STORAGE);
        expect(await hasDocumentAccess()).toBe(true);
        expect(StorageModule.hasAllFilesAccess).not.toHaveBeenCalled();
    });

    it('is always available on iOS', async () => {
        setPlatform('ios');
        expect(await hasDocumentAccess()).toBe(true);
        expect(await ensureDocumentAccess()).toBe(true);
    });

    it('does not prompt when All Files Access is already on', async () => {
        (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(true);
        expect(await ensureDocumentAccess()).toBe(true);
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('opens the All Files Access screen and resolves with the state after the user is back', async () => {
        const result = ensureDocumentAccess();
        await flush();
        expect(alertSpy).toHaveBeenCalledWith('Allow Pinpointer to find your PDFs', expect.any(String), expect.any(Array), expect.anything());
        press('Open Settings');
        await flush();
        expect(StorageModule.openAllFilesAccessSettings).toHaveBeenCalledTimes(1);

        (StorageModule.hasAllFilesAccess as jest.Mock).mockResolvedValue(true);
        returnToApp();
        expect(await result).toBe(true);
    });

    it('on Android 10 and below asks with the normal dialog first', async () => {
        setPlatform('android', 29);
        requestResults[P.READ_EXTERNAL_STORAGE] = R.GRANTED;
        expect(await ensureDocumentAccess()).toBe(true);
        expect(PermissionsAndroid.request).toHaveBeenCalledWith(P.READ_EXTERNAL_STORAGE);
        expect(alertSpy).not.toHaveBeenCalled();
    });

    it('on Android 10 and below guides a blocked user to Settings', async () => {
        setPlatform('android', 29);
        requestResults[P.READ_EXTERNAL_STORAGE] = R.NEVER_ASK_AGAIN;
        const result = ensureDocumentAccess();
        await flush();
        expect(alertSpy).toHaveBeenCalledWith('Files permission is off', expect.any(String), expect.any(Array), expect.anything());
        press('Open Settings');
        await flush();
        granted.add(P.READ_EXTERNAL_STORAGE);
        returnToApp();
        expect(await result).toBe(true);
        expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    });
});
