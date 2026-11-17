/**
 * SearchRekey: old rows get the current search tail in the background, in
 * batches, resumable, and only while nobody is using the phone.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as connection from '../../database/connection';
import { getDb } from '../../database/connection';
import { SEARCH_KEYS_VERSION, SEARCH_TAIL_MARK, visibleContent } from '../SearchKeys';
import { SEARCH_KEYS_CURSOR_KEY, SEARCH_KEYS_VERSION_KEY, isRekeyDone, rekeySearchTails } from '../SearchRekey';
import { __resetInteractionGate, noteInteraction, QUIET_AFTER_MS } from '../../services/InteractionGate';
// Test-only export of __mocks__/op-sqlite.js (declared in database/__tests__/search.test.ts).
import { __resetAll } from '@op-engineering/op-sqlite';

/** A row as an older version stored it: words plus a tail without the new keys. */
const oldRow = (id: number, content: string) => {
    getDb().executeSync(
        'INSERT INTO document_index (title, content, filePath, type, detection_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [null, `${content} ${SEARCH_TAIL_MARK} qkold`, `/photos/${id}.jpg`, 'IMAGE', 'TEXT', 1],
    );
};

const contents = (): string[] =>
    ((getDb().executeSync('SELECT id, title, content FROM document_index;')?.rows ?? []) as Array<{ content: string }>).map(r => r.content);

beforeEach(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    __resetAll();
    connection.closeDatabase();
    connection.setupDatabase();
    await AsyncStorage.clear();
    __resetInteractionGate();
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

test('gives every old row the new tail, then marks the work done', async () => {
    for (let i = 1; i <= 60; i++) oldRow(i, i % 2 ? 'rnedicine twice a day' : 'मुगतान रसीद');
    jest.useFakeTimers();
    const run = rekeySearchTails();
    await jest.runAllTimersAsync();
    await expect(run).resolves.toBe(60);

    const rows = contents();
    expect(rows.every(c => c.includes('qv') || c.includes('qf'))).toBe(true);
    expect(rows.every(c => !c.includes('qkold'))).toBe(true);
    expect(rows[0].startsWith('rnedicine twice a day')).toBe(true);
    await expect(isRekeyDone()).resolves.toBe(true);
    await expect(AsyncStorage.getItem(SEARCH_KEYS_CURSOR_KEY)).resolves.toBeNull();
    await expect(rekeySearchTails()).resolves.toBe(0);
});

test('stops when asked and resumes where it stopped', async () => {
    for (let i = 1; i <= 60; i++) oldRow(i, 'rnedicine');
    jest.useFakeTimers();
    const cancel = { current: false };
    const first = rekeySearchTails(cancel);
    await jest.advanceTimersByTimeAsync(0);
    cancel.current = true;
    await jest.runAllTimersAsync();
    const firstCount = await first;
    expect(firstCount).toBeGreaterThan(0);
    expect(firstCount).toBeLessThan(60);
    expect(Number(await AsyncStorage.getItem(SEARCH_KEYS_CURSOR_KEY))).toBe(firstCount);
    await expect(isRekeyDone()).resolves.toBe(false);

    const second = rekeySearchTails();
    await jest.runAllTimersAsync();
    await expect(second).resolves.toBe(60 - firstCount);
    await expect(isRekeyDone()).resolves.toBe(true);
});

test('waits while someone is using the phone', async () => {
    oldRow(1, 'rnedicine');
    jest.useFakeTimers();
    noteInteraction();
    const run = rekeySearchTails();
    await jest.advanceTimersByTimeAsync(QUIET_AFTER_MS / 2);
    expect(contents()[0]).toContain('qkold');
    await jest.runAllTimersAsync();
    await expect(run).resolves.toBe(1);
});

test('leaves rows without words, and up-to-date rows, unchanged', async () => {
    getDb().executeSync(
        'INSERT INTO document_index (title, content, filePath, type, detection_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
        [null, '', '/photos/empty.jpg', 'IMAGE', 'OBJECT', 1],
    );
    jest.useFakeTimers();
    const run = rekeySearchTails();
    await jest.runAllTimersAsync();
    await expect(run).resolves.toBe(0);
    await expect(AsyncStorage.getItem(SEARCH_KEYS_VERSION_KEY)).resolves.toBe(String(SEARCH_KEYS_VERSION));
});

test('takes the Soundex codes and the Hindi gloss old versions stored out of the visible text', async () => {
    // As versions before 3 stored them: words, codes, and for Hindi the gloss.
    oldRow(1, 'Electricity Bill Receipt E423 B400 R213');
    oldRow(2, 'कमल kamal lotus flower K540 L320 F460');
    jest.useFakeTimers();
    const run = rekeySearchTails();
    await jest.runAllTimersAsync();
    await expect(run).resolves.toBe(2);

    const [english, hindi] = contents();
    expect(visibleContent(english)).toBe('Electricity Bill Receipt');
    expect(visibleContent(hindi)).toBe('कमल');
    // Still searchable by them: they moved to the hidden tail.
    const tail = hindi.split(SEARCH_TAIL_MARK)[1];
    expect(tail.split(' ')).toEqual(expect.arrayContaining(['kamal', 'lotus', 'flower', 'L320']));
    expect(english.split(SEARCH_TAIL_MARK)[1].split(' ')).toEqual(expect.arrayContaining(['E423', 'B400', 'R213']));
});
