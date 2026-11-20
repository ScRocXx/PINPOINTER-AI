/**
 * InteractionGate — indexing steps aside while someone is using the phone.
 *
 * On a 4-core phone, reading a photo (ML Kit on two threads, CLIP on two
 * more, the resize, and the database writes on the JS thread) takes every
 * core the UI needs. Scrolling the grid or typing a search while that runs
 * is what feels laggy. So the indexing loops check this gate before each
 * file: while the person is touching, scrolling or typing, and for a short
 * moment after, the next file waits. The file already being read finishes.
 *
 * It never waits longer than MAX_HOLD_MS in one go, so a finger resting on
 * the screen can slow indexing down but not stop it. The charging-time job
 * runs with the screen off, where nothing touches the gate.
 *
 * Plain TypeScript, no React. The app's root view and the main lists report
 * touches and scrolls with noteInteraction(); search reports typing.
 *
 * Loops call it as `if (!isQuiet()) await waitForQuiet(...)`, so the usual
 * case (nobody touching) adds no await at all.
 */

/** Indexing waits this long after the last touch, scroll or key. */
export const QUIET_AFTER_MS = 700;

/** The longest one wait lasts; after it, one more file is read regardless. */
export const MAX_HOLD_MS = 6000;

let lastInteraction = Number.NEGATIVE_INFINITY;

/** Someone touched, scrolled or typed just now. Cheap: safe to call on every move. */
export const noteInteraction = (): void => {
    lastInteraction = Date.now();
};

/** True when nobody has touched the screen for QUIET_AFTER_MS. */
export const isQuiet = (): boolean => Date.now() - lastInteraction >= QUIET_AFTER_MS;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves once nobody has touched the screen for QUIET_AFTER_MS, after at
 * most MAX_HOLD_MS, or as soon as `isCancelled` says the job was stopped.
 * Returns how long it waited (0 when it was already quiet).
 */
export const waitForQuiet = async (isCancelled?: () => boolean): Promise<number> => {
    const started = Date.now();
    while (!isQuiet() && !isCancelled?.()) {
        const held = Date.now() - started;
        if (held >= MAX_HOLD_MS) break;
        const untilQuiet = QUIET_AFTER_MS - (Date.now() - lastInteraction);
        // Wake at least every 250ms, so a cancel is noticed quickly.
        await sleep(Math.max(16, Math.min(untilQuiet, 250, MAX_HOLD_MS - held)));
    }
    return Date.now() - started;
};

/** @internal Test helper. */
export const __resetInteractionGate = (): void => {
    lastInteraction = Number.NEGATIVE_INFINITY;
};
