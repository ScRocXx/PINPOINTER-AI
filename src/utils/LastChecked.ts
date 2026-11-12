import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from './AppLogger';

/** What was checked: the photo gallery, or the PDFs. */
export type CheckedKind = 'photos' | 'papers';

/** The same keys the sync hooks always used, so saved times carry over. */
const KEYS: Record<CheckedKind, string> = {
    photos: 'gallery_last_sync_time',
    papers: 'doc_last_sync_time',
};

type Listener = (kind: CheckedKind, at: number) => void;
const listeners = new Set<Listener>();

/**
 * Remember that a check of photos or papers just finished. Called by
 * IndexingService, so the time is right whoever started the check: Home,
 * the first run, or the charging-time job.
 */
export const markChecked = async (kind: CheckedKind, at: number = Date.now()): Promise<void> => {
    listeners.forEach((listener) => {
        try {
            listener(kind, at);
        } catch (e) {
            AppLogger.warn('LastChecked', 'Listener failed', e);
        }
    });
    try {
        await AsyncStorage.setItem(KEYS[kind], String(at));
    } catch (e) {
        AppLogger.warn('LastChecked', 'Could not save the time', e);
    }
};

/** When photos or papers were last checked, or null if never. */
export const getLastChecked = async (kind: CheckedKind): Promise<number | null> => {
    try {
        const raw = await AsyncStorage.getItem(KEYS[kind]);
        const at = raw ? parseInt(raw, 10) : NaN;
        return Number.isFinite(at) ? at : null;
    } catch (e) {
        AppLogger.warn('LastChecked', 'Could not read the time', e);
        return null;
    }
};

/** Hear about every finished check. Returns an unsubscribe function. */
export const subscribeLastChecked = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
