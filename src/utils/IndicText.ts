/**
 * IndicText.ts — one text pipeline for every major Indian script.
 *
 * The SAME functions run on the index side (OCR text from photos and PDFs)
 * and on the query side (typed or spoken searches). That symmetry is what
 * makes "dawai", "davaai" and "दवाई" find each other.
 *
 *   normalizeIndic()  NFC, invisible joiners removed, Indian digits → 0-9
 *   romanize()        any Indian script → plain Roman letters (Hinglish style)
 *   bhashaKey()       spelling-insensitive sound key for one word
 *
 * Scripts: Devanagari (Hindi, Marathi, Nepali), Bengali/Assamese, Gurmukhi,
 * Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam. These Unicode blocks
 * share the ISCII layout, so one offset table covers all of them, with a few
 * per-script overrides.
 *
 * Pure TypeScript, no model, no allocation beyond the output strings.
 */

// ─── Script detection ────────────────────────────────────────────────────────

/** Indian scripts handled here, named by their ISO 15924 codes. */
export type IndicScript =
    | 'deva' | 'beng' | 'guru' | 'gujr' | 'orya'
    | 'taml' | 'telu' | 'knda' | 'mlym';

const BLOCK_START = 0x0900;
const BLOCK_END = 0x0d80; // exclusive
const BLOCK_SIZE = 0x80;
const SCRIPTS: IndicScript[] = ['deva', 'beng', 'guru', 'gujr', 'orya', 'taml', 'telu', 'knda', 'mlym'];

/** The Indian script a code point belongs to, or null. */
export const scriptOf = (cp: number): IndicScript | null =>
    cp >= BLOCK_START && cp < BLOCK_END ? SCRIPTS[Math.floor((cp - BLOCK_START) / BLOCK_SIZE)] : null;

const INDIC_RE = /[ऀ-ൿ]/;

/** True when the text contains any Indian-script letter. */
export const containsIndic = (text: string): boolean => INDIC_RE.test(text);

/**
 * Scripts whose word-final consonant is silent in speech (schwa deletion):
 * कमल is "kamal", not "kamala". Odia and the Dravidian scripts keep the vowel.
 */
const FINAL_SCHWA_DROPPED = new Set<IndicScript>(['deva', 'beng', 'guru', 'gujr']);

// ─── Normalization ───────────────────────────────────────────────────────────

const INDIC_DIGIT_RE = /[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g;
const INVISIBLE_RE = /[​-‍­﻿]/g;
const DANDA_RE = /[।॥]/g;

/** Converts every Indian-script digit (०-९, ০-৯, ௦-௯, …) to ASCII 0-9. */
export const asciiDigits = (text: string): string =>
    text.replace(INDIC_DIGIT_RE, ch => String((ch.charCodeAt(0) - BLOCK_START) % BLOCK_SIZE - 0x66));

/**
 * Canonical form for storage and matching:
 *  - Unicode NFC (nukta letters such as क़ become क + ़ consistently)
 *  - zero-width joiners, soft hyphens and BOMs removed
 *  - Indian digits → 0-9, so PII masking and number search see them
 *  - danda (। ॥) → space
 */
export const normalizeIndic = (text: string): string => {
    if (!text) return '';
    return asciiDigits(text.normalize('NFC').replace(INVISIBLE_RE, '').replace(DANDA_RE, ' '));
};

// ─── Romanization tables (by offset inside a 128-code-point block) ──────────

/** Independent vowels. */
const VOWELS: Record<number, string> = {
    0x05: 'a', 0x06: 'aa', 0x07: 'i', 0x08: 'ee', 0x09: 'u', 0x0a: 'oo',
    0x0b: 'ri', 0x0c: 'li', 0x0d: 'e', 0x0e: 'e', 0x0f: 'e', 0x10: 'ai',
    0x11: 'o', 0x12: 'o', 0x13: 'o', 0x14: 'au', 0x60: 'ri', 0x61: 'li',
};

/** Dependent vowel signs (matras). */
const MATRAS: Record<number, string> = {
    0x3e: 'aa', 0x3f: 'i', 0x40: 'ee', 0x41: 'u', 0x42: 'oo', 0x43: 'ri', 0x44: 'ri',
    0x45: 'e', 0x46: 'e', 0x47: 'e', 0x48: 'ai', 0x49: 'o', 0x4a: 'o', 0x4b: 'o',
    0x4c: 'au', 0x62: 'li', 0x63: 'li',
};

/** Consonants (each carries an inherent "a" unless a matra or virama follows). */
const CONSONANTS: Record<number, string> = {
    0x15: 'k', 0x16: 'kh', 0x17: 'g', 0x18: 'gh', 0x19: 'ng',
    0x1a: 'ch', 0x1b: 'chh', 0x1c: 'j', 0x1d: 'jh', 0x1e: 'n',
    0x1f: 't', 0x20: 'th', 0x21: 'd', 0x22: 'dh', 0x23: 'n',
    0x24: 't', 0x25: 'th', 0x26: 'd', 0x27: 'dh', 0x28: 'n', 0x29: 'n',
    0x2a: 'p', 0x2b: 'ph', 0x2c: 'b', 0x2d: 'bh', 0x2e: 'm',
    0x2f: 'y', 0x30: 'r', 0x31: 'r', 0x32: 'l', 0x33: 'l', 0x34: 'l',
    0x35: 'v', 0x36: 'sh', 0x37: 'sh', 0x38: 's', 0x39: 'h',
    // Precomposed nukta letters (NFC decomposes most, but OCR may emit them)
    0x58: 'q', 0x59: 'kh', 0x5a: 'g', 0x5b: 'z', 0x5c: 'r', 0x5d: 'rh', 0x5e: 'f', 0x5f: 'y',
};

/** What a consonant becomes when a nukta (़) follows it. */
const NUKTA_FORMS: Record<number, string> = {
    0x15: 'q', 0x16: 'kh', 0x17: 'gh', 0x1c: 'z', 0x21: 'r', 0x22: 'rh', 0x2b: 'f', 0x2f: 'y',
};

const ANUSVARA = 0x02;
const CHANDRABINDU = 0x01;
const VISARGA = 0x03;
const NUKTA = 0x3c;
const VIRAMA = 0x4d;

/** Per-script exceptions to the shared layout. */
const SCRIPT_CONSONANTS: Partial<Record<IndicScript, Record<number, string>>> = {
    beng: { 0x70: 'r', 0x71: 'v' },                  // Assamese ৰ ৱ
    mlym: { 0x34: 'l' },                             // ഴ (zha)
    taml: { 0x34: 'l' },                             // ழ (zha), "Tamil"
};

/** Consonants that never take an inherent vowel (Bengali khanda ta, Malayalam chillus). */
const SCRIPT_DEAD_CONSONANTS: Partial<Record<IndicScript, Record<number, string>>> = {
    beng: { 0x4e: 't' },
    mlym: { 0x7a: 'n', 0x7b: 'n', 0x7c: 'r', 0x7d: 'l', 0x7e: 'l', 0x7f: 'k', 0x4e: 'r' },
};

/** Signs that add a nasal (Gurmukhi tippi works like anusvara). */
const isNasalSign = (script: IndicScript, off: number): boolean =>
    off === ANUSVARA || off === CHANDRABINDU || (script === 'guru' && off === 0x70);

// ─── Romanization ────────────────────────────────────────────────────────────

/** Romanizes ONE run of Indian-script characters (a single word). */
const romanizeWord = (word: string): string => {
    let out = '';
    let pending = false;               // inherent "a" owed by the last consonant
    let lastConsonantStart = -1;       // index in `out` where it started
    let lastConsonantOff = -1;
    let script: IndicScript = 'deva';

    const flushInherent = () => {
        if (pending) out += 'a';
        pending = false;
    };

    for (const ch of word) {
        const cp = ch.codePointAt(0) ?? 0;
        const s = scriptOf(cp);
        if (!s) {
            flushInherent();
            out += ch;
            continue;
        }
        script = s;
        const off = (cp - BLOCK_START) % BLOCK_SIZE;

        const dead = SCRIPT_DEAD_CONSONANTS[s]?.[off];
        if (dead !== undefined) {
            flushInherent();
            out += dead;
            continue;
        }

        const consonant = SCRIPT_CONSONANTS[s]?.[off] ?? CONSONANTS[off];
        if (consonant !== undefined && !(s === 'guru' && off === 0x70)) {
            flushInherent();
            lastConsonantStart = out.length;
            lastConsonantOff = off;
            out += consonant;
            pending = true;
            continue;
        }

        if (off === NUKTA) {
            const form = NUKTA_FORMS[lastConsonantOff];
            if (pending && form !== undefined && lastConsonantStart >= 0) {
                out = out.slice(0, lastConsonantStart) + form;
            }
            continue;
        }
        if (off === VIRAMA) {
            pending = false;
            continue;
        }
        const matra = MATRAS[off];
        if (matra !== undefined) {
            pending = false;
            out += matra;
            continue;
        }
        if (isNasalSign(s, off)) {
            flushInherent();
            out += 'n';
            continue;
        }
        if (off === VISARGA) {
            flushInherent();
            out += 'h';
            continue;
        }
        const vowel = VOWELS[off];
        if (vowel !== undefined) {
            flushInherent();
            out += vowel;
            continue;
        }
        if (off >= 0x66 && off <= 0x6f) {
            flushInherent();
            out += String(off - 0x66);
            continue;
        }
        // Avagraha, length marks, Gurmukhi addak and vowel bearers, om, etc.
        // carry no sound of their own here.
    }

    // Word-final consonant: silent in Hindi-belt scripts, spoken elsewhere.
    if (pending && !FINAL_SCHWA_DROPPED.has(script)) out += 'a';
    return out;
};

/** Devanagari ज्ञ is said "gy" (ज्ञान = gyaan), not "jn". */
const DEVA_GYA_RE = /ज्ञ/g;

/**
 * Romanizes text in any supported Indian script to plain Roman letters in
 * Hinglish style (aa, ee, oo). Latin text, digits and punctuation pass
 * through; whitespace is collapsed.
 *
 *   कमल → kamal · आधार → aadhaar · क्षमा → kshamaa · ज्ञान → gyaan
 *   বিল → bil · మందు → mandu
 */
export const romanize = (text: string): string => {
    if (!text) return '';
    const normalized = normalizeIndic(text).replace(DEVA_GYA_RE, 'ग्य');
    // Split into runs of Indic letters vs everything else, romanize the runs.
    return normalized
        .replace(/[ऀ-ൿ]+/g, run => romanizeWord(run))
        .replace(/\s+/g, ' ')
        .trim();
};

// ─── Bhasha key ──────────────────────────────────────────────────────────────

/**
 * Spelling-insensitive sound key for ONE word, in any script.
 *
 * Folds the ways Indians spell the same sound in Roman letters:
 * vowel length (a/aa, i/ee, u/oo), w/v, ph/f, z/j, q/k, sh/s, aspiration
 * (kh/k, bh/b, dh/d …), c/k/s, doubled letters, English silent e, and short
 * a/e inside the word. Applied to OCR words and query words alike, so
 *
 *   dawai · davaai · दवाई  → "dv"
 *   aadhaar · adhar · आधार → "adr"
 *   bill · बिल             → "bil"
 *   bank · बैंक             → "bnk"
 *
 * Returns '' for words that are too short or contain digits (numbers are
 * matched as numbers, and digit-bearing tokens may be masked PII).
 */
export const bhashaKey = (word: string): string => {
    if (!word || /\d/.test(word)) return '';
    let s = containsIndic(word) ? romanize(word) : word;
    s = s.toLowerCase().replace(/[^a-z]/g, '');
    if (s.length < 2) return '';

    // English silent final e: name → nam, phone → phon
    if (s.length > 3 && /[^aeiou]e$/.test(s)) s = s.slice(0, -1);

    // c: ch/chh is its own sound; otherwise soft before e/i/y, hard elsewhere
    s = s.replace(/chh?/g, 'C').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/C/g, 'c');

    // Aspiration and fricatives
    s = s.replace(/ph/g, 'f').replace(/sh/g, 's').replace(/([kgcjtdpbr])h/g, '$1');

    // Letters Indians use interchangeably
    s = s.replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 'j').replace(/w/g, 'v');

    // Vowel length and diphthongs
    s = s.replace(/ee|ii/g, 'i').replace(/oo|uu/g, 'u').replace(/aa/g, 'a')
        .replace(/ai|ae/g, 'e').replace(/au|ou/g, 'o').replace(/y$/, 'i');

    // m before p/b is the same nasal as n (sambandh = sanbandh)
    s = s.replace(/m(?=[bp])/g, 'n');

    // Doubled letters, then short a/e inside the word, then doubles again
    s = s.replace(/(.)\1+/g, '$1');
    s = s[0] + s.slice(1).replace(/[ae]/g, '');
    s = s.replace(/(.)\1+/g, '$1');

    return s.length >= 2 ? s : '';
};

/** Splits text into word tokens across scripts (letters, marks, digits). */
export const tokenizeWords = (text: string): string[] =>
    normalizeIndic(text)
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        .filter(Boolean);

/** Unique Bhasha keys for every word in the text, in first-seen order. */
export const bhashaKeysFor = (text: string): string[] => {
    const seen = new Set<string>();
    for (const w of tokenizeWords(text)) {
        const k = bhashaKey(w);
        if (k) seen.add(k);
    }
    return [...seen];
};
