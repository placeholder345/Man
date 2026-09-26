let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  console.error(
    `ManTube needs Node.js 22.13 or newer (it uses the built-in node:sqlite module). ` +
      `You are running ${process.version}.`
  );
  process.exit(1);
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    name        TEXT,
    about       TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS videos (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    category      TEXT NOT NULL,
    file          TEXT NOT NULL,
    original_name TEXT,
    size          INTEGER NOT NULL,
    duration      REAL,
    width         INTEGER,
    height        INTEGER,
    thumb         TEXT,
    views         INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS videos_by_user    ON videos(user_id, created_at);
  CREATE INDEX IF NOT EXISTS videos_by_created ON videos(created_at);

  CREATE TABLE IF NOT EXISTS ratings (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    value      INTEGER NOT NULL CHECK (value IN (-1, 1)),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, video_id)
  );
  CREATE INDEX IF NOT EXISTS ratings_by_video ON ratings(video_id, value);

  CREATE TABLE IF NOT EXISTS comments (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS comments_by_video ON comments(video_id, created_at);

  CREATE TABLE IF NOT EXISTS subscriptions (
    subscriber_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (subscriber_id, channel_id)
  );
  CREATE INDEX IF NOT EXISTS subscriptions_by_channel ON subscriptions(channel_id);

  -- One row per (viewer, video): drives view counting and watch history.
  CREATE TABLE IF NOT EXISTS watches (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id   TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    last_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, video_id)
  );
  CREATE INDEX IF NOT EXISTS watches_by_user ON watches(user_id, last_at);
`;

export function openDatabase(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  db.exec(SCHEMA);
  return db;
}

/** Run `fn` inside a transaction, rolling back if it throws. */
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
