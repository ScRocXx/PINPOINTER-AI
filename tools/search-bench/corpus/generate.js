#!/usr/bin/env node
/* eslint-env node */
/**
 * Builds the test gallery and the questions to ask it.
 *
 *   node corpus/generate.js [--size 10000] [--seed 7] [--now 2026-11-20] [--out out]
 *
 * Writes, in --out (default tools/search-bench/out):
 *   corpus.jsonl   one line per photo / PDF: what it shows (lines of text, the
 *                  look it is drawn with), what OCR may read from it (`ocr`,
 *                  with simulated misreadings), when it was taken, its kind.
 *   queries.jsonl  one line per search, with the right answer: the photos it
 *                  must find (`expect.ids`), may find (`also`), a rule the
 *                  scorer works out at run time (dates relative to the run),
 *                  or nothing at all (`mode: none`).
 *   meta.json      sizes, seed, the date it was made for.
 *
 * Everything is fixed by the seed: the same command gives the same gallery.
 * The device bench draws corpus.jsonl into images and PDFs
 * (device/render.js); the desk bench indexes the `ocr` text directly.
 */
const fs = require('fs');
const path = require('path');
const P = require('./pools');

// ─── Options ────────────────────────────────────────────────────────────────
const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
};
const SIZE = Number(arg('size', 10000));
const SEED = Number(arg('seed', 7));
const NOW = new Date(`${arg('now', new Date().toISOString().slice(0, 10))}T18:00:00+05:30`).getTime();
const OUT = path.resolve(arg('out', path.join(__dirname, '..', 'out')));

// ─── Deterministic randomness ───────────────────────────────────────────────
/* eslint-disable no-bitwise -- a seeded random number generator works on bits */
let seed = SEED >>> 0 || 1;
const rnd = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/* eslint-enable no-bitwise */
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
const chance = p => rnd() < p;
const digits = n => Array.from({ length: n }, (_, i) => (i === 0 ? int(1, 9) : int(0, 9))).join('');
const shuffle = a => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ─── Dates ──────────────────────────────────────────────────────────────────
const DAY = 86400000;
const IST = 5.5 * 3600000;
const START = new Date('2023-01-01T00:00:00+05:30').getTime();
/** A time between START and NOW, more of them recent (as in a real gallery). */
const randomTaken = () => {
  const span = NOW - START;
  const u = Math.pow(rnd(), 0.7);
  return NOW - Math.floor(u * span) - int(0, 3600000);
};
const istParts = ms => {
  const d = new Date(ms + IST);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
};
const pad = n => String(n).padStart(2, '0');
const dmy = ms => {
  const p = istParts(ms);
  return `${pad(p.d)}/${pad(p.m + 1)}/${p.y}`;
};
const dMonY = ms => {
  const p = istParts(ms);
  return `${pad(p.d)}-${P.MONTHS_EN[p.m].slice(0, 3)}-${p.y}`;
};
const atIst = (iso, hour = 12) => new Date(`${iso}T${pad(hour)}:${pad(int(0, 59))}:00+05:30`).getTime();

// ─── Numbers that look real but aren't ──────────────────────────────────────
// Verhoeff tables (Aadhaar's check digit): numbers that pass are regenerated,
// so no generated "Aadhaar number" can be a real one.
const VD = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VP = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const verhoeffValid = num => {
  let c = 0;
  [...num].reverse().forEach((ch, i) => { c = VD[c][VP[i % 8][Number(ch)]]; });
  return c === 0;
};
const fakeAadhaar = () => {
  for (;;) {
    const n = String(int(2, 9)) + digits(11);
    if (!verhoeffValid(n)) return `${n.slice(0, 4)} ${n.slice(4, 8)} ${n.slice(8)}`;
  }
};
const L = () => String.fromCharCode(65 + int(0, 25));
const fakePan = () => `${L()}${L()}${L()}P${L()}${digits(4)}${L()}`;
const fakePhone = () => `${int(6, 9)}${digits(9).slice(0, 9)}`;
const money = (a, b) => {
  const n = int(a, b);
  return n >= 1000 ? `${Math.floor(n / 1000)},${String(n % 1000).padStart(3, '0')}` : String(n);
};

// ─── People ─────────────────────────────────────────────────────────────────
/** A person with English and Hindi spellings. Names repeat across papers, as in a family's gallery. */
const usedFirst = new Set();
/** A person no one else in the gallery shares a first name with (so "Ramesh's bill" has one right answer). */
const person = () => {
  const free = P.PEOPLE.filter(p => !usedFirst.has(p[0]));
  const [first, firstHi, sex] = pick(free.length ? free : P.PEOPLE);
  usedFirst.add(first);
  const [last, lastHi] = pick(P.SURNAMES);
  const city = pick(P.CITIES);
  return { first, last, en: `${first} ${last}`, hi: `${firstHi} ${lastHi}`, sex, city, area: pick(P.AREAS), house: int(1, 450) };
};
const FAMILY = Array.from({ length: 8 }, person);

// ─── OCR misreadings (desk only; on a phone ML Kit makes its own) ───────────
const LATIN_SWAPS = [['rn', 'm'], ['m', 'rn'], ['l', '1'], ['1', 'l'], ['I', 'l'], ['O', '0'], ['0', 'O'], ['S', '5'], ['5', 'S'], ['cl', 'd'], ['e', 'c'], ['h', 'b'], ['u', 'v'], ['B', '8'], ['i', 'l'], ['vv', 'w'], ['.', ','], ['a', 'o']];
const DEVA_SWAPS = [['ि', 'ी'], ['ी', 'ि'], ['ु', 'ू'], ['ू', 'ु'], ['े', 'ै'], ['ब', 'व'], ['व', 'ब'], ['म', 'भ'], ['भ', 'म'], ['घ', 'ध'], ['ध', 'घ'], ['द', 'ढ'], ['त', 'ट'], ['ष', 'प'], ['थ', 'य'], ['ं', ''], ['्', ''], ['़', ''], ['ँ', 'ं'], ['ा', '']];
const misreadWord = w => {
  const deva = /[ऀ-ॿ]/.test(w);
  const swaps = (deva ? DEVA_SWAPS : LATIN_SWAPS).filter(([a]) => w.includes(a));
  if (swaps.length === 0 || (w.length >= 6 && chance(0.15))) {
    if (w.length >= 6) {
      const at = int(2, w.length - 3);
      return `${w.slice(0, at)} ${w.slice(at)}`; // a word split in two
    }
    return w;
  }
  const [a, b] = pick(swaps);
  const idx = [];
  for (let i = w.indexOf(a); i >= 0; i = w.indexOf(a, i + 1)) idx.push(i);
  const at = pick(idx);
  return w.slice(0, at) + b + w.slice(at + a.length);
};
/** What OCR reads from these lines: clean, a few misread words, or many plus dropped lines and junk. */
const ocrRead = (lines, level) => {
  if (level === 'clean') return lines.join('\n');
  const rate = level === 'light' ? 0.04 : 0.12;
  const out = [];
  for (const line of lines) {
    if (level === 'heavy' && chance(0.08)) continue; // a line OCR missed
    let words = line.split(' ').map(w => (w.length >= 3 && chance(rate) ? misreadWord(w) : w));
    if (level === 'heavy' && chance(0.1)) words = [...words, pick(['|', '~', '—', 'll', ':', ',,'])];
    out.push(words.join(' '));
  }
  return out.join('\n');
};
const noiseLevel = style => {
  // Screenshots are read cleanly; photos of paper less so.
  const screen = ['upi', 'sms', 'chat', 'recharge', 'news', 'ticket-app', 'flight', 'app', 'app-dark'].includes(style);
  const r = rnd();
  if (screen) return r < 0.85 ? 'clean' : 'light';
  return r < 0.4 ? 'clean' : r < 0.8 ? 'light' : 'heavy';
};

// ─── Query helpers ──────────────────────────────────────────────────────────
const KEYS = 'qwertyuiop|asdfghjkl|zxcvbnm'.split('|');
const neighbours = ch => {
  for (let r = 0; r < KEYS.length; r++) {
    const c = KEYS[r].indexOf(ch);
    if (c >= 0) return [KEYS[r][c - 1], KEYS[r][c + 1], KEYS[r - 1]?.[c], KEYS[r + 1]?.[c]].filter(Boolean);
  }
  return [];
};
/** One phone-keyboard typo in a word of 4+ letters: neighbouring key, missed key, extra key, swapped keys. */
const typo = word => {
  const w = word.toLowerCase();
  if (w.length < 4 || !/^[a-z]+$/.test(w)) return null;
  const i = int(1, w.length - 2);
  const r = rnd();
  if (r < 0.4) {
    const n = neighbours(w[i]);
    return n.length ? w.slice(0, i) + pick(n) + w.slice(i + 1) : null;
  }
  if (r < 0.65) return w.slice(0, i) + w.slice(i + 1);
  if (r < 0.85) {
    const n = neighbours(w[i]);
    return n.length ? w.slice(0, i) + pick(n) + w.slice(i) : null;
  }
  return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
};
/** The query with one typo in its longest Latin word, or null. */
const withTypo = q => {
  const words = q.split(' ');
  const order = words.map((w, i) => [w.length, i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    const t = typo(words[i]);
    if (t && t !== words[i].toLowerCase()) return words.map((w, j) => (j === i ? t : w.toLowerCase())).join(' ');
  }
  return null;
};

// ─── The gallery ────────────────────────────────────────────────────────────
const docs = [];
const queries = [];
let nextDoc = 1;
let nextQuery = 1;

/** Adds one photo or PDF. Returns its id. */
/** Phone-screen styles: saved as PNG screenshots in Pictures/Screenshots, with the phone's status bar. */
const SCREEN_STYLES = new Set(['upi', 'sms', 'chat', 'recharge', 'news', 'ticket-app', 'flight', 'app', 'app-dark']);
const statusBar = t => {
  const p = istParts(t);
  return `${pad(p.h)}:${pad(p.mi)}  ${pick(['4G', '5G', 'VoLTE 4G', 'Wi-Fi'])}  ${int(8, 100)}%`;
};

const addDoc = d => {
  const id = `d${String(nextDoc++).padStart(5, '0')}`;
  const takenAt = d.takenAt ?? randomTaken();
  const screen = SCREEN_STYLES.has(d.style) && d.kind !== 'DOCUMENT';
  // A screenshot shows the phone's status bar too: OCR reads it like any text.
  const lines = d.pages ? d.pages.flat() : d.lines ? (screen && !d.copyOf ? [statusBar(takenAt), ...d.lines] : d.lines) : null;
  const level = lines ? (d.pdfKind === 'digital' ? 'clean' : noiseLevel(d.style)) : 'clean';
  const doc = {
    id,
    kind: d.kind ?? 'IMAGE',
    category: d.category,
    style: d.style,
    lang: d.lang ?? 'none',
    lines,
    // PDFs: the text page by page (the app reads the first 500 characters of pages 1-3).
    pages: d.pages ?? null,
    pagesOcr: d.pages ? d.pages.map(pg => ocrRead(pg, level)) : null,
    pdfKind: d.pdfKind ?? null,
    password: d.password ?? null,
    labels: d.labels ?? null,
    theme: d.theme ?? null,
    ocrLevel: level,
    ocr: lines ? ocrRead(lines, level) : null,
    detection: lines ? 'TEXT' : d.labels ? 'OBJECT' : 'EMPTY',
    takenAt,
    series: d.series ?? null,
    copyOf: d.copyOf ?? null,
    person: d.person ?? null,
    // Where it lives on the phone, and its file name (always starting with the id).
    folder: d.folder ?? (d.kind === 'DOCUMENT' ? 'Download' : screen ? 'Screenshots' : 'Pictures'),
    format: d.kind === 'DOCUMENT' ? 'pdf' : screen ? 'png' : 'jpg',
    fileName: null,
  };
  doc.fileName = `${id}${d.fileName ? `_${d.fileName}` : ''}.${doc.format}`;
  docs.push(doc);
  return id;
};

/**
 * Adds a search. mode: 'one' (any of expect.ids is the right answer; rank
 * matters), 'set' (all of expect.ids should be found), 'first' (the top
 * result must be one of expect.ids), 'none' (nothing should be found),
 * 'smoke' (no right answer; only must not crash or hang).
 */
const ask = (text, kind, lang, mode, ids = [], extra = {}) => {
  if (!text || !text.trim()) return;
  queries.push({ qid: `q${String(nextQuery++).padStart(5, '0')}`, text, kind, lang, mode, expect: { ids }, ...extra });
};

// ── Bills: series of monthly bills, the hardest everyday search ─────────────
const billSeries = [];
for (let s = 0; s < 8; s++) {
  const who = s < 4 ? FAMILY[s] : person();
  const co = P.POWER[s % P.POWER.length];
  const acct = digits(co.acct);
  const lang = ['en', 'mix', 'hi', 'mix', 'en', 'mix', 'hi', 'en'][s];
  const months = int(8, 14);
  const series = `power-${s}`;
  const ids = [];
  for (let k = months - 1; k >= 0; k--) {
    const billDate = NOW - k * 30 * DAY - int(5, 25) * DAY;
    const p = istParts(billDate);
    const due = billDate + 15 * DAY;
    const amt = money(380, 4800);
    const units = int(60, 720);
    const en = [co.en, 'Electricity Bill', `${co.label}: ${acct}`, `Name: ${who.en.toUpperCase()}`, `Address: H.No. ${who.house}, ${who.area}, ${who.city[0]}`,
      `Bill Month: ${P.MONTHS_EN[p.m].slice(0, 3).toUpperCase()}-${p.y}`, `Bill Date: ${dmy(billDate)}`, `Units Consumed: ${units}`, `Amount Payable: Rs ${amt}.00`, `Due Date: ${dmy(due)}`, `Pay online at ${co.site}`];
    const hi = [co.hi, 'बिजली बिल', `उपभोक्ता संख्या: ${acct}`, `नाम: ${who.hi}`, `पता: ${who.house}, ${who.city[1]}`, `बिल माह: ${P.MONTHS_HI[p.m]} ${p.y}`, `बिल दिनांक: ${dmy(billDate)}`,
      `खपत यूनिट: ${units}`, `देय राशि: ₹${amt}`, `अंतिम तिथि: ${dmy(due)}`];
    const lines = lang === 'en' ? en : lang === 'hi' ? hi : [...hi.slice(0, 2), ...en.slice(1)];
    ids.push(addDoc({ category: 'electricity', style: 'bill', lang, lines, takenAt: billDate + int(1, 9) * DAY, series, person: who.en }));
  }
  billSeries.push({ series, ids, who, co, acct, lang });
  // The newest bill of this connection.
  const newest = ids[ids.length - 1];
  if (lang !== 'hi') ask(`${who.first} latest electricity bill`, 'latest', 'en', 'first', [newest], { note: 'newest of this series first' });
  ask(`${who.first.toLowerCase()} ka latest bijli bill`, 'latest', 'hinglish', 'first', [newest]);
  ask(`${who.hi.split(' ')[0]} का सबसे नया बिजली बिल`, 'latest', 'hi', 'first', [newest]);
  ask(`${co.en.split(' ')[0]} bill ${who.first}`, 'exact', 'en', 'set', ids);
  ask(`${co.short} bill ${who.first}`, 'abbrev', 'en', 'set', ids, { note: 'short name the bill may not print' });
  ask(acct, 'number', 'en', 'set', ids, { note: 'account number printed on every bill' });
  ask(`${who.first.toLowerCase()} bijli bill kitna`, 'answer', 'hinglish', 'set', ids);
}
const allPower = billSeries.flatMap(s => s.ids);
ask('latest electricity bill', 'latest', 'en', 'first', billSeries.map(s => s.ids[s.ids.length - 1]));
ask('pichla bijli bill', 'latest', 'hinglish', 'first', billSeries.map(s => s.ids[s.ids.length - 1]));
ask('सबसे नया बिजली बिल', 'latest', 'hi', 'first', billSeries.map(s => s.ids[s.ids.length - 1]));
ask('electricity bill', 'concept', 'en', 'set', allPower);
ask('bijli bill', 'concept', 'hinglish', 'set', allPower);
ask('बिजली का बिल', 'concept', 'hi', 'set', allPower);
ask('bijlee ka bil', 'voice', 'hinglish', 'set', allPower, { note: 'voice-style spelling' });
ask('electric bill', 'concept', 'en', 'set', allPower);
ask('light bill', 'concept', 'en', 'set', allPower, { note: 'what many people call it' });

// Water and gas
const waterIds = [];
for (let s = 0; s < 2; s++) {
  const who = FAMILY[s + 2];
  const wb = P.WATER[s];
  const kno = digits(10);
  for (let k = 0; k < 6; k++) {
    const bd = NOW - k * 60 * DAY - int(3, 20) * DAY;
    const amt = money(150, 1400);
    const lines = [wb.en, wb.hi, 'Water Bill / जल बिल', `${wb.label}: ${kno}`, `Consumer Name: ${who.en}`, `Bill Date: ${dmy(bd)}`, `Net Amount: Rs ${amt}`, `Due Date: ${dmy(bd + 21 * DAY)}`];
    waterIds.push(addDoc({ category: 'water', style: 'bill', lang: 'mix', lines, takenAt: bd + int(1, 6) * DAY, series: `water-${s}`, person: who.en }));
  }
}
ask('water bill', 'concept', 'en', 'set', waterIds);
ask('paani ka bill', 'concept', 'hinglish', 'set', waterIds);
ask('पानी का बिल', 'concept', 'hi', 'set', waterIds);

const gasIds = [];
for (let k = 0; k < 18; k++) {
  const g = P.GAS[k % 3];
  const who = FAMILY[k % 4];
  const t = randomTaken();
  const lang = k % 3 === 0 ? 'hi' : 'en';
  const lines = lang === 'en'
    ? [g.en, g.company, 'LPG Cash Memo', `Consumer No: ${digits(7)}`, `Name: ${who.en}`, `Booking Date: ${dmy(t - 2 * DAY)}`, `Delivery Date: ${dmy(t)}`, `14.2 Kg Cylinder Refill`, `Amount: Rs ${int(803, 1103)}.00`]
    : [g.hi, 'एलपीजी गैस सिलेंडर', 'कैश मेमो', `उपभोक्ता संख्या: ${digits(7)}`, `नाम: ${who.hi}`, `बुकिंग दिनांक: ${dmy(t - 2 * DAY)}`, `राशि: ₹${int(803, 1103)}`];
  gasIds.push(addDoc({ category: 'gas', style: 'receipt', lang, lines, takenAt: t, person: who.en }));
}
ask('gas cylinder', 'concept', 'en', 'set', gasIds);
ask('gas ki parchi', 'concept', 'hinglish', 'set', gasIds);
ask('गैस सिलेंडर', 'concept', 'hi', 'set', gasIds);
ask('indane', 'cross', 'en', 'set', gasIds.filter((_, k) => k % 3 === 0), { note: 'Indane receipts here are Hindi-only (इंडेन)' });
ask('hp gas', 'exact', 'en', 'set', gasIds.filter((_, k) => k % 3 === 1));
ask('lpg', 'exact', 'en', 'set', gasIds.filter((_, k) => k % 3 !== 0), { also: gasIds.filter((_, k) => k % 3 === 0) });

// ── ID cards ─────────────────────────────────────────────────────────────────
const idIds = [];
const idOf = {};
FAMILY.forEach((who, n) => {
  const aad = fakeAadhaar();
  const dob = `${pad(int(1, 28))}/${pad(int(1, 12))}/${int(1945, 2005)}`;
  const front = ['भारत सरकार', 'Government of India', who.hi, who.en, `जन्म तिथि/DOB: ${dob}`, who.sex === 'M' ? 'पुरुष/ MALE' : 'महिला/ FEMALE', aad, 'मेरा आधार, मेरी पहचान'];
  const a = addDoc({ category: 'id', style: 'card', lang: 'mix', lines: front, person: who.en });
  const back = ['भारतीय विशिष्ट पहचान प्राधिकरण', 'Unique Identification Authority of India', `पता: ${who.house}, ${who.area}, ${who.city[1]}, ${who.city[3]} - ${who.city[4]}`,
    `Address: H.No. ${who.house}, ${who.area}, ${who.city[0]}, ${who.city[2]} - ${who.city[4]}`, aad, '1947', 'help@uidai.gov.in', 'www.uidai.gov.in'];
  const b = addDoc({ category: 'id', style: 'card', lang: 'mix', lines: back, person: who.en });
  idIds.push(a, b);
  idOf[who.en] = [a, b];
  ask(`${who.first} aadhaar`, 'exact', 'en', 'one', [a, b]);
  ask(`${who.first.toLowerCase()} ka aadhar card`, 'natural', 'hinglish', 'one', [a, b]);
  ask(`${who.hi.split(' ')[0]} का आधार कार्ड`, 'exact', 'hi', 'one', [a, b]);
  ask(`adhar card ${who.first.toLowerCase()} ${who.last.toLowerCase()}`, 'voice', 'en', 'one', [a, b]);
  ask(aad.slice(-4), 'number', 'en', 'one', [a, b], { note: 'last 4 digits stay after masking' });
  ask(aad, 'privacy', 'en', 'none', [], { note: 'a full Aadhaar number is masked before storing, so it must not be findable' });
  ask(aad.replace(/ /g, ''), 'privacy', 'en', 'none', []);

  if (n < 6) {
    const pan = fakePan();
    const lines = ['आयकर विभाग', 'INCOME TAX DEPARTMENT', 'भारत सरकार', 'GOVT. OF INDIA', 'स्थायी लेखा संख्या कार्ड', 'Permanent Account Number Card', pan, 'नाम / Name', who.en.toUpperCase(),
      "पिता का नाम / Father's Name", `${pick(P.PEOPLE)[0].toUpperCase()} ${who.last.toUpperCase()}`, 'जन्म की तारीख / Date of Birth', dob];
    const id = addDoc({ category: 'id', style: 'card', lang: 'mix', lines, person: who.en });
    idIds.push(id);
    ask(`${who.first} pan card`, 'exact', 'en', 'one', [id]);
    ask(`${who.hi.split(' ')[0]} का पैन कार्ड`, 'exact', 'hi', 'one', [id]);
    ask(pan, 'number', 'en', 'one', [id], { note: 'the PAN is stored masked (ABCDE****F); finding the card by it is fine, the full number is not stored' });
  }
  if (n < 5) {
    const epic = `${L()}${L()}${L()}${digits(7)}`;
    const lines = ['भारत निर्वाचन आयोग', 'ELECTION COMMISSION OF INDIA', 'पहचान पत्र', 'IDENTITY CARD', epic, `निर्वाचक का नाम : ${who.hi}`, `Elector's Name : ${who.en}`, `लिंग / Sex : ${who.sex === 'M' ? 'पुरुष / Male' : 'महिला / Female'}`];
    const id = addDoc({ category: 'id', style: 'card', lang: 'mix', lines, person: who.en });
    idIds.push(id);
    ask(`${who.first.toLowerCase()} voter id`, 'exact', 'en', 'one', [id]);
    ask(`${who.hi.split(' ')[0]} वोटर कार्ड`, 'exact', 'hi', 'one', [id]);
    ask(epic, 'number', 'en', 'one', [id]);
  }
  if (n < 4) {
    const dl = `UP32 ${int(2005, 2022)}00${digits(5)}`;
    const lines = ['INDIAN UNION DRIVING LICENCE', `Issued by Government of ${who.city[2]}`, `DL No: ${dl}`, `Name: ${who.en.toUpperCase()}`, `DOB: ${dob}`, `Valid Till: ${pad(int(1, 28))}-${pad(int(1, 12))}-${int(2027, 2040)}`, 'COV: LMV, MCWG'];
    const id = addDoc({ category: 'id', style: 'card', lang: 'en', lines, person: who.en });
    idIds.push(id);
    ask(`${who.first} driving licence`, 'exact', 'en', 'one', [id]);
    ask(`${who.first.toLowerCase()} ka license`, 'natural', 'hinglish', 'one', [id]);
  }
  if (n < 3) {
    const lines = ['राशन कार्ड', 'खाद्य एवं रसद विभाग', `${who.city[3]}`, `कार्ड संख्या: ${digits(12).slice(0, 12)}`, `परिवार के मुखिया का नाम: ${who.hi}`, 'पात्र गृहस्थी', `सदस्यों की संख्या: ${int(2, 7)}`];
    const id = addDoc({ category: 'id', style: 'card', lang: 'hi', lines, person: who.en });
    idIds.push(id);
    ask(`${who.first.toLowerCase()} ration card`, 'cross', 'hinglish', 'one', [id], { note: 'Hinglish query, Hindi-only card' });
    ask('राशन कार्ड', 'exact', 'hi', 'one', [id]);
  }
  if (n < 2) {
    const lines = ['REPUBLIC OF INDIA', 'भारत गणराज्य', 'PASSPORT', 'पासपोर्ट', `Surname: ${who.last.toUpperCase()}`, `Given Name(s): ${who.first.toUpperCase()}`, `Place of Birth: ${who.city[0].toUpperCase()}`,
      `P<IND${who.last.toUpperCase()}<<${who.first.toUpperCase()}<<<<<<<<<<<<<<<<<<<`];
    const id = addDoc({ category: 'id', style: 'card', lang: 'mix', lines, person: who.en });
    idIds.push(id);
    ask(`${who.first} passport`, 'exact', 'en', 'one', [id]);
  }
});

// ── Health ───────────────────────────────────────────────────────────────────
const medIds = [];
const rxIds = [];
const medByBrand = {};
for (let k = 0; k < 30; k++) {
  const [brand, generic, strength, form] = P.MEDICINES[k % P.MEDICINES.length];
  const mfg = int(1, 12);
  const lines = [brand, `${generic} ${form === 'Syrup' ? 'Oral Solution' : form === 'Cap' ? 'Capsules' : 'Tablets'} IP ${strength}`.trim(), `Mfd. by: ${pick(P.PHARMA)}`,
    `B.No. ${L()}${digits(5)}`, `Mfg. ${pad(mfg)}/2025  Exp. ${pad(mfg)}/2027`, `M.R.P. Rs.${int(18, 240)}.${pad(int(0, 99))} per strip of 10 ${form === 'Cap' ? 'capsules' : 'tablets'}`, 'Store below 25°C'];
  const id = addDoc({ category: 'medicine', style: 'strip', lang: 'en', lines });
  medIds.push(id);
  (medByBrand[brand] = medByBrand[brand] || []).push(id);
}
const rxMeds = {};
for (let k = 0; k < 24; k++) {
  const [doc, deg] = P.DOCTORS[k % P.DOCTORS.length];
  const who = FAMILY[k % FAMILY.length];
  const meds = shuffle([...P.MEDICINES]).slice(0, int(2, 4));
  const t = randomTaken();
  const hindi = k % 3 === 0;
  const lines = [`Dr. ${doc}`, deg, P.CLINICS[k % P.CLINICS.length], `Name: ${who.en}   Age: ${int(35, 82)}   Sex: ${who.sex}`, `Date: ${dmy(t)}`, 'Rx',
    ...meds.map(([b, , s, f], i) => `${i + 1}. ${f} ${b.split(' ')[0]} ${s}  ${pick(['1-0-1', '1-0-0', '0-0-1', '1-1-1'])}  x ${pick([5, 10, 30])} days  ${hindi ? pick(['खाने के बाद', 'खाने से पहले']) : pick(['after food', 'before food'])}`),
    hindi ? 'एक महीने बाद दिखाएं' : 'Review after 1 month'];
  const id = addDoc({ category: 'prescription', style: 'note', lang: hindi ? 'mix' : 'en', lines, takenAt: t, person: who.en });
  rxIds.push(id);
  rxMeds[id] = meds.map(m => m[0]);
  ask(`dr ${doc.split(' ').pop().toLowerCase()} prescription ${who.first.toLowerCase()}`, 'exact', 'en', 'one', [id]);
}
for (const [brand] of P.MEDICINES.slice(0, 12)) {
  const strips = medByBrand[brand] ?? [];
  const rx = Object.entries(rxMeds).filter(([, m]) => m.includes(brand)).map(([id]) => id);
  const name = brand.split(' ')[0];
  ask(name, 'exact', 'en', 'set', [...strips, ...rx]);
  const t = withTypo(name);
  if (t) ask(t, 'typo', 'en', 'set', [...strips, ...rx]);
}
const generics = ['Telmisartan', 'Metformin', 'Paracetamol', 'Pantoprazole', 'Atorvastatin', 'Azithromycin'];
for (const g of generics) {
  const ids = medIds.filter(id => docs.find(d => d.id === id).lines[1].startsWith(g));
  ask(g.toLowerCase(), 'exact', 'en', 'set', ids);
  const t = withTypo(g);
  if (t) ask(t, 'typo', 'en', 'set', ids);
}
const labIds = [];
for (let k = 0; k < 18; k++) {
  const [test, values] = P.LAB_TESTS[k % P.LAB_TESTS.length];
  const who = FAMILY[k % FAMILY.length];
  const lines = [P.LABS[k % P.LABS.length], `Patient Name: ${who.en}`, `Age/Sex: ${int(35, 80)} Y / ${who.sex}`, `Ref. By: Dr. ${pick(P.DOCTORS)[0]}`, `Collected: ${dmy(randomTaken())}`, test, ...values, 'End of Report'];
  const id = addDoc({ category: 'report', style: 'report', lang: 'en', lines, person: who.en });
  labIds.push(id);
  ask(`${who.first.toLowerCase()} ${test.toLowerCase()} report`, 'exact', 'en', 'one', [id]);
}
ask('sugar report', 'concept', 'en', 'set', labIds.filter((_, k) => [2, 4].includes(k % 6)));
ask('thyroid', 'exact', 'en', 'set', labIds.filter((_, k) => k % 6 === 3));
ask('खून की जांच', 'cross', 'hi', 'set', labIds, { note: 'Hindi query, English reports: only the concept can find them' });
ask('dawai', 'concept', 'hinglish', 'set', [...medIds, ...rxIds]);
ask('दवाई', 'concept', 'hi', 'set', [...medIds, ...rxIds]);
ask('medicine', 'concept', 'en', 'set', [...medIds, ...rxIds]);
ask('doctor ki parchi', 'concept', 'hinglish', 'set', rxIds);
ask('papa ki dawai ki parchi', 'natural', 'hinglish', 'set', rxIds);

// ── Money ────────────────────────────────────────────────────────────────────
const bankIds = [];
for (let k = 0; k < 10; k++) {
  const b = P.BANKS[k % P.BANKS.length];
  const who = FAMILY[k % FAMILY.length];
  const acc = digits(int(11, 16));
  const lines = [b.en, b.hi, `Branch: ${who.city[0]} Main`, `IFSC: ${b.ifsc}0${digits(6)}`, `A/c No: ${acc}`, `Name: ${who.en}`, `CIF No: ${digits(11)}`, k % 2 ? 'Savings Account Passbook' : 'बचत खाता पासबुक'];
  const id = addDoc({ category: 'bank', style: 'card', lang: 'mix', lines, person: who.en });
  bankIds.push(id);
  ask(`${b.en.split(' ').filter(w => w.length > 3 && !['Bank', 'India', 'National'].includes(w))[0] ?? b.en.split(' ')[0]} passbook ${who.first.toLowerCase()}`, 'exact', 'en', 'one', [id]);
  ask(`${b.short} passbook ${who.first.toLowerCase()}`, 'abbrev', 'en', 'one', [id], { note: 'SBI, PNB, BOB: the passbook prints the full name' });
  ask(acc.slice(-4), 'number', 'en', 'one', [id], { also: [], note: 'last digits of an account number' });
}
const upiIds = [];
const upiByPayee = {};
for (let k = 0; k < 140; k++) {
  const app = pick(P.UPI_APPS);
  const payee = pick(P.PAYEES);
  const amt = money(20, 9000);
  const t = randomTaken();
  const p = istParts(t);
  const hindi = chance(0.2);
  const lines = [app, hindi ? 'भुगतान सफल' : 'Payment Successful', `₹${amt}`, `${hindi ? 'को भुगतान' : 'Paid to'} ${payee}`, `${payee.toLowerCase().replace(/[^a-z]/g, '')}@ybl`,
    `${pad(p.d)} ${P.MONTHS_EN[p.m].slice(0, 3)} ${p.y}, ${pad(p.h % 12 || 12)}:${pad(p.mi)} ${p.h < 12 ? 'am' : 'pm'}`, `UPI Transaction ID: ${digits(12)}`, `Debited from ${pick(P.BANKS).short} XXXX${digits(4)}`];
  const id = addDoc({ category: 'payment', style: 'upi', lang: hindi ? 'mix' : 'en', lines, takenAt: t });
  upiIds.push(id);
  (upiByPayee[payee] = upiByPayee[payee] || []).push(id);
}
for (const [payee, ids] of Object.entries(upiByPayee)) {
  ask(`${payee.split(' ')[0]} payment`, 'exact', 'en', 'set', ids);
}
ask('phonepe', 'exact', 'en', 'set', upiIds.filter(id => docs.find(d => d.id === id).lines.includes('PhonePe')));
ask('upi payment', 'concept', 'en', 'set', upiIds);
ask('bhugtan', 'concept', 'hinglish', 'set', upiIds);
const smsIds = [];
for (let k = 0; k < 70; k++) {
  const b = pick(P.BANKS);
  const t = randomTaken();
  const kind = k % 3;
  const lines = kind === 0
    ? [b.short, `Your A/c XX${digits(4)} is debited by Rs.${money(100, 25000)}.00 on ${dmy(t)}. Avl Bal Rs ${money(1000, 90000)}.00 -${b.short}`]
    : kind === 1
      ? [b.short, `Dear Customer, INR ${money(500, 60000)}.00 credited to your A/c XX${digits(4)} on ${dmy(t)} by NEFT. -${b.short}`]
      : ['VM-' + b.ifsc, `${digits(6)} is your OTP for transaction at ${pick(P.PAYEES)}. Do not share it with anyone. -${b.short}`];
  smsIds.push(addDoc({ category: 'sms', style: 'sms', lang: 'en', lines, takenAt: t }));
}
ask('salary credited', 'exact', 'en', 'smoke', []);
const salaryIds = [];
const co = pick(P.COMPANIES);
for (let k = 0; k < 12; k++) {
  const t = NOW - k * 30 * DAY - int(0, 5) * DAY;
  const p = istParts(t);
  const lines = [co, `Salary Slip for the month of ${P.MONTHS_EN[p.m]} ${p.y}`, `Employee Name: ${FAMILY[0].en}`, `Employee Code: E${digits(4)}`, `Basic: ${money(18000, 22000)}.00`, `HRA: ${money(7000, 9000)}.00`, `Net Pay: ${money(28000, 36000)}.00`];
  salaryIds.push(addDoc({ category: 'salary', style: 'report', lang: 'en', lines, takenAt: t + 2 * DAY, series: 'salary', person: FAMILY[0].en }));
}
ask('salary slip', 'concept', 'en', 'set', salaryIds);
ask('tankhwah', 'concept', 'hinglish', 'set', salaryIds);
ask('वेतन पर्ची', 'cross', 'hi', 'set', salaryIds);
ask('latest salary slip', 'latest', 'en', 'first', [salaryIds[0]]);

// ── Insurance, school, property ──────────────────────────────────────────────
const lifeIds = [];
for (let k = 0; k < 6; k++) {
  const who = FAMILY[k];
  const pol = digits(9);
  const lines = ['Life Insurance Corporation of India', 'भारतीय जीवन बीमा निगम', 'Premium Receipt', `Policy No: ${pol}`, `Name of Life Assured: ${who.en}`, `Premium Amount: Rs ${money(3000, 25000)}.00`,
    `Next Due Date: ${dmy(NOW + int(10, 300) * DAY)}`, `Sum Assured: Rs ${pick(['2,00,000', '5,00,000', '10,00,000'])}`];
  const id = addDoc({ category: 'insurance', style: 'report', lang: 'mix', lines, person: who.en });
  lifeIds.push(id);
  ask(pol, 'number', 'en', 'one', [id], { note: 'policy number' });
  ask(`${who.first.toLowerCase()} lic policy`, 'exact', 'en', 'one', [id]);
}
ask('bima', 'concept', 'hinglish', 'set', lifeIds);
ask('insurance policy', 'concept', 'en', 'set', lifeIds);
const schoolIds = [];
for (let k = 0; k < 5; k++) {
  const who = person();
  const lines = ['Central Board of Secondary Education', 'Marks Statement cum Certificate', `Secondary School Examination, ${int(2015, 2024)}`, `This is to certify that ${who.en.toUpperCase()}`, `Roll No. ${digits(8)}`,
    'English 088', 'Hindi 091', 'Mathematics 079', 'Science 084', 'Social Science 090', 'Result: PASS'];
  schoolIds.push(addDoc({ category: 'certificate', style: 'report', lang: 'en', lines, person: who.en }));
}
ask('marksheet', 'concept', 'en', 'set', schoolIds);
ask('cbse result', 'exact', 'en', 'set', schoolIds);
const certIds = [];
const certs = [['जन्म प्रमाण पत्र', 'Birth Certificate'], ['आय प्रमाण पत्र', 'Income Certificate'], ['जाति प्रमाण पत्र', 'Caste Certificate'], ['निवास प्रमाण पत्र', 'Domicile Certificate']];
certs.forEach(([hi, en], k) => {
  const who = FAMILY[k];
  const lines = [`${who.city[3]} सरकार`, hi, en, `प्रमाणित किया जाता है कि ${who.hi}`, `This is to certify that ${who.en}`, `प्रमाण पत्र संख्या: ${digits(12).slice(0, 12)}`, `दिनांक: ${dmy(randomTaken())}`];
  const id = addDoc({ category: 'certificate', style: 'report', lang: 'mix', lines, person: who.en });
  certIds.push(id);
  ask(en.toLowerCase(), 'exact', 'en', 'one', [id]);
  ask(hi, 'exact', 'hi', 'one', [id]);
});
ask('janam praman patra', 'concept', 'hinglish', 'one', [certIds[0]]);
const propIds = [
  addDoc({ category: 'property', style: 'report', lang: 'en', lines: ['Rent Agreement', `This agreement is made at ${FAMILY[1].city[0]} on ${dmy(randomTaken())}`, `between ${FAMILY[1].en} (Landlord)`, `and ${person().en} (Tenant)`, 'Monthly rent of Rs 9,500/-', 'Security deposit Rs 19,000/-'] }),
  addDoc({ category: 'property', style: 'report', lang: 'hi', lines: ['विक्रय पत्र', 'रजिस्ट्री', `विक्रेता: ${FAMILY[0].hi}`, `खसरा संख्या: ${int(100, 999)}`, `मौजा: ${FAMILY[0].city[1]}`, 'उप निबंधक कार्यालय'] }),
];
ask('rent agreement', 'exact', 'en', 'one', [propIds[0]]);
ask('kiraya', 'concept', 'hinglish', 'one', [propIds[0]]);
ask('zameen ki registry', 'concept', 'hinglish', 'one', [propIds[1]]);
ask('रजिस्ट्री', 'exact', 'hi', 'one', [propIds[1]]);

// ── Travel ───────────────────────────────────────────────────────────────────
const trainIds = [];
for (let k = 0; k < 16; k++) {
  const [no, name, from, to] = P.TRAINS[k % P.TRAINS.length];
  const t = randomTaken();
  const pnr = `${int(2, 8)}${digits(9)}`;
  const lines = ['IRCTC E-Ticket', 'Electronic Reservation Slip (ERS)', `PNR: ${pnr}`, `Train No./Name: ${no} / ${name}`, `From: ${from}  To: ${to}`, `Date of Journey: ${dMonY(t + 5 * DAY)}`,
    `Passenger: ${FAMILY[k % 4].en.toUpperCase()}  CNF/${pick(['B2', 'S5', 'A1', 'B4'])}/${int(1, 72)}`, `Total Fare: ₹ ${money(400, 4200)}.00`];
  const id = addDoc({ category: 'ticket', style: 'ticket-app', lang: 'en', lines, takenAt: t });
  trainIds.push(id);
  ask(pnr, 'number', 'en', 'one', [id], { note: 'PNR: 10 digits; one starting 6-9 looks like a phone number to the masker' });
  ask(`${name.split(' ')[0].toLowerCase()} train ticket`, 'exact', 'en', 'set', trainIds.filter((_, j) => j % P.TRAINS.length === k % P.TRAINS.length));
}
ask('train ticket', 'concept', 'en', 'set', trainIds);
ask('rail ka ticket', 'concept', 'hinglish', 'set', trainIds);
ask('ट्रेन टिकट', 'cross', 'hi', 'set', trainIds);
ask('pnr', 'exact', 'en', 'set', trainIds);
const flightIds = P.FLIGHTS.map(([air, no, from, to]) =>
  addDoc({ category: 'ticket', style: 'flight', lang: 'en', lines: [air, 'Boarding Pass', `Flight ${no}`, `${from} → ${to}`, `Name: ${FAMILY[0].en.toUpperCase()}`, `Seat ${int(1, 30)}${pick(['A', 'C', 'D', 'F'])}`, `Gate ${int(1, 40)}`, `Boarding ${pad(int(5, 22))}:${pad(int(0, 59))}`] }));
ask('boarding pass', 'exact', 'en', 'set', flightIds);
ask('indigo', 'exact', 'en', 'one', [flightIds[0]]);
ask('flight ticket', 'concept', 'en', 'set', flightIds, { note: '"flight" is not a known word: only the text "Flight" finds these' });

// ── Phone screenshots, messages, greetings, everyday text ───────────────────
const rechargeIds = [];
for (let k = 0; k < 25; k++) {
  const plan = pick([199, 239, 299, 479, 719]);
  const lines = [pick(['Jio', 'Airtel', 'Vi']), 'Recharge Successful', `₹${plan} plan`, `Validity: ${pick([28, 56, 84])} days`, `Mobile: ${fakePhone()}`, `Transaction ID: ${digits(10)}`];
  rechargeIds.push(addDoc({ category: 'recharge', style: 'recharge', lang: 'en', lines }));
}
ask('recharge', 'concept', 'en', 'set', rechargeIds);
ask('mobile recharge', 'concept', 'en', 'set', rechargeIds);

const fest = [];
for (const [name, days] of Object.entries(P.FESTIVAL_DAYS)) {
  for (const day of days) {
    const greet = {
      diwali: [['Happy Diwali', 'May the festival of lights bring joy'], ['दीपावली की हार्दिक शुभकामनाएं', 'शुभ दीपावली']],
      holi: [['Happy Holi', 'Colours of joy'], ['होली की हार्दिक शुभकामनाएं', 'बुरा न मानो होली है']],
      rakhi: [['Happy Raksha Bandhan', 'Bhai Behan ka pyaar'], ['रक्षाबंधन की हार्दिक शुभकामनाएं', 'भाई बहन का प्यार']],
      eid: [['Eid Mubarak', 'Wishing you peace and happiness'], ['ईद मुबारक', 'आपको और आपके परिवार को ईद की मुबारकबाद']],
    }[name];
    for (let k = 0; k < 4; k++) {
      const [l1, l2] = greet[k % 2];
      fest.push(addDoc({ category: 'greeting', style: 'greeting', lang: k % 2 ? 'hi' : 'en', lines: [l1, l2, `From ${FAMILY[k].first} and family`], takenAt: atIst(day, int(8, 22)), theme: name }));
    }
    for (let k = 0; k < 6; k++) {
      fest.push(addDoc({ category: 'festival-photo', style: 'photo', labels: pick([['Lighting', 'Event'], ['Crowd', 'Event'], ['Smile', 'Fun'], ['Food', 'Dessert']]), takenAt: atIst(day, int(9, 23)), theme: name }));
    }
  }
}
const festAround = (name, year) => {
  const day = P.FESTIVAL_DAYS[name].find(d => d.startsWith(String(year)));
  if (!day) return [];
  const t = atIst(day, 12);
  return docs.filter(d => Math.abs(d.takenAt - t) < 3.5 * DAY).map(d => d.id);
};
const festOn = (name, year) => {
  const day = P.FESTIVAL_DAYS[name].find(d => d.startsWith(String(year)));
  return docs.filter(d => d.theme === name && day && istParts(d.takenAt).y === year && dmy(d.takenAt) === dmy(atIst(day))).map(d => d.id);
};
ask('diwali 2024', 'date', 'en', 'set', festOn('diwali', 2024), { also: festAround('diwali', 2024), note: 'themed photos of the day; anything from the days around counts too' });
ask('diwali photos 2023', 'date', 'en', 'set', festOn('diwali', 2023), { also: festAround('diwali', 2023), note: 'themed photos of the day; anything from the days around counts too' });
ask('दिवाली 2025', 'date', 'hi', 'set', festOn('diwali', 2025), { also: festAround('diwali', 2025), note: 'themed photos of the day; anything from the days around counts too' });
ask('holi 2025', 'date', 'en', 'set', festOn('holi', 2025), { also: festAround('holi', 2025), note: 'themed photos of the day; anything from the days around counts too' });
ask('holi ki photo 2024', 'date', 'hinglish', 'set', festOn('holi', 2024), { also: festAround('holi', 2024), note: 'themed photos of the day; anything from the days around counts too' });
ask('raksha bandhan 2024', 'date', 'en', 'set', festOn('rakhi', 2024), { also: festAround('rakhi', 2024), note: 'themed photos of the day; anything from the days around counts too' });
ask('rakhi 2025 photos', 'date', 'en', 'set', festOn('rakhi', 2025), { also: festAround('rakhi', 2025), note: 'themed photos of the day; anything from the days around counts too' });
ask('eid 2025', 'date', 'en', 'set', festOn('eid', 2025), { also: festAround('eid', 2025), note: 'themed photos of the day; anything from the days around counts too' });
ask('diwali photos', 'date', 'en', 'set', ['diwali'].flatMap(n => [2023, 2024, 2025].flatMap(y => festOn(n, y))), { note: 'every year' });
ask('happy diwali', 'exact', 'en', 'set', docs.filter(d => d.theme === 'diwali' && d.lines?.[0] === 'Happy Diwali').map(d => d.id));
ask('ईद मुबारक', 'exact', 'hi', 'set', docs.filter(d => d.theme === 'eid' && d.lines?.[0] === 'ईद मुबारक').map(d => d.id));

const weddingIds = [];
for (let k = 0; k < 6; k++) {
  const g = person();
  const b = person();
  const t = randomTaken();
  const lines = k % 2
    ? ['॥ श्री गणेशाय नमः ॥', 'शुभ विवाह', `चि. ${g.hi.split(' ')[0]}`, 'संग', `आयु. ${b.hi.split(' ')[0]}`, `दिनांक: ${dmy(t + 20 * DAY)}`, `स्थान: ${g.city[1]}`, 'आप सपरिवार सादर आमंत्रित हैं']
    : ['Wedding Invitation', `${g.first} weds ${b.first}`, `on ${dMonY(t + 20 * DAY)}`, `Venue: Hotel ${pick(['Clarks', 'Grand', 'Royal Palace'])}, ${g.city[0]}`, 'With best compliments from the family'];
  const id = addDoc({ category: 'wedding', style: 'greeting', lang: k % 2 ? 'hi' : 'en', lines, takenAt: t });
  weddingIds.push(id);
  ask(k % 2 ? `${g.hi.split(' ')[0]} की शादी का कार्ड` : `${g.first.toLowerCase()} wedding card`, 'exact', k % 2 ? 'hi' : 'en', 'one', [id]);
}
ask('shaadi ka card', 'concept', 'hinglish', 'set', weddingIds);
ask('wedding card', 'concept', 'en', 'set', weddingIds);

// Distractors: text people keep that nobody searches for, and that share words with what they do.
const fill = (n, make) => { for (let k = 0; k < n; k++) make(k); };
const scale = Math.max(1, SIZE / 10000);
fill(Math.round(700 * scale), () => {
  const who = pick(FAMILY);
  const n = int(3, 8);
  const lines = [who.first, ...Array.from({ length: n }, () => `${pick(P.CHAT_LINES)}  ${pad(int(7, 22))}:${pad(int(0, 59))}`)];
  addDoc({ category: 'chat', style: 'chat', lang: 'mix', lines });
});
fill(Math.round(250 * scale), () => addDoc({ category: 'news', style: 'news', lang: 'mix', lines: [pick(['Dainik Jagran', 'Amar Ujala', 'Times of India', 'NDTV', 'Aaj Tak']), pick(P.NEWS), pick(P.NEWS)] }));
fill(Math.round(500 * scale), () => addDoc({ category: 'quote', style: 'greeting', lang: 'mix', lines: [pick(P.QUOTES)] }));
fill(Math.round(150 * scale), k => {
  const hindi = chance(0.5);
  addDoc({ category: 'shop', style: 'sign', lang: hindi ? 'hi' : 'en', lines: hindi ? [pick(P.SHOPS_HI), `प्रो. ${pick(FAMILY).hi}`, `मो. ${fakePhone()}`] : [pick(P.SHOPS), `Prop. ${pick(FAMILY).en}`, `Mob. ${fakePhone()}`] });
});
fill(Math.round(120 * scale), () => {
  const [brand, what] = pick(P.PRODUCTS);
  addDoc({ category: 'product', style: 'strip', lang: 'en', lines: [brand, what, `MRP Rs ${int(10, 600)}.00 (Incl. of all taxes)`, `Best before ${int(6, 12)} months from packaging`] });
});
fill(Math.round(60 * scale), () => {
  const [h, b] = pick(P.NOTICES);
  addDoc({ category: 'notice', style: 'report', lang: /[ऀ-ॿ]/.test(h) ? 'hi' : 'en', lines: [h, b, `Dated: ${dmy(randomTaken())}`] });
});
// A few kinds of text that do say "bill", "card" or "medicine" without being one.
const MENTIONS = ['Bijli ka bill bhar diya?', 'Aadhar card ki copy bhej do', 'Papa ki dawai khatam ho gayi', 'Gas cylinder book kar do', 'Bank passbook update karwana hai', 'Train ticket confirm hua?', 'बिजली का बिल कितना आया', 'दवाई ले आना'];
fill(Math.round(15 * scale), () => addDoc({ category: 'chat', style: 'chat', lang: 'mix', lines: [pick(FAMILY).first, pick(MENTIONS), pick(P.CHAT_LINES)] }));

// ── PDFs ─────────────────────────────────────────────────────────────────────
// What people keep as PDFs: e-bills, bank statements, policies, e-tickets, an
// e-Aadhaar (password-protected, as UIDAI sends it), scans, Hindi notices,
// and PDFs that arrived on WhatsApp (they sit in WhatsApp's own folder).
const pdfIds = [];
const pdf = d => {
  const id = addDoc({ kind: 'DOCUMENT', style: 'pdf', pdfKind: 'digital', ...d });
  pdfIds.push(id);
  return id;
};
// e-bills, as downloaded from the power company's site
for (const s of billSeries.slice(0, 3)) {
  for (const id of s.ids.slice(-3)) {
    const d = docs.find(x => x.id === id);
    const p = istParts(d.takenAt);
    const fid = pdf({ category: 'electricity', lang: d.lang, pages: [d.lines], takenAt: d.takenAt, series: d.series, person: d.person, fileName: `${s.co.short.replace(/ /g, '_')}_Bill_${P.MONTHS_EN[p.m].slice(0, 3)}${p.y}` });
    // The e-bill PDF is as right an answer as the photo of the same bill.
    for (const q of queries) if (q.expect.ids.includes(id) && !q.expect.ids.includes(fid)) q.expect.ids.push(fid);
    ask(`${s.co.en.split(' ')[0]} bill pdf ${P.MONTHS_EN[p.m].toLowerCase()} ${p.y}`, 'pdf', 'en', 'one', [fid, id], { note: 'the e-bill PDF (or its photo)' });
  }
}
// Bank statements: five pages; some words sit where the app doesn't read.
const statementTests = [];
for (let k = 0; k < 4; k++) {
  const b = P.BANKS[k];
  const who = FAMILY[k];
  const acc = digits(12);
  const late1 = ['Shiv Shakti Hardware', 'Navjeevan Opticals', 'Laxmi Narayan Jewellers', 'Sangam Tent House'][k];
  const early2 = ['Krishna Fruit Wholesale', 'Vaishno Dhaba', 'Sai Ram Dairy Farm', 'Mahalaxmi Steel'][k];
  const page5 = ['Saraswati Coaching Centre', 'Ganga Ram Hospital', 'Kalyan Matka Furniture', 'Durga Puja Samiti'][k];
  const txn = n => Array.from({ length: n }, (_, i) => `${pad((i % 28) + 1)}/${pad(int(1, 12))}/2025 UPI/DR/${digits(9)}/${pick(P.PAYEES)} ${money(50, 4000)}.00 ${money(5000, 90000)}.00`);
  const pages = [
    [b.en, 'Account Statement', `Account Name: ${who.en}`, `Account Number: ${acc}`, `Branch: ${who.city[0]} Main`, `IFSC: ${b.ifsc}0${digits(6)}`, 'Statement Period: 01/04/2025 to 30/09/2025', ...txn(14), `05/05/2025 UPI/DR/${digits(9)}/${late1} 1,250.00 41,200.00`, ...txn(10)],
    [`12/06/2025 UPI/DR/${digits(9)}/${early2} 780.00 38,100.00`, ...txn(24)],
    txn(25),
    txn(25),
    [...txn(12), `28/09/2025 NEFT/${page5} 2,400.00 36,050.00`, 'Closing Balance 36,050.00', 'This is a computer generated statement'],
  ];
  const id = pdf({ category: 'bank', lang: 'en', pages, person: who.en, fileName: `${b.short.replace(/ /g, '')}_Statement_Apr-Sep2025` });
  statementTests.push(id);
  ask(`${b.en.split(' ').filter(w => w.length > 3 && !['Bank', 'India', 'National'].includes(w))[0] ?? b.ifsc} statement ${who.first.toLowerCase()}`.toLowerCase(), 'pdf', 'en', 'one', [id], { note: 'words at the top of page 1' });
  ask(late1.toLowerCase(), 'pdf-depth', 'en', 'one', [id], { note: 'only on page 1, after its first 500 characters: the app reads 500 per page' });
  ask(early2.toLowerCase(), 'pdf-depth', 'en', 'one', [id], { note: 'only at the top of page 2 (read)' });
  ask(page5.toLowerCase(), 'pdf-depth', 'en', 'one', [id], { note: 'only on page 5: the app reads pages 1-3' });
}
ask('bank statement', 'pdf', 'en', 'set', statementTests);
// An LIC policy document, eight pages, English and Hindi.
const policyNo = digits(9);
const lic = pdf({
  category: 'insurance', lang: 'mix', folder: 'Documents', person: FAMILY[1].en, fileName: 'LIC_Policy_Document',
  pages: [
    ['Life Insurance Corporation of India', 'भारतीय जीवन बीमा निगम', 'Policy Document', `Policy Number: ${policyNo}`, `Life Assured: ${FAMILY[1].en}`, "Plan: LIC's Jeevan Anand (Table 915)", 'Sum Assured: Rs 5,00,000', `Nominee: ${FAMILY[0].en}`],
    ['Schedule of Premiums', 'Yearly premium Rs 24,312', 'Date of commencement 15/03/2019', 'Date of maturity 15/03/2040'],
    ...Array.from({ length: 6 }, (_, i) => [`Conditions and Privileges page ${i + 3}`, 'Grace period of 30 days is allowed for payment of premium', 'Revival of discontinued policies', 'Loan may be granted on the sole security of the policy']),
  ],
});
ask('jeevan anand', 'pdf', 'en', 'one', [lic]);
ask(policyNo, 'pdf', 'en', 'one', [lic], { note: 'policy number in a PDF' });
ask('lic policy document', 'pdf', 'en', 'one', [lic], { also: lifeIds });
ask('बीमा पॉलिसी', 'pdf', 'hi', 'set', [lic, ...lifeIds]);
// Hindi PDFs with a text layer.
const hiNotice = pdf({ category: 'notice', lang: 'hi', fileName: 'Nagar_Nigam_Suchna', pages: [['नगर निगम लखनऊ', 'सार्वजनिक सूचना', 'सभी भवन स्वामियों को सूचित किया जाता है कि गृहकर 31 मार्च तक जमा करें', 'विलंब होने पर ब्याज देय होगा', 'नगर आयुक्त']] });
ask('गृहकर', 'pdf', 'hi', 'one', [hiNotice]);
ask('nagar nigam suchna', 'pdf', 'hinglish', 'one', [hiNotice], { note: 'Hinglish query, Hindi PDF' });
ask('house tax notice', 'pdf', 'en', 'one', [hiNotice], { note: 'English query, Hindi PDF: no shared word' });
const hiRation = pdf({ category: 'id', lang: 'hi', fileName: 'Ration_Card_List', pages: [['खाद्य एवं रसद विभाग उत्तर प्रदेश', 'पात्र गृहस्थी राशन कार्ड सूची', `${FAMILY[2].hi} - ${int(3, 6)} सदस्य`, `${FAMILY[3].hi} - ${int(2, 5)} सदस्य`]] });
ask('राशन कार्ड सूची', 'pdf', 'hi', 'one', [hiRation]);
// Scans: PDFs that are only pictures of pages (a phone scanner app, a shop's scanner).
const scans = [
  ['Aadhaar_scan', 'id', ['भारत सरकार', 'Government of India', FAMILY[4].hi, FAMILY[4].en, `DOB: ${pad(int(1, 28))}/${pad(int(1, 12))}/${int(1950, 2000)}`, fakeAadhaar()], `${FAMILY[4].first.toLowerCase()} aadhaar`],
  ['Property_papers', 'property', ['विक्रय विलेख', 'रजिस्ट्री', `विक्रेता: ${FAMILY[5].hi}`, `खसरा संख्या: ${int(100, 999)}`, 'उप निबंधक कार्यालय'], 'zameen ki registry'],
  ['Prescription_scan', 'prescription', [`Dr. ${P.DOCTORS[0][0]}`, P.DOCTORS[0][1], `Name: ${FAMILY[6].en}`, 'Rx', '1. Tab Telma 40 mg 1-0-0 x 30 days', '2. Tab Glycomet 500 mg 1-0-1 x 30 days'], `${FAMILY[6].first.toLowerCase()} glycomet`],
  ['Marksheet_scan', 'certificate', ['Board of High School and Intermediate Education Uttar Pradesh', 'Marksheet cum Certificate', `Name: ${FAMILY[7].en.toUpperCase()}`, 'Result: PASSED IN FIRST DIVISION'], `${FAMILY[7].first.toLowerCase()} marksheet`],
];
for (const [name, category, lines, q] of scans) {
  const id = pdf({ category, lang: 'mix', pdfKind: 'scanned', style: 'pdf-scan', fileName: name, pages: [lines] });
  const cards = category === 'id' ? idOf[FAMILY[4].en] ?? [] : [];
  ask(q, 'pdf-scan', /^[a-z ]+$/.test(q) ? 'en' : 'hi', 'one', [id, ...cards], { note: 'a scanned PDF: only OCR can read it' });
}
// e-Aadhaar: UIDAI's PDF is locked with a password (first 4 letters of the name + birth year).
const eAadhaar = [];
for (const who of FAMILY.slice(0, 2)) {
  const aad = fakeAadhaar();
  const born = int(1950, 2000);
  const id = pdf({
    category: 'id', lang: 'mix', pdfKind: 'password', password: `${who.first.slice(0, 4).toUpperCase()}${born}`, person: who.en,
    fileName: `EAadhaar_XXXXXXXX${aad.slice(-4)}_2023110512${digits(4)}`,
    pages: [['Unique Identification Authority of India', 'भारतीय विशिष्ट पहचान प्राधिकरण', 'Enrolment No: 1234/56789/01234', who.en, `DOB: 01/01/${born}`, aad, 'आधार - आम आदमी का अधिकार']],
  });
  eAadhaar.push(id);
  ask(`${who.first.toLowerCase()} e aadhaar`, 'pdf-locked', 'en', 'one', [id, ...(idOf[who.en] ?? [])], { note: 'password-protected e-Aadhaar PDF (or the card photo)' });
}
ask('eaadhaar pdf', 'pdf-locked', 'en', 'set', eAadhaar, { note: 'only the file name can be read without the password' });
// PDFs that came on WhatsApp: they stay in WhatsApp's folder.
const waIds = [];
const waDocs = [
  ['School_Circular', 'notice', 'en', ['Delhi Public School', 'Circular No. 45/2025', 'Annual Sports Day will be held on 15 December', 'Parents are requested to attend']],
  ['Shaadi_Card', 'wedding', 'hi', ['शुभ विवाह', `चि. ${FAMILY[3].hi.split(' ')[0]}`, 'संग', 'आयु. पूजा', 'आप सपरिवार सादर आमंत्रित हैं']],
  ['IRCTC_Ticket', 'ticket', 'en', ['IRCTC E-Ticket', `PNR: ${int(2, 5)}${digits(9)}`, 'Train No./Name: 12004 / Lucknow Shatabdi', 'From: NEW DELHI (NDLS) To: LUCKNOW NR (LKO)']],
  ['Society_Maintenance_Bill', 'electricity', 'en', ['Green Valley Residents Welfare Association', 'Maintenance Bill', 'Flat No. B-204', 'Amount Due Rs 2,500', 'Due Date 10/12/2025']],
];
for (const [name, category, lang, lines] of waDocs) {
  const id = pdf({ category, lang, folder: 'WhatsApp', fileName: name, pages: [lines] });
  waIds.push(id);
}
ask('sports day circular', 'pdf-whatsapp', 'en', 'one', [waIds[0]], { note: 'a PDF in WhatsApp Documents' });
ask('shatabdi ticket', 'pdf-whatsapp', 'en', 'one', [waIds[2]], { note: 'a PDF in WhatsApp Documents' });
ask('maintenance bill', 'pdf-whatsapp', 'en', 'one', [waIds[3]], { note: 'a PDF in WhatsApp Documents' });

// ── More screenshots: the apps people screenshot ─────────────────────────────
const shotIds = {};
const shot = (key, d) => {
  const id = addDoc({ category: 'screenshot', ...d });
  (shotIds[key] = shotIds[key] || []).push(id);
  return id;
};
fill(25, () => {
  const item = pick(['Prestige Pressure Cooker 5 L', 'boAt Rockerz 450 Headphones', 'Philips Steam Iron', 'Bajaj Mixer Grinder 750 W', 'Redmi 13C Mobile Cover']);
  shot('amazon', { style: 'app', lang: 'en', lines: ['amazon.in', 'Your Orders', item, `Arriving ${pick(['Tuesday', 'Friday', 'tomorrow'])}`, `Order # 40${digits(1)}-${digits(7)}-${digits(7)}`, `Order Total ₹${money(299, 4999)}`] });
});
fill(6, () => shot('digilocker', { style: 'app', lang: 'mix', lines: ['DigiLocker', 'Issued Documents', 'Aadhaar Card', 'Unique Identification Authority of India', 'Driving License', 'PUC Certificate'] }));
fill(10, () => {
  const s = pick(billSeries);
  shot('powerapp', { style: 'app', lang: 'en', lines: [s.co.short, 'Pay Bill', `${s.co.label} ${s.acct}`, `Bill Amount ₹${money(400, 4800)}`, `Due on ${dmy(randomTaken())}`, 'Pay Now'], person: s.who.en });
});
fill(20, () => shot('youtube', { style: 'app-dark', lang: 'mix', lines: ['YouTube', pick(['Shree Hanuman Chalisa | Hariharan', 'Easy Aloo Paratha Recipe', 'Yoga for Back Pain | 20 Minutes', 'Kapil Sharma Show Best Comedy', 'Mann Ki Baat']), `${int(1, 99)}M views`, 'Subscribe'] }));
fill(25, () => {
  const who = pick(FAMILY);
  shot('darkchat', { style: 'app-dark', lang: 'mix', lines: [who.first, ...Array.from({ length: int(3, 6) }, () => pick(P.CHAT_LINES))] });
});
fill(15, () => shot('hindinews', { style: 'app', lang: 'hi', lines: [pick(['दैनिक भास्कर', 'अमर उजाला', 'आज तक']), pick(P.NEWS.filter(n => /[\u0900-\u097F]/.test(n))), 'और पढ़ें'] }));
fill(10, () => shot('calendar', { style: 'app', lang: 'en', lines: ['Calendar', pick(['Doctor appointment', 'Pay LIC premium', 'Gas booking', 'Pension certificate submit']), `${pick(['Mon', 'Wed', 'Sat'])}, ${int(1, 28)} ${pick(P.MONTHS_EN)}`, `${int(9, 18)}:00 – ${int(10, 19)}:00`] }));
fill(10, () => shot('maps', { style: 'app', lang: 'en', lines: ['Google Maps', `${int(5, 45)} min (${int(2, 30)} km)`, `via ${pick(['NH 27', 'Ring Road', 'Station Road'])}`, pick(['AIIMS Hospital', 'Charbagh Railway Station', 'Hazratganj Market', 'Bada Imambara'])] }));
ask('amazon order', 'screenshot', 'en', 'set', shotIds.amazon);
ask('pressure cooker', 'screenshot', 'en', 'set', docs.filter(d => d.lines?.includes('Prestige Pressure Cooker 5 L')).map(d => d.id));
ask('digilocker', 'screenshot', 'en', 'set', shotIds.digilocker);
ask('hanuman chalisa', 'screenshot', 'en', 'set', docs.filter(d => d.lines?.some(l => l.startsWith('Shree Hanuman Chalisa'))).map(d => d.id), { note: 'dark-mode screenshots' });
ask('doctor appointment', 'screenshot', 'en', 'set', docs.filter(d => d.lines?.includes('Doctor appointment')).map(d => d.id));
ask('hazratganj', 'screenshot', 'en', 'set', docs.filter(d => d.lines?.includes('Hazratganj Market')).map(d => d.id));
ask('payment screenshot', 'screenshot', 'en', 'set', upiIds, { note: 'UPI screenshots never say "screenshot"' });
ask('whatsapp chat', 'screenshot', 'en', 'set', docs.filter(d => d.style === 'chat' && !d.copyOf).map(d => d.id), { note: 'chat screenshots never say "WhatsApp"' });

// WhatsApp copies: byte-identical copies of some photos (sent and received).
const copySource = docs.filter(d => d.detection === 'TEXT' && d.kind === 'IMAGE' && ['payment', 'greeting', 'id', 'electricity'].includes(d.category));
fill(60, () => {
  const src = pick(copySource);
  addDoc({ ...src, kind: 'IMAGE', lines: src.lines, takenAt: src.takenAt + int(1, 600) * 1000, copyOf: src.id, series: src.series, fileName: null, folder: src.folder === 'Screenshots' ? 'Pictures' : src.folder });
  // keep the copy's text exactly the same as the source's
  docs[docs.length - 1].ocr = src.ocr;
  docs[docs.length - 1].ocrLevel = src.ocrLevel;
});
ask('happy holi', 'copies', 'en', 'set', docs.filter(d => d.theme === 'holi' && d.lines?.[0] === 'Happy Holi' && !d.copyOf).map(d => d.id), { note: 'each copy shown once' });

// Photos without text: the rest of the gallery.
const labelIds = {};
while (docs.length < SIZE) {
  if (chance(0.25)) {
    addDoc({ category: 'photo', style: 'photo' });
    continue;
  }
  const set = pick(P.LABEL_SETS);
  const id = addDoc({ category: 'photo', style: 'photo', labels: set.labels, theme: set.theme });
  (labelIds[set.theme] = labelIds[set.theme] || []).push(id);
}
// Searches for what photos show (on the desk: their labels; on a phone: CLIP too).
const withLabel = word => docs.filter(d => d.labels?.includes(word) && !d.copyOf).map(d => d.id);
const THEME_LABEL = { dog: 'Dog', cat: 'Cat', flower: 'Flower', temple: 'Temple', car: 'Car', cake: 'Cake', food: 'Food', selfie: 'Selfie', baby: 'Baby', beach: 'Beach', bicycle: 'Bicycle', mountain: 'Mountain' };
const themeAsk = (q, theme, lang, note) => ask(q, 'picture', lang, 'set', withLabel(THEME_LABEL[theme]), { note });
themeAsk('dog', 'dog', 'en');
themeAsk('cat', 'cat', 'en');
themeAsk('flowers', 'flower', 'en');
themeAsk('phool', 'flower', 'hinglish');
themeAsk('फूल', 'flower', 'hi');
themeAsk('temple', 'temple', 'en');
themeAsk('mandir', 'temple', 'hinglish');
themeAsk('मंदिर', 'temple', 'hi');
themeAsk('car', 'car', 'en');
themeAsk('gaadi', 'car', 'hinglish');
themeAsk('cake', 'cake', 'en');
themeAsk('birthday cake', 'cake', 'en', 'labels say Cake, not birthday');
themeAsk('khana', 'food', 'hinglish');
themeAsk('food', 'food', 'en');
themeAsk('selfie', 'selfie', 'en');
themeAsk('baby', 'baby', 'en');
themeAsk('bachcha', 'baby', 'hinglish');
themeAsk('beach', 'beach', 'en');
themeAsk('samundar', 'beach', 'hinglish', 'not a known word');
themeAsk('kutta', 'dog', 'hinglish', 'not a known word');
themeAsk('कुत्ता', 'dog', 'hi', 'not a known word');
themeAsk('photo of a dog', 'dog', 'en');
themeAsk('cycle', 'bicycle', 'en', 'labels say Bicycle');
themeAsk('pahad', 'mountain', 'hinglish', 'not a known word');

// ── Collections (Home's "Find quickly" tiles) ───────────────────────────────
const isCat = (...cats) => docs.filter(d => cats.includes(d.category) && !d.copyOf).map(d => d.id);
ask('ID cards', 'collection', 'en', 'set', isCat('id'));
ask('पहचान पत्र', 'collection', 'hi', 'set', isCat('id'));
ask('Bills', 'collection', 'en', 'set', isCat('electricity', 'water', 'gas'), { also: isCat('payment', 'recharge') });
ask('Medicine', 'collection', 'en', 'set', isCat('medicine', 'prescription'), { also: isCat('report') });
ask('दवाइयाँ', 'collection', 'hi', 'set', isCat('medicine', 'prescription'), { also: isCat('report') });
ask('Bank', 'collection', 'en', 'set', isCat('bank'), { also: isCat('sms', 'payment') });

// ── Dates relative to the run (worked out by the scorer from when it ran) ───
ask('kal ki photo', 'date', 'hinglish', 'set', [], { rule: { window: 'yesterday' } });
ask('aaj ki photos', 'date', 'hinglish', 'set', [], { rule: { window: 'today' } });
ask('last month', 'date', 'en', 'set', [], { rule: { window: 'lastMonth' } });
ask('pichle mahine ka bill', 'date', 'hinglish', 'set', [], { rule: { window: 'lastMonth', categories: ['electricity', 'water', 'gas'] } });
ask('last week photos', 'date', 'en', 'set', [], { rule: { window: 'lastWeek' } });
ask('march 2024 bill', 'date', 'en', 'set', [], { rule: { window: 'month', year: 2024, month: 2, categories: ['electricity', 'water', 'gas'] } });
ask('2023 photos', 'date', 'en', 'set', [], { rule: { window: 'year', year: 2023 } });
ask('october 2025', 'date', 'en', 'set', [], { rule: { window: 'month', year: 2025, month: 9 } });

// ── Nothing should be found ─────────────────────────────────────────────────
for (const w of P.ABSENT_WORDS) ask(w, 'absent', /[ऀ-ॿ]/.test(w) ? 'hi' : 'en', 'none');
const MASH = ['asdfgh', 'qwerty', 'hjkl', 'zxcvbnm', 'jjjjjj', 'xkcdqw', 'hzjsbsjd', 'mnbvcx', 'pqowie', 'dfghjk', 'ghfjdks', 'kkkkkkkkk', 'aaaaaaa', 'lkjhg', 'wxyz'];
for (const m of MASH) ask(m, 'garbage', 'en', 'none', [], { note: 'keyboard mash' });
for (const g of ['🙂', '🙏🙏', '😂😂😂', '?????', '....', '!!!', '#$%^&*', '₹₹₹', '———', '…']) ask(g, 'garbage', 'none', 'none', [], { note: 'symbols only' });
for (const g of ['"', '""', "'", 'bill"', '"bill', 'bill*', '*', 'bill AND', 'AND', 'OR', 'NOT', 'NEAR(bill card)', '-bill', 'bill^', '(bill', 'bill)', ':', 'content:bill', '{bill}', '%', '_', '\\', '%bill%', "'; DROP TABLE document_index; --", 'bill" OR "1"="1']) {
  ask(g, 'syntax', 'none', 'smoke', [], { note: 'must not crash; FTS5 and SQL special characters' });
}
ask('a', 'short', 'en', 'smoke', []);
ask('b', 'short', 'en', 'smoke', []);
ask('bi', 'short', 'en', 'smoke', []);
ask('क', 'short', 'hi', 'smoke', []);
ask('1', 'short', 'en', 'smoke', []);
ask('the', 'short', 'en', 'smoke', []);
ask('ka', 'short', 'hinglish', 'smoke', []);
ask('   ', 'short', 'none', 'smoke', []);
ask('bill '.repeat(60).trim(), 'long', 'en', 'smoke', [], { note: '60 words' });
ask(P.NEWS.join(' '), 'long', 'mix', 'smoke', [], { note: 'a pasted paragraph' });
ask('x'.repeat(400), 'long', 'en', 'none', []);
ask('qwerty asdf zxcv giraffe', 'garbage', 'en', 'none', []);
ask('electricity giraffe', 'absent', 'en', 'none', [], { note: 'one real word, one absent: every word must match' });
ask('1234567890', 'garbage', 'en', 'none', []);
ask('0000', 'garbage', 'en', 'none', []);

// ── The Screenshots collection (Home's tile reads the phone's Screenshots album) ──
const allShots = docs.filter(d => d.folder === 'Screenshots' && !d.copyOf).map(d => d.id);
ask('Screenshots', 'collection', 'en', 'set', allShots, { note: 'the tile uses the album; a typed search uses words and CLIP' });
ask('स्क्रीन शॉट', 'collection', 'hi', 'set', allShots);
ask('screenshot', 'collection', 'en', 'set', allShots);

// ── Photos without text: what is stored for them must not be searchable ──
ask('image', 'placeholder', 'en', 'none', [], { note: 'photos without text are stored as the word "image"' });
ask('img', 'placeholder', 'en', 'none', [], { note: 'prefix of the stored placeholder "image"' });
ask('imag', 'placeholder', 'en', 'none', []);

// ─── Typos in everyday searches ──────────────────────────────────────────────
// One phone-keyboard typo in about half of the everyday searches (Latin
// letters only: Hindi typing goes through a different keyboard).
for (const q of [...queries]) {
  if (!['exact', 'natural', 'concept', 'cross', 'latest', 'answer'].includes(q.kind)) continue;
  if (!['en', 'hinglish'].includes(q.lang) || !chance(0.5)) continue;
  const t = withTypo(q.text);
  if (t) ask(t, 'typo', q.lang, q.mode, q.expect.ids, { also: q.also, rule: q.rule, from: q.qid });
}

// ─── Write ──────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'corpus.jsonl'), docs.map(d => JSON.stringify(d)).join('\n') + '\n');
const valid = queries.filter(q => q.mode !== 'set' && q.mode !== 'one' && q.mode !== 'first' ? true : q.expect.ids.length > 0 || q.rule);
fs.writeFileSync(path.join(OUT, 'queries.jsonl'), valid.map(q => JSON.stringify(q)).join('\n') + '\n');
const count = (arr, key) => {
  const m = {};
  for (const x of arr) m[x[key]] = (m[x[key]] || 0) + 1;
  return m;
};
const meta = { madeFor: new Date(NOW).toISOString(), seed: SEED, size: docs.length, queries: valid.length, dropped: queries.length - valid.length, byCategory: count(docs, 'category'), byKind: count(valid, 'kind'), byOcr: count(docs, 'ocrLevel') };
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
console.log(`${docs.length} photos and PDFs, ${valid.length} searches (${meta.dropped} without an answer dropped) → ${OUT}`);
