import {
    FOLD_PREFIX, JOIN_PREFIX, SHAPE_PREFIX,
    foldSoundKey, foldedSoundKey, joinedNeighbourKeys, looksLikeMisreadOf, matraDrops, shapeKey,
    tolerantTermsForQueryWord, toleranceTokens,
} from '../OcrTolerance';
import { bhashaKey } from '../IndicText';

describe('shapeKey: how a word looks', () => {
    it('makes look-alike Devanagari letters one', () => {
        expect(shapeKey('मुगतान')).toBe(shapeKey('भुगतान'));
        expect(shapeKey('विल')).toBe(shapeKey('बिल'));
        expect(shapeKey('धर')).toBe(shapeKey('घर'));
        expect(shapeKey('रिपोत')).toBe(shapeKey('रिपोट'));
    });

    it('folds vowel length and leaves out the marks OCR drops', () => {
        expect(shapeKey('बिजलि')).toBe(shapeKey('बिजली'));
        expect(shapeKey('सख्या')).toBe(shapeKey('संख्या'));
        expect(shapeKey('जमीन')).toBe(shapeKey('ज़मीन'));
        expect(shapeKey('ज़मीन')).toBe(shapeKey('जज़मीन'.replace('जज़', 'ज़'))); // precomposed za
        expect(shapeKey('परमाण')).toBe(shapeKey('प्रमाण'.replace('्', ''))); // broken conjunct
        expect(shapeKey('प्रमाण')).toBe(shapeKey('परमाण'.replace('रम', 'र्म').replace('र्म', 'रम')));
    });

    it('reads ra + va as kha', () => {
        expect(shapeKey('रवपत')).toBe(shapeKey('खपत'));
    });

    it('makes Latin look-alikes one', () => {
        expect(shapeKey('rnedicine')).toBe(shapeKey('medicine'));
        expect(shapeKey('bi11')).toBe(shapeKey('bill'));
        expect(shapeKey('BiIl')).toBe(shapeKey('bill'));
        expect(shapeKey('0range')).toBe(shapeKey('orange'));
        expect(shapeKey('c1ass')).toBe(shapeKey('class'));
        expect(shapeKey('vvater')).toBe(shapeKey('water'));
    });

    it('keeps words that only look alike to OCR apart from real differences', () => {
        expect(shapeKey('बिल')).not.toBe(shapeKey('दिल'));
        expect(shapeKey('bill')).not.toBe(shapeKey('ball'));
    });

    it('gives no key to numbers, Soundex codes, single letters or empty input', () => {
        expect(shapeKey('1240')).toBe('');
        expect(shapeKey('B234')).toBe('');
        expect(shapeKey('a')).toBe('');
        expect(shapeKey('')).toBe('');
    });
});

describe('foldedSoundKey: script-free and OCR-tolerant', () => {
    it('matches a Hinglish query to a misread Hindi word', () => {
        expect(foldedSoundKey('bhugtan')).toBe(foldedSoundKey('मुगतान'));
        expect(foldedSoundKey('bhugtan')).toBe(foldedSoundKey('भुगतान'));
    });

    it('folds b/v/m, g/d and a dropped nasal', () => {
        expect(foldSoundKey('vil')).toBe('bil');
        expect(foldSoundKey('mil')).toBe('bil');
        expect(foldSoundKey('gr')).toBe('dr');
        expect(foldSoundKey('snky')).toBe(foldSoundKey('sky'));
    });

    it('is empty for words too short to be safe', () => {
        expect(foldedSoundKey('का')).toBe('');
        expect(foldedSoundKey('')).toBe('');
    });
});

describe('matraDrops', () => {
    it('leaves out one vowel sign at a time', () => {
        expect(matraDrops('बिजली').sort()).toEqual(['बजली', 'बिजल'].sort());
        expect(matraDrops('बल')).toEqual([]);
    });
});

describe('joinedNeighbourKeys: words OCR split in two', () => {
    it('joins a split word', () => {
        expect(joinedNeighbourKeys(['elec', 'tricity'])).toContain(bhashaKey('electricity'));
        expect(joinedNeighbourKeys(['बिज', 'ली'])).toContain(bhashaKey('बिजली'));
    });

    it('does not join two long real words, mixed scripts or numbers', () => {
        expect(joinedNeighbourKeys(['electricity', 'department'])).toEqual([]);
        expect(joinedNeighbourKeys(['bill', 'बिल'])).toEqual([]);
        expect(joinedNeighbourKeys(['no', '1240'])).toEqual([]);
    });
});

describe('toleranceTokens: the extra tail tokens', () => {
    it('stores shape, folded and joined keys with their prefixes, once each', () => {
        const tokens = toleranceTokens(['मुगतान', 'मुगतान', 'विल', 'rnedicine', 'elec', 'tricity']);
        expect(tokens).toContain(SHAPE_PREFIX + shapeKey('विल'));
        expect(tokens).toContain(SHAPE_PREFIX + shapeKey('rnedicine'));
        expect(tokens).toContain(FOLD_PREFIX + foldedSoundKey('मुगतान'));
        expect(tokens).toContain(JOIN_PREFIX + bhashaKey('electricity'));
        expect(new Set(tokens).size).toBe(tokens.length);
    });

    it('adds nothing for a word whose keys are the word itself', () => {
        expect(toleranceTokens(['art'])).toEqual([]);
        // मुगतान is its own shape key: the query finds it as a plain word.
        expect(toleranceTokens(['मुगतान']).some(t => t.startsWith(SHAPE_PREFIX))).toBe(false);
        expect(tolerantTermsForQueryWord('भुगतान').shapes).toContain('मुगतान');
    });
});

describe('tolerantTermsForQueryWord', () => {
    it('gives shape keys with each vowel sign left out, the folded key, and the joined key', () => {
        const t = tolerantTermsForQueryWord('बिजली');
        expect(t.shapes).toContain(SHAPE_PREFIX + shapeKey('बिजली'));
        expect(t.shapes).toContain(SHAPE_PREFIX + shapeKey('बजली'));
        expect(t.shapes).toContain(shapeKey('बजली'));
        expect(t.folded).toEqual([FOLD_PREFIX + foldedSoundKey('बिजली'), `qk${foldedSoundKey('बिजली')}`]);
        expect(t.joined).toEqual([JOIN_PREFIX + bhashaKey('बिजली')]);
    });

    it('has nothing to add for very short words', () => {
        expect(tolerantTermsForQueryWord('a')).toEqual({ shapes: [], folded: [], joined: [] });
    });
});

describe('looksLikeMisreadOf', () => {
    it('recognises misreadings, and only those', () => {
        expect(looksLikeMisreadOf('rnedicine', 'medicine')).toBe(true);
        expect(looksLikeMisreadOf('मुगतान', 'भुगतान')).toBe(true);
        expect(looksLikeMisreadOf('बजली', 'बिजली')).toBe(true);
        expect(looksLikeMisreadOf('मुगतान', 'bhugtan')).toBe(true);
        expect(looksLikeMisreadOf('ticket', 'medicine')).toBe(false);
    });
});
