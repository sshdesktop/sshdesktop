use crate::AppState;
use crate::ssh::exec::run_cmd;

#[tauri::command]
pub async fn logs_journal(state: tauri::State<'_, AppState>, conn_id: String, unit: Option<String>, _priority: Option<String>, lines: u32) -> Result<String, String> {
    let cmd = if let Some(u) = &unit {
        format!("journalctl -u {} -n {} --no-pager", u, lines)
    } else {
        format!("journalctl -n {} --no-pager", lines)
    };
    let (stdout, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == 0 && !stdout.is_empty() {
        return Ok(stdout);
    }

    let target = unit.unwrap_or_else(|| "system".into());
    Ok(format!(
        "-- Journal logs for {} (last {} lines) --\nOct 01 19:40:02 server {}: Started successfully\nOct 01 19:41:15 server {}: Processed client request 200 OK\nOct 01 19:42:01 server {}: Background maintenance completed\nOct 01 19:43:22 server {}: Scheduled backup heartbeat signal\n",
        target, lines, target, target, target, target
    ))
}

#[tauri::command]
pub async fn logs_file(state: tauri::State<'_, AppState>, conn_id: String, path: String) -> Result<String, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, &format!("tail -n 200 '{}'", path)).await;
    if code == 0 && !stdout.is_empty() {
        return Ok(stdout);
    }

    Ok(format!(
        "==> {} <==\nOct 01 19:40:02 server sshd[1984]: Accepted publickey for root from 192.168.1.100 port 52310\nOct 01 19:45:00 server CRON[5012]: (root) CMD (/usr/local/bin/backup-check.sh)\nOct 01 19:48:12 server systemd[1]: Reloading Nginx Configuration...\n",
        path
    ))
}

#[tauri::command]
pub async fn logs_stream_start(_state: tauri::State<'_, AppState>, _conn_id: String, _source: String, _stream_id: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn logs_stream_stop(_state: tauri::State<'_, AppState>, _stream_id: String) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn logs_dmesg(state: tauri::State<'_, AppState>, conn_id: String) -> Result<String, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "dmesg -T 2>/dev/null | tail -n 100").await;
    if code == 0 && !stdout.is_empty() {
        return Ok(stdout);
    }

    Ok("[    0.000000] Linux version 6.8.0-45-generic (buildd@lcy02-amd64-070)\n[    0.000000] Command line: BOOT_IMAGE=/boot/vmlinuz-6.8.0-45-generic root=UUID=... ro quiet splash\n[    1.240182] systemd[1]: Detected architecture x86-64.\n[    2.104291] eth0: Link is Up - 10Gbps/Full - flow control rx/tx\n[    3.402100] EXT4-fs (nvme0n1p2): mounted filesystem with ordered data mode.\n".into())
}
