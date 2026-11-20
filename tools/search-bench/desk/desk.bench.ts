/**
 * Desk bench: the app's own indexing and search code, on a real SQLite
 * engine (FTS5, fts5vocab, sqlite-vec via desk/nodeSqlite.js), over the test
 * gallery from corpus/generate.js. What OCR "read" is the corpus's `ocr`
 * text (with simulated misreadings); photos without text carry ML Kit-style
 * labels. CLIP is not run here (no look-alikes): the device bench measures
 * that on a phone.
 *
 *   node corpus/generate.js && (cd ../.. && npx jest --config tools/search-bench/jest.config.js)
 *   node score.js out/desk-results.jsonl
 *
 * BENCH_OUT (default tools/search-bench/out) holds the corpus and gets
 * desk-results.jsonl and desk-index.json.
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../../src/utils/AppLogger', () => ({
  AppLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, log: () => {} },
}));

import { setupDatabase } from '../../../src/database';
import { indexDocument } from '../../../src/database/documents';
import { noteFileSeen, markOcrDone, setFingerprint } from '../../../src/database/fileState';
import { beginTransaction, commitTransaction } from '../../../src/database/transactions';
import { getDb, isFtsAvailable } from '../../../src/database/connection';
import { searchWordsFirst, pictureQueryFor } from '../../../src/services/SearchPipeline';
import { appCanSee, benchPath, idOfPath, storedText, type CorpusDoc } from './stored';

const OUT = process.env.BENCH_OUT ?? path.join(__dirname, '..', 'out');

interface Query {
  qid: string;
  text: string;
}

const readJsonl = <T,>(file: string): T[] =>
  fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);

test('desk bench', async () => {
  const docs = readJsonl<CorpusDoc>(path.join(OUT, 'corpus.jsonl'));
  const queries = readJsonl<Query>(path.join(OUT, 'queries.jsonl'));

  setupDatabase();
  expect(isFtsAvailable()).toBe(true);

  // ── Index ──
  const tIndex = Date.now();
  const perDoc: number[] = [];
  let failed = 0;
  for (let i = 0; i < docs.length; i += 250) {
    beginTransaction();
    for (const d of docs.slice(i, i + 250)) {
      if (!appCanSee(d)) continue;
      const t0 = process.hrtime.bigint();
      const uri = benchPath(d);
      noteFileSeen(uri, d.kind, d.takenAt);
      const id = indexDocument(null, storedText(d), uri, d.kind, (d.detection === 'EMPTY' ? 'EMPTY' : d.detection) as 'TEXT', d.takenAt);
      if (id == null) failed++;
      markOcrDone(uri, d.kind);
      // Byte-identical copies share a fingerprint (the source's id stands in for the hash).
      setFingerprint(uri, d.copyOf ?? d.id, d.kind);
      perDoc.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    commitTransaction();
  }
  const indexMs = Date.now() - tIndex;
  perDoc.sort((a, b) => a - b);
  const q = (p: number) => perDoc[Math.min(perDoc.length - 1, Math.floor(p * perDoc.length))];
  fs.writeFileSync(
    path.join(OUT, 'desk-index.json'),
    JSON.stringify({ docs: docs.length, failed, totalMs: indexMs, perDocMs: { p50: q(0.5), p95: q(0.95), max: perDoc[perDoc.length - 1] } }, null, 2),
  );

  // ── Privacy: no full Aadhaar, PAN or phone number may be stored ──
  const numbers = new Set<string>();
  for (const d of docs) {
    const text = (d.lines ?? []).join('\n');
    for (const m of text.match(/\b\d{4} \d{4} \d{4}\b/g) ?? []) numbers.add(m.replace(/ /g, ''));
    for (const m of text.match(/\b[A-Z]{5}\d{4}[A-Z]\b/g) ?? []) numbers.add(m);
    for (const m of text.match(/\b[6-9]\d{9}\b/g) ?? []) numbers.add(m);
  }
  const db = getDb();
  // OCR slips turn digits into look-alike letters ("1O85", "l234", "5S"): read
  // stored text with those letters as digits, so a number that slipped past
  // the mask that way is still caught.
  const asDigits = (t: string) => t.replace(/[OoDQ]/g, '0').replace(/[lIi|!]/g, '1').replace(/[Zz]/g, '2').replace(/[Ss]/g, '5').replace(/[G]/g, '6').replace(/[B]/g, '8').replace(/[g]/g, '9');
  const contents = (db.executeSync('SELECT filePath, content, title FROM document_index').rows ?? []) as Array<{ filePath: string; content: string; title: string | null }>;
  const leaks: string[] = [];
  const slipped: Array<{ number: string; stored: string; file: string }> = [];
  for (const n of numbers) {
    const spaced = /^\d{12}$/.test(n) ? `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}` : n;
    const exact = contents.some(r => (r.content ?? '').includes(n) || (r.content ?? '').includes(spaced) || (r.title ?? '').includes(n));
    if (exact) {
      leaks.push(n);
      continue;
    }
    if (!/^\d+$/.test(n)) continue;
    for (const r of contents) {
      const text = (r.content ?? '').split('\u2063')[0];
      const flat = asDigits(text).replace(/[\s-]/g, '');
      if (flat.includes(n)) {
        const m = text.match(new RegExp(spaced.split('').map(ch => (ch === ' ' ? '[\\s-]?' : '[0-9OoDQlIi|!ZzSsGBg]')).join('')));
        slipped.push({ number: `${n.slice(0, 2)}…${n.slice(-2)}`, stored: m ? m[0].replace(/[0-9]/g, '#') : '?', file: idOfPath(r.filePath) });
        break;
      }
    }
  }
  const vocabLeaks = (db.executeSync("CREATE VIRTUAL TABLE IF NOT EXISTS temp.bench_vocab USING fts5vocab(main, 'fts_index', 'row')"), [...numbers].filter(n => {
    const r = db.executeSync('SELECT COUNT(*) AS c FROM temp.bench_vocab WHERE term = ?', [n.toLowerCase()]).rows?.[0] as { c: number };
    return r.c > 0;
  }));
  const indexReport = JSON.parse(fs.readFileSync(path.join(OUT, 'desk-index.json'), 'utf8'));
  indexReport.privacy = { numbersChecked: numbers.size, storedInText: leaks, storedInSearchIndex: vocabLeaks, storedWithOcrSlips: slipped };
  fs.writeFileSync(path.join(OUT, 'desk-index.json'), JSON.stringify(indexReport, null, 2));

  // ── Search ──
  const runAt = Date.now();
  const lines: string[] = [];
  for (const query of queries) {
    const t0 = process.hrtime.bigint();
    let row: Record<string, unknown>;
    try {
      const words = await searchWordsFirst(query.text);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      row = {
        qid: query.qid,
        ids: words.results.map(r => idOfPath(r.filePath)),
        searched: words.query,
        correctedFrom: words.correctedFrom,
        dates: words.meaning.dates?.meaning ?? null,
        newestFirst: words.meaning.recency !== null,
        clipText: pictureQueryFor(words.query, words.meaning),
        ms: { words: ms },
      };
    } catch (e) {
      row = { qid: query.qid, ids: [], error: String(e), ms: { words: Number(process.hrtime.bigint() - t0) / 1e6 } };
    }
    lines.push(JSON.stringify(row));
  }
  fs.writeFileSync(path.join(OUT, 'desk-results.jsonl'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'desk-run.json'), JSON.stringify({ runAt, where: 'desk', lookAlikes: false, notSeen: docs.filter(d => !appCanSee(d)).map(d => d.id) }, null, 2));
});
