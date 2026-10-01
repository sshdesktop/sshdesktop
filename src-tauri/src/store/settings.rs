use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    pub theme: String,
    pub accent_color: String,
    pub terminal_font_size: u32,
    pub terminal_color_scheme: String,
    pub editor_font_size: u32,
    pub dock_position: String,
    pub polling_interval_ms: u64,
    pub show_hidden_files: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".into(),
            accent_color: "#89B4FA".into(),
            terminal_font_size: 14,
            terminal_color_scheme: "catppuccin-mocha".into(),
            editor_font_size: 14,
            dock_position: "bottom".into(),
            polling_interval_ms: 2000,
            show_hidden_files: true,
        }
    }
}

fn get_settings_path() -> PathBuf {
    let mut dir = directories::BaseDirs::new()
        .map(|b| b.data_local_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));
    dir.push("clouddesk");
    let _ = fs::create_dir_all(&dir);
    dir.push("settings.json");
    dir
}

#[tauri::command]
pub async fn settings_get(_state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    let path = get_settings_path();
    if let Ok(content) = fs::read_to_string(path) {
        if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
            return Ok(settings);
        }
    }
    Ok(AppSettings::default())
}

#[tauri::command]
pub async fn settings_save(_state: tauri::State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    let path = get_settings_path();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}
