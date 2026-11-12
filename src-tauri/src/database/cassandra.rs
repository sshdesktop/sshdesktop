use std::time::Instant;
use tokio::net::TcpStream;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use serde_json::{json, Value};
use super::types::{
    ActiveDatabaseSession, ColumnMeta, DatabaseConnectionConfig, DatabaseObject,
    DriverInstance, QueryResult, ServerCapabilities,
};

pub struct CqlFrame {
    pub opcode: u8,
    pub stream: i16,
    pub body: Vec<u8>,
}

pub async fn write_cql_frame(stream: &mut TcpStream, opcode: u8, stream_id: i16, body: &[u8]) -> Result<(), String> {
    let mut header = [0u8; 9];
    header[0] = 0x04; // Protocol v4 request
    header[1] = 0x00; // Flags
    header[2..4].copy_from_slice(&stream_id.to_be_bytes());
    header[4] = opcode;
    header[5..9].copy_from_slice(&(body.len() as i32).to_be_bytes());

    stream.write_all(&header).await.map_err(|e| format!("Cassandra TCP write header error: {}", e))?;
    if !body.is_empty() {
        stream.write_all(body).await.map_err(|e| format!("Cassandra TCP write body error: {}", e))?;
    }
    stream.flush().await.map_err(|e| format!("Cassandra TCP flush error: {}", e))?;
    Ok(())
}

pub async fn read_cql_frame(stream: &mut TcpStream) -> Result<CqlFrame, String> {
    let mut header = [0u8; 9];
    stream.read_exact(&mut header).await.map_err(|e| format!("Cassandra TCP read header error: {}", e))?;

    let version = header[0];
    if version != 0x84 && version != 0x04 {
        return Err(format!("Unexpected Cassandra protocol version header: 0x{:02x}", version));
    }

    let stream_id = i16::from_be_bytes([header[2], header[3]]);
    let opcode = header[4];
    let body_len = i32::from_be_bytes([header[5], header[6], header[7], header[8]]) as usize;

    if body_len > 32 * 1024 * 1024 {
        return Err("Cassandra frame exceeds 32 MiB limit".into());
    }

    let mut body = vec![0u8; body_len];
    if body_len > 0 {
        stream.read_exact(&mut body).await.map_err(|e| format!("Cassandra TCP read body error: {}", e))?;
    }

    Ok(CqlFrame {
        opcode,
        stream: stream_id,
        body,
    })
}

fn write_string(buf: &mut Vec<u8>, s: &str) {
    let len = s.len() as u16;
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
}

fn write_long_string(buf: &mut Vec<u8>, s: &str) {
    let len = s.len() as i32;
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(s.as_bytes());
}

fn write_bytes(buf: &mut Vec<u8>, b: &[u8]) {
    let len = b.len() as i32;
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(b);
}

pub async fn send_cql_query(
    stream: &mut TcpStream,
    query: &str,
) -> Result<QueryResult, String> {
    let start = Instant::now();
    let mut body = Vec::new();
    write_long_string(&mut body, query);
    // Consistency level: ONE (0x0001)
    body.extend_from_slice(&1u16.to_be_bytes());
    // Flags: 0x00
    body.push(0x00);

    write_cql_frame(stream, 0x07, 1, &body).await?;
    let resp = read_cql_frame(stream).await?;

    if resp.opcode == 0x00 {
        // ERROR frame
        let err_code = if resp.body.len() >= 4 {
            i32::from_be_bytes([resp.body[0], resp.body[1], resp.body[2], resp.body[3]])
        } else {
            0
        };
        let msg = if resp.body.len() >= 6 {
            let msg_len = u16::from_be_bytes([resp.body[4], resp.body[5]]) as usize;
            if resp.body.len() >= 6 + msg_len {
                String::from_utf8_lossy(&resp.body[6..6 + msg_len]).to_string()
            } else {
                "Cassandra query error".to_string()
            }
        } else {
            "Cassandra query error".to_string()
        };
        return Err(format!("Cassandra CQL Error (0x{:04x}): {}", err_code, msg));
    }

    if resp.opcode != 0x08 {
        return Err(format!("Unexpected Cassandra response opcode: 0x{:02x}", resp.opcode));
    }

    // Parse RESULT frame
    if resp.body.len() < 4 {
        return Err("Truncated Cassandra result frame".into());
    }
    let kind = i32::from_be_bytes([resp.body[0], resp.body[1], resp.body[2], resp.body[3]]);

    let mut cols = Vec::new();
    let mut rows = Vec::new();
    let affected: u64;

    match kind {
        1 => {
            // VOID
            affected = 1;
        }
        2 => {
            // ROWS
            let mut pos = 4;
            if resp.body.len() < pos + 8 {
                return Err("Truncated Cassandra rows metadata".into());
            }
            let flags = i32::from_be_bytes([resp.body[pos], resp.body[pos + 1], resp.body[pos + 2], resp.body[pos + 3]]);
            pos += 4;
            let col_count = i32::from_be_bytes([resp.body[pos], resp.body[pos + 1], resp.body[pos + 2], resp.body[pos + 3]]) as usize;
            pos += 4;

            let has_global_table_spec = (flags & 0x0001) != 0;
            if has_global_table_spec {
                // Read global keyspace and table name
                if resp.body.len() < pos + 2 { return Err("Truncated global spec".into()); }
                let ks_len = u16::from_be_bytes([resp.body[pos], resp.body[pos + 1]]) as usize;
                pos += 2 + ks_len;
                if resp.body.len() < pos + 2 { return Err("Truncated global spec".into()); }
                let tbl_len = u16::from_be_bytes([resp.body[pos], resp.body[pos + 1]]) as usize;
                pos += 2 + tbl_len;
            }

            for _ in 0..col_count {
                if !has_global_table_spec {
                    let ks_len = u16::from_be_bytes([resp.body[pos], resp.body[pos + 1]]) as usize;
                    pos += 2 + ks_len;
                    let tbl_len = u16::from_be_bytes([resp.body[pos], resp.body[pos + 1]]) as usize;
                    pos += 2 + tbl_len;
                }
                let name_len = u16::from_be_bytes([resp.body[pos], resp.body[pos + 1]]) as usize;
                pos += 2;
                let col_name = String::from_utf8_lossy(&resp.body[pos..pos + name_len]).to_string();
                pos += name_len;
                let type_code = u16::from_be_bytes([resp.body[pos], resp.body[pos + 1]]);
                pos += 2;

                let type_str = match type_code {
                    0x0001 => "ascii",
                    0x0002 => "bigint",
                    0x0003 => "blob",
                    0x0004 => "boolean",
                    0x0008 => "double",
                    0x0009 => "float",
                    0x000b => "int",
                    0x000c => "text",
                    0x000d => "timestamp",
                    0x000e => "uuid",
                    0x000f => "varchar",
                    _ => "text",
                };

                cols.push(ColumnMeta {
                    name: col_name,
                    data_type: type_str.to_string(),
                    nullable: true,
                    is_primary_key: false,
                    is_foreign_key: false,
                    referenced_table: None,
                    referenced_column: None,
                    default_value: None,
                    extra: None,
                });
            }

            let row_count = i32::from_be_bytes([resp.body[pos], resp.body[pos + 1], resp.body[pos + 2], resp.body[pos + 3]]) as usize;
            pos += 4;
            affected = row_count as u64;

            for _ in 0..row_count {
                let mut row_map = serde_json::Map::new();
                for col in &cols {
                    if pos + 4 > resp.body.len() { break; }
                    let val_len = i32::from_be_bytes([resp.body[pos], resp.body[pos + 1], resp.body[pos + 2], resp.body[pos + 3]]);
                    pos += 4;
                    if val_len < 0 {
                        row_map.insert(col.name.clone(), Value::Null);
                    } else {
                        let len = val_len as usize;
                        let slice = &resp.body[pos..pos + len];
                        pos += len;
                        let parsed_val = match col.data_type.as_str() {
                            "int" if len == 4 => json!(i32::from_be_bytes([slice[0], slice[1], slice[2], slice[3]])),
                            "bigint" | "timestamp" if len == 8 => json!(i64::from_be_bytes([slice[0], slice[1], slice[2], slice[3], slice[4], slice[5], slice[6], slice[7]])),
                            "boolean" if len == 1 => json!(slice[0] != 0),
                            _ => json!(String::from_utf8_lossy(slice).to_string()),
                        };
                        row_map.insert(col.name.clone(), parsed_val);
                    }
                }
                rows.push(Value::Object(row_map));
            }
        }
        _ => {
            affected = 1;
        }
    }

    Ok(QueryResult {
        columns: cols,
        rows,
        affected_rows: affected,
        last_insert_id: None,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        command_type: "CQL".to_string(),
        server_version: Some("Apache Cassandra".to_string()),
        warnings: Vec::new(),
        all_results: None,
    })
}

pub async fn connect_cassandra(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let addr = format!("{}:{}", effective_host, effective_port);
    let mut stream = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        TcpStream::connect(&addr),
    )
    .await
    .map_err(|_| format!("Cassandra TCP connection to {} timed out", addr))?
    .map_err(|e| format!("Cassandra TCP connection to {} failed: {}", addr, e))?;

    // Send STARTUP frame
    let mut startup_body = Vec::new();
    startup_body.extend_from_slice(&1u16.to_be_bytes()); // 1 entry in map
    write_string(&mut startup_body, "CQL_VERSION");
    write_string(&mut startup_body, "3.0.0");

    write_cql_frame(&mut stream, 0x01, 1, &startup_body).await?;
    let resp = read_cql_frame(&mut stream).await?;

    if resp.opcode == 0x03 {
        // AUTHENTICATE requested
        let username = config.username.as_str();
        let password = config.password.as_deref().unwrap_or("");
        let mut creds = Vec::new();
        creds.push(0x00);
        creds.extend_from_slice(username.as_bytes());
        creds.push(0x00);
        creds.extend_from_slice(password.as_bytes());

        let mut auth_body = Vec::new();
        write_bytes(&mut auth_body, &creds);
        write_cql_frame(&mut stream, 0x0f, 1, &auth_body).await?;
        let auth_resp = read_cql_frame(&mut stream).await?;
        if auth_resp.opcode != 0x10 && auth_resp.opcode != 0x02 {
            return Err("Cassandra authentication failed: invalid credentials.".into());
        }
    } else if resp.opcode != 0x02 {
        return Err(format!("Cassandra handshake failed with opcode 0x{:02x}", resp.opcode));
    }

    // Query server release version
    let version_res = send_cql_query(&mut stream, "SELECT release_version FROM system.local;").await;
    let version_str = match version_res {
        Ok(qr) => qr.rows.first()
            .and_then(|r| r.get("release_version"))
            .and_then(|v| v.as_str())
            .unwrap_or("4.x")
            .to_string(),
        Err(_) => "Apache Cassandra 4.x".to_string(),
    };

    let capabilities = ServerCapabilities {
        engine: "cassandra".to_string(),
        server_version: format!("Apache Cassandra {}", version_str),
        supports_transactions: false,
        supports_schemas: true,
        supports_procedures: false,
        supports_functions: true,
        supports_triggers: true,
        supports_views: true,
        supports_indexes: true,
        supports_foreign_keys: false,
        supports_explain: false,
        supports_process_list: false,
        read_only: config.read_only,
        supports_rename_table: false,
        supports_alter_column: false,
    };

    Ok((
        DriverInstance::Cassandra {
            host: effective_host.to_string(),
            port: effective_port,
            keyspace: config.keyspace.clone(),
        },
        capabilities,
    ))
}

pub async fn list_tables_cassandra(
    session: &ActiveDatabaseSession,
) -> Result<Vec<DatabaseObject>, String> {
    let (host, port, default_ks) = match &session.driver {
        DriverInstance::Cassandra { host, port, keyspace } => (host, *port, keyspace.clone()),
        _ => return Err("Invalid driver instance for Cassandra".into()),
    };

    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(&addr).await
        .map_err(|e| format!("Failed to connect to Cassandra at {}: {}", addr, e))?;

    let mut startup_body = Vec::new();
    startup_body.extend_from_slice(&1u16.to_be_bytes());
    write_string(&mut startup_body, "CQL_VERSION");
    write_string(&mut startup_body, "3.0.0");
    write_cql_frame(&mut stream, 0x01, 1, &startup_body).await?;
    let _ = read_cql_frame(&mut stream).await?;

    let ks = default_ks.unwrap_or_else(|| "system".to_string());
    let query = format!("SELECT table_name FROM system_schema.tables WHERE keyspace_name = '{}';", ks);
    let res = send_cql_query(&mut stream, &query).await?;

    let objects = res.rows
        .into_iter()
        .filter_map(|r| r.get("table_name").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .map(|name| DatabaseObject {
            name,
            object_type: "table".to_string(),
            schema: Some(ks.clone()),
            row_count: None,
            size_bytes: None,
            definition: None,
        })
        .collect();

    Ok(objects)
}

pub async fn get_table_columns_cassandra(
    session: &ActiveDatabaseSession,
    table_name: &str,
) -> Result<Vec<ColumnMeta>, String> {
    let (host, port, default_ks) = match &session.driver {
        DriverInstance::Cassandra { host, port, keyspace } => (host, *port, keyspace.clone()),
        _ => return Err("Invalid driver instance for Cassandra".into()),
    };

    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(&addr).await
        .map_err(|e| format!("Failed to connect to Cassandra at {}: {}", addr, e))?;

    let mut startup_body = Vec::new();
    startup_body.extend_from_slice(&1u16.to_be_bytes());
    write_string(&mut startup_body, "CQL_VERSION");
    write_string(&mut startup_body, "3.0.0");
    write_cql_frame(&mut stream, 0x01, 1, &startup_body).await?;
    let _ = read_cql_frame(&mut stream).await?;

    let ks = default_ks.unwrap_or_else(|| "system".to_string());
    let query = format!(
        "SELECT column_name, type, kind FROM system_schema.columns WHERE keyspace_name = '{}' AND table_name = '{}';",
        ks, table_name
    );
    let res = send_cql_query(&mut stream, &query).await?;

    let cols = res.rows
        .into_iter()
        .map(|r| {
            let name = r.get("column_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let ty = r.get("type").and_then(|v| v.as_str()).unwrap_or("text").to_string();
            let kind = r.get("kind").and_then(|v| v.as_str()).unwrap_or("");
            let is_pk = kind == "partition_key" || kind == "clustering";

            ColumnMeta {
                name,
                data_type: ty,
                nullable: !is_pk,
                is_primary_key: is_pk,
                is_foreign_key: false,
                referenced_table: None,
                referenced_column: None,
                default_value: None,
                extra: Some(kind.to_string()),
            }
        })
        .collect();

    Ok(cols)
}

pub async fn execute_query_cassandra(
    query: &str,
    session: &ActiveDatabaseSession,
) -> Result<QueryResult, String> {
    let (host, port, default_ks) = match &session.driver {
        DriverInstance::Cassandra { host, port, keyspace } => (host, *port, keyspace.clone()),
        _ => return Err("Invalid driver instance for Cassandra".into()),
    };

    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(&addr).await
        .map_err(|e| format!("Failed to connect to Cassandra at {}: {}", addr, e))?;

    let mut startup_body = Vec::new();
    startup_body.extend_from_slice(&1u16.to_be_bytes());
    write_string(&mut startup_body, "CQL_VERSION");
    write_string(&mut startup_body, "3.0.0");
    write_cql_frame(&mut stream, 0x01, 1, &startup_body).await?;
    let _ = read_cql_frame(&mut stream).await?;

    if let Some(ref ks) = default_ks {
        let use_ks = format!("USE \"{}\";", ks);
        let _ = send_cql_query(&mut stream, &use_ks).await;
    }

    send_cql_query(&mut stream, query).await
}
