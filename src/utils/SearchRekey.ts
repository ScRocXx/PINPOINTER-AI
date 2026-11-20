/**
 * SearchRekey.ts — gives rows indexed before the current search keys the new
 * ones (SEARCH_KEYS_VERSION in SearchKeys.ts), without reading any file again.
 *
 * Each row's stored text already holds the (masked) words; only the hidden
 * search tail after them is rebuilt. Runs as IndexingService's `rekey` job:
 * small batches, each in one transaction, a pause between them, waiting while
 * someone uses the phone, and a saved place to resume from.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    beginTransaction, commitTransaction, rollbackTransaction, listContentAfter, updateDocumentContent,
} from '../database';
import { SEARCH_KEYS_VERSION, visibleContent, withSearchTail } from './SearchKeys';
import { isQuiet, waitForQuiet } from '../services/InteractionGate';
import { AppLogger } from './AppLogger';

export const SEARCH_KEYS_VERSION_KEY = 'search_keys_version';
export const SEARCH_KEYS_CURSOR_KEY = 'search_keys_cursor';
const BATCH_SIZE = 25;
const PAUSE_MS = 50;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const readNumber = async (key: string): Promise<number> => {
    try {
        const value = Number(await AsyncStorage.getItem(key));
        return Number.isFinite(value) ? value : 0;
    } catch {
        return 0;
    }
};

/** True when every row already has the current search keys. */
export const isRekeyDone = async (): Promise<boolean> =>
    (await readNumber(SEARCH_KEYS_VERSION_KEY)) >= SEARCH_KEYS_VERSION;

/** Rebuilds old search tails. Returns how many rows changed. */
export const rekeySearchTails = async (cancelRef?: { current: boolean }): Promise<number> => {
    if (await isRekeyDone()) return 0;
    let after = await readNumber(SEARCH_KEYS_CURSOR_KEY);
    let updated = 0;
    while (!cancelRef?.current) {
        if (!isQuiet()) {
            await waitForQuiet(() => !!cancelRef?.current);
            if (cancelRef?.current) break;
        }
        const rows = listContentAfter(after, BATCH_SIZE);
        if (rows.length === 0) {
            await AsyncStorage.setItem(SEARCH_KEYS_VERSION_KEY, String(SEARCH_KEYS_VERSION));
            await AsyncStorage.removeItem(SEARCH_KEYS_CURSOR_KEY);
            if (updated > 0) AppLogger.info('SearchRekey', `Search keys updated on ${updated} rows`);
            break;
        }
        beginTransaction();
        try {
            for (const row of rows) {
                const body = visibleContent(row.content);
                if (!body.trim()) continue;
                const next = withSearchTail(body, row.title);
                if (next !== row.content) {
                    updateDocumentContent(row.id, next);
                    updated++;
                }
            }
            commitTransaction();
        } catch (e) {
            rollbackTransaction();
            AppLogger.warn('SearchRekey', 'Updating search keys failed; will try again later', e);
            break;
        }
        after = rows[rows.length - 1].id;
        await AsyncStorage.setItem(SEARCH_KEYS_CURSOR_KEY, String(after));
        await sleep(PAUSE_MS);
    }
    return updated;
};
