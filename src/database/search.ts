/**
 * Search: FTS5 full-text search with LIKE fallback (synonyms, phonetic
 * matching, relevance ranking), photos that look like the query (CLIP), the
 * merge of the two, and snippet extraction.
 */
import { soundex } from '../utils/Soundex';
import { searchWords, termsForQueryWord } from '../utils/SearchKeys';
import { collectionForQuery } from '../utils/Collections';
import { AppLogger } from '../utils/AppLogger';
import { getDb, getReadDb, isFtsAvailable } from './connection';
import { processResults } from './documents';
import { collectionTerms } from './collectionTerms';
import { findLookAlikes, findLookAlikesAsync } from './vectors';
import type { DocumentRecord } from './types';

// ─── Synonym Map for Indian Documents ───────────────────────────────────────
// Expands common search terms to catch spelling variations and aliases
const SYNONYM_GROUPS: string[][] = [
  ['aadhaar', 'aadhar', 'aadharcard', 'aadhaarcard', 'uidai'],
  ['pancard', 'pan card', 'pan', 'permanent account number'],
  ['licence', 'license', 'driving licence', 'driving license', 'dl'],
  ['voter', 'voter id', 'voterid', 'epic', 'election'],
  ['passport', 'pasprt'],
  ['invoice', 'bill', 'tax invoice'],
  ['receipt', 'payment receipt'],
  ['salary', 'salary slip', 'payslip', 'pay slip'],
  ['marksheet', 'mark sheet', 'result', 'grade card'],
  ['certificate', 'certify', 'certification'],
  ['insurance', 'policy', 'lic'],
  ['electricity', 'electric bill', 'power bill', 'bijli'],
  ['medical', 'doctor', 'prescription', 'lab report'],
  ['property', 'deed', 'rent agreement', 'lease'],
];

// The rule for which photos count as look-alikes lives in vectors.ts.
export { MAX_VECTOR_DISTANCE } from './vectors';

// ─── Merging word matches with look-alikes ──────────────────────────────────
// Reciprocal rank fusion: a result scores weight / (RANK_K + its rank) in each
// list it is in, and the sums are sorted. Words count double, so the first
// eleven word matches come before the best look-alike; after that one
// look-alike follows every two word matches. A photo in both lists rises to
// the top. (With the usual RANK_K of 60 every one of 50 word matches outranked
// the best look-alike, so look-alikes never made the list.)
export const RANK_K = 10;
export const TEXT_WEIGHT = 2;

/** Word matches and look-alikes as one list, best first, each file once. */
export const mergeByRank = (textHits: DocumentRecord[], lookAlikes: DocumentRecord[]): DocumentRecord[] => {
  const scores = new Map<string, { doc: DocumentRecord; score: number }>();
  const add = (docs: DocumentRecord[], weight: number) => {
    const ranked = new Set<string>();
    for (const doc of docs) {
      if (ranked.has(doc.filePath)) continue;
      ranked.add(doc.filePath);
      const points = weight / (RANK_K + ranked.size);
      const entry = scores.get(doc.filePath);
      if (entry) entry.score += points;
      else scores.set(doc.filePath, { doc, score: points });
    }
  };
  add(textHits, TEXT_WEIGHT);
  add(lookAlikes, 1);
  // Array.sort is stable: equal scores keep word matches ahead of look-alikes.
  return [...scores.values()].sort((x, y) => y.score - x.score).map(e => e.doc);
};

const BY_IDS_SQL = (count: number) =>
  `SELECT id, title, content, filePath, type, detection_type, timestamp
     FROM document_index WHERE id IN (${Array.from({ length: count }, () => '?').join(', ')})`;

/** The rows for `ids`, in the order of `ids`. */
const inIdOrder = (ids: number[], result: Parameters<typeof processResults>[0]): DocumentRecord[] => {
  const byId = new Map(processResults(result).map(doc => [doc.id, doc]));
  return ids.map(id => byId.get(id)).filter((doc): doc is DocumentRecord => !!doc);
};

/** The photos that look like the query vector, closest first. */
const searchByLook = (queryVector: Float32Array): DocumentRecord[] => {
  const ids = findLookAlikes(queryVector).map(l => l.documentId);
  if (ids.length === 0) return [];
  return inIdOrder(ids, getDb().executeSync(BY_IDS_SQL(ids.length), ids));
};

/** searchByLook on the read connection, off the JS thread. */
const searchByLookAsync = async (queryVector: Float32Array): Promise<DocumentRecord[]> => {
  const ids = (await findLookAlikesAsync(queryVector)).map(l => l.documentId);
  if (ids.length === 0) return [];
  return inIdOrder(ids, await getReadDb().execute(BY_IDS_SQL(ids.length), ids));
};

/**
 * Expand a search word with synonyms if it matches any group.
 * Returns the original word + any synonyms from the same group.
 */
const expandWithSynonyms = (word: string): string[] => {
  const lw = word.toLowerCase();
  for (const group of SYNONYM_GROUPS) {
    if (group.some(syn => syn === lw || lw.includes(syn) || syn.includes(lw))) {
      return [...new Set([lw, ...group])];
    }
  }
  return [lw];
};

/**
 * One FTS5 group per query word: the word itself (prefix), its romanized
 * form, its Bhasha sound key and its concept ids. e.g. दवाई →
 *   ("दवाई"* OR "davaaee"* OR "qkdv" OR "qcmedicine")
 */
const ftsGroup = (word: string): string => {
  const t = termsForQueryWord(word);
  const parts = [`"${word}"*`];
  if (t.roman) parts.push(`"${t.roman}"*`);
  if (t.key) parts.push(`"${t.key}"`);
  for (const c of t.concepts) parts.push(`"${c}"`);
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`;
};

/**
 * Search documents by their words and, when `queryVector` is given, by what
 * the photos look like.
 *
 *  1. Words: FTS5 if available, else LIKE. Title and content, every word of
 *     the query must match (filler words like "of" are left out), synonym
 *     expansion for common Indian document terms. A query that names a Home
 *     collection ("ID cards", "पहचान पत्र") finds every concept in it
 *     (Aadhaar, PAN, voter ID...) instead of the words.
 *  2. Look: photos that stand out as close to the query vector.
 *  3. The two lists merged by rank (see mergeByRank).
 */
export const searchDocuments = (query: string, queryVector?: Float32Array): DocumentRecord[] => {
  const textHits = searchByWords(query);
  if (!queryVector || !query.trim()) return textHits;
  const t0 = Date.now();
  try {
    const lookAlikes = searchByLook(queryVector);
    AppLogger.info('DB', `Look-alike search took ${Date.now() - t0}ms. Found ${lookAlikes.length} photos.`);
    return lookAlikes.length > 0 ? mergeByRank(textHits, lookAlikes) : textHits;
  } catch (e) {
    AppLogger.warn('DB', 'Look-alike search failed, showing word matches only:', e);
    return textHits;
  }
};

/**
 * searchDocuments for screens: the words are matched right away (an FTS
 * query capped at 50 rows, a few ms), and the look-alike scan, which reads
 * every photo's vector, runs on the read connection off the JS thread.
 * Same results as searchDocuments.
 */
export const searchDocumentsAsync = async (query: string, queryVector?: Float32Array): Promise<DocumentRecord[]> => {
  const textHits = searchByWords(query);
  if (!queryVector || !query.trim()) return textHits;
  const t0 = Date.now();
  try {
    const lookAlikes = await searchByLookAsync(queryVector);
    AppLogger.info('DB', `Look-alike search took ${Date.now() - t0}ms (off the JS thread). Found ${lookAlikes.length} photos.`);
    return lookAlikes.length > 0 ? mergeByRank(textHits, lookAlikes) : textHits;
  } catch (e) {
    AppLogger.warn('DB', 'Look-alike search failed, showing word matches only:', e);
    return textHits;
  }
};

const searchByWords = (query: string): DocumentRecord[] => {
  const t0 = Date.now();
  try {
    const db = getDb();
    const trimmed = query.trim();
    if (!trimmed) return [];

    let results: DocumentRecord[] = [];
    // Split query into individual words for multi-word AND matching
    const words = searchWords(trimmed);
    const safeQuery = words.join(' ');
    // "ID cards" means any ID card: match the collection's concept tokens
    // and phrases (any of them) instead of the words "id" AND "cards".
    const collection = collectionTerms(collectionForQuery(trimmed));
    const collectionFts = collection?.fts ?? '';

    if (isFtsAvailable() && safeQuery) {
      try {
        // Build FTS5 query: each word with wildcard, AND-joined
        const ftsTerms = collectionFts || words.map(ftsGroup).join(' AND ');
        const ftsResults = db.executeSync(
          `SELECT d.id, d.title, d.content, d.filePath, d.type, d.detection_type, d.timestamp
           FROM fts_index f
           JOIN document_index d ON d.id = f.rowid
           WHERE f.fts_index MATCH ?
           ORDER BY rank
           LIMIT 50`,
          [ftsTerms]
        );
        results = processResults(ftsResults);
        if (results.length > 0) {
          AppLogger.info('DB', `FTS5 Search for "${safeQuery}" took ${Date.now() - t0}ms. Found ${results.length} hits.`);
          return results;
        }
      } catch (err) {
        AppLogger.warn('DB', `FTS5 matches failed for query "${trimmed}":`, err);
      }
    }

    // Fallback: LIKE search with multi-word AND + synonym expansion
    // For each word, expand synonyms and build (content LIKE %syn1% OR content LIKE %syn2% OR title LIKE %syn1% ...)
    const whereClauses: string[] = [];
    const params: string[] = [];

    if (collection) {
      // One OR group over the collection's terms.
      whereClauses.push(`(${collection.like.map(() => 'content LIKE ? COLLATE NOCASE').join(' OR ')})`);
      params.push(...collection.like);
    }
    for (const word of collection ? [] : words.length > 0 ? words : [trimmed]) {
      const expanded = expandWithSynonyms(word);
      const orParts: string[] = [];
      for (const syn of expanded) {
        orParts.push('content LIKE ? COLLATE NOCASE');
        params.push(`%${syn}%`);
        orParts.push('title LIKE ? COLLATE NOCASE');
        params.push(`%${syn}%`);
      }
      // Sound key and concept tokens from the search tail
      const t = termsForQueryWord(word);
      for (const extra of [t.roman, t.key, ...t.concepts]) {
        if (!extra) continue;
        orParts.push('content LIKE ? COLLATE NOCASE');
        params.push(`%${extra}%`);
      }
      // Also match via Soundex code (phonetic matching)
      const sx = soundex(word);
      if (sx && sx.length === 4) {
        orParts.push('content LIKE ? COLLATE NOCASE');
        params.push(`%${sx}%`);
      }
      whereClauses.push(`(${orParts.join(' OR ')})`);
    }

    const whereSQL = whereClauses.join(' AND ');
    const likeResults = db.executeSync(
      `SELECT id, title, content, filePath, type, detection_type, timestamp
       FROM document_index
       WHERE ${whereSQL}
       ORDER BY timestamp DESC
       LIMIT 50`,
      params
    );
    results = processResults(likeResults);

    AppLogger.info('DB', `Enhanced Search for "${trimmed}" took ${Date.now() - t0}ms. Found ${results.length} hits.`);

    // ─── Relevance Ranking ────────────────────────────────────────────
    // Score and re-sort results so the most relevant appear first
    const rankedResults = rankResults(results, trimmed, words);

    // ─── Deduplication ───────────────────────────────────────────────
    // Same file may be indexed multiple times; keep only the top-ranked entry
    const seen = new Set<string>();
    const dedupedResults = rankedResults.filter(doc => {
      if (seen.has(doc.filePath)) return false;
      seen.add(doc.filePath);
      return true;
    });

    return dedupedResults;
  } catch (e) {
    AppLogger.error('DB', `Search Failed after ${Date.now() - t0}ms:`, e);
    return [];
  }
};

// ─── Relevance Ranking ──────────────────────────────────────────────────────

const rankResults = (results: DocumentRecord[], query: string, words: string[]): DocumentRecord[] => {
  const lowerQuery = query.toLowerCase();

  const scored = results.map(doc => {
    let score = 0;
    const lowerContent = (doc.content || '').toLowerCase();
    const lowerTitle = (doc.title || '').toLowerCase();

    // Title match — highest priority
    if (lowerTitle.includes(lowerQuery)) score += 50;
    for (const w of words) {
      if (lowerTitle.includes(w.toLowerCase())) score += 15;
    }

    // Exact phrase match in content
    if (lowerContent.includes(lowerQuery)) score += 30;

    // Individual word matches in content
    for (const w of words) {
      if (lowerContent.includes(w.toLowerCase())) score += 10;
    }

    // Recency boost (0-10 points, decays over 30 days)
    if (doc.timestamp) {
      const ageMs = Date.now() - doc.timestamp;
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      score += Math.max(0, 10 - Math.floor(ageDays / 3));
    }

    return { doc, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.doc);
};

/**
 * Extract a text snippet (~80 chars) around the first match of the query keyword.
 * Used by the UI to show WHERE the match was found.
 */
export const extractSnippet = (content: string, query: string, snippetLen = 80): string => {
  if (!content || !query) return '';
  const lower = content.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 0);

  // Find the position of the first matching word
  let matchPos = -1;
  let matchWord = '';
  for (const w of words) {
    const pos = lower.indexOf(w);
    if (pos !== -1 && (matchPos === -1 || pos < matchPos)) {
      matchPos = pos;
      matchWord = w;
    }
  }

  if (matchPos === -1) return content.substring(0, snippetLen) + (content.length > snippetLen ? '...' : '');

  // Extract a window around the match
  const halfLen = Math.floor(snippetLen / 2);
  let start = Math.max(0, matchPos - halfLen);
  let end = Math.min(content.length, matchPos + matchWord.length + halfLen);

  let snippet = content.substring(start, end).replace(/\n/g, ' ').trim();
  if (start > 0) snippet = '...' + snippet;
  if (end < content.length) snippet += '...';

  return snippet;
};
