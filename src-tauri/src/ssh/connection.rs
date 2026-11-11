pub fn validate_ssh_target(host: &str, port: u16, username: &str) -> Result<(), String> {
    let raw_host = host;
    let raw_username = username;
    let host = host.trim();
    let username = username.trim();
    if host.is_empty() || username.is_empty()
        || host != raw_host || username != raw_username
        || host.len() > 253
        || !host.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_' | b':' | b'[' | b']'))
    {
        return Err("Invalid SSH hostname or IP address.".into());
    }
    let ip_candidate = host.strip_prefix('[').and_then(|v| v.strip_suffix(']')).unwrap_or(host);
    if ip_candidate.parse::<std::net::IpAddr>().is_err() {
        let labels: Vec<&str> = host.split('.').collect();
        if labels.iter().any(|label| label.is_empty() || label.len() > 63
            || label.starts_with('-') || label.ends_with('-')
            || !label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
        {
            return Err("Invalid SSH hostname.".into());
        }
    }
    if username.is_empty() || username.len() > 128
        || !username.as_bytes()[0].is_ascii_alphanumeric()
        || !username.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
    {
        return Err("Invalid SSH username.".into());
    }
    if port == 0 {
        return Err("SSH port must be between 1 and 65535.".into());
    }
    Ok(())
}

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionConfig {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    #[serde(default)]
    pub auth_method: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
    pub connected_at: i64,
}

#[derive(Clone)]
pub struct SshConnection {
    pub id: String,
    pub config: ConnectionConfig,
    pub connected: bool,
    pub connected_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserPrivilegeInfo {
    pub username: String,
    pub uid: u32,
    pub gid: u32,
    pub home_dir: String,
    pub is_root: bool,
    pub has_sudo: bool,
    pub sudo_type: String, // "root" | "passwordless" | "password" | "none"
    pub groups: Vec<String>,
}

lazy_static::lazy_static! {
    static ref USER_PRIVILEGE_CACHE: parking_lot::Mutex<std::collections::HashMap<String, UserPrivilegeInfo>> = parking_lot::Mutex::new(std::collections::HashMap::new());
}

pub fn get_cached_user_privilege(conn_id: &str) -> Option<UserPrivilegeInfo> {
    let map = USER_PRIVILEGE_CACHE.lock();
    map.get(conn_id).cloned()
}

pub fn get_cached_user_privilege_for_user(conn_id: &str, expected_user: &str) -> Option<UserPrivilegeInfo> {
    let map = USER_PRIVILEGE_CACHE.lock();
    if let Some(cached) = map.get(conn_id) {
        if cached.username == expected_user {
            return Some(cached.clone());
        }
    }
    None
}

pub fn set_cached_user_privilege(conn_id: &str, info: UserPrivilegeInfo) {
    let mut map = USER_PRIVILEGE_CACHE.lock();
    map.insert(conn_id.to_string(), info.clone());
    if conn_id == "default" {
        map.insert("default".to_string(), info);
    }
}

pub fn invalidate_user_privilege_cache(conn_id: &str) {
    let mut map = USER_PRIVILEGE_CACHE.lock();
    map.remove(conn_id);
    map.remove("default");
}

/// A short-lived password file for PuTTY command-line tools. The password is
/// never placed in process arguments; the file is owner-only on Unix and lives
/// in the current user's protected temporary directory on Windows.
pub struct SshPasswordFile {
    path: std::path::PathBuf,
}

impl SshPasswordFile {
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for SshPasswordFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

pub fn create_password_file(password: &str) -> Result<SshPasswordFile, String> {
    if password.bytes().any(|byte| byte == 10 || byte == 13) {
        return Err("SSH passwords containing newline characters cannot be passed safely to PuTTY".into());
    }
    let path = std::env::temp_dir().join(format!("sshdesktop-pw-{}.tmp", Uuid::new_v4()));
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt;
        std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600)
            .open(&path).map_err(|e| format!("Could not create protected SSH password file: {}", e))?
    };
    #[cfg(not(unix))]
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true)
        .open(&path).map_err(|e| format!("Could not create protected SSH password file: {}", e))?;
    #[cfg(windows)]
    if let Err(error) = secure_private_key_permissions(&path) {
        drop(file);
        let _ = std::fs::remove_file(&path);
        return Err(format!("Could not secure SSH password file permissions: {}", error));
    }
    use std::io::Write;
    if let Err(error) = writeln!(file, "{}", password).and_then(|_| file.sync_all()) {
        let _ = std::fs::remove_file(&path);
        return Err(format!("Could not write protected SSH password file: {}", error));
    }
    Ok(SshPasswordFile { path })
}

pub fn get_plink_path() -> &'static str {
    if std::path::Path::new(r"C:\Program Files\PuTTY\plink.exe").exists() {
        r"C:\Program Files\PuTTY\plink.exe"
    } else if std::path::Path::new(r"C:\Program Files (x86)\PuTTY\plink.exe").exists() {
        r"C:\Program Files (x86)\PuTTY\plink.exe"
    } else {
        "plink"
    }
}

pub fn cleanup_putty_host_key(host: &str, port: &str) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let keys = [
            format!("ssh-ed25519@{}:{}", port, host),
            format!("ssh-rsa@{}:{}", port, host),
            format!("ecdsa-sha2-nistp256@{}:{}", port, host),
            format!("rsa2@{}:{}", port, host),
        ];
        for k in &keys {
            let _ = std::process::Command::new("reg")
                .args(["delete", r"HKCU\Software\SimonTatham\PuTTY\SshHostKeys", "/v", k, "/f"])
                .creation_flags(0x08000000)
                .output();
        }
    }
}


pub fn is_ppk_key(path_or_content: &str) -> bool {
    let trimmed = path_or_content.trim();
    if trimmed.to_lowercase().ends_with(".ppk") {
        return true;
    }
    if trimmed.contains("PuTTY-User-Key-File") {
        return true;
    }
    if let Ok(content) = std::fs::read_to_string(trimmed) {
        if content.contains("PuTTY-User-Key-File") {
            return true;
        }
    }
    false
}

#[cfg(windows)]
pub fn secure_windows_private_key(path: &std::path::Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let username = std::env::var("USERNAME")
        .map_err(|_| "Could not determine the current Windows account; refusing to use an unsecured private key.".to_string())?;
    if username.trim().is_empty() {
        return Err("The current Windows account name is empty; refusing to use an unsecured private key.".into());
    }
    let path_str = path.to_string_lossy();
    // Strip pre-existing inherited and explicit ACEs before applying owner-only DACL
    let _ = std::process::Command::new("icacls.exe")
        .arg(&*path_str)
        .arg("/reset")
        .creation_flags(0x08000000)
        .output();

    let output = std::process::Command::new("icacls.exe")
        .arg(&*path_str)
        .arg("/inheritance:r")
        .arg("/grant:r")
        .arg(format!("{}:(F)", username))
        .arg("/remove:g")
        .arg("Users")
        .arg("/remove:g")
        .arg("Authenticated Users")
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .map_err(|e| format!("Failed to invoke icacls: {}", e))?;
    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("icacls failed: {}", err_msg.trim()));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn secure_windows_private_key(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

pub fn secure_private_key_permissions(path: &std::path::Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to secure private key permissions (0600): {}", e))?;
    }
    #[cfg(windows)]
    {
        secure_windows_private_key(path)?;
    }
    Ok(())
}

pub fn write_secure_private_key(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let parent = path.parent().ok_or_else(|| "Private key path has no parent directory.".to_string())?;
        let temp = parent.join(format!(".sshdesktop-key-{}.tmp", Uuid::new_v4().simple()));
        let result = (|| -> Result<(), String> {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .open(&temp)
                .map_err(|e| format!("Failed to create protected temporary private key: {}", e))?;
            file.write_all(data).map_err(|e| format!("Failed to write private key data: {}", e))?;
            file.sync_all().map_err(|e| format!("Failed to flush private key data: {}", e))?;
            std::fs::rename(&temp, path)
                .map_err(|e| format!("Failed to atomically replace private key: {}", e))?;
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result
    }
    #[cfg(windows)]
    {
        use std::io::Write;
        use std::os::windows::ffi::OsStrExt;
        let parent = path.parent().ok_or_else(|| "Private key path has no parent directory.".to_string())?;
        let temp = parent.join(format!(".sshdesktop-key-{}.tmp", Uuid::new_v4().simple()));
        let result = (|| -> Result<(), String> {
            let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp)
                .map_err(|e| format!("Failed to create temporary private key: {}", e))?;
            secure_private_key_permissions(&temp)?;
            file.write_all(data).map_err(|e| format!("Failed to write private key: {}", e))?;
            file.sync_all().map_err(|e| format!("Failed to flush private key: {}", e))?;
            #[link(name = "Kernel32")]
            extern "system" {
                fn MoveFileExW(existing_name: *const u16, new_name: *const u16, flags: u32) -> i32;
            }
            const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
            const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
            let source: Vec<u16> = temp.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
            let destination: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
            let replaced = unsafe {
                MoveFileExW(source.as_ptr(), destination.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)
            };
            if replaced == 0 {
                return Err(format!("Failed to atomically replace private key: {}", std::io::Error::last_os_error()));
            }
            Ok(())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        result
    }
    #[cfg(not(any(unix, windows)))]
    {
        std::fs::write(path, data).map_err(|e| format!("Failed to write private key: {}", e))?;
        Ok(())
    }
}

pub fn resolve_key_path(key_input: &str) -> Option<String> {
    let trimmed = key_input.trim();
    if trimmed.is_empty() {
        return None;
    }

    let path = std::path::Path::new(trimmed);
    if path.exists() && path.is_file() {
        if secure_private_key_permissions(path).is_err() {
            log::error!("SSH Desktop: Refusing to use private key because permissions could not be secured: {}", path.display());
            return None;
        }
        return Some(trimmed.to_string());
    }

    // Check if path references legacy ~/.clouddesk or ~/.sshdesktop
    let migrated = trimmed.replace(".clouddesk", ".sshdesktop");
    let p_migrated = std::path::Path::new(&migrated);
    if p_migrated.exists() && p_migrated.is_file() {
        if secure_private_key_permissions(p_migrated).is_err() {
            log::error!("SSH Desktop: Refusing to use migrated private key because permissions could not be secured: {}", p_migrated.display());
            return None;
        }
        return Some(migrated);
    }

    None
}

pub fn ensure_key_file(conn_id: &str, key_input: &str) -> Option<String> {
    let trimmed = key_input.trim();
    if trimmed.is_empty() {
        return None;
    }

    // 1. If it's already an existing file on disk, return its path
    let p = std::path::Path::new(trimmed);
    if p.exists() && p.is_file() {
        if secure_private_key_permissions(p).is_err() {
            log::error!("SSH Desktop: Refusing to use private key because permissions could not be secured: {}", p.display());
            return None;
        }
        return Some(trimmed.to_string());
    }

    // 2. If it is raw key content (PEM or PPK)
    if trimmed.contains("PRIVATE KEY") || trimmed.contains("PuTTY-User-Key-File") || trimmed.lines().count() > 1 {
        if let Some(base) = directories::BaseDirs::new() {
            let keys_dir = base.home_dir().join(".sshdesktop").join("keys");
            if std::fs::create_dir_all(&keys_dir).is_err() {
                return None;
            }

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if std::fs::set_permissions(&keys_dir, std::fs::Permissions::from_mode(0o700)).is_err() {
                    return None;
                }
            }

            let is_ppk = is_ppk_key(trimmed);
            let ext = if is_ppk { "ppk" } else { "pem" };
            let safe_id = conn_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>();
            if safe_id.is_empty() {
                log::error!("SSH Desktop: Refusing to persist private key without a valid connection ID.");
                return None;
            }
            let target_file = keys_dir.join(format!("{}.{}", safe_id, ext));

            if write_secure_private_key(&target_file, trimmed.as_bytes()).is_ok() {
                return target_file.to_str().map(|s| s.to_string());
            }
        }
    }

    None
}

#[tauri::command]
pub async fn ssh_connect(state: tauri::State<'_, AppState>, mut config: ConnectionConfig) -> Result<String, String> {
    validate_ssh_target(&config.host, config.port, &config.username)?;

    let id = config.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    config.id = Some(id.clone());
    invalidate_user_privilege_cache(&id);
    log::info!("SSH Desktop: Establishing SSH connection [{}] for {} ({}:{})", id, config.name, config.host, config.port);

    // Ensure the key file is available on disk for CLI utilities (scp, ssh, plink)
    if let Some(raw_key) = &config.private_key_path {
        if let Some(key_path) = ensure_key_file(&id, raw_key) {
            config.private_key_path = Some(key_path);
        }
    }

    let host = &config.host;
    let port = config.port.to_string();
    let user = &config.username;
    let mut verified = false;
    let mut last_error = String::new();

    let is_key_auth = match config.auth_method.as_deref() {
        Some("password") => false,
        Some("key") => true,
        _ => config.private_key_path.is_some() || config.password.is_none(),
    };
    let selected_key_path = if is_key_auth { config.private_key_path.as_deref() } else { None };
    if config.auth_method.as_deref() == Some("key")
        && selected_key_path.map(|path| path.trim().is_empty()).unwrap_or(true)
    {
        return Err("Key authentication was selected, but no private key was provided.".into());
    }
    if let Some(key_path) = selected_key_path {
        if resolve_key_path(key_path).is_none() {
            return Err(format!("Selected SSH identity '{}' could not be found.", key_path));
        }
    }
    let is_ppk = selected_key_path.map(is_ppk_key).unwrap_or(false);

    // 0. Primary Fast Path: Try establishing persistent in-memory SSH transport
    if !is_ppk {
        if let Ok(handle) = crate::ssh::session::connect_session_with_passphrase_auth(
            host,
            config.port,
            user,
            if is_key_auth { None } else { config.password.as_deref() },
            selected_key_path,
            config.passphrase.as_deref(),
            config.auth_method.as_deref() != Some("password"),
        ).await {
            verified = true;
            let mut sessions = state.sessions.lock().await;
            let arc_handle = std::sync::Arc::new(handle);
            sessions.insert(id.clone(), arc_handle.clone());
            sessions.insert("default".to_string(), arc_handle);
            log::info!("SSH Desktop: Native persistent SSH session established for {}", host);
        }
    }

    // 1. If Key authentication is requested (PPK or PEM)
    if !verified && is_key_auth {
        if is_ppk {
            if let Some(key_path) = &config.private_key_path {
                let plink_bin = get_plink_path();
                let mut cmd = tokio::process::Command::new(plink_bin);
    cmd.kill_on_drop(true);
                #[cfg(windows)]
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

                cmd.arg("-batch").arg("-ssh")
                    .arg("-P")
                    .arg(&port)
                    .arg("-l")
                    .arg(user)
                    .arg("-i")
                    .arg(key_path)
                    .arg(host)
                    .arg("echo sshdesktop-connected")
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());

                match cmd.spawn() {
                    Ok(child) => {
                        match tokio::time::timeout(std::time::Duration::from_secs(12), child.wait_with_output()).await {
                            Ok(Ok(out)) => {
                                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                                if out.status.success() || stdout.contains("sshdesktop-connected") || stdout.contains("clouddesk-connected") {
                                    verified = true;
                                    log::info!("SSH Desktop: Plink connection test with PuTTY PPK successful for {}", host);
                                } else {
                                    let err_raw = if !stderr.is_empty() { stderr } else { stdout };
                                    last_error = err_raw
                                        .lines()
                                        .filter(|l| !l.contains("Store key in cache") && !l.contains("The server's") && !l.contains("fingerprint"))
                                        .collect::<Vec<_>>()
                                        .join(" ")
                                        .trim()
                                        .to_string();
                                    if last_error.is_empty() {
                                        last_error = "PuTTY PPK authentication failed (access denied)".to_string();
                                    }
                                    log::warn!("SSH Desktop: Plink PPK test failed for {}: {}", host, last_error);
                                }
                            }
                            Ok(Err(e)) => {
                                last_error = format!("Plink PPK error: {}", e);
                            }
                            Err(_) => {
                                last_error = format!("Connection timed out connecting to {}:{} with PuTTY PPK key", host, port);
                            }
                        }
                    }
                    Err(e) => {
                        last_error = format!("Could not launch plink for PPK key auth: {}", e);
                    }
                }
            }
        } else {
            // OpenSSH auth (for PEM keys)
            let mut ssh_test = tokio::process::Command::new("ssh");
    ssh_test.kill_on_drop(true);
            #[cfg(windows)]
            ssh_test.creation_flags(0x08000000); // CREATE_NO_WINDOW

            ssh_test
                .arg("-p")
                .arg(&port)
                .arg("-o")
                .arg("StrictHostKeyChecking=yes")
                .arg("-o")
                .arg("BatchMode=yes")
                .arg("-o")
                .arg("IdentitiesOnly=yes")
                .arg("-o")
                .arg("ConnectTimeout=6");

            if let Some(key) = &config.private_key_path {
                if resolve_key_path(key).is_some() {
                    ssh_test.arg("-i").arg(key);
                }
            }

            ssh_test.arg(format!("{}@{}", user, host)).arg("echo sshdesktop-connected");

            match tokio::time::timeout(std::time::Duration::from_secs(8), ssh_test.output()).await {
                Ok(Ok(out)) => {
                    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                    if out.status.success() || stdout.contains("sshdesktop-connected") || stdout.contains("clouddesk-connected") {
                        verified = true;
                        log::info!("SSH Desktop: OpenSSH connection test successful for {}", host);
                    } else {
                        last_error = if !stderr.is_empty() {
                            stderr.trim().to_string()
                        } else {
                            "OpenSSH authentication failed (Permission denied)".to_string()
                        };
                    }
                }
                Ok(Err(e)) => {
                    last_error = format!("OpenSSH execution error: {}", e);
                }
                Err(_) => {
                    last_error = format!("Connection timed out after 8s connecting to {}:{}", host, port);
                }
            }
        }
    }

    // 2. Password auth via plink (only if not key auth)
    if !verified && !is_key_auth {
        if let Some(pwd) = &config.password {
            if !pwd.is_empty() {
                let password_file = create_password_file(pwd)?;
                let plink_bin = get_plink_path();
                let mut cmd = tokio::process::Command::new(plink_bin);
    cmd.kill_on_drop(true);
                #[cfg(windows)]
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

                cmd.arg("-batch")
                    .arg("-ssh")
                    .arg("-P")
                    .arg(&port)
                    .arg("-l")
                    .arg(user)
                    .arg("-pwfile")
                    .arg(password_file.path())
                    .arg(host)
                    .arg("echo sshdesktop-connected")
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());

                match cmd.spawn() {
                    Ok(child) => {
                        match tokio::time::timeout(std::time::Duration::from_secs(10), child.wait_with_output()).await {
                            Ok(Ok(out)) => {
                                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                                if out.status.success() || stdout.contains("sshdesktop-connected") || stdout.contains("clouddesk-connected") {
                                    verified = true;
                                    log::info!("SSH Desktop: Plink connection test successful for {}", host);
                                } else {
                                    let err_raw = if !stderr.is_empty() { stderr } else { stdout };
                                    last_error = err_raw
                                    .lines()
                                    .filter(|l| !l.contains("Store key in cache") && !l.contains("The server's") && !l.contains("fingerprint"))
                                    .collect::<Vec<_>>()
                                    .join(" ")
                                    .trim()
                                    .to_string();
                                    if last_error.is_empty() {
                                        last_error = "SSH Authentication failed (access denied or wrong password)".to_string();
                                    }
                                    log::warn!("SSH Desktop: Plink test failed for {}: {}", host, last_error);
                                }
                            }
                            Ok(Err(e)) => {
                                last_error = format!("Plink execution error: {}", e);
                            }
                            Err(_) => {
                                last_error = format!("Connection timed out after 10s connecting to {}:{}", host, port);
                            }
                        }
                    }
                    Err(e) => {
                        last_error = format!("Could not launch plink: {}", e);
                    }
                }
            }
        }
    }

    if !verified {
        let clean_error = if last_error.is_empty() {
            format!("Failed to connect to {}:{}. Please check host IP, port, and credentials.", host, port)
        } else {
            last_error
        };
        log::error!("SSH Desktop: Connection failed for {}: {}", host, clean_error);
        return Err(clean_error);
    }

    let conn = SshConnection {
        id: id.clone(),
        config: config.clone(),
        connected: true,
        connected_at: chrono::Utc::now().timestamp(),
    };

    {
        let mut map = state.connections.lock();
        map.insert(id.clone(), conn.clone());
        map.insert("default".to_string(), conn);
    }

    // Automatically persist to disk so all apps and future restarts can self-heal
    let saved = crate::store::connections::SavedConnection {
        id: id.clone(),
        created_at: chrono::Utc::now().timestamp(),
        last_connected_at: Some(chrono::Utc::now().timestamp()),
        notes: None,
        name: config.name.clone(),
        host: config.host.clone(),
        port: config.port,
        username: config.username.clone(),
        password: config.password.clone(),
        private_key_path: config.private_key_path.clone(),
        auth_method: config.auth_method.clone(),
        color: config.color.clone(),
        group: config.group.clone(),
        tags: config.tags.clone(),
    };
    let _ = crate::store::connections::save_or_update_connection_on_disk(saved);

    log::info!("SSH Desktop: SSH Session established with ID: {} (verified: true)", id);
    Ok(id)
}

impl From<crate::store::connections::SavedConnection> for ConnectionConfig {
    fn from(s: crate::store::connections::SavedConnection) -> Self {
        ConnectionConfig {
            id: Some(s.id),
            name: s.name,
            host: s.host,
            port: s.port,
            username: s.username,
            password: s.password,
            private_key_path: s.private_key_path,
            passphrase: None,
            auth_method: s.auth_method,
            color: s.color,
            group: s.group,
            tags: s.tags,
        }
    }
}

/// Helper: resolve a connection by ID.
/// Searches in-memory connections, auto-restores from disk if needed,
/// or falls back to the default or first available active server.
pub fn resolve_connection(state: &AppState, conn_id: &str) -> Option<SshConnection> {
    // Reject invalid saved/imported SSH targets before any remote operation.
    // 1. In-memory check
    {
        let lock = state.connections.lock();
        if let Some(c) = lock.get(conn_id).cloned() {
            if validate_ssh_target(&c.config.host, c.config.port, &c.config.username).is_err() {
                return None;
            }
            return Some(c);
        }
        if conn_id.is_empty() {
            if let Some(c) = lock.get("default").cloned() {
                if validate_ssh_target(&c.config.host, c.config.port, &c.config.username).is_err() {
                    return None;
                }
                return Some(c);
            }
        }
    }

    // 2. Try disk persistence auto-restore
    if let Some(saved) = crate::store::connections::get_saved_connection_by_id(conn_id) {
        let restored = SshConnection {
            id: saved.id.clone(),
            config: saved.into(),
            // Restoring saved configuration is not proof of a live SSH transport.
            connected: false,
            connected_at: 0,
        };
        if validate_ssh_target(&restored.config.host, restored.config.port, &restored.config.username).is_err() {
            return None;
        }
        let mut lock = state.connections.lock();
        lock.insert(restored.id.clone(), restored.clone());
        if conn_id == "default" || lock.get("default").is_none() {
            lock.insert("default".to_string(), restored.clone());
        }
        log::info!("SSH Desktop: Auto-restored SSH connection '{}' from disk storage into memory", conn_id);
        return Some(restored);
    }

    // 3. Fallback ONLY if conn_id is explicitly "default" or empty
    if conn_id == "default" {
        let lock = state.connections.lock();
        lock.get("default").cloned()
    } else {
        None
    }
}

#[tauri::command]
pub async fn ssh_disconnect(state: tauri::State<'_, AppState>, conn_id: String) -> Result<(), String> {
    let handle_to_disconnect = {
        let mut sessions = state.sessions.lock().await;
        let removed = sessions.remove(&conn_id);
        if conn_id == "default" {
            sessions.remove("default").or(removed)
        } else {
            if let (Some(ref r), Some(default)) = (removed.as_ref(), sessions.get("default")) {
                if std::sync::Arc::ptr_eq(r, default) {
                    sessions.remove("default");
                }
            }
            removed
        }
        // Do not silently retarget the default alias to another server after disconnect.
    };
    if let Some(handle) = handle_to_disconnect {
        tokio::spawn(async move {
            let _ = tokio::time::timeout(
                std::time::Duration::from_millis(800),
                handle.disconnect(russh::Disconnect::ByApplication, "User Disconnect", "en"),
            ).await;
        });
    }
    {
        let mut map = state.connections.lock();
        map.remove(&conn_id);
        if conn_id == "default" || map.get("default").map(|c| c.id == conn_id).unwrap_or(false) {
            map.remove("default");
        }
        // The default alias stays unset until the user explicitly connects/selects a server.
    }
    {
        let mut priv_map = USER_PRIVILEGE_CACHE.lock();
        priv_map.remove(&conn_id);
        // The alias may refer to the disconnected connection; invalidate it rather
        // than risk returning privilege data for a different active session.
        priv_map.remove("default");
    }
    let _ = crate::ssh::tunnel::ssh_stop_socks5(conn_id.clone()).await;
    log::info!("SSH Desktop: SSH Session disconnected for ID: {}", conn_id);
    Ok(())
}

#[tauri::command]
pub async fn ssh_list_connections(state: tauri::State<'_, AppState>) -> Result<Vec<ConnectionInfo>, String> {
    let list: Vec<ConnectionInfo> = state
        .connections
        .lock()
        .iter()
        .filter(|(k, _)| *k != "default")
        .map(|(_, c)| ConnectionInfo {
            id: c.id.clone(),
            name: c.config.name.clone(),
            host: c.config.host.clone(),
            port: c.config.port,
            username: c.config.username.clone(),
            connected: c.connected,
            connected_at: c.connected_at,
        })
        .collect();
    Ok(list)
}

#[tauri::command]
pub async fn ssh_test_connection(mut config: ConnectionConfig) -> Result<bool, String> {
    validate_ssh_target(&config.host, config.port, &config.username)?;
    if config.host.is_empty() || config.port == 0 {
        return Err("Invalid host or port configuration".into());
    }

    if let Some(raw_key) = &config.private_key_path {
        if let Some(existing_path) = ensure_key_file("test-probe", raw_key) {
            config.private_key_path = Some(existing_path);
        }
    }

    let is_key_auth = match config.auth_method.as_deref() {
        Some("password") => false,
        Some("key") => true,
        _ => config.private_key_path.is_some() || config.password.is_none(),
    };
    let selected_key_path = if is_key_auth { config.private_key_path.as_deref() } else { None };
    if let Some(key_path) = selected_key_path {
        if resolve_key_path(key_path).is_none() {
            return Ok(false);
        }
    }
    let is_ppk = selected_key_path.map(is_ppk_key).unwrap_or(false);

    // 1. In-memory persistent probe (for PEM keys / password)
    if !is_ppk {
        if let Ok(handle) = crate::ssh::session::connect_session_with_passphrase_auth(
            &config.host,
            config.port,
            &config.username,
            if is_key_auth { None } else { config.password.as_deref() },
            selected_key_path,
            None,
            config.auth_method.as_deref() != Some("password"),
        ).await {
            if let Ok((out, _err, code)) = crate::ssh::session::run_exec_channel(&handle, "echo sshdesktop-ok").await {
                if code == 0 && (out.contains("sshdesktop-ok") || out.contains("clouddesk-ok")) {
                    return Ok(true);
                }
            }
        }
    }

    let host = &config.host;
    let port = config.port.to_string();
    let user = &config.username;

    // 2. PPK Key probe via Plink
    if is_ppk {
        if let Some(key_path) = &config.private_key_path {
            let plink_bin = get_plink_path();
            let mut cmd = tokio::process::Command::new(plink_bin);
    cmd.kill_on_drop(true);
            #[cfg(windows)]
            cmd.creation_flags(0x08000000);
            cmd.arg("-batch")
                .arg("-ssh")
                .arg("-P").arg(&port)
                .arg("-l").arg(user)
                .arg("-i").arg(key_path)
                .arg(host)
                .arg("echo sshdesktop-ok");
            if let Ok(Ok(res)) = tokio::time::timeout(std::time::Duration::from_secs(8), cmd.output()).await {
                if res.status.success() {
                    return Ok(true);
                }
            }
        }
    }

    // 3. Password probe via Plink
    if let Some(pwd) = &config.password {
        if !pwd.is_empty() {
            let password_file = create_password_file(pwd)?;
            let plink_bin = get_plink_path();
            let mut cmd = tokio::process::Command::new(plink_bin);
    cmd.kill_on_drop(true);
            #[cfg(windows)]
            cmd.creation_flags(0x08000000);
            cmd.arg("-ssh")
                .arg("-batch")
                .arg("-P").arg(&port)
                .arg("-l").arg(user)
                .arg("-pwfile").arg(password_file.path())
                .arg(host)
                .arg("echo sshdesktop-ok");
            if let Ok(Ok(res)) = tokio::time::timeout(std::time::Duration::from_secs(8), cmd.output()).await {
                if res.status.success() {
                    return Ok(true);
                }
            }
        }
    }

    // 4. OpenSSH PEM probe
    if !is_ppk && is_key_auth {
        let mut cmd = tokio::process::Command::new("ssh");
    cmd.kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        cmd.arg("-p").arg(&port)
            .arg("-o").arg("StrictHostKeyChecking=yes")
            .arg("-o").arg("BatchMode=yes")
            .arg("-o").arg("ConnectTimeout=6");
        if let Some(k) = &config.private_key_path {
            if resolve_key_path(k).is_some() {
                cmd.arg("-i").arg(k);
            }
        }
        cmd.arg(format!("{}@{}", user, host)).arg("echo sshdesktop-ok");
        if let Ok(Ok(res)) = tokio::time::timeout(std::time::Duration::from_secs(8), cmd.output()).await {
            if res.status.success() {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

#[tauri::command]
pub async fn ssh_get_user_privilege(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<UserPrivilegeInfo, String> {
    // 1. Resolve connection first
    let conn = match resolve_connection(&state, &conn_id) {
        Some(c) => c,
        None => return Err(format!("No active SSH connection found for '{}'.", conn_id)),
    };

    let configured_user = conn.config.username.clone();

    // 2. Check cache only for this specific conn_id AND matching configured username
    if let Some(cached) = get_cached_user_privilege_for_user(&conn_id, &configured_user) {
        return Ok(cached);
    }

    // 3. Fast identity probe via basic shell commands (runs as unprivileged user)
    // Output:
    // Line 1: UID
    // Line 2: GID
    // Line 3: Username
    // Line 4: Groups
    // Line 5: $HOME
    let probe_script = r#"id -u; id -g; id -un; id -Gn; echo "$HOME""#;
    let (stdout, _) = crate::ssh::exec::run_cmd(&state, &conn_id, probe_script).await;

    let lines: Vec<&str> = stdout.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();

    let uid = lines.first().and_then(|s| s.parse::<u32>().ok()).unwrap_or_else(|| {
        if configured_user == "root" { 0 } else { 1000 }
    });
    let gid = lines.get(1).and_then(|s| s.parse::<u32>().ok()).unwrap_or(uid);
    let username = lines.get(2).map(|s| s.to_string()).unwrap_or(configured_user.clone());
    let groups: Vec<String> = lines.get(3)
        .map(|s| s.split_whitespace().map(|g| g.to_string()).collect())
        .unwrap_or_default();
    let home_dir = lines.get(4).map(|s| s.to_string()).unwrap_or_else(|| {
        if uid == 0 || username == "root" { "/root".to_string() } else { format!("/home/{}", username) }
    });

    // 4. If root, return immediately
    if uid == 0 || username == "root" {
        let info = UserPrivilegeInfo {
            username,
            uid: 0,
            gid: 0,
            home_dir: if home_dir.is_empty() { "/root".into() } else { home_dir },
            is_root: true,
            has_sudo: true,
            sudo_type: "root".to_string(),
            groups,
        };
        set_cached_user_privilege(&conn_id, info.clone());
        return Ok(info);
    }

    // 5. Test passwordless sudo
    let (_sudo_n_out, sudo_n_code) = crate::ssh::exec::run_cmd(&state, &conn_id, "sudo -n true 2>&1").await;
    if sudo_n_code == 0 {
        let info = UserPrivilegeInfo {
            username,
            uid,
            gid,
            home_dir,
            is_root: false,
            has_sudo: true,
            sudo_type: "passwordless".to_string(),
            groups,
        };
        set_cached_user_privilege(&conn_id, info.clone());
        return Ok(info);
    }

    // 6. Test password sudo if session has password
    let mut has_sudo = false;
    let mut sudo_type = "none".to_string();

    if let Some(pwd) = &conn.config.password {
        if !pwd.is_empty() {
            let test_pwd_cmd = "sudo -S -k -p '' true 2>&1";
            let mut password_input = pwd.as_bytes().to_vec();
            password_input.push(b'\n');
            let (_pwd_out, pwd_code) = crate::ssh::exec::run_cmd_with_stdin(
                &state, &conn_id, test_pwd_cmd, &password_input
            ).await;
            if pwd_code == 0 {
                has_sudo = true;
                sudo_type = "password".to_string();
            }
        }
    }

    // 7. If not verified via password test yet, check if user belongs to standard sudo/wheel/admin groups
    if !has_sudo {
        let is_in_sudo_group = groups.iter().any(|g| {
            let lower = g.to_lowercase();
            lower == "sudo" || lower == "wheel" || lower == "admin"
        });
        if is_in_sudo_group {
            has_sudo = true;
            sudo_type = "password".to_string();
        }
    }

    let info = UserPrivilegeInfo {
        username,
        uid,
        gid,
        home_dir,
        is_root: false,
        has_sudo,
        sudo_type,
        groups,
    };
    set_cached_user_privilege(&conn_id, info.clone());
    Ok(info)
}


