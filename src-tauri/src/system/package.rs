use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::{run_cmd, run_cmd_priv};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
    pub size: String,
    pub description: String,
    pub arch: String,
    pub status: String,
}

/// Detect the package manager available on the remote system.
/// Returns: "apt" | "dnf" | "yum" | "pacman" | "unknown"
async fn detect_pkg_manager(state: &AppState, conn_id: &str) -> String {
    let (out, _) = run_cmd(
        state,
        conn_id,
        "command -v apt-get dpkg dnf yum pacman 2>/dev/null | head -n 1",
    ).await;
    let out = out.trim().to_lowercase();
    if out.contains("apt") || out.contains("dpkg") { return "apt".into(); }
    if out.contains("dnf")  { return "dnf".into(); }
    if out.contains("yum")  { return "yum".into(); }
    if out.contains("pacman") { return "pacman".into(); }
    "unknown".into()
}

#[tauri::command]
pub async fn package_list(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<PackageInfo>, String> {
    let pm = detect_pkg_manager(&state, &conn_id).await;

    let (stdout, code) = match pm.as_str() {
        "apt" => run_cmd(
            &state,
            &conn_id,
            "dpkg-query -W -f='${Package}\t${Version}\t${Installed-Size}\t${Architecture}\t${binary:Summary}\n' 2>/dev/null",
        ).await,
        "dnf" | "yum" => run_cmd(
            &state,
            &conn_id,
            "rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\t%{SIZE}\t%{ARCH}\t%{SUMMARY}\n' 2>/dev/null",
        ).await,
        "pacman" => run_cmd(
            &state,
            &conn_id,
            r#"pacman -Q 2>/dev/null | awk '{print $1"\t"$2"\t0\tall\tpacman package"}'"#,
        ).await,
        _ => return Err("No supported package manager found (apt/dnf/yum/pacman).".into()),
    };

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 4 {
            let name    = parts[0].trim().to_string();
            let version = parts[1].trim().to_string();
            let size_kb = parts[2].trim().parse::<u64>().unwrap_or(0);
            let arch    = parts[3].trim().to_string();
            let description = if parts.len() > 4 { parts[4].trim().to_string() } else { name.clone() };
            let size = if size_kb > 1024 * 1024 {
                format!("{:.1} GB", size_kb as f64 / 1024.0 / 1024.0)
            } else if size_kb > 1024 {
                format!("{:.1} MB", size_kb as f64 / 1024.0)
            } else {
                format!("{} KB", size_kb)
            };

            if !name.is_empty() {
                list.push(PackageInfo {
                    name, version, size, description, arch,
                    status: "installed".into(),
                });
            }
        }
    }

    if list.is_empty() {
        return Err("No installed packages found.".into());
    }

    Ok(list)
}

#[tauri::command]
pub async fn package_search(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    query: String,
) -> Result<Vec<PackageInfo>, String> {
    // Validate query
    if query.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')')) {
        return Err("Invalid search query.".into());
    }

    let pm = detect_pkg_manager(&state, &conn_id).await;

    let (stdout, code) = match pm.as_str() {
        "apt" => run_cmd(
            &state,
            &conn_id,
            &format!("apt-cache search '{}' 2>/dev/null | head -n 20", query),
        ).await,
        "dnf" => run_cmd(
            &state,
            &conn_id,
            &format!("dnf search '{}' 2>/dev/null | grep -v '^=\\|^Last' | head -n 20", query),
        ).await,
        "yum" => run_cmd(
            &state,
            &conn_id,
            &format!("yum search '{}' 2>/dev/null | head -n 20", query),
        ).await,
        _ => return Err("No supported package manager found.".into()),
    };

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        if let Some(dash) = line.find(" - ") {
            let name = line[..dash].trim().to_string();
            let desc = line[dash + 3..].trim().to_string();
            if !name.is_empty() {
                list.push(PackageInfo {
                    name, version: "latest".into(), size: "—".into(),
                    description: desc, arch: "all".into(), status: "available".into(),
                });
            }
        } else if line.contains(':') {
            // dnf/yum format: "name.arch : description"
            let parts: Vec<&str> = line.splitn(2, ':').collect();
            if parts.len() == 2 {
                let name = parts[0].trim().trim_end_matches(".noarch").trim_end_matches(".x86_64").to_string();
                let desc = parts[1].trim().to_string();
                if !name.is_empty() && !desc.is_empty() {
                    list.push(PackageInfo {
                        name, version: "latest".into(), size: "—".into(),
                        description: desc, arch: "all".into(), status: "available".into(),
                    });
                }
            }
        }
    }

    if list.is_empty() {
        return Err(format!("No packages found matching '{}'.", query));
    }

    Ok(list)
}

#[tauri::command]
pub async fn package_install(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    name: String,
) -> Result<String, String> {
    if name.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')')) {
        return Err("Invalid package name.".into());
    }

    let pm = detect_pkg_manager(&state, &conn_id).await;
    let cmd = match pm.as_str() {
        "apt"    => format!("DEBIAN_FRONTEND=noninteractive apt-get install -y '{}' 2>&1", name),
        "dnf"    => format!("dnf install -y '{}' 2>&1", name),
        "yum"    => format!("yum install -y '{}' 2>&1", name),
        "pacman" => format!("pacman -S --noconfirm '{}' 2>&1", name),
        _ => return Err("No supported package manager found.".into()),
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("Install failed: {}", stdout.trim()));
    }

    log::info!("CloudDesk: Installed package {}", name);
    Ok(if !stdout.is_empty() { stdout } else { format!("Package '{}' installed successfully.", name) })
}

#[tauri::command]
pub async fn package_remove(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    name: String,
) -> Result<String, String> {
    if name.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')')) {
        return Err("Invalid package name.".into());
    }

    let pm = detect_pkg_manager(&state, &conn_id).await;
    let cmd = match pm.as_str() {
        "apt"    => format!("apt-get remove -y '{}' 2>&1", name),
        "dnf"    => format!("dnf remove -y '{}' 2>&1", name),
        "yum"    => format!("yum remove -y '{}' 2>&1", name),
        "pacman" => format!("pacman -R --noconfirm '{}' 2>&1", name),
        _ => return Err("No supported package manager found.".into()),
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 && !stdout.is_empty() {
        return Err(format!("Remove failed: {}", stdout.trim()));
    }

    log::info!("CloudDesk: Removed package {}", name);
    Ok(if !stdout.is_empty() { stdout } else { format!("Package '{}' removed successfully.", name) })
}

#[tauri::command]
pub async fn package_update(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    let pm = detect_pkg_manager(&state, &conn_id).await;
    let cmd = match pm.as_str() {
        "apt"    => "apt-get update 2>&1",
        "dnf"    => "dnf check-update 2>&1",
        "yum"    => "yum check-update 2>&1",
        "pacman" => "pacman -Sy 2>&1",
        _ => return Err("No supported package manager found.".into()),
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    // apt-get update exits 0 on success; dnf/yum check-update exits 100 if updates available
    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Ok("Package repositories updated.".into())
}

#[tauri::command]
pub async fn package_upgradable(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<PackageInfo>, String> {
    let pm = detect_pkg_manager(&state, &conn_id).await;

    let (stdout, code) = match pm.as_str() {
        "apt" => run_cmd(
            &state,
            &conn_id,
            "apt list --upgradable 2>/dev/null | tail -n +2",
        ).await,
        "dnf" => run_cmd(
            &state,
            &conn_id,
            "dnf list updates 2>/dev/null | tail -n +2",
        ).await,
        "yum" => run_cmd(
            &state,
            &conn_id,
            "yum list updates 2>/dev/null | tail -n +2",
        ).await,
        _ => return Ok(vec![]), // pacman: no easy list; return empty
    };

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }

        // apt format: "nginx/jammy-updates 1.26.1-1 amd64 [upgradable from: 1.24.0-2]"
        // dnf format: "nginx.x86_64   1:1.26.1-1.el9   appstream"
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() { continue; }

        let raw_name = parts[0];
        let name = raw_name.split('/').next().unwrap_or(raw_name)
            .split('.').next().unwrap_or(raw_name)
            .to_string();
        let version = parts.get(1).copied().unwrap_or("latest").to_string();

        if !name.is_empty() {
            list.push(PackageInfo {
                name, version, size: "—".into(),
                description: "Upgradable package".into(),
                arch: "amd64".into(),
                status: "upgradable".into(),
            });
        }
    }

    Ok(list)
}

#[tauri::command]
pub async fn package_detect_manager(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    Ok(detect_pkg_manager(&state, &conn_id).await)
}
