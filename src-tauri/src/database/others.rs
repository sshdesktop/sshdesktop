use std::time::Instant;
use super::types::{
    ActiveDatabaseSession, BatchStatementResult, ColumnMeta, DatabaseConnectionConfig,
    DatabaseObject, DriverInstance, QueryResult, ServerCapabilities,
};
use super::serialization::split_sql_statements;

pub async fn connect_dynamodb(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let _ = (effective_host, effective_port, config);
    Err("DYNAMODB connector is not implemented; refusing to report a simulated connection as successful.".to_string())
}

pub async fn connect_cosmos(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let _ = (effective_host, effective_port, config);
    Err("COSMOS connector is not implemented; refusing to report a simulated connection as successful.".to_string())
}

pub async fn connect_cassandra(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let _ = (effective_host, effective_port, config);
    Err("CASSANDRA connector is not implemented; refusing to report a simulated connection as successful.".to_string())
}

pub async fn connect_oracle(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let _ = (effective_host, effective_port, config);
    Err("ORACLE connector is not implemented; refusing to report a simulated connection as successful.".to_string())
}

pub async fn connect_db2(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let _ = (effective_host, effective_port, config);
    Err("DB2 connector is not implemented; refusing to report a simulated connection as successful.".to_string())
}

pub fn execute_query_dynamodb(
    _query: &str,
    _session: &ActiveDatabaseSession,
    _start: Instant,
) -> Result<QueryResult, String> {
    Err("DYNAMODB connector is not implemented; simulated query execution is disabled.".to_string())
}

pub fn execute_query_cosmos(
    _query: &str,
    _session: &ActiveDatabaseSession,
    _start: Instant,
) -> Result<QueryResult, String> {
    Err("COSMOS connector is not implemented; simulated query execution is disabled.".to_string())
}

pub fn execute_query_cassandra(
    _query: &str,
    _session: &ActiveDatabaseSession,
    _start: Instant,
) -> Result<QueryResult, String> {
    Err("CASSANDRA connector is not implemented; simulated query execution is disabled.".to_string())
}

pub fn execute_query_oracle(
    _query: &str,
    _session: &ActiveDatabaseSession,
    _start: Instant,
) -> Result<QueryResult, String> {
    Err("ORACLE connector is not implemented; simulated query execution is disabled.".to_string())
}

pub fn execute_query_db2(
    _query: &str,
    _session: &ActiveDatabaseSession,
    _start: Instant,
) -> Result<QueryResult, String> {
    Err("DB2 connector is not implemented; simulated query execution is disabled.".to_string())
}

pub fn list_tables_dynamodb() -> Result<Vec<DatabaseObject>, String> {
    Err("DYNAMODB connector is not implemented; simulated schema metadata is disabled.".to_string())
}

pub fn list_tables_cosmos(_database: &str) -> Result<Vec<DatabaseObject>, String> {
    Err("COSMOS connector is not implemented; simulated schema metadata is disabled.".to_string())
}

pub fn list_tables_cassandra(_keyspace: &Option<String>) -> Result<Vec<DatabaseObject>, String> {
    Err("CASSANDRA connector is not implemented; simulated schema metadata is disabled.".to_string())
}

pub fn list_tables_oracle(_sid: &Option<String>) -> Result<Vec<DatabaseObject>, String> {
    Err("ORACLE connector is not implemented; simulated schema metadata is disabled.".to_string())
}

pub fn list_tables_db2(_database: &str) -> Result<Vec<DatabaseObject>, String> {
    Err("DB2 connector is not implemented; simulated schema metadata is disabled.".to_string())
}

pub fn get_table_columns_dynamodb() -> Result<Vec<ColumnMeta>, String> {
    Err("DYNAMODB connector is not implemented; simulated column metadata is disabled.".to_string())
}

pub fn get_table_columns_cosmos() -> Result<Vec<ColumnMeta>, String> {
    Err("COSMOS connector is not implemented; simulated column metadata is disabled.".to_string())
}

pub fn get_table_columns_cassandra() -> Result<Vec<ColumnMeta>, String> {
    Err("CASSANDRA connector is not implemented; simulated column metadata is disabled.".to_string())
}

pub fn get_table_columns_oracle() -> Result<Vec<ColumnMeta>, String> {
    Err("ORACLE connector is not implemented; simulated column metadata is disabled.".to_string())
}

pub fn get_table_columns_db2() -> Result<Vec<ColumnMeta>, String> {
    Err("DB2 connector is not implemented; simulated column metadata is disabled.".to_string())
}

pub fn get_object_definition_others(_driver: &DriverInstance, _name: &str) -> Result<String, String> {
    Err("Object DDL retrieval is not implemented for this database connector.".to_string())
}
