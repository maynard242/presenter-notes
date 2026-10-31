-- Additive only. Run through scripts/harden.mjs; never drizzle push --force.
CREATE TABLE IF NOT EXISTS resource_guards (
  user_id text PRIMARY KEY,
  request_window timestamp with time zone NOT NULL DEFAULT date_trunc('minute', statement_timestamp()),
  request_count bigint NOT NULL DEFAULT 0,
  write_window timestamp with time zone NOT NULL DEFAULT date_trunc('minute', statement_timestamp()),
  write_count bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notes_owner_list_idx
  ON notes (user_id, event_date DESC, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notes_owner_updated_idx
  ON notes (user_id, updated_at DESC, id DESC);
