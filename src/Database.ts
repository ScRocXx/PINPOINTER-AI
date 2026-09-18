import { open } from 'react-native-quick-sqlite';
import { soundex } from './utils/Soundex';
import { maskSensitiveData } from './utils/DataMasking';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DocumentRecord {
  id?: number;
  title?: string; // Newly added for Document matching
  content: string;
  filePath: string;
  type: 'IMAGE' | 'DOCUMENT';
  detection_type: 'TEXT' | 'OBJECT';
  timestamp: number;
}

// ─── Singleton DB ───────────────────────────────────────────────────────────

let _db: ReturnType<typeof open> | null = null;

const getDb = (): ReturnType<typeof open> => {
  if (!_db) {
    _db = open({ name: 'pinpoint.db' });
  }
  return _db;
};

export const closeDatabase = () => {
  if (_db) {
    try {
      _db.close();
      _db = null;
      console.log('[DB] Database Connection Closed safely');
    } catch (e) {
      console.error('[DB] Failed to close database safely', e);
    }
  }
};

// ─── FTS5 availability flag ─────────────────────────────────────────────────
let _ftsAvailable = false;

// ─── Schema Setup ───────────────────────────────────────────────────────────

export const setupDatabase = () => {
  try {
    const db = getDb();

    // Enable WAL mode for 2-3x faster concurrent reads/writes during sync
    try { db.execute('PRAGMA journal_mode=WAL;'); } catch (_) { }

    // Main data table — always required
    db.execute(`
      CREATE TABLE IF NOT EXISTS document_index (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        filePath TEXT UNIQUE,
        type TEXT DEFAULT 'IMAGE',
        detection_type TEXT DEFAULT 'TEXT',
        timestamp INTEGER
      );
    `);

    // Add columns if upgrading from old schema (safe to run even if column exists)
    try { db.execute(`ALTER TABLE document_index ADD COLUMN title TEXT;`); } catch (_) { }
    try { db.execute(`ALTER TABLE document_index ADD COLUMN type TEXT DEFAULT 'IMAGE';`); } catch (_) { }
    try { db.execute(`ALTER TABLE document_index ADD COLUMN detection_type TEXT DEFAULT 'TEXT';`); } catch (_) { }
    try { db.execute(`ALTER TABLE document_index ADD COLUMN timestamp INTEGER;`); } catch (_) { }
    try { db.execute(`ALTER TABLE document_index ADD COLUMN page_count INTEGER DEFAULT 0;`); } catch (_) { }
    try { db.execute(`ALTER TABLE document_index ADD COLUMN pdf_status TEXT DEFAULT 'PENDING';`); } catch (_) { }

    // Try FTS5 (may not be compiled into this SQLite build)
    try {
      db.execute(`
        CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
          content,
          filePath UNINDEXED,
          tokenize = 'unicode61'
        );
      `);

      db.execute(`
        CREATE TRIGGER IF NOT EXISTS fts_insert AFTER INSERT ON document_index BEGIN
          INSERT INTO fts_index(rowid, content, filePath)
          VALUES (NEW.id, NEW.content, NEW.filePath);
        END;
      `);

      db.execute(`
        CREATE TRIGGER IF NOT EXISTS fts_delete AFTER DELETE ON document_index BEGIN
          DELETE FROM fts_index WHERE rowid = OLD.id;
        END;
      `);

      db.execute(`
        CREATE TRIGGER IF NOT EXISTS fts_update AFTER UPDATE OF content ON document_index BEGIN
          DELETE FROM fts_index WHERE rowid = OLD.id;
          INSERT INTO fts_index(rowid, content, filePath)
          VALUES (NEW.id, NEW.content, NEW.filePath);
        END;
      `);

      _ftsAvailable = true;
      console.log('[DB] Database Ready (FTS5 enabled)');
    } catch (ftsError) {
      _ftsAvailable = false;
      console.warn('[DB] FTS5 not available, using LIKE fallback:', ftsError);
      console.log('[DB] Database Ready (LIKE mode)');
    }
  } catch (error) {
    console.error('[DB] Setup Failed:', error);
  }
};

// ─── Queries ────────────────────────────────────────────────────────────────

export const isFileIndexed = (path: string): boolean => {
  try {
    const db = getDb();
    const result = db.execute('SELECT id FROM document_index WHERE filePath = ? LIMIT 1', [path]);
    const rows = result?.rows?._array || (result?.rows ? Array.from(result.rows) : []);
    return rows.length > 0;
  } catch (e) {
    console.warn('[DB] isFileIndexed check failed:', e);
    return false;
  }
};

export const indexDocument = (
  title: string | null = null,
  content: string,
  filePath: string,
  type: 'IMAGE' | 'DOCUMENT',
  detection_type: 'TEXT' | 'OBJECT'
) => {
  // C2 fix: Mask PII (Aadhaar/PAN/phone) at the single chokepoint so no caller can bypass it
  content = maskSensitiveData(content ?? '');

  if (!content.trim() && !title?.trim()) {
    console.log('[DB] Skipped empty indexing for:', filePath);
    return;
  }

  try {
    const db = getDb();
    // Always DELETE first to ensure FTS triggers fire correctly for updates
    db.execute('DELETE FROM document_index WHERE filePath = ?', [filePath]);
    db.execute(
      'INSERT INTO document_index (title, content, filePath, type, detection_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
      [title, content.trim(), filePath, type, detection_type, Date.now()]
    );
    console.log(`[DB] Indexed ✅ [${type}] ${filePath}`);
  } catch (e) {
    console.error('[DB] Save Failed:', e);
  }
};

// ─── Batch Transaction Support ──────────────────────────────────────────────
// Wrap bulk inserts in BEGIN/COMMIT for 3-5x speed boost during sync

export const beginTransaction = () => {
  try { getDb().execute('BEGIN TRANSACTION;'); } catch (_) { }
};

export const commitTransaction = () => {
  try { getDb().execute('COMMIT;'); } catch (_) { }
};

export const rollbackTransaction = () => {
  try { getDb().execute('ROLLBACK;'); } catch (_) { }
};

/**
 * Helper to process query results into DocumentRecord array.
 */
const processResults = (result: any): DocumentRecord[] => {
  const rows = result?.rows?._array || (result?.rows ? Array.from(result.rows) : []);
  return rows.map((row: any) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    filePath: row.filePath,
    type: row.type,
    detection_type: row.detection_type,
    timestamp: row.timestamp,
  })) as DocumentRecord[];
};

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
export const searchDocuments = (query: string): DocumentRecord[] => {
  const t0 = Date.now();
  try {
    const db = getDb();
    const trimmed = query.trim();
    if (!trimmed) return [];

    let results: DocumentRecord[] = [];
    const safeQuery = trimmed.replace(/[^\w\s-]/g, '').trim();

    // Split query into individual words for multi-word AND matching
    const words = safeQuery.split(/\s+/).filter(w => w.length > 0);

    if (_ftsAvailable && safeQuery) {
      try {
        // Build FTS5 query: each word with wildcard, AND-joined
        const ftsTerms = words.map(w => `"${w}"*`).join(' AND ');
        const ftsResults = db.execute(
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
          console.log(`[DB] FTS5 Search for "${safeQuery}" took ${Date.now() - t0}ms. Found ${results.length} hits.`);
          return results;
        }
      } catch (err) {
        console.warn(`[DB] FTS5 matches failed for query "${trimmed}":`, err);
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
    const likeResults = db.execute(
      `SELECT id, title, content, filePath, type, detection_type, timestamp
       FROM document_index
       WHERE ${whereSQL}
       ORDER BY timestamp DESC
       LIMIT 50`,
      params
    );
    results = processResults(likeResults);

    console.log(`[DB] Enhanced Search for "${trimmed}" took ${Date.now() - t0}ms. Found ${results.length} hits.`);

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
    console.error(`[DB] Search Failed after ${Date.now() - t0}ms:`, e);
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

/** Returns the total number of indexed documents */
export const getIndexedCount = (): number => {
  try {
    const db = getDb();
    const result = db.execute('SELECT COUNT(*) as cnt FROM document_index');
    const rows = result?.rows?._array || (result?.rows ? Array.from(result.rows) : []);
    return rows.length > 0 ? (rows[0] as { cnt: number }).cnt : 0;
  } catch (e) {
    console.warn('[DB] Count Failed:', e);
    return 0;
  }
};

/** Clears all indexed documents — useful for a forced full re-index */
export const clearIndex = () => {
  try {
    const db = getDb();
    db.execute('DELETE FROM document_index');
    if (_ftsAvailable) {
      try { db.execute('DELETE FROM fts_index'); } catch (_) { }
    }
    console.log('[DB] Index cleared');
  } catch (e) {
    console.error('[DB] Clear Failed:', e);
  }
};

/** Returns all documents of type 'DOCUMENT' for the vault screen */
export const getAllDocuments = (): DocumentRecord[] => {
  try {
    const db = getDb();
    const result = db.execute(
      `SELECT id, title, content, filePath, type, detection_type, timestamp
       FROM document_index
       WHERE type = 'DOCUMENT'
       ORDER BY timestamp DESC`
    );
    return processResults(result);
  } catch (e) {
    console.warn('[DB] getAllDocuments failed:', e);
    return [];
  }
};