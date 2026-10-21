-- name: drop_pardons
-- pardons of bans about to go
DELETE FROM reports WHERE kind = 'pardon' AND target_id IN (
  SELECT id FROM reports WHERE kind = 'ban' AND at < :before
);

-- name: drop_bans
DELETE FROM reports WHERE kind = 'ban' AND at < :before;

-- name: drop_claims
DELETE FROM claims WHERE expires_at <= :now;
