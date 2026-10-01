use serde::{Deserialize, Serialize};
use crate::AppState;
use super::monitor::DiskUsage;
use crate::ssh::exec::run_cmd;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlockDevice {
    pub name: String,
    pub size: String,
    pub type_name: String,
    pub fstype: Option<String>,
    pub mountpoint: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LargestDir {
    pub path: String,
    pub size: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SmartStatus {
    pub device: String,
    pub health: String,
    pub temperature_c: Option<u32>,
    pub power_on_hours: Option<u64>,
    pub raw_output: String,
}

#[tauri::command]
pub async fn disk_list(state: tauri::State<'_, AppState>, conn_id: String) -> Result<Vec<BlockDevice>, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "lsblk -J -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT,MODEL").await;

    if code == 0 && !stdout.trim().is_empty() {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&stdout) {
            if let Some(blockdevices) = val.get("blockdevices").and_then(|b| b.as_array()) {
                let mut devices = Vec::new();
                for dev in blockdevices {
                    devices.push(BlockDevice {
                        name: dev.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        size: dev.get("size").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        type_name: dev.get("type").and_then(|v| v.as_str()).unwrap_or("disk").to_string(),
                        fstype: dev.get("fstype").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        mountpoint: dev.get("mountpoint").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        model: dev.get("model").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    });
                }
                return Ok(devices);
            }
        }
    }

    // Try plaintext lsblk if json flag not supported
    let (plain, _) = run_cmd(&state, &conn_id, "lsblk -r -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINT").await;
    let mut devices = Vec::new();
    for line in plain.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            devices.push(BlockDevice {
                name: parts[0].to_string(),
                size: parts[1].to_string(),
                type_name: parts[2].to_string(),
                fstype: parts.get(3).map(|s| s.to_string()),
                mountpoint: parts.get(4).map(|s| s.to_string()),
                model: None,
            });
        }
    }

    Ok(devices)
}

#[tauri::command]
pub async fn disk_usage(state: tauri::State<'_, AppState>, conn_id: String) -> Result<Vec<DiskUsage>, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "df -B1 -P -x tmpfs -x devtmpfs -x squashfs").await;

    if code == 0 && !stdout.trim().is_empty() {
        let mut usages = Vec::new();
        for line in stdout.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 6 {
                let filesystem = parts[0].to_string();
                let total: u64 = parts[1].parse().unwrap_or(0);
                let used: u64 = parts[2].parse().unwrap_or(0);
                let available: u64 = parts[3].parse().unwrap_or(0);
                let percent: f32 = parts[4].trim_end_matches('%').parse().unwrap_or(0.0);
                let mount_point = parts[5].to_string();

                usages.push(DiskUsage {
                    filesystem,
                    mount_point,
                    total,
                    used,
                    available,
                    percent,
                });
            }
        }
        return Ok(usages);
    }

    Ok(vec![])
}

#[tauri::command]
pub async fn disk_smart(state: tauri::State<'_, AppState>, conn_id: String, device: String) -> Result<String, String> {
    let cmd = format!("smartctl -H /dev/{} 2>/dev/null || echo 'SMART info unavailable for {}'", device, device);
    let (stdout, _) = run_cmd(&state, &conn_id, &cmd).await;
    Ok(stdout)
}

#[tauri::command]
pub async fn disk_largest_dirs(state: tauri::State<'_, AppState>, conn_id: String, path: String) -> Result<String, String> {
    let cmd = format!("du -h -d 1 '{}' 2>/dev/null | sort -hr | head -n 10", path);
    let (stdout, _) = run_cmd(&state, &conn_id, &cmd).await;
    Ok(stdout)
}
