use serde::{Deserialize, Serialize};
use std::time::Instant;
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

/// Helper: run a command on the remote server via SSH (plink or openssh).
/// Returns (stdout, exit_code). exit_code = -1 means no connection / spawn error.
pub async fn run_cmd(state: &AppState, conn_id: &str, command: &str) -> (String, i32) {
    // 0. Primary Fast Path: Execute directly over active persistent in-memory SSH transport
    {
        let handle_opt = {
            let sessions = state.sessions.lock().await;
            if conn_id == "default" || conn_id.is_empty() {
                sessions.get("default").cloned().or_else(|| sessions.values().next().cloned())
            } else {
                sessions.get(conn_id).cloned()
            }
        };
        if let Some(handle) = handle_opt {
            match crate::ssh::session::run_exec_channel(&handle, command).await {
                Ok((stdout, code)) => {
                    return (stdout, code);
                }
                Err(e) => {
                    log::warn!("SSH Desktop: Persistent channel failed for cmd '{}': {}, falling back...", command, e);
                }
            }
        }
    }

    // Resolve connection (exact id, saved connection on disk, or fallback)
    let conn = match crate::ssh::connection::resolve_connection(state, conn_id) {
        Some(c) => c,
        None => return (String::new(), -1),
    };

    // Attempt lazy persistent session establishment for future instantaneous calls
    if state.sessions.lock().await.get(conn_id).is_none() {
        let conn_clone = conn.clone();
        let state_sessions = state.sessions.clone();
        let cid = conn_id.to_string();
        tokio::spawn(async move {
            if let Ok(handle) = crate::ssh::session::connect_session(
                &conn_clone.config.host,
                conn_clone.config.port,
                &conn_clone.config.username,
                conn_clone.config.password.as_deref(),
                conn_clone.config.private_key_path.as_deref(),
            ).await {
                let mut map = state_sessions.lock().await;
                let arc = std::sync::Arc::new(handle);
                map.insert(cid, arc.clone());
                map.insert("default".to_string(), arc);
                log::info!("SSH Desktop: Lazily established persistent SSH transport for {}", conn_clone.config.host);
            }
        });
    }


    let host = conn.config.host.clone();
    let port = conn.config.port.to_string();
    let user = conn.config.username.clone();
    let destination = format!("{}@{}", user, host);

    let auth_method = conn.config.auth_method.as_deref().unwrap_or("password");
    let is_key_auth = auth_method == "key" || conn.config.private_key_path.is_some();

    // ── 1. Password auth via plink (only if not key auth) ───────────────────
    if !is_key_auth {
        if let Some(pwd) = &conn.config.password {
            if !pwd.is_empty() {
                for attempt in 0..2 {
                let mut cmd = tokio::process::Command::new("plink");
                #[cfg(windows)]
                cmd.creation_flags(0x08000000);

                cmd.arg("-ssh")
                    .arg("-batch")          // never prompt for host key
                    .arg("-P").arg(&port)
                    .arg("-l").arg(&user)
                    .arg("-pw").arg(pwd)
                    .arg(&host)
                    .arg(command)
                    .stdin(std::process::Stdio::null())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());

                if let Ok(child) = cmd.spawn() {
                    match tokio::time::timeout(
                        std::time::Duration::from_secs(35),
                        child.wait_with_output(),
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

                            // Retry once if transient handshake dropped due to concurrency / rate-limit
                            if !output.status.success() && stdout.is_empty() && attempt == 0 {
                                if raw_stderr.contains("Server refused our key")
                                    || raw_stderr.contains("Connection reset")
                                    || raw_stderr.contains("fatal")
                                    || exit_code == -1
                                {
                                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                                    continue;
                                }
                            }

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
                            if attempt == 0 {
                                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                                continue;
                            }
                        }
                        Err(_) => {
                            log::warn!("SSH Desktop: plink timed out for {} on command: {}", host, command);
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
    let is_ppk = conn.config.private_key_path.as_deref().map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    if is_ppk {
        let plink_bin = crate::ssh::connection::get_plink_path();
        for attempt in 0..2 {
            let mut cmd = tokio::process::Command::new(plink_bin);
            #[cfg(windows)]
            cmd.creation_flags(0x08000000);

            cmd.arg("-ssh")
                .arg("-batch")
                .arg("-P").arg(&port)
                .arg("-l").arg(&user);

            if let Some(key_path) = &conn.config.private_key_path {
                if crate::ssh::connection::resolve_key_path(key_path).is_some() {
                    cmd.arg("-i").arg(key_path);
                }
            }

            cmd.arg(&host)
                .arg(command)
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            if let Ok(child) = cmd.spawn() {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(35),
                    child.wait_with_output(),
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
                        if attempt == 0 {
                            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                            continue;
                        }
                    }
                    Err(_) => {
                        log::warn!("SSH Desktop: plink ppk timed out for {} on command: {}", host, command);
                        return (String::new(), -1);
                    }
                }
            }
        }
    }

    // ── 3. PEM / OpenSSH key auth via OpenSSH ──────────────────────────────
    let mut ssh_cmd = tokio::process::Command::new("ssh");
    #[cfg(windows)]
    ssh_cmd.creation_flags(0x08000000);

    ssh_cmd
        .arg("-p").arg(&port)
        .arg("-o").arg("StrictHostKeyChecking=no")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("IdentitiesOnly=yes")
        .arg("-o").arg("ConnectTimeout=8")
        .arg("-o").arg("ServerAliveInterval=10")
        .arg("-o").arg("ServerAliveCountMax=2");

    if let Some(key_path) = &conn.config.private_key_path {
        if crate::ssh::connection::resolve_key_path(key_path).is_some() {
            ssh_cmd.arg("-i").arg(key_path);
        }
    }

    ssh_cmd
        .arg(&destination)
        .arg(command)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    match tokio::time::timeout(
        std::time::Duration::from_secs(30),
        ssh_cmd.output(),
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
            log::warn!("SSH Desktop: ssh spawn error for {}: {}", host, e);
        }
        Err(_) => {
            log::warn!("SSH Desktop: ssh timed out for {} on command: {}", host, command);
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
    let normalized_cmd = raw_cmd
        .replace("| sudo ", "| ")
        .replace("; sudo ", "; ")
        .replace("&& sudo ", "&& ")
        .replace("|| sudo ", "|| ");

    let conn = match conn_opt {
        Some(c) => c,
        None => return run_cmd(state, conn_id, &normalized_cmd).await,
    };

    let username = &conn.config.username;

    // ── 0th Condition: Fast check if user is already known to lack sudo ────
    if let Some(priv_info) = crate::ssh::connection::get_cached_user_privilege(conn_id) {
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
        if let Some(mut p) = crate::ssh::connection::get_cached_user_privilege(conn_id) {
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

    // 3B. User requires a password for sudo (sudo -S)
    if let Some(ref pwd) = conn.config.password {
        if !pwd.is_empty() {
            let escaped_pwd = pwd.replace('\'', r"'\''");
            // Use printf to pipe the password securely to sudo -S
            let sudo_s_cmd = format!(
                "printf '%s\\n' '{}' | sudo -S -p '' -- sh -c '{}' 2>&1",
                escaped_pwd,
                escaped_raw
            );
            let (s_out, s_code) = run_cmd(state, conn_id, &sudo_s_cmd).await;

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
    // 0. Primary Fast Path: Execute directly over active persistent in-memory SSH transport
    {
        let handle_opt = {
            let sessions = state.sessions.lock().await;
            if conn_id == "default" || conn_id.is_empty() {
                sessions.get("default").cloned().or_else(|| sessions.values().next().cloned())
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
                    log::warn!("SSH Desktop: Persistent channel with stdin failed for cmd '{}': {}, falling back...", command, e);
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

    let auth_method = conn.config.auth_method.as_deref().unwrap_or("password");
    let is_key_auth = auth_method == "key" || conn.config.private_key_path.is_some();

    // 1. Password auth via plink (only if not key auth)
    if !is_key_auth {
        if let Some(pwd) = &conn.config.password {
            if !pwd.is_empty() {
            let mut cmd = tokio::process::Command::new("plink");
            #[cfg(windows)]
            cmd.creation_flags(0x08000000);
            cmd.arg("-ssh")
                .arg("-batch")
                .arg("-P").arg(&port)
                .arg("-l").arg(&user)
                .arg("-pw").arg(pwd)
                .arg(&host)
                .arg(command)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            if let Ok(mut child) = cmd.spawn() {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = tokio::io::AsyncWriteExt::write_all(&mut stdin, stdin_data).await;
                }
                if let Ok(Ok(output)) = tokio::time::timeout(std::time::Duration::from_secs(60), child.wait_with_output()).await {
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
}

    // 2. PPK Key auth via plink
    let is_ppk = conn.config.private_key_path.as_deref().map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    if is_ppk {
        let plink_bin = crate::ssh::connection::get_plink_path();
        let mut cmd = tokio::process::Command::new(plink_bin);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        cmd.arg("-ssh")
            .arg("-batch")
            .arg("-P").arg(&port)
            .arg("-l").arg(&user);
        if let Some(key_path) = &conn.config.private_key_path {
            if crate::ssh::connection::resolve_key_path(key_path).is_some() {
                cmd.arg("-i").arg(key_path);
            }
        }
        cmd.arg(&host)
            .arg(command)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        if let Ok(mut child) = cmd.spawn() {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = tokio::io::AsyncWriteExt::write_all(&mut stdin, stdin_data).await;
            }
            if let Ok(Ok(output)) = tokio::time::timeout(std::time::Duration::from_secs(60), child.wait_with_output()).await {
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

    // 3. PEM Key auth via OpenSSH
    let mut ssh_cmd = tokio::process::Command::new("ssh");
    #[cfg(windows)]
    ssh_cmd.creation_flags(0x08000000);
    ssh_cmd
        .arg("-p").arg(&port)
        .arg("-o").arg("StrictHostKeyChecking=no")
        .arg("-o").arg("BatchMode=yes")
        .arg("-o").arg("IdentitiesOnly=yes")
        .arg("-o").arg("ConnectTimeout=10");

    if let Some(key_path) = &conn.config.private_key_path {
        if crate::ssh::connection::resolve_key_path(key_path).is_some() {
            ssh_cmd.arg("-i").arg(key_path);
        }
    }

    ssh_cmd
        .arg(&destination)
        .arg(command)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Ok(mut child) = ssh_cmd.spawn() {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = tokio::io::AsyncWriteExt::write_all(&mut stdin, stdin_data).await;
        }
        if let Ok(Ok(output)) = tokio::time::timeout(std::time::Duration::from_secs(60), child.wait_with_output()).await {
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let exit_code = output.status.code().unwrap_or(-1);
            if !stdout.is_empty() || output.status.success() {
                return (stdout, exit_code);
            }
            return (stderr, exit_code);
        }
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
    let conn_opt = crate::ssh::connection::resolve_connection(state, conn_id);
    let trimmed_cmd = command.trim();
    let raw_cmd = trimmed_cmd.strip_prefix("sudo ").unwrap_or(trimmed_cmd).trim();

    let conn = match conn_opt {
        Some(c) => c,
        None => return run_cmd_with_stdin(state, conn_id, raw_cmd, stdin_data).await,
    };

    let username = &conn.config.username;

    // Fast check if user is known to lack sudo
    if let Some(priv_info) = crate::ssh::connection::get_cached_user_privilege(conn_id) {
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

    if let Some(ref pwd) = conn.config.password {
        if !pwd.is_empty() {
            let sudo_s_cmd = format!(
                "printf '%s\\n' '{}' | sudo -S -p '' -- sh -c '{}' 2>&1",
                pwd.replace('\'', r"'\''"),
                raw_cmd.replace('\'', r"'\''")
            );
            let (s_out, s_code) = run_cmd_with_stdin(state, conn_id, &sudo_s_cmd, stdin_data).await;
            if s_code == 0 {
                return (s_out, s_code);
            }
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
    
    // First, verify that a connection exists or can be resolved
    if crate::ssh::connection::resolve_connection(&state, &conn_id).is_none() {
        return Err(format!(
            "No active SSH connection for id '{}'. Please connect to a server first.",
            conn_id
        ));
    }

    // If command explicitly starts with sudo or contains sudo in pipeline, execute via run_cmd_priv
    let needs_priv = trimmed.starts_with("sudo ") || trimmed.contains(" sudo ") || trimmed.contains("| sudo ");
    let (stdout, exit_code) = if needs_priv {
        run_cmd_priv(&state, &conn_id, trimmed).await
    } else {
        // Run direct command first
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
            let can_elevate = crate::ssh::connection::get_cached_user_privilege(&conn_id)
                .map(|p| p.has_sudo || p.is_root)
                .unwrap_or(true);

            if can_elevate {
                log::info!("SSH Desktop: Detected permission denial for '{}', attempting auto-elevation", command);
                let (priv_out, priv_code) = run_cmd_priv(&state, &conn_id, &command).await;
                if priv_code == 0 || !priv_out.is_empty() {
                    (priv_out, priv_code)
                } else {
                    (direct_out, direct_code)
                }
            } else {
                (direct_out, direct_code)
            }
        } else {
            (direct_out, direct_code)
        }
    };

    if exit_code == -1 && stdout.is_empty() {
        return Err("Remote command execution timed out or failed on server.".to_string());
    }

    Ok(CommandResult {
        stderr: String::new(),
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
    let app_clone = app.clone();
    let stream_id_clone = stream_id.clone();
    let conn_id_clone = conn_id.clone();
    let command_clone = command.clone();

    tokio::spawn(async move {
        // 0. Fast Path: Real-time streaming channel over persistent session
        let handle_opt = {
            let state_ref = app_clone.state::<AppState>();
            let sessions = state_ref.sessions.lock().await;
            if conn_id_clone == "default" || conn_id_clone.is_empty() {
                sessions.get("default").cloned().or_else(|| sessions.values().next().cloned())
            } else {
                sessions.get(&conn_id_clone).cloned()
            }
        };

        if let Some(handle) = handle_opt {
            let cmd_to_run = if command_clone.trim().starts_with("sudo ") {
                let trimmed = command_clone.trim();
                trimmed.strip_prefix("sudo ").unwrap_or(trimmed).trim().to_string()
            } else {
                command_clone.clone()
            };
            if let Ok(_) = crate::ssh::session::run_stream_channel(&app_clone, &handle, &stream_id_clone, &cmd_to_run).await {
                return;
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
                run_cmd_priv(
                    &app_clone.state::<AppState>(),
                    &conn_id_clone,
                    &command_clone,
                ).await
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
            exit_code: Some(if done_exit != -1 { done_exit } else { 0 }),
        };
        let _ = app_clone.emit("exec-output", chunk);
    });

    Ok(())
}

#[tauri::command]
pub async fn ssh_exec_stop(_state: tauri::State<'_, AppState>, _stream_id: String) -> Result<(), String> {
    log::info!("SSH Desktop: Stopped stream {}", _stream_id);
    Ok(())
}
