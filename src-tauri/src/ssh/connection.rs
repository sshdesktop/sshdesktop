use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionConfig {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub passphrase: Option<String>,
    #[serde(default)]
    pub auth_method: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionInfo {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub connected: bool,
    pub connected_at: i64,
}

#[derive(Clone)]
pub struct SshConnection {
    pub id: String,
    pub config: ConnectionConfig,
    pub connected: bool,
    pub connected_at: i64,
}

#[tauri::command]
pub async fn ssh_connect(state: tauri::State<'_, AppState>, config: ConnectionConfig) -> Result<String, String> {
    let id = config.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    log::info!("CloudDesk: Establishing SSH connection [{}] for {} ({}:{})", id, config.name, config.host, config.port);

    // Test connectivity using plink (if password) or ssh
    let host = &config.host;
    let port = config.port.to_string();
    let user = &config.username;
    let mut verified = false;
    let mut last_error = String::new();

    if let Some(pwd) = &config.password {
        if !pwd.is_empty() {
            let mut cmd = tokio::process::Command::new("plink");
            #[cfg(windows)]
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

            cmd.arg("-ssh")
                .arg("-P")
                .arg(&port)
                .arg("-l")
                .arg(user)
                .arg("-pw")
                .arg(pwd)
                .arg(host)
                .arg("echo clouddesk-connected")
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            match cmd.spawn() {
                Ok(mut child) => {
                    if let Some(mut stdin) = child.stdin.take() {
                        let _ = tokio::io::AsyncWriteExt::write_all(&mut stdin, b"y\r\ny\r\n").await;
                    }
                    match tokio::time::timeout(std::time::Duration::from_secs(10), child.wait_with_output()).await {
                        Ok(Ok(out)) => {
                            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                            if out.status.success() || stdout.contains("clouddesk-connected") {
                                verified = true;
                                log::info!("CloudDesk: Plink connection test successful for {}", host);
                            } else {
                                let err_raw = if !stderr.is_empty() { stderr } else { stdout };
                                last_error = err_raw
                                    .lines()
                                    .filter(|l| !l.contains("Store key in cache") && !l.contains("The server's") && !l.contains("fingerprint"))
                                    .collect::<Vec<_>>()
                                    .join(" ")
                                    .trim()
                                    .to_string();
                                if last_error.is_empty() {
                                    last_error = "SSH Authentication failed (access denied or wrong password)".to_string();
                                }
                                log::warn!("CloudDesk: Plink test failed for {}: {}", host, last_error);
                            }
                        }
                        Ok(Err(e)) => {
                            last_error = format!("Plink execution error: {}", e);
                        }
                        Err(_) => {
                            last_error = format!("Connection timed out after 10s connecting to {}:{}", host, port);
                        }
                    }
                }
                Err(e) => {
                    last_error = format!("Could not launch plink: {}", e);
                }
            }
        }
    }

    if !verified && (config.password.is_none() || config.password.as_ref().map(|s| s.is_empty()).unwrap_or(true)) {
        let mut ssh_test = tokio::process::Command::new("ssh");
        #[cfg(windows)]
        ssh_test.creation_flags(0x08000000); // CREATE_NO_WINDOW

        ssh_test
            .arg("-p")
            .arg(&port)
            .arg("-o")
            .arg("StrictHostKeyChecking=accept-new")
            .arg("-o")
            .arg("BatchMode=yes")
            .arg("-o")
            .arg("ConnectTimeout=6");

        if let Some(key) = &config.private_key_path {
            if !key.is_empty() {
                ssh_test.arg("-i").arg(key);
            }
        }

        ssh_test.arg(format!("{}@{}", user, host)).arg("echo clouddesk-connected");

        match tokio::time::timeout(std::time::Duration::from_secs(10), ssh_test.output()).await {
            Ok(Ok(out)) => {
                let stdout = String::from_utf8_lossy(&out.stdout).to_string();
                let stderr = String::from_utf8_lossy(&out.stderr).to_string();
                if out.status.success() || stdout.contains("clouddesk-connected") {
                    verified = true;
                    log::info!("CloudDesk: OpenSSH connection test successful for {}", host);
                } else {
                    last_error = if !stderr.is_empty() {
                        stderr.trim().to_string()
                    } else {
                        "OpenSSH authentication failed (Permission denied)".to_string()
                    };
                }
            }
            Ok(Err(e)) => {
                last_error = format!("OpenSSH execution error: {}", e);
            }
            Err(_) => {
                last_error = format!("Connection timed out after 10s connecting to {}:{}", host, port);
            }
        }
    }

    if !verified {
        let clean_error = if last_error.is_empty() {
            format!("Failed to connect to {}:{}. Please check host IP, port, and credentials.", host, port)
        } else {
            last_error
        };
        log::error!("CloudDesk: Connection failed for {}: {}", host, clean_error);
        return Err(clean_error);
    }

    let conn = SshConnection {
        id: id.clone(),
        config,
        connected: true,
        connected_at: chrono::Utc::now().timestamp(),
    };

    {
        let mut map = state.connections.lock();
        map.insert(id.clone(), conn.clone());
        map.insert("default".to_string(), conn);
    }

    log::info!("CloudDesk: SSH Session established with ID: {} (verified: true)", id);
    Ok(id)
}

#[tauri::command]
pub async fn ssh_disconnect(state: tauri::State<'_, AppState>, conn_id: String) -> Result<(), String> {
    let mut map = state.connections.lock();
    map.remove(&conn_id);
    if map.len() == 1 && map.contains_key("default") {
        map.remove("default");
    }
    log::info!("CloudDesk: SSH Session disconnected for ID: {}", conn_id);
    Ok(())
}

#[tauri::command]
pub async fn ssh_list_connections(state: tauri::State<'_, AppState>) -> Result<Vec<ConnectionInfo>, String> {
    let list: Vec<ConnectionInfo> = state
        .connections
        .lock()
        .iter()
        .filter(|(k, _)| *k != "default")
        .map(|(_, c)| ConnectionInfo {
            id: c.id.clone(),
            name: c.config.name.clone(),
            host: c.config.host.clone(),
            port: c.config.port,
            username: c.config.username.clone(),
            connected: c.connected,
            connected_at: c.connected_at,
        })
        .collect();
    Ok(list)
}

#[tauri::command]
pub async fn ssh_test_connection(config: ConnectionConfig) -> Result<bool, String> {
    if config.host.is_empty() || config.port == 0 {
        return Err("Invalid host or port configuration".into());
    }
    Ok(true)
}
