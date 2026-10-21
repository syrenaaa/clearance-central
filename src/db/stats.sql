-- name: clear_counts
DELETE FROM stats_counts WHERE server_id = :serverId AND day = :day;

-- name: clear_day
DELETE FROM stats_days WHERE server_id = :serverId AND day = :day;

-- name: insert_day
INSERT INTO stats_days
  (server_id, day, plugin_version, enforce, allow_score, flag_score, received_at)
  VALUES (:serverId, :day, :pluginVersion, :enforce, :allowScore, :flagScore, :now);

-- name: insert_count
INSERT INTO stats_counts (server_id, day, metric, key, n)
  VALUES (:serverId, :day, :metric, :key, :n);

-- days with >= :minServers live servers are the only ones summed (no differencing)

-- name: count_servers
WITH live AS (
  SELECT d.server_id, d.day FROM stats_days d JOIN servers s ON s.id = d.server_id
    WHERE s.revoked_at IS NULL AND d.day BETWEEN :from AND :to
), days AS (
  SELECT day FROM live GROUP BY day HAVING COUNT(*) >= :minServers
)
SELECT COUNT(DISTINCT server_id) AS servers, (SELECT COUNT(*) FROM days) AS days
  FROM live WHERE day IN (SELECT day FROM days);

-- name: sum_counts
WITH days AS (
  SELECT d.day FROM stats_days d JOIN servers s ON s.id = d.server_id
    WHERE s.revoked_at IS NULL AND d.day BETWEEN :from AND :to
    GROUP BY d.day HAVING COUNT(*) >= :minServers
)
SELECT c.metric, c.key, SUM(c.n) AS n
  FROM stats_counts c JOIN servers s ON s.id = c.server_id
  WHERE s.revoked_at IS NULL AND c.day IN (SELECT day FROM days)
  GROUP BY c.metric, c.key;
