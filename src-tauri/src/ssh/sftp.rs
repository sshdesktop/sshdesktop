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
    // --time-style=+%s gives a Unix epoch timestamp; -N (--literal) prevents ls from quoting filenames with spaces
    let cmd = format!(
        "ls -la -N --time-style=+%s '{}' 2>&1 || ls -la -N '{}' 2>&1 || ls -la --time-style=+%s '{}' 2>&1 || ls -la '{}' 2>&1",
        escaped, escaped, escaped, escaped
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

            // For symlinks "name -> target", keep just the name and strip any surrounding quotes added by ls
            let raw_target = name.split(" -> ").next().unwrap_or(&name).trim();
            let display_name = if (raw_target.starts_with('\'') && raw_target.ends_with('\'') && raw_target.len() >= 2)
                || (raw_target.starts_with('"') && raw_target.ends_with('"') && raw_target.len() >= 2)
            {
                raw_target[1..raw_target.len() - 1].to_string()
            } else {
                raw_target.to_string()
            };

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
    if path.trim().is_empty() {
        return Err("Remote file path cannot be empty".into());
    }
    let escaped = shell_escape(&path);
    // Keep the remote payload ASCII so run_cmd's UTF-8 decoding cannot corrupt
    // arbitrary binary bytes (archives, images, database backups, executables).
    let command = format!("base64 < '{}' | tr -d '\\n'", escaped);
    let (encoded, code) = run_cmd(&state, &conn_id, &command).await;
    if code == -1 && encoded.is_empty() {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err(format!("Failed to read file '{}': {}", path, encoded.trim()));
    }
    // Bound memory use: 48 MiB decoded file maximum for this command-based path.
    const MAX_ENCODED: usize = 64 * 1024 * 1024;
    if encoded.len() > MAX_ENCODED {
        return Err("File is too large for the command-based binary transfer (maximum 48 MiB).".into());
    }
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|e| format!("Remote file transfer returned invalid base64 data: {}", e))
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
    let clean_path = path.trim();
    if !clean_path.starts_with('/') || clean_path.len() > 4096
        || clean_path.chars().any(|c| c.is_control())
        || clean_path.rsplit('/').next().map(|n| n.is_empty() || n == "." || n == "..").unwrap_or(true)
    {
        return Err("Remote upload path must be a valid absolute file path.".into());
    }
    let escaped_path = shell_escape(clean_path);
    let b64 = to_base64(bytes);
    let parent = clean_path.rsplit_once('/').map(|(p, _)| if p.is_empty() { "/" } else { p }).unwrap_or("/");
    let tmp_name = format!(".sshdesktop-upload-{}", uuid::Uuid::new_v4().simple());
    let local_tmp = format!("{}/{}", parent.trim_end_matches('/'), tmp_name);
    let local_tmp = if parent == "/" { format!("/{}", tmp_name) } else { local_tmp };
    let escaped_tmp = shell_escape(&local_tmp);

    // Write beside the destination, then atomically rename so a failed transfer
    // never truncates or leaves a partially-written destination file.
    let atomic_cmd = format!(
        "umask 077 && base64 -d > '{}' && if [ -f '{}' ] && [ ! -L '{}' ]; then chmod --reference='{}' '{}'; fi && mv -f -- '{}' '{}'",
        escaped_tmp, escaped_path, escaped_path, escaped_path, escaped_tmp, escaped_tmp, escaped_path
    );
    let (stdout, code) = crate::ssh::exec::run_cmd_with_stdin(state, conn_id, &atomic_cmd, b64.as_bytes()).await;
    if code == 0 {
        log::info!("SSH Desktop: Atomically saved remote file {} ({} bytes)", clean_path, bytes.len());
        return Ok(());
    }

    // If the destination directory is privileged, stage in /tmp and move with sudo.
    let tmp_file = format!("/tmp/.sshdesktop-upload-{}", uuid::Uuid::new_v4().simple());
    let escaped_tmp_file = shell_escape(&tmp_file);
    let tmp_cmd = format!("umask 077 && base64 -d > '{}'", escaped_tmp_file);
    let (tmp_out, tmp_code) = crate::ssh::exec::run_cmd_with_stdin(state, conn_id, &tmp_cmd, b64.as_bytes()).await;
    if tmp_code != 0 {
        let _ = crate::ssh::exec::run_cmd(state, conn_id, &format!("rm -f -- '{}'", escaped_tmp)).await;
        return Err(format!("Failed to stage remote upload: {}", tmp_out.trim()));
    }

    let mv_cmd = format!(
        "if [ -f '{}' ] && [ ! -L '{}' ]; then chmod --reference='{}' '{}'; fi && mv -f -- '{}' '{}'",
        escaped_path, escaped_path, escaped_path, escaped_tmp_file, escaped_tmp_file, escaped_path
    );
    let (move_out, move_code) = crate::ssh::exec::run_cmd_priv(state, conn_id, &mv_cmd).await;
    if move_code == 0 {
        log::info!("SSH Desktop: Atomically saved remote file with elevated privileges: {}", clean_path);
        return Ok(());
    }
    let _ = crate::ssh::exec::run_cmd(state, conn_id, &format!("rm -f -- '{}' '{}'", escaped_tmp, escaped_tmp_file)).await;
    Err(format!("Failed to replace remote file '{}': {}", clean_path, if move_out.trim().is_empty() { "Permission denied" } else { move_out.trim() }))
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
    // Canonicalize on the remote host before applying protected-root checks.
    // This blocks traversal aliases such as /etc/../ and repeated separators.
    if path.trim().is_empty() {
        return Err("Remote path cannot be empty".into());
    }
    let escaped = shell_escape(&path);
    // Resolve the parent but preserve the final path component. Full realpath()
    // would follow a final symlink and could delete its target instead of the link.
    let canonical_cmd = format!(
        "target='{}'; parent=$(dirname -- \"$target\") || exit 1; base=$(basename -- \"$target\") || exit 1; canonical_parent=$(realpath -m -- \"$parent\") || exit 1; if [ \"$base\" = . ] || [ \"$base\" = .. ]; then realpath -m -- \"$target\"; elif [ \"$canonical_parent\" = / ]; then printf '/%s' \"$base\"; else printf '%s/%s' \"$canonical_parent\" \"$base\"; fi",
        escaped
    );
    let (canonical, canonical_code) = run_cmd(&state, &conn_id, &canonical_cmd).await;
    if canonical_code != 0 {
        return Err(format!("Could not safely resolve remote path '{}': {}", path, canonical.trim()));
    }
    let canonical = canonical.trim();
    let canonical = if canonical.len() > 1 { canonical.trim_end_matches('/') } else { canonical };
    let protected = ["/", "/home", "/root", "/etc", "/usr", "/boot", "/sys", "/proc", "/dev", "/bin", "/sbin", "/lib", "/lib64", "/var", "/run"];
    if protected.iter().any(|root| canonical == *root) {
        return Err(format!("System protection active: Refusing to delete protected path '{}'", canonical));
    }
    let escaped = shell_escape(canonical);
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
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.arg("-P").arg(&port)
        .arg("-o").arg("StrictHostKeyChecking=yes")
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
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.arg("-P").arg(&port)
        .arg("-o").arg("StrictHostKeyChecking=yes")
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
    if filename == "." || filename == ".."
        || filename.contains('/') || filename.contains('\\')
        || filename.chars().any(|c| c.is_control())
    {
        return Err("Remote filename is not safe to use as a local download name".into());
    }

    let local_dest = download_dir.join(filename);
    let local_dest_str = local_dest.to_string_lossy().to_string();

    let has_pwd = conn.config.password.as_ref().map(|p| !p.is_empty()).unwrap_or(false);

    if has_pwd {
        let pwd = conn.config.password.as_ref().unwrap();
        let password_file = crate::ssh::connection::create_password_file(pwd)?;
        let src = format!("{}@{}:{}", user, host, remote_path);
        let mut cmd = tokio::process::Command::new("pscp");
    cmd.kill_on_drop(true);
        #[cfg(windows)]
        cmd.creation_flags(0x08000000);
        cmd.arg("-P").arg(&port)
            .arg("-batch")
            .arg("-pwfile").arg(password_file.path())
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
    cmd.kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x08000000);
    cmd.arg("-P").arg(&port)
        .arg("-o").arg("StrictHostKeyChecking=yes");

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

