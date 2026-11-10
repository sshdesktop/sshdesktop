use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use crate::AppState;

fn default_port() -> u16 { 22 }
fn default_username() -> String { "root".to_string() }

fn credential_entry(id: &str) -> Result<keyring::Entry, String> {
    if id.trim().is_empty() {
        return Err("Connection ID is required for secure credential storage".into());
    }
    keyring::Entry::new("com.sshdesktop.app", &format!("ssh-connection:{}", id))
        .map_err(|e| format!("Could not access the operating-system credential store: {}", e))
}

fn store_connection_password(id: &str, password: &str) -> Result<(), String> {
    let entry = credential_entry(id)?;
    entry.set_password(password)
        .map_err(|e| format!("Could not save SSH password to the operating-system credential store: {}", e))
}

fn load_connection_password(id: &str) -> Option<String> {
    credential_entry(id).ok()?.get_password().ok()
}

fn delete_connection_password(id: &str) {
    if let Ok(entry) = credential_entry(id) {
        let _ = entry.delete_credential();
    }
}

fn hydrate_connection_passwords(list: &mut [SavedConnection]) -> bool {
    let mut migrated = false;
    for connection in list {
        if let Some(password) = connection.password.as_ref() {
            if !password.is_empty() && store_connection_password(&connection.id, password).is_ok() {
                migrated = true;
            }
        } else {
            connection.password = load_connection_password(&connection.id);
        }
    }
    migrated
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedConnection {
    pub id: String,
    #[serde(default)]
    pub created_at: i64,
    #[serde(default)]
    pub last_connected_at: Option<i64>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_username")]
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub auth_method: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

fn get_storage_path() -> PathBuf {
    let mut dir = directories::BaseDirs::new()
        .map(|b| b.home_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    dir.push(".sshdesktop");
    let _ = fs::create_dir_all(&dir);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    dir.push("connections.json");
    dir
}

pub fn read_connections_from_disk() -> Vec<SavedConnection> {
    let path = get_storage_path();
    #[cfg(unix)]
    if path.exists() {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(mut list) = serde_json::from_str::<Vec<SavedConnection>>(&content) {
            let migrated_legacy_password = hydrate_connection_passwords(&mut list);
            if migrated_legacy_password {
                // write_connections_to_disk serializes a sanitized copy, removing
                // legacy plaintext password fields only after keyring storage succeeds.
                let _ = write_connections_to_disk(&list);
            }
            return list;
        }
    }
    // Fallback migration from legacy ~/.clouddesk/connections.json or AppData
    if let Some(base) = directories::BaseDirs::new() {
        let legacy_home = base.home_dir().join(".clouddesk").join("connections.json");
        if let Ok(content) = fs::read_to_string(legacy_home) {
            if let Ok(mut list) = serde_json::from_str::<Vec<SavedConnection>>(&content) {
                hydrate_connection_passwords(&mut list);
                // Only copy legacy data through the sanitizer. If the OS keyring
                // is unavailable, do not create a new plaintext password file.
                let _ = write_connections_to_disk(&list);
                return list;
            }
        }
        let legacy_appdata = base.data_local_dir().join("clouddesk").join("connections.json");
        if let Ok(content) = fs::read_to_string(legacy_appdata) {
            if let Ok(mut list) = serde_json::from_str::<Vec<SavedConnection>>(&content) {
                hydrate_connection_passwords(&mut list);
                let _ = write_connections_to_disk(&list);
                return list;
            }
        }
    }
    vec![]
}

pub fn write_connections_to_disk(list: &[SavedConnection]) -> Result<(), String> {
    let path = get_storage_path();
    let mut sanitized = list.to_vec();
    for connection in &mut sanitized {
        if let Some(password) = connection.password.as_ref() {
            if !password.is_empty() {
                store_connection_password(&connection.id, password)?;
            }
        }
        connection.password = None;
    }
    let json = serde_json::to_string_pretty(&sanitized).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut options = fs::OpenOptions::new();
        options.write(true).create(true).truncate(true).mode(0o600);
        use std::io::Write;
        let mut file = options.open(&path).map_err(|e| e.to_string())?;
        file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&path, json).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn sanitize_connection_secrets(connection: &mut SavedConnection) {
    if let Some(ref key_str) = connection.private_key_path {
        let trimmed = key_str.trim();
        if trimmed.contains("PRIVATE KEY") || trimmed.contains("PuTTY-User-Key-File") || trimmed.lines().count() > 1 {
            let conn_id = if connection.id.is_empty() { "default" } else { &connection.id };
            if let Some(saved_path) = crate::ssh::connection::ensure_key_file(conn_id, trimmed) {
                connection.private_key_path = Some(saved_path);
            }
        }
    }
}

pub fn save_or_update_connection_on_disk(mut connection: SavedConnection) -> Result<String, String> {
    sanitize_connection_secrets(&mut connection);
    let mut list = read_connections_from_disk();
    if connection.id.is_empty() {
        connection.id = uuid::Uuid::new_v4().to_string();
    }
    let id = connection.id.clone();
    match connection.password.as_deref() {
        Some(password) if !password.is_empty() => store_connection_password(&id, password)?,
        _ => delete_connection_password(&id),
    }
    list.retain(|c| c.id != id);
    list.push(connection);
    write_connections_to_disk(&list)?;
    Ok(id)
}

pub fn get_saved_connection_by_id(id: &str) -> Option<SavedConnection> {
    let list = read_connections_from_disk();
    if id == "default" || id.is_empty() {
        return list.first().cloned();
    }
    list.into_iter().find(|c| c.id == id)
}

#[tauri::command]
pub async fn store_save_connection(_state: tauri::State<'_, AppState>, connection: SavedConnection) -> Result<String, String> {
    save_or_update_connection_on_disk(connection)
}

#[tauri::command]
pub async fn store_list_connections(_state: tauri::State<'_, AppState>) -> Result<Vec<SavedConnection>, String> {
    // Return the actual saved connections; empty list if user has none yet.
    let mut list = read_connections_from_disk();
    for conn in &mut list {
        sanitize_connection_secrets(conn);
    }
    Ok(list)
}

#[tauri::command]
pub async fn store_delete_connection(_state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    let mut list = read_connections_from_disk();
    list.retain(|c| c.id != id);
    write_connections_to_disk(&list)?;
    delete_connection_password(&id);
    Ok(())
}

#[tauri::command]
pub async fn store_update_connection(_state: tauri::State<'_, AppState>, mut connection: SavedConnection) -> Result<(), String> {
    sanitize_connection_secrets(&mut connection);
    let mut list = read_connections_from_disk();
    match connection.password.as_deref() {
        Some(password) if !password.is_empty() => store_connection_password(&connection.id, password)?,
        _ => delete_connection_password(&connection.id),
    }
    if let Some(pos) = list.iter().position(|c| c.id == connection.id) {
        list[pos] = connection;
    } else {
        list.push(connection);
    }
    write_connections_to_disk(&list)
}
