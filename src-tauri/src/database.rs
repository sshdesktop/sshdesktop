use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use tiberius::Client as TiberiusClient;

// ─── Data Transfer Models ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DatabaseConnectionConfig {
    pub id: String,
    pub name: String,
    pub engine: String, // mysql, mariadb, postgresql, sqlite, mssql, mongodb, redis
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub database: String,
    pub schema: Option<String>,
    #[serde(default)]
    pub use_ssh: bool,
    pub ssh_connection_id: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_path: Option<String>,
    pub sqlite_path: Option<String>,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub is_foreign_key: bool,
    pub referenced_table: Option<String>,
    pub referenced_column: Option<String>,
    pub default_value: Option<String>,
    pub extra: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct QueryResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<serde_json::Value>,
    pub affected_rows: u64,
    pub last_insert_id: Option<i64>,
    pub execution_time_ms: f64,
    pub command_type: String,
    pub server_version: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ServerCapabilities {
    pub engine: String,
    pub server_version: String,
    pub supports_transactions: bool,
    pub supports_schemas: bool,
    pub supports_procedures: bool,
    pub supports_functions: bool,
    pub supports_triggers: bool,
    pub supports_views: bool,
    pub supports_indexes: bool,
    pub supports_foreign_keys: bool,
    pub supports_explain: bool,
    pub supports_process_list: bool,
    pub read_only: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DatabaseObject {
    pub name: String,
    pub object_type: String, // table, view, procedure, function, trigger, index, collection
    pub schema: Option<String>,
    pub row_count: Option<i64>,
    pub size_bytes: Option<i64>,
    pub definition: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ForeignKeyRelation {
    pub constraint_name: Option<String>,
    pub table_name: String,
    pub column_name: String,
    pub foreign_table_name: String,
    pub foreign_column_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RedisKeyItem {
    pub key: String,
    pub key_type: String,
    pub ttl: i64,
    pub size: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RedisValueItem {
    pub key: String,
    pub key_type: String,
    pub ttl: i64,
    pub value: serde_json::Value,
}

// ─── Driver Handles ────────────────────────────────────────────────

pub enum DriverInstance {
    MySql(sqlx::MySqlPool),
    Postgres(sqlx::PgPool),
    Sqlite(sqlx::SqlitePool),
    Mssql {
        config: tiberius::Config,
        tcp_addr: String,
    },
    Mongo(mongodb::Client),
    Redis(redis::Client),
}

pub struct ActiveDatabaseSession {
    pub id: String,
    pub config: DatabaseConnectionConfig,
    pub local_port: u16,
    pub tunnel_shutdown: Option<oneshot::Sender<()>>,
    pub driver: DriverInstance,
    pub capabilities: ServerCapabilities,
}

pub struct DatabaseManager {
    sessions: Arc<tokio::sync::Mutex<HashMap<String, ActiveDatabaseSession>>>,
}

impl DatabaseManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }
}

// ─── SSH Tunnel Helper ──────────────────────────────────────────────

async fn setup_ssh_tunnel(
    config: &DatabaseConnectionConfig,
    app_state: &crate::AppState,
) -> Result<(u16, oneshot::Sender<()>), String> {
    let target_host = if config.host.trim().is_empty() {
        "127.0.0.1".to_string()
    } else {
        config.host.trim().to_string()
    };
    let target_port = config.port;

    // Check if we have an active russh session
    let ssh_conn_id = config.ssh_connection_id.clone().unwrap_or_else(|| "default".to_string());
    let maybe_handle = {
        let lock = app_state.sessions.lock().await;
        lock.get(&ssh_conn_id).cloned()
    };

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local tunnel port: {}", e))?;
    let local_port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local port: {}", e))?
        .port();

    let (shutdown_tx, mut shutdown_rx) = oneshot::channel();

    let target_host_clone = target_host.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => {
                    log::info!("SSH tunnel on port {} stopped", local_port);
                    break;
                }
                res = listener.accept() => {
                    match res {
                        Ok((mut local_stream, _)) => {
                            if let Some(ref handle) = maybe_handle {
                                let h = handle.clone();
                                let r_host = target_host_clone.clone();
                                tokio::spawn(async move {
                                    match h.channel_open_direct_tcpip(&r_host, target_port as u32, "127.0.0.1", local_port as u32).await {
                                        Ok(channel) => {
                                            let mut ssh_stream = channel.into_stream();
                                            let _ = tokio::io::copy_bidirectional(&mut local_stream, &mut ssh_stream).await;
                                        }
                                        Err(e) => {
                                            log::error!("Failed to open direct-tcpip channel: {}", e);
                                        }
                                    }
                                });
                            }
                        }
                        Err(e) => {
                            log::warn!("Listener error on tunnel port {}: {}", local_port, e);
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok((local_port, shutdown_tx))
}

// ─── Native Driver Connect Implementations ─────────────────────────

async fn connect_mysql(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let pwd = config.password.as_deref().unwrap_or("");
    let url = format!(
        "mysql://{}:{}@{}:{}/{}",
        urlencoding(&config.username),
        urlencoding(pwd),
        effective_host,
        effective_port,
        config.database
    );

    let pool = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(config.timeout_seconds.unwrap_or(8)))
        .connect(&url)
        .await
        .map_err(|e| format!("MySQL connection error: {}", e))?;

    // Detect server version
    let version_row: (String,) = sqlx::query_as("SELECT VERSION()")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|_| ("MySQL Compatible".to_string(),));

    let capabilities = ServerCapabilities {
        engine: config.engine.clone(),
        server_version: version_row.0,
        supports_transactions: true,
        supports_schemas: false,
        supports_procedures: true,
        supports_functions: true,
        supports_triggers: true,
        supports_views: true,
        supports_indexes: true,
        supports_foreign_keys: true,
        supports_explain: true,
        supports_process_list: true,
        read_only: config.read_only,
    };

    Ok((DriverInstance::MySql(pool), capabilities))
}

async fn connect_postgres(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let pwd = config.password.as_deref().unwrap_or("");
    let url = format!(
        "postgres://{}:{}@{}:{}/{}",
        urlencoding(&config.username),
        urlencoding(pwd),
        effective_host,
        effective_port,
        config.database
    );

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(config.timeout_seconds.unwrap_or(8)))
        .connect(&url)
        .await
        .map_err(|e| format!("PostgreSQL connection error: {}", e))?;

    let version_row: (String,) = sqlx::query_as("SELECT version()")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|_| ("PostgreSQL".to_string(),));

    let capabilities = ServerCapabilities {
        engine: "postgresql".to_string(),
        server_version: version_row.0,
        supports_transactions: true,
        supports_schemas: true,
        supports_procedures: true,
        supports_functions: true,
        supports_triggers: true,
        supports_views: true,
        supports_indexes: true,
        supports_foreign_keys: true,
        supports_explain: true,
        supports_process_list: true,
        read_only: config.read_only,
    };

    Ok((DriverInstance::Postgres(pool), capabilities))
}

async fn connect_sqlite(
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let path = config.sqlite_path.as_deref().unwrap_or(&config.database);
    let url = format!("sqlite://{}", path);

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .map_err(|e| format!("SQLite connection error: {}", e))?;

    // Enable foreign keys
    let _ = sqlx::query("PRAGMA foreign_keys = ON;").execute(&pool).await;

    let version_row: (String,) = sqlx::query_as("SELECT sqlite_version()")
        .fetch_one(&pool)
        .await
        .unwrap_or_else(|_| ("SQLite 3".to_string(),));

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
    };

    Ok((DriverInstance::Sqlite(pool), capabilities))
}

async fn connect_mssql(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let mut tiberius_cfg = tiberius::Config::new();
    tiberius_cfg.host(effective_host);
    tiberius_cfg.port(effective_port);
    tiberius_cfg.authentication(tiberius::AuthMethod::sql_server(
        &config.username,
        config.password.as_deref().unwrap_or(""),
    ));
    tiberius_cfg.database(&config.database);
    tiberius_cfg.trust_cert();

    let tcp_addr = format!("{}:{}", effective_host, effective_port);
    let tcp = TcpStream::connect(&tcp_addr)
        .await
        .map_err(|e| format!("SQL Server TCP connect error: {}", e))?;
    tcp.set_nodelay(true).map_err(|e| e.to_string())?;

    let mut client = TiberiusClient::connect(tiberius_cfg.clone(), tcp.compat_write())
        .await
        .map_err(|e| format!("TDS handshake error: {}", e))?;

    let row = client
        .query("SELECT @@VERSION", &[])
        .await
        .map_err(|e| e.to_string())?
        .into_row()
        .await
        .map_err(|e| e.to_string())?;

    let version_str = row
        .and_then(|r| r.get::<&str, _>(0).map(|s| s.to_string()))
        .unwrap_or_else(|| "Microsoft SQL Server".to_string());

    let capabilities = ServerCapabilities {
        engine: "mssql".to_string(),
        server_version: version_str,
        supports_transactions: true,
        supports_schemas: true,
        supports_procedures: true,
        supports_functions: true,
        supports_triggers: true,
        supports_views: true,
        supports_indexes: true,
        supports_foreign_keys: true,
        supports_explain: true,
        supports_process_list: true,
        read_only: config.read_only,
    };

    Ok((
        DriverInstance::Mssql {
            config: tiberius_cfg,
            tcp_addr,
        },
        capabilities,
    ))
}

async fn connect_mongo(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let auth = if let Some(ref pwd) = config.password {
        if !config.username.is_empty() {
            format!("{}:{}@", urlencoding(&config.username), urlencoding(pwd))
        } else {
            "".to_string()
        }
    } else {
        "".to_string()
    };

    let uri = format!("mongodb://{}{}:{}/{}", auth, effective_host, effective_port, config.database);
    let client_options = mongodb::options::ClientOptions::parse(&uri)
        .await
        .map_err(|e| format!("MongoDB connection string error: {}", e))?;

    let client = mongodb::Client::with_options(client_options)
        .map_err(|e| format!("MongoDB client init error: {}", e))?;

    // Ping to verify
    let db = client.database(&config.database);
    let ping_doc = mongodb::bson::doc! { "ping": 1 };
    db.run_command(ping_doc, None)
        .await
        .map_err(|e| format!("MongoDB ping failed: {}", e))?;

    let build_info = db
        .run_command(mongodb::bson::doc! { "buildInfo": 1 }, None)
        .await
        .ok();
    let version_str = build_info
        .and_then(|d| d.get_str("version").ok().map(|s| s.to_string()))
        .unwrap_or_else(|| "MongoDB".to_string());

    let capabilities = ServerCapabilities {
        engine: "mongodb".to_string(),
        server_version: version_str,
        supports_transactions: true,
        supports_schemas: false,
        supports_procedures: false,
        supports_functions: false,
        supports_triggers: false,
        supports_views: true,
        supports_indexes: true,
        supports_foreign_keys: false,
        supports_explain: true,
        supports_process_list: false,
        read_only: config.read_only,
    };

    Ok((DriverInstance::Mongo(client), capabilities))
}

async fn connect_redis(
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

    let url = format!("redis://{}{}:{}/{}", auth, effective_host, effective_port, config.database);
    let client = redis::Client::open(url).map_err(|e| format!("Redis client init error: {}", e))?;

    let mut con = client
        .get_multiplexed_tokio_connection()
        .await
        .map_err(|e| format!("Redis connect error: {}", e))?;

    let pong: String = redis::cmd("PING")
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
    };

    Ok((DriverInstance::Redis(client), capabilities))
}

fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

// ─── SQL Row Serialization Helper ─────────────────────────────────

fn serialize_mysql_row(row: &sqlx::mysql::MySqlRow) -> (Vec<ColumnMeta>, serde_json::Value) {
    use sqlx::Column;
    use sqlx::Row;
    use sqlx::TypeInfo;

    let mut cols_meta = Vec::new();
    let mut obj = serde_json::Map::new();

    for col in row.columns() {
        let name = col.name().to_string();
        let type_name = col.type_info().name().to_string();

        cols_meta.push(ColumnMeta {
            name: name.clone(),
            data_type: type_name.clone(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        });

        // Try extracting value by type
        let json_val = if let Ok(val) = row.try_get::<Option<i64>, _>(col.ordinal()) {
            val.map(|v| serde_json::Value::Number(v.into())).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<f64>, _>(col.ordinal()) {
            val.and_then(|v| serde_json::Number::from_f64(v).map(serde_json::Value::Number))
                .unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<bool>, _>(col.ordinal()) {
            val.map(serde_json::Value::Bool).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<String>, _>(col.ordinal()) {
            val.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
        } else {
            serde_json::Value::Null
        };

        obj.insert(name, json_val);
    }

    (cols_meta, serde_json::Value::Object(obj))
}

fn serialize_pg_row(row: &sqlx::postgres::PgRow) -> (Vec<ColumnMeta>, serde_json::Value) {
    use sqlx::Column;
    use sqlx::Row;
    use sqlx::TypeInfo;

    let mut cols_meta = Vec::new();
    let mut obj = serde_json::Map::new();

    for col in row.columns() {
        let name = col.name().to_string();
        let type_name = col.type_info().name().to_string();

        cols_meta.push(ColumnMeta {
            name: name.clone(),
            data_type: type_name.clone(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        });

        let json_val = if let Ok(val) = row.try_get::<Option<i64>, _>(col.ordinal()) {
            val.map(|v| serde_json::Value::Number(v.into())).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<i32>, _>(col.ordinal()) {
            val.map(|v| serde_json::Value::Number(v.into())).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<f64>, _>(col.ordinal()) {
            val.and_then(|v| serde_json::Number::from_f64(v).map(serde_json::Value::Number))
                .unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<bool>, _>(col.ordinal()) {
            val.map(serde_json::Value::Bool).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<String>, _>(col.ordinal()) {
            val.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
        } else {
            serde_json::Value::Null
        };

        obj.insert(name, json_val);
    }

    (cols_meta, serde_json::Value::Object(obj))
}

fn serialize_sqlite_row(row: &sqlx::sqlite::SqliteRow) -> (Vec<ColumnMeta>, serde_json::Value) {
    use sqlx::Column;
    use sqlx::Row;
    use sqlx::TypeInfo;

    let mut cols_meta = Vec::new();
    let mut obj = serde_json::Map::new();

    for col in row.columns() {
        let name = col.name().to_string();
        let type_name = col.type_info().name().to_string();

        cols_meta.push(ColumnMeta {
            name: name.clone(),
            data_type: type_name.clone(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        });

        let json_val = if let Ok(val) = row.try_get::<Option<i64>, _>(col.ordinal()) {
            val.map(|v| serde_json::Value::Number(v.into())).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<f64>, _>(col.ordinal()) {
            val.and_then(|v| serde_json::Number::from_f64(v).map(serde_json::Value::Number))
                .unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<Option<String>, _>(col.ordinal()) {
            val.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)
        } else {
            serde_json::Value::Null
        };

        obj.insert(name, json_val);
    }

    (cols_meta, serde_json::Value::Object(obj))
}

// ─── TAURI COMMAND IMPLEMENTATIONS ─────────────────────────────────

#[tauri::command]
pub async fn db_connect(
    state: tauri::State<'_, crate::AppState>,
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    config: DatabaseConnectionConfig,
) -> Result<ServerCapabilities, String> {
    let (effective_host, effective_port, tunnel_tx) = if config.use_ssh {
        let (p, tx) = setup_ssh_tunnel(&config, &state).await?;
        ("127.0.0.1".to_string(), p, Some(tx))
    } else {
        (config.host.clone(), config.port, None)
    };

    let (driver, capabilities) = match config.engine.as_str() {
        "mysql" | "mariadb" => connect_mysql(&effective_host, effective_port, &config).await?,
        "postgresql" => connect_postgres(&effective_host, effective_port, &config).await?,
        "sqlite" => connect_sqlite(&config).await?,
        "mssql" => connect_mssql(&effective_host, effective_port, &config).await?,
        "mongodb" => connect_mongo(&effective_host, effective_port, &config).await?,
        "redis" => connect_redis(&effective_host, effective_port, &config).await?,
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
    let (effective_host, effective_port, tunnel_tx) = if config.use_ssh {
        let (p, tx) = setup_ssh_tunnel(&config, &state).await?;
        ("127.0.0.1".to_string(), p, Some(tx))
    } else {
        (config.host.clone(), config.port, None)
    };

    let res = match config.engine.as_str() {
        "mysql" | "mariadb" => connect_mysql(&effective_host, effective_port, &config).await,
        "postgresql" => connect_postgres(&effective_host, effective_port, &config).await,
        "sqlite" => connect_sqlite(&config).await,
        "mssql" => connect_mssql(&effective_host, effective_port, &config).await,
        "mongodb" => connect_mongo(&effective_host, effective_port, &config).await,
        "redis" => connect_redis(&effective_host, effective_port, &config).await,
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
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    query: String,
    max_rows: Option<u32>,
) -> Result<QueryResult, String> {
    let limit = max_rows.unwrap_or(500) as usize;
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    let start = Instant::now();

    match &session.driver {
        DriverInstance::MySql(pool) => {
            let rows = sqlx::query(&query)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("MySQL error: {}", e))?;

            let mut cols_meta = Vec::new();
            let mut json_rows = Vec::new();

            for (idx, row) in rows.iter().enumerate() {
                if idx >= limit {
                    break;
                }
                let (meta, val) = serialize_mysql_row(row);
                if idx == 0 {
                    cols_meta = meta;
                }
                json_rows.push(val);
            }

            Ok(QueryResult {
                columns: cols_meta,
                rows: json_rows,
                affected_rows: rows.len() as u64,
                last_insert_id: None,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                command_type: "SQL".to_string(),
                server_version: Some(session.capabilities.server_version.clone()),
                warnings: Vec::new(),
            })
        }

        DriverInstance::Postgres(pool) => {
            let rows = sqlx::query(&query)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("PostgreSQL error: {}", e))?;

            let mut cols_meta = Vec::new();
            let mut json_rows = Vec::new();

            for (idx, row) in rows.iter().enumerate() {
                if idx >= limit {
                    break;
                }
                let (meta, val) = serialize_pg_row(row);
                if idx == 0 {
                    cols_meta = meta;
                }
                json_rows.push(val);
            }

            Ok(QueryResult {
                columns: cols_meta,
                rows: json_rows,
                affected_rows: rows.len() as u64,
                last_insert_id: None,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                command_type: "SQL".to_string(),
                server_version: Some(session.capabilities.server_version.clone()),
                warnings: Vec::new(),
            })
        }

        DriverInstance::Sqlite(pool) => {
            let rows = sqlx::query(&query)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("SQLite error: {}", e))?;

            let mut cols_meta = Vec::new();
            let mut json_rows = Vec::new();

            for (idx, row) in rows.iter().enumerate() {
                if idx >= limit {
                    break;
                }
                let (meta, val) = serialize_sqlite_row(row);
                if idx == 0 {
                    cols_meta = meta;
                }
                json_rows.push(val);
            }

            Ok(QueryResult {
                columns: cols_meta,
                rows: json_rows,
                affected_rows: rows.len() as u64,
                last_insert_id: None,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                command_type: "SQL".to_string(),
                server_version: Some(session.capabilities.server_version.clone()),
                warnings: Vec::new(),
            })
        }

        DriverInstance::Mssql { config, tcp_addr } => {
            let tcp = TcpStream::connect(tcp_addr)
                .await
                .map_err(|e| format!("MSSQL reconnect error: {}", e))?;
            tcp.set_nodelay(true).map_err(|e| e.to_string())?;

            let mut client = TiberiusClient::connect(config.clone(), tcp.compat_write())
                .await
                .map_err(|e| format!("MSSQL connect error: {}", e))?;

            let stream = client
                .simple_query(&query)
                .await
                .map_err(|e| format!("MSSQL query error: {}", e))?;

            let rows = stream.into_first_result().await.map_err(|e| e.to_string())?;

            let mut cols_meta = Vec::new();
            let mut json_rows = Vec::new();

            for (idx, row) in rows.iter().enumerate() {
                if idx >= limit {
                    break;
                }
                let mut obj = serde_json::Map::new();
                for (col_idx, col) in row.columns().iter().enumerate() {
                    let col_name = col.name().to_string();
                    if idx == 0 {
                        cols_meta.push(ColumnMeta {
                            name: col_name.clone(),
                            data_type: format!("{:?}", col.column_type()),
                            nullable: true,
                            is_primary_key: false,
                            is_foreign_key: false,
                            referenced_table: None,
                            referenced_column: None,
                            default_value: None,
                            extra: None,
                        });
                    }
                    let val = row
                        .get::<&str, _>(col_idx)
                        .map(|s| serde_json::Value::String(s.to_string()))
                        .unwrap_or(serde_json::Value::Null);
                    obj.insert(col_name, val);
                }
                json_rows.push(serde_json::Value::Object(obj));
            }

            Ok(QueryResult {
                columns: cols_meta,
                rows: json_rows,
                affected_rows: rows.len() as u64,
                last_insert_id: None,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                command_type: "T-SQL".to_string(),
                server_version: Some(session.capabilities.server_version.clone()),
                warnings: Vec::new(),
            })
        }

        DriverInstance::Mongo(client) => {
            // Evaluates command as MongoDB runCommand or collection operation
            let db = client.database(&session.config.database);
            let doc_cmd: mongodb::bson::Document = serde_json::from_str(&query)
                .map_err(|_| "MongoDB query must be a valid BSON/JSON document expression".to_string())?;

            let res = db
                .run_command(doc_cmd, None)
                .await
                .map_err(|e| format!("MongoDB command error: {}", e))?;

            let json_res: serde_json::Value = mongodb::bson::Bson::Document(res).into_relaxed_extjson();

            Ok(QueryResult {
                columns: vec![ColumnMeta {
                    name: "result".to_string(),
                    data_type: "Document".to_string(),
                    nullable: true,
                    is_primary_key: false,
                    is_foreign_key: false,
                    referenced_table: None,
                    referenced_column: None,
                    default_value: None,
                    extra: None,
                }],
                rows: vec![json_res],
                affected_rows: 1,
                last_insert_id: None,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                command_type: "MongoDB".to_string(),
                server_version: Some(session.capabilities.server_version.clone()),
                warnings: Vec::new(),
            })
        }

        DriverInstance::Redis(client) => {
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
            })
        }
    }
}

#[tauri::command]
pub async fn db_list_tables(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<DatabaseObject>, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    match &session.driver {
        DriverInstance::MySql(pool) => {
            use sqlx::Row;
            let rows = sqlx::query(
                "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
            )
            .bind(&session.config.database)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(rows
                .into_iter()
                .map(|r| {
                    let table_name: String = r.try_get(0).unwrap_or_default();
                    let table_type: String = r.try_get(1).unwrap_or_default();
                    DatabaseObject {
                        name: table_name,
                        object_type: if table_type == "VIEW" { "view".to_string() } else { "table".to_string() },
                        schema: Some(session.config.database.clone()),
                        row_count: None,
                        size_bytes: None,
                        definition: None,
                    }
                })
                .collect())
        }

        DriverInstance::Postgres(pool) => {
            use sqlx::Row;
            let schema_name = schema.unwrap_or_else(|| "public".to_string());
            let rows = sqlx::query(
                "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
            )
            .bind(&schema_name)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(rows
                .into_iter()
                .map(|r| {
                    let table_name: String = r.try_get(0).unwrap_or_default();
                    let table_type: String = r.try_get(1).unwrap_or_default();
                    DatabaseObject {
                        name: table_name,
                        object_type: if table_type == "VIEW" { "view".to_string() } else { "table".to_string() },
                        schema: Some(schema_name.clone()),
                        row_count: None,
                        size_bytes: None,
                        definition: None,
                    }
                })
                .collect())
        }

        DriverInstance::Sqlite(pool) => {
            use sqlx::Row;
            let rows = sqlx::query(
                "SELECT name, type FROM sqlite_master WHERE type in ('table','view') ORDER BY name",
            )
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(rows
                .into_iter()
                .filter_map(|r| {
                    let name: Option<String> = r.try_get(0).ok();
                    let obj_type: String = r.try_get(1).unwrap_or_else(|_| "table".to_string());
                    name.map(|n| DatabaseObject {
                        name: n,
                        object_type: obj_type,
                        schema: None,
                        row_count: None,
                        size_bytes: None,
                        definition: None,
                    })
                })
                .collect())
        }

        DriverInstance::Mssql { config, tcp_addr } => {
            let tcp = TcpStream::connect(tcp_addr).await.map_err(|e| e.to_string())?;
            tcp.set_nodelay(true).map_err(|e| e.to_string())?;
            let mut client = TiberiusClient::connect(config.clone(), tcp.compat_write()).await.map_err(|e| e.to_string())?;

            let rows = client
                .simple_query("SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME")
                .await
                .map_err(|e| e.to_string())?
                .into_first_result()
                .await
                .map_err(|e| e.to_string())?;

            let mut res = Vec::new();
            for r in rows {
                if let (Some(name), Some(ty)) = (r.get::<&str, _>(0), r.get::<&str, _>(1)) {
                    res.push(DatabaseObject {
                        name: name.to_string(),
                        object_type: if ty.contains("VIEW") { "view".to_string() } else { "table".to_string() },
                        schema: Some("dbo".to_string()),
                        row_count: None,
                        size_bytes: None,
                        definition: None,
                    });
                }
            }
            Ok(res)
        }

        DriverInstance::Mongo(client) => {
            let db = client.database(&session.config.database);
            let collections = db.list_collection_names(None).await.map_err(|e| e.to_string())?;
            Ok(collections
                .into_iter()
                .map(|c| DatabaseObject {
                    name: c,
                    object_type: "collection".to_string(),
                    schema: Some(session.config.database.clone()),
                    row_count: None,
                    size_bytes: None,
                    definition: None,
                })
                .collect())
        }

        DriverInstance::Redis(client) => {
            let mut con = client.get_multiplexed_tokio_connection().await.map_err(|e| e.to_string())?;
            let keys: Vec<String> = redis::cmd("KEYS").arg("*").query_async(&mut con).await.unwrap_or_default();
            Ok(keys
                .into_iter()
                .map(|k| DatabaseObject {
                    name: k,
                    object_type: "key".to_string(),
                    schema: Some(session.config.database.clone()),
                    row_count: None,
                    size_bytes: None,
                    definition: None,
                })
                .collect())
        }
    }
}

#[tauri::command]
pub async fn db_get_table_columns(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    table_name: String,
) -> Result<Vec<ColumnMeta>, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    match &session.driver {
        DriverInstance::MySql(pool) => {
            use sqlx::Row;
            let rows = sqlx::query(
                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
            )
            .bind(&session.config.database)
            .bind(&table_name)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(rows
                .into_iter()
                .map(|r| {
                    let col_name: String = r.try_get(0).unwrap_or_default();
                    let col_type: String = r.try_get(1).unwrap_or_default();
                    let is_nullable: String = r.try_get(2).unwrap_or_default();
                    let col_key: String = r.try_get(3).unwrap_or_default();
                    let col_default: Option<String> = r.try_get(4).ok();
                    let extra: Option<String> = r.try_get(5).ok();
                    ColumnMeta {
                        name: col_name,
                        data_type: col_type,
                        nullable: is_nullable == "YES",
                        is_primary_key: col_key == "PRI",
                        is_foreign_key: col_key == "MUL",
                        referenced_table: None,
                        referenced_column: None,
                        default_value: col_default,
                        extra,
                    }
                })
                .collect())
        }

        DriverInstance::Postgres(pool) => {
            use sqlx::Row;
            let rows = sqlx::query(
                "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
            )
            .bind(&table_name)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

            Ok(rows
                .into_iter()
                .map(|r| {
                    let col_name: String = r.try_get(0).unwrap_or_default();
                    let data_type: String = r.try_get(1).unwrap_or_default();
                    let is_nullable: String = r.try_get(2).unwrap_or_default();
                    let col_default: Option<String> = r.try_get(3).ok();
                    ColumnMeta {
                        name: col_name,
                        data_type,
                        nullable: is_nullable == "YES",
                        is_primary_key: false,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: col_default,
                        extra: None,
                    }
                })
                .collect())
        }

        DriverInstance::Sqlite(pool) => {
            let q = format!("PRAGMA table_info('{}');", table_name);
            let rows = sqlx::query(&q).fetch_all(pool).await.map_err(|e| e.to_string())?;

            use sqlx::Row;
            let mut cols = Vec::new();
            for r in rows {
                let name: String = r.try_get("name").unwrap_or_default();
                let ty: String = r.try_get("type").unwrap_or_else(|_| "TEXT".to_string());
                let notnull: i64 = r.try_get("notnull").unwrap_or(0);
                let pk: i64 = r.try_get("pk").unwrap_or(0);
                let dflt: Option<String> = r.try_get("dflt_value").ok();

                cols.push(ColumnMeta {
                    name,
                    data_type: ty,
                    nullable: notnull == 0,
                    is_primary_key: pk > 0,
                    is_foreign_key: false,
                    referenced_table: None,
                    referenced_column: None,
                    default_value: dflt,
                    extra: None,
                });
            }
            Ok(cols)
        }

        DriverInstance::Mssql { config, tcp_addr } => {
            let tcp = TcpStream::connect(tcp_addr).await.map_err(|e| e.to_string())?;
            tcp.set_nodelay(true).map_err(|e| e.to_string())?;
            let mut client = TiberiusClient::connect(config.clone(), tcp.compat_write()).await.map_err(|e| e.to_string())?;

            let sql = format!(
                "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '{}' ORDER BY ORDINAL_POSITION",
                table_name
            );
            let rows = client
                .simple_query(sql)
                .await
                .map_err(|e| e.to_string())?
                .into_first_result()
                .await
                .map_err(|e| e.to_string())?;

            let mut cols = Vec::new();
            for r in rows {
                let name = r.get::<&str, _>(0).unwrap_or("").to_string();
                let ty = r.get::<&str, _>(1).unwrap_or("").to_string();
                let nullable = r.get::<&str, _>(2).unwrap_or("") == "YES";
                let def = r.get::<&str, _>(3).map(|s| s.to_string());

                cols.push(ColumnMeta {
                    name,
                    data_type: ty,
                    nullable,
                    is_primary_key: false,
                    is_foreign_key: false,
                    referenced_table: None,
                    referenced_column: None,
                    default_value: def,
                    extra: None,
                });
            }
            Ok(cols)
        }

        _ => Ok(Vec::new()),
    }
}

// ─── Redis Specific Commands ───────────────────────────────────────

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

// ─── MongoDB Specific Commands ─────────────────────────────────────

#[tauri::command]
pub async fn mongodb_list_collections(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let DriverInstance::Mongo(client) = &session.driver {
        let db = client.database(&session.config.database);
        db.list_collection_names(None).await.map_err(|e| e.to_string())
    } else {
        Err("Active connection is not MongoDB".to_string())
    }
}

#[tauri::command]
pub async fn mongodb_find_documents(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    collection: String,
    filter_json: Option<String>,
    skip: Option<u64>,
    limit: Option<i64>,
) -> Result<QueryResult, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let DriverInstance::Mongo(client) = &session.driver {
        let db = client.database(&session.config.database);
        let coll = db.collection::<mongodb::bson::Document>(&collection);

        let filter_doc = if let Some(ref fj) = filter_json {
            if !fj.trim().is_empty() {
                serde_json::from_str(fj).map_err(|e| format!("Invalid filter JSON: {}", e))?
            } else {
                mongodb::bson::doc! {}
            }
        } else {
            mongodb::bson::doc! {}
        };

        let mut find_options = mongodb::options::FindOptions::default();
        find_options.skip = skip;
        find_options.limit = Some(limit.unwrap_or(100));

        let start = Instant::now();
        use futures::StreamExt;
        let mut cursor = coll.find(filter_doc, find_options).await.map_err(|e| e.to_string())?;

        let mut json_docs = Vec::new();
        while let Some(doc) = cursor.next().await {
            let d = doc.map_err(|e| e.to_string())?;
            json_docs.push(mongodb::bson::Bson::Document(d).into_relaxed_extjson());
        }

        Ok(QueryResult {
            columns: vec![ColumnMeta {
                name: "document".to_string(),
                data_type: "BSON Document".to_string(),
                nullable: true,
                is_primary_key: false,
                is_foreign_key: false,
                referenced_table: None,
                referenced_column: None,
                default_value: None,
                extra: None,
            }],
            rows: json_docs,
            affected_rows: 0,
            last_insert_id: None,
            execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
            command_type: "MongoDB Find".to_string(),
            server_version: Some(session.capabilities.server_version.clone()),
            warnings: Vec::new(),
        })
    } else {
        Err("Active connection is not MongoDB".to_string())
    }
}

#[tauri::command]
pub async fn mongodb_insert_document(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    collection: String,
    doc_json: String,
) -> Result<String, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let DriverInstance::Mongo(client) = &session.driver {
        let db = client.database(&session.config.database);
        let coll = db.collection::<mongodb::bson::Document>(&collection);

        let doc: mongodb::bson::Document = serde_json::from_str(&doc_json).map_err(|e| e.to_string())?;
        let res = coll.insert_one(doc, None).await.map_err(|e| e.to_string())?;

        Ok(format!("{:?}", res.inserted_id))
    } else {
        Err("Active connection is not MongoDB".to_string())
    }
}
