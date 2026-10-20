use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::{run_cmd, run_cmd_priv};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub user: String,
    pub cpu_percent: f32,
    pub mem_percent: f32,
    pub vsz: u64,
    pub rss: u64,
    pub status: String,
    pub command: String,
    pub start_time: String,
    pub cpu_time: String,
    pub threads: u32,
}

#[tauri::command]
pub async fn process_list(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<ProcessInfo>, String> {
    // Columns: user:20,pid,ppid,pcpu,pmem,vsz,rss,stat,time,start_time,nlwp,args
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        "ps -eo user:20,pid,ppid,pcpu,pmem,vsz,rss,stat,time,start_time,nlwp,args --sort=-%cpu --no-header 2>/dev/null | head -n 120",
    ).await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 11 {
            let user       = parts[0].to_string();
            let pid        = parts[1].parse::<u32>().unwrap_or(0);
            let ppid       = parts[2].parse::<u32>().unwrap_or(0);
            let cpu_pct    = parts[3].parse::<f32>().unwrap_or(0.0);
            let mem_pct    = parts[4].parse::<f32>().unwrap_or(0.0);
            let vsz        = parts[5].parse::<u64>().unwrap_or(0) * 1024; // kB → bytes
            let rss        = parts[6].parse::<u64>().unwrap_or(0) * 1024;
            let status     = parts[7].to_string();
            let cpu_time   = parts[8].to_string();
            let start_time = parts[9].to_string();
            let threads    = parts[10].parse::<u32>().unwrap_or(1);
            let command    = parts[11..].join(" ");
            let name       = parts[11].split('/').last().unwrap_or("proc")
                .trim_start_matches('-') // some processes have leading dash (login shells)
                .to_string();

            if pid > 0 {
                list.push(ProcessInfo {
                    pid, ppid, name, user, cpu_percent: cpu_pct, mem_percent: mem_pct,
                    vsz, rss, status, command, start_time, cpu_time, threads,
                });
            }
        }
    }

    if list.is_empty() && !stdout.is_empty() {
        // Fallback: try the simpler ps aux
        return process_list_aux(&state, &conn_id).await;
    }

    if list.is_empty() {
        return Err("No process data returned from remote server.".into());
    }

    Ok(list)
}

async fn process_list_aux(state: &AppState, conn_id: &str) -> Result<Vec<ProcessInfo>, String> {
    let (stdout, _) = run_cmd(state, conn_id, "ps aux --sort=-%cpu 2>/dev/null | head -n 80").await;
    let mut list = Vec::new();
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 11 {
            let user     = parts[0].to_string();
            let pid      = parts[1].parse::<u32>().unwrap_or(0);
            let cpu_pct  = parts[2].parse::<f32>().unwrap_or(0.0);
            let mem_pct  = parts[3].parse::<f32>().unwrap_or(0.0);
            let vsz      = parts[4].parse::<u64>().unwrap_or(0) * 1024;
            let rss      = parts[5].parse::<u64>().unwrap_or(0) * 1024;
            let status   = parts[7].to_string();
            let start    = parts[8].to_string();
            let cpu_time = parts[9].to_string();
            let command  = parts[10..].join(" ");
            let name     = parts[10].split('/').last().unwrap_or("proc").to_string();
            if pid > 0 {
                list.push(ProcessInfo {
                    pid, ppid: 1, name, user, cpu_percent: cpu_pct, mem_percent: mem_pct,
                    vsz, rss, status, command, start_time: start, cpu_time, threads: 1,
                });
            }
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn process_kill(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    pid: u32,
    signal: String,
) -> Result<(), String> {
    // Validate signal name to prevent injection
    let safe_signal = match signal.to_uppercase().as_str() {
        "TERM" | "SIGTERM" | "15" => "TERM",
        "KILL" | "SIGKILL" | "9"  => "KILL",
        "HUP"  | "SIGHUP"  | "1"  => "HUP",
        "INT"  | "SIGINT"  | "2"  => "INT",
        "STOP" | "SIGSTOP" | "19" => "STOP",
        "CONT" | "SIGCONT" | "18" => "CONT",
        "USR1" | "SIGUSR1" | "10" => "USR1",
        "USR2" | "SIGUSR2" | "12" => "USR2",
        _ => return Err(format!("Invalid or unsupported signal: {}", signal)),
    };

    // Guard against killing PID 1 (init/systemd)
    if pid <= 1 {
        return Err("Refusing to send signal to PID 1 (init/systemd).".into());
    }

    // 1. Try direct kill first
    let (stdout, code) = run_cmd(&state, &conn_id, &format!("kill -s {} {}", safe_signal, pid)).await;
    if code == 0 {
        log::info!("SSH Desktop: Sent signal {} to PID {} directly", safe_signal, pid);
        return Ok(());
    }

    // 2. Direct kill failed (e.g. Operation not permitted for non-root user).
    // Automatically elevate with sudo using run_cmd_priv!
    let (priv_out, priv_code) = run_cmd_priv(&state, &conn_id, &format!("kill -s {} {}", safe_signal, pid)).await;
    if priv_code == 0 {
        log::info!("SSH Desktop: Sent signal {} to PID {} with sudo elevation", safe_signal, pid);
        return Ok(());
    }

    // 3. If signal was KILL or TERM and still failed, try force kill with sudo kill -9
    if safe_signal == "KILL" || safe_signal == "TERM" {
        let (_, force_code) = run_cmd_priv(&state, &conn_id, &format!("kill -9 {}", pid)).await;
        if force_code == 0 {
            log::info!("SSH Desktop: Force-killed PID {} with sudo kill -9", pid);
            return Ok(());
        }
    }

    // Clean up plink/bash error messages (filter out "Server refused our key", "[sudo] password", etc.)
    let raw_err = if !priv_out.is_empty() { priv_out } else { stdout };
    let filtered_lines: Vec<&str> = raw_err
        .lines()
        .map(|l| l.trim())
        .filter(|l| {
            !l.is_empty()
                && !l.contains("Server refused our key")
                && !l.contains("[sudo] password")
                && !l.contains("Password:")
        })
        .collect();

    let clean_msg = filtered_lines.join(" ");
    let final_msg = if clean_msg.is_empty() {
        format!("Failed to kill process {}: Operation not permitted. Ensure user has sudo permissions.", pid)
    } else {
        clean_msg
    };

    Err(final_msg)
}

#[tauri::command]
pub async fn process_renice(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    pid: u32,
    value: i32,
) -> Result<(), String> {
    // Nice values: -20 (highest priority) to 19 (lowest)
    if value < -20 || value > 19 {
        return Err(format!("Nice value must be between -20 and 19, got {}", value));
    }
    if pid <= 1 {
        return Err("Refusing to renice PID 1.".into());
    }

    // Try direct renice
    let (stdout, code) = run_cmd(&state, &conn_id, &format!("renice -n {} -p {}", value, pid)).await;
    if code == 0 {
        log::info!("SSH Desktop: Renice PID {} to nice {}", pid, value);
        return Ok(());
    }

    // Elevate with sudo
    let (priv_out, priv_code) = run_cmd_priv(&state, &conn_id, &format!("renice -n {} -p {}", value, pid)).await;
    if priv_code == 0 {
        log::info!("SSH Desktop: Renice PID {} to nice {} with sudo", pid, value);
        return Ok(());
    }

    let raw_err = if !priv_out.is_empty() { priv_out } else { stdout };
    let filtered: Vec<&str> = raw_err
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.contains("Server refused our key") && !l.contains("[sudo]"))
        .collect();
    let msg = filtered.join(" ");
    Err(if msg.is_empty() { format!("Failed to renice PID {}", pid) } else { msg })
}
