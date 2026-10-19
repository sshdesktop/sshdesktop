use std::time::Instant;
use super::types::{
    ActiveDatabaseSession, BatchStatementResult, ColumnMeta, DatabaseConnectionConfig,
    DatabaseObject, DriverInstance, QueryResult, ServerCapabilities, urlencoding,
};
use super::serialization::{serialize_pg_row, split_sql_statements};

pub async fn connect_postgres(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let pwd = config.password.as_deref().unwrap_or("");
    let ssl_param = if config.use_ssl {
        if config.ssl_verify { "?sslmode=verify-full" } else { "?sslmode=require" }
    } else {
        "?sslmode=disable"
    };

    let db_name = if config.database.trim().is_empty() {
        "postgres"
    } else {
        config.database.trim()
    };

    let url = format!(
        "postgres://{}:{}@{}:{}/{}{}",
        urlencoding(&config.username),
        urlencoding(pwd),
        effective_host,
        effective_port,
        db_name,
        ssl_param
    );

    let connect_res = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(std::time::Duration::from_secs(config.timeout_seconds.unwrap_or(8)))
        .connect(&url)
        .await;

    let pool = match connect_res {
        Ok(p) => p,
        Err(e) => {
            let err_str = e.to_string();
            if db_name != "postgres" && (err_str.contains("does not exist") || err_str.contains("database \"")) {
                let fallback_url = format!(
                    "postgres://{}:{}@{}:{}/postgres{}",
                    urlencoding(&config.username),
                    urlencoding(pwd),
                    effective_host,
                    effective_port,
                    ssl_param
                );
                sqlx::postgres::PgPoolOptions::new()
                    .max_connections(5)
                    .acquire_timeout(std::time::Duration::from_secs(config.timeout_seconds.unwrap_or(8)))
                    .connect(&fallback_url)
                    .await
                    .map_err(|fe| format!("PostgreSQL connection error: {} (fallback to 'postgres' db also failed: {})", e, fe))?
            } else {
                return Err(format!("PostgreSQL connection error: {}", e));
            }
        }
    };

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
        supports_rename_table: true,
        supports_alter_column: true,
    };

    Ok((DriverInstance::Postgres(pool), capabilities))
}

pub async fn execute_query_postgres(
    pool: &sqlx::PgPool,
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
    let mut warnings = Vec::new();
    let mut batch_results = Vec::new();
    let num_stmts = statements.len();

    for (stmt_idx, stmt) in statements.iter().enumerate() {
        let stmt_start = Instant::now();
        let s_upper = stmt.trim().to_uppercase();
        let is_mutation = !s_upper.starts_with("SELECT")
            && !s_upper.starts_with("SHOW")
            && !s_upper.starts_with("DESCRIBE")
            && !s_upper.starts_with("EXPLAIN")
            && !s_upper.starts_with("WITH")
            && !s_upper.contains("RETURNING");

        if is_mutation {
            let res = sqlx::raw_sql(stmt)
                .execute(pool)
                .await
                .map_err(|e| format!("PostgreSQL error (statement {}/{}): {}", stmt_idx + 1, num_stmts, e))?;

            let aff = res.rows_affected();
            total_affected += aff;
            if num_stmts > 1 {
                warnings.push(format!("Statement {}/{}: {} rows affected", stmt_idx + 1, num_stmts, aff));
            }
            batch_results.push(BatchStatementResult {
                statement: stmt.to_string(),
                columns: Vec::new(),
                rows: Vec::new(),
                affected_rows: aff,
                last_insert_id: None,
                execution_time_ms: stmt_start.elapsed().as_secs_f64() * 1000.0,
                error: None,
            });
        } else {
            let rows = sqlx::raw_sql(stmt)
                .fetch_all(pool)
                .await
                .map_err(|e| format!("PostgreSQL error (statement {}/{}): {}", stmt_idx + 1, num_stmts, e))?;

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
        last_insert_id: None,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        command_type: "SQL".to_string(),
        server_version: Some(session.capabilities.server_version.clone()),
        warnings,
        all_results: if batch_results.len() > 1 { Some(batch_results) } else { None },
    })
}

pub async fn list_tables_postgres(
    pool: &sqlx::PgPool,
    session: &ActiveDatabaseSession,
    schema: Option<String>,
) -> Result<Vec<DatabaseObject>, String> {
    use sqlx::Row;
    let schema_name = schema
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "public".to_string());
    let rows = sqlx::query(
        "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 OR ($1 = $2 AND table_schema = 'public') ORDER BY table_name",
    )
    .bind(&schema_name)
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
                schema: Some(schema_name.clone()),
                row_count: None,
                size_bytes: None,
                definition: None,
            }
        })
        .collect())
}

pub async fn get_table_columns_postgres(
    pool: &sqlx::PgPool,
    _session: &ActiveDatabaseSession,
    table_name: &str,
    schema: Option<String>,
) -> Result<Vec<ColumnMeta>, String> {
    use sqlx::Row;
    let clean_table = table_name.trim().trim_matches('"').to_string();
    let pure_table = clean_table.split('.').last().unwrap_or(&clean_table).trim().trim_matches('"').to_string();
    let schema_name = schema
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "public".to_string());

    let sql = r#"
        SELECT 
            c.column_name, 
            c.data_type, 
            c.is_nullable, 
            c.column_default,
            COALESCE(pk.is_pk, false) AS is_pk,
            fk.foreign_table,
            fk.foreign_column
        FROM information_schema.columns c
        LEFT JOIN (
            SELECT kcu.column_name, true AS is_pk
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_name = $1 AND (tc.table_schema = $2 OR tc.table_schema = 'public')
        ) pk ON c.column_name = pk.column_name
        LEFT JOIN (
            SELECT 
                kcu.column_name,
                ccu.table_name AS foreign_table,
                ccu.column_name AS foreign_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu 
              ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu 
              ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1 AND (tc.table_schema = $2 OR tc.table_schema = 'public')
        ) fk ON c.column_name = fk.column_name
        WHERE c.table_name = $1 AND (c.table_schema = $2 OR c.table_schema = 'public')
        ORDER BY c.ordinal_position
    "#;

    let rows = sqlx::query(sql)
        .bind(&pure_table)
        .bind(&schema_name)
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
            let is_pk: bool = r.try_get(4).unwrap_or(false);
            let f_table: Option<String> = r.try_get(5).ok();
            let f_col: Option<String> = r.try_get(6).ok();
            let is_fk = f_table.is_some();

            ColumnMeta {
                name: col_name,
                data_type,
                nullable: is_nullable == "YES",
                is_primary_key: is_pk,
                is_foreign_key: is_fk,
                referenced_table: f_table,
                referenced_column: f_col,
                default_value: col_default,
                extra: None,
            }
        })
        .collect())
}

pub async fn execute_operation_postgres(pool: &sqlx::PgPool, sql: &str) -> Result<u64, String> {
    let res = sqlx::raw_sql(sql).execute(pool).await.map_err(|e| e.to_string())?;
    Ok(res.rows_affected())
}

pub async fn get_object_definition_postgres(
    pool: &sqlx::PgPool,
    object_type: &str,
    name: &str,
) -> Result<String, String> {
    use sqlx::Row;
    match object_type.to_lowercase().as_str() {
        "view" => {
            let q = "SELECT pg_get_viewdef($1::regclass, true);";
            let row = sqlx::query(q).bind(name).fetch_one(pool).await.map_err(|e| e.to_string())?;
            let def: String = row.try_get(0).unwrap_or_default();
            Ok(format!("CREATE OR REPLACE VIEW \"{}\" AS\n{};", name, def))
        }
        "procedure" | "function" => {
            let q = "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = $1 LIMIT 1;";
            let row = sqlx::query(q).bind(name).fetch_one(pool).await.map_err(|e| e.to_string())?;
            let def: String = row.try_get(0).unwrap_or_default();
            Ok(def)
        }
        "trigger" => {
            let q = "SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = $1 LIMIT 1;";
            let row = sqlx::query(q).bind(name).fetch_one(pool).await.map_err(|e| e.to_string())?;
            let def: String = row.try_get(0).unwrap_or_default();
            Ok(def)
        }
        "table" => {
            let q = "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position;";
            let rows = sqlx::query(q).bind(name).fetch_all(pool).await.map_err(|e| e.to_string())?;
            let mut cols = Vec::new();
            for r in rows {
                let cname: String = r.try_get(0).unwrap_or_default();
                let dtype: String = r.try_get(1).unwrap_or_default();
                let null: String = r.try_get(2).unwrap_or_default();
                cols.push(format!("  \"{}\" {} {}", cname, dtype, if null == "YES" { "NULL" } else { "NOT NULL" }));
            }
            Ok(format!("CREATE TABLE \"{}\" (\n{}\n);", name, cols.join(",\n")))
        }
        _ => Err(format!("Unsupported object type: {}", object_type)),
    }
}
