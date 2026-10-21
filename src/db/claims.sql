-- name: drop_expired
DELETE FROM claims WHERE expires_at <= :now;

-- name: insert
-- no-op when a limit is hit
INSERT INTO claims (id_hash, token, address, port, expires_at)
  SELECT :idHash, :token, :address, :port, :expiresAt
  WHERE (SELECT COUNT(*) FROM claims WHERE address = :address AND port = :port) < :perAddress
    AND (SELECT COUNT(*) FROM claims) < :total;

-- name: find
SELECT token, address, port FROM claims WHERE id_hash = :idHash AND expires_at > :now;

-- name: drop
DELETE FROM claims WHERE id_hash = :idHash;
