'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'duracell.sqlite');

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  survey_json TEXT NOT NULL,
  status_json TEXT NOT NULL,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  slide_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  participant_hash TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  answers_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (session_id, section_id, participant_hash)
);
CREATE INDEX IF NOT EXISTS idx_sub_session ON submissions(session_id, section_id);
CREATE TABLE IF NOT EXISTS moderation (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  display_text TEXT,
  excerpt INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (submission_id, item_key)
);
CREATE TABLE IF NOT EXISTS analyses (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  method TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  summary TEXT,
  error TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  stale INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT,
  PRIMARY KEY (session_id, question_id)
);
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'other',
  response_ids_json TEXT NOT NULL DEFAULT '[]',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_themes_q ON themes(session_id, question_id);
CREATE TABLE IF NOT EXISTS notes (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL,
  observations TEXT NOT NULL DEFAULT '',
  decisions TEXT NOT NULL DEFAULT '',
  followups TEXT NOT NULL DEFAULT '',
  actions_json TEXT NOT NULL DEFAULT '[]',
  show_on_slide INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (session_id, section_id)
);
CREATE TABLE IF NOT EXISTS host_tokens (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, tx, DB_PATH, DATA_DIR };
