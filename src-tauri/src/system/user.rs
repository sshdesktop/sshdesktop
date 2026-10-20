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
        "cat /etc/shadow 2>/dev/null || getent shadow 2>/dev/null",
    ).await;
    let mut locked_users: std::collections::HashSet<String> = std::collections::HashSet::new();
    for line in shadow_out.lines() {
        let parts: Vec<&str> = line.split(':').collect();
        if parts.len() >= 2 {
            let user = parts[0].trim();
            let hash = parts[1].trim();
            // Locked if hash starts with '!' or '*'
            // Or if field 8 (expiration date in days since epoch) is 1 or in past
            let is_expired = if parts.len() >= 8 && !parts[7].trim().is_empty() {
                if let Ok(exp_days) = parts[7].trim().parse::<i64>() {
                    exp_days > 0 && exp_days <= 100 // e.g. 1 means expired in 1970
                } else {
                    false
                }
            } else {
                false
            };
            if hash.starts_with('!') || hash.starts_with('*') || is_expired {
                locked_users.insert(user.to_string());
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
                log::warn!("SSH Desktop: chpasswd warning for {}: {}", username, pwd_out.trim());
            }
        }
    }

    log::info!("SSH Desktop: Added user {}", username);
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
    log::info!("SSH Desktop: Deleted user {}", username);
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

    log::info!("SSH Desktop: Modified user {}", username);
    Ok(())
}

#[tauri::command]
pub async fn user_lock(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    username: String,
) -> Result<(), String> {
    if username.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid username.".into());
    }
    if username == "root" {
        return Err("Cannot lock the root superuser account.".into());
    }

    // Comprehensive lock:
    // 1. Set expiration date to 1 (day after epoch) -> disables all SSH key and password logins
    // 2. Lock password hash with usermod -L or passwd -l
    let cmd = format!(
        "usermod -L -e 1 '{}' 2>&1 || (usermod -L '{}' 2>&1; usermod -e 1 '{}' 2>&1) || passwd -l '{}' 2>&1",
        username, username, username, username
    );
    let (out, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !out.is_empty() {
        return Err(format!("Lock user failed: {}", out.trim()));
    }

    log::info!("SSH Desktop: Locked user {}", username);
    Ok(())
}

#[tauri::command]
pub async fn user_unlock(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    username: String,
) -> Result<(), String> {
    if username.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid username.".into());
    }

    // Comprehensive unlock:
    // 1. Clear expiration date -> re-enables login access
    // 2. Unlock password hash with usermod -U or passwd -u
    let cmd = format!(
        "usermod -e '' '{}' 2>&1; usermod -U '{}' 2>/dev/null || passwd -u '{}' 2>/dev/null || true",
        username, username, username
    );
    let (out, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !out.is_empty() {
        return Err(format!("Unlock user failed: {}", out.trim()));
    }

    log::info!("SSH Desktop: Unlocked user {}", username);
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

    // Check if group has members in /etc/group
    let check_members = format!(
        "getent group '{}' 2>/dev/null | awk -F: '{{print $4}}'",
        name
    );
    let (members_out, _) = run_cmd(&state, &conn_id, &check_members).await;
    let trimmed_members = members_out.trim();
    if !trimmed_members.is_empty() {
        return Err(format!(
            "Cannot delete group '{}': Group still has active member user(s) ({}). Please remove users from this group first.",
            name, trimmed_members
        ));
    }

    // Check if any user has this group's GID as their primary GID
    let check_primary = format!(
        "gid=$(getent group '{}' 2>/dev/null | awk -F: '{{print $3}}'); if [ -n \"$gid\" ]; then getent passwd | awk -F: -v g=\"$gid\" '$4==g{{print $1}}'; fi",
        name
    );
    let (primary_out, _) = run_cmd(&state, &conn_id, &check_primary).await;
    let trimmed_primary = primary_out.trim();
    if !trimmed_primary.is_empty() {
        return Err(format!(
            "Cannot delete group '{}': It is the primary group for user(s) ({}). Cannot delete a group with assigned users.",
            name, trimmed_primary.replace('\n', ", ")
        ));
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
pub async fn group_add_user(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    group: String,
    username: String,
) -> Result<(), String> {
    if group.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid group name.".into());
    }
    if username.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid username.".into());
    }

    let cmd = format!("gpasswd -a '{}' '{}' 2>&1 || usermod -aG '{}' '{}' 2>&1", username, group, group, username);
    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("Failed to add user '{}' to group '{}': {}", username, group, stdout.trim()));
    }
    Ok(())
}

#[tauri::command]
pub async fn group_remove_user(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    group: String,
    username: String,
) -> Result<(), String> {
    if group.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid group name.".into());
    }
    if username.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-') {
        return Err("Invalid username.".into());
    }

    let cmd = format!("gpasswd -d '{}' '{}' 2>&1", username, group);
    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("Failed to remove user '{}' from group '{}': {}", username, group, stdout.trim()));
    }
    Ok(())
}

#[tauri::command]
pub async fn who_is_logged_in(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    // Multi-fallback active user session detection (who -> w -> loginctl -> ps)
    let cmd = r#"
if [ -n "$(who 2>/dev/null)" ]; then
    who 2>/dev/null
elif command -v w >/dev/null 2>&1 && [ -n "$(w -h 2>/dev/null)" ]; then
    w -h 2>/dev/null | awk '{printf "%s\t%s\t%s\t%s\n", $1, $2, ($3 ? $3 : "local"), $4}'
elif command -v loginctl >/dev/null 2>&1 && [ -n "$(loginctl list-sessions --no-legend 2>/dev/null)" ]; then
    loginctl list-sessions --no-legend 2>/dev/null | awk '{printf "%s\t%s\t%s\tActive\n", $3, ($5 ? $5 : "session-"$1), ($4 ? $4 : "systemd")}'
else
    ps -eo user,tty,etime,args 2>/dev/null | grep -E 'pts/[0-9]|tty[0-9]' | grep -v grep | awk '{printf "%s\t%s\tlocal/ssh\t%s\n", $1, $2, $3}'
fi
"#;
    let (stdout, code) = run_cmd(&state, &conn_id, cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if !stdout.trim().is_empty() {
        return Ok(stdout);
    }
    Ok(String::new())
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
