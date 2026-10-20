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

fn validate_cron_field(s: &str) -> bool {
    // Allow cron-valid characters: digits, *, /, -, ,
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit() || matches!(c, '*' | '/' | '-' | ',' | 'L' | 'W' | '#' | '?'))
}

#[tauri::command]
pub async fn cron_list(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<CronJob>, String> {
    let (stdout, code) = run_cmd(&state, &conn_id, "crontab -l 2>/dev/null").await;

    if code == -1 && stdout.is_empty() {
        return Err("No active SSH connection.".into());
    }

    // "no crontab for user" is a normal condition
    if stdout.trim() == "no crontab for root" || stdout.contains("no crontab for ") {
        return Ok(vec![]);
    }

    let mut list = Vec::new();
    let mut line_num: u32 = 0;

    for line in stdout.lines() {
        line_num += 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 6 {
            let schedule = parts[0..5].join(" ");
            let command  = parts[5..].join(" ");
            list.push(CronJob {
                schedule,
                command,
                user: "current".into(),
                line_number: line_num,
            });
        }
    }

    Ok(list)
}

#[tauri::command]
pub async fn cron_list_all(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<CronJob>, String> {
    // Include /etc/cron.d/* and system crontabs
    let (stdout, code) = run_cmd(
        &state,
        &conn_id,
        r#"
        (crontab -l 2>/dev/null | awk '{print "current\t" $0}');
        for f in /etc/cron.d/* /etc/crontab 2>/dev/null; do
            [ -f "$f" ] && awk -v src="$f" '!/^#|^$/{print src "\t" $0}' "$f";
        done
        "#,
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();
    let mut line_num: u32 = 0;

    for line in stdout.lines() {
        line_num += 1;
        let cols: Vec<&str> = line.splitn(2, '\t').collect();
        if cols.len() < 2 { continue; }
        let source = cols[0].trim();
        let entry  = cols[1].trim();

        if entry.is_empty() || entry.starts_with('#') {
            continue;
        }

        let parts: Vec<&str> = entry.split_whitespace().collect();
        // /etc/crontab and cron.d files have: min hr dom mon dow user command
        // User crontab has: min hr dom mon dow command
        let (schedule, user, command) = if source.contains("/etc") && parts.len() >= 7 {
            (parts[0..5].join(" "), parts[5].to_string(), parts[6..].join(" "))
        } else if parts.len() >= 6 {
            (parts[0..5].join(" "), "current".to_string(), parts[5..].join(" "))
        } else {
            continue;
        };

        list.push(CronJob { schedule, command, user, line_number: line_num });
    }

    Ok(list)
}

#[tauri::command]
pub async fn cron_add(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    schedule: String,
    command: String,
) -> Result<(), String> {
    // Validate schedule fields
    let fields: Vec<&str> = schedule.split_whitespace().collect();
    if fields.len() != 5 {
        return Err("Schedule must have exactly 5 fields (min hour dom month dow).".into());
    }
    for field in &fields {
        if !validate_cron_field(field) {
            return Err(format!("Invalid cron schedule field: '{}'", field));
        }
    }

    // Prevent command injection in schedule
    if schedule.chars().any(|c| matches!(c, ';' | '|' | '&' | '`' | '$')) {
        return Err("Invalid characters in schedule.".into());
    }

    let new_entry = format!("{} {}", schedule, command);
    // Escape single quotes in the entry for the shell
    let escaped = new_entry.replace('\'', r"'\''");
    let cmd = format!("(crontab -l 2>/dev/null; echo '{}') | crontab -", escaped);

    let (_out, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err("Failed to add cron entry.".into());
    }

    log::info!("SSH Desktop: Added cron: {} {}", schedule, command);
    Ok(())
}

#[tauri::command]
pub async fn cron_remove(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    line_number: u32,
) -> Result<(), String> {
    if line_number == 0 {
        return Err("Invalid line number.".into());
    }

    // Re-list to find the actual content line (not counting comments/blanks)
    let (stdout, code) = run_cmd(&state, &conn_id, "crontab -l 2>/dev/null").await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    // Find the Nth non-comment, non-blank line
    let mut real_line: u32 = 0;
    let mut actual_line_num: u32 = 0;
    for (idx, line) in stdout.lines().enumerate() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('#') {
            real_line += 1;
            if real_line == line_number {
                actual_line_num = (idx + 1) as u32;
                break;
            }
        }
    }

    if actual_line_num == 0 {
        return Err(format!("Cron entry #{} not found.", line_number));
    }

    let cmd = format!("crontab -l 2>/dev/null | sed '{}d' | crontab -", actual_line_num);
    let (_out, del_code) = run_cmd(&state, &conn_id, &cmd).await;
    if del_code == -1 {
        return Err("No active SSH connection.".into());
    }
    if del_code != 0 {
        return Err(format!("Failed to remove cron entry #{}", line_number));
    }

    log::info!("SSH Desktop: Removed cron entry at line {}", actual_line_num);
    Ok(())
}
