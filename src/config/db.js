/**
 * Database setup.
 *
 * We use SQLite through `sql.js` — SQLite compiled to WebAssembly.
 * Why: it is pure JavaScript, so `npm install` works on every machine
 * (no C++ compiler, no Visual Studio, no database server to install).
 *
 * The database lives in memory while the server runs and is written to
 * a file (data/taskmaster.db) shortly after every change, so data survives
 * restarts. The schema is created automatically on first start.
 *
 * This module exposes a tiny synchronous API modelled on better-sqlite3:
 *
 *   db.prepare(sql).get(...params)   -> first row or undefined
 *   db.prepare(sql).all(...params)   -> array of rows
 *   db.prepare(sql).run(...params)   -> { changes, lastInsertRowid }
 *   db.exec(sql)                     -> run several statements (no params)
 *   db.transaction(fn)               -> returns a function that runs fn inside BEGIN/COMMIT
 *
 * Params may be positional (`?` with a list of values) or named
 * (`@name` with a single object: { name: value }).
 *
 * IMPORTANT: `await db.init()` must be called once before handling requests
 * (server.js and scripts/smoke-test.js do this).
 */
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const env = require('./env');

const SAVE_DELAY_MS = 50;      // batch rapid writes into one file save
const inMemory = env.dbFile === ':memory:';

let sqlite = null;             // the sql.js Database instance
let saveTimer = null;

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    bio           TEXT    DEFAULT '',
    created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teams (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invite_code TEXT    NOT NULL UNIQUE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS team_members (
    team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (team_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    description TEXT    DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'in_progress', 'completed')),
    priority    TEXT    NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low', 'medium', 'high')),
    due_date    TEXT,
    creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    team_id     INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stored_name   TEXT    NOT NULL,
    original_name TEXT    NOT NULL,
    mime_type     TEXT,
    size_bytes    INTEGER NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT    NOT NULL,
    message    TEXT    NOT NULL,
    task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
    is_read    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- JWTs that were explicitly logged out. Checked on every authenticated request.
  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti        TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_team     ON tasks(team_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_status   ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_comments_task  ON comments(task_id);
  CREATE INDEX IF NOT EXISTS idx_notif_user     ON notifications(user_id, is_read);
`;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Load sql.js, open (or create) the database file, create the schema. */
async function init() {
  if (sqlite) return;
  const SQL = await initSqlJs();

  fs.mkdirSync(env.uploadDir, { recursive: true });

  if (!inMemory && fs.existsSync(env.dbFile)) {
    sqlite = new SQL.Database(fs.readFileSync(env.dbFile));
  } else {
    if (!inMemory) fs.mkdirSync(path.dirname(env.dbFile), { recursive: true });
    sqlite = new SQL.Database();
  }

  applyPragmas();
  sqlite.exec(schema);
  saveNow();
}

function applyPragmas() {
  sqlite.exec('PRAGMA foreign_keys = ON;');
}

/** Write the in-memory database to disk right now. */
function saveNow() {
  if (inMemory || !sqlite) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  const bytes = sqlite.export();          // note: export() re-opens the connection...
  applyPragmas();                         // ...so per-connection pragmas must be re-applied
  fs.writeFileSync(env.dbFile, Buffer.from(bytes));
}

/** Schedule a save shortly; many writes in a row become one disk write. */
function scheduleSave() {
  if (inMemory) return;
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

// Flush to disk when the process is told to stop (Ctrl+C, etc.).
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { saveNow(); process.exit(0); });
}
process.on('exit', () => saveNow());

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

function ensureReady() {
  if (!sqlite) throw new Error('Database not initialised: call `await db.init()` first');
}

/**
 * Normalise call arguments into what sql.js expects:
 *   .get(1, 'x')          -> [1, 'x']            (positional ?)
 *   .get({ me: 1 })       -> { '@me': 1 }        (named @me)
 */
function toBindings(args) {
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const named = {};
    for (const [k, v] of Object.entries(args[0])) named[`@${k}`] = v === undefined ? null : v;
    return named;
  }
  return args.map((v) => (v === undefined ? null : v));
}

function isWrite(sql) {
  return /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i.test(sql);
}

/** Returns a statement-like object. The SQL is compiled on each call and freed afterwards. */
function prepare(sql) {
  return {
    get(...args) {
      ensureReady();
      const stmt = sqlite.prepare(sql);
      try {
        stmt.bind(toBindings(args));
        return stmt.step() ? stmt.getAsObject() : undefined;
      } finally {
        stmt.free();
      }
    },

    all(...args) {
      ensureReady();
      const stmt = sqlite.prepare(sql);
      try {
        stmt.bind(toBindings(args));
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally {
        stmt.free();
      }
    },

    run(...args) {
      ensureReady();
      const stmt = sqlite.prepare(sql);
      try {
        stmt.bind(toBindings(args));
        stmt.step();
      } finally {
        stmt.free();
      }
      const changes = sqlite.getRowsModified();
      const lastInsertRowid = sqlite.exec('SELECT last_insert_rowid()')[0].values[0][0];
      if (isWrite(sql)) scheduleSave();
      return { changes, lastInsertRowid };
    },
  };
}

/** Execute one or more statements without parameters. */
function exec(sql) {
  ensureReady();
  sqlite.exec(sql);
  if (isWrite(sql)) scheduleSave();
}

/**
 * Wrap a function so everything inside runs in a single transaction:
 *   const create = db.transaction((a, b) => { ...; return result; });
 *   create(1, 2);
 */
function transaction(fn) {
  return (...args) => {
    ensureReady();
    sqlite.exec('BEGIN');
    try {
      const result = fn(...args);
      sqlite.exec('COMMIT');
      scheduleSave();
      return result;
    } catch (err) {
      sqlite.exec('ROLLBACK');
      throw err;
    }
  };
}

module.exports = { init, prepare, exec, transaction, saveNow };
