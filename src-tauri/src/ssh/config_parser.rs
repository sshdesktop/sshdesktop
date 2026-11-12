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

/// Quote an OpenSSH config value when it contains characters that would
/// otherwise be interpreted as separators or comments. Escape backslashes and
/// double quotes inside the quoted value.
fn format_config_value(value: &str) -> String {
    if value.chars().any(|c| c.is_whitespace() || c == '#' || c == '"') {
        let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
        format!("\"{}\"", escaped)
    } else {
        value.to_string()
    }
}

/// Remove an SSH config inline comment without treating '#' inside quotes as a comment.
fn strip_inline_comment(line: &str) -> &str {
    let mut quote = None;
    let mut escaped = false;
    let mut previous_was_whitespace = true;
    for (index, ch) in line.char_indices() {
        if escaped {
            escaped = false;
            previous_was_whitespace = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            previous_was_whitespace = false;
            continue;
        }
        if let Some(active_quote) = quote {
            if ch == active_quote {
                quote = None;
            }
            previous_was_whitespace = false;
            continue;
        }
        if ch == '"' || ch == '\'' {
            quote = Some(ch);
            previous_was_whitespace = false;
            continue;
        }
        if ch == '#' && previous_was_whitespace {
            return &line[..index];
        }
        previous_was_whitespace = ch.is_whitespace();
    }
    line
}

/// Decode a single SSH config value, preserving whitespace inside quotes.
fn parse_config_value(raw: &str) -> String {
    let value = raw.trim();
    let quoted = value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')));
    if !quoted {
        return value.to_string();
    }
    let value = &value[1..value.len() - 1];
    let mut decoded = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            if let Some(next) = chars.next() {
                decoded.push(next);
            } else {
                decoded.push(ch);
            }
        } else {
            decoded.push(ch);
        }
    }
    decoded
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

fn wildcard_match(pattern: &str, text: &str) -> bool {
    // OpenSSH Include globs support both '*' and '?'. Work on Unicode scalar
    // values rather than byte offsets so a wildcard match cannot panic on a
    // non-ASCII filename.
    let pattern: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    let (mut pi, mut ti, mut star, mut retry) = (0usize, 0usize, None, 0usize);
    while ti < text.len() {
        if pi < pattern.len() && (pattern[pi] == '?' || pattern[pi] == text[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < pattern.len() && pattern[pi] == '*' {
            star = Some(pi);
            pi += 1;
            retry = ti;
        } else if let Some(star_index) = star {
            pi = star_index + 1;
            retry += 1;
            ti = retry;
        } else {
            return false;
        }
    }
    while pi < pattern.len() && pattern[pi] == '*' {
        pi += 1;
    }
    pi == pattern.len()
}

fn parse_ssh_config_internal(
    content: &str,
    base_dir: Option<&Path>,
    depth: usize,
    visited: &mut std::collections::HashSet<PathBuf>,
) -> Vec<SshConfigHost> {
    let mut hosts = Vec::new();
    let mut current_aliases: Vec<String> = Vec::new();
    let mut current_template: Option<SshConfigHost> = None;
    let mut global_defaults: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    // OpenSSH applies the first obtained value for most scalar options. Keep
    // block state even for wildcard-only Host patterns, which have no UI alias.
    let mut in_host_block = false;
    let mut seen_host_options: std::collections::HashSet<String> = std::collections::HashSet::new();

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
        let line = strip_inline_comment(raw_line).trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        let separator = match line.find(char::is_whitespace) {
            Some(index) => index,
            None => continue,
        };
        let key = line[..separator].to_lowercase();
        let value = parse_config_value(&line[separator..]);

        if key == "host" {
            // Flush any previously collected host block
            flush_aliases(&current_template, &current_aliases, &mut hosts);
            in_host_block = true;
            seen_host_options.clear();

            let tokens: Vec<String> = value
                .split_whitespace()
                .map(|s| s.trim_matches('"').trim_matches('\'').to_string())
                .filter(|s| !s.is_empty())
                .collect();

            let concrete_aliases: Vec<String> = tokens
                .into_iter()
                .filter(|alias| {
                    !alias.starts_with('!')
                        && !alias.contains('*')
                        && !alias.contains('?')
                })
                .collect();

            // Pattern and negation entries control OpenSSH matching; they are
            // not concrete saved connections and must not appear in the host list.
            if concrete_aliases.is_empty() {
                current_aliases = Vec::new();
                current_template = None;
            } else {
                let first_alias = concrete_aliases[0].clone();
                current_aliases = concrete_aliases;
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
            if seen_host_options.insert(key.clone()) {
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
            }
        } else if key == "include" {
            if depth < 5 {
                let expanded_inc = expand_tilde(&value);
                let raw_path = std::path::Path::new(&expanded_inc);
                let inc_path = if raw_path.is_relative() {
                    if let Some(base) = base_dir {
                        base.join(raw_path)
                    } else if let Some(ssh_dir) = get_ssh_dir() {
                        ssh_dir.join(raw_path)
                    } else {
                        raw_path.to_path_buf()
                    }
                } else {
                    raw_path.to_path_buf()
                };

                if inc_path.is_file() {
                    let norm_path = inc_path.canonicalize().unwrap_or_else(|_| inc_path.clone());
                    if visited.insert(norm_path.clone()) {
                        if let Ok(included_content) = std::fs::read_to_string(&norm_path) {
                            let next_base = norm_path.parent();
                            let inc_hosts = parse_ssh_config_internal(&included_content, next_base, depth + 1, visited);
                            hosts.extend(inc_hosts);
                        }
                    }
                } else if let Some(parent) = inc_path.parent() {
                    if let Some(file_pattern) = inc_path.file_name().and_then(|n| n.to_str()) {
                        if (file_pattern.contains('*') || file_pattern.contains('?')) && parent.is_dir() {
                            if let Ok(entries) = std::fs::read_dir(parent) {
                                // OpenSSH expands Include globs in deterministic
                                // lexical order. read_dir order is filesystem-dependent.
                                let mut paths: Vec<PathBuf> = entries
                                    .filter_map(Result::ok)
                                    .map(|entry| entry.path())
                                    .collect();
                                paths.sort();
                                for p in paths {
                                    if p.is_file() {
                                        if let Some(fname) = p.file_name().and_then(|n| n.to_str()) {
                                            if wildcard_match(file_pattern, fname) {
                                                let norm_path = p.canonicalize().unwrap_or_else(|_| p.clone());
                                                if visited.insert(norm_path.clone()) {
                                                    if let Ok(inc_content) = std::fs::read_to_string(&norm_path) {
                                                        let next_base = norm_path.parent();
                                                        let inc_hosts = parse_ssh_config_internal(&inc_content, next_base, depth + 1, visited);
                                                        hosts.extend(inc_hosts);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else if !in_host_block {
            // Only directives before the first Host block are global defaults.
            // Options under wildcard-only Host blocks must never leak into later
            // concrete hosts.
            global_defaults.entry(key).or_insert(value);
        }
    }

    flush_aliases(&current_template, &current_aliases, &mut hosts);

    hosts
}

pub fn parse_ssh_config_content(content: &str) -> Vec<SshConfigHost> {
    let mut visited = std::collections::HashSet::new();
    let ssh_dir = get_ssh_dir();
    parse_ssh_config_internal(content, ssh_dir.as_deref(), 0, &mut visited)
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

    let mut visited = std::collections::HashSet::new();
    if let Ok(norm) = path.canonicalize() {
        visited.insert(norm);
    } else {
        visited.insert(path.clone());
    }

    Ok(parse_ssh_config_internal(&content, path.parent(), 0, &mut visited))
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
    if entry.hostname.trim().is_empty()
        || has_control(&entry.hostname)
        || entry.hostname.chars().any(|c| c.is_whitespace() || c == '#')
    {
        return Err("Invalid SSH hostname.".into());
    }
    if entry.user.as_deref()
        .map(|v| v.trim().is_empty() || has_control(v) || v.chars().any(|c| c.is_whitespace() || c == '#'))
        .unwrap_or(false)
    {
        return Err("Invalid SSH username.".into());
    }
    if entry.raw_identity_file.as_deref().or(entry.identity_file.as_deref())
        .map(|v| v.trim().is_empty() || has_control(v)).unwrap_or(false)
    {
        return Err("Invalid SSH identity file path.".into());
    }
    if entry.proxy_jump.as_deref()
        .map(|v| {
            v.trim().is_empty()
                || has_control(v)
                || v.chars().any(|c| c.is_whitespace() || c == '#' || c == '"' || c == '\'')
        })
        .unwrap_or(false)
    {
        return Err("Invalid ProxyJump value.".into());
    }

    if entry.port == Some(0) {
        return Err("SSH port must be between 1 and 65535.".into());
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
        block.push_str(&format!("    IdentityFile {}\n", format_config_value(id)));
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

    #[cfg(windows)]
    {
        // std::fs::rename cannot replace an existing destination on Windows.
        // Stage the old config and restore it if installing the new file fails.
        if config_path.exists() {
            let backup_path = ssh_dir.join(format!("config.{}.bak", uuid::Uuid::new_v4()));
            if let Err(error) = std::fs::rename(&config_path, &backup_path) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!(
                    "Failed to stage existing SSH config {}: {}",
                    config_path.display(), error
                ));
            }
            if let Err(error) = std::fs::rename(&temp_path, &config_path) {
                let restore_error = std::fs::rename(&backup_path, &config_path).err();
                let _ = std::fs::remove_file(&temp_path);
                return Err(match restore_error {
                    Some(restore) => format!(
                        "Failed to install SSH config: {}. Restoring the previous config also failed: {}",
                        error, restore
                    ),
                    None => format!(
                        "Failed to install SSH config; previous config restored: {}",
                        error
                    ),
                });
            }
            // The new config is installed; the backup is no longer needed.
            let _ = std::fs::remove_file(&backup_path);
        } else if let Err(error) = std::fs::rename(&temp_path, &config_path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("Failed to install SSH config {}: {}", config_path.display(), error));
        }
    }

    #[cfg(not(windows))]
    {
        if let Err(error) = std::fs::rename(&temp_path, &config_path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("Failed to atomically update {}: {}", config_path.display(), error));
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600));
    }

    log::info!("SSH Desktop: Successfully saved host '{}' to {}", entry.name, config_path.display());
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wildcard_host_options_do_not_leak_into_concrete_hosts() {
        let hosts = parse_ssh_config_content(
            "Host *.internal\\n    User wildcard-user\\nHost app-prod\\n    HostName 10.0.0.8\\n"
        );
        let app = hosts.iter().find(|host| host.name == "app-prod").unwrap();
        assert_eq!(app.user, None);
        assert_eq!(app.hostname, "10.0.0.8");
    }

    #[test]
    fn first_scalar_host_option_wins_like_openssh() {
        let hosts = parse_ssh_config_content(
            "Host app-prod\\n    User first-user\\n    User second-user\\n    HostName first.example.com\\n    HostName second.example.com\\n"
        );
        let app = hosts.iter().find(|host| host.name == "app-prod").unwrap();
        assert_eq!(app.user.as_deref(), Some("first-user"));
        assert_eq!(app.hostname, "first.example.com");
    }

    #[test]
    fn first_global_scalar_default_wins() {
        let hosts = parse_ssh_config_content(
            "User global-first\\nUser global-second\\nHost app-prod\\n    HostName app.example.com\\n"
        );
        let app = hosts.iter().find(|host| host.name == "app-prod").unwrap();
        assert_eq!(app.user.as_deref(), Some("global-first"));
    }
}


#[cfg(test)]
mod include_glob_tests {
    use super::wildcard_match;

    #[test]
    fn include_globs_support_single_character_wildcards() {
        assert!(wildcard_match("config?.conf", "config1.conf"));
        assert!(!wildcard_match("config?.conf", "config12.conf"));
        assert!(wildcard_match("hosts/*.conf", "hosts/prod.conf"));
        assert!(wildcard_match("hosts/?.conf", "hosts/é.conf"));
        assert!(!wildcard_match("hosts/?.conf", "hosts/prod.conf"));
    }
}
