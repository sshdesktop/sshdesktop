use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::{run_cmd, run_cmd_priv};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FirewallRule {
    pub id: String,
    pub number: u32,
    pub action: String,       // "ALLOW", "DENY", "REJECT", "LIMIT"
    pub direction: String,    // "IN", "OUT", "BOTH"
    pub from_ip: String,      // "Anywhere" or specific IP/CIDR
    pub to_port: String,      // "22", "80/tcp", "8000:8080"
    pub protocol: String,     // "tcp", "udp", "any"
    pub zone: Option<String>, // for firewalld
    pub comment: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FirewallStatusInfo {
    pub backend: String,              // "ufw", "firewalld", "iptables", "none"
    pub installed: bool,
    pub active: bool,
    pub ufw_installed: bool,
    pub ufw_active: bool,
    pub firewalld_installed: bool,
    pub firewalld_active: bool,
    pub default_incoming: String,
    pub default_outgoing: String,
    pub default_routed: String,
    pub active_zone: Option<String>,
    pub all_zones: Vec<String>,
    pub raw_status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AddRulePayload {
    pub port: String,
    pub protocol: String,
    pub action: String,
    pub direction: Option<String>,
    pub from_ip: Option<String>,
    pub backend: Option<String>,
    pub zone: Option<String>,
    pub comment: Option<String>,
}

/// Detect whether ufw or firewalld is available on the remote system.
pub async fn detect_firewall(state: &AppState, conn_id: &str) -> &'static str {
    let (out, _) = run_cmd(
        state,
        conn_id,
        "if command -v ufw >/dev/null 2>&1; then echo 'ufw'; elif command -v firewall-cmd >/dev/null 2>&1; then echo 'firewalld'; elif command -v iptables >/dev/null 2>&1; then echo 'iptables'; else echo 'none'; fi",
    ).await;
    let out = out.trim().to_lowercase();
    if out.contains("ufw") { return "ufw"; }
    if out.contains("firewalld") { return "firewalld"; }
    if out.contains("iptables") { return "iptables"; }
    "none"
}

#[tauri::command]
pub async fn firewall_detect_backend(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<FirewallStatusInfo, String> {
    let check_script = r#"
echo "---UFW_INSTALLED---"
command -v ufw >/dev/null 2>&1 && echo "yes" || echo "no"
echo "---FIREWALLD_INSTALLED---"
command -v firewall-cmd >/dev/null 2>&1 && echo "yes" || echo "no"
echo "---UFW_STATUS---"
ufw status verbose 2>/dev/null || echo "inactive"
echo "---FIREWALLD_STATUS---"
firewall-cmd --state 2>/dev/null || echo "not running"
echo "---FIREWALLD_ZONES---"
firewall-cmd --get-active-zones 2>/dev/null
echo "---ALL_ZONES---"
firewall-cmd --get-zones 2>/dev/null
"#;

    let (stdout, _) = run_cmd(&state, &conn_id, check_script).await;

    let mut ufw_installed = false;
    let mut firewalld_installed = false;
    let mut ufw_active = false;
    let mut firewalld_active = false;
    let mut default_incoming = "deny".to_string();
    let mut default_outgoing = "allow".to_string();
    let mut default_routed = "disabled".to_string();
    let mut active_zone: Option<String> = None;
    let mut all_zones: Vec<String> = Vec::new();
    let mut raw_status = String::new();

    let sections: Vec<&str> = stdout.split("---").collect();
    for i in 0..sections.len() {
        let sec_name = sections[i].trim();
        let sec_content = sections.get(i + 1).map(|s| s.trim()).unwrap_or("");

        if sec_name.starts_with("UFW_INSTALLED") {
            ufw_installed = sec_content.starts_with("yes");
        } else if sec_name.starts_with("FIREWALLD_INSTALLED") {
            firewalld_installed = sec_content.starts_with("yes");
        } else if sec_name.starts_with("UFW_STATUS") {
            raw_status = sec_content.to_string();
            if sec_content.to_lowercase().contains("status: active") {
                ufw_active = true;
            }
            // Parse defaults: Default: deny (incoming), allow (outgoing), disabled (routed)
            if let Some(def_idx) = sec_content.find("Default:") {
                let def_line = sec_content[def_idx..].lines().next().unwrap_or("");
                if def_line.contains("incoming") {
                    if def_line.contains("allow (incoming)") { default_incoming = "allow".to_string(); }
                    else if def_line.contains("reject (incoming)") { default_incoming = "reject".to_string(); }
                    else { default_incoming = "deny".to_string(); }
                }
                if def_line.contains("outgoing") {
                    if def_line.contains("deny (outgoing)") { default_outgoing = "deny".to_string(); }
                    else { default_outgoing = "allow".to_string(); }
                }
                if def_line.contains("routed") {
                    if def_line.contains("allow (routed)") { default_routed = "allow".to_string(); }
                    else if def_line.contains("deny (routed)") { default_routed = "deny".to_string(); }
                }
            }
        } else if sec_name.starts_with("FIREWALLD_STATUS") {
            if sec_content.trim() == "running" {
                firewalld_active = true;
            }
        } else if sec_name.starts_with("FIREWALLD_ZONES") {
            for line in sec_content.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() && !trimmed.starts_with("interfaces:") && !trimmed.starts_with("sources:") {
                    active_zone = Some(trimmed.to_string());
                    break;
                }
            }
        } else if sec_name.starts_with("ALL_ZONES") {
            for z in sec_content.split_whitespace() {
                all_zones.push(z.to_string());
            }
        }
    }

    let installed = ufw_installed || firewalld_installed;
    let active = ufw_active || firewalld_active;

    let backend = if firewalld_active {
        "firewalld".to_string()
    } else if ufw_active {
        "ufw".to_string()
    } else if ufw_installed {
        "ufw".to_string()
    } else if firewalld_installed {
        "firewalld".to_string()
    } else {
        "none".to_string()
    };

    Ok(FirewallStatusInfo {
        backend,
        installed,
        active,
        ufw_installed,
        ufw_active,
        firewalld_installed,
        firewalld_active,
        default_incoming,
        default_outgoing,
        default_routed,
        active_zone,
        all_zones,
        raw_status,
    })
}

#[tauri::command]
pub async fn firewall_status(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
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

    // If user lacks privileges to query firewall rules, gracefully return empty list so the rest of the application loads
    if code != 0 && (stdout.contains("Permission Denied") || stdout.contains("need to be root") || stdout.contains("permission denied") || stdout.contains("You need to be root")) {
        log::warn!("SSH Desktop: firewall_rules inaccessible for non-sudo user, returning empty rule list gracefully");
        return Ok(vec![]);
    }

    let mut list = Vec::new();

    match fw {
        "ufw" => {
            for line in stdout.lines() {
                let line = line.trim();
                // Format: [ 1] 22/tcp                     ALLOW IN    Anywhere
                // Format: [ 2] 80                         ALLOW IN    192.168.1.0/24   # Web
                if line.starts_with('[') {
                    if let Some(close) = line.find(']') {
                        let num_str = line[1..close].trim();
                        if let Ok(num) = num_str.parse::<u32>() {
                            let rest = line[close + 1..].trim();
                            let parts: Vec<&str> = rest.split_whitespace().collect();
                            if parts.len() >= 2 {
                                let port_proto = parts[0];
                                let action = parts[1].to_uppercase();
                                let direction = if parts.len() > 2 && (parts[2].eq_ignore_ascii_case("IN") || parts[2].eq_ignore_ascii_case("OUT")) {
                                    parts[2].to_uppercase()
                                } else {
                                    "IN".to_string()
                                };

                                let from_start = if parts.len() > 2 && (parts[2].eq_ignore_ascii_case("IN") || parts[2].eq_ignore_ascii_case("OUT")) { 3 } else { 2 };
                                let from_ip = if parts.len() > from_start {
                                    parts[from_start..].join(" ")
                                } else {
                                    "Anywhere".to_string()
                                };

                                let (to_port, protocol) = if let Some(sl) = port_proto.find('/') {
                                    (port_proto[..sl].to_string(), port_proto[sl + 1..].to_string())
                                } else {
                                    (port_proto.to_string(), "any".to_string())
                                };

                                list.push(FirewallRule {
                                    id: format!("ufw-{}", num),
                                    number: num,
                                    action,
                                    direction,
                                    from_ip,
                                    to_port,
                                    protocol,
                                    zone: None,
                                    comment: format!("UFW Rule #{}", num),
                                });
                            }
                        }
                    }
                }
            }
        }
        "firewalld" => {
            let mut rule_num = 1;
            let mut current_zone: Option<String> = None;
            for line in stdout.lines() {
                let line = line.trim();
                if line.contains("(active)") {
                    current_zone = line.split_whitespace().next().map(|s| s.to_string());
                } else if line.starts_with("ports:") {
                    let items = line.split(':').nth(1).unwrap_or("").trim();
                    for item in items.split_whitespace() {
                        let (port, proto) = if let Some(sl) = item.find('/') {
                            (item[..sl].to_string(), item[sl + 1..].to_string())
                        } else {
                            (item.to_string(), "tcp".to_string())
                        };
                        list.push(FirewallRule {
                            id: format!("fwd-port-{}", rule_num),
                            number: rule_num,
                            action: "ALLOW".to_string(),
                            direction: "IN".to_string(),
                            from_ip: "Anywhere".to_string(),
                            to_port: port,
                            protocol: proto,
                            zone: current_zone.clone(),
                            comment: "Firewalld Port Rule".to_string(),
                        });
                        rule_num += 1;
                    }
                } else if line.starts_with("services:") {
                    let items = line.split(':').nth(1).unwrap_or("").trim();
                    for item in items.split_whitespace() {
                        list.push(FirewallRule {
                            id: format!("fwd-srv-{}", rule_num),
                            number: rule_num,
                            action: "ALLOW".to_string(),
                            direction: "IN".to_string(),
                            from_ip: "Anywhere".to_string(),
                            to_port: item.to_string(),
                            protocol: "service".to_string(),
                            zone: current_zone.clone(),
                            comment: format!("Firewalld Service ({})", item),
                        });
                        rule_num += 1;
                    }
                }
            }
        }
        _ => {
            // iptables
            for line in stdout.lines().skip(2) {
                let line = line.trim();
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 6 {
                    if let Ok(n) = parts[0].parse::<u32>() {
                        let action   = parts[1].to_uppercase();
                        let protocol = parts[2].to_lowercase();
                        let from_ip  = parts[4].to_string();
                        let to_port  = parts.iter()
                            .find(|s| s.starts_with("dpt:"))
                            .map(|s| s.trim_start_matches("dpt:").to_string())
                            .unwrap_or_else(|| "any".to_string());

                        list.push(FirewallRule {
                            id: format!("ipt-{}", n),
                            number: n,
                            action,
                            direction: "IN".to_string(),
                            from_ip,
                            to_port,
                            protocol,
                            zone: None,
                            comment: format!("iptables rule #{}", n),
                        });
                    }
                }
            }
        }
    }

    Ok(list)
}

#[tauri::command]
pub async fn firewall_add_rule_advanced(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    payload: AddRulePayload,
) -> Result<String, String> {
    let port = payload.port.trim();
    if port.is_empty() {
        return Err("Port or service cannot be empty.".to_string());
    }

    let proto = match payload.protocol.to_lowercase().as_str() {
        "tcp" => "tcp",
        "udp" => "udp",
        _ => "any",
    };

    let action = match payload.action.to_lowercase().as_str() {
        "allow" | "permit" => "allow",
        "deny" | "block" => "deny",
        "reject" => "reject",
        "limit" => "limit",
        _ => "allow",
    };

    let direction = payload.direction.as_deref().unwrap_or("in").to_lowercase();
    let from_ip = payload.from_ip.as_deref().unwrap_or("").trim();
    let backend_choice = payload.backend.as_deref();
    let fw = if let Some(b) = backend_choice {
        if b == "firewalld" { "firewalld" } else { "ufw" }
    } else {
        detect_firewall(&state, &conn_id).await
    };

    let cmd = match fw {
        "firewalld" => {
            let zone_flag = if let Some(ref z) = payload.zone {
                if !z.trim().is_empty() { format!("--zone={}", z.trim()) } else { String::new() }
            } else {
                String::new()
            };

            // Check if port is numeric / range vs service name
            let is_numeric = port.chars().any(|c| c.is_ascii_digit());
            if is_numeric {
                let p_arg = if proto == "any" { format!("{}/tcp", port) } else { format!("{}/{}", port, proto) };
                if action == "allow" {
                    format!("firewall-cmd --permanent {} --add-port={} 2>&1 && firewall-cmd --reload 2>&1", zone_flag, p_arg)
                } else {
                    format!("firewall-cmd --permanent {} --remove-port={} 2>&1 && firewall-cmd --reload 2>&1", zone_flag, p_arg)
                }
            } else {
                // Service name
                if action == "allow" {
                    format!("firewall-cmd --permanent {} --add-service={} 2>&1 && firewall-cmd --reload 2>&1", zone_flag, port)
                } else {
                    format!("firewall-cmd --permanent {} --remove-service={} 2>&1 && firewall-cmd --reload 2>&1", zone_flag, port)
                }
            }
        }
        "ufw" => {
            let mut ufw_cmd = format!("ufw {}", action);
            if direction == "out" {
                ufw_cmd.push_str(" out");
            }
            if !from_ip.is_empty() && !from_ip.eq_ignore_ascii_case("anywhere") && !from_ip.eq_ignore_ascii_case("any") {
                ufw_cmd.push_str(&format!(" from {} to any port {}", from_ip, port));
                if proto != "any" {
                    ufw_cmd.push_str(&format!(" proto {}", proto));
                }
            } else {
                if proto != "any" {
                    ufw_cmd.push_str(&format!(" {}/{}", port, proto));
                } else {
                    ufw_cmd.push_str(&format!(" {}", port));
                }
            }
            if let Some(ref c) = payload.comment {
                if !c.trim().is_empty() {
                    ufw_cmd.push_str(&format!(" comment '{}'", c.trim().replace('\'', "")));
                }
            }
            format!("{} 2>&1", ufw_cmd)
        }
        _ => {
            format!(
                "iptables -A INPUT -p {} --dport {} -j {} 2>&1",
                if proto == "any" { "tcp" } else { proto },
                port,
                if action == "allow" { "ACCEPT" } else { "DROP" }
            )
        }
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code != 0 && !stdout.is_empty() && !stdout.contains("ALREADY_ENABLED") && !stdout.contains("Rule added") {
        return Err(format!("Failed to add rule (code {}): {}", code, stdout.trim()));
    }

    Ok(format!("Rule successfully added: {} {} {}", action.to_uppercase(), port, proto))
}

#[tauri::command]
pub async fn firewall_add_rule(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    port: String,
    protocol: String,
    action: String,
) -> Result<String, String> {
    firewall_add_rule_advanced(state, conn_id, AddRulePayload {
        port,
        protocol,
        action,
        direction: Some("in".to_string()),
        from_ip: None,
        backend: None,
        zone: None,
        comment: None,
    }).await
}

#[tauri::command]
pub async fn firewall_delete_rule_advanced(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    rule_number: u32,
    port: Option<String>,
    protocol: Option<String>,
    backend: Option<String>,
    zone: Option<String>,
) -> Result<String, String> {
    let fw = if let Some(b) = backend {
        if b == "firewalld" { "firewalld" } else { "ufw" }
    } else {
        detect_firewall(&state, &conn_id).await
    };

    let cmd = match fw {
        "firewalld" => {
            let zone_flag = if let Some(ref z) = zone {
                if !z.trim().is_empty() { format!("--zone={}", z.trim()) } else { String::new() }
            } else {
                String::new()
            };
            if let Some(ref p) = port {
                let proto = protocol.as_deref().unwrap_or("tcp");
                if p.chars().any(|c| c.is_ascii_digit()) {
                    format!("firewall-cmd --permanent {} --remove-port={}/{} 2>&1; firewall-cmd --reload 2>&1", zone_flag, p, proto)
                } else {
                    format!("firewall-cmd --permanent {} --remove-service={} 2>&1; firewall-cmd --reload 2>&1", zone_flag, p)
                }
            } else {
                return Err("Port or service name is required to delete a firewalld rule.".into());
            }
        }
        "ufw" => {
            format!("echo y | ufw delete {} 2>&1", rule_number)
        }
        _ => {
            format!("iptables -D INPUT {} 2>&1", rule_number)
        }
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code != 0 && !stdout.is_empty() {
        return Err(format!("Rule delete failed: {}", stdout.trim()));
    }

    Ok("Firewall rule successfully deleted.".to_string())
}

#[tauri::command]
pub async fn firewall_delete_rule(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    rule_number: u32,
) -> Result<String, String> {
    firewall_delete_rule_advanced(state, conn_id, rule_number, None, None, None, None).await
}

#[tauri::command]
pub async fn firewall_toggle(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    enable: bool,
) -> Result<String, String> {
    let fw = detect_firewall(&state, &conn_id).await;
    let cmd = match (fw, enable) {
        ("ufw", true)        => "ufw --force enable 2>&1",
        ("ufw", false)       => "ufw disable 2>&1",
        ("firewalld", true)  => "systemctl enable --now firewalld 2>&1",
        ("firewalld", false) => "systemctl stop firewalld 2>&1",
        (_, true)            => "systemctl start iptables 2>&1",
        (_, false)           => "systemctl stop iptables 2>&1",
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    let status = if enable { "enabled" } else { "disabled" };
    Ok(if !stdout.is_empty() { stdout } else { format!("Firewall is now {}.", status) })
}

#[tauri::command]
pub async fn firewall_install(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    tool: String, // "ufw" or "firewalld"
) -> Result<String, String> {
    let tool_name = tool.trim().to_lowercase();
    let install_cmd = format!(
        "if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y {}; elif command -v dnf >/dev/null 2>&1; then dnf install -y {}; elif command -v yum >/dev/null 2>&1; then yum install -y {}; elif command -v pacman >/dev/null 2>&1; then pacman -Sy --noconfirm {}; else echo 'Package manager not supported'; exit 1; fi",
        tool_name, tool_name, tool_name, tool_name
    );

    let (stdout, code) = run_cmd_priv(&state, &conn_id, &install_cmd).await;
    if code != 0 {
        return Err(format!("Installation of {} failed (code {}): {}", tool_name, code, stdout.trim()));
    }

    // If firewalld was installed, enable service
    if tool_name == "firewalld" {
        let _ = run_cmd_priv(&state, &conn_id, "systemctl enable --now firewalld 2>/dev/null || true").await;
    }

    Ok(format!("{} installed successfully!", tool_name.to_uppercase()))
}

#[tauri::command]
pub async fn firewall_set_default_policy(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    direction: String, // "incoming" or "outgoing"
    policy: String,    // "allow" or "deny"
) -> Result<String, String> {
    let dir = direction.trim().to_lowercase();
    let pol = policy.trim().to_lowercase();
    let cmd = format!("ufw default {} {} 2>&1", pol, dir);
    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code != 0 {
        return Err(format!("Failed to set default policy: {}", stdout.trim()));
    }
    Ok(format!("Default policy for {} set to {}", dir, pol.to_uppercase()))
}

#[tauri::command]
pub async fn firewall_reset(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    let cmd = "echo y | ufw reset 2>&1";
    let (stdout, code) = run_cmd_priv(&state, &conn_id, cmd).await;
    if code != 0 {
        return Err(format!("Failed to reset firewall: {}", stdout.trim()));
    }
    Ok("Firewall reset to default state.".to_string())
}

#[tauri::command]
pub async fn firewall_reload(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    let fw = detect_firewall(&state, &conn_id).await;
    let cmd = match fw {
        "firewalld" => "firewall-cmd --reload 2>&1",
        _ => "ufw reload 2>&1",
    };
    let (stdout, code) = run_cmd_priv(&state, &conn_id, cmd).await;
    if code != 0 {
        return Err(format!("Failed to reload firewall: {}", stdout.trim()));
    }
    Ok("Firewall rules reloaded successfully.".to_string())
}
