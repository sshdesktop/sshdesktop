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
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        "systemctl list-units --type=service --all --no-pager --plain 2>/dev/null",
    ).await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    // Check if systemctl is actually available
    if stdout.contains("command not found") || stdout.contains("not found") {
        return Err("systemd not found on remote server. This feature requires a systemd-based Linux.".into());
    }

    let mut list = Vec::new();
    // Also fetch which services are 'enabled' via systemctl is-enabled in bulk
    // by querying list-unit-files
    let (enabled_out, _) = run_cmd(
        &state,
        &conn_id,
        "systemctl list-unit-files --type=service --no-pager --plain 2>/dev/null",
    ).await;

    let mut enabled_map: std::collections::HashMap<String, bool> = std::collections::HashMap::new();
    for line in enabled_out.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 && parts[0].ends_with(".service") {
            enabled_map.insert(
                parts[0].to_string(),
                matches!(parts[1], "enabled" | "enabled-runtime" | "static"),
            );
        }
    }

    for line in stdout.lines().skip(1) {
        let line = line.trim();
        // Stop at summary line
        if line.is_empty() || line.starts_with("LOAD") || line.starts_with("To show")
            || line.starts_with("Legend:") || line.starts_with("loaded units listed")
        {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 4 && parts[0].ends_with(".service") {
            let name        = parts[0].to_string();
            let load_state  = parts[1].to_string();
            let active_state = parts[2].to_string();
            let sub_state   = parts[3].to_string();
            let description = if parts.len() > 4 { parts[4..].join(" ") } else { name.clone() };
            let enabled     = *enabled_map.get(&name).unwrap_or(&false);

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

    log::info!("CloudDesk: systemctl {} {}", safe_action, name);
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
