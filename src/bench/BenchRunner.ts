/**
 * BenchRunner.ts — the search bench's hands inside the app (bench builds only).
 *
 * tools/search-bench/device/bench.js drives a phone over USB: it copies test
 * photos and PDFs on, then talks to this runner through files in the app's
 * own folder (Android/data/com.pinpointer.app/files/bench/):
 *
 *   request.json   {"cmd":"status"} | {"cmd":"index"} | {"cmd":"privacy"} | {"cmd":"search","k":100}
 *   status.json    written every few seconds: indexing progress and counts
 *   index-done.json, privacy.json (shapes of numbers the mask missed, no digits),
 *   results.jsonl + run.json + search-done.json
 *
 * A search runs the very steps the search screen runs (services/SearchPipeline:
 * words, typo rescue, CLIP text, look-alikes) and records what each returned
 * and how long it took, plus the raw look-alike distances for tuning. Results
 * name files, never their text: only ids of the bench's own test files
 * ("d00042") and, for the phone's own photos, "own:<file name>".
 *
 * It only starts when benchFlag.BENCH_BUILD is true (never in the repository).
 */
import RNFS from 'react-native-fs';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { getReadyCounts } from '../database/fileState';
import { getEmbeddingCount, lookAlikeDiagnosticsAsync } from '../database/vectors';
import { understandQuery } from '../database';
import { getReadDb } from '../database/connection';
import { IndexingService } from '../services/IndexingService';
import { encodeText, isTextModelReady, warmUpText, areClipModelsAvailable } from '../services/EmbeddingService';
import { needsRescue, pictureQueryFor, rescueWords, withLookAlikes, wordResults } from '../services/SearchPipeline';
import { getGalleryTotalCount } from '../utils/GallerySync';
import { markFirstRunDone } from '../utils/FirstRun';
import { AppLogger } from '../utils/AppLogger';

export const BENCH_DIR = `${RNFS.ExternalDirectoryPath}/bench`;
/** Test files are named d00001.jpg, d00002_BSES_Bill_Nov2025.pdf … by the bench; anything else is the phone's own. */
const BENCH_NAME = /^(d\d{5})(?:_[^/]*)?\.(jpg|jpeg|png|pdf)$/i;
const POLL_MS = 2000;
const STATUS_EVERY_MS = 5000;

export type BenchCommand =
    | { cmd: 'status' }
    | { cmd: 'index' }
    | { cmd: 'privacy' }
    | { cmd: 'search'; queries?: string; k?: number };

/** The command in a request file, or null when it isn't one. */
export const parseCommand = (text: string): BenchCommand | null => {
    try {
        const c = JSON.parse(text) as Partial<BenchCommand> & { cmd?: string };
        if (c.cmd === 'status' || c.cmd === 'index' || c.cmd === 'privacy') return { cmd: c.cmd };
        if (c.cmd === 'search') {
            const s = c as { queries?: unknown; k?: unknown };
            return {
                cmd: 'search',
                queries: typeof s.queries === 'string' ? s.queries : undefined,
                k: typeof s.k === 'number' && s.k > 0 ? Math.min(200, Math.floor(s.k)) : undefined,
            };
        }
        return null;
    } catch {
        return null;
    }
};

/** A stored path or URI as the bench names it: "d00042" for its test files, "own:IMG_1234.jpg" otherwise. */
export const benchIdOf = (filePath: string, names: ReadonlyMap<string, string>): string => {
    const name = names.get(filePath) ?? decodeURIComponent(filePath.split('/').pop() ?? filePath);
    return BENCH_NAME.exec(name)?.[1] ?? `own:${name}`;
};

/** Every gallery photo's URI → file name (stored rows hold the URI; the bench knows files by name). */
const loadNames = async (): Promise<Map<string, string>> => {
    const names = new Map<string, string>();
    let after: string | undefined;
    for (let page = 0; page < 200; page++) {
        const result = await CameraRoll.getPhotos({ first: 500, after, assetType: 'Photos', include: ['filename'] });
        for (const edge of result.edges) {
            const { uri, filename } = edge.node.image;
            if (uri && filename) names.set(uri, filename);
        }
        if (!result.page_info.has_next_page) break;
        after = result.page_info.end_cursor;
    }
    return names;
};

const write = (file: string, data: unknown) => RNFS.writeFile(`${BENCH_DIR}/${file}`, JSON.stringify(data, null, 1), 'utf8');

const writeStatus = async (extra: Record<string, unknown> = {}) => {
    const ready = getReadyCounts();
    await write('status.json', {
        at: Date.now(),
        ready,
        vectors: getEmbeddingCount(),
        indexing: IndexingService.getSnapshot(),
        textModelReady: isTextModelReady(),
        ...extra,
    });
};

const ms = (t0: number) => Date.now() - t0;

/** Index everything on the phone the way the first run does: photos, PDFs, then the CLIP backfill. */
const runIndex = async () => {
    const t0 = Date.now();
    await markFirstRunDone();
    const photos = await IndexingService.deepGallerySync();
    const tPhotos = ms(t0);
    const pdfs = await IndexingService.documentSync();
    const tPdfs = ms(t0) - tPhotos;
    await IndexingService.whenIdle();
    const embedded = await IndexingService.backfill();
    await IndexingService.whenIdle();
    await write('index-done.json', {
        at: Date.now(),
        ms: { photos: tPhotos, pdfs: tPdfs, total: ms(t0) },
        photos,
        pdfs,
        embedded,
        ready: getReadyCounts(),
        vectors: getEmbeddingCount(),
        galleryTotal: await getGalleryTotalCount(),
    });
};

/**
 * Long numbers that slipped past the mask: runs of 10-12 digit-like
 * characters (OCR reads 0 as O, 1 as l, 5 as S…) with at least 8 real digits
 * and no mask star. Only their shape is reported ("#### #### #O##"), never the
 * digits, so the result is safe to copy off the phone.
 */
const SLIP = /(?<![0-9A-Za-z*])(?:[0-9OoDQlIi|SsBZ][ -]?){9,11}[0-9OoDQlIi|SsBZ](?![0-9A-Za-z*])/g;
export const unmaskedNumberShapes = (text: string): string[] =>
    (text.match(SLIP) ?? [])
        .filter(run => (run.match(/[0-9]/g) ?? []).length >= 8 && /[0-9]/.test(run[0] + run[run.length - 1]))
        .map(run => run.replace(/[0-9]/g, '#'));

/** Scans every stored text for numbers the mask missed (bench builds only). */
const runPrivacy = async () => {
    const result = await getReadDb().execute('SELECT content FROM document_index');
    const shapes: Record<string, number> = {};
    let rows = 0;
    for (const row of (result?.rows ?? []) as Array<{ content?: string }>) {
        const found = unmaskedNumberShapes(String(row.content ?? '').split('\u2063')[0]);
        if (found.length) rows++;
        for (const shape of found) shapes[shape] = (shapes[shape] ?? 0) + 1;
    }
    await write('privacy.json', { at: Date.now(), rowsChecked: result?.rows?.length ?? 0, rowsWithUnmaskedNumbers: rows, shapes });
};

interface QueryLine { qid: string; text: string }

/** document_index id → file path, for the look-alike distances. */
const pathsOf = async (ids: number[]): Promise<Map<number, string>> => {
    const out = new Map<number, string>();
    if (ids.length === 0) return out;
    const result = await getReadDb().execute(
        `SELECT id, filePath FROM document_index WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids,
    );
    for (const row of (result?.rows ?? []) as Array<{ id: number; filePath: string }>) out.set(row.id, row.filePath);
    return out;
};

/** One search, step by step, as the search screen runs it. */
const searchOnce = async (q: QueryLine, names: ReadonlyMap<string, string>, k: number) => {
    const id = (p: string) => benchIdOf(p, names);
    const t0 = Date.now();
    let words = wordResults(q.text);
    const tWords = ms(t0);
    if (needsRescue(words)) words = (await rescueWords(q.text)) ?? words;
    const tRescue = ms(t0) - tWords;
    const meaning = understandQuery(words.query);
    const clipText = pictureQueryFor(words.query, meaning);
    const t1 = Date.now();
    const vector = clipText ? await encodeText(clipText) : null;
    const tEncode = ms(t1);
    let final = words.results;
    let look: unknown = null;
    let tLook = 0;
    if (vector) {
        const t2 = Date.now();
        final = await withLookAlikes(words.query, vector, words.results);
        tLook = ms(t2);
        const diag = await lookAlikeDiagnosticsAsync(vector, k);
        if (diag) {
            const paths = await pathsOf(diag.nearest.map(n => n.documentId));
            look = {
                photos: diag.photos,
                far: diag.farDistance,
                limit: diag.limit,
                nearest: diag.nearest.map(n => ({ id: id(paths.get(n.documentId) ?? `#${n.documentId}`), d: Math.round(n.distance * 10000) / 10000 })),
            };
        }
    }
    return {
        qid: q.qid,
        ids: final.map(d => id(d.filePath)),
        wordIds: words.results.map(d => id(d.filePath)),
        searched: words.query,
        correctedFrom: words.correctedFrom,
        dates: meaning.dates?.meaning ?? null,
        newestFirst: meaning.recency !== null,
        clipText,
        ms: { words: tWords + tRescue, rescue: tRescue, encode: tEncode, look: tLook },
        look,
    };
};

const runSearch = async (cmd: Extract<BenchCommand, { cmd: 'search' }>) => {
    const file = `${BENCH_DIR}/${cmd.queries ?? 'queries.jsonl'}`;
    const queries = (await RNFS.readFile(file, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line) as QueryLine);
    const names = await loadNames();
    const clip = await areClipModelsAvailable();
    const tWarm = Date.now();
    if (clip) await warmUpText();
    const warmMs = ms(tWarm);
    const out = `${BENCH_DIR}/results.jsonl`;
    await RNFS.writeFile(out, '', 'utf8');
    let batch: string[] = [];
    for (let i = 0; i < queries.length; i++) {
        let row: unknown;
        try {
            row = await searchOnce(queries[i], names, cmd.k ?? 100);
        } catch (e) {
            row = { qid: queries[i].qid, ids: [], error: String(e) };
        }
        batch.push(JSON.stringify(row));
        if (batch.length >= 20 || i === queries.length - 1) {
            await RNFS.appendFile(out, batch.join('\n') + '\n', 'utf8');
            batch = [];
            await writeStatus({ searched: i + 1, of: queries.length });
        }
    }
    await write('run.json', { runAt: Date.now(), where: 'device', lookAlikes: clip, textModelWarmMs: warmMs, queries: queries.length, photosNamed: names.size });
    await write('search-done.json', { at: Date.now() });
};

let busy = false;

const handle = async (cmd: BenchCommand) => {
    if (cmd.cmd === 'index') await runIndex();
    else if (cmd.cmd === 'privacy') await runPrivacy();
    else if (cmd.cmd === 'search') await runSearch(cmd);
    await writeStatus();
};

/** Starts watching for bench requests. Returns a function that stops it. */
export const startBench = (): (() => void) => {
    let lastStatus = 0;
    const tick = async () => {
        if (busy) return;
        busy = true;
        try {
            await RNFS.mkdir(BENCH_DIR);
            const request = `${BENCH_DIR}/request.json`;
            if (await RNFS.exists(request)) {
                const text = await RNFS.readFile(request, 'utf8');
                await RNFS.unlink(request);
                const cmd = parseCommand(text);
                if (cmd) {
                    AppLogger.info('Bench', `Running ${cmd.cmd}`);
                    await handle(cmd);
                } else {
                    await write('error.json', { at: Date.now(), error: 'not a bench command' });
                }
            } else if (Date.now() - lastStatus > STATUS_EVERY_MS) {
                lastStatus = Date.now();
                await writeStatus();
            }
        } catch (e) {
            AppLogger.warn('Bench', 'Bench step failed', e);
            try {
                await write('error.json', { at: Date.now(), error: String(e) });
            } catch {
                // the folder itself is not writable: nothing more to do
            }
        } finally {
            busy = false;
        }
    };
    const timer = setInterval(() => {
        tick().catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(timer);
};
