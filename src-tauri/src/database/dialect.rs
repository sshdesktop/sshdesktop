use super::types::ColumnSpec;

// ─── SQL Dialect Helpers ──────────────────────────────────────────

pub fn quote_ident(engine: &str, ident: &str) -> String {
    let clean = ident.trim();
    match engine {
        "mysql" | "mariadb" => format!("`{}`", clean.replace('`', "``")),
        "postgres" | "postgresql" | "sqlite" => format!("\"{}\"", clean.replace('"', "\"\"")),
        "mssql" => format!("[{}]", clean.replace(']', "]]")),
        _ => clean.to_string(),
    }
}

pub fn generate_create_table_sql(
    engine: &str,
    table: &str,
    columns: &[ColumnSpec],
) -> Result<String, String> {
    if columns.is_empty() {
        return Err("Cannot create table with 0 columns".to_string());
    }
    let mut col_defs = Vec::new();
    let mut pks = Vec::new();

    for col in columns {
        let col_quoted = quote_ident(engine, &col.name);
        let data_type = col.data_type.trim().to_uppercase();

        let (type_clause, is_inline_pk) = match engine {
            "mysql" | "mariadb" => {
                if col.primary_key && col.auto_increment {
                    (format!("{} AUTO_INCREMENT", data_type), false)
                } else {
                    (data_type, false)
                }
            }
            "postgres" | "postgresql" => {
                if col.primary_key && col.auto_increment {
                    ("SERIAL".to_string(), false)
                } else {
                    (data_type, false)
                }
            }
            "sqlite" => {
                if col.primary_key && col.auto_increment {
                    ("INTEGER PRIMARY KEY AUTOINCREMENT".to_string(), true)
                } else {
                    (data_type, false)
                }
            }
            "mssql" => {
                if col.primary_key && col.auto_increment {
                    ("INT IDENTITY(1,1)".to_string(), false)
                } else {
                    (data_type, false)
                }
            }
            _ => (data_type, false),
        };

        let null_clause = if col.nullable && !col.primary_key {
            "NULL"
        } else {
            "NOT NULL"
        };

        let default_clause = match &col.default_value {
            Some(d) if !d.trim().is_empty() => {
                let d_clean = d.trim();
                if d_clean.starts_with("CURRENT_")
                    || d_clean.starts_with("now(")
                    || d_clean.starts_with("datetime(")
                {
                    format!(" DEFAULT {}", d_clean)
                } else if d_clean.parse::<f64>().is_ok() {
                    format!(" DEFAULT {}", d_clean)
                } else {
                    format!(" DEFAULT '{}'", d_clean.replace('\'', "''"))
                }
            }
            _ => String::new(),
        };

        if is_inline_pk {
            col_defs.push(format!("  {} {}{}", col_quoted, type_clause, default_clause));
        } else {
            col_defs.push(format!(
                "  {} {} {}{}",
                col_quoted, type_clause, null_clause, default_clause
            ));
            if col.primary_key {
                pks.push(col_quoted);
            }
        }
    }

    if !pks.is_empty() {
        col_defs.push(format!("  PRIMARY KEY ({})", pks.join(", ")));
    }

    let table_quoted = quote_ident(engine, table);
    let engine_suffix = match engine {
        "mysql" | "mariadb" => " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        _ => "",
    };

    Ok(format!(
        "CREATE TABLE {} (\n{}\n){};",
        table_quoted,
        col_defs.join(",\n"),
        engine_suffix
    ))
}

pub fn generate_rename_sql(
    engine: &str,
    object_type: &str,
    old_name: &str,
    new_name: &str,
) -> Result<String, String> {
    match engine {
        "mysql" | "mariadb" => match object_type {
            "table" | "view" => Ok(format!(
                "RENAME TABLE {} TO {};",
                quote_ident(engine, old_name),
                quote_ident(engine, new_name)
            )),
            _ => Err(format!(
                "Direct rename for {} is not supported in MySQL. Drop and recreate instead.",
                object_type
            )),
        },
        "postgres" | "postgresql" => match object_type {
            "table" => Ok(format!(
                "ALTER TABLE {} RENAME TO {};",
                quote_ident(engine, old_name),
                quote_ident(engine, new_name)
            )),
            "view" => Ok(format!(
                "ALTER VIEW {} RENAME TO {};",
                quote_ident(engine, old_name),
                quote_ident(engine, new_name)
            )),
            "procedure" => Ok(format!(
                "ALTER PROCEDURE {} RENAME TO {};",
                quote_ident(engine, old_name),
                quote_ident(engine, new_name)
            )),
            "function" => Ok(format!(
                "ALTER FUNCTION {} RENAME TO {};",
                quote_ident(engine, old_name),
                quote_ident(engine, new_name)
            )),
            _ => Err(format!(
                "Direct rename for {} is not supported in PostgreSQL.",
                object_type
            )),
        },
        "sqlite" => match object_type {
            "table" => Ok(format!(
                "ALTER TABLE {} RENAME TO {};",
                quote_ident(engine, old_name),
                quote_ident(engine, new_name)
            )),
            _ => Err(format!(
                "Direct rename for {} is not supported in SQLite.",
                object_type
            )),
        },
        "mssql" => Ok(format!(
            "EXEC sp_rename '{}', '{}';",
            old_name.replace('\'', "''"),
            new_name.replace('\'', "''")
        )),
        _ => Err(format!("Rename operation not supported for engine {}", engine)),
    }
}

pub fn generate_drop_sql(
    engine: &str,
    object_type: &str,
    name: &str,
) -> Result<String, String> {
    let q_name = quote_ident(engine, name);
    match engine {
        "mysql" | "mariadb" => match object_type {
            "table" => Ok(format!("DROP TABLE IF EXISTS {};", q_name)),
            "view" => Ok(format!("DROP VIEW IF EXISTS {};", q_name)),
            "procedure" => Ok(format!("DROP PROCEDURE IF EXISTS {};", q_name)),
            "function" => Ok(format!("DROP FUNCTION IF EXISTS {};", q_name)),
            "trigger" => Ok(format!("DROP TRIGGER IF EXISTS {};", q_name)),
            _ => Err(format!("Unsupported object type {} for drop", object_type)),
        },
        "postgres" | "postgresql" => match object_type {
            "table" => Ok(format!("DROP TABLE IF EXISTS {} CASCADE;", q_name)),
            "view" => Ok(format!("DROP VIEW IF EXISTS {} CASCADE;", q_name)),
            "procedure" => Ok(format!("DROP PROCEDURE IF EXISTS {} CASCADE;", q_name)),
            "function" => Ok(format!("DROP FUNCTION IF EXISTS {} CASCADE;", q_name)),
            "trigger" => Ok(format!("DROP TRIGGER IF EXISTS {};", q_name)),
            _ => Err(format!("Unsupported object type {} for drop", object_type)),
        },
        "sqlite" => match object_type {
            "table" => Ok(format!("DROP TABLE IF EXISTS {};", q_name)),
            "view" => Ok(format!("DROP VIEW IF EXISTS {};", q_name)),
            "trigger" => Ok(format!("DROP TRIGGER IF EXISTS {};", q_name)),
            _ => Err(format!("Unsupported object type {} for drop", object_type)),
        },
        "mssql" => match object_type {
            "table" => Ok(format!("DROP TABLE IF EXISTS {};", q_name)),
            "view" => Ok(format!("DROP VIEW IF EXISTS {};", q_name)),
            "procedure" => Ok(format!("DROP PROCEDURE IF EXISTS {};", q_name)),
            "function" => Ok(format!("DROP FUNCTION IF EXISTS {};", q_name)),
            "trigger" => Ok(format!("DROP TRIGGER IF EXISTS {};", q_name)),
            _ => Err(format!("Unsupported object type {} for drop", object_type)),
        },
        _ => Err(format!("Drop operation not supported for engine {}", engine)),
    }
}

pub fn generate_truncate_table_sql(engine: &str, table: &str) -> String {
    let q = quote_ident(engine, table);
    match engine {
        "sqlite" => format!("DELETE FROM {};", q),
        _ => format!("TRUNCATE TABLE {};", q),
    }
}

pub fn generate_add_column_sql(engine: &str, table: &str, col: &ColumnSpec) -> String {
    let q_table = quote_ident(engine, table);
    let q_col = quote_ident(engine, &col.name);
    let null_clause = if col.nullable { "NULL" } else { "NOT NULL" };
    let default_clause = match &col.default_value {
        Some(d) if !d.trim().is_empty() => format!(" DEFAULT '{}'", d.replace('\'', "''")),
        _ => String::new(),
    };
    format!(
        "ALTER TABLE {} ADD COLUMN {} {} {}{};",
        q_table, q_col, col.data_type, null_clause, default_clause
    )
}

pub fn generate_drop_column_sql(engine: &str, table: &str, col_name: &str) -> String {
    let q_table = quote_ident(engine, table);
    let q_col = quote_ident(engine, col_name);
    format!("ALTER TABLE {} DROP COLUMN {};", q_table, q_col)
}

pub fn generate_create_index_sql(
    engine: &str,
    table: &str,
    index_name: &str,
    columns: &[String],
    is_unique: bool,
) -> Result<String, String> {
    if columns.is_empty() {
        return Err("Columns list cannot be empty for index".to_string());
    }
    let u = if is_unique { "UNIQUE " } else { "" };
    let q_idx = quote_ident(engine, index_name);
    let q_tbl = quote_ident(engine, table);
    let q_cols = columns
        .iter()
        .map(|c| quote_ident(engine, c))
        .collect::<Vec<_>>()
        .join(", ");
    Ok(format!("CREATE {}INDEX {} ON {} ({});", u, q_idx, q_tbl, q_cols))
}

pub fn generate_drop_index_sql(engine: &str, table: &str, index_name: &str) -> String {
    let q_idx = quote_ident(engine, index_name);
    let q_tbl = quote_ident(engine, table);
    match engine {
        "mysql" | "mariadb" => format!("DROP INDEX {} ON {};", q_idx, q_tbl),
        "mssql" => format!("DROP INDEX {}.{};", q_tbl, q_idx),
        _ => format!("DROP INDEX {};", q_idx),
    }
}
