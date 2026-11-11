use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use super::types::DatabaseConnectionConfig;

pub async fn setup_ssh_tunnel(
    config: &DatabaseConnectionConfig,
    app_state: &crate::AppState,
) -> Result<(u16, oneshot::Sender<()>), String> {
    let target_host = if config.host.trim().is_empty() {
        "127.0.0.1".to_string()
    } else {
        config.host.trim().to_string()
    };
    let target_port = config.port;
    if target_host.len() > 253 || target_host.chars().any(|c| c.is_control() || c.is_whitespace())
        || target_port == 0
    {
        return Err("Invalid database tunnel target host or port.".into());
    }

    let ssh_conn_id = config.ssh_connection_id.as_deref()
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "Select an SSH connection for this database tunnel.".to_string())?
        .to_string();

    // Resolve only the explicitly selected SSH session; never borrow an unrelated session.
    let mut maybe_handle = {
        let lock = app_state.sessions.lock().await;
        lock.get(&ssh_conn_id).cloned()
    };

    // 2. Resolve SSH connection configuration from memory or disk
    let maybe_conn = crate::ssh::connection::resolve_connection(app_state, &ssh_conn_id);
    let conn = maybe_conn.as_ref().ok_or_else(|| format!("SSH connection '{}' could not be resolved.", ssh_conn_id))?;
    let is_key_auth = match conn.config.auth_method.as_deref() {
        Some("password") => false,
        Some("key") => true,
        _ => conn.config.private_key_path.is_some() || conn.config.password.is_none(),
    };
    let selected_key_path = if is_key_auth { conn.config.private_key_path.as_deref() } else { None };
    if let Some(key_path) = selected_key_path {
        if crate::ssh::connection::resolve_key_path(key_path).is_none() {
            return Err(format!("Selected SSH identity '{}' could not be found.", key_path));
        }
    }
    if !is_key_auth && conn.config.password.as_deref().map(|p| p.is_empty()).unwrap_or(true) {
        return Err("Password authentication was selected, but no SSH password is configured.".into());
    }

    // 3. Try lazy in-memory persistent SSH session establishment if not already active
    if maybe_handle.is_none() {
        if let Some(ref conn) = maybe_conn {
            let is_ppk = selected_key_path.map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
            if !is_ppk {
                if let Ok(new_handle) = crate::ssh::session::connect_session_with_passphrase_auth(
                    &conn.config.host,
                    conn.config.port,
                    &conn.config.username,
                    if is_key_auth { None } else { conn.config.password.as_deref() },
                    selected_key_path,
                    conn.config.passphrase.as_deref(),
                    conn.config.auth_method.as_deref() != Some("password"),
                ).await {
                    let arc_h = Arc::new(new_handle);
                    {
                        let mut lock = app_state.sessions.lock().await;
                        lock.insert(conn.id.clone(), arc_h.clone());
                        lock.entry("default".to_string()).or_insert_with(|| arc_h.clone());
                    }
                    maybe_handle = Some(arc_h);
                }
            }
        }
    }

    // ── PATH A: Native high-performance async multiplexed tunnel via russh ───
    if let Some(handle) = maybe_handle {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local tunnel port: {}", e))?;
        let local_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to get local port: {}", e))?
            .port();

        let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
        let (cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
        let target_host_clone = target_host.clone();
        let conn_semaphore = Arc::new(tokio::sync::Semaphore::new(64));

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        let _ = cancel_tx.send(true);
                        log::info!("SSH direct-tcpip tunnel on port {} stopped", local_port);
                        break;
                    }
                    res = listener.accept() => {
                        match res {
                            Ok((mut local_stream, _)) => {
                                let permit = match conn_semaphore.clone().try_acquire_owned() {
                                    Ok(p) => p,
                                    Err(_) => {
                                        log::warn!("DB SSH tunnel concurrency limit (64) reached on port {}; dropping connection", local_port);
                                        continue;
                                    }
                                };
                                let h = handle.clone();
                                let r_host = target_host_clone.clone();
                                let mut task_cancel = cancel_rx.clone();
                                tokio::spawn(async move {
                                    let _permit = permit;
                                    match tokio::time::timeout(
                                        std::time::Duration::from_secs(15),
                                        h.channel_open_direct_tcpip(&r_host, target_port as u32, "127.0.0.1", local_port as u32),
                                    ).await {
                                        Ok(Ok(channel)) => {
                                            let mut ssh_stream = channel.into_stream();
                                            tokio::select! {
                                                _ = tokio::io::copy_bidirectional(&mut local_stream, &mut ssh_stream) => {}
                                                _ = task_cancel.changed() => {}
                                            }
                                        }
                                        Ok(Err(e)) => {
                                            log::error!("Failed to open direct-tcpip channel to {}:{}: {}", r_host, target_port, e);
                                        }
                                        Err(_) => {
                                            log::error!("Timed out opening direct-tcpip channel to {}:{}", r_host, target_port);
                                        }
                                    }
                                });
                            }
                            Err(e) => {
                                log::warn!("Listener error on tunnel port {}: {}", local_port, e);
                                break;
                            }
                        }
                    }
                }
            }
        });

        log::info!("SSH Desktop: Native SSH direct-tcpip tunnel established: 127.0.0.1:{} -> {}:{}", local_port, target_host, target_port);
        return Ok((local_port, shutdown_tx));
    }

    // ── PATH B: System SSH / PuTTY Plink Port Forwarding Fallback ────────────
    if let Some(conn) = maybe_conn.as_ref() {
        let local_port = {
            let l = TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Failed to allocate local port for SSH tunnel: {}", e))?;
            l.local_addr().map_err(|e| e.to_string())?.port()
        };

        let is_ppk = selected_key_path.map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
        let plink_bin = crate::ssh::connection::get_plink_path();
        let plink_available = plink_bin != "plink" || std::path::Path::new(plink_bin).exists();
        let password_file = if !is_key_auth {
            if !plink_available {
                return Err("PuTTY Plink is required for password-authenticated database tunnels but was not found.".into());
            }
            conn.config.password.as_deref().filter(|p| !p.is_empty())
                .map(crate::ssh::connection::create_password_file).transpose()?
        } else {
            None
        };
        if is_ppk && !plink_available {
            return Err("PuTTY Plink is required for this PPK database tunnel but was not found.".into());
        }

        let mut cmd = if is_ppk || password_file.is_some() {
            let mut c = tokio::process::Command::new(plink_bin);
    c.kill_on_drop(true);
            #[cfg(windows)]
            c.creation_flags(0x08000000); // CREATE_NO_WINDOW
            c.arg("-ssh")
             .arg("-batch")
             .arg("-N")
             .arg("-P").arg(conn.config.port.to_string())
             .arg("-L").arg(format!("{}:{}:{}", local_port, target_host, target_port))
             .arg("-l").arg(&conn.config.username);
            if let Some(ppk) = selected_key_path {
                c.arg("-i").arg(ppk);
            }
            if let Some(ref password_file) = password_file {
                c.arg("-pwfile").arg(password_file.path());
            }
            c.arg(&conn.config.host);
            c
        } else {
            let mut c = tokio::process::Command::new("ssh");
    c.kill_on_drop(true);
            #[cfg(windows)]
            c.creation_flags(0x08000000); // CREATE_NO_WINDOW
            c.arg("-N")
             .arg("-p").arg(conn.config.port.to_string())
             .arg("-L").arg(format!("{}:{}:{}", local_port, target_host, target_port))
             .arg("-o").arg("StrictHostKeyChecking=yes")
             .arg("-o").arg("IdentitiesOnly=yes")
             .arg("-o").arg("ExitOnForwardFailure=yes");
            if let Some(key) = selected_key_path {
                c.arg("-i").arg(key);
            }
            c.arg(format!("{}@{}", conn.config.username, conn.config.host));
            c
        };

        cmd.stdin(std::process::Stdio::null())
           .stdout(std::process::Stdio::null())
           .stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn()
            .map_err(|e| format!("Failed to spawn SSH tunnel command: {}", e))?;

        // Give the background process a moment to establish the listening port
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;

        if let Ok(Some(status)) = child.try_wait() {
            let mut err_msg = format!("SSH tunnel process exited immediately (code: {})", status);
            if let Some(mut stderr) = child.stderr.take() {
                let mut buf = Vec::new();
                let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut buf).await;
                let s = String::from_utf8_lossy(&buf).trim().to_string();
                if !s.is_empty() {
                    err_msg = format!("SSH tunnel failed: {}", s);
                }
            }
            return Err(err_msg);
        }

        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        tokio::spawn(async move {
            // Keep the protected password file alive for the full lifetime of Plink.
            let _password_file = password_file;
            let _ = shutdown_rx.await;
            log::info!("Killing background SSH tunnel process on port {}", local_port);
            let _ = child.kill().await;
        });

        log::info!("SSH Desktop: Process SSH tunnel established: 127.0.0.1:{} -> {}:{}", local_port, target_host, target_port);
        return Ok((local_port, shutdown_tx));
    }

    // ── PATH C: No SSH Connection Found ─────────────────────────────────────
    Err(format!(
        "SSH Tunnel Error: No active SSH server connection found in SSH Desktop for '{}'. Please connect to your server via SSH first before using SSH Tunneling.",
        ssh_conn_id
    ))
}

pub fn from_base64(s: &str) -> Option<Vec<u8>> {
    let clean: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if clean.is_empty() {
        return Some(Vec::new());
    }
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    let decode_val = |b: u8| -> Option<u8> {
        match b {
            b'A'..=b'Z' => Some(b - b'A'),
            b'a'..=b'z' => Some(b - b'a' + 26),
            b'0'..=b'9' => Some(b - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    for chunk in clean.chunks(4) {
        if chunk.len() < 2 {
            break;
        }
        let c0 = decode_val(chunk[0])?;
        let c1 = decode_val(chunk[1])?;
        out.push((c0 << 2) | (c1 >> 4));
        if chunk.len() > 2 && chunk[2] != b'=' {
            let c2 = decode_val(chunk[2])?;
            out.push(((c1 & 0x0f) << 4) | (c2 >> 2));
            if chunk.len() > 3 && chunk[3] != b'=' {
                let c3 = decode_val(chunk[3])?;
                out.push(((c2 & 0x03) << 6) | c3);
            }
        }
    }
    Some(out)
}
