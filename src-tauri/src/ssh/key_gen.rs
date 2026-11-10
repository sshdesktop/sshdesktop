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

    if !ssh_dir.exists() {
        std::fs::create_dir_all(&ssh_dir)
            .map_err(|e| format!("Failed to create .ssh directory: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700));
        }
    }

    let base_name = filename
        .unwrap_or_else(|| "id_ed25519".to_string())
        .trim()
        .to_string();
    if base_name.is_empty()
        || base_name == "." || base_name == ".."
        || !base_name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-' || c == b'.')
    {
        return Err("Invalid key filename: use only letters, numbers, dot, underscore, and hyphen".into());
    }

    let priv_path = ssh_dir.join(&base_name);
    let pub_path = ssh_dir.join(format!("{}.pub", base_name));

    // If key already exists, generate with unique suffix
    let (target_priv, target_pub) = if priv_path.exists() {
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let new_priv = ssh_dir.join(format!("{}_{}", base_name, timestamp));
        let new_pub = ssh_dir.join(format!("{}_{}.pub", base_name, timestamp));
        (new_priv, new_pub)
    } else {
        (priv_path, pub_path)
    };

    let comm = comment.unwrap_or_else(|| "sshdesktop".to_string());
    let pass = passphrase.unwrap_or_default();

    // 1. Try native ssh-keygen binary first
    let mut cmd = tokio::process::Command::new("ssh-keygen");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    cmd.arg("-t")
        .arg("ed25519")
        .arg("-C")
        .arg(&comm)
        .arg("-N")
        .arg(&pass)
        .arg("-f")
        .arg(target_priv.to_str().unwrap());

    let output = cmd.output().await;

    let success = match output {
        Ok(out) => out.status.success() && target_priv.exists(),
        Err(_) => false,
    };

    if !success {
        // Fallback: Generate via russh_keys
        let key_pair = russh_keys::key::KeyPair::generate_ed25519();

        let mut priv_pem = Vec::new();
        russh_keys::encode_pkcs8_pem(&key_pair, &mut priv_pem)
            .map_err(|e| format!("Failed to encode private key: {}", e))?;

        let pub_b64 = key_pair.public_key_base64();
        let pub_formatted = format!("ssh-ed25519 {} {}\n", pub_b64, comm);

        std::fs::write(&target_priv, &priv_pem)
            .map_err(|e| format!("Failed to write private key file: {}", e))?;
        std::fs::write(&target_pub, &pub_formatted)
            .map_err(|e| format!("Failed to write public key file: {}", e))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&target_priv, std::fs::Permissions::from_mode(0o600));
        let _ = std::fs::set_permissions(&target_pub, std::fs::Permissions::from_mode(0o644));
    }

    let pub_content = std::fs::read_to_string(&target_pub)
        .map_err(|e| format!("Failed to read generated public key: {}", e))?
        .trim()
        .to_string();

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
        if priv_p.exists() {
            let pub_p = ssh_dir.join(format!("{}.pub", name));
            let pub_content = if pub_p.exists() {
                std::fs::read_to_string(&pub_p).ok().map(|s| s.trim().to_string())
            } else {
                None
            };

            keys.push(LocalKeyInfo {
                name: name.to_string(),
                path: priv_p.to_string_lossy().to_string(),
                public_key_path: if pub_p.exists() { Some(pub_p.to_string_lossy().to_string()) } else { None },
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
            if path.is_file() {
                let fname = path.file_name().unwrap_or_default().to_string_lossy();
                let is_known = candidates.iter().any(|(c, _, _)| *c == fname);
                if !is_known && (fname.ends_with(".pem") || fname.starts_with("id_")) && !fname.ends_with(".pub") && !fname.ends_with(".known_hosts") && fname != "config" && fname != "known_hosts" {
                    let pub_p = ssh_dir.join(format!("{}.pub", fname));
                    let pub_content = if pub_p.exists() {
                        std::fs::read_to_string(&pub_p).ok().map(|s| s.trim().to_string())
                    } else {
                        None
                    };
                    keys.push(LocalKeyInfo {
                        name: fname.to_string(),
                        path: path.to_string_lossy().to_string(),
                        public_key_path: if pub_p.exists() { Some(pub_p.to_string_lossy().to_string()) } else { None },
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
    let fields: Vec<&str> = clean_key.split_whitespace().collect();
    if fields.len() < 2 || fields.len() > 3
        || !(fields[0].starts_with("ssh-") || fields[0].starts_with("ecdsa-") || fields[0].starts_with("sk-ssh-") || fields[0].starts_with("sk-ecdsa-"))
        || !fields[0].bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid SSH public key format".into());
    }
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(fields[1])
        .map_err(|_| "Invalid SSH public key base64 data".to_string())?;
    if decoded.is_empty() {
        return Err("SSH public key data is empty".into());
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
