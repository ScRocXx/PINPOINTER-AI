/**
 * HindiTranslit.test.ts — exhaustive unit tests for the deterministic
 * Devanagari → Hinglish transliterator + Hindi→English dictionary lookup.
 *
 * IMPORTANT — how this module really behaves (verified against the source):
 *  - The "2-char first" check in transliterate() operates on UTF-16 code
 *    units. Multi-code-unit keys in the source (nukta consonants written as
 *    base + U+093C, and 'अं') DO match through it.
 *  - The conjunct keys क्ष / त्र / ज्ञ are 3 code units each, so the 2-char
 *    slice can NEVER match them; they decompose instead (क्ष→"ksh",
 *    त्र→"tr", ज्ञ→"jn"). The 'gya' value for ज्ञ is unreachable dead code
 *    for standard NFC input.
 *  - The implicit 'a' after a consonant is only added in the consonant
 *    branch. A consonant at the END OF THE STRING is consumed by the
 *    2-char-first check (slice returns the single char, which is itself a
 *    key), so it gets NO implicit 'a': राम→"raam", कमल→"kamal",
 *    single क→"k". But a consonant followed by ANY other character
 *    (space, digit, Latin letter) goes through the consonant branch and
 *    drops the word-final 'a' before digits too: कमल123→"kamal123",
 *    "आधार कार्ड"→"aadhaar kaard" (the source's own doc comment says
 *    "aadhaar kaard", which is wrong).
 *  - Precomposed nukta code points (e.g. U+0958 QA) are NOT in the maps and
 *    are silently skipped as unknown Devanagari.
 */
import {
    transliterate,
    lookupEnglish,
    containsDevanagari,
    enrichHindi,
} from '../HindiTranslit';

describe('transliterate', () => {
    it('returns an empty string for empty input', () => {
        expect(transliterate('')).toBe('');
    });

    describe('independent vowels', () => {
        it.each([
            ['अ', 'a'],
            ['आ', 'aa'],
            ['इ', 'i'],
            ['ई', 'ee'],
            ['उ', 'u'],
            ['ऊ', 'oo'],
            ['ए', 'e'],
            ['ऐ', 'ai'],
            ['ओ', 'o'],
            ['औ', 'au'],
            ['ऋ', 'ri'],
        ])('maps %s → %s', (devanagari, expected) => {
            expect(transliterate(devanagari)).toBe(expected);
        });

        it('maps अं (a + anusvara, a 2-unit key) via the two-char fast path', () => {
            expect(transliterate('अं')).toBe('an');
        });
    });

    describe('consonants', () => {
        // Each consonant is followed by म so the consonant branch runs and
        // the implicit-'a' rule applies; the trailing म itself is word-final
        // and contributes just "m".
        it.each([
            ['कम', 'kam'],
            ['खम', 'kham'],
            ['गम', 'gam'],
            ['घम', 'gham'],
            ['ङम', 'ngam'],
            ['चम', 'cham'],
            ['छम', 'chham'],
            ['जम', 'jam'],
            ['झम', 'jham'],
            ['ञम', 'nam'],
            ['टम', 'tam'],
            ['ठम', 'tham'],
            ['डम', 'dam'],
            ['ढम', 'dham'],
            ['णम', 'nam'],
            ['तम', 'tam'],
            ['थम', 'tham'],
            ['दम', 'dam'],
            ['धम', 'dham'],
            ['नम', 'nam'],
            ['पम', 'pam'],
            ['फम', 'pham'],
            ['बम', 'bam'],
            ['भम', 'bham'],
            ['मम', 'mam'],
            ['यम', 'yam'],
            ['रम', 'ram'],
            ['लम', 'lam'],
            ['वम', 'vam'],
            ['शम', 'sham'],
            ['षम', 'sham'],
            ['सम', 'sam'],
            ['हम', 'ham'],
            ['ळम', 'lam'],
        ])('maps %s → %s', (devanagari, expected) => {
            expect(transliterate(devanagari)).toBe(expected);
        });
    });

    describe('matras (dependent vowel signs)', () => {
        it.each([
            ['का', 'kaa'],
            ['कि', 'ki'],
            ['की', 'kee'],
            ['कु', 'ku'],
            ['कू', 'koo'],
            ['के', 'ke'],
            ['कै', 'kai'],
            ['को', 'ko'],
            ['कौ', 'kau'],
            ['कृ', 'kri'],
        ])('maps %s → %s', (devanagari, expected) => {
            expect(transliterate(devanagari)).toBe(expected);
        });
    });

    describe('implicit-a rules', () => {
        it('adds implicit "a" after a word-internal consonant', () => {
            // doc example: "कमल" → "kamal"
            expect(transliterate('कमल')).toBe('kamal');
        });

        it('does NOT add implicit "a" to a word-final consonant', () => {
            expect(transliterate('राम')).toBe('raam');
            // doc example: "घर" → "ghar"
            expect(transliterate('घर')).toBe('ghar');
        });

        it('gives a lone consonant no implicit "a"', () => {
            expect(transliterate('क')).toBe('k');
            expect(transliterate('म')).toBe('m');
        });

        it('drops the word-final "a" before punctuation and digits too', () => {
            expect(transliterate('कमल!')).toBe('kamal!');
            expect(transliterate('कमल123')).toBe('kamal123');
        });

        it('halant suppresses the implicit "a" (explicit half-letter)', () => {
            expect(transliterate('क्')).toBe('k');
        });
    });

    describe('conjuncts', () => {
        it.each([
            ['क्ष', 'ksh'],
            ['त्र', 'tr'],
        ])('decomposes %s → %s', (devanagari, expected) => {
            expect(transliterate(devanagari)).toBe(expected);
        });

        it('says ज्ञ as "gy", the way Hindi speakers do', () => {
            expect(transliterate('ज्ञ')).toBe('gy');
        });

        it('handles conjuncts inside words', () => {
            expect(transliterate('ज्ञान')).toBe('gyaan');
            expect(transliterate('क्षमा')).toBe('kshamaa');
            expect(transliterate('स्त्री')).toBe('stree');
        });
    });

    describe('anusvara, visarga and chandrabindu', () => {
        it.each([
            ['सं', 'san'], // the consonant's own "a" comes before the anusvara's n
            ['दुःख', 'duhkh'], // visarga → h
            ['गाँव', 'gaanv'], // chandrabindu → n
            ['चाँद', 'chaand'], // chandrabindu → n
            ['हिंदी', 'hindee'], // anusvara → n
        ])('maps %s → %s', (devanagari, expected) => {
            expect(transliterate(devanagari)).toBe(expected);
        });
    });

    describe('nukta consonants (stored decomposed: base + U+093C)', () => {
        it.each([
            ['क़', 'q'],
            ['ख़', 'kh'],
            ['ग़', 'gh'],
            ['ज़', 'z'],
            ['फ़', 'f'],
            ['ड़', 'r'],
            ['ढ़', 'rh'],
            ['य़', 'y'],
        ])('maps %s → %s', (devanagari, expected) => {
            expect(transliterate(devanagari)).toBe(expected);
        });

        it('handles nukta consonants inside words', () => {
            expect(transliterate('फ़िल्म')).toBe('film');
            expect(transliterate('ज़मीन')).toBe('zameen');
            expect(transliterate('क़िला')).toBe('qilaa');
        });

        it('reads PRECOMPOSED nukta code points the same as decomposed ones', () => {
            // U+0958 DEVANAGARI LETTER QA: NFC turns it into क + ़
            expect(transliterate('\u0958')).toBe('q');
            expect(transliterate('\u0958िला')).toBe('qilaa');
        });
    });

    describe('whole words (doc examples as regression tests)', () => {
        it.each([
            ['कमल', 'kamal'],
            ['आधार', 'aadhaar'],
            ['घर', 'ghar'],
            ['नमस्ते', 'namaste'],
            ['दिल्ली', 'dillee'],
            ['पानी', 'paanee'],
            ['स्कूल', 'skool'],
            ['विद्यालय', 'vidyaalay'],
            ['ऋषि', 'rishi'],
            ['अंगूर', 'angoor'],
        ])('maps %s → %s', (devanagari, expected) => {
            expect(transliterate(devanagari)).toBe(expected);
        });
    });

    describe('passthrough and edge cases', () => {
        it('passes ASCII through unchanged', () => {
            expect(transliterate('hello')).toBe('hello');
            expect(transliterate('hello, world!')).toBe('hello, world!');
        });

        it('passes ASCII digits through unchanged', () => {
            expect(transliterate('123')).toBe('123');
        });

        it('handles mixed Hindi + ASCII', () => {
            expect(transliterate('कमल123')).toBe('kamal123');
            expect(transliterate('hello कमल')).toBe('hello kamal');
            expect(transliterate('फोन 123')).toBe('phon 123');
        });

        it('turns Indian digits into 0-9 and skips om and danda', () => {
            expect(transliterate('१२३')).toBe('123');
            expect(transliterate('ॐ')).toBe('');
            expect(transliterate('।')).toBe('');
        });

        it('collapses whitespace and trims', () => {
            expect(transliterate('कमल  घर')).toBe('kamal ghar');
            expect(transliterate('  कमल ')).toBe('kamal');
            expect(transliterate('कमल\nघर')).toBe('kamal ghar');
        });

        it('produces non-empty plain-ASCII output for Hindi input', () => {
            const words = ['कमल', 'आधार', 'नमस्ते', 'दिल्ली', 'हिंदी', 'क्षमा', 'ज्ञान', 'फ़िल्म'];
            for (const w of words) {
                const out = transliterate(w);
                expect(out.length).toBeGreaterThan(0);
                expect(out).toMatch(/^[a-z ]+$/);
            }
        });
    });
});

describe('lookupEnglish', () => {
    it('translates a single known word', () => {
        expect(lookupEnglish('कमल')).toBe('lotus flower');
    });

    it('joins translations of multiple words with spaces', () => {
        // doc example: "कमल घर" → "lotus flower home house"
        expect(lookupEnglish('कमल घर')).toBe('lotus flower home house');
    });

    it('returns an empty string for unknown words', () => {
        expect(lookupEnglish('नमस्ते')).toBe('');
    });

    it('returns an empty string for empty input', () => {
        expect(lookupEnglish('')).toBe('');
    });

    it('splits on commas', () => {
        expect(lookupEnglish('कमल, घर')).toBe('lotus flower home house');
    });

    it('splits on danda (।)', () => {
        expect(lookupEnglish('कमल। घर')).toBe('lotus flower home house');
    });

    it('skips unknown words but keeps known ones', () => {
        expect(lookupEnglish('कमल xyz')).toBe('lotus flower');
    });

    it('covers document vocabulary', () => {
        expect(lookupEnglish('आधार')).toBe('aadhaar id card');
        expect(lookupEnglish('माँ')).toBe('mother mom');
    });

    it('ignores extra whitespace', () => {
        expect(lookupEnglish('  कमल   घर  ')).toBe('lotus flower home house');
    });
});

describe('containsDevanagari', () => {
    it.each([['कमल'], ['hello कमल'], ['क'], ['१२३']])(
        'returns true for %s',
        (text) => {
            expect(containsDevanagari(text)).toBe(true);
        },
    );

    it.each([['hello'], [''], ['123'], ['!@#'], ['   ']])(
        'returns false for %s',
        (text) => {
            expect(containsDevanagari(text)).toBe(false);
        },
    );
});

describe('enrichHindi', () => {
    it('combines original + hinglish + english (doc example)', () => {
        expect(enrichHindi('कमल')).toBe('कमल kamal lotus flower');
    });

    it('enriches multi-word input, skipping dict misses (doc example)', () => {
        // "कार्ड" has no dict entry: transliterated but not translated
        expect(enrichHindi('आधार कार्ड')).toBe('आधार कार्ड aadhaar kaard aadhaar id card');
    });

    it('returns an empty string for empty input', () => {
        expect(enrichHindi('')).toBe('');
    });

    it('omits the english segment when no word is in the dictionary', () => {
        expect(enrichHindi('नमस्ते')).toBe('नमस्ते namaste');
    });

    it('passes pure ASCII through as both text and hinglish', () => {
        expect(enrichHindi('hello')).toBe('hello hello');
    });
});
