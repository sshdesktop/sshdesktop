fn split_cron_fields_and_command(line: &str, field_count: usize) -> Option<(Vec<&str>, &str)> {
    let bytes = line.as_bytes();
    let mut cursor = 0usize;
    let mut fields = Vec::with_capacity(field_count);
    while fields.len() < field_count {
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            return None;
        }
        let start = cursor;
        while cursor < bytes.len() && !bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        fields.push(&line[start..cursor]);
    }
    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    if cursor >= bytes.len() {
        return None;
    }
    Some((fields, &line[cursor..]))
}

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
    let (stdout, code) = run_cmd(&state, &conn_id, "crontab -l 2>&1").await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    // "no crontab for user" is a normal condition.
    if stdout.to_ascii_lowercase().contains("no crontab for ") {
        return Ok(vec![]);
    }
    if code != 0 {
        return Err(format!("Failed to list crontab: {}", stdout.trim()));
    }

    let mut list = Vec::new();
    let mut line_num: u32 = 0;

    for line in stdout.lines() {
        line_num += 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        if let Some((fields, command)) = split_cron_fields_and_command(trimmed, 5) {
            let schedule = fields.join(" ");
            list.push(CronJob {
                schedule,
                command: command.to_string(),
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
        true
        "#,
    ).await;

    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err(format!("Failed to list system cron jobs: {}", stdout.trim()));
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

        // /etc/crontab and cron.d files include a user field after the schedule.
        // Preserve the command text exactly; joining split_whitespace() would
        // silently collapse spaces inside quoted arguments.
        let (schedule, user, command) = if source.contains("/etc") {
            let Some((fields, command)) = split_cron_fields_and_command(entry, 6) else { continue; };
            (fields[..5].join(" "), fields[5].to_string(), command.to_string())
        } else {
            let Some((fields, command)) = split_cron_fields_and_command(entry, 5) else { continue; };
            (fields.join(" "), "current".to_string(), command.to_string())
        };

        list.push(CronJob { schedule, command, user, line_number: line_num });
    }

    Ok(list)
}

fn build_safe_crontab_update_script(action_cmd: &str) -> String {
    format!(
        "LOCK_FILE=\"/tmp/.sshdesktop_cron_$(id -u).lock\"; \
         BAK_FILE=\"$HOME/.sshdesktop_crontab.bak\"; \
         run_update() {{ \
           (crontab -l 2>/dev/null > \"$BAK_FILE\" || true); \
           {action_cmd}; \
         }}; \
         if command -v flock >/dev/null 2>&1; then \
           (flock -w 5 9 || {{ echo 'CRON_LOCK_TIMEOUT: Concurrent crontab update in progress.' >&2; exit 4; }}; run_update) 9>\"$LOCK_FILE\"; \
         else \
           run_update; \
         fi"
    )
}

#[tauri::command]
pub async fn cron_add(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    schedule: String,
    command: String,
) -> Result<(), String> {
    crate::store::audit::enforce_policy_permission("cron_add")?;
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

    if command.trim().is_empty() || command.len() > 8192 || command.chars().any(|c| c == '\n' || c == '\r' || c == '\0') {
        return Err("Cron command must be 1–8192 characters and contain no line breaks or NUL bytes.".into());
    }

    let new_entry = format!("{} {}", schedule, command);
    let escaped = new_entry.replace('\'', r"'\''");
    let update_action = format!("(crontab -l 2>/dev/null; printf '%s\\n' '{}') | crontab -", escaped);
    let cmd = build_safe_crontab_update_script(&update_action);

    let (out, code) = run_cmd(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err(if out.trim().is_empty() { "Failed to add cron entry.".into() } else { out.trim().to_string() });
    }

    crate::store::audit::append_audit_event("cron_add", "desktop-user", &conn_id, "ok", Some(schedule));
    log::info!("SSH Desktop: Added cron: {}", new_entry);
    Ok(())
}

#[tauri::command]
pub async fn cron_remove(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    line_number: u32,
) -> Result<(), String> {
    crate::store::audit::enforce_policy_permission("cron_remove")?;
    if line_number == 0 {
        return Err("Invalid line number.".into());
    }

    // Re-list to find the actual content line (not counting comments/blanks)
    let (stdout, code) = run_cmd(&state, &conn_id, "crontab -l 2>/dev/null").await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    // The UI receives physical line numbers from cron_list. Remove that exact
    // line, not the Nth non-comment entry (which could delete a different job).
    let selected = stdout.lines().nth((line_number - 1) as usize)
        .ok_or_else(|| format!("Cron line {} not found.", line_number))?;
    if selected.trim().is_empty() || selected.trim().starts_with('#') {
        return Err(format!("Cron line {} is not an active job.", line_number));
    }
    let expected_escaped = selected.replace('\'', r"'\''");
    let actual_line_num = line_number;

    // Compare-and-swap check inside the lock ensures line_number still refers to the same job.
    let update_action = format!(
        "CUR=$(crontab -l 2>/dev/null | sed -n '{line}p'); \
         if [ \"$CUR\" != '{expected}' ]; then \
           echo 'CRON_CONFLICT: Crontab changed concurrently; refresh before removing.' >&2; exit 5; \
         fi; \
         crontab -l 2>/dev/null | sed '{line}d' | crontab -",
        line = actual_line_num,
        expected = expected_escaped,
    );
    let cmd = build_safe_crontab_update_script(&update_action);
    let (out, del_code) = run_cmd(&state, &conn_id, &cmd).await;
    if del_code == -1 {
        return Err("No active SSH connection.".into());
    }
    if del_code != 0 {
        return Err(if out.trim().is_empty() { format!("Failed to remove cron entry #{}", line_number) } else { out.trim().to_string() });
    }

    crate::store::audit::append_audit_event("cron_remove", "desktop-user", &conn_id, "ok", Some(format!("line={}", actual_line_num)));
    log::info!("SSH Desktop: Removed cron entry at line {}", actual_line_num);
    Ok(())
}

#[tauri::command]
pub async fn cron_rollback(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    crate::store::audit::enforce_policy_permission("cron_rollback")?;
    let cmd = "BAK=\"$HOME/.sshdesktop_crontab.bak\"; if [ ! -f \"$BAK\" ]; then echo 'No crontab backup snapshot found.' >&2; exit 2; fi; crontab \"$BAK\" && echo 'Crontab restored from previous snapshot.'";
    let (out, code) = run_cmd(&state, &conn_id, cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err(if out.trim().is_empty() { "Failed to restore crontab backup.".into() } else { out.trim().to_string() });
    }
    crate::store::audit::append_audit_event("cron_rollback", "desktop-user", &conn_id, "ok", None);
    Ok(out.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cron_update_script_includes_backup_and_lock() {
        let script = build_safe_crontab_update_script("crontab -l | crontab -");
        assert!(script.contains(".sshdesktop_crontab.bak"));
        assert!(script.contains("flock -w 5"));
    }
}
