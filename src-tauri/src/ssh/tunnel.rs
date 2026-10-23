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
    let ftype = tunnel_type.as_deref().unwrap_or("local").to_lowercase();
    if ftype == "dynamic" || ftype == "socks" || ftype == "socks5" {
        return ssh_start_socks5(state, conn_id, Some(if local_port > 0 { local_port } else { 1080 })).await;
    }

    let is_remote_forward = ftype == "remote" || ftype == "reverse" || ftype == "-r";
    let tunnel_key = if is_remote_forward {
        format!("{}:remote:{}:{}", conn_id, remote_port, local_port)
    } else {
        format!("{}:{}:{}", conn_id, remote_host, remote_port)
    };

    // 1. If an active tunnel for this server and remote port already exists, return its port
    let mut stale_child_to_kill = None;
    {
        let mut lock = ACTIVE_TUNNELS.lock();
        if let Some(active) = lock.get(&tunnel_key) {
            if is_remote_forward {
                return Ok(active.info.local_port);
            } else if std::net::TcpStream::connect(("127.0.0.1", active.info.local_port)).is_ok() {
                log::info!("SSH Desktop: Reusing active SSH tunnel for {}:{} on local port {}", remote_host, remote_port, active.info.local_port);
                return Ok(active.info.local_port);
            } else {
                // Stale tunnel that is not listening, clean it up so we can recreate it
                if let Some(mut stale) = lock.remove(&tunnel_key) {
                    stale_child_to_kill = stale.child.take();
                }
            }
        }
    }
    if let Some(mut ch) = stale_child_to_kill {
        let _ = ch.kill().await;
    }

    // 2. Resolve SSH connection configuration
    let conn = crate::ssh::connection::resolve_connection(&state, &conn_id)
        .ok_or_else(|| format!("No active SSH connection found for '{}'. Please connect to a server first.", conn_id))?;

    let effective_local_port = if is_remote_forward {
        if local_port > 0 { local_port } else { 3000 }
    } else if local_port > 0 {
        // If an existing tunnel is registered with this local_port, stop it first
        let mut dead_children = Vec::new();
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
                }
            }
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

    let is_ppk = conn.config.private_key_path.as_deref().map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    let plink_bin = crate::ssh::connection::get_plink_path();
    let plink_available = plink_bin != "plink" || std::path::Path::new(plink_bin).exists();
    let has_password = conn.config.password.as_deref().map(|p| !p.trim().is_empty()).unwrap_or(false);
    let is_pem_key = conn.config.private_key_path.as_deref().map(|k| !k.trim().is_empty() && !crate::ssh::connection::is_ppk_key(k)).unwrap_or(false);
    // Never use Plink for PEM keys (Plink only supports PuTTY .ppk keys)
    let prefer_plink = !is_pem_key && (is_ppk || has_password) && plink_available;

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
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.arg("-N");
        if is_remote_forward {
            cmd.arg("-R").arg(&forward_arg);
        } else {
            cmd.arg("-L").arg(&forward_arg);
        }

        cmd.arg("-p").arg(&ssh_port)
            .arg("-o").arg("StrictHostKeyChecking=no")
            .arg("-o").arg("UserKnownHostsFile=/dev/null")
            .arg("-o").arg("GlobalKnownHostsFile=/dev/null")
            .arg("-o").arg("ExitOnForwardFailure=yes")
            .arg("-o").arg("ConnectTimeout=10")
            .arg("-o").arg("ServerAliveInterval=30")
            .arg("-o").arg("ServerAliveCountMax=3");

        if let Some(key) = &conn.config.private_key_path {
            if crate::ssh::connection::resolve_key_path(key).is_some() {
                cmd.arg("-i").arg(key);
            }
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
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.arg("-ssh")
            .arg("-N")
            .arg("-P").arg(&ssh_port)
            .arg("-l").arg(&user);

        if is_remote_forward {
            cmd.arg("-R").arg(&forward_arg);
        } else {
            cmd.arg("-L").arg(&forward_arg);
        }

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
        cmd
    };

    if prefer_plink {
        used_plink_first = true;
        // Pre-cache host key in PuTTY registry to prevent batch mode / host key rejection
        #[cfg(windows)]
        {
            let mut probe = tokio::process::Command::new(plink_bin);
            probe.creation_flags(0x08000000);
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

        let mut cmd = make_plink_cmd();
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
            if let Ok(mut child) = cmd.spawn() {
                if let Some(mut stdin) = child.stdin.take() {
                    tokio::spawn(async move {
                        let _ = tokio::io::AsyncWriteExt::write_all(&mut stdin, b"y\r\ny\r\n").await;
                        let _ = tokio::io::AsyncWriteExt::flush(&mut stdin).await;
                    });
                }
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
            let mut stderr_msg = String::new();
            if let Some(mut stderr) = ch.stderr.take() {
                let mut buf = Vec::new();
                let _ = tokio::io::AsyncReadExt::read_to_end(&mut stderr, &mut buf).await;
                let text = String::from_utf8_lossy(&buf).trim().to_string();
                if !text.is_empty() {
                    stderr_msg = text;
                }
            }
            let _ = ch.kill().await;
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
        if let Some(mut active) = lock.remove(&tunnel_id) {
            active.child.take()
        } else {
            let matching_key = lock.iter().find(|(k, v)| {
                *k == &tunnel_id 
                || v.info.tunnel_id == tunnel_id 
                || v.info.local_port.to_string() == tunnel_id
                || k.ends_with(&format!(":{}", tunnel_id))
            }).map(|(k, _)| k.clone());
            
            if let Some(k) = matching_key {
                lock.remove(&k).and_then(|mut active| active.child.take())
            } else {
                None
            }
        }
    };

    if let Some(mut child) = maybe_child {
        let _ = child.kill().await;
        log::info!("SSH Desktop: Stopped SSH Tunnel {}", tunnel_id);
        return Ok(());
    }

    let maybe_socks = {
        let mut lock = ACTIVE_SOCKS5.lock();
        if let Some(mut active) = lock.remove(&tunnel_id) {
            active.child.take()
        } else {
            let matching_key = lock.iter().find(|(k, v)| {
                *k == &tunnel_id 
                || v.info.tunnel_id == tunnel_id 
                || v.info.local_port.to_string() == tunnel_id
                || k.contains(&tunnel_id)
            }).map(|(k, _)| k.clone());
            if let Some(k) = matching_key {
                lock.remove(&k).and_then(|mut active| active.child.take())
            } else {
                None
            }
        }
    };

    if let Some(mut child) = maybe_socks {
        let _ = child.kill().await;
        log::info!("SSH Desktop: Stopped SOCKS5 Tunnel {}", tunnel_id);
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

/// Start an SSH Dynamic SOCKS5 Proxy: binds 127.0.0.1:local_port (via ssh -D)
#[tauri::command]
pub async fn ssh_start_socks5(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    preferred_port: Option<u16>,
) -> Result<u16, String> {
    // 1. If an active SOCKS5 proxy already exists and is responsive for this connection, return its port
    let mut stale_socks_child = None;
    {
        let mut lock = ACTIVE_SOCKS5.lock();
        if let Some(active) = lock.get(&conn_id) {
            if std::net::TcpStream::connect(("127.0.0.1", active.info.local_port)).is_ok() {
                log::info!("SSH Desktop: Reusing active SOCKS5 proxy on 127.0.0.1:{}", active.info.local_port);
                return Ok(active.info.local_port);
            } else {
                if let Some(mut stale) = lock.remove(&conn_id) {
                    stale_socks_child = stale.child.take();
                }
            }
        }
    }
    if let Some(mut ch) = stale_socks_child {
        let _ = ch.kill().await;
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
    let plink_bin = crate::ssh::connection::get_plink_path();
    let plink_available = plink_bin != "plink" || std::path::Path::new(plink_bin).exists();
    let has_password = conn.config.password.as_deref().map(|p| !p.trim().is_empty()).unwrap_or(false);
    let is_pem_key = conn.config.private_key_path.as_deref().map(|k| !k.trim().is_empty() && !crate::ssh::connection::is_ppk_key(k)).unwrap_or(false);
    let prefer_plink = !is_pem_key && (is_ppk || has_password) && plink_available;

    let mut spawned = false;
    let mut child_handle: Option<tokio::process::Child> = None;
    let mut last_error = String::new();
    let mut used_plink_first = false;

    // Helper closure to build OpenSSH SOCKS5 command
    let make_openssh_cmd = || {
        let mut cmd = tokio::process::Command::new("ssh");
        #[cfg(windows)]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        cmd.arg("-N")
            .arg("-D").arg(format!("127.0.0.1:{}", effective_local_port))
            .arg("-p").arg(&ssh_port)
            .arg("-o").arg("StrictHostKeyChecking=no")
            .arg("-o").arg("UserKnownHostsFile=/dev/null")
            .arg("-o").arg("GlobalKnownHostsFile=/dev/null")
            .arg("-o").arg("ExitOnForwardFailure=yes")
            .arg("-o").arg("ConnectTimeout=10")
            .arg("-o").arg("ServerAliveInterval=30")
            .arg("-o").arg("ServerAliveCountMax=3");

        if let Some(key) = &conn.config.private_key_path {
            if crate::ssh::connection::resolve_key_path(key).is_some() {
                cmd.arg("-i").arg(key);
            }
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
        cmd
    };

    if prefer_plink {
        used_plink_first = true;
        let mut cmd = make_plink_cmd();
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
            if let Ok(mut child) = cmd.spawn() {
                if let Some(mut stdin) = child.stdin.take() {
                    tokio::spawn(async move {
                        let _ = tokio::io::AsyncWriteExt::write_all(&mut stdin, b"y\r\ny\r\n").await;
                        let _ = tokio::io::AsyncWriteExt::flush(&mut stdin).await;
                    });
                }
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
