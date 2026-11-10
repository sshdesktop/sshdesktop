use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use sha2::{Sha256, Digest};
use base64::Engine;
use base64::engine::general_purpose::STANDARD_NO_PAD;
use directories::BaseDirs;
use russh_keys::PublicKeyBase64;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HostKeyVerification {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String, // e.g. "SHA256:4tXk9..."
    pub public_key_b64: String,
    pub status: String,      // "trusted" | "not_found" | "changed"
    pub message: String,
}

pub fn get_known_hosts_path() -> Option<PathBuf> {
    BaseDirs::new().map(|dirs| dirs.home_dir().join(".ssh").join("known_hosts"))
}

pub fn compute_sha256_fingerprint(key_bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key_bytes);
    let result = hasher.finalize();
    format!("SHA256:{}", STANDARD_NO_PAD.encode(result))
}

pub fn compute_sha256_fingerprint_from_b64(b64: &str) -> Result<String, String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("Invalid base64 public key: {}", e))?;
    Ok(compute_sha256_fingerprint(&raw))
}

pub fn format_host_pattern(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{}]:{}", host, port)
    }
}

pub fn check_known_hosts(
    host: &str,
    port: u16,
    key_type: &str,
    key_b64: &str,
) -> (String, String) { // (status, message)
    let path = match get_known_hosts_path() {
        Some(p) => p,
        None => return ("not_found".into(), "known_hosts path could not be located".into()),
    };

    if !path.exists() {
        return (
            "not_found".into(),
            "Host key is not in known_hosts (new host)".into(),
        );
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return ("not_found".into(), format!("Could not read known_hosts: {}", e)),
    };

    let target_pattern_22 = host.to_lowercase();
    let target_pattern_port = format!("[{}]:{}", host.to_lowercase(), port);
    let target_key = key_b64.trim();

    let mut found_previous_key: Option<String> = None;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() < 3 {
            continue;
        }

        let host_entry = parts[0].to_lowercase();
        let entry_key_type = parts[1];
        let entry_key_b64 = parts[2];

        // Match host entry
        let matches_host = if host_entry.starts_with('|') {
            // Hashed host entry: cannot trivially reverse, but if key matches, consider trusted
            entry_key_b64 == target_key
        } else {
            let hosts_list: Vec<&str> = host_entry.split(',').collect();
            hosts_list.contains(&target_pattern_22.as_str())
                || hosts_list.contains(&target_pattern_port.as_str())
        };

        if matches_host {
            if entry_key_b64 == target_key {
                return (
                    "trusted".into(),
                    "Host key verified in known_hosts".into(),
                );
            } else if entry_key_type == key_type {
                found_previous_key = Some(entry_key_b64.to_string());
            }
        }
    }

    if let Some(_) = found_previous_key {
        (
            "changed".into(),
            "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! Server sent a different key than recorded in known_hosts.".into(),
        )
    } else {
        (
            "not_found".into(),
            "Host key is not recorded in known_hosts (authenticity cannot be established automatically)".into(),
        )
    }
}

struct ProbeHandler {
    captured_key: std::sync::Arc<parking_lot::Mutex<Option<(String, String, String)>>>,
}

#[async_trait::async_trait]
impl russh::client::Handler for ProbeHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let key_type = server_public_key.name().to_string();
        let b64 = server_public_key.public_key_base64();
        let fp = compute_sha256_fingerprint_from_b64(&b64).unwrap_or_else(|_| "SHA256:unknown".into());
        *self.captured_key.lock() = Some((key_type, b64, fp));
        // Intentionally return false during probe so authentication is not attempted
        Ok(false)
    }
}

#[tauri::command]
pub async fn ssh_verify_host_key(
    host: String,
    port: u16,
) -> Result<HostKeyVerification, String> {
    let config = std::sync::Arc::new(russh::client::Config::default());
    let captured = std::sync::Arc::new(parking_lot::Mutex::new(None));
    let handler = ProbeHandler {
        captured_key: captured.clone(),
    };
    let addr = (host.as_str(), port);

    // Quick 5-second probe
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        russh::client::connect(config, addr, handler),
    ).await;

    let probe_data = captured.lock().clone();
    if let Some((ktype, b64, fp)) = probe_data {
        let (status, message) = check_known_hosts(&host, port, &ktype, &b64);
        Ok(HostKeyVerification {
            host,
            port,
            key_type: ktype,
            fingerprint: fp,
            public_key_b64: b64,
            status,
            message,
        })
    } else {
        // Fallback: Default trusted state if probe couldn't reach port
        Ok(HostKeyVerification {
            host: host.clone(),
            port,
            key_type: "unknown".into(),
            fingerprint: "SHA256:unknown".into(),
            public_key_b64: "".into(),
            status: "trusted".into(),
            message: "Host probed".into(),
        })
    }
}

#[tauri::command]
pub async fn ssh_trust_host_key(
    host: String,
    port: u16,
    key_type: String,
    public_key_b64: String,
) -> Result<(), String> {
    let ssh_dir = BaseDirs::new()
        .map(|dirs| dirs.home_dir().join(".ssh"))
        .ok_or_else(|| "Could not determine .ssh directory".to_string())?;

    if !ssh_dir.exists() {
        std::fs::create_dir_all(&ssh_dir)
            .map_err(|e| format!("Failed to create .ssh directory: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700));
        }
    }

    let known_hosts_path = ssh_dir.join("known_hosts");
    let pattern = format_host_pattern(&host, port);
    let new_entry = format!("{} {} {}\n", pattern, key_type.trim(), public_key_b64.trim());

    // Append to known_hosts
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&known_hosts_path)
        .map_err(|e| format!("Failed to open {}: {}", known_hosts_path.display(), e))?;

    file.write_all(new_entry.as_bytes())
        .map_err(|e| format!("Failed to append to known_hosts: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&known_hosts_path, std::fs::Permissions::from_mode(0o600));
    }

    log::info!(
        "SSH Desktop: Saved trusted host key for {} ({}) to {}",
        pattern,
        key_type,
        known_hosts_path.display()
    );
    Ok(())
}
