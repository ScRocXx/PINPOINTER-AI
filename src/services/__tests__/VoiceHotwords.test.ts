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
  MAX_HOTWORDS,
  REFRESH_AFTER_MS,
  __resetVoiceHotwords,
  hotwordsFrom,
  refreshHotwords,
  refreshHotwordsIfStale,
} from '../VoiceHotwords';
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

describe('hotwordsFrom', () => {
  test('Devanagari words in two papers or more, three letters or more, most common first', () => {
    expect(hotwordsFrom([
      { term: 'बीएसईएस', docs: 9 },
      { term: 'bses', docs: 9 },          // another script: the Hindi model writes Devanagari
      { term: 'बिल', docs: 8 },           // two letters (ि is a sign)
      { term: 'qkbjl', docs: 7 },         // a search key, not a word
      { term: 'अपोलो', docs: 5 },
      { term: '१२३४', docs: 5 },          // digits
      { term: 'रमेश', docs: 1 },          // one paper: maybe an OCR misreading
      { term: 'अपोलो', docs: 4 },         // once
    ])).toEqual(['बीएसईएस', 'अपोलो']);
  });

  test('at most MAX_HOTWORDS', () => {
    const many = Array.from({ length: MAX_HOTWORDS + 50 }, (_, i) => ({ term: `कमल${'क'.repeat(i % 7)}${String.fromCharCode(0x915 + (i % 30))}${i}`.replace(/\d/g, ''), docs: 3 }));
    expect(hotwordsFrom(many).length).toBeLessThanOrEqual(MAX_HOTWORDS);
  });
});

describe('refreshHotwords', () => {
  test('reads the person\'s own Hindi words and gives them to the Hindi model', async () => {
    indexDocument(null, 'बीएसईएस बिजली बिल राशि', '/p/1.jpg', 'IMAGE', 'TEXT');
    indexDocument(null, 'बीएसईएस बिजली बिल', '/p/2.jpg', 'IMAGE', 'TEXT');
    indexDocument(null, 'रमेश अपोलो', '/p/3.jpg', 'IMAGE', 'TEXT');
    expect(await refreshHotwords()).toBe(2);
    expect(setHotwords).toHaveBeenCalledWith(['बिजली', 'बीएसईएस']);
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
