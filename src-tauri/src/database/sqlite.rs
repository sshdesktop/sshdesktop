fn sqlite_cache_path(config: &DatabaseConnectionConfig, remote_path: &str) -> Result<std::path::PathBuf, String> {
    use sha2::{Digest, Sha256};
    let cache_dir = std::env::temp_dir().join("sshdesktop_sqlite");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Failed to create SQLite cache directory: {}", e))?;
    let mut hasher = Sha256::new();
    hasher.update(config.id.as_bytes());
    hasher.update([0]);
    hasher.update(remote_path.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    Ok(cache_dir.join(format!("{}.db", digest)))
}

use futures::TryStreamExt;
use std::time::Instant;
use super::types::{
    ActiveDatabaseSession, BatchStatementResult, ColumnMeta, DatabaseConnectionConfig,
    DatabaseObject, DriverInstance, QueryResult, ServerCapabilities,
};
use super::serialization::{serialize_sqlite_row, split_sql_statements};
use super::tunnel::from_base64;

pub async fn connect_sqlite(
    config: &DatabaseConnectionConfig,
    state: Option<&crate::AppState>,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let raw_path = config.sqlite_path.as_deref().unwrap_or(&config.database).trim();
    if raw_path.is_empty() {
        return Err("SQLite file path is empty. Please specify a database file path.".to_string());
    }

    let should_use_ssh = config.use_ssh;

    let effective_path = if should_use_ssh {
        if let Some(app_state) = state {
            let sessions_guard = app_state.sessions.lock().await;
            let resolved_conn_id = config.ssh_connection_id.as_deref()
                .filter(|cid| sessions_guard.contains_key(*cid))
                .map(str::to_string);
            drop(sessions_guard);
            let conn_id = resolved_conn_id.ok_or_else(|| {
                "Select an active SSH connection for this remote SQLite database; no other SSH session will be used implicitly.".to_string()
            })?;

            let escaped = raw_path.replace('\'', "'\\''");
            let (test_out, test_code) = crate::ssh::exec::run_cmd(
                app_state,
                &conn_id,
                &format!("if [ -f '{}' ]; then echo EXISTS; elif [ ! -e '{}' ]; then echo MISSING; else echo INVALID; exit 2; fi", escaped, escaped),
            ).await;
            if test_code != 0 || (!test_out.contains("EXISTS") && !test_out.contains("MISSING")) {
                return Err(format!("Could not inspect remote SQLite file '{}': {}", raw_path, test_out.trim()));
            }

            let local_cache = sqlite_cache_path(config, raw_path)?;

            if test_out.contains("MISSING") {
                if config.read_only {
                    return Err("Read-only SQLite connection cannot create a missing remote database file.".into());
                }
                let (touch_out, touch_code) = crate::ssh::exec::run_cmd(
                    app_state, &conn_id, &format!("umask 077 && touch '{}'", escaped)
                ).await;
                if touch_code != 0 {
                    return Err(format!("Failed to create remote SQLite file '{}': {}", raw_path, touch_out.trim()));
                }
                std::fs::File::create(&local_cache)
                    .map_err(|e| format!("Failed to create local SQLite cache: {}", e))?;
            } else {
                let download_cmd = format!(
                    "base64 '{}' | tr -d '\\n'",
                    escaped
                );
                let (cmd_out, cmd_code) = crate::ssh::exec::run_cmd(app_state, &conn_id, &download_cmd).await;
                if cmd_code != 0 {
                    return Err(format!("Failed to download remote SQLite database '{}': {}", raw_path, cmd_out.trim()));
                }
                let bytes = from_base64(cmd_out.trim())
                    .ok_or_else(|| "Remote SQLite download returned invalid base64 data.".to_string())?;
                std::fs::write(&local_cache, bytes)
                    .map_err(|e| format!("Failed to write local SQLite cache: {}", e))?;
            }

            local_cache.to_string_lossy().to_string()
        } else {
            return Err("Remote SQLite requires an application SSH state and an explicit SSH connection.".into());
        }
    } else {
        raw_path.to_string()
    };

    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(&effective_path)
        .create_if_missing(!config.read_only)
        .read_only(config.read_only);
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
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
        supports_rename_table: true,
        supports_alter_column: false,
    };

    Ok((DriverInstance::Sqlite(pool), capabilities))
}

pub async fn execute_query_sqlite(
    pool: &sqlx::SqlitePool,
    query: &str,
    limit: usize,
    session: &ActiveDatabaseSession,
    state: &crate::AppState,
    start: Instant,
) -> Result<QueryResult, String> {
    let statements = split_sql_statements(query);
    if statements.is_empty() {
        return Err("Query string is empty".to_string());
    }

    let mut final_cols = Vec::new();
    let mut final_rows = Vec::new();
    let mut total_affected = 0u64;
    let mut last_insert_id = None;
    let mut warnings = Vec::new();
    let mut batch_results = Vec::new();
    let mut had_mutation = false;
    let num_stmts = statements.len();

    let mut remaining_rows = limit;
    for (stmt_idx, stmt) in statements.iter().enumerate() {
        let stmt_start = Instant::now();
        let s_upper = stmt.trim().to_uppercase();
        let is_mutation = !s_upper.starts_with("SELECT")
            && !s_upper.starts_with("EXPLAIN")
            && !s_upper.starts_with("WITH")
            && !s_upper.starts_with("PRAGMA TABLE_INFO")
            && !s_upper.starts_with("PRAGMA FOREIGN_KEY_LIST")
            && !s_upper.starts_with("PRAGMA INDEX_LIST")
            && !s_upper.starts_with("PRAGMA DATABASE_LIST")
            && !s_upper.contains("RETURNING");

        if is_mutation {
            had_mutation = true;
            let res = sqlx::raw_sql(stmt)
                .execute(pool)
                .await
                .map_err(|e| format!("SQLite error (statement {}/{}): {}", stmt_idx + 1, num_stmts, e))?;

            let aff = res.rows_affected();
            total_affected += aff;
            let id = res.last_insert_rowid();
            let id_opt = if id > 0 {
                last_insert_id = Some(id);
                Some(id)
            } else {
                None
            };
            if num_stmts > 1 {
                warnings.push(format!("Statement {}/{}: {} rows affected", stmt_idx + 1, num_stmts, aff));
            }
            batch_results.push(BatchStatementResult {
                statement: stmt.to_string(),
                columns: Vec::new(),
                rows: Vec::new(),
                affected_rows: aff,
                last_insert_id: id_opt,
                execution_time_ms: stmt_start.elapsed().as_secs_f64() * 1000.0,
                error: None,
            });
        } else {
            let mut row_stream = sqlx::raw_sql(stmt).fetch(pool);
            let mut rows = Vec::with_capacity(remaining_rows.min(1024));
            while let Some(row) = row_stream.try_next().await
                .map_err(|e| format!("SQLite error (statement {}/{}): {}", stmt_idx + 1, num_stmts, e))?
            {
                rows.push(row);
                if rows.len() > remaining_rows {
                    break;
                }
            }
            let truncated = rows.len() > remaining_rows;
            if truncated {
                rows.truncate(remaining_rows);
                warnings.push(format!("Statement {}/{}: result truncated to {} rows", stmt_idx + 1, num_stmts, remaining_rows));
            }

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

            remaining_rows = remaining_rows.saturating_sub(rows.len());
            if num_stmts > 1 {
                warnings.push(format!("Statement {}/{}: {} rows returned", stmt_idx + 1, num_stmts, rows.len()));
            }

            if final_rows.is_empty() || !json_rows.is_empty() {
                final_cols = cols_meta.clone();
                final_rows = json_rows.clone();
            }
            total_affected += rows.len() as u64;

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
    }

    // If SQLite is on remote host and mutation occurred, sync cache back via SFTP
    if had_mutation && session.config.use_ssh {
        if let Some(conn_id) = &session.config.ssh_connection_id {
            let raw_path = session.config.sqlite_path.as_deref().unwrap_or(&session.config.database).trim();
            let local_cache = sqlite_cache_path(&session.config, raw_path)?;
            let bytes = std::fs::read(&local_cache)
                .map_err(|e| format!("Failed to read updated local SQLite cache: {}", e))?;
            crate::ssh::sftp::sftp_write_bytes(state, conn_id, raw_path, &bytes).await
                .map_err(|e| format!("SQLite changes were applied locally but remote sync failed: {}", e))?;
        }
    }

    Ok(QueryResult {
        columns: final_cols,
        rows: final_rows,
        affected_rows: total_affected,
        last_insert_id,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        command_type: "SQL".to_string(),
        server_version: Some(session.capabilities.server_version.clone()),
        warnings,
        all_results: if batch_results.len() > 1 { Some(batch_results) } else { None },
    })
}

pub async fn list_tables_sqlite(pool: &sqlx::SqlitePool) -> Result<Vec<DatabaseObject>, String> {
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

pub async fn get_table_columns_sqlite(
    pool: &sqlx::SqlitePool,
    table_name: &str,
) -> Result<Vec<ColumnMeta>, String> {
    use sqlx::Row;
    let fk_q = format!("PRAGMA foreign_key_list('{}');", table_name.replace('\'', "''"));
    let fk_rows = sqlx::query(&fk_q).fetch_all(pool).await.unwrap_or_default();
    let mut fk_map: std::collections::HashMap<String, (String, String)> = std::collections::HashMap::new();
    for fkr in fk_rows {
        let from_col: String = fkr.try_get("from").unwrap_or_default();
        let to_table: String = fkr.try_get("table").unwrap_or_default();
        let to_col: String = fkr.try_get("to").unwrap_or_default();
        if !from_col.is_empty() {
            fk_map.insert(from_col, (to_table, to_col));
        }
    }

    let q = format!("PRAGMA table_info('{}');", table_name.replace('\'', "''"));
    let rows = sqlx::query(&q).fetch_all(pool).await.map_err(|e| e.to_string())?;

    let mut cols = Vec::new();
    for r in rows {
        let name: String = r.try_get("name").unwrap_or_default();
        let ty: String = r.try_get("type").unwrap_or_else(|_| "TEXT".to_string());
        let notnull: i64 = r.try_get("notnull").unwrap_or(0);
        let pk: i64 = r.try_get("pk").unwrap_or(0);
        let dflt: Option<String> = r.try_get("dflt_value").ok();

        let fk_info = fk_map.get(&name);

        cols.push(ColumnMeta {
            name: name.clone(),
            data_type: ty,
            nullable: notnull == 0,
            is_primary_key: pk > 0,
            is_foreign_key: fk_info.is_some(),
            referenced_table: fk_info.map(|(t, _)| t.clone()),
            referenced_column: fk_info.map(|(_, c)| c.clone()),
            default_value: dflt,
            extra: None,
        });
    }
    Ok(cols)
}

pub async fn execute_operation_sqlite(
    pool: &sqlx::SqlitePool,
    sql: &str,
    session: &ActiveDatabaseSession,
    state: &crate::AppState,
) -> Result<u64, String> {
    let res = sqlx::raw_sql(sql).execute(pool).await.map_err(|e| e.to_string())?;
    if session.config.use_ssh {
        if let Some(conn_id) = &session.config.ssh_connection_id {
            let raw_path = session.config.sqlite_path.as_deref().unwrap_or(&session.config.database);
            let cache_dir = std::env::temp_dir().join("sshdesktop_sqlite");
            let safe_name = format!("{}_{}", session.config.id, raw_path.replace(|c: char| !c.is_alphanumeric(), "_"));
            let local_cache = cache_dir.join(format!("{}.db", safe_name));
            if let Ok(bytes) = std::fs::read(&local_cache) {
                let _ = crate::ssh::sftp::sftp_write_bytes(state, conn_id, raw_path, &bytes).await;
            }
        }
    }
    Ok(res.rows_affected())
}

pub async fn get_object_definition_sqlite(
    pool: &sqlx::SqlitePool,
    name: &str,
) -> Result<String, String> {
    use sqlx::Row;
    let q = "SELECT sql FROM sqlite_master WHERE name = ?;";
    let row = sqlx::query(q).bind(name).fetch_one(pool).await.map_err(|e| e.to_string())?;
    let def: String = row.try_get(0).unwrap_or_default();
    Ok(def)
}
