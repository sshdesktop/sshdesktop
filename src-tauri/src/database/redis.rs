fn validate_redis_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 1024 || key.chars().any(|c| c.is_control()) {
        return Err("Redis key must contain 1–1024 bytes and no control characters.".into());
    }
    Ok(())
}

fn validate_redis_pattern(pattern: &str) -> Result<(), String> {
    if pattern.len() > 1024 || pattern.chars().any(|c| c.is_control()) {
        return Err("Redis key pattern must be at most 1024 bytes and contain no control characters.".into());
    }
    Ok(())
}

fn parse_redis_args(input: &str) -> Result<Vec<String>, String> {
    if input.len() > 1024 * 1024 {
        return Err("Redis command exceeds the 1 MiB input limit.".into());
    }
    if input.chars().any(|c| c == '\0') {
        return Err("Redis command contains a NUL byte.".into());
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
    if args.len() > 4096 || args.iter().any(|arg| arg.len() > 256 * 1024) {
        return Err("Redis command exceeds the 4096 argument count or per-argument size limit.".into());
    }
    if args.iter().any(|arg| arg.chars().any(|c| c.is_control())) {
        return Err("Redis command arguments must not contain control characters.".into());
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
    let parts = parse_redis_args(query)?;
    if parts.is_empty() {
        return Err("Empty Redis command".to_string());
    }
    let mut con = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client.get_multiplexed_tokio_connection(),
    ).await.map_err(|_| "Redis connection timed out after 10 seconds.".to_string())?
        .map_err(|e| format!("Redis connection error: {}", e))?;
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

    let val: redis::Value = tokio::time::timeout(
        std::time::Duration::from_secs(60),
        cmd.query_async(&mut con),
    ).await.map_err(|_| "Redis command timed out after 60 seconds.".to_string())?
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

    let encoded_size = serde_json::to_vec(&json_val)
        .map_err(|e| format!("Could not serialize Redis response: {}", e))?.len();
    if encoded_size > 16 * 1024 * 1024 {
        return Err("Redis response exceeds the 16 MiB display limit.".into());
    }

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
    let mut con = tokio::time::timeout(std::time::Duration::from_secs(10), client.get_multiplexed_tokio_connection())
        .await.map_err(|_| "Redis connection timed out after 10 seconds.".to_string())?
        .map_err(|e| format!("Redis connection error: {}", e))?;
    let mut keys = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut cursor: u64 = 0;
    loop {
        let (next, mut batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor).arg("MATCH").arg("*").arg("COUNT").arg(500)
            .query_async(&mut con).await.map_err(|e| format!("Redis SCAN failed: {}", e))?;
        for key in batch {
            if seen.insert(key.clone()) {
                keys.push(key);
                if keys.len() >= 10000 { break; }
            }
        }
        if keys.len() >= 10000 {
            keys.truncate(10000);
            break;
        }
        cursor = next;
        if cursor == 0 { break; }
    }
    if keys.len() > 10_000 {
        keys.truncate(10_000);
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
            validate_redis_key(name)?;
            let mut con = tokio::time::timeout(std::time::Duration::from_secs(10), client.get_multiplexed_tokio_connection())
                .await.map_err(|_| "Redis connection timed out after 10 seconds.".to_string())?
                .map_err(|e| format!("Redis connection error: {}", e))?;
            let deleted: u64 = tokio::time::timeout(
                std::time::Duration::from_secs(30),
                redis::cmd("DEL").arg(name).query_async(&mut con),
            ).await.map_err(|_| "Redis delete timed out after 30 seconds.".to_string())?
                .map_err(|e| format!("Redis DEL failed: {}", e))?;
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

async fn redis_hscan_bounded(
    con: &mut redis::aio::MultiplexedConnection,
    key: &str,
) -> Result<HashMap<String, String>, String> {
    const MAX_FIELDS: usize = 10_000;
    let mut cursor = 0u64;
    let mut fields = HashMap::new();
    loop {
        let (next, batch): (u64, Vec<(String, String)>) = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            redis::cmd("HSCAN").arg(key).arg(cursor).arg("COUNT").arg(1000).query_async(con),
        ).await.map_err(|_| "Redis HSCAN timed out.".to_string())?
            .map_err(|e| format!("Redis HSCAN failed: {}", e))?;
        for (field, value) in batch {
            fields.entry(field).or_insert(value);
            if fields.len() >= MAX_FIELDS { break; }
        }
        if fields.len() >= MAX_FIELDS || next == 0 { break; }
        cursor = next;
    }
    Ok(fields)
}

async fn redis_sscan_bounded(
    con: &mut redis::aio::MultiplexedConnection,
    key: &str,
) -> Result<Vec<String>, String> {
    const MAX_MEMBERS: usize = 10_000;
    let mut cursor = 0u64;
    let mut seen = std::collections::HashSet::new();
    let mut members = Vec::new();
    loop {
        let (next, batch): (u64, Vec<String>) = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            redis::cmd("SSCAN").arg(key).arg(cursor).arg("COUNT").arg(1000).query_async(con),
        ).await.map_err(|_| "Redis SSCAN timed out.".to_string())?
            .map_err(|e| format!("Redis SSCAN failed: {}", e))?;
        for member in batch {
            if seen.insert(member.clone()) {
                members.push(member);
                if members.len() >= MAX_MEMBERS { break; }
            }
        }
        if members.len() >= MAX_MEMBERS || next == 0 { break; }
        cursor = next;
    }
    Ok(members)
}

pub async fn get_object_definition_redis(
    client: &redis::Client,
    name: &str,
) -> Result<String, String> {
    validate_redis_key(name)?;
    let mut con = tokio::time::timeout(std::time::Duration::from_secs(10), client.get_multiplexed_tokio_connection())
        .await.map_err(|_| "Redis connection timed out after 10 seconds.".to_string())?
        .map_err(|e| format!("Redis connection error: {}", e))?;
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
    validate_redis_pattern(&pat)?;
    let cnt = count.unwrap_or(200).clamp(1, 1000);
    let mut con = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client.get_multiplexed_tokio_connection(),
    ).await.map_err(|_| "Redis connection timed out after 10 seconds.".to_string())?
        .map_err(|e| format!("Redis connection error: {}", e))?;
    const MAX_SCAN_KEYS: usize = 10_000;
    let scan_result = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        let mut cursor = 0u64;
        let mut seen = std::collections::HashSet::new();
        let mut keys = Vec::new();
        loop {
            let (next_cursor, batch): (u64, Vec<String>) = redis::cmd("SCAN")
                .arg(cursor).arg("MATCH").arg(&pat).arg("COUNT").arg(cnt)
                .query_async(&mut con).await
                .map_err(|e| format!("Redis SCAN failed: {}", e))?;
            for key in batch {
                if seen.insert(key.clone()) {
                    keys.push(key);
                    if keys.len() >= MAX_SCAN_KEYS { break; }
                }
            }
            if keys.len() >= MAX_SCAN_KEYS || next_cursor == 0 { break; }
            cursor = next_cursor;
        }
        let mut items = Vec::with_capacity(keys.len());
        for key in keys {
            let ty: String = redis::cmd("TYPE").arg(&key).query_async(&mut con).await
                .map_err(|e| format!("Redis TYPE failed for key '{}': {}", key, e))?;
            let ttl: i64 = redis::cmd("TTL").arg(&key).query_async(&mut con).await
                .map_err(|e| format!("Redis TTL failed for key '{}': {}", key, e))?;
            items.push(RedisKeyItem { key, key_type: ty, ttl, size: None });
        }
        Ok::<Vec<RedisKeyItem>, String>(items)
    }).await.map_err(|_| "Redis key scan exceeded the 30-second time limit.".to_string())??;
    Ok(scan_result)
}

#[tauri::command]
pub async fn redis_get_value(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    key: String,
) -> Result<RedisValueItem, String> {
    validate_redis_key(&key)?;
    let session = {
        let lock = db_mgr.sessions.lock().await;
        lock.get(&connection_id).cloned()
            .ok_or_else(|| "Database connection not active".to_string())?
    };
    let client = match &session.driver {
        DriverInstance::Redis(client) => client.clone(),
        _ => return Err("Active connection is not Redis".to_string()),
    };
    let mut con = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client.get_multiplexed_tokio_connection(),
    ).await.map_err(|_| "Redis connection timed out after 10 seconds.".to_string())?
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
            let map = redis_hscan_bounded(&mut con, &key).await?;
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
            let items = redis_sscan_bounded(&mut con, &key).await?;
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

    let encoded_size = serde_json::to_vec(&val)
        .map_err(|e| format!("Could not serialize Redis value: {}", e))?.len();
    if encoded_size > 16 * 1024 * 1024 {
        return Err("Redis key value exceeds the 16 MiB display limit.".into());
    }
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
    validate_redis_key(&key)?;
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
    let mut con = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client.get_multiplexed_tokio_connection(),
    ).await.map_err(|_| "Redis connection timed out after 10 seconds.".to_string())?
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
    validate_redis_key(&key)?;
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
    let mut con = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        client.get_multiplexed_tokio_connection(),
    ).await.map_err(|_| "Redis connection timed out after 10 seconds.".to_string())?
        .map_err(|e| format!("Redis connection error: {}", e))?;
    let deleted: i64 = redis::cmd("DEL").arg(&key).query_async(&mut con).await
        .map_err(|e| format!("Redis DEL failed: {}", e))?;
    Ok(deleted > 0)
}


#[cfg(test)]
mod redis_input_validation_tests {
    use super::*;

    #[test]
    fn redis_key_rejects_empty_oversized_and_control_values() {
        assert!(validate_redis_key("users:1").is_ok());
        assert!(validate_redis_key("").is_err());
        assert!(validate_redis_key(&"k".repeat(1025)).is_err());
        assert!(validate_redis_key("bad\nkey").is_err());
        assert!(validate_redis_key("bad\0key").is_err());
    }

    #[test]
    fn redis_pattern_rejects_controls_and_oversized_values() {
        assert!(validate_redis_pattern("cache:*").is_ok());
        assert!(validate_redis_pattern("bad\tpattern").is_err());
        assert!(validate_redis_pattern(&"x".repeat(1025)).is_err());
    }

    #[test]
    fn redis_command_parser_rejects_nul_and_control_characters() {
        assert!(parse_redis_args("GET key\0").is_err());
        assert!(parse_redis_args("GET bad\nkey").is_err());
    }

    #[test]
    fn redis_command_parser_enforces_argument_count() {
        let command = std::iter::repeat("x").take(4097).collect::<Vec<_>>().join(" ");
        assert!(parse_redis_args(&command).is_err());
    }

    #[test]
    fn redis_command_parser_preserves_quoted_and_escaped_arguments() {
        assert_eq!(
            parse_redis_args("SET greeting \"hello world\"").unwrap(),
            vec!["SET", "greeting", "hello world"]
        );
        assert_eq!(
            parse_redis_args("SET key hello\\ world").unwrap(),
            vec!["SET", "key", "hello world"]
        );
    }
}
