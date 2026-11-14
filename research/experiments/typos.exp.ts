/**
 * Experiment 2: typing mistakes in Hinglish/English queries. Today's search
 * vs correcting the query against the person's OWN index vocabulary.
 */
import * as fs from 'fs';
import { buildIndexableContent } from '../../src/utils/TextEnrichment';
import { withSearchTail, termsForQueryWord } from '../../src/utils/SearchKeys';
import { bhashaKey, romanize } from '../../src/utils/IndicText';

const vocab = JSON.parse(fs.readFileSync(process.env.EXP_VOCAB ?? require('path').join(__dirname, 'data', 'vocab.json'), 'utf8')) as { hi: string[]; en: string[] };
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

// ── Damerau-Levenshtein with a cap ──
const dl = (a: string, b: string, max: number): number => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
};

const DOC_HI = 'बिजली बिल राशि भुगतान देय तिथि उपभोक्ता संख्या मीटर यूनिट खपत शुल्क बकाया रसीद दवाई गोली खुराक डॉक्टर अस्पताल मरीज जांच रिपोर्ट पर्ची आधार पहचान पत्र मोबाइल बैंक खाता शाखा जमा निकासी ब्याज पासबुक किराया मकान बीमा पॉलिसी किस्त वेतन पेंशन राशन कार्ड परिवार मतदाता वाहन लाइसेंस पंजीकरण संपत्ति विद्यालय परीक्षा परिणाम प्रमाणपत्र गैस सिलेंडर पानी आयकर हस्ताक्षर योजना किसान आवेदन टिकट यात्रा स्टेशन शादी निमंत्रण'.split(' ');
const DOC_EN = 'electricity bill amount payable consumer meter invoice receipt balance medicine tablet prescription doctor hospital patient report aadhaar address mobile account branch deposit interest cheque agreement insurance policy premium salary pension ration voter election vehicle licence registration certificate school examination result admission ticket journey station departure booking cylinder statement signature government scheme application invitation wedding birthday'.split(' ');

jest.setTimeout(30 * 60 * 1000);

test('experiment 2', async () => {
  const HI = vocab.hi.filter(w => DEVA.test(w) && !/[^ऀ-ॿ]/.test(w));
  const EN = vocab.en.filter(w => /^[a-z]+$/.test(w));
  const out: Record<string, unknown> = {};
  for (const size of [2000, 10000]) {
    // The person's index: their document words + other words, each with how often it occurs (wordfreq rank as a proxy).
    const words = [...new Set([...DOC_HI, ...DOC_EN, ...HI.slice(0, size / 2), ...EN.slice(0, size / 2)])];
    const freq = new Map<string, number>();
    words.forEach((w, i) => freq.set(w, 1 / (1 + i)));
    DOC_HI.concat(DOC_EN).forEach(w => freq.set(w, 0.01)); // document words are common in this person's papers
    // What a typed Latin query is compared with: English words, and Hindi words as they are typed (romanized).
    const surface = new Map<string, string>(); // typed form -> indexed word
    for (const w of words) surface.set(DEVA.test(w) ? romanize(w).toLowerCase() : w, w);
    const byKey = new Map<string, string[]>();
    for (const w of words) { const k = bhashaKey(w); if (k) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(w); }
    const docToks = new Map<string, Set<string>>();
    for (const w of words) docToks.set(w, await indexTokens(w));

    const anyHit = (q: string) => { for (const t of docToks.values()) if (current(q, t)) return true; return false; };
    const correctSurface = (q: string, k: number) => {
      const max = q.length <= 4 ? 1 : 2;
      const c: Array<[number, number, string]> = [];
      for (const [s, w] of surface) { const d = dl(q, s, max); if (d <= max) c.push([d, -(freq.get(w) ?? 0), w]); }
      return c.sort((x, y) => x[0] - y[0] || x[1] - y[1]).slice(0, k).map(x => x[2]);
    };
    const correctKey = (q: string, k: number) => {
      const qk = bhashaKey(q); if (qk.length < 2) return [];
      const c: Array<[number, number, string]> = [];
      for (const [key, ws] of byKey) { const d = dl(qk, key, 1); if (d <= 1) for (const w of ws) c.push([d, -(freq.get(w) ?? 0), w]); }
      return c.sort((x, y) => x[0] - y[0] || x[1] - y[1]).slice(0, k).map(x => x[2]);
    };

    const stats: Record<string, [number, number]> = {};
    const bump = (name: string, ok: boolean) => { const s = (stats[name] ??= [0, 0]); s[1]++; if (ok) s[0]++; };
    let falseFix = 0, cleanN = 0;
    for (const target of [...DOC_HI, ...DOC_EN]) {
      const intended = DEVA.test(target) ? romanize(target).toLowerCase() : target;
      const tt = docToks.get(target)!;
      // A correct query must never be "corrected" away from what was meant.
      cleanN++; if (!anyHit(intended)) falseFix++;
      for (let s = 0; s < 6; s++) {
        const q = typo(intended);
        if (q === intended) continue;
        const lang = DEVA.test(target) ? 'hinglish' : 'english';
        const now = current(q, tt);
        bump(`${lang}: today`, now);
        const s1 = correctSurface(q, 1), s3 = correctSurface(q, 3), k1 = correctKey(q, 1), k3 = correctKey(q, 3);
        bump(`${lang}: spelling fix, top 1`, now || s1.includes(target));
        bump(`${lang}: spelling fix, top 3`, now || s3.includes(target));
        bump(`${lang}: sound-key fix, top 1`, now || k1.includes(target));
        bump(`${lang}: both fixes, top 3`, now || s3.includes(target) || k3.includes(target));
        // Realistic policy: fix only when the typed word finds nothing at all in the index.
        const nothing = !anyHit(q);
        bump(`${lang}: fix only when nothing found`, now || (nothing && (s3.includes(target) || k3.includes(target))));
        bump(`${lang}: (typed word finds nothing)`, nothing);
      }
    }
    // Speed of a plain scan over the vocabulary (Node; a phone is slower).
    const t0 = Date.now(); for (let i = 0; i < 50; i++) correctSurface('bijlee', 3); const ms = (Date.now() - t0) / 50;
    out[`vocab ${words.length}`] = { stats, cleanQueriesThatFindNothing: `${falseFix}/${cleanN}`, scanMsPerQuery: ms };
  }
  fs.writeFileSync(process.env.EXP_OUT ?? require('path').join(__dirname, 'results', 'typos.json'), JSON.stringify(out, null, 1));
});
