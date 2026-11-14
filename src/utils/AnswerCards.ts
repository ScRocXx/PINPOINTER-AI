/**
 * AnswerCards.ts — the answer, not just the file: "₹1,240 · Due 5 April",
 * "Valid till March 2025", "Morning and night, after food".
 *
 * Older people search for a bill to know how much and by when, for a policy to
 * know whether it is still valid, for a prescription to know when to take the
 * medicine. These rules read those facts from a paper's stored text (already
 * masked, so no personal number is ever read here), in English and Hindi. No
 * model: a few patterns that Indian bills, policies and prescriptions share.
 * Every fact is optional; nothing is shown when a rule isn't sure.
 */

/** A calendar day (month 1–12). */
export interface FactDate {
    y: number;
    m: number;
    d: number;
}

export interface MedicineTimes {
    morning: boolean;
    afternoon: boolean;
    night: boolean;
    /** Only when needed (SOS). */
    asNeeded?: boolean;
    food?: 'after' | 'before';
}

export interface AnswerFacts {
    /** The amount to pay, in rupees. */
    amount?: number;
    due?: FactDate;
    /** Valid till (end of that day, or of that month when only month/year is given). */
    validTill?: FactDate;
    medicine?: MedicineTimes;
}

const MONTHS: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    'जनवरी': 1, 'फरवरी': 2, 'फ़रवरी': 2, 'मार्च': 3, 'अप्रैल': 4, 'मई': 5, 'जून': 6, 'जुलाई': 7, 'अगस्त': 8,
    'सितंबर': 9, 'सितम्बर': 9, 'अक्टूबर': 10, 'अक्तूबर': 10, 'नवंबर': 11, 'नवम्बर': 11, 'दिसंबर': 12, 'दिसम्बर': 12,
};
const MONTH_WORD = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?|जनवरी|फ़?फरवरी|फ़रवरी|मार्च|अप्रैल|मई|जून|जुलाई|अगस्त|सितम्बर|सितंबर|अक्टूबर|अक्तूबर|नवम्बर|नवंबर|दिसम्बर|दिसंबर';

const fullYear = (y: number): number => (y < 100 ? 2000 + y : y);

const validDate = (y: number, m: number, d: number): FactDate | null => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2099) return null;
    const t = new Date(y, m - 1, d);
    return t.getMonth() === m - 1 ? { y, m, d } : null;
};

const monthOf = (word: string): number | undefined => {
    const w = word.toLowerCase().replace(/\.$/, '');
    return MONTHS[w] ?? MONTHS[w.slice(0, 3)];
};

/** The first date in `text` (Indian order for numbers: day/month/year). */
export const firstDate = (text: string): FactDate | null => {
    const candidates: Array<{ at: number; date: FactDate }> = [];
    const numeric = /(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})(?!\d)/g;
    for (const m of text.matchAll(numeric)) {
        const date = validDate(fullYear(Number(m[3])), Number(m[2]), Number(m[1]));
        if (date) candidates.push({ at: m.index ?? 0, date });
    }
    const dayMonth = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-,]*(${MONTH_WORD})[\\s\\-,]*(\\d{2,4})?`, 'giu');
    for (const m of text.matchAll(dayMonth)) {
        const month = monthOf(m[2]);
        const year = m[4] ? fullYear(Number(m[4])) : new Date().getFullYear();
        const date = month ? validDate(year, month, Number(m[1])) : null;
        if (date) candidates.push({ at: m.index ?? 0, date });
    }
    const monthDay = new RegExp(`(${MONTH_WORD})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'giu');
    for (const m of text.matchAll(monthDay)) {
        const month = monthOf(m[1]);
        const date = month ? validDate(Number(m[4]), month, Number(m[3])) : null;
        if (date) candidates.push({ at: m.index ?? 0, date });
    }
    candidates.sort((a, b) => a.at - b.at);
    return candidates[0]?.date ?? null;
};

/** The date that follows one of `labels` closely (within a short stretch of text). */
const dateAfter = (text: string, labels: RegExp, reach = 40): FactDate | null => {
    for (const m of text.matchAll(labels)) {
        const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + reach);
        const date = firstDate(after);
        if (date) return date;
    }
    return null;
};

const DUE_LABELS = /(due\s*date|due\s*on|due\s*by|pay\s*by|payment\s*due|last\s*date(\s*of\s*payment)?|अंतिम\s*तिथि|अन्तिम\s*तिथि|देय\s*तिथि|अंतिम\s*दिनांक|भुगतान\s*की\s*अंतिम\s*तिथि)/giu;
const VALID_LABELS = /(valid\s*(till|upto|up\s*to|until|thru|through)|expiry(\s*date)?|expires(\s*on)?|date\s*of\s*expiry|exp\.?\s*date|वैधता|समाप्ति(\s*तिथि)?|मान्य)/giu;

/** "Valid till 12/2025": the end of that month. */
const monthYearAfter = (text: string, labels: RegExp): FactDate | null => {
    for (const m of text.matchAll(labels)) {
        const after = text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 25);
        const my = after.match(/(?<![\d/.-])(\d{1,2})\s*[/-]\s*(\d{2,4})(?![\d/.-])/);
        if (my) {
            const month = Number(my[1]);
            const year = fullYear(Number(my[2]));
            if (month >= 1 && month <= 12 && year >= 2000 && year <= 2099) {
                return { y: year, m: month, d: new Date(year, month, 0).getDate() };
            }
        }
    }
    return null;
};

const AMOUNT_NUMBER = '(\\d{1,3}(?:,\\d{2,3})+(?:\\.\\d{1,2})?|\\d+(?:\\.\\d{1,2})?)';
const CURRENCY = '(?:₹|rs\\.?|inr|रु\\.?|रुपये|रुपए)';
/** Labels for the amount to pay, most telling first. */
const AMOUNT_LABELS = [
    'amount\\s*payable', 'net\\s*payable', 'total\\s*payable', 'payable\\s*amount', 'amount\\s*due', 'due\\s*amount',
    'bill\\s*amount', 'grand\\s*total', 'net\\s*amount', 'total\\s*amount', 'total',
    'देय\\s*राशि', 'कुल\\s*देय', 'कुल\\s*राशि', 'भुगतान\\s*राशि', 'कुल', 'राशि',
];

const toAmount = (raw: string): number | null => {
    const n = Number(raw.replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 && n < 10_000_000 ? n : null;
};

/** The amount to pay: after the most telling label, else the largest amount written with ₹ / Rs. */
export const amountToPay = (text: string): number | null => {
    for (const label of AMOUNT_LABELS) {
        const re = new RegExp(`${label}[^\\d₹\\n]{0,12}?(?:${CURRENCY}\\s*)?${AMOUNT_NUMBER}`, 'iu');
        const m = text.match(re);
        const amount = m ? toAmount(m[1]) : null;
        if (amount) return amount;
    }
    let best: number | null = null;
    for (const m of text.matchAll(new RegExp(`${CURRENCY}\\s*${AMOUNT_NUMBER}`, 'giu'))) {
        const amount = toAmount(m[1]);
        if (amount && (best === null || amount > best)) best = amount;
    }
    return best;
};

const PRESCRIPTION = /\b(tab|tabs|tablet|cap|caps|capsule|syrup|syp|inj|mg|ml|rx|dose)\b|दवा|दवाई|गोली|खुराक/iu;

/** When to take the medicine, from a prescription's own shorthand. */
export const medicineTimes = (text: string): MedicineTimes | null => {
    if (!PRESCRIPTION.test(text)) return null;
    const times: MedicineTimes = { morning: false, afternoon: false, night: false };
    let found = false;
    const pattern = text.match(/(?<![\d.])([01½])\s*[-–]\s*([01½])\s*[-–]\s*([01½])(?![\d.])/);
    if (pattern) {
        times.morning = pattern[1] !== '0';
        times.afternoon = pattern[2] !== '0';
        times.night = pattern[3] !== '0';
        found = times.morning || times.afternoon || times.night;
    } else if (/\b(tds|tid|thrice)\b|तीन\s*बार/iu.test(text)) {
        times.morning = times.afternoon = times.night = found = true;
    } else if (/\b(bd|bid|twice)\b|दो\s*बार|सुबह\s*[-,और]*\s*शाम|सुबह\s*[-,और]*\s*रात/iu.test(text)) {
        times.morning = times.night = found = true;
    } else if (/\b(hs|bedtime|at\s*night)\b|सोते\s*समय|रात\s*को/iu.test(text)) {
        times.night = found = true;
    } else if (/\b(od|once\s*(a\s*)?daily)\b|एक\s*बार|दिन\s*में\s*एक/iu.test(text)) {
        times.morning = found = true;
    }
    if (/\b(sos|when\s*needed|if\s*needed)\b|जरूरत\s*होने\s*पर|ज़रूरत\s*होने\s*पर/iu.test(text)) {
        times.asNeeded = true;
        found = true;
    }
    if (/after\s*(food|meals?|breakfast|lunch|dinner)|\ba\/f\b|खाने\s*के\s*बाद|भोजन\s*के\s*बाद/iu.test(text)) times.food = 'after';
    else if (/before\s*(food|meals?|breakfast)|empty\s*stomach|\bb\/f\b|खाने\s*से\s*पहले|भोजन\s*से\s*पहले|खाली\s*पेट/iu.test(text)) {
        times.food = 'before';
    }
    return found ? times : null;
};

/** Everything a result row can answer at a glance; {} when nothing is sure. */
export const answerFacts = (text: string | null | undefined): AnswerFacts => {
    const t = (text ?? '').replace(/\s+/g, ' ');
    if (!t.trim()) return {};
    const facts: AnswerFacts = {};
    const amount = amountToPay(t);
    if (amount) facts.amount = amount;
    const due = dateAfter(t, DUE_LABELS);
    if (due) facts.due = due;
    const validTill = dateAfter(t, VALID_LABELS) ?? monthYearAfter(t, VALID_LABELS);
    if (validTill) facts.validTill = validTill;
    const medicine = medicineTimes(t);
    if (medicine) facts.medicine = medicine;
    return facts;
};

/** True when there is anything to show. */
export const hasFacts = (facts: AnswerFacts): boolean =>
    facts.amount !== undefined || !!facts.due || !!facts.validTill || !!facts.medicine;
