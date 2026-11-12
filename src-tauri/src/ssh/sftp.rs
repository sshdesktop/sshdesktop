fn valid_remote_path(path: &str) -> bool {
    path.starts_with('/') && path.len() <= 4096
        && !path.chars().any(|ch| ch.is_control())
        && !path.split('/').any(|part| part == "." || part == "..")
}

async fn run_scp_transfer(
    conn: &crate::ssh::connection::SshConnection,
    local_path: &str,
    remote_path: &str,
    upload: bool,
) -> Result<(), String> {
    if local_path.trim().is_empty() || local_path.len() > 4096
        || local_path.chars().any(|ch| ch.is_control())
    {
        return Err("Invalid local transfer path.".into());
    }
    if !remote_path.starts_with('/') || remote_path.len() > 4096
        || remote_path.chars().any(|ch| ch.is_control())
        || remote_path.split('/').any(|part| part == "." || part == "..")
    {
        return Err("Remote transfer path must be absolute and cannot contain traversal components.".into());
    }
    let is_key_auth = match conn.config.auth_method.as_deref() {
        Some("password") => false,
        Some("key") => true,
        _ => conn.config.private_key_path.is_some() || conn.config.password.is_none(),
    };
    let selected_key_path = if is_key_auth { conn.config.private_key_path.as_deref() } else { None };
    if let Some(key) = selected_key_path {
        if crate::ssh::connection::resolve_key_path(key).is_none() {
            return Err(format!("Selected SSH identity '{}' could not be found.", key));
        }
    }
    let password = if is_key_auth { None } else { conn.config.password.as_deref().filter(|p| !p.is_empty()) };
    if !is_key_auth && password.is_none() {
        return Err("Password authentication was selected, but no SSH password is configured.".into());
    }

    let use_putty = !is_key_auth || selected_key_path.map(crate::ssh::connection::is_ppk_key).unwrap_or(false);
    let host_spec = if conn.config.host.contains(':') && !conn.config.host.starts_with('[') {
        format!("[{}]", conn.config.host)
    } else {
        conn.config.host.clone()
    };
    let local_arg = if local_path.starts_with('-') { format!("./{}", local_path) } else { local_path.to_string() };
    let mut cmd = if use_putty {
        let mut command = tokio::process::Command::new("pscp");
        command.kill_on_drop(true);
        command.arg("-P").arg(conn.config.port.to_string()).arg("-batch");
        if let Some(pwd) = password {
            let password_file = crate::ssh::connection::create_password_file(pwd)?;
            command.arg("-pwfile").arg(password_file.path());
            // Keep the temporary credential file alive until pscp exits.
            let remote_spec = format!("{}@{}:'{}'", conn.config.username, host_spec, shell_escape(remote_path));
            if upload {
                command.arg("-r").arg(&local_arg).arg(&remote_spec);
            } else {
                command.arg(&remote_spec).arg(&local_arg);
            }
            command.stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            let output = tokio::time::timeout(std::time::Duration::from_secs(300), command.output())
                .await.map_err(|_| "PuTTY file transfer timed out after 300 seconds.".to_string())?
                .map_err(|e| format!("Failed to start pscp: {}", e))?;
            if output.status.success() { return Ok(()); }
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        if let Some(key) = selected_key_path {
            command.arg("-i").arg(key);
        }
        command
    } else {
        let mut command = tokio::process::Command::new("scp");
        command.kill_on_drop(true);
        command.arg("-O")
            .arg("-P").arg(conn.config.port.to_string())
            .arg("-o").arg("StrictHostKeyChecking=yes")
            .arg("-o").arg("IdentitiesOnly=yes")
            .arg("-o").arg("BatchMode=yes");
        if let Some(key) = selected_key_path {
            command.arg("-i").arg(key);
        }
        command
    };

    let remote_spec = format!("{}@{}:'{}'", conn.config.username, host_spec, shell_escape(remote_path));
    if upload {
        cmd.arg(&local_arg).arg(&remote_spec);
    } else {
        cmd.arg(&remote_spec).arg(&local_arg);
    }
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let output = tokio::time::timeout(std::time::Duration::from_secs(300), cmd.output())
        .await.map_err(|_| "SCP file transfer timed out after 300 seconds.".to_string())?
        .map_err(|e| format!("Failed to start SCP: {}", e))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

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
    if !path.is_empty() && !valid_remote_path(&path) {
        return Err("Remote directory path must be absolute and contain no traversal or control characters.".into());
    }
    let clean_path = if path.is_empty() || path == "/" {
        "/"
    } else {
        let p = path.trim_end_matches('/');
        if p.is_empty() { "/" } else { p }
    };

    // Fast Path: Native SFTP directory listing via russh-sftp (binary clean, handles all legal filenames)
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
        if let Ok(sftp) = crate::ssh::session::open_sftp(&handle).await {
            let dir_entries = tokio::time::timeout(
                std::time::Duration::from_secs(30),
                sftp.read_dir(clean_path)
            ).await
                .map_err(|_| format!("SFTP directory listing timed out for '{}'.", clean_path))?
                .map_err(|e| format!("SFTP could not list '{}': {}", clean_path, e))?;
            const MAX_DIR_ENTRIES: usize = 10000;
            let mut entries = Vec::new();
            for entry in dir_entries {
                let file_name = entry.file_name();
                if file_name == "." || file_name == ".." {
                    continue;
                }
                if entries.len() >= MAX_DIR_ENTRIES {
                    return Err(format!("Directory contains more than {} entries; narrow the directory before listing.", MAX_DIR_ENTRIES));
                }
                let is_dir = entry.metadata().is_dir();
                    let is_symlink = entry.metadata().is_symlink();
                    let size = entry.metadata().size.unwrap_or(0);
                    let modified = entry.metadata().mtime.unwrap_or(0) as i64;
                    let permissions = format!("{:o}", entry.metadata().permissions.unwrap_or(0) & 0o777);
                    let full_path = if clean_path == "/" {
                        format!("/{}", file_name)
                    } else {
                        format!("{}/{}", clean_path, file_name)
                    };
                    entries.push(FileEntry {
                        name: file_name,
                        path: full_path,
                        size,
                        is_dir,
                        is_symlink,
                        permissions,
                        owner: entry.metadata().uid.map(|u| u.to_string()).unwrap_or_default(),
                        group: entry.metadata().gid.map(|g| g.to_string()).unwrap_or_default(),
                        modified,
                    });
                }
            return Ok(entries);
        }
    }

    let escaped = shell_escape(clean_path);
    // Prefer NUL/tab-delimited find output to avoid ambiguity on spaces/quotes/newlines;
    // fall back to literal ls -la on BSD/BusyBox systems that do not support find -printf.
    let find_cmd = format!(
        "if find '{}' -maxdepth 1 -mindepth 1 -printf '%y\\t%M\\t%u\\t%g\\t%s\\t%T@\\t%f\\0' >/dev/null 2>&1; then \
            printf '__SSHDESKTOP_FIND__\\n'; \
            find '{}' -maxdepth 1 -mindepth 1 -printf '%y\\t%M\\t%u\\t%g\\t%s\\t%T@\\t%f\\0' 2>&1 | tr '\\0' '\\n'; \
         else \
            ls -la -N --time-style=+%s '{}' 2>&1 || ls -la -N '{}' 2>&1 || ls -la --time-style=+%s '{}' 2>&1 || ls -la '{}' 2>&1; \
         fi",
        escaped, escaped, escaped, escaped, escaped, escaped
    );
    let (stdout, code) = run_cmd(&state, &conn_id, &find_cmd).await;

    if code == -1 {
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

    if code != 0 {
        return Err(format!("Failed to list remote directory '{}': {}", clean_path, stdout.trim()));
    }

    if let Some(rest) = stdout.strip_prefix("__SSHDESKTOP_FIND__\n") {
        return Ok(parse_structured_find_output(clean_path, rest));
    }

    Ok(parse_ls_output(clean_path, &stdout))
}

fn parse_structured_find_output(clean_path: &str, raw: &str) -> Vec<FileEntry> {
    let mut entries = Vec::new();
    for line in raw.lines() {
        if line.is_empty() {
            continue;
        }
        let mut fields = line.splitn(7, '\t');
        let (Some(ftype), Some(perms), Some(owner), Some(group), Some(size_str), Some(mtime_str), Some(name)) = (
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
        ) else {
            continue;
        };
        if name == "." || name == ".." || name.is_empty() || name.contains('/') {
            continue;
        }
        let modified = mtime_str
            .split('.')
            .next()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let entry_path = if clean_path == "/" {
            format!("/{}", name)
        } else {
            format!("{}/{}", clean_path, name)
        };
        entries.push(FileEntry {
            name: name.to_string(),
            path: entry_path,
            size: size_str.parse::<u64>().unwrap_or(0),
            is_dir: ftype == "d",
            is_symlink: ftype == "l",
            permissions: perms.to_string(),
            owner: owner.to_string(),
            group: group.to_string(),
            modified,
        });
    }
    entries
}

fn parse_ls_output(clean_path: &str, stdout: &str) -> Vec<FileEntry> {
    let mut entries = Vec::new();
    let now_ts = chrono::Utc::now().timestamp();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // ls -la format: perms links owner group size [date/timestamp] name
        if parts.len() >= 7
            && (parts[0].starts_with('d')
                || parts[0].starts_with('-')
                || parts[0].starts_with('l'))
        {
            // Preserve internal spaces inside filenames by slicing after the timestamp field in the original line
            let is_epoch = parts[5].chars().all(|c| c.is_ascii_digit());
            let (raw_name, modified) = if is_epoch {
                let mut rest = line.trim_start();
                for _ in 0..6 {
                    rest = rest.split_once(char::is_whitespace).map(|(_, r)| r.trim_start()).unwrap_or("");
                }
                (rest.to_string(), parts[5].parse::<i64>().unwrap_or(0))
            } else if parts.len() >= 9 {
                let mut rest = line.trim_start();
                for _ in 0..8 {
                    rest = rest.split_once(char::is_whitespace).map(|(_, r)| r.trim_start()).unwrap_or("");
                }
                (rest.to_string(), now_ts)
            } else {
                (parts[parts.len() - 1].to_string(), 0)
            };

            if raw_name == "." || raw_name == ".." || raw_name.is_empty() {
                continue;
            }

            // For symlinks "name -> target", keep just the name and strip any surrounding quotes added by ls
            let is_symlink_line = parts[0].starts_with('l');
            let raw_target = if is_symlink_line {
                raw_name.split(" -> ").next().unwrap_or(&raw_name).trim()
            } else {
                raw_name.trim_end_matches('\r')
            };
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

    entries
}

#[tauri::command]
pub async fn sftp_read_file(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<Vec<u8>, String> {
    if !valid_remote_path(&path) {
        return Err("Remote file path must be absolute and contain no traversal or control characters.".into());
    }

    // Fast Path: Native SFTP binary read via russh-sftp
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
        // Only fall back to the shell when the SFTP subsystem itself cannot be
        // opened. Once SFTP is active, preserve file/open/read errors rather
        // than hiding permission and transport failures behind a second path.
        if let Ok(sftp) = crate::ssh::session::open_sftp(&handle).await {
            use tokio::io::AsyncReadExt;
            let file = tokio::time::timeout(
                std::time::Duration::from_secs(15),
                sftp.open(&path),
            ).await
                .map_err(|_| format!("SFTP open timed out for '{}'.", path))?
                .map_err(|e| format!("SFTP could not open '{}': {}", path, e))?;
            let mut content = Vec::new();
            const MAX_READ_BYTES: u64 = 48 * 1024 * 1024; // 48 MiB safety limit
            let bytes_read = tokio::time::timeout(
                std::time::Duration::from_secs(60),
                file.take(MAX_READ_BYTES + 1).read_to_end(&mut content)
            ).await
                .map_err(|_| format!("SFTP read timed out for '{}'.", path))?
                .map_err(|e| format!("SFTP read failed for '{}': {}", path, e))?;
            if bytes_read as u64 > MAX_READ_BYTES {
                return Err("File is too large for binary transfer (maximum 48 MiB).".into());
            }
            return Ok(content);
        }
    }

    let escaped = shell_escape(&path);
    // Check the remote size before encoding to avoid transferring an oversized file.
    let command = format!("size=$(wc -c < '{}') || exit 1; [ \"$size\" -le 50331648 ] || {{ echo 'File exceeds 48 MiB limit' >&2; exit 1; }}; head -c 50331649 '{}' | base64 | tr -d '\\n'", escaped, escaped);
    let (encoded, code) = run_cmd(&state, &conn_id, &command).await;
    if code == -1 {
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
    if !valid_remote_path(&path) {
        return Err("Remote text file path must be absolute and contain no traversal or control characters.".into());
    }
    let escaped = shell_escape(&path);
    // Bound emitted bytes to the limit plus one byte to detect concurrent growth.
    let cmd = format!("head -c 8388609 -- '{}' 2>/dev/null", escaped);
    let (stdout, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code == 0 {
        if stdout.len() > 8 * 1024 * 1024 {
            return Err("Text file exceeds the 8 MiB read limit.".into());
        }
        return Ok(stdout);
    }
    Err(format!("Failed to read file '{}': {}", path, stdout.trim()))
}

const B64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn to_base64(bytes: &[u8]) -> String {
    let mut result = String::with_capacity(bytes.len().div_ceil(3) * 4);
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
    if bytes.len() > 256 * 1024 * 1024 {
        return Err("Remote file upload is limited to 256 MiB per operation.".into());
    }
    let clean_path = path.trim();
    if !clean_path.starts_with('/') || clean_path.len() > 4096
        || clean_path.chars().any(|c| c.is_control())
        || clean_path.split('/').any(|part| part == "." || part == "..")
        || clean_path.rsplit('/').next().map(|n| n.is_empty()).unwrap_or(true)
    {
        return Err("Remote upload path must be a valid absolute file path.".into());
    }

    // Fast Path: Native SFTP binary upload via russh-sftp
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
        // Only fall back to the shell when the SFTP subsystem cannot be opened.
        // Once SFTP is available, report operation failures instead of hiding them.
        if let Ok(sftp) = crate::ssh::session::open_sftp(&handle).await {
            use tokio::io::AsyncWriteExt;
            let parent = clean_path.rsplit_once('/').map(|(p, _)| if p.is_empty() { "/" } else { p }).unwrap_or("/");
            let tmp_name = format!(".upload-{}.tmp", uuid::Uuid::new_v4().simple());
            let tmp_path = if parent == "/" { format!("/{}", tmp_name) } else { format!("{}/{}", parent.trim_end_matches('/'), tmp_name) };

            if let Ok(mut file) = tokio::time::timeout(std::time::Duration::from_secs(15), sftp.create(&tmp_path)).await
                .map_err(|_| "Timed out creating temporary remote upload file.".to_string())?
            {
                let transfer_res = tokio::time::timeout(
                    std::time::Duration::from_secs(300),
                    async { file.write_all(bytes).await?; file.flush().await }
                ).await;
                drop(file);
                match transfer_res {
                    Ok(Ok(())) => {},
                    Ok(Err(e)) => {
                        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), sftp.remove_file(&tmp_path)).await;
                        return Err(format!("SFTP upload or flush failed: {}", e));
                    },
                    Err(_) => {
                        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), sftp.remove_file(&tmp_path)).await;
                        return Err("SFTP upload timed out after 300 seconds.".into());
                    }
                }
                match tokio::time::timeout(std::time::Duration::from_secs(30), sftp.rename(&tmp_path, clean_path)).await {
                    Ok(Ok(())) => return Ok(()),
                    Ok(Err(e)) => {
                        // SFTP v3 rename fails on OpenSSH when destination exists; try atomic mv -f if target exists
                        let escaped_tmp = shell_escape(&tmp_path);
                        let escaped_clean = shell_escape(clean_path);
                        let mv_cmd = format!("mv -f -- '{}' '{}'", escaped_tmp, escaped_clean);
                        let (_, mv_code) = crate::ssh::exec::run_cmd(state, conn_id, &mv_cmd).await;
                        if mv_code == 0 {
                            return Ok(());
                        }
                        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), sftp.remove_file(&tmp_path)).await;
                        return Err(format!("SFTP could not atomically publish uploaded file: {}", e));
                    },
                    Err(_) => {
                        let _ = tokio::time::timeout(std::time::Duration::from_secs(5), sftp.remove_file(&tmp_path)).await;
                        return Err("Timed out publishing uploaded file over SFTP.".into());
                    }
                }
            }
            // Fall through to shell/sudo fallback if sftp.create failed (e.g. permission denied in root-owned directory)
        }
    }

    let escaped_path = shell_escape(clean_path);
    let b64 = to_base64(bytes);
    if b64.len() > 64 * 1024 * 1024 {
        return Err("Encoded payload exceeds the 64 MiB shell fallback limit; ensure SFTP subsystem is available.".into());
    }
    let parent = clean_path.rsplit_once('/').map(|(p, _)| if p.is_empty() { "/" } else { p }).unwrap_or("/");
    let tmp_name = format!(".sshdesktop-upload-{}", uuid::Uuid::new_v4().simple());
    let local_tmp = format!("{}/{}", parent.trim_end_matches('/'), tmp_name);
    let local_tmp = if parent == "/" { format!("/{}", tmp_name) } else { local_tmp };
    let escaped_tmp = shell_escape(&local_tmp);
    // GNU/Linux uses -d/--decode; BSD/macOS base64 uses -D.
    let decode_base64 = "(if base64 -d </dev/null >/dev/null 2>&1; then base64 -d; else base64 -D; fi)";

    // Write beside the destination, then atomically rename so a failed transfer
    // never truncates or leaves a partially-written destination file.
    let preserve_mode = format!(
        "if [ -f '{0}' ] && [ ! -L '{0}' ]; then mode=$(stat -c '%a' '{0}' 2>/dev/null || stat -f '%Lp' '{0}' 2>/dev/null) || exit 1; case \"$mode\" in *[!0-7]*|'') exit 1;; esac; chmod \"$mode\" '{1}'; fi",
        escaped_path, escaped_tmp
    );
    let atomic_cmd = format!(
        "umask 077 && {} > '{}' && {} && mv -f -- '{}' '{}'",
        decode_base64, escaped_tmp, preserve_mode, escaped_tmp, escaped_path
    );
    let (stdout, code) = crate::ssh::exec::run_cmd_with_stdin(state, conn_id, &atomic_cmd, b64.as_bytes()).await;
    if code == 0 {
        log::info!("SSH Desktop: Atomically saved remote file {} ({} bytes)", clean_path, bytes.len());
        return Ok(());
    }

    let lower_err = stdout.to_lowercase();
    let is_perm_err = lower_err.contains("permission denied") || lower_err.contains("operation not permitted") || lower_err.contains("read-only");
    if code == -1 || !is_perm_err {
        let _ = crate::ssh::exec::run_cmd(state, conn_id, &format!("rm -f -- '{}'", escaped_tmp)).await;
        return Err(format!("Failed to write remote file '{}': {}", clean_path, stdout.trim()));
    }

    // If the destination directory is privileged, stage in /tmp and move with sudo, preserving/setting root ownership.
    let tmp_file = format!("/tmp/.sshdesktop-upload-{}", uuid::Uuid::new_v4().simple());
    let escaped_tmp_file = shell_escape(&tmp_file);
    let tmp_cmd = format!("umask 077 && {} > '{}'", decode_base64, escaped_tmp_file);
    let (tmp_out, tmp_code) = crate::ssh::exec::run_cmd_with_stdin(state, conn_id, &tmp_cmd, b64.as_bytes()).await;
    if tmp_code != 0 {
        let _ = crate::ssh::exec::run_cmd(state, conn_id, &format!("rm -f -- '{}' '{}'", escaped_tmp, escaped_tmp_file)).await;
        return Err(format!("Failed to stage remote upload: {}", tmp_out.trim()));
    }

    let preserve_tmp_mode = format!(
        "if [ -f '{0}' ] && [ ! -L '{0}' ]; then mode=$(stat -c '%a' '{0}' 2>/dev/null || stat -f '%Lp' '{0}' 2>/dev/null) || exit 1; case \"$mode\" in *[!0-7]*|'') exit 1;; esac; chmod \"$mode\" '{1}'; owner=$(stat -c '%u:%g' '{0}' 2>/dev/null || stat -f '%u:%g' '{0}' 2>/dev/null); [ -n \"$owner\" ] && chown \"$owner\" '{1}' 2>/dev/null || true; else chown 0:0 '{1}' 2>/dev/null || true; fi",
        escaped_path, escaped_tmp_file
    );
    let mv_cmd = format!(
        "{} && mv -f -- '{}' '{}'",
        preserve_tmp_mode, escaped_tmp_file, escaped_path
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
    if !valid_remote_path(&path) {
        return Err("Remote directory path must be absolute and contain no traversal or control characters.".into());
    }
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
    if !valid_remote_path(&path) {
        return Err("Remote delete path must be absolute and contain no traversal or control characters.".into());
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
    let is_protected = protected.iter().any(|root| {
        canonical == *root || (*root != "/" && canonical.starts_with(&format!("{}/", root)))
    });
    if is_protected {
        return Err(format!("System protection active: Refusing to delete protected system path '{}'", canonical));
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
    if !valid_remote_path(&old_path) || !valid_remote_path(&new_path) {
        return Err("Rename paths must be absolute and contain no traversal or control characters.".into());
    }
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
    if !valid_remote_path(&path) || mode > 0o7777 {
        return Err("Invalid remote path or permission mode.".into());
    }
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
    let valid_owner = !owner.is_empty() && owner.len() <= 64
        && owner.as_bytes()[0].is_ascii_alphanumeric()
        && owner.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'));
    let valid_group = group.is_empty() || (group.len() <= 64
        && group.as_bytes()[0].is_ascii_alphanumeric()
        && group.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-')));
    if !valid_remote_path(&path) || !valid_owner || !valid_group {
        return Err("Invalid remote path, owner, or group.".into());
    }
    let target = if group.is_empty() { owner } else { format!("{}:{}", owner, group) };
    let escaped = shell_escape(&path);
    // Ownership changes target one selected object; recursion is never implicit.
    let cmd = format!("chown '{}' '{}'", target, escaped);
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
    if !valid_remote_path(&path) {
        return Err("Invalid remote stat path.".into());
    }
    let escaped = shell_escape(&path);
    let stat_cmd = format!(
        "stat -c '%s\\t%Y\\t%A\\t%U\\t%G' '{}' 2>/dev/null || stat -f '%z\\t%m\\t%Sp\\t%Su\\t%Sg' '{}' 2>/dev/null",
        escaped, escaped
    );
    let (stdout, code) = run_cmd(&state, &conn_id, &stat_cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code == 0 && !stdout.is_empty() {
        let parts: Vec<&str> = stdout.trim().splitn(5, '\t').collect();
        if parts.len() == 5 {
            let size = parts[0].parse::<u64>()
                .map_err(|_| "Remote stat returned an invalid file size.".to_string())?;
            let modified = parts[1].parse::<i64>()
                .map_err(|_| "Remote stat returned an invalid modification time.".to_string())?;
            let perms = parts[2].to_string();
            if perms.is_empty() {
                return Err("Remote stat returned empty permission metadata.".into());
            }
            let is_dir = perms.starts_with('d');
            let is_symlink = perms.starts_with('l');
            return Ok(FileEntry {
                name: path.split('/').next_back().unwrap_or("file").to_string(),
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

/// Write a completed download atomically without overwriting an existing local file.
async fn save_download_new(local_path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let parent = local_path.parent().filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| std::path::Path::new("."));
    tokio::fs::create_dir_all(parent).await
        .map_err(|e| format!("Failed to create local download directory: {}", e))?;
    if tokio::fs::try_exists(local_path).await.unwrap_or(true) {
        return Err(format!("Download destination already exists; refusing to overwrite '{}'.", local_path.display()));
    }
    let mut temp_path = None;
    let mut temp_file = None;
    for _ in 0..8 {
        let candidate = parent.join(format!(".sshdesktop-download-{}.tmp", uuid::Uuid::new_v4().simple()));
        let mut options = tokio::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&candidate).await {
            Ok(file) => {
                temp_path = Some(candidate);
                temp_file = Some(file);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create temporary download file: {}", error)),
        }
    }
    let temp_path = temp_path.ok_or_else(|| "Could not allocate a unique temporary download file.".to_string())?;
    let mut file = temp_file.expect("temporary file path and handle are created together");
    let write_result = async {
        file.write_all(bytes).await?;
        file.flush().await?;
        file.sync_all().await
    }.await;
    drop(file);
    if let Err(error) = write_result {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err(format!("Failed to write temporary download file: {}", error));
    }
    match tokio::fs::hard_link(&temp_path, local_path).await {
        Ok(()) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            Ok(())
        }
        Err(error) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            Err(format!("Could not publish download without overwriting an existing file: {}", error))
        }
    }
}

#[tauri::command]
pub async fn sftp_download(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let destination = std::path::Path::new(&local_path);
    if local_path.trim().is_empty() || local_path.len() > 4096
        || local_path.chars().any(|ch| ch.is_control())
    {
        return Err("Invalid local download destination.".into());
    }
    if tokio::fs::try_exists(destination).await.unwrap_or(true) {
        return Err(format!("Download destination already exists; refusing to overwrite '{}'.", local_path));
    }
    // Preserve the 48 MiB transfer cap and surface remote permission/transport
    // errors. Falling back to SCP after a capped read failure would bypass the
    // limit and could silently turn a failed transfer into an unbounded one.
    let bytes = sftp_read_file(state.clone(), conn_id.clone(), remote_path.clone()).await?;
    save_download_new(destination, &bytes).await
        .map_err(|e| format!("Failed to save downloaded file '{}': {}", local_path, e))?;
    log::info!("SSH Desktop: Downloaded {} to {}", remote_path, local_path);
    Ok(())

}

#[tauri::command]
pub async fn sftp_upload(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    if local_path.trim().is_empty()
        || local_path.len() > 4096
        || local_path.chars().any(|ch| ch.is_control())
    {
        return Err("Invalid local upload path.".into());
    }
    if !valid_remote_path(&remote_path) || remote_path == "/" || remote_path.ends_with('/') {
        return Err("Remote upload path must be an absolute file path without traversal components.".into());
    }
    const MAX_UPLOAD_BYTES: u64 = 256 * 1024 * 1024;
    let local_metadata = tokio::fs::symlink_metadata(&local_path).await
        .map_err(|e| format!("Cannot access local upload file '{}': {}", local_path, e))?;
    if local_metadata.file_type().is_symlink() || !local_metadata.is_file() {
        return Err("Only regular local files (not symbolic links) can be uploaded.".into());
    }
    if local_metadata.len() > MAX_UPLOAD_BYTES {
        return Err("Remote file upload is limited to 256 MiB per operation.".into());
    }
    use tokio::io::AsyncReadExt;
    let file = tokio::fs::File::open(&local_path).await
        .map_err(|e| format!("Failed to open local upload file '{}': {}", local_path, e))?;
    let opened_metadata = file.metadata().await
        .map_err(|e| format!("Failed to inspect opened upload file '{}': {}", local_path, e))?;
    if !opened_metadata.is_file() || opened_metadata.len() > MAX_UPLOAD_BYTES {
        return Err("Only regular local files up to 256 MiB can be uploaded.".into());
    }
    let mut bytes = Vec::with_capacity(opened_metadata.len() as usize);
    file.take(MAX_UPLOAD_BYTES + 1).read_to_end(&mut bytes).await
        .map_err(|e| format!("Failed to read local upload file '{}': {}", local_path, e))?;
    if bytes.len() as u64 > MAX_UPLOAD_BYTES {
        return Err("Local file grew beyond the 256 MiB upload limit while being read.".into());
    }
    sftp_write_bytes(&state, &conn_id, &remote_path, &bytes).await
}

#[tauri::command]
pub async fn sftp_read_file_base64(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<String, String> {
    if !valid_remote_path(&path) {
        return Err("Invalid remote file path.".into());
    }
    let escaped = shell_escape(&path);
    let cmd = format!("size=$(wc -c < '{}') || exit 1; [ \"$size\" -le 50331648 ] || {{ echo 'File exceeds 48 MiB limit' >&2; exit 1; }}; head -c 50331649 '{}' | base64 | tr -d '\\n'", escaped, escaped);
    let (stdout, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code == 0 {
        const MAX_BASE64_BYTES: usize = 64 * 1024 * 1024;
        if stdout.len() > MAX_BASE64_BYTES {
            return Err("Encoded remote file exceeds the 48 MiB transfer limit.".into());
        }
        let clean_b64: String = stdout.chars().filter(|c| !c.is_whitespace()).collect();
        if clean_b64.len() > MAX_BASE64_BYTES || clean_b64.len() % 4 != 0
            || !clean_b64.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='))
        {
            return Err("Remote file transfer returned invalid or oversized base64 data.".into());
        }
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
    if !remote_path.starts_with('/') || remote_path.len() > 4096 || remote_path.ends_with('/')
        || remote_path.chars().any(|ch| ch.is_control())
        || remote_path.split('/').any(|part| part == "." || part == "..")
    {
        return Err("Remote download path must be an absolute path without traversal components.".into());
    }

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
        .next_back()
        .unwrap_or("downloaded_file");
    if filename == "." || filename == ".."
        || filename.contains('/') || filename.contains('\\')
        || filename.ends_with('.') || filename.ends_with(' ')
        || filename.chars().any(|c| c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        || matches!(filename.split('.').next().unwrap_or(filename).to_ascii_uppercase().as_str(), "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9" | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9")
    {
        return Err("Remote filename is not safe to use as a local download name".into());
    }

    let local_dest = download_dir.join(filename);
    let local_dest_str = local_dest.to_string_lossy().to_string();

    // Use the bounded SFTP read path and never overwrite an existing Downloads file.
    let bytes = sftp_read_file(state.clone(), conn_id.clone(), remote_path.clone()).await?;
    save_download_new(&local_dest, &bytes).await
        .map_err(|e| format!("Failed to save downloaded file '{}': {}", local_dest_str, e))?;
    log::info!("SSH Desktop: Downloaded {} to {}", remote_path, local_dest_str);
    Ok(local_dest_str)
}

#[tauri::command]
pub async fn sftp_folder_size(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    path: String,
) -> Result<String, String> {
    if !valid_remote_path(&path) {
        return Err("Invalid remote directory path.".into());
    }
    let escaped = shell_escape(&path);
    let cmd = format!("du -sh '{}' 2>/dev/null | cut -f1", escaped);
    let (stdout, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err(format!("Failed to calculate folder size: {}", stdout.trim()));
    }
    if !stdout.trim().is_empty() {
        Ok(stdout.trim().to_string())
    } else {
        Ok("—".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn structured_find_preserves_spaces_quotes_and_symlinks() {
        let raw = "f\t-rw-r--r--\troot\troot\t1234\t1700000000.5\tmy report 'final' \"v2\".pdf\n\
                   l\tlrwxrwxrwx\troot\troot\t11\t1700000001.0\tlink name -> target\n\
                   d\tdrwxr-xr-x\tubuntu\tubuntu\t4096\t1700000002\t-leading-hyphen dir\n";
        let entries = parse_structured_find_output("/home/user", raw);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].name, "my report 'final' \"v2\".pdf");
        assert_eq!(entries[0].path, "/home/user/my report 'final' \"v2\".pdf");
        assert_eq!(entries[0].size, 1234);
        assert_eq!(entries[0].modified, 1700000000);
        assert!(entries[1].is_symlink);
        assert_eq!(entries[1].name, "link name -> target");
        assert!(entries[2].is_dir);
        assert_eq!(entries[2].name, "-leading-hyphen dir");
    }

    #[test]
    fn ls_fallback_preserves_multiple_spaces_in_filename() {
        let ls_out = "total 8\n\
                      -rw-r--r-- 1 ubuntu ubuntu 512 1700000100 two   spaces file.txt\n\
                      lrwxrwxrwx 1 root root 9 1700000200 'my link' -> '/var/log/app.log'\n";
        let entries = parse_ls_output("/tmp", ls_out);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "two   spaces file.txt");
        assert_eq!(entries[0].modified, 1700000100);
        assert!(entries[1].is_symlink);
        assert_eq!(entries[1].name, "my link");
    }

    #[test]
    fn ls_fallback_preserves_quotes_unicode_and_trailing_spaces() {
        let ls_out = "-rw-r--r-- 1 user group 42 1700000300 résumé (2026) $report .txt \n\
                      drwxr-xr-x 1 user group 4096 1700000400 \"quoted \\\"dir\\\"\" \n";
        let entries = parse_ls_output("/srv/data", ls_out);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "résumé (2026) $report .txt ");
        assert_eq!(entries[0].path, "/srv/data/résumé (2026) $report .txt ");
        assert!(entries[1].is_dir);
        assert!(entries[1].name.contains("quoted"));
    }
}

