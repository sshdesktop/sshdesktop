use crate::AppState;
use crate::ssh::exec::{run_cmd, run_cmd_priv};

fn shell_escape(s: &str) -> String {
    s.replace('\'', r"'\''")
}

#[tauri::command]
pub async fn send_desktop_notification(
    _app: tauri::AppHandle,
    _title: String,
    _body: String,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn sftp_create_zip_pure(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    base_dir: String,
    items: Vec<String>,
    output_filename: String,
) -> Result<String, String> {
    if items.is_empty() {
        return Err("No items selected to archive".into());
    }

    let clean_dir = if base_dir.is_empty() || base_dir == "/" { "/" } else { base_dir.trim_end_matches('/') };
    let archive_path = format!("{}/{}", clean_dir, output_filename);

    let escaped_items = items
        .iter()
        .map(|it| format!("'{}'", shell_escape(it)))
        .collect::<Vec<_>>()
        .join(" ");

    let lower = output_filename.to_lowercase();
    let cmd = if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        format!(
            "cd '{}' && tar -czvf '{}' {}",
            shell_escape(clean_dir),
            shell_escape(&output_filename),
            escaped_items
        )
    } else if lower.ends_with(".tar.bz2") {
        format!(
            "cd '{}' && tar -cjvf '{}' {}",
            shell_escape(clean_dir),
            shell_escape(&output_filename),
            escaped_items
        )
    } else if lower.ends_with(".tar.xz") {
        format!(
            "cd '{}' && tar -cJvf '{}' {}",
            shell_escape(clean_dir),
            shell_escape(&output_filename),
            escaped_items
        )
    } else if lower.ends_with(".tar") {
        format!(
            "cd '{}' && tar -cvf '{}' {}",
            shell_escape(clean_dir),
            shell_escape(&output_filename),
            escaped_items
        )
    } else if lower.ends_with(".zip") {
        format!(
            "cd '{}' && (command -v zip >/dev/null 2>&1 && zip -r '{}' {} || python3 -m zipfile -c '{}' {})",
            shell_escape(clean_dir),
            shell_escape(&output_filename),
            escaped_items,
            shell_escape(&output_filename),
            escaped_items
        )
    } else {
        // Default to tar.gz
        format!(
            "cd '{}' && tar -czvf '{}' {}",
            shell_escape(clean_dir),
            shell_escape(&output_filename),
            escaped_items
        )
    };

    let (out, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == 0 {
        return Ok(archive_path);
    }

    // Attempt elevated privileges
    let (priv_out, priv_code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if priv_code == 0 {
        return Ok(archive_path);
    }

    let err_msg = if !priv_out.trim().is_empty() {
        priv_out
    } else if !out.trim().is_empty() {
        out
    } else {
        format!("Command exited with status code {}", code)
    };

    Err(format!("Archive creation failed: {}", err_msg))
}

#[tauri::command]
pub async fn sftp_extract_archive_pure(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    archive_path: String,
    dest_dir: String,
) -> Result<String, String> {
    let clean_dest = if dest_dir.is_empty() || dest_dir == "/" { "/" } else { dest_dir.trim_end_matches('/') };
    let escaped_arch = shell_escape(&archive_path);
    let escaped_dest = shell_escape(clean_dest);

    let lower = archive_path.to_lowercase();
    let cmd = if lower.ends_with(".tar.gz") || lower.ends_with(".tgz") {
        format!("mkdir -p '{}' && tar -xzvf '{}' -C '{}'", escaped_dest, escaped_arch, escaped_dest)
    } else if lower.ends_with(".tar.bz2") {
        format!("mkdir -p '{}' && tar -xjvf '{}' -C '{}'", escaped_dest, escaped_arch, escaped_dest)
    } else if lower.ends_with(".tar.xz") {
        format!("mkdir -p '{}' && tar -xJvf '{}' -C '{}'", escaped_dest, escaped_arch, escaped_dest)
    } else if lower.ends_with(".tar") {
        format!("mkdir -p '{}' && tar -xvf '{}' -C '{}'", escaped_dest, escaped_arch, escaped_dest)
    } else if lower.ends_with(".gz") {
        let uncompressed = archive_path.strip_suffix(".gz").unwrap_or(&archive_path);
        let uncompressed_name = std::path::Path::new(uncompressed)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();
        format!(
            "mkdir -p '{}' && gzip -d -k -c '{}' > '{}/{}'",
            escaped_dest,
            escaped_arch,
            escaped_dest,
            shell_escape(&uncompressed_name)
        )
    } else if lower.ends_with(".zip") {
        format!(
            "mkdir -p '{}' && (command -v unzip >/dev/null 2>&1 && unzip -o '{}' -d '{}' || python3 -m zipfile -e '{}' '{}')",
            escaped_dest,
            escaped_arch,
            escaped_dest,
            escaped_arch,
            escaped_dest
        )
    } else {
        format!("mkdir -p '{}' && tar -xvf '{}' -C '{}'", escaped_dest, escaped_arch, escaped_dest)
    };

    let (out, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == 0 {
        return Ok(format!("Extracted archive: {}", archive_path));
    }

    // Fallback to elevated privileges
    let (priv_out, priv_code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if priv_code == 0 {
        return Ok(format!("Extracted archive: {}", archive_path));
    }

    let err_msg = if !priv_out.trim().is_empty() {
        priv_out
    } else if !out.trim().is_empty() {
        out
    } else {
        format!("Command exited with status code {}", code)
    };

    Err(format!("Archive extraction failed: {}", err_msg))
}
