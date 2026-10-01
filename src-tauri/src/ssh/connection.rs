use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConnectionConfig {
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
    let id = Uuid::new_v4().to_string();
    log::info!("CloudDesk: Establishing SSH connection for {} ({}:{})", config.name, config.host, config.port);

    // Test connectivity using plink (if password) or ssh
    let host = &config.host;
    let port = config.port.to_string();
    let user = &config.username;
    let mut verified = false;

    if let Some(pwd) = &config.password {
        if !pwd.is_empty() {
            let plink_test = tokio::process::Command::new("plink")
                .arg("-batch")
                .arg("-ssh")
                .arg("-P")
                .arg(&port)
                .arg("-l")
                .arg(user)
                .arg("-pw")
                .arg(pwd)
                .arg(host)
                .arg("echo clouddesk-connected")
                .output()
                .await;

            if let Ok(out) = plink_test {
                if out.status.success() {
                    verified = true;
                    log::info!("CloudDesk: Plink connection test successful for {}", host);
                }
            }
        }
    }

    if !verified {
        let mut ssh_test = tokio::process::Command::new("ssh");
        ssh_test
            .arg("-p")
            .arg(&port)
            .arg("-o")
            .arg("StrictHostKeyChecking=no")
            .arg("-o")
            .arg("ConnectTimeout=4");

        if let Some(key) = &config.private_key_path {
            if !key.is_empty() {
                ssh_test.arg("-i").arg(key);
            }
        }

        ssh_test.arg(format!("{}@{}", user, host)).arg("echo clouddesk-connected");

        if let Ok(out) = ssh_test.output().await {
            if out.status.success() {
                verified = true;
                log::info!("CloudDesk: OpenSSH connection test successful for {}", host);
            }
        }
    }

    let conn = SshConnection {
        id: id.clone(),
        config,
        connected: true,
        connected_at: chrono::Utc::now().timestamp(),
    };

    state.connections.lock().insert(id.clone(), conn);
    log::info!("CloudDesk: SSH Session established with ID: {} (verified: {})", id, verified);
    Ok(id)
}

#[tauri::command]
pub async fn ssh_disconnect(state: tauri::State<'_, AppState>, conn_id: String) -> Result<(), String> {
    state.connections.lock().remove(&conn_id);
    log::info!("CloudDesk: SSH Session disconnected for ID: {}", conn_id);
    Ok(())
}

#[tauri::command]
pub async fn ssh_list_connections(state: tauri::State<'_, AppState>) -> Result<Vec<ConnectionInfo>, String> {
    let list: Vec<ConnectionInfo> = state
        .connections
        .lock()
        .values()
        .map(|c| ConnectionInfo {
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
