/**
 * SpellingService end to end on the in-memory database: the vocabulary comes
 * from the real index (fts5vocab in the mock), corrections from the person's
 * own words.
 */
import * as connection from '../../database/connection';
import { indexDocument } from '../../database/documents';
import { __resetVocabularyTable } from '../../database/vocabulary';
import * as vocabulary from '../../database/vocabulary';
import { IDLE_DROP_MS, __resetSpelling, rescueQuery } from '../SpellingService';
// Test-only export of __mocks__/op-sqlite.js (declared in database/__tests__/search.test.ts).
import { __resetAll } from '@op-engineering/op-sqlite';

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    __resetAll();
    connection.closeDatabase();
    connection.setupDatabase();
    __resetVocabularyTable();
    __resetSpelling();
    indexDocument(null, 'medicine after food, twice a day', '/photos/rx.jpg', 'IMAGE', 'TEXT');
    indexDocument(null, 'बिजली बिल भुगतान', '/photos/bijli.jpg', 'IMAGE', 'TEXT');
    indexDocument('Electricity bill', 'electricity bill amount', '/docs/bill.pdf', 'DOCUMENT', 'TEXT');
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

test('corrects typed words to words in the index', async () => {
    await expect(rescueQuery('medicne')).resolves.toEqual({
        query: 'medicine',
        corrections: [{ from: 'medicne', to: 'medicine' }],
    });
    await expect(rescueQuery('electrcity bil')).resolves.toMatchObject({ query: 'electricity bil' });
});

test('corrects a Hinglish typo by sound, to the word as the paper writes it', async () => {
    const rescue = await rescueQuery('bijki');
    expect(rescue?.query).toBe('बिजली');
});

test('keeps filler words and leaves known words alone', async () => {
    await expect(rescueQuery('medicne of')).resolves.toMatchObject({ query: 'medicne of'.replace('medicne', 'medicine') });
    await expect(rescueQuery('medicine')).resolves.toBeNull();
    await expect(rescueQuery('zzqxv')).resolves.toBeNull();
    await expect(rescueQuery('   ')).resolves.toBeNull();
});

test('reads the vocabulary once, and frees it after a quiet while', async () => {
    jest.useFakeTimers();
    const load = jest.spyOn(vocabulary, 'loadVocabulary');
    await rescueQuery('medicne');
    await rescueQuery('electrcity');
    expect(load).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(IDLE_DROP_MS + 1);
    await rescueQuery('medicne');
    expect(load).toHaveBeenCalledTimes(2);
});

test('gives up quietly when the vocabulary cannot be read', async () => {
    jest.spyOn(vocabulary, 'loadVocabulary').mockRejectedValue(new Error('disk'));
    await expect(rescueQuery('medicne')).resolves.toBeNull();
});
