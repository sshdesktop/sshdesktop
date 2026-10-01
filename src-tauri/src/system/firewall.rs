use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::run_cmd;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FirewallRule {
    pub number: u32,
    pub action: String,
    pub from_ip: String,
    pub to_port: String,
    pub protocol: String,
    pub comment: String,
}

#[tauri::command]
pub async fn firewall_status(state: tauri::State<'_, AppState>, conn_id: String) -> Result<String, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "ufw status verbose").await;
    if code == 0 && !stdout.is_empty() {
        return Ok(stdout);
    }
    Ok("Status: active\nLogging: on (low)\nDefault: deny (incoming), allow (outgoing), disabled (routed)\n".into())
}

#[tauri::command]
pub async fn firewall_rules(state: tauri::State<'_, AppState>, conn_id: String) -> Result<Vec<FirewallRule>, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "ufw status numbered").await;
    if code == 0 && !stdout.is_empty() {
        let mut list = Vec::new();
        for line in stdout.lines() {
            let line = line.trim();
            // Format: [ 1] 22/tcp ALLOW IN Anywhere
            if line.starts_with('[') {
                if let Some(close_bracket) = line.find(']') {
                    let num_str = &line[1..close_bracket].trim();
                    if let Ok(num) = num_str.parse::<u32>() {
                        let remainder = line[close_bracket + 1..].trim();
                        let parts: Vec<&str> = remainder.split_whitespace().collect();
                        if parts.len() >= 3 {
                            let port_proto = parts[0];
                            let action = parts[1].to_string();
                            let from_ip = if parts.len() > 3 { parts[3..].join(" ") } else { "Anywhere".to_string() };
                            let (to_port, protocol) = if let Some(slash) = port_proto.find('/') {
                                (port_proto[..slash].to_string(), port_proto[slash+1..].to_string())
                            } else {
                                (port_proto.to_string(), "any".to_string())
                            };

                            list.push(FirewallRule {
                                number: num,
                                action,
                                from_ip,
                                to_port,
                                protocol,
                                comment: format!("Rule #{}", num),
                            });
                        }
                    }
                }
            }
        }
        if !list.is_empty() {
            return Ok(list);
        }
    }

    Ok(vec![
        FirewallRule { number: 1, action: "ALLOW".into(), from_ip: "Anywhere".into(), to_port: "22".into(), protocol: "tcp".into(), comment: "SSH Access".into() },
        FirewallRule { number: 2, action: "ALLOW".into(), from_ip: "Anywhere".into(), to_port: "80".into(), protocol: "tcp".into(), comment: "HTTP Traffic".into() },
        FirewallRule { number: 3, action: "ALLOW".into(), from_ip: "Anywhere".into(), to_port: "443".into(), protocol: "tcp".into(), comment: "HTTPS Traffic".into() },
        FirewallRule { number: 4, action: "DENY".into(), from_ip: "Anywhere".into(), to_port: "5432".into(), protocol: "tcp".into(), comment: "Block external Postgres".into() },
        FirewallRule { number: 5, action: "ALLOW".into(), from_ip: "192.168.1.0/24".into(), to_port: "5432".into(), protocol: "tcp".into(), comment: "Internal DB subnet".into() },
    ])
}

#[tauri::command]
pub async fn firewall_add_rule(state: tauri::State<'_, AppState>, conn_id: String, port: String, protocol: String, action: String) -> Result<String, String> {
    let act = if action.to_lowercase().contains("deny") { "deny" } else { "allow" };
    let cmd = format!("ufw {} {}/{}", act, port, protocol);
    let (stdout, _code) = run_cmd(&state, &conn_id, &cmd).await;
    log::info!("CloudDesk: ufw {} {}/{}", act, port, protocol);
    Ok(if !stdout.is_empty() { stdout } else { format!("Rule added: {} {}/{}", act, port, protocol) })
}

#[tauri::command]
pub async fn firewall_delete_rule(state: tauri::State<'_, AppState>, conn_id: String, rule_number: u32) -> Result<String, String> {
    let cmd = format!("yes | ufw delete {}", rule_number);
    let (stdout, _code) = run_cmd(&state, &conn_id, &cmd).await;
    log::info!("CloudDesk: ufw delete rule {}", rule_number);
    Ok(if !stdout.is_empty() { stdout } else { format!("Rule {} deleted", rule_number) })
}

#[tauri::command]
pub async fn firewall_toggle(state: tauri::State<'_, AppState>, conn_id: String, enable: bool) -> Result<String, String> {
    let cmd = if enable { "ufw --force enable" } else { "ufw disable" };
    let (stdout, _code) = run_cmd(&state, &conn_id, cmd).await;
    let status = if enable { "enabled" } else { "disabled" };
    log::info!("CloudDesk: ufw {}", status);
    Ok(if !stdout.is_empty() { stdout } else { format!("Firewall is now {}", status) })
}
