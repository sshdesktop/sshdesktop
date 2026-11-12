use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::Mutex;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TunnelInfo {
    pub tunnel_id: String,
    pub conn_id: String,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub created_at: i64,
}

pub struct ActiveTunnel {
    pub info: TunnelInfo,
    pub child: Option<tokio::process::Child>,
    pub shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
    pub task_alive: Option<Arc<std::sync::atomic::AtomicBool>>,
    pub password_file: Option<Arc<crate::ssh::connection::SshPasswordFile>>,
}

const MAX_SOCKS5_CONCURRENT_STREAMS: usize = 64;

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn validate_socks5_credentials(
    offered_user: &[u8],
    offered_pass: &[u8],
    expected_user: &str,
    expected_pass: &str,
) -> bool {
    constant_time_eq(offered_user, expected_user.as_bytes())
        && constant_time_eq(offered_pass, expected_pass.as_bytes())
}

fn is_cloud_metadata_target(host: &str) -> bool {
    let normalized = host.trim_matches(|ch| ch == '[' || ch == ']').trim_end_matches('.').to_ascii_lowercase();
    if matches!(normalized.as_str(), "metadata.google.internal" | "metadata") {
        return true;
    }

    match normalized.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(ip)) => {
            ip == std::net::Ipv4Addr::new(169, 254, 169, 254)
                || ip == std::net::Ipv4Addr::new(169, 254, 170, 2)
        }
        Ok(std::net::IpAddr::V6(ip)) => {
            ip.to_string() == "fd00:ec2::254"
                || ip.to_ipv4_mapped().map(|mapped| {
                    mapped == std::net::Ipv4Addr::new(169, 254, 169, 254)
                        || mapped == std::net::Ipv4Addr::new(169, 254, 170, 2)
                }).unwrap_or(false)
        }
        Err(_) => false,
    }
}

async fn handle_socks5_client(
    stream: &mut tokio::net::TcpStream,
    handle: &Arc<crate::ssh::session::ClientHandle>,
    local_port: u16,
    auth: Option<&(String, String)>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    // Bound negotiation with 10-second timeout to prevent hung clients
    let (target_host, target_port) = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        // 1. Negotiation
        let mut header = [0u8; 2];
        stream.read_exact(&mut header).await?;
        if header[0] != 0x05 {
            return Err("Not SOCKS5".into());
        }
        let nmethods = header[1] as usize;
        if nmethods == 0 {
            let _ = stream.write_all(&[0x05, 0xFF]).await;
            return Err("SOCKS5 client offered no authentication methods".into());
        }
        let mut methods = vec![0u8; nmethods];
        stream.read_exact(&mut methods).await?;

        if let Some((expected_user, expected_pass)) = auth {
            // Require RFC 1929 Username/Password authentication (method 0x02)
            if !methods.contains(&0x02) {
                let _ = stream.write_all(&[0x05, 0xFF]).await;
                return Err("SOCKS5 authentication (RFC 1929 0x02) is required".into());
            }
            stream.write_all(&[0x05, 0x02]).await?;

            let mut sub_hdr = [0u8; 2];
            stream.read_exact(&mut sub_hdr).await?;
            if sub_hdr[0] != 0x01 {
                let _ = stream.write_all(&[0x01, 0x01]).await;
                return Err("Unsupported SOCKS5 auth subnegotiation version".into());
            }
            let ulen = sub_hdr[1] as usize;
            if ulen == 0 {
                let _ = stream.write_all(&[0x01, 0x01]).await;
                return Err("SOCKS5 username must not be empty".into());
            }
            let mut ubuf = vec![0u8; ulen];
            stream.read_exact(&mut ubuf).await?;
            let mut plen_buf = [0u8; 1];
            stream.read_exact(&mut plen_buf).await?;
            let password_len = plen_buf[0] as usize;
            if password_len == 0 {
                let _ = stream.write_all(&[0x01, 0x01]).await;
                return Err("SOCKS5 password must not be empty".into());
            }
            let mut pbuf = vec![0u8; password_len];
            stream.read_exact(&mut pbuf).await?;

            if !validate_socks5_credentials(&ubuf, &pbuf, expected_user, expected_pass) {
                let _ = stream.write_all(&[0x01, 0x01]).await;
                return Err("SOCKS5 username/password authentication failed".into());
            }
            stream.write_all(&[0x01, 0x00]).await?;
        } else {
            // RFC 1928: Verify client offered Method 0x00 (NO AUTHENTICATION REQUIRED)
            if !methods.contains(&0x00) {
                let _ = stream.write_all(&[0x05, 0xFF]).await; // 0xFF = NO ACCEPTABLE METHODS
                return Err("SOCKS5 client did not offer unauthenticated mode (0x00)".into());
            }
            // Reply: Version 5, Method 0 (No authentication required)
            stream.write_all(&[0x05, 0x00]).await?;
        }

        // 2. Request
        let mut req = [0u8; 4];
        stream.read_exact(&mut req).await?;
        if req[0] != 0x05 || req[1] != 0x01 { // 0x01 = CONNECT
            let _ = stream.write_all(&[0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
            return Err("Only SOCKS5 CONNECT is supported".into());
        }

        let target_host = match req[3] {
            1 => {
                // IPv4: 4 bytes
                let mut ip = [0u8; 4];
                stream.read_exact(&mut ip).await?;
                format!("{}.{}.{}.{}", ip[0], ip[1], ip[2], ip[3])
            }
            3 => {
                // Domain: 1 byte len + domain string
                let mut len = [0u8; 1];
                stream.read_exact(&mut len).await?;
                if len[0] == 0 {
                    let _ = stream.write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
                    return Err("SOCKS5 domain name cannot be empty".into());
                }
                let mut domain = vec![0u8; len[0] as usize];
                stream.read_exact(&mut domain).await?;
                let domain = String::from_utf8(domain)
                    .map_err(|_| "SOCKS5 domain name is not valid UTF-8")?;
                if domain.chars().any(|ch| ch.is_control() || ch.is_whitespace()) {
                    let _ = stream.write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
                    return Err("SOCKS5 domain name contains invalid characters".into());
                }
                domain
            }
            4 => {
                // IPv6: 16 bytes
                let mut ip = [0u8; 16];
                stream.read_exact(&mut ip).await?;
                use std::net::Ipv6Addr;
                Ipv6Addr::from(ip).to_string()
            }
            _ => {
                let _ = stream.write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
                return Err("Address type not supported".into());
            }
        };

        let mut port_buf = [0u8; 2];
        stream.read_exact(&mut port_buf).await?;
        let target_port = u16::from_be_bytes(port_buf);
        if target_port == 0 {
            let _ = stream.write_all(&[0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
            return Err("SOCKS5 destination port must be between 1 and 65535".into());
        }
        let policy = crate::store::audit::load_security_policy();
        if policy.block_metadata_egress && is_cloud_metadata_target(&target_host) {
            let _ = stream.write_all(&[0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
            return Err("SOCKS5 connection to cloud instance metadata endpoints is blocked by workspace security policy".into());
        }
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>((target_host, target_port))
    }).await.map_err(|_| "SOCKS5 client handshake timed out")??;

    // 3. Bound SSH channel creation so an unresponsive server cannot retain
    // an accepted SOCKS client indefinitely.
    let channel_result = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        handle.channel_open_direct_tcpip(&target_host, target_port as u32, "127.0.0.1", local_port as u32),
    ).await;
    match channel_result {
        Ok(Ok(channel)) => {
            // SOCKS5 success reply: 0x05 (ver), 0x00 (success), 0x00 (rsv), 0x01 (IPv4), 127.0.0.1:0
            stream.write_all(&[0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]).await?;
            let mut ssh_stream = channel.into_stream();
            let _ = tokio::io::copy_bidirectional(stream, &mut ssh_stream).await;
            Ok(())
        }
        Ok(Err(e)) => {
            let _ = stream.write_all(&[0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
            Err(e.into())
        }
        Err(_) => {
            let _ = stream.write_all(&[0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]).await;
            Err("SSH channel open timed out".into())
        }
    }
}

lazy_static! {
    static ref ACTIVE_TUNNELS: Mutex<HashMap<String, ActiveTunnel>> = Mutex::new(HashMap::new());
    static ref ACTIVE_SOCKS5: Mutex<HashMap<String, ActiveTunnel>> = Mutex::new(HashMap::new());
}

fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn find_available_port(preferred: u16) -> u16 {
    if preferred > 0 && is_port_available(preferred) {
        return preferred;
    }
    if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", 0)) {
        if let Ok(addr) = listener.local_addr() {
            return addr.port();
        }
    }
    if preferred > 0 { preferred } else { 18080 }
}

/// Start an SSH port forwarding tunnel: binds 127.0.0.1:local_port -> remote_host:remote_port (Local),
/// or remote_port -> 127.0.0.1:local_port (Remote), or SOCKS5 (Dynamic)
#[tauri::command]
pub async fn ssh_start_tunnel(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
    tunnel_type: Option<String>,
) -> Result<u16, String> {
    let ftype = tunnel_type.as_deref().unwrap_or("local").trim().to_ascii_lowercase();
    if !matches!(ftype.as_str(), "local" | "remote" | "reverse" | "-r" | "dynamic" | "socks" | "socks5") {
        return Err("Tunnel type must be local, remote, or dynamic SOCKS5.".into());
    }
    if ftype == "dynamic" || ftype == "socks" || ftype == "socks5" {
        return ssh_start_socks5(state, conn_id, Some(if local_port > 0 { local_port } else { 1080 }), None, None, None).await;
    }

    let is_remote_forward = ftype == "remote" || ftype == "reverse" || ftype == "-r";
    let tunnel_key = if is_remote_forward {
        format!("{}:remote:{}:{}:{}", conn_id, remote_host, remote_port, local_port)
    } else {
        format!("{}:local:{}:{}:{}", conn_id, local_port, remote_host, remote_port)
    };

    // 1. If an active tunnel for this server and remote port already exists, verify actual process/task health
    let mut stale_child_to_kill = None;
    let mut stale_shutdown_to_send = None;
    {
        let mut lock = ACTIVE_TUNNELS.lock();
        if let Some(active) = lock.get_mut(&tunnel_key) {
            let is_alive = if let Some(ref mut child) = active.child {
                match child.try_wait() {
                    Ok(None) => true,
                    _ => false,
                }
            } else if active.shutdown_tx.is_some() {
                active.task_alive.as_ref()
                    .map(|alive| alive.load(std::sync::atomic::Ordering::Acquire))
                    .unwrap_or(false)
            } else {
                false
            };

            if is_alive {
                log::info!("SSH Desktop: Reusing active SSH tunnel for {}:{} on local port {}", remote_host, remote_port, active.info.local_port);
                return Ok(active.info.local_port);
            } else {
                // Stale tunnel that has exited or closed, clean it up so we can recreate it
                if let Some(mut stale) = lock.remove(&tunnel_key) {
                    stale_child_to_kill = stale.child.take();
                    stale_shutdown_to_send = stale.shutdown_tx.take();
                }
            }
        }
    }
    if let Some(tx) = stale_shutdown_to_send {
        let _ = tx.send(());
    }
    if let Some(mut ch) = stale_child_to_kill {
        let _ = ch.kill().await;
    }

    // 2. Resolve SSH connection configuration
    let conn = crate::ssh::connection::resolve_connection(&state, &conn_id)
        .ok_or_else(|| format!("No active SSH connection found for '{}'. Please connect to a server first.", conn_id))?;
    // Port 0 is a valid request for an automatically selected local listener
    // port. The effective port is resolved below before binding/launching.
    crate::ssh::connection::validate_ssh_target(&remote_host, remote_port, &conn.config.username)
        .map_err(|e| format!("Invalid tunnel destination: {}", e))?;
    let is_key_auth = match conn.config.auth_method.as_deref() {
        Some("password") => false,
        Some("key") => true,
        _ => conn.config.private_key_path.is_some() || conn.config.password.is_none(),
    };
    let selected_key_path_raw = if is_key_auth { conn.config.private_key_path.as_deref() } else { None };
    if conn.config.auth_method.as_deref() == Some("key")
        && selected_key_path_raw.map(|key| key.trim().is_empty()).unwrap_or(true)
    {
        return Err("Key authentication was selected, but no private key was provided.".into());
    }
    let resolved_key_path = match selected_key_path_raw {
        Some(key_path) => Some(crate::ssh::connection::resolve_key_path(key_path)
            .ok_or_else(|| format!("Selected SSH identity '{}' could not be found or secured.", key_path))?),
        None => None,
    };
    let selected_key_path = resolved_key_path.as_deref();

    let effective_local_port = if is_remote_forward {
        if local_port > 0 { local_port } else { 3000 }
    } else if local_port > 0 {
        // If an existing tunnel is registered with this local_port, stop it first
        let mut dead_children = Vec::new();
        let mut dead_shutdowns = Vec::new();
        {
            let mut lock = ACTIVE_TUNNELS.lock();
            let dead_keys: Vec<String> = lock.iter()
                .filter(|(k, v)| v.info.local_port == local_port && **k != tunnel_key)
                .map(|(k, _)| k.clone())
                .collect();
            for k in dead_keys {
                if let Some(mut old) = lock.remove(&k) {
                    if let Some(ch) = old.child.take() {
                        dead_children.push(ch);
                    }
                    if let Some(tx) = old.shutdown_tx.take() {
                        dead_shutdowns.push(tx);
                    }
                }
            }
        }
        for tx in dead_shutdowns {
            let _ = tx.send(());
        }
        for mut ch in dead_children {
            let _ = ch.kill().await;
        }

        if !is_port_available(local_port) {
            tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
        }

        if !is_port_available(local_port) {
            return Err(format!(
                "Local port {} is already in use by another application. Please choose a different local port or stop the conflicting application.",
                local_port
            ));
        }
        local_port
    } else {
        find_available_port(if remote_port > 0 { remote_port } else { 0 })
    };

    let host = conn.config.host.clone();
    let ssh_port = conn.config.port.to_string();
    let user = conn.config.username.clone();
    let remote_target = if remote_host.trim().is_empty()
        || remote_host.trim().eq_ignore_ascii_case(&host)
        || remote_host.trim().eq_ignore_ascii_case("localhost") {
        "127.0.0.1".to_string()
    } else {
        remote_host.trim().to_string()
    };

    log::info!(
        "SSH Desktop: Spawning SSH Tunnel [{}] (type: {}) via {}@{}:{}",
        tunnel_key, ftype, user, host, ssh_port
    );

    // 3. Fast Path: Native in-memory SSH multiplexing path via russh
    if !is_remote_forward {
        let mut maybe_handle = {
            let lock = state.sessions.lock().await;
            lock.get(&conn_id).cloned()
                .or_else(|| if conn_id == "default" { lock.get("default").cloned() } else { None })
        };

        if maybe_handle.is_none() {
            let is_ppk = selected_key_path.map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
            if !is_ppk {
                // Share the same lifecycle lock as explicit connect/disconnect and
                // terminal handshakes; otherwise a late tunnel handshake can
                // overwrite a newer session or resurrect one after disconnect.
                let lock_id = conn.id.clone();
                let connection_lock = {
                    let mut locks = state.connection_locks.lock();
                    locks.retain(|_, weak_lock| weak_lock.strong_count() > 0);
                    match locks.get(&lock_id).and_then(std::sync::Weak::upgrade) {
                        Some(existing) => existing,
                        None => {
                            let created = Arc::new(tokio::sync::Mutex::new(()));
                            locks.insert(lock_id.clone(), Arc::downgrade(&created));
                            created
                        }
                    }
                };
                let _connection_guard = connection_lock.lock_owned().await;

                // Re-check while holding the lifecycle lock before starting a handshake.
                maybe_handle = {
                    let sessions = state.sessions.lock().await;
                    sessions.get(&conn_id).cloned()
                        .or_else(|| sessions.get(&conn.id).cloned())
                        .or_else(|| if conn_id == "default" { sessions.get("default").cloned() } else { None })
                };

                if maybe_handle.is_none() {
                    match crate::ssh::session::connect_session_with_passphrase_auth(
                        &conn.config.host,
                        conn.config.port,
                        &conn.config.username,
                        if is_key_auth { None } else { conn.config.password.as_deref() },
                        selected_key_path,
                        conn.config.passphrase.as_deref(),
                        conn.config.auth_method.as_deref() != Some("password"),
                    ).await {
                        Ok(new_handle) => {
                            let arc_h = Arc::new(new_handle);
                            let mut sessions = state.sessions.lock().await;
                            if sessions.contains_key(&conn_id) || sessions.contains_key(&conn.id) {
                                maybe_handle = sessions.get(&conn_id).cloned()
                                    .or_else(|| sessions.get(&conn.id).cloned());
                                drop(sessions);
                                let _ = tokio::time::timeout(
                                    std::time::Duration::from_millis(800),
                                    arc_h.disconnect(
                                        russh::Disconnect::ByApplication,
                                        "Superseded tunnel SSH handshake",
                                        "en",
                                    ),
                                ).await;
                            } else {
                                sessions.insert(conn.id.clone(), arc_h.clone());
                                sessions.entry("default".to_string()).or_insert_with(|| arc_h.clone());
                                maybe_handle = Some(arc_h);
                            }
                        }
                        Err(error) => {
                            log::warn!("SSH Desktop: Tunnel SSH handshake failed for {}: {}", conn.config.host, error);
                        }
                    }
                }
            }
        }

        if let Some(handle) = maybe_handle {
            let listener = match tokio::net::TcpListener::bind(("127.0.0.1", effective_local_port)).await {
                Ok(l) => l,
                Err(e) => {
                    return Err(format!("Failed to bind local tunnel port {}: {}", effective_local_port, e));
                }
            };

            let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();
            let target_host = remote_target.clone();
            let target_port = remote_port;
            let local_p = effective_local_port;
            let conn_sem = Arc::new(tokio::sync::Semaphore::new(128));
            let task_alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
            let task_alive_guard = task_alive.clone();

            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        _ = &mut shutdown_rx => {
                            log::info!("SSH direct-tcpip tunnel on port {} stopped", local_p);
                            break;
                        }
                        res = listener.accept() => {
                            match res {
                                Ok((mut local_stream, _)) => {
                                    let permit = match conn_sem.clone().try_acquire_owned() {
                                        Ok(p) => p,
                                        Err(_) => {
                                            log::warn!("Max concurrent connections (128) reached for tunnel on port {}", local_p);
                                            drop(local_stream);
                                            continue;
                                        }
                                    };
                                    let h = handle.clone();
                                    let r_host = target_host.clone();
                                    tokio::spawn(async move {
                                        let _permit = permit;
                                        let channel_result = tokio::time::timeout(
                                            std::time::Duration::from_secs(15),
                                            h.channel_open_direct_tcpip(&r_host, target_port as u32, "127.0.0.1", local_p as u32),
                                        ).await;
                                        match channel_result {
                                            Ok(Ok(channel)) => {
                                                let mut ssh_stream = channel.into_stream();
                                                let _ = tokio::io::copy_bidirectional(&mut local_stream, &mut ssh_stream).await;
                                            }
                                            Ok(Err(e)) => {
                                                log::error!("Failed to open direct-tcpip channel to {}:{}: {}", r_host, target_port, e);
                                            }
                                            Err(_) => {
                                                log::warn!("Timed out opening direct-tcpip channel to {}:{}.", r_host, target_port);
                                            }
                                        }
                                    });
                                }
                                Err(e) => {
                                    log::warn!("Listener error on tunnel port {}: {}", local_p, e);
                                    break;
                                }
                            }
                        }
                    }
                }
                task_alive_guard.store(false, std::sync::atomic::Ordering::Release);
            });

            let tunnel_info = TunnelInfo {
                tunnel_id: tunnel_key.clone(),
                conn_id: conn_id.clone(),
                local_port: effective_local_port,
                remote_host: remote_target,
                remote_port,
                created_at: chrono::Utc::now().timestamp(),
            };

            {
                let mut lock = ACTIVE_TUNNELS.lock();
                lock.insert(tunnel_key, ActiveTunnel {
                    info: tunnel_info,
                    child: None,
                    shutdown_tx: Some(shutdown_tx),
                    task_alive: Some(task_alive),
                    password_file: None,
                });
            }

            log::info!("SSH Desktop: Native SSH Tunnel active on 127.0.0.1:{}", effective_local_port);
            return Ok(effective_local_port);
        }
    }

    let is_ppk = selected_key_path.map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    let plink_bin = crate::ssh::connection::get_plink_path();
    let plink_available = plink_bin != "plink" || std::path::Path::new(plink_bin).exists();
    let has_password = !is_key_auth && conn.config.password.as_deref().map(|p| !p.trim().is_empty()).unwrap_or(false);
    let is_pem_key = selected_key_path.map(|k| !crate::ssh::connection::is_ppk_key(k)).unwrap_or(false);
    if !is_key_auth && !has_password {
        return Err("Password authentication was selected, but no SSH password is configured.".into());
    }
    if (is_ppk || has_password) && !plink_available {
        return Err("PuTTY Plink is required for this SSH tunnel authentication method but was not found.".into());
    }
    // Never use Plink for PEM keys (Plink only supports PuTTY .ppk keys)
    let prefer_plink = !is_pem_key && (is_ppk || has_password) && plink_available;
    let password_file = if has_password && plink_available && !is_pem_key {
        let password = conn.config.password.as_deref().unwrap_or_default();
        Some(Arc::new(crate::ssh::connection::create_password_file(password)?))
    } else {
        None
    };

    let mut spawned = false;
    let mut child_handle: Option<tokio::process::Child> = None;
    let mut last_error = String::new();
    let mut used_plink_first = false;

    let forward_arg = if is_remote_forward {
        format!("{}:127.0.0.1:{}", remote_port, effective_local_port)
    } else {
        format!("127.0.0.1:{}:{}:{}", effective_local_port, remote_target, remote_port)
    };

    // Helper closure to build OpenSSH tunnel command
    let make_openssh_cmd = || {
        let mut cmd = tokio::process::Command::new("ssh");
    cmd.kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.arg("-N");
        if is_remote_forward {
            cmd.arg("-R").arg(&forward_arg);
        } else {
            cmd.arg("-L").arg(&forward_arg);
        }

        cmd.arg("-p").arg(&ssh_port)
            .arg("-o").arg("StrictHostKeyChecking=yes")
            .arg("-o").arg("BatchMode=yes")
            .arg("-o").arg("IdentitiesOnly=yes")
            .arg("-o").arg("ExitOnForwardFailure=yes")
            .arg("-o").arg("ConnectTimeout=10")
            .arg("-o").arg("ServerAliveInterval=30")
            .arg("-o").arg("ServerAliveCountMax=3");

        if !is_key_auth {
            cmd.arg("-o").arg("PubkeyAuthentication=no");
        }

        if let Some(key) = selected_key_path {
            cmd.arg("-i").arg(key);
        }

        cmd.arg(format!("{}@{}", user, host));
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());
        cmd
    };

    // Helper closure to build Plink tunnel command
    let make_plink_cmd = || {
        let mut cmd = tokio::process::Command::new(plink_bin);
    cmd.kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.arg("-batch").arg("-ssh")
            .arg("-N")
            .arg("-P").arg(&ssh_port)
            .arg("-l").arg(&user);

        if is_remote_forward {
            cmd.arg("-R").arg(&forward_arg);
        } else {
            cmd.arg("-L").arg(&forward_arg);
        }

        if let Some(password_file) = &password_file {
            cmd.arg("-pwfile").arg(password_file.path());
        }

        if let Some(key) = selected_key_path {
            cmd.arg("-i").arg(key);
        }

        cmd.arg(&host);
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());
        cmd
    };

    if prefer_plink {
        used_plink_first = true;
        let mut cmd = make_plink_cmd();
        match cmd.spawn() {
            Ok(child) => {
                child_handle = Some(child);
                spawned = true;
            }
            Err(e) => {
                last_error = format!("Plink tunnel launch error: {}", e);
            }
        }
    } else {
        // OpenSSH preferred for OpenSSH PEM keys or keyless/agent auth
        let mut cmd = make_openssh_cmd();
        match cmd.spawn() {
            Ok(child) => {
                child_handle = Some(child);
                spawned = true;
            }
            Err(e) => {
                last_error = format!("OpenSSH tunnel launch error: {}", e);
            }
        }
    }

    // Fallback if primary tool failed to spawn
    if !spawned {
        if used_plink_first {
            let mut cmd = make_openssh_cmd();
            if let Ok(child) = cmd.spawn() {
                child_handle = Some(child);
                spawned = true;
            }
        } else if plink_available && !is_pem_key {
            let mut cmd = make_plink_cmd();
            if let Ok(child) = cmd.spawn() {
                child_handle = Some(child);
                spawned = true;
            }
        }
    }

    if !spawned {
        return Err(format!("Could not spawn SSH tunnel: {}", last_error));
    }

    // Wait up to 3.5 seconds for the port to start listening
    let mut bound = false;
    if is_remote_forward {
        // For remote port forwarding (-R), verify child process stays alive without immediate error
        tokio::time::sleep(tokio::time::Duration::from_millis(800)).await;
        if let Some(ref mut ch) = child_handle {
            if let Ok(Some(status)) = ch.try_wait() {
                let mut err_msg = format!("Remote tunnel exited early: {}", status);
                if let Some(mut stderr) = ch.stderr.take() {
                    let mut buf = Vec::new();
                    let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut buf).await;
                    let text = String::from_utf8_lossy(&buf).trim().to_string();
                    if !text.is_empty() {
                        err_msg = format!("{}: {}", err_msg, text);
                    }
                }
                return Err(err_msg);
            }
        }
        bound = true;
    } else {
        for _ in 0..35 {
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
            if std::net::TcpStream::connect(("127.0.0.1", effective_local_port)).is_ok() {
                bound = true;
                break;
            }
            // Check if child exited prematurely
            if let Some(ref mut ch) = child_handle {
                if let Ok(Some(status)) = ch.try_wait() {
                    let mut err_msg = format!("SSH Tunnel process exited early with status: {}", status);
                    if let Some(mut stderr) = ch.stderr.take() {
                        let mut buf = Vec::new();
                        let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut buf).await;
                        let text = String::from_utf8_lossy(&buf).trim().to_string();
                        if !text.is_empty() {
                            err_msg = format!("{}: {}", err_msg, text);
                        }
                    }
                    log::warn!("SSH Desktop: Primary tunnel process exited ({}).", err_msg);

                    // Alternate fallback attempt only if Plink wasn't already tried and not a PEM key
                    let alt_spawned = if used_plink_first {
                        let mut alt_cmd = make_openssh_cmd();
                        alt_cmd.spawn().ok()
                    } else if plink_available && !is_pem_key {
                        let mut alt_cmd = make_plink_cmd();
                        alt_cmd.spawn().ok()
                    } else {
                        None
                    };

                    if let Some(alt_child) = alt_spawned {
                        for _ in 0..20 {
                            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                            if std::net::TcpStream::connect(("127.0.0.1", effective_local_port)).is_ok() {
                                bound = true;
                                child_handle = Some(alt_child);
                                break;
                            }
                        }
                    }

                    if !bound {
                        return Err(err_msg);
                    } else {
                        break;
                    }
                }
            }
        }
    }

    if !bound {
        if let Some(mut ch) = child_handle.take() {
            let _ = ch.kill().await;
            let mut stderr_msg = String::new();
            if let Some(mut stderr) = ch.stderr.take() {
                let mut buf = Vec::new();
                if let Ok(Ok(_)) = tokio::time::timeout(
                    std::time::Duration::from_millis(500),
                    tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut buf)
                ).await {
                    let text = String::from_utf8_lossy(&buf).trim().to_string();
                    if !text.is_empty() {
                        stderr_msg = text;
                    }
                }
            }
            if !stderr_msg.is_empty() {
                return Err(format!("Tunnel on port {} failed: {}", effective_local_port, stderr_msg));
            }
        }
        return Err(format!("SSH Tunnel on local port {} timed out waiting to connect. Verify your server is running and port {} is accessible.", effective_local_port, remote_port));
    }

    let tunnel_info = TunnelInfo {
        tunnel_id: tunnel_key.clone(),
        conn_id: conn_id.clone(),
        local_port: effective_local_port,
        remote_host: remote_target,
        remote_port,
        created_at: chrono::Utc::now().timestamp(),
    };

    {
        let mut lock = ACTIVE_TUNNELS.lock();
        lock.insert(tunnel_key, ActiveTunnel {
            info: tunnel_info,
            child: child_handle,
            shutdown_tx: None,
            task_alive: None,
            password_file: password_file.clone(),
        });
    }

    log::info!("SSH Desktop: SSH Tunnel active on 127.0.0.1:{} (bound: {})", effective_local_port, bound);
    Ok(effective_local_port)
}

/// Stop an active SSH port forwarding tunnel
#[tauri::command]
pub async fn ssh_stop_tunnel(tunnel_id: String) -> Result<(), String> {
    let (maybe_child, maybe_shutdown) = {
        let mut lock = ACTIVE_TUNNELS.lock();
        if let Some(mut active) = lock.remove(&tunnel_id) {
            (active.child.take(), active.shutdown_tx.take())
        } else {
            let matching_key = lock.iter().find(|(k, v)| {
                *k == &tunnel_id 
                || v.info.tunnel_id == tunnel_id 
                || v.info.local_port.to_string() == tunnel_id
                || k.ends_with(&format!(":{}", tunnel_id))
            }).map(|(k, _)| k.clone());
            
            if let Some(k) = matching_key {
                if let Some(mut active) = lock.remove(&k) {
                    (active.child.take(), active.shutdown_tx.take())
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            }
        }
    };

    if let Some(tx) = maybe_shutdown {
        let _ = tx.send(());
        log::info!("SSH Desktop: Stopped native SSH Tunnel {}", tunnel_id);
    }
    if let Some(mut child) = maybe_child {
        let _ = child.kill().await;
        log::info!("SSH Desktop: Stopped external SSH Tunnel {}", tunnel_id);
    }

    let (maybe_socks_child, maybe_socks_shutdown) = {
        let mut lock = ACTIVE_SOCKS5.lock();
        if let Some(mut active) = lock.remove(&tunnel_id) {
            (active.child.take(), active.shutdown_tx.take())
        } else {
            let matching_key = lock.iter().find(|(k, v)| {
                *k == &tunnel_id 
                || v.info.tunnel_id == tunnel_id 
                || v.info.local_port.to_string() == tunnel_id
                || v.info.conn_id == tunnel_id
            }).map(|(k, _)| k.clone());
            if let Some(k) = matching_key {
                if let Some(mut active) = lock.remove(&k) {
                    (active.child.take(), active.shutdown_tx.take())
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            }
        }
    };

    if let Some(tx) = maybe_socks_shutdown {
        let _ = tx.send(());
        log::info!("SSH Desktop: Stopped native SOCKS5 Tunnel {}", tunnel_id);
    }
    if let Some(mut child) = maybe_socks_child {
        let _ = child.kill().await;
        log::info!("SSH Desktop: Stopped external SOCKS5 Tunnel {}", tunnel_id);
    }
    Ok(())
}

/// List all active SSH port forwarding tunnels and proxies
#[tauri::command]
pub async fn ssh_list_tunnels() -> Result<Vec<TunnelInfo>, String> {
    let mut list = Vec::new();
    {
        let lock = ACTIVE_TUNNELS.lock();
        list.extend(lock.values().map(|a| a.info.clone()));
    }
    {
        let lock = ACTIVE_SOCKS5.lock();
        list.extend(lock.values().map(|a| a.info.clone()));
    }
    Ok(list)
}

/// Start an SSH Dynamic SOCKS5 Proxy: binds 127.0.0.1:local_port
#[tauri::command]
pub async fn ssh_start_socks5(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    preferred_port: Option<u16>,
    username: Option<String>,
    password: Option<String>,
    require_auth: Option<bool>,
) -> Result<u16, String> {
    // 1. If an active SOCKS5 proxy already exists and is responsive for this connection, return its port
    let mut stale_socks_child = None;
    let mut stale_socks_shutdown = None;
    {
        let mut lock = ACTIVE_SOCKS5.lock();
        if let Some(active) = lock.get_mut(&conn_id) {
            let is_alive = if let Some(child) = active.child.as_mut() {
                matches!(child.try_wait(), Ok(None))
            } else {
                active.task_alive.as_ref()
                    .map(|alive| alive.load(std::sync::atomic::Ordering::Acquire))
                    .unwrap_or(false)
            };
            if is_alive {
                log::info!("SSH Desktop: Reusing active SOCKS5 proxy on 127.0.0.1:{}", active.info.local_port);
                return Ok(active.info.local_port);
            } else {
                if let Some(mut stale) = lock.remove(&conn_id) {
                    stale_socks_child = stale.child.take();
                    stale_socks_shutdown = stale.shutdown_tx.take();
                }
            }
        }
    }
    if let Some(tx) = stale_socks_shutdown {
        let _ = tx.send(());
    }
    if let Some(mut ch) = stale_socks_child {
        let _ = ch.kill().await;
    }

    // 2. Resolve SSH connection configuration
    let conn = crate::ssh::connection::resolve_connection(&state, &conn_id)
        .ok_or_else(|| format!("No active SSH connection found for '{}'. Please connect to a server first.", conn_id))?;
    if preferred_port == Some(0) {
        return Err("SOCKS5 local port must be between 1 and 65535.".into());
    }

    let socks_auth: Option<(String, String)> = match (username, password) {
        (Some(u), Some(p)) => {
            if u.is_empty() || u.len() > 255 || p.len() > 255 {
                return Err("SOCKS5 username and password must be 1..=255 bytes.".into());
            }
            Some((u, p))
        }
        (Some(_), None) | (None, Some(_)) => {
            return Err("Both username and password are required when configuring SOCKS5 authentication.".into());
        }
        (None, None) => None,
    };
    if require_auth == Some(true) && socks_auth.is_none() {
        return Err("SOCKS5 authentication was requested without username/password credentials.".into());
    }

    let preferred = preferred_port.unwrap_or(1080);
    let effective_local_port = find_available_port(if preferred >= 1024 { preferred } else { 10800 });

    // Prefer the native in-process russh SOCKS5 listener when a session handle exists so
    // optional RFC 1929 authentication and bounded concurrency apply consistently.
    let native_handle = {
        let lock = state.sessions.lock().await;
        lock.get(&conn_id).cloned()
    };
    if let Some(client_handle) = native_handle {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", effective_local_port))
            .await
            .map_err(|e| format!("Failed to bind SOCKS5 listener on 127.0.0.1:{}: {}", effective_local_port, e))?;
        let (shutdown_tx, mut shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        let semaphore = Arc::new(tokio::sync::Semaphore::new(MAX_SOCKS5_CONCURRENT_STREAMS));
        let auth_enabled = socks_auth.is_some();
        let auth_arc = socks_auth.map(Arc::new);
        let listen_port = effective_local_port;
        let task_alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
        let task_alive_guard = task_alive.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    accept_res = listener.accept() => {
                        match accept_res {
                            Ok((mut sock, _)) => {
                                let Ok(permit) = semaphore.clone().try_acquire_owned() else {
                                    continue;
                                };
                                let handle_clone = client_handle.clone();
                                let auth_clone = auth_arc.clone();
                                tokio::spawn(async move {
                                    let _permit = permit;
                                    let _ = handle_socks5_client(&mut sock, &handle_clone, listen_port, auth_clone.as_deref()).await;
                                });
                            }
                            Err(_) => break,
                        }
                    }
                }
            }
            task_alive_guard.store(false, std::sync::atomic::Ordering::Release);
        });
        let tunnel_info = TunnelInfo {
            tunnel_id: format!("socks5:{}", conn_id),
            conn_id: conn_id.clone(),
            local_port: effective_local_port,
            remote_host: "127.0.0.1".to_string(),
            remote_port: 0,
            created_at: chrono::Utc::now().timestamp(),
        };
        {
            let mut lock = ACTIVE_SOCKS5.lock();
            lock.insert(conn_id.clone(), ActiveTunnel {
                info: tunnel_info,
                child: None,
                shutdown_tx: Some(shutdown_tx),
                task_alive: Some(task_alive),
                password_file: None,
            });
        }
        log::info!("SSH Desktop: Native SOCKS5 Proxy active on 127.0.0.1:{} (auth={})", effective_local_port, auth_enabled);
        return Ok(effective_local_port);
    }
    if socks_auth.is_some() {
        return Err("Authenticated SOCKS5 requires an active native SSH session.".into());
    }
    let is_key_auth = match conn.config.auth_method.as_deref() {
        Some("password") => false,
        Some("key") => true,
        _ => conn.config.private_key_path.is_some() || conn.config.password.is_none(),
    };
    let selected_key_path_raw = if is_key_auth { conn.config.private_key_path.as_deref() } else { None };
    if conn.config.auth_method.as_deref() == Some("key")
        && selected_key_path_raw.map(|key| key.trim().is_empty()).unwrap_or(true)
    {
        return Err("Key authentication was selected, but no private key was provided.".into());
    }
    let resolved_key_path = match selected_key_path_raw {
        Some(key_path) => Some(crate::ssh::connection::resolve_key_path(key_path)
            .ok_or_else(|| format!("Selected SSH identity '{}' could not be found or secured.", key_path))?),
        None => None,
    };
    let selected_key_path = resolved_key_path.as_deref();

    let host = conn.config.host.clone();
    let ssh_port = conn.config.port.to_string();
    let user = conn.config.username.clone();

    log::info!(
        "SSH Desktop: Spawning SSH SOCKS5 Proxy -D 127.0.0.1:{} via {}@{}:{}",
        effective_local_port, user, host, ssh_port
    );

    let is_ppk = selected_key_path.map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    let plink_bin = crate::ssh::connection::get_plink_path();
    let plink_available = plink_bin != "plink" || std::path::Path::new(plink_bin).exists();
    let has_password = !is_key_auth && conn.config.password.as_deref().map(|p| !p.trim().is_empty()).unwrap_or(false);
    let is_pem_key = selected_key_path.map(|k| !crate::ssh::connection::is_ppk_key(k)).unwrap_or(false);
    if !is_key_auth && !has_password {
        return Err("Password authentication was selected, but no SSH password is configured.".into());
    }
    if (is_ppk || has_password) && !plink_available {
        return Err("PuTTY Plink is required for this SSH tunnel authentication method but was not found.".into());
    }
    let prefer_plink = !is_pem_key && (is_ppk || has_password) && plink_available;
    let password_file = if has_password && plink_available && !is_pem_key {
        let password = conn.config.password.as_deref().unwrap_or_default();
        Some(Arc::new(crate::ssh::connection::create_password_file(password)?))
    } else {
        None
    };

    let mut spawned = false;
    let mut child_handle: Option<tokio::process::Child> = None;
    let mut last_error = String::new();
    let mut used_plink_first = false;

    // Helper closure to build OpenSSH SOCKS5 command
    let make_openssh_cmd = || {
        let mut cmd = tokio::process::Command::new("ssh");
    cmd.kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.arg("-N")
            .arg("-D").arg(format!("127.0.0.1:{}", effective_local_port))
            .arg("-p").arg(&ssh_port)
            .arg("-o").arg("StrictHostKeyChecking=yes")
            .arg("-o").arg("BatchMode=yes")
            .arg("-o").arg("IdentitiesOnly=yes")
            .arg("-o").arg("ExitOnForwardFailure=yes")
            .arg("-o").arg("ConnectTimeout=10")
            .arg("-o").arg("ServerAliveInterval=30")
            .arg("-o").arg("ServerAliveCountMax=3");

        if !is_key_auth {
            cmd.arg("-o").arg("PubkeyAuthentication=no");
        }

        if let Some(key) = selected_key_path {
            cmd.arg("-i").arg(key);
        }

        cmd.arg(format!("{}@{}", user, host));
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());
        cmd
    };

    // Helper closure to build Plink SOCKS5 command
    let make_plink_cmd = || {
        let mut cmd = tokio::process::Command::new(plink_bin);
    cmd.kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.arg("-batch").arg("-ssh")
            .arg("-N")
            .arg("-P").arg(&ssh_port)
            .arg("-l").arg(&user)
            .arg("-D").arg(format!("127.0.0.1:{}", effective_local_port));

        if let Some(password_file) = &password_file {
            cmd.arg("-pwfile").arg(password_file.path());
        }

        if let Some(key) = selected_key_path {
            cmd.arg("-i").arg(key);
        }

        cmd.arg(&host);
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());
        cmd
    };

    if prefer_plink {
        used_plink_first = true;
        let mut cmd = make_plink_cmd();
        match cmd.spawn() {
            Ok(child) => {
                child_handle = Some(child);
                spawned = true;
            }
            Err(e) => {
                last_error = format!("Plink SOCKS5 launch error: {}", e);
            }
        }
    } else {
        // OpenSSH preferred for OpenSSH PEM keys or keyless/agent auth
        let mut cmd = make_openssh_cmd();
        match cmd.spawn() {
            Ok(child) => {
                child_handle = Some(child);
                spawned = true;
            }
            Err(e) => {
                last_error = format!("OpenSSH SOCKS5 launch error: {}", e);
            }
        }
    }

    // Fallback if primary tool failed to spawn
    if !spawned {
        if used_plink_first {
            let mut cmd = make_openssh_cmd();
            if let Ok(child) = cmd.spawn() {
                child_handle = Some(child);
                spawned = true;
            }
        } else if plink_available && !is_pem_key {
            let mut cmd = make_plink_cmd();
            if let Ok(child) = cmd.spawn() {
                child_handle = Some(child);
                spawned = true;
            }
        }
    }

    if !spawned {
        return Err(format!("Could not spawn SSH SOCKS5 proxy: {}", last_error));
    }

    // Wait up to 3 seconds for the SOCKS5 proxy port to start listening
    let mut bound = false;
    for _ in 0..30 {
        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        if std::net::TcpStream::connect(("127.0.0.1", effective_local_port)).is_ok() {
            bound = true;
            break;
        }

        // Check if child exited prematurely
        if let Some(ref mut ch) = child_handle {
            if let Ok(Some(status)) = ch.try_wait() {
                let mut err_msg = format!("SSH SOCKS5 process exited early with status: {}", status);
                if let Some(mut stderr) = ch.stderr.take() {
                    let mut buf = Vec::new();
                    let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut buf).await;
                    let text = String::from_utf8_lossy(&buf).trim().to_string();
                    if !text.is_empty() {
                        err_msg = format!("{}: {}", err_msg, text);
                    }
                }
                log::warn!("SSH Desktop: Primary SOCKS5 process exited ({}).", err_msg);

                // Alternate fallback attempt only if Plink wasn't already tried and not a PEM key
                let alt_spawned = if used_plink_first {
                    let mut alt_cmd = make_openssh_cmd();
                    alt_cmd.spawn().ok()
                } else if plink_available && !is_pem_key {
                    let mut alt_cmd = make_plink_cmd();
                    alt_cmd.spawn().ok()
                } else {
                    None
                };

                if let Some(alt_child) = alt_spawned {
                    for _ in 0..20 {
                        tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
                        if std::net::TcpStream::connect(("127.0.0.1", effective_local_port)).is_ok() {
                            bound = true;
                            child_handle = Some(alt_child);
                            break;
                        }
                    }
                }

                if !bound {
                    return Err(err_msg);
                } else {
                    break;
                }
            }
        }
    }

    if !bound {
        if let Some(mut child) = child_handle.take() {
            let _ = child.kill().await;
        }
        return Err(format!("SOCKS5 proxy port {} did not start listening in time.", effective_local_port));
    }

    let tunnel_info = TunnelInfo {
        tunnel_id: format!("socks5:{}", conn_id),
        conn_id: conn_id.clone(),
        local_port: effective_local_port,
        remote_host: "0.0.0.0".to_string(),
        remote_port: 0,
        created_at: chrono::Utc::now().timestamp(),
    };

    {
        let mut lock = ACTIVE_SOCKS5.lock();
        lock.insert(conn_id.clone(), ActiveTunnel {
            info: tunnel_info,
            child: child_handle,
            shutdown_tx: None,
            task_alive: None,
            password_file: password_file.clone(),
        });
    }

    log::info!("SSH Desktop: SSH SOCKS5 Proxy active on 127.0.0.1:{}", effective_local_port);
    Ok(effective_local_port)
}

/// Stop an active SSH SOCKS5 proxy
#[tauri::command]
pub async fn ssh_stop_socks5(conn_id: String) -> Result<(), String> {
    let (maybe_child, maybe_shutdown) = {
        let mut lock = ACTIVE_SOCKS5.lock();
        if let Some(mut active) = lock.remove(&conn_id) {
            (active.child.take(), active.shutdown_tx.take())
        } else {
            (None, None)
        }
    };

    if let Some(tx) = maybe_shutdown {
        let _ = tx.send(());
        log::info!("SSH Desktop: Stopped native SSH SOCKS5 Proxy for {}", conn_id);
    }
    if let Some(mut child) = maybe_child {
        let _ = child.kill().await;
        log::info!("SSH Desktop: Stopped external SSH SOCKS5 Proxy for {}", conn_id);
    }
    Ok(())
}

/// Get the active SOCKS5 port for a connection if running
#[tauri::command]
pub async fn ssh_get_socks5(conn_id: String) -> Result<Option<u16>, String> {
    let lock = ACTIVE_SOCKS5.lock();
    if let Some(active) = lock.get(&conn_id) {
        if std::net::TcpStream::connect(("127.0.0.1", active.info.local_port)).is_ok() {
            return Ok(Some(active.info.local_port));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socks5_rfc1929_credential_validation_is_exact() {
        assert!(validate_socks5_credentials(b"alice", b"s3cr3t", "alice", "s3cr3t"));
        assert!(!validate_socks5_credentials(b"alice", b"s3cr3u", "alice", "s3cr3t"));
        assert!(!validate_socks5_credentials(b"alice2", b"s3cr3t", "alice", "s3cr3t"));
        assert!(!validate_socks5_credentials(b"bob", b"s3cr3t", "alice", "s3cr3t"));
    }

    #[test]
    fn metadata_egress_filter_handles_ipv4_mapped_ipv6() {
        assert!(is_cloud_metadata_target("169.254.169.254"));
        assert!(is_cloud_metadata_target("[fd00:ec2::254]"));
        assert!(is_cloud_metadata_target("::ffff:169.254.169.254"));
        assert!(is_cloud_metadata_target("metadata.google.internal."));
        assert!(!is_cloud_metadata_target("10.0.0.5"));
        assert!(!is_cloud_metadata_target("example.com"));
    }
}
