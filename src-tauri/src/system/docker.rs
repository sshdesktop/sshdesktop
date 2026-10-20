use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::run_cmd;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub created: String,
    pub cpu_percent: f32,
    pub mem_usage: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DockerImage {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub size: String,
    pub created: String,
}

#[tauri::command]
pub async fn docker_containers(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<ContainerInfo>, String> {
    // Use --format '{{json .}}' which emits one JSON object per line (NDJSON)
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        "docker ps -a --format '{{json .}}' 2>&1",
    ).await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    if stdout.contains("command not found") || stdout.contains("Cannot connect to the Docker") {
        return Err("Docker is not running or not installed on the remote server.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            let id      = val.get("ID").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let name    = val.get("Names").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let image   = val.get("Image").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let status  = val.get("Status").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let state_s = val.get("State").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
            let ports   = val.get("Ports").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let created = val.get("CreatedAt").and_then(|v| v.as_str()).unwrap_or("").to_string();

            if !id.is_empty() {
                list.push(ContainerInfo {
                    id,
                    name: name.trim_start_matches('/').to_string(),
                    image,
                    status,
                    state: state_s,
                    ports,
                    created,
                    cpu_percent: 0.0,
                    mem_usage: "—".into(),
                });
            }
        }
    }

    if list.is_empty() && !stdout.trim().is_empty() {
        // docker ps returned something but no JSON — might be a different format or error
        if stdout.lines().count() > 1 {
            // Possibly tabular output fallback
            return parse_docker_ps_tabular(&stdout);
        }
    }

    // Optionally enrich with docker stats (non-blocking, ignore failure)
    if !list.is_empty() {
        let (stats_out, stats_code) = run_cmd(
            &state,
            &conn_id,
            "docker stats --no-stream --format '{{.ID}}\t{{.CPUPerc}}\t{{.MemUsage}}' 2>/dev/null",
        ).await;
        if stats_code == 0 && !stats_out.is_empty() {
            for line in stats_out.lines() {
                let cols: Vec<&str> = line.split('\t').collect();
                if cols.len() >= 3 {
                    let stats_id = cols[0].trim();
                    let cpu_str  = cols[1].trim().trim_end_matches('%');
                    let mem_str  = cols[2].trim();
                    for c in &mut list {
                        if c.id.starts_with(stats_id) || stats_id.starts_with(&c.id[..8.min(c.id.len())]) {
                            c.cpu_percent = cpu_str.parse().unwrap_or(0.0);
                            c.mem_usage   = mem_str.to_string();
                        }
                    }
                }
            }
        }
    }

    Ok(list)
}

fn parse_docker_ps_tabular(stdout: &str) -> Result<Vec<ContainerInfo>, String> {
    let mut list = Vec::new();
    for line in stdout.lines().skip(1) {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            list.push(ContainerInfo {
                id:          parts[0].to_string(),
                name:        parts.last().copied().unwrap_or("").to_string(),
                image:       parts.get(1).copied().unwrap_or("").to_string(),
                status:      parts.get(4).copied().unwrap_or("").to_string(),
                state:       "unknown".into(),
                ports:       "".into(),
                created:     "".into(),
                cpu_percent: 0.0,
                mem_usage:   "—".into(),
            });
        }
    }
    Ok(list)
}

#[tauri::command]
pub async fn docker_action(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    container_id: String,
    action: String,
) -> Result<String, String> {
    // Validate action
    let safe_action = match action.as_str() {
        "start" | "stop" | "restart" | "pause" | "unpause" | "kill" => action.as_str(),
        "remove" | "rm" => "rm",
        _ => return Err(format!("Invalid docker action: {}", action)),
    };

    // Sanitize container id (hex or name)
    if container_id.chars().any(|c| c == ';' || c == '&' || c == '`' || c == '$') {
        return Err("Invalid container ID.".into());
    }

    let force = if safe_action == "rm" { " -f" } else { "" };
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        &format!("docker {}{} {} 2>&1", safe_action, force, container_id),
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err(format!("docker {} failed: {}", safe_action, stdout.trim()));
    }

    log::info!("SSH Desktop: docker {} {}", safe_action, container_id);
    Ok(stdout.trim().to_string())
}

#[tauri::command]
pub async fn docker_logs(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    container_id: String,
    lines: u32,
) -> Result<String, String> {
    if container_id.chars().any(|c| c == ';' || c == '&' || c == '`' || c == '$') {
        return Err("Invalid container ID.".into());
    }

    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        &format!("docker logs --tail {} {} 2>&1", lines.min(2000), container_id),
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Err(format!("No logs returned for container '{}'", container_id))
}

#[tauri::command]
pub async fn docker_images(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<DockerImage>, String> {
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        "docker images --format '{{json .}}' 2>&1",
    ).await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }
    if stdout.contains("command not found") {
        return Err("Docker is not installed on the remote server.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('{') {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            let id      = val.get("ID").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let repo    = val.get("Repository").and_then(|v| v.as_str()).unwrap_or("<none>").to_string();
            let tag     = val.get("Tag").and_then(|v| v.as_str()).unwrap_or("<none>").to_string();
            let size    = val.get("Size").and_then(|v| v.as_str()).unwrap_or("—").to_string();
            let created = val.get("CreatedAt").and_then(|v| v.as_str()).unwrap_or("—").to_string();
            if !id.is_empty() {
                list.push(DockerImage { id, repository: repo, tag, size, created });
            }
        }
    }

    if list.is_empty() {
        return Err("No docker images found on the remote server.".into());
    }

    Ok(list)
}

#[tauri::command]
pub async fn docker_exec(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    container_id: String,
    command: String,
) -> Result<String, String> {
    if container_id.chars().any(|c| c == ';' || c == '&' || c == '`' || c == '$') {
        return Err("Invalid container ID.".into());
    }
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        &format!("docker exec {} sh -c '{}' 2>&1", container_id, command.replace('\'', r"'\''")),
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && stdout.is_empty() {
        return Err(format!("docker exec failed for container '{}'", container_id));
    }
    Ok(stdout)
}

#[tauri::command]
pub async fn docker_stats(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<ContainerInfo>, String> {
    docker_containers(state, conn_id).await
}

#[tauri::command]
pub async fn docker_image_remove(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    image_id: String,
) -> Result<String, String> {
    if image_id.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')')) {
        return Err("Invalid image ID.".into());
    }

    // Safety check: verify no active or stopped containers use this image
    let (chk, _) = run_cmd(
        &state,
        &conn_id,
        &format!("docker ps -a --filter ancestor='{}' --format '{{{{.Names}}}} ({{{{.Status}}}})' 2>&1", image_id),
    ).await;
    let chk_trimmed = chk.trim();
    if !chk_trimmed.is_empty() && !chk_trimmed.contains("error") && !chk_trimmed.contains("unknown flag") {
        return Err(format!(
            "Cannot delete image: It is currently used by container(s):\n{}",
            chk_trimmed
        ));
    }

    // Safe deletion without -f
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        &format!("docker rmi '{}' 2>&1", image_id),
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    if code != 0 {
        return Err(format!("docker rmi failed: {}", stdout.trim()));
    }

    Ok(stdout.trim().to_string())
}
