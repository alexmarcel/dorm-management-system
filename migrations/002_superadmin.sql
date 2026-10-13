CREATE TABLE users_new (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','warden','superadmin')),
 student_id TEXT UNIQUE COLLATE NOCASE, room_id TEXT REFERENCES rooms(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), must_change INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, phone TEXT, email TEXT, archived_at TEXT,
 CHECK(archived_at IS NULL OR active=0)
);
INSERT INTO users_new(id,name,username,password_hash,role,student_id,room_id,active,must_change,created_at)
SELECT id,name,username,password_hash,role,student_id,room_id,active,must_change,created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE UNIQUE INDEX single_superadmin ON users(role) WHERE role='superadmin';
CREATE TABLE admin_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),action TEXT NOT NULL,target_id TEXT,details TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE student_imports(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES users(id),fingerprint TEXT NOT NULL,student_count INTEGER NOT NULL,created_at TEXT NOT NULL);
