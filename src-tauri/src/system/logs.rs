fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn valid_unit_name(value: &str) -> bool {
    !value.is_empty() && !value.starts_with('-') && value.len() <= 256
        && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '@' | ':' | '-'))
}

use crate::AppState;
use crate::ssh::exec::run_cmd;
use tauri::{Emitter, Manager};
use parking_lot::Mutex;
use std::collections::HashMap;

lazy_static::lazy_static! {
    static ref ACTIVE_STREAMS: Mutex<HashMap<String, tokio::task::AbortHandle>> = Mutex::new(HashMap::new());
}

struct LogStreamGuard(String);
impl Drop for LogStreamGuard {
    fn drop(&mut self) {
        ACTIVE_STREAMS.lock().remove(&self.0);
    }
}

#[tauri::command]
pub async fn logs_journal(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    unit: Option<String>,
    priority: Option<String>,
    lines: u32,
) -> Result<String, String> {
    // Validate unit name
    if let Some(ref u) = unit {
        if !valid_unit_name(u) {
            return Err("Invalid unit name.".into());
        }
    }

    let lines_capped = lines.min(2000);

    let mut cmd_parts = vec!["journalctl".to_string(), "--no-pager".to_string()];
    cmd_parts.push(format!("-n {}", lines_capped));

    if let Some(ref u) = unit {
        cmd_parts.push(format!("-u {}", shell_quote(u)));
    }

    if let Some(ref p) = priority {
        // Validate priority level
        let valid_priorities = ["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug",
                                 "0", "1", "2", "3", "4", "5", "6", "7"];
        if valid_priorities.contains(&p.to_lowercase().as_str()) {
            cmd_parts.push(format!("-p {}", shell_quote(&p.to_lowercase())));
        } else {
            return Err(format!("Invalid journal priority: {}", p));
        }
    }

    cmd_parts.push("2>&1".to_string());
    let cmd = cmd_parts.join(" ");

    let (stdout, code) = run_cmd(&state, &conn_id, &cmd).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    if stdout.contains("command not found") {
        return Err("journalctl not available. This feature requires a systemd-based Linux.".into());
    }

    if code != 0 {
        return Err(format!("journalctl failed: {}", stdout.trim()));
    }
    if !stdout.is_empty() {
        return Ok(stdout);
    }

    let target = unit.unwrap_or_else(|| "system".into());
    Ok(format!("-- No journal entries found for {} --", target))
}

#[tauri::command]
pub async fn logs_file(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<String, String> {
    // Validate path (must be absolute, no injection)
    if !path.starts_with('/') || path.len() > 4096 || path.chars().any(|c| c.is_control()) {
        return Err("Path must be absolute, at most 4096 characters, and contain no control characters.".into());
    }
    let escaped = path.replace('\'', r"'\''");
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        &format!("tail -n 500 '{}' 2>&1", escaped),
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    if stdout.contains("No such file") || stdout.contains("Permission denied") {
        return Err(stdout.trim().to_string());
    }

    if code != 0 {
        return Err(format!("Unable to read log file '{}': {}", path, stdout.trim()));
    }
    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Ok(format!("(File '{}' is empty)", path))
}

#[tauri::command]
pub async fn logs_stream_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conn_id: String,
    source: String,
    stream_id: String,
) -> Result<(), String> {
    if stream_id.trim().is_empty() || stream_id.len() > 128
        || stream_id.chars().any(|c| !c.is_ascii_alphanumeric() && !matches!(c, '-' | '_'))
    {
        return Err("Invalid log stream ID.".into());
    }
    let is_file = source.starts_with('/');
    if source.is_empty() || source.len() > 4096 || source.chars().any(|c| c.is_control())
        || (!is_file && !valid_unit_name(&source))
    {
        return Err("Invalid log source.".into());
    }

    let conn = crate::ssh::connection::resolve_connection(&state, &conn_id)
        .ok_or_else(|| format!("SSH connection '{}' not found.", conn_id))?;
    let is_key_auth = match conn.config.auth_method.as_deref() {
        Some("password") => false,
        Some("key") => true,
        _ => conn.config.private_key_path.is_some() || conn.config.password.is_none(),
    };
    let selected_key_path = if is_key_auth { conn.config.private_key_path.as_deref() } else { None };
    if selected_key_path.map(crate::ssh::connection::is_ppk_key).unwrap_or(false) {
        return Err("Live log streaming currently requires a PEM/OpenSSH private key or password authentication; PuTTY PPK streaming is not supported by the native SSH channel.".into());
    }

    let handle = {
        let sessions = state.sessions.lock().await;
        sessions.get(&conn_id).cloned()
            .or_else(|| if conn_id == "default" { sessions.get("default").cloned() } else { None })
    };
    let handle = match handle {
        Some(handle) => handle,
        None => {
            let new_handle = crate::ssh::session::connect_session_with_passphrase_auth(
                &conn.config.host,
                conn.config.port,
                &conn.config.username,
                if is_key_auth { None } else { conn.config.password.as_deref() },
                selected_key_path,
                conn.config.passphrase.as_deref(),
                conn.config.auth_method.as_deref() != Some("password"),
            ).await.map_err(|e| format!("Failed to open SSH log stream: {}", e))?;
            let handle = std::sync::Arc::new(new_handle);
            let mut sessions = state.sessions.lock().await;
            sessions.insert(conn_id.clone(), handle.clone());
            if conn_id == "default" {
                sessions.insert("default".to_string(), handle.clone());
            }
            handle
        }
    };

    let cmd = if is_file {
        format!("tail -n 50 -F -- {} 2>&1", shell_quote(&source))
    } else {
        format!("journalctl -u {} -f -n 50 --no-pager 2>&1", shell_quote(&source))
    };

    let app_clone = app.clone();
    let stream_id_clone = stream_id.clone();
    let (start_tx, start_rx) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        let _ = start_rx.await;
        let _guard = LogStreamGuard(stream_id_clone.clone());
        if let Err(error) = crate::ssh::session::run_log_stream_channel(
            &app_clone, &handle, &stream_id_clone, &cmd
        ).await {
            let _ = app_clone.emit("log-stream-data", serde_json::json!({
                "stream_id": stream_id_clone,
                "data": format!("Log stream failed: {}", error),
                "done": true
            }));
        }
    });

    {
        let mut streams = ACTIVE_STREAMS.lock();
        if streams.contains_key(&stream_id) {
            task.abort();
            return Err("A log stream with this ID is already running.".into());
        }
        streams.insert(stream_id, task.abort_handle());
    }
    let _ = start_tx.send(());
    Ok(())
}

#[tauri::command]
pub async fn logs_stream_stop(
    app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
    stream_id: String,
) -> Result<(), String> {
    if stream_id.trim().is_empty() {
        return Err("Log stream ID cannot be empty.".into());
    }
    if let Some(handle) = ACTIVE_STREAMS.lock().remove(&stream_id) {
        handle.abort();
        use tauri::Emitter;
        let _ = app.emit("log-stream-data", serde_json::json!({
            "stream_id": stream_id,
            "data": "",
            "done": true,
            "cancelled": true
        }));
        log::info!("SSH Desktop: Log stream {} stopped", stream_id);
        Ok(())
    } else {
        Err(format!("Log stream '{}' is not running.", stream_id))
    }
}

#[tauri::command]
pub async fn logs_dmesg(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        "dmesg -T 2>/dev/null | tail -n 200",
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    if code != 0 {
        return Err(format!("dmesg failed: {}", stdout.trim()));
    }
    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Err("dmesg returned no output.".into())
}
