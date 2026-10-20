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
                log::info!("CloudDesk: Reusing active SSH tunnel for {}:{} on local port {}", remote_host, remote_port, active.info.local_port);
                return Ok(active.info.local_port);
            }
        }
    }

    // 2. Resolve SSH connection configuration
    let conn = crate::ssh::connection::resolve_connection(&state, &conn_id)
        .ok_or_else(|| format!("No active SSH connection found for '{}'. Please connect to a server first.", conn_id))?;

    let effective_local_port = find_available_port(if local_port > 0 { local_port } else { remote_port });
    let host = conn.config.host.clone();
    let ssh_port = conn.config.port.to_string();
    let user = conn.config.username.clone();
    let remote_target = if remote_host.trim().is_empty() { "127.0.0.1".to_string() } else { remote_host.trim().to_string() };

    log::info!(
        "CloudDesk: Spawning SSH Tunnel -L 127.0.0.1:{}:{}:{} via {}@{}:{}",
        effective_local_port, remote_target, remote_port, user, host, ssh_port
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
            .arg("-batch")
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
        cmd.stdin(std::process::Stdio::null());
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::piped());

        match cmd.spawn() {
            Ok(child) => {
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
                return Err(err_msg);
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

    log::info!("CloudDesk: SSH Tunnel active on 127.0.0.1:{} (bound: {})", effective_local_port, bound);
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
        log::info!("CloudDesk: Stopped SSH Tunnel {}", tunnel_id);
    }
    Ok(())
}

/// List all active SSH port forwarding tunnels
#[tauri::command]
pub async fn ssh_list_tunnels() -> Result<Vec<TunnelInfo>, String> {
    let lock = ACTIVE_TUNNELS.lock();
    Ok(lock.values().map(|a| a.info.clone()).collect())
}
