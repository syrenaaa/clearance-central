-- name: find_by_key_hash
SELECT id FROM servers WHERE key_hash = :keyHash AND revoked_at IS NULL;

-- name: upsert
-- new server, or re-key the live one at the same address
INSERT INTO servers (id, key_hash, address, port, created_at)
  VALUES (:id, :keyHash, :address, :port, :now)
  ON CONFLICT (address, port) WHERE revoked_at IS NULL
  DO UPDATE SET key_hash = excluded.key_hash
  RETURNING id;

-- name: revoke
UPDATE servers SET revoked_at = :now WHERE id = :id AND revoked_at IS NULL;

-- name: list
-- admin view, newest first, revoked included
SELECT s.id, s.address, s.port, s.created_at, s.revoked_at,
  (SELECT COUNT(*) FROM reports r WHERE r.server_id = s.id AND r.kind = 'ban') AS bans,
  (SELECT MAX(d.day) FROM stats_days d WHERE d.server_id = s.id) AS last_stats_day
  FROM servers s
  ORDER BY s.created_at DESC, s.id DESC;
