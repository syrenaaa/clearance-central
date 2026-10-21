-- one statement per section, applied once in name order. never edit an applied one

-- name: m001_ban_expiry
-- null = permanent (also every ban from before durations)
ALTER TABLE reports ADD COLUMN expires_at INTEGER;
