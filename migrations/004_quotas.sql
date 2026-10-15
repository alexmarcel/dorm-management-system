CREATE TABLE usage_limits (
 user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL,
 reset_at INTEGER NOT NULL, used INTEGER NOT NULL,
 PRIMARY KEY(user_id,kind)
);
CREATE INDEX uploads_owner ON uploads(owner_id);
CREATE TABLE password_work(id TEXT PRIMARY KEY, pid INTEGER NOT NULL);
