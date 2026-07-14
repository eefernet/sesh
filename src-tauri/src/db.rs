use crate::models::{AppSettings, AuthKind, MachineDraft, MachineProfile, ThemeDefinition};
use rusqlite::{Connection, OptionalExtension, params};
use std::{path::Path, sync::Mutex};

pub struct Database(pub Mutex<Connection>);

impl Database {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
          CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,host TEXT NOT NULL,port INTEGER NOT NULL,username TEXT NOT NULL,auth_kind TEXT NOT NULL,private_key_path TEXT,has_saved_password INTEGER NOT NULL DEFAULT 0,has_saved_passphrase INTEGER NOT NULL DEFAULT 0,theme_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_connected_at TEXT);
          CREATE TABLE IF NOT EXISTS themes(id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL);"
        ).map_err(|e| e.to_string())?;
        Ok(Self(Mutex::new(conn)))
    }
    pub fn profiles(&self) -> Result<Vec<MachineProfile>, String> {
        let conn = self.0.lock().map_err(|_| "Database lock failed")?;
        let mut stmt=conn.prepare("SELECT id,name,host,port,username,auth_kind,private_key_path,has_saved_password,has_saved_passphrase,theme_id,created_at,updated_at,last_connected_at FROM profiles ORDER BY COALESCE(last_connected_at,updated_at) DESC").map_err(|e|e.to_string())?;
        stmt.query_map([], row_profile)
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub fn profile(&self, id: &str) -> Result<Option<MachineProfile>, String> {
        let conn = self.0.lock().map_err(|_| "Database lock failed")?;
        conn.query_row("SELECT id,name,host,port,username,auth_kind,private_key_path,has_saved_password,has_saved_passphrase,theme_id,created_at,updated_at,last_connected_at FROM profiles WHERE id=?",[id],row_profile).optional().map_err(|e|e.to_string())
    }
    pub fn save_profile(&self, d: &MachineDraft) -> Result<MachineProfile, String> {
        let id =
            d.id.clone()
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let now = chrono::Utc::now().to_rfc3339();
        let old = self.profile(&id)?;
        let created = old
            .as_ref()
            .map(|x| x.created_at.clone())
            .unwrap_or_else(|| now.clone());
        let auth = if d.auth_kind == AuthKind::Password {
            "password"
        } else {
            "privateKey"
        };
        let conn = self.0.lock().map_err(|_| "Database lock failed")?;
        conn.execute("INSERT INTO profiles(id,name,host,port,username,auth_kind,private_key_path,has_saved_password,has_saved_passphrase,theme_id,created_at,updated_at,last_connected_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,username=excluded.username,auth_kind=excluded.auth_kind,private_key_path=excluded.private_key_path,has_saved_password=excluded.has_saved_password,has_saved_passphrase=excluded.has_saved_passphrase,theme_id=excluded.theme_id,updated_at=excluded.updated_at",params![id,d.name.trim(),d.host.trim(),d.port,d.username.trim(),auth,d.private_key_path,d.save_password,d.save_passphrase,d.theme_id,created,now,old.as_ref().and_then(|x|x.last_connected_at.clone())]).map_err(|e|e.to_string())?;
        drop(conn);
        self.profile(&id)?
            .ok_or_else(|| "Saved profile could not be loaded".into())
    }
    pub fn delete_profile(&self, id: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "Database lock failed")?
            .execute("DELETE FROM profiles WHERE id=?", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn touch_profile(&self, id: &str) {
        if let Ok(conn) = self.0.lock() {
            let _ = conn.execute(
                "UPDATE profiles SET last_connected_at=? WHERE id=?",
                params![chrono::Utc::now().to_rfc3339(), id],
            );
        }
    }
    pub fn themes(&self) -> Result<Vec<ThemeDefinition>, String> {
        let conn = self.0.lock().map_err(|_| "Database lock failed")?;
        let mut stmt = conn
            .prepare("SELECT payload FROM themes ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;
        stmt.query_map([], |r| {
            let s: String = r.get(0)?;
            serde_json::from_str(&s).map_err(|e| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(e),
                )
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
    }
    pub fn save_theme(&self, t: &ThemeDefinition) -> Result<(), String> {
        let payload = serde_json::to_string(t).map_err(|e| e.to_string())?;
        self.0.lock().map_err(|_|"Database lock failed")?.execute("INSERT INTO themes(id,payload,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",params![t.id,payload,chrono::Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn delete_theme(&self, id: &str) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "Database lock failed")?
            .execute("DELETE FROM themes WHERE id=?", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn settings(&self) -> Result<AppSettings, String> {
        let conn = self.0.lock().map_err(|_| "Database lock failed")?;
        let payload: Option<String> = conn
            .query_row("SELECT payload FROM settings WHERE key='app'", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(payload
            .and_then(|value| serde_json::from_str(&value).ok())
            .unwrap_or_default())
    }
    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let payload = serde_json::to_string(settings).map_err(|e| e.to_string())?;
        self.0.lock().map_err(|_| "Database lock failed")?.execute(
            "INSERT INTO settings(key,payload,updated_at) VALUES('app',?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at",
            params![payload, chrono::Utc::now().to_rfc3339()],
        ).map_err(|e| e.to_string())?;
        Ok(())
    }
}
fn row_profile(r: &rusqlite::Row) -> rusqlite::Result<MachineProfile> {
    let auth: String = r.get(5)?;
    Ok(MachineProfile {
        id: r.get(0)?,
        name: r.get(1)?,
        host: r.get(2)?,
        port: r.get(3)?,
        username: r.get(4)?,
        auth_kind: if auth == "privateKey" {
            AuthKind::PrivateKey
        } else {
            AuthKind::Password
        },
        private_key_path: r.get(6)?,
        has_saved_password: r.get(7)?,
        has_saved_passphrase: r.get(8)?,
        theme_id: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
        last_connected_at: r.get(12)?,
    })
}

#[cfg(test)]
mod tests {
    use super::Database;
    use crate::models::AppSettings;
    use rusqlite::Connection;
    use std::sync::Mutex;

    #[test]
    fn application_settings_round_trip() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE settings(key TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at TEXT NOT NULL);").unwrap();
        let database = Database(Mutex::new(connection));
        let mut settings = AppSettings::default();
        settings.default_port = 2222;
        database.save_settings(&settings).unwrap();
        assert_eq!(database.settings().unwrap(), settings);
    }
}
