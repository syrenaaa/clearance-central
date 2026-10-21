-- name: insert_ban
INSERT INTO reports
  (id, server_id, kind, client_ref, user_id, severity, category, at, expires_at, received_at)
  VALUES
  (:id, :serverId, 'ban', :clientRef, :userId, :severity, :category, :at, :expiresAt, :now)
  ON CONFLICT (server_id, kind, client_ref) DO NOTHING;

-- name: insert_pardon
-- only for a ban this same server reported
INSERT INTO reports (id, server_id, kind, client_ref, target_id, at, received_at)
  SELECT :id, :serverId, 'pardon', :clientRef, :reportId, :at, :now
  WHERE EXISTS (
    SELECT 1 FROM reports WHERE id = :reportId AND server_id = :serverId AND kind = 'ban'
  )
  ON CONFLICT (server_id, kind, client_ref) DO NOTHING;

-- name: by_client_ref
SELECT id, kind, received_at FROM reports
  WHERE server_id = :serverId AND kind = :kind AND client_ref = :clientRef;

-- name: active_bans
-- running (unexpired, unpardoned) bans from live servers since :since, newest first
SELECT r.server_id, r.at, r.expires_at, r.severity, r.category
  FROM reports r JOIN servers s ON s.id = r.server_id
  WHERE r.kind = 'ban' AND r.user_id = :userId AND r.at >= :since
    AND (r.expires_at IS NULL OR r.expires_at > :now)
    AND s.revoked_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports p WHERE p.kind = 'pardon' AND p.target_id = r.id
    )
  ORDER BY r.at DESC
  LIMIT 1000;
