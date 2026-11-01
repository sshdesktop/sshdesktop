use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::{run_cmd, run_cmd_priv};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServiceInfo {
    pub name: String,
    pub description: String,
    pub load_state: String,
    pub active_state: String,
    pub sub_state: String,
    pub enabled: bool,
}

#[tauri::command]
pub async fn service_list(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<ServiceInfo>, String> {
    let (combined_out, code) = run_cmd(
        &state,
        &conn_id,
        "systemctl daemon-reload 2>/dev/null; systemctl list-units --type=service --all --no-pager --plain 2>/dev/null; echo '---FILES---'; systemctl list-unit-files --type=service --all --no-pager --plain 2>/dev/null",
    ).await;

    if code == -1 && combined_out.is_empty() {
        return Err("No active SSH connection.".into());
    }

    // Check if systemctl is actually available
    if combined_out.contains("command not found") || combined_out.contains("not found") {
        return Err("systemd not found on remote server. This feature requires a systemd-based Linux.".into());
    }

    let mut parts_split = combined_out.split("---FILES---");
    let units_out = parts_split.next().unwrap_or("");
    let files_out = parts_split.next().unwrap_or("");

    let mut files_map: std::collections::HashMap<String, (bool, String)> = std::collections::HashMap::new();
    for line in files_out.lines().skip(1) {
        let p: Vec<&str> = line.split_whitespace().collect();
        if p.len() >= 2 && p[0].ends_with(".service") {
            let is_enabled = matches!(p[1], "enabled" | "enabled-runtime" | "static");
            files_map.insert(p[0].to_string(), (is_enabled, p[1].to_string()));
        }
    }

    let mut list = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in units_out.lines().skip(1) {
        let line = line.trim();
        // Stop at summary line
        if line.is_empty()
            || line.starts_with("LOAD")
            || line.starts_with("To show")
            || line.starts_with("Legend:")
            || line.starts_with("loaded units listed")
        {
            continue;
        }
        let mut p: Vec<&str> = line.split_whitespace().collect();
        if p.first().copied() == Some("●") || p.first().copied() == Some("*") {
            p.remove(0);
        }
        if p.len() >= 4 && p[0].ends_with(".service") {
            let name        = p[0].to_string();
            seen.insert(name.clone());
            let load_state  = p[1].to_string();
            let active_state = p[2].to_string();
            let sub_state   = p[3].to_string();
            let description = if p.len() > 4 { p[4..].join(" ") } else { name.clone() };
            let enabled     = files_map.get(&name).map(|(en, _)| *en).unwrap_or(false);

            list.push(ServiceInfo {
                name,
                description,
                load_state,
                active_state,
                sub_state,
                enabled,
            });
        }
    }

    // Include all installed service unit files from disk that are not yet loaded in systemd memory (e.g. newly installed packages)
    for (name, (is_enabled, state_str)) in &files_map {
        if !seen.contains(name) && !name.contains("@.") && state_str != "alias" {
            seen.insert(name.clone());
            let clean_desc = name.trim_end_matches(".service").to_string();
            list.push(ServiceInfo {
                name: name.clone(),
                description: clean_desc,
                load_state: "loaded".to_string(),
                active_state: "inactive".to_string(),
                sub_state: "dead".to_string(),
                enabled: *is_enabled,
            });
        }
    }

    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    if list.is_empty() {
        return Err("No services found. Ensure systemd is running on the remote server.".into());
    }

    Ok(list)
}

#[tauri::command]
pub async fn service_action(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    name: String,
    action: String,
) -> Result<String, String> {
    // Validate action
    let safe_action = match action.as_str() {
        "start" | "stop" | "restart" | "reload" | "enable" | "disable"
        | "mask" | "unmask" => action.as_str(),
        _ => return Err(format!("Invalid service action: {}", action)),
    };

    // Validate service name (no shell metacharacters)
    if name.chars().any(|c| matches!(c, '&' | ';' | '|' | '`' | '$' | '(' | ')' | '<' | '>')) {
        return Err("Invalid service name.".into());
    }

    let (stdout, code) = run_cmd_priv(
        &state,
        &conn_id,
        &format!("systemctl {} {} 2>&1", safe_action, name),
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("systemctl {} {} failed: {}", safe_action, name, stdout.trim()));
    }

    log::info!("SSH Desktop: systemctl {} {}", safe_action, name);
    Ok(format!("Service '{}' {}", name, safe_action))
}

#[tauri::command]
pub async fn service_status(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    name: String,
) -> Result<String, String> {
    if name.chars().any(|c| matches!(c, '&' | ';' | '|' | '`' | '$' | '(' | ')' | '<' | '>')) {
        return Err("Invalid service name.".into());
    }

    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        &format!("systemctl status {} --no-pager 2>&1", name),
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    // systemctl status returns exit 3 for inactive services — still valid output
    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Err(format!("Could not get status for service '{}'", name))
}

#[tauri::command]
pub async fn service_logs(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    name: String,
    lines: u32,
) -> Result<String, String> {
    if name.chars().any(|c| matches!(c, '&' | ';' | '|' | '`' | '$' | '(' | ')' | '<' | '>')) {
        return Err("Invalid service name.".into());
    }

    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        &format!("journalctl -u {} -n {} --no-pager 2>&1", name, lines.min(1000)),
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Err(format!("No journal logs found for service '{}'", name))
}
