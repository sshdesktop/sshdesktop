use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::system::monitor::NetworkInterface;
use crate::ssh::exec::run_cmd;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ListeningPort {
    pub protocol: String,
    pub local_addr: String,
    pub local_port: u16,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActiveConnection {
    pub protocol: String,
    pub local_addr: String,
    pub remote_addr: String,
    pub state: String,
    pub pid: Option<u32>,
}

#[tauri::command]
pub async fn network_ports(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<ListeningPort>, String> {
    // ss -tlnpH: TCP listening, numeric, processes, no header
    let (stdout, code) = run_cmd(&state, &conn_id, "ss -tlnp 2>/dev/null").await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // Format: Netid State Recv-Q Send-Q Local:Port Peer:Port [Process]
        if parts.len() < 5 { continue; }

        let local = parts[3]; // "0.0.0.0:22" or "[::]:22"
        if let Some(c_idx) = local.rfind(':') {
            let addr = &local[..c_idx];
            let port_str = &local[c_idx + 1..];
            if let Ok(port) = port_str.parse::<u16>() {
                // Parse process info: users:(("sshd",pid=1042,fd=3))
                let proc_raw = if parts.len() > 5 { parts[5..].join(" ") } else { String::new() };
                let (pid, name) = parse_ss_process(&proc_raw);

                list.push(ListeningPort {
                    protocol: parts[0].to_string(),
                    local_addr: addr.trim_matches('[').trim_matches(']').to_string(),
                    local_port: port,
                    pid,
                    process_name: name,
                });
            }
        }
    }

    if list.is_empty() {
        return Err("No listening port data returned from remote server.".into());
    }

    Ok(list)
}

/// Parse `users:(("sshd",pid=1042,fd=3))` → (Some(1042), Some("sshd"))
fn parse_ss_process(proc_str: &str) -> (Option<u32>, Option<String>) {
    if proc_str.is_empty() {
        return (None, None);
    }
    // Extract name: first quoted string
    let name = if let Some(start) = proc_str.find('"') {
        let after = &proc_str[start + 1..];
        after.find('"').map(|end| after[..end].to_string())
    } else {
        None
    };

    // Extract pid=NNNN
    let pid = proc_str.split(',')
        .find(|s| s.trim_start().starts_with("pid="))
        .and_then(|s| s.trim_start_matches("pid=").trim().parse::<u32>().ok());

    (pid, name)
}

#[tauri::command]
pub async fn network_connections(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<ActiveConnection>, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "ss -tnp state established 2>/dev/null").await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // Netid Recv-Q Send-Q Local Peer Process?
        if parts.len() >= 5 {
            let proc_raw = if parts.len() > 5 { parts[5..].join(" ") } else { String::new() };
            let (pid, _) = parse_ss_process(&proc_raw);

            list.push(ActiveConnection {
                protocol: "TCP".into(),
                local_addr: parts[3].to_string(),
                remote_addr: parts[4].to_string(),
                state: "ESTABLISHED".into(),
                pid,
            });
        }
    }

    if list.is_empty() {
        // Empty established connections is valid (no active connections)
        return Ok(vec![]);
    }

    Ok(list)
}

#[tauri::command]
pub async fn network_interfaces(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<NetworkInterface>, String> {
    crate::system::monitor::system_get_network(state, conn_id).await
}

#[tauri::command]
pub async fn network_ping(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    host: String,
) -> Result<String, String> {
    // Validate host (no shell metacharacters)
    if host.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')' | '<' | '>')) {
        return Err(format!("Invalid host: {}", host));
    }

    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        &format!("ping -c 4 -W 3 '{}' 2>&1", host),
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Err(format!("ping to '{}' returned no output.", host))
}

#[tauri::command]
pub async fn network_dns_lookup(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    domain: String,
) -> Result<String, String> {
    if domain.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')' | '<' | '>')) {
        return Err(format!("Invalid domain: {}", domain));
    }

    // Try dig first, fall back to host, then nslookup
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        &format!("dig +noall +answer +comments '{}' 2>/dev/null || host '{}' 2>/dev/null || nslookup '{}' 2>&1", domain, domain, domain),
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Err(format!("DNS lookup for '{}' returned no results.", domain))
}
