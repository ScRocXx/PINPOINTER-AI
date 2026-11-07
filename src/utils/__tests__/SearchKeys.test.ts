import {
    SEARCH_TAIL_MARK, buildSearchTail, queryWords, termsForQueryWord, visibleContent, withSearchTail,
} from '../SearchKeys';
import { bhashaKey } from '../IndicText';

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
