use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
    pub fingerprint_sha256: String,
    pub raw_public_key_b64: String,
    pub status: String, // "trusted" | "not_found" | "changed" | "failed"
    pub message: String,
    pub known_key_type: Option<String>,
    pub known_fingerprint_sha256: Option<String>,
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
) -> (String, String, Option<String>) { // (status, message, Option<known_b64>)
    let path = match get_known_hosts_path() {
        Some(p) => p,
        None => return ("not_found".into(), "known_hosts path could not be located".into(), None),
    };

    if !path.exists() {
        return (
            "not_found".into(),
            "Host key is not recorded in known_hosts (new host)".into(),
            None,
        );
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return ("not_found".into(), format!("Could not read known_hosts: {}", e), None),
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
                    None,
                );
            } else if entry_key_type == key_type {
                found_previous_key = Some(entry_key_b64.to_string());
            }
        }
    }

    if let Some(prev) = found_previous_key {
        (
            "changed".into(),
            "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! Server sent a different key than recorded in known_hosts.".into(),
            Some(prev),
        )
    } else {
        (
            "not_found".into(),
            "Host key is not recorded in known_hosts (authenticity cannot be established automatically)".into(),
            None,
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
        // Intentionally return false during probe so full authentication is not attempted
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

    // Non-blocking 5-second probe
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        russh::client::connect(config, addr, handler),
    ).await;

    let probe_data = captured.lock().clone();
    if let Some((ktype, b64, fp)) = probe_data {
        let (status, message, known_b64) = check_known_hosts(&host, port, &ktype, &b64);
        let (known_key_type, known_fingerprint_sha256) = match known_b64 {
            Some(kb64) => {
                let kfp = compute_sha256_fingerprint_from_b64(&kb64).ok();
                (Some(ktype.clone()), kfp)
            }
            None => (None, None),
        };

        Ok(HostKeyVerification {
            host,
            port,
            key_type: ktype,
            fingerprint_sha256: fp,
            raw_public_key_b64: b64,
            status,
            message,
            known_key_type,
            known_fingerprint_sha256,
        })
    } else {
        // Rule 4: Probe failed to establish handshake or receive host key.
        // NEVER mark trusted on failure! Return status: "failed".
        Ok(HostKeyVerification {
            host: host.clone(),
            port,
            key_type: "unknown".into(),
            fingerprint_sha256: "".into(),
            raw_public_key_b64: "".into(),
            status: "failed".into(),
            message: format!("Failed to probe host key from {}:{}. Connection timed out or server unreachable.", host, port),
            known_key_type: None,
            known_fingerprint_sha256: None,
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

    let mut filtered_lines: Vec<String> = Vec::new();
    let target_p22 = host.to_lowercase();
    let target_pport = format!("[{}]:{}", host.to_lowercase(), port);

    if known_hosts_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&known_hosts_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() >= 2 {
                    let host_col = parts[0].to_lowercase();
                    let hosts: Vec<&str> = host_col.split(',').collect();
                    let matches_target = hosts.contains(&target_p22.as_str()) || hosts.contains(&target_pport.as_str());
                    let matches_type = parts[1] == key_type.trim();
                    // Drop conflicting previous entry for this host and key type
                    if matches_target && matches_type {
                        continue;
                    }
                }
                filtered_lines.push(line.to_string());
            }
        }
    }

    filtered_lines.push(new_entry.trim_end().to_string());
    let mut updated_content = filtered_lines.join("\n");
    updated_content.push('\n');

    std::fs::write(&known_hosts_path, updated_content.as_bytes())
        .map_err(|e| format!("Failed to write {}: {}", known_hosts_path.display(), e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&known_hosts_path, std::fs::Permissions::from_mode(0o600));
    }

    log::info!(
        "SSH Desktop: Saved verified host key for {} ({}) to {}",
        pattern,
        key_type,
        known_hosts_path.display()
    );
    Ok(())
}
