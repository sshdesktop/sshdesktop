use std::sync::Arc;
use std::time::Instant;

use super::types::{
    ActiveDatabaseSession, ColumnMeta, DatabaseConnectionConfig, DatabaseManager,
    DatabaseObject, DatabaseOperation, DriverInstance, OperationResult, QueryResult,
    ServerCapabilities,
};
use super::tunnel::setup_ssh_tunnel;
use super::dialect::{
    generate_add_column_sql, generate_create_index_sql, generate_create_table_sql,
    generate_drop_column_sql, generate_drop_index_sql, generate_drop_sql,
    generate_rename_sql, generate_truncate_table_sql,
};
use super::mysql::{
    connect_mysql, execute_operation_mysql, execute_query_mysql, get_object_definition_mysql,
    get_table_columns_mysql, list_tables_mysql,
};
use super::postgres::{
    connect_postgres, execute_operation_postgres, execute_query_postgres,
    get_object_definition_postgres, get_table_columns_postgres, list_tables_postgres,
};
use super::sqlite::{
    connect_sqlite, execute_operation_sqlite, execute_query_sqlite,
    get_object_definition_sqlite, get_table_columns_sqlite, list_tables_sqlite,
};
use super::mssql::{
    connect_mssql, execute_operation_mssql, execute_query_mssql,
    get_object_definition_mssql, get_table_columns_mssql, list_tables_mssql,
};
use super::mongo::{
    connect_mongo, execute_mongodb_query, execute_operation_mongo,
    get_collection_columns_mongo, get_object_definition_mongo, list_collections_mongo,
};
use super::redis::{
    connect_redis, execute_operation_redis, execute_query_redis,
    get_object_definition_redis, get_table_columns_redis, list_tables_redis,
};
use super::others::{
    connect_cassandra, connect_cosmos, connect_db2, connect_dynamodb, connect_oracle,
    execute_query_cassandra, execute_query_cosmos, execute_query_db2, execute_query_dynamodb,
    execute_query_oracle, get_object_definition_others, get_table_columns_cassandra,
    get_table_columns_cosmos, get_table_columns_db2, get_table_columns_dynamodb,
    get_table_columns_oracle, list_tables_cassandra, list_tables_cosmos, list_tables_db2,
    list_tables_dynamodb, list_tables_oracle,
};

pub use super::mongo::{mongodb_find_documents, mongodb_insert_document, mongodb_list_collections};
pub use super::redis::{redis_delete_key, redis_get_value, redis_scan_keys, redis_set_value};

// Validate shared connection input before opening tunnels or drivers.
fn validate_database_config(config: &DatabaseConnectionConfig) -> Result<(), String> {
    let id = config.id.trim();
    if id.is_empty() || id.len() > 128 || id.chars().any(|c| c.is_control()) {
        return Err("Database connection ID must be 1–128 bytes and contain no control characters.".into());
    }
    let engine = config.engine.trim();
    if engine.is_empty() || engine.len() > 32 || engine.chars().any(|c| !c.is_ascii_alphanumeric() && c != '_' && c != '-') {
        return Err("Database engine identifier is invalid.".into());
    }
    let is_sqlite = matches!(engine.to_ascii_lowercase().as_str(), "sqlite" | "sqlite3");
    if !is_sqlite {
        let host = config.host.trim();
        if host.is_empty() || host.len() > 253 || host.chars().any(|c| c.is_control() || c.is_whitespace()) {
            return Err("Database host must be 1–253 bytes and contain no whitespace or control characters.".into());
        }
        if config.port == 0 {
            return Err("Database port must be between 1 and 65535.".into());
        }
    }
    if config.database.len() > 512 || config.database.chars().any(|c| c == '\\0' || c.is_control()) {
        return Err("Database name exceeds 512 bytes or contains control characters.".into());
    }
    if config.username.len() > 256 || config.username.chars().any(|c| c == '\\0' || c.is_control()) {
        return Err("Database username exceeds 256 bytes or contains control characters.".into());
    }
    if config.password.as_ref().map(|v| v.len() > 64 * 1024).unwrap_or(false)
        || config.secret_access_key.as_ref().map(|v| v.len() > 64 * 1024).unwrap_or(false)
        || config.access_key_id.as_ref().map(|v| v.len() > 4096).unwrap_or(false)
    {
        return Err("Database credential input exceeds the supported size limit.".into());
    }
    if config.use_ssh && config.ssh_connection_id.as_deref().map(str::trim).filter(|v| !v.is_empty()).is_none() {
        return Err("Select an SSH connection for this database tunnel.".into());
    }
    Ok(())
}

// ─── Tauri Command Implementations ─────────────────────────────────

async fn dispatch_db_query(
    session: &ActiveDatabaseSession,
    query: &str,
    limit: usize,
    state: &crate::AppState,
    start: Instant,
) -> Result<QueryResult, String> {
    match &session.driver {
        DriverInstance::MySql(pool) => execute_query_mysql(pool, query, limit, session, start).await,
        DriverInstance::Postgres(pool) => execute_query_postgres(pool, query, limit, session, start).await,
        DriverInstance::Sqlite(pool) => execute_query_sqlite(pool, query, limit, session, state, start).await,
        DriverInstance::Mssql { config, tcp_addr } => execute_query_mssql(config, tcp_addr, query, limit, session, start).await,
        DriverInstance::Mongo(client) => execute_mongodb_query(client, &session.config.database, query, limit, Some(session.capabilities.server_version.clone())).await,
        DriverInstance::Redis(client) => execute_query_redis(client, query, session, start).await,
        DriverInstance::DynamoDb { .. } => execute_query_dynamodb(query, session, start),
        DriverInstance::CosmosDb { .. } => execute_query_cosmos(query, session, start),
        DriverInstance::Cassandra { .. } => execute_query_cassandra(query, session, start),
        DriverInstance::Oracle { .. } => execute_query_oracle(query, session, start),
        DriverInstance::Db2 { .. } => execute_query_db2(query, session, start),
    }
}

#[tauri::command]
pub async fn db_connect(
    state: tauri::State<'_, crate::AppState>,
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    config: DatabaseConnectionConfig,
) -> Result<ServerCapabilities, String> {
    let mut config = config;
    validate_database_config(&config)?;
    // Keep driver connection waits bounded even if a malformed/stale profile
    // contains an extreme timeout value.
    config.timeout_seconds = Some(config.timeout_seconds.unwrap_or(8).clamp(3, 120));
    let engine_lower = config.engine.trim().to_lowercase();
    if config.database.trim().is_empty() {
        match engine_lower.as_str() {
            "mongodb" | "mongo" => config.database = "admin".to_string(),
            "postgresql" | "postgres" => config.database = "postgres".to_string(),
            "mysql" | "mariadb" => config.database = "mysql".to_string(),
            "redis" => config.database = "0".to_string(),
            _ => {}
        }
    }

    let (effective_host, effective_port, mut tunnel_tx) = if config.use_ssh {
        let (p, tx) = setup_ssh_tunnel(&config, &state).await?;
        ("127.0.0.1".to_string(), p, Some(tx))
    } else {
        (config.host.clone(), config.port, None)
    };

    let connect_result = match engine_lower.as_str() {
        "mysql" | "mariadb" => connect_mysql(&effective_host, effective_port, &config).await,
        "postgresql" | "postgres" => connect_postgres(&effective_host, effective_port, &config).await,
        "sqlite" | "sqlite3" => connect_sqlite(&config, Some(&state)).await,
        "mssql" | "sqlserver" => connect_mssql(&effective_host, effective_port, &config).await,
        "mongodb" | "mongo" => connect_mongo(&effective_host, effective_port, &config).await,
        "redis" => connect_redis(&effective_host, effective_port, &config).await,
        "dynamodb" | "dynamo" => connect_dynamodb(&effective_host, effective_port, &config).await,
        "cosmos" | "cosmosdb" => connect_cosmos(&effective_host, effective_port, &config).await,
        "cassandra" => connect_cassandra(&effective_host, effective_port, &config).await,
        "oracle" => connect_oracle(&effective_host, effective_port, &config).await,
        "db2" => connect_db2(&effective_host, effective_port, &config).await,
        other => Err(format!("Unsupported database engine: {}", other)),
    };
    let (driver, capabilities) = match connect_result {
        Ok(result) => result,
        Err(error) => {
            if let Some(tx) = tunnel_tx.take() {
                let _ = tx.send(());
            }
            return Err(error);
        }
    };

    let session = ActiveDatabaseSession {
        id: config.id.clone(),
        config: config.clone(),
        local_port: effective_port,
        tunnel_shutdown: Arc::new(tokio::sync::Mutex::new(tunnel_tx)),
        driver,
        capabilities: capabilities.clone(),
    };

    let old_session = {
        let mut lock = db_mgr.sessions.lock().await;
        let old = lock.remove(&config.id);
        lock.insert(config.id.clone(), Arc::new(session));
        old
    };
    // Never await a per-session mutex while holding the global session map lock.
    if let Some(old) = old_session {
        if let Some(tx) = old.tunnel_shutdown.lock().await.take() {
            let _ = tx.send(());
        }
    }

    Ok(capabilities)
}

#[tauri::command]
pub async fn db_disconnect(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
) -> Result<(), String> {
    let session = {
        let mut lock = db_mgr.sessions.lock().await;
        lock.remove(&connection_id)
    };
    // Removing the map entry is the only operation performed under the global lock.
    // Tunnel shutdown may contend with connection setup/cleanup and must happen outside it.
    if let Some(session) = session {
        if let Some(tx) = session.tunnel_shutdown.lock().await.take() {
            let _ = tx.send(());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn db_test_connection(
    state: tauri::State<'_, crate::AppState>,
    config: DatabaseConnectionConfig,
) -> Result<ServerCapabilities, String> {
    let mut config = config;
    validate_database_config(&config)?;
    config.timeout_seconds = Some(config.timeout_seconds.unwrap_or(8).clamp(3, 120));
    let engine_lower = config.engine.trim().to_lowercase();
    if config.database.trim().is_empty() {
        match engine_lower.as_str() {
            "mongodb" | "mongo" => config.database = "admin".to_string(),
            "postgresql" | "postgres" => config.database = "postgres".to_string(),
            "mysql" | "mariadb" => config.database = "mysql".to_string(),
            "redis" => config.database = "0".to_string(),
            _ => {}
        }
    }

    let (effective_host, effective_port, tunnel_tx) = if config.use_ssh {
        let (p, tx) = setup_ssh_tunnel(&config, &state).await?;
        ("127.0.0.1".to_string(), p, Some(tx))
    } else {
        (config.host.clone(), config.port, None)
    };

    let res = match engine_lower.as_str() {
        "mysql" | "mariadb" => connect_mysql(&effective_host, effective_port, &config).await,
        "postgresql" | "postgres" => connect_postgres(&effective_host, effective_port, &config).await,
        "sqlite" | "sqlite3" => connect_sqlite(&config, Some(&state)).await,
        "mssql" | "sqlserver" => connect_mssql(&effective_host, effective_port, &config).await,
        "mongodb" | "mongo" => connect_mongo(&effective_host, effective_port, &config).await,
        "redis" => connect_redis(&effective_host, effective_port, &config).await,
        "dynamodb" | "dynamo" => connect_dynamodb(&effective_host, effective_port, &config).await,
        "cosmos" | "cosmosdb" => connect_cosmos(&effective_host, effective_port, &config).await,
        "cassandra" => connect_cassandra(&effective_host, effective_port, &config).await,
        "oracle" => connect_oracle(&effective_host, effective_port, &config).await,
        "db2" => connect_db2(&effective_host, effective_port, &config).await,
        other => Err(format!("Unsupported database engine: {}", other)),
    };

    if let Some(tx) = tunnel_tx {
        let _ = tx.send(());
    }

    let (_, caps) = res?;
    Ok(caps)
}

#[tauri::command]
pub async fn db_execute_query(
    state: tauri::State<'_, crate::AppState>,
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    query: String,
    max_rows: Option<usize>,
) -> Result<QueryResult, String> {
    if query.len() > 5 * 1024 * 1024 {
        return Err("SQL query exceeds the 5 MiB input limit.".into());
    }
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id)
            .cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };

    // Read-only sessions must not execute arbitrary SQL/commands. Redis uses its
    // own safe READ_ONLY_COMMANDS allow-list inside execute_query_redis.
    if session.config.read_only && !matches!(&session.driver, DriverInstance::Redis(_)) {
        if matches!(&session.driver, DriverInstance::Mongo(_)) {
            return Err("Read-only mode for MongoDB query consoles is not supported safely; use a read-only database account".to_string());
        }
        let normalized = query.trim();
        // Comments and control characters make prefix-based SQL inspection
        // ambiguous (for example executable MySQL comments). Reject them in
        // read-only mode rather than attempting to strip SQL syntax manually.
        if normalized.contains("--")
            || normalized.contains("/*")
            || normalized.contains("*/")
            || normalized.contains('#')
            || normalized.chars().any(|c| c == '\0' || (c.is_control() && c != '\n' && c != '\r' && c != '\t'))
        {
            return Err("Read-only mode rejects SQL comments and control characters; use a database account with server-enforced read-only privileges for stronger guarantees.".into());
        }
        let upper = normalized.to_ascii_uppercase();
        let allowed = ["SELECT", "SHOW", "DESCRIBE", "DESC"];
        let is_read = allowed.iter().any(|prefix| {
            upper.strip_prefix(prefix)
                .map(|rest| rest.is_empty() || rest.chars().next().map(|c| c.is_whitespace()).unwrap_or(false))
                .unwrap_or(false)
        });
        let upper_compact = upper.split_whitespace().collect::<Vec<_>>().join(" ");
        let upper_no_ws: String = upper.chars().filter(|c| !c.is_whitespace()).collect();
        // This is a conservative application-level guard, not a substitute
        // for a database account that has server-enforced read-only privileges.
        // Block known side-effecting, file, process, lock, and administrative
        // functions across the supported SQL dialects.
        let potentially_mutating = [
            "INTO", "FORUPDATE", "FORSHARE", "LOCKINSHAREMODE",
            "NEXTVAL(", "SETVAL(", "PG_ADVISORY", "PG_NOTIFY(",
            "PG_RELOAD_CONF(", "PG_ROTATE_LOGFILE(", "PG_LOG_BACKEND_MEMORY_CONTEXTS(",
            "LOAD_FILE(", "SLEEP(", "BENCHMARK(", "DBLINK_EXEC(",
            "PG_READ_FILE(", "PG_READ_BINARY_FILE(", "PG_STAT_FILE(",
            "LO_IMPORT(", "LO_EXPORT(", "LO_CREATE(", "LO_UNLINK(", "LO_PUT(",
            "PG_EXPORT_SNAPSHOT(", "PG_SWITCH_WAL(", "DBLINK_CONNECT(", "DBLINK_SEND_QUERY(",
            "OPENQUERY(", "PG_TERMINATE_BACKEND(", "PG_CANCEL_BACKEND(", "PG_LS_DIR(",
            "XP_CMDSHELL", "SP_OACREATE", "OPENROWSET(", "OPENDATASOURCE(",
            "GET_LOCK(", "RELEASE_LOCK(", "PG_SLEEP(", "SET_CONFIG(",
            "DBMS_LOCK.", "DBMS_SCHEDULER.", "DBMS_PIPE.", "DBMS_SQL.",
            "UTL_FILE.", "UTL_HTTP.", "UTL_SMTP.", "UTL_TCP.", "UTL_INADDR.",
            "WAITFOR", "DBCC", "SHUTDOWN", "KILL ", "LOAD_EXTENSION(",
            "WRITEFILE(", "READFILE(", "INTOOUTFILE", "INTODUMPFILE",
        ].iter().any(|needle| upper_no_ws.contains(&needle.replace(' ', "")))
            || upper_compact.contains("LOCK IN SHARE MODE")
            || upper_no_ws.contains("PRAGMA")
            || upper_no_ws.contains("ATTACHDATABASE")
            || upper_no_ws.contains("DETACHDATABASE");
        let semicolon_count = normalized.chars().filter(|c| *c == ';').count();
        let has_multiple_statements = semicolon_count > 1
            || (semicolon_count == 1 && !normalized.trim_end().ends_with(';'));
        if !is_read || potentially_mutating || has_multiple_statements {
            return Err("Read-only session: only one conservative read/query statement is allowed".to_string());
        }
    }

    let limit = max_rows.unwrap_or(500).min(10000);
    let query_timeout_secs = session.config.timeout_seconds.unwrap_or(60).clamp(5, 300);
    let start = Instant::now();

    let res = tokio::time::timeout(
        std::time::Duration::from_secs(query_timeout_secs),
        dispatch_db_query(&session, &query, limit, &state, start),
    )
    .await
    .map_err(|_| format!("Database query execution timed out after {} seconds.", query_timeout_secs))?;

    // Bound the payload sent across the Tauri IPC boundary. A row-count limit
    // alone is insufficient because a single database row may contain very
    // large text/blob values. This check applies uniformly to every engine.
    const MAX_QUERY_RESULT_BYTES: usize = 16 * 1024 * 1024;
    if let Ok(ref qr) = res {
        let encoded_len = serde_json::to_vec(qr)
            .map_err(|e| format!("Could not serialize database query result: {}", e))?
            .len();
        if encoded_len > MAX_QUERY_RESULT_BYTES {
            return Err(format!(
                "Database query result exceeds the 16 MiB response limit ({} bytes). Add a WHERE clause or reduce the selected columns.",
                encoded_len
            ));
        }
    }

    if let Ok(ref qr) = res {
        let mut new_db_name: Option<String> = None;
        let trimmed_q = query.trim().trim_end_matches(';').trim();
        let q_lower = trimmed_q.to_lowercase();
        if q_lower.starts_with("use ") {
            let after_use = trimmed_q[4..].trim().trim_end_matches(';').trim();
            let target_db = after_use.trim_matches(|c| c == '\'' || c == '"' || c == '`' || c == '[' || c == ']').trim();
            if !target_db.is_empty() {
                new_db_name = Some(target_db.to_string());
            }
        } else if trimmed_q.to_uppercase().starts_with("SELECT ") && matches!(&session.driver, DriverInstance::Redis(_)) {
            let after_sel = trimmed_q[7..].trim();
            if let Ok(num) = after_sel.parse::<u32>() {
                new_db_name = Some(num.to_string());
            }
        } else if let Some(after_c) = trimmed_q.strip_prefix("\\c ") {
            let target_db = after_c.trim().trim_matches(|c| c == '\'' || c == '"').trim();
            if !target_db.is_empty() {
                new_db_name = Some(target_db.to_string());
            }
        } else if qr.command_type == "MongoDB Use" {
            if let Some(first_row) = qr.rows.first() {
                if let Some(new_db) = first_row.get("database").and_then(|v| v.as_str()) {
                    new_db_name = Some(new_db.to_string());
                }
            }
        } else if let Some(ref batch) = qr.all_results {
            for b in batch {
                let b_trimmed = b.statement.trim().trim_end_matches(';').trim();
                let b_lower = b_trimmed.to_lowercase();
                if b_lower.starts_with("use ") {
                    let after_use = b_trimmed[4..].trim();
                    let target_db = after_use.trim_matches(|c| c == '\'' || c == '"' || c == '`' || c == '[' || c == ']').trim();
                    if !target_db.is_empty() {
                        new_db_name = Some(target_db.to_string());
                    }
                }
            }
        }

        if let Some(new_db) = new_db_name {
            let mut lock = db_mgr.sessions.lock().await;
            // A query may finish after disconnect/reconnect with the same ID.
            // Update only the exact session that executed this query; never replace
            // a newer connection with a stale clone holding the old driver/tunnel.
            if let Some(existing) = lock.get_mut(&connection_id) {
                if Arc::ptr_eq(existing, &session) {
                    let mut updated = (**existing).clone();
                    updated.config.database = new_db;
                    *existing = Arc::new(updated);
                }
            }
        }
    }

    res
}

#[tauri::command]
pub async fn db_list_tables(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<DatabaseObject>, String> {
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id)
            .cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };

    match &session.driver {
        DriverInstance::MySql(pool) => list_tables_mysql(pool, &session, schema).await,
        DriverInstance::Postgres(pool) => list_tables_postgres(pool, &session, schema).await,
        DriverInstance::Sqlite(pool) => list_tables_sqlite(pool).await,
        DriverInstance::Mssql { config, tcp_addr } => list_tables_mssql(config, tcp_addr).await,
        DriverInstance::Mongo(client) => list_collections_mongo(client, &session).await,
        DriverInstance::Redis(client) => list_tables_redis(client).await,
        DriverInstance::DynamoDb { .. } => list_tables_dynamodb(),
        DriverInstance::CosmosDb { database, .. } => list_tables_cosmos(database),
        DriverInstance::Cassandra { keyspace, .. } => list_tables_cassandra(keyspace),
        DriverInstance::Oracle { sid, .. } => list_tables_oracle(sid),
        DriverInstance::Db2 { database, .. } => list_tables_db2(database),
    }
}

#[tauri::command]
pub async fn db_get_table_columns(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
) -> Result<Vec<ColumnMeta>, String> {
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id)
            .cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };

    match &session.driver {
        DriverInstance::MySql(pool) => get_table_columns_mysql(pool, &session, &table_name, schema).await,
        DriverInstance::Postgres(pool) => get_table_columns_postgres(pool, &session, &table_name, schema).await,
        DriverInstance::Sqlite(pool) => get_table_columns_sqlite(pool, &table_name).await,
        DriverInstance::Mssql { config, tcp_addr } => get_table_columns_mssql(config, tcp_addr, &table_name).await,
        DriverInstance::Mongo(client) => get_collection_columns_mongo(client, &session, &table_name).await,
        DriverInstance::Redis(_) => Ok(get_table_columns_redis()),
        DriverInstance::DynamoDb { .. } => get_table_columns_dynamodb(),
        DriverInstance::CosmosDb { .. } => get_table_columns_cosmos(),
        DriverInstance::Cassandra { .. } => get_table_columns_cassandra(),
        DriverInstance::Oracle { .. } => get_table_columns_oracle(),
        DriverInstance::Db2 { .. } => get_table_columns_db2(),
    }
}

#[tauri::command]
pub async fn db_execute_operation(
    state: tauri::State<'_, crate::AppState>,
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    operation: DatabaseOperation,
) -> Result<OperationResult, String> {
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id)
            .cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };

    if session.config.read_only {
        return Err("Database session is in read-only mode".to_string());
    }
    crate::store::audit::enforce_policy_permission("db_execute_operation")?;

    let start = Instant::now();
    let engine = session.config.engine.to_lowercase();

    // Check Mongo native
    if let DriverInstance::Mongo(client) = &session.driver {
        return execute_operation_mongo(client, &session, &operation, start).await;
    }

    // Check Redis native
    if let DriverInstance::Redis(client) = &session.driver {
        return execute_operation_redis(client, &operation, start).await;
    }

    // SQL engines
    let (sql, msg) = match &operation {
        DatabaseOperation::CreateTable { table, columns, .. } => {
            let sql = generate_create_table_sql(&engine, table, columns)?;
            (sql, format!("Table '{}' created successfully", table))
        }
        DatabaseOperation::RenameObject { object_type, old_name, new_name, .. } => {
            let sql = generate_rename_sql(&engine, object_type, old_name, new_name)?;
            (sql, format!("{} '{}' renamed to '{}'", object_type, old_name, new_name))
        }
        DatabaseOperation::DropObject { object_type, name, .. } => {
            let sql = generate_drop_sql(&engine, object_type, name)?;
            (sql, format!("{} '{}' dropped successfully", object_type, name))
        }
        DatabaseOperation::TruncateTable { table, .. } => {
            let sql = generate_truncate_table_sql(&engine, table);
            (sql, format!("Table '{}' truncated", table))
        }
        DatabaseOperation::AddColumn { table, column, .. } => {
            let sql = generate_add_column_sql(&engine, table, column)?;
            (sql, format!("Column '{}' added to table '{}'", column.name, table))
        }
        DatabaseOperation::DropColumn { table, column_name, .. } => {
            let sql = generate_drop_column_sql(&engine, table, column_name);
            (sql, format!("Column '{}' dropped from table '{}'", column_name, table))
        }
        DatabaseOperation::CreateIndex { table, index_name, columns, is_unique, .. } => {
            let sql = generate_create_index_sql(&engine, table, index_name, columns, *is_unique)?;
            (sql, format!("Index '{}' created on table '{}'", index_name, table))
        }
        DatabaseOperation::DropIndex { table, index_name, .. } => {
            let sql = generate_drop_index_sql(&engine, table, index_name);
            (sql, format!("Index '{}' dropped", index_name))
        }
    };

    let affected = match &session.driver {
        DriverInstance::MySql(pool) => execute_operation_mysql(pool, &sql).await?,
        DriverInstance::Postgres(pool) => execute_operation_postgres(pool, &sql).await?,
        DriverInstance::Sqlite(pool) => execute_operation_sqlite(pool, &sql, &session, &state).await?,
        DriverInstance::Mssql { config, tcp_addr } => execute_operation_mssql(config, tcp_addr, &sql).await?,
        DriverInstance::Oracle { .. }
        | DriverInstance::Db2 { .. }
        | DriverInstance::Cassandra { .. }
        | DriverInstance::DynamoDb { .. }
        | DriverInstance::CosmosDb { .. } => {
            return Err("Schema operation is not implemented for this database driver".to_string());
        },
        _ => return Err("Operation not supported for this database driver".to_string()),
    };

    Ok(OperationResult {
        success: true,
        message: msg,
        affected_rows: affected,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        generated_sql: Some(sql),
        definition: None,
    })
}

#[tauri::command]
pub async fn db_get_object_definition(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    object_type: String,
    name: String,
    schema: Option<String>,
) -> Result<String, String> {
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id)
            .cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };

    match &session.driver {
        DriverInstance::MySql(pool) => get_object_definition_mysql(pool, &object_type, &name).await,
        DriverInstance::Postgres(pool) => get_object_definition_postgres(pool, &object_type, &name).await,
        DriverInstance::Sqlite(pool) => get_object_definition_sqlite(pool, &name).await,
        DriverInstance::Mssql { config, tcp_addr } => get_object_definition_mssql(config, tcp_addr, &name).await,
        DriverInstance::Mongo(client) => get_object_definition_mongo(client, &session, &name).await,
        DriverInstance::Redis(client) => get_object_definition_redis(client, &name).await,
        other => get_object_definition_others(other, &name),
    }
}

#[tauri::command]
pub async fn db_get_capabilities(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
) -> Result<ServerCapabilities, String> {
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id)
            .cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };

    Ok(session.capabilities.clone())
}
