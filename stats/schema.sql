-- nimbus-stats D1 schema. Daily counts only - no content, see
-- ../src/lib/telemetry/events.ts.
CREATE TABLE IF NOT EXISTS tallies (
  day TEXT NOT NULL,      -- YYYY-MM-DD, UTC
  install TEXT NOT NULL,  -- random per install, not the account
  ver TEXT NOT NULL,
  os TEXT NOT NULL,
  ev TEXT NOT NULL,
  props TEXT NOT NULL,    -- JSON of fixed words from events.ts
  n INTEGER NOT NULL,
  PRIMARY KEY (day, install, ev, props)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS tallies_day_ev ON tallies (day, ev);
CREATE TABLE IF NOT EXISTS daily (
  day TEXT PRIMARY KEY,
  writes INTEGER NOT NULL
);
