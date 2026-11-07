import { buildIndexableContent } from '../TextEnrichment';
import { soundex, soundexAll } from '../Soundex';
import { containsDevanagari, enrichHindi } from '../HindiTranslit';

describe('buildIndexableContent — empty and non-Hindi input', () => {
    it('returns empty string for empty input', async () => {
        expect(await buildIndexableContent('')).toBe('');
    });

    it('returns empty string for whitespace-only input', async () => {
        expect(await buildIndexableContent('   ')).toBe('');
        expect(await buildIndexableContent('\n\t ')).toBe('');
    });

    it('returns a Promise', () => {
        expect(buildIndexableContent('hello')).toBeInstanceOf(Promise);
    });

    it('returns Latin-only text trimmed and unmodified (no enrichment)', async () => {
        expect(await buildIndexableContent('hello world')).toBe('hello world');
        expect(await buildIndexableContent('  hello world  ')).toBe('hello world');
    });

    it('preserves punctuation in Latin-only text', async () => {
        expect(await buildIndexableContent('Invoice #123, total Rs. 500')).toBe(
            'Invoice #123, total Rs. 500',
        );
    });
});

describe('buildIndexableContent — Hindi pipeline output', () => {
    it('enriches "कमल" into Devanagari + Hinglish + English + soundex', async () => {
        expect(await buildIndexableContent('कमल')).toBe('कमल kamal lotus flower K540 L320 F460');
    });

    it('enriches a multi-word Hindi phrase deterministically', async () => {
        expect(await buildIndexableContent('आधार कार्ड')).toBe(
            'आधार कार्ड aadhaar kaard aadhaar id card A360 K630 A360 I300 C630',
        );
    });

    it('omits the English segment when no dictionary entry exists', async () => {
        // "पुस्तक" has no HINDI_DICT entry → only Devanagari + transliteration + soundex.
        expect(await buildIndexableContent('पुस्तक')).toBe('पुस्तक pustak P232');
    });

    it('handles mixed Hindi + Latin input', async () => {
        expect(await buildIndexableContent('कमल hello')).toBe(
            'कमल hello kamal hello lotus flower H400 K540 H400 L320 F460',
        );
    });

    it('does not crash on Devanagari punctuation with no translatable content', async () => {
        expect(await buildIndexableContent('।')).toBe('।');
    });
});

describe('buildIndexableContent — signal composition', () => {
    it('contains all four index signals for Hindi text', async () => {
        const out = await buildIndexableContent('कमल');
        expect(containsDevanagari(out)).toBe(true); // Part 1: original Devanagari
        expect(out).toContain('kamal'); // Part 2: Hinglish transliteration
        expect(out).toContain('lotus flower'); // Part 3: English dictionary keywords
        expect(out).toContain('K540'); // Part 4: soundex phonetic codes
    });

    it('appends soundex codes computed from the Latin part of the enrichment', async () => {
        const raw = 'आधार कार्ड';
        const enriched = enrichHindi(raw);
        // Strip Devanagari exactly the way the pipeline does.
        const latinPart = enriched.replace(/[\u0900-\u097F]/g, '').trim();
        const expectedCodes = soundexAll(latinPart).join(' ');

        const out = await buildIndexableContent(raw);
        expect(out.startsWith(enriched)).toBe(true);
        expect(out.endsWith(expectedCodes)).toBe(true);
        expect(expectedCodes.length).toBeGreaterThan(0);
    });

    it('is typo-tolerant: a misspelled transliteration maps to an indexed code', async () => {
        const out = await buildIndexableContent('कमल');
        // "kammal" is a plausible OCR/typing variant of "kamal".
        expect(soundex('kammal')).toBe(soundex('kamal'));
        expect(out).toContain(soundex('kammal'));
    });

    it('trims the final output (no leading/trailing whitespace)', async () => {
        const out = await buildIndexableContent('  कमल  ');
        expect(out).toBe(out.trim());
        expect(out.length).toBeGreaterThan(0);
    });
});
