use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::{run_cmd, run_cmd_priv};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserInfo {
    pub username: String,
    pub uid: u32,
    pub gid: u32,
    pub home: String,
    pub shell: String,
    pub groups: Vec<String>,
    pub locked: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GroupInfo {
    pub name: String,
    pub gid: u32,
    pub members: Vec<String>,
}

#[tauri::command]
pub async fn user_list(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<UserInfo>, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "getent passwd 2>/dev/null").await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    // Also fetch locked status from /etc/shadow (requires root/sudo; graceful failure)
    let (shadow_out, _) = run_cmd_priv(
        &state,
        &conn_id,
        "getent shadow 2>/dev/null | awk -F: '{print $1,$2}'",
    ).await;
    let mut locked_users: std::collections::HashSet<String> = std::collections::HashSet::new();
    for line in shadow_out.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 2 {
            let hash = parts[1];
            // Locked if hash starts with '!' or '*'
            if hash.starts_with('!') || hash.starts_with('*') {
                locked_users.insert(parts[0].to_string());
            }
        }
    }

    // Fetch group membership for all users
    let (groups_out, _) = run_cmd(
        &state,
        &conn_id,
        "for u in $(getent passwd | awk -F: '$3>=1000||$3==0{print $1}'); do echo \"$u:$(id -nG $u 2>/dev/null)\"; done",
    ).await;
    let mut user_groups: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for line in groups_out.lines() {
        if let Some(colon) = line.find(':') {
            let user = line[..colon].trim().to_string();
            let groups: Vec<String> = line[colon + 1..]
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            user_groups.insert(user, groups);
        }
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 7 {
            let username = parts[0].trim().to_string();
            let uid = parts[2].parse::<u32>().unwrap_or(0);
            let gid = parts[3].parse::<u32>().unwrap_or(0);
            let home  = parts[5].trim().to_string();
            let shell = parts[6].trim().to_string();
            let locked = locked_users.contains(&username)
                || shell.contains("nologin")
                || shell.contains("/false");

            // Include root (uid 0) and human users (uid >= 1000)
            if uid == 0 || uid >= 1000 {
                let groups = user_groups.get(&username)
                    .cloned()
                    .unwrap_or_else(|| vec![username.clone()]);
                list.push(UserInfo { username, uid, gid, home, shell, groups, locked });
            }
        }
    }

    if list.is_empty() {
        return Err("No user data returned from remote server.".into());
    }

    Ok(list)
}

#[tauri::command]
pub async fn user_add(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    username: String,
    password: Option<String>,
    shell: Option<String>,
    groups: Option<Vec<String>>,
) -> Result<(), String> {
    // Validate username
    if username.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid username. Use only alphanumeric characters, hyphens, and underscores.".into());
    }

    let sh = shell.unwrap_or_else(|| "/bin/bash".into());
    let mut cmd = format!("useradd -m -s '{}' '{}'", sh, username);

    if let Some(grps) = &groups {
        if !grps.is_empty() {
            cmd = format!("useradd -m -s '{}' -G '{}' '{}'", sh, grps.join(","), username);
        }
    }

    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("useradd failed: {}", stdout.trim()));
    }

    // Set password if provided
    if let Some(pwd) = &password {
        if !pwd.is_empty() {
            let escaped_pwd = pwd.replace('\'', r"'\''");
            let pwd_cmd = format!("echo '{}:{}' | chpasswd 2>&1", username, escaped_pwd);
            let (pwd_out, pwd_code) = run_cmd_priv(&state, &conn_id, &pwd_cmd).await;
            if pwd_code != 0 && !pwd_out.is_empty() {
                log::warn!("CloudDesk: chpasswd warning for {}: {}", username, pwd_out.trim());
            }
        }
    }

    log::info!("CloudDesk: Added user {}", username);
    Ok(())
}

#[tauri::command]
pub async fn user_delete(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    username: String,
    remove_home: bool,
) -> Result<(), String> {
    if username.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid username.".into());
    }
    // Protect critical system users
    if matches!(username.as_str(), "root" | "daemon" | "bin" | "sys" | "sync") {
        return Err(format!("Refusing to delete protected system user '{}'.", username));
    }

    let flag = if remove_home { "-r" } else { "" };
    let cmd = format!("userdel {} '{}' 2>&1", flag, username);
    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("userdel failed: {}", stdout.trim()));
    }
    log::info!("CloudDesk: Deleted user {}", username);
    Ok(())
}

#[tauri::command]
pub async fn user_modify(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    username: String,
    shell: Option<String>,
    groups: Option<Vec<String>>,
) -> Result<(), String> {
    if username.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid username.".into());
    }

    if let Some(sh) = shell {
        let (out, code) = run_cmd_priv(
            &state,
            &conn_id,
            &format!("usermod -s '{}' '{}' 2>&1", sh, username),
        ).await;
        if code != 0 && code != -1 && !out.is_empty() {
            return Err(format!("usermod shell change failed: {}", out.trim()));
        }
    }

    if let Some(grps) = groups {
        if !grps.is_empty() {
            let (out, code) = run_cmd_priv(
                &state,
                &conn_id,
                &format!("usermod -aG '{}' '{}' 2>&1", grps.join(","), username),
            ).await;
            if code != 0 && code != -1 && !out.is_empty() {
                return Err(format!("usermod groups change failed: {}", out.trim()));
            }
        }
    }

    log::info!("CloudDesk: Modified user {}", username);
    Ok(())
}

#[tauri::command]
pub async fn group_list(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<GroupInfo>, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "getent group 2>/dev/null").await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 4 {
            let name = parts[0].trim().to_string();
            let gid  = parts[2].parse::<u32>().unwrap_or(0);
            let members: Vec<String> = if parts[3].is_empty() {
                vec![]
            } else {
                parts[3].split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
            };

            // Show root group, sudo/admin/wheel, docker, and all human groups (gid >= 1000)
            if gid == 0 || gid >= 1000 || matches!(name.as_str(), "sudo" | "wheel" | "admin" | "docker" | "adm") {
                list.push(GroupInfo { name, gid, members });
            }
        }
    }

    if list.is_empty() {
        return Err("No group data returned from remote server.".into());
    }

    Ok(list)
}

#[tauri::command]
pub async fn group_add(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    name: String,
) -> Result<(), String> {
    if name.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid group name.".into());
    }
    let (stdout, code) = run_cmd_priv(&state, &conn_id, &format!("groupadd '{}' 2>&1", name)).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("groupadd failed: {}", stdout.trim()));
    }
    Ok(())
}

#[tauri::command]
pub async fn group_delete(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    name: String,
) -> Result<(), String> {
    if name.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid group name.".into());
    }
    if matches!(name.as_str(), "root" | "sudo" | "wheel" | "daemon") {
        return Err(format!("Refusing to delete protected group '{}'.", name));
    }
    let (stdout, code) = run_cmd_priv(&state, &conn_id, &format!("groupdel '{}' 2>&1", name)).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("groupdel failed: {}", stdout.trim()));
    }
    Ok(())
}

#[tauri::command]
pub async fn who_is_logged_in(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "who 2>/dev/null").await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if !stdout.is_empty() {
        return Ok(stdout);
    }
    Ok("(No active login sessions found)".into())
}

#[tauri::command]
pub async fn last_logins(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "last -n 20 2>/dev/null").await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if !stdout.is_empty() {
        return Ok(stdout);
    }
    Ok("(No login history available)".into())
}
