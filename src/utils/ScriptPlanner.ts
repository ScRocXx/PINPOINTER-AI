/**
 * ScriptPlanner.ts — which ML Kit scripts to read a photo with.
 *
 * Reading every photo with both the Latin and the Devanagari recognizer
 * doubles the OCR work. Many galleries are almost all English; others have
 * Hindi bills, notices and chats. The planner learns which kind this gallery
 * is, on the phone, and plans each photo:
 *
 *  - learning (the first LEARN_PHOTOS photos read with Devanagari): both;
 *  - Devanagari found in at least HINDI_SHARE of them: both, always;
 *  - otherwise Latin, plus Devanagari when Latin finds less than
 *    FEW_LATIN_CHARS characters (Hindi text the Latin model can't read), and
 *    both on every CHECK_EVERY-th photo so a change in the gallery is noticed.
 *
 * The counts are kept in AsyncStorage, saved every few photos.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppLogger } from './AppLogger';

export type OcrScript = 'latin' | 'devanagari';

/** What PhotoReader.readText is asked to do for one photo. */
export interface ScriptPlan {
    scripts: OcrScript[];
    fallbackScript?: OcrScript;
    fallbackBelowChars?: number;
}

export interface ScriptStats {
    /** Photos planned so far. */
    planned: number;
    /** Photos the Devanagari recognizer read. */
    checked: number;
    /** Of those, photos with Devanagari letters in them. */
    withDevanagari: number;
}

export const LEARN_PHOTOS = 100;
export const HINDI_SHARE = 0.02;
export const CHECK_EVERY = 10;
export const FEW_LATIN_CHARS = 15;
const STATS_KEY = 'ocr_script_stats';
const SAVE_EVERY = 10;

const BOTH: ScriptPlan = { scripts: ['latin', 'devanagari'] };

/** The plan for the next photo, from what the gallery has shown so far. Pure. */
export const planFor = (stats: ScriptStats): ScriptPlan => {
    if (stats.checked < LEARN_PHOTOS) return BOTH;
    if (stats.withDevanagari / stats.checked >= HINDI_SHARE) return BOTH;
    if (stats.planned % CHECK_EVERY === 0) return BOTH;
    return { scripts: ['latin'], fallbackScript: 'devanagari', fallbackBelowChars: FEW_LATIN_CHARS };
};

const DEVANAGARI = /[ऀ-ॿ]/;

/** The counts after one photo. Pure. */
export const withResult = (stats: ScriptStats, devanagariText: string | null): ScriptStats => ({
    planned: stats.planned + 1,
    checked: stats.checked + (devanagariText === null ? 0 : 1),
    withDevanagari: stats.withDevanagari + (devanagariText !== null && DEVANAGARI.test(devanagariText) ? 1 : 0),
});

let stats: ScriptStats | null = null;
let unsaved = 0;

const load = async (): Promise<ScriptStats> => {
    if (stats) return stats;
    try {
        const raw = await AsyncStorage.getItem(STATS_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<ScriptStats>) : {};
        stats = {
            planned: Number(parsed.planned) || 0,
            checked: Number(parsed.checked) || 0,
            withDevanagari: Number(parsed.withDevanagari) || 0,
        };
    } catch (e) {
        AppLogger.warn('ScriptPlanner', 'Could not read the script counts', e);
        stats = { planned: 0, checked: 0, withDevanagari: 0 };
    }
    return stats;
};

/** The plan for the next photo. */
export const nextPlan = async (): Promise<ScriptPlan> => planFor(await load());

/** Records what the photo's Devanagari pass found (null when it didn't run). */
export const recordResult = async (devanagariText: string | null): Promise<void> => {
    stats = withResult(await load(), devanagariText);
    if (++unsaved >= SAVE_EVERY) {
        unsaved = 0;
        AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats)).catch(e =>
            AppLogger.warn('ScriptPlanner', 'Could not save the script counts', e),
        );
    }
};

/** @internal Test helper. */
export const __resetScriptPlanner = () => {
    stats = null;
    unsaved = 0;
};
