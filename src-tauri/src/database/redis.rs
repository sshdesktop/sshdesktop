fn parse_redis_args(input: &str) -> Result<Vec<String>, String> {
    if input.len() > 1024 * 1024 {
        return Err("Redis command exceeds the 1 MiB input limit.".into());
    }
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut token_started = false;

    for ch in input.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            token_started = true;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            token_started = true;
            continue;
        }
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else {
                current.push(ch);
            }
            token_started = true;
            continue;
        }
        match ch {
            '\'' | '"' => { quote = Some(ch); token_started = true; }
            c if c.is_whitespace() => {
                if token_started {
                    args.push(std::mem::take(&mut current));
                    token_started = false;
                }
            }
            _ => { current.push(ch); token_started = true; }
        }
    }

    if escaped {
        return Err("Redis command ends with an incomplete escape sequence.".into());
    }
    if quote.is_some() {
        return Err("Unterminated quote in Redis command.".into());
    }
    if token_started {
        args.push(current);
    }
    if args.len() > 10_000 || args.iter().any(|arg| arg.len() > 256 * 1024) {
        return Err("Redis command exceeds the argument count or per-argument size limit.".into());
    }
    Ok(args)
}

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

    let parts = parse_redis_args(query)?;
    if parts.is_empty() {
        return Err("Empty Redis command".to_string());
    }

    if session.config.read_only {
        let command = parts[0].to_ascii_uppercase();
        const READ_ONLY_COMMANDS: &[&str] = &[
            "GET", "MGET", "EXISTS", "TYPE", "TTL", "PTTL", "STRLEN",
            "HGET", "HMGET", "HGETALL", "HEXISTS", "HLEN", "HKEYS", "HVALS",
            "LRANGE", "LLEN", "LINDEX", "SCARD", "SISMEMBER", "SMISMEMBER",
            "SMEMBERS", "SRANDMEMBER", "ZCARD", "ZSCORE", "ZMSCORE", "ZRANGE",
            "ZREVRANGE", "ZRANGEBYSCORE", "ZCOUNT", "INFO", "PING", "DBSIZE",
            "SCAN", "RANDOMKEY", "TIME", "ROLE"
        ];
        if !READ_ONLY_COMMANDS.contains(&command.as_str()) {
            return Err(format!("Redis command '{}' is not permitted in read-only mode.", command));
        }
    }

    let mut cmd = redis::cmd(&parts[0]);
    for arg in &parts[1..] {
        cmd.arg(arg);
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
    let mut keys = Vec::new();
    let mut cursor: u64 = 0;
    loop {
        let (next, mut batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor).arg("MATCH").arg("*").arg("COUNT").arg(500)
            .query_async(&mut con).await.map_err(|e| format!("Redis SCAN failed: {}", e))?;
        keys.append(&mut batch);
        if keys.len() >= 10000 {
            keys.truncate(10000);
            break;
        }
        cursor = next;
        if cursor == 0 { break; }
    }
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
    if name.is_empty() || name.len() > 1024 || name.chars().any(|c| c == '\0') {
        return Err("Redis key must contain 1–1024 bytes and no NUL characters.".into());
    }
    let k_type: String = redis::cmd("TYPE").arg(name).query_async(&mut con).await
        .map_err(|e| format!("Redis TYPE failed: {}", e))?;
    let ttl: i64 = redis::cmd("TTL").arg(name).query_async(&mut con).await
        .map_err(|e| format!("Redis TTL failed: {}", e))?;
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
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id).cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };
    let client = match &session.driver {
        DriverInstance::Redis(client) => client.clone(),
        _ => return Err("Active connection is not Redis".to_string()),
    };

    let pat = pattern.unwrap_or_else(|| "*".to_string());
    if pat.len() > 1024 || pat.chars().any(|c| c.is_control()) {
        return Err("Redis key pattern must be at most 1024 bytes and contain no control characters.".into());
    }
    let cnt = count.unwrap_or(200).clamp(1, 1000);
    let mut con = client.get_multiplexed_tokio_connection().await
        .map_err(|e| format!("Redis connection error: {}", e))?;
    let res: (u64, Vec<String>) = redis::cmd("SCAN")
        .arg(0).arg("MATCH").arg(&pat).arg("COUNT").arg(cnt)
        .query_async(&mut con).await
        .map_err(|e| format!("Redis SCAN failed: {}", e))?;

    let mut items = Vec::with_capacity(res.1.len());
    for key in res.1.into_iter().take(1000) {
        let ty: String = redis::cmd("TYPE").arg(&key).query_async(&mut con).await
            .map_err(|e| format!("Redis TYPE failed for key '{}': {}", key, e))?;
        let ttl: i64 = redis::cmd("TTL").arg(&key).query_async(&mut con).await
            .map_err(|e| format!("Redis TTL failed for key '{}': {}", key, e))?;
        items.push(RedisKeyItem { key, key_type: ty, ttl, size: None });
    }
    Ok(items)
}

#[tauri::command]
pub async fn redis_get_value(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    key: String,
) -> Result<RedisValueItem, String> {
    if key.is_empty() || key.len() > 1024 || key.chars().any(|c| c == '\0') {
        return Err("Redis key must contain 1–1024 bytes and no NUL characters.".into());
    }
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id).cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };
    let client = match &session.driver {
        DriverInstance::Redis(client) => client.clone(),
        _ => return Err("Active connection is not Redis".to_string()),
    };
    let mut con = client.get_multiplexed_tokio_connection().await
        .map_err(|e| format!("Redis connection error: {}", e))?;
    let ty: String = redis::cmd("TYPE").arg(&key).query_async(&mut con).await
        .map_err(|e| format!("Redis TYPE failed: {}", e))?;
    let ttl: i64 = redis::cmd("TTL").arg(&key).query_async(&mut con).await
        .map_err(|e| format!("Redis TTL failed: {}", e))?;

    const MAX_ITEMS: usize = 10_000;
    let val: serde_json::Value = match ty.as_str() {
        "string" => {
            let value: Vec<u8> = redis::cmd("GET").arg(&key).query_async(&mut con).await
                .map_err(|e| format!("Redis GET failed: {}", e))?;
            if value.len() > 16 * 1024 * 1024 {
                return Err("Redis value exceeds the 16 MiB display limit.".into());
            }
            serde_json::Value::String(String::from_utf8_lossy(&value).to_string())
        }
        "hash" => {
            let size: usize = redis::cmd("HLEN").arg(&key).query_async(&mut con).await
                .map_err(|e| format!("Redis HLEN failed: {}", e))?;
            if size > MAX_ITEMS { return Err("Redis hash exceeds the 10,000-field display limit.".into()); }
            let map: HashMap<String, String> = redis::cmd("HGETALL").arg(&key).query_async(&mut con).await
                .map_err(|e| format!("Redis HGETALL failed: {}", e))?;
            serde_json::to_value(map).map_err(|e| format!("Could not serialize Redis hash: {}", e))?
        }
        "list" => {
            let size: usize = redis::cmd("LLEN").arg(&key).query_async(&mut con).await
                .map_err(|e| format!("Redis LLEN failed: {}", e))?;
            if size > MAX_ITEMS { return Err("Redis list exceeds the 10,000-item display limit.".into()); }
            let items: Vec<String> = redis::cmd("LRANGE").arg(&key).arg(0).arg((MAX_ITEMS - 1) as isize)
                .query_async(&mut con).await.map_err(|e| format!("Redis LRANGE failed: {}", e))?;
            serde_json::to_value(items).map_err(|e| format!("Could not serialize Redis list: {}", e))?
        }
        "set" => {
            let size: usize = redis::cmd("SCARD").arg(&key).query_async(&mut con).await
                .map_err(|e| format!("Redis SCARD failed: {}", e))?;
            if size > MAX_ITEMS { return Err("Redis set exceeds the 10,000-member display limit.".into()); }
            let items: Vec<String> = redis::cmd("SMEMBERS").arg(&key).query_async(&mut con).await
                .map_err(|e| format!("Redis SMEMBERS failed: {}", e))?;
            serde_json::to_value(items).map_err(|e| format!("Could not serialize Redis set: {}", e))?
        }
        "zset" => {
            let size: usize = redis::cmd("ZCARD").arg(&key).query_async(&mut con).await
                .map_err(|e| format!("Redis ZCARD failed: {}", e))?;
            if size > MAX_ITEMS { return Err("Redis sorted set exceeds the 10,000-member display limit.".into()); }
            let items: Vec<(String, f64)> = redis::cmd("ZRANGE").arg(&key).arg(0).arg((MAX_ITEMS - 1) as isize)
                .arg("WITHSCORES").query_async(&mut con).await
                .map_err(|e| format!("Redis ZRANGE failed: {}", e))?;
            serde_json::to_value(items).map_err(|e| format!("Could not serialize Redis sorted set: {}", e))?
        }
        "none" => serde_json::Value::Null,
        other => return Err(format!("Unsupported Redis key type '{}'.", other)),
    };

    Ok(RedisValueItem { key, key_type: ty, ttl, value: val })
}

#[tauri::command]
pub async fn redis_set_value(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    key: String,
    value: String,
    ttl: Option<i64>,
) -> Result<(), String> {
    if key.is_empty() || key.len() > 1024 || key.chars().any(|c| c == '\0') {
        return Err("Redis key must contain 1–1024 bytes and no NUL characters.".into());
    }
    if value.len() > 16 * 1024 * 1024 {
        return Err("Redis value exceeds the 16 MiB input limit.".into());
    }
    if ttl.map(|seconds| seconds <= 0).unwrap_or(false) {
        return Err("Redis TTL must be a positive number of seconds.".into());
    }
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id).cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };
    if session.config.read_only {
        return Err("Database session is in read-only mode".to_string());
    }
    let client = match &session.driver {
        DriverInstance::Redis(client) => client.clone(),
        _ => return Err("Active connection is not Redis".to_string()),
    };
    let mut con = client.get_multiplexed_tokio_connection().await
        .map_err(|e| format!("Redis connection error: {}", e))?;
    if let Some(seconds) = ttl {
        let _: () = redis::cmd("SETEX").arg(&key).arg(seconds).arg(&value)
            .query_async(&mut con).await.map_err(|e| format!("Redis SETEX failed: {}", e))?;
    } else {
        let _: () = redis::cmd("SET").arg(&key).arg(&value)
            .query_async(&mut con).await.map_err(|e| format!("Redis SET failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn redis_delete_key(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    key: String,
) -> Result<bool, String> {
    if key.is_empty() || key.len() > 1024 || key.chars().any(|c| c == '\0') {
        return Err("Redis key must contain 1–1024 bytes and no NUL characters.".into());
    }
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id).cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };
    if session.config.read_only {
        return Err("Database session is in read-only mode".to_string());
    }
    let client = match &session.driver {
        DriverInstance::Redis(client) => client.clone(),
        _ => return Err("Active connection is not Redis".to_string()),
    };
    let mut con = client.get_multiplexed_tokio_connection().await
        .map_err(|e| format!("Redis connection error: {}", e))?;
    let deleted: i64 = redis::cmd("DEL").arg(&key).query_async(&mut con).await
        .map_err(|e| format!("Redis DEL failed: {}", e))?;
    Ok(deleted > 0)
}
