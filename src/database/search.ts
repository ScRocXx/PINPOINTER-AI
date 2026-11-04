/**
 * Search: FTS5 full-text search with LIKE fallback, hybrid vector search
 * via Reciprocal Rank Fusion, synonym expansion, phonetic matching,
 * relevance ranking, and snippet extraction.
 */
import { soundex } from '../utils/Soundex';
import { AppLogger } from '../utils/AppLogger';
import { getDb, isFtsAvailable, isVecAvailable } from './connection';
import { processResults } from './documents';
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

// ─── Semantic relevance cutoff ──────────────────────────────────────────────
// vec_index uses L2 distance. Both CLIP vectors are unit length, so
// distance = sqrt(2 - 2·cosine). Without a cutoff the 50 nearest photos are
// returned for every query, even nonsense. 1.26 keeps matches with cosine
// similarity ≳ 0.21, a typical floor for a real CLIP text→image match.
// Tune on device: lower = stricter, fewer semantic results.
export const MAX_VECTOR_DISTANCE = 1.26;

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
 * Search documents — uses FTS5 if available, falls back to LIKE.
 *
 * Improvements:
 *  1. Searches BOTH title and content columns
 *  2. Multi-word queries are split and AND-matched
 *  3. Synonym expansion for common Indian document terms
 */
export const searchDocuments = (query: string, queryVector?: Float32Array): DocumentRecord[] => {
  const t0 = Date.now();
  try {
    const db = getDb();
    const trimmed = query.trim();
    if (!trimmed) return [];

    let results: DocumentRecord[] = [];
    const safeQuery = trimmed.replace(/[^\w\s-]/g, '').trim();

    // Split query into individual words for multi-word AND matching
    const words = safeQuery.split(/\s+/).filter(w => w.length > 0);

    // ── Hybrid Search: FTS5 + Vector via Reciprocal Rank Fusion ──────────
    if (isFtsAvailable() && isVecAvailable() && queryVector && safeQuery) {
      try {
        const ftsTerms = words.map(w => `"${w}"*`).join(' OR ');
        const vectorBlob = new Uint8Array(queryVector.buffer);

        const hybridResults = db.executeSync(`
          WITH
          vector_knn AS (
            SELECT document_id, distance
            FROM vec_index
            WHERE embedding MATCH vec_f32(?)
              AND k = 50
          ),
          vector_matches AS (
            SELECT
              document_id AS rowid,
              ROW_NUMBER() OVER (ORDER BY distance ASC) AS vec_rank
            FROM vector_knn
            WHERE distance <= ?
          ),
          fts_matches AS (
            SELECT
              rowid,
              ROW_NUMBER() OVER (ORDER BY rank ASC) AS fts_rank
            FROM fts_index
            WHERE fts_index MATCH ?
            LIMIT 50
          ),
          combined AS (
            SELECT rowid, fts_rank AS rank, 'fts' AS source FROM fts_matches
            UNION ALL
            SELECT rowid, vec_rank AS rank, 'vec' AS source FROM vector_matches
          )
          SELECT
            d.id, d.title, d.content, d.filePath, d.type,
            d.detection_type, d.timestamp,
            SUM(CASE WHEN c.source = 'fts' THEN 2.0 / (60.0 + c.rank)
                     ELSE 1.0 / (60.0 + c.rank) END) AS rrf_score
          FROM combined c
          JOIN document_index d ON d.id = c.rowid
          GROUP BY c.rowid
          ORDER BY rrf_score DESC
          LIMIT 50
        `, [vectorBlob, MAX_VECTOR_DISTANCE, ftsTerms]);

        const hybridHits = processResults(hybridResults);
        if (hybridHits.length > 0) {
          AppLogger.info('DB', `Hybrid Search for "${safeQuery}" took ${Date.now() - t0}ms. Found ${hybridHits.length} hits.`);
          return hybridHits;
        }
      } catch (err) {
        AppLogger.warn('DB', 'Hybrid search failed, falling back to FTS5:', err);
      }
    }

    if (isFtsAvailable() && safeQuery) {
      try {
        // Build FTS5 query: each word with wildcard, AND-joined
        const ftsTerms = words.map(w => `"${w}"*`).join(' AND ');
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

    for (const word of words.length > 0 ? words : [trimmed]) {
      const expanded = expandWithSynonyms(word);
      const orParts: string[] = [];
      for (const syn of expanded) {
        orParts.push('content LIKE ? COLLATE NOCASE');
        params.push(`%${syn}%`);
        orParts.push('title LIKE ? COLLATE NOCASE');
        params.push(`%${syn}%`);
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
