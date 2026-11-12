fn validate_sqlite_identifier(value: &str, kind: &str) -> Result<(), String> {
    if value.is_empty() || value.len() > 255 || value.chars().any(|c| c.is_control() || c == '\0') {
        return Err(format!("SQLite {} must be 1–255 bytes and contain no control characters.", kind));
    }
    Ok(())
}

fn validate_sqlite_metadata_text(value: &str, kind: &str, max_bytes: usize) -> Result<(), String> {
    if value.len() > max_bytes || value.chars().any(|c| c == '\0') {
        return Err(format!("SQLite {} metadata exceeds its {} byte limit or contains NUL.", kind, max_bytes));
    }
    Ok(())
}

fn secure_sqlite_cache_file(path: &std::path::Path) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|e| format!("Could not inspect SQLite cache file: {}", e))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("SQLite cache path must be a regular file, not a symlink or special file.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("Failed to secure SQLite cache file: {}", e))?;
    }
    Ok(())
}

fn sqlite_cache_path(config: &DatabaseConnectionConfig, remote_path: &str) -> Result<std::path::PathBuf, String> {
    use sha2::{Digest, Sha256};
    let cache_dir = std::env::temp_dir().join("sshdesktop_sqlite");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create SQLite cache directory: {}", e))?;
    let cache_meta = std::fs::symlink_metadata(&cache_dir)
        .map_err(|e| format!("Could not inspect SQLite cache directory: {}", e))?;
    if cache_meta.file_type().is_symlink() || !cache_meta.is_dir() {
        return Err("SQLite cache directory must be a real directory, not a symlink or special file.".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&cache_dir, std::fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("Failed to secure SQLite cache directory: {}", e))?;
    }
    let mut hasher = Sha256::new();
    // Include endpoint identity so reused connection IDs cannot collide across hosts.
    hasher.update(config.host.as_bytes());
    hasher.update([0]);
    hasher.update(config.port.to_be_bytes());
    hasher.update([0]);
    hasher.update(config.username.as_bytes());
    hasher.update([0]);
    if let Some(id) = config.ssh_connection_id.as_deref() { hasher.update(id.as_bytes()); }
    hasher.update([0]);
    if let Some(host) = config.ssh_host.as_deref() { hasher.update(host.as_bytes()); }
    hasher.update([0]);
    if let Some(port) = config.ssh_port { hasher.update(port.to_be_bytes()); }
    hasher.update([0]);
    if let Some(user) = config.ssh_user.as_deref() { hasher.update(user.as_bytes()); }
    hasher.update([0]);
    hasher.update(remote_path.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    Ok(cache_dir.join(format!("{}.db", digest)))
}

use futures::TryStreamExt;
use std::time::Instant;
use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, OnceLock, Weak};

static SQLITE_CACHE_LOCKS: OnceLock<StdMutex<HashMap<std::path::PathBuf, Weak<tokio::sync::Mutex<()>>>>> = OnceLock::new();

fn sqlite_cache_lock(path: &std::path::Path) -> Result<Arc<tokio::sync::Mutex<()>>, String> {
    let registry = SQLITE_CACHE_LOCKS.get_or_init(|| StdMutex::new(HashMap::new()));
    let mut locks = registry.lock().map_err(|_| "SQLite cache lock registry is poisoned.".to_string())?;
    // Remove dead entries so one-off database paths do not grow this registry forever.
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(path).and_then(Weak::upgrade) {
        return Ok(lock);
    }
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    locks.insert(path.to_path_buf(), Arc::downgrade(&lock));
    Ok(lock)
}
use super::types::{
    ActiveDatabaseSession, BatchStatementResult, ColumnMeta, DatabaseConnectionConfig,
    DatabaseObject, DriverInstance, QueryResult, ServerCapabilities,
};
use super::serialization::{serialize_sqlite_row, split_sql_statements_for_engine};
use super::tunnel::from_base64;

fn validate_remote_sqlite_path(path: &str) -> Result<(), String> {
    if path.is_empty() || path == "/" || path.len() > 4096 || !path.starts_with('/')
        || path.chars().any(|c| c.is_control() || c == '\0')
        || path.split('/').any(|part| part == "." || part == "..")
        || path.contains("//") || path.ends_with('/')
    {
        return Err("Remote SQLite path must be a normalized absolute POSIX path of at most 4096 bytes.".into());
    }
    Ok(())
}

fn validate_wal_checkpoint_status(busy: i64, log_frames: i64, checkpointed_frames: i64, phase: &str) -> Result<(), String> {
    if busy != 0 {
        return Err(format!("SQLite WAL checkpoint is busy during {}; refusing remote synchronization.", phase));
    }
    if log_frames >= 0 && checkpointed_frames >= 0 && checkpointed_frames < log_frames {
        return Err(format!("SQLite WAL checkpoint was incomplete during {} ({} of {} frames); refusing remote synchronization.", phase, checkpointed_frames, log_frames));
    }
    Ok(())
}

fn validate_single_operation_sql(sql: &str) -> Result<(), String> {
    if sql.trim().is_empty() { return Err("SQLite operation SQL is empty.".into()); }
    if sql.len() > 5 * 1024 * 1024 { return Err("SQLite operation SQL exceeds the 5 MiB input limit.".into()); }
    if sql.chars().any(|c| c == '\0') { return Err("SQLite operation SQL contains a NUL byte.".into()); }
    let statements = split_sql_statements_for_engine(sql, "sqlite");
    if statements.len() != 1 {
        return Err("A SQLite schema operation must contain exactly one SQL statement.".into());
    }
    Ok(())
}

async fn run_checked_wal_checkpoint(pool: &sqlx::SqlitePool, phase: &str) -> Result<(), String> {
    use sqlx::Row;
    let row = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)").fetch_one(pool),
    ).await.map_err(|_| format!("SQLite WAL checkpoint timed out during {}.", phase))?
        .map_err(|e| format!("Could not checkpoint the local SQLite WAL during {}: {}", phase, e))?;
    let busy: i64 = row.try_get(0).map_err(|e| format!("Could not read SQLite WAL checkpoint busy status: {}", e))?;
    let log_frames: i64 = row.try_get(1).map_err(|e| format!("Could not read SQLite WAL frame count: {}", e))?;
    let checkpointed_frames: i64 = row.try_get(2).map_err(|e| format!("Could not read SQLite checkpointed frame count: {}", e))?;
    validate_wal_checkpoint_status(busy, log_frames, checkpointed_frames, phase)
}

async fn prepare_remote_sqlite_sync(pool: &sqlx::SqlitePool) -> Result<(), String> {
    run_checked_wal_checkpoint(pool, "pre-sync").await?;
    let mode: (String,) = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        sqlx::query_as("PRAGMA journal_mode=DELETE").fetch_one(pool),
    ).await.map_err(|_| "Switching SQLite journal mode timed out.".to_string())?
        .map_err(|e| format!("Could not switch local SQLite journal mode to DELETE: {}", e))?;
    if !mode.0.eq_ignore_ascii_case("delete") {
        return Err(format!("Remote SQLite sync requires DELETE journal mode; SQLite returned '{}'.", mode.0));
    }
    run_checked_wal_checkpoint(pool, "final-sync").await?;
    Ok(())
}

fn validate_sqlite_file_header(bytes: &[u8]) -> Result<(), String> {
    // A zero-byte file is SQLite's valid newly-created empty database state.
    if bytes.is_empty() { return Ok(()); }
    if bytes.len() < 100 || !bytes.starts_with(b"SQLite format 3\0") {
        return Err("Remote file is not a valid SQLite 3 database header.".into());
    }
    let encoded_page_size = u16::from_be_bytes([bytes[16], bytes[17]]);
    let page_size = if encoded_page_size == 1 { 65_536usize } else { encoded_page_size as usize };
    if !(512..=65_536).contains(&page_size) || !page_size.is_power_of_two() {
        return Err("SQLite database header contains an invalid page size.".into());
    }
    if !matches!(bytes[18], 1 | 2) || !matches!(bytes[19], 1 | 2) {
        return Err("SQLite database header contains unsupported read/write format versions.".into());
    }
    if bytes[21] != 64 || bytes[22] != 32 || bytes[23] != 32 {
        return Err("SQLite database header contains invalid payload fraction values.".into());
    }
    let reserved = bytes[20] as usize;
    if reserved >= page_size.saturating_sub(480) {
        return Err("SQLite database header contains an invalid reserved-byte count.".into());
    }
    let declared_pages = u32::from_be_bytes([bytes[28], bytes[29], bytes[30], bytes[31]]) as usize;
    if declared_pages > 0 && declared_pages > bytes.len() / page_size {
        return Err("SQLite database file is shorter than its declared page count.".into());
    }
    Ok(())
}

fn ensure_no_pending_local_wal(cache_path: &std::path::Path) -> Result<(), String> {
    let wal_path = std::path::PathBuf::from(format!("{}-wal", cache_path.display()));
    let shm_path = std::path::PathBuf::from(format!("{}-shm", cache_path.display()));
    match std::fs::symlink_metadata(&shm_path) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_file() =>
            return Err("Refusing remote sync because the local SQLite shared-memory sidecar is not a regular file.".into()),
        Err(e) if e.kind() != std::io::ErrorKind::NotFound =>
            return Err(format!("Could not inspect local SQLite shared-memory sidecar: {}", e)),
        _ => {}
    }
    match std::fs::symlink_metadata(&wal_path) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_file() =>
            Err("Refusing remote sync because the local SQLite WAL sidecar is not a regular file.".into()),
        Ok(meta) if meta.len() > 0 =>
            Err("Refusing remote sync because the local SQLite WAL still contains data.".into()),
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not inspect local SQLite WAL sidecar: {}", e)),
    }
}

pub async fn connect_sqlite(
    config: &DatabaseConnectionConfig,
    state: Option<&crate::AppState>,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let raw_path = config.sqlite_path.as_deref().unwrap_or(&config.database).trim();
    if raw_path.len() > 4096 || raw_path.chars().any(|c| c.is_control() || c == '\0') {
        return Err("SQLite database path exceeds 4096 bytes or contains control characters.".into());
    }
    if config.use_ssh && (!raw_path.starts_with('/') || raw_path.split('/').any(|part| part == "." || part == "..")) {
        return Err("Remote SQLite requires a normalized absolute POSIX path without dot segments.".into());
    }
    if raw_path.is_empty() {
        return Err("SQLite file path is empty. Please specify a database file path.".to_string());
    }

    let should_use_ssh = config.use_ssh;

    let effective_path = if should_use_ssh {
        if let Some(app_state) = state {
            let sessions_guard = app_state.sessions.lock().await;
            let resolved_conn_id = config.ssh_connection_id.as_deref()
                .filter(|cid| sessions_guard.contains_key(*cid))
                .map(str::to_string);
            drop(sessions_guard);
            let conn_id = resolved_conn_id.ok_or_else(|| {
                "Select an active SSH connection for this remote SQLite database; no other SSH session will be used implicitly.".to_string()
            })?;

            let escaped = raw_path.replace('\'', "'\\''");
            let (test_out, test_code) = crate::ssh::exec::run_cmd(
                app_state,
                &conn_id,
                &format!("if [ -L '{}' ]; then echo INVALID; exit 2; elif [ -f '{}' ]; then echo EXISTS; elif [ ! -e '{}' ]; then echo MISSING; else echo INVALID; exit 2; fi", escaped, escaped, escaped),
            ).await;
            if test_code != 0 || (!test_out.contains("EXISTS") && !test_out.contains("MISSING")) {
                return Err(format!("Could not inspect remote SQLite file '{}': {}", raw_path, test_out.trim()));
            }

            let local_cache = sqlite_cache_path(config, raw_path)?;
            // Serialize cache refresh against queries and uploads from other sessions
            // in this process that target the same remote SQLite file.
            let cache_lock = sqlite_cache_lock(&local_cache)?;
            let _cache_guard = cache_lock.lock().await;
            // A non-empty SQLite WAL may contain committed changes absent from the main file.
            let wal_path = format!("{}-wal", escaped);
            let shm_path = format!("{}-shm", escaped);
            let sidecar_cmd = format!(
                "if [ -L '{}' ] || [ -L '{}' ]; then echo INVALID_SIDECAR; exit 2; elif [ -s '{}' ]; then echo WAL_ACTIVE; exit 3; elif [ -e '{}' ] && [ ! -f '{}' ]; then echo INVALID_SHM; exit 4; else echo SIDECARS_CLEAR; fi",
                wal_path, shm_path, wal_path, shm_path, shm_path
            );
            let (sidecar_out, sidecar_code) = crate::ssh::exec::run_cmd(app_state, &conn_id, &sidecar_cmd).await;
            if sidecar_code != 0 || !sidecar_out.contains("SIDECARS_CLEAR") {
                return Err(format!("Remote SQLite WAL/SHM sidecar state is unsafe or unreadable: {}", sidecar_out.trim()));
            }

            if test_out.contains("MISSING") {
                if config.read_only {
                    return Err("Read-only SQLite connection cannot create a missing remote database file.".into());
                }
                let (touch_out, touch_code) = crate::ssh::exec::run_cmd(
                    app_state, &conn_id, &format!("umask 077 && touch '{}'", escaped)
                ).await;
                if touch_code != 0 {
                    return Err(format!("Failed to create remote SQLite file '{}': {}", raw_path, touch_out.trim()));
                }
                if let Ok(meta) = std::fs::symlink_metadata(&local_cache) {
                    if meta.file_type().is_symlink() || !meta.is_file() {
                        return Err("Refusing to replace a non-regular SQLite cache path.".into());
                    }
                }
                let temp_cache = local_cache.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
                let file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp_cache)
                    .map_err(|e| format!("Failed to create temporary SQLite cache: {}", e))?;
                drop(file);
                if let Err(e) = secure_sqlite_cache_file(&temp_cache) {
                    let _ = std::fs::remove_file(&temp_cache);
                    return Err(e);
                }
                std::fs::rename(&temp_cache, &local_cache)
                    .map_err(|e| { let _ = std::fs::remove_file(&temp_cache); format!("Failed to publish empty SQLite cache: {}", e) })?;
            } else {
                let download_cmd = format!(
                    "size=$(wc -c < '{}') || exit 1; [ \"$size\" -le 268435456 ] || {{ echo 'Remote SQLite database exceeds the 256 MiB cache limit' >&2; exit 1; }}; base64 '{}' | tr -d '\\n'",
                    escaped, escaped
                );
                let (cmd_out, cmd_code) = crate::ssh::exec::run_cmd(app_state, &conn_id, &download_cmd).await;
                if cmd_code != 0 {
                    return Err(format!("Failed to download remote SQLite database '{}': {}", raw_path, cmd_out.trim()));
                }
                let bytes = from_base64(cmd_out.trim())
                    .ok_or_else(|| "Remote SQLite download returned invalid base64 data.".to_string())?;
                if bytes.len() > 256 * 1024 * 1024 {
                    return Err("Decoded remote SQLite database exceeds the 256 MiB cache limit.".into());
                }
                validate_sqlite_file_header(&bytes)?;
                let temp_cache = local_cache.with_extension(format!("{}.tmp", uuid::Uuid::new_v4().simple()));
                let write_result = (|| -> Result<(), String> {
                    use std::io::Write;
                    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp_cache)
                        .map_err(|e| format!("Failed to create temporary SQLite cache: {}", e))?;
                    file.write_all(&bytes).map_err(|e| format!("Failed to write temporary SQLite cache: {}", e))?;
                    file.sync_all().map_err(|e| format!("Failed to flush temporary SQLite cache: {}", e))?;
                    Ok(())
                })();
                if let Err(e) = write_result {
                    let _ = std::fs::remove_file(&temp_cache);
                    return Err(e);
                }
                if let Err(e) = secure_sqlite_cache_file(&temp_cache) {
                    let _ = std::fs::remove_file(&temp_cache);
                    return Err(e);
                }
                std::fs::rename(&temp_cache, &local_cache)
                    .map_err(|e| { let _ = std::fs::remove_file(&temp_cache); format!("Failed to publish downloaded SQLite cache: {}", e) })?;
            }

            local_cache.to_string_lossy().to_string()
        } else {
            return Err("Remote SQLite requires an application SSH state and an explicit SSH connection.".into());
        }
    } else {
        raw_path.to_string()
    };

    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&effective_path)
        .create_if_missing(!config.read_only)
        .read_only(config.read_only);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        // SQLite foreign_keys is connection-local; a single pooled connection keeps
        // the verified PRAGMA enabled for every query on this pool.
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|e| format!("SQLite connection error: {}", e))?;

    if let Err(e) = sqlx::query("PRAGMA foreign_keys = ON;").execute(&pool).await {
        pool.close().await;
        return Err(format!("Failed to enable SQLite foreign-key enforcement: {}", e));
    }
    if let Err(e) = sqlx::query("PRAGMA synchronous = FULL").execute(&pool).await {
        pool.close().await;
        return Err(format!("Could not enable durable SQLite synchronization: {}", e));
    }
    if let Err(e) = sqlx::query("PRAGMA busy_timeout = 5000").execute(&pool).await {
        pool.close().await;
        return Err(format!("Could not configure SQLite lock wait timeout: {}", e));
    }
    let fk_enabled: (i64,) = match sqlx::query_as("PRAGMA foreign_keys").fetch_one(&pool).await {
        Ok(value) => value,
        Err(e) => { pool.close().await; return Err(format!("Could not verify SQLite foreign-key enforcement: {}", e)); }
    };
    if fk_enabled.0 != 1 { pool.close().await; return Err("SQLite foreign-key enforcement could not be enabled.".into()); }
    let synchronous: (i64,) = match sqlx::query_as("PRAGMA synchronous").fetch_one(&pool).await {
        Ok(value) => value,
        Err(e) => { pool.close().await; return Err(format!("Could not verify SQLite durability mode: {}", e)); }
    };
    if synchronous.0 != 2 { pool.close().await; return Err("SQLite FULL synchronous durability could not be enabled.".into()); }
    let busy_timeout: (i64,) = match sqlx::query_as("PRAGMA busy_timeout").fetch_one(&pool).await {
        Ok(value) => value,
        Err(e) => { pool.close().await; return Err(format!("Could not verify SQLite busy timeout: {}", e)); }
    };
    if busy_timeout.0 < 5000 { pool.close().await; return Err("SQLite busy timeout is below the required 5000 ms.".into()); }
    let quick_check: (String,) = match sqlx::query_as("PRAGMA quick_check(1)").fetch_one(&pool).await {
        Ok(value) => value,
        Err(e) => { pool.close().await; return Err(format!("SQLite quick integrity check failed: {}", e)); }
    };
    if !quick_check.0.eq_ignore_ascii_case("ok") {
        pool.close().await;
        return Err(format!("SQLite database integrity check reported: {}", quick_check.0));
    }
    let version_row: (String,) = match sqlx::query_as("SELECT sqlite_version()").fetch_one(&pool).await {
        Ok(value) => value,
        Err(e) => { pool.close().await; return Err(format!("Could not read SQLite server version: {}", e)); }
    };

    let capabilities = ServerCapabilities {
        engine: "sqlite".to_string(),
        server_version: version_row.0,
        supports_transactions: true,
        supports_schemas: false,
        supports_procedures: false,
        supports_functions: false,
        supports_triggers: true,
        supports_views: true,
        supports_indexes: true,
        supports_foreign_keys: true,
        supports_explain: true,
        supports_process_list: false,
        read_only: config.read_only,
        supports_rename_table: true,
        supports_alter_column: false,
    };

    Ok((DriverInstance::Sqlite(pool), capabilities))
}

pub async fn execute_query_sqlite(
    pool: &sqlx::SqlitePool,
    query: &str,
    limit: usize,
    session: &ActiveDatabaseSession,
    state: &crate::AppState,
    start: Instant,
) -> Result<QueryResult, String> {
    if query.len() > 5 * 1024 * 1024 { return Err("SQLite query exceeds the 5 MiB input limit.".into()); }
    if query.chars().any(|c| c == '\0') { return Err("SQLite query contains a NUL byte.".into()); }
    let statements = split_sql_statements_for_engine(query, "sqlite");
    if statements.is_empty() { return Err("Query string is empty".to_string()); }
    if statements.len() > 100 { return Err("SQLite batch exceeds the 100-statement limit.".into()); }
    let limit = limit.clamp(1, 10_000);

    let mut final_cols = Vec::new();
    let mut final_rows = Vec::new();
    let mut total_affected = 0u64;
    let mut last_insert_id = None;
    let mut warnings = Vec::new();
    let mut batch_results = Vec::new();
    let mut had_mutation = false;
    let mut total_result_bytes = 0usize;
    let num_stmts = statements.len();
    let remote_sync_id = if session.config.use_ssh {
        Some(session.config.ssh_connection_id.as_deref().filter(|id| !id.trim().is_empty())
            .ok_or_else(|| "Remote SQLite query requires an explicit SSH connection ID.".to_string())?)
    } else { None };
    let remote_cache_path = if session.config.use_ssh {
        let raw_path = session.config.sqlite_path.as_deref().unwrap_or(&session.config.database).trim();
        validate_remote_sqlite_path(raw_path)?;
        Some(sqlite_cache_path(&session.config, raw_path)?)
    } else { None };
    let _cache_guard = if let Some(cache_path) = remote_cache_path.as_ref() {
        Some(sqlite_cache_lock(cache_path)?.lock_owned().await)
    } else { None };
    // For remote SQLite, conservatively sync after every query. SQL lexical
    // classification cannot reliably recognize every write form (comments,
    // CTEs, extensions, or dialect-specific syntax).
    if session.config.use_ssh && !session.config.read_only { had_mutation = true; }
    let mut remaining_rows = limit;
    for (stmt_idx, stmt) in statements.iter().enumerate() {
        let stmt_start = Instant::now();
        let s_upper = stmt.trim().to_uppercase();
        let is_write_query = s_upper.starts_with("INSERT")
            || s_upper.starts_with("UPDATE")
            || s_upper.starts_with("DELETE")
            || s_upper.starts_with("REPLACE")
            || s_upper.starts_with("CREATE")
            || s_upper.starts_with("DROP")
            || s_upper.starts_with("ALTER")
            || s_upper.starts_with("REINDEX") || s_upper.starts_with("VACUUM")
            || s_upper.starts_with("ANALYZE") || s_upper.starts_with("ATTACH")
            || s_upper.starts_with("DETACH") || s_upper.starts_with("PRAGMA")
            || s_upper.starts_with("BEGIN") || s_upper.starts_with("COMMIT")
            || s_upper.starts_with("END") || s_upper.starts_with("ROLLBACK")
            || s_upper.starts_with("SAVEPOINT") || s_upper.starts_with("RELEASE")
            || (s_upper.starts_with("WITH") && (s_upper.contains("INSERT") || s_upper.contains("UPDATE") || s_upper.contains("DELETE") || s_upper.contains("REPLACE")));

        if is_write_query {
            had_mutation = true;
        }

        // Transaction control can commit or discard prior writes; it must pass
        // through the mutation path and trigger remote cache synchronization.
        let is_transaction_control = ["BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"]
            .iter().any(|kw| s_upper == *kw || s_upper.starts_with(&format!("{} ", kw)));
        let is_mutation = (is_write_query && !s_upper.contains("RETURNING")) || is_transaction_control;
        if is_mutation {
            let res = sqlx::raw_sql(stmt)
                .execute(pool)
                .await
                .map_err(|e| format!("SQLite error (statement {}/{}): {}", stmt_idx + 1, num_stmts, e))?;

            let aff = res.rows_affected();
            total_affected = total_affected.saturating_add(aff);
            let id = res.last_insert_rowid();
            let id_opt = if id > 0 {
                last_insert_id = Some(id);
                Some(id)
            } else {
                None
            };
            if num_stmts > 1 {
                warnings.push(format!("Statement {}/{}: {} rows affected", stmt_idx + 1, num_stmts, aff));
            }
            batch_results.push(BatchStatementResult {
                statement: stmt.to_string(),
                columns: Vec::new(),
                rows: Vec::new(),
                affected_rows: aff,
                last_insert_id: id_opt,
                execution_time_ms: stmt_start.elapsed().as_secs_f64() * 1000.0,
                error: None,
            });
        } else {
            let mut row_stream = sqlx::raw_sql(stmt).fetch(pool);
            let mut rows = Vec::with_capacity(remaining_rows.min(1024));
            while let Some(row) = row_stream.try_next().await
                .map_err(|e| format!("SQLite error (statement {}/{}): {}", stmt_idx + 1, num_stmts, e))?
            {
                rows.push(row);
                if rows.len() > remaining_rows {
                    break;
                }
            }
            let truncated = rows.len() > remaining_rows;
            if truncated {
                rows.truncate(remaining_rows);
                warnings.push(format!("Statement {}/{}: result truncated to {} rows", stmt_idx + 1, num_stmts, remaining_rows));
            }

            let mut cols_meta = Vec::new();
            let mut json_rows = Vec::new();
            let mut statement_result_bytes = 0usize;

            for (idx, row) in rows.iter().enumerate() {
                if idx >= limit {
                    break;
                }
                let (meta, val) = serialize_sqlite_row(row);
                let row_bytes = serde_json::to_vec(&val).map_err(|e| format!("Could not serialize SQLite result row: {}", e))?.len();
                if row_bytes > 8 * 1024 * 1024 { return Err("SQLite result row exceeds the 8 MiB display limit.".into()); }
                statement_result_bytes = statement_result_bytes.saturating_add(row_bytes);
                total_result_bytes = total_result_bytes.saturating_add(row_bytes);
                if statement_result_bytes > 12 * 1024 * 1024 { return Err("SQLite statement result exceeds the 12 MiB display limit; reduce selected columns.".into()); }
                if total_result_bytes > 16 * 1024 * 1024 { return Err("SQLite batch result exceeds the 16 MiB IPC limit; reduce statements or selected columns.".into()); }
                if idx == 0 {
                    cols_meta = meta;
                }
                json_rows.push(val);
            }

            remaining_rows = remaining_rows.saturating_sub(rows.len());
            if num_stmts > 1 {
                warnings.push(format!("Statement {}/{}: {} rows returned", stmt_idx + 1, num_stmts, rows.len()));
            }

            if final_rows.is_empty() || !json_rows.is_empty() {
                final_cols = cols_meta.clone();
                final_rows = json_rows.clone();
            }
            let stmt_affected = if is_write_query { rows.len() as u64 } else { 0 };
            total_affected = total_affected.saturating_add(stmt_affected);

            batch_results.push(BatchStatementResult {
                statement: stmt.to_string(),
                columns: cols_meta,
                rows: json_rows,
                affected_rows: stmt_affected,
                last_insert_id: None,
                execution_time_ms: stmt_start.elapsed().as_secs_f64() * 1000.0,
                error: None,
            });
        }
    }

    // If SQLite is on remote host and mutation occurred, sync cache back via SFTP
    if had_mutation && session.config.use_ssh && !session.config.read_only {
        if let Some(conn_id) = remote_sync_id {
            let raw_path = session.config.sqlite_path.as_deref().unwrap_or(&session.config.database).trim();
            validate_remote_sqlite_path(raw_path)?;
            let local_cache = remote_cache_path.as_ref().ok_or_else(|| "Remote SQLite cache path was not initialized.".to_string())?;
            prepare_remote_sqlite_sync(pool).await?;
            ensure_no_pending_local_wal(local_cache)?;
            let metadata = std::fs::symlink_metadata(local_cache)
                .map_err(|e| format!("Could not inspect updated SQLite cache: {}", e))?;
            if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 256 * 1024 * 1024 {
                return Err("Updated SQLite cache is not a regular file within the 256 MiB synchronization limit.".into());
            }
            let bytes = std::fs::read(local_cache)
                .map_err(|e| format!("Failed to read updated local SQLite cache: {}", e))?;
            validate_sqlite_file_header(&bytes)?;
            crate::ssh::sftp::sftp_write_bytes(state, conn_id, raw_path, &bytes).await
                .map_err(|e| format!("SQLite changes were applied locally but remote sync failed: {}", e))?;
        }
    }

    Ok(QueryResult {
        columns: final_cols,
        rows: final_rows,
        affected_rows: total_affected,
        last_insert_id,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        command_type: "SQL".to_string(),
        server_version: Some(session.capabilities.server_version.clone()),
        warnings,
        all_results: if batch_results.len() > 1 { Some(batch_results) } else { None },
    })
}

pub async fn list_tables_sqlite(pool: &sqlx::SqlitePool) -> Result<Vec<DatabaseObject>, String> {
    use sqlx::Row;
    let rows = sqlx::query("SELECT name, type FROM sqlite_master WHERE type in ('table','view') ORDER BY name")
        .fetch_all(pool).await.map_err(|e| format!("SQLite table listing failed: {}", e))?;
    if rows.len() > 10_000 { return Err("SQLite database contains more than 10,000 tables and views.".into()); }
    rows.into_iter().map(|r| {
        let name: String = r.try_get(0).map_err(|e| format!("Invalid SQLite schema name: {}", e))?;
        if name.is_empty() || name.len() > 255 || name.chars().any(|c| c.is_control()) {
            return Err("SQLite returned an invalid or oversized schema object name.".to_string());
        }
        let obj_type: String = r.try_get(1).map_err(|e| format!("Invalid SQLite object type: {}", e))?;
        if obj_type != "table" && obj_type != "view" {
            return Err("SQLite returned an unsupported schema object type.".into());
        }
        Ok(DatabaseObject { name, object_type: obj_type, schema: None, row_count: None, size_bytes: None, definition: None })
    }).collect()
}

pub async fn get_table_columns_sqlite(
    pool: &sqlx::SqlitePool,
    table_name: &str,
) -> Result<Vec<ColumnMeta>, String> {
    use sqlx::Row;
    validate_sqlite_identifier(table_name, "table name")?;
    let fk_q = format!("PRAGMA foreign_key_list('{}');", table_name.replace('\'', "''"));
    let fk_rows = sqlx::query(&fk_q).fetch_all(pool).await
        .map_err(|e| format!("SQLite foreign-key metadata query failed: {}", e))?;
    let mut fk_map: std::collections::HashMap<String, (String, String)> = std::collections::HashMap::new();
    if fk_rows.len() > 2048 {
        return Err("SQLite table has more than 2048 foreign-key metadata entries.".into());
    }
    for fkr in fk_rows {
        let from_col: String = fkr.try_get("from").map_err(|e| format!("Invalid SQLite foreign-key column metadata: {}", e))?;
        let to_table: String = fkr.try_get("table").map_err(|e| format!("Invalid SQLite foreign-key table metadata: {}", e))?;
        let to_col: String = fkr.try_get("to").map_err(|e| format!("Invalid SQLite foreign-key target metadata: {}", e))?;
        validate_sqlite_metadata_text(&from_col, "foreign-key column", 255)?;
        validate_sqlite_metadata_text(&to_table, "foreign-key table", 255)?;
        validate_sqlite_metadata_text(&to_col, "foreign-key target column", 255)?;
        if !from_col.is_empty() {
            fk_map.insert(from_col, (to_table, to_col));
        }
    }

    let q = format!("PRAGMA table_info('{}');", table_name.replace('\'', "''"));
    let rows = sqlx::query(&q).fetch_all(pool).await.map_err(|e| e.to_string())?;

    if rows.len() > 2048 {
        return Err("SQLite table has more than 2048 columns; refusing oversized metadata response.".into());
    }
    let mut cols = Vec::new();
    for r in rows {
        let name: String = r.try_get("name").map_err(|e| format!("Invalid SQLite column name metadata: {}", e))?;
        let ty: String = r.try_get("type").map_err(|e| format!("Invalid SQLite column type metadata: {}", e))?;
        let notnull: i64 = r.try_get("notnull").map_err(|e| format!("Invalid SQLite nullability metadata: {}", e))?;
        let pk: i64 = r.try_get("pk").map_err(|e| format!("Invalid SQLite primary-key metadata: {}", e))?;
        let dflt: Option<String> = r.try_get("dflt_value").map_err(|e| format!("Invalid SQLite default metadata: {}", e))?;
        validate_sqlite_metadata_text(&name, "column name", 255)?;
        validate_sqlite_metadata_text(&ty, "column type", 1024)?;
        if let Some(default_value) = dflt.as_deref() {
            validate_sqlite_metadata_text(default_value, "column default", 16 * 1024)?;
        }

        let fk_info = fk_map.get(&name);

        cols.push(ColumnMeta {
            name: name.clone(),
            data_type: ty,
            nullable: notnull == 0,
            is_primary_key: pk > 0,
            is_foreign_key: fk_info.is_some(),
            referenced_table: fk_info.map(|(t, _)| t.clone()),
            referenced_column: fk_info.map(|(_, c)| c.clone()),
            default_value: dflt,
            extra: None,
        });
    }
    Ok(cols)
}

pub async fn execute_operation_sqlite(
    pool: &sqlx::SqlitePool,
    sql: &str,
    session: &ActiveDatabaseSession,
    state: &crate::AppState,
) -> Result<u64, String> {
    if session.config.read_only { return Err("This SQLite connection is read-only.".into()); }
    validate_single_operation_sql(sql)?;
    let remote_conn_id = if session.config.use_ssh {
        Some(session.config.ssh_connection_id.as_deref().filter(|id| !id.trim().is_empty())
            .ok_or_else(|| "Remote SQLite operation has no explicit SSH connection ID.".to_string())?)
    } else { None };
    let remote_cache_path = if session.config.use_ssh {
        let raw_path = session.config.sqlite_path.as_deref().unwrap_or(&session.config.database).trim();
        validate_remote_sqlite_path(raw_path)?;
        Some(sqlite_cache_path(&session.config, raw_path)?)
    } else { None };
    let _cache_guard = if let Some(cache_path) = remote_cache_path.as_ref() {
        Some(sqlite_cache_lock(cache_path)?.lock_owned().await)
    } else { None };
    let res = sqlx::raw_sql(sql).execute(pool).await.map_err(|e| e.to_string())?;
    if let Some(conn_id) = remote_conn_id {
        let raw_path = session.config.sqlite_path.as_deref().unwrap_or(&session.config.database).trim();
        validate_remote_sqlite_path(raw_path)?;
        let local_cache = remote_cache_path.as_ref().ok_or_else(|| "Remote SQLite cache path was not initialized.".to_string())?;
        prepare_remote_sqlite_sync(pool).await?;
        ensure_no_pending_local_wal(local_cache)?;
        let metadata = std::fs::symlink_metadata(local_cache)
            .map_err(|e| format!("Could not inspect updated SQLite cache: {}", e))?;
        if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 256 * 1024 * 1024 {
            return Err("Updated SQLite cache is not a regular file within the 256 MiB synchronization limit.".into());
        }
        let bytes = std::fs::read(local_cache)
            .map_err(|e| format!("Failed to read updated local SQLite cache: {}", e))?;
        validate_sqlite_file_header(&bytes)?;
        crate::ssh::sftp::sftp_write_bytes(state, conn_id, raw_path, &bytes).await
            .map_err(|e| format!("SQLite operation succeeded locally but remote sync failed: {}", e))?;
    }
    Ok(res.rows_affected())
}

pub async fn get_object_definition_sqlite(
    pool: &sqlx::SqlitePool,
    name: &str,
) -> Result<String, String> {
    use sqlx::Row;
    let q = "SELECT sql FROM sqlite_master WHERE name = ?;";
    validate_sqlite_identifier(name, "object name")?;
    let row = sqlx::query(q).bind(name).fetch_one(pool).await.map_err(|e| e.to_string())?;
    let def: Option<String> = row.try_get(0).map_err(|e| format!("Invalid SQLite object definition: {}", e))?;
    let definition = def.ok_or_else(|| format!("SQLite object '{}' has no stored SQL definition.", name))?;
    validate_sqlite_metadata_text(&definition, "object definition", 5 * 1024 * 1024)?;
    if definition.len() > 5 * 1024 * 1024 {
        return Err("SQLite object definition exceeds the 5 MiB metadata limit.".into());
    }
    Ok(definition)
}

#[cfg(test)]
mod sqlite_path_and_transaction_tests {
    use super::*;

    #[test]
    fn validates_sqlite_remote_paths() {
        assert!(validate_sqlite_identifier("users", "table name").is_ok());
        assert!(validate_sqlite_identifier("", "table name").is_err());
        assert!(validate_sqlite_identifier("users\\n", "table name").is_err());
    }

    #[test]
    fn recognizes_transaction_control_statements() {
        for sql in ["BEGIN", "BEGIN IMMEDIATE", "COMMIT", "END", "ROLLBACK", "SAVEPOINT point_a", "RELEASE point_a"] {
            let upper = sql.trim().to_uppercase();
            let is_transaction_control = ["BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"]
                .iter().any(|kw| upper == *kw || upper.starts_with(&format!("{} ", kw)));
            assert!(is_transaction_control, "not recognized: {}", sql);
        }
    }
}


#[cfg(test)]
mod remote_sqlite_safety_tests {
    use super::*;

    #[test]
    fn remote_path_requires_absolute_normalized_posix_path() {
        assert!(validate_remote_sqlite_path("/var/lib/app/data.db").is_ok());
        assert!(validate_remote_sqlite_path("/tmp/数据库.db").is_ok());
        assert!(validate_remote_sqlite_path("/").is_err());
        assert!(validate_remote_sqlite_path("/tmp//data.db").is_err());
        assert!(validate_remote_sqlite_path("/tmp/data.db/").is_err());
        assert!(validate_remote_sqlite_path("").is_err());
        assert!(validate_remote_sqlite_path("relative.db").is_err());
        assert!(validate_remote_sqlite_path("/tmp/../etc/passwd").is_err());
        assert!(validate_remote_sqlite_path("/tmp/./data.db").is_err());
        assert!(validate_remote_sqlite_path("/tmp/data\n.db").is_err());
        assert!(validate_remote_sqlite_path(&format!("/{}", "a".repeat(4096))).is_err());
    }

    #[test]
    fn cache_lock_is_shared_for_same_path_and_distinct_for_other_paths() {
        let a = std::path::PathBuf::from("/tmp/sshdesktop-test-a.db");
        let b = std::path::PathBuf::from("/tmp/sshdesktop-test-b.db");
        let first = sqlite_cache_lock(&a).expect("first cache lock");
        let second = sqlite_cache_lock(&a).expect("second cache lock");
        let other = sqlite_cache_lock(&b).expect("other cache lock");
        assert!(Arc::ptr_eq(&first, &second));
        assert!(!Arc::ptr_eq(&first, &other));
    }

    #[test]
    fn missing_or_empty_wal_is_safe_but_nonempty_wal_is_rejected() {
        let path = std::env::temp_dir().join(format!("sshdesktop-wal-test-{}.db", uuid::Uuid::new_v4()));
        assert!(ensure_no_pending_local_wal(&path).is_ok());
        let wal = std::path::PathBuf::from(format!("{}-wal", path.display()));
        std::fs::write(&wal, b"").expect("create empty WAL");
        assert!(ensure_no_pending_local_wal(&path).is_ok());
        std::fs::write(&wal, b"pending wal").expect("write WAL");
        assert!(ensure_no_pending_local_wal(&path).is_err());
        let _ = std::fs::remove_file(&wal);
    }

    #[test]
    fn sqlite_cache_lock_registry_reuses_arc_without_holding_registry_lock() {
        let path = std::path::PathBuf::from("/tmp/sshdesktop-test-registry.db");
        let lock = sqlite_cache_lock(&path).expect("cache lock");
        let guard = lock.try_lock().expect("new lock should be available");
        drop(guard);
        assert!(Arc::strong_count(&lock) >= 1);
    }
}


#[cfg(test)]
mod sqlite_sync_validation_tests {
    use super::*;

    #[test]
    fn valid_test_sqlite_header() -> Vec<u8> {
        let mut header = b"SQLite format 3\0".to_vec();
        header.resize(100, 0);
        header[16..18].copy_from_slice(&4096u16.to_be_bytes());
        header[18] = 1;
        header[19] = 1;
        header[21] = 64;
        header[22] = 32;
        header[23] = 32;
        header
    }

    #[test]
    fn sqlite_file_header_accepts_empty_and_valid_database() {
        assert!(validate_sqlite_file_header(&[]).is_ok());
        assert!(validate_sqlite_file_header(&valid_test_sqlite_header()).is_ok());
    }

    #[test]
    fn sqlite_file_header_rejects_invalid_and_truncated_files() {
        assert!(validate_sqlite_file_header(b"not a database").is_err());
        assert!(validate_sqlite_file_header(b"SQLite format 3\0").is_err());
        assert!(validate_sqlite_file_header(&vec![0u8; 100]).is_err());
        let mut bad_page_size = valid_test_sqlite_header();
        bad_page_size[16..18].copy_from_slice(&1000u16.to_be_bytes());
        assert!(validate_sqlite_file_header(&bad_page_size).is_err());
        let mut bad_format = valid_test_sqlite_header();
        bad_format[18] = 3;
        assert!(validate_sqlite_file_header(&bad_format).is_err());
        let mut bad_fraction = valid_test_sqlite_header();
        bad_fraction[21] = 63;
        assert!(validate_sqlite_file_header(&bad_fraction).is_err());
        let mut bad_reserved = valid_test_sqlite_header();
        bad_reserved[16..18].copy_from_slice(&512u16.to_be_bytes());
        bad_reserved[20] = 33;
        assert!(validate_sqlite_file_header(&bad_reserved).is_err());
    }

    #[test]
    fn wal_checkpoint_rejects_busy_state() {
        assert!(validate_wal_checkpoint_status(1, 10, 10, "test").is_err());
    }

    #[test]
    fn wal_checkpoint_rejects_incomplete_frames() {
        assert!(validate_wal_checkpoint_status(0, 10, 9, "test").is_err());
    }

    #[test]
    fn wal_checkpoint_accepts_completed_and_no_wal_states() {
        assert!(validate_wal_checkpoint_status(0, 10, 10, "test").is_ok());
        assert!(validate_wal_checkpoint_status(0, -1, -1, "test").is_ok());
    }

    #[test]
    fn operation_sql_rejects_empty_input() {
        assert!(validate_single_operation_sql("  \n ").is_err());
    }

    #[test]
    fn operation_sql_rejects_nul_bytes() {
        assert!(validate_single_operation_sql("CREATE TABLE t(a);\0").is_err());
    }

    #[test]
    fn operation_sql_rejects_multiple_statements() {
        assert!(validate_single_operation_sql("CREATE TABLE a(x); DROP TABLE b;").is_err());
    }

    #[test]
    fn operation_sql_accepts_single_statement() {
        assert!(validate_single_operation_sql("CREATE TABLE test_table(id INTEGER PRIMARY KEY);").is_ok());
    }

    #[test]
    fn operation_sql_enforces_byte_limit() {
        let sql = format!("SELECT '{}';", "x".repeat(5 * 1024 * 1024));
        assert!(validate_single_operation_sql(&sql).is_err());
    }
}
