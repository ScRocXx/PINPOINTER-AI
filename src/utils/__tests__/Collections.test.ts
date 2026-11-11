import { COLLECTIONS, collectionForQuery, getCollection } from '../Collections';
import { CONCEPTS, clipTextForQuery } from '../ConceptTable';
import { en, hi } from '../../i18n/strings';
import { queryWords } from '../SearchKeys';

describe('collectionForQuery', () => {
  test('each Home tile label names its collection, in English and Hindi', () => {
    for (const c of COLLECTIONS) {
      expect(collectionForQuery(en[c.labelKey])?.id).toBe(c.id);
      expect(collectionForQuery(hi[c.labelKey])?.id).toBe(c.id);
    }
  });

  test('ignores case, extra spaces and punctuation', () => {
    expect(collectionForQuery('  id   CARDS! ')?.id).toBe('id');
    expect(collectionForQuery('Screenshot')?.id).toBe('screenshot');
    expect(collectionForQuery('पहचान-पत्र')?.id).toBe('id');
  });

  test('only a whole query counts', () => {
    expect(collectionForQuery('bills march')).toBeNull();
    expect(collectionForQuery('my family trip')).toBeNull();
    expect(collectionForQuery('aadhaar')).toBeNull();
    expect(collectionForQuery('')).toBeNull();
    expect(collectionForQuery(undefined)).toBeNull();
  });

  test('every concept a collection uses exists in the concept table', () => {
    const known = new Set(CONCEPTS.map(c => c.id));
    for (const c of COLLECTIONS) {
      for (const id of c.concepts) expect(known).toContain(id);
    }
  });

  test('ID cards cover every ID the concept table knows', () => {
    expect(getCollection('id').concepts).toEqual(
      expect.arrayContaining(['aadhaar', 'pancard', 'voterid', 'licence', 'passport', 'ration']),
    );
  });

  test('getCollection throws for an unknown id', () => {
    expect(() => getCollection('nope' as never)).toThrow('Unknown collection');
  });
});

describe('clipTextForQuery with collections', () => {
  test('a collection name goes to CLIP as its English phrase, even in Hindi', () => {
    expect(clipTextForQuery('स्क्रीनशॉट', queryWords('स्क्रीनशॉट'))).toBe('a screenshot of a phone screen');
    expect(clipTextForQuery('परिवार', queryWords('परिवार'))).toBe('family photo');
    expect(clipTextForQuery('ID cards', queryWords('ID cards'))).toBe('identity card');
  });

  test('other queries are unchanged', () => {
    expect(clipTextForQuery('red car', queryWords('red car'))).toBe('red car');
  });
});
