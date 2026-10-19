use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use super::types::{
    ActiveDatabaseSession, ColumnMeta, DatabaseConnectionConfig, DatabaseManager,
    DatabaseObject, DatabaseOperation, DriverInstance, OperationResult, QueryResult,
    RedisKeyItem, RedisValueItem, ServerCapabilities, urlencoding,
};

pub async fn connect_redis(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let auth = if let Some(ref pwd) = config.password {
        if !pwd.is_empty() {
            format!(":{}@", urlencoding(pwd))
        } else {
            "".to_string()
        }
    } else {
        "".to_string()
    };

    let scheme = if config.use_ssl { "rediss" } else { "redis" };
    let db_path = match config.database.trim().parse::<u32>() {
        Ok(n) => format!("/{}", n),
        Err(_) => "".to_string(),
    };
    let url = format!("{}://{}{}:{}{}", scheme, auth, effective_host, effective_port, db_path);
    let client = redis::Client::open(url).map_err(|e| format!("Redis client init error: {}", e))?;

    let mut con = tokio::time::timeout(
        std::time::Duration::from_secs(config.timeout_seconds.unwrap_or(8)),
        client.get_multiplexed_tokio_connection()
    )
    .await
    .map_err(|_| "Redis connection timed out after 8 seconds".to_string())?
    .map_err(|e| format!("Redis connect error: {}", e))?;

    let _pong: String = redis::cmd("PING")
        .query_async(&mut con)
        .await
        .map_err(|e| format!("Redis PING error: {}", e))?;

    let info: String = redis::cmd("INFO")
        .arg("server")
        .query_async(&mut con)
        .await
        .unwrap_or_default();
    let version = info
        .lines()
        .find(|l| l.starts_with("redis_version:"))
        .map(|l| l.replace("redis_version:", "").trim().to_string())
        .unwrap_or_else(|| "Redis".to_string());

    let capabilities = ServerCapabilities {
        engine: "redis".to_string(),
        server_version: version,
        supports_transactions: true,
        supports_schemas: false,
        supports_procedures: false,
        supports_functions: false,
        supports_triggers: false,
        supports_views: false,
        supports_indexes: false,
        supports_foreign_keys: false,
        supports_explain: false,
        supports_process_list: true,
        read_only: config.read_only,
        supports_rename_table: true,
        supports_alter_column: false,
    };

    Ok((DriverInstance::Redis(client), capabilities))
}

pub async fn execute_query_redis(
    client: &redis::Client,
    query: &str,
    session: &ActiveDatabaseSession,
    start: Instant,
) -> Result<QueryResult, String> {
    let mut con = client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| format!("Redis connection error: {}", e))?;

    let parts: Vec<&str> = query.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty Redis command".to_string());
    }

    let mut cmd = redis::cmd(parts[0]);
    for arg in &parts[1..] {
        cmd.arg(*arg);
    }

    let val: redis::Value = cmd
        .query_async(&mut con)
        .await
        .map_err(|e| format!("Redis query error: {}", e))?;

    let json_val = match val {
        redis::Value::Nil => serde_json::Value::Null,
        redis::Value::Int(i) => serde_json::Value::Number(i.into()),
        redis::Value::BulkString(bytes) => serde_json::Value::String(String::from_utf8_lossy(&bytes).to_string()),
        redis::Value::Array(items) => {
            let arr = items
                .into_iter()
                .map(|it| match it {
                    redis::Value::BulkString(b) => serde_json::Value::String(String::from_utf8_lossy(&b).to_string()),
                    redis::Value::Int(i) => serde_json::Value::Number(i.into()),
                    _ => serde_json::Value::Null,
                })
                .collect();
            serde_json::Value::Array(arr)
        }
        redis::Value::SimpleString(s) => serde_json::Value::String(s),
        redis::Value::Okay => serde_json::Value::String("OK".to_string()),
        _ => serde_json::Value::String(format!("{:?}", val)),
    };

    Ok(QueryResult {
        columns: vec![ColumnMeta {
            name: "response".to_string(),
            data_type: "RedisValue".to_string(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        }],
        rows: vec![serde_json::json!({ "response": json_val })],
        affected_rows: 1,
        last_insert_id: None,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        command_type: "Redis".to_string(),
        server_version: Some(session.capabilities.server_version.clone()),
        warnings: Vec::new(),
        all_results: None,
    })
}

pub async fn list_tables_redis(client: &redis::Client) -> Result<Vec<DatabaseObject>, String> {
    let mut con = client.get_multiplexed_tokio_connection().await.map_err(|e| e.to_string())?;
    let keys: Vec<String> = redis::cmd("KEYS").arg("*").query_async(&mut con).await.unwrap_or_default();
    Ok(keys
        .into_iter()
        .map(|k| DatabaseObject {
            name: k,
            object_type: "key".to_string(),
            schema: None,
            row_count: None,
            size_bytes: None,
            definition: None,
        })
        .collect())
}

pub fn get_table_columns_redis() -> Vec<ColumnMeta> {
    vec![
        ColumnMeta {
            name: "key".to_string(),
            data_type: "String".to_string(),
            nullable: false,
            is_primary_key: true,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        },
        ColumnMeta {
            name: "type".to_string(),
            data_type: "String".to_string(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        },
        ColumnMeta {
            name: "value".to_string(),
            data_type: "String".to_string(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        },
    ]
}

pub async fn execute_operation_redis(
    client: &redis::Client,
    operation: &DatabaseOperation,
    start: Instant,
) -> Result<OperationResult, String> {
    match operation {
        DatabaseOperation::DropObject { name, .. } => {
            let mut con = client.get_multiplexed_tokio_connection().await.map_err(|e| e.to_string())?;
            let deleted: u64 = redis::cmd("DEL").arg(name).query_async(&mut con).await.map_err(|e| e.to_string())?;
            Ok(OperationResult {
                success: true,
                message: format!("Key '{}' deleted", name),
                affected_rows: deleted,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                generated_sql: None,
                definition: None,
            })
        }
        _ => Err("Operation not supported for Redis".to_string()),
    }
}

pub async fn get_object_definition_redis(
    client: &redis::Client,
    name: &str,
) -> Result<String, String> {
    let mut con = client.get_multiplexed_tokio_connection().await.map_err(|e| e.to_string())?;
    let k_type: String = redis::cmd("TYPE").arg(name).query_async(&mut con).await.unwrap_or_else(|_| "unknown".to_string());
    let ttl: i64 = redis::cmd("TTL").arg(name).query_async(&mut con).await.unwrap_or(-1);
    Ok(format!("// Redis Key: {}\n// Type: {}\n// TTL: {}\nGET \"{}\"", name, k_type, ttl, name))
}

// ─── Redis Specific Tauri Commands ───────────────────────────────────

#[tauri::command]
pub async fn redis_scan_keys(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    pattern: Option<String>,
    count: Option<u32>,
) -> Result<Vec<RedisKeyItem>, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let DriverInstance::Redis(client) = &session.driver {
        let mut con = client.get_multiplexed_tokio_connection().await.map_err(|e| e.to_string())?;
        let pat = pattern.unwrap_or_else(|| "*".to_string());
        let cnt = count.unwrap_or(200);

        let mut cmd = redis::cmd("SCAN");
        cmd.arg(0).arg("MATCH").arg(pat).arg("COUNT").arg(cnt);

        let res: (u64, Vec<String>) = cmd.query_async(&mut con).await.map_err(|e| e.to_string())?;

        let mut items = Vec::new();
        for k in res.1 {
            let ty: String = redis::cmd("TYPE").arg(&k).query_async(&mut con).await.unwrap_or_default();
            let ttl: i64 = redis::cmd("TTL").arg(&k).query_async(&mut con).await.unwrap_or(-1);

            items.push(RedisKeyItem {
                key: k,
                key_type: ty,
                ttl,
                size: None,
            });
        }
        Ok(items)
    } else {
        Err("Active connection is not Redis".to_string())
    }
}

#[tauri::command]
pub async fn redis_get_value(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    key: String,
) -> Result<RedisValueItem, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let DriverInstance::Redis(client) = &session.driver {
        let mut con = client.get_multiplexed_tokio_connection().await.map_err(|e| e.to_string())?;
        let ty: String = redis::cmd("TYPE").arg(&key).query_async(&mut con).await.map_err(|e| e.to_string())?;
        let ttl: i64 = redis::cmd("TTL").arg(&key).query_async(&mut con).await.unwrap_or(-1);

        let val: serde_json::Value = match ty.as_str() {
            "string" => {
                let s: String = redis::cmd("GET").arg(&key).query_async(&mut con).await.unwrap_or_default();
                serde_json::Value::String(s)
            }
            "hash" => {
                let map: HashMap<String, String> = redis::cmd("HGETALL").arg(&key).query_async(&mut con).await.unwrap_or_default();
                serde_json::to_value(map).unwrap_or(serde_json::Value::Null)
            }
            "list" => {
                let items: Vec<String> = redis::cmd("LRANGE").arg(&key).arg(0).arg(-1).query_async(&mut con).await.unwrap_or_default();
                serde_json::to_value(items).unwrap_or(serde_json::Value::Null)
            }
            "set" => {
                let items: Vec<String> = redis::cmd("SMEMBERS").arg(&key).query_async(&mut con).await.unwrap_or_default();
                serde_json::to_value(items).unwrap_or(serde_json::Value::Null)
            }
            "zset" => {
                let items: Vec<(String, f64)> = redis::cmd("ZRANGE").arg(&key).arg(0).arg(-1).arg("WITHSCORES").query_async(&mut con).await.unwrap_or_default();
                serde_json::to_value(items).unwrap_or(serde_json::Value::Null)
            }
            _ => serde_json::Value::Null,
        };

        Ok(RedisValueItem {
            key,
            key_type: ty,
            ttl,
            value: val,
        })
    } else {
        Err("Active connection is not Redis".to_string())
    }
}

#[tauri::command]
pub async fn redis_set_value(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    key: String,
    value: String,
    ttl: Option<i64>,
) -> Result<(), String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let DriverInstance::Redis(client) = &session.driver {
        let mut con = client.get_multiplexed_tokio_connection().await.map_err(|e| e.to_string())?;
        if let Some(t) = ttl {
            if t > 0 {
                let _: () = redis::cmd("SETEX").arg(&key).arg(t).arg(&value).query_async(&mut con).await.map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
        let _: () = redis::cmd("SET").arg(&key).arg(&value).query_async(&mut con).await.map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Active connection is not Redis".to_string())
    }
}

#[tauri::command]
pub async fn redis_delete_key(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    key: String,
) -> Result<bool, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let DriverInstance::Redis(client) = &session.driver {
        let mut con = client.get_multiplexed_tokio_connection().await.map_err(|e| e.to_string())?;
        let deleted: i64 = redis::cmd("DEL").arg(&key).query_async(&mut con).await.map_err(|e| e.to_string())?;
        Ok(deleted > 0)
    } else {
        Err("Active connection is not Redis".to_string())
    }
}
