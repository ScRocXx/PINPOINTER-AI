/**
 * Database connection management: singleton handle, schema setup,
 * capability flags (FTS5 / sqlite-vec), and teardown.
 */
import { open } from '@op-engineering/op-sqlite';
import { AppLogger } from '../utils/AppLogger';
import { seedFileStateFromIndex } from './fileState';
import { maskSensitiveData } from '../utils/DataMasking';
import { withSearchTail } from '../utils/SearchKeys';

// ─── Singleton DB ───────────────────────────────────────────────────────────

let _db: ReturnType<typeof open> | null = null;

/** Internal accessor for the singleton connection. Opens lazily. */
export const getDb = (): ReturnType<typeof open> => {
  if (!_db) {
    _db = open({ name: 'pinpoint.db' });
  }
  return _db;
};

/**
 * A second connection, for reads that may take a while (photo look-alike
 * search scans every vector). Its async execute() runs on op-sqlite's own
 * thread, so the JS thread stays free to draw; WAL lets it read while
 * indexing writes on the main connection. Opened on first use, after
 * setupDatabase() has created the tables.
 */
let _readDb: ReturnType<typeof open> | null = null;

export const getReadDb = (): ReturnType<typeof open> => {
  if (!_readDb) {
    _readDb = open({ name: 'pinpoint.db' });
  }
  return _readDb;
};

export const closeDatabase = () => {
  if (_readDb) {
    const readDb = _readDb;
    _readDb = null;
    // In tests open() hands back the same object for the same name.
    if (readDb !== _db) {
      try {
        readDb.close();
      } catch (e) {
        AppLogger.warn('DB', 'Failed to close the read connection', e);
      }
    }
  }
  if (_db) {
    try {
      _db.close();
      _db = null;
      AppLogger.info('DB', 'Database Connection Closed safely');
    } catch (e) {
      AppLogger.error('DB', 'Failed to close database safely', e);
    }
  }
};

// ─── Capability flags ───────────────────────────────────────────────────────
// Set during setupDatabase(); read by search.ts and vectors.ts.

let _ftsAvailable = false;
let _vecAvailable = false;

/** True when the FTS5 virtual table was created successfully. */
export const isFtsAvailable = (): boolean => _ftsAvailable;

/** True when the sqlite-vec virtual table was created successfully. */
export const isVecAvailable = (): boolean => _vecAvailable;

// ─── Schema Setup ───────────────────────────────────────────────────────────

/**
 * FTS5 tokenizer that keeps Indian-script vowel signs inside words.
 * unicode61's default categories ("L* N* Co") leave out combining marks
 * (Mn, Mc), so बिल was split at its vowel sign. Older SQLite builds without
 * the `categories` option fall back to plain unicode61.
 */
const INDIC_TOKENIZER = `unicode61 categories 'L* N* Co Mn Mc'`;

const createFtsTable = (db: ReturnType<typeof open>) => {
  try {
    db.executeSync(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
        content,
        filePath UNINDEXED,
        tokenize = "${INDIC_TOKENIZER}"
      );
    `);
  } catch (e) {
    AppLogger.warn('DB', 'FTS5 categories option unsupported, using plain unicode61:', e);
    db.executeSync(`
      CREATE VIRTUAL TABLE IF NOT EXISTS fts_index USING fts5(
        content,
        filePath UNINDEXED,
        tokenize = 'unicode61'
      );
    `);
  }
};

export const setupDatabase = () => {
  try {
    const db = getDb();

    // Enable WAL mode for 2-3x faster concurrent reads/writes during sync
    try { db.executeSync('PRAGMA journal_mode=WAL;'); } catch { }

    // Main data table — always required
    db.executeSync(`
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
    try { db.executeSync(`ALTER TABLE document_index ADD COLUMN title TEXT;`); } catch { }
    try { db.executeSync(`ALTER TABLE document_index ADD COLUMN type TEXT DEFAULT 'IMAGE';`); } catch { }
    try { db.executeSync(`ALTER TABLE document_index ADD COLUMN detection_type TEXT DEFAULT 'TEXT';`); } catch { }
    try { db.executeSync(`ALTER TABLE document_index ADD COLUMN timestamp INTEGER;`); } catch { }
    try { db.executeSync(`ALTER TABLE document_index ADD COLUMN page_count INTEGER DEFAULT 0;`); } catch { }
    try { db.executeSync(`ALTER TABLE document_index ADD COLUMN pdf_status TEXT DEFAULT 'PENDING';`); } catch { }

    // Try FTS5 (may not be compiled into this SQLite build)
    try {
      createFtsTable(db);

      db.executeSync(`
        CREATE TRIGGER IF NOT EXISTS fts_insert AFTER INSERT ON document_index BEGIN
          INSERT INTO fts_index(rowid, content, filePath)
          VALUES (NEW.id, NEW.content, NEW.filePath);
        END;
      `);

      db.executeSync(`
        CREATE TRIGGER IF NOT EXISTS fts_delete AFTER DELETE ON document_index BEGIN
          DELETE FROM fts_index WHERE rowid = OLD.id;
        END;
      `);

      db.executeSync(`
        CREATE TRIGGER IF NOT EXISTS fts_update AFTER UPDATE OF content ON document_index BEGIN
          DELETE FROM fts_index WHERE rowid = OLD.id;
          INSERT INTO fts_index(rowid, content, filePath)
          VALUES (NEW.id, NEW.content, NEW.filePath);
        END;
      `);

      _ftsAvailable = true;
      AppLogger.info('DB', 'Database Ready (FTS5 enabled)');
    } catch (ftsError) {
      _ftsAvailable = false;
      AppLogger.warn('DB', 'FTS5 not available, using LIKE fallback:', ftsError);
      AppLogger.info('DB', 'Database Ready (LIKE mode)');
    }

    // ─── sqlite-vec Vector Index ───────────────────────────────────────
    try {
      db.executeSync(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_index USING vec0(
          document_id INTEGER PRIMARY KEY,
          embedding float[512]
        );
      `);
      _vecAvailable = true;
      AppLogger.info('DB', 'Vector index ready (sqlite-vec enabled)');
    } catch (vecError) {
      _vecAvailable = false;
      AppLogger.warn('DB', 'sqlite-vec not available:', vecError);
    }

    runMigrations();
  } catch (error) {
    AppLogger.error('DB', 'Setup Failed:', error);
  }
};

// ─── Versioned migrations ───────────────────────────────────────────────────
// PRAGMA user_version records the last migration applied. Each migration runs
// once, in its own transaction; add new ones to the end, never edit old ones.
// (The CREATE/ALTER statements above predate this and stay idempotent.)

interface Migration {
  version: number;
  name: string;
  up: () => void;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'per-file indexing state',
    up: () => {
      const db = getDb();
      db.executeSync(`
        CREATE TABLE IF NOT EXISTS files (
          uri TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          mtime INTEGER,
          ocr_status TEXT NOT NULL DEFAULT 'pending',
          embed_status TEXT NOT NULL DEFAULT 'pending',
          embed_model TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          updated_at INTEGER
        ) WITHOUT ROWID;
      `);
      db.executeSync('CREATE INDEX IF NOT EXISTS files_embed_status ON files(embed_status);');
      seedFileStateFromIndex(_vecAvailable);
    },
  },
  {
    version: 2,
    name: 'Indian-language search keys and tokenizer',
    up: () => {
      const db = getDb();
      // 1. Re-mask (Indian digits are now caught) and add the search tail of
      //    sound keys and concept ids to every row. The fts_update trigger
      //    keeps the old FTS table in step while this runs.
      const rows = (db.executeSync('SELECT id, title, content FROM document_index;')?.rows ?? []) as Array<{
        id: number; title: string | null; content: string | null;
      }>;
      for (const r of rows) {
        const current = r.content ?? '';
        const masked = maskSensitiveData(current);
        const next = masked.trim() ? withSearchTail(masked, r.title) : masked;
        if (next !== current) {
          db.executeSync('UPDATE document_index SET content = ? WHERE id = ?;', [next, r.id]);
        }
      }
      // 2. Rebuild FTS with the Indian-script tokenizer.
      if (_ftsAvailable) {
        db.executeSync('DROP TABLE IF EXISTS fts_index;');
        createFtsTable(db);
        db.executeSync('INSERT INTO fts_index(rowid, content, filePath) SELECT id, content, filePath FROM document_index;');
      }
    },
  },
];

/** The schema version this build expects. */
export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Current PRAGMA user_version (0 for a database that predates migrations). */
export const getSchemaVersion = (): number => {
  try {
    const row = getDb().executeSync('PRAGMA user_version;')?.rows?.[0] as { user_version?: number } | undefined;
    return typeof row?.user_version === 'number' ? row.user_version : 0;
  } catch {
    return 0;
  }
};

const runMigrations = () => {
  const db = getDb();
  let current = getSchemaVersion();
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    try {
      db.executeSync('BEGIN TRANSACTION;');
      migration.up();
      db.executeSync(`PRAGMA user_version = ${migration.version};`);
      db.executeSync('COMMIT;');
      current = migration.version;
      AppLogger.info('DB', `Migration ${migration.version} applied (${migration.name})`);
    } catch (e) {
      try { db.executeSync('ROLLBACK;'); } catch { }
      AppLogger.error('DB', `Migration ${migration.version} failed (${migration.name})`, e);
      return; // later migrations may depend on this one
    }
  }
};
