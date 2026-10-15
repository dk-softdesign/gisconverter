import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

// The app's own database (members and sessions). Lives next to the app by
// default; in Docker it sits on a volume so it survives redeploys.
const DATABASE_PATH = resolve(process.env.DATABASE_PATH ?? "data/gisconverter.db");

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  -- NULL until the member has accepted their invite and chosen a password.
  password_hash TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  -- SHA-256 of the current one-time invite / password-reset token.
  invite_token_hash TEXT UNIQUE,
  invite_expires_at INTEGER,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  -- SHA-256 of the cookie token, so a leaked database can't be used to log in.
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
`;

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
  const opened = new DatabaseSync(DATABASE_PATH);
  // WAL + a busy timeout let a second process (e.g. a start-first redeploy)
  // briefly share the file without "database is locked" errors.
  opened.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  opened.exec(MIGRATIONS);
  db = opened;
  return db;
}

// Runs `fn` in a write transaction; BEGIN IMMEDIATE takes the write lock up
// front so check-then-write sequences (e.g. "no users yet → create admin")
// can't race.
export function transaction<T>(fn: (db: DatabaseSync) => T): T {
  const database = getDb();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
