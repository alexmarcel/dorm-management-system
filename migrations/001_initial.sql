CREATE TABLE users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('student','warden')),
 student_id TEXT UNIQUE COLLATE NOCASE, room_id TEXT REFERENCES rooms(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), must_change INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL
);
CREATE TABLE blocks(id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, code TEXT NOT NULL UNIQUE COLLATE NOCASE, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE levels(id TEXT PRIMARY KEY, block_id TEXT NOT NULL REFERENCES blocks(id), name TEXT NOT NULL COLLATE NOCASE, code TEXT NOT NULL COLLATE NOCASE, sort_order INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, UNIQUE(block_id,name), UNIQUE(block_id,code));
CREATE TABLE rooms(id TEXT PRIMARY KEY, level_id TEXT NOT NULL REFERENCES levels(id), name TEXT NOT NULL COLLATE NOCASE, archived INTEGER NOT NULL DEFAULT 0, UNIQUE(level_id,name));
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE login_limits(key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE TABLE report_counters(level_id TEXT PRIMARY KEY REFERENCES levels(id), value INTEGER NOT NULL DEFAULT 0);
CREATE TABLE reports (
 id TEXT PRIMARY KEY, report_number TEXT NOT NULL UNIQUE, creator_id TEXT NOT NULL REFERENCES users(id),
 room_id TEXT NOT NULL REFERENCES rooms(id), title TEXT NOT NULL, description TEXT NOT NULL,
 category TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('Submitted','Acknowledged','In progress','Closed')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT, closed_by TEXT REFERENCES users(id), snapshot TEXT,
 submission_key TEXT NOT NULL, UNIQUE(creator_id,submission_key)
);
CREATE INDEX reports_creator ON reports(creator_id,created_at);
CREATE INDEX reports_room ON reports(room_id,created_at);
CREATE INDEX reports_status ON reports(status,created_at);
CREATE TABLE events (
 id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, report_id TEXT NOT NULL REFERENCES reports(id), actor_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL, message TEXT NOT NULL, previous_status TEXT, new_status TEXT, created_at TEXT NOT NULL,
 submission_key TEXT NOT NULL, UNIQUE(actor_id,submission_key)
);
CREATE INDEX events_report ON events(report_id,seq);
CREATE TABLE uploads (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), object_key TEXT NOT NULL UNIQUE,
 bytes INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE attachments(id TEXT PRIMARY KEY REFERENCES uploads(id), event_id TEXT NOT NULL REFERENCES events(id));
CREATE INDEX attachments_event ON attachments(event_id);
CREATE TABLE notifications(id TEXT PRIMARY KEY, recipient_id TEXT NOT NULL REFERENCES users(id), event_id TEXT NOT NULL REFERENCES events(id), read_at TEXT, created_at TEXT NOT NULL, UNIQUE(recipient_id,event_id));
CREATE INDEX notifications_recipient ON notifications(recipient_id,read_at,created_at);

CREATE TRIGGER closed_report_update BEFORE UPDATE ON reports WHEN OLD.status='Closed' BEGIN SELECT RAISE(ABORT,'Closed reports are immutable'); END;
CREATE TRIGGER closed_report_delete BEFORE DELETE ON reports WHEN OLD.status='Closed' BEGIN SELECT RAISE(ABORT,'Closed reports are immutable'); END;
CREATE TRIGGER report_identity BEFORE UPDATE ON reports WHEN NEW.id IS NOT OLD.id OR NEW.report_number IS NOT OLD.report_number OR NEW.creator_id IS NOT OLD.creator_id OR NEW.room_id IS NOT OLD.room_id BEGIN SELECT RAISE(ABORT,'Report identity is immutable'); END;
CREATE TRIGGER closed_event_insert BEFORE INSERT ON events WHEN (SELECT status FROM reports WHERE id=NEW.report_id)='Closed' BEGIN SELECT RAISE(ABORT,'Closed reports are immutable'); END;
CREATE TRIGGER event_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Timeline is append only'); END;
CREATE TRIGGER event_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Timeline is append only'); END;
CREATE TRIGGER closed_attachment_insert BEFORE INSERT ON attachments WHEN (SELECT r.status FROM events e JOIN reports r ON r.id=e.report_id WHERE e.id=NEW.event_id)='Closed' BEGIN SELECT RAISE(ABORT,'Closed reports are immutable'); END;
CREATE TRIGGER attachment_update BEFORE UPDATE ON attachments BEGIN SELECT RAISE(ABORT,'Attachments are immutable'); END;
CREATE TRIGGER attachment_delete BEFORE DELETE ON attachments BEGIN SELECT RAISE(ABORT,'Attachments are immutable'); END;
CREATE TRIGGER upload_update BEFORE UPDATE ON uploads WHEN EXISTS(SELECT 1 FROM attachments WHERE id=OLD.id) BEGIN SELECT RAISE(ABORT,'Attached photos are immutable'); END;
CREATE TRIGGER upload_delete BEFORE DELETE ON uploads WHEN EXISTS(SELECT 1 FROM attachments WHERE id=OLD.id) BEGIN SELECT RAISE(ABORT,'Attached photos are immutable'); END;
