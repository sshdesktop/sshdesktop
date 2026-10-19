use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BandwidthStat {
    pub name: String,
    pub ip: String,
    pub mac: String,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
    pub rx_packets: u64,
    pub tx_packets: u64,
    pub rx_errors: u64,
    pub tx_errors: u64,
    pub rx_drops: u64,
    pub tx_drops: u64,
    pub rx_speed_bps: f64, // bytes / second
    pub tx_speed_bps: f64, // bytes / second
    pub operstate: String, // "up", "down", "unknown"
    pub mtu: Option<u32>,
    pub speed_mbit: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NetworkBandwidthSummary {
    pub total_rx_bytes: u64,
    pub total_tx_bytes: u64,
    pub total_rx_speed_bps: f64,
    pub total_tx_speed_bps: f64,
    pub total_rx_packets: u64,
    pub total_tx_packets: u64,
    pub interfaces: Vec<BandwidthStat>,
    pub timestamp: u64,
}

#[tauri::command]
pub async fn network_ports(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<ListeningPort>, String> {
    // ss -tunlp: TCP & UDP listening, numeric, processes, no header
    let (stdout, code) = run_cmd(&state, &conn_id, "ss -tunlp 2>/dev/null || ss -tlnp 2>/dev/null").await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        // Format: Netid State Recv-Q Send-Q Local:Port Peer:Port [Process]
        if parts.len() < 5 { continue; }

        let protocol = parts[0].to_lowercase();
        let local = parts[4]; // "0.0.0.0:22" or "[::]:22" or parts[3] depending on Netid column
        
        // Find which column has the local:port
        let local_col = if local.contains(':') {
            local
        } else if parts.len() > 3 && parts[3].contains(':') {
            parts[3]
        } else {
            continue;
        };

        if let Some(c_idx) = local_col.rfind(':') {
            let addr = &local_col[..c_idx];
            let port_str = &local_col[c_idx + 1..];
            if let Ok(port) = port_str.parse::<u16>() {
                // Parse process info: users:(("sshd",pid=1042,fd=3))
                let proc_raw = parts.iter().skip(5).cloned().collect::<Vec<_>>().join(" ");
                let (pid, name) = parse_ss_process(&proc_raw);

                list.push(ListeningPort {
                    protocol: if protocol.contains("udp") { "UDP".to_string() } else { "TCP".to_string() },
                    local_addr: addr.trim_matches('[').trim_matches(']').to_string(),
                    local_port: port,
                    pid,
                    process_name: name,
                });
            }
        }
    }

    if list.is_empty() {
        // Fallback: netstat -tunlp
        let (n_out, _) = run_cmd(&state, &conn_id, "netstat -tunlp 2>/dev/null").await;
        for line in n_out.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 6 && (parts[0].starts_with("tcp") || parts[0].starts_with("udp")) {
                let proto = parts[0].to_uppercase();
                let local = parts[3];
                if let Some(c_idx) = local.rfind(':') {
                    let addr = &local[..c_idx];
                    let port_str = &local[c_idx + 1..];
                    if let Ok(port) = port_str.parse::<u16>() {
                        let proc_col = parts.get(6).unwrap_or(&"");
                        let (pid, name) = if proc_col.contains('/') {
                            let sub: Vec<&str> = proc_col.splitn(2, '/').collect();
                            (sub[0].parse::<u32>().ok(), Some(sub[1].to_string()))
                        } else {
                            (None, None)
                        };

                        list.push(ListeningPort {
                            protocol: proto,
                            local_addr: addr.to_string(),
                            local_port: port,
                            pid,
                            process_name: name,
                        });
                    }
                }
            }
        }
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

/// Kill process holding a port using elevated privilege, fuser, lsof, and signal handling
#[tauri::command]
pub async fn network_kill_port(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    port: u16,
    protocol: String,
    pid: Option<u32>,
    signal: Option<String>,
) -> Result<String, String> {
    let sig_name = signal.unwrap_or_else(|| "KILL".to_string()).to_uppercase();
    let sig_num = match sig_name.as_str() {
        "TERM" | "SIGTERM" | "15" => "15",
        "HUP" | "SIGHUP" | "1" => "1",
        "INT" | "SIGINT" | "2" => "2",
        _ => "9", // Default SIGKILL
    };
    let proto = protocol.to_lowercase();
    let proto_clean = if proto.contains("udp") { "udp" } else { "tcp" };
    let pid_str = pid.map(|p| p.to_string()).unwrap_or_else(|| "none".to_string());

    let script = format!(
        r#"
PORT={port}
PROTO="{proto}"
SIG="{sig}"
PID="{pid_target}"

# 1. Kill by PID if provided
if [ "$PID" != "none" ] && [ "$PID" -gt 0 ] 2>/dev/null; then
    kill -"$SIG" "$PID" 2>/dev/null || true
    sleep 0.2
fi

# 2. Try fuser if available
if command -v fuser >/dev/null 2>&1; then
    fuser -k -"$SIG" "$PORT/$PROTO" 2>/dev/null || true
fi

# 3. Try lsof if available
if command -v lsof >/dev/null 2>&1; then
    lsof -ti:"$PORT" 2>/dev/null | xargs -r kill -"$SIG" 2>/dev/null || true
fi

# 4. Try ss process identification
PIDS=$(ss -lptn "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2)
for P in $PIDS; do
    if [ -n "$P" ]; then
        kill -"$SIG" "$P" 2>/dev/null || true
    fi
done

sleep 0.2
RECHECK=$(ss -lptn "sport = :$PORT" 2>/dev/null | grep -c ":$PORT" || echo 0)
if [ "$RECHECK" -eq 0 ]; then
    echo "SUCCESS: Port :$PORT freed successfully."
else
    echo "SIGNAL_SENT: Termination signal sent to port :$PORT."
fi
"#,
        port = port,
        proto = proto_clean,
        sig = sig_num,
        pid_target = pid_str,
    );

    let (stdout, _) = crate::ssh::exec::run_cmd_priv(&state, &conn_id, &script).await;
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        Ok(format!("Signal SIG{} sent to port :{}", sig_num, port))
    } else {
        Ok(trimmed.to_string())
    }
}

/// Retrieve real-time network bandwidth, transfer rate, packets, errors, drops and link properties
#[tauri::command]
pub async fn network_bandwidth_stats(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<NetworkBandwidthSummary, String> {
    let probe_script = r#"
D1=$(cat /proc/net/dev 2>/dev/null)
sleep 0.4
D2=$(cat /proc/net/dev 2>/dev/null)
echo "===DEV1==="
echo "$D1"
echo "===DEV2==="
echo "$D2"
echo "===ADDR==="
ip -o addr show 2>/dev/null || ifconfig 2>/dev/null || true
echo "===SYSNET==="
for iface in /sys/class/net/*; do
  [ -d "$iface" ] || continue
  bn=$(basename "$iface")
  oper=$(cat "$iface/operstate" 2>/dev/null || echo "unknown")
  mtu=$(cat "$iface/mtu" 2>/dev/null || echo "0")
  spd=$(cat "$iface/speed" 2>/dev/null || echo "0")
  mac=$(cat "$iface/address" 2>/dev/null || echo "—")
  echo "$bn|$oper|$mtu|$spd|$mac"
done
"#;

    let (stdout, code) = run_cmd(&state, &conn_id, probe_script).await;
    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    // Split output by marker tags
    let dev1_raw = stdout.split("===DEV1===").nth(1).unwrap_or("").split("===DEV2===").next().unwrap_or("");
    let dev2_raw = stdout.split("===DEV2===").nth(1).unwrap_or("").split("===ADDR===").next().unwrap_or("");
    let addr_raw = stdout.split("===ADDR===").nth(1).unwrap_or("").split("===SYSNET===").next().unwrap_or("");
    let sys_raw = stdout.split("===SYSNET===").nth(1).unwrap_or("");

    // Map IP addresses per interface
    let mut iface_ips: HashMap<String, String> = HashMap::new();
    for line in addr_raw.lines() {
        let tokens: Vec<&str> = line.split_whitespace().collect();
        if tokens.len() >= 4 && (tokens[2] == "inet" || tokens[2] == "inet6") {
            let iface = tokens[1].trim_end_matches(':').to_string();
            let ip = tokens[3].split('/').next().unwrap_or("").to_string();
            iface_ips.entry(iface).or_insert(ip);
        }
    }

    // Map sys attributes: operstate, mtu, speed, mac
    struct SysAttr {
        operstate: String,
        mtu: Option<u32>,
        speed_mbit: Option<u64>,
        mac: String,
    }
    let mut iface_sys: HashMap<String, SysAttr> = HashMap::new();
    for line in sys_raw.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 5 {
            let bn = parts[0].trim().to_string();
            let oper = parts[1].trim().to_string();
            let mtu = parts[2].trim().parse::<u32>().ok();
            let spd = parts[3].trim().parse::<u64>().ok();
            let mac = parts[4].trim().to_string();
            iface_sys.insert(bn, SysAttr { operstate: oper, mtu, speed_mbit: spd, mac });
        }
    }

    // Parse DEV1 bytes (for speed calculation over 0.4s delta)
    let mut dev1_bytes: HashMap<String, (u64, u64)> = HashMap::new();
    for line in dev1_raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 10 && parts[0].contains(':') {
            let name = parts[0].trim_end_matches(':').to_string();
            let rx: u64 = parts[1].parse().unwrap_or(0);
            let tx: u64 = parts[9].parse().unwrap_or(0);
            dev1_bytes.insert(name, (rx, tx));
        }
    }

    // Parse DEV2 for current cumulative counters and calculate delta
    let mut interfaces = Vec::new();
    let mut total_rx_bytes: u64 = 0;
    let mut total_tx_bytes: u64 = 0;
    let mut total_rx_speed: f64 = 0.0;
    let mut total_tx_speed: f64 = 0.0;
    let mut total_rx_packets: u64 = 0;
    let mut total_tx_packets: u64 = 0;

    for line in dev2_raw.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 10 && parts[0].contains(':') {
            let name = parts[0].trim_end_matches(':').to_string();
            let rx_bytes: u64 = parts[1].parse().unwrap_or(0);
            let rx_packets: u64 = parts[2].parse().unwrap_or(0);
            let rx_errors: u64 = parts[3].parse().unwrap_or(0);
            let rx_drops: u64 = parts[4].parse().unwrap_or(0);

            let tx_bytes: u64 = parts[9].parse().unwrap_or(0);
            let tx_packets: u64 = parts[10].parse().unwrap_or(0);
            let tx_errors: u64 = parts[11].parse().unwrap_or(0);
            let tx_drops: u64 = parts[12].parse().unwrap_or(0);

            // Compute speed over 0.4 second interval
            let (prev_rx, prev_tx) = dev1_bytes.get(&name).cloned().unwrap_or((rx_bytes, tx_bytes));
            let rx_speed_bps = if rx_bytes >= prev_rx { (rx_bytes - prev_rx) as f64 / 0.4 } else { 0.0 };
            let tx_speed_bps = if tx_bytes >= prev_tx { (tx_bytes - prev_tx) as f64 / 0.4 } else { 0.0 };

            let ip = iface_ips.get(&name).cloned().unwrap_or_else(|| "—".to_string());
            let sys = iface_sys.get(&name);
            let operstate = sys.as_ref().map(|s| s.operstate.clone()).unwrap_or_else(|| "up".to_string());
            let mtu = sys.as_ref().and_then(|s| s.mtu);
            let speed_mbit = sys.as_ref().and_then(|s| s.speed_mbit);
            let mac = sys.as_ref().map(|s| s.mac.clone()).unwrap_or_else(|| "—".to_string());

            if name != "lo" {
                total_rx_bytes += rx_bytes;
                total_tx_bytes += tx_bytes;
                total_rx_speed += rx_speed_bps;
                total_tx_speed += tx_speed_bps;
                total_rx_packets += rx_packets;
                total_tx_packets += tx_packets;
            }

            interfaces.push(BandwidthStat {
                name,
                ip,
                mac,
                rx_bytes,
                tx_bytes,
                rx_packets,
                tx_packets,
                rx_errors,
                tx_errors,
                rx_drops,
                tx_drops,
                rx_speed_bps,
                tx_speed_bps,
                operstate,
                mtu,
                speed_mbit,
            });
        }
    }

    // Sort physical/real interfaces first, then loopback
    interfaces.sort_by(|a, b| {
        if a.name == "lo" {
            std::cmp::Ordering::Greater
        } else if b.name == "lo" {
            std::cmp::Ordering::Less
        } else {
            a.name.cmp(&b.name)
        }
    });

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    Ok(NetworkBandwidthSummary {
        total_rx_bytes,
        total_tx_bytes,
        total_rx_speed_bps: total_rx_speed,
        total_tx_speed_bps: total_tx_speed,
        total_rx_packets,
        total_tx_packets,
        interfaces,
        timestamp,
    })
}
