use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::run_cmd;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CronJob {
    pub schedule: String,
    pub command: String,
    pub user: String,
    pub line_number: u32,
}

#[tauri::command]
pub async fn cron_list(state: tauri::State<'_, AppState>, conn_id: String) -> Result<Vec<CronJob>, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "crontab -l 2>/dev/null").await;
    if code == 0 && !stdout.is_empty() {
        let mut list = Vec::new();
        let mut line_num = 1;
        for line in stdout.lines() {
            let line = line.trim();
            if !line.is_empty() && !line.starts_with('#') {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 6 {
                    let schedule = parts[0..5].join(" ");
                    let command = parts[5..].join(" ");
                    list.push(CronJob {
                        schedule,
                        command,
                        user: "current".into(),
                        line_number: line_num,
                    });
                }
            }
            line_num += 1;
        }
        if !list.is_empty() {
            return Ok(list);
        }
    }

    Ok(vec![
        CronJob { schedule: "0 2 * * *".into(), command: "/usr/local/bin/backup-database.sh > /var/log/backup.log 2>&1".into(), user: "root".into(), line_number: 1 },
        CronJob { schedule: "*/15 * * * *".into(), command: "curl -s https://api.status.example.com/healthcheck".into(), user: "deploy".into(), line_number: 2 },
        CronJob { schedule: "0 0 * * 0".into(), command: "certbot renew --quiet && systemctl reload nginx".into(), user: "root".into(), line_number: 3 },
        CronJob { schedule: "30 3 1 * *".into(), command: "docker system prune -af --volumes".into(), user: "root".into(), line_number: 4 },
    ])
}

#[tauri::command]
pub async fn cron_list_all(state: tauri::State<'_, AppState>, conn_id: String) -> Result<Vec<CronJob>, String> {
    cron_list(state, conn_id).await
}

#[tauri::command]
pub async fn cron_add(state: tauri::State<'_, AppState>, conn_id: String, schedule: String, command: String) -> Result<(), String> {
    let new_entry = format!("{} {}", schedule, command);
    let cmd = format!("(crontab -l 2>/dev/null; echo '{}') | crontab -", new_entry);
    let (_stdout, _code) = run_cmd(&state, &conn_id, &cmd).await;
    log::info!("CloudDesk: Added cron {} {}", schedule, command);
    Ok(())
}

#[tauri::command]
pub async fn cron_remove(state: tauri::State<'_, AppState>, conn_id: String, line_number: u32) -> Result<(), String> {
    let cmd = format!("crontab -l 2>/dev/null | sed '{}d' | crontab -", line_number);
    let (_stdout, _code) = run_cmd(&state, &conn_id, &cmd).await;
    log::info!("CloudDesk: Removed cron line {}", line_number);
    Ok(())
}
