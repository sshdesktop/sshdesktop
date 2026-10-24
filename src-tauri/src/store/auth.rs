use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use sha2::{Digest, Sha256};

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
        return etc_dir.join("auth.json");
    }

    // 2. User home directory ~/.sshdesktop/auth.json
    if let Some(base) = directories::BaseDirs::new() {
        let home_dot_dir = base.home_dir().join(".sshdesktop");
        let _ = fs::create_dir_all(&home_dot_dir);
        return home_dot_dir.join("auth.json");
    }

    // 3. Fallback to local .sshdesktop/auth.json
    let local = PathBuf::from(".sshdesktop");
    let _ = fs::create_dir_all(&local);
    local.join("auth.json")
}

/// Sets strict POSIX permissions (chmod 600) on Unix systems
pub fn enforce_strict_permissions(path: &PathBuf) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(path) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o600); // Read/Write only by owner
            let _ = fs::set_permissions(path, perms);
        }
    }
}

/// Secure salted SHA-256 password hashing
pub fn hash_password(password: &str, salt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(b"::sshdesktop_secure_auth_v2::");
    hasher.update(password.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Loads or auto-initializes the default admin/admin configuration
pub fn load_or_init_auth_config() -> (ServerAuthConfig, PathBuf) {
    let path = get_auth_file_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(config) = serde_json::from_str::<ServerAuthConfig>(&content) {
                return (config, path);
            }
        }
    }

    // Initialize default admin / admin credentials with mandatory change flag
    let salt = uuid::Uuid::new_v4().to_string();
    let default_config = ServerAuthConfig {
        username: "admin".to_string(),
        password_hash: hash_password("admin", &salt),
        salt,
        must_change_password: true,
        created_at: chrono::Utc::now().timestamp(),
        last_login_at: None,
    };

    if let Ok(json) = serde_json::to_string_pretty(&default_config) {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, json);
        enforce_strict_permissions(&path);
        log::info!("SSH Desktop: Initialized default web auth credentials in {:?}", path);
    }

    (default_config, path)
}

#[tauri::command]
pub async fn auth_get_status() -> Result<AuthStatusResponse, String> {
    let (config, path) = load_or_init_auth_config();
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
    let (mut config, path) = load_or_init_auth_config();
    let trimmed_user = username.trim();

    if trimmed_user != config.username {
        return Err("Invalid username or password.".to_string());
    }

    let calculated_hash = hash_password(&password, &config.salt);
    if calculated_hash != config.password_hash {
        return Err("Invalid username or password.".to_string());
    }

    IS_AUTHENTICATED.store(true, Ordering::SeqCst);
    config.last_login_at = Some(chrono::Utc::now().timestamp());
    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = fs::write(&path, json);
        enforce_strict_permissions(&path);
    }

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
    let (mut config, path) = load_or_init_auth_config();

    // Verify current password first
    let current_hash = hash_password(&current_password, &config.salt);
    if current_hash != config.password_hash {
        return Err("Current password verification failed. Please check your current password.".to_string());
    }

    let clean_user = new_username.trim();
    if clean_user.len() < 3 {
        return Err("New username must be at least 3 characters long.".to_string());
    }
    if new_password.trim().len() < 6 {
        return Err("New password must be at least 6 characters long.".to_string());
    }
    if new_password.trim() == "admin" {
        return Err("New password cannot be the default 'admin'. Please choose a secure password.".to_string());
    }

    let new_salt = uuid::Uuid::new_v4().to_string();
    config.username = clean_user.to_string();
    config.password_hash = hash_password(&new_password, &new_salt);
    config.salt = new_salt;
    config.must_change_password = false;
    config.last_login_at = Some(chrono::Utc::now().timestamp());

    if let Ok(json) = serde_json::to_string_pretty(&config) {
        let _ = fs::write(&path, json);
        enforce_strict_permissions(&path);
    }

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
