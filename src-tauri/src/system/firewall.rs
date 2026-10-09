use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::{run_cmd, run_cmd_priv};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FirewallRule {
    pub number: u32,
    pub action: String,
    pub from_ip: String,
    pub to_port: String,
    pub protocol: String,
    pub comment: String,
}

/// Detect whether ufw or firewalld is available on the remote system.
async fn detect_firewall(state: &AppState, conn_id: &str) -> &'static str {
    let (out, _) = run_cmd(
        state,
        conn_id,
        "command -v ufw firewall-cmd iptables 2>/dev/null | head -n 1",
    ).await;
    let out = out.trim().to_lowercase();
    if out.contains("ufw") { return "ufw"; }
    if out.contains("firewall-cmd") { return "firewalld"; }
    "iptables"
}

#[tauri::command]
pub async fn firewall_status(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    if firewall_status_inner(&state, &conn_id).await.is_err() {}
    let fw = detect_firewall(&state, &conn_id).await;

    let cmd = match fw {
        "ufw"       => "ufw status verbose 2>&1",
        "firewalld" => "firewall-cmd --state 2>&1 && firewall-cmd --list-all 2>&1",
        _           => "iptables -L -n 2>&1 | head -n 40",
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Err("Could not determine firewall status.".into())
}

async fn firewall_status_inner(_state: &AppState, _conn_id: &str) -> Result<(), ()> {
    Ok(()) // placeholder
}

#[tauri::command]
pub async fn firewall_rules(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<FirewallRule>, String> {
    let fw = detect_firewall(&state, &conn_id).await;

    let (stdout, code) = match fw {
        "ufw" => run_cmd_priv(&state, &conn_id, "ufw status numbered 2>&1").await,
        "firewalld" => run_cmd_priv(&state, &conn_id, "firewall-cmd --list-all 2>&1").await,
        _ => run_cmd_priv(&state, &conn_id, "iptables -L INPUT -n --line-numbers 2>&1").await,
    };

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();

    match fw {
        "ufw" => {
            for line in stdout.lines() {
                let line = line.trim();
                // Format: [ 1] 22/tcp   ALLOW IN    Anywhere
                if line.starts_with('[') {
                    if let Some(close) = line.find(']') {
                        let num_str = line[1..close].trim();
                        if let Ok(num) = num_str.parse::<u32>() {
                            let rest = line[close + 1..].trim();
                            let parts: Vec<&str> = rest.split_whitespace().collect();
                            if parts.len() >= 2 {
                                let port_proto = parts[0];
                                let action = parts[1].to_string();
                                let from_ip = if parts.len() > 3 {
                                    parts[3..].join(" ")
                                } else {
                                    "Anywhere".to_string()
                                };
                                let (to_port, protocol) = if let Some(sl) = port_proto.find('/') {
                                    (port_proto[..sl].to_string(), port_proto[sl + 1..].to_string())
                                } else {
                                    (port_proto.to_string(), "any".to_string())
                                };

                                list.push(FirewallRule {
                                    number: num,
                                    action,
                                    from_ip,
                                    to_port,
                                    protocol,
                                    comment: format!("ufw rule #{}", num),
                                });
                            }
                        }
                    }
                }
            }
        }
        "firewalld" => {
            // Parse firewall-cmd --list-all output
            let mut rule_num = 1;
            for line in stdout.lines() {
                let line = line.trim();
                if line.starts_with("ports:") || line.starts_with("services:") {
                    let items = line.split(':').nth(1).unwrap_or("").trim();
                    for item in items.split_whitespace() {
                        let (port, proto) = if let Some(sl) = item.find('/') {
                            (item[..sl].to_string(), item[sl + 1..].to_string())
                        } else {
                            (item.to_string(), "tcp".to_string())
                        };
                        list.push(FirewallRule {
                            number: rule_num,
                            action: "ALLOW".to_string(),
                            from_ip: "Anywhere".to_string(),
                            to_port: port,
                            protocol: proto,
                            comment: "firewalld rule".to_string(),
                        });
                        rule_num += 1;
                    }
                }
            }
        }
        _ => {
            // iptables --line-numbers
            for line in stdout.lines().skip(2) {
                let line = line.trim();
                let parts: Vec<&str> = line.split_whitespace().collect();
                // num target prot opt source destination [dpt:PORT]
                if parts.len() >= 6 {
                    if let Ok(n) = parts[0].parse::<u32>() {
                        let action   = parts[1].to_string();
                        let protocol = parts[2].to_string();
                        let from_ip  = parts[4].to_string();
                        let to_port  = parts.iter()
                            .find(|s| s.starts_with("dpt:"))
                            .map(|s| s.trim_start_matches("dpt:").to_string())
                            .unwrap_or_else(|| "any".to_string());

                        list.push(FirewallRule {
                            number: n,
                            action,
                            from_ip,
                            to_port,
                            protocol,
                            comment: format!("iptables rule #{}", n),
                        });
                    }
                }
            }
        }
    }

    if list.is_empty() {
        return Err("No firewall rules found, or firewall is not configured.".into());
    }

    Ok(list)
}

#[tauri::command]
pub async fn firewall_add_rule(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    port: String,
    protocol: String,
    action: String,
) -> Result<String, String> {
    // Validate port (numeric or service name)
    if port.chars().any(|c| !c.is_alphanumeric() && c != '-') {
        return Err("Invalid port.".into());
    }
    // Validate protocol
    let safe_proto = match protocol.to_lowercase().as_str() {
        "tcp"  => "tcp",
        "udp"  => "udp",
        "any" | "both" => "any",
        _ => return Err(format!("Invalid protocol: {}", protocol)),
    };
    // Validate action
    let safe_act = match action.to_lowercase().as_str() {
        "allow" | "permit" => "allow",
        "deny"  | "block"  => "deny",
        _ => return Err(format!("Invalid action: {}", action)),
    };

    let fw = detect_firewall(&state, &conn_id).await;
    let cmd = match fw {
        "ufw" => if safe_proto == "any" {
            format!("ufw {} {} 2>&1", safe_act, port)
        } else {
            format!("ufw {} {}/{} 2>&1", safe_act, port, safe_proto)
        },
        "firewalld" if safe_act == "allow" => format!(
            "firewall-cmd --permanent --add-port={}/{} 2>&1 && firewall-cmd --reload 2>&1",
            port, safe_proto
        ),
        "firewalld" => format!(
            "firewall-cmd --permanent --remove-port={}/{} 2>&1 && firewall-cmd --reload 2>&1",
            port, safe_proto
        ),
        _ => format!(
            "iptables -A INPUT -p {} --dport {} -j {} 2>&1",
            if safe_proto == "any" { "tcp" } else { safe_proto },
            port,
            if safe_act == "allow" { "ACCEPT" } else { "DROP" }
        ),
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("Firewall rule add failed: {}", stdout.trim()));
    }

    log::info!("CloudDesk: Added firewall rule: {} {} {}", safe_act, port, safe_proto);
    Ok(format!("Rule added: {} {} {}", safe_act, port, safe_proto))
}

#[tauri::command]
pub async fn firewall_delete_rule(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    rule_number: u32,
) -> Result<String, String> {
    if rule_number == 0 {
        return Err("Invalid rule number.".into());
    }

    let fw = detect_firewall(&state, &conn_id).await;
    let cmd = match fw {
        "ufw" => format!("echo y | ufw delete {} 2>&1", rule_number),
        _ => format!("iptables -D INPUT {} 2>&1", rule_number),
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("Firewall rule delete failed: {}", stdout.trim()));
    }

    log::info!("CloudDesk: Deleted firewall rule {}", rule_number);
    Ok(format!("Rule {} deleted.", rule_number))
}

#[tauri::command]
pub async fn firewall_toggle(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    enable: bool,
) -> Result<String, String> {
    let fw = detect_firewall(&state, &conn_id).await;
    let cmd = match (fw, enable) {
        ("ufw", true)       => "ufw --force enable 2>&1",
        ("ufw", false)      => "ufw disable 2>&1",
        ("firewalld", true) => "systemctl start firewalld 2>&1",
        ("firewalld", false)=> "systemctl stop firewalld 2>&1",
        (_, true)           => "systemctl start iptables 2>&1",
        (_, false)          => "systemctl stop iptables 2>&1",
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    let status = if enable { "enabled" } else { "disabled" };
    log::info!("CloudDesk: Firewall {}", status);
    Ok(if !stdout.is_empty() { stdout } else { format!("Firewall is now {}.", status) })
}
