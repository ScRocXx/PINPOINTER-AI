import { CONCEPTS, clipTextForQuery, conceptsForText, conceptsForWord } from '../ConceptTable';

describe('CONCEPTS', () => {
    it('has unique lowercase a-z ids', () => {
        const ids = CONCEPTS.map(c => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
    });
});

describe('conceptsForWord', () => {
    it.each([
        ['बिजली', 'electricity'],
        ['bijli', 'electricity'],
        ['electricity', 'electricity'],
        ['दवाई', 'medicine'],
        ['dawai', 'medicine'],
        ['dawaai', 'medicine'],       // another common spelling
        ['दवाइयाँ', 'medicine'],       // plural, stemmed
        ['ওষুধ', 'medicine'],          // Bengali
        ['மருந்து', 'medicine'],      // Tamil
        ['आधार', 'aadhaar'],
        ['adhar', 'aadhaar'],
        ['रसीद', 'receipt'],
        ['बिल', 'bill'],
        ['invoice', 'bill'],
    ])('%s → %s', (word, id) => {
        expect(conceptsForWord(word)).toContain(id);
    });

    it('returns nothing for unknown words and numbers', () => {
        expect(conceptsForWord('xyzzy')).toEqual([]);
        expect(conceptsForWord('1234')).toEqual([]);
        expect(conceptsForWord('')).toEqual([]);
    });
});

describe('conceptsForText', () => {
    it('collects unique ids across words', () => {
        expect(conceptsForText(['बिजली', 'बिल', 'bill'])).toEqual(['electricity', 'bill']);
    });
});

describe('clipTextForQuery', () => {
    it('turns Hindi words into English phrases', () => {
        expect(clipTextForQuery('बिजली बिल', ['बिजली', 'बिल'])).toBe('electricity bill a bill');
    });

    it('drops Hindi words it does not know (returns null when nothing is left)', () => {
        expect(clipTextForQuery('नमस्ते', ['नमस्ते'])).toBeNull();
    });

    it('turns Hinglish spellings into English', () => {
        expect(clipTextForQuery('dawai', ['dawai'])).toBe('medicine tablets');
    });

    it('passes English and unknown Latin words through as typed', () => {
        expect(clipTextForQuery('invoice', ['invoice'])).toBe('invoice');
        expect(clipTextForQuery('red car', ['red', 'car'])).toBe('red car');
        expect(clipTextForQuery('sunset beach', ['sunset', 'beach'])).toBe('sunset beach');
    });
});
