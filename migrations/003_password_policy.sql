CREATE TABLE app_settings (key TEXT PRIMARY KEY,value INTEGER NOT NULL CHECK(value IN (0,1)));
INSERT INTO app_settings(key,value) VALUES ('require_initial_password_change',1);
