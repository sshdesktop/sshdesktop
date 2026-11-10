use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use directories::BaseDirs;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SshConfigHost {
    pub name: String,                    // The Host alias (e.g. "web-prod")
    pub hostname: String,                // HostName (e.g. "192.168.1.100")
    pub user: Option<String>,            // User (e.g. "ubuntu")
    pub port: Option<u16>,               // Port (default 22)
    pub identity_file: Option<String>,   // Expanded path to key
    pub raw_identity_file: Option<String>,// Original path with ~ if any
    pub identities_only: Option<bool>,   // IdentitiesOnly yes/no
    pub proxy_jump: Option<String>,      // ProxyJump bastion
}

pub fn get_ssh_dir() -> Option<PathBuf> {
    BaseDirs::new().map(|dirs| dirs.home_dir().join(".ssh"))
}

pub fn get_ssh_config_path() -> Option<PathBuf> {
    get_ssh_dir().map(|dir| dir.join("config"))
}

pub fn expand_tilde(path_str: &str) -> String {
    let trimmed = path_str.trim().trim_matches('"').trim_matches('\'');
    if trimmed.starts_with("~/") || trimmed.starts_with("~\\") || trimmed == "~" {
        if let Some(base) = BaseDirs::new() {
            let home = base.home_dir().to_string_lossy().to_string();
            if trimmed == "~" {
                return home;
            }
            return format!("{}{}", home, &trimmed[1..]);
        }
    }
    trimmed.to_string()
}

pub fn parse_ssh_config_content(content: &str) -> Vec<SshConfigHost> {
    let mut hosts = Vec::new();
    let mut current_host: Option<SshConfigHost> = None;
    let mut global_defaults: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let mut parts = line.split_whitespace();
        let key = match parts.next() {
            Some(k) => k.to_lowercase(),
            None => continue,
        };
        let value = parts.collect::<Vec<_>>().join(" ");
        let value = value.trim_matches('"').trim_matches('\'').trim().to_string();

        if key == "host" {
            // If previous host was being collected, save it
            if let Some(h) = current_host.take() {
                if h.name != "*" {
                    hosts.push(h);
                }
            }

            if value == "*" {
                // Global defaults block
                current_host = None;
            } else {
                current_host = Some(SshConfigHost {
                    name: value.clone(),
                    hostname: value, // Default to Host alias until HostName is found
                    user: global_defaults.get("user").cloned(),
                    port: global_defaults.get("port").and_then(|p| p.parse().ok()).or(Some(22)),
                    identity_file: global_defaults.get("identityfile").map(|p| expand_tilde(p)),
                    raw_identity_file: global_defaults.get("identityfile").cloned(),
                    identities_only: global_defaults.get("identitiesonly").map(|v| v.to_lowercase() == "yes"),
                    proxy_jump: global_defaults.get("proxyjump").cloned(),
                });
            }
        } else if let Some(ref mut host) = current_host {
            match key.as_str() {
                "hostname" => host.hostname = value,
                "user" => host.user = Some(value),
                "port" => {
                    if let Ok(p) = value.parse::<u16>() {
                        host.port = Some(p);
                    }
                }
                "identityfile" => {
                    host.raw_identity_file = Some(value.clone());
                    host.identity_file = Some(expand_tilde(&value));
                }
                "identitiesonly" => {
                    host.identities_only = Some(value.to_lowercase() == "yes");
                }
                "proxyjump" => {
                    host.proxy_jump = Some(value);
                }
                _ => {}
            }
        } else {
            // Outside of a specific host block: global defaults
            global_defaults.insert(key, value);
        }
    }

    if let Some(h) = current_host {
        if h.name != "*" {
            hosts.push(h);
        }
    }

    hosts
}

#[tauri::command]
pub async fn ssh_config_get_path() -> Result<String, String> {
    get_ssh_config_path()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine system SSH directory".to_string())
}

#[tauri::command]
pub async fn ssh_config_read_hosts() -> Result<Vec<SshConfigHost>, String> {
    let path = match get_ssh_config_path() {
        Some(p) => p,
        None => return Ok(Vec::new()),
    };

    if !path.exists() {
        return Ok(Vec::new());
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    Ok(parse_ssh_config_content(&content))
}

#[tauri::command]
pub async fn ssh_config_save_host(entry: SshConfigHost) -> Result<(), String> {
    // Values are written into an OpenSSH configuration file. Reject control
    // characters so user input cannot create additional directives/Host blocks.
    let has_control = |value: &str| value.chars().any(|c| c == '\\n' || c == '\\r' || c == '\\0');
    if entry.name.trim().is_empty()
        || has_control(&entry.name)
        || !entry.name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err("Invalid SSH host alias. Use only letters, numbers, dots, underscores, and hyphens.".into());
    }
    if entry.hostname.trim().is_empty() || has_control(&entry.hostname) || entry.hostname.chars().any(char::is_whitespace) {
        return Err("Invalid SSH hostname.".into());
    }
    if entry.user.as_deref().map(|v| v.trim().is_empty() || has_control(v) || v.chars().any(char::is_whitespace)).unwrap_or(false) {
        return Err("Invalid SSH username.".into());
    }
    if entry.raw_identity_file.as_deref().or(entry.identity_file.as_deref())
        .map(|v| v.trim().is_empty() || has_control(v)).unwrap_or(false)
    {
        return Err("Invalid SSH identity file path.".into());
    }
    if entry.proxy_jump.as_deref()
        .map(|v| v.trim().is_empty() || has_control(v) || v.chars().any(char::is_whitespace))
        .unwrap_or(false)
    {
        return Err("Invalid ProxyJump value.".into());
    }

    let ssh_dir = get_ssh_dir().ok_or_else(|| "Could not determine .ssh directory".to_string())?;
    let config_path = get_ssh_config_path().ok_or_else(|| "Could not determine .ssh/config path".to_string())?;

    if !ssh_dir.exists() {
        std::fs::create_dir_all(&ssh_dir)
            .map_err(|e| format!("Failed to create .ssh directory: {}", e))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700));
        }
    }

    let existing_content = if config_path.exists() {
        std::fs::read_to_string(&config_path).unwrap_or_default()
    } else {
        String::new()
    };

    // Format new host block
    let mut block = String::new();
    block.push_str(&format!("Host {}\n", entry.name));
    block.push_str(&format!("    HostName {}\n", entry.hostname));
    if let Some(ref u) = entry.user {
        block.push_str(&format!("    User {}\n", u));
    }
    if let Some(p) = entry.port {
        if p != 22 {
            block.push_str(&format!("    Port {}\n", p));
        }
    }
    if let Some(ref id) = entry.raw_identity_file.as_ref().or(entry.identity_file.as_ref()) {
        block.push_str(&format!("    IdentityFile {}\n", id));
        block.push_str("    IdentitiesOnly yes\n");
    }
    if let Some(ref pj) = entry.proxy_jump {
        if !pj.is_empty() {
            block.push_str(&format!("    ProxyJump {}\n", pj));
        }
    }

    // Check if host block already exists; replace or append
    let host_header = format!("Host {}", entry.name);
    let mut updated = String::new();
    let mut replacing = false;
    let mut replaced = false;

    for line in existing_content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("Host ") {
            let host_val = trimmed["Host ".len()..].trim();
            if host_val == entry.name {
                replacing = true;
                replaced = true;
                updated.push_str(&block);
                continue;
            } else if replacing {
                replacing = false;
            }
        }

        if !replacing {
            updated.push_str(line);
            updated.push('\n');
        }
    }

    if !replaced {
        if !updated.ends_with("\n\n") && !updated.is_empty() {
            if !updated.ends_with('\n') {
                updated.push('\n');
            }
            updated.push('\n');
        }
        updated.push_str(&block);
    }

    std::fs::write(&config_path, updated)
        .map_err(|e| format!("Failed to write to {}: {}", config_path.display(), e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600));
    }

    log::info!("SSH Desktop: Successfully saved host '{}' to {}", entry.name, config_path.display());
    Ok(())
}
