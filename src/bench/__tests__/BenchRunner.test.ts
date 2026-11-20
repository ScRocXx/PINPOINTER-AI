/**
 * The search bench's in-app runner: reading requests, naming files, and a
 * whole search request run against the in-memory database.
 */
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { BENCH_DIR, benchIdOf, parseCommand, startBench } from '../BenchRunner';
import { BENCH_BUILD } from '../benchFlag';
import { setupDatabase } from '../../database';
import { indexDocument } from '../../database/documents';

jest.mock('../../services/EmbeddingService', () => ({
    encodeText: jest.fn(async () => null),
    warmUpText: jest.fn(async () => true),
    isTextModelReady: jest.fn(() => false),
    areClipModelsAvailable: jest.fn(async () => false),
}));
jest.mock('../../services/SpellingService', () => ({ rescueQuery: jest.fn(async () => null) }));

const fs = RNFS as jest.Mocked<typeof RNFS>;

describe('benchFlag', () => {
    test('is off in the repository, so a normal build never runs the bench', () => {
        expect(BENCH_BUILD).toBe(false);
    });
});

describe('parseCommand', () => {
    test('reads the three commands', () => {
        expect(parseCommand('{"cmd":"status"}')).toEqual({ cmd: 'status' });
        expect(parseCommand('{"cmd":"index"}')).toEqual({ cmd: 'index' });
        expect(parseCommand('{"cmd":"search","k":30,"queries":"q.jsonl"}')).toEqual({ cmd: 'search', k: 30, queries: 'q.jsonl' });
    });

    test('caps and cleans what a search asks for', () => {
        expect(parseCommand('{"cmd":"search","k":5000}')).toEqual({ cmd: 'search', k: 200, queries: undefined });
        expect(parseCommand('{"cmd":"search","k":-1,"queries":7}')).toEqual({ cmd: 'search', k: undefined, queries: undefined });
    });

    test('anything else is not a command', () => {
        expect(parseCommand('{"cmd":"delete"}')).toBeNull();
        expect(parseCommand('not json')).toBeNull();
        expect(parseCommand('')).toBeNull();
    });
});

describe('benchIdOf', () => {
    const names = new Map([['content://media/external/images/media/12', 'd00042.jpg'], ['content://media/external/images/media/13', 'IMG_2031.jpg']]);

    test('names the bench files by id and the phone own photos by file name', () => {
        expect(benchIdOf('content://media/external/images/media/12', names)).toBe('d00042');
        expect(benchIdOf('content://media/external/images/media/13', names)).toBe('own:IMG_2031.jpg');
    });

    test('PDFs and unknown URIs fall back to the last part of the path', () => {
        expect(benchIdOf('file:///storage/emulated/0/Download/PinpointerBench/d00107.pdf', names)).toBe('d00107');
        expect(benchIdOf('file:///storage/emulated/0/Download/Bill%20March.pdf', names)).toBe('own:Bill March.pdf');
    });
});

describe('startBench', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        setupDatabase();
    });
    afterEach(() => jest.useRealTimers());

    const files = new Map<string, string>();
    const useFiles = () => {
        files.clear();
        fs.exists.mockImplementation(async p => files.has(p));
        fs.readFile.mockImplementation(async p => files.get(p) ?? '');
        fs.unlink.mockImplementation(async p => {
            files.delete(p);
        });
        fs.writeFile.mockImplementation(async (p, data) => {
            files.set(p, data);
        });
        fs.appendFile.mockImplementation(async (p, data) => {
            files.set(p, (files.get(p) ?? '') + data);
        });
    };

    const runTicks = async (n: number) => {
        for (let i = 0; i < n; i++) {
            jest.advanceTimersByTime(2000);
            // let the async tick finish
            for (let j = 0; j < 50; j++) await Promise.resolve();
        }
    };

    test('a search request writes one result line per query, naming files, never their text', async () => {
        useFiles();
        indexDocument(null, 'BSES बिजली बिल Amount Payable Rs 1240', 'content://media/external/images/media/1', 'IMAGE', 'TEXT', Date.now());
        (CameraRoll.getPhotos as jest.Mock).mockResolvedValueOnce({
            edges: [{ node: { image: { uri: 'content://media/external/images/media/1', filename: 'd00001.jpg' } } }],
            page_info: { has_next_page: false },
        });
        files.set(`${BENCH_DIR}/queries.jsonl`, '{"qid":"q1","text":"bijli bill"}\n{"qid":"q2","text":"giraffe"}\n');
        files.set(`${BENCH_DIR}/request.json`, '{"cmd":"search"}');
        const stop = startBench();
        await runTicks(3);
        stop();
        expect(files.has(`${BENCH_DIR}/search-done.json`)).toBe(true);
        const rows = (files.get(`${BENCH_DIR}/results.jsonl`) ?? '').split('\n').filter(Boolean).map(l => JSON.parse(l));
        expect(rows.map(r => r.qid)).toEqual(['q1', 'q2']);
        expect(rows[0].ids).toEqual(['d00001']);
        expect(rows[1].ids).toEqual([]);
        expect(JSON.stringify(rows)).not.toContain('1240');
        expect(JSON.parse(files.get(`${BENCH_DIR}/run.json`)!)).toMatchObject({ where: 'device', lookAlikes: false, queries: 2 });
        expect(files.has(`${BENCH_DIR}/request.json`)).toBe(false);
    });

    test('a bad request is reported, not run', async () => {
        useFiles();
        files.set(`${BENCH_DIR}/request.json`, '{"cmd":"rm -rf"}');
        const stop = startBench();
        await runTicks(2);
        stop();
        expect(files.get(`${BENCH_DIR}/error.json`)).toContain('not a bench command');
    });

    test('without a request it only writes the status', async () => {
        useFiles();
        const stop = startBench();
        await runTicks(4);
        stop();
        const status = JSON.parse(files.get(`${BENCH_DIR}/status.json`) ?? '{}');
        expect(status.ready).toBeDefined();
        expect(status.indexing).toBeDefined();
    });
});
