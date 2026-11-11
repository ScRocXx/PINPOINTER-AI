/**
 * MatchTerms.ts — why a result matched, in words the screen can show.
 *
 * Search finds "आधार" for "aadhaar" through sound keys and concepts (see
 * SearchKeys.ts), so the typed word often isn't in the text at all. These
 * helpers find the words that DID match, so the screen can mark them, and
 * name what else the query was searched as ("Also searched: आधार, aadhar").
 *
 * Pure and synchronous; cheap enough to run per visible row.
 */
import { CONCEPTS, conceptsForWord } from './ConceptTable';
import { bhashaKey, containsIndic, romanize, tokenizeWords } from './IndicText';
import { queryWords } from './SearchKeys';

const DEVANAGARI = /[ऀ-ॿ]/;
const conceptWords = new Map(CONCEPTS.map(c => [c.id, c.words]));

/** Lowercased query words, at least 2 letters (single letters match everything). */
const cleanQueryWords = (query: string): string[] =>
    queryWords(query).map(w => w.toLowerCase()).filter(w => w.length >= 2);

/** Two spellings of one word ("aadhaar" / "aadhaars"), not a new word. */
const sameStem = (a: string, b: string): boolean => a.startsWith(b) || b.startsWith(a);

/**
 * Other forms the query was searched as, for the "Also searched" line:
 * the Hindi word for an English or Hinglish query, the Roman spelling for a
 * Hindi query, and one other spelling or English word. At most `max`.
 *
 *   "aadhaar"  → ["आधार", "aadhar"]
 *   "bijli"    → ["बिजली", "electricity"]
 *   "दवाई"     → ["dawa", "medicine"]
 */
export const alsoSearchedAs = (query: string, max = 3): string[] => {
    const words = cleanQueryWords(query);
    const typed = new Set(words);
    const out: string[] = [];
    const add = (w: string | undefined): void => {
        const f = w?.trim().toLowerCase();
        if (!f || typed.has(f) || out.some(o => o.toLowerCase() === f)) return;
        out.push(w!.trim());
    };

    for (const w of words) {
        const indic = containsIndic(w);
        const key = bhashaKey(w);
        const related = conceptsForWord(w).flatMap(id => conceptWords.get(id) ?? []);
        if (indic) {
            // The usual Roman spelling ("dawai"), else the letter-by-letter one.
            add(related.find(r => !containsIndic(r) && bhashaKey(r) === key) ?? romanize(w).toLowerCase());
            // An English word for the same meaning.
            add(related.find(r => !containsIndic(r) && bhashaKey(r) !== key));
        } else {
            // The Hindi word, preferring one that sounds like what was typed.
            const hindi = related.filter(r => DEVANAGARI.test(r));
            add(hindi.find(r => bhashaKey(r) === key) ?? hindi[0]);
            add(related.find(r => !containsIndic(r) && !sameStem(r.toLowerCase(), w)));
        }
        if (out.length >= max) break;
    }
    return out.slice(0, max);
};

/**
 * The words in `text` that match `query`: the same word or its start (the
 * index matches prefixes), the same sound in any script, or the same
 * meaning. These are what HighlightedText and the lock-on corners mark.
 * In text order, each word once.
 */
export const matchTermsIn = (text: string, query: string): string[] => {
    if (!text) return [];
    const words = cleanQueryWords(query);
    if (words.length === 0) return [];
    const keys = new Set(words.map(bhashaKey).filter(Boolean));
    const romans = new Set(words.filter(containsIndic).map(w => romanize(w).toLowerCase()));
    const concepts = new Set(words.flatMap(conceptsForWord));

    const found: string[] = [];
    const seen = new Set<string>();
    for (const token of tokenizeWords(text)) {
        const lower = token.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        const prefix = words.some(w => lower.startsWith(w)) || romans.has(lower);
        const sound = !prefix && keys.size > 0 && keys.has(bhashaKey(token));
        const meaning = !prefix && !sound && concepts.size > 0 && conceptsForWord(token).some(id => concepts.has(id));
        if (prefix || sound || meaning) found.push(token);
    }
    return found;
};

/** Case-insensitive position of the earliest term in `text`, or -1. */
export const firstMatchIndex = (text: string, terms: ReadonlyArray<string>): number => {
    const lower = text.toLowerCase();
    let best = -1;
    for (const t of terms) {
        if (!t) continue;
        const i = lower.indexOf(t.toLowerCase());
        if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    return best;
};

/**
 * A one-line excerpt that STARTS at the first matched word, so the word
 * sits at the very start of the row's text where the lock-on corners can
 * frame it. Without a match it is the start of the text.
 */
export const snippetFrom = (text: string, terms: ReadonlyArray<string>, maxLen = 140): string => {
    const flat = (text ?? '').replace(/\s+/g, ' ').trim();
    if (!flat) return '';
    const i = firstMatchIndex(flat, terms);
    const start = i > 0 ? i : 0;
    const cut = flat.slice(start, start + maxLen).trim();
    return start + maxLen < flat.length ? `${cut}…` : cut;
};
