use super::types::ColumnMeta;

// ─── SQL Row Serialization Helpers ─────────────────────────────────

pub fn get_mysql_str(row: &sqlx::mysql::MySqlRow, idx: usize) -> String {
    use sqlx::Row;
    if let Ok(s) = row.try_get::<String, _>(idx) {
        s
    } else if let Ok(Some(s)) = row.try_get::<Option<String>, _>(idx) {
        s
    } else if let Ok(bytes) = row.try_get::<Vec<u8>, _>(idx) {
        String::from_utf8_lossy(&bytes).to_string()
    } else if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(idx) {
        String::from_utf8_lossy(&bytes).to_string()
    } else {
        String::new()
    }
}

pub fn get_mysql_opt_str(row: &sqlx::mysql::MySqlRow, idx: usize) -> Option<String> {
    use sqlx::Row;
    if let Ok(s) = row.try_get::<Option<String>, _>(idx) {
        s
    } else if let Ok(bytes) = row.try_get::<Option<Vec<u8>>, _>(idx) {
        bytes.map(|b| String::from_utf8_lossy(&b).to_string())
    } else {
        None
    }
}

pub fn serialize_mysql_row(row: &sqlx::mysql::MySqlRow) -> (Vec<ColumnMeta>, serde_json::Value) {
    use sqlx::Column;
    use sqlx::Row;
    use sqlx::TypeInfo;
    use sqlx::ValueRef;

    let mut cols_meta = Vec::new();
    let mut obj = serde_json::Map::new();

    for col in row.columns() {
        let name = col.name().to_string();
        let type_name = col.type_info().name().to_string();

        cols_meta.push(ColumnMeta {
            name: name.clone(),
            data_type: type_name.clone(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        });

        let idx = col.ordinal();
        let is_null = row.try_get_raw(idx).map(|r| r.is_null()).unwrap_or(false);

        let json_val = if is_null {
            serde_json::Value::Null
        } else if let Ok(val) = row.try_get::<i64, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<i32, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<i16, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<i8, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<u64, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<u32, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<u16, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<u8, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<f64, _>(idx) {
            serde_json::Number::from_f64(val).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<f32, _>(idx) {
            serde_json::Number::from_f64(val as f64).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<bool, _>(idx) {
            serde_json::Value::Bool(val)
        } else if let Ok(val) = row.try_get::<String, _>(idx) {
            serde_json::Value::String(val)
        } else if let Ok(val) = row.try_get::<chrono::NaiveDateTime, _>(idx) {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        } else if let Ok(val) = row.try_get::<chrono::DateTime<chrono::Local>, _>(idx) {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        } else if let Ok(val) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(idx) {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        } else if let Ok(val) = row.try_get::<chrono::NaiveDate, _>(idx) {
            serde_json::Value::String(val.to_string())
        } else if let Ok(val) = row.try_get::<chrono::NaiveTime, _>(idx) {
            serde_json::Value::String(val.to_string())
        } else if let Ok(val) = row.try_get::<serde_json::Value, _>(idx) {
            val
        } else if let Ok(val) = row.try_get::<Vec<u8>, _>(idx) {
            if let Ok(s) = std::str::from_utf8(&val) {
                serde_json::Value::String(s.to_string())
            } else {
                serde_json::Value::String(format!("0x{}", val.iter().map(|b| format!("{:02X}", b)).collect::<String>()))
            }
        } else {
            serde_json::Value::Null
        };

        obj.insert(name, json_val);
    }

    (cols_meta, serde_json::Value::Object(obj))
}

pub fn serialize_pg_row(row: &sqlx::postgres::PgRow) -> (Vec<ColumnMeta>, serde_json::Value) {
    use sqlx::Column;
    use sqlx::Row;
    use sqlx::TypeInfo;
    use sqlx::ValueRef;

    let mut cols_meta = Vec::new();
    let mut obj = serde_json::Map::new();

    for col in row.columns() {
        let name = col.name().to_string();
        let type_name = col.type_info().name().to_string();

        cols_meta.push(ColumnMeta {
            name: name.clone(),
            data_type: type_name.clone(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        });

        let idx = col.ordinal();
        let is_null = row.try_get_raw(idx).map(|r| r.is_null()).unwrap_or(false);

        let json_val = if is_null {
            serde_json::Value::Null
        } else if let Ok(val) = row.try_get::<i64, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<i32, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<i16, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<i8, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<f64, _>(idx) {
            serde_json::Number::from_f64(val).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<f32, _>(idx) {
            serde_json::Number::from_f64(val as f64).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<bool, _>(idx) {
            serde_json::Value::Bool(val)
        } else if let Ok(val) = row.try_get::<String, _>(idx) {
            serde_json::Value::String(val)
        } else if let Ok(val) = row.try_get::<chrono::NaiveDateTime, _>(idx) {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        } else if let Ok(val) = row.try_get::<chrono::DateTime<chrono::Local>, _>(idx) {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        } else if let Ok(val) = row.try_get::<chrono::DateTime<chrono::FixedOffset>, _>(idx) {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        } else if let Ok(val) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(idx) {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        } else if let Ok(val) = row.try_get::<chrono::NaiveDate, _>(idx) {
            serde_json::Value::String(val.to_string())
        } else if let Ok(val) = row.try_get::<chrono::NaiveTime, _>(idx) {
            serde_json::Value::String(val.to_string())
        } else if let Ok(val) = row.try_get::<uuid::Uuid, _>(idx) {
            serde_json::Value::String(val.to_string())
        } else if let Ok(val) = row.try_get::<serde_json::Value, _>(idx) {
            val
        } else if let Ok(val) = row.try_get::<Vec<u8>, _>(idx) {
            if let Ok(s) = std::str::from_utf8(&val) {
                serde_json::Value::String(s.to_string())
            } else {
                serde_json::Value::String(format!("0x{}", val.iter().map(|b| format!("{:02X}", b)).collect::<String>()))
            }
        } else {
            serde_json::Value::Null
        };

        obj.insert(name, json_val);
    }

    (cols_meta, serde_json::Value::Object(obj))
}

pub fn serialize_sqlite_row(row: &sqlx::sqlite::SqliteRow) -> (Vec<ColumnMeta>, serde_json::Value) {
    use sqlx::Column;
    use sqlx::Row;
    use sqlx::TypeInfo;
    use sqlx::ValueRef;

    let mut cols_meta = Vec::new();
    let mut obj = serde_json::Map::new();

    for col in row.columns() {
        let name = col.name().to_string();
        let type_name = col.type_info().name().to_string();

        cols_meta.push(ColumnMeta {
            name: name.clone(),
            data_type: type_name.clone(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        });

        let idx = col.ordinal();
        let is_null = row.try_get_raw(idx).map(|r| r.is_null()).unwrap_or(false);

        let json_val = if is_null {
            serde_json::Value::Null
        } else if let Ok(val) = row.try_get::<i64, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<i32, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<i16, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<i8, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<u64, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<u32, _>(idx) {
            serde_json::Value::Number(val.into())
        } else if let Ok(val) = row.try_get::<f64, _>(idx) {
            serde_json::Number::from_f64(val).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<f32, _>(idx) {
            serde_json::Number::from_f64(val as f64).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
        } else if let Ok(val) = row.try_get::<bool, _>(idx) {
            serde_json::Value::Bool(val)
        } else if let Ok(val) = row.try_get::<String, _>(idx) {
            serde_json::Value::String(val)
        } else if let Ok(val) = row.try_get::<chrono::NaiveDateTime, _>(idx) {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        } else if let Ok(val) = row.try_get::<chrono::DateTime<chrono::Local>, _>(idx) {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        } else if let Ok(val) = row.try_get::<chrono::DateTime<chrono::Utc>, _>(idx) {
            serde_json::Value::String(val.format("%Y-%m-%d %H:%M:%S").to_string())
        } else if let Ok(val) = row.try_get::<chrono::NaiveDate, _>(idx) {
            serde_json::Value::String(val.to_string())
        } else if let Ok(val) = row.try_get::<chrono::NaiveTime, _>(idx) {
            serde_json::Value::String(val.to_string())
        } else if let Ok(val) = row.try_get::<Vec<u8>, _>(idx) {
            if let Ok(s) = std::str::from_utf8(&val) {
                serde_json::Value::String(s.to_string())
            } else {
                serde_json::Value::String(format!("0x{}", val.iter().map(|b| format!("{:02X}", b)).collect::<String>()))
            }
        } else {
            serde_json::Value::Null
        };

        obj.insert(name, json_val);
    }

    (cols_meta, serde_json::Value::Object(obj))
}

pub fn split_sql_statements(input: &str) -> Vec<String> {
    split_sql_statements_for_engine(input, "")
}

pub fn split_sql_statements_for_engine(input: &str, engine: &str) -> Vec<String> {
    let is_mysql = matches!(engine.to_ascii_lowercase().as_str(), "mysql" | "mariadb");
    let mut statements = Vec::new();
    let mut current_delimiter = ";".to_string();
    let mut current_stmt = String::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_backtick = false;
    let mut in_bracket_identifier = false;
    let mut dollar_quote: Option<String> = None;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut begin_end_depth: usize = 0;

    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let ch = chars[i];
        let next_ch = if i + 1 < len { Some(chars[i + 1]) } else { None };

        if let Some(tag) = dollar_quote.as_ref() {
            if i + tag.chars().count() <= len
                && chars[i..i + tag.chars().count()].iter().collect::<String>() == *tag
            {
                current_stmt.push_str(tag);
                i += tag.chars().count();
                dollar_quote = None;
                continue;
            }
            current_stmt.push(ch);
            i += 1;
            continue;
        }

        // Handle SQL Server bracket-quoted identifiers.
        if in_bracket_identifier {
            current_stmt.push(ch);
            if ch == ']' {
                if next_ch == Some(']') {
                    current_stmt.push(']');
                    i += 2;
                    continue;
                }
                in_bracket_identifier = false;
            }
            i += 1;
            continue;
        }

        // Handle line comment end
        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
            }
            current_stmt.push(ch);
            i += 1;
            continue;
        }

        // Handle block comment end
        if in_block_comment {
            if ch == '*' && next_ch == Some('/') {
                current_stmt.push('*');
                current_stmt.push('/');
                in_block_comment = false;
                i += 2;
                continue;
            }
            current_stmt.push(ch);
            i += 1;
            continue;
        }

        // Handle string literals
        if in_single_quote {
            current_stmt.push(ch);
            if ch == '\\' && i + 1 < len {
                current_stmt.push(chars[i + 1]);
                i += 2;
                continue;
            }
            if ch == '\'' {
                if next_ch == Some('\'') {
                    current_stmt.push('\'');
                    i += 2;
                    continue;
                }
                in_single_quote = false;
            }
            i += 1;
            continue;
        }

        if in_double_quote {
            current_stmt.push(ch);
            if ch == '\\' && i + 1 < len {
                current_stmt.push(chars[i + 1]);
                i += 2;
                continue;
            }
            if ch == '"' {
                if next_ch == Some('"') {
                    current_stmt.push('"');
                    i += 2;
                    continue;
                }
                in_double_quote = false;
            }
            i += 1;
            continue;
        }

        if in_backtick {
            current_stmt.push(ch);
            if ch == '`' {
                if next_ch == Some('`') {
                    current_stmt.push('`');
                    i += 2;
                    continue;
                }
                in_backtick = false;
            }
            i += 1;
            continue;
        }

        // Start comments
        if ch == '-' && next_ch == Some('-')
            && (!is_mysql || i + 2 >= len || chars[i + 2].is_whitespace())
        {
            in_line_comment = true;
            current_stmt.push('-');
            current_stmt.push('-');
            i += 2;
            continue;
        }
        // MySQL treats any unquoted # as a line comment. Other dialects
        // retain # operators and SQL Server temporary-table identifiers.
        if ch == '#' && (is_mysql || next_ch.map(|n| n.is_whitespace()).unwrap_or(false)) {
            in_line_comment = true;
            current_stmt.push('#');
            i += 1;
            continue;
        }
        if ch == '/' && next_ch == Some('*') {
            in_block_comment = true;
            current_stmt.push('/');
            current_stmt.push('*');
            i += 2;
            continue;
        }

        // Start string or identifier quotes
        if ch == '\'' {
            in_single_quote = true;
            current_stmt.push(ch);
            i += 1;
            continue;
        }
        if ch == '"' {
            in_double_quote = true;
            current_stmt.push(ch);
            i += 1;
            continue;
        }
        if ch == '`' {
            in_backtick = true;
            current_stmt.push(ch);
            i += 1;
            continue;
        }
        if ch == '[' {
            in_bracket_identifier = true;
            current_stmt.push(ch);
            i += 1;
            continue;
        }
        if ch == '
        let is_at_start = current_stmt.trim().is_empty();
        if is_at_start {
            let remaining: String = chars[i..].iter().collect();
            let upper = remaining.to_uppercase();
            if upper.starts_with("DELIMITER ") || upper.starts_with("DELIMITER\t") {
                let after_kw = &remaining["DELIMITER".len()..];
                let trimmed_after = after_kw.trim_start();
                let delim_token: String = trimmed_after
                    .chars()
                    .take_while(|c| !c.is_whitespace() && *c != '\n' && *c != '\r')
                    .collect();
                if !delim_token.is_empty() {
                    current_delimiter = delim_token.clone();
                    let skip_len = "DELIMITER".len() + (after_kw.len() - trimmed_after.len()) + delim_token.len();
                    i += skip_len;
                    while i < len && (chars[i] == ' ' || chars[i] == '\t' || chars[i] == '\r') {
                        i += 1;
                    }
                    if i < len && chars[i] == '\n' {
                        i += 1;
                    }
                    continue;
                }
            }
        }

        // Check for delimiter match
        let delim_len = current_delimiter.chars().count();
        if i + delim_len <= len {
            let slice: String = chars[i..i + delim_len].iter().collect();
            if slice == current_delimiter {
                let should_split = if current_delimiter == ";" {
                    begin_end_depth == 0
                } else {
                    true
                };

                if should_split {
                    let stmt_trimmed = current_stmt.trim();
                    if !stmt_trimmed.is_empty() {
                        statements.push(stmt_trimmed.to_string());
                    }
                    current_stmt.clear();
                    begin_end_depth = 0;
                    i += delim_len;
                    continue;
                }
            }
        }

        // Track BEGIN ... END depth if default delimiter is used
        if current_delimiter == ";" {
            let prev_is_boundary = i == 0 || (!chars[i - 1].is_alphanumeric() && chars[i - 1] != '_');
            if prev_is_boundary {
                let remaining: String = chars[i..].iter().take(10).collect();
                let upper = remaining.to_uppercase();
                if upper.starts_with("BEGIN") && (i + 5 >= len || (!chars[i + 5].is_alphanumeric() && chars[i + 5] != '_')) {
                    let after_begin: String = chars[i + 5..].iter().take(20).collect();
                    let upper_after = after_begin.trim_start().to_uppercase();
                    if !upper_after.starts_with("TRAN") && !upper_after.starts_with("WORK") {
                        begin_end_depth += 1;
                    }
                } else if upper.starts_with("END") && (i + 3 >= len || (!chars[i + 3].is_alphanumeric() && chars[i + 3] != '_')) {
                    begin_end_depth = begin_end_depth.saturating_sub(1);
                }
            }
        }

        current_stmt.push(ch);
        i += 1;
    }

    let rem = current_stmt.trim();
    if !rem.is_empty() {
        let final_stmt = if rem.ends_with(&current_delimiter) {
            rem[..rem.len() - current_delimiter.len()].trim()
        } else {
            rem
        };
        if !final_stmt.is_empty() {
            statements.push(final_stmt.to_string());
        }
    }

    statements
}
 {
            let mut j = i + 1;
            while j < len && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            if j < len && chars[j] == '
        let is_at_start = current_stmt.trim().is_empty();
        if is_at_start {
            let remaining: String = chars[i..].iter().collect();
            let upper = remaining.to_uppercase();
            if upper.starts_with("DELIMITER ") || upper.starts_with("DELIMITER\t") {
                let after_kw = &remaining["DELIMITER".len()..];
                let trimmed_after = after_kw.trim_start();
                let delim_token: String = trimmed_after
                    .chars()
                    .take_while(|c| !c.is_whitespace() && *c != '\n' && *c != '\r')
                    .collect();
                if !delim_token.is_empty() {
                    current_delimiter = delim_token.clone();
                    let skip_len = "DELIMITER".len() + (after_kw.len() - trimmed_after.len()) + delim_token.len();
                    i += skip_len;
                    while i < len && (chars[i] == ' ' || chars[i] == '\t' || chars[i] == '\r') {
                        i += 1;
                    }
                    if i < len && chars[i] == '\n' {
                        i += 1;
                    }
                    continue;
                }
            }
        }

        // Check for delimiter match
        let delim_len = current_delimiter.chars().count();
        if i + delim_len <= len {
            let slice: String = chars[i..i + delim_len].iter().collect();
            if slice == current_delimiter {
                let should_split = if current_delimiter == ";" {
                    begin_end_depth == 0
                } else {
                    true
                };

                if should_split {
                    let stmt_trimmed = current_stmt.trim();
                    if !stmt_trimmed.is_empty() {
                        statements.push(stmt_trimmed.to_string());
                    }
                    current_stmt.clear();
                    begin_end_depth = 0;
                    i += delim_len;
                    continue;
                }
            }
        }

        // Track BEGIN ... END depth if default delimiter is used
        if current_delimiter == ";" {
            let prev_is_boundary = i == 0 || (!chars[i - 1].is_alphanumeric() && chars[i - 1] != '_');
            if prev_is_boundary {
                let remaining: String = chars[i..].iter().take(10).collect();
                let upper = remaining.to_uppercase();
                if upper.starts_with("BEGIN") && (i + 5 >= len || (!chars[i + 5].is_alphanumeric() && chars[i + 5] != '_')) {
                    let after_begin: String = chars[i + 5..].iter().take(20).collect();
                    let upper_after = after_begin.trim_start().to_uppercase();
                    if !upper_after.starts_with("TRAN") && !upper_after.starts_with("WORK") {
                        begin_end_depth += 1;
                    }
                } else if upper.starts_with("END") && (i + 3 >= len || (!chars[i + 3].is_alphanumeric() && chars[i + 3] != '_')) {
                    begin_end_depth = begin_end_depth.saturating_sub(1);
                }
            }
        }

        current_stmt.push(ch);
        i += 1;
    }

    let rem = current_stmt.trim();
    if !rem.is_empty() {
        let final_stmt = if rem.ends_with(&current_delimiter) {
            rem[..rem.len() - current_delimiter.len()].trim()
        } else {
            rem
        };
        if !final_stmt.is_empty() {
            statements.push(final_stmt.to_string());
        }
    }

    statements
}
 {
                let tag: String = chars[i..=j].iter().collect();
                current_stmt.push_str(&tag);
                i = j + 1;
                dollar_quote = Some(tag);
                continue;
            }
        }

        // Check for DELIMITER keyword
        let is_at_start = current_stmt.trim().is_empty();
        if is_at_start {
            let remaining: String = chars[i..].iter().collect();
            let upper = remaining.to_uppercase();
            if upper.starts_with("DELIMITER ") || upper.starts_with("DELIMITER\t") {
                let after_kw = &remaining["DELIMITER".len()..];
                let trimmed_after = after_kw.trim_start();
                let delim_token: String = trimmed_after
                    .chars()
                    .take_while(|c| !c.is_whitespace() && *c != '\n' && *c != '\r')
                    .collect();
                if !delim_token.is_empty() {
                    current_delimiter = delim_token.clone();
                    let skip_len = "DELIMITER".len() + (after_kw.len() - trimmed_after.len()) + delim_token.len();
                    i += skip_len;
                    while i < len && (chars[i] == ' ' || chars[i] == '\t' || chars[i] == '\r') {
                        i += 1;
                    }
                    if i < len && chars[i] == '\n' {
                        i += 1;
                    }
                    continue;
                }
            }
        }

        // Check for delimiter match
        let delim_len = current_delimiter.chars().count();
        if i + delim_len <= len {
            let slice: String = chars[i..i + delim_len].iter().collect();
            if slice == current_delimiter {
                let should_split = if current_delimiter == ";" {
                    begin_end_depth == 0
                } else {
                    true
                };

                if should_split {
                    let stmt_trimmed = current_stmt.trim();
                    if !stmt_trimmed.is_empty() {
                        statements.push(stmt_trimmed.to_string());
                    }
                    current_stmt.clear();
                    begin_end_depth = 0;
                    i += delim_len;
                    continue;
                }
            }
        }

        // Track BEGIN ... END depth if default delimiter is used
        if current_delimiter == ";" {
            let prev_is_boundary = i == 0 || (!chars[i - 1].is_alphanumeric() && chars[i - 1] != '_');
            if prev_is_boundary {
                let remaining: String = chars[i..].iter().take(10).collect();
                let upper = remaining.to_uppercase();
                if upper.starts_with("BEGIN") && (i + 5 >= len || (!chars[i + 5].is_alphanumeric() && chars[i + 5] != '_')) {
                    let after_begin: String = chars[i + 5..].iter().take(20).collect();
                    let upper_after = after_begin.trim_start().to_uppercase();
                    if !upper_after.starts_with("TRAN") && !upper_after.starts_with("WORK") {
                        begin_end_depth += 1;
                    }
                } else if upper.starts_with("END") && (i + 3 >= len || (!chars[i + 3].is_alphanumeric() && chars[i + 3] != '_')) {
                    begin_end_depth = begin_end_depth.saturating_sub(1);
                }
            }
        }

        current_stmt.push(ch);
        i += 1;
    }

    let rem = current_stmt.trim();
    if !rem.is_empty() {
        let final_stmt = if rem.ends_with(&current_delimiter) {
            rem[..rem.len() - current_delimiter.len()].trim()
        } else {
            rem
        };
        if !final_stmt.is_empty() {
            statements.push(final_stmt.to_string());
        }
    }

    statements
}


#[cfg(test)]
mod dialect_splitter_tests {
    use super::split_sql_statements_for_engine;

    #[test]
    fn postgres_json_hash_operators_are_not_comments() {
        let statements = split_sql_statements_for_engine(
            "SELECT payload #> '{\\"items\\"}' FROM docs; SELECT 2;",
            "postgres",
        );
        assert_eq!(statements.len(), 2);
    }

    #[test]
    fn sql_server_temp_table_names_are_not_comments() {
        let statements = split_sql_statements_for_engine(
            "CREATE TABLE #temp (id INT); SELECT * FROM #temp;",
            "mssql",
        );
        assert_eq!(statements.len(), 2);
    }

    #[test]
    fn mysql_hash_comments_work_without_a_space() {
        let statements = split_sql_statements_for_engine(
            "SELECT 1;#comment without leading space\\nSELECT 2;",
            "mysql",
        );
        assert_eq!(statements.len(), 2);
    }

    #[test]
    fn postgres_dollar_quoted_semicolons_do_not_split() {
        let statements = split_sql_statements_for_engine(
            "DO $$ BEGIN PERFORM 1; PERFORM 2; END $$; SELECT 3;",
            "postgres",
        );
        assert_eq!(statements.len(), 2);
    }
}
