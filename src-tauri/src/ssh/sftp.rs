use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::run_cmd;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub permissions: String,
    pub owner: String,
    pub group: String,
    pub modified: i64,
}

/// Escape a path for use in single-quoted shell strings.
/// Replaces single quotes with '\'' (end quote, literal quote, re-open quote).
fn shell_escape(s: &str) -> String {
    s.replace('\'', r"'\''")
}

#[tauri::command]
pub async fn sftp_list_dir(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<Vec<FileEntry>, String> {
    let clean_path = if path.is_empty() || path == "/" {
        "/"
    } else {
        let p = path.trim_end_matches('/');
        if p.is_empty() { "/" } else { p }
    };
    let escaped = shell_escape(clean_path);
    // --time-style=+%s gives a Unix epoch timestamp; capture 2>&1 to detect permission denied
    let cmd = format!(
        "ls -la --time-style=+%s '{}' 2>&1 || ls -la '{}' 2>&1",
        escaped, escaped
    );
    let (stdout, code) = run_cmd(&state, &conn_id, &cmd).await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection. Please connect to a server first.".into());
    }

    if stdout.contains("Permission denied") || stdout.contains("permission denied") {
        return Err(format!("Permission denied: You do not have permission to access '{}'.", clean_path));
    }

    if stdout.contains("No such file or directory")
        || stdout.contains("cannot access")
        || stdout.contains("Not a directory")
    {
        return Err(format!("Directory not found: '{}'. The specified directory does not exist or cannot be accessed.", clean_path));
    }

    let mut entries = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // ls -la format: perms links owner group size [date/timestamp] name
        if parts.len() >= 7
            && (parts[0].starts_with('d')
                || parts[0].starts_with('-')
                || parts[0].starts_with('l'))
        {
            // Determine if we got epoch (all digits) or human date
            let is_epoch = parts[5].chars().all(|c| c.is_ascii_digit());
            let (name, modified) = if is_epoch {
                // format: perms links owner group size epoch name...
                (parts[6..].join(" "), parts[5].parse::<i64>().unwrap_or(0))
            } else if parts.len() >= 9 {
                // format: perms links owner group size month day time name...
                (parts[8..].join(" "), chrono::Utc::now().timestamp())
            } else {
                (parts[parts.len() - 1].to_string(), 0)
            };

            // Skip . and ..
            if name == "." || name == ".." || name.is_empty() {
                continue;
            }

            // For symlinks "name -> target", keep just the name
            let display_name = name.split(" -> ").next().unwrap_or(&name).to_string();

            let is_dir = parts[0].starts_with('d');
            let is_symlink = parts[0].starts_with('l');
            let size = parts[4].parse::<u64>().unwrap_or(0);
            let entry_path = if clean_path == "/" {
                format!("/{}", display_name)
            } else {
                format!("{}/{}", clean_path, display_name)
            };

            entries.push(FileEntry {
                name: display_name,
                path: entry_path,
                size,
                is_dir,
                is_symlink,
                permissions: parts[0].to_string(),
                owner: parts[2].to_string(),
                group: parts[3].to_string(),
                modified,
            });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub async fn sftp_read_file(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<Vec<u8>, String> {
    let escaped = shell_escape(&path);
    let (stdout, code) = run_cmd(&state, &conn_id, &format!("cat '{}'", escaped)).await;
    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }
    if code == 0 {
        return Ok(stdout.into_bytes());
    }
    Err(format!("Failed to read file '{}': {}", path, stdout.trim()))
}

#[tauri::command]
pub async fn sftp_read_text_file(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<String, String> {
    let escaped = shell_escape(&path);
    let (stdout, code) = run_cmd(&state, &conn_id, &format!("cat '{}'", escaped)).await;
    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }
    if code == 0 {
        return Ok(stdout);
    }
    Err(format!("Failed to read file '{}': {}", path, stdout.trim()))
}

const B64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn to_base64(bytes: &[u8]) -> String {
    let mut result = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        result.push(B64_CHARS[(b0 >> 2) as usize] as char);
        result.push(B64_CHARS[(((b0 & 3) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            result.push(B64_CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(B64_CHARS[(b2 & 0x3f) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

pub async fn sftp_write_bytes(
    state: &AppState,
    conn_id: &str,
    path: &str,
    bytes: &[u8],
) -> Result<(), String> {
    let escaped_path = shell_escape(path);
    let b64 = to_base64(bytes);

    // 1. Direct write via base64 decode from stdin (fast path for user-owned paths)
    let cmd = format!("base64 -d > '{}'", escaped_path);
    let (stdout, code) = crate::ssh::exec::run_cmd_with_stdin(state, conn_id, &cmd, b64.as_bytes()).await;
    if code == 0 {
        log::info!("SSH Desktop: Saved remote file {} ({} bytes)", path, bytes.len());
        return Ok(());
    }

    // 2. If direct write failed (e.g. Permission Denied in root/system directories like /var/www, /etc),
    // write safely to /tmp first with regular user permissions, then elevate with sudo mv!
    // This completely bypasses sudo stdin pipe issues while supporting both passwordless sudo (-n) and password sudo (-S).
    let tmp_file = format!("/tmp/.cd_up_{}_{}", std::process::id(), uuid::Uuid::new_v4().simple());
    let tmp_cmd = format!("base64 -d > '{}'", tmp_file);
    let (_tmp_out, tmp_code) = crate::ssh::exec::run_cmd_with_stdin(state, conn_id, &tmp_cmd, b64.as_bytes()).await;
    if tmp_code == 0 {
        let mv_cmd = format!("mv -f '{}' '{}'", tmp_file, escaped_path);
        let (s_out, s_code) = crate::ssh::exec::run_cmd_priv(state, conn_id, &mv_cmd).await;
        if s_code == 0 {
            log::info!("SSH Desktop: Saved remote file with elevated privileges via sudo mv: {}", path);
            return Ok(());
        }
        // Cleanup temp file if mv failed
        let _ = crate::ssh::exec::run_cmd(state, conn_id, &format!("rm -f '{}'", tmp_file)).await;
        return Err(format!("Failed to write remote file '{}': {}", path, s_out.trim()));
    }

    let detail = if !stdout.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        "Permission Denied: Administrator (sudo) privileges required to write to this file.".to_string()
    };
    Err(format!("Failed to write remote file '{}': {}", path, detail))
}

#[tauri::command]
pub async fn sftp_write_file(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
    content: Vec<u8>,
) -> Result<(), String> {
    sftp_write_bytes(&state, &conn_id, &path, &content).await
}

#[tauri::command]
pub async fn sftp_write_text_file(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
    content: String,
) -> Result<(), String> {
    sftp_write_bytes(&state, &conn_id, &path, content.as_bytes()).await
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<(), String> {
    let escaped = shell_escape(&path);
    let (stdout, code) = run_cmd(&state, &conn_id, &format!("mkdir -p '{}' 2>&1", escaped)).await;
    if code == 0 {
        return Ok(());
    }
    // Fallback to elevated execution if permission denied
    let (s_out, s_code) = crate::ssh::exec::run_cmd_priv(&state, &conn_id, &format!("mkdir -p '{}' 2>&1", escaped)).await;
    if s_code == 0 {
        return Ok(());
    }
    let err = if !s_out.trim().is_empty() { s_out.trim() } else { stdout.trim() };
    Err(format!("Failed to create directory '{}': {}", path, err))
}

#[tauri::command]
pub async fn sftp_delete(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<(), String> {
    // Prevent deleting root or protected system roots by mistake
    if path == "/" || path == "/home" || path == "/etc" || path == "/usr" || path == "/boot" || path == "/sys" {
        return Err(format!("System protection active: Refusing to delete protected path '{}'", path));
    }
    let escaped = shell_escape(&path);
    let (stdout, code) = run_cmd(&state, &conn_id, &format!("rm -rf '{}' 2>&1", escaped)).await;
    if code == 0 {
        return Ok(());
    }
    // Fallback to elevated execution if permission denied
    let (s_out, s_code) = crate::ssh::exec::run_cmd_priv(&state, &conn_id, &format!("rm -rf '{}' 2>&1", escaped)).await;
    if s_code == 0 {
        return Ok(());
    }
    let err = if !s_out.trim().is_empty() { s_out.trim() } else { stdout.trim() };
    Err(format!("Failed to delete '{}': {}", path, err))
}

#[tauri::command]
pub async fn sftp_rename(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let old_escaped = shell_escape(&old_path);
    let new_escaped = shell_escape(&new_path);
    let (stdout, code) = run_cmd(&state, &conn_id, &format!("mv '{}' '{}' 2>&1", old_escaped, new_escaped)).await;
    if code == 0 {
        return Ok(());
    }
    // Fallback to elevated execution if permission denied
    let (s_out, s_code) = crate::ssh::exec::run_cmd_priv(&state, &conn_id, &format!("mv '{}' '{}' 2>&1", old_escaped, new_escaped)).await;
    if s_code == 0 {
        return Ok(());
    }
    let err = if !s_out.trim().is_empty() { s_out.trim() } else { stdout.trim() };
    Err(format!("Failed to move '{}' to '{}': {}", old_path, new_path, err))
}

#[tauri::command]
pub async fn sftp_chmod(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
    mode: u32,
) -> Result<(), String> {
    let escaped = shell_escape(&path);
    let cmd = format!("chmod {:o} '{}'", mode, escaped);
    let (_stdout, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code == 0 {
        return Ok(());
    }
    // Fallback: try elevated execution if permission denied
    let (_s_out, s_code) = crate::ssh::exec::run_cmd_priv(&state, &conn_id, &cmd).await;
    if s_code == 0 {
        return Ok(());
    }
    Err(format!("Failed to update permissions on '{}'", path))
}

#[tauri::command]
pub async fn sftp_chown(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
    owner: String,
    group: String,
) -> Result<(), String> {
    let target = if group.is_empty() {
        owner
    } else {
        format!("{}:{}", owner, group)
    };
    let escaped = shell_escape(&path);
    let cmd = format!("chown -R '{}' '{}'", target, escaped);
    let (_stdout, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code == 0 {
        return Ok(());
    }
    // Fallback: try elevated execution if permission denied
    let (_s_out, s_code) = crate::ssh::exec::run_cmd_priv(&state, &conn_id, &cmd).await;
    if s_code == 0 {
        return Ok(());
    }
    Err(format!("Failed to update ownership on '{}'", path))
}

#[tauri::command]
pub async fn sftp_stat(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<FileEntry, String> {
    let escaped = shell_escape(&path);
    let (stdout, code) = run_cmd(&state, &conn_id, &format!("stat -c \"%s %Y %A %U %G\" '{}'", escaped)).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code == 0 && !stdout.is_empty() {
        let parts: Vec<&str> = stdout.trim().split_whitespace().collect();
        if parts.len() >= 5 {
            let size = parts[0].parse::<u64>().unwrap_or(0);
            let modified = parts[1].parse::<i64>().unwrap_or(0);
            let perms = parts[2].to_string();
            let is_dir = perms.starts_with('d');
            let is_symlink = perms.starts_with('l');
            return Ok(FileEntry {
                name: path.split('/').last().unwrap_or("file").to_string(),
                path: path.clone(),
                size,
                is_dir,
                is_symlink,
                permissions: perms,
                owner: parts[3].to_string(),
                group: parts[4].to_string(),
                modified,
            });
        }
    }

    Err(format!("Could not stat path '{}': {}", path, stdout.trim()))
}

#[tauri::command]
pub async fn sftp_download(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    // 1. Primary fast path: read remote file content directly via SSH stream
    if let Ok(bytes) = sftp_read_file(state.clone(), conn_id.clone(), remote_path.clone()).await {
        if let Some(parent) = std::path::Path::new(&local_path).parent() {
            let _ = tokio::fs::create_dir_all(parent).await;
        }
        if let Ok(()) = tokio::fs::write(&local_path, &bytes).await {
            log::info!("SSH Desktop: Downloaded {} to {}", remote_path, local_path);
            return Ok(());
        }
    }

    // 2. Fallback: scp
    let conn = crate::ssh::connection::resolve_connection(&state, &conn_id)
        .ok_or("No active SSH connection.")?;

    let host = &conn.config.host;
    let port = conn.config.port.to_string();
    let user = &conn.config.username;
    let src = format!("{}@{}:{}", user, host, remote_path);

    let mut cmd = tokio::process::Command::new("scp");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.arg("-P").arg(&port)
        .arg("-o").arg("StrictHostKeyChecking=no")
        .arg("-o").arg("IdentitiesOnly=yes");

    if let Some(key) = &conn.config.private_key_path {
        if crate::ssh::connection::resolve_key_path(key).is_some() {
            cmd.arg("-i").arg(key);
        }
    }
    cmd.arg(&src).arg(&local_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        cmd.output(),
    ).await
        .map_err(|_| "Download timed out after 120s".to_string())?
        .map_err(|e| format!("scp error: {}", e))?;

    if output.status.success() {
        log::info!("SSH Desktop: Downloaded {} to {}", remote_path, local_path);
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn sftp_upload(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    // 1. Primary fast path: read local file and stream write over active SSH session
    if let Ok(bytes) = tokio::fs::read(&local_path).await {
        return sftp_write_bytes(&state, &conn_id, &remote_path, &bytes).await;
    }

    // 2. Fallback: scp
    let conn = crate::ssh::connection::resolve_connection(&state, &conn_id)
        .ok_or("No active SSH connection.")?;

    let host = &conn.config.host;
    let port = conn.config.port.to_string();
    let user = &conn.config.username;
    let dst = format!("{}@{}:{}", user, host, remote_path);

    let mut cmd = tokio::process::Command::new("scp");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.arg("-P").arg(&port)
        .arg("-o").arg("StrictHostKeyChecking=no")
        .arg("-o").arg("IdentitiesOnly=yes");

    if let Some(key) = &conn.config.private_key_path {
        if crate::ssh::connection::resolve_key_path(key).is_some() {
            cmd.arg("-i").arg(key);
        }
    }
    cmd.arg(&local_path).arg(&dst)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        cmd.output(),
    ).await
        .map_err(|_| "Upload timed out after 120s".to_string())?
        .map_err(|e| format!("scp error: {}", e))?;

    if output.status.success() {
        log::info!("SSH Desktop: Uploaded {} to {}", local_path, remote_path);
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn sftp_read_file_base64(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<String, String> {
    let escaped = shell_escape(&path);
    let cmd = format!("base64 -w 0 '{}' 2>/dev/null || base64 '{}'", escaped, escaped);
    let (stdout, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }
    if code == 0 && !stdout.is_empty() {
        let clean_b64: String = stdout.chars().filter(|c| !c.is_whitespace()).collect();
        return Ok(clean_b64);
    }
    Err(format!("Failed to read binary file '{}'", path))
}

#[tauri::command]
pub async fn sftp_download_to_downloads(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    remote_path: String,
) -> Result<String, String> {
    let conn = crate::ssh::connection::resolve_connection(&state, &conn_id)
        .ok_or_else(|| "No active SSH connection.".to_string())?;

    let host = &conn.config.host;
    let port = conn.config.port.to_string();
    let user = &conn.config.username;

    let download_dir = directories::UserDirs::new()
        .and_then(|u| u.download_dir().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| {
            #[cfg(windows)]
            {
                if let Ok(profile) = std::env::var("USERPROFILE") {
                    return std::path::PathBuf::from(profile).join("Downloads");
                }
            }
            std::env::temp_dir()
        });

    let filename = remote_path
        .split('/')
        .filter(|s| !s.is_empty())
        .last()
        .unwrap_or("downloaded_file");

    let local_dest = download_dir.join(filename);
    let local_dest_str = local_dest.to_string_lossy().to_string();

    let has_pwd = conn.config.password.as_ref().map(|p| !p.is_empty()).unwrap_or(false);

    if has_pwd {
        let pwd = conn.config.password.as_ref().unwrap();
        let src = format!("{}@{}:{}", user, host, remote_path);
        let mut cmd = tokio::process::Command::new("pscp");
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        cmd.arg("-P").arg(&port)
            .arg("-batch")
            .arg("-pw").arg(pwd)
            .arg(&src).arg(&local_dest_str)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let res = tokio::time::timeout(
            std::time::Duration::from_secs(300),
            cmd.output(),
        ).await;

        if let Ok(Ok(output)) = res {
            if output.status.success() {
                log::info!("SSH Desktop: Downloaded {} to {}", remote_path, local_dest_str);
                return Ok(local_dest_str);
            } else {
                let err = String::from_utf8_lossy(&output.stderr);
                log::warn!("SSH Desktop: pscp download failed: {}, falling back to scp", err);
            }
        }
    }

    let src = format!("{}@{}:{}", user, host, remote_path);
    let mut cmd = tokio::process::Command::new("scp");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.arg("-P").arg(&port)
        .arg("-o").arg("StrictHostKeyChecking=no");

    if let Some(key) = &conn.config.private_key_path {
        if !key.is_empty() {
            cmd.arg("-i").arg(key);
        }
    }
    cmd.arg(&src).arg(&local_dest_str)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(300),
        cmd.output(),
    ).await
        .map_err(|_| "Download timed out after 300s".to_string())?
        .map_err(|e| format!("Failed to run scp: {}", e))?;

    if output.status.success() {
        log::info!("SSH Desktop: Downloaded {} to {}", remote_path, local_dest_str);
        Ok(local_dest_str)
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("Download failed: {}", err.trim()))
    }
}

#[tauri::command]
pub async fn sftp_folder_size(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<String, String> {
    let escaped = shell_escape(&path);
    let cmd = format!("du -sh '{}' 2>/dev/null | cut -f1", escaped);
    let (stdout, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == 0 && !stdout.trim().is_empty() {
        Ok(stdout.trim().to_string())
    } else {
        Ok("—".to_string())
    }
}

