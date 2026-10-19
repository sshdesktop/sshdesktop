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

// ─── Tauri Command Implementations ─────────────────────────────────

#[tauri::command]
pub async fn db_connect(
    state: tauri::State<'_, crate::AppState>,
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    config: DatabaseConnectionConfig,
) -> Result<ServerCapabilities, String> {
    let mut config = config;
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

    let (driver, capabilities) = match engine_lower.as_str() {
        "mysql" | "mariadb" => connect_mysql(&effective_host, effective_port, &config).await?,
        "postgresql" | "postgres" => connect_postgres(&effective_host, effective_port, &config).await?,
        "sqlite" | "sqlite3" => connect_sqlite(&config, Some(&state)).await?,
        "mssql" | "sqlserver" => connect_mssql(&effective_host, effective_port, &config).await?,
        "mongodb" | "mongo" => connect_mongo(&effective_host, effective_port, &config).await?,
        "redis" => connect_redis(&effective_host, effective_port, &config).await?,
        "dynamodb" | "dynamo" => connect_dynamodb(&effective_host, effective_port, &config).await?,
        "cosmos" | "cosmosdb" => connect_cosmos(&effective_host, effective_port, &config).await?,
        "cassandra" => connect_cassandra(&effective_host, effective_port, &config).await?,
        "oracle" => connect_oracle(&effective_host, effective_port, &config).await?,
        "db2" => connect_db2(&effective_host, effective_port, &config).await?,
        other => return Err(format!("Unsupported database engine: {}", other)),
    };

    let session = ActiveDatabaseSession {
        id: config.id.clone(),
        config: config.clone(),
        local_port: effective_port,
        tunnel_shutdown: tunnel_tx,
        driver,
        capabilities: capabilities.clone(),
    };

    {
        let mut lock = db_mgr.sessions.lock().await;
        if let Some(old) = lock.remove(&config.id) {
            if let Some(tx) = old.tunnel_shutdown {
                let _ = tx.send(());
            }
        }
        lock.insert(config.id.clone(), session);
    }

    Ok(capabilities)
}

#[tauri::command]
pub async fn db_disconnect(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
) -> Result<(), String> {
    let mut lock = db_mgr.sessions.lock().await;
    if let Some(session) = lock.remove(&connection_id) {
        if let Some(tx) = session.tunnel_shutdown {
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
    let mut lock = db_mgr.sessions.lock().await;
    let session = lock
        .get_mut(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    let limit = max_rows.unwrap_or(500);
    let start = Instant::now();

    let res = match &session.driver {
        DriverInstance::MySql(pool) => {
            execute_query_mysql(pool, &query, limit, session, start).await
        }
        DriverInstance::Postgres(pool) => {
            execute_query_postgres(pool, &query, limit, session, start).await
        }
        DriverInstance::Sqlite(pool) => {
            execute_query_sqlite(pool, &query, limit, session, &state, start).await
        }
        DriverInstance::Mssql { config, tcp_addr } => {
            execute_query_mssql(config, tcp_addr, &query, limit, session, start).await
        }
        DriverInstance::Mongo(client) => {
            execute_mongodb_query(client, &session.config.database, &query, limit, Some(session.capabilities.server_version.clone())).await
        }
        DriverInstance::Redis(client) => {
            execute_query_redis(client, &query, session, start).await
        }
        DriverInstance::DynamoDb { .. } => {
            execute_query_dynamodb(&query, session, start)
        }
        DriverInstance::CosmosDb { .. } => {
            execute_query_cosmos(&query, session, start)
        }
        DriverInstance::Cassandra { .. } => {
            execute_query_cassandra(&query, session, start)
        }
        DriverInstance::Oracle { .. } => {
            execute_query_oracle(&query, session, start)
        }
        DriverInstance::Db2 { .. } => {
            execute_query_db2(&query, session, start)
        }
    };

    if let Ok(ref qr) = res {
        let trimmed_q = query.trim().trim_end_matches(';').trim();
        let q_lower = trimmed_q.to_lowercase();
        if q_lower.starts_with("use ") {
            let after_use = trimmed_q[4..].trim().trim_end_matches(';').trim();
            let target_db = after_use.trim_matches(|c| c == '\'' || c == '"' || c == '`' || c == '[' || c == ']').trim();
            if !target_db.is_empty() {
                session.config.database = target_db.to_string();
            }
        } else if trimmed_q.to_uppercase().starts_with("SELECT ") && matches!(&session.driver, DriverInstance::Redis(_)) {
            let after_sel = trimmed_q[7..].trim();
            if let Ok(num) = after_sel.parse::<u32>() {
                session.config.database = num.to_string();
            }
        } else if trimmed_q.starts_with("\\c ") {
            let after_c = trimmed_q[3..].trim();
            let target_db = after_c.trim_matches(|c| c == '\'' || c == '"').trim();
            if !target_db.is_empty() {
                session.config.database = target_db.to_string();
            }
        } else if qr.command_type == "MongoDB Use" {
            if let Some(first_row) = qr.rows.first() {
                if let Some(new_db) = first_row.get("database").and_then(|v| v.as_str()) {
                    session.config.database = new_db.to_string();
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
                        session.config.database = target_db.to_string();
                    }
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
    let mut lock = db_mgr.sessions.lock().await;
    let session = lock
        .get_mut(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let Some(ref s) = schema {
        if !s.trim().is_empty() {
            session.config.database = s.trim().to_string();
        }
    }

    match &session.driver {
        DriverInstance::MySql(pool) => list_tables_mysql(pool, session, schema).await,
        DriverInstance::Postgres(pool) => list_tables_postgres(pool, session, schema).await,
        DriverInstance::Sqlite(pool) => list_tables_sqlite(pool).await,
        DriverInstance::Mssql { config, tcp_addr } => list_tables_mssql(config, tcp_addr).await,
        DriverInstance::Mongo(client) => list_collections_mongo(client, session).await,
        DriverInstance::Redis(client) => list_tables_redis(client).await,
        DriverInstance::DynamoDb { .. } => Ok(list_tables_dynamodb()),
        DriverInstance::CosmosDb { database, .. } => Ok(list_tables_cosmos(database)),
        DriverInstance::Cassandra { keyspace, .. } => Ok(list_tables_cassandra(keyspace)),
        DriverInstance::Oracle { sid, .. } => Ok(list_tables_oracle(sid)),
        DriverInstance::Db2 { database, .. } => Ok(list_tables_db2(database)),
    }
}

#[tauri::command]
pub async fn db_get_table_columns(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    table_name: String,
    schema: Option<String>,
) -> Result<Vec<ColumnMeta>, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    match &session.driver {
        DriverInstance::MySql(pool) => get_table_columns_mysql(pool, session, &table_name, schema).await,
        DriverInstance::Postgres(pool) => get_table_columns_postgres(pool, session, &table_name, schema).await,
        DriverInstance::Sqlite(pool) => get_table_columns_sqlite(pool, &table_name).await,
        DriverInstance::Mssql { config, tcp_addr } => get_table_columns_mssql(config, tcp_addr, &table_name).await,
        DriverInstance::Mongo(client) => get_collection_columns_mongo(client, session, &table_name).await,
        DriverInstance::Redis(_) => Ok(get_table_columns_redis()),
        DriverInstance::DynamoDb { .. } => Ok(get_table_columns_dynamodb()),
        DriverInstance::CosmosDb { .. } => Ok(get_table_columns_cosmos()),
        DriverInstance::Cassandra { .. } => Ok(get_table_columns_cassandra()),
        DriverInstance::Oracle { .. } => Ok(get_table_columns_oracle()),
        DriverInstance::Db2 { .. } => Ok(get_table_columns_db2()),
    }
}

#[tauri::command]
pub async fn db_execute_operation(
    state: tauri::State<'_, crate::AppState>,
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    operation: DatabaseOperation,
) -> Result<OperationResult, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if session.config.read_only {
        return Err("Database session is in read-only mode".to_string());
    }

    let start = Instant::now();
    let engine = session.config.engine.to_lowercase();

    // Check Mongo native
    if let DriverInstance::Mongo(client) = &session.driver {
        return execute_operation_mongo(client, session, &operation, start).await;
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
            let sql = generate_add_column_sql(&engine, table, column);
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
        DriverInstance::Sqlite(pool) => execute_operation_sqlite(pool, &sql, session, &state).await?,
        DriverInstance::Mssql { config, tcp_addr } => execute_operation_mssql(config, tcp_addr, &sql).await?,
        DriverInstance::Oracle { .. }
        | DriverInstance::Db2 { .. }
        | DriverInstance::Cassandra { .. }
        | DriverInstance::DynamoDb { .. }
        | DriverInstance::CosmosDb { .. } => 0,
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
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    match &session.driver {
        DriverInstance::MySql(pool) => get_object_definition_mysql(pool, &object_type, &name).await,
        DriverInstance::Postgres(pool) => get_object_definition_postgres(pool, &object_type, &name).await,
        DriverInstance::Sqlite(pool) => get_object_definition_sqlite(pool, &name).await,
        DriverInstance::Mssql { config, tcp_addr } => get_object_definition_mssql(config, tcp_addr, &name).await,
        DriverInstance::Mongo(client) => get_object_definition_mongo(client, session, &name).await,
        DriverInstance::Redis(client) => get_object_definition_redis(client, &name).await,
        other => get_object_definition_others(other, &name),
    }
}

#[tauri::command]
pub async fn db_get_capabilities(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
) -> Result<ServerCapabilities, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    Ok(session.capabilities.clone())
}
