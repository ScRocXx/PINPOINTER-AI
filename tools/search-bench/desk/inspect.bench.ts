/**
 * Look at a few searches closely: what each returns, from which step, and
 * what the top results say.
 *   BENCH_QUERIES='bijli bill|मंदिर' npx jest --config tools/search-bench/jest.config.js --testMatch '**' + '/inspect.bench.ts'
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
import { getDb } from '../../../src/database/connection';
import { searchWordsFirst } from '../../../src/services/SearchPipeline';
import { termsForQueryWord, searchWords } from '../../../src/utils/SearchKeys';

const OUT = process.env.BENCH_OUT ?? path.join(__dirname, '..', 'out');
const readJsonl = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

test('inspect', async () => {
  const docs = readJsonl(path.join(OUT, 'corpus.jsonl'));
  const byId = new Map(docs.map((d: any) => [d.id, d]));
  setupDatabase();
  beginTransaction();
  for (const d of docs) {
    const uri = `/b/${d.id}.${d.kind === 'DOCUMENT' ? 'pdf' : 'jpg'}`;
    noteFileSeen(uri, d.kind, d.takenAt);
    const text = d.kind === 'DOCUMENT' ? d.lines.join(' ') : d.detection === 'TEXT' ? d.ocr : d.detection === 'OBJECT' ? d.labels.join(' ') : 'image';
    indexDocument(null, text, uri, d.kind, d.detection, d.takenAt);
    markOcrDone(uri, d.kind);
    setFingerprint(uri, d.copyOf ?? d.id, d.kind);
  }
  commitTransaction();
  const out: string[] = [];
  for (const q of (process.env.BENCH_QUERIES ?? '').split('|').filter(Boolean)) {
    const r = await searchWordsFirst(q);
    out.push(`\n=== ${q}  → searched "${r.query}"${r.correctedFrom ? ' (corrected)' : ''}, ${r.results.length} results, dates=${JSON.stringify(r.meaning.dates?.meaning ?? null)} newest=${!!r.meaning.recency}`);
    out.push(`    words=${JSON.stringify(searchWords(r.query))} terms=${JSON.stringify(searchWords(r.query).map(termsForQueryWord))}`);
    for (const doc of r.results.slice(0, Number(process.env.BENCH_TOP ?? 8))) {
      const id = path.basename(doc.filePath).replace(/\.\w+$/, '');
      const d: any = byId.get(id);
      out.push(`    ${id} [${d.category}${d.series ? ' ' + d.series : ''}] ${new Date(d.takenAt).toISOString().slice(0, 10)} ${JSON.stringify((doc.content ?? '').slice(0, 110))}`);
    }
    if (process.env.BENCH_ID) {
      const row = getDb().executeSync('SELECT content FROM document_index WHERE filePath LIKE ?', [`%${process.env.BENCH_ID}%`]).rows?.[0] as any;
      out.push(`    stored ${process.env.BENCH_ID}: ${JSON.stringify(row?.content)}`);
    }
  }
  fs.writeFileSync(path.join(OUT, 'inspect.txt'), out.join('\n'));
});
