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

/// Match an OpenSSH hashed host token (|1|salt|hmac) against a candidate host.
fn matches_hashed_host(token: &str, candidate: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha1::Sha1;

    let mut fields = token.split('|');
    if fields.next() != Some("") || fields.next() != Some("1") {
        return false;
    }
    let (Some(salt_b64), Some(hash_b64), None) = (fields.next(), fields.next(), fields.next()) else {
        return false;
    };
    let Ok(salt) = base64::engine::general_purpose::STANDARD.decode(salt_b64) else {
        return false;
    };
    let Ok(expected) = base64::engine::general_purpose::STANDARD.decode(hash_b64) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(&salt) else {
        return false;
    };
    mac.update(candidate.as_bytes());
    mac.verify_slice(&expected).is_ok()
}

/// Match only the exact host token, including OpenSSH's non-default-port form.
/// Wildcards and negated patterns are deliberately not treated as exact trust.
fn host_token_matches(token: &str, host: &str, port: u16) -> bool {
    let normalized_host = host.to_lowercase();
    let candidates = if port == 22 {
        vec![normalized_host.clone(), format!("[{}]:{}", normalized_host, port)]
    } else {
        vec![format!("[{}]:{}", normalized_host, port)]
    };

    if token.starts_with("|1|") {
        return candidates.iter().any(|candidate| matches_hashed_host(token, candidate));
    }

    let token = token.to_lowercase();
    candidates.iter().any(|candidate| token == *candidate)
}

pub fn check_known_hosts(
    host: &str,
    port: u16,
    key_type: &str,
    key_b64: &str,
) -> (String, String, Option<String>) {
    let path = match get_known_hosts_path() {
        Some(p) => p,
        None => return ("failed".into(), "known_hosts path could not be located".into(), None),
    };

    if !path.exists() {
        return ("not_found".into(), "Host key is not recorded in known_hosts (new host)".into(), None);
    }

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(e) => return ("failed".into(), format!("Could not read known_hosts: {}", e), None),
    };

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

        // OpenSSH markers have security semantics. A revoked key must never be
        // accepted, and CA entries are not direct host keys (certificate validation
        // is not implemented by this russh handler).
        let (marker, host_field, key_type_field, key_field) = if parts[0].starts_with('@') {
            if parts.len() < 4 { continue; }
            (Some(parts[0]), parts[1], parts[2], parts[3])
        } else {
            (None, parts[0], parts[1], parts[2])
        };

        let host_matches = host_field.split(',').any(|token| {
            !token.starts_with('!') && host_token_matches(token, host, port)
        });
        if !host_matches {
            continue;
        }

        if marker == Some("@cert-authority") {
            continue;
        }

        if key_field == target_key && key_type_field == key_type {
            if marker == Some("@revoked") {
                return (
                    "changed".into(),
                    "The offered SSH host key is explicitly revoked in known_hosts.".into(),
                    Some(key_field.to_string()),
                );
            }
            return ("trusted".into(), "Host key verified in known_hosts".into(), None);
        }

        if key_type_field == key_type && marker != Some("@revoked") {
            found_previous_key = Some(key_field.to_string());
        }
    }

    if let Some(previous) = found_previous_key {
        (
            "changed".into(),
            "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! The server key differs from known_hosts.".into(),
            Some(previous),
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
    use base64::Engine;

    let host = host.trim();
    let key_type = key_type.trim();
    let public_key_b64 = public_key_b64.trim();

    if host.is_empty()
        || host.chars().any(|c| c.is_whitespace() || c.is_control() || c == ',' || c == '!')
        || port == 0
    {
        return Err("Invalid host or port for known_hosts entry".into());
    }
    if key_type.is_empty()
        || !key_type.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'@' || b == b'.')
    {
        return Err("Invalid SSH host key algorithm".into());
    }

    let decoded_key = base64::engine::general_purpose::STANDARD
        .decode(public_key_b64)
        .map_err(|_| "Invalid base64 SSH public key".to_string())?;
    if decoded_key.is_empty() {
        return Err("SSH public key cannot be empty".into());
    }

    // Do not silently replace a changed key. The user must verify it out-of-band,
    // remove the old known_hosts entry with ssh-keygen -R, then reconnect.
    let (status, message, _) = check_known_hosts(host, port, key_type, public_key_b64);
    if status == "changed" {
        return Err(format!(
            "Host key changed for {}:{}; refusing automatic replacement. Verify the new fingerprint independently, then remove the old entry from known_hosts before trusting it.",
            host, port
        ));
    }
    if status == "trusted" {
        return Ok(());
    }
    if status == "failed" {
        return Err(format!("Cannot safely update known_hosts: {}", message));
    }

    let ssh_dir = BaseDirs::new()
        .map(|dirs| dirs.home_dir().join(".ssh"))
        .ok_or_else(|| "Could not determine .ssh directory".to_string())?;
    std::fs::create_dir_all(&ssh_dir)
        .map_err(|e| format!("Failed to create .ssh directory: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to secure .ssh directory permissions: {}", e))?;
    }

    let known_hosts_path = ssh_dir.join("known_hosts");
    let pattern = format_host_pattern(host, port);
    let new_entry = format!("{} {} {}\n", pattern, key_type, public_key_b64);
    let existing = if known_hosts_path.exists() {
        std::fs::read_to_string(&known_hosts_path)
            .map_err(|e| format!("Failed to read known_hosts: {}", e))?
    } else {
        String::new()
    };

    // Remove only entries that exactly identify this host (including hashed entries).
    // Preserve comments, other hosts, and unrelated key algorithms.
    let mut retained = Vec::new();
    for line in existing.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            retained.push(line.to_string());
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        let (host_field, entry_key_type) = if parts.first().map(|p| p.starts_with('@')).unwrap_or(false) {
            if parts.len() < 4 {
                retained.push(line.to_string());
                continue;
            }
            (parts[1], parts[2])
        } else if parts.len() >= 3 {
            (parts[0], parts[1])
        } else {
            retained.push(line.to_string());
            continue;
        };
        let same_host = host_field.split(',').any(|token| {
            !token.starts_with('!') && host_token_matches(token, host, port)
        });
        if !(same_host && entry_key_type == key_type) {
            retained.push(line.to_string());
        }
    }

    retained.push(new_entry.trim_end().to_string());
    let mut updated = retained.join("\n");
    updated.push('\n');

    let temp_path = ssh_dir.join(format!("known_hosts.{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temp_path, updated.as_bytes())
        .map_err(|e| format!("Failed to write temporary known_hosts: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temp_path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to secure known_hosts permissions: {}", e))?;
    }

    #[cfg(windows)]
    {
        // Windows rename does not replace an existing destination. Move the old
        // file aside first and restore it if installing the new file fails.
        if known_hosts_path.exists() {
            let backup_path = ssh_dir.join(format!("known_hosts.{}.bak", uuid::Uuid::new_v4()));
            std::fs::rename(&known_hosts_path, &backup_path)
                .map_err(|e| format!("Failed to stage existing known_hosts: {}", e))?;
            if let Err(error) = std::fs::rename(&temp_path, &known_hosts_path) {
                let restore_error = std::fs::rename(&backup_path, &known_hosts_path).err();
                let _ = std::fs::remove_file(&temp_path);
                return Err(match restore_error {
                    Some(restore) => format!(
                        "Failed to install known_hosts: {}. Restoring the previous file also failed: {}",
                        error, restore
                    ),
                    None => format!("Failed to install known_hosts; previous file restored: {}", error),
                });
            }
            let _ = std::fs::remove_file(&backup_path);
        } else if let Err(error) = std::fs::rename(&temp_path, &known_hosts_path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("Failed to install known_hosts: {}", error));
        }
    }

    #[cfg(not(windows))]
    {
        if let Err(error) = std::fs::rename(&temp_path, &known_hosts_path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("Failed to replace known_hosts: {}", error));
        }
    }

    log::info!(
        "SSH Desktop: Saved explicitly approved host key for {} ({})",
        pattern,
        key_type
    );
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    fn hashed_host_token(host: &str, salt: &[u8]) -> String {
        use hmac::{Hmac, Mac};
        use sha1::Sha1;
        let mut mac = Hmac::<Sha1>::new_from_slice(salt).expect("valid HMAC key");
        mac.update(host.as_bytes());
        format!(
            "|1|{}|{}",
            base64::engine::general_purpose::STANDARD.encode(salt),
            base64::engine::general_purpose::STANDARD.encode(mac.finalize().into_bytes())
        )
    }

    #[test]
    fn matches_hashed_default_port_host() {
        let token = hashed_host_token("server.example.com", b"test-salt");
        assert!(host_token_matches(&token, "server.example.com", 22));
        assert!(!host_token_matches(&token, "other.example.com", 22));
    }

    #[test]
    fn matches_hashed_non_default_port_host() {
        let token = hashed_host_token("[server.example.com]:2222", b"another-salt");
        assert!(host_token_matches(&token, "server.example.com", 2222));
        assert!(!host_token_matches(&token, "server.example.com", 22));
    }

    #[test]
    fn malformed_hashed_host_never_matches() {
        assert!(!host_token_matches("|1|not-base64|also-not-base64", "server.example.com", 22));
        assert!(!host_token_matches("|2|c2FsdA==|aGFzaA==", "server.example.com", 22));
    }

    #[test]
    fn plain_host_matching_is_exact() {
        assert!(host_token_matches("server.example.com", "server.example.com", 22));
        assert!(!host_token_matches("server.example.com", "other.example.com", 22));
        assert!(host_token_matches("[server.example.com]:2222", "server.example.com", 2222));
        assert!(!host_token_matches("[server.example.com]:2222", "server.example.com", 22));
    }
}
