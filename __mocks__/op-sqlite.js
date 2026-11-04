/**
 * __mocks__/op-sqlite.js — in-memory mock of @op-engineering/op-sqlite
 *
 * Implements just enough of the op-sqlite API (`open()` → db with
 * `executeSync` / `execute`) to run src/Database.ts for real in jest:
 *   - document_index table (INSERT/DELETE/SELECT, UNIQUE-ish filePath handling
 *     is done by the app's DELETE-before-INSERT pattern)
 *   - vec_index table (embedding storage)
 *   - FTS5 MATCH queries → case-insensitive substring matching over
 *     content + title (AND/OR term logic honored)
 *   - LIKE fallback queries → evaluates the generated WHERE clause
 *   - last_insert_rowid(), COUNT(*), transactions (BEGIN/COMMIT/ROLLBACK
 *     with snapshot/restore, nesting-safe)
 *   - DDL (CREATE TABLE / VIRTUAL TABLE / TRIGGER / ALTER / PRAGMA) → no-op
 *
 * Routed via jest.config.js moduleNameMapper so tests always use this
 * deterministic in-memory implementation instead of the native module.
 */

const splitTopLevel = (sql, delimiter) => {
  // Split on delimiter, ignoring delimiters nested inside parentheses.
  const parts = [];
  let depth = 0;
  let current = '';
  const d = delimiter.toUpperCase();
  const upper = sql.toUpperCase();
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    if (sql[i] === ')') depth--;
    if (depth === 0 && upper.startsWith(d, i)) {
      parts.push(current);
      current = '';
      i += d.length - 1;
    } else {
      current += sql[i];
    }
  }
  parts.push(current);
  return parts;
};

const parseSelectColumns = (selectList) => {
  // Returns [{ key }] — the output property name for each selected column.
  return splitTopLevel(selectList, ',').map((col) => {
    const c = col.trim();
    const asMatch = c.match(/^(.*)\s+AS\s+([A-Za-z_][\w]*)$/i);
    if (asMatch) return { key: asMatch[2] };
    // Strip table prefix: d.id → id ; fts_index MATCH … never lands here
    const dot = c.lastIndexOf('.');
    const bare = (dot >= 0 ? c.slice(dot + 1) : c).trim();
    // Expression columns without alias (e.g. SUM(...)) → shouldn't happen;
    // give them a synthetic key so projection never crashes.
    if (/[()]/.test(bare)) return { key: '__expr', expr: true };
    return { key: bare };
  });
};

class MockDB {
  constructor(name) {
    this.name = name;
    this.documents = [];
    this.vectors = [];
    this._autoId = 1;
    this._lastInsertId = null;
    this._txStack = [];
  }

  // ── op-sqlite API surface ──────────────────────────────────────────────
  executeSync(sql, params) {
    return this._exec(sql, params || []);
  }

  execute(sql, params) {
    return this._exec(sql, params || []);
  }

  close() {}

  // Test helper: wipe everything (mirrors a fresh install)
  __reset() {
    this.documents = [];
    this.vectors = [];
    this._autoId = 1;
    this._lastInsertId = null;
    this._txStack = [];
  }

  // ── internals ──────────────────────────────────────────────────────────
  _snapshot() {
    return {
      documents: this.documents.map((r) => ({ ...r })),
      vectors: this.vectors.map((r) => ({ ...r })),
      autoId: this._autoId,
      lastInsertId: this._lastInsertId,
    };
  }

  _restore(s) {
    this.documents = s.documents;
    this.vectors = s.vectors;
    this._autoId = s.autoId;
    this._lastInsertId = s.lastInsertId;
  }

  _project(rows, selectList, extra = {}) {
    const cols = parseSelectColumns(selectList);
    return rows.map((row) => {
      const out = {};
      cols.forEach(({ key, expr }) => {
        if (expr) {
          out[key] = extra[key] !== undefined ? extra[key] : 1.0;
        } else if (extra[key] !== undefined && row[key] === undefined) {
          out[key] = extra[key];
        } else {
          out[key] = row[key];
        }
      });
      // Carry through any extra computed columns (e.g. rrf_score)
      Object.keys(extra).forEach((k) => {
        if (!(k in out)) out[k] = extra[k];
      });
      return out;
    });
  }

  _selectList(sql) {
    const m = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s/i);
    return m ? m[1] : '*';
  }

  _exec(sql, params) {
    const q = sql.replace(/\s+/g, ' ').trim();
    const up = q.toUpperCase();

    // DDL / PRAGMA → no-op success
    if (/^(PRAGMA|CREATE|ALTER)\b/.test(up)) return { rows: [] };

    // Transactions (nesting-safe via snapshot stack)
    if (/^BEGIN\b/.test(up)) {
      this._txStack.push(this._snapshot());
      return { rows: [] };
    }
    if (/^COMMIT\b/.test(up)) {
      this._txStack.pop();
      return { rows: [] };
    }
    if (/^ROLLBACK\b/.test(up)) {
      const s = this._txStack.pop();
      if (s) this._restore(s);
      return { rows: [] };
    }

    // INSERT INTO document_index (cols…) VALUES (…)
    if (/^INSERT INTO document_index\s*\(/i.test(q)) {
      const m = q.match(/^INSERT INTO document_index\s*\(([^)]+)\)/i);
      const cols = m[1].split(',').map((c) => c.trim());
      const row = { id: this._autoId++ };
      cols.forEach((c, i) => {
        row[c] = params[i];
      });
      this.documents.push(row);
      this._lastInsertId = row.id;
      return { rows: [] };
    }

    // INSERT INTO vec_index
    if (/^INSERT INTO vec_index/i.test(q)) {
      const [document_id, embedding] = params;
      this.vectors.push({ document_id, embedding });
      return { rows: [] };
    }

    // DELETE variants
    if (/^DELETE FROM document_index WHERE filePath = \?/i.test(q)) {
      const [p] = params;
      this.documents = this.documents.filter((r) => r.filePath !== p);
      return { rows: [] };
    }
    if (/^DELETE FROM document_index\s*;?\s*$/i.test(q)) {
      this.documents = [];
      return { rows: [] };
    }
    if (/^DELETE FROM fts_index/i.test(q)) return { rows: [] }; // FTS is virtual over documents
    if (/^DELETE FROM vec_index\s*;?\s*$/i.test(q)) {
      this.vectors = [];
      return { rows: [] };
    }
    if (/^DELETE FROM vec_index WHERE document_id = \?/i.test(q)) {
      const [id] = params;
      this.vectors = this.vectors.filter((v) => v.document_id !== id);
      return { rows: [] };
    }

    // SELECT last_insert_rowid()
    if (/last_insert_rowid\(\)/i.test(q)) {
      return { rows: [{ id: this._lastInsertId }] };
    }

    // SELECT COUNT(*) as cnt FROM …
    if (/SELECT COUNT\(\*\) as cnt FROM vec_index/i.test(q)) {
      return { rows: [{ cnt: this.vectors.length }] };
    }
    if (/SELECT COUNT\(\*\) as cnt FROM document_index/i.test(q)) {
      return { rows: [{ cnt: this.documents.length }] };
    }

    // Point lookups
    if (/FROM document_index WHERE filePath = \?/i.test(q)) {
      const [p] = params;
      const hit = this.documents.find((r) => r.filePath === p);
      return { rows: hit ? this._project([hit], this._selectList(q)) : [] };
    }
    if (/FROM vec_index WHERE document_id = \?/i.test(q)) {
      const [id] = params;
      const hit = this.vectors.find((v) => v.document_id === id);
      return { rows: hit ? [{ document_id: hit.document_id }] : [] };
    }

    // Images without an embedding (backfill): id < ? AND id NOT IN vec_index
    if (/WHERE type = 'IMAGE' AND id < \? AND id NOT IN \(SELECT document_id FROM vec_index\)/i.test(q)) {
      const [beforeId, limit] = params;
      const withVec = new Set(this.vectors.map((v) => v.document_id));
      const rows = this.documents
        .filter((r) => r.type === 'IMAGE' && r.id < beforeId && !withVec.has(r.id))
        .sort((a, b) => b.id - a.id)
        .slice(0, limit);
      return { rows: this._project(rows, this._selectList(q)) };
    }

    // FTS5 MATCH (simple FTS path + hybrid WITH query)
    if (/\bMATCH\b/i.test(q)) return this._ftsSearch(q, params);

    // LIKE fallback
    if (/\bLIKE\b/i.test(q)) return this._likeSearch(q, params);

    // Vault listing: WHERE type = 'DOCUMENT'
    if (/FROM document_index WHERE type = 'DOCUMENT'/i.test(q)) {
      const rows = this.documents
        .filter((r) => r.type === 'DOCUMENT')
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return { rows: this._project(rows, this._selectList(q)) };
    }

    // Unknown statement → empty result (mirrors a failed query the app catches)
    return { rows: [] };
  }

  _matchTerms(matchParam) {
    // FTS5 term strings look like: "aadhaar"* AND "card"*  or  "x"* OR "y"*
    const terms = [];
    const re = /"([^"]+)"\*?/g;
    let m;
    while ((m = re.exec(matchParam)) !== null) terms.push(m[1].toLowerCase());
    const isOr = /\bOR\b/i.test(matchParam);
    return { terms, isOr };
  }

  _docMatchesTerms(doc, terms, isOr) {
    const hay = `${doc.title || ''} ${doc.content || ''}`.toLowerCase();
    return isOr ? terms.some((t) => hay.includes(t)) : terms.every((t) => hay.includes(t));
  }

  _ftsSearch(q, params) {
    // params: [ftsTerms] for the simple path, [vectorBlob, ftsTerms] for hybrid
    const matchParam = String(params[params.length - 1] ?? '');
    const { terms, isOr } = this._matchTerms(matchParam);
    const hybrid = /rrf_score/i.test(q);
    let rows = this.documents.filter((d) => this._docMatchesTerms(d, terms, isOr));
    rows = rows.slice(0, 50);
    const extra = hybrid ? { rrf_score: 1.0 } : {};
    return { rows: this._project(rows, this._selectList(q), extra) };
  }

  _likeSearch(q, params) {
    const whereRaw = q.split(/WHERE/i)[1] || '';
    const where = whereRaw.split(/ORDER BY/i)[0];
    // Top-level groups: ( … ) AND ( … )
    const groups = splitTopLevel(where, 'AND').map((g) => g.replace(/^\(|\)$/g, '').trim());
    let pIdx = 0;
    const groupTests = groups.map((g) => {
      const atoms = [...g.matchAll(/(\w+)\s+LIKE\s+\?/gi)];
      const tests = atoms.map((a) => {
        const col = a[1];
        const needle = String(params[pIdx++] ?? '').replace(/%/g, '').toLowerCase();
        return (row) => String(row[col] ?? '').toLowerCase().includes(needle);
      });
      return (row) => tests.some((t) => t(row));
    });
    let rows = this.documents.filter((r) => groupTests.every((f) => f(r)));
    rows = rows.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 50);
    return { rows: this._project(rows, this._selectList(q)) };
  }
}

const instances = new Map();

/** Open (or reuse) a named in-memory database. */
const open = jest.fn((options = {}) => {
  const name = options.name || ':memory:';
  if (!instances.has(name)) instances.set(name, new MockDB(name));
  return instances.get(name);
});

/** Test helper — drop all open instances so the next open() is pristine. */
const __resetAll = () => {
  instances.clear();
  open.mockClear();
};

module.exports = { open, __resetAll, MockDB };
module.exports.default = { open, __resetAll };
