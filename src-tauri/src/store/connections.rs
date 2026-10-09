use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SavedConnection {
    pub id: String,
    pub created_at: i64,
    pub last_connected_at: Option<i64>,
    pub notes: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
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
    dir.push(".clouddesk");
    let _ = fs::create_dir_all(&dir);
    dir.push("connections.json");
    dir
}

pub fn read_connections_from_disk() -> Vec<SavedConnection> {
    let path = get_storage_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(list) = serde_json::from_str::<Vec<SavedConnection>>(&content) {
            return list;
        }
    }
    // Fallback migration from legacy AppData path
    if let Some(base) = directories::BaseDirs::new() {
        let legacy = base.data_local_dir().join("clouddesk").join("connections.json");
        if let Ok(content) = fs::read_to_string(legacy) {
            if let Ok(list) = serde_json::from_str::<Vec<SavedConnection>>(&content) {
                let _ = fs::write(&path, &content);
                return list;
            }
        }
    }
    vec![]
}

pub fn write_connections_to_disk(list: &[SavedConnection]) -> Result<(), String> {
    let path = get_storage_path();
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

fn sanitize_connection_secrets(connection: &mut SavedConnection) {
    if let Some(ref key_str) = connection.private_key_path {
        let trimmed = key_str.trim();
        if trimmed.contains("PRIVATE KEY") || trimmed.contains("PuTTY-User-Key-File") || trimmed.lines().count() > 2 {
            connection.private_key_path = None;
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
    write_connections_to_disk(&list)
}

#[tauri::command]
pub async fn store_update_connection(_state: tauri::State<'_, AppState>, mut connection: SavedConnection) -> Result<(), String> {
    sanitize_connection_secrets(&mut connection);
    let mut list = read_connections_from_disk();
    if let Some(pos) = list.iter().position(|c| c.id == connection.id) {
        list[pos] = connection;
    } else {
        list.push(connection);
    }
    write_connections_to_disk(&list)
}
