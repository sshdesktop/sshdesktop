use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use parking_lot::Mutex;
use lazy_static::lazy_static;

use super::connections::{read_connections_from_disk, write_connections_to_disk, SavedConnection};
use super::settings::{get_sshdesktop_dir, AppSettings};

lazy_static! {
    static ref AUDIT_WRITE_LOCK: Mutex<()> = Mutex::new(());
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub ts: String,
    pub event: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub target: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    pub prev_hash: String,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditVerifyResult {
    pub valid: bool,
    pub total: usize,
    pub verified: usize,
    pub broken_at: Option<usize>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityPolicy {
    pub role: String,
    pub block_metadata_egress: bool,
    pub updated_at: Option<String>,
    pub updated_by: Option<String>,
}

impl Default for SecurityPolicy {
    fn default() -> Self {
        Self {
            role: "admin".to_string(),
            block_metadata_egress: true,
            updated_at: None,
            updated_by: None,
        }
    }
}

fn audit_log_path() -> PathBuf {
    get_sshdesktop_dir().join("audit.log")
}

fn policy_file_path() -> PathBuf {
    get_sshdesktop_dir().join("policy.json")
}

fn compute_entry_hash(prev_hash: &str, ts: &str, event: &str, username: &str, target: &str, status: &str, details: &Option<String>) -> String {
    let mut hasher = Sha256::new();
    let payload = serde_json::json!({
        "ts": ts,
        "event": event,
        "username": username,
        "target": target,
        "status": status,
        "details": details,
    });
    hasher.update(format!("{}|{}", prev_hash, payload).as_bytes());
    hex_encode(&hasher.finalize())
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

fn last_audit_hash(path: &std::path::Path) -> String {
    let zero = "0".repeat(64);
    let Ok(raw) = fs::read_to_string(path) else {
        return zero;
    };
    for line in raw.lines().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<AuditEntry>(trimmed) {
            if entry.hash.len() == 64 {
                return entry.hash;
            }
        }
        break;
    }
    zero
}

pub fn append_audit_event(
    event: &str,
    username: &str,
    target: &str,
    status: &str,
    details: Option<String>,
) {
    let _guard = AUDIT_WRITE_LOCK.lock();
    let path = audit_log_path();
    append_audit_event_to_path(&path, event, username, target, status, details);
}

fn append_audit_event_to_path(
    path: &std::path::Path,
    event: &str,
    username: &str,
    target: &str,
    status: &str,
    details: Option<String>,
) {
    if let Ok(meta) = fs::metadata(path) {
        if meta.len() > 10 * 1024 * 1024 {
            let rotated = path.with_extension("log.1");
            let _ = fs::rename(path, rotated);
        }
    }
    let prev_hash = last_audit_hash(path);
    let ts = chrono::Utc::now().to_rfc3339();
    let hash = compute_entry_hash(&prev_hash, &ts, event, username, target, status, &details);
    let entry = AuditEntry {
        ts,
        event: event.to_string(),
        username: username.to_string(),
        target: target.to_string(),
        status: status.to_string(),
        details,
        prev_hash,
        hash,
    };
    let Ok(mut line) = serde_json::to_string(&entry) else {
        return;
    };
    line.push('\n');
    let mut opts = fs::OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    if let Ok(mut f) = opts.open(path) {
        let _ = f.write_all(line.as_bytes());
    }
}

fn verify_audit_chain_at(path: &std::path::Path) -> AuditVerifyResult {
    let Ok(raw) = fs::read_to_string(path) else {
        return AuditVerifyResult {
            valid: true,
            total: 0,
            verified: 0,
            broken_at: None,
            reason: None,
        };
    };
    let lines: Vec<&str> = raw.lines().filter(|l| !l.trim().is_empty()).collect();
    let mut expected_prev = "0".repeat(64);
    let mut verified = 0usize;
    for (idx, line) in lines.iter().enumerate() {
        let entry: AuditEntry = match serde_json::from_str(line) {
            Ok(e) => e,
            Err(_) => {
                return AuditVerifyResult {
                    valid: false,
                    total: lines.len(),
                    verified,
                    broken_at: Some(idx + 1),
                    reason: Some("Malformed JSON audit record".to_string()),
                };
            }
        };
        if entry.prev_hash != expected_prev {
            return AuditVerifyResult {
                valid: false,
                total: lines.len(),
                verified,
                broken_at: Some(idx + 1),
                reason: Some("Previous hash mismatch".to_string()),
            };
        }
        let expected_hash = compute_entry_hash(
            &entry.prev_hash,
            &entry.ts,
            &entry.event,
            &entry.username,
            &entry.target,
            &entry.status,
            &entry.details,
        );
        if entry.hash != expected_hash {
            return AuditVerifyResult {
                valid: false,
                total: lines.len(),
                verified,
                broken_at: Some(idx + 1),
                reason: Some("Entry hash tamper detected".to_string()),
            };
        }
        expected_prev = entry.hash;
        verified += 1;
    }
    AuditVerifyResult {
        valid: true,
        total: lines.len(),
        verified,
        broken_at: None,
        reason: None,
    }
}

pub fn load_security_policy() -> SecurityPolicy {
    let path = policy_file_path();
    let Ok(raw) = fs::read_to_string(path) else {
        return SecurityPolicy::default();
    };
    let mut policy = serde_json::from_str::<SecurityPolicy>(&raw).unwrap_or_default();
    if !matches!(policy.role.as_str(), "admin" | "operator" | "read_only") {
        policy.role = "admin".to_string();
    }
    policy
}

pub fn check_policy_permission_for_role(role: &str, action: &str) -> Result<(), String> {
    let read_only_blocked = matches!(
        action,
        "firewall_add_rule"
            | "firewall_add_rule_advanced"
            | "firewall_delete_rule"
            | "firewall_delete_rule_advanced"
            | "firewall_toggle"
            | "firewall_install"
            | "firewall_reload"
            | "firewall_set_default_policy"
            | "firewall_reset"
            | "user_create"
            | "user_delete"
            | "user_modify"
            | "user_lock"
            | "user_sudo_toggle"
            | "group_add_user"
            | "disk_create_label"
            | "disk_create_partition"
            | "disk_delete_partition"
            | "disk_resize_partition"
            | "disk_set_partition_flag"
            | "disk_format_filesystem"
            | "disk_set_label"
            | "disk_manage_swap"
            | "disk_manage_tmp"
            | "db_execute_operation"
            | "backup_import_config"
            | "ssh_install_public_key"
            | "sftp_mutate"
    );
    let operator_blocked = matches!(
        action,
        "firewall_reset"
            | "firewall_set_default_policy"
            | "disk_create_label"
            | "disk_create_partition"
            | "disk_delete_partition"
            | "disk_format_filesystem"
            | "user_delete"
            | "user_sudo_toggle"
    );
    if role == "read_only" && read_only_blocked {
        return Err(format!(
            "POLICY_DENIED: Action '{}' is blocked while workspace role is set to 'read_only'.",
            action
        ));
    }
    if role == "operator" && operator_blocked {
        return Err(format!(
            "POLICY_DENIED: Destructive action '{}' requires 'admin' role (current role: 'operator').",
            action
        ));
    }
    Ok(())
}

pub fn enforce_policy_permission(action: &str) -> Result<(), String> {
    let policy = load_security_policy();
    check_policy_permission_for_role(&policy.role, action)
}

#[tauri::command]
pub async fn audit_get_logs(limit: Option<usize>) -> Result<Vec<AuditEntry>, String> {
    let max_entries = limit.unwrap_or(200).clamp(1, 2000);
    let path = audit_log_path();
    let Ok(raw) = fs::read_to_string(path) else {
        return Ok(Vec::new());
    };
    let mut entries: Vec<AuditEntry> = raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<AuditEntry>(l).ok())
        .collect();
    if entries.len() > max_entries {
        entries = entries.split_off(entries.len() - max_entries);
    }
    entries.reverse();
    Ok(entries)
}

#[tauri::command]
pub async fn audit_verify_chain() -> Result<AuditVerifyResult, String> {
    Ok(verify_audit_chain_at(&audit_log_path()))
}

#[tauri::command]
pub async fn policy_get_mode() -> Result<SecurityPolicy, String> {
    Ok(load_security_policy())
}

#[tauri::command]
pub async fn policy_set_mode(
    role: String,
    block_metadata_egress: Option<bool>,
) -> Result<SecurityPolicy, String> {
    let clean_role = role.trim().to_ascii_lowercase();
    if !matches!(clean_role.as_str(), "admin" | "operator" | "read_only") {
        return Err("Policy role must be one of: admin, operator, read_only.".into());
    }
    let current = load_security_policy();
    let updated = SecurityPolicy {
        role: clean_role.clone(),
        block_metadata_egress: block_metadata_egress.unwrap_or(current.block_metadata_egress),
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
        updated_by: Some("desktop-user".to_string()),
    };
    let json = serde_json::to_string_pretty(&updated).map_err(|e| e.to_string())?;
    let path = policy_file_path();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| format!("Failed to save security policy: {}", e))?;
        file.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&path, json).map_err(|e| format!("Failed to save security policy: {}", e))?;
    }
    append_audit_event(
        "policy_set_mode",
        "desktop-user",
        "workspace-policy",
        "ok",
        Some(format!("role={}", clean_role)),
    );
    Ok(updated)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeCapabilities {
    pub runtime: String,
    pub version: String,
    pub features: serde_json::Value,
    pub db_engines: serde_json::Value,
}

pub fn build_runtime_capabilities() -> RuntimeCapabilities {
    RuntimeCapabilities {
        runtime: "tauri".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        features: serde_json::json!({
            "desktop_notifications": true,
            "native_webview_window": true,
            "putty_launch": cfg!(windows),
            "keyring_vault": true,
            "socks5_auth": true,
            "local_fs": false,
            "audit_log": true,
            "rbac_policy": true,
            "config_backup": true,
        }),
        db_engines: serde_json::json!({
            "postgresql": true,
            "mysql": true,
            "mariadb": true,
            "sqlite": true,
            "mssql": true,
            "mongodb": true,
            "redis": true,
            "oracle": false,
            "dynamodb": false,
            "cosmos": false,
            "cassandra": false,
            "db2": false,
        }),
    }
}

#[tauri::command]
pub async fn runtime_capabilities() -> Result<RuntimeCapabilities, String> {
    Ok(build_runtime_capabilities())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackupBundle {
    pub schema: String,
    pub exported_at: String,
    pub version: String,
    pub runtime: String,
    pub connections: Vec<SavedConnection>,
    pub settings: AppSettings,
    pub policy: SecurityPolicy,
}

#[tauri::command]
pub async fn backup_export_config() -> Result<WorkspaceBackupBundle, String> {
    let mut connections = read_connections_from_disk();
    for conn in &mut connections {
        conn.password = None;
    }
    let settings_path = get_sshdesktop_dir().join("settings.json");
    let settings = fs::read_to_string(settings_path)
        .ok()
        .and_then(|s| serde_json::from_str::<AppSettings>(&s).ok())
        .unwrap_or_default();
    let policy = load_security_policy();
    append_audit_event("backup_export_config", "desktop-user", "workspace", "ok", None);
    Ok(WorkspaceBackupBundle {
        schema: "sshdesktop-config-v1".to_string(),
        exported_at: chrono::Utc::now().to_rfc3339(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        runtime: "tauri".to_string(),
        connections,
        settings,
        policy,
    })
}

#[tauri::command]
pub async fn backup_import_config(bundle: WorkspaceBackupBundle) -> Result<serde_json::Value, String> {
    enforce_policy_permission("backup_import_config")?;
    if bundle.schema != "sshdesktop-config-v1" {
        return Err("Invalid backup bundle schema.".into());
    }
    let mut merged = read_connections_from_disk();
    for incoming in bundle.connections {
        if incoming.id.trim().is_empty() || incoming.host.trim().is_empty() {
            continue;
        }
        let mut clean = incoming;
        if let Some(existing) = merged.iter().find(|c| c.id == clean.id).cloned() {
            clean.password = existing.password;
            merged.retain(|c| c.id != clean.id);
        } else {
            clean.password = None;
        }
        merged.push(clean);
    }
    write_connections_to_disk(&merged)?;
    let settings_json = serde_json::to_string_pretty(&bundle.settings).map_err(|e| e.to_string())?;
    let settings_path = get_sshdesktop_dir().join("settings.json");
    fs::write(settings_path, settings_json).map_err(|e| format!("Failed to restore settings: {}", e))?;
    append_audit_event("backup_import_config", "desktop-user", "workspace", "ok", None);
    Ok(serde_json::json!({ "imported": true }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_hash_chain_detects_tampering() {
        let temp_file = std::env::temp_dir().join(format!("sshdesktop-audit-test-{}.log", uuid::Uuid::new_v4().simple()));
        append_audit_event_to_path(&temp_file, "ssh_connect", "alice", "prod-1", "ok", None);
        append_audit_event_to_path(&temp_file, "firewall_toggle", "alice", "prod-1", "ok", Some("enable=true".into()));
        let verified = verify_audit_chain_at(&temp_file);
        assert!(verified.valid);
        assert_eq!(verified.total, 2);

        // Tamper with line 1 payload
        let raw = fs::read_to_string(&temp_file).unwrap();
        let tampered = raw.replacen("prod-1", "evil-host", 1);
        fs::write(&temp_file, tampered).unwrap();
        let bad = verify_audit_chain_at(&temp_file);
        assert!(!bad.valid);
        assert_eq!(bad.broken_at, Some(1));
        let _ = fs::remove_file(&temp_file);
    }

    #[test]
    fn policy_blocks_read_only_and_destructive_operator_actions() {
        assert!(check_policy_permission_for_role("admin", "firewall_reset").is_ok());
        assert!(check_policy_permission_for_role("operator", "firewall_add_rule").is_ok());
        assert!(check_policy_permission_for_role("operator", "firewall_reset").is_err());
        assert!(check_policy_permission_for_role("operator", "disk_format_filesystem").is_err());
        assert!(check_policy_permission_for_role("read_only", "firewall_add_rule").is_err());
        assert!(check_policy_permission_for_role("read_only", "firewall_add_rule_advanced").is_err());
        assert!(check_policy_permission_for_role("read_only", "firewall_delete_rule_advanced").is_err());
        assert!(check_policy_permission_for_role("read_only", "firewall_install").is_err());
        assert!(check_policy_permission_for_role("read_only", "firewall_reload").is_err());
        assert!(check_policy_permission_for_role("read_only", "ssh_install_public_key").is_err());
        assert!(check_policy_permission_for_role("read_only", "sftp_mutate").is_err());
        assert!(check_policy_permission_for_role("read_only", "user_delete").is_err());
    }

    #[test]
    fn runtime_capabilities_reports_honest_db_drivers() {
        let caps = build_runtime_capabilities();
        assert_eq!(caps.runtime, "tauri");
        assert_eq!(caps.db_engines["postgresql"], serde_json::json!(true));
        assert_eq!(caps.db_engines["oracle"], serde_json::json!(false));
        assert_eq!(caps.db_engines["dynamodb"], serde_json::json!(false));
    }
}
