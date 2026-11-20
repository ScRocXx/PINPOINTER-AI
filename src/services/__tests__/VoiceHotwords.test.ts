/**
 * VoiceHotwords: the Hindi words of the person's own papers, chosen from the
 * real index (fts5vocab in the in-memory database mock) and handed to the
 * Hindi speech model.
 */
import { NativeModules } from 'react-native';
import * as connection from '../../database/connection';
import { indexDocument } from '../../database/documents';
import { __resetVocabularyTable } from '../../database/vocabulary';
import {
  MAX_OWN_HOTWORDS,
  REFRESH_AFTER_MS,
  __resetVoiceHotwords,
  hotwordsFrom,
  refreshHotwords,
  refreshHotwordsIfStale,
  seedHotwords,
} from '../VoiceHotwords';
import { bhashaKey } from '../../utils/IndicText';
// Test-only export of __mocks__/op-sqlite.js (declared in database/__tests__/search.test.ts).
import { __resetAll } from '@op-engineering/op-sqlite';

const setHotwords = NativeModules.SherpaOnnxModule.setHotwords as jest.Mock;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  __resetAll();
  connection.closeDatabase();
  connection.setupDatabase();
  __resetVocabularyTable();
  __resetVoiceHotwords();
  setHotwords.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('seedHotwords (built-in words)', () => {
  const seeds = seedHotwords();

  test('the words people search for, as single Devanagari words', () => {
    expect(seeds).toEqual(expect.arrayContaining(['आधार', 'गैस', 'वोटर', 'पर्ची', 'दवाई', 'बिजली', 'कार्ड', 'पॉलिसी', 'दिवाली', 'राखी']));
    expect(seeds.every(w => /^[\u0900-\u0963\u0971-\u097F]+$/.test(w))).toBe(true);
  });

  test('no spelling doubles, and few enough to leave room for the person\'s own words', () => {
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(seeds).toContain('फोन');
    expect(seeds).not.toContain('फ़ोन');
    expect(seeds).not.toContain('जाँच');
    expect(seeds.length).toBeGreaterThan(80);
    expect(seeds.length + MAX_OWN_HOTWORDS).toBeLessThanOrEqual(210);
  });

  test('is built once', () => {
    expect(seedHotwords()).toBe(seeds);
  });
});

describe('hotwordsFrom (the person\'s own words)', () => {
  test('Devanagari words in two papers or more, three letters or more, most common first', () => {
    expect(hotwordsFrom([
      { term: 'बीएसईएस', docs: 9 },
      { term: 'bses', docs: 9 },          // another script: the Hindi model writes Devanagari
      { term: 'जल', docs: 8 },            // two letters
      { term: 'qkbjl', docs: 7 },         // a search key, not a word
      { term: 'अपोलो', docs: 5 },
      { term: '१२३४', docs: 5 },          // digits
      { term: 'रमेश', docs: 1 },          // one paper: maybe an OCR misreading
      { term: 'अपोलो', docs: 4 },         // once
    ])).toEqual(['बीएसईएस', 'अपोलो']);
  });

  test('a common word is left to the built-in list (a strong boost on it does harm)', () => {
    const own = hotwordsFrom([
      { term: 'आधार', docs: 9 },
      { term: 'बिजलि', docs: 6 },         // sounds like the built-in बिजली
      { term: 'एलआईसी', docs: 5 },
    ]);
    expect(own).toEqual(['एलआईसी']);
    expect(bhashaKey('बिजलि')).toBe(bhashaKey('बिजली'));
  });

  test('at most MAX_OWN_HOTWORDS', () => {
    const letters = 'कखगघचछजझटठडढतथदधनपफबभमयरलवशसह';
    const many = Array.from({ length: MAX_OWN_HOTWORDS + 50 }, (_, i) => ({
      term: `ज्ञ${letters[i % 29]}${letters[Math.floor(i / 29) % 29]}${letters[(i * 7) % 29]}ऋ`,
      docs: 3,
    }));
    expect(hotwordsFrom(many).length).toBeLessThanOrEqual(MAX_OWN_HOTWORDS);
    expect(hotwordsFrom(many).length).toBeGreaterThan(MAX_OWN_HOTWORDS / 2);
  });
});

describe('refreshHotwords', () => {
  test('gives the Hindi model the person\'s own words and the built-in ones, apart', async () => {
    indexDocument(null, 'बीएसईएस बिजली बिल राशि', '/p/1.jpg', 'IMAGE', 'TEXT');
    indexDocument(null, 'बीएसईएस बिजली बिल', '/p/2.jpg', 'IMAGE', 'TEXT');
    indexDocument(null, 'रमेश अपोलो', '/p/3.jpg', 'IMAGE', 'TEXT');
    expect(await refreshHotwords()).toBe(1 + seedHotwords().length);
    // बिजली is in two papers too, but it is a built-in word.
    expect(setHotwords).toHaveBeenCalledWith(['बीएसईएस'], seedHotwords());
  });

  test('a new phone still gets the built-in words', async () => {
    expect(await refreshHotwords()).toBe(seedHotwords().length);
    expect(setHotwords).toHaveBeenCalledWith([], seedHotwords());
  });

  test('at most once in REFRESH_AFTER_MS when asked again and again', async () => {
    indexDocument(null, 'बीएसईएस बिजली', '/p/1.jpg', 'IMAGE', 'TEXT');
    indexDocument(null, 'बीएसईएस बिजली', '/p/2.jpg', 'IMAGE', 'TEXT');
    refreshHotwordsIfStale(1_000);
    refreshHotwordsIfStale(2_000);
    await new Promise(r => setImmediate(r));
    expect(setHotwords).toHaveBeenCalledTimes(1);
    refreshHotwordsIfStale(1_000 + REFRESH_AFTER_MS);
    await new Promise(r => setImmediate(r));
    expect(setHotwords).toHaveBeenCalledTimes(2);
  });

  test('a failure is logged, not thrown', async () => {
    setHotwords.mockRejectedValueOnce(new Error('no model'));
    expect(() => refreshHotwordsIfStale(5)).not.toThrow();
    await new Promise(r => setImmediate(r));
  });
});
