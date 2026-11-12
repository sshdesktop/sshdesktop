use std::time::Instant;
use super::types::{
    ActiveDatabaseSession, ColumnMeta, DatabaseConnectionConfig, DatabaseObject,
    DriverInstance, QueryResult, ServerCapabilities,
};

pub async fn connect_oracle(
    _effective_host: &str,
    _effective_port: u16,
    _config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    Err("ORACLE connector requires Oracle Instant Client SDK (oci.dll on Windows, libclntsh.so on Linux). Install the Oracle Instant Client and configure your system PATH to enable native Oracle connections.".to_string())
}

pub async fn connect_db2(
    _effective_host: &str,
    _effective_port: u16,
    _config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    Err("DB2 connector requires IBM Db2 CLI client libraries (db2cli.dll on Windows, libdb2.so on Linux). Install the IBM Data Server Driver package to enable native DB2 connections.".to_string())
}

pub fn execute_query_oracle(
    _query: &str,
    _session: &ActiveDatabaseSession,
    _start: Instant,
) -> Result<QueryResult, String> {
    Err("ORACLE connector is not available: Oracle Instant Client is not installed.".to_string())
}

pub fn execute_query_db2(
    _query: &str,
    _session: &ActiveDatabaseSession,
    _start: Instant,
) -> Result<QueryResult, String> {
    Err("DB2 connector is not available: IBM Db2 CLI client is not installed.".to_string())
}

pub fn list_tables_oracle(_sid: &Option<String>) -> Result<Vec<DatabaseObject>, String> {
    Err("ORACLE connector is not available: Oracle Instant Client is not installed.".to_string())
}

pub fn list_tables_db2(_database: &str) -> Result<Vec<DatabaseObject>, String> {
    Err("DB2 connector is not available: IBM Db2 CLI client is not installed.".to_string())
}

pub fn get_table_columns_oracle() -> Result<Vec<ColumnMeta>, String> {
    Err("ORACLE connector is not available: Oracle Instant Client is not installed.".to_string())
}

pub fn get_table_columns_db2() -> Result<Vec<ColumnMeta>, String> {
    Err("DB2 connector is not available: IBM Db2 CLI client is not installed.".to_string())
}

pub fn get_object_definition_others(_driver: &DriverInstance, _name: &str) -> Result<String, String> {
    Err("Object DDL retrieval is not supported for this database connector.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::types::DatabaseConnectionConfig;

    #[tokio::test]
    async fn oracle_and_db2_require_system_client_libraries() {
        let cfg = DatabaseConnectionConfig {
            id: "t".into(),
            name: "t".into(),
            engine: "oracle".into(),
            host: "127.0.0.1".into(),
            port: 1521,
            username: "u".into(),
            password: Some("p".into()),
            database: "d".into(),
            ..Default::default()
        };
        assert!(connect_oracle("127.0.0.1", 1521, &cfg).await.is_err());
        assert!(connect_db2("127.0.0.1", 50000, &cfg).await.is_err());
        assert!(list_tables_oracle(&None).is_err());
        assert!(list_tables_db2("d").is_err());
    }
}
