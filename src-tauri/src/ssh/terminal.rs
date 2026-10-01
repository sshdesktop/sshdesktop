use serde::{Deserialize, Serialize};
use tauri::Emitter;
use crate::AppState;

#[derive(Clone, Debug)]
pub struct TerminalSession {
    pub id: String,
    pub conn_id: String,
    pub rows: u16,
    pub cols: u16,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TerminalOutput {
    pub terminal_id: String,
    pub data: Vec<u8>,
    pub text: Option<String>,
}

#[tauri::command]
pub async fn terminal_create(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conn_id: String,
    rows: u16,
    cols: u16,
) -> Result<String, String> {
    let term_id = uuid::Uuid::new_v4().to_string();
    let session = TerminalSession {
        id: term_id.clone(),
        conn_id: conn_id.clone(),
        rows,
        cols,
        created_at: chrono::Utc::now().timestamp(),
    };

    state.terminals.lock().insert(term_id.clone(), session);
    log::info!("CloudDesk: Terminal PTY session created: {}", term_id);

    // Emit initial welcome text to frontend
    let welcome = format!("\x1b[1;32m[CloudDesk]\x1b[0m Connected to terminal session {}\r\n", term_id);
    let _ = app.emit("terminal-output", TerminalOutput {
        terminal_id: term_id.clone(),
        data: welcome.as_bytes().to_vec(),
        text: Some(welcome),
    });

    Ok(term_id)
}

#[tauri::command]
pub async fn terminal_write(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    terminal_id: String,
    data: Vec<u8>,
) -> Result<(), String> {
    let session = {
        let terms = state.terminals.lock();
        terms.get(&terminal_id).cloned()
    };

    let session = match session {
        Some(s) => s,
        None => return Err(format!("Terminal session {} not found", terminal_id)),
    };

    let input_str = String::from_utf8_lossy(&data).to_string();

    // Execute command on the remote server
    let trimmed = input_str.trim();
    if !trimmed.is_empty() {
        let (output, _code) = crate::ssh::exec::run_cmd(&state, &session.conn_id, trimmed).await;
        let formatted = if output.is_empty() {
            format!("\r\n")
        } else {
            format!("{}\r\n", output.replace('\r', "").replace('\n', "\r\n"))
        };

        let _ = app.emit("terminal-output", TerminalOutput {
            terminal_id: terminal_id.clone(),
            data: formatted.as_bytes().to_vec(),
            text: Some(formatted),
        });
        return Ok(());
    }

    // Default local / echo fallback
    let echo = input_str.replace('\r', "").replace('\n', "\r\n");
    let _ = app.emit("terminal-output", TerminalOutput {
        terminal_id,
        data: echo.as_bytes().to_vec(),
        text: Some(echo),
    });

    Ok(())
}

#[tauri::command]
pub async fn terminal_resize(
    state: tauri::State<'_, AppState>,
    terminal_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    if let Some(term) = state.terminals.lock().get_mut(&terminal_id) {
        term.rows = rows;
        term.cols = cols;
        log::debug!("Terminal {} resized to {}x{}", terminal_id, cols, rows);
    }
    Ok(())
}

#[tauri::command]
pub async fn terminal_close(
    state: tauri::State<'_, AppState>,
    terminal_id: String,
) -> Result<(), String> {
    state.terminals.lock().remove(&terminal_id);
    log::info!("CloudDesk: Terminal PTY session closed: {}", terminal_id);
    Ok(())
}
