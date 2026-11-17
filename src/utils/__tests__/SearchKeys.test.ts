import {
    SEARCH_TAIL_MARK, buildSearchTail, queryWords, searchWords, termsForQueryWord, visibleContent, withSearchTail,
    withoutOldEnrichment,
} from '../SearchKeys';
import { bhashaKey } from '../IndicText';
import { enrichHindi } from '../HindiTranslit';
import { soundex } from '../Soundex';

describe('the tail holds what used to be appended to the text', () => {
    it('keeps Soundex codes of the Latin words in the tail, never in what is shown', () => {
        const out = withSearchTail('Hello World');
        expect(visibleContent(out)).toBe('Hello World');
        expect(out.split(SEARCH_TAIL_MARK)[1].split(' ')).toEqual(expect.arrayContaining(['H400', 'W643']));
    });

    it('keeps the Hinglish and English words for Hindi in the tail', () => {
        const out = withSearchTail('कमल');
        expect(visibleContent(out)).toBe('कमल');
        expect(out.split(SEARCH_TAIL_MARK)[1].split(' ')).toEqual(expect.arrayContaining(['kamal', 'lotus', 'flower', 'K540', 'L320']));
    });

    it('builds the same keys and concepts as when the gloss was in the text', () => {
        const before = buildSearchTail(enrichHindi('आधार कार्ड')).split(' ').filter(t => /^q[kc]/.test(t));
        const now = buildSearchTail('आधार कार्ड').split(' ');
        expect(now).toEqual(expect.arrayContaining(before));
    });

    it('adds no gloss for text without Devanagari, and no codes for words with digits', () => {
        const tail = buildSearchTail('Invoice123 total').split(' ');
        expect(tail).toContain(soundex('total'));
        expect(tail).not.toContain(soundex('Invoice'));
    });
});

describe('withoutOldEnrichment', () => {
    it('removes trailing Soundex codes of the words before them', () => {
        expect(withoutOldEnrichment('Hello World H400 W643')).toBe('Hello World');
    });

    it('removes an exact Hindi gloss, with the codes, in mixed text too', () => {
        expect(withoutOldEnrichment('कमल kamal lotus flower K540 L320 F460')).toBe('कमल');
        const mixed = `${enrichHindi('आधार card नंबर')} A360 C630`;
        expect(withoutOldEnrichment(mixed)).toBe('आधार card नंबर');
    });

    it('keeps codes that are not the Soundex of a word in the text', () => {
        expect(withoutOldEnrichment('Flat B123 Tower')).toBe('Flat B123 Tower');
        expect(withoutOldEnrichment('Model A100 manual')).toBe('Model A100 manual');
    });

    it('keeps Hindi text that is not exactly an old gloss', () => {
        expect(withoutOldEnrichment('कमल kamal')).toBe('कमल kamal');
        expect(withoutOldEnrichment('कमल')).toBe('कमल');
        expect(withoutOldEnrichment('बिजली का बिल 1240')).toBe('बिजली का बिल 1240');
    });

    it('leaves new text exactly as it is, line breaks included', () => {
        expect(withoutOldEnrichment('Due date\n5 April')).toBe('Due date\n5 April');
    });
});

describe('withSearchTail / visibleContent', () => {
    it('appends keys and concepts after the invisible marker', () => {
        const out = withSearchTail('Electricity bill');
        const [body, tail] = out.split(SEARCH_TAIL_MARK);
        expect(body.trim()).toBe('Electricity bill');
        expect(tail).toContain(`qk${bhashaKey('bill')}`);
        expect(tail).toContain('qcelectricity');
        expect(tail).toContain('qcbill');
    });

    it('is idempotent', () => {
        const once = withSearchTail('बिजली का बिल');
        expect(withSearchTail(once)).toBe(once);
    });

    it('reads the title for concepts', () => {
        expect(withSearchTail('scan 001', 'Aadhaar Card')).toContain('qcaadhaar');
    });

    it('visibleContent strips the tail', () => {
        expect(visibleContent(withSearchTail('दवाई की पर्ची'))).toBe('दवाई की पर्ची');
        expect(visibleContent('no tail')).toBe('no tail');
        expect(visibleContent('')).toBe('');
        expect(visibleContent(null)).toBe('');
    });

    it('returns content unchanged when no keys can be built', () => {
        expect(withSearchTail('1234')).toBe('1234');
    });

    it('builds no tokens from numbers, so masked PII stays masked', () => {
        expect(buildSearchTail('****-****-9012 ABCDE****F')).not.toMatch(/9012/);
    });
});

describe('queryWords', () => {
    it('keeps Hindi words whole (the old ASCII filter deleted them)', () => {
        expect(queryWords('बिजली का बिल!')).toEqual(['बिजली', 'का', 'बिल']);
    });

    it('converts Indian digits and drops punctuation', () => {
        expect(queryWords('बिल २०२४?')).toEqual(['बिल', '2024']);
    });
});

describe('termsForQueryWord', () => {
    it('gives the roman form, key and concepts for a Hindi word', () => {
        const t = termsForQueryWord('दवाई');
        expect(t.roman).toBe('davaaee');
        expect(t.key).toBe(`qk${bhashaKey('dawai')}`);
        expect(t.concepts).toContain('qcmedicine');
    });

    it('has no roman form for Latin words', () => {
        expect(termsForQueryWord('bill').roman).toBeNull();
    });
});

describe('searchWords', () => {
    it('drops filler words in English, Hinglish and Hindi', () => {
        expect(searchWords('bill of the shop')).toEqual(['bill', 'shop']);
        expect(searchWords('papa ka bill')).toEqual(['papa', 'bill']);
        expect(searchWords('बिजली का बिल')).toEqual(['बिजली', 'बिल']);
    });

    it('drops a picture word that only asks for a photo', () => {
        expect(searchWords('photo of biryani')).toEqual(['biryani']);
        expect(searchWords('a picture of my dog')).toEqual(['dog']);
        expect(searchWords('biryani ki photo')).toEqual(['biryani']);
        expect(searchWords('शादी की फोटो')).toEqual(['शादी']);
    });

    it('keeps a picture word that is part of what is searched', () => {
        expect(searchWords('passport photo')).toEqual(['passport', 'photo']);
        expect(searchWords('photo')).toEqual(['photo']);
    });

    it('keeps a query made only of filler, so typing still searches', () => {
        expect(searchWords('the')).toEqual(['the']);
        expect(searchWords('photo of')).toEqual(['photo']);
        expect(searchWords('of')).toEqual(['of']);
    });
});

describe('buildSearchTail — OCR-tolerant keys', () => {
    const { buildSearchTail: tail, SEARCH_KEYS_VERSION: version } = jest.requireActual('../SearchKeys');

    it('adds shape, folded and joined keys after the sound keys and concepts', () => {
        const t: string = tail('rnedicine elec tricity');
        const tokens = t.split(' ');
        const firstTolerant = tokens.findIndex(x => /^q[vfj]/.test(x));
        expect(firstTolerant).toBeGreaterThan(0);
        expect(tokens.slice(0, firstTolerant).every(x => /^q[kc]/.test(x))).toBe(true);
        expect(tokens).toEqual(expect.arrayContaining(['qvmedldne']));
        expect(tokens.some(x => x.startsWith('qj'))).toBe(true);
    });

    it('is at version 3 (bump it with every change to the tail)', () => {
        expect(version).toBe(3);
    });
});

describe('searchWords — question words', () => {
    const { searchWords: words } = jest.requireActual('../SearchKeys');
    it('leaves out the question the answer line replies to', () => {
        expect(words('bijli bill kitna')).toEqual(['bijli', 'bill']);
        expect(words('policy kab tak')).toEqual(['policy']);
        expect(words('बिल कितना')).toEqual(['बिल']);
    });
});
