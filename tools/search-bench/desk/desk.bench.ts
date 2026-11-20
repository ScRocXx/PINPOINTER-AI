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

const OUT = process.env.BENCH_OUT ?? path.join(__dirname, '..', 'out');

interface CorpusDoc {
  id: string;
  kind: 'IMAGE' | 'DOCUMENT';
  detection: 'TEXT' | 'OBJECT' | 'EMPTY';
  ocr: string | null;
  lines: string[] | null;
  labels: string[] | null;
  takenAt: number;
  copyOf: string | null;
}
interface Query {
  qid: string;
  text: string;
}

const readJsonl = <T,>(file: string): T[] =>
  fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as T);

/** Where a test file "lives": the scorer turns results back into ids by this name. */
export const benchPath = (doc: Pick<CorpusDoc, 'id' | 'kind'>) => `/storage/emulated/0/Pictures/PinpointerBench/${doc.id}.${doc.kind === 'DOCUMENT' ? 'pdf' : 'jpg'}`;
const idOfPath = (p: string) => path.basename(p).replace(/\.(jpg|pdf)$/, '');

/** What the app stores for a photo or PDF, as GallerySync and DocumentPipeline do. */
const storedText = (d: CorpusDoc): string => {
  if (d.kind === 'DOCUMENT') return (d.lines ?? []).join(' ').substring(0, 2000);
  if (d.detection === 'TEXT') return (d.ocr ?? '').trim() || 'image';
  if (d.detection === 'OBJECT') return (d.labels ?? []).join(' ');
  return 'image';
};

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
  const leaks: string[] = [];
  for (const n of numbers) {
    const spaced = /^\d{12}$/.test(n) ? `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}` : n;
    const hit = db.executeSync('SELECT COUNT(*) AS c FROM document_index WHERE content LIKE ? OR content LIKE ? OR title LIKE ?', [`%${n}%`, `%${spaced}%`, `%${n}%`]).rows?.[0] as { c: number };
    if (hit.c > 0) leaks.push(n);
  }
  const vocabLeaks = (db.executeSync("CREATE VIRTUAL TABLE IF NOT EXISTS temp.bench_vocab USING fts5vocab(main, 'fts_index', 'row')"), [...numbers].filter(n => {
    const r = db.executeSync('SELECT COUNT(*) AS c FROM temp.bench_vocab WHERE term = ?', [n.toLowerCase()]).rows?.[0] as { c: number };
    return r.c > 0;
  }));
  const indexReport = JSON.parse(fs.readFileSync(path.join(OUT, 'desk-index.json'), 'utf8'));
  indexReport.privacy = { numbersChecked: numbers.size, storedInText: leaks, storedInSearchIndex: vocabLeaks };
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
  fs.writeFileSync(path.join(OUT, 'desk-run.json'), JSON.stringify({ runAt, where: 'desk', lookAlikes: false }, null, 2));
});
