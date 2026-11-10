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
    let mut current_aliases: Vec<String> = Vec::new();
    let mut current_template: Option<SshConfigHost> = None;
    let mut global_defaults: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    let flush_aliases = |template: &Option<SshConfigHost>, aliases: &[String], list: &mut Vec<SshConfigHost>| {
        if let Some(ref tmpl) = template {
            let primary = aliases.first().cloned().unwrap_or_default();
            for alias in aliases {
                if alias != "*" && !alias.is_empty() {
                    let mut h = tmpl.clone();
                    h.name = alias.clone();
                    if h.hostname == primary {
                        h.hostname = alias.clone();
                    }
                    list.push(h);
                }
            }
        }
    };

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
            // Flush any previously collected host block
            flush_aliases(&current_template, &current_aliases, &mut hosts);

            let tokens: Vec<String> = value
                .split_whitespace()
                .map(|s| s.trim_matches('"').trim_matches('\'').to_string())
                .filter(|s| !s.is_empty())
                .collect();

            if tokens.is_empty() || tokens.iter().all(|t| t == "*") {
                current_aliases = Vec::new();
                current_template = None;
            } else {
                let first_alias = tokens[0].clone();
                current_aliases = tokens;
                current_template = Some(SshConfigHost {
                    name: first_alias.clone(),
                    hostname: first_alias,
                    user: global_defaults.get("user").cloned(),
                    port: global_defaults.get("port").and_then(|p| p.parse().ok()).or(Some(22)),
                    identity_file: global_defaults.get("identityfile").map(|p| expand_tilde(p)),
                    raw_identity_file: global_defaults.get("identityfile").cloned(),
                    identities_only: global_defaults.get("identitiesonly").map(|v| v.to_lowercase() == "yes"),
                    proxy_jump: global_defaults.get("proxyjump").cloned(),
                });
            }
        } else if let Some(ref mut host) = current_template {
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
        } else if key == "include" {
            let expanded_inc = expand_tilde(&value);
            let inc_path = std::path::Path::new(&expanded_inc);
            if inc_path.is_file() {
                if let Ok(included_content) = std::fs::read_to_string(inc_path) {
                    let inc_hosts = parse_ssh_config_content(&included_content);
                    hosts.extend(inc_hosts);
                }
            } else if let Some(parent) = inc_path.parent() {
                if let Some(file_pattern) = inc_path.file_name().and_then(|n| n.to_str()) {
                    if file_pattern.contains('*') && parent.is_dir() {
                        if let Ok(entries) = std::fs::read_dir(parent) {
                            for entry in entries.flatten() {
                                let p = entry.path();
                                if p.is_file() {
                                    if let Ok(inc_content) = std::fs::read_to_string(&p) {
                                        let inc_hosts = parse_ssh_config_content(&inc_content);
                                        hosts.extend(inc_hosts);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Outside of a specific host block: global defaults
            global_defaults.insert(key, value);
        }
    }

    flush_aliases(&current_template, &current_aliases, &mut hosts);

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
    let has_control = |value: &str| value.chars().any(|c| c.is_control());
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

    std::fs::create_dir_all(&ssh_dir)
        .map_err(|e| format!("Failed to create .ssh directory: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&ssh_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to secure .ssh directory permissions: {}", e))?;
    }

    // Never treat an unreadable existing config as an empty file: doing so could
    // overwrite a user's SSH configuration and silently remove their host entries.
    let existing_content = if config_path.exists() {
        std::fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read existing SSH config {}: {}", config_path.display(), e))?
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

    let temp_path = ssh_dir.join(format!("config.{}.tmp", uuid::Uuid::new_v4()));
    if let Err(e) = std::fs::write(&temp_path, &updated) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("Failed to write temporary SSH config: {}", e));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&temp_path, std::fs::Permissions::from_mode(0o600));
    }

    if let Err(e) = std::fs::rename(&temp_path, &config_path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(format!("Failed to atomically update {}: {}", config_path.display(), e));
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600));
    }

    log::info!("SSH Desktop: Successfully saved host '{}' to {}", entry.name, config_path.display());
    Ok(())
}
