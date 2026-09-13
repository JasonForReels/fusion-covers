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
