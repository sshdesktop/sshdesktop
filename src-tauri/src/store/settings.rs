use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_accent")]
    pub accent_color: String,
    #[serde(default = "default_font_size")]
    pub terminal_font_size: u32,
    #[serde(default = "default_color_scheme")]
    pub terminal_color_scheme: String,
    #[serde(default = "default_font_size")]
    pub editor_font_size: u32,
    #[serde(default = "default_dock_position")]
    pub dock_position: String,
    #[serde(default = "default_polling")]
    pub polling_interval_ms: u64,
    #[serde(default = "default_true")]
    pub show_hidden_files: bool,
    #[serde(default)]
    pub wallpaper: Option<String>,
    #[serde(default)]
    pub custom_wallpaper_url: Option<String>,
    #[serde(default)]
    pub icon_positions: Option<serde_json::Value>,
    #[serde(default)]
    pub sticky_notes: Option<String>,
    #[serde(default)]
    pub favorites: Option<Vec<String>>,
}

fn default_theme() -> String { "dark".into() }
fn default_accent() -> String { "#89B4FA".into() }
fn default_font_size() -> u32 { 14 }
fn default_color_scheme() -> String { "catppuccin-mocha".into() }
fn default_dock_position() -> String { "bottom".into() }
fn default_polling() -> u64 { 2000 }
fn default_true() -> bool { true }

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            accent_color: default_accent(),
            terminal_font_size: default_font_size(),
            terminal_color_scheme: default_color_scheme(),
            editor_font_size: default_font_size(),
            dock_position: default_dock_position(),
            polling_interval_ms: default_polling(),
            show_hidden_files: true,
            wallpaper: Some("sonoma".into()),
            custom_wallpaper_url: None,
            icon_positions: None,
            sticky_notes: None,
            favorites: Some(vec!["/".into(), "/home".into(), "/etc".into(), "/var/log".into(), "/tmp".into()]),
        }
    }
}

pub fn get_sshdesktop_dir() -> PathBuf {
    if let Some(base) = directories::BaseDirs::new() {
        let home_dot_dir = base.home_dir().join(".sshdesktop");
        let _ = fs::create_dir_all(&home_dot_dir);
        return home_dot_dir;
    }
    let local = PathBuf::from(".sshdesktop");
    let _ = fs::create_dir_all(&local);
    local
}

pub fn get_clouddesk_dir() -> PathBuf {
    get_sshdesktop_dir()
}

fn get_settings_path() -> PathBuf {
    let dir = get_sshdesktop_dir();
    dir.join("settings.json")
}

#[tauri::command]
pub async fn settings_get(_state: tauri::State<'_, AppState>) -> Result<AppSettings, String> {
    let path = get_settings_path();
    if let Ok(content) = fs::read_to_string(&path) {
        if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
            return Ok(settings);
        }
    }
    // Fallback check legacy location (~/.clouddesk/settings.json or AppData)
    if let Some(base) = directories::BaseDirs::new() {
        let legacy_home = base.home_dir().join(".clouddesk").join("settings.json");
        if let Ok(content) = fs::read_to_string(&legacy_home) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                let _ = fs::write(&path, &content);
                return Ok(settings);
            }
        }
        let legacy = base.data_local_dir().join("clouddesk").join("settings.json");
        if let Ok(content) = fs::read_to_string(legacy) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                let _ = fs::write(&path, &content);
                return Ok(settings);
            }
        }
    }
    let default_settings = AppSettings::default();
    if let Ok(serialized) = serde_json::to_string_pretty(&default_settings) {
        let _ = fs::write(&path, serialized);
    }
    Ok(default_settings)
}

#[tauri::command]
pub async fn settings_save(_state: tauri::State<'_, AppState>, settings: AppSettings) -> Result<(), String> {
    let path = get_settings_path();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}
