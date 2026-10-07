-- DFW Tee-Times initial schema
-- All tables use INTEGER for timestamps (epoch ms) unless noted.
-- Strings are TEXT. Prices are stored as INTEGER cents.

PRAGMA foreign_keys = ON;

-- ---------- catalog ----------

CREATE TABLE IF NOT EXISTS courses (
  id                    TEXT PRIMARY KEY,           -- canonical id (e.g. "tpc_craig_ranch")
  name                  TEXT NOT NULL,
  city                  TEXT NOT NULL,
  state                 TEXT NOT NULL DEFAULT 'TX',
  lat                   REAL NOT NULL,
  lon                   REAL NOT NULL,
  default_provider      TEXT NOT NULL,              -- see PROVIDERS in src/types.ts
  booking_window_days   INTEGER NOT NULL DEFAULT 7,
  booking_opens_at_local TEXT NOT NULL DEFAULT '06:00', -- course-local HH:MM
  timezone              TEXT NOT NULL DEFAULT 'America/Chicago',
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_courses_city ON courses(city);
CREATE INDEX IF NOT EXISTS idx_courses_provider ON courses(default_provider);

-- Same course appearing on multiple providers
CREATE TABLE IF NOT EXISTS course_providers (
  course_id          TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  provider           TEXT NOT NULL,
  provider_course_id TEXT NOT NULL,
  base_url           TEXT,
  created_at         INTEGER NOT NULL,
  PRIMARY KEY (course_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_course_providers_lookup
  ON course_providers(provider, provider_course_id);

-- Aliases used for fuzzy dedup when merging sources (e.g. "TPC Craig" vs "TPC Craig Ranch")
CREATE TABLE IF NOT EXISTS course_aliases (
  alias      TEXT NOT NULL,
  course_id  TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  source     TEXT,                                -- e.g. 'golfnow', 'seed'
  PRIMARY KEY (alias, source)
);

-- ---------- vault ----------

CREATE TABLE IF NOT EXISTS vault_entries (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL DEFAULT 'default',   -- single-user for now
  provider      TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('cookies','password')),
  ciphertext    TEXT NOT NULL,                    -- base64 AES-GCM ciphertext
  iv            TEXT NOT NULL,                    -- base64 IV
  expires_at    INTEGER,                          -- epoch ms, NULL = unknown
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_user_provider
  ON vault_entries(user_id, provider);

-- ---------- scheduled bookings ----------

CREATE TABLE IF NOT EXISTS scheduled_bookings (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL DEFAULT 'default',
  provider            TEXT NOT NULL,
  provider_course_id  TEXT NOT NULL,
  course_id           TEXT NOT NULL,
  date                TEXT NOT NULL,              -- YYYY-MM-DD (course-local)
  time_window_start   TEXT NOT NULL,              -- HH:MM
  time_window_end     TEXT NOT NULL,              -- HH:MM
  players             INTEGER NOT NULL CHECK (players BETWEEN 1 AND 4),
  max_price_cents     INTEGER,                    -- NULL = no ceiling
  book_at             INTEGER NOT NULL,            -- epoch ms UTC
  status              TEXT NOT NULL CHECK (status IN
                       ('pending','due','booking','booked','failed','cancelled')),
  attempts            INTEGER NOT NULL DEFAULT 0,
  last_error          TEXT,
  confirmation_code   TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_due
  ON scheduled_bookings(status, book_at)
  WHERE status IN ('pending','due');

CREATE INDEX IF NOT EXISTS idx_scheduled_user
  ON scheduled_bookings(user_id, status);

-- ---------- booking attempts (audit log) ----------

CREATE TABLE IF NOT EXISTS booking_attempts (
  id                    TEXT PRIMARY KEY,
  scheduled_booking_id  TEXT NOT NULL REFERENCES scheduled_bookings(id) ON DELETE CASCADE,
  attempted_at          INTEGER NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('booked','failed','expired')),
  confirmation_code     TEXT,
  provider_slot_id      TEXT,
  error_message         TEXT
);

CREATE INDEX IF NOT EXISTS idx_attempts_booking
  ON booking_attempts(scheduled_booking_id, attempted_at);

-- ---------- scrape errors (debugging) ----------

CREATE TABLE IF NOT EXISTS scrape_errors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  provider    TEXT NOT NULL,
  course_id   TEXT NOT NULL,
  date        TEXT NOT NULL,
  message     TEXT NOT NULL,
  occurred_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scrape_errors_recent
  ON scrape_errors(occurred_at DESC);

-- ---------- notifications (audit) ----------

CREATE TABLE IF NOT EXISTS notifications (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL DEFAULT 'default',
  scheduled_booking_id  TEXT REFERENCES scheduled_bookings(id) ON DELETE SET NULL,
  channel               TEXT NOT NULL CHECK (channel IN ('email','sms')),
  sent_at               INTEGER NOT NULL,
  subject               TEXT NOT NULL,
  body                  TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error_message         TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_recent
  ON notifications(sent_at DESC);