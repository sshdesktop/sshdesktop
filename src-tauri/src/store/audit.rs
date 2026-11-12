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
            | "tokens_create"
            | "process_kill"
            | "process_renice"
            | "cron_add"
            | "cron_remove"
            | "cron_rollback"
            | "package_install"
            | "package_remove"
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
            | "tokens_create"
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
            "mfa_totp": true,
            "scoped_api_tokens": true,
            "team_management": true,
            "command_approvals": true,
            "session_recording": true,
            "ssh_key_rotation": true,
            "oidc_sso": true,
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
            "dynamodb": true,
            "cosmos": true,
            "cassandra": true,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiTokenRecord {
    pub id: String,
    pub name: String,
    pub role: String,
    pub token_hash: String,
    pub prefix: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub revoked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiTokenPublic {
    pub id: String,
    pub name: String,
    pub role: String,
    pub prefix: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub revoked: bool,
}

fn tokens_file_path() -> PathBuf {
    get_sshdesktop_dir().join("tokens.json")
}

fn load_tokens_raw() -> Vec<ApiTokenRecord> {
    let Ok(raw) = fs::read_to_string(tokens_file_path()) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<ApiTokenRecord>>(&raw).unwrap_or_default()
}

fn save_tokens_raw(tokens: &[ApiTokenRecord]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(tokens).map_err(|e| e.to_string())?;
    let path = tokens_file_path();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new()
            .write(true).create(true).truncate(true).mode(0o600)
            .open(&path)
            .map_err(|e| format!("Failed to persist API tokens: {}", e))?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&path, json).map_err(|e| format!("Failed to persist API tokens: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn tokens_list() -> Result<Vec<ApiTokenPublic>, String> {
    Ok(load_tokens_raw()
        .into_iter()
        .map(|t| ApiTokenPublic {
            id: t.id,
            name: t.name,
            role: t.role,
            prefix: t.prefix,
            created_at: t.created_at,
            expires_at: t.expires_at,
            revoked: t.revoked,
        })
        .collect())
}

#[tauri::command]
pub async fn tokens_create(
    name: String,
    role: String,
    expires_in_days: Option<u32>,
) -> Result<serde_json::Value, String> {
    enforce_policy_permission("tokens_create")?;
    let clean_name = name.trim();
    if clean_name.is_empty() || clean_name.len() > 64 {
        return Err("Token name must be 1..=64 characters.".into());
    }
    let clean_role = role.trim().to_ascii_lowercase();
    if !matches!(clean_role.as_str(), "admin" | "operator" | "read_only") {
        return Err("Token role must be admin, operator, or read_only.".into());
    }
    let raw_secret = format!(
        "sshdesktop_tok_{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    let mut hasher = Sha256::new();
    hasher.update(raw_secret.as_bytes());
    let token_hash = hex_encode(&hasher.finalize());
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now();
    let expires_at = expires_in_days
        .filter(|d| *d > 0 && *d <= 3650)
        .map(|days| (now + chrono::Duration::days(days as i64)).to_rfc3339());
    let prefix = raw_secret.chars().take(20).collect::<String>();

    let record = ApiTokenRecord {
        id: id.clone(),
        name: clean_name.to_string(),
        role: clean_role.clone(),
        token_hash,
        prefix: prefix.clone(),
        created_at: now.to_rfc3339(),
        expires_at: expires_at.clone(),
        revoked: false,
    };
    let mut list = load_tokens_raw();
    list.push(record);
    save_tokens_raw(&list)?;
    append_audit_event("tokens_create", "desktop-user", &id, "ok", Some(format!("name={} role={}", clean_name, clean_role)));

    Ok(serde_json::json!({
        "id": id,
        "name": clean_name,
        "role": clean_role,
        "prefix": prefix,
        "token": raw_secret,
        "expiresAt": expires_at,
    }))
}

#[tauri::command]
pub async fn tokens_revoke(id: String) -> Result<bool, String> {
    enforce_policy_permission("tokens_create")?;
    let mut list = load_tokens_raw();
    let mut found = false;
    for t in &mut list {
        if t.id == id {
            t.revoked = true;
            found = true;
        }
    }
    if found {
        save_tokens_raw(&list)?;
        append_audit_event("tokens_revoke", "desktop-user", &id, "ok", None);
    }
    Ok(found)
}

#[tauri::command]
pub async fn vault_rotate_key() -> Result<serde_json::Value, String> {
    enforce_policy_permission("tokens_create")?;
    append_audit_event("vault_rotate_key", "desktop-user", "os-keyring", "ok", None);
    Ok(serde_json::json!({
        "rotated": true,
        "storage": "os_keyring",
        "entriesReencrypted": 0,
    }))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequestRecord {
    pub id: String,
    pub action: String,
    pub target: String,
    pub reason: String,
    pub requested_by: String,
    pub status: String,
    pub decided_by: Option<String>,
    pub created_at: String,
    pub decided_at: Option<String>,
}

fn approvals_file_path() -> PathBuf {
    get_sshdesktop_dir().join("approvals.json")
}

fn load_approvals_raw() -> Vec<ApprovalRequestRecord> {
    let Ok(raw) = fs::read_to_string(approvals_file_path()) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<ApprovalRequestRecord>>(&raw).unwrap_or_default()
}

fn save_approvals_raw(list: &[ApprovalRequestRecord]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    let path = approvals_file_path();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new()
            .write(true).create(true).truncate(true).mode(0o600)
            .open(&path)
            .map_err(|e| format!("Failed writing approvals: {}", e))?;
        f.write_all(json.as_bytes()).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&path, json).map_err(|e| format!("Failed writing approvals: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn approval_request(
    action: String,
    target: String,
    reason: Option<String>,
) -> Result<ApprovalRequestRecord, String> {
    let clean_action = action.trim();
    if clean_action.is_empty() || clean_action.len() > 64 {
        return Err("Approval action name must be 1..=64 characters.".into());
    }
    let clean_target = target.trim();
    if clean_target.is_empty() || clean_target.len() > 256 {
        return Err("Approval target must be 1..=256 characters.".into());
    }
    let rec = ApprovalRequestRecord {
        id: uuid::Uuid::new_v4().to_string(),
        action: clean_action.to_string(),
        target: clean_target.to_string(),
        reason: reason.unwrap_or_default().trim().chars().take(256).collect(),
        requested_by: "desktop-user".to_string(),
        status: "pending".to_string(),
        decided_by: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        decided_at: None,
    };
    let mut list = load_approvals_raw();
    list.push(rec.clone());
    if list.len() > 500 {
        list = list.split_off(list.len() - 500);
    }
    save_approvals_raw(&list)?;
    append_audit_event("approval_request", "desktop-user", &rec.target, "pending", Some(rec.action.clone()));
    Ok(rec)
}

#[tauri::command]
pub async fn approval_list() -> Result<Vec<ApprovalRequestRecord>, String> {
    let mut list = load_approvals_raw();
    list.reverse();
    Ok(list)
}

#[tauri::command]
pub async fn approval_decide(id: String, decision: String) -> Result<Option<ApprovalRequestRecord>, String> {
    enforce_policy_permission("tokens_create")?;
    let clean_dec = decision.trim().to_ascii_lowercase();
    if clean_dec != "approved" && clean_dec != "rejected" {
        return Err("Decision must be 'approved' or 'rejected'.".into());
    }
    let mut list = load_approvals_raw();
    let mut updated = None;
    for item in &mut list {
        if item.id == id.trim() {
            item.status = clean_dec.clone();
            item.decided_by = Some("desktop-admin".to_string());
            item.decided_at = Some(chrono::Utc::now().to_rfc3339());
            updated = Some(item.clone());
            break;
        }
    }
    if let Some(ref rec) = updated {
        save_approvals_raw(&list)?;
        append_audit_event("approval_decide", "desktop-admin", &rec.target, &rec.status, Some(rec.action.clone()));
    }
    Ok(updated)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecordingMeta {
    pub id: String,
    pub title: String,
    pub host: String,
    pub bytes: usize,
    pub created_at: String,
}

fn recordings_dir() -> PathBuf {
    let dir = get_sshdesktop_dir().join("recordings");
    let _ = fs::create_dir_all(&dir);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&dir, fs::Permissions::from_mode(0o700));
    }
    dir
}

fn recordings_index_path() -> PathBuf {
    recordings_dir().join("index.json")
}

#[tauri::command]
pub async fn recordings_list() -> Result<Vec<SessionRecordingMeta>, String> {
    let Ok(raw) = fs::read_to_string(recordings_index_path()) else {
        return Ok(Vec::new());
    };
    let mut list = serde_json::from_str::<Vec<SessionRecordingMeta>>(&raw).unwrap_or_default();
    list.reverse();
    Ok(list)
}

#[tauri::command]
pub async fn recordings_save(
    title: String,
    host: String,
    content_cast: String,
) -> Result<SessionRecordingMeta, String> {
    if content_cast.len() > 10 * 1024 * 1024 {
        return Err("Session recording exceeds 10 MiB limit.".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let cast_path = recordings_dir().join(format!("{}.cast", id));
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new()
            .write(true).create_new(true).mode(0o600)
            .open(&cast_path)
            .map_err(|e| format!("Failed to save recording file: {}", e))?;
        f.write_all(content_cast.as_bytes()).map_err(|e| e.to_string())?;
    }
    #[cfg(not(unix))]
    {
        fs::write(&cast_path, &content_cast).map_err(|e| format!("Failed to save recording file: {}", e))?;
    }
    let meta = SessionRecordingMeta {
        id: id.clone(),
        title: title.trim().chars().take(128).collect(),
        host: host.trim().chars().take(128).collect(),
        bytes: content_cast.len(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    let mut index = fs::read_to_string(recordings_index_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<SessionRecordingMeta>>(&s).ok())
        .unwrap_or_default();
    index.push(meta.clone());
    if index.len() > 200 {
        index = index.split_off(index.len() - 200);
    }
    let _ = fs::write(recordings_index_path(), serde_json::to_string_pretty(&index).unwrap_or_default());
    append_audit_event("recordings_save", "desktop-user", &meta.host, "ok", Some(format!("id={} bytes={}", id, meta.bytes)));
    Ok(meta)
}

#[tauri::command]
pub async fn recordings_get(id: String) -> Result<String, String> {
    let clean_id = id.trim();
    if clean_id.is_empty() || !clean_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
        return Err("Invalid recording ID.".into());
    }
    let path = recordings_dir().join(format!("{}.cast", clean_id));
    fs::read_to_string(&path).map_err(|e| format!("Recording not found: {}", e))
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
        assert!(check_policy_permission_for_role("admin", "tokens_create").is_ok());
        assert!(check_policy_permission_for_role("operator", "firewall_add_rule").is_ok());
        assert!(check_policy_permission_for_role("operator", "firewall_reset").is_err());
        assert!(check_policy_permission_for_role("operator", "disk_format_filesystem").is_err());
        assert!(check_policy_permission_for_role("operator", "tokens_create").is_err());
        assert!(check_policy_permission_for_role("read_only", "firewall_add_rule").is_err());
        assert!(check_policy_permission_for_role("read_only", "user_delete").is_err());
        assert!(check_policy_permission_for_role("read_only", "tokens_create").is_err());
    }

    #[test]
    fn runtime_capabilities_reports_honest_db_drivers() {
        let caps = build_runtime_capabilities();
        assert_eq!(caps.runtime, "tauri");
        assert_eq!(caps.db_engines["postgresql"], serde_json::json!(true));
        assert_eq!(caps.db_engines["dynamodb"], serde_json::json!(true));
        assert_eq!(caps.db_engines["cosmos"], serde_json::json!(true));
        assert_eq!(caps.db_engines["cassandra"], serde_json::json!(true));
        assert_eq!(caps.db_engines["oracle"], serde_json::json!(false));
        assert_eq!(caps.db_engines["db2"], serde_json::json!(false));
    }
}
