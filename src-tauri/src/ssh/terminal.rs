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

    // Ensure clean replacement if session id is reused (prevents duplicate pumps/listeners)
    if let Some(prev) = state.terminals.lock().remove(&term_id) {
        if let Some(pid) = prev.child_pid {
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

    let auth_method = conn.config.auth_method.as_deref().unwrap_or("password");
    let is_key_auth = auth_method == "key" || private_key.is_some();
    let is_ppk = private_key.as_deref().map(crate::ssh::connection::is_ppk_key).unwrap_or(false);

    // Ensure key file exists on disk
    let resolved_key_path = if let Some(ref k) = private_key {
        crate::ssh::connection::ensure_key_file(&conn_id, k)
    } else {
        None
    };

    // ── 0. Fast TCP Connectivity Probe (3.5s timeout) ─────────────────────────
    // Avoid misleading "Connected" messages when port 22 is unreachable or offline
    let target_addr = format!("{}:{}", host, port);
    let banner_init = format!("\x1b[1;36m[SSH Desktop Terminal]\x1b[0m Connecting to \x1b[1m{}@{}:{}\x1b[0m...\r\n", user, host, port);
    let _ = app.emit("terminal-output", TerminalOutput {
        terminal_id: term_id.clone(),
        data: banner_init.as_bytes().to_vec(),
        text: Some(banner_init),
    });

    match tokio::time::timeout(
        std::time::Duration::from_millis(3500),
        tokio::net::TcpStream::connect(&target_addr),
    ).await {
        Ok(Ok(_sock)) => {
            log::info!("SSH Desktop: TCP connect succeeded to {}", target_addr);
        }
        Ok(Err(e)) => {
            let diag = format!(
                "\r\n\x1b[1;31m[Network Error]\x1b[0m Failed to reach \x1b[1m{} on port {}\x1b[0m: {}\r\n\r\n\
                 \x1b[1;33mCommon reasons for AWS EC2 ({}) connection failures:\x1b[0m\r\n\
                 \x1b[36m1. AWS Security Group:\x1b[0m In AWS EC2 console -> Security Groups -> Inbound Rules:\r\n\
                    Add rule for \x1b[32mSSH (TCP Port 22)\x1b[0m with source \x1b[32m0.0.0.0/0\x1b[0m (or your current IP).\r\n\
                 \x1b[36m2. Instance State:\x1b[0m Check AWS Console - is the EC2 instance in 'Running' state?\r\n\
                 \x1b[36m3. Public IP Changed:\x1b[0m If the instance was stopped and restarted, AWS assigns a new Public IP.\r\n\
                    Update the IP in SSH Desktop (Edit Server Details).\r\n\r\n\
                 \x1b[90m[Process exited]\x1b[0m\r\n",
                host, port, e, host
            );
            let _ = app.emit("terminal-output", TerminalOutput {
                terminal_id: term_id.clone(),
                data: diag.as_bytes().to_vec(),
                text: Some(diag),
            });
            return Ok(term_id);
        }
        Err(_) => {
            let diag = format!(
                "\r\n\x1b[1;31m[Connection Timed Out]\x1b[0m Server \x1b[1m{}:{}\x1b[0m did not respond within 3.5s.\r\n\r\n\
                 \x1b[1;33mCommon reasons for AWS EC2 ({}) connection timeout:\x1b[0m\r\n\
                 \x1b[36m1. AWS Security Group:\x1b[0m In AWS EC2 console -> Security Groups -> Inbound Rules:\r\n\
                    Add rule for \x1b[32mSSH (TCP Port 22)\x1b[0m with source \x1b[32m0.0.0.0/0\x1b[0m (or your current IP).\r\n\
                 \x1b[36m2. Instance State:\x1b[0m Check AWS Console - is the EC2 instance in 'Running' state?\r\n\
                 \x1b[36m3. Public IP Changed:\x1b[0m If the instance was stopped and restarted, AWS assigns a new Public IP.\r\n\
                    Update the IP in SSH Desktop (Edit Server Details).\r\n\r\n\
                 \x1b[90m[Process timed out]\x1b[0m\r\n",
                host, port, host
            );
            let _ = app.emit("terminal-output", TerminalOutput {
                terminal_id: term_id.clone(),
                data: diag.as_bytes().to_vec(),
                text: Some(diag),
            });
            return Ok(term_id);
        }
    }

    // ── 1. Fast Path: Native In-Memory SSH Transport PTY (russh) ────────────
    // Checks for existing active session or creates a new high-performance russh session.
    // Native SSH channel request_pty + request_shell bypasses all Windows ConPTY limitations,
    // host key prompt blocks, and external plink/ssh process spawns.
    if !is_ppk {
        let handle_opt = {
            let sessions = state.sessions.lock().await;
            sessions.get(&conn_id).cloned().or_else(|| {
                if conn_id == "default" || conn_id.is_empty() {
                    sessions.get("default").cloned().or_else(|| sessions.values().next().cloned())
                } else {
                    None
                }
            })
        };

        let handle = match handle_opt {
            Some(h) => Some(h),
            None => {
                let key_str = resolved_key_path.as_deref().or(private_key.as_deref());
                match crate::ssh::session::connect_session(
                    &host,
                    conn.config.port,
                    &user,
                    password.as_deref(),
                    key_str,
                ).await {
                    Ok(new_handle) => {
                        let arc_h = std::sync::Arc::new(new_handle);
                        let mut sessions = state.sessions.lock().await;
                        sessions.insert(conn_id.clone(), arc_h.clone());
                        sessions.insert("default".to_string(), arc_h.clone());
                        Some(arc_h)
                    }
                    Err(e) => {
                        log::warn!("SSH Desktop: russh on-demand connect failed for {}: {}", host, e);
                        None
                    }
                }
            }
        };

        if let Some(h) = handle {
            match crate::ssh::session::open_pty_shell(&h, "xterm-256color", cols as u32, rows as u32).await {
                Ok((mut reader, mut writer)) => {
                    log::info!("SSH Desktop: Native russh interactive PTY shell opened for {}@{}:{}", user, host, port);
                    let (tx, mut rx) = unbounded_channel::<Vec<u8>>();

                    // Stdin / Writer Pump
                    tokio::spawn(async move {
                        while let Some(data) = rx.recv().await {
                            if writer.write_all(&data).await.is_err() {
                                break;
                            }
                            let _ = writer.flush().await;
                        }
                    });

                    // Stdout / Reader Pump
                    let app_out = app.clone();
                    let term_id_out = term_id.clone();
                    tokio::spawn(async move {
                        let mut buf = [0u8; 4096];
                        loop {
                            match reader.read(&mut buf).await {
                                Ok(0) => break,
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

                    let session = TerminalSession {
                        id: term_id.clone(),
                        conn_id: conn_id.clone(),
                        rows,
                        cols,
                        created_at: chrono::Utc::now().timestamp(),
                        tx: Some(tx),
                        child_pid: None,
                    };
                    state.terminals.lock().insert(term_id.clone(), session);
                    return Ok(term_id);
                }
                Err(e) => {
                    log::warn!("SSH Desktop: Native russh PTY request failed for {}: {}, falling back...", host, e);
                }
            }
        }
    }

    // ── 2. Fallback Path: CLI PTY process (plink or openssh) ────────────────
    crate::ssh::connection::cleanup_putty_host_key(&host, &port);

    let mut cmd = if is_key_auth {
        if is_ppk {
            let mut c = tokio::process::Command::new(plink_path);
            c.arg("-ssh")
                .arg("-t")
                .arg("-P").arg(&port)
                .arg("-l").arg(&user);
            if let Some(ref k) = resolved_key_path {
                c.arg("-i").arg(k);
            }
            c.arg(&host);
            c
        } else {
            let mut c = tokio::process::Command::new("ssh");
            c.arg("-tt")
                .arg("-p").arg(&port)
                .arg("-o").arg("StrictHostKeyChecking=no")
                .arg("-o").arg(if cfg!(windows) { "UserKnownHostsFile=NUL" } else { "UserKnownHostsFile=/dev/null" })
                .arg("-o").arg("IdentitiesOnly=yes")
                .arg("-o").arg("ConnectTimeout=10");
            if let Some(ref k) = resolved_key_path {
                c.arg("-i").arg(k);
            }
            c.arg(format!("{}@{}", user, host));
            c
        }
    } else if password.as_ref().map(|s| !s.is_empty()).unwrap_or(false) {
        let mut c = tokio::process::Command::new(plink_path);
        c.arg("-ssh")
            .arg("-t") // Force pseudo-terminal
            .arg("-P").arg(&port)
            .arg("-l").arg(&user)
            .arg("-pw").arg(password.as_ref().unwrap())
            .arg(&host);
        c
    } else {
        let mut c = tokio::process::Command::new("ssh");
        c.arg("-tt")
            .arg("-p").arg(&port)
            .arg("-o").arg("StrictHostKeyChecking=no")
            .arg("-o").arg(if cfg!(windows) { "UserKnownHostsFile=NUL" } else { "UserKnownHostsFile=/dev/null" })
            .arg("-o").arg("ConnectTimeout=10");
        c.arg(format!("{}@{}", user, host));
        c
    };

    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    log::info!("SSH Desktop: Spawning interactive terminal PTY for {}@{}:{}", user, host, port);

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
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let formatted = format!("\x1b[31m{}\x1b[0m", text.replace("\r\n", "\n").replace('\n', "\r\n"));
                    let _ = app_err.emit("terminal-output", TerminalOutput {
                        terminal_id: term_id_err.clone(),
                        data: formatted.as_bytes().to_vec(),
                        text: Some(formatted),
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
    log::info!("SSH Desktop: Terminal PTY session closed: {}", terminal_id);
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

    crate::ssh::connection::cleanup_putty_host_key(&conn.config.host, &conn.config.port.to_string());

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
            let script_file = temp_dir.join(format!("sshdesktop_dir_{}.sh", uuid::Uuid::new_v4()));
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

