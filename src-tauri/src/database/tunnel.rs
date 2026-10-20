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

    let ssh_conn_id = config.ssh_connection_id.clone().unwrap_or_else(|| "default".to_string());

    // 1. Check if we have an active russh session in state.sessions
    let mut maybe_handle = {
        let lock = app_state.sessions.lock().await;
        lock.get(&ssh_conn_id).cloned()
            .or_else(|| lock.get("default").cloned())
            .or_else(|| lock.values().next().cloned())
    };

    // 2. Resolve SSH connection configuration from memory or disk
    let maybe_conn = crate::ssh::connection::resolve_connection(app_state, &ssh_conn_id);

    // 3. Try lazy in-memory persistent SSH session establishment if not already active
    if maybe_handle.is_none() {
        if let Some(ref conn) = maybe_conn {
            let is_ppk = conn.config.private_key_path.as_deref().map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
            if !is_ppk {
                if let Ok(new_handle) = crate::ssh::session::connect_session(
                    &conn.config.host,
                    conn.config.port,
                    &conn.config.username,
                    conn.config.password.as_deref(),
                    conn.config.private_key_path.as_deref(),
                ).await {
                    let arc_h = Arc::new(new_handle);
                    {
                        let mut lock = app_state.sessions.lock().await;
                        lock.insert(conn.id.clone(), arc_h.clone());
                        lock.insert("default".to_string(), arc_h.clone());
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
        let target_host_clone = target_host.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => {
                        log::info!("SSH direct-tcpip tunnel on port {} stopped", local_port);
                        break;
                    }
                    res = listener.accept() => {
                        match res {
                            Ok((mut local_stream, _)) => {
                                let h = handle.clone();
                                let r_host = target_host_clone.clone();
                                tokio::spawn(async move {
                                    match h.channel_open_direct_tcpip(&r_host, target_port as u32, "127.0.0.1", local_port as u32).await {
                                        Ok(channel) => {
                                            let mut ssh_stream = channel.into_stream();
                                            let _ = tokio::io::copy_bidirectional(&mut local_stream, &mut ssh_stream).await;
                                        }
                                        Err(e) => {
                                            log::error!("Failed to open direct-tcpip channel to {}:{}: {}", r_host, target_port, e);
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
    if let Some(conn) = maybe_conn {
        let local_port = {
            let l = TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Failed to allocate local port for SSH tunnel: {}", e))?;
            l.local_addr().map_err(|e| e.to_string())?.port()
        };

        let is_ppk = conn.config.private_key_path.as_deref().map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
        let plink_bin = crate::ssh::connection::get_plink_path();

        let mut cmd = if is_ppk || conn.config.password.is_some() {
            let mut c = tokio::process::Command::new(plink_bin);
            #[cfg(windows)]
            c.creation_flags(0x08000000); // CREATE_NO_WINDOW
            c.arg("-ssh")
             .arg("-batch")
             .arg("-N")
             .arg("-P").arg(conn.config.port.to_string())
             .arg("-L").arg(format!("{}:{}:{}", local_port, target_host, target_port))
             .arg("-l").arg(&conn.config.username);
            if let Some(ref ppk) = conn.config.private_key_path {
                c.arg("-i").arg(ppk);
            }
            if let Some(ref pwd) = conn.config.password {
                if !pwd.is_empty() {
                    c.arg("-pw").arg(pwd);
                }
            }
            c.arg(&conn.config.host);
            c
        } else {
            let mut c = tokio::process::Command::new("ssh");
            #[cfg(windows)]
            c.creation_flags(0x08000000); // CREATE_NO_WINDOW
            c.arg("-N")
             .arg("-p").arg(conn.config.port.to_string())
             .arg("-L").arg(format!("{}:{}:{}", local_port, target_host, target_port))
             .arg("-o").arg("StrictHostKeyChecking=no")
             .arg("-o").arg(if cfg!(windows) { "UserKnownHostsFile=NUL" } else { "UserKnownHostsFile=/dev/null" })
             .arg("-o").arg("IdentitiesOnly=yes")
             .arg("-o").arg("ExitOnForwardFailure=yes");
            if let Some(ref key) = conn.config.private_key_path {
                if crate::ssh::connection::resolve_key_path(key).is_some() {
                    c.arg("-i").arg(key);
                }
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
