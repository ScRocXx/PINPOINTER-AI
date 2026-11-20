import { buildVocabulary, correctionsFor, editDistanceWithin, isKnownWord } from '../SpellingRescue';
import { bhashaKey } from '../IndicText';

const vocab = buildVocabulary([
    { term: 'medicine', docs: 12 },
    { term: 'medicines', docs: 2 },
    { term: 'bill', docs: 30 },
    { term: 'ball', docs: 1 },
    { term: 'बिजली', docs: 8 },
    { term: `qk${bhashaKey('बिजली')}`, docs: 8 },
    { term: `qk${bhashaKey('bill')}`, docs: 30 },
    { term: 'qcmedicine', docs: 12 },
    { term: 'qvmedldne', docs: 3 },
    { term: '1240', docs: 4 },
    { term: 'telmisartan', docs: 1 },
]);

describe('buildVocabulary', () => {
    it('keeps words and sound keys, and drops other tail tokens and numbers', () => {
        expect([...vocab.words.keys()].sort()).toEqual(['ball', 'bill', 'medicine', 'medicines', 'telmisartan', 'बिजली'].sort());
        expect(vocab.keys.has(bhashaKey('बिजली'))).toBe(true);
        expect(vocab.wordsByLength.get(4)?.sort()).toEqual(['ball', 'bill']);
    });
});

describe('editDistanceWithin', () => {
    it('counts inserts, deletes, changes and swapped neighbours', () => {
        expect(editDistanceWithin('bill', 'bill', 2)).toBe(0);
        expect(editDistanceWithin('bil', 'bill', 2)).toBe(1);
        expect(editDistanceWithin('bikl', 'bill', 2)).toBe(1);
        expect(editDistanceWithin('bilk', 'blik', 2)).toBe(1);
        expect(editDistanceWithin('medcine', 'medicine', 2)).toBe(1);
    });

    it('stops early once it is past the limit', () => {
        expect(editDistanceWithin('ticket', 'medicine', 2)).toBe(3);
        expect(editDistanceWithin('ab', 'abcdef', 2)).toBe(3);
    });
});

describe('correctionsFor', () => {
    it('corrects a typo to a word in the person\'s own papers', () => {
        expect(correctionsFor('medicne', vocab)[0]).toMatchObject({ via: 'spelling', word: 'medicine', distance: 1 });
        expect(correctionsFor('telmisartn', vocab)[0]).toMatchObject({ word: 'telmisartan' });
    });

    it('prefers the closer word, then the more common one', () => {
        expect(correctionsFor('bilk', vocab)[0].word).toBe('bill');
    });

    it('corrects a Hinglish typo by sound to a Hindi word', () => {
        const best = correctionsFor('bijki', vocab)[0];
        expect(best).toMatchObject({ via: 'sound', key: bhashaKey('बिजली') });
    });

    it('leaves words that search already finds, short words and unknown far words alone', () => {
        expect(correctionsFor('bill', vocab)).toEqual([]);
        expect(correctionsFor('bijli', vocab)).toEqual([]); // same sound as बिजली
        expect(isKnownWord('BILL', vocab)).toBe(true);
        expect(correctionsFor('bl', vocab)).toEqual([]);
        expect(correctionsFor('xyzzyq', vocab)).toEqual([]);
    });

    it('keeps scripts apart for spelling corrections', () => {
        expect(correctionsFor('बिजलो', vocab).every(c => c.via === 'sound' || c.word === 'बिजली')).toBe(true);
        expect(correctionsFor('bijlo', vocab).some(c => c.word === 'बिजली')).toBe(false);
    });
});
