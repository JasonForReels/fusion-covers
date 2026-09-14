-- One row per sync token. Everything except id/version/timestamps is opaque ciphertext.
-- Run this on every shard database.
CREATE TABLE IF NOT EXISTS vaults (
  id           TEXT PRIMARY KEY,     -- HKDF-derived id, reveals nothing about the token
  write_hash   TEXT NOT NULL,        -- SHA-256 of the client-derived write secret
  version      INTEGER NOT NULL,
  data         TEXT NOT NULL,        -- base64url(iv || AES-GCM(gzip(json)))
  updated_at   INTEGER NOT NULL,     -- last write
  accessed_at  INTEGER NOT NULL      -- last read or write (refreshed at most once a day)
);
CREATE INDEX IF NOT EXISTS vaults_accessed_at ON vaults (accessed_at);

-- "Host with Covers": a published config.json + cover images, served publicly for Fusion.
CREATE TABLE IF NOT EXISTS hosts (
  id           TEXT PRIMARY KEY,     -- random 32-hex id (part of the public URL)
  write_hash   TEXT NOT NULL,        -- SHA-256 of the client's random write secret
  bytes        INTEGER NOT NULL,     -- total stored size, for the per-host cap
  updated_at   INTEGER NOT NULL,
  accessed_at  INTEGER NOT NULL      -- refreshed (at most daily) when Fusion reads config.json
);
CREATE INDEX IF NOT EXISTS hosts_accessed_at ON hosts (accessed_at);
CREATE TABLE IF NOT EXISTS host_files (
  host_id  TEXT NOT NULL,
  name     TEXT NOT NULL,            -- "config.json" or "covers/<file>"
  type     TEXT NOT NULL,
  hash     TEXT NOT NULL,            -- SHA-256 of the content (lets clients skip unchanged uploads)
  size     INTEGER NOT NULL,
  data     BLOB NOT NULL,
  PRIMARY KEY (host_id, name)
);
