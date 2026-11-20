/**
 * The search steps shared by useSearch and the search bench, against the
 * in-memory database: words, typo rescue, what CLIP is shown, and the merge.
 */
import { setupDatabase } from '../../database';
import { indexDocument } from '../../database/documents';
import { rescueQuery } from '../SpellingService';
import { mergeResults, needsRescue, pictureQueryFor, rescueWords, searchWordsFirst, wordResults } from '../SearchPipeline';
import type { DocumentRecord } from '../../database';

jest.mock('../SpellingService', () => ({ rescueQuery: jest.fn(async () => null) }));
const mockRescue = rescueQuery as jest.MockedFunction<typeof rescueQuery>;

const doc = (filePath: string): DocumentRecord => ({ filePath, content: '', type: 'IMAGE', detection_type: 'TEXT', timestamp: 0 });

beforeEach(() => {
    setupDatabase();
    mockRescue.mockReset().mockResolvedValue(null);
    indexDocument(null, 'BSES Rajdhani बिजली बिल Amount Payable Rs 1240', '/bill.jpg', 'IMAGE', 'TEXT', Date.now());
    indexDocument(null, 'Dolo 650 Paracetamol Tablets', '/strip.jpg', 'IMAGE', 'TEXT', Date.now());
});

describe('wordResults and needsRescue', () => {
    test('finds by words, and a search that found something needs no rescue', () => {
        const words = wordResults('bijli bill');
        expect(words.results.map(d => d.filePath)).toEqual(['/bill.jpg']);
        expect(words.correctedFrom).toBeNull();
        expect(needsRescue(words)).toBe(false);
    });

    test('nothing found may be a typo, but a date that found nothing is not', () => {
        expect(needsRescue(wordResults('qqqzzz'))).toBe(true);
        expect(needsRescue({ query: 'diwali 2019', results: [], correctedFrom: null })).toBe(false);
    });
});

describe('rescueWords', () => {
    test('searches the correction and says what was typed', async () => {
        mockRescue.mockResolvedValue({ query: 'paracetamol', corrections: [{ from: 'paracetmol', to: 'paracetamol' }] });
        const rescued = await rescueWords('paracetmol');
        expect(rescued).toMatchObject({ query: 'paracetamol', correctedFrom: 'paracetmol' });
        expect(rescued!.results.map(d => d.filePath)).toEqual(['/strip.jpg']);
    });

    test('no correction, or one that finds nothing, keeps the typed query with no results', async () => {
        expect(await rescueWords('qqqzzz')).toEqual({ query: 'qqqzzz', results: [], correctedFrom: null });
        mockRescue.mockResolvedValue({ query: 'zzzqqq', corrections: [] });
        expect(await rescueWords('qqqzzz')).toEqual({ query: 'qqqzzz', results: [], correctedFrom: null });
    });

    test('stops when a newer search replaced this one', async () => {
        mockRescue.mockResolvedValue({ query: 'paracetamol', corrections: [] });
        expect(await rescueWords('paracetmol', () => false)).toBeNull();
    });
});

describe('searchWordsFirst', () => {
    test('runs the rescue only when the words find nothing, and reads the meaning of the searched query', async () => {
        const found = await searchWordsFirst('latest bijli bill');
        expect(mockRescue).not.toHaveBeenCalled();
        expect(found.meaning.recency).not.toBeNull();
        // (A real typo like "paracetmol" usually finds something through the
        // Soundex fallback first, so the rescue doesn't run: see
        // tools/search-bench/FINDINGS.md. Input that finds nothing at all here.)
        mockRescue.mockResolvedValue({ query: 'paracetamol', corrections: [] });
        const rescued = await searchWordsFirst('qqqzzz');
        expect(mockRescue).toHaveBeenCalledWith('qqqzzz');
        expect(rescued.query).toBe('paracetamol');
        expect(rescued.correctedFrom).toBe('qqqzzz');
    });
});

describe('pictureQueryFor', () => {
    test('Hindi concepts reach CLIP in English; unknown Hindi skips it', async () => {
        const known = await searchWordsFirst('दवाई');
        expect(pictureQueryFor(known.query, known.meaning)).toMatch(/medicine/);
        const unknown = await searchWordsFirst('पनडुब्बी');
        expect(pictureQueryFor(unknown.query, unknown.meaning)).toBeNull();
    });

    test('"latest" words are left out; a festival shows CLIP what it looks like', async () => {
        const latest = await searchWordsFirst('latest electricity bill');
        expect(pictureQueryFor(latest.query, latest.meaning)).toBe('electricity bill');
        const festival = await searchWordsFirst('diwali photos');
        expect(pictureQueryFor(festival.query, festival.meaning)).toMatch(/diwali/i);
    });
});

describe('mergeResults', () => {
    test('look-alike list first, then word results it lacked, each file once', () => {
        expect(mergeResults([doc('/a'), doc('/b')], [doc('/b'), doc('/c')]).map(d => d.filePath)).toEqual(['/a', '/b', '/c']);
    });
});
