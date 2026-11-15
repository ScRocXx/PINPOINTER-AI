/**
 * PaperSeries.ts — "latest electricity bill", "pichla bill", "सबसे नया बिल".
 *
 * Bills, statements and policies come again and again from the same place,
 * and people ask for the newest one. Words like "latest" or "pichla" are
 * almost never printed on the paper, so as search words they found nothing.
 * Here they mean an order instead: newest first, by the paper's own printed
 * date (bill / invoice / statement date, else the bill month, else the due
 * date), else when the photo was taken, else when it was indexed.
 *
 * Papers from the same account (consumer, account, policy number...) form a
 * series: the newest of each series comes first, then the older ones. A yearly
 * insurance renewal then shows next to this month's electricity bill instead
 * of after eleven older electricity bills.
 *
 * Pure: reads the stored (already masked) text only.
 */
import type { DocumentRecord } from '../database/types';
import { DUE_LABELS, MONTH_WORD, dateAfter, monthOf, type FactDate } from './AnswerCards';
import { normalizeIndic } from './IndicText';

const norm = (word: string): string =>
    normalizeIndic(word).toLowerCase().replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '');

const normSet = (words: string[]): Set<string> => new Set(words.map(norm));

/** Words that only ever mean "the newest". */
const STRONG = normSet([
    'latest', 'newest', 'recent',
    'pichla', 'pichhla', 'pichli', 'pichhli', 'pichle', 'pichhle',
    'aakhri', 'akhri', 'aakhiri', 'akhiri', 'taza', 'taaza', 'tazaa', 'navintam',
    'पिछला', 'पिछली', 'पिछले', 'आखिरी', 'आख़िरी', 'आखरी', 'ताज़ा', 'ताजा', 'ताज़ी', 'ताजी', 'नवीनतम', 'हालिया',
]);

/**
 * Words that also mean something else ("New India Assurance", "last date"):
 * newest-first only when no paper found for the query says them.
 */
const WEAK = normSet(['new', 'naya', 'nayi', 'naye', 'nayaa', 'last', 'नया', 'नई', 'नयी', 'नए', 'नये']);

/** "most recent", "sabse naya", "सबसे नया". */
const MOST = normSet(['most', 'sabse', 'सबसे']);

const PICTURE_WORDS = normSet([
    'photo', 'photos', 'picture', 'pictures', 'pic', 'pics', 'image', 'images', 'foto', 'tasveer', 'tasveeren',
    'फोटो', 'फ़ोटो', 'तस्वीर', 'तस्वीरें',
]);
const PAPER_WORDS = normSet([
    'pdf', 'pdfs', 'document', 'documents', 'doc', 'docs', 'paper', 'papers', 'kagaz', 'kaagaz', 'kagaj',
    'कागज़', 'कागज', 'काग़ज़', 'दस्तावेज़', 'दस्तावेज',
]);

export interface Recency {
    /** The query without its "latest" words. */
    rest: string;
    /** The "latest" words found (normalised). */
    words: string[];
    /** Only words that also mean something else ("new", "naya", "last"). */
    weakOnly: boolean;
    /** Nothing else asked but "photos" or "papers": the newest of those. */
    only?: 'IMAGE' | 'DOCUMENT';
}

/** True for a word that asks for the newest ("latest", "pichla", "नया"). */
export const isRecencyWord = (word: string): boolean => {
    const w = norm(word);
    return STRONG.has(w) || WEAK.has(w);
};

/** The query's "latest" words, or null when it has none. */
export const parseRecency = (query: string): Recency | null => {
    const parts = (query ?? '').split(/\s+/).filter(Boolean);
    const words = parts.map(norm);
    const drop = parts.map(() => false);
    const found: string[] = [];
    let strong = false;
    words.forEach((w, i) => {
        if (!STRONG.has(w) && !WEAK.has(w)) return;
        drop[i] = true;
        found.push(w);
        if (STRONG.has(w)) strong = true;
        if (i > 0 && MOST.has(words[i - 1])) drop[i - 1] = true;
        if (i > 1 && words[i - 2] === 'sab' && words[i - 1] === 'se') drop[i - 1] = drop[i - 2] = true;
    });
    if (found.length === 0) return null;
    const restParts = parts.filter((_, i) => !drop[i]);
    const restWords = restParts.map(norm).filter(Boolean);
    const recency: Recency = { rest: restParts.join(' '), words: found, weakOnly: !strong };
    if (restWords.length > 0 && restWords.every(w => PICTURE_WORDS.has(w))) {
        recency.rest = '';
        recency.only = 'IMAGE';
    } else if (restWords.length > 0 && restWords.every(w => PAPER_WORDS.has(w))) {
        recency.rest = '';
        recency.only = 'DOCUMENT';
    }
    return recency;
};

/** True when the paper's own words include one of `words` ("New India Assurance"). */
export const saysAnyOf = (doc: DocumentRecord, words: ReadonlyArray<string>): boolean => {
    const text = `${doc.title ?? ''} ${doc.content ?? ''}`;
    const own = new Set(normalizeIndic(text).toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean));
    return words.some(w => own.has(w));
};

// ─── The paper's own date ───────────────────────────────────────────────────

/** Labels of the day a paper was made. */
const ISSUE_LABELS = /(?<![\p{L}\p{M}\p{N}])(bill\s*date|bill\s*dt\.?|billing\s*date|date\s*of\s*bill|bill\s*issue\s*date|issue\s*date|date\s*of\s*issue|issued\s*on|invoice\s*date|inv\.?\s*date|statement\s*date|receipt\s*date|transaction\s*date|txn\s*date|generated\s*on|बिल\s*दिनांक|बिल\s*तिथि|बिल\s*की\s*तारीख|जारी\s*करने\s*की\s*तिथि)/giu;
/** Labels of the month a bill is for ("Bill Month: OCT-2025"). */
const MONTH_LABELS = /(?<![\p{L}\p{M}\p{N}])(bill\s*month|billing\s*month|bill\s*for(\s*the)?(\s*month)?(\s*of)?|for\s*the\s*month\s*of|month\s*of|बिल\s*माह|बिल\s*का\s*महीना)/giu;
/** Labels of the time a bill covers ("Billing period 01-09-2025 to 30-09-2025"). */
const PERIOD_LABELS = /(?<![\p{L}\p{M}\p{N}])(billing\s*period|bill\s*period|period\s*from|period|बिल\s*अवधि|अवधि)/giu;

const toMs = (d: FactDate): number => new Date(d.y, d.m - 1, d.d).getTime();

/** "OCT-2025", "October 2025", "10/2025" right after a month label: the 1st of that month. */
const monthAfter = (text: string): FactDate | null => {
    for (const m of text.matchAll(MONTH_LABELS)) {
        const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 25);
        const named = after.match(new RegExp(`^[\\s:.\\-–]*(${MONTH_WORD})[\\s\\-,'’.]*(\\d{2,4})(?!\\d)`, 'iu'));
        if (named) {
            const month = monthOf(named[1]);
            const raw = Number(named[named.length - 1]);
            const y = raw < 100 ? 2000 + raw : raw;
            if (month && y >= 2000 && y <= 2099) return { y, m: month, d: 1 };
        }
        const numeric = after.match(/^[\s:.\-–]*(\d{1,2})\s*[/-]\s*(\d{4})(?![\d/.-])/);
        if (numeric) {
            const month = Number(numeric[1]);
            const y = Number(numeric[2]);
            if (month >= 1 && month <= 12 && y >= 2000 && y <= 2099) return { y, m: month, d: 1 };
        }
    }
    return null;
};

/** How far ahead of the photo (or of now) a printed date may be: due dates run ahead. */
const AHEAD_MS = 120 * 24 * 60 * 60 * 1000;

/**
 * The date printed on the paper, in ms, or null when there is no labelled
 * one or it can't be right (later than the photo, or now, by over 120 days:
 * a misread year).
 */
export const paperDate = (doc: DocumentRecord, now: number = Date.now()): number | null => {
    const text = (doc.content ?? '').replace(/\s+/g, ' ');
    if (!text.trim()) return null;
    const found = dateAfter(text, ISSUE_LABELS) ?? monthAfter(text) ?? dateAfter(text, DUE_LABELS) ?? dateAfter(text, PERIOD_LABELS);
    if (!found) return null;
    const ms = toMs(found);
    const ceiling = (typeof doc.takenAt === 'number' ? Math.min(doc.takenAt, now) : now) + AHEAD_MS;
    return ms <= ceiling ? ms : null;
};

/** When the paper is from: its printed date, else when the photo was taken, else when it was indexed. */
export const whenOf = (doc: DocumentRecord, now: number = Date.now()): number =>
    paperDate(doc, now) ?? (typeof doc.takenAt === 'number' ? doc.takenAt : doc.timestamp ?? 0);

// ─── Series ─────────────────────────────────────────────────────────────────

/** Labels of the number that stays the same from bill to bill. */
const ACCOUNT_LABELS = /(?<![\p{L}\p{M}\p{N}])(consumer(?:\s*(?:no|number|id|code))?|ca\s*(?:no|number)|contract\s*account(?:\s*(?:no|number))?|account\s*(?:no|number|id)|a\/c\s*(?:no|number)?|acct\.?\s*(?:no|number)?|k\.?\s*no|customer\s*(?:id|no|number)|bp\s*(?:no|number)|service\s*(?:no|number)|connection\s*(?:id|no|number)|lpg\s*id|policy\s*(?:no|number)|subscriber\s*id|relationship\s*(?:no|number)|card\s*(?:no|number)|loan\s*(?:account\s*)?(?:no|number)|उपभोक्ता\s*(?:संख्या|क्रमांक|नंबर|सं|नं)|खाता\s*(?:संख्या|क्रमांक|नंबर|सं|नं)|ग्राहक\s*(?:संख्या|आईडी|नंबर|क्रमांक)|पॉलिसी\s*(?:संख्या|नंबर|क्रमांक)|कनेक्शन\s*(?:संख्या|नंबर))/giu;

/**
 * The paper's account number (consumer no., CA no., policy no....), the
 * same on every bill of one connection; null when none is labelled. Read
 * from masked text, so a masked number ("******3210") is its key; OCR's
 * O/0 and I/l/1 slips are folded so one misread digit doesn't split a series.
 */
export const seriesKey = (doc: DocumentRecord): string | null => {
    const text = (doc.content ?? '').replace(/\s+/g, ' ');
    for (const m of text.matchAll(ACCOUNT_LABELS)) {
        const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 48);
        const lead = after.match(/^[\s.:#\-–=]*(?:no\.?)?[\s.:#\-–=]*/iu)?.[0].length ?? 0;
        const tokens = after.slice(lead).split(' ');
        let value = (tokens[0] ?? '').replace(/[^A-Za-z0-9*]+$/u, '');
        // "XXXX XXXX 1234": groups of digits and masks read as one number.
        if (/^[\dXx*]{2,}$/.test(value)) {
            for (const t of tokens.slice(1, 6)) {
                const group = t.replace(/[^A-Za-z0-9*]+$/u, '');
                if (!/^[\dXx*]{2,6}$/.test(group)) break;
                value += group;
            }
        }
        if (!/^[A-Za-z0-9*][A-Za-z0-9*/-]{3,29}$/.test(value)) continue;
        if ((value.match(/\d/g) ?? []).length < 3) continue;
        return value.toUpperCase().replace(/[/-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
    }
    return null;
};

/**
 * Newest first. The newest paper of each series (and every paper without
 * one) comes first, by date; then the older papers of each series, by date.
 * Ties keep their search order.
 */
export const newestFirst = (docs: ReadonlyArray<DocumentRecord>, now: number = Date.now()): DocumentRecord[] => {
    const dated = docs.map((doc, i) => ({ doc, i, when: whenOf(doc, now), series: seriesKey(doc) }));
    const newest = new Map<string, number>();
    for (const d of dated) {
        if (!d.series) continue;
        const best = newest.get(d.series);
        if (best === undefined || d.when > dated[best].when) newest.set(d.series, d.i);
    }
    const head = (d: { i: number; series: string | null }): number => (!d.series || newest.get(d.series) === d.i ? 0 : 1);
    return [...dated].sort((a, b) => head(a) - head(b) || b.when - a.when || a.i - b.i).map(d => d.doc);
};
