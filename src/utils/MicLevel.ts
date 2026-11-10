/**
 * MicLevel.ts — the real microphone level while voice search listens.
 *
 * SherpaOnnxModule sends "onSpeechVolume" ({ level: 0..1 }) about 16 times a
 * second while recording. The meter and the silence check subscribe here
 * directly, so the level never goes through React state (that would redraw
 * every screen on the shared context many times a second).
 */
import { NativeEventEmitter, NativeModules } from 'react-native';

export const MIC_LEVEL_EVENT = 'onSpeechVolume';

/** Above this the person is speaking; below it is room noise. */
export const SPEECH_LEVEL = 0.35;
/** Stop this long after the person stops speaking. */
export const SILENCE_MS = 1600;
/** Never record longer than this (a search is a few words). */
export const MAX_LISTEN_MS = 12000;
/** If nothing is said at all, give up after this. */
export const NO_SPEECH_MS = 6000;

const clamp01 = (n: unknown): number => {
    const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
    return Math.min(1, Math.max(0, v));
};

let emitter: NativeEventEmitter | null = null;
const getEmitter = (): NativeEventEmitter | null => {
    if (emitter) return emitter;
    const mod = NativeModules.SherpaOnnxModule;
    if (!mod) return null;
    emitter = new NativeEventEmitter(mod);
    return emitter;
};

/** Listen to the live level (0..1). Returns a function that stops listening. */
export const subscribeMicLevel = (onLevel: (level: number) => void): (() => void) => {
    const em = getEmitter();
    if (!em) return () => {};
    const sub = em.addListener(MIC_LEVEL_EVENT, (e: { level?: number } | undefined) => onLevel(clamp01(e?.level)));
    return () => sub.remove();
};

/** What listening should do after a reading: keep going, stop and read the words, or give up. */
export type ListenVerdict = 'listen' | 'stop' | 'cancel';

export interface SilenceDetector {
    /** Feed one level reading (0..1) and its time. */
    push: (level: number, now?: number) => ListenVerdict;
    /** Whether any speech was heard yet. */
    heardSpeech: () => boolean;
}

/**
 * Decides when listening ends on its own, so people don't have to find the
 * stop button: a pause after speaking means "stop" (read the words), nothing
 * said at all means "cancel" (Whisper would only invent words from silence),
 * and the time limit stops it. Tapping stop still works any time.
 */
export const createSilenceDetector = (
    startedAt: number,
    {
        speechLevel = SPEECH_LEVEL,
        silenceMs = SILENCE_MS,
        maxMs = MAX_LISTEN_MS,
        noSpeechMs = NO_SPEECH_MS,
    }: Partial<{ speechLevel: number; silenceMs: number; maxMs: number; noSpeechMs: number }> = {},
): SilenceDetector => {
    let heard = false;
    let lastLoudAt = startedAt;
    return {
        push: (level, now = Date.now()) => {
            if (level >= speechLevel) {
                heard = true;
                lastLoudAt = now;
            }
            if (heard) {
                return now - lastLoudAt >= silenceMs || now - startedAt >= maxMs ? 'stop' : 'listen';
            }
            return now - startedAt >= noSpeechMs ? 'cancel' : 'listen';
        },
        heardSpeech: () => heard,
    };
};
