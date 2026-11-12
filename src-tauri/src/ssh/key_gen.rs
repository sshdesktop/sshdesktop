use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use directories::BaseDirs;
use russh_keys::PublicKeyBase64;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeneratedKeyPair {
    pub private_key_path: String,
    pub public_key_path: String,
    pub public_key_content: String,
    pub key_type: String,
    pub comment: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalKeyInfo {
    pub name: String,
    pub path: String,
    pub public_key_path: Option<String>,
    pub public_key_content: Option<String>,
    pub key_type: String,
    pub is_default: bool,
}

pub fn get_ssh_dir() -> Option<PathBuf> {
    BaseDirs::new().map(|dirs| dirs.home_dir().join(".ssh"))
}

#[tauri::command]
pub async fn ssh_generate_key_pair(
    filename: Option<String>,
    comment: Option<String>,
    passphrase: Option<String>,
) -> Result<GeneratedKeyPair, String> {
    let ssh_dir = get_ssh_dir().ok_or_else(|| "Could not locate user home directory".to_string())?;

    std::fs::create_dir_all(&ssh_dir)
        .map_err(|e| format!("Failed to create .ssh directory: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Secure existing directories too; do not assume ~/.ssh already has safe mode bits.
        std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Could not secure SSH key directory permissions: {}", e))?;
    }

    let base_name = filename
        .unwrap_or_else(|| "id_ed25519".to_string())
        .trim()
        .to_string();
    if base_name.is_empty() || base_name.len() > 200
        || base_name == "." || base_name == ".."
        || !base_name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-' || c == b'.')
    {
        return Err("Invalid key filename: use only letters, numbers, dot, underscore, and hyphen".into());
    }

    let priv_path = ssh_dir.join(&base_name);
    let pub_path = ssh_dir.join(format!("{}.pub", base_name));
    // exists() follows symlinks and returns false for dangling links. Inspect
    // directory entries themselves so a dangling symlink is never treated as
    // a free destination for ssh-keygen.
    let path_entry_exists = |path: &Path| std::fs::symlink_metadata(path).is_ok();

    // If key already exists, generate with unique suffix
    let (target_priv, target_pub) = if path_entry_exists(&priv_path) || path_entry_exists(&pub_path) {
        // A timestamp-only suffix collides when multiple keys are generated in
        // the same second. UUID suffixes avoid accidental key replacement.
        let suffix = uuid::Uuid::new_v4().simple().to_string();
        let new_priv = ssh_dir.join(format!("{}_{}", base_name, suffix));
        let new_pub = ssh_dir.join(format!("{}_{}.pub", base_name, suffix));
        (new_priv, new_pub)
    } else {
        (priv_path, pub_path)
    };
    if path_entry_exists(&target_priv) || path_entry_exists(&target_pub) {
        return Err("Generated SSH key destination already exists; refusing to overwrite it.".into());
    }

    let comm = comment.unwrap_or_else(|| "sshdesktop".to_string());
    let pass = passphrase.unwrap_or_default();
    if comm.len() > 256 || comm.chars().any(|c| c.is_control()) {
        return Err("Key comment must be at most 256 characters and contain no control characters.".into());
    }
    if pass.len() > 4096 || pass.contains('\0') {
        return Err("Key passphrase must be at most 4096 bytes and contain no NUL characters.".into());
    }
    let target_priv_str = target_priv.to_str()
        .ok_or_else(|| "SSH key path contains characters that cannot be represented by ssh-keygen.".to_string())?;

    // 1. Try native ssh-keygen binary first without exposing passphrase in CLI arguments
    struct TempFileCleanup(Vec<std::path::PathBuf>);
    impl Drop for TempFileCleanup {
        fn drop(&mut self) {
            for p in &self.0 {
                let _ = std::fs::remove_file(p);
            }
        }
    }
    let mut cleanup_guard = TempFileCleanup(Vec::new());

    let mut cmd = tokio::process::Command::new("ssh-keygen");
    cmd.kill_on_drop(true);
    cmd.stdin(std::process::Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    cmd.arg("-t")
        .arg("ed25519")
        .arg("-C")
        .arg(&comm);

    if pass.is_empty() {
        cmd.arg("-N").arg("");
    } else {
        let askpass_id = uuid::Uuid::new_v4().simple().to_string();
        let pass_file = std::env::temp_dir().join(format!("sshdesktop_kp_{}.txt", askpass_id));
        #[cfg(unix)]
        let askpass_script = std::env::temp_dir().join(format!("sshdesktop_ask_{}.sh", askpass_id));
        #[cfg(not(unix))]
        let askpass_script = std::env::temp_dir().join(format!("sshdesktop_ask_{}.cmd", askpass_id));

        cleanup_guard.0.push(pass_file.clone());
        cleanup_guard.0.push(askpass_script.clone());

        {
            use std::io::Write;
            #[cfg(unix)]
            let mut pf = {
                use std::os::unix::fs::OpenOptionsExt;
                std::fs::OpenOptions::new().write(true).create_new(true).mode(0o600).open(&pass_file)
                    .map_err(|e| format!("Failed to prepare key passphrase helper: {}", e))?
            };
            #[cfg(not(unix))]
            let mut pf = std::fs::OpenOptions::new().write(true).create_new(true).open(&pass_file)
                .map_err(|e| format!("Failed to prepare key passphrase helper: {}", e))?;
            pf.write_all(pass.as_bytes()).map_err(|e| format!("Failed writing passphrase helper: {}", e))?;
        }

        {
            use std::io::Write;
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                let escaped_pf = pass_file.to_string_lossy().replace('\'', r"'\''");
                let script_body = format!("#!/bin/sh\ncat '{}'\n", escaped_pf);
                let mut sf = std::fs::OpenOptions::new().write(true).create_new(true).mode(0o700).open(&askpass_script)
                    .map_err(|e| format!("Failed to prepare askpass script: {}", e))?;
                sf.write_all(script_body.as_bytes()).map_err(|e| format!("Failed writing askpass script: {}", e))?;
            }
            #[cfg(not(unix))]
            {
                let pf_str = pass_file.to_string_lossy().replace('"', "");
                let script_body = format!("@echo off\r\ntype \"{}\"\r\n", pf_str);
                let mut sf = std::fs::OpenOptions::new().write(true).create_new(true).open(&askpass_script)
                    .map_err(|e| format!("Failed to prepare askpass script: {}", e))?;
                sf.write_all(script_body.as_bytes()).map_err(|e| format!("Failed writing askpass script: {}", e))?;
            }
        }

        cmd.env("SSH_ASKPASS", &askpass_script)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", "sshdesktop:0");
    }

    cmd.arg("-f").arg(target_priv_str);

    let output = tokio::time::timeout(std::time::Duration::from_secs(30), cmd.output()).await;
    drop(cleanup_guard);

    let success = match output {
        Ok(Ok(out)) => out.status.success() && target_priv.exists() && target_pub.exists(),
        Ok(Err(error)) => {
            log::warn!("SSH Desktop: ssh-keygen could not be started: {}", error);
            false
        }
        Err(_) => {
            log::warn!("SSH Desktop: ssh-keygen timed out after 30 seconds.");
            false
        }
    };

    if !success {
        // Remove any partial output left by a failed ssh-keygen invocation.
        let _ = std::fs::remove_file(&target_priv);
        let _ = std::fs::remove_file(&target_pub);
        if !pass.is_empty() {
            return Err("Passphrase-protected key generation requires a working ssh-keygen binary; refusing to create an unencrypted fallback key".into());
        }
        // Fallback: Generate via russh_keys only when no passphrase was requested.
        let key_pair = russh_keys::key::KeyPair::generate_ed25519();

        let mut priv_pem = Vec::new();
        russh_keys::encode_pkcs8_pem(&key_pair, &mut priv_pem)
            .map_err(|e| format!("Failed to encode private key: {}", e))?;

        let pub_b64 = key_pair.public_key_base64();
        let pub_formatted = format!("ssh-ed25519 {} {}\n", pub_b64, comm);

        crate::ssh::connection::write_secure_private_key(&target_priv, &priv_pem)
            .map_err(|e| format!("Failed to write private key file: {}", e))?;
        if let Err(error) = std::fs::write(&target_pub, &pub_formatted) {
            let _ = std::fs::remove_file(&target_priv);
            let _ = std::fs::remove_file(&target_pub);
            return Err(format!("Failed to write public key file: {}", error));
        }
    }

    if let Err(error) = crate::ssh::connection::secure_private_key_permissions(&target_priv) {
        let _ = std::fs::remove_file(&target_priv);
        let _ = std::fs::remove_file(&target_pub);
        return Err(format!("Could not secure generated private key permissions: {}", error));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Err(error) = std::fs::set_permissions(&target_pub, std::fs::Permissions::from_mode(0o644)) {
            let _ = std::fs::remove_file(&target_priv);
            let _ = std::fs::remove_file(&target_pub);
            return Err(format!("Could not set generated public key permissions: {}", error));
        }
    }

    let pub_content = match std::fs::read_to_string(&target_pub) {
        Ok(content) => content.trim().to_string(),
        Err(error) => {
            let _ = std::fs::remove_file(&target_priv);
            let _ = std::fs::remove_file(&target_pub);
            return Err(format!("Failed to read generated public key: {}", error));
        }
    };

    Ok(GeneratedKeyPair {
        private_key_path: target_priv.to_string_lossy().to_string(),
        public_key_path: target_pub.to_string_lossy().to_string(),
        public_key_content: pub_content,
        key_type: "ED25519".to_string(),
        comment: comm,
    })
}

#[tauri::command]
pub async fn ssh_list_local_keys() -> Result<Vec<LocalKeyInfo>, String> {
    let ssh_dir = match get_ssh_dir() {
        Some(d) => d,
        None => return Ok(Vec::new()),
    };

    if !ssh_dir.exists() {
        return Ok(Vec::new());
    }

    let mut keys = Vec::new();
    let candidates = [
        ("id_ed25519", "ED25519", true),
        ("id_rsa", "RSA", true),
        ("id_ecdsa", "ECDSA", true),
        ("id_dsa", "DSA", false),
    ];

    // 1. Check standard default identity files
    for (name, ktype, is_def) in candidates {
        let priv_p = ssh_dir.join(name);
        let is_regular_private_key = std::fs::symlink_metadata(&priv_p)
            .map(|metadata| metadata.file_type().is_file())
            .unwrap_or(false);
        if is_regular_private_key {
            let pub_p = ssh_dir.join(format!("{}.pub", name));
            let pub_is_regular = std::fs::symlink_metadata(&pub_p)
                .map(|metadata| metadata.file_type().is_file())
                .unwrap_or(false);
            let pub_content = if pub_is_regular {
                std::fs::read_to_string(&pub_p).ok().map(|s| s.trim().to_string())
            } else {
                None
            };

            keys.push(LocalKeyInfo {
                name: name.to_string(),
                path: priv_p.to_string_lossy().to_string(),
                public_key_path: if pub_is_regular { Some(pub_p.to_string_lossy().to_string()) } else { None },
                public_key_content: pub_content,
                key_type: ktype.to_string(),
                is_default: is_def,
            });
        }
    }

    // 2. Scan for any other .pem or private keys in ~/.ssh
    if let Ok(entries) = std::fs::read_dir(&ssh_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let file_type = match entry.file_type() {
                Ok(kind) => kind,
                Err(error) => {
                    log::warn!("SSH Desktop: Could not inspect key candidate {}: {}", path.display(), error);
                    continue;
                }
            };
            // Do not follow symlinks while enumerating private keys: a link in
            // ~/.ssh could otherwise expose unrelated files outside the key store.
            if file_type.is_file() {
                let fname = path.file_name().unwrap_or_default().to_string_lossy();
                let is_known = candidates.iter().any(|(c, _, _)| *c == fname);
                if !is_known && (fname.ends_with(".pem") || fname.starts_with("id_")) && !fname.ends_with(".pub") && !fname.ends_with(".known_hosts") && fname != "config" && fname != "known_hosts" {
                    let pub_p = ssh_dir.join(format!("{}.pub", fname));
                    let pub_is_regular = std::fs::symlink_metadata(&pub_p)
                        .map(|m| m.file_type().is_file())
                        .unwrap_or(false);
                    let pub_content = if pub_is_regular {
                        std::fs::read_to_string(&pub_p).ok().map(|s| s.trim().to_string())
                    } else {
                        None
                    };
                    keys.push(LocalKeyInfo {
                        name: fname.to_string(),
                        path: path.to_string_lossy().to_string(),
                        public_key_path: if pub_is_regular { Some(pub_p.to_string_lossy().to_string()) } else { None },
                        public_key_content: pub_content,
                        key_type: if fname.contains("ed25519") { "ED25519".into() } else { "Custom".into() },
                        is_default: false,
                    });
                }
            }
        }
    }

    Ok(keys)
}

#[tauri::command]
pub async fn ssh_install_public_key(
    state: tauri::State<'_, crate::AppState>,
    conn_id: String,
    public_key: String,
) -> Result<bool, String> {
    let clean_key = public_key.trim();
    if clean_key.len() > 64 * 1024 || clean_key.chars().any(|ch| ch.is_control() && ch != '\t') {
        return Err("SSH public key must be a single line no larger than 64 KiB.".into());
    }
    let fields: Vec<&str> = clean_key.split_whitespace().collect();
    if fields.len() < 2
        || !(fields[0].starts_with("ssh-") || fields[0].starts_with("ecdsa-") || fields[0].starts_with("sk-ssh-") || fields[0].starts_with("sk-ecdsa-"))
        || !fields[0].bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid SSH public key format".into());
    }
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(fields[1])
        .map_err(|_| "Invalid SSH public key base64 data".to_string())?;
    if decoded.len() > 48 * 1024 {
        return Err("Decoded SSH public key exceeds the 48 KiB safety limit.".into());
    }
    if decoded.len() < 4 {
        return Err("SSH public key data is malformed".into());
    }
    let algorithm_len = u32::from_be_bytes([decoded[0], decoded[1], decoded[2], decoded[3]]) as usize;
    if algorithm_len == 0
        || algorithm_len > decoded.len().saturating_sub(4)
        || decoded.get(4..4 + algorithm_len) != Some(fields[0].as_bytes())
    {
        return Err("SSH public key algorithm does not match its encoded key data".into());
    }

    let mut key_line = clean_key.to_string();
    key_line.push('\n');
    let sessions = state.sessions.lock().await;
    let handle = sessions
        .get(&conn_id)
        .ok_or_else(|| "No active SSH session found for this connection ID".to_string())?;

    // Never interpolate public-key data into a remote shell command. Send it
    // over the SSH channel stdin after creating the protected destination file.
    let install_cmd = "IFS= read -r key_line && umask 077 && mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && (grep -qxF -- \"$key_line\" ~/.ssh/authorized_keys || printf '%s\\n' \"$key_line\" >> ~/.ssh/authorized_keys) && chmod 600 ~/.ssh/authorized_keys && echo KEY_INSTALLED_OK";
    let (output, code) = crate::ssh::session::run_exec_channel_with_stdin(handle, install_cmd, key_line.as_bytes())
        .await
        .map_err(|e| format!("Failed to execute key installation: {}", e))?;

    if code == 0 && output.contains("KEY_INSTALLED_OK") {
        log::info!("SSH Desktop: Successfully registered public key into remote ~/.ssh/authorized_keys");
        Ok(true)
    } else {
        Err(format!("Server returned error installing key: {}", output))
    }
}
