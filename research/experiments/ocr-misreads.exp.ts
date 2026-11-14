/**
 * Experiment 1: does Pinpointer's word search survive OCR mistakes?
 * Uses the app's real enrichment + search keys; only the matching rule is
 * re-implemented (FTS5 semantics: prefix on word/roman, exact on keys/concepts).
 */
import * as fs from 'fs';
import { buildIndexableContent } from '../../src/utils/TextEnrichment';
import { withSearchTail, termsForQueryWord } from '../../src/utils/SearchKeys';
import { bhashaKey, romanize } from '../../src/utils/IndicText';

const OUT = process.env.EXP_OUT ?? require('path').join(__dirname, 'results', 'ocr-misreads.json');
const vocab = JSON.parse(fs.readFileSync(process.env.EXP_VOCAB ?? require('path').join(__dirname, 'data', 'vocab.json'), 'utf8')) as { hi: string[]; en: string[] };

// ── deterministic RNG ──
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];

// ── tokenization like FTS5 unicode61 with categories 'L* N* Co Mn Mc' ──
const tokens = (text: string): string[] =>
  text.normalize('NFC').split(/[^\p{L}\p{N}\p{Co}\p{Mn}\p{Mc}]+/u).filter(Boolean).map(t => t.toLowerCase());

const DEVA = /[ऀ-ॿ]/;
const MATRA_PAIRS: Record<string, string> = { 'ि': 'ी', 'ी': 'ि', 'ु': 'ू', 'ू': 'ु', 'े': 'ै', 'ै': 'े', 'ो': 'ौ', 'ौ': 'ो' };
const MATRAS = 'ािीुूृेैोौॅॉ';
// Look-alike pairs from the literature (ba/va, gha/dha, ma/bha, da/dha, ta/Ta) + two assumed (pa/sha, tha/ya).
const LOOKALIKE: Array<[string, string]> = [['ब', 'व'], ['घ', 'ध'], ['म', 'भ'], ['द', 'ध'], ['त', 'ट'], ['प', 'ष'], ['थ', 'य']];
const NUKTA = '़', VIRAMA = '्', ANUSVARA = 'ं', CHANDRA = 'ँ';

type ErrKind = 'matra' | 'lookalike' | 'diacritic' | 'conjunct' | 'split' | 'unknown_kha';
const DEVA_WEIGHTS: Array<[ErrKind, number]> = [['matra', 0.26], ['lookalike', 0.36], ['diacritic', 0.18], ['conjunct', 0.10], ['split', 0.05], ['unknown_kha', 0.05]];

const chars = (w: string) => [...w.normalize('NFC').replace(/[क़-य़]/g, c => c.normalize('NFD'))];

/** One OCR mistake of the given kind, or null when the word has no place for it. */
const corruptDeva = (w: string, kind: ErrKind): string | null => {
  const c = chars(w);
  const idx = (pred: (ch: string, i: number) => boolean) => c.map((ch, i) => (pred(ch, i) ? i : -1)).filter(i => i >= 0);
  switch (kind) {
    case 'matra': {
      const at = idx(ch => MATRAS.includes(ch));
      if (!at.length) return null;
      const i = pick(at);
      if (MATRA_PAIRS[c[i]] && rnd() < 0.6) c[i] = MATRA_PAIRS[c[i]];
      else c.splice(i, 1);
      return c.join('');
    }
    case 'lookalike': {
      const at = idx(ch => LOOKALIKE.some(([a, b]) => ch === a || ch === b));
      if (!at.length) return null;
      const i = pick(at);
      const opts = LOOKALIKE.filter(([a, b]) => c[i] === a || c[i] === b).map(([a, b]) => (c[i] === a ? b : a));
      c[i] = pick(opts);
      return c.join('');
    }
    case 'diacritic': {
      const at = idx(ch => ch === ANUSVARA || ch === CHANDRA || ch === NUKTA);
      if (!at.length) return null;
      const i = pick(at);
      if (c[i] === NUKTA) c.splice(i, 1);
      else if (rnd() < 0.5) c[i] = c[i] === ANUSVARA ? CHANDRA : ANUSVARA;
      else c.splice(i, 1);
      return c.join('');
    }
    case 'conjunct': {
      const at = idx(ch => ch === VIRAMA);
      if (!at.length) return null;
      c.splice(pick(at), 1);
      return c.join('');
    }
    case 'split': {
      if (c.length < 4) return null;
      const at = idx((ch, i) => i >= 2 && i <= c.length - 2 && !MATRAS.includes(ch) && ch !== VIRAMA && ch !== NUKTA && ch !== ANUSVARA && ch !== CHANDRA);
      if (!at.length) return null;
      const i = pick(at);
      return c.slice(0, i).join('') + ' ' + c.slice(i).join('');
    }
    case 'unknown_kha': {
      const at = idx(ch => ch === 'ख');
      if (!at.length) return null;
      c.splice(pick(at), 1, 'र', 'व');
      return c.join('');
    }
  }
};

const LATIN_ERRS: Array<[RegExp, string]> = [[/m/, 'rn'], [/rn/, 'm'], [/d/, 'cl'], [/w/, 'vv'], [/l/, '1'], [/i/, 'l'], [/o/, '0'], [/e/, 'c'], [/s/, '5'], [/h/, 'b']];
const corruptLatin = (w: string, kind: 'glyph' | 'split'): string | null => {
  if (kind === 'split') {
    if (w.length < 5) return null;
    const i = 2 + Math.floor(rnd() * (w.length - 3));
    return w.slice(0, i) + ' ' + w.slice(i);
  }
  const usable = LATIN_ERRS.filter(([re]) => re.test(w));
  if (!usable.length) return null;
  const [re, to] = pick(usable);
  const hits = [...w.matchAll(new RegExp(re.source, 'g'))];
  const h = pick(hits);
  return w.slice(0, h.index!) + to + w.slice(h.index! + h[0].length);
};

// ── what the index holds for a document whose OCR text is `text` ──
const indexTokens = async (text: string) => new Set(tokens(withSearchTail(await buildIndexableContent(text))));

// ── matching rules ──
type Matcher = (q: string, toks: Set<string>) => boolean;
const current: Matcher = (q, toks) => {
  const t = termsForQueryWord(q);
  const w = q.toLowerCase();
  for (const tok of toks) {
    if (tok.startsWith(w) || (t.roman && tok.startsWith(t.roman)) || tok === t.key || t.concepts.includes(tok)) return true;
  }
  return false;
};

/** Shape key: letters OCR confuses become one; marks OCR drops are left out. */
const SHAPE_CLASSES: Record<string, string> = {
  'व': 'ब', 'ध': 'द', 'घ': 'द', 'भ': 'म', 'ट': 'त', 'ष': 'प', 'थ': 'य',
  'ी': 'ि', 'ू': 'ु', 'ै': 'े', 'ौ': 'ो', 'ई': 'इ', 'ऊ': 'उ', 'ऐ': 'ए', 'औ': 'ओ',
};
const shapeKeyDeva = (w: string, keepMatras: boolean): string => {
  let s = chars(w).filter(ch => ch !== NUKTA && ch !== VIRAMA && ch !== ANUSVARA && ch !== CHANDRA).join('');
  s = s.replace(/रव/g, 'ख');
  s = [...s].map(ch => SHAPE_CLASSES[ch] ?? ch).filter(ch => keepMatras || !MATRAS.includes(ch)).join('');
  return s;
};
const shapeKeyLatin = (w: string): string =>
  w.toLowerCase().replace(/rn/g, 'm').replace(/cl/g, 'd').replace(/vv/g, 'w').replace(/[1il|]/g, 'l').replace(/0/g, 'o').replace(/5/g, 's').replace(/[ce]/g, 'e').replace(/[hb]/g, 'b');
const shapeKey = (w: string, keepMatras = true) => (DEVA.test(w) ? shapeKeyDeva(w, keepMatras) : shapeKeyLatin(w));

const shapeTokens = (text: string, keepMatras: boolean) =>
  new Set(text.split(/\s+/).filter(Boolean).map(w => shapeKey(w, keepMatras)).filter(k => k.length >= 2));

const editDistance1 = (a: string, b: string): boolean => {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0; while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
};

/** Query expansion: the query plus every single OCR misreading the confusion model knows. */
const expandQuery = (q: string): Set<string> => {
  const out = new Set<string>([q.normalize('NFC')]);
  if (!DEVA.test(q)) {
    for (const [re, to] of LATIN_ERRS) for (const m of q.matchAll(new RegExp(re.source, 'g'))) out.add(q.slice(0, m.index!) + to + q.slice(m.index! + m[0].length));
    return out;
  }
  const c = chars(q);
  c.forEach((ch, i) => {
    const put = (rep: string[]) => out.add([...c.slice(0, i), ...rep, ...c.slice(i + 1)].join('').normalize('NFC'));
    if (MATRA_PAIRS[ch]) put([MATRA_PAIRS[ch]]);
    if (MATRAS.includes(ch) || ch === VIRAMA || ch === NUKTA || ch === ANUSVARA || ch === CHANDRA) put([]);
    if (ch === ANUSVARA) put([CHANDRA]);
    if (ch === CHANDRA) put([ANUSVARA]);
    for (const [a, b] of LOOKALIKE) { if (ch === a) put([b]); if (ch === b) put([a]); }
  });
  return out;
};

type Doc = { text: string; toks: Set<string>; jt?: string; jtoks?: Set<string> };
const methods: Record<string, (q: string, doc: Doc) => boolean> = {
  current: (q, d) => current(q, d.toks),
  shapeKey: (q, d) => current(q, d.toks) || shapeTokens(d.text, true).has(shapeKey(q, true)),
  shapeSkeleton: (q, d) => current(q, d.toks) || shapeTokens(d.text, false).has(shapeKey(q, false)),
  expansion: (q, d) => {
    if (current(q, d.toks)) return true;
    const words = new Set(d.text.split(/\s+/).map(w => w.normalize('NFC').toLowerCase()));
    for (const v of expandQuery(q)) if (words.has(v.toLowerCase())) return true;
    return false;
  },
  soundKeyEdit1: (q, d) => {
    if (current(q, d.toks)) return true;
    const qk = bhashaKey(q);
    if (qk.length < 3) return false;
    for (const tok of d.toks) if (tok.startsWith('qk') && tok.length - 2 >= 3 && editDistance1(tok.slice(2), qk)) return true;
    return false;
  },
};


/** OCR-tolerant sound key: script-free, so it also serves Hinglish typing. */
const foldKey = (k: string) =>
  k.replace(/[vmw]/g, 'b').replace(/g/g, 'd').replace(/n(?=[bcdfghjklmpqrstvwxyz])/g, '').replace(/(.)\1+/g, '$1');
const foldedKeyOf = (w: string) => foldKey(bhashaKey(DEVA.test(w) ? w : shapeKeyLatin(w)));
const foldedTokens = (text: string) => new Set(text.split(/\s+/).filter(Boolean).map(foldedKeyOf).filter(k => k.length >= 2));
const joinedText = (text: string) => {
  const ws = text.split(/\s+/).filter(Boolean);
  const joins: string[] = [];
  for (let i = 0; i + 1 < ws.length; i++) joins.push(ws[i] + ws[i + 1]);
  return joins.length ? `${text} ${joins.join(' ')}` : text;
};
methods.foldedKey = (q: string, d: Doc) => current(q, d.toks) || (foldedKeyOf(q).length >= 3 && foldedTokens(d.text).has(foldedKeyOf(q)));
const joinCache = new Map<string, Set<string>>();
const joinedToks = async (text: string) => {
  let t = joinCache.get(text);
  if (!t) { t = await indexTokens(joinedText(text)); joinCache.set(text, t); }
  return t;
};
methods.tolerant = (q: string, d: Doc) => tolerantOn(q, d.text, d.toks) || (!!d.jt && tolerantOn(q, d.jt, d.jtoks!));
// The combination: shape key + expansion + folded key, all also over joined neighbours.
const tolerantOn = (q: string, text: string, toks: Set<string>) =>
  current(q, toks) || methods.shapeKey(q, { text, toks }) || methods.expansion(q, { text, toks }) || methods.foldedKey(q, { text, toks });

const DOC_WORDS_HI = ('बिजली बिल राशि भुगतान देय तिथि उपभोक्ता संख्या मीटर यूनिट खपत शुल्क कुल बकाया रसीद दवाई दवा गोली खुराक डॉक्टर अस्पताल मरीज जांच रिपोर्ट पर्ची सुबह शाम भोजन आधार पहचान पत्र नाम पिता पति जन्म लिंग पता मोबाइल नंबर बैंक खाता शाखा जमा निकासी ब्याज शेष चेक पासबुक किराया मकान मालिक अनुबंध बीमा पॉलिसी प्रीमियम किस्त ऋण वेतन पेंशन राशन कार्ड परिवार सदस्य मतदाता निर्वाचन आयोग वाहन लाइसेंस पंजीकरण संपत्ति रजिस्ट्री विद्यालय परीक्षा परिणाम अंक प्रमाणपत्र प्रवेश शिक्षा गैस सिलेंडर बुकिंग पानी नगर निगम आयकर विवरण दिनांक हस्ताक्षर सरकार योजना लाभार्थी किसान सम्मान निधि आवेदन फॉर्म ट्रेन टिकट यात्रा स्टेशन प्रस्थान आगमन शादी निमंत्रण कार्यक्रम मंदिर पूजा जन्मदिन ज़मीन फ़ोन सड़क पढ़ाई दफ़्तर विद्युत स्वास्थ्य क्रमांक श्रमिक').split(' ');
const DOC_WORDS_EN = 'electricity bill amount payable due date consumer number meter units invoice receipt total balance medicine tablet prescription doctor hospital patient report aadhaar address mobile bank account branch deposit interest cheque rent agreement insurance policy premium salary pension ration card voter election vehicle licence registration certificate school examination result marks admission ticket train journey station departure arrival booking cylinder water income statement signature government scheme application form invitation wedding birthday'.split(' ');

const HI_VOCAB = vocab.hi.filter(w => DEVA.test(w) && !/[^ऀ-ॿ]/.test(w));
const EN_VOCAB = vocab.en.filter(w => /^[a-z]+$/.test(w));
const HI_TARGETS = [...new Set([...DOC_WORDS_HI, ...HI_VOCAB.slice(150, 1650).filter(w => chars(w).length >= 3)])];

jest.setTimeout(30 * 60 * 1000);

test('experiment 1', async () => {
  const results: Record<string, unknown> = {};
  const DEVA_KINDS: ErrKind[] = ['matra', 'lookalike', 'diacritic', 'conjunct', 'split', 'unknown_kha'];

  // 1. Recall by error kind, Hindi targets: every target, every kind it can have, 2 samples each.
  const recall: Record<string, Record<string, [number, number]>> = {};
  const docRecall: Record<string, Record<string, [number, number]>> = {};
  for (const set of ['doc', 'all'] as const) {
    const targets = set === 'doc' ? DOC_WORDS_HI : HI_TARGETS;
    const table = set === 'doc' ? docRecall : recall;
    for (const w of targets) {
      for (const kind of DEVA_KINDS) {
        for (let s = 0; s < 2; s++) {
          const bad = corruptDeva(w, kind);
          if (!bad || bad === w) continue;
          const doc = { text: bad, toks: await indexTokens(bad), jt: joinedText(bad), jtoks: await joinedToks(bad) };
          for (const [name, m] of Object.entries(methods)) {
            const cell = ((table[name] ??= {})[kind] ??= [0, 0]);
            cell[1]++;
            // Same-script query (typed in Hindi) and Hinglish query (typed in Roman letters).
            if (m(w, doc)) cell[0]++;
          }
          for (const [name, m] of Object.entries(methods)) {
            const cell = ((table[`${name}|hinglish`] ??= {})[kind] ??= [0, 0]);
            cell[1]++;
            if (m(romanize(w).toLowerCase(), doc)) cell[0]++;
          }
        }
      }
    }
  }
  results.recallAllHindi = recall;
  results.recallDocHindi = docRecall;

  // 2. English document words.
  const enRecall: Record<string, Record<string, [number, number]>> = {};
  for (const w of DOC_WORDS_EN) for (const kind of ['glyph', 'split'] as const) for (let s = 0; s < 3; s++) {
    const bad = corruptLatin(w, kind);
    if (!bad || bad === w) continue;
    const doc = { text: bad, toks: await indexTokens(bad), jt: joinedText(bad), jtoks: await joinedToks(bad) };
    for (const [name, m] of Object.entries(methods)) {
      const cell = ((enRecall[name] ??= {})[kind] ??= [0, 0]);
      cell[1]++;
      if (m(w, doc)) cell[0]++;
    }
  }
  results.recallEnglish = enRecall;

  // 3. False matches: other real words (no OCR errors) a query now also finds.
  const vocabDocs: Array<{ w: string; text: string; toks: Set<string> }> = [];
  for (const v of HI_VOCAB) vocabDocs.push({ w: v, text: v, toks: await indexTokens(v) });
  const enDocs: Array<{ w: string; text: string; toks: Set<string> }> = [];
  for (const v of EN_VOCAB.slice(0, 20000)) enDocs.push({ w: v, text: v, toks: await indexTokens(v) });
  const falseMatches: Record<string, { hiMean: number; hiAny: number; enMean: number; enAny: number }> = {};
  for (const [name, m] of Object.entries(methods)) {
    let hiTotal = 0, hiAny = 0, enTotal = 0, enAny = 0;
    for (const q of DOC_WORDS_HI) {
      let n = 0; for (const d of vocabDocs) if (d.w !== q && m(q, d)) n++;
      hiTotal += n; if (n > 0) hiAny++;
    }
    for (const q of DOC_WORDS_EN) {
      let n = 0; for (const d of enDocs) if (d.w !== q && m(q, d)) n++;
      enTotal += n; if (n > 0) enAny++;
    }
    falseMatches[name] = { hiMean: hiTotal / DOC_WORDS_HI.length, hiAny: hiAny / DOC_WORDS_HI.length, enMean: enTotal / DOC_WORDS_EN.length, enAny: enAny / DOC_WORDS_EN.length };
  }
  results.falseMatches = falseMatches;
  // Joining neighbours: how often does a query match a join of two unrelated real words?
  const pairs: Array<{ text: string; toks: Set<string>; jtoks: Set<string> }> = [];
  for (let i = 0; i < 3000; i++) {
    const a = pick(HI_VOCAB.slice(0, 8000)), b = pick(HI_VOCAB.slice(0, 8000));
    const text = `${a} ${b}`;
    pairs.push({ text, toks: await indexTokens(text), jtoks: await indexTokens(joinedText(text)) });
  }
  let joinFalse = 0;
  for (const q of DOC_WORDS_HI) for (const p of pairs) if (!current(q, p.toks) && current(q, p.jtoks)) joinFalse++;
  results.joinFalsePer1000Docs = (1000 * joinFalse) / (DOC_WORDS_HI.length * pairs.length);

  results.sizes = { hiTargets: HI_TARGETS.length, docHi: DOC_WORDS_HI.length, docEn: DOC_WORDS_EN.length, hiVocab: HI_VOCAB.length, enVocab: Math.min(EN_VOCAB.length, 20000) };
  results.examples = DOC_WORDS_HI.slice(0, 12).map(w => ({ w, roman: romanize(w), key: bhashaKey(w), shape: shapeKey(w), skeleton: shapeKey(w, false) }));
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
});
