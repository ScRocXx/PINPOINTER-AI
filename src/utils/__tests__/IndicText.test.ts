import {
    asciiDigits, bhashaKey, bhashaKeysFor, containsIndic, normalizeIndic, romanize, scriptOf, tokenizeWords,
} from '../IndicText';

describe('normalizeIndic', () => {
    it('turns digits of every Indian script into 0-9', () => {
        expect(asciiDigits('१२३४ ৫৬ ௭௮ ౯')).toBe('1234 56 78 9');
        expect(normalizeIndic('आधार ४५६७ ८९०१ २३४५')).toBe('आधार 4567 8901 2345');
    });

    it('removes zero-width joiners and soft hyphens', () => {
        expect(normalizeIndic('क्‍ष')).toBe('क्ष');
        expect(normalizeIndic('bi­ll')).toBe('bill');
    });

    it('applies NFC so precomposed and decomposed nukta letters are equal', () => {
        expect(normalizeIndic('ज़')).toBe(normalizeIndic('ज़'));
    });

    it('turns danda into a space', () => {
        expect(normalizeIndic('कमल। घर')).toBe('कमल  घर');
    });

    it('returns an empty string for empty input', () => {
        expect(normalizeIndic('')).toBe('');
    });
});

describe('scriptOf / containsIndic', () => {
    it.each([
        ['क', 'deva'], ['ক', 'beng'], ['ਕ', 'guru'], ['ક', 'gujr'], ['କ', 'orya'],
        ['க', 'taml'], ['క', 'telu'], ['ಕ', 'knda'], ['ക', 'mlym'],
    ])('detects %s as %s', (ch, script) => {
        expect(scriptOf(ch.codePointAt(0) as number)).toBe(script);
    });

    it('returns null for Latin', () => {
        expect(scriptOf('k'.codePointAt(0) as number)).toBeNull();
        expect(containsIndic('bill')).toBe(false);
        expect(containsIndic('bill बिल')).toBe(true);
    });
});

describe('romanize', () => {
    it.each([
        ['कमल', 'kamal'],
        ['आधार', 'aadhaar'],
        ['घर', 'ghar'],
        ['क्षमा', 'kshamaa'],
        ['ज्ञान', 'gyaan'],
        ['स्त्री', 'stree'],
        ['बिजली', 'bijalee'],
        ['दवाई', 'davaaee'],
        ['बैंक', 'baink'],
        ['कार्ड', 'kaard'],
        ['फ़िल्म', 'film'],
        ['ज़मीन', 'zameen'],
        ['डॉक्टर', 'doktar'],
    ])('Devanagari %s → %s', (word, roman) => {
        expect(romanize(word)).toBe(roman);
    });

    it.each([
        ['বিল', 'bil'],          // Bengali
        ['ਦਵਾਈ', 'davaaee'],     // Gurmukhi
        ['દવા', 'davaa'],        // Gujarati
        ['ಬಿಲ್', 'bil'],          // Kannada (virama: no final vowel)
        ['మందు', 'mandu'],       // Telugu
        ['ବିଲ', 'bila'],         // Odia keeps the final vowel
    ])('other scripts: %s → %s', (word, roman) => {
        expect(romanize(word)).toBe(roman);
    });

    it('keeps Latin text and digits, converts Indian digits', () => {
        expect(romanize('hello कमल 123 १२३')).toBe('hello kamal 123 123');
    });

    it('treats हिंदी and हिन्दी the same', () => {
        expect(romanize('हिंदी')).toBe(romanize('हिन्दी'));
    });
});

describe('bhashaKey', () => {
    const sameKey = (...words: string[]) => {
        const keys = words.map(bhashaKey);
        expect(new Set(keys).size).toBe(1);
        expect(keys[0]).not.toBe('');
    };

    it('matches Hinglish spellings and the Devanagari word', () => {
        sameKey('dawai', 'davaai', 'dawaai', 'दवाई');
        sameKey('aadhaar', 'aadhar', 'adhar', 'आधार');
        sameKey('bijli', 'bijlee', 'बिजली');
        sameKey('raseed', 'rasid', 'रसीद');
        sameKey('parchi', 'parchee', 'पर्ची');
    });

    it('matches English loanwords with their Devanagari spelling', () => {
        sameKey('bill', 'बिल');
        sameKey('bank', 'बैंक');
        sameKey('card', 'कार्ड');
        sameKey('phone', 'फोन');
    });

    it('matches the same word across Indian scripts', () => {
        sameKey('बिल', 'বিল', 'ಬಿಲ್');
        sameKey('दवाई', 'ਦਵਾਈ');
    });

    it('ignores case', () => {
        expect(bhashaKey('BILL')).toBe(bhashaKey('bill'));
    });

    it('returns empty for digits, single letters and empty input', () => {
        expect(bhashaKey('1234')).toBe('');
        expect(bhashaKey('ABCDE1234F')).toBe('');
        expect(bhashaKey('a')).toBe('');
        expect(bhashaKey('')).toBe('');
    });

    it('keeps different words apart', () => {
        expect(bhashaKey('bill')).not.toBe(bhashaKey('bank'));
        expect(bhashaKey('bijli')).not.toBe(bhashaKey('pani'));
    });
});

describe('tokenizeWords / bhashaKeysFor', () => {
    it('keeps Indian vowel signs inside words', () => {
        expect(tokenizeWords('बिजली का बिल, 2024')).toEqual(['बिजली', 'का', 'बिल', '2024']);
    });

    it('returns unique keys in first-seen order', () => {
        expect(bhashaKeysFor('bill बिल bank')).toEqual([bhashaKey('bill'), bhashaKey('bank')]);
    });
});
