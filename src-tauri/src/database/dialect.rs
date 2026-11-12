fn validate_sql_type(value: &str) -> Result<String, String> {
    let ty = value.trim().to_ascii_uppercase();
    const TYPES: &[&str] = &[
        "INT", "INTEGER", "BIGINT", "SMALLINT", "TINYINT", "MEDIUMINT",
        "SERIAL", "BIGSERIAL", "SMALLSERIAL", "DECIMAL", "NUMERIC", "NUMBER",
        "REAL", "FLOAT", "DOUBLE", "DOUBLE PRECISION", "BIT", "BOOLEAN", "BOOL",
        "CHAR", "CHARACTER", "VARCHAR", "VARCHAR2", "NCHAR", "NVARCHAR", "NVARCHAR2",
        "CHARACTER VARYING", "NATIONAL CHARACTER", "NATIONAL CHARACTER VARYING",
        "TEXT", "TINYTEXT", "MEDIUMTEXT", "LONGTEXT", "CLOB", "NCLOB", "DBCLOB",
        "BLOB", "TINYBLOB", "MEDIUMBLOB", "LONGBLOB", "BYTEA", "BINARY",
        "VARBINARY", "IMAGE", "RAW", "LONG", "LONG RAW", "GRAPHIC", "VARGRAPHIC",
        "DATE", "TIME", "TIMESTAMP", "DATETIME", "DATETIME2", "SMALLDATETIME",
        "DATETIMEOFFSET", "YEAR", "UUID", "UNIQUEIDENTIFIER", "JSON", "JSONB",
        "XML", "MONEY", "SMALLMONEY", "INET", "CIDR", "MACADDR", "INTERVAL",
        "GEOMETRY", "GEOGRAPHY", "POINT", "LINESTRING", "POLYGON", "DECFLOAT",
    ];
    if ty.is_empty() || ty.len() > 80 || ty.chars().any(|ch| ch.is_control()) {
        return Err("Invalid SQL data type.".into());
    }

    let (base, params, suffix) = if let Some(open) = ty.find('(') {
        let close = ty[open + 1..].find(')').map(|i| open + 1 + i)
            .ok_or_else(|| "Invalid SQL data type parameters.".to_string())?;
        if ty[close + 1..].chars().any(|ch| ch == '(' || ch == ')') {
            return Err("Invalid SQL data type parameters.".into());
        }
        (&ty[..open], Some(&ty[open + 1..close]), ty[close + 1..].trim())
    } else {
        if ty.contains(')') {
            return Err("Invalid SQL data type parameters.".into());
        }
        (ty.as_str(), None, "")
    };
    let base = base.trim();
    if !TYPES.contains(&base) {
        return Err("Unsupported SQL data type. Use a standard database type name.".into());
    }
    if let Some(params) = params {
        if params.is_empty() || !params.split(',').all(|part| {
            let part = part.trim();
            part.eq_ignore_ascii_case("MAX") || (!part.is_empty() && part.len() <= 6 && part.bytes().all(|b| b.is_ascii_digit()))
        }) {
            return Err("SQL data type parameters must be numeric (or MAX where supported).".into());
        }
    }
    if !matches!(suffix, "" | "UNSIGNED" | "ZEROFILL" | "UNSIGNED ZEROFILL" | "WITH TIME ZONE" | "WITHOUT TIME ZONE") {
        return Err("Unsupported SQL data type modifier.".into());
    }
    Ok(ty)
}

fn default_clause(value: Option<&String>) -> Result<String, String> {
    let Some(raw) = value else { return Ok(String::new()); };
    let value = raw.trim();
    if value.is_empty() { return Ok(String::new()); }
    if value.len() > 1024 || value.chars().any(|c| c.is_control()) {
        return Err("Default value is too long or contains control characters.".into());
    }
    let upper = value.to_ascii_uppercase();
    if matches!(upper.as_str(), "CURRENT_TIMESTAMP" | "CURRENT_DATE" | "CURRENT_TIME" | "NULL" | "TRUE" | "FALSE" | "NOW()" | "GETDATE()" | "SYSDATETIME()" | "DATETIME('NOW')" ) {
        return Ok(format!(" DEFAULT {}", upper));
    }
    if value.parse::<f64>().is_ok() {
        return Ok(format!(" DEFAULT {}", value));
    }
    if value.contains('\\') {
        return Err("Backslashes are not allowed in SQL default literals; use an explicit escaped value supported by the database.".into());
    }
    Ok(format!(" DEFAULT '{}'", value.replace('\'', "''")))
}

fn validate_identifier(value: &str, kind: &str) -> Result<(), String> {
    let ident = value.trim();
    if ident.is_empty() || ident.len() > 128 || ident.chars().any(|c| c.is_control() || c == '\\0') {
        return Err(format!("{} must be 1–128 bytes and contain no control characters.", kind));
    }
    Ok(())
}

use super::types::ColumnSpec;

// ─── SQL Dialect Helpers ──────────────────────────────────────────

pub fn quote_ident(engine: &str, ident: &str) -> String {
    let clean = ident.trim();
    match engine {
        "mysql" | "mariadb" => format!("`{}`", clean.replace('`', "``")),
        "postgres" | "postgresql" | "sqlite" => format!("\"{}\"", clean.replace('"', "\"\"")),
        "mssql" => format!("[{}]", clean.replace(']', "]]")),
        _ => format!("\"{}\"", clean.replace('"', "\"\"")),
    }
}

pub fn generate_create_table_sql(
    engine: &str,
    table: &str,
    columns: &[ColumnSpec],
) -> Result<String, String> {
    validate_identifier(table, "Table name")?;
    if columns.len() > 256 {
        return Err("A table cannot contain more than 256 columns in one operation.".into());
    }
    let mut seen_columns = std::collections::HashSet::with_capacity(columns.len());
    for col in columns {
        validate_identifier(&col.name, "Column name")?;
        if !seen_columns.insert(col.name.to_ascii_lowercase()) {
            return Err(format!("Duplicate column name '{}'.", col.name));
        }
    }

    if columns.is_empty() {
        return Err("Cannot create table with 0 columns".to_string());
    }
    let mut col_defs = Vec::new();
    let mut pks = Vec::new();

    for col in columns {
        if col.name.trim().is_empty() || col.name.len() > 128 || col.name.chars().any(|ch| ch.is_control()) {
            return Err("Column names must be 1-128 characters and contain no control characters.".into());
        }
        let col_quoted = quote_ident(engine, &col.name);
        let data_type = validate_sql_type(&col.data_type)?;
        if col.auto_increment && !col.primary_key {
            return Err("Auto-increment columns must be primary keys.".into());
        }
        if col.auto_increment && matches!(engine, "mysql" | "mariadb")
            && !matches!(data_type.as_str(), "INT" | "INTEGER" | "BIGINT" | "SMALLINT" | "TINYINT" | "MEDIUMINT")
        {
            return Err("MySQL auto-increment requires an integer column type.".into());
        }

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

        let default_clause = default_clause(col.default_value.as_ref())?;

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
    validate_identifier(old_name, "Old object name")?;
    validate_identifier(new_name, "New object name")?;

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
    validate_identifier(name, "Object name")?;

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

pub fn generate_truncate_table_sql(engine: &str, table: &str) -> Result<String, String> {
    validate_identifier(table, "Table name")?;
    let q = quote_ident(engine, table);
    Ok(match engine {
        "sqlite" => format!("DELETE FROM {};", q),
        _ => format!("TRUNCATE TABLE {};", q),
    })
}

pub fn generate_add_column_sql(engine: &str, table: &str, col: &ColumnSpec) -> Result<String, String> {
    validate_identifier(table, "Table name")?;
    validate_identifier(&col.name, "Column name")?;

    let q_table = quote_ident(engine, table);
    let q_col = quote_ident(engine, &col.name);
    let data_type = validate_sql_type(&col.data_type)?;
    let null_clause = if col.nullable { "NULL" } else { "NOT NULL" };
    let default_clause = default_clause(col.default_value.as_ref())?;
    Ok(format!(
        "ALTER TABLE {} ADD COLUMN {} {} {}{};",
        q_table, q_col, data_type, null_clause, default_clause
    ))
}

pub fn generate_drop_column_sql(engine: &str, table: &str, col_name: &str) -> Result<String, String> {
    validate_identifier(table, "Table name")?;
    validate_identifier(col_name, "Column name")?;
    let q_table = quote_ident(engine, table);
    let q_col = quote_ident(engine, col_name);
    Ok(format!("ALTER TABLE {} DROP COLUMN {};", q_table, q_col))
}

pub fn generate_create_index_sql(
    engine: &str,
    table: &str,
    index_name: &str,
    columns: &[String],
    is_unique: bool,
) -> Result<String, String> {
    validate_identifier(table, "Table name")?;
    validate_identifier(index_name, "Index name")?;
    if columns.len() > 64 {
        return Err("An index cannot contain more than 64 columns.".into());
    }
    for column in columns {
        validate_identifier(column, "Index column name")?;
    }

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

pub fn generate_drop_index_sql(engine: &str, table: &str, index_name: &str) -> Result<String, String> {
    validate_identifier(table, "Table name")?;
    validate_identifier(index_name, "Index name")?;
    let q_idx = quote_ident(engine, index_name);
    let q_tbl = quote_ident(engine, table);
    Ok(match engine {
        "mysql" | "mariadb" => format!("DROP INDEX {} ON {};", q_idx, q_tbl),
        "mssql" => format!("DROP INDEX {} ON {};", q_idx, q_tbl),
        _ => format!("DROP INDEX {};", q_idx),
    })
}

