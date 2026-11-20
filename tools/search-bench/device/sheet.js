#!/usr/bin/env node
/* eslint-env node */
/**
 * Pictures to judge CLIP by: for each search, one image with the photos the
 * search showed (look-alikes marked), numbered, with their distance to the
 * query, then the nearest photos CLIP did NOT let in (to see what a looser
 * cutoff would add). Look at a sheet and record verdicts with judge.js.
 *
 *   node device/sheet.js q00405 p0004 …       chosen searches
 *   node device/sheet.js --kind picture       every search of a kind
 *   node device/sheet.js --worst 20           the 20 searches with most look-alikes
 *   options: --set NAME (searches in out/device/NAME/), --top 24 (shown results), --beyond 8 (nearest left out), --local (read bench
 *            photos from out/device/media instead of the phone; your own photos always come from the phone)
 *
 * Writes out/device/sheets/<qid>.jpg and <qid>.json (number → file). Photos are
 * copied from the phone into out/device/thumbs/ and stay on this computer.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const flag = name => process.argv.includes(`--${name}`);
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'out')));
// --set NAME: a separate list of searches, e.g. your real gallery's (out/device/NAME/).
const DEV = arg('set') ? path.join(OUT, 'device', arg('set')) : path.join(OUT, 'device');
const SHEETS = path.join(DEV, 'sheets');
const THUMBS = path.join(DEV, 'thumbs');
const TOP = Number(arg('top', 24));
const BEYOND = Number(arg('beyond', 8));
const ADB = process.env.ADB || 'adb';
const SERIAL = arg('serial', null);
const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

const adb = args => spawnSync(ADB, [...(SERIAL ? ['-s', SERIAL] : []), ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });

/** Where a result's photo is on the phone. */
const phonePath = id => {
  if (!id.startsWith('own:')) return `/sdcard/Pictures/PinpointerBench/${id}.jpg`;
  const name = id.slice(4).replace(/'/g, "''");
  const out = adb(['shell', `content query --uri content://media/external/images/media --projection _data --where "_display_name='${name}'"`]).stdout || '';
  const m = out.match(/_data=([^\n,]+)/);
  return m ? m[1].trim() : null;
};

/** A local copy of the photo, or null (PDFs and missing files have none). */
const localCopy = id => {
  if (/\.pdf$/i.test(id)) return null;
  if (flag('local') && !id.startsWith('own:')) {
    const f = path.join(OUT, 'device', 'media', 'Pictures', `${id}.jpg`);
    return fs.existsSync(f) ? f : null;
  }
  const file = path.join(THUMBS, id.replace(/[^\w.-]/g, '_') + (id.startsWith('own:') ? '' : '.jpg'));
  if (fs.existsSync(file)) return file;
  const from = phonePath(id);
  if (!from) return null;
  fs.mkdirSync(THUMBS, { recursive: true });
  const r = adb(['pull', from, file]);
  return r.status === 0 && fs.existsSync(file) ? file : null;
};

const main = async () => {
  const results = readJsonl(path.join(DEV, 'results.jsonl'));
  const queries = new Map(readJsonl(path.join(DEV, 'queries.jsonl')).map(q => [q.qid, q]));
  let chosen = process.argv.slice(2).filter(a => /^[a-z]\d+$/i.test(a));
  if (arg('kind')) chosen = results.filter(r => queries.get(r.qid)?.kind === arg('kind')).map(r => r.qid);
  if (arg('worst')) {
    const added = r => (r.ids ?? []).filter(id => !(r.wordIds ?? []).includes(id)).length;
    chosen = [...results].sort((a, b) => added(b) - added(a)).slice(0, Number(arg('worst'))).map(r => r.qid);
  }
  if (chosen.length === 0) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\* eslint-env node \*\/\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
    process.exit(1);
  }
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('Playwright is missing: npm install in tools/search-bench, then npx playwright install chromium.');
    process.exit(1);
  }
  fs.mkdirSync(SHEETS, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  for (const qid of chosen) {
    const r = results.find(x => x.qid === qid);
    const q = queries.get(qid);
    if (!r || !q) {
      console.log(`${qid}: no result`);
      continue;
    }
    const words = new Set(r.wordIds ?? []);
    const dist = new Map((r.look?.nearest ?? []).map(n => [n.id, n.d]));
    const shown = (r.ids ?? []).slice(0, TOP).map(id => ({ id, look: !words.has(id), d: dist.get(id) }));
    const shownSet = new Set(r.ids ?? []);
    const beyond = (r.look?.nearest ?? []).filter(n => !shownSet.has(n.id)).slice(0, BEYOND).map(n => ({ id: n.id, look: true, d: n.d, out: true }));
    const items = [...shown, ...beyond].map((it, i) => ({ ...it, n: i + 1, file: localCopy(it.id) }));
    const cells = items
      .map(it => {
        const img = it.file ? `<img src="data:image/jpeg;base64,${fs.readFileSync(it.file).toString('base64')}">` : `<div class="none">${it.id.endsWith('.pdf') || /pdf/i.test(it.id) ? 'PDF' : 'no image'}</div>`;
        const tag = it.out ? 'left out' : it.look ? 'CLIP' : 'words';
        return `<div class="cell ${it.out ? 'out' : it.look ? 'look' : 'word'}">${img}<div class="cap"><b>${it.n}</b> ${tag}${it.d != null ? ` · ${it.d.toFixed(3)}` : ''}</div></div>`;
      })
      .join('');
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;font:16px sans-serif;background:#fff}
      h1{font-size:22px;margin:12px 16px 4px} p{margin:0 16px 10px;color:#444}
      .grid{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;padding:0 16px 16px}
      .cell{border:4px solid #ccc;border-radius:6px;overflow:hidden;background:#eee}
      .cell.look{border-color:#7b2ff7}.cell.word{border-color:#1faa59}.cell.out{border-color:#999;opacity:.75;border-style:dashed}
      img{width:100%;height:170px;object-fit:contain;background:#222;display:block}.none{height:170px;display:flex;align-items:center;justify-content:center;color:#666}
      .cap{padding:3px 6px;font-size:14px}</style>
      <h1>${qid} · “${q.text.replace(/</g, '&lt;')}” → CLIP saw “${(r.clipText ?? '—').replace(/</g, '&lt;')}”</h1>
      <p>green = found by words · purple = added by CLIP · dashed = nearest photos CLIP left out · number = distance (cutoff ${r.look?.limit?.toFixed(3) ?? '—'}, far ${r.look?.far?.toFixed(3) ?? '—'})</p>
      <div class="grid">${cells}</div>`;
    await page.setContent(html);
    await page.screenshot({ path: path.join(SHEETS, `${qid}.jpg`), type: 'jpeg', quality: 80, fullPage: true });
    fs.writeFileSync(path.join(SHEETS, `${qid}.json`), JSON.stringify({ qid, text: q.text, items: items.map(({ n, id, look, out, d }) => ({ n, id, look, out: !!out, d })) }, null, 1));
    console.log(`${qid}: ${path.join(SHEETS, `${qid}.jpg`)} (${items.length} photos)`);
  }
  await browser.close();
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
