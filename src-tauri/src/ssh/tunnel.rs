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
}

lazy_static! {
    static ref ACTIVE_TUNNELS: Mutex<HashMap<String, ActiveTunnel>> = Mutex::new(HashMap::new());
    static ref ACTIVE_SOCKS5: Mutex<HashMap<String, ActiveTunnel>> = Mutex::new(HashMap::new());
}

fn is_port_available(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn find_available_port(preferred: u16) -> u16 {
    // Only bind non-privileged ports (>= 1024) to avoid OS permission issues on Windows/Unix
    if preferred >= 1024 && is_port_available(preferred) {
        return preferred;
    }
    if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", 0)) {
        if let Ok(addr) = listener.local_addr() {
            return addr.port();
        }
    }
    if preferred >= 1024 { preferred } else { 18080 }
}

/// Start an SSH port forwarding tunnel: binds 127.0.0.1:local_port -> remote_host:remote_port
#[tauri::command]
pub async fn ssh_start_tunnel(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
) -> Result<u16, String> {
    let tunnel_key = format!("{}:{}:{}", conn_id, remote_host, remote_port);

    // 1. If an active tunnel for this server and remote port already exists, return its port
    {
        let lock = ACTIVE_TUNNELS.lock();
        if let Some(active) = lock.get(&tunnel_key) {
            // Verify if still listening
            if std::net::TcpStream::connect(("127.0.0.1", active.info.local_port)).is_ok() {
                log::info!("SSH Desktop: Reusing active SSH tunnel for {}:{} on local port {}", remote_host, remote_port, active.info.local_port);
                return Ok(active.info.local_port);
            }
        }
    }

    // 2. Resolve SSH connection configuration
    let conn = crate::ssh::connection::resolve_connection(&state, &conn_id)
        .ok_or_else(|| format!("No active SSH connection found for '{}'. Please connect to a server first.", conn_id))?;

    let effective_local_port = find_available_port(if local_port >= 1024 { local_port } else if remote_port >= 1024 { remote_port } else { 0 });
    let host = conn.config.host.clone();
    let ssh_port = conn.config.port.to_string();
    let user = conn.config.username.clone();
    let remote_target = if remote_host.trim().is_empty() { "127.0.0.1".to_string() } else { remote_host.trim().to_string() };

    log::info!(
        "SSH Desktop: Spawning SSH Tunnel -L 127.0.0.1:{}:{}:{} via {}@{}:{}",
        effective_local_port, remote_target, remote_port, user, host, ssh_port
    );

    let is_ppk = conn.config.private_key_path.as_deref().map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    let mut spawned = false;
    let mut child_handle: Option<tokio::process::Child> = None;
    let mut last_error = String::new();

    // Approach A: Try Plink (best for Windows with passwords or PPK keys)
    let plink_bin = crate::ssh::connection::get_plink_path();
    if plink_bin != "plink" || std::path::Path::new(plink_bin).exists() || conn.config.password.is_some() || is_ppk {
        // Pre-cache host key in PuTTY registry to prevent batch mode / host key rejection
        #[cfg(windows)]
        {
            let mut probe = tokio::process::Command::new(plink_bin);
            probe.creation_flags(0x08000000); // CREATE_NO_WINDOW
            probe.arg("-ssh").arg("-P").arg(&ssh_port).arg("-l").arg(&user);
            if let Some(pwd) = &conn.config.password {
                if !pwd.is_empty() { probe.arg("-pw").arg(pwd); }
            }
            if let Some(key) = &conn.config.private_key_path {
                if crate::ssh::connection::resolve_key_path(key).is_some() { probe.arg("-i").arg(key); }
            }
            probe.arg(&host).arg("echo sshdesktop-tunnel-ok");
            probe.stdin(std::process::Stdio::piped());
            probe.stdout(std::process::Stdio::piped());
            probe.stderr(std::process::Stdio::piped());

            if let Ok(mut ch) = probe.spawn() {
                if let Some(mut stdin) = ch.stdin.take() {
                    let _ = tokio::io::AsyncWriteExt::write_all(&mut stdin, b"y\r\ny\r\n").await;
                }
                let _ = tokio::time::timeout(std::time::Duration::from_secs(3), ch.wait()).await;
            }
        }

        let mut cmd = tokio::process::Command::new(plink_bin);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        // NOTE: We do NOT pass -batch so Plink accepts host keys via piped stdin
        cmd.arg("-ssh")
            .arg("-N") // do not open a remote command or shell
            .arg("-P").arg(&ssh_port)
            .arg("-l").arg(&user)
            .arg("-L").arg(format!("127.0.0.1:{}:{}:{}", effective_local_port, remote_target, remote_port));

        if let Some(pwd) = &conn.config.password {
            if !pwd.is_empty() {
                cmd.arg("-pw").arg(pwd);
            }
        }

        if let Some(key) = &conn.config.private_key_path {
            if crate::ssh::connection::resolve_key_path(key).is_some() {
                cmd.arg("-i").arg(key);
            }
        }

        cmd.arg(&host);
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());

        match cmd.spawn() {
            Ok(mut child) => {
                if let Some(mut stdin) = child.stdin.take() {
                    tokio::spawn(async move {
                        // Automatically answer "y" to accept host key caching prompt if prompted
                        let _ = tokio::io::AsyncWriteExt::write_all(&mut stdin, b"y\r\ny\r\n").await;
                        let _ = tokio::io::AsyncWriteExt::flush(&mut stdin).await;
                    });
                }
                child_handle = Some(child);
                spawned = true;
            }
            Err(e) => {
                last_error = format!("Plink tunnel launch error: {}", e);
            }
        }
    }

    // Approach B: Try OpenSSH ssh (built into Windows 10/11)
    if !spawned {
        let mut cmd = tokio::process::Command::new("ssh");
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.arg("-N")
            .arg("-L").arg(format!("127.0.0.1:{}:{}:{}", effective_local_port, remote_target, remote_port))
            .arg("-p").arg(&ssh_port)
            .arg("-o").arg("StrictHostKeyChecking=no")
            .arg("-o").arg(if cfg!(windows) { "UserKnownHostsFile=NUL" } else { "UserKnownHostsFile=/dev/null" })
            .arg("-o").arg("ExitOnForwardFailure=yes");

        if let Some(key) = &conn.config.private_key_path {
            if crate::ssh::connection::resolve_key_path(key).is_some() {
                cmd.arg("-i").arg(key);
            }
        }

        cmd.arg(format!("{}@{}", user, host));
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());

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

    if !spawned {
        return Err(format!("Could not spawn SSH tunnel: {}", last_error));
    }

    // Wait up to 3 seconds for the port to start listening
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
                let mut err_msg = format!("SSH Tunnel process exited early with status: {}", status);
                if let Some(mut stderr) = ch.stderr.take() {
                    let mut buf = Vec::new();
                    let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut buf).await;
                    let text = String::from_utf8_lossy(&buf).trim().to_string();
                    if !text.is_empty() {
                        err_msg = format!("{}: {}", err_msg, text);
                    }
                }
                log::warn!("SSH Desktop: Tunnel process exited ({}). Attempting OpenSSH fallback...", err_msg);

                // Fallback attempt: OpenSSH
                let mut alt_cmd = tokio::process::Command::new("ssh");
                #[cfg(windows)]
                alt_cmd.creation_flags(0x08000000);
                alt_cmd.arg("-N")
                    .arg("-L").arg(format!("127.0.0.1:{}:{}:{}", effective_local_port, remote_target, remote_port))
                    .arg("-p").arg(&ssh_port)
                    .arg("-o").arg("StrictHostKeyChecking=no")
                    .arg("-o").arg(if cfg!(windows) { "UserKnownHostsFile=NUL" } else { "UserKnownHostsFile=/dev/null" })
                    .arg("-o").arg("ExitOnForwardFailure=yes");

                if let Some(key) = &conn.config.private_key_path {
                    if crate::ssh::connection::resolve_key_path(key).is_some() {
                        alt_cmd.arg("-i").arg(key);
                    }
                }

                alt_cmd.arg(format!("{}@{}", user, host));
                alt_cmd.stdin(std::process::Stdio::null());
                alt_cmd.stdout(std::process::Stdio::null());
                alt_cmd.stderr(std::process::Stdio::piped());

                if let Ok(alt_child) = alt_cmd.spawn() {
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
        });
    }

    log::info!("SSH Desktop: SSH Tunnel active on 127.0.0.1:{} (bound: {})", effective_local_port, bound);
    Ok(effective_local_port)
}

/// Stop an active SSH port forwarding tunnel
#[tauri::command]
pub async fn ssh_stop_tunnel(tunnel_id: String) -> Result<(), String> {
    let maybe_child = {
        let mut lock = ACTIVE_TUNNELS.lock();
        lock.remove(&tunnel_id).and_then(|mut active| active.child.take())
    };

    if let Some(mut child) = maybe_child {
        let _ = child.kill().await;
        log::info!("SSH Desktop: Stopped SSH Tunnel {}", tunnel_id);
    }
    Ok(())
}

/// List all active SSH port forwarding tunnels
#[tauri::command]
pub async fn ssh_list_tunnels() -> Result<Vec<TunnelInfo>, String> {
    let lock = ACTIVE_TUNNELS.lock();
    Ok(lock.values().map(|a| a.info.clone()).collect())
}

/// Start an SSH Dynamic SOCKS5 Proxy: binds 127.0.0.1:local_port (via ssh -D)
#[tauri::command]
pub async fn ssh_start_socks5(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    preferred_port: Option<u16>,
) -> Result<u16, String> {
    // 1. If an active SOCKS5 proxy already exists and is responsive for this connection, return its port
    {
        let lock = ACTIVE_SOCKS5.lock();
        if let Some(active) = lock.get(&conn_id) {
            if std::net::TcpStream::connect(("127.0.0.1", active.info.local_port)).is_ok() {
                log::info!("SSH Desktop: Reusing active SOCKS5 proxy on 127.0.0.1:{}", active.info.local_port);
                return Ok(active.info.local_port);
            }
        }
    }

    // 2. Resolve SSH connection configuration
    let conn = crate::ssh::connection::resolve_connection(&state, &conn_id)
        .ok_or_else(|| format!("No active SSH connection found for '{}'. Please connect to a server first.", conn_id))?;

    let preferred = preferred_port.unwrap_or(1080);
    let effective_local_port = find_available_port(if preferred >= 1024 { preferred } else { 10800 });
    let host = conn.config.host.clone();
    let ssh_port = conn.config.port.to_string();
    let user = conn.config.username.clone();

    log::info!(
        "SSH Desktop: Spawning SSH SOCKS5 Proxy -D 127.0.0.1:{} via {}@{}:{}",
        effective_local_port, user, host, ssh_port
    );

    let is_ppk = conn.config.private_key_path.as_deref().map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    let mut spawned = false;
    let mut child_handle: Option<tokio::process::Child> = None;
    let mut last_error = String::new();

    // Approach A: Try Plink (best for Windows with passwords or PPK keys)
    let plink_bin = crate::ssh::connection::get_plink_path();
    if plink_bin != "plink" || std::path::Path::new(plink_bin).exists() || conn.config.password.is_some() || is_ppk {
        let mut cmd = tokio::process::Command::new(plink_bin);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.arg("-ssh")
            .arg("-N")
            .arg("-P").arg(&ssh_port)
            .arg("-l").arg(&user)
            .arg("-D").arg(format!("127.0.0.1:{}", effective_local_port));

        if let Some(pwd) = &conn.config.password {
            if !pwd.is_empty() {
                cmd.arg("-pw").arg(pwd);
            }
        }

        if let Some(key) = &conn.config.private_key_path {
            if crate::ssh::connection::resolve_key_path(key).is_some() {
                cmd.arg("-i").arg(key);
            }
        }

        cmd.arg(&host);
        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());

        match cmd.spawn() {
            Ok(mut child) => {
                if let Some(mut stdin) = child.stdin.take() {
                    tokio::spawn(async move {
                        let _ = tokio::io::AsyncWriteExt::write_all(&mut stdin, b"y\r\ny\r\n").await;
                        let _ = tokio::io::AsyncWriteExt::flush(&mut stdin).await;
                    });
                }
                child_handle = Some(child);
                spawned = true;
            }
            Err(e) => {
                last_error = format!("Plink SOCKS5 launch error: {}", e);
            }
        }
    }

    // Approach B: Try OpenSSH ssh (built into Windows 10/11)
    if !spawned {
        let mut cmd = tokio::process::Command::new("ssh");
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.arg("-N")
            .arg("-D").arg(format!("127.0.0.1:{}", effective_local_port))
            .arg("-p").arg(&ssh_port)
            .arg("-o").arg("StrictHostKeyChecking=no")
            .arg("-o").arg(if cfg!(windows) { "UserKnownHostsFile=NUL" } else { "UserKnownHostsFile=/dev/null" })
            .arg("-o").arg("ExitOnForwardFailure=yes");

        if let Some(key) = &conn.config.private_key_path {
            if crate::ssh::connection::resolve_key_path(key).is_some() {
                cmd.arg("-i").arg(key);
            }
        }

        cmd.arg(format!("{}@{}", user, host));
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());

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
        });
    }

    log::info!("SSH Desktop: SSH SOCKS5 Proxy active on 127.0.0.1:{}", effective_local_port);
    Ok(effective_local_port)
}

/// Stop an active SSH SOCKS5 proxy
#[tauri::command]
pub async fn ssh_stop_socks5(conn_id: String) -> Result<(), String> {
    let maybe_child = {
        let mut lock = ACTIVE_SOCKS5.lock();
        lock.remove(&conn_id).and_then(|mut active| active.child.take())
    };

    if let Some(mut child) = maybe_child {
        let _ = child.kill().await;
        log::info!("SSH Desktop: Stopped SSH SOCKS5 Proxy for {}", conn_id);
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
