fn valid_remote_absolute_path(value: &str) -> bool {
    value.starts_with('/') && value.len() <= 4096 && !value.chars().any(|c| c.is_control())
}

fn valid_archive_filename(value: &str) -> bool {
    !value.is_empty() && value != "." && value != ".." && value.len() <= 255
        && !value.contains('/') && !value.contains('\\')
        && !value.chars().any(|c| c.is_control())
}

fn valid_archive_item(value: &str) -> bool {
    !value.is_empty() && !value.starts_with('/') && !value.contains('\\')
        && !value.chars().any(|c| c.is_control())
        && !value.split('/').any(|part| part == "." || part == ".." || part.is_empty())
}

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
    if !valid_remote_absolute_path(&base_dir) || !valid_archive_filename(&output_filename)
        || items.iter().any(|item| !valid_archive_item(item))
    {
        return Err("Archive directory, filename, or selected item path is invalid.".into());
    }
    if items.iter().any(|item| item == &output_filename) {
        return Err("The output archive cannot also be included in its own input selection.".into());
    }

    let clean_dir = if base_dir == "/" { "/" } else { base_dir.trim_end_matches('/') };
    let archive_path = format!("{}/{}", clean_dir, output_filename);

    let escaped_items = items
        .iter()
        .map(|it| {
            // A relative item beginning with '-' must not be interpreted as a
            // tar/zip command-line option.
            let safe_item = if it.starts_with('-') { format!("./{}", it) } else { it.clone() };
            format!("'{}'", shell_escape(&safe_item))
        })
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
    if !valid_remote_absolute_path(&archive_path) || !valid_remote_absolute_path(&dest_dir) {
        return Err("Archive and destination paths must be absolute and contain no control characters.".into());
    }
    let clean_dest = if dest_dir == "/" { "/" } else { dest_dir.trim_end_matches('/') };
    let escaped_arch = shell_escape(&archive_path);
    let escaped_dest = shell_escape(clean_dest);

    let lower = archive_path.to_lowercase();
    let mut cmd = if lower.ends_with(".tar.gz") || lower.ends_with(".tgz")
        || lower.ends_with(".tar.bz2") || lower.ends_with(".tar.xz") || lower.ends_with(".tar") {
        format!(
            "mkdir -p '{}' && python3 -c '{}' '{}' '{}'",
            escaped_dest, shell_escape("import os,sys,tarfile\narchive,dest=sys.argv[1],os.path.realpath(sys.argv[2])\nwith tarfile.open(archive,'r:*') as t:\n    members=t.getmembers()\n    if len(members)>100000 or sum(m.size for m in members if m.isfile())>5368709120:\n        raise SystemExit('TAR archive exceeds extraction limits')\n    for m in members:\n        target=os.path.realpath(os.path.join(dest,m.name))\n        if os.path.commonpath([dest,target]) != dest or os.path.isabs(m.name) or m.issym() or m.islnk() or not (m.isfile() or m.isdir()):\n            raise SystemExit('Unsafe or unsupported TAR member: '+repr(m.name))\n    t.extractall(dest,members=members)"), escaped_arch, escaped_dest
        )
    } else if lower.ends_with(".gz") {
        let uncompressed = archive_path.strip_suffix(".gz").unwrap_or(&archive_path);
        let uncompressed_name = std::path::Path::new(uncompressed)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy();
        format!(
            "mkdir -p '{}' && python3 -c '{}' '{}' '{}/{}'",
            escaped_dest,
            shell_escape("import gzip,sys\nsrc,dst=sys.argv[1],sys.argv[2]\ntotal=0\nwith gzip.open(src,'rb') as r, open(dst,'wb') as w:\n    while True:\n        chunk=r.read(1048576)\n        if not chunk: break\n        total+=len(chunk)\n        if total>5368709120: raise SystemExit('Gzip output exceeds 5 GiB limit')\n        w.write(chunk)"),
            escaped_arch,
            escaped_dest,
            shell_escape(&uncompressed_name)
        )
    } else if lower.ends_with(".zip") {
        // Validate every archive member before extraction to prevent zip-slip paths.
        format!(
            "mkdir -p '{}' && python3 -c '{}' '{}' '{}'",
            escaped_dest, shell_escape("import os,sys,stat,zipfile\narchive,dest=sys.argv[1],os.path.realpath(sys.argv[2])\nwith zipfile.ZipFile(archive) as z:\n    members=z.infolist()\n    if len(members)>100000 or sum(m.file_size for m in members if not m.is_dir())>5368709120:\n        raise SystemExit('ZIP archive exceeds extraction limits')\n    for m in members:\n        target=os.path.realpath(os.path.join(dest,m.filename))\n        mode=(m.external_attr >> 16) & 0xffff\n        if os.path.commonpath([dest,target]) != dest or os.path.isabs(m.filename) or stat.S_ISLNK(mode):\n            raise SystemExit('Unsafe ZIP member: '+repr(m.filename))\n    z.extractall(dest)"), escaped_arch, escaped_dest
        )
    } else {
        return Err("Unsupported archive format. Supported: tar, tar.gz, tgz, tar.bz2, tar.xz, zip, and gzip.".into());
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
