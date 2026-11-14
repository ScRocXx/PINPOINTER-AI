import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    CHECK_EVERY, FEW_LATIN_CHARS, LEARN_PHOTOS, __resetScriptPlanner, nextPlan, planFor, recordResult, withResult,
} from '../ScriptPlanner';

const BOTH = { scripts: ['latin', 'devanagari'] };
const LATIN_FIRST = { scripts: ['latin'], fallbackScript: 'devanagari', fallbackBelowChars: FEW_LATIN_CHARS };

describe('planFor', () => {
    it('reads with both while it learns the gallery', () => {
        expect(planFor({ planned: 5, checked: 5, withDevanagari: 0 })).toEqual(BOTH);
    });

    it('keeps both for a gallery with Hindi in it', () => {
        expect(planFor({ planned: 301, checked: 200, withDevanagari: 10 })).toEqual(BOTH);
    });

    it('reads an English gallery with Latin, Devanagari only when Latin finds little', () => {
        expect(planFor({ planned: 301, checked: 200, withDevanagari: 1 })).toEqual(LATIN_FIRST);
    });

    it('still checks with both every so often', () => {
        expect(planFor({ planned: 300, checked: 200, withDevanagari: 1 })).toEqual(BOTH);
        expect(300 % CHECK_EVERY).toBe(0);
    });
});

describe('withResult', () => {
    it('counts photos, Devanagari passes, and Devanagari found', () => {
        let s = { planned: 0, checked: 0, withDevanagari: 0 };
        s = withResult(s, 'बिजली बिल');
        s = withResult(s, 'electricity bill');
        s = withResult(s, null);
        expect(s).toEqual({ planned: 3, checked: 2, withDevanagari: 1 });
    });
});

describe('nextPlan / recordResult', () => {
    beforeEach(async () => {
        __resetScriptPlanner();
        await AsyncStorage.clear();
    });

    it('learns from the photos it reads, and saves every few photos', async () => {
        await expect(nextPlan()).resolves.toEqual(BOTH);
        for (let i = 0; i < LEARN_PHOTOS; i++) await recordResult('only english words');
        // Planned 100: a check photo; the next one is read with Latin first.
        await recordResult(null);
        await expect(nextPlan()).resolves.toEqual(LATIN_FIRST);
        const saved = JSON.parse((await AsyncStorage.getItem('ocr_script_stats')) ?? '{}');
        expect(saved.checked).toBe(LEARN_PHOTOS);

        // A fresh start reads the saved counts (saved at 100 planned: a check photo).
        __resetScriptPlanner();
        await expect(nextPlan()).resolves.toEqual(planFor(saved));
        await expect(nextPlan()).resolves.toEqual(BOTH);
    });
});
