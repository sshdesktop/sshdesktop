use std::time::Instant;
use super::types::{
    ActiveDatabaseSession, BatchStatementResult, ColumnMeta, DatabaseConnectionConfig,
    DatabaseObject, DriverInstance, QueryResult, ServerCapabilities, urlencoding,
};
use super::serialization::{get_mysql_opt_str, get_mysql_str, serialize_mysql_row, split_sql_statements};

pub async fn connect_mysql(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let pwd = config.password.as_deref().unwrap_or("");
    let ssl_param = if config.use_ssl {
        if config.ssl_verify { "?ssl-mode=Required" } else { "?ssl-mode=Required" }
    } else {
        "?ssl-mode=Disabled"
    };

    let db_name = config.database.trim();
    let url = if db_name.is_empty() {
        format!(
            "mysql://{}:{}@{}:{}{}",
            urlencoding(&config.username),
            urlencoding(pwd),
            effective_host,
            effective_port,
            ssl_param
        )
    } else {
        format!(
            "mysql://{}:{}@{}:{}/{}{}",
            urlencoding(&config.username),
            urlencoding(pwd),
            effective_host,
            effective_port,
            db_name,
            ssl_param
        )
    };

    let connect_res = sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(config.timeout_seconds.unwrap_or(8)))
        .connect(&url)
        .await;

    let pool = match connect_res {
        Ok(p) => p,
        Err(e) => {
            let err_str = e.to_string();
            if !db_name.is_empty() && (err_str.contains("Unknown database") || err_str.contains("database \"") || err_str.contains("1049")) {
                let fallback_url = format!(
                    "mysql://{}:{}@{}:{}{}",
                    urlencoding(&config.username),
                    urlencoding(pwd),
                    effective_host,
                    effective_port,
                    ssl_param
                );
                sqlx::mysql::MySqlPoolOptions::new()
                    .max_connections(5)
                    .acquire_timeout(std::time::Duration::from_secs(config.timeout_seconds.unwrap_or(8)))
                    .connect(&fallback_url)
                    .await
                    .map_err(|fe| format!("MySQL connection error: {} (fallback also failed: {})", e, fe))?
            } else {
                return Err(format!("MySQL connection error: {}", e));
            }
        }
    };

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
        supports_rename_table: true,
        supports_alter_column: true,
    };

    Ok((DriverInstance::MySql(pool), capabilities))
}

pub async fn execute_query_mysql(
    pool: &sqlx::MySqlPool,
    query: &str,
    limit: usize,
    session: &ActiveDatabaseSession,
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
    let num_stmts = statements.len();

    for (stmt_idx, stmt) in statements.iter().enumerate() {
        let stmt_start = Instant::now();
        let s_upper = stmt.trim().to_uppercase();
        let is_mutation = !s_upper.starts_with("SELECT")
            && !s_upper.starts_with("SHOW")
            && !s_upper.starts_with("DESCRIBE")
            && !s_upper.starts_with("DESC ")
            && !s_upper.starts_with("EXPLAIN")
            && !s_upper.starts_with("WITH")
            && !s_upper.contains("RETURNING");

        if is_mutation {
            let res = sqlx::raw_sql(stmt)
                .execute(pool)
                .await
                .map_err(|e| format!("MySQL error (statement {}/{}): {}", stmt_idx + 1, num_stmts, e))?;

            let aff = res.rows_affected();
            total_affected += aff;
            let id = res.last_insert_id();
            let id_opt = if id > 0 {
                last_insert_id = Some(id as i64);
                Some(id as i64)
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
            let rows = sqlx::raw_sql(stmt)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("MySQL error (statement {}/{}): {}", stmt_idx + 1, num_stmts, e))?;

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

pub async fn list_tables_mysql(
    pool: &sqlx::MySqlPool,
    session: &ActiveDatabaseSession,
    schema: Option<String>,
) -> Result<Vec<DatabaseObject>, String> {
    let target_db = schema
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| session.config.database.clone());

    let show_tables_cmd = if !target_db.is_empty() {
        format!("SHOW FULL TABLES IN `{}`", target_db.replace('`', "``"))
    } else {
        "SHOW FULL TABLES".to_string()
    };

    let tables_res = sqlx::query(&show_tables_cmd).fetch_all(pool).await;

    let rows_data: Vec<DatabaseObject> = match tables_res {
        Ok(show_rows) if !show_rows.is_empty() => {
            show_rows
                .into_iter()
                .map(|r| {
                    let table_name = get_mysql_str(&r, 0);
                    let table_type = get_mysql_str(&r, 1);
                    DatabaseObject {
                        name: table_name,
                        object_type: if table_type.to_uppercase().contains("VIEW") {
                            "view".to_string()
                        } else {
                            "table".to_string()
                        },
                        schema: Some(if target_db.is_empty() { session.config.database.clone() } else { target_db.clone() }),
                        row_count: None,
                        size_bytes: None,
                        definition: None,
                    }
                })
                .filter(|o| !o.name.is_empty())
                .collect()
        }
        _ => {
            let is_query = if target_db.is_empty() {
                "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME"
            } else {
                "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.tables WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME"
            };

            let is_res = if target_db.is_empty() {
                sqlx::query(is_query).fetch_all(pool).await
            } else {
                sqlx::query(is_query).bind(&target_db).fetch_all(pool).await
            };

            match is_res {
                Ok(is_rows) => is_rows
                    .into_iter()
                    .map(|r| {
                        let table_name = get_mysql_str(&r, 0);
                        let table_type = get_mysql_str(&r, 1);
                        DatabaseObject {
                            name: table_name,
                            object_type: if table_type.to_uppercase().contains("VIEW") {
                                "view".to_string()
                            } else {
                                "table".to_string()
                            },
                            schema: Some(if target_db.is_empty() { session.config.database.clone() } else { target_db.clone() }),
                            row_count: None,
                            size_bytes: None,
                            definition: None,
                        }
                    })
                    .filter(|o| !o.name.is_empty())
                    .collect(),
                Err(e) => return Err(format!("MySQL list tables error: {}", e)),
            }
        }
    };

    Ok(rows_data)
}

pub async fn get_table_columns_mysql(
    pool: &sqlx::MySqlPool,
    session: &ActiveDatabaseSession,
    table_name: &str,
    schema: Option<String>,
) -> Result<Vec<ColumnMeta>, String> {
    // Strip enclosing backticks or quotes if any
    let clean_table = table_name.trim().trim_matches('`').trim_matches('"').to_string();
    let (detected_schema, pure_table) = if let Some((s, t)) = clean_table.split_once('.') {
        (
            Some(s.trim_matches('`').trim_matches('"').to_string()),
            t.trim_matches('`').trim_matches('"').to_string(),
        )
    } else {
        (None, clean_table.clone())
    };

    let target_db = detected_schema
        .or(schema)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| session.config.database.clone());

    // 1. Primary method: SHOW FULL COLUMNS (qualified first, then unqualified fallback)
    let show_cmd_qualified = if !target_db.is_empty() {
        format!(
            "SHOW FULL COLUMNS FROM `{}`.`{}`",
            target_db.replace('`', "``"),
            pure_table.replace('`', "``")
        )
    } else {
        format!("SHOW FULL COLUMNS FROM `{}`", pure_table.replace('`', "``"))
    };

    let rows_res = sqlx::query(&show_cmd_qualified).fetch_all(pool).await;

    let show_rows = match rows_res {
        Ok(r) if !r.is_empty() => Ok(r),
        _ => {
            let fallback_cmd = format!("SHOW FULL COLUMNS FROM `{}`", pure_table.replace('`', "``"));
            sqlx::query(&fallback_cmd).fetch_all(pool).await
        }
    };

    let mut cols: Vec<ColumnMeta> = match show_rows {
        Ok(rows) if !rows.is_empty() => {
            rows.into_iter()
                .map(|r| {
                    let field = get_mysql_str(&r, 0);
                    let col_type = get_mysql_str(&r, 1);
                    let is_nullable = get_mysql_str(&r, 3);
                    let key = get_mysql_str(&r, 4);
                    let default_val = get_mysql_opt_str(&r, 5);
                    let extra = get_mysql_opt_str(&r, 6);

                    ColumnMeta {
                        name: field,
                        data_type: col_type,
                        nullable: is_nullable == "YES",
                        is_primary_key: key == "PRI",
                        is_foreign_key: key == "MUL",
                        referenced_table: None,
                        referenced_column: None,
                        default_value: default_val,
                        extra,
                    }
                })
                .filter(|c| !c.name.is_empty())
                .collect()
        }
        _ => {
            // 2. Secondary fallback: Query information_schema.columns directly without joins
            let is_query = if target_db.is_empty() {
                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM information_schema.columns WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION"
            } else {
                "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM information_schema.columns WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION"
            };

            let is_res = if target_db.is_empty() {
                sqlx::query(is_query).bind(&pure_table).fetch_all(pool).await
            } else {
                sqlx::query(is_query).bind(&target_db).bind(&pure_table).fetch_all(pool).await
            };

            match is_res {
                Ok(is_rows) => is_rows
                    .into_iter()
                    .map(|r| {
                        let field = get_mysql_str(&r, 0);
                        let col_type = get_mysql_str(&r, 1);
                        let is_nullable = get_mysql_str(&r, 2);
                        let key = get_mysql_str(&r, 3);
                        let default_val = get_mysql_opt_str(&r, 4);
                        let extra = get_mysql_opt_str(&r, 5);

                        ColumnMeta {
                            name: field,
                            data_type: col_type,
                            nullable: is_nullable == "YES",
                            is_primary_key: key == "PRI",
                            is_foreign_key: key == "MUL",
                            referenced_table: None,
                            referenced_column: None,
                            default_value: default_val,
                            extra,
                        }
                    })
                    .filter(|c| !c.name.is_empty())
                    .collect(),
                Err(e) => return Err(format!("MySQL column retrieval error: {}", e)),
            }
        }
    };

    // 3. Gracefully populate foreign key details if any column has a MUL key
    if cols.iter().any(|c| c.is_foreign_key) {
        let fk_query = if target_db.is_empty() {
            "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL"
        } else {
            "SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL"
        };

        let fk_res = if target_db.is_empty() {
            sqlx::query(fk_query).bind(&pure_table).fetch_all(pool).await
        } else {
            sqlx::query(fk_query).bind(&target_db).bind(&pure_table).fetch_all(pool).await
        };

        if let Ok(fk_rows) = fk_res {
            let mut fk_map = std::collections::HashMap::new();
            for fkr in fk_rows {
                let c_name = get_mysql_str(&fkr, 0);
                let ref_tbl = get_mysql_str(&fkr, 1);
                let ref_col = get_mysql_str(&fkr, 2);
                if !c_name.is_empty() {
                    fk_map.insert(c_name, (ref_tbl, ref_col));
                }
            }
            for col in &mut cols {
                if let Some((ref_t, ref_c)) = fk_map.get(&col.name) {
                    col.is_foreign_key = true;
                    col.referenced_table = Some(ref_t.clone());
                    col.referenced_column = Some(ref_c.clone());
                }
            }
        }
    }

    Ok(cols)
}

pub async fn execute_operation_mysql(pool: &sqlx::MySqlPool, sql: &str) -> Result<u64, String> {
    let res = sqlx::raw_sql(sql).execute(pool).await.map_err(|e| e.to_string())?;
    Ok(res.rows_affected())
}

pub async fn get_object_definition_mysql(
    pool: &sqlx::MySqlPool,
    object_type: &str,
    name: &str,
) -> Result<String, String> {
    use sqlx::Row;
    let clean_name = name.trim().replace('`', "``");
    let cmd = match object_type.to_lowercase().as_str() {
        "view" => format!("SHOW CREATE VIEW `{}`;", clean_name),
        "procedure" => format!("SHOW CREATE PROCEDURE `{}`;", clean_name),
        "function" => format!("SHOW CREATE FUNCTION `{}`;", clean_name),
        "trigger" => format!("SHOW CREATE TRIGGER `{}`;", clean_name),
        "table" => format!("SHOW CREATE TABLE `{}`;", clean_name),
        _ => return Err(format!("Unsupported object type: {}", object_type)),
    };

    let row = sqlx::raw_sql(&cmd).fetch_one(pool).await.map_err(|e| e.to_string())?;
    use sqlx::Column;

    let mut def = String::new();
    let mut charset: Option<String> = None;

    for col in row.columns() {
        let cname = col.name();
        if cname.eq_ignore_ascii_case("character_set_client") {
            if let Ok(cs) = row.try_get::<String, _>(cname) {
                charset = Some(cs);
            }
        }
    }

    // Priority 1: Match column by known name pattern (Create View, Create Table, etc.)
    for col in row.columns() {
        let cname = col.name().to_lowercase();
        if cname.contains("create") || cname.contains("statement") || cname.contains("definition") {
            if let Ok(val) = row.try_get::<String, _>(col.ordinal()) {
                let trimmed = val.trim();
                if !trimmed.is_empty() && !trimmed.starts_with("utf8") && trimmed != "utf8mb4" {
                    def = val;
                    break;
                }
            }
        }
    }

    // Priority 2: Fallback to the longest string column that is not a charset/collation
    if def.empty_or_whitespace() {
        for col in row.columns() {
            if let Ok(val) = row.try_get::<String, _>(col.ordinal()) {
                let trimmed = val.trim();
                if val.len() > def.len() && !trimmed.starts_with("utf8") && trimmed != "utf8mb4" && !trimmed.contains("collation") {
                    def = val;
                }
            }
        }
    }

    if let Some(cs) = charset {
        if !def.contains("CHARSET") && !def.contains("CHARACTER SET") {
            def.push_str(&format!("\n-- Character set: {}", cs));
        }
    }

    Ok(def)
}

trait EmptyOrWhitespace {
    fn empty_or_whitespace(&self) -> bool;
}

impl EmptyOrWhitespace for String {
    fn empty_or_whitespace(&self) -> bool {
        self.trim().is_empty()
    }
}
