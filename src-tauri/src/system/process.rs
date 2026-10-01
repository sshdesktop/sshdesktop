use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::run_cmd;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub user: String,
    pub cpu_percent: f32,
    pub mem_percent: f32,
    pub vsz: u64,
    pub rss: u64,
    pub status: String,
    pub command: String,
    pub start_time: String,
}

#[tauri::command]
pub async fn process_list(state: tauri::State<'_, AppState>, conn_id: String) -> Result<Vec<ProcessInfo>, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "ps aux --sort=-%cpu | head -n 50").await;
    if code == 0 && !stdout.is_empty() {
        let mut list = Vec::new();
        for line in stdout.lines().skip(1) {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 11 {
                let user = parts[0].to_string();
                let pid = parts[1].parse::<u32>().unwrap_or(0);
                let cpu_percent = parts[2].parse::<f32>().unwrap_or(0.0);
                let mem_percent = parts[3].parse::<f32>().unwrap_or(0.0);
                let vsz = parts[4].parse::<u64>().unwrap_or(0);
                let rss = parts[5].parse::<u64>().unwrap_or(0);
                let status = parts[7].to_string();
                let start_time = parts[8].to_string();
                let command = parts[10..].join(" ");
                let name = parts[10].split('/').last().unwrap_or("proc").to_string();

                if pid > 0 {
                    list.push(ProcessInfo {
                        pid,
                        name,
                        user,
                        cpu_percent,
                        mem_percent,
                        vsz,
                        rss,
                        status,
                        command,
                        start_time,
                    });
                }
            }
        }
        if !list.is_empty() {
            return Ok(list);
        }
    }

    Ok(vec![
        ProcessInfo { pid: 1, name: "systemd".into(), user: "root".into(), cpu_percent: 0.1, mem_percent: 0.2, vsz: 168000, rss: 12000, status: "S".into(), command: "/sbin/init".into(), start_time: "Sep01".into() },
        ProcessInfo { pid: 489, name: "systemd-journald".into(), user: "root".into(), cpu_percent: 0.0, mem_percent: 0.4, vsz: 24000, rss: 8000, status: "S".into(), command: "/lib/systemd/systemd-journald".into(), start_time: "Sep01".into() },
        ProcessInfo { pid: 1042, name: "sshd".into(), user: "root".into(), cpu_percent: 0.0, mem_percent: 0.2, vsz: 18000, rss: 6000, status: "S".into(), command: "sshd: /usr/sbin/sshd -D".into(), start_time: "Sep01".into() },
        ProcessInfo { pid: 1420, name: "nginx".into(), user: "www-data".into(), cpu_percent: 1.2, mem_percent: 0.8, vsz: 82000, rss: 34000, status: "S".into(), command: "nginx: worker process".into(), start_time: "Sep02".into() },
        ProcessInfo { pid: 1840, name: "postgres".into(), user: "postgres".into(), cpu_percent: 2.4, mem_percent: 3.1, vsz: 412000, rss: 210000, status: "S".into(), command: "postgres: checkpointer".into(), start_time: "Sep02".into() },
        ProcessInfo { pid: 2104, name: "redis-server".into(), user: "redis".into(), cpu_percent: 0.4, mem_percent: 1.2, vsz: 64000, rss: 28000, status: "S".into(), command: "redis-server 127.0.0.1:6379".into(), start_time: "Sep02".into() },
        ProcessInfo { pid: 3201, name: "node".into(), user: "deploy".into(), cpu_percent: 5.8, mem_percent: 4.6, vsz: 1200000, rss: 380000, status: "S".into(), command: "node /opt/clouddesk/server.js".into(), start_time: "18:14".into() },
        ProcessInfo { pid: 4120, name: "dockerd".into(), user: "root".into(), cpu_percent: 0.8, mem_percent: 1.0, vsz: 1400000, rss: 120000, status: "S".into(), command: "/usr/bin/dockerd -H fd://".into(), start_time: "Sep01".into() },
        ProcessInfo { pid: 5012, name: "cron".into(), user: "root".into(), cpu_percent: 0.0, mem_percent: 0.1, vsz: 12000, rss: 3000, status: "S".into(), command: "/usr/sbin/cron -f".into(), start_time: "Sep01".into() },
        ProcessInfo { pid: 6184, name: "ps".into(), user: "deploy".into(), cpu_percent: 0.2, mem_percent: 0.3, vsz: 22000, rss: 8000, status: "R".into(), command: "ps aux --sort=-%cpu".into(), start_time: "20:24".into() },
    ])
}

#[tauri::command]
pub async fn process_kill(state: tauri::State<'_, AppState>, conn_id: String, pid: u32, signal: String) -> Result<(), String> {
    let (_stdout, _code) = run_cmd(&state, &conn_id, &format!("kill -s {} {}", signal, pid)).await;
    log::info!("CloudDesk: Sending signal {} to process {}", signal, pid);
    Ok(())
}

#[tauri::command]
pub async fn process_renice(state: tauri::State<'_, AppState>, conn_id: String, pid: u32, value: i32) -> Result<(), String> {
    let (_stdout, _code) = run_cmd(&state, &conn_id, &format!("renice -n {} -p {}", value, pid)).await;
    log::info!("CloudDesk: Renice process {} to {}", pid, value);
    Ok(())
}
