import {
    MAX_HOLD_MS,
    QUIET_AFTER_MS,
    __resetInteractionGate,
    isQuiet,
    noteInteraction,
    waitForQuiet,
} from '../InteractionGate';

beforeEach(() => {
    jest.useFakeTimers();
    __resetInteractionGate();
});

afterEach(() => {
    jest.useRealTimers();
});

describe('InteractionGate', () => {
    test('is quiet before anyone touches the screen', async () => {
        expect(isQuiet()).toBe(true);
        await expect(waitForQuiet()).resolves.toBe(0);
    });

    test('a touch makes it busy until QUIET_AFTER_MS has passed', () => {
        noteInteraction();
        expect(isQuiet()).toBe(false);
        jest.advanceTimersByTime(QUIET_AFTER_MS - 1);
        expect(isQuiet()).toBe(false);
        jest.advanceTimersByTime(1);
        expect(isQuiet()).toBe(true);
    });

    test('waits until the touching stops, then a moment more', async () => {
        noteInteraction();
        let done = false;
        const wait = waitForQuiet().then((ms) => {
            done = true;
            return ms;
        });

        // Still scrolling 500ms later: keep waiting.
        await jest.advanceTimersByTimeAsync(500);
        noteInteraction();
        await jest.advanceTimersByTimeAsync(QUIET_AFTER_MS - 50);
        expect(done).toBe(false);

        await jest.advanceTimersByTimeAsync(100);
        expect(done).toBe(true);
        await expect(wait).resolves.toBeGreaterThanOrEqual(500 + QUIET_AFTER_MS);
    });

    test('never holds longer than MAX_HOLD_MS, even under a finger that never lifts', async () => {
        noteInteraction();
        let done = false;
        const wait = waitForQuiet().then(() => {
            done = true;
        });
        for (let t = 0; t < MAX_HOLD_MS - 300; t += 200) {
            noteInteraction();
            await jest.advanceTimersByTimeAsync(200);
        }
        expect(done).toBe(false);
        for (let t = 0; t < 600 && !done; t += 100) {
            noteInteraction();
            await jest.advanceTimersByTimeAsync(100);
        }
        expect(done).toBe(true);
        await wait;
    });

    test('stops waiting soon after the job is cancelled', async () => {
        noteInteraction();
        const cancel = { current: false };
        let done = false;
        const wait = waitForQuiet(() => cancel.current).then(() => {
            done = true;
        });
        await jest.advanceTimersByTimeAsync(100);
        noteInteraction();
        cancel.current = true;
        await jest.advanceTimersByTimeAsync(260);
        expect(done).toBe(true);
        await wait;
    });
});
