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
        .map(|b| b.data_local_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    dir.push("clouddesk");
    let _ = fs::create_dir_all(&dir);
    dir.push("connections.json");
    dir
}

fn read_connections_from_disk() -> Vec<SavedConnection> {
    let path = get_storage_path();
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(list) = serde_json::from_str::<Vec<SavedConnection>>(&content) {
            return list;
        }
    }
    vec![]
}

fn write_connections_to_disk(list: &[SavedConnection]) -> Result<(), String> {
    let path = get_storage_path();
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn store_save_connection(_state: tauri::State<'_, AppState>, mut connection: SavedConnection) -> Result<String, String> {
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

#[tauri::command]
pub async fn store_list_connections(_state: tauri::State<'_, AppState>) -> Result<Vec<SavedConnection>, String> {
    let list = read_connections_from_disk();
    if list.is_empty() {
        // Return a default demo server profile if empty
        return Ok(vec![
            SavedConnection {
                id: "default-ubuntu-node".into(),
                name: "Production Ubuntu Node".into(),
                host: "192.168.1.50".into(),
                port: 22,
                username: "root".into(),
                password: Some("••••••••".into()),
                private_key_path: None,
                auth_method: Some("password".into()),
                color: Some("#89b4fa".into()),
                group: Some("Infrastructure".into()),
                tags: vec!["Ubuntu".into(), "KVM".into(), "Production".into()],
                created_at: 1727788800,
                last_connected_at: Some(1727800000),
                notes: Some("Primary application server running Docker and Nginx".into()),
            }
        ]);
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
pub async fn store_update_connection(_state: tauri::State<'_, AppState>, connection: SavedConnection) -> Result<(), String> {
    let mut list = read_connections_from_disk();
    if let Some(pos) = list.iter().position(|c| c.id == connection.id) {
        list[pos] = connection;
    } else {
        list.push(connection);
    }
    write_connections_to_disk(&list)
}
