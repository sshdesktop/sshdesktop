use std::time::Instant;
use tokio::net::TcpStream;
use tokio_util::compat::TokioAsyncWriteCompatExt;
use tiberius::Client as TiberiusClient;
use super::types::{
    ActiveDatabaseSession, BatchStatementResult, ColumnMeta, DatabaseConnectionConfig,
    DatabaseObject, DriverInstance, QueryResult, ServerCapabilities,
};
use super::serialization::split_sql_statements;

pub async fn connect_mssql(
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

    // Set encryption according to config.use_ssl
    if config.use_ssl {
        tiberius_cfg.encryption(tiberius::EncryptionLevel::Required);
        tiberius_cfg.trust_cert();
    } else {
        tiberius_cfg.encryption(tiberius::EncryptionLevel::NotSupported);
    }

    let tcp_addr = format!("{}:{}", effective_host, effective_port);
    let tcp = TcpStream::connect(&tcp_addr)
        .await
        .map_err(|e| format!("SQL Server TCP connect error: {}", e))?;
    tcp.set_nodelay(true).map_err(|e| e.to_string())?;

    let client_res = TiberiusClient::connect(tiberius_cfg.clone(), tcp.compat_write()).await;
    let mut client = match client_res {
        Ok(c) => c,
        Err(e) => {
            // Prelogin handshake fallback: toggle encryption mode in case of server-side mismatch
            let mut alt_cfg = tiberius_cfg.clone();
            if config.use_ssl {
                alt_cfg.encryption(tiberius::EncryptionLevel::NotSupported);
            } else {
                alt_cfg.encryption(tiberius::EncryptionLevel::Required);
                alt_cfg.trust_cert();
            }
            let alt_tcp = TcpStream::connect(&tcp_addr)
                .await
                .map_err(|te| format!("SQL Server TCP connect error: {}", te))?;
            alt_tcp.set_nodelay(true).map_err(|te| te.to_string())?;
            match TiberiusClient::connect(alt_cfg.clone(), alt_tcp.compat_write()).await {
                Ok(c) => {
                    tiberius_cfg = alt_cfg;
                    c
                }
                Err(_) => return Err(format!("TDS handshake error: {}", e)),
            }
        }
    };

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
        supports_rename_table: true,
        supports_alter_column: true,
    };

    Ok((
        DriverInstance::Mssql {
            config: tiberius_cfg,
            tcp_addr,
        },
        capabilities,
    ))
}

pub async fn execute_query_mssql(
    config: &tiberius::Config,
    tcp_addr: &str,
    query: &str,
    limit: usize,
    session: &ActiveDatabaseSession,
    start: Instant,
) -> Result<QueryResult, String> {
    let tcp = TcpStream::connect(tcp_addr)
        .await
        .map_err(|e| format!("MSSQL reconnect error: {}", e))?;
    tcp.set_nodelay(true).map_err(|e| e.to_string())?;

    let mut client = TiberiusClient::connect(config.clone(), tcp.compat_write())
        .await
        .map_err(|e| format!("MSSQL connect error: {}", e))?;

    let statements = split_sql_statements(query);
    let mut final_cols = Vec::new();
    let mut final_rows = Vec::new();
    let mut total_affected = 0u64;
    let mut batch_results = Vec::new();

    for stmt in &statements {
        let stmt_start = Instant::now();
        let stream = client
            .simple_query(stmt)
            .await
            .map_err(|e| format!("MSSQL query error: {}", e))?;

        let rows = stream.into_first_result().await.unwrap_or_default();
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

        total_affected += rows.len() as u64;
        if final_rows.is_empty() || !json_rows.is_empty() {
            final_cols = cols_meta.clone();
            final_rows = json_rows.clone();
        }

        batch_results.push(BatchStatementResult {
            statement: stmt.to_string(),
            columns: cols_meta,
            rows: json_rows,
            affected_rows: rows.len() as u64,
            last_insert_id: None,
            execution_time_ms: stmt_start.elapsed().as_secs_f64() * 1000.0,
            error: None,
        });
    }

    Ok(QueryResult {
        columns: final_cols,
        rows: final_rows,
        affected_rows: total_affected,
        last_insert_id: None,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        command_type: "T-SQL".to_string(),
        server_version: Some(session.capabilities.server_version.clone()),
        warnings: Vec::new(),
        all_results: Some(batch_results),
    })
}

pub async fn list_tables_mssql(
    config: &tiberius::Config,
    tcp_addr: &str,
) -> Result<Vec<DatabaseObject>, String> {
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

pub async fn get_table_columns_mssql(
    config: &tiberius::Config,
    tcp_addr: &str,
    table_name: &str,
) -> Result<Vec<ColumnMeta>, String> {
    let tcp = TcpStream::connect(tcp_addr).await.map_err(|e| e.to_string())?;
    tcp.set_nodelay(true).map_err(|e| e.to_string())?;
    let mut client = TiberiusClient::connect(config.clone(), tcp.compat_write()).await.map_err(|e| e.to_string())?;

    let sql = format!(
        r#"
        SELECT 
            c.COLUMN_NAME, 
            c.DATA_TYPE, 
            c.IS_NULLABLE, 
            c.COLUMN_DEFAULT,
            CASE WHEN pk.COLUMN_NAME IS NOT NULL THEN 1 ELSE 0 END AS IS_PK
        FROM INFORMATION_SCHEMA.COLUMNS c
        LEFT JOIN (
            SELECT kcu.COLUMN_NAME 
            FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu 
              ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
            WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_NAME = '{0}'
        ) pk ON c.COLUMN_NAME = pk.COLUMN_NAME
        WHERE c.TABLE_NAME = '{0}' 
        ORDER BY c.ORDINAL_POSITION
        "#,
        table_name.replace('\'', "''")
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
        let is_pk = r.get::<i32, _>(4).unwrap_or(0) == 1;

        cols.push(ColumnMeta {
            name,
            data_type: ty,
            nullable,
            is_primary_key: is_pk,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: def,
            extra: None,
        });
    }
    Ok(cols)
}

pub async fn execute_operation_mssql(
    config: &tiberius::Config,
    tcp_addr: &str,
    sql: &str,
) -> Result<u64, String> {
    let tcp = TcpStream::connect(tcp_addr).await.map_err(|e| e.to_string())?;
    tcp.set_nodelay(true).map_err(|e| e.to_string())?;
    let mut client = TiberiusClient::connect(config.clone(), tcp.compat_write()).await.map_err(|e| e.to_string())?;
    let res = client.execute(sql, &[]).await.map_err(|e| e.to_string())?;
    Ok(res.total())
}

pub async fn get_object_definition_mssql(
    config: &tiberius::Config,
    tcp_addr: &str,
    name: &str,
) -> Result<String, String> {
    let tcp = TcpStream::connect(tcp_addr).await.map_err(|e| e.to_string())?;
    tcp.set_nodelay(true).map_err(|e| e.to_string())?;
    let mut client = TiberiusClient::connect(config.clone(), tcp.compat_write()).await.map_err(|e| e.to_string())?;
    let q = "SELECT OBJECT_DEFINITION(OBJECT_ID(@P1));";
    let row = client.query(q, &[&name]).await.map_err(|e| e.to_string())?.into_row().await.map_err(|e| e.to_string())?;
    let def = row.and_then(|r| r.get::<&str, _>(0).map(|s| s.to_string())).unwrap_or_default();
    Ok(def)
}
