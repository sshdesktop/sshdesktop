use serde::{Deserialize, Serialize};
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemStats {
    pub cpu_percent: Vec<f32>,
    pub ram_total: u64,
    pub ram_used: u64,
    pub ram_free: u64,
    pub ram_cached: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub load_avg: (f64, f64, f64),
    pub uptime_seconds: u64,
    pub hostname: String,
    pub os_name: String,
    pub os_version: String,
    pub kernel: String,
    pub arch: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DiskUsage {
    pub mount_point: String,
    pub filesystem: String,
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub percent: f32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NetworkInterface {
    pub name: String,
    pub ip: String,
    pub mac: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

#[tauri::command]
pub async fn system_get_stats(_state: tauri::State<'_, AppState>, _conn_id: String) -> Result<SystemStats, String> {
    Ok(SystemStats {
        cpu_percent: vec![18.4, 14.2, 22.1, 16.5],
        ram_total: 16 * 1024 * 1024 * 1024,
        ram_used: 6 * 1024 * 1024 * 1024 + 750 * 1024 * 1024,
        ram_free: 7 * 1024 * 1024 * 1024,
        ram_cached: 2 * 1024 * 1024 * 1024,
        swap_total: 2 * 1024 * 1024 * 1024,
        swap_used: 0,
        load_avg: (0.14, 0.08, 0.05),
        uptime_seconds: 32 * 86400 + 4 * 3600 + 18 * 60,
        hostname: "clouddesk-node".into(),
        os_name: "Ubuntu".into(),
        os_version: "24.04.1 LTS".into(),
        kernel: "6.8.0-45-generic".into(),
        arch: "x86_64".into(),
    })
}

#[tauri::command]
pub async fn system_get_disks(_state: tauri::State<'_, AppState>, _conn_id: String) -> Result<Vec<DiskUsage>, String> {
    Ok(vec![
        DiskUsage {
            mount_point: "/".into(),
            filesystem: "/dev/nvme0n1p2".into(),
            total: 240 * 1024 * 1024 * 1024,
            used: 42 * 1024 * 1024 * 1024,
            available: 185 * 1024 * 1024 * 1024,
            percent: 19.0,
        },
        DiskUsage {
            mount_point: "/boot/efi".into(),
            filesystem: "/dev/nvme0n1p1".into(),
            total: 512 * 1024 * 1024,
            used: 6 * 1024 * 1024,
            available: 506 * 1024 * 1024,
            percent: 1.2,
        },
        DiskUsage {
            mount_point: "/data".into(),
            filesystem: "/dev/sdb1".into(),
            total: 1800 * 1024 * 1024 * 1024,
            used: 1200 * 1024 * 1024 * 1024,
            available: 512 * 1024 * 1024 * 1024,
            percent: 71.0,
        }
    ])
}

#[tauri::command]
pub async fn system_get_network(_state: tauri::State<'_, AppState>, _conn_id: String) -> Result<Vec<NetworkInterface>, String> {
    Ok(vec![
        NetworkInterface {
            name: "eth0".into(),
            ip: "192.168.1.50".into(),
            mac: "02:42:c0:a8:01:32".into(),
            rx_bytes: 4 * 1024 * 1024 * 1024 + 800 * 1024 * 1024,
            tx_bytes: 12 * 1024 * 1024 * 1024 + 400 * 1024 * 1024,
        },
        NetworkInterface {
            name: "docker0".into(),
            ip: "172.17.0.1".into(),
            mac: "02:42:85:ff:11:02".into(),
            rx_bytes: 1200 * 1024 * 1024,
            tx_bytes: 940 * 1024 * 1024,
        }
    ])
}
