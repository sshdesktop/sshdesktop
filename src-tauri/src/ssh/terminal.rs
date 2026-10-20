use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use crate::AppState;

#[derive(Clone)]
pub struct TerminalSession {
    pub id: String,
    pub conn_id: String,
    pub rows: u16,
    pub cols: u16,
    pub created_at: i64,
    pub tx: Option<UnboundedSender<Vec<u8>>>,
    pub child_pid: Option<u32>,
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
    terminal_id: Option<String>,
) -> Result<String, String> {
    let term_id = terminal_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    // Find connection config (RAM, disk auto-restore, or fallback)
    let conn = match crate::ssh::connection::resolve_connection(&state, &conn_id) {
        Some(c) => c,
        None => return Err(format!("Connection {} not found", conn_id)),
    };

    let host = conn.config.host.clone();
    let port = conn.config.port.to_string();
    let user = conn.config.username.clone();
    let password = conn.config.password.clone();
    let private_key = conn.config.private_key_path.clone();

    // Check for plink.exe (PuTTY CLI)
    let plink_path = if std::path::Path::new(r"C:\Program Files\PuTTY\plink.exe").exists() {
        r"C:\Program Files\PuTTY\plink.exe"
    } else {
        "plink"
    };

    // Prepare interactive command
    let is_ppk = private_key.as_deref().map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    let mut cmd = if password.is_some() && !password.as_ref().unwrap().is_empty() {
        let mut c = tokio::process::Command::new(plink_path);
        c.arg("-ssh")
            .arg("-t") // Force pseudo-terminal
            .arg("-P")
            .arg(&port)
            .arg("-l")
            .arg(&user)
            .arg("-pw")
            .arg(password.as_ref().unwrap())
            .arg(&host);
        c
    } else if is_ppk {
        let mut c = tokio::process::Command::new(plink_path);
        c.arg("-ssh")
            .arg("-t")
            .arg("-P")
            .arg(&port)
            .arg("-l")
            .arg(&user);
        if let Some(ref k) = private_key {
            if crate::ssh::connection::resolve_key_path(k).is_some() {
                c.arg("-i").arg(k);
            }
        }
        c.arg(&host);
        c
    } else {
        let mut c = tokio::process::Command::new("ssh");
        c.arg("-tt")
            .arg("-p")
            .arg(&port)
            .arg("-o")
            .arg("StrictHostKeyChecking=no")
            .arg("-o")
            .arg("IdentitiesOnly=yes")
            .arg("-o")
            .arg("ConnectTimeout=10");
        if let Some(ref k) = private_key {
            if crate::ssh::connection::resolve_key_path(k).is_some() {
                c.arg("-i").arg(k);
            }
        }
        c.arg(format!("{}@{}", user, host));
        c
    };

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    log::info!("CloudDesk: Spawning interactive terminal PTY for {}@{}:{}", user, host, port);

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn SSH process: {}", e))?;
    let child_pid = child.id();

    let mut stdin = child.stdin.take().ok_or("Failed to open child stdin")?;
    let mut stdout = child.stdout.take().ok_or("Failed to open child stdout")?;
    let mut stderr = child.stderr.take().ok_or("Failed to open child stderr")?;

    let (tx, mut rx) = unbounded_channel::<Vec<u8>>();

    // Stdin Pump
    tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            if stdin.write_all(&data).await.is_err() {
                break;
            }
            let _ = stdin.flush().await;
        }
    });

    // Stdout Pump
    let app_out = app.clone();
    let term_id_out = term_id.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let _ = app_out.emit("terminal-output", TerminalOutput {
                        terminal_id: term_id_out.clone(),
                        data: buf[..n].to_vec(),
                        text: None,
                    });
                }
                Err(_) => break,
            }
        }
        let exit_msg = "\r\n\x1b[33m[Session disconnected]\x1b[0m\r\n";
        let _ = app_out.emit("terminal-output", TerminalOutput {
            terminal_id: term_id_out,
            data: exit_msg.as_bytes().to_vec(),
            text: Some(exit_msg.to_string()),
        });
    });

    // Stderr Pump
    let app_err = app.clone();
    let term_id_err = term_id.clone();
    tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => {
                    let _ = app_err.emit("terminal-output", TerminalOutput {
                        terminal_id: term_id_err.clone(),
                        data: buf[..n].to_vec(),
                        text: None,
                    });
                }
                Err(_) => break,
            }
        }
    });

    let session = TerminalSession {
        id: term_id.clone(),
        conn_id: conn_id.clone(),
        rows,
        cols,
        created_at: chrono::Utc::now().timestamp(),
        tx: Some(tx),
        child_pid,
    };

    state.terminals.lock().insert(term_id.clone(), session);

    // Initial banner
    let banner = format!("\x1b[1;32m[CloudDesk PuTTY-Grade PTY]\x1b[0m Connected to \x1b[1m{}@{}\x1b[0m\r\n\r\n", user, host);
    let _ = app.emit("terminal-output", TerminalOutput {
        terminal_id: term_id.clone(),
        data: banner.as_bytes().to_vec(),
        text: Some(banner),
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
    let tx_opt = {
        let terms = state.terminals.lock();
        terms.get(&terminal_id).and_then(|s| s.tx.clone())
    };

    if let Some(tx) = tx_opt {
        tx.send(data).map_err(|e| format!("Failed to send data to terminal: {}", e))?;
        Ok(())
    } else {
        Err(format!("Terminal session {} not found or closed", terminal_id))
    }
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
    }
    Ok(())
}

#[tauri::command]
pub async fn terminal_close(
    state: tauri::State<'_, AppState>,
    terminal_id: String,
) -> Result<(), String> {
    if let Some(session) = state.terminals.lock().remove(&terminal_id) {
        if let Some(pid) = session.child_pid {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = std::process::Command::new("taskkill")
                    .args(&["/F", "/T", "/PID", &pid.to_string()])
                    .creation_flags(0x08000000)
                    .output();
            }
        }
    }
    log::info!("CloudDesk: Terminal PTY session closed: {}", terminal_id);
    Ok(())
}

#[tauri::command]
pub async fn ssh_launch_putty(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    remote_dir: Option<String>,
) -> Result<(), String> {
    let conn = match crate::ssh::connection::resolve_connection(&state, &conn_id) {
        Some(c) => c,
        None => return Err(format!("Connection {} not found", conn_id)),
    };

    let putty_path = if std::path::Path::new(r"C:\Program Files\PuTTY\putty.exe").exists() {
        r"C:\Program Files\PuTTY\putty.exe"
    } else {
        "putty"
    };

    let mut cmd = std::process::Command::new(putty_path);
    cmd.arg("-ssh")
        .arg("-P")
        .arg(conn.config.port.to_string())
        .arg("-l")
        .arg(&conn.config.username);

    if let Some(ref pwd) = conn.config.password {
        if !pwd.is_empty() {
            cmd.arg("-pw").arg(pwd);
        }
    }

    if let Some(ref key) = conn.config.private_key_path {
        if !key.is_empty() {
            cmd.arg("-i").arg(key);
        }
    }

    // If remote directory specified, create startup script to cd to that location
    if let Some(ref dir) = remote_dir {
        if !dir.is_empty() && dir != "/" {
            let temp_dir = std::env::temp_dir();
            let script_file = temp_dir.join(format!("clouddesk_dir_{}.sh", uuid::Uuid::new_v4()));
            let script_body = format!("cd '{}' 2>/dev/null || cd ~; exec $SHELL -l\n", dir.replace('\'', r"'\''"));
            if std::fs::write(&script_file, script_body).is_ok() {
                cmd.arg("-m").arg(&script_file);
            }
        }
    }

    cmd.arg(&conn.config.host);

    cmd.spawn().map_err(|e| format!("Failed to launch PuTTY: {}", e))?;
    Ok(())
}

