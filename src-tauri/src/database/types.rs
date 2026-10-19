use std::collections::HashMap;
use std::sync::Arc;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;

// ─── Data Transfer Models ──────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DatabaseConnectionConfig {
    pub id: String,
    pub name: String,
    pub engine: String, // mysql, mariadb, postgresql, sqlite, mssql, mongodb, redis, oracle, dynamodb, cosmos, cassandra, db2
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub database: String,
    pub schema: Option<String>,
    #[serde(default)]
    pub use_ssl: bool,
    #[serde(default)]
    pub ssl_verify: bool,
    #[serde(default)]
    pub use_ssh: bool,
    pub ssh_connection_id: Option<String>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_path: Option<String>,
    pub sqlite_path: Option<String>,
    // Cloud & NoSQL parameters
    pub access_key_id: Option<String>,
    pub secret_access_key: Option<String>,
    pub region: Option<String>,
    pub endpoint_url: Option<String>,
    pub keyspace: Option<String>,
    pub sid: Option<String>,
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
pub struct BatchStatementResult {
    pub statement: String,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<serde_json::Value>,
    pub affected_rows: u64,
    pub last_insert_id: Option<i64>,
    pub execution_time_ms: f64,
    pub error: Option<String>,
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
    #[serde(default)]
    pub all_results: Option<Vec<BatchStatementResult>>,
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
    #[serde(default)]
    pub supports_rename_table: bool,
    #[serde(default)]
    pub supports_alter_column: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ColumnSpec {
    pub name: String,
    pub data_type: String,
    #[serde(default)]
    pub nullable: bool,
    #[serde(default)]
    pub primary_key: bool,
    #[serde(default)]
    pub auto_increment: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "operation", rename_all = "snake_case")]
pub enum DatabaseOperation {
    CreateTable {
        database: Option<String>,
        schema: Option<String>,
        table: String,
        columns: Vec<ColumnSpec>,
    },
    RenameObject {
        database: Option<String>,
        schema: Option<String>,
        object_type: String, // table, view, procedure, function, trigger
        old_name: String,
        new_name: String,
    },
    DropObject {
        database: Option<String>,
        schema: Option<String>,
        object_type: String, // table, view, procedure, function, trigger, collection, key
        name: String,
    },
    TruncateTable {
        database: Option<String>,
        schema: Option<String>,
        table: String,
    },
    AddColumn {
        database: Option<String>,
        schema: Option<String>,
        table: String,
        column: ColumnSpec,
    },
    DropColumn {
        database: Option<String>,
        schema: Option<String>,
        table: String,
        column_name: String,
    },
    CreateIndex {
        database: Option<String>,
        schema: Option<String>,
        table: String,
        index_name: String,
        columns: Vec<String>,
        is_unique: bool,
    },
    DropIndex {
        database: Option<String>,
        schema: Option<String>,
        table: String,
        index_name: String,
    },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OperationResult {
    pub success: bool,
    pub message: String,
    pub affected_rows: u64,
    pub execution_time_ms: f64,
    pub generated_sql: Option<String>,
    pub definition: Option<String>,
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
    DynamoDb {
        endpoint: String,
        region: String,
    },
    CosmosDb {
        endpoint: String,
        database: String,
    },
    Cassandra {
        host: String,
        port: u16,
        keyspace: Option<String>,
    },
    Oracle {
        host: String,
        port: u16,
        sid: Option<String>,
    },
    Db2 {
        host: String,
        port: u16,
        database: String,
    },
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
    pub sessions: Arc<tokio::sync::Mutex<HashMap<String, ActiveDatabaseSession>>>,
}

impl DatabaseManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(tokio::sync::Mutex::new(HashMap::new())),
        }
    }
}

pub fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}
