/**
 * Experiment 4: the typos of typos.exp.ts, corrected by the APP's code.
 * The person's index is built with the real search tail; the vocabulary is
 * read from it the way fts5vocab does (every token with its row count), fed
 * to SpellingRescue.buildVocabulary/correctionsFor, and a sound correction is
 * turned into a word the way SpellingService does (a word in a row holding
 * that key). Policy as shipped: correct only when the typed word finds nothing.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildIndexableContent } from '../../src/utils/TextEnrichment';
import { withSearchTail, termsForQueryWord, visibleContent } from '../../src/utils/SearchKeys';
import { bhashaKey, romanize, tokenizeWords } from '../../src/utils/IndicText';
import { buildVocabulary, correctionsFor } from '../../src/utils/SpellingRescue';

const vocab = JSON.parse(fs.readFileSync(process.env.EXP_VOCAB ?? path.join(__dirname, 'data', 'vocab.json'), 'utf8')) as { hi: string[]; en: string[] };
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const tokens = (text: string) => text.normalize('NFC').split(/[^\p{L}\p{N}\p{Co}\p{Mn}\p{Mc}]+/u).filter(Boolean).map(t => t.toLowerCase());
const indexTokens = async (text: string) => new Set(tokens(withSearchTail(await buildIndexableContent(text))));
const DEVA = /[ऀ-ॿ]/;

const current = (q: string, toks: Set<string>) => {
  const t = termsForQueryWord(q); const w = q.toLowerCase();
  for (const tok of toks) if (tok.startsWith(w) || (t.roman && tok.startsWith(t.roman)) || tok === t.key || t.concepts.includes(tok)) return true;
  return false;
};

// ── phone keyboard typos ──
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const pos: Record<string, [number, number]> = {};
ROWS.forEach((r, y) => [...r].forEach((c, x) => (pos[c] = [x + y * 0.5, y])));
const near = (c: string) => Object.keys(pos).filter(k => k !== c && pos[c] && Math.hypot(pos[k][0] - pos[c][0], pos[k][1] - pos[c][1]) < 1.2);
const typo = (w: string): string => {
  const i = Math.floor(rnd() * w.length);
  const r = rnd();
  if (r < 0.4 && near(w[i]).length) return w.slice(0, i) + pick(near(w[i])) + w.slice(i + 1);   // fat finger
  if (r < 0.65 && w.length > 3) return w.slice(0, i) + w.slice(i + 1);                           // missed key
  if (r < 0.85) return w.slice(0, i) + (near(w[i]).length && rnd() < 0.5 ? pick(near(w[i])) : w[i]) + w.slice(i); // extra key
  if (i < w.length - 1) return w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);                  // swapped
  return w.slice(0, -1);
};

const DOC_HI = 'बिजली बिल राशि भुगतान देय तिथि उपभोक्ता संख्या मीटर यूनिट खपत शुल्क बकाया रसीद दवाई गोली खुराक डॉक्टर अस्पताल मरीज जांच रिपोर्ट पर्ची आधार पहचान पत्र मोबाइल बैंक खाता शाखा जमा निकासी ब्याज पासबुक किराया मकान बीमा पॉलिसी किस्त वेतन पेंशन राशन कार्ड परिवार मतदाता वाहन लाइसेंस पंजीकरण संपत्ति विद्यालय परीक्षा परिणाम प्रमाणपत्र गैस सिलेंडर पानी आयकर हस्ताक्षर योजना किसान आवेदन टिकट यात्रा स्टेशन शादी निमंत्रण'.split(' ');
const DOC_EN = 'electricity bill amount payable consumer meter invoice receipt balance medicine tablet prescription doctor hospital patient report aadhaar address mobile account branch deposit interest cheque agreement insurance policy premium salary pension ration voter election vehicle licence registration certificate school examination result admission ticket journey station departure booking cylinder statement signature government scheme application invitation wedding birthday'.split(' ');

jest.setTimeout(30 * 60 * 1000);

test('experiment 4', async () => {
  const HI = vocab.hi.filter(w => DEVA.test(w) && !/[^\u0900-\u097F]/.test(w));
  const EN = vocab.en.filter(w => /^[a-z]+$/.test(w));
  const out: Record<string, unknown> = {};
  for (const size of [2000, 10000]) {
    const words = [...new Set([...DOC_HI, ...DOC_EN, ...HI.slice(0, size / 2), ...EN.slice(0, size / 2)])];
    // One indexed row per word: its stored text, as indexDocument writes it.
    const rows = new Map<string, string>();
    for (const w of words) rows.set(w, withSearchTail(await buildIndexableContent(w)));
    const rowTokens = new Map<string, Set<string>>();
    for (const [w, c] of rows) rowTokens.set(w, new Set(tokens(c)));
    // fts5vocab: every token, with how many rows contain it.
    const counts = new Map<string, number>();
    for (const t of rowTokens.values()) for (const x of t) counts.set(x, (counts.get(x) ?? 0) + 1);
    const vocabRows = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 40000).map(([term, docs]) => ({ term, docs }));
    const v = buildVocabulary(vocabRows);
    const anyHit = (q: string) => { for (const t of rowTokens.values()) if (current(q, t)) return true; return false; };
    const wordWithKey = (key: string): string | null => {
      for (const c of rows.values()) {
        if (!c.includes(`qk${key}`)) continue;
        const hit = tokenizeWords(visibleContent(c)).find(t => bhashaKey(t) === key);
        if (hit) return hit;
      }
      return null;
    };
    const stats: Record<string, [number, number]> = {};
    const bump = (name: string, ok: boolean) => { const s = (stats[name] ??= [0, 0]); s[1]++; if (ok) s[0]++; };
    let wrongFix = 0, clean = 0;
    for (const target of [...DOC_HI, ...DOC_EN]) {
      const lang = DEVA.test(target) ? 'hinglish' : 'english';
      const intended = DEVA.test(target) ? romanize(target).toLowerCase() : target;
      clean++;
      if (!anyHit(intended) && correctionsFor(intended, v, 1).length > 0) wrongFix++;
      for (let s = 0; s < 6; s++) {
        const q = typo(intended);
        if (q === intended) continue;
        const tt = rowTokens.get(target)!;
        const now = current(q, tt);
        bump(`${lang}: today`, now);
        let fixed = false;
        if (!now && !anyHit(q)) {
          const [best] = correctionsFor(q, v, 1);
          const to = best ? (best.via === 'spelling' ? best.word ?? null : wordWithKey(best.key ?? '')) : null;
          fixed = !!to && current(to, tt);
        }
        bump(`${lang}: with spelling rescue`, now || fixed);
      }
    }
    out[`index of ${words.length} words`] = { stats, correctQueriesCorrected: `${wrongFix}/${clean}`, vocabularyTerms: vocabRows.length };
  }
  fs.writeFileSync(process.env.EXP_OUT ?? path.join(__dirname, 'results', 'app-typos.json'), JSON.stringify(out, null, 1));
});
