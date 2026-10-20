use crate::AppState;
use crate::ssh::exec::run_cmd;
use tauri::{Emitter, Manager};
use parking_lot::Mutex;
use std::collections::HashMap;

lazy_static::lazy_static! {
    static ref ACTIVE_STREAMS: Mutex<HashMap<String, bool>> = Mutex::new(HashMap::new());
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
        if u.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')' | '<' | '>')) {
            return Err("Invalid unit name.".into());
        }
    }

    let lines_capped = lines.min(2000);

    let mut cmd_parts = vec!["journalctl".to_string(), "--no-pager".to_string()];
    cmd_parts.push(format!("-n {}", lines_capped));

    if let Some(ref u) = unit {
        cmd_parts.push(format!("-u '{}'", u));
    }

    if let Some(ref p) = priority {
        // Validate priority level
        let valid_priorities = ["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug",
                                 "0", "1", "2", "3", "4", "5", "6", "7"];
        if valid_priorities.contains(&p.to_lowercase().as_str()) {
            cmd_parts.push(format!("-p '{}'", p.to_lowercase()));
        }
    }

    cmd_parts.push("2>&1".to_string());
    let cmd = cmd_parts.join(" ");

    let (stdout, code) = run_cmd(&state, &conn_id, &cmd).await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    if stdout.contains("command not found") {
        return Err("journalctl not available. This feature requires a systemd-based Linux.".into());
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
    if !path.starts_with('/') {
        return Err("Path must be absolute.".into());
    }
    if path.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')')) {
        return Err("Invalid path.".into());
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

    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Ok(format!("(File '{}' is empty or not readable)", path))
}

#[tauri::command]
pub async fn logs_stream_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conn_id: String,
    source: String,
    stream_id: String,
) -> Result<(), String> {
    // Mark stream as active
    ACTIVE_STREAMS.lock().insert(stream_id.clone(), true);

    let app_clone = app.clone();
    let stream_id_clone = stream_id.clone();
    let conn_id_clone = conn_id.clone();
    let source_clone = source.clone();

    // Validate source
    if source.chars().any(|c| matches!(c, ';' | '&' | '`' | '$' | '(' | ')')) {
        return Err("Invalid log source.".into());
    }

    tokio::spawn(async move {
        // Build the streaming command
        let cmd = if source_clone.starts_with('/') {
            // File path — use tail -f
            format!("tail -n 50 -f '{}' 2>&1", source_clone.replace('\'', r"'\''"))
        } else {
            // journalctl unit
            format!("journalctl -u '{}' -f -n 50 --no-pager 2>&1", source_clone)
        };

        // Execute and stream output in chunks
        let state_ref = app_clone.state::<AppState>();
        let (initial_out, _) = run_cmd(&state_ref, &conn_id_clone, &cmd).await;

        // Check if stream was stopped before we got output
        if !ACTIVE_STREAMS.lock().get(&stream_id_clone).copied().unwrap_or(false) {
            return;
        }

        if !initial_out.is_empty() {
            let _ = app_clone.emit("log-stream-data", serde_json::json!({
                "stream_id": stream_id_clone,
                "data": initial_out,
                "done": true,
            }));
        }

        ACTIVE_STREAMS.lock().remove(&stream_id_clone);
    });

    Ok(())
}

#[tauri::command]
pub async fn logs_stream_stop(
    _state: tauri::State<'_, AppState>,
    stream_id: String,
) -> Result<(), String> {
    ACTIVE_STREAMS.lock().remove(&stream_id);
    log::info!("SSH Desktop: Log stream {} stopped", stream_id);
    Ok(())
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

    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Err("dmesg returned no output. This may require root privileges.".into())
}
