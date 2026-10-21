-- tables + indexes, created idempotently

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  port INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

-- one live listing per address; re-verifying rotates its key
CREATE UNIQUE INDEX IF NOT EXISTS servers_live_address
  ON servers (address, port) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS claims (
  id_hash TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  address TEXT NOT NULL,
  port INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS claims_address ON claims (address, port);

CREATE TABLE IF NOT EXISTS stats_days (
  server_id TEXT NOT NULL,
  day TEXT NOT NULL,
  plugin_version TEXT NOT NULL,
  enforce INTEGER NOT NULL,
  allow_score INTEGER NOT NULL,
  flag_score INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, day)
);

-- one row per non-zero counter, so network sums are one GROUP BY
CREATE TABLE IF NOT EXISTS stats_counts (
  server_id TEXT NOT NULL,
  day TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('check', 'score', 'ban')),
  key TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (server_id, day, metric, key)
);

CREATE INDEX IF NOT EXISTS stats_counts_day ON stats_counts (day);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ban', 'pardon')),
  client_ref TEXT NOT NULL,
  user_id TEXT,
  severity INTEGER,
  category TEXT,
  target_id TEXT,
  at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  UNIQUE (server_id, kind, client_ref),
  CHECK (
    (kind = 'ban' AND user_id IS NOT NULL AND severity IS NOT NULL
      AND category IS NOT NULL AND target_id IS NULL)
    OR (kind = 'pardon' AND target_id IS NOT NULL AND user_id IS NULL
      AND severity IS NULL AND category IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS reports_ban_user
  ON reports (user_id, at) WHERE kind = 'ban';

CREATE INDEX IF NOT EXISTS reports_pardon_target
  ON reports (target_id) WHERE kind = 'pardon';

-- applied migrations.sql sections, see schema.ts
CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY
);
