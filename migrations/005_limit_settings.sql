CREATE TABLE limit_settings (
 key TEXT PRIMARY KEY,
 value INTEGER NOT NULL CHECK(typeof(value)='integer' AND value>0)
);
-- Expiry is fixed when an upload is accepted, so changing policy cannot race cleanup.
CREATE TABLE upload_expirations (
 upload_id TEXT PRIMARY KEY REFERENCES uploads(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL
);
