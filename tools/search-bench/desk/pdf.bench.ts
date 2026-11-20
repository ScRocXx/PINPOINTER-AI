/**
 * PDF reading: the app's own processPDF (utils/DocumentPipeline) on real PDF
 * files, with the real file system and SQLite. Page pictures and OCR are not
 * available on a computer, so a PDF whose text the native step can't read
 * shows up as "went to OCR" with only its file name stored. How much of each
 * PDF's real text (pdftotext, or the corpus lines) ends up searchable is the
 * score.
 *
 *   BENCH_PDFS=dir npx jest --config tools/search-bench/jest.config.js --testMatch '**' + '/pdf.bench.ts' --forceExit
 *   (default dir: out/device/media/Download; writes out/pdf-results.json)
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

jest.mock('../../../src/utils/AppLogger', () => ({
  AppLogger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, log: () => {} },
}));
// The real file system instead of the Jest mock.
jest.mock('react-native-fs', () => {
  const nodeFs = jest.requireActual('fs');
  return {
    stat: async (p: string) => ({ size: nodeFs.statSync(p).size, mtime: nodeFs.statSync(p).mtimeMs, isFile: () => true, isDirectory: () => false }),
    read: async (p: string, length: number, position: number, encoding: string) => {
      const fd = nodeFs.openSync(p, 'r');
      const buf = Buffer.alloc(length);
      const n = nodeFs.readSync(fd, buf, 0, length, position);
      nodeFs.closeSync(fd);
      return buf.subarray(0, n).toString(encoding === 'ascii' ? 'latin1' : encoding);
    },
    exists: async (p: string) => nodeFs.existsSync(p),
    unlink: async () => {},
  };
});

import { NativeModules } from 'react-native';
import { setupDatabase } from '../../../src/database';
import { getDb } from '../../../src/database/connection';
import { visibleContent } from '../../../src/utils/SearchKeys';
import { processPDF } from '../../../src/utils/DocumentPipeline';

const OUT = process.env.BENCH_OUT ?? path.join(__dirname, '..', 'out');
const MEDIA = path.join(OUT, 'device', 'media');
const DIRS = process.env.BENCH_PDFS ? [process.env.BENCH_PDFS] : ['Download', 'Documents', 'WhatsApp'].map(f => path.join(MEDIA, f));
/** The bench's own PDFs: their true text is in the corpus (also for locked ones pdftotext can't open). */
const corpusText = new Map<string, string>(
  fs.existsSync(path.join(OUT, 'corpus.jsonl'))
    ? fs.readFileSync(path.join(OUT, 'corpus.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).filter((d: { kind: string }) => d.kind === 'DOCUMENT').map((d: { id: string; lines: string[] }) => [d.id, d.lines.join('\n')])
    : [],
);

/** The PDF's real text, by an independent reader (poppler's pdftotext), when installed. */
const trueText = (file: string): string | null => {
  try {
    return execFileSync('pdftotext', ['-q', file, '-'], { encoding: 'utf8' });
  } catch {
    return null;
  }
};
const words = (t: string) => new Set((t.toLowerCase().match(/[\p{L}\p{M}\p{N}]{4,}/gu) ?? []).filter(w => !/^\d+$/.test(w)));

test('pdf reading', async () => {
  const files = DIRS.flatMap(dir => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.pdf')).map(f => path.join(dir, f)) : []));
  expect(files.length).toBeGreaterThan(0);
  Object.assign(NativeModules, {
    NativePdfModule: {
      getPdfInfo: async (p: string) => ({ pageCount: (fs.readFileSync(p.replace('file://', ''), 'latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length }),
      rasterizePages: async () => [], // no page pictures on a computer: the OCR step finds nothing
      cleanupCache: async () => {},
    },
  });
  setupDatabase();
  const out = [];
  for (const file of files.sort()) {
    const f = path.basename(file);
    const result = await processPDF(file);
    const row = getDb().executeSync('SELECT content FROM document_index WHERE filePath = ?', [`file://${file}`]).rows?.[0] as { content?: string } | undefined;
    const stored = visibleContent(row?.content ?? '');
    const truth = corpusText.get(f.match(/^d\d{5}/)?.[0] ?? '') ?? trueText(file);
    const want = truth ? words(truth) : null;
    const got = words(stored);
    const found = want ? [...want].filter(w => got.has(w)).length : null;
    out.push({
      file: f,
      folder: path.basename(path.dirname(file)),
      status: result.status,
      pages: result.metadata.pageCount,
      storedChars: stored.length,
      trueWords: want?.size ?? null,
      wordsFound: found,
      readPct: want && want.size ? Math.round((100 * (found ?? 0)) / want.size) : null,
      stored: stored.slice(0, 160),
    });
  }
  fs.writeFileSync(path.join(OUT, 'pdf-results.json'), JSON.stringify(out, null, 2));
});
