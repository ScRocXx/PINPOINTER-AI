/**
 * Collections.ts — the "Find quickly" groups on Home (ID cards, Bills...).
 *
 * A collection is a set of concept ids from `ConceptTable`, so it finds a
 * thing in any language and spelling: "ID cards" finds Aadhaar, PAN and
 * voter cards, because indexing already tagged them `qcaadhaar`, `qcpancard`
 * and so on. Searching for a collection's name (the Home tile's label, in
 * English or Hindi) searches the whole collection; see `search.ts`.
 *
 * Screenshots have no words in common, so that collection has no concepts:
 * Home fills its tile from the phone's Screenshots album, and search finds
 * screenshots by how they look (CLIP).
 */
import { en, hi, StringKey } from '../i18n/strings';
import { normalizeIndic } from './IndicText';

export type CollectionId = 'id' | 'bill' | 'medicine' | 'bank' | 'screenshot' | 'family';

export interface Collection {
  id: CollectionId;
  /** The tile's name, also a search phrase for the collection. */
  labelKey: StringKey;
  /** Concept ids (ConceptTable) that put a file in this collection. */
  concepts: string[];
  /**
   * Exact phrases in a file's text that also put it here, for things no
   * single concept word catches ("Permanent Account Number" is a PAN card).
   */
  textPhrases: string[];
  /** English text for the CLIP text encoder. */
  clip: string;
  /** More whole queries that mean this collection, besides the labels. */
  extraPhrases: string[];
}

export const COLLECTIONS: readonly Collection[] = [
  {
    id: 'id',
    labelKey: 'collection.id',
    concepts: ['aadhaar', 'pancard', 'voterid', 'licence', 'passport', 'ration', 'idcard'],
    textPhrases: ['permanent account number'],
    clip: 'identity card',
    extraPhrases: ['id card', 'ids', 'identity cards', 'identity card', 'पहचान-पत्र'],
  },
  {
    id: 'bill',
    labelKey: 'collection.bills',
    concepts: ['bill', 'receipt', 'electricity'],
    textPhrases: [],
    clip: 'a bill or receipt',
    extraPhrases: ['बिलें', 'bills and receipts'],
  },
  {
    id: 'medicine',
    labelKey: 'collection.medicine',
    concepts: ['medicine', 'prescription', 'doctor', 'hospital'],
    textPhrases: [],
    clip: 'medicine and prescriptions',
    extraPhrases: ['medicines', 'दवाइयाँ', 'दवा'],
  },
  {
    id: 'bank',
    labelKey: 'collection.bank',
    concepts: ['bank'],
    textPhrases: ['ifsc'],
    clip: 'bank passbook',
    extraPhrases: ['banking'],
  },
  {
    id: 'screenshot',
    labelKey: 'collection.screenshots',
    concepts: [],
    textPhrases: [],
    clip: 'a screenshot of a phone screen',
    extraPhrases: ['screenshot', 'स्क्रीन शॉट'],
  },
  {
    id: 'family',
    labelKey: 'collection.family',
    concepts: ['family', 'mother', 'father', 'grandmother', 'grandfather', 'child', 'wedding'],
    textPhrases: [],
    clip: 'family photo',
    extraPhrases: ['family photos', 'परिवार की फ़ोटो'],
  },
];

/** Lower case, Indic-normalized, single-spaced, without punctuation. */
const normalizePhrase = (text: string): string =>
  normalizeIndic(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const byPhrase = new Map<string, Collection>();
for (const c of COLLECTIONS) {
  for (const phrase of [en[c.labelKey], hi[c.labelKey], ...c.extraPhrases]) {
    const key = normalizePhrase(phrase);
    if (key && !byPhrase.has(key)) byPhrase.set(key, c);
  }
}

/**
 * The collection a whole query names ("ID cards", "पहचान पत्र", "Bills"),
 * or null. Only the entire query counts: "bills march" is a normal search.
 */
export const collectionForQuery = (query: string | null | undefined): Collection | null =>
  query ? byPhrase.get(normalizePhrase(query)) ?? null : null;

export const getCollection = (id: CollectionId): Collection => {
  const found = COLLECTIONS.find(c => c.id === id);
  if (!found) throw new Error(`Unknown collection: ${id}`);
  return found;
};
