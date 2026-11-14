/**
 * Experiment 3: the same simulated OCR misreadings as ocr-misreads.exp.ts,
 * searched with the APP's code: the search tail from SearchKeys.withSearchTail
 * (now with OcrTolerance's keys) and the query terms from termsForQueryWord +
 * tolerantTermsForQueryWord, matched with FTS5 rules (prefix on the word and
 * its romanized form, exact on every other term). Checks that the shipped
 * implementation, with its size trims, keeps what experiment 1 predicted.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildIndexableContent } from '../../src/utils/TextEnrichment';
import { withSearchTail, termsForQueryWord } from '../../src/utils/SearchKeys';
import { tolerantTermsForQueryWord } from '../../src/utils/OcrTolerance';
import { romanize } from '../../src/utils/IndicText';

const OUT = process.env.EXP_OUT ?? path.join(__dirname, 'results', 'app-search.json');
const vocab = JSON.parse(fs.readFileSync(process.env.EXP_VOCAB ?? path.join(__dirname, 'data', 'vocab.json'), 'utf8')) as { hi: string[]; en: string[] };

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


const DOC_WORDS_HI = ('बिजली बिल राशि भुगतान देय तिथि उपभोक्ता संख्या मीटर यूनिट खपत शुल्क कुल बकाया रसीद दवाई दवा गोली खुराक डॉक्टर अस्पताल मरीज जांच रिपोर्ट पर्ची सुबह शाम भोजन आधार पहचान पत्र नाम पिता पति जन्म लिंग पता मोबाइल नंबर बैंक खाता शाखा जमा निकासी ब्याज शेष चेक पासबुक किराया मकान मालिक अनुबंध बीमा पॉलिसी प्रीमियम किस्त ऋण वेतन पेंशन राशन कार्ड परिवार सदस्य मतदाता निर्वाचन आयोग वाहन लाइसेंस पंजीकरण संपत्ति रजिस्ट्री विद्यालय परीक्षा परिणाम अंक प्रमाणपत्र प्रवेश शिक्षा गैस सिलेंडर बुकिंग पानी नगर निगम आयकर विवरण दिनांक हस्ताक्षर सरकार योजना लाभार्थी किसान सम्मान निधि आवेदन फॉर्म ट्रेन टिकट यात्रा स्टेशन प्रस्थान आगमन शादी निमंत्रण कार्यक्रम मंदिर पूजा जन्मदिन ज़मीन फ़ोन सड़क पढ़ाई दफ़्तर विद्युत स्वास्थ्य क्रमांक श्रमिक').split(' ');
const DOC_WORDS_EN = 'electricity bill amount payable due date consumer number meter units invoice receipt total balance medicine tablet prescription doctor hospital patient report aadhaar address mobile bank account branch deposit interest cheque rent agreement insurance policy premium salary pension ration card voter election vehicle licence registration certificate school examination result marks admission ticket train journey station departure arrival booking cylinder water income statement signature government scheme application form invitation wedding birthday'.split(' ');

const HI_VOCAB = vocab.hi.filter(w => DEVA.test(w) && !/[^ऀ-ॿ]/.test(w));
const EN_VOCAB = vocab.en.filter(w => /^[a-z]+$/.test(w));
const HI_TARGETS = [...new Set([...DOC_WORDS_HI, ...HI_VOCAB.slice(150, 1650).filter(w => chars(w).length >= 3)])];


const indexTokens = async (text: string) => new Set(tokens(withSearchTail(await buildIndexableContent(text))));

/** Today's search: one group per query word, as search.ts builds it. */
const exact = (q: string, toks: Set<string>): boolean => {
  const t = termsForQueryWord(q);
  const w = q.toLowerCase();
  for (const tok of toks) {
    if (tok.startsWith(w) || (t.roman && tok.startsWith(t.roman)) || tok === t.key || t.concepts.includes(tok)) return true;
  }
  return false;
};

/** The misread tier: the same group plus the tolerant terms (all exact tokens). */
const tolerant = (q: string, toks: Set<string>): boolean => {
  if (exact(q, toks)) return true;
  const t = tolerantTermsForQueryWord(q);
  return [...t.shapes, ...t.folded, ...t.joined].some(term => toks.has(term.toLowerCase()));
};

jest.setTimeout(30 * 60 * 1000);

test('experiment 3', async () => {
  const DEVA_KINDS: ErrKind[] = ['matra', 'lookalike', 'diacritic', 'conjunct', 'split', 'unknown_kha'];
  const recall: Record<string, Record<string, [number, number]>> = {};
  const bump = (row: string, kind: string, ok: boolean) => { const c = ((recall[row] ??= {})[kind] ??= [0, 0]); c[1]++; if (ok) c[0]++; };
  for (const w of DOC_WORDS_HI) for (const kind of DEVA_KINDS) for (let s = 0; s < 2; s++) {
    const bad = corruptDeva(w, kind);
    if (!bad || bad === w) continue;
    const toks = await indexTokens(bad);
    bump('hindi typed in Hindi: today', kind, exact(w, toks));
    bump('hindi typed in Hindi: app', kind, tolerant(w, toks));
    const hinglish = romanize(w).toLowerCase();
    bump('hindi typed in Hinglish: today', kind, exact(hinglish, toks));
    bump('hindi typed in Hinglish: app', kind, tolerant(hinglish, toks));
  }
  for (const w of DOC_WORDS_EN) for (const kind of ['glyph', 'split'] as const) for (let s = 0; s < 3; s++) {
    const bad = corruptLatin(w, kind);
    if (!bad || bad === w) continue;
    const toks = await indexTokens(bad);
    bump('english: today', kind, exact(w, toks));
    bump('english: app', kind, tolerant(w, toks));
  }
  // False matches: other real words each query also finds.
  const HI = vocab.hi.filter(x => DEVA.test(x) && !/[^\u0900-\u097F]/.test(x));
  const EN = vocab.en.filter(x => /^[a-z]+$/.test(x)).slice(0, 20000);
  const hiDocs: Array<[string, Set<string>]> = [];
  for (const v of HI) hiDocs.push([v, await indexTokens(v)]);
  const enDocs: Array<[string, Set<string>]> = [];
  for (const v of EN) enDocs.push([v, await indexTokens(v)]);
  const falseMatches: Record<string, number> = {};
  for (const [name, m] of [['today', exact], ['app', tolerant]] as const) {
    let hi = 0, en = 0;
    for (const q of DOC_WORDS_HI) for (const [v, t] of hiDocs) if (v !== q && m(q, t)) hi++;
    for (const q of DOC_WORDS_EN) for (const [v, t] of enDocs) if (v !== q && m(q, t)) en++;
    falseMatches[`${name}: hindi per query`] = hi / DOC_WORDS_HI.length;
    falseMatches[`${name}: english per query`] = en / DOC_WORDS_EN.length;
  }
  fs.writeFileSync(OUT, JSON.stringify({ recall, falseMatches }, null, 1));
});
