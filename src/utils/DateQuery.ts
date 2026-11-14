/**
 * DateQuery.ts — "Diwali photos", "pichhle mahine ka bill", "kal ki photo":
 * the date words of a search, as time windows on when a photo was taken.
 *
 * Older people remember when something happened (a festival, "last month")
 * better than the words in it. Hindi date expressions and festivals have no
 * ready-made parser; this one is small, offline and needs no table that goes
 * out of date: festivals that follow the moon are computed.
 *
 * - Moon phases: Meeus, "Astronomical Algorithms" ch. 49 (mean phase plus the
 *   main periodic terms; minutes of error, far inside the windows used).
 * - Hindu festivals: the lunar month is named by the sidereal sign the sun is
 *   in at its new moon (amanta). Diwali is the new moon while the sun is in
 *   Tula; when two new moons fall in one sign, the first month is the extra
 *   (adhik) one, so the LAST such new moon counts (2020 and 2023 had one).
 *   The sign is worked out at the moment of the new moon (sun's longitude,
 *   Meeus ch. 25, minus the Lahiri ayanamsa): calendar-day windows put the
 *   2020 new moon of 17 Oct, 01:01 IST, in the wrong month.
 * - Eid: the arithmetic Islamic calendar; Indian dates are often a day later,
 *   so its windows are a day wider.
 *
 * Windows are in the phone's local time (Indian phones: IST); festival days
 * are worked out in IST.
 */
import { normalizeIndic } from './IndicText';

const DAY = 86400000;
const IST_OFFSET_MS = 5.5 * 3600000;
const RAD = Math.PI / 180;

// ─── Moon phases (Meeus ch. 49) ──────────────────────────────────────────────

/** Julian ephemeris day of new moon (phase 0) or full moon (phase 0.5) number k. */
export const moonPhaseJde = (k: number): number => {
    const T = k / 1236.85;
    let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T * T - 0.00000015 * T * T * T;
    const E = 1 - 0.002516 * T - 0.0000074 * T * T;
    const M = (2.5534 + 29.1053567 * k - 0.0000014 * T * T) * RAD;
    const Mp = (201.5643 + 385.81693528 * k + 0.0107582 * T * T) * RAD;
    const F = (160.7108 + 390.67050284 * k - 0.0016118 * T * T) * RAD;
    const Om = (124.7746 - 1.56375588 * k + 0.0020672 * T * T) * RAD;
    const full = Math.abs(k - Math.floor(k) - 0.5) < 1e-9;
    const [a1, a2, a3, a4, a5] = full
        ? [-0.40614, 0.17302, 0.01614, 0.01043, 0.00734]
        : [-0.4072, 0.17241, 0.01608, 0.01039, 0.00739];
    jde +=
        a1 * Math.sin(Mp) +
        a2 * E * Math.sin(M) +
        a3 * Math.sin(2 * Mp) +
        a4 * Math.sin(2 * F) +
        a5 * E * Math.sin(Mp - M) -
        (full ? 0.00515 : 0.00514) * E * Math.sin(Mp + M) +
        (full ? 0.00209 : 0.00208) * E * E * Math.sin(2 * M) -
        0.00111 * Math.sin(Mp - 2 * F) -
        0.00057 * Math.sin(Mp + 2 * F) +
        0.00056 * E * Math.sin(2 * Mp + M) -
        0.00042 * Math.sin(3 * Mp) +
        0.00042 * E * Math.sin(M + 2 * F) +
        0.00038 * E * Math.sin(M - 2 * F) -
        0.00024 * E * Math.sin(2 * Mp - M) -
        0.00017 * Math.sin(Om);
    return jde;
};

const jdeToMs = (jde: number): number => (jde - 2440587.5) * DAY;

/** A calendar day: year, month 1–12, day. */
export interface Ymd {
    y: number;
    m: number;
    d: number;
}

/** The IST calendar day of a moment. */
const istDay = (ms: number): Ymd => {
    const t = new Date(ms + IST_OFFSET_MS);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

const dayNumber = ({ y, m, d }: Ymd): number => Date.UTC(y, m - 1, d) / DAY;
const fromDayNumber = (n: number): Ymd => {
    const t = new Date(n * DAY);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};

/** Every new moon (phase 0) or full moon (0.5) whose IST day is in a Gregorian year. */
const phasesInYear = (year: number, phase: 0 | 0.5): Array<{ jde: number; day: Ymd }> => {
    const k0 = Math.floor((year - 2000) * 12.3685) - 2;
    const out: Array<{ jde: number; day: Ymd }> = [];
    for (let k = k0; k < k0 + 17; k++) {
        const jde = moonPhaseJde(k + phase);
        const day = istDay(jdeToMs(jde));
        if (day.y === year) out.push({ jde, day });
    }
    return out;
};

/** The sidereal (Lahiri) sign the sun is in at a moment: 0 Mesha … 5 Kanya, 6 Tula … 11 Meena. */
export const sunSign = (jde: number): number => {
    const T = (jde - 2451545) / 36525;
    const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
    const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * RAD;
    const C =
        (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
        (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
        0.000289 * Math.sin(3 * M);
    const ayanamsa = 23.853 + ((jde - 2451545) / 365.25) * 0.013969;
    const lon = (((L0 + C - ayanamsa) % 360) + 360) % 360;
    return Math.floor(lon / 30);
};

/** The amanta month's new moon: the LAST new moon of the year with the sun in `sign`. */
const monthNewMoon = (year: number, sign: number): Ymd | null => {
    const inSign = phasesInYear(year, 0).filter(p => sunSign(p.jde) === sign);
    return inSign.length ? inSign[inSign.length - 1].day : null;
};

/** The first full moon after a day. */
const fullMoonAfter = (day: Ymd): Ymd | null => {
    const n = dayNumber(day);
    for (const y of [day.y, day.y + 1]) {
        for (const f of phasesInYear(y, 0.5)) if (dayNumber(f.day) > n) return f.day;
    }
    return null;
};

/** The sun's sidereal sign at the new moon that starts each month we need. */
const SIGN = { karka: 3, simha: 4, kanya: 5, tula: 6, kumbha: 10 };

// ─── Islamic calendar (arithmetic) ───────────────────────────────────────────

/** Gregorian day of an Islamic (arithmetic, civil) date. */
export const hijriToGregorian = (hy: number, hm: number, hd: number): Ymd => {
    const jd = Math.floor((11 * hy + 3) / 30) + 354 * hy + 30 * hm - Math.floor((hm - 1) / 2) + hd + 1948440 - 385;
    return fromDayNumber(jd - 2440588);
};

const islamicInYear = (year: number, hm: number, hd: number): Ymd[] => {
    const hy0 = Math.floor((year - 622) * (33 / 32));
    const out: Ymd[] = [];
    for (let hy = hy0 - 2; hy <= hy0 + 2; hy++) {
        const g = hijriToGregorian(hy, hm, hd);
        if (g.y === year) out.push(g);
    }
    return out;
};

// ─── Festivals ───────────────────────────────────────────────────────────────

export type FestivalId =
    | 'diwali' | 'holi' | 'rakhi' | 'navratri' | 'dussehra' | 'ganesh' | 'karva' | 'chhath'
    | 'eid' | 'bakrid' | 'christmas' | 'newyear' | 'sankranti' | 'republic' | 'independence';

/** One festival in one year: its days, first to last (inclusive), in IST. */
export interface FestivalDays {
    start: Ymd;
    end: Ymd;
}

const span = (day: Ymd, before: number, after: number): FestivalDays => ({
    start: fromDayNumber(dayNumber(day) - before),
    end: fromDayNumber(dayNumber(day) + after),
});

/** The days of a festival in a year (null when it can't be worked out). */
export const festivalDays = (id: FestivalId, year: number): FestivalDays | null => {
    switch (id) {
        case 'diwali': {
            // Dhanteras … Bhai Dooj around the new moon.
            const nm = monthNewMoon(year, SIGN.tula);
            return nm ? span(nm, 3, 2) : null;
        }
        case 'karva': {
            const nm = monthNewMoon(year, SIGN.tula);
            return nm ? span(fromDayNumber(dayNumber(nm) - 12), 1, 1) : null;
        }
        case 'chhath': {
            const nm = monthNewMoon(year, SIGN.tula);
            return nm ? span(fromDayNumber(dayNumber(nm) + 6), 2, 1) : null;
        }
        case 'holi': {
            const nm = monthNewMoon(year, SIGN.kumbha);
            const fm = nm ? fullMoonAfter(nm) : null;
            return fm ? span(fm, 1, 1) : null;
        }
        case 'rakhi': {
            const nm = monthNewMoon(year, SIGN.karka);
            const fm = nm ? fullMoonAfter(nm) : null;
            return fm ? span(fm, 1, 1) : null;
        }
        case 'ganesh': {
            // Chaturthi to Anant Chaturdashi.
            const nm = monthNewMoon(year, SIGN.simha);
            return nm ? { start: fromDayNumber(dayNumber(nm) + 3), end: fromDayNumber(dayNumber(nm) + 14) } : null;
        }
        case 'navratri': {
            // Pratipada is the new moon's day when the moon is new before sunrise.
            const nm = monthNewMoon(year, SIGN.kanya);
            return nm ? { start: nm, end: fromDayNumber(dayNumber(nm) + 10) } : null;
        }
        case 'dussehra': {
            // Dashami: NM + 10, or earlier when a lunar day is skipped (2020: NM + 8).
            const nm = monthNewMoon(year, SIGN.kanya);
            return nm ? { start: fromDayNumber(dayNumber(nm) + 8), end: fromDayNumber(dayNumber(nm) + 11) } : null;
        }
        case 'eid': {
            const [d] = islamicInYear(year, 10, 1);
            return d ? span(d, 1, 2) : null;
        }
        case 'bakrid': {
            const [d] = islamicInYear(year, 12, 10);
            return d ? span(d, 1, 2) : null;
        }
        case 'christmas':
            return { start: { y: year, m: 12, d: 24 }, end: { y: year, m: 12, d: 26 } };
        case 'newyear':
            return { start: { y: year - 1, m: 12, d: 31 }, end: { y: year, m: 1, d: 1 } };
        case 'sankranti':
            return { start: { y: year, m: 1, d: 13 }, end: { y: year, m: 1, d: 16 } };
        case 'republic':
            return { start: { y: year, m: 1, d: 26 }, end: { y: year, m: 1, d: 26 } };
        case 'independence':
            return { start: { y: year, m: 8, d: 15 }, end: { y: year, m: 8, d: 15 } };
    }
};

/** Words for each festival (English, Hinglish, Hindi), multi-word ones included. */
const FESTIVAL_WORDS: Record<FestivalId, string[]> = {
    diwali: ['diwali', 'deepavali', 'dipawali', 'deepawali', 'divali', 'दिवाली', 'दीवाली', 'दीपावली'],
    holi: ['holi', 'होली'],
    rakhi: ['rakhi', 'raksha bandhan', 'rakshabandhan', 'राखी', 'रक्षाबंधन', 'रक्षा बंधन'],
    navratri: ['navratri', 'navaratri', 'durga puja', 'नवरात्रि', 'नवरात्र', 'दुर्गा पूजा'],
    dussehra: ['dussehra', 'dasara', 'dashara', 'dussera', 'vijayadashami', 'दशहरा', 'विजयादशमी'],
    ganesh: ['ganesh chaturthi', 'ganpati', 'ganapati', 'ganeshotsav', 'गणेश चतुर्थी', 'गणपति'],
    karva: ['karva chauth', 'karwa chauth', 'करवा चौथ'],
    chhath: ['chhath', 'chhath puja', 'छठ', 'छठ पूजा'],
    eid: ['eid', 'eid ul fitr', 'eid al fitr', 'ईद'],
    bakrid: ['bakrid', 'bakra eid', 'eid al adha', 'eid ul adha', 'बकरीद'],
    christmas: ['christmas', 'xmas', 'क्रिसमस'],
    newyear: ['new year', 'naya saal', 'नया साल', 'नए साल'],
    sankranti: ['makar sankranti', 'sankranti', 'lohri', 'pongal', 'मकर संक्रांति', 'संक्रांति', 'लोहड़ी', 'पोंगल'],
    republic: ['republic day', '26 january', 'गणतंत्र दिवस'],
    independence: ['independence day', '15 august', 'स्वतंत्रता दिवस'],
};

type Relative = 'today' | 'yesterday' | 'dayBefore' | 'thisWeek' | 'lastWeek' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear';

const RELATIVE_WORDS: Record<Relative, string[]> = {
    today: ['today', 'aaj', 'आज'],
    // "kal" is also tomorrow, but nobody searches photos from tomorrow.
    yesterday: ['yesterday', 'kal', 'कल'],
    dayBefore: ['parso', 'parson', 'परसों'],
    thisWeek: ['this week', 'is hafte', 'is week', 'इस हफ्ते', 'इस हफ़्ते', 'इस सप्ताह'],
    lastWeek: ['last week', 'pichhle hafte', 'pichle hafte', 'पिछले हफ्ते', 'पिछले हफ़्ते', 'पिछले सप्ताह'],
    thisMonth: ['this month', 'is mahine', 'इस महीने'],
    lastMonth: ['last month', 'pichhle mahine', 'pichle mahine', 'पिछले महीने'],
    thisYear: ['this year', 'is saal', 'is sal', 'इस साल'],
    lastYear: ['last year', 'pichhle saal', 'pichle saal', 'pichhle sal', 'पिछले साल'],
};

/** "the last one": with a festival, only its most recent time. */
const LAST_WORDS = new Set(['last', 'pichhli', 'pichli', 'pichhle', 'pichle', 'पिछली', 'पिछले']);

/** Month names. "march" and "may" are words too: they count only next to a year. */
const MONTHS: Array<{ names: string[]; needsYear?: boolean }> = [
    { names: ['january', 'jan', 'जनवरी'] },
    { names: ['february', 'feb', 'फरवरी', 'फ़रवरी'] },
    { names: ['march', 'मार्च'], needsYear: true },
    { names: ['april', 'अप्रैल'] },
    { names: ['may', 'मई'], needsYear: true },
    { names: ['june', 'जून'] },
    { names: ['july', 'जुलाई'] },
    { names: ['august', 'aug', 'अगस्त'] },
    { names: ['september', 'sept', 'सितंबर', 'सितम्बर'] },
    { names: ['october', 'oct', 'अक्टूबर', 'अक्तूबर'] },
    { names: ['november', 'nov', 'नवंबर', 'नवम्बर'] },
    { names: ['december', 'dec', 'दिसंबर', 'दिसम्बर'] },
];

/** Earliest year festivals are looked for in when no year is given. */
const FIRST_YEAR = 2010;

/** A time window: from (inclusive) to (exclusive), in ms. */
export interface DateWindow {
    from: number;
    to: number;
}

/** What the date words meant, for the screen. */
export type DateMeaning =
    | { kind: 'festival'; festival: FestivalId; year?: number; latest?: boolean }
    | { kind: 'relative'; relative: Relative }
    | { kind: 'month'; month: number; year: number }
    | { kind: 'year'; year: number };

export interface DateQuery {
    /** The query without its date words: what to look for in the text ('' for none). */
    rest: string;
    /** When the photo or paper must be from (any of them), newest first. */
    windows: DateWindow[];
    meaning: DateMeaning;
}

const localDay = ({ y, m, d }: Ymd): number => new Date(y, m - 1, d).getTime();
const dayWindow = (days: FestivalDays): DateWindow => ({
    from: localDay(days.start),
    to: localDay(days.end) + DAY,
});

const startOfLocalDay = (ms: number): number => {
    const t = new Date(ms);
    return new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
};

const relativeWindow = (r: Relative, now: number): DateWindow => {
    const today = startOfLocalDay(now);
    const t = new Date(now);
    switch (r) {
        case 'today':
            return { from: today, to: today + DAY };
        case 'yesterday':
            return { from: today - DAY, to: today };
        case 'dayBefore':
            return { from: today - 2 * DAY, to: today - DAY };
        case 'thisWeek':
            return { from: today - 6 * DAY, to: today + DAY };
        case 'lastWeek':
            return { from: today - 13 * DAY, to: today - 6 * DAY };
        case 'thisMonth':
            return { from: new Date(t.getFullYear(), t.getMonth(), 1).getTime(), to: today + DAY };
        case 'lastMonth':
            return {
                from: new Date(t.getFullYear(), t.getMonth() - 1, 1).getTime(),
                to: new Date(t.getFullYear(), t.getMonth(), 1).getTime(),
            };
        case 'thisYear':
            return { from: new Date(t.getFullYear(), 0, 1).getTime(), to: today + DAY };
        case 'lastYear':
            return { from: new Date(t.getFullYear() - 1, 0, 1).getTime(), to: new Date(t.getFullYear(), 0, 1).getTime() };
    }
};

/** Every past time of a festival (all years, or one), newest first. */
const festivalWindows = (id: FestivalId, now: number, year?: number, latest?: boolean): DateWindow[] => {
    const thisYear = new Date(now).getFullYear();
    const years = year ? [year] : Array.from({ length: thisYear - FIRST_YEAR + 1 }, (_, i) => thisYear - i);
    const out: DateWindow[] = [];
    for (const y of years) {
        const days = festivalDays(id, y);
        if (!days) continue;
        const w = dayWindow(days);
        if (w.from > now) continue; // hasn't happened yet this year
        out.push(w);
        if (latest) break;
    }
    return out;
};

/** Find `phrase` (one or more words) in `words`; returns its start index or -1. */
const findPhrase = (words: string[], phrase: string, used: boolean[]): number => {
    const parts = phrase.split(' ');
    for (let i = 0; i + parts.length <= words.length; i++) {
        if (parts.every((p, j) => words[i + j] === p && !used[i + j])) return i;
    }
    return -1;
};

const YEAR_RE = /^(20\d\d)$/;

/**
 * The date words of a query, or null when it has none. "diwali photos" →
 * every Diwali so far; "diwali 2023" → that one; "pichhli diwali" → the most
 * recent one; "kal ki photo" → yesterday; "march 2024", "pichhle mahine".
 */
export const parseDateQuery = (query: string, now: number = Date.now()): DateQuery | null => {
    const words = normalizeIndic(query ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
    if (words.length === 0) return null;
    const used = words.map(() => false);
    const take = (i: number, n: number) => {
        for (let j = i; j < i + n; j++) used[j] = true;
    };
    const thisYear = new Date(now).getFullYear();
    const yearAt = words.findIndex(w => YEAR_RE.test(w) && Number(w) >= 2000 && Number(w) <= thisYear);
    const year = yearAt >= 0 ? Number(words[yearAt]) : undefined;
    const lastAt = words.findIndex(w => LAST_WORDS.has(w));

    let meaning: DateMeaning | null = null;
    let windows: DateWindow[] = [];

    // Festivals (longest phrases first, so "eid al adha" isn't read as "eid").
    const festivalPhrases = (Object.keys(FESTIVAL_WORDS) as FestivalId[])
        .flatMap(id => FESTIVAL_WORDS[id].map(p => ({ id, p })))
        .sort((a, b) => b.p.split(' ').length - a.p.split(' ').length);
    for (const { id, p } of festivalPhrases) {
        const at = findPhrase(words, p, used);
        if (at < 0) continue;
        take(at, p.split(' ').length);
        const latest = year === undefined && lastAt >= 0;
        if (year !== undefined) take(yearAt, 1);
        if (latest) take(lastAt, 1);
        meaning = { kind: 'festival', festival: id, year, latest: latest || undefined };
        windows = festivalWindows(id, now, year, latest);
        break;
    }

    // Relative days, weeks, months, years (multi-word first).
    if (!meaning) {
        const relPhrases = (Object.keys(RELATIVE_WORDS) as Relative[])
            .flatMap(r => RELATIVE_WORDS[r].map(p => ({ r, p })))
            .sort((a, b) => b.p.split(' ').length - a.p.split(' ').length);
        for (const { r, p } of relPhrases) {
            const at = findPhrase(words, p, used);
            if (at < 0) continue;
            take(at, p.split(' ').length);
            meaning = { kind: 'relative', relative: r };
            windows = [relativeWindow(r, now)];
            break;
        }
    }

    // A month, with or without a year.
    if (!meaning) {
        for (let mi = 0; mi < MONTHS.length && !meaning; mi++) {
            const { names, needsYear } = MONTHS[mi];
            for (const name of names) {
                const at = words.indexOf(name);
                if (at < 0 || used[at]) continue;
                if (needsYear && year === undefined) continue;
                const now0 = new Date(now);
                // Without a year: the most recent such month.
                const y = year ?? (mi <= now0.getMonth() ? now0.getFullYear() : now0.getFullYear() - 1);
                take(at, 1);
                if (year !== undefined) take(yearAt, 1);
                meaning = { kind: 'month', month: mi + 1, year: y };
                windows = [{ from: new Date(y, mi, 1).getTime(), to: new Date(y, mi + 1, 1).getTime() }];
                break;
            }
        }
    }

    // A year on its own counts only when nothing else is asked ("2023", "2023 photos"):
    // "bill 2023" may mean the words "bill" and "2023".
    if (!meaning && year !== undefined) {
        const others = words.filter((w, i) => i !== yearAt && !PICTURE_WORDS.has(w));
        if (others.length === 0) {
            take(yearAt, 1);
            meaning = { kind: 'year', year };
            windows = [{ from: new Date(year, 0, 1).getTime(), to: new Date(year + 1, 0, 1).getTime() }];
        }
    }

    if (!meaning) return null;
    const rest = words.filter((w, i) => !used[i] && !LINK_WORDS.has(w)).join(' ');
    return { rest: onlyPictureWords(rest) ? '' : rest, windows, meaning };
};

/** Words that only ask for a picture ("photo", "फोटो"): no text to look for. */
const PICTURE_WORDS = new Set([
    'photo', 'photos', 'picture', 'pictures', 'pic', 'pics', 'image', 'images', 'foto', 'tasveer', 'tasveeren',
    'फोटो', 'फ़ोटो', 'तस्वीर', 'तस्वीरें',
]);

/** Little words around a date ("ki", "ka", "from", "of", "wali"). */
const LINK_WORDS = new Set([
    'ki', 'ka', 'ke', 'ko', 'se', 'wali', 'wala', 'wale', 'mein', 'me', 'from', 'of', 'in', 'on', 'the', 'during', 'at',
    'की', 'का', 'के', 'को', 'से', 'वाली', 'वाला', 'वाले', 'में',
]);

const onlyPictureWords = (rest: string): boolean => rest.split(' ').filter(Boolean).every(w => PICTURE_WORDS.has(w));

/** What a festival looks like, in English, for the photo look-alike search (CLIP). */
const FESTIVAL_PICTURES: Record<FestivalId, string> = {
    diwali: 'diwali lamps and lights',
    holi: 'holi festival colours',
    rakhi: 'rakhi on a wrist',
    navratri: 'garba dance',
    dussehra: 'dussehra ravan effigy',
    ganesh: 'ganesh idol',
    karva: 'karva chauth moon sieve',
    chhath: 'chhath puja by the river',
    eid: 'eid celebration',
    bakrid: 'eid celebration',
    christmas: 'christmas tree',
    newyear: 'new year party',
    sankranti: 'kites in the sky',
    republic: 'republic day parade',
    independence: 'indian flag',
};

/** What to show CLIP for a date query: the other words, or what a festival looks like. */
export const pictureTextFor = (dq: DateQuery): string | null =>
    dq.rest.trim() || (dq.meaning.kind === 'festival' ? FESTIVAL_PICTURES[dq.meaning.festival] : null);
