use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use sha2::{Digest, Sha256};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::password_hash::SaltString;

static IS_AUTHENTICATED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerAuthConfig {
    pub username: String,
    pub password_hash: String,
    pub salt: String,
    pub must_change_password: bool,
    pub created_at: i64,
    pub last_login_at: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthStatusResponse {
    pub is_configured: bool,
    pub is_authenticated: bool,
    pub must_change_password: bool,
    pub username: String,
    pub storage_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuthActionResult {
    pub success: bool,
    pub must_change_password: bool,
    pub username: String,
    pub message: Option<String>,
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

/// Loads or auto-initializes the default admin/admin configuration
pub fn load_or_init_auth_config() -> Result<(ServerAuthConfig, PathBuf), String> {
    let path = get_auth_file_path();
    if path.exists() {
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Could not read authentication configuration {}: {}", path.display(), e))?;
        let config = serde_json::from_str::<ServerAuthConfig>(&content)
            .map_err(|e| format!("Authentication configuration {} is invalid; refusing to reset credentials: {}", path.display(), e))?;
        return Ok((config, path));
    }

    // Initialize default admin / admin credentials only when no config exists.
    let salt = uuid::Uuid::new_v4().to_string();
    let default_config = ServerAuthConfig {
        username: "admin".to_string(),
        password_hash: hash_password("admin", &salt),
        salt,
        must_change_password: true,
        created_at: chrono::Utc::now().timestamp(),
        last_login_at: None,
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
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path)
        .map_err(|e| format!("Could not create initial authentication configuration {}: {}", path.display(), e))?;
    file.write_all(json.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("Could not write initial authentication configuration: {}", e))?;
    enforce_strict_permissions(&path)?;
    log::info!("SSH Desktop: Initialized default web auth credentials in {:?}", path);

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
    })
}

#[tauri::command]
pub async fn auth_login(username: String, password: String) -> Result<AuthActionResult, String> {
    let (mut config, path) = load_or_init_auth_config()?;
    let trimmed_user = username.trim();

    if trimmed_user != config.username {
        return Err("Invalid username or password.".to_string());
    }

    let verify_password_value = password.clone();
    let verify_salt = config.salt.clone();
    let verify_hash = config.password_hash.clone();
    let password_valid = tokio::task::spawn_blocking(move || {
        verify_password(&verify_password_value, &verify_salt, &verify_hash)
    }).await.map_err(|e| format!("Password verification task failed: {}", e))?;
    if !password_valid {
        return Err("Invalid username or password.".to_string());
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
    fs::write(&path, json)
        .map_err(|e| format!("Could not update authentication configuration: {}", e))?;
    enforce_strict_permissions(&path)?;
    IS_AUTHENTICATED.store(true, Ordering::SeqCst);

    log::info!("SSH Desktop: Web session authenticated for user '{}'", config.username);
    Ok(AuthActionResult {
        success: true,
        must_change_password: config.must_change_password,
        username: config.username,
        message: Some("Authentication successful.".to_string()),
    })
}

#[tauri::command]
pub async fn auth_change_credentials(
    current_password: String,
    new_username: String,
    new_password: String,
) -> Result<AuthActionResult, String> {
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
    if clean_user.len() < 3 {
        return Err("New username must be at least 3 characters long.".to_string());
    }
    if new_password.trim().len() < 12 {
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
    fs::write(&path, json).map_err(|e| format!("Could not save new authentication credentials: {}", e))?;
    enforce_strict_permissions(&path)?;

    IS_AUTHENTICATED.store(true, Ordering::SeqCst);
    log::info!("SSH Desktop: Successfully updated master web credentials. User: '{}', file: {:?}", config.username, path);

    Ok(AuthActionResult {
        success: true,
        must_change_password: false,
        username: config.username,
        message: Some("Credentials successfully changed and saved securely.".to_string()),
    })
}

#[tauri::command]
pub async fn auth_logout() -> Result<bool, String> {
    IS_AUTHENTICATED.store(false, Ordering::SeqCst);
    log::info!("SSH Desktop: Web session logged out.");
    Ok(true)
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
}
