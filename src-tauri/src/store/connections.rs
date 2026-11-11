struct FileLockGuard(std::path::PathBuf);
impl Drop for FileLockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn acquire_cross_process_lock(parent: &std::path::Path) -> Result<FileLockGuard, String> {
    let lock_path = parent.join(".connections.lock");
    let start = std::time::Instant::now();
    loop {
        match fs::OpenOptions::new().write(true).create_new(true).open(&lock_path) {
            Ok(_) => return Ok(FileLockGuard(lock_path)),
            Err(_) => {
                // Break stale locks left by killed processes (> 10s old)
                if let Ok(meta) = fs::metadata(&lock_path) {
                    if let Ok(elapsed) = meta.modified().and_then(|m| m.elapsed().map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))) {
                        if elapsed.as_secs() > 10 {
                            let _ = fs::remove_file(&lock_path);
                        }
                    }
                }
                if start.elapsed().as_millis() > 3000 {
                    return Err("Timed out acquiring cross-process connection storage lock.".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }
}

fn write_connections_file(path: &std::path::Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Connection storage path has no parent directory.".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("Failed to create connection storage directory: {}", e))?;
    let _lock = acquire_cross_process_lock(parent)?;
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let temp = parent.join(format!(".connections-{}.tmp", uuid::Uuid::new_v4().simple()));
        let result = (|| -> Result<(), String> {
            let mut file = fs::OpenOptions::new().write(true).create_new(true).mode(0o600)
                .open(&temp).map_err(|e| format!("Failed to create temporary connection file: {}", e))?;
            file.write_all(content.as_bytes()).map_err(|e| format!("Failed to write connections: {}", e))?;
            file.sync_all().map_err(|e| format!("Failed to flush connections: {}", e))?;
            fs::rename(&temp, path).map_err(|e| format!("Failed to replace connections file: {}", e))?;
            fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("Failed to secure connections file: {}", e))?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
    #[cfg(not(unix))]
    {
        use std::io::Write;
        let temp = parent.join(format!(".connections-{}.tmp", uuid::Uuid::new_v4().simple()));
        let result = (|| -> Result<(), String> {
            let mut file = fs::OpenOptions::new().write(true).create_new(true)
                .open(&temp).map_err(|e| format!("Failed to create temporary connection file: {}", e))?;
            file.write_all(content.as_bytes()).map_err(|e| format!("Failed to write connections: {}", e))?;
            file.sync_all().map_err(|e| format!("Failed to flush connections: {}", e))?;
            #[cfg(windows)]
            {
                use std::os::windows::ffi::OsStrExt;
                #[link(name = "Kernel32")]
                extern "system" {
                    fn MoveFileExW(existing_name: *const u16, new_name: *const u16, flags: u32) -> i32;
                }
                const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
                const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
                let source: Vec<u16> = temp.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
                let destination: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
                let replaced = unsafe {
                    MoveFileExW(source.as_ptr(), destination.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)
                };
                if replaced == 0 {
                    return Err(format!("Failed to atomically replace connections file: {}", std::io::Error::last_os_error()));
                }
            }
            #[cfg(not(windows))]
            fs::rename(&temp, path).map_err(|e| format!("Failed to replace connections file: {}", e))?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result
    }
}

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
        if let Some(password) = connection.password.take() {
            if !password.is_empty() {
                if store_connection_password(&connection.id, &password).is_ok() {
                    migrated = true;
                    connection.password = Some(password);
                } else {
                    log::warn!("Could not migrate SSH password to secure credential store for {}. Wiping plaintext from memory to prevent leak.", connection.id);
                    connection.password = None;
                }
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

pub fn try_read_connections_from_disk() -> Result<Vec<SavedConnection>, String> {
    let path = get_storage_path();
    #[cfg(unix)]
    if path.exists() {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read connection store at {:?}: {}", path, e))?;
        if content.trim().is_empty() {
            return Ok(vec![]);
        }
        match serde_json::from_str::<Vec<SavedConnection>>(&content) {
            Ok(mut list) => {
                let migrated_legacy_password = hydrate_connection_passwords(&mut list);
                if migrated_legacy_password {
                    let _ = write_connections_to_disk(&list);
                }
                return Ok(list);
            }
            Err(e) => {
                // Critical safeguard: do not return an empty list when parsing an existing file fails.
                // Overwriting an existing file with an empty list would permanently wipe out user connection profiles.
                log::error!("Failed to parse connections.json: {}", e);
                return Err(format!("Corrupted connections storage file: {}. File path: {:?}", e, path));
            }
        }
    }
    // Fallback migration from legacy ~/.clouddesk/connections.json or AppData
    if let Some(base) = directories::BaseDirs::new() {
        let legacy_home = base.home_dir().join(".clouddesk").join("connections.json");
        if legacy_home.exists() {
            if let Ok(content) = fs::read_to_string(&legacy_home) {
                if let Ok(mut list) = serde_json::from_str::<Vec<SavedConnection>>(&content) {
                    hydrate_connection_passwords(&mut list);
                    let _ = write_connections_to_disk(&list);
                    return Ok(list);
                }
            }
        }
        let legacy_appdata = base.data_local_dir().join("clouddesk").join("connections.json");
        if legacy_appdata.exists() {
            if let Ok(content) = fs::read_to_string(&legacy_appdata) {
                if let Ok(mut list) = serde_json::from_str::<Vec<SavedConnection>>(&content) {
                    hydrate_connection_passwords(&mut list);
                    let _ = write_connections_to_disk(&list);
                    return Ok(list);
                }
            }
        }
    }
    Ok(vec![])
}

pub fn read_connections_from_disk() -> Vec<SavedConnection> {
    try_read_connections_from_disk().unwrap_or_default()
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
    if json.len() > 8 * 1024 * 1024 {
        return Err("Connection storage exceeds the 8 MiB limit.".into());
    }
    write_connections_file(&path, &json)
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
    if connection.id.is_empty() {
        connection.id = uuid::Uuid::new_v4().to_string();
    }
    sanitize_connection_secrets(&mut connection);
    let mut list = try_read_connections_from_disk()?;
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
    let mut list = try_read_connections_from_disk()?;
    list.retain(|c| c.id != id);
    write_connections_to_disk(&list)?;
    delete_connection_password(&id);
    Ok(())
}

#[tauri::command]
pub async fn store_update_connection(_state: tauri::State<'_, AppState>, mut connection: SavedConnection) -> Result<(), String> {
    if connection.id.trim().is_empty() {
        return Err("Connection identifier cannot be empty.".into());
    }
    sanitize_connection_secrets(&mut connection);
    let mut list = try_read_connections_from_disk()?;
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
