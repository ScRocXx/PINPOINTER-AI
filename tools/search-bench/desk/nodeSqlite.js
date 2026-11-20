/* eslint-env node */
/**
 * A stand-in for @op-engineering/op-sqlite on a computer: the same `open()` →
 * `executeSync` / `execute` / `close` surface, backed by Node's built-in
 * SQLite (node:sqlite, with FTS5 and fts5vocab) plus the sqlite-vec extension
 * (the `vec0` table the app uses for photo look-alikes).
 *
 * Unlike the Jest mock in __mocks__/op-sqlite.js, which imitates FTS5 with
 * substring matching, this runs the app's SQL on a real SQLite engine: the
 * real tokenizer, the real FTS5 query syntax, real `rank` ordering, real
 * vector distances. That is what an accuracy bench needs.
 *
 * Every `open()` with the same name shares one connection (the app opens
 * pinpoint.db twice, a writer and a reader; one connection behaves the same
 * for a single-threaded bench).
 */
const { DatabaseSync } = require('node:sqlite');

let vecPath = null;
try {
  vecPath = require('sqlite-vec').getLoadablePath();
} catch {
  vecPath = null; // look-alike search reports "unavailable", as on a phone without sqlite-vec
}

const connections = new Map();

const toParam = v => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return v;
};

/** Statements that return rows (or might). Everything else may hold several statements. */
const RETURNS_ROWS = /^\s*(SELECT|WITH|PRAGMA|INSERT|UPDATE|DELETE|REPLACE)\b/i;

class NodeDb {
  constructor(name) {
    this.name = name;
    this.db = new DatabaseSync(process.env.BENCH_DB_FILE || ':memory:', { allowExtension: true });
    if (vecPath) {
      this.db.loadExtension(vecPath);
    }
    this.db.enableLoadExtension(false);
    this.stmts = new Map();
  }

  prepare(sql) {
    let stmt = this.stmts.get(sql);
    if (!stmt) {
      stmt = this.db.prepare(sql);
      this.stmts.set(sql, stmt);
    }
    return stmt;
  }

  executeSync(sql, params) {
    const args = (params ?? []).map(toParam);
    if (args.length === 0 && !RETURNS_ROWS.test(sql)) {
      this.db.exec(sql);
      return { rows: [], rowsAffected: 0 };
    }
    const stmt = this.prepare(sql);
    if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) {
      const rows = stmt.all(...args).map(r => ({ ...r }));
      return { rows, rowsAffected: 0 };
    }
    const info = stmt.run(...args);
    return { rows: [], rowsAffected: Number(info.changes), insertId: Number(info.lastInsertRowid) };
  }

  async execute(sql, params) {
    return this.executeSync(sql, params);
  }

  close() {}
}

const open = ({ name }) => {
  let conn = connections.get(name);
  if (!conn) {
    conn = new NodeDb(name);
    connections.set(name, conn);
  }
  return conn;
};

/** Close every connection (between bench runs). */
const __closeAll = () => {
  for (const c of connections.values()) {
    try {
      c.db.close();
    } catch {
      // already closed
    }
  }
  connections.clear();
};

module.exports = { open, __closeAll, hasVec: () => !!vecPath };
