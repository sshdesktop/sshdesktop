use serde::{Deserialize, Serialize};
use std::time::Instant;
use std::collections::HashMap;
use parking_lot::Mutex;

lazy_static::lazy_static! {
    static ref EXEC_STREAMS: Mutex<HashMap<String, tokio::task::AbortHandle>> = Mutex::new(HashMap::new());
    static ref CONNECTING_SESSIONS: Mutex<std::collections::HashSet<String>> = Mutex::new(std::collections::HashSet::new());
}

struct ExecStreamGuard(String);
impl Drop for ExecStreamGuard {
    fn drop(&mut self) {
        EXEC_STREAMS.lock().remove(&self.0);
    }
}
use tauri::{Emitter, Manager};
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StreamChunk {
    pub stream_id: String,
    pub data: String,
    pub is_stderr: bool,
    pub is_done: bool,
    pub exit_code: Option<i32>,
}

/// Send command input without allowing a stalled SSH subprocess to hang forever.
async fn write_child_stdin(
    child: &mut tokio::process::Child,
    data: &[u8],
) -> Result<(), String> {
    let mut stdin = child.stdin.take().ok_or("SSH process stdin was not available")?;
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        tokio::io::AsyncWriteExt::write_all(&mut stdin, data),
    ).await.map_err(|_| "Timed out sending input to SSH process")?
        .map_err(|e| format!("Failed to send input to SSH process: {}", e))?;
    Ok(())
}


/// Drain a subprocess pipe while retaining at most the configured number of bytes.
/// Continuing to drain after the cap prevents a child from deadlocking on a full pipe.
async fn read_subprocess_output<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    limit: usize,
) -> std::io::Result<(Vec<u8>, bool)> {
    use tokio::io::AsyncReadExt;
    let mut retained = Vec::with_capacity(limit.min(64 * 1024));
    let mut buffer = [0u8; 16 * 1024];
    let mut exceeded = false;
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        let remaining = limit.saturating_sub(retained.len());
        let keep = remaining.min(count);
        retained.extend_from_slice(&buffer[..keep]);
        if keep < count {
            exceeded = true;
        }
    }
    Ok((retained, exceeded))
}

/// Wait for an SSH client without allowing remote output to exhaust local memory.
/// Each stream is capped at 8 MiB; excess bytes are drained but never retained.
async fn wait_with_limited_output(
    mut child: tokio::process::Child,
) -> Result<std::process::Output, String> {
    const MAX_STREAM_BYTES: usize = 8 * 1024 * 1024;
    let stdout = child.stdout.take().ok_or("SSH subprocess stdout was not piped")?;
    let stderr = child.stderr.take().ok_or("SSH subprocess stderr was not piped")?;
    let (stdout_result, stderr_result, status_result) = tokio::join!(
        read_subprocess_output(stdout, MAX_STREAM_BYTES),
        read_subprocess_output(stderr, MAX_STREAM_BYTES),
        child.wait()
    );
    let (stdout, stdout_exceeded) = stdout_result
        .map_err(|e| format!("Failed reading SSH subprocess stdout: {}", e))?;
    let (stderr, stderr_exceeded) = stderr_result
        .map_err(|e| format!("Failed reading SSH subprocess stderr: {}", e))?;
    let status = status_result.map_err(|e| format!("Failed waiting for SSH subprocess: {}", e))?;
    if stdout_exceeded || stderr_exceeded {
        return Err("SSH command output exceeded the 8 MiB per-stream safety limit; output was truncated.".into());
    }
    Ok(std::process::Output { status, stdout, stderr })
}

/// Helper: run a command on the remote server via SSH (plink or openssh).
/// Returns (stdout, exit_code). exit_code = -1 means no connection / spawn error.
pub async fn run_cmd(state: &AppState, conn_id: &str, command: &str) -> (String, i32) {
    if command.trim().is_empty() || command.len() > 1024 * 1024 || command.contains('\0') {
        return ("SSH command must be non-empty, contain no NUL bytes, and be at most 1 MiB.".into(), -1);
    }
    // 0. Primary Fast Path: Execute directly over active persistent in-memory SSH transport
    {
        let handle_opt = {
            let sessions = state.sessions.lock().await;
            if conn_id == "default" {
                sessions.get("default").cloned()
            } else if conn_id.is_empty() {
                None
            } else {
                sessions.get(conn_id).cloned()
            }
        };
        if let Some(handle) = handle_opt {
            match crate::ssh::session::run_exec_channel(&handle, command).await {
                Ok((stdout, stderr, code)) => {
                    let out = if !stderr.is_empty() && !stdout.is_empty() {
                        format!("{}\n{}", stdout.trim_end(), stderr.trim_start())
                    } else if !stderr.is_empty() {
                        stderr
                    } else {
                        stdout
                    };
                    return (out, code);
                }
                Err(e) => {
                    // A failed channel open/command exchange is evidence that this
                    // persistent transport may no longer be usable. Evict only this
                    // exact handle (it may have been replaced concurrently), mark its
                    // owning connection disconnected, and never replay the command.
                    let target_id = {
                        let map = state.connections.lock();
                        if conn_id == "default" {
                            map.get("default").map(|connection| connection.id.clone())
                        } else {
                            Some(conn_id.to_string())
                        }
                    };

                    let mut connection_guard = None;
                    if let Some(ref id) = target_id {
                        let connection_lock = {
                            let mut locks = state.connection_locks.lock();
                            locks.retain(|_, weak_lock| weak_lock.strong_count() > 0);
                            match locks.get(id).and_then(std::sync::Weak::upgrade) {
                                Some(existing) => existing,
                                None => {
                                    let created = std::sync::Arc::new(tokio::sync::Mutex::new(()));
                                    locks.insert(id.clone(), std::sync::Arc::downgrade(&created));
                                    created
                                }
                            }
                        };
                        connection_guard = Some(connection_lock.lock_owned().await);
                    }

                    let was_current = {
                        let mut sessions = state.sessions.lock().await;
                        let found = sessions.values().any(|candidate| std::sync::Arc::ptr_eq(candidate, &handle));
                        if found {
                            sessions.retain(|_, candidate| !std::sync::Arc::ptr_eq(candidate, &handle));
                        }
                        found
                    };

                    if was_current {
                        if let Some(ref id) = target_id {
                            let mut map = state.connections.lock();
                            if let Some(connection) = map.get_mut(id) {
                                connection.connected = false;
                            }
                            if map.get("default").map(|connection| connection.id == *id).unwrap_or(false) {
                                if let Some(default_connection) = map.get_mut("default") {
                                    default_connection.connected = false;
                                }
                            }
                            crate::ssh::connection::invalidate_user_privilege_cache(id);
                        }

                        let _ = tokio::time::timeout(
                            std::time::Duration::from_millis(800),
                            handle.disconnect(
                                russh::Disconnect::ByApplication,
                                "SSH transport became unhealthy",
                                "en",
                            ),
                        ).await;
                    }
                    drop(connection_guard);

                    log::warn!("SSH Desktop: Persistent SSH transport evicted after command channel failure for {}: {}; command was not replayed", conn_id, e);
                    return (format!("SSH connection is no longer healthy; command was not retried to avoid duplicate execution: {}", e), -1);
                }
            }
        }
    }

    // Resolve connection (exact id, saved connection on disk, or fallback)
    let conn = match crate::ssh::connection::resolve_connection(state, conn_id) {
        Some(c) => c,
        None => return (String::new(), -1),
    };
    if conn.config.auth_method.as_deref() == Some("key")
        && conn.config.private_key_path.as_deref().map(|path| path.trim().is_empty()).unwrap_or(true)
    {
        return ("Key authentication was selected, but no private key was configured.".into(), -1);
    }

    // Attempt lazy persistent session establishment for future instantaneous calls (deduplicating concurrent attempts)
    let should_spawn = if !conn_id.is_empty() && conn_id != "default" {
        let is_empty = state.sessions.lock().await.get(conn_id).is_none();
        if is_empty {
            let mut connecting = CONNECTING_SESSIONS.lock();
            if !connecting.contains(conn_id) {
                connecting.insert(conn_id.to_string());
                true
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    if should_spawn {
        let conn_clone = conn.clone();
        let state_sessions = state.sessions.clone();
        let state_connections = state.connections.clone();
        let connection_locks = state.connection_locks.clone();
        let cid = conn_id.to_string();
        tokio::spawn(async move {
            struct InFlightGuard(String);
            impl Drop for InFlightGuard {
                fn drop(&mut self) {
                    CONNECTING_SESSIONS.lock().remove(&self.0);
                }
            }
            let _guard = InFlightGuard(cid.clone());

            let is_key_auth = match conn_clone.config.auth_method.as_deref() {
                Some("password") => false,
                Some("key") => true,
                _ => conn_clone.config.private_key_path.is_some() || conn_clone.config.password.is_none(),
            };
            let handle = match crate::ssh::session::connect_session_with_passphrase_auth(
                &conn_clone.config.host,
                conn_clone.config.port,
                &conn_clone.config.username,
                if is_key_auth { None } else { conn_clone.config.password.as_deref() },
                if is_key_auth { conn_clone.config.private_key_path.as_deref() } else { None },
                conn_clone.config.passphrase.as_deref(),
                conn_clone.config.auth_method.as_deref() != Some("password"),
            ).await {
                Ok(handle) => handle,
                Err(error) => {
                    log::warn!("SSH Desktop: Lazy persistent connection failed for {}: {}", conn_clone.config.host, error);
                    return;
                }
            };

            // Use the same per-connection lock as explicit connect/disconnect.
            // This prevents a background lazy connect from resurrecting a session
            // after disconnect or overwriting a newer authenticated transport.
            let connection_lock = {
                let mut locks = connection_locks.lock();
                locks.retain(|_, weak_lock| weak_lock.strong_count() > 0);
                match locks.get(&cid).and_then(std::sync::Weak::upgrade) {
                    Some(existing) => existing,
                    None => {
                        let created = std::sync::Arc::new(tokio::sync::Mutex::new(()));
                        locks.insert(cid.clone(), std::sync::Arc::downgrade(&created));
                        created
                    }
                }
            };
            let _connection_guard = connection_lock.lock_owned().await;

            let still_configured = state_connections.lock()
                .get(&cid)
                .map(|current| current.config.host == conn_clone.config.host
                    && current.config.port == conn_clone.config.port
                    && current.config.username == conn_clone.config.username)
                .unwrap_or(false);
            if !still_configured {
                let _ = tokio::time::timeout(
                    std::time::Duration::from_millis(800),
                    handle.disconnect(russh::Disconnect::ByApplication, "Lazy SSH connection became stale", "en"),
                ).await;
                return;
            }

            let mut map = state_sessions.lock().await;
            if map.contains_key(&cid) {
                // An explicit reconnect won the race; never replace its transport.
                drop(map);
                let _ = tokio::time::timeout(
                    std::time::Duration::from_millis(800),
                    handle.disconnect(russh::Disconnect::ByApplication, "Superseded lazy SSH connection", "en"),
                ).await;
                return;
            }
            map.insert(cid.clone(), std::sync::Arc::new(handle));
            if let Some(connection) = state_connections.lock().get_mut(&cid) {
                connection.connected = true;
                connection.connected_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_secs() as i64)
                    .unwrap_or(0);
            }
            log::info!("SSH Desktop: Lazily established persistent SSH transport for {}", conn_clone.config.host);
        });
    }


    let host = conn.config.host.clone();
    let port = conn.config.port.to_string();
    let user = conn.config.username.clone();
    let destination = format!("{}@{}", user, host);

    let is_key_auth = match conn.config.auth_method.as_deref() {
        Some("password") => false,
        Some("key") => true,
        _ => conn.config.private_key_path.is_some() || conn.config.password.is_none(),
    };
    let configured_key_path = if is_key_auth { conn.config.private_key_path.as_deref() } else { None };
    if conn.config.auth_method.as_deref() == Some("key")
        && configured_key_path.map(|path| path.trim().is_empty()).unwrap_or(true)
    {
        return ("Key authentication was selected, but no private key was configured.".into(), -1);
    }
    let resolved_key_path = match configured_key_path {
        Some(path) => match crate::ssh::connection::resolve_key_path(path) {
            Some(resolved) => Some(resolved),
            None => return (format!("Selected SSH identity '{}' could not be found. No alternate key will be used.", path), -1),
        },
        None => None,
    };
    let selected_key_path = resolved_key_path.as_deref();

    // ── 1. Password auth via plink (only if not key auth) ───────────────────
    if !is_key_auth {
        if let Some(pwd) = &conn.config.password {
            if !pwd.is_empty() {
                let password_file = match crate::ssh::connection::create_password_file(pwd) {
                    Ok(file) => file,
                    Err(error) => return (error, -1),
                };
                for attempt in 0..2 {
                let mut cmd = tokio::process::Command::new(crate::ssh::connection::get_plink_path());
            cmd.kill_on_drop(true);
                #[cfg(windows)]
                cmd.creation_flags(0x08000000);

                cmd.arg("-ssh")
                    .arg("-batch")          // never prompt for host key
                    .arg("-P").arg(&port)
                    .arg("-l").arg(&user)
                    .arg("-pwfile").arg(password_file.path())
                    .arg(&host)
                    .arg(command)
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());

                if let Ok(child) = cmd.spawn() {
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(35),
                        wait_with_limited_output(child),
                    ).await {
                        Ok(Ok(output)) => {
                            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                            let raw_stderr = String::from_utf8_lossy(&output.stderr).to_string();
                            let stderr = raw_stderr
                                .lines()
                                .filter(|l| !l.contains("Server refused our key"))
                                .collect::<Vec<_>>()
                                .join("\n")
                                .trim()
                                .to_string();
                            let exit_code = output.status.code().unwrap_or(-1);

                            // Once Plink has spawned, the remote command may already have
                            // started even when the SSH transport exits with an error.
                            // Never replay a potentially non-idempotent command automatically.

                            if !stdout.is_empty() || output.status.success() {
                                return (stdout, exit_code);
                            }
                            if !stderr.is_empty() {
                                return (stderr, exit_code);
                            }
                            return (String::new(), exit_code);
                        }
                        Ok(Err(e)) => {
                            log::warn!("SSH Desktop: plink wait error for {}: {}", host, e);
                            return (format!("Plink reported a wait error after the remote command may have started: {}", e), -1);
                        }
                        Err(_) => {
                            log::warn!("SSH Desktop: plink command timed out for {}", host);
                            return (String::new(), -1);
                        }
                    }
                } else if attempt == 0 {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    continue;
                }
            }
        }
    }
}

    // ── 2. Key auth via Plink (for PPK) or OpenSSH (for PEM) ────────────────
    let is_ppk = selected_key_path.map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    if is_ppk {
        let plink_bin = crate::ssh::connection::get_plink_path();
        for attempt in 0..2 {
            let mut cmd = tokio::process::Command::new(plink_bin);
        cmd.kill_on_drop(true);
            #[cfg(windows)]
            cmd.creation_flags(0x08000000);

            cmd.arg("-ssh")
                .arg("-batch")
                .arg("-P").arg(&port)
                .arg("-l").arg(&user);

            if let Some(key_path) = selected_key_path {
                cmd.arg("-i").arg(key_path);
            }

            cmd.arg(&host)
                .arg(command)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            if let Ok(child) = cmd.spawn() {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(35),
                    wait_with_limited_output(child),
                ).await {
                    Ok(Ok(output)) => {
                        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                        let raw_stderr = String::from_utf8_lossy(&output.stderr).to_string();
                        let stderr = raw_stderr
                            .lines()
                            .filter(|l| !l.contains("Server refused our key"))
                            .collect::<Vec<_>>()
                            .join("\n")
                            .trim()
                            .to_string();
                        let exit_code = output.status.code().unwrap_or(-1);

                        if !stdout.is_empty() || output.status.success() {
                            return (stdout, exit_code);
                        }
                        if !stderr.is_empty() {
                            return (stderr, exit_code);
                        }
                        return (String::new(), exit_code);
                    }
                    Ok(Err(e)) => {
                        log::warn!("SSH Desktop: plink ppk wait error for {}: {}", host, e);
                        return (format!("Plink reported a wait error after the remote command may have started: {}", e), -1);
                    }
                    Err(_) => {
                        log::warn!("SSH Desktop: Plink key command timed out for {}", host);
                        return (String::new(), -1);
                    }
                }
            }
        }
    }

    // ── 3. PEM / OpenSSH key auth via OpenSSH ──────────────────────────────
    let mut ssh_cmd = tokio::process::Command::new("ssh");
    ssh_cmd.kill_on_drop(true);
    if !is_key_auth {
        ssh_cmd.arg("-o").arg("PubkeyAuthentication=no");
    }
    #[cfg(windows)]
    ssh_cmd.creation_flags(0x08000000);

    ssh_cmd
        .arg("-p").arg(&port)
        .arg("-o").arg("StrictHostKeyChecking=yes")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("IdentitiesOnly=yes")
        .arg("-o").arg("ConnectTimeout=8")
        .arg("-o").arg("ServerAliveInterval=10")
        .arg("-o").arg("ServerAliveCountMax=2");

    if let Some(key_path) = selected_key_path {
        if let Some(resolved_key) = crate::ssh::connection::resolve_key_path(key_path) {
            ssh_cmd.arg("-i").arg(resolved_key);
        }
    }

    ssh_cmd
        .arg(&destination)
        .arg(command)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let child = match ssh_cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            log::warn!("SSH Desktop: ssh spawn error for {}: {}", host, e);
            return (String::new(), -1);
        }
    };
    match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        wait_with_limited_output(child),
    ).await {
        Ok(Ok(output)) => {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);
            if !stdout.is_empty() || output.status.success() {
                return (stdout, exit_code);
            }
            if !stderr.is_empty() {
                return (stderr, exit_code);
            }
            return (String::new(), exit_code);
        }
        Ok(Err(e)) => {
            log::warn!("SSH Desktop: bounded command output failed for {}: {}", host, e);
        }
        Err(_) => {
            log::warn!("SSH Desktop: OpenSSH command timed out for {}", host);
        }
    }

    (String::new(), -1)
}

/// Helper: run a privileged command on the remote server following the 3 priority conditions:
/// 1st Condition: If user is root (or username is root), run directly without sudo (strip any sudo prefix).
/// 2nd Condition: If user has passwordless sudo, run with `sudo -n`.
/// 3rd Condition: If user requires password, run with `sudo -S` using session password. If not in sudoers, return clean error.
pub async fn run_cmd_priv(state: &AppState, conn_id: &str, command: &str) -> (String, i32) {
    let conn_opt = crate::ssh::connection::resolve_connection(state, conn_id);
    let trimmed_cmd = command.trim();
    let raw_cmd = trimmed_cmd.strip_prefix("sudo ").unwrap_or(trimmed_cmd).trim();
    // Normalize nested sudo in pipes/chains since the entire subshell will be elevated
    // The whole shell command is already executed inside sudo. Avoid textual
    // substitutions that can corrupt quoted literals or alter command meaning.
    let normalized_cmd = raw_cmd.to_string();

    let conn = match conn_opt {
        Some(c) => c,
        None => return ("No saved SSH connection is available for privileged execution; refusing to run without privilege handling.".into(), -1),
    };

    let username = &conn.config.username;

    // ── 0th Condition: Fast check if user is already known to lack sudo ────
    if let Some(priv_info) = crate::ssh::connection::get_cached_user_privilege_for_user(conn_id, username) {
        if !priv_info.has_sudo && !priv_info.is_root {
            let msg = format!(
                "Permission Denied: User '{}' does not have administrator (sudo) privileges on this server.",
                username
            );
            log::warn!("SSH Desktop: Fast-failing privileged command for non-sudo user: {}", msg);
            return (msg, 126);
        }
    }

    // ── 1st Condition: Is the user root? ────────────────────────────────────
    // If username is "root", execute directly without sudo (never needs sudo, avoids "sudo: command not found")
    if username == "root" {
        return run_cmd(state, conn_id, &normalized_cmd).await;
    }

    // ── 2nd Condition: Does the user have Passwordless Sudo? (sudo -n) ─────
    let escaped_raw = normalized_cmd.replace('\'', r"'\''");
    let sudo_n_cmd = format!("sudo -n -- sh -c '{}' 2>&1", escaped_raw);
    let (n_out, n_code) = run_cmd(state, conn_id, &sudo_n_cmd).await;

    // If sudo -n succeeded, return immediately!
    if n_code == 0 {
        return (n_out, n_code);
    }

    // ── 3rd Condition: Evaluate why sudo -n failed ──────────────────────────
    let lower_out = n_out.to_lowercase();

    // 3A. User is NOT in the sudoers file (No sudo permission)
    if lower_out.contains("not in the sudoers file")
        || lower_out.contains("is not allowed to execute")
        || lower_out.contains("not in sudoers")
    {
        if let Some(mut p) = crate::ssh::connection::get_cached_user_privilege_for_user(conn_id, username) {
            p.has_sudo = false;
            p.sudo_type = "none".to_string();
            crate::ssh::connection::set_cached_user_privilege(conn_id, p);
        }
        let msg = format!(
            "Permission Denied: User '{}' does not have administrator (sudo) privileges on this server.\n{}",
            username,
            n_out.trim()
        );
        log::warn!("SSH Desktop: {}", msg);
        return (msg, n_code);
    }

    // 3B. /usr/bin/sudo SUID permission broken on server (effective UID is not 0 / nosuid)
    if lower_out.contains("effective uid is not 0") || lower_out.contains("nosuid") {
        let msg = format!(
            "Server Permission Error: /usr/bin/sudo has lost its setuid root permissions on the server.\n\
             Fix on your server by running as root:\n\
               chown root:root /usr/bin/sudo && chmod 4755 /usr/bin/sudo\n\
             Or connect in SSH Desktop as 'root' using your PEM key."
        );
        log::error!("SSH Desktop: {}", msg);
        return (msg, n_code);
    }

    // Only retry with a password when sudo explicitly reports that one is required.
    let password_required = lower_out.contains("password is required")
        || lower_out.contains("a password is required")
        || lower_out.contains("no password was provided");
    if !password_required {
        return (n_out, n_code);
    }

    // 3C. User requires a password for sudo (sudo -S)
    if let Some(ref pwd) = conn.config.password {
        if !pwd.is_empty() {
            let sudo_s_cmd = format!(
                "sudo -S -p '' -- sh -c '{}' 2>&1",
                escaped_raw
            );
            let mut password_input = pwd.as_bytes().to_vec();
            password_input.push(b'\n');
            let (s_out, s_code) = run_cmd_with_stdin(state, conn_id, &sudo_s_cmd, &password_input).await;

            if s_code == 0 {
                return (s_out, s_code);
            }

            let s_lower = s_out.to_lowercase();
            if s_lower.contains("effective uid is not 0") || s_lower.contains("nosuid") {
                let msg = format!(
                    "Server Permission Error: /usr/bin/sudo has lost its setuid root permissions on the server.\n\
                     Fix on your server by running as root:\n\
                       chown root:root /usr/bin/sudo && chmod 4755 /usr/bin/sudo\n\
                     Or connect in SSH Desktop as 'root' using your PEM key."
                );
                log::error!("SSH Desktop: {}", msg);
                return (msg, s_code);
            }

            if s_lower.contains("not in the sudoers file")
                || s_lower.contains("is not allowed to execute")
            {
                let msg = format!(
                    "Permission Denied: User '{}' does not have administrator (sudo) privileges on this server.\n{}",
                    username,
                    s_out.trim()
                );
                return (msg, s_code);
            }

            if s_lower.contains("incorrect password")
                || s_lower.contains("authentication failure")
                || s_lower.contains("sorry, try again")
            {
                let msg = format!(
                    "Authentication Failed: Sudo password for user '{}' was rejected.\n{}",
                    username,
                    s_out.trim()
                );
                return (msg, s_code);
            }

            return (s_out, s_code);
        }
    }

    // If user has no password stored (e.g. key auth) and sudo -n required a password
    if lower_out.contains("password is required") || lower_out.contains("terminal is required") {
        let msg = format!(
            "Permission Denied: Sudo password required for user '{}', but no password is saved in session.",
            username
        );
        return (msg, n_code);
    }

    // Fallback: return the output of sudo -n
    (n_out, n_code)
}

/// Helper: run a command on the remote server via SSH while streaming data into stdin.
pub async fn run_cmd_with_stdin(
    state: &AppState,
    conn_id: &str,
    command: &str,
    stdin_data: &[u8],
) -> (String, i32) {
    if command.trim().is_empty() || command.len() > 1024 * 1024 || command.contains('\0') {
        return ("SSH command must be non-empty, contain no NUL bytes, and be at most 1 MiB.".into(), -1);
    }
    const MAX_STDIN_BYTES: usize = 64 * 1024 * 1024;
    if stdin_data.len() > MAX_STDIN_BYTES {
        return ("SSH command input exceeds the 64 MiB safety limit.".into(), -1);
    }
    // 0. Primary Fast Path: Execute directly over active persistent in-memory SSH transport
    {
        let handle_opt = {
            let sessions = state.sessions.lock().await;
            if conn_id == "default" {
                sessions.get("default").cloned()
            } else if conn_id.is_empty() {
                None
            } else {
                sessions.get(conn_id).cloned()
            }
        };
        if let Some(handle) = handle_opt {
            match crate::ssh::session::run_exec_channel_with_stdin(&handle, command, stdin_data).await {
                Ok((stdout, code)) => {
                    return (stdout, code);
                }
                Err(e) => {
                    log::warn!("SSH Desktop: Persistent stdin channel failed for {}: {}; refusing automatic replay", conn_id, e);
                    return (format!("SSH input channel failed; operation was not retried to avoid duplicate execution: {}", e), -1);
                }
            }
        }
    }

    // Resolve connection
    let conn = match crate::ssh::connection::resolve_connection(state, conn_id) {
        Some(c) => c,
        None => return (String::new(), -1),
    };

    let host = conn.config.host.clone();
    let port = conn.config.port.to_string();
    let user = conn.config.username.clone();
    let destination = format!("{}@{}", user, host);

    let is_key_auth = match conn.config.auth_method.as_deref() {
        Some("password") => false,
        Some("key") => true,
        _ => conn.config.private_key_path.is_some() || conn.config.password.is_none(),
    };
    let selected_key_path = if is_key_auth { conn.config.private_key_path.as_deref() } else { None };
    if conn.config.auth_method.as_deref() == Some("key")
        && selected_key_path.map(|path| path.trim().is_empty()).unwrap_or(true)
    {
        return ("Key authentication was selected, but no private key was configured.".into(), -1);
    }
    if let Some(key_path) = selected_key_path {
        if crate::ssh::connection::resolve_key_path(key_path).is_none() {
            return (format!("Selected SSH identity '{}' could not be found. No alternate key will be used.", key_path), -1);
        }
    }

    // 1. Password auth via plink (only if not key auth)
    if !is_key_auth {
        if let Some(pwd) = &conn.config.password {
            if !pwd.is_empty() {
            let password_file = match crate::ssh::connection::create_password_file(pwd) {
                Ok(file) => file,
                Err(error) => return (error, -1),
            };
            let mut cmd = tokio::process::Command::new(crate::ssh::connection::get_plink_path());
            cmd.kill_on_drop(true);
            #[cfg(windows)]
            cmd.creation_flags(0x08000000);
            cmd.arg("-ssh")
                .arg("-batch")
                .arg("-P").arg(&port)
                .arg("-l").arg(&user)
                .arg("-pwfile").arg(password_file.path())
                .arg(&host)
                .arg(command)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            if let Ok(mut child) = cmd.spawn() {
                if let Err(error) = write_child_stdin(&mut child, stdin_data).await {
                    let _ = child.kill().await;
                    return (error, -1);
                }
                let output = match tokio::time::timeout(std::time::Duration::from_secs(60), wait_with_limited_output(child)).await {
                    Ok(Ok(output)) => output,
                    Ok(Err(error)) => return (format!("SSH subprocess wait failed: {}", error), -1),
                    Err(_) => return ("SSH subprocess timed out; refusing authentication fallback to avoid replay.".into(), -1),
                };

                    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                    let exit_code = output.status.code().unwrap_or(-1);
                    if !stdout.is_empty() || output.status.success() {
                        return (stdout, exit_code);
                    }
                    return (stderr, exit_code);
                
            }
        }
    }
}

    // 2. PPK Key auth via plink
    let is_ppk = selected_key_path.map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    if is_ppk {
        let plink_bin = crate::ssh::connection::get_plink_path();
        let mut cmd = tokio::process::Command::new(plink_bin);
        cmd.kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        cmd.arg("-ssh")
            .arg("-batch")
            .arg("-P").arg(&port)
            .arg("-l").arg(&user);
        if let Some(key_path) = &conn.config.private_key_path {
            if let Some(resolved_key) = crate::ssh::connection::resolve_key_path(key_path) {
                cmd.arg("-i").arg(resolved_key);
            }
        }
        cmd.arg(&host)
            .arg(command)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        if let Ok(mut child) = cmd.spawn() {
            if let Err(error) = write_child_stdin(&mut child, stdin_data).await {
                let _ = child.kill().await;
                return (error, -1);
            }
            let output = match tokio::time::timeout(std::time::Duration::from_secs(60), wait_with_limited_output(child)).await {
                Ok(Ok(output)) => output,
                Ok(Err(error)) => return (format!("SSH subprocess wait failed: {}", error), -1),
                Err(_) => return ("SSH subprocess timed out; refusing authentication fallback to avoid replay.".into(), -1),
            };

                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let exit_code = output.status.code().unwrap_or(-1);
                if !stdout.is_empty() || output.status.success() {
                    return (stdout, exit_code);
                }
                return (stderr, exit_code);
            
        }
    }

    // 3. PEM Key auth via OpenSSH
    let mut ssh_cmd = tokio::process::Command::new("ssh");
    ssh_cmd.kill_on_drop(true);
    #[cfg(windows)]
    ssh_cmd.creation_flags(0x08000000);
    ssh_cmd
        .arg("-p").arg(&port)
        .arg("-o").arg("StrictHostKeyChecking=yes")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("IdentitiesOnly=yes")
        .arg("-o").arg("ConnectTimeout=10");
    if !is_key_auth {
        ssh_cmd.arg("-o").arg("PubkeyAuthentication=no");
    }

    if let Some(key_path) = selected_key_path {
        if let Some(resolved_key) = crate::ssh::connection::resolve_key_path(key_path) {
            ssh_cmd.arg("-i").arg(resolved_key);
        }
    }

    ssh_cmd
        .arg(&destination)
        .arg(command)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Ok(mut child) = ssh_cmd.spawn() {
        if let Err(error) = write_child_stdin(&mut child, stdin_data).await {
            let _ = child.kill().await;
            return (error, -1);
        }
        let output = match tokio::time::timeout(std::time::Duration::from_secs(60), wait_with_limited_output(child)).await {
            Ok(Ok(output)) => output,
            Ok(Err(error)) => return (format!("SSH subprocess wait failed: {}", error), -1),
            Err(_) => return ("SSH subprocess timed out; refusing authentication fallback to avoid replay.".into(), -1),
        };

            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);
            if !stdout.is_empty() || output.status.success() {
                return (stdout, exit_code);
            }
            return (stderr, exit_code);
        
    }

    (String::new(), -1)
}

/// Helper: run an elevated (sudo) command while streaming data into stdin.
pub async fn run_cmd_priv_with_stdin(
    state: &AppState,
    conn_id: &str,
    command: &str,
    stdin_data: &[u8],
) -> (String, i32) {
    const MAX_STDIN_BYTES: usize = 64 * 1024 * 1024;
    if stdin_data.len() > MAX_STDIN_BYTES {
        return ("Privileged SSH command input exceeds the 64 MiB safety limit.".into(), -1);
    }
    let conn_opt = crate::ssh::connection::resolve_connection(state, conn_id);
    let trimmed_cmd = command.trim();
    if trimmed_cmd.is_empty() || command.len() > 1024 * 1024 || command.contains('\0') {
        return ("Privileged SSH command must be non-empty, contain no NUL bytes, and be at most 1 MiB.".into(), -1);
    }
    let raw_cmd = trimmed_cmd.strip_prefix("sudo ").unwrap_or(trimmed_cmd).trim();

    let conn = match conn_opt {
        Some(c) => c,
        None => return ("No saved SSH connection is available for privileged input; refusing to run without privilege handling.".into(), -1),
    };

    let username = &conn.config.username;

    // Fast check if user is known to lack sudo
    if let Some(priv_info) = crate::ssh::connection::get_cached_user_privilege_for_user(conn_id, username) {
        if !priv_info.has_sudo && !priv_info.is_root {
            return (format!("Permission Denied: User '{}' does not have administrator (sudo) privileges on this server.", username), 126);
        }
    }

    if username == "root" {
        return run_cmd_with_stdin(state, conn_id, raw_cmd, stdin_data).await;
    }

    let sudo_n_cmd = format!("sudo -n -- sh -c '{}' 2>&1", raw_cmd.replace('\'', r"'\''"));
    let (n_out, n_code) = run_cmd_with_stdin(state, conn_id, &sudo_n_cmd, stdin_data).await;
    if n_code == 0 {
        return (n_out, n_code);
    }
    let n_out_lower = n_out.to_ascii_lowercase();
    let password_required = n_out_lower.contains("password is required")
        || n_out_lower.contains("a password is required")
        || n_out_lower.contains("no password was provided");
    if !password_required {
        return (n_out, n_code);
    }

    if let Some(ref pwd) = conn.config.password {
        if !pwd.is_empty() {
            if pwd.contains('\n') || pwd.contains('\r') {
                return ("Refusing sudo elevation: password contains invalid newline characters.".into(), 1);
            }
            // Never place the sudo password in a remote shell command or process
            // argument list. Send it through the SSH channel stdin instead.
            let sudo_s_cmd = format!(
                "sudo -S -p '' -- sh -c '{}' 2>&1",
                raw_cmd.replace('\'', r"'\''")
            );
            if pwd.len().saturating_add(1).saturating_add(stdin_data.len()) > MAX_STDIN_BYTES {
                return ("Privileged SSH input, including the sudo password, exceeds the 64 MiB safety limit.".into(), -1);
            }
            let mut sudo_input = Vec::with_capacity(pwd.len() + 1 + stdin_data.len());
            sudo_input.extend_from_slice(pwd.as_bytes());
            sudo_input.push(b'\n');
            sudo_input.extend_from_slice(stdin_data);
            return run_cmd_with_stdin(state, conn_id, &sudo_s_cmd, &sudo_input).await;
        }
    }

    (n_out, n_code)
}

#[tauri::command]
pub async fn ssh_exec(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    command: String,
) -> Result<CommandResult, String> {
    let start = Instant::now();
    let trimmed = command.trim();
    if trimmed.is_empty() || command.len() > 1024 * 1024 || command.contains('\0') {
        return Err("SSH command must be non-empty, contain no NUL bytes, and be at most 1 MiB.".into());
    }

    // First, verify that a connection exists or can be resolved
    if crate::ssh::connection::resolve_connection(&state, &conn_id).is_none() {
        return Err(format!(
            "No active SSH connection for id '{}'. Please connect to a server first.",
            conn_id
        ));
    }

    // If command explicitly starts with sudo or contains sudo in pipeline, execute via run_cmd_priv
    let needs_priv = trimmed.starts_with("sudo ");
    let (stdout, stderr, exit_code) = if needs_priv {
        let (out, code) = run_cmd_priv(&state, &conn_id, trimmed).await;
        (out, String::new(), code)
    } else {
        // Fast path: try persistent native channel with split stdout/stderr
        let handle_opt = {
            let sessions = state.sessions.lock().await;
            if conn_id == "default" {
                sessions.get("default").cloned()
            } else if conn_id.is_empty() {
                None
            } else {
                sessions.get(&conn_id).cloned()
            }
        };

        if let Some(handle) = handle_opt {
            let (p_out, p_err, p_code) = match crate::ssh::session::run_exec_channel(&handle, &command).await {
                Ok((s_out, s_err, s_code)) => (s_out, s_err, s_code),
                Err(error) => (
                    format!("SSH command channel failed; command was not retried to avoid duplicate execution: {}", error),
                    String::new(),
                    -1,
                ),
            };

            let combined = format!("{}\n{}", p_out, p_err);
            let is_permission_denial = p_code != 0 && (
                combined.contains("Interactive authentication required")
                || combined.contains("Permission denied")
                || combined.contains("Access denied")
                || combined.contains("Operation not permitted")
                || combined.contains("must be root")
                || combined.contains("You need to be root")
                || combined.contains("a terminal is required")
            );

            if is_permission_denial {
                let can_elevate = crate::ssh::connection::get_cached_user_privilege_for_user(&conn_id, &crate::ssh::connection::resolve_connection(&state, &conn_id).map(|c| c.config.username).unwrap_or_default())
                    .map(|p| p.has_sudo || p.is_root)
                    .unwrap_or(false);

                if can_elevate {
                    log::info!("SSH Desktop: Persistent channel detected a permission denial; attempting configured privilege handling");
                    let (priv_out, priv_code) = run_cmd_priv(&state, &conn_id, &command).await;
                    if priv_code == 0 || !priv_out.is_empty() {
                        (priv_out, String::new(), priv_code)
                    } else {
                        (p_out, p_err, p_code)
                    }
                } else {
                    (p_out, p_err, p_code)
                }
            } else {
                (p_out, p_err, p_code)
            }
        } else {
            // Run direct command
            let (direct_out, direct_code) = run_cmd(&state, &conn_id, &command).await;

            // Smart auto-elevation: if direct execution failed with permission/polkit error
            let is_permission_denial = direct_code != 0 && (
                direct_out.contains("Interactive authentication required")
                || direct_out.contains("Permission denied")
                || direct_out.contains("Access denied")
                || direct_out.contains("Operation not permitted")
                || direct_out.contains("must be root")
                || direct_out.contains("You need to be root")
                || direct_out.contains("a terminal is required")
            );

            if is_permission_denial {
                let can_elevate = crate::ssh::connection::get_cached_user_privilege_for_user(&conn_id, &crate::ssh::connection::resolve_connection(&state, &conn_id).map(|c| c.config.username).unwrap_or_default())
                    .map(|p| p.has_sudo || p.is_root)
                    .unwrap_or(false);

                if can_elevate {
                    log::info!("SSH Desktop: Detected a permission denial; attempting configured privilege handling");
                    let (priv_out, priv_code) = run_cmd_priv(&state, &conn_id, &command).await;
                    if priv_code == 0 || !priv_out.is_empty() {
                        (priv_out, String::new(), priv_code)
                    } else {
                        (direct_out, String::new(), direct_code)
                    }
                } else {
                    (direct_out, String::new(), direct_code)
                }
            } else {
                (direct_out, String::new(), direct_code)
            }
        }
    };

    if exit_code == -1 && stdout.is_empty() && stderr.is_empty() {
        return Err("Remote command execution timed out or failed on server.".to_string());
    }

    Ok(CommandResult {
        stderr,
        stdout,
        exit_code,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn ssh_exec_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    conn_id: String,
    command: String,
    stream_id: String,
) -> Result<(), String> {
    if stream_id.trim().is_empty() || stream_id.len() > 128
        || stream_id.chars().any(|c| !c.is_ascii_alphanumeric() && !matches!(c, '-' | '_'))
    {
        return Err("Invalid execution stream ID.".into());
    }
    if conn_id.trim().is_empty() || command.trim().is_empty() || command.len() > 1024 * 1024 || command.contains('\0') {
        return Err("A connection ID and command (maximum 1 MiB) are required.".into());
    }
    // Reserve the ID under one lock from duplicate check through insertion.
    // The task waits on a oneshot until its abort handle has been registered.
    let mut streams = EXEC_STREAMS.lock();
    if streams.contains_key(&stream_id) {
        return Err("An execution stream with this ID is already running.".into());
    }

    let app_clone = app.clone();
    let stream_id_clone = stream_id.clone();
    let conn_id_clone = conn_id.clone();
    let command_clone = command.clone();
    let (start_tx, start_rx) = tokio::sync::oneshot::channel();

    let task = tokio::spawn(async move {
        let _ = start_rx.await;
        let _stream_guard = ExecStreamGuard(stream_id_clone.clone());
        // 0. Fast Path: Real-time streaming channel over persistent session
        let handle_opt = {
            let state_ref = app_clone.state::<AppState>();
            let sessions = state_ref.sessions.lock().await;
            if conn_id_clone == "default" || conn_id_clone.is_empty() {
                sessions.get("default").cloned()
            } else {
                sessions.get(&conn_id_clone).cloned()
            }
        };

        // Never strip sudo from a command: that would execute a different,
        // unprivileged operation and could incorrectly report success.
        if !command_clone.trim_start().starts_with("sudo ") {
            if let Some(handle) = handle_opt {
                match crate::ssh::session::run_stream_channel(
                    &app_clone, &handle, &stream_id_clone, &command_clone
                ).await {
                    Ok(_) => return,
                    Err(error) => {
                        let _ = app_clone.emit("exec-output", StreamChunk {
                            stream_id: stream_id_clone.clone(),
                            data: format!("\r\n[SSH stream failed; command was not retried to avoid duplicate execution: {}]\r\n", error),
                            is_stderr: true,
                            is_done: true,
                            exit_code: Some(-1),
                        });
                        return;
                    }
                }
            }
        }

        let has_conn = crate::ssh::connection::resolve_connection(
            &app_clone.state::<AppState>(),
            &conn_id_clone,
        ).is_some();

        let (out, code) = if !has_conn {
            (String::new(), -1)
        } else if command_clone.trim().starts_with("sudo ") {
            run_cmd_priv(
                &app_clone.state::<AppState>(),
                &conn_id_clone,
                &command_clone,
            ).await
        } else {
            let (direct_out, direct_code) = run_cmd(
                &app_clone.state::<AppState>(),
                &conn_id_clone,
                &command_clone,
            ).await;

            let is_permission_denial = direct_code != 0 && (
                direct_out.contains("Interactive authentication required")
                || direct_out.contains("Permission denied")
                || direct_out.contains("Access denied")
                || direct_out.contains("Operation not permitted")
            );

            if is_permission_denial {
                // Auto-elevation is allowed only when remote privilege detection
                // positively confirms root or sudo access. Unknown/stale privilege
                // state must never trigger an implicit sudo attempt.
                let can_elevate = crate::ssh::connection::resolve_connection(
                    &app_clone.state::<AppState>(),
                    &conn_id_clone,
                )
                .and_then(|conn| {
                    crate::ssh::connection::get_cached_user_privilege_for_user(
                        &conn_id_clone,
                        &conn.config.username,
                    )
                })
                .map(|priv_info| priv_info.has_sudo || priv_info.is_root)
                .unwrap_or(false);

                if can_elevate {
                    run_cmd_priv(
                        &app_clone.state::<AppState>(),
                        &conn_id_clone,
                        &command_clone,
                    ).await
                } else {
                    (direct_out, direct_code)
                }
            } else {
                (direct_out, direct_code)
            }
        };

        let (data, done_exit) = if code == -1 && out.is_empty() {
            if !has_conn {
                (
                    format!("$ {}\r\n[No connection — not connected to any server]\r\n", command_clone),
                    1,
                )
            } else {
                (
                    format!("$ {}\r\n[Command timed out or remote connection error]\r\n", command_clone),
                    1,
                )
            }
        } else {
            (if !out.is_empty() { out } else { format!("$ {}\r\n[Command completed with no output]\r\n", command_clone) }, code)
        };

        let chunk = StreamChunk {
            stream_id: stream_id_clone,
            data,
            is_stderr: false,
            is_done: true,
            exit_code: Some(done_exit),
        };
        let _ = app_clone.emit("exec-output", chunk);
    });

    streams.insert(stream_id.clone(), task.abort_handle());
    drop(streams);
    let _ = start_tx.send(());
    Ok(())
}

#[tauri::command]
pub async fn ssh_exec_stop(
    app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
    stream_id: String,
) -> Result<(), String> {
    if stream_id.trim().is_empty() {
        return Err("Execution stream ID cannot be empty.".into());
    }
    if let Some(handle) = EXEC_STREAMS.lock().remove(&stream_id) {
        handle.abort();
        let _ = app.emit("exec-output", StreamChunk {
            stream_id: stream_id.clone(),
            data: "[Execution cancelled]".into(),
            is_stderr: false,
            is_done: true,
            exit_code: Some(-1),
        });
        log::info!("SSH Desktop: Cancelled execution stream {}", stream_id);
        Ok(())
    } else {
        Err(format!("Execution stream '{}' is not running.", stream_id))
    }
}
