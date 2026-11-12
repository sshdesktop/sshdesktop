use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use sha2::{Digest, Sha256};
use hmac::{Hmac, Mac};
use sha1::Sha1;
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::password_hash::SaltString;

static IS_AUTHENTICATED: AtomicBool = AtomicBool::new(false);

// Persist credential changes through a same-directory temporary file so readers
// never observe a partially-written JSON document. The temporary file is
// private on Unix and renamed only after its contents have been flushed.
fn persist_auth_config(path: &PathBuf, json: &str) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "Authentication path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("Could not create authentication directory: {}", e))?;
    let temp_path = parent.join(format!(".auth-{}.tmp", uuid::Uuid::new_v4().simple()));
    let write_result = (|| -> Result<(), String> {
        use std::io::Write;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        let mut file = options.open(&temp_path).map_err(|e| format!("Could not create temporary authentication file: {}", e))?;
        file.write_all(json.as_bytes()).and_then(|_| file.sync_all())
            .map_err(|e| format!("Could not flush temporary authentication file: {}", e))?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&temp_path, fs::Permissions::from_mode(0o600))
                .map_err(|e| format!("Could not secure temporary authentication file: {}", e))?;
        }
        fs::rename(&temp_path, path).map_err(|e| format!("Could not atomically replace authentication configuration: {}", e))?;
        #[cfg(unix)] { if let Ok(dir) = fs::File::open(parent) { let _ = dir.sync_all(); } }
        Ok(())
    })();
    if write_result.is_err() { let _ = fs::remove_file(&temp_path); }
    write_result
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerAuthConfig {
    pub username: String,
    pub password_hash: String,
    pub salt: String,
    pub must_change_password: bool,
    pub created_at: i64,
    pub last_login_at: Option<i64>,
    #[serde(default)]
    pub totp_enabled: bool,
    #[serde(default)]
    pub totp_secret: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthStatusResponse {
    pub is_configured: bool,
    pub is_authenticated: bool,
    pub must_change_password: bool,
    pub username: String,
    pub storage_path: String,
    pub totp_enabled: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthActionResult {
    pub success: bool,
    pub must_change_password: bool,
    pub username: String,
    pub mfa_required: bool,
    pub message: Option<String>,
}

const BASE32_ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

fn base32_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() * 8 + 4) / 5);
    let mut buf: u32 = 0;
    let mut bits: u8 = 0;
    for &b in data {
        buf = (buf << 8) | (b as u32);
        bits += 8;
        while bits >= 5 {
            bits -= 5;
            out.push(BASE32_ALPHABET[((buf >> bits) & 0x1f) as usize] as char);
        }
    }
    if bits > 0 {
        out.push(BASE32_ALPHABET[((buf << (5 - bits)) & 0x1f) as usize] as char);
    }
    out
}

fn base32_decode(encoded: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity((encoded.len() * 5) / 8);
    let mut buf: u32 = 0;
    let mut bits: u8 = 0;
    for ch in encoded.trim().trim_end_matches('=').bytes() {
        if ch == b' ' || ch == b'-' { continue; }
        let val = match ch.to_ascii_uppercase() {
            b'A'..=b'Z' => (ch.to_ascii_uppercase() - b'A') as u32,
            b'2'..=b'7' => (ch - b'2' + 26) as u32,
            _ => return Err("Invalid Base32 TOTP secret character".into()),
        };
        buf = (buf << 5) | val;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
        }
    }
    Ok(out)
}

pub fn compute_totp_at(secret_b32: &str, unix_secs: u64) -> Result<String, String> {
    let key = base32_decode(secret_b32)?;
    if key.is_empty() {
        return Err("TOTP secret cannot be empty".into());
    }
    let counter = (unix_secs / 30).to_be_bytes();
    let mut mac = Hmac::<Sha1>::new_from_slice(&key).map_err(|_| "Invalid HMAC key".to_string())?;
    mac.update(&counter);
    let digest = mac.finalize().into_bytes();
    let offset = (digest[digest.len() - 1] & 0x0f) as usize;
    let bin = ((digest[offset] as u32 & 0x7f) << 24)
        | ((digest[offset + 1] as u32 & 0xff) << 16)
        | ((digest[offset + 2] as u32 & 0xff) << 8)
        | (digest[offset + 3] as u32 & 0xff);
    Ok(format!("{:06}", bin % 1_000_000))
}

pub fn verify_totp_code(secret_b32: &str, code: &str, unix_secs: u64) -> bool {
    let clean = code.trim();
    if clean.len() != 6 || !clean.bytes().all(|b| b.is_ascii_digit()) {
        return false;
    }
    for delta in [-30i64, 0, 30] {
        let ts = (unix_secs as i64).saturating_add(delta).max(0) as u64;
        if let Ok(expected) = compute_totp_at(secret_b32, ts) {
            if expected.as_bytes().iter().zip(clean.as_bytes()).fold(0u8, |a, (x, y)| a | (x ^ y)) == 0 {
                return true;
            }
        }
    }
    false
}

/// Resolves the secure server configuration file path:
/// 1. /etc/sshdesktop/auth.json (system daemon location)
/// 2. ~/.sshdesktop/auth.json (user home daemon location)
/// 3. .sshdesktop/auth.json (local directory fallback)
pub fn get_auth_file_path() -> PathBuf {
    // 1. Check if /etc/sshdesktop is writable or exists (Linux server daemon)
    let etc_dir = PathBuf::from("/etc/sshdesktop");
    if etc_dir.exists() || (cfg!(unix) && fs::create_dir_all(&etc_dir).is_ok()) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&etc_dir, fs::Permissions::from_mode(0o700));
        }
        return etc_dir.join("auth.json");
    }

    // 2. User home directory ~/.sshdesktop/auth.json
    if let Some(base) = directories::BaseDirs::new() {
        let home_dot_dir = base.home_dir().join(".sshdesktop");
        let _ = fs::create_dir_all(&home_dot_dir);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&home_dot_dir, fs::Permissions::from_mode(0o700));
        }
        return home_dot_dir.join("auth.json");
    }

    // 3. Fallback to local .sshdesktop/auth.json
    let local = PathBuf::from(".sshdesktop");
    let _ = fs::create_dir_all(&local);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&local, fs::Permissions::from_mode(0o700));
    }
    local.join("auth.json")
}

/// Sets strict POSIX permissions (chmod 600) on Unix systems
pub fn enforce_strict_permissions(path: &PathBuf) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Could not secure authentication file permissions: {}", e))?;
    }
    Ok(())
}

/// Argon2id password hashing. The supplied per-user salt is encoded into the
/// PHC string so existing config storage remains backward compatible.
pub fn hash_password(password: &str, salt: &str) -> String {
    let salt = SaltString::encode_b64(salt.as_bytes()).expect("UUID salt must be valid password-hash salt");
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .expect("Argon2id hashing should succeed with the default parameters")
        .to_string()
}

fn legacy_sha256_password(password: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b"::sshdesktop_secure_auth_v2::");
    hasher.update(password.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn verify_password(password: &str, salt: &str, stored: &str) -> bool {
    if stored.starts_with("$argon2") {
        return PasswordHash::new(stored)
            .ok()
            .map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
            .unwrap_or(false);
    }
    // Constant-time comparison for legacy SHA-256 hashes during migration.
    let candidate = legacy_sha256_password(password, salt);
    if candidate.len() != stored.len() { return false; }
    candidate.as_bytes().iter().zip(stored.as_bytes()).fold(0u8, |diff, (a, b)| diff | (*a ^ *b)) == 0
}

fn generate_initial_password() -> String {
    const CHARSET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_";
    let mut out = String::with_capacity(20);
    // Concatenate two v4 UUIDs (32 CSPRNG bytes) to derive 20 unbiased characters
    let bytes = [
        *uuid::Uuid::new_v4().as_bytes(),
        *uuid::Uuid::new_v4().as_bytes(),
    ];
    for chunk in bytes.iter().flat_map(|b| b.iter()).take(20) {
        out.push(CHARSET[(*chunk as usize) % CHARSET.len()] as char);
    }
    out
}

fn initial_credentials_file_path(auth_path: &std::path::Path) -> PathBuf {
    auth_path
        .parent()
        .map(|p| p.join("initial-admin-credentials.txt"))
        .unwrap_or_else(|| PathBuf::from("initial-admin-credentials.txt"))
}

/// Loads or auto-initializes a unique random bootstrap administrator configuration
pub fn load_or_init_auth_config() -> Result<(ServerAuthConfig, PathBuf), String> {
    let path = get_auth_file_path();
    if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Could not read authentication configuration {}: {}", path.display(), e))?;
        let config = serde_json::from_str::<ServerAuthConfig>(&content)
            .map_err(|e| format!("Authentication configuration {} is invalid; refusing to reset credentials: {}", path.display(), e))?;
        if config.username.is_empty() || config.username.len() > 64
            || config.password_hash.is_empty() || config.password_hash.len() > 512
            || config.salt.is_empty() || config.salt.len() > 128
        {
            return Err(format!("Authentication configuration {} contains invalid or oversized credential fields.", path.display()));
        }
        return Ok((config, path));
    }

    // Initialize random one-time bootstrap administrator credentials only when no config exists.
    let salt = uuid::Uuid::new_v4().to_string();
    let initial_password = generate_initial_password();
    let default_config = ServerAuthConfig {
        username: "admin".to_string(),
        password_hash: hash_password(&initial_password, &salt),
        salt,
        must_change_password: true,
        created_at: chrono::Utc::now().timestamp(),
        last_login_at: None,
        totp_enabled: false,
        totp_secret: None,
    };

    let json = serde_json::to_string_pretty(&default_config)
        .map_err(|e| format!("Could not serialize initial authentication configuration: {}", e))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create authentication directory {}: {}", parent.display(), e))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Some(parent) = path.parent() {
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|e| format!("Could not secure authentication directory: {}", e))?;
        }
    }
    // create_new prevents racing initialization from truncating an existing file.
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path)
        .map_err(|e| format!("Could not create initial authentication configuration {}: {}", path.display(), e))?;
    file.write_all(json.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("Could not write initial authentication configuration: {}", e))?;
    enforce_strict_permissions(&path)?;

    let creds_path = initial_credentials_file_path(&path);
    let _ = fs::remove_file(&creds_path);
    let mut creds_opts = fs::OpenOptions::new();
    creds_opts.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        creds_opts.mode(0o600);
    }
    if let Ok(mut cf) = creds_opts.open(&creds_path) {
        let banner = format!(
            "SSH Desktop Initial Setup Credentials (rotate on first login)\nusername=admin\npassword={}\n",
            initial_password
        );
        let _ = cf.write_all(banner.as_bytes()).and_then(|_| cf.sync_all());
        let _ = enforce_strict_permissions(&creds_path);
    }

    log::info!(
        "SSH Desktop: Initialized random bootstrap admin credentials in {:?} (initial password written to {:?})",
        path,
        creds_path
    );

    Ok((default_config, path))
}

#[tauri::command]
pub async fn auth_get_status() -> Result<AuthStatusResponse, String> {
    let (config, path) = load_or_init_auth_config()?;
    let is_auth = IS_AUTHENTICATED.load(Ordering::SeqCst);

    Ok(AuthStatusResponse {
        is_configured: true,
        is_authenticated: is_auth,
        must_change_password: config.must_change_password,
        username: config.username,
        storage_path: path.to_string_lossy().to_string(),
        totp_enabled: config.totp_enabled,
    })
}

#[tauri::command]
pub async fn auth_login(
    username: String,
    password: String,
    totp_code: Option<String>,
) -> Result<AuthActionResult, String> {
    if username.len() > 128 || password.len() > 4096 || username.chars().any(char::is_control) {
        return Err("Username or password exceeds the allowed input size or contains invalid characters.".into());
    }
    let (mut config, path) = load_or_init_auth_config()?;
    let trimmed_user = username.trim();

    if trimmed_user != config.username {
        // Also support team administrator/operator/read-only accounts configured in team.json
        let mut team = load_team_users();
        if let Some(member) = team.iter_mut().find(|u| u.username.eq_ignore_ascii_case(trimmed_user)) {
            if member.disabled {
                return Err("This user account has been disabled by an administrator.".into());
            }
            let v_pw = password.clone();
            let v_salt = member.salt.clone();
            let v_hash = member.password_hash.clone();
            let ok = tokio::task::spawn_blocking(move || verify_password(&v_pw, &v_salt, &v_hash))
                .await
                .map_err(|e| format!("Password verification failed: {}", e))?;
            if !ok {
                crate::store::audit::append_audit_event("auth_login", trimmed_user, "team-auth", "failed", None);
                return Err("Invalid username or password.".into());
            }
            member.last_login_at = Some(chrono::Utc::now().timestamp());
            let role = member.role.clone();
            let uname = member.username.clone();
            let _ = save_team_users(&team);
            IS_AUTHENTICATED.store(true, Ordering::SeqCst);
            crate::store::audit::append_audit_event("auth_login", &uname, "team-auth", "ok", Some(format!("role={}", role)));
            return Ok(AuthActionResult {
                success: true,
                must_change_password: false,
                username: uname,
                mfa_required: false,
                message: Some("Authentication successful.".into()),
            });
        }
        return Err("Invalid username or password.".to_string());
    }

    let verify_password_value = password.clone();
    let verify_salt = config.salt.clone();
    let verify_hash = config.password_hash.clone();
    let password_valid = tokio::task::spawn_blocking(move || {
        verify_password(&verify_password_value, &verify_salt, &verify_hash)
    }).await.map_err(|e| format!("Password verification task failed: {}", e))?;
    if !password_valid {
        crate::store::audit::append_audit_event("auth_login", trimmed_user, "desktop-auth", "failed", None);
        return Err("Invalid username or password.".to_string());
    }

    if config.totp_enabled {
        let secret = config.totp_secret.as_deref().unwrap_or("");
        let code = totp_code.as_deref().unwrap_or("");
        if code.trim().is_empty() {
            return Ok(AuthActionResult {
                success: false,
                must_change_password: config.must_change_password,
                username: config.username,
                mfa_required: true,
                message: Some("Two-factor authentication code is required.".to_string()),
            });
        }
        let now_secs = chrono::Utc::now().timestamp().max(0) as u64;
        if !verify_totp_code(secret, code, now_secs) {
            crate::store::audit::append_audit_event("auth_login", trimmed_user, "desktop-auth", "failed", Some("invalid_totp".into()));
            return Err("Invalid 2FA authenticator code.".to_string());
        }
    }

    // Transparently upgrade legacy fast hashes without blocking the async
    // runtime worker on CPU-intensive password hashing.
    if !config.password_hash.starts_with("$argon2") {
        config.salt = uuid::Uuid::new_v4().to_string();
        let password_for_hash = password.clone();
        let salt_for_hash = config.salt.clone();
        config.password_hash = tokio::task::spawn_blocking(move || {
            hash_password(&password_for_hash, &salt_for_hash)
        }).await.map_err(|e| format!("Password migration task failed: {}", e))?;
    }

    config.last_login_at = Some(chrono::Utc::now().timestamp());
    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Could not serialize authentication configuration: {}", e))?;
    persist_auth_config(&path, &json)?;
    enforce_strict_permissions(&path)?;
    IS_AUTHENTICATED.store(true, Ordering::SeqCst);
    crate::store::audit::append_audit_event("auth_login", &config.username, "desktop-auth", "ok", None);

    log::info!("SSH Desktop: Web session authenticated for user '{}'", config.username);
    Ok(AuthActionResult {
        success: true,
        must_change_password: config.must_change_password,
        username: config.username,
        mfa_required: false,
        message: Some("Authentication successful.".to_string()),
    })
}

#[tauri::command]
pub async fn auth_change_credentials(
    current_password: String,
    new_username: String,
    new_password: String,
) -> Result<AuthActionResult, String> {
    if current_password.len() > 4096 || new_password.len() > 4096 || new_username.len() > 64 {
        return Err("Credential input exceeds the allowed maximum length.".into());
    }
    if new_username.chars().any(char::is_control) || new_password.chars().any(char::is_control) {
        return Err("Credentials must not contain control characters.".into());
    }
    let (mut config, path) = load_or_init_auth_config()?;

    // Verify the current password on the blocking pool so Argon2 work does
    // not stall Tokio's async executor.
    let current_password_value = current_password.clone();
    let verify_salt = config.salt.clone();
    let verify_hash = config.password_hash.clone();
    let current_password_valid = tokio::task::spawn_blocking(move || {
        verify_password(&current_password_value, &verify_salt, &verify_hash)
    }).await.map_err(|e| format!("Password verification task failed: {}", e))?;
    if !current_password_valid {
        return Err("Current password verification failed. Please check your current password.".to_string());
    }

    let clean_user = new_username.trim();
    if clean_user.len() < 3 || clean_user.len() > 64
        || !clean_user.as_bytes()[0].is_ascii_alphanumeric()
        || !clean_user.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-'))
    {
        return Err("New username must be 3-64 characters, start with a letter or number, and contain only letters, numbers, '.', '_' or '-'.".to_string());
    }
    if new_password.trim().len() < 12 || new_password.trim().len() > 4096 {
        return Err("New password must be at least 12 characters long.".to_string());
    }
    if new_password.trim() == "admin" {
        return Err("New password cannot be the default 'admin'. Please choose a secure password.".to_string());
    }

    let new_salt = uuid::Uuid::new_v4().to_string();
    let password_for_hash = new_password.clone();
    let salt_for_hash = new_salt.clone();
    let new_hash = tokio::task::spawn_blocking(move || {
        hash_password(&password_for_hash, &salt_for_hash)
    }).await.map_err(|e| format!("Password hashing task failed: {}", e))?;
    config.username = clean_user.to_string();
    config.password_hash = new_hash;
    config.salt = new_salt;
    config.must_change_password = false;
    config.last_login_at = Some(chrono::Utc::now().timestamp());

    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    persist_auth_config(&path, &json)?;
    enforce_strict_permissions(&path)?;
    let _ = fs::remove_file(initial_credentials_file_path(&path));

    IS_AUTHENTICATED.store(true, Ordering::SeqCst);
    log::info!("SSH Desktop: Successfully updated master web credentials. User: '{}', file: {:?}", config.username, path);

    Ok(AuthActionResult {
        success: true,
        must_change_password: false,
        username: config.username,
        mfa_required: false,
        message: Some("Credentials successfully changed and saved securely.".to_string()),
    })
}

#[tauri::command]
pub async fn auth_logout() -> Result<bool, String> {
    IS_AUTHENTICATED.store(false, Ordering::SeqCst);
    log::info!("SSH Desktop: Web session logged out.");
    Ok(true)
}

#[tauri::command]
pub async fn auth_totp_setup() -> Result<serde_json::Value, String> {
    let (config, _) = load_or_init_auth_config()?;
    let bytes = [
        *uuid::Uuid::new_v4().as_bytes(),
    ];
    let secret = base32_encode(&bytes[0][..16]);
    let otpauth_url = format!(
        "otpauth://totp/SSHDesktop:{}?secret={}&issuer=SSHDesktop&digits=6&period=30",
        config.username, secret
    );
    Ok(serde_json::json!({
        "secret": secret,
        "otpauth_url": otpauth_url,
        "totp_enabled": config.totp_enabled,
    }))
}

#[tauri::command]
pub async fn auth_totp_enable(secret: String, code: String) -> Result<bool, String> {
    let (mut config, path) = load_or_init_auth_config()?;
    let now_secs = chrono::Utc::now().timestamp().max(0) as u64;
    if !verify_totp_code(&secret, &code, now_secs) {
        return Err("Invalid 6-digit verification code for the provided secret.".into());
    }
    config.totp_secret = Some(secret.trim().to_string());
    config.totp_enabled = true;
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    persist_auth_config(&path, &json)?;
    enforce_strict_permissions(&path)?;
    crate::store::audit::append_audit_event("auth_totp_enable", &config.username, "mfa", "ok", None);
    Ok(true)
}

#[tauri::command]
pub async fn auth_totp_disable(password: String, code: String) -> Result<bool, String> {
    let (mut config, path) = load_or_init_auth_config()?;
    let pw_ok = verify_password(&password, &config.salt, &config.password_hash);
    if !pw_ok {
        return Err("Current password verification failed.".into());
    }
    if config.totp_enabled {
        let now_secs = chrono::Utc::now().timestamp().max(0) as u64;
        if !verify_totp_code(config.totp_secret.as_deref().unwrap_or(""), &code, now_secs) {
            return Err("Valid 2FA code required to disable MFA.".into());
        }
    }
    config.totp_enabled = false;
    config.totp_secret = None;
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    persist_auth_config(&path, &json)?;
    enforce_strict_permissions(&path)?;
    crate::store::audit::append_audit_event("auth_totp_disable", &config.username, "mfa", "ok", None);
    Ok(true)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamUserRecord {
    pub username: String,
    pub role: String,
    pub password_hash: String,
    pub salt: String,
    pub disabled: bool,
    pub created_at: i64,
    pub last_login_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TeamUserPublic {
    pub username: String,
    pub role: String,
    pub disabled: bool,
    pub created_at: i64,
    pub last_login_at: Option<i64>,
}

fn team_file_path() -> PathBuf {
    get_auth_file_path()
        .parent()
        .map(|p| p.join("team.json"))
        .unwrap_or_else(|| PathBuf::from("team.json"))
}

fn load_team_users() -> Vec<TeamUserRecord> {
    let Ok(raw) = fs::read_to_string(team_file_path()) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<TeamUserRecord>>(&raw).unwrap_or_default()
}

fn save_team_users(users: &[TeamUserRecord]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(users).map_err(|e| e.to_string())?;
    let path = team_file_path();
    persist_auth_config(&path, &json)?;
    enforce_strict_permissions(&path)?;
    Ok(())
}

#[tauri::command]
pub async fn team_list() -> Result<Vec<TeamUserPublic>, String> {
    Ok(load_team_users()
        .into_iter()
        .map(|u| TeamUserPublic {
            username: u.username,
            role: u.role,
            disabled: u.disabled,
            created_at: u.created_at,
            last_login_at: u.last_login_at,
        })
        .collect())
}

#[tauri::command]
pub async fn team_add(username: String, password: String, role: String) -> Result<TeamUserPublic, String> {
    crate::store::audit::enforce_policy_permission("tokens_create")?;
    let clean_user = username.trim().to_string();
    if clean_user.len() < 3 || clean_user.len() > 64 || !clean_user.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'-')) {
        return Err("Username must be 3-64 alphanumeric/._- characters.".into());
    }
    if password.len() < 12 || password.len() > 4096 {
        return Err("Team member password must be at least 12 characters.".into());
    }
    let clean_role = role.trim().to_ascii_lowercase();
    if !matches!(clean_role.as_str(), "admin" | "operator" | "read_only") {
        return Err("Role must be admin, operator, or read_only.".into());
    }
    if let Ok((primary, _)) = load_or_init_auth_config() {
        if primary.username.eq_ignore_ascii_case(&clean_user) {
            return Err("Username conflicts with the primary administrator account.".into());
        }
    }
    let mut users = load_team_users();
    if users.iter().any(|u| u.username.eq_ignore_ascii_case(&clean_user)) {
        return Err("Team member already exists.".into());
    }
    let salt = uuid::Uuid::new_v4().to_string();
    let pw = password.clone();
    let s = salt.clone();
    let hash = tokio::task::spawn_blocking(move || hash_password(&pw, &s))
        .await
        .map_err(|e| format!("Failed hashing team password: {}", e))?;
    let record = TeamUserRecord {
        username: clean_user.clone(),
        role: clean_role.clone(),
        password_hash: hash,
        salt,
        disabled: false,
        created_at: chrono::Utc::now().timestamp(),
        last_login_at: None,
    };
    users.push(record.clone());
    save_team_users(&users)?;
    crate::store::audit::append_audit_event("team_add", "desktop-user", &clean_user, "ok", Some(format!("role={}", clean_role)));
    Ok(TeamUserPublic {
        username: record.username,
        role: record.role,
        disabled: record.disabled,
        created_at: record.created_at,
        last_login_at: record.last_login_at,
    })
}

#[tauri::command]
pub async fn team_set_role(username: String, role: String, disabled: Option<bool>) -> Result<bool, String> {
    crate::store::audit::enforce_policy_permission("tokens_create")?;
    let clean_role = role.trim().to_ascii_lowercase();
    if !matches!(clean_role.as_str(), "admin" | "operator" | "read_only") {
        return Err("Role must be admin, operator, or read_only.".into());
    }
    let mut users = load_team_users();
    let Some(target) = users.iter_mut().find(|u| u.username.eq_ignore_ascii_case(username.trim())) else {
        return Ok(false);
    };
    target.role = clean_role.clone();
    if let Some(d) = disabled {
        target.disabled = d;
    }
    save_team_users(&users)?;
    crate::store::audit::append_audit_event("team_set_role", "desktop-user", username.trim(), "ok", Some(format!("role={}", clean_role)));
    Ok(true)
}

#[tauri::command]
pub async fn team_remove(username: String) -> Result<bool, String> {
    crate::store::audit::enforce_policy_permission("tokens_create")?;
    let mut users = load_team_users();
    let before = users.len();
    users.retain(|u| !u.username.eq_ignore_ascii_case(username.trim()));
    let changed = users.len() < before;
    if changed {
        save_team_users(&users)?;
        crate::store::audit::append_audit_event("team_remove", "desktop-user", username.trim(), "ok", None);
    }
    Ok(changed)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SsoOidcConfig {
    pub enabled: bool,
    pub provider_name: String,
    pub issuer_url: String,
    pub client_id: String,
    pub redirect_uri: String,
    pub default_role: String,
}

impl Default for SsoOidcConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            provider_name: "OIDC Identity Provider".into(),
            issuer_url: String::new(),
            client_id: String::new(),
            redirect_uri: String::new(),
            default_role: "read_only".into(),
        }
    }
}

fn sso_file_path() -> PathBuf {
    get_auth_file_path()
        .parent()
        .map(|p| p.join("sso.json"))
        .unwrap_or_else(|| PathBuf::from("sso.json"))
}

#[tauri::command]
pub async fn sso_get_config() -> Result<SsoOidcConfig, String> {
    let Ok(raw) = fs::read_to_string(sso_file_path()) else {
        return Ok(SsoOidcConfig::default());
    };
    Ok(serde_json::from_str::<SsoOidcConfig>(&raw).unwrap_or_default())
}

#[tauri::command]
pub async fn sso_set_config(config: SsoOidcConfig) -> Result<SsoOidcConfig, String> {
    crate::store::audit::enforce_policy_permission("tokens_create")?;
    let clean_role = config.default_role.trim().to_ascii_lowercase();
    if !matches!(clean_role.as_str(), "admin" | "operator" | "read_only") {
        return Err("Default SSO role must be admin, operator, or read_only.".into());
    }
    let clean_issuer = config.issuer_url.trim().to_string();
    if config.enabled && !clean_issuer.starts_with("https://") {
        return Err("SSO OIDC Issuer URL must use https:// when enabled.".into());
    }
    let next = SsoOidcConfig {
        enabled: config.enabled,
        provider_name: config.provider_name.trim().chars().take(64).collect(),
        issuer_url: clean_issuer,
        client_id: config.client_id.trim().chars().take(256).collect(),
        redirect_uri: config.redirect_uri.trim().chars().take(512).collect(),
        default_role: clean_role,
    };
    let json = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
    let path = sso_file_path();
    persist_auth_config(&path, &json)?;
    enforce_strict_permissions(&path)?;
    crate::store::audit::append_audit_event("sso_set_config", "desktop-user", &next.issuer_url, "ok", None);
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn argon2_password_hash_verifies() {
        let salt = "test-salt-for-sshdesktop";
        let hash = hash_password("correct horse battery staple", salt);
        assert!(hash.starts_with("$argon2id$"));
        assert!(verify_password("correct horse battery staple", salt, &hash));
        assert!(!verify_password("wrong password", salt, &hash));
    }

    #[test]
    fn legacy_sha256_hash_is_accepted_for_migration() {
        let salt = "legacy-test-salt";
        let legacy = legacy_sha256_password("legacy-password", salt);
        assert!(verify_password("legacy-password", salt, &legacy));
        assert!(!verify_password("incorrect", salt, &legacy));
    }

    #[test]
    fn bootstrap_password_is_never_static_admin() {
        let p1 = generate_initial_password();
        let p2 = generate_initial_password();
        assert!(p1.len() >= 18);
        assert_ne!(p1, "admin");
        assert_ne!(p1, p2);
    }

    #[test]
    fn rfc6238_totp_verifies_standard_vector_and_rejects_invalid() {
        // RFC 6238 SHA-1 secret "12345678901234567890" -> Base32 "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
        // Wait: at T=59s (step 1), 8-digit is 94287082 -> 6-digit mod 1e6 is "287082"
        let secret = base32_encode(b"12345678901234567890");
        assert_eq!(compute_totp_at(&secret, 59).unwrap(), "287082");
        assert!(verify_totp_code(&secret, "287082", 59));
        assert!(verify_totp_code(&secret, "287082", 89)); // +30s skew allowed
        assert!(!verify_totp_code(&secret, "287082", 180)); // out of window
        assert!(!verify_totp_code(&secret, "000000", 59));
    }
}
