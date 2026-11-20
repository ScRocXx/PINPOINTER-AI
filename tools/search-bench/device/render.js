#!/usr/bin/env node
/* eslint-env node */
/**
 * Draws the test gallery as real files for a phone: photos of papers and
 * cards (tilted, on a table, a little blurred), crisp phone screenshots (UPI,
 * chats, SMS), greetings, and PDFs. Each JPEG carries the date it was "taken"
 * (EXIF DateTimeOriginal, IST), which Android's gallery reads, and the file's
 * modification time matches.
 *
 *   node device/render.js [--out out] [--coco DIR] [--only 200]
 *
 * Writes out/device/media/Pictures/*.jpg and out/device/media/Download/*.pdf.
 * Photos without text (most of a gallery) come from --coco: a folder of COCO
 * val2017 images (device/photos.js lists which image stands for which photo and
 * what is in it). Without --coco they are left out, and the "what a photo
 * shows" searches are skipped on the phone.
 *
 * Needs Playwright with Chromium: npm install (in tools/search-bench), then
 * npx playwright install chromium.
 */
const fs = require('fs');
const path = require('path');
const { exifJpeg } = require('./exif');

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'out')));
const ONLY = Number(arg('only', 0));
const COCO = arg('coco', null);
const MEDIA = path.join(OUT, 'device', 'media');
const FONTS = path.resolve(__dirname, '..', '..', '..', 'android', 'app', 'src', 'main', 'assets', 'fonts');

const readJsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

// Deterministic per-document variation (tilt, light, surface).
// eslint-disable-next-line no-bitwise -- a string hash
const hash = s => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const vary = (id, salt, min, max) => min + ((hash(id + salt) % 1000) / 1000) * (max - min);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// The app's own font (Latin + Devanagari), embedded so the page needs no file access.
const fontFaces = ['Regular', 'SemiBold', 'Bold', 'ExtraBold']
  .map(w => `@font-face{font-family:'Mukta ${w}';src:url(data:font/ttf;base64,${fs.readFileSync(path.join(FONTS, `Mukta-${w}.ttf`)).toString('base64')});}`)
  .join('');

/** Screens are drawn at phone size; papers as a photo of a page on a surface. */
const SCREEN = new Set(['upi', 'sms', 'chat', 'recharge', 'news', 'ticket-app', 'flight']);

const lineHtml = (lines, first = 'title') =>
  lines.map((l, i) => `<div class="${i === 0 ? first : 'line'}">${esc(l)}</div>`).join('');

const body = d => {
  const L = d.lines;
  switch (d.style) {
    case 'upi':
      return `<div class="app">${esc(L[0])}</div><div class="tick">✓</div><div class="ok">${esc(L[1])}</div><div class="amount">${esc(L[2])}</div>${lineHtml(L.slice(3), 'line')}`;
    case 'chat':
      return `<div class="chathead">${esc(L[0])}</div>${L.slice(1).map((l, i) => `<div class="bubble ${i % 2 ? 'me' : ''}">${esc(l)}</div>`).join('')}`;
    case 'sms':
      return `<div class="chathead">${esc(L[0])}</div><div class="bubble">${esc(L.slice(1).join(' '))}</div>`;
    case 'greeting':
      return `<div class="big">${esc(L[0])}</div>${lineHtml(L.slice(1), 'line')}`;
    case 'sign':
      return `<div class="big">${esc(L[0])}</div>${lineHtml(L.slice(1), 'line')}`;
    default:
      return lineHtml(L);
  }
};

const css = d => {
  const tilt = SCREEN.has(d.style) ? 0 : vary(d.id, 't', -4, 4);
  const blur = SCREEN.has(d.style) || d.ocrLevel === 'clean' ? 0 : d.ocrLevel === 'light' ? 0.4 : 0.9;
  const light = vary(d.id, 'l', 0.85, 1.05);
  const surface = ['#8b6b4a', '#5d5246', '#c9c2b8', '#3f4a52', '#a08060'][hash(d.id) % 5];
  const paper = {
    bill: 'background:#fdfdf8;font-family:"Mukta Regular";color:#222;',
    receipt: 'background:#fffbea;font-family:"Mukta Regular";color:#333;',
    card: `background:linear-gradient(160deg,#fff 0%,${['#e8f1ff', '#fff3e0', '#e9f7ef'][hash(d.id) % 3]} 100%);border-radius:28px;font-family:"Mukta SemiBold";color:#1d2a3a;`,
    strip: 'background:linear-gradient(135deg,#d9dde2,#f4f6f8 40%,#c4c9cf);font-family:"Mukta Bold";color:#1a1a6e;',
    note: 'background:#fff;font-family:"Mukta Regular";color:#173b8f;',
    report: 'background:#fff;font-family:"Mukta Regular";color:#111;',
    pdf: 'background:#fff;font-family:"Mukta Regular";color:#111;',
    greeting: `background:linear-gradient(135deg,${['#ff9a3c,#ffd166', '#7b2ff7,#f107a3', '#11998e,#38ef7d', '#e65c00,#f9d423'][hash(d.id) % 4]});font-family:"Mukta Bold";color:#fff;text-align:center;text-shadow:0 2px 6px rgba(0,0,0,.35);`,
    sign: `background:${['#c62828', '#1565c0', '#2e7d32', '#f9a825'][hash(d.id) % 4]};font-family:"Mukta ExtraBold","Mukta Bold";color:#fff;text-align:center;`,
  }[d.style] ?? 'background:#fff;font-family:"Mukta Regular";color:#111;';
  return `html,body{margin:0;padding:0;}
  body{background:${SCREEN.has(d.style) ? '#fff' : surface};width:${SCREEN.has(d.style) ? 540 : 900}px;min-height:${SCREEN.has(d.style) ? 1200 : 1200}px;display:flex;align-items:center;justify-content:center;}
  #shot{${SCREEN.has(d.style) ? 'width:540px;min-height:1200px;padding:40px 28px;box-sizing:border-box;background:#fff;font-family:"Mukta Regular";color:#111;' : `width:700px;padding:48px 44px;box-sizing:border-box;${paper}transform:rotate(${tilt}deg);box-shadow:0 18px 40px rgba(0,0,0,.45);filter:blur(${blur}px) brightness(${light});`}}
  .title{font-family:"Mukta Bold";font-size:${SCREEN.has(d.style) ? 30 : 34}px;line-height:1.25;margin-bottom:12px;}
  .line{font-size:${SCREEN.has(d.style) ? 24 : 26}px;line-height:1.45;}
  .big{font-size:58px;line-height:1.15;margin:30px 0 24px;}
  .app{font-family:"Mukta Bold";font-size:28px;color:#5f259f;margin-bottom:60px;}
  .tick{width:110px;height:110px;border-radius:55px;background:#1faa59;color:#fff;font-size:70px;text-align:center;line-height:110px;margin:0 auto 24px;}
  .ok{text-align:center;font-family:"Mukta SemiBold";font-size:30px;}
  .amount{text-align:center;font-family:"Mukta Bold";font-size:64px;margin:10px 0 40px;}
  .chathead{background:#075e54;color:#fff;font-family:"Mukta SemiBold";font-size:28px;padding:18px 20px;margin:-40px -28px 24px;}
  .bubble{background:#fff;border-radius:12px;padding:12px 16px;margin:10px 60px 10px 0;font-size:24px;box-shadow:0 1px 1px rgba(0,0,0,.15);}
  .bubble.me{background:#dcf8c6;margin:10px 0 10px 60px;}
  ${d.style === 'chat' || d.style === 'sms' ? '#shot{background:#ece5dd !important;}' : ''}`;
};

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces}</style><style id="look"></style></head><body><div id="shot"></div></body></html>`;

/** Draws one document into the already-open page (fonts load once). */
const draw = async (page, d) => {
  await page.evaluate(([look, html]) => {
    document.getElementById('look').textContent = look;
    document.getElementById('shot').innerHTML = html;
  }, [css(d), body(d)]);
  await page.evaluate(() => document.fonts.ready);
};

const main = async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('Playwright is missing: run "npm install" in tools/search-bench, then "npx playwright install chromium".');
    process.exit(1);
  }
  const docs = readJsonl(path.join(OUT, 'corpus.jsonl'));
  const textDocs = docs.filter(d => d.lines && !d.copyOf);
  const todo = ONLY ? textDocs.slice(0, ONLY) : textDocs;
  fs.mkdirSync(path.join(MEDIA, 'Pictures'), { recursive: true });
  fs.mkdirSync(path.join(MEDIA, 'Download'), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 }, deviceScaleFactor: 1.5 });
  await page.setContent(PAGE, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  let n = 0;
  const t0 = Date.now();
  for (const d of todo) {
    if (d.kind === 'DOCUMENT') {
      const file = path.join(MEDIA, 'Download', `${d.id}.pdf`);
      if (!fs.existsSync(file)) {
        await draw(page, { ...d, style: 'pdf' });
        await page.pdf({ path: file, format: 'A4', printBackground: true });
      }
      fs.utimesSync(file, d.takenAt / 1000, d.takenAt / 1000);
    } else {
      const file = path.join(MEDIA, 'Pictures', `${d.id}.jpg`);
      if (!fs.existsSync(file)) {
        await page.setViewportSize(SCREEN.has(d.style) ? { width: 540, height: 1200 } : { width: 900, height: 1200 });
        await draw(page, d);
        const jpg = await page.screenshot({ type: 'jpeg', quality: 82, fullPage: true });
        fs.writeFileSync(file, exifJpeg(jpg, d.takenAt));
      }
      fs.utimesSync(file, d.takenAt / 1000, d.takenAt / 1000);
    }
    if (++n % 100 === 0) process.stdout.write(`\r${n} of ${todo.length} drawn (${Math.round((Date.now() - t0) / n)} ms each)`);
  }
  await browser.close();

  // Byte-identical WhatsApp copies: the same file under another name.
  let copies = 0;
  for (const d of docs.filter(x => x.copyOf)) {
    const src = path.join(MEDIA, 'Pictures', `${d.copyOf}.jpg`);
    if (!fs.existsSync(src)) continue;
    const file = path.join(MEDIA, 'Pictures', `${d.id}.jpg`);
    fs.copyFileSync(src, file);
    fs.utimesSync(file, d.takenAt / 1000, d.takenAt / 1000);
    copies++;
  }

  // Photos without text: COCO images (see photos.js), dated like the gallery.
  let photos = 0;
  const mapFile = path.join(OUT, 'device', 'photos.json');
  if (COCO && fs.existsSync(mapFile)) {
    const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    const byId = new Map(docs.map(d => [d.id, d]));
    for (const [id, entry] of Object.entries(map.photos)) {
      const d = byId.get(id);
      const file = path.join(MEDIA, 'Pictures', `${id}.jpg`);
      if (!fs.existsSync(file)) fs.writeFileSync(file, exifJpeg(fs.readFileSync(path.join(COCO, entry.file)), d.takenAt));
      fs.utimesSync(file, d.takenAt / 1000, d.takenAt / 1000);
      photos++;
    }
  }
  console.log(`\n${n} papers and screenshots, ${copies} copies, ${photos} photos → ${MEDIA}`);
};

main().catch(e => {
  console.error(e);
  process.exit(1);
});
