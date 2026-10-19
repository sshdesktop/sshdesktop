use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use super::types::{
    ActiveDatabaseSession, BatchStatementResult, ColumnMeta, DatabaseConnectionConfig,
    DatabaseManager, DatabaseObject, DatabaseOperation, DriverInstance, OperationResult,
    QueryResult, ServerCapabilities, urlencoding,
};
use super::serialization::split_sql_statements;

#[inline]
pub fn get_effective_mongo_db<'a>(db: &'a str) -> &'a str {
    let trimmed = db.trim();
    if trimmed.is_empty() {
        "admin"
    } else {
        trimmed
    }
}

pub async fn connect_mongo(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let db_name = get_effective_mongo_db(&config.database).to_string();

    let has_auth = !config.username.trim().is_empty() && config.password.as_ref().map(|p| !p.is_empty()).unwrap_or(false);
    let auth = if has_auth {
        let pwd = config.password.as_deref().unwrap_or("");
        format!("{}:{}@", urlencoding(config.username.trim()), urlencoding(pwd))
    } else {
        "".to_string()
    };

    let mut query_params = Vec::new();
    if config.use_ssl {
        if config.ssl_verify {
            query_params.push("tls=true".to_string());
        } else {
            query_params.push("tls=true&tlsAllowInvalidCertificates=true".to_string());
        }
    }
    if has_auth {
        query_params.push(format!("authSource={}", db_name));
    }

    let query_str = if query_params.is_empty() {
        "".to_string()
    } else {
        format!("?{}", query_params.join("&"))
    };

    let uri = format!("mongodb://{}{}:{}/{}{}", auth, effective_host, effective_port, db_name, query_str);
    let mut client_options = mongodb::options::ClientOptions::parse(&uri)
        .await
        .map_err(|e| format!("MongoDB connection string error: {}", e))?;

    client_options.server_selection_timeout = Some(std::time::Duration::from_secs(config.timeout_seconds.unwrap_or(8)));
    client_options.connect_timeout = Some(std::time::Duration::from_secs(config.timeout_seconds.unwrap_or(8)));

    let client = mongodb::Client::with_options(client_options)
        .map_err(|e| format!("MongoDB client init error: {}", e))?;

    // Ping to verify
    let db = client.database(&db_name);
    let ping_doc = mongodb::bson::doc! { "ping": 1 };
    db.run_command(ping_doc, None)
        .await
        .map_err(|e| format!("MongoDB ping failed: {}", e))?;

    let build_info = db
        .run_command(mongodb::bson::doc! { "buildInfo": 1 }, None)
        .await
        .ok();
    let version_str = build_info
        .and_then(|d| d.get_str("version").ok().map(|s| s.to_string()))
        .unwrap_or_else(|| "MongoDB".to_string());

    let capabilities = ServerCapabilities {
        engine: "mongodb".to_string(),
        server_version: version_str,
        supports_transactions: true,
        supports_schemas: false,
        supports_procedures: false,
        supports_functions: false,
        supports_triggers: false,
        supports_views: true,
        supports_indexes: true,
        supports_foreign_keys: false,
        supports_explain: true,
        supports_process_list: false,
        read_only: config.read_only,
        supports_rename_table: true,
        supports_alter_column: false,
    };

    Ok((DriverInstance::Mongo(client), capabilities))
}

pub fn bson_to_clean_json(bson: mongodb::bson::Bson) -> serde_json::Value {
    match bson {
        mongodb::bson::Bson::Double(d) => serde_json::json!(d),
        mongodb::bson::Bson::String(s) => serde_json::Value::String(s),
        mongodb::bson::Bson::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(bson_to_clean_json).collect())
        }
        mongodb::bson::Bson::Document(doc) => {
            let mut map = serde_json::Map::new();
            for (k, v) in doc {
                map.insert(k, bson_to_clean_json(v));
            }
            serde_json::Value::Object(map)
        }
        mongodb::bson::Bson::Boolean(b) => serde_json::Value::Bool(b),
        mongodb::bson::Bson::Null => serde_json::Value::Null,
        mongodb::bson::Bson::RegularExpression(re) => {
            serde_json::Value::String(format!("/{}/{}", re.pattern, re.options))
        }
        mongodb::bson::Bson::JavaScriptCode(code) => serde_json::Value::String(code),
        mongodb::bson::Bson::JavaScriptCodeWithScope(code) => {
            serde_json::Value::String(code.code)
        }
        mongodb::bson::Bson::Int32(i) => serde_json::json!(i),
        mongodb::bson::Bson::Int64(i) => serde_json::json!(i),
        mongodb::bson::Bson::Timestamp(ts) => {
            serde_json::json!({ "time": ts.time, "increment": ts.increment })
        }
        mongodb::bson::Bson::Binary(b) => {
            serde_json::Value::String(format!("<Binary {} bytes>", b.bytes.len()))
        }
        mongodb::bson::Bson::ObjectId(oid) => {
            serde_json::Value::String(oid.to_hex())
        }
        mongodb::bson::Bson::DateTime(dt) => {
            serde_json::Value::String(dt.try_to_rfc3339_string().unwrap_or_else(|_| dt.to_string()))
        }
        mongodb::bson::Bson::Symbol(s) => serde_json::Value::String(s),
        mongodb::bson::Bson::Decimal128(d) => serde_json::Value::String(d.to_string()),
        mongodb::bson::Bson::Undefined => serde_json::Value::Null,
        mongodb::bson::Bson::MinKey => serde_json::Value::String("<MinKey>".to_string()),
        mongodb::bson::Bson::MaxKey => serde_json::Value::String("<MaxKey>".to_string()),
        _ => serde_json::Value::Null,
    }
}

pub fn strip_js_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let chars: Vec<char> = input.chars().collect();
    let n = chars.len();
    let mut i = 0;

    while i < n {
        let c = chars[i];

        // 1. Double-quoted string
        if c == '"' {
            out.push('"');
            i += 1;
            while i < n {
                let sc = chars[i];
                out.push(sc);
                if sc == '\\' && i + 1 < n {
                    i += 1;
                    out.push(chars[i]);
                } else if sc == '"' {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // 2. Single-quoted string
        if c == '\'' {
            out.push('\'');
            i += 1;
            while i < n {
                let sc = chars[i];
                out.push(sc);
                if sc == '\\' && i + 1 < n {
                    i += 1;
                    out.push(chars[i]);
                } else if sc == '\'' {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // 3. Backtick / template string
        if c == '`' {
            out.push('`');
            i += 1;
            while i < n {
                let sc = chars[i];
                out.push(sc);
                if sc == '\\' && i + 1 < n {
                    i += 1;
                    out.push(chars[i]);
                } else if sc == '`' {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // 4. Single-line comment // or --
        if (c == '/' && i + 1 < n && chars[i + 1] == '/') || (c == '-' && i + 1 < n && chars[i + 1] == '-') {
            i += 2;
            while i < n && chars[i] != '\n' && chars[i] != '\r' {
                i += 1;
            }
            out.push(' ');
            continue;
        }

        // 5. Multi-line comment /* ... */
        if c == '/' && i + 1 < n && chars[i + 1] == '*' {
            i += 2;
            while i + 1 < n && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            if i + 1 < n {
                i += 2; // skip */
            } else {
                i = n;
            }
            out.push(' ');
            continue;
        }

        out.push(c);
        i += 1;
    }

    out
}

pub fn split_mongo_statements(raw_query: &str) -> Vec<String> {
    let stripped = strip_js_comments(raw_query);
    let mut statements = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = stripped.chars().collect();
    let n = chars.len();
    let mut i = 0;

    let mut depth_paren: usize = 0;
    let mut depth_brace: usize = 0;
    let mut depth_bracket: usize = 0;

    while i < n {
        let c = chars[i];

        if c == '"' || c == '\'' || c == '`' {
            let quote = c;
            current.push(c);
            i += 1;
            while i < n {
                let sc = chars[i];
                current.push(sc);
                if sc == '\\' && i + 1 < n {
                    i += 1;
                    current.push(chars[i]);
                } else if sc == quote {
                    break;
                }
                i += 1;
            }
            i += 1;
            continue;
        }

        match c {
            '(' => depth_paren += 1,
            ')' => depth_paren = depth_paren.saturating_sub(1),
            '{' => depth_brace += 1,
            '}' => depth_brace = depth_brace.saturating_sub(1),
            '[' => depth_bracket += 1,
            ']' => depth_bracket = depth_bracket.saturating_sub(1),
            ';' if depth_paren == 0 && depth_brace == 0 && depth_bracket == 0 => {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    statements.push(trimmed.to_string());
                }
                current.clear();
                i += 1;
                continue;
            }
            _ => {}
        }

        current.push(c);
        i += 1;
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        statements.push(trimmed.to_string());
    }

    statements
}

pub fn extract_paren_args(s: &str, method_name: &str) -> Result<String, String> {
    let prefix = format!("{}(", method_name);
    if !s.starts_with(&prefix) {
        return Err(format!("Expected {} call", method_name));
    }
    let after = &s[prefix.len()..];
    let chars: Vec<char> = after.chars().collect();
    let n = chars.len();
    let mut depth = 1usize;
    let mut i = 0;
    while i < n && depth > 0 {
        let c = chars[i];
        if c == '"' || c == '\'' || c == '`' {
            let quote = c;
            i += 1;
            while i < n {
                let sc = chars[i];
                if sc == '\\' && i + 1 < n {
                    i += 2;
                } else if sc == quote {
                    i += 1;
                    break;
                } else {
                    i += 1;
                }
            }
            continue;
        }
        if c == '(' {
            depth += 1;
        } else if c == ')' {
            depth -= 1;
            if depth == 0 {
                let content: String = chars[..i].iter().collect();
                return Ok(content.trim().to_string());
            }
        }
        i += 1;
    }
    Ok(after.trim().trim_end_matches(')').trim().to_string())
}

pub fn relax_to_strict_json(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 32);
    let chars: Vec<char> = input.chars().collect();
    let n = chars.len();
    let mut i = 0;

    while i < n {
        let c = chars[i];

        // 0. Skip single line & multi-line comments if any remain
        if (c == '/' && i + 1 < n && chars[i + 1] == '/') || (c == '-' && i + 1 < n && chars[i + 1] == '-') {
            i += 2;
            while i < n && chars[i] != '\n' && chars[i] != '\r' {
                i += 1;
            }
            continue;
        }
        if c == '/' && i + 1 < n && chars[i + 1] == '*' {
            i += 2;
            while i < n && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            if i + 1 < n {
                i += 2;
            } else {
                i = n;
            }
            continue;
        }

        // 1. Double-quoted string
        if c == '"' {
            out.push('"');
            i += 1;
            while i < n {
                let sc = chars[i];
                out.push(sc);
                if sc == '\\' && i + 1 < n {
                    i += 1;
                    out.push(chars[i]);
                } else if sc == '"' {
                    i += 1;
                    break;
                }
                i += 1;
            }
            continue;
        }

        // 2. Single-quoted string -> convert to double-quoted
        if c == '\'' {
            out.push('"');
            i += 1;
            while i < n {
                let sc = chars[i];
                if sc == '\\' && i + 1 < n {
                    i += 1;
                    let next_c = chars[i];
                    if next_c == '\'' {
                        out.push('\'');
                    } else {
                        out.push('\\');
                        out.push(next_c);
                    }
                } else if sc == '"' {
                    out.push('\\');
                    out.push('"');
                } else if sc == '\'' {
                    out.push('"');
                    i += 1;
                    break;
                } else {
                    out.push(sc);
                }
                i += 1;
            }
            continue;
        }

        // 3. Trailing comma removal before closing brace or bracket
        if c == '}' || c == ']' {
            let mut trimmed_len = out.len();
            while trimmed_len > 0 {
                let last_b = out.as_bytes()[trimmed_len - 1];
                if last_b == b' ' || last_b == b'\t' || last_b == b'\r' || last_b == b'\n' {
                    trimmed_len -= 1;
                } else {
                    break;
                }
            }
            if trimmed_len > 0 && out.as_bytes()[trimmed_len - 1] == b',' {
                out.truncate(trimmed_len - 1);
            }
            out.push(c);
            i += 1;
            continue;
        }

        // 4. ObjectId("...") or ObjectId('...')
        if (c == 'O' || c == 'o') && i + 8 <= n {
            let slice: String = chars[i..std::cmp::min(i + 9, n)].iter().collect();
            if slice.eq_ignore_ascii_case("objectid(") {
                i += 9;
                while i < n && (chars[i] == ' ' || chars[i] == '\t' || chars[i] == '\r' || chars[i] == '\n') { i += 1; }
                let quote = if i < n && (chars[i] == '"' || chars[i] == '\'') { let q = chars[i]; i += 1; q } else { ' ' };
                let mut oid_str = String::new();
                while i < n && chars[i] != quote && chars[i] != ')' {
                    oid_str.push(chars[i]);
                    i += 1;
                }
                if i < n && chars[i] == quote { i += 1; }
                while i < n && chars[i] != ')' { i += 1; }
                if i < n && chars[i] == ')' { i += 1; }
                out.push_str(&format!("{{\"$oid\":\"{}\"}}", oid_str.trim()));
                continue;
            }
        }

        // 5. ISODate("...")
        if (c == 'I' || c == 'i') && i + 7 <= n {
            let slice: String = chars[i..std::cmp::min(i + 8, n)].iter().collect();
            if slice.eq_ignore_ascii_case("isodate(") {
                i += 8;
                while i < n && (chars[i] == ' ' || chars[i] == '\t' || chars[i] == '\r' || chars[i] == '\n') { i += 1; }
                let quote = if i < n && (chars[i] == '"' || chars[i] == '\'') { let q = chars[i]; i += 1; q } else { ' ' };
                let mut date_str = String::new();
                while i < n && chars[i] != quote && chars[i] != ')' {
                    date_str.push(chars[i]);
                    i += 1;
                }
                if i < n && chars[i] == quote { i += 1; }
                while i < n && chars[i] != ')' { i += 1; }
                if i < n && chars[i] == ')' { i += 1; }
                out.push_str(&format!("{{\"$date\":\"{}\"}}", date_str.trim()));
                continue;
            }
        }

        // 6. new Date("...") or new Date()
        if (c == 'n' || c == 'N') && i + 8 <= n {
            let slice: String = chars[i..std::cmp::min(i + 8, n)].iter().collect();
            if slice.eq_ignore_ascii_case("new date") {
                let mut j = i + 8;
                while j < n && (chars[j] == ' ' || chars[j] == '\t') { j += 1; }
                if j < n && chars[j] == '(' {
                    j += 1;
                    while j < n && (chars[j] == ' ' || chars[j] == '\t') { j += 1; }
                    let quote = if j < n && (chars[j] == '"' || chars[j] == '\'') { let q = chars[j]; j += 1; q } else { ' ' };
                    let mut d_str = String::new();
                    while j < n && chars[j] != quote && chars[j] != ')' {
                        d_str.push(chars[j]);
                        j += 1;
                    }
                    if j < n && chars[j] == quote { j += 1; }
                    while j < n && chars[j] != ')' { j += 1; }
                    if j < n && chars[j] == ')' { j += 1; }
                    i = j;
                    if d_str.trim().is_empty() {
                        let now = chrono::Utc::now().to_rfc3339();
                        out.push_str(&format!("{{\"$date\":\"{}\"}}", now));
                    } else {
                        out.push_str(&format!("{{\"$date\":\"{}\"}}", d_str.trim()));
                    }
                    continue;
                }
            }
        }

        // 7. NumberInt(123) / NumberLong(123) / NumberDecimal("123")
        if (c == 'N' || c == 'n') && i + 10 <= n {
            let slice: String = chars[i..std::cmp::min(i + 14, n)].iter().collect();
            if slice.to_ascii_lowercase().starts_with("numberint(")
                || slice.to_ascii_lowercase().starts_with("numberlong(")
                || slice.to_ascii_lowercase().starts_with("numberdecimal(") {
                let open_paren = slice.find('(').unwrap();
                let mut j = i + open_paren + 1;
                while j < n && (chars[j] == ' ' || chars[j] == '\t') { j += 1; }
                let quote = if j < n && (chars[j] == '"' || chars[j] == '\'') { let q = chars[j]; j += 1; q } else { ' ' };
                let mut num_str = String::new();
                while j < n && chars[j] != quote && chars[j] != ')' {
                    num_str.push(chars[j]);
                    j += 1;
                }
                if j < n && chars[j] == quote { j += 1; }
                while j < n && chars[j] != ')' { j += 1; }
                if j < n && chars[j] == ')' { j += 1; }
                i = j;
                let val_trimmed = num_str.trim();
                if val_trimmed.parse::<f64>().is_ok() || val_trimmed.parse::<i64>().is_ok() {
                    out.push_str(val_trimmed);
                } else {
                    out.push_str(&format!("\"{}\"", val_trimmed));
                }
                continue;
            }
        }

        // 8. Unquoted object keys: identifier followed by optional whitespace and ':'
        if c.is_alphabetic() || c == '_' || c == '$' {
            let start = i;
            while i < n && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '$') {
                i += 1;
            }
            let ident: String = chars[start..i].iter().collect();
            let mut j = i;
            while j < n && (chars[j] == ' ' || chars[j] == '\t' || chars[j] == '\r' || chars[j] == '\n') {
                j += 1;
            }
            if j < n && chars[j] == ':' {
                out.push('"');
                out.push_str(&ident);
                out.push('"');
            } else {
                out.push_str(&ident);
            }
            continue;
        }

        // 9. Any other char
        out.push(c);
        i += 1;
    }

    out
}

pub fn json_to_bson_value(val: serde_json::Value) -> mongodb::bson::Bson {
    match val {
        serde_json::Value::Null => mongodb::bson::Bson::Null,
        serde_json::Value::Bool(b) => mongodb::bson::Bson::Boolean(b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                if i >= i32::MIN as i64 && i <= i32::MAX as i64 {
                    mongodb::bson::Bson::Int32(i as i32)
                } else {
                    mongodb::bson::Bson::Int64(i)
                }
            } else if let Some(f) = n.as_f64() {
                mongodb::bson::Bson::Double(f)
            } else {
                mongodb::bson::Bson::String(n.to_string())
            }
        }
        serde_json::Value::String(s) => mongodb::bson::Bson::String(s),
        serde_json::Value::Array(arr) => {
            mongodb::bson::Bson::Array(arr.into_iter().map(json_to_bson_value).collect())
        }
        serde_json::Value::Object(map) => {
            if map.len() == 1 {
                if let Some(oid_val) = map.get("$oid") {
                    if let Some(oid_str) = oid_val.as_str() {
                        if let Ok(oid) = mongodb::bson::oid::ObjectId::parse_str(oid_str) {
                            return mongodb::bson::Bson::ObjectId(oid);
                        }
                    }
                }
                if let Some(date_val) = map.get("$date") {
                    if let Some(date_str) = date_val.as_str() {
                        if let Ok(dt) = mongodb::bson::DateTime::parse_rfc3339_str(date_str) {
                            return mongodb::bson::Bson::DateTime(dt);
                        }
                    }
                }
            }
            let mut doc = mongodb::bson::Document::new();
            for (k, v) in map {
                let clean_k = k.trim().to_string();
                if clean_k == "_id" {
                    if let serde_json::Value::String(ref s) = v {
                        if s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit()) {
                            if let Ok(oid) = mongodb::bson::oid::ObjectId::parse_str(s) {
                                doc.insert(clean_k, oid);
                                continue;
                            }
                        }
                    }
                }
                doc.insert(clean_k, json_to_bson_value(v));
            }
            mongodb::bson::Bson::Document(doc)
        }
    }
}

pub fn json_to_bson_document(val: serde_json::Value) -> Result<mongodb::bson::Document, String> {
    match json_to_bson_value(val) {
        mongodb::bson::Bson::Document(doc) => Ok(doc),
        _ => Err("Expected JSON object for MongoDB document".to_string()),
    }
}

pub fn parse_relaxed_document(s: &str) -> Result<mongodb::bson::Document, String> {
    let stripped = strip_js_comments(s);
    let trimmed = stripped.trim();
    if trimmed.is_empty() || trimmed == "{}" {
        return Ok(mongodb::bson::Document::new());
    }
    let strict = relax_to_strict_json(trimmed);
    let val: serde_json::Value = serde_json::from_str(&strict)
        .map_err(|e| format!("Invalid MongoDB document: {}. (Processed: {})", e, strict))?;
    json_to_bson_document(val)
}

pub fn split_top_level_args(args_str: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let chars: Vec<char> = args_str.chars().collect();
    let n = chars.len();
    let mut i = 0;
    let mut depth_paren: usize = 0;
    let mut depth_brace: usize = 0;
    let mut depth_bracket: usize = 0;

    while i < n {
        let c = chars[i];
        if c == '"' || c == '\'' {
            current.push(c);
            let quote = c;
            i += 1;
            while i < n {
                let sc = chars[i];
                current.push(sc);
                if sc == '\\' && i + 1 < n {
                    i += 1;
                    current.push(chars[i]);
                } else if sc == quote {
                    break;
                }
                i += 1;
            }
            i += 1;
            continue;
        }

        match c {
            '(' => depth_paren += 1,
            ')' => depth_paren = depth_paren.saturating_sub(1),
            '{' => depth_brace += 1,
            '}' => depth_brace = depth_brace.saturating_sub(1),
            '[' => depth_bracket += 1,
            ']' => depth_bracket = depth_bracket.saturating_sub(1),
            ',' if depth_paren == 0 && depth_brace == 0 && depth_bracket == 0 => {
                let trimmed = current.trim();
                if !trimmed.is_empty() {
                    args.push(trimmed.to_string());
                }
                current.clear();
                i += 1;
                continue;
            }
            _ => {}
        }
        current.push(c);
        i += 1;
    }

    let trimmed = current.trim();
    if !trimmed.is_empty() {
        args.push(trimmed.to_string());
    }
    args
}

pub fn parse_method_calls(chain: &str) -> Vec<(String, String)> {
    let mut methods = Vec::new();
    let chars: Vec<char> = chain.chars().collect();
    let n = chars.len();
    let mut i = 0;

    while i < n {
        while i < n && (chars[i].is_whitespace() || chars[i] == '.') {
            i += 1;
        }
        if i >= n {
            break;
        }

        let name_start = i;
        while i < n && (chars[i].is_alphanumeric() || chars[i] == '_' || chars[i] == '$') {
            i += 1;
        }
        let method_name: String = chars[name_start..i].iter().collect();
        if method_name.is_empty() {
            break;
        }

        while i < n && chars[i].is_whitespace() {
            i += 1;
        }
        if i < n && chars[i] == '(' {
            i += 1;
            let args_start = i;
            let mut depth = 1;
            while i < n && depth > 0 {
                let c = chars[i];
                if c == '"' || c == '\'' {
                    let quote = c;
                    i += 1;
                    while i < n {
                        let sc = chars[i];
                        if sc == '\\' && i + 1 < n {
                            i += 2;
                        } else if sc == quote {
                            i += 1;
                            break;
                        } else {
                            i += 1;
                        }
                    }
                    continue;
                }
                if c == '(' {
                    depth += 1;
                } else if c == ')' {
                    depth -= 1;
                    if depth == 0 {
                        let args_str: String = chars[args_start..i].iter().collect();
                        methods.push((method_name.clone(), args_str.trim().to_string()));
                        i += 1;
                        break;
                    }
                }
                i += 1;
            }
        } else {
            methods.push((method_name, "".to_string()));
        }
    }

    methods
}

pub async fn collect_mongo_cursor_results(
    cursor: &mut mongodb::Cursor<mongodb::bson::Document>,
    command_type: &str,
    start_time: Instant,
    server_version: Option<String>,
    limit: usize,
) -> Result<QueryResult, String> {
    use futures::StreamExt;
    let mut rows = Vec::new();
    let mut key_order = Vec::new();
    let mut key_types: HashMap<String, String> = HashMap::new();
    let mut count = 0usize;

    while let Some(doc_res) = cursor.next().await {
        if count >= limit {
            break;
        }
        count += 1;
        let doc = doc_res.map_err(|e| format!("MongoDB cursor error: {}", e))?;
        for (k, v) in &doc {
            if !key_types.contains_key(k) {
                if k == "_id" {
                    key_order.insert(0, k.clone());
                } else {
                    key_order.push(k.clone());
                }
                let t_name = match v.element_type() {
                    mongodb::bson::spec::ElementType::ObjectId => "ObjectId".to_string(),
                    mongodb::bson::spec::ElementType::String => "String".to_string(),
                    mongodb::bson::spec::ElementType::Int32 => "Int32".to_string(),
                    mongodb::bson::spec::ElementType::Int64 => "Int64".to_string(),
                    mongodb::bson::spec::ElementType::Double => "Double".to_string(),
                    mongodb::bson::spec::ElementType::Boolean => "Boolean".to_string(),
                    mongodb::bson::spec::ElementType::DateTime => "Date".to_string(),
                    mongodb::bson::spec::ElementType::Array => "Array".to_string(),
                    mongodb::bson::spec::ElementType::EmbeddedDocument => "Document".to_string(),
                    mongodb::bson::spec::ElementType::Null => "Null".to_string(),
                    mongodb::bson::spec::ElementType::Binary => "Binary".to_string(),
                    other => format!("{:?}", other),
                };
                key_types.insert(k.clone(), t_name);
            }
        }
        rows.push(bson_to_clean_json(mongodb::bson::Bson::Document(doc)));
    }

    let columns = if key_order.is_empty() {
        vec![ColumnMeta {
            name: "_id".to_string(),
            data_type: "ObjectId".to_string(),
            nullable: false,
            is_primary_key: true,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        }]
    } else {
        key_order.into_iter().map(|k| {
            let dt = key_types.get(&k).cloned().unwrap_or_else(|| "Field".to_string());
            let is_id = k == "_id";
            ColumnMeta {
                name: k,
                data_type: dt,
                nullable: !is_id,
                is_primary_key: is_id,
                is_foreign_key: false,
                referenced_table: None,
                referenced_column: None,
                default_value: None,
                extra: None,
            }
        }).collect()
    };

    let total = rows.len() as u64;
    Ok(QueryResult {
        columns,
        rows,
        affected_rows: total,
        last_insert_id: None,
        execution_time_ms: start_time.elapsed().as_secs_f64() * 1000.0,
        command_type: command_type.to_string(),
        server_version,
        warnings: Vec::new(),
        all_results: None,
    })
}

pub fn unpack_mongo_command_result(
    doc: mongodb::bson::Document,
    command_type: &str,
    start_time: Instant,
    server_version: Option<String>,
) -> Result<QueryResult, String> {
    if let Ok(cursor_doc) = doc.get_document("cursor") {
        if let Ok(first_batch) = cursor_doc.get_array("firstBatch") {
            let mut rows = Vec::new();
            let mut key_order = Vec::new();
            let mut key_types = HashMap::new();

            for item in first_batch {
                if let Some(item_doc) = item.as_document() {
                    for (k, v) in item_doc {
                        if !key_types.contains_key(k) {
                            if k == "_id" {
                                key_order.insert(0, k.clone());
                            } else {
                                key_order.push(k.clone());
                            }
                            let t_name = match v.element_type() {
                                mongodb::bson::spec::ElementType::ObjectId => "ObjectId".to_string(),
                                mongodb::bson::spec::ElementType::String => "String".to_string(),
                                mongodb::bson::spec::ElementType::Int32 => "Int32".to_string(),
                                mongodb::bson::spec::ElementType::Int64 => "Int64".to_string(),
                                mongodb::bson::spec::ElementType::Double => "Double".to_string(),
                                mongodb::bson::spec::ElementType::Boolean => "Boolean".to_string(),
                                mongodb::bson::spec::ElementType::DateTime => "Date".to_string(),
                                mongodb::bson::spec::ElementType::Array => "Array".to_string(),
                                mongodb::bson::spec::ElementType::EmbeddedDocument => "Document".to_string(),
                                mongodb::bson::spec::ElementType::Null => "Null".to_string(),
                                mongodb::bson::spec::ElementType::Binary => "Binary".to_string(),
                                other => format!("{:?}", other),
                            };
                            key_types.insert(k.clone(), t_name);
                        }
                    }
                    rows.push(bson_to_clean_json(mongodb::bson::Bson::Document(item_doc.clone())));
                } else {
                    rows.push(bson_to_clean_json(item.clone()));
                }
            }

            let columns = if key_order.is_empty() {
                vec![ColumnMeta {
                    name: "result".to_string(),
                    data_type: "Document".to_string(),
                    nullable: true,
                    is_primary_key: false,
                    is_foreign_key: false,
                    referenced_table: None,
                    referenced_column: None,
                    default_value: None,
                    extra: None,
                }]
            } else {
                key_order.into_iter().map(|k| {
                    let dt = key_types.get(&k).cloned().unwrap_or_else(|| "Field".to_string());
                    let is_id = k == "_id";
                    ColumnMeta {
                        name: k,
                        data_type: dt,
                        nullable: !is_id,
                        is_primary_key: is_id,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: None,
                        extra: None,
                    }
                }).collect()
            };

            let count = rows.len() as u64;
            return Ok(QueryResult {
                columns,
                rows,
                affected_rows: count,
                last_insert_id: None,
                execution_time_ms: start_time.elapsed().as_secs_f64() * 1000.0,
                command_type: command_type.to_string(),
                server_version,
                warnings: Vec::new(),
                all_results: None,
            });
        }
    }

    // Unpack databases array from listDatabases command
    if let Ok(db_arr) = doc.get_array("databases") {
        let mut rows = Vec::new();
        for item in db_arr {
            if let Some(item_doc) = item.as_document() {
                rows.push(bson_to_clean_json(mongodb::bson::Bson::Document(item_doc.clone())));
            } else {
                rows.push(bson_to_clean_json(item.clone()));
            }
        }
        let columns = vec![
            ColumnMeta {
                name: "name".to_string(),
                data_type: "String".to_string(),
                nullable: false,
                is_primary_key: true,
                is_foreign_key: false,
                referenced_table: None,
                referenced_column: None,
                default_value: None,
                extra: None,
            },
            ColumnMeta {
                name: "sizeOnDisk".to_string(),
                data_type: "Int64".to_string(),
                nullable: true,
                is_primary_key: false,
                is_foreign_key: false,
                referenced_table: None,
                referenced_column: None,
                default_value: None,
                extra: None,
            },
            ColumnMeta {
                name: "empty".to_string(),
                data_type: "Boolean".to_string(),
                nullable: true,
                is_primary_key: false,
                is_foreign_key: false,
                referenced_table: None,
                referenced_column: None,
                default_value: None,
                extra: None,
            },
        ];
        let count = rows.len() as u64;
        return Ok(QueryResult {
            columns,
            rows,
            affected_rows: count,
            last_insert_id: None,
            execution_time_ms: start_time.elapsed().as_secs_f64() * 1000.0,
            command_type: command_type.to_string(),
            server_version,
            warnings: Vec::new(),
            all_results: None,
        });
    }

    let clean_json = bson_to_clean_json(mongodb::bson::Bson::Document(doc));
    let columns = if let serde_json::Value::Object(ref map) = clean_json {
        map.keys().map(|k| ColumnMeta {
            name: k.clone(),
            data_type: "Field".to_string(),
            nullable: true,
            is_primary_key: k == "_id",
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        }).collect()
    } else {
        vec![ColumnMeta {
            name: "result".to_string(),
            data_type: "Document".to_string(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        }]
    };

    Ok(QueryResult {
        columns,
        rows: vec![clean_json],
        affected_rows: 1,
        last_insert_id: None,
        execution_time_ms: start_time.elapsed().as_secs_f64() * 1000.0,
        command_type: command_type.to_string(),
        server_version,
        warnings: Vec::new(),
        all_results: None,
    })
}

pub async fn execute_mongodb_single_command(
    client: &mongodb::Client,
    database_name: &str,
    raw_query: &str,
    limit_override: usize,
    server_version: Option<String>,
) -> Result<QueryResult, String> {
    let database_name = get_effective_mongo_db(database_name);
    let start = Instant::now();

    // 1. Strip comments outside of string literals
    let clean = strip_js_comments(raw_query).trim().trim_end_matches(';').trim().to_string();
    if clean.is_empty() {
        return Err("MongoDB query is empty".to_string());
    }

    // 2. "use <dbname>" shell command
    let trimmed_clean = clean.trim();
    if trimmed_clean.to_lowercase().starts_with("use ") {
        let after_use = trimmed_clean[4..].trim().trim_end_matches(';').trim();
        let target_db = after_use.trim_matches(|c| c == '\'' || c == '"' || c == '`').trim();
        if target_db.is_empty() {
            return Err("Database name cannot be empty in 'use <db>'".to_string());
        }
        return Ok(QueryResult {
            columns: vec![
                ColumnMeta {
                    name: "status".to_string(),
                    data_type: "String".to_string(),
                    nullable: false,
                    is_primary_key: false,
                    is_foreign_key: false,
                    referenced_table: None,
                    referenced_column: None,
                    default_value: None,
                    extra: None,
                },
                ColumnMeta {
                    name: "database".to_string(),
                    data_type: "String".to_string(),
                    nullable: false,
                    is_primary_key: true,
                    is_foreign_key: false,
                    referenced_table: None,
                    referenced_column: None,
                    default_value: None,
                    extra: None,
                },
            ],
            rows: vec![serde_json::json!({
                "status": format!("switched to db {}", target_db),
                "database": target_db,
            })],
            affected_rows: 1,
            last_insert_id: None,
            execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
            command_type: "MongoDB Use".to_string(),
            server_version,
            warnings: Vec::new(),
            all_results: None,
        });
    }

    // 3. Builtin quick helper commands: show dbs / show collections
    if clean.eq_ignore_ascii_case("show dbs") || clean.eq_ignore_ascii_case("show databases") {
        let db = client.database("admin");
        let res = db.run_command(mongodb::bson::doc! { "listDatabases": 1 }, None).await.map_err(|e| format!("MongoDB error: {}", e))?;
        return unpack_mongo_command_result(res, "MongoDB listDatabases", start, server_version);
    }
    if clean.eq_ignore_ascii_case("show collections") || clean.eq_ignore_ascii_case("show tables") {
        let db = client.database(database_name);
        let colls = db.list_collection_names(None).await.map_err(|e| format!("MongoDB error: {}", e))?;
        let rows: Vec<serde_json::Value> = colls.into_iter().map(|c| serde_json::json!({ "collection": c })).collect();
        let total = rows.len() as u64;
        return Ok(QueryResult {
            columns: vec![ColumnMeta {
                name: "collection".to_string(),
                data_type: "String".to_string(),
                nullable: false,
                is_primary_key: true,
                is_foreign_key: false,
                referenced_table: None,
                referenced_column: None,
                default_value: None,
                extra: None,
            }],
            rows,
            affected_rows: total,
            last_insert_id: None,
            execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
            command_type: "MongoDB Show Collections".to_string(),
            server_version,
            warnings: Vec::new(),
            all_results: None,
        });
    }

    // 4. SQL-like query fallback: SELECT * FROM collection [LIMIT n]
    let upper = clean.to_uppercase();
    if upper.starts_with("SELECT ") {
        if let Some(from_pos) = upper.find(" FROM ") {
            let after_from = clean[from_pos + 6..].trim();
            let tokens: Vec<&str> = after_from.split_whitespace().collect();
            if !tokens.is_empty() {
                let coll_name = tokens[0].trim_matches(|c| c == '`' || c == '\'' || c == '"' || c == ';');
                let mut limit = limit_override as i64;
                for (idx, tok) in tokens.iter().enumerate() {
                    if tok.eq_ignore_ascii_case("LIMIT") && idx + 1 < tokens.len() {
                        if let Ok(l) = tokens[idx + 1].trim_matches(';').parse::<i64>() {
                            limit = l;
                        }
                    }
                }
                let coll = client.database(database_name).collection::<mongodb::bson::Document>(coll_name);
                let find_opts = mongodb::options::FindOptions::builder().limit(Some(limit)).build();
                let mut cursor = coll.find(None, find_opts).await.map_err(|e| format!("MongoDB error: {}", e))?;
                return collect_mongo_cursor_results(&mut cursor, "MongoDB SQL Query", start, server_version, limit_override).await;
            }
        }
    }

    // 5. Raw JSON document / runCommand (e.g. { ping: 1 }, { listCollections: 1 }, { listIndexes: "coll" })
    if clean.starts_with('{') {
        let doc_cmd = parse_relaxed_document(&clean)?;
        let db = client.database(database_name);
        let res = db.run_command(doc_cmd, None).await.map_err(|e| format!("MongoDB command error: {}", e))?;
        return unpack_mongo_command_result(res, "MongoDB Command", start, server_version);
    }

    // 6. Shell syntax: db.<collection>.<method>() or db.getCollection("collection").<method>() or db.<dbMethod>()
    if clean.starts_with("db.") || clean.starts_with("db[") || clean.starts_with("getCollection(") {
        let after_db = if clean.starts_with("db.") {
            clean[3..].trim()
        } else if clean.starts_with("db[") {
            clean[2..].trim()
        } else {
            clean.trim()
        };

        // ── A. Database-level Methods on `db` ──────────────────────────

        // db.runCommand(doc)
        if after_db.starts_with("runCommand(") {
            let inner = extract_paren_args(after_db, "runCommand")?;
            let doc_cmd = parse_relaxed_document(&inner)?;
            let db = client.database(database_name);
            let res = db.run_command(doc_cmd, None).await.map_err(|e| format!("MongoDB runCommand error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB runCommand", start, server_version);
        }

        // db.adminCommand(doc)
        if after_db.starts_with("adminCommand(") {
            let inner = extract_paren_args(after_db, "adminCommand")?;
            let doc_cmd = parse_relaxed_document(&inner)?;
            let db = client.database("admin");
            let res = db.run_command(doc_cmd, None).await.map_err(|e| format!("MongoDB adminCommand error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB adminCommand", start, server_version);
        }

        // db.createCollection("name", options)
        if after_db.starts_with("createCollection(") {
            let inner = extract_paren_args(after_db, "createCollection")?;
            let args = split_top_level_args(&inner);
            if args.is_empty() {
                return Err("createCollection requires collection name, e.g. db.createCollection(\"name\")".to_string());
            }
            let coll_name = args[0].trim().trim_matches(|c| c == '\'' || c == '"' || c == '`');
            let mut cmd = mongodb::bson::Document::new();
            cmd.insert("create", coll_name);
            if args.len() >= 2 && !args[1].trim().is_empty() {
                let opts = parse_relaxed_document(&args[1])?;
                for (k, v) in opts {
                    let tk = k.trim().to_string();
                    if tk != "create" {
                        cmd.insert(tk, v);
                    }
                }
            }
            let db = client.database(database_name);
            let res = db.run_command(cmd, None).await.map_err(|e| format!("MongoDB error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB CreateCollection", start, server_version);
        }

        // db.createView("viewName", "viewOn", pipeline, options)
        if after_db.starts_with("createView(") {
            let inner = extract_paren_args(after_db, "createView")?;
            let args = split_top_level_args(&inner);
            if args.len() < 3 {
                return Err("createView requires (viewName, viewOn, pipeline) arguments".to_string());
            }
            let view_name = args[0].trim().trim_matches(|c| c == '\'' || c == '"' || c == '`');
            let view_on = args[1].trim().trim_matches(|c| c == '\'' || c == '"' || c == '`');
            let pipeline_json = relax_to_strict_json(&args[2]);
            let pipeline_val: serde_json::Value = serde_json::from_str(&pipeline_json)
                .map_err(|e| format!("Invalid createView pipeline: {}", e))?;
            let pipeline_bson = match json_to_bson_value(pipeline_val) {
                mongodb::bson::Bson::Array(arr) => arr,
                _ => return Err("createView pipeline must be an array of stages".to_string()),
            };
            let mut cmd = mongodb::bson::Document::new();
            cmd.insert("create", view_name);
            cmd.insert("viewOn", view_on);
            cmd.insert("pipeline", pipeline_bson);
            if args.len() >= 4 && !args[3].trim().is_empty() {
                let opts = parse_relaxed_document(&args[3])?;
                for (k, v) in opts {
                    let tk = k.trim().to_string();
                    if tk != "create" && tk != "viewOn" && tk != "pipeline" {
                        cmd.insert(tk, v);
                    }
                }
            }
            let db = client.database(database_name);
            let res = db.run_command(cmd, None).await.map_err(|e| format!("MongoDB error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB CreateView", start, server_version);
        }

        // db.validateCollection("collName", options)
        if after_db.starts_with("validateCollection(") {
            let inner = extract_paren_args(after_db, "validateCollection")?;
            let args = split_top_level_args(&inner);
            if args.is_empty() {
                return Err("validateCollection requires collection name, e.g. db.validateCollection(\"name\")".to_string());
            }
            let target_coll = args[0].trim().trim_matches(|c| c == '\'' || c == '"' || c == '`');
            let mut cmd = mongodb::bson::Document::new();
            cmd.insert("validate", target_coll);
            if args.len() >= 2 && !args[1].trim().is_empty() {
                let opt_str = args[1].trim();
                if opt_str == "true" {
                    cmd.insert("full", true);
                } else if opt_str == "false" {
                    cmd.insert("full", false);
                } else if let Ok(doc) = parse_relaxed_document(opt_str) {
                    for (k, v) in doc {
                        let tk = k.trim().to_string();
                        if tk != "validate" {
                            cmd.insert(tk, v);
                        }
                    }
                }
            }
            let db = client.database(database_name);
            let res = db.run_command(cmd, None).await.map_err(|e| format!("MongoDB validate error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB ValidateCollection", start, server_version);
        }

        // db.currentOp(options)
        if after_db.starts_with("currentOp(") || after_db == "currentOp" {
            let admin_db = client.database("admin");
            let mut cmd = mongodb::bson::doc! { "currentOp": 1 };
            if after_db.starts_with("currentOp(") {
                let inner = extract_paren_args(after_db, "currentOp")?;
                if !inner.trim().is_empty() {
                    if let Ok(doc) = parse_relaxed_document(&inner) {
                        for (k, v) in doc {
                            let tk = k.trim().to_string();
                            if tk != "currentOp" { cmd.insert(tk, v); }
                        }
                    }
                }
            }
            let res = admin_db.run_command(cmd, None).await.map_err(|e| format!("MongoDB currentOp error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB CurrentOp", start, server_version);
        }

        // db.killOp(opid)
        if after_db.starts_with("killOp(") {
            let inner = extract_paren_args(after_db, "killOp")?;
            let opid_str = inner.trim().trim_matches(|c| c == '\'' || c == '"' || c == '`');
            let opid: i64 = opid_str.parse().map_err(|_| "killOp requires numeric opid, e.g. db.killOp(12345)".to_string())?;
            let admin_db = client.database("admin");
            let res = admin_db.run_command(mongodb::bson::doc! { "killOp": 1, "op": opid }, None).await.map_err(|e| format!("MongoDB killOp error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB KillOp", start, server_version);
        }

        // db.fsyncLock()
        if after_db.starts_with("fsyncLock(") || after_db == "fsyncLock" {
            let admin_db = client.database("admin");
            let res = admin_db.run_command(mongodb::bson::doc! { "fsync": 1, "lock": true }, None).await.map_err(|e| format!("MongoDB fsyncLock error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB FsyncLock", start, server_version);
        }

        // db.fsyncUnlock()
        if after_db.starts_with("fsyncUnlock(") || after_db == "fsyncUnlock" {
            let admin_db = client.database("admin");
            let res = admin_db.run_command(mongodb::bson::doc! { "fsyncUnlock": 1 }, None).await.map_err(|e| format!("MongoDB fsyncUnlock error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB FsyncUnlock", start, server_version);
        }

        // db.repairDatabase()
        if after_db.starts_with("repairDatabase(") || after_db == "repairDatabase" {
            let db = client.database(database_name);
            let res = db.run_command(mongodb::bson::doc! { "repairDatabase": 1 }, None).await.map_err(|e| format!("MongoDB repairDatabase error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB RepairDatabase", start, server_version);
        }

        // db.hostInfo()
        if after_db.starts_with("hostInfo(") || after_db == "hostInfo" {
            let admin_db = client.database("admin");
            let res = admin_db.run_command(mongodb::bson::doc! { "hostInfo": 1 }, None).await.map_err(|e| format!("MongoDB hostInfo error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB HostInfo", start, server_version);
        }

        // db.buildInfo() or db.serverBuildInfo()
        if after_db.starts_with("buildInfo(") || after_db == "buildInfo"
            || after_db.starts_with("serverBuildInfo(") || after_db == "serverBuildInfo" {
            let admin_db = client.database("admin");
            let res = admin_db.run_command(mongodb::bson::doc! { "buildInfo": 1 }, None).await.map_err(|e| format!("MongoDB buildInfo error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB BuildInfo", start, server_version);
        }

        // db.hello() or db.isMaster()
        if after_db.starts_with("hello(") || after_db == "hello"
            || after_db.starts_with("isMaster(") || after_db == "isMaster" {
            let admin_db = client.database("admin");
            let res = admin_db.run_command(mongodb::bson::doc! { "hello": 1 }, None).await.map_err(|e| format!("MongoDB hello error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB Hello", start, server_version);
        }

        // db.listCommands()
        if after_db.starts_with("listCommands(") || after_db == "listCommands" {
            let admin_db = client.database("admin");
            let res = admin_db.run_command(mongodb::bson::doc! { "listCommands": 1 }, None).await.map_err(|e| format!("MongoDB listCommands error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB ListCommands", start, server_version);
        }

        // db.rotateLogs()
        if after_db.starts_with("rotateLogs(") || after_db == "rotateLogs" {
            let admin_db = client.database("admin");
            let res = admin_db.run_command(mongodb::bson::doc! { "logRotate": 1 }, None).await.map_err(|e| format!("MongoDB logRotate error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB LogRotate", start, server_version);
        }

        // db.getProfilingStatus()
        if after_db.starts_with("getProfilingStatus(") || after_db == "getProfilingStatus" {
            let db = client.database(database_name);
            let res = db.run_command(mongodb::bson::doc! { "profile": -1 }, None).await.map_err(|e| format!("MongoDB getProfilingStatus error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB ProfilingStatus", start, server_version);
        }

        // db.setProfilingLevel(level, slowms)
        if after_db.starts_with("setProfilingLevel(") {
            let inner = extract_paren_args(after_db, "setProfilingLevel")?;
            let args = split_top_level_args(&inner);
            let level: i32 = args.get(0).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
            let slowms: i32 = args.get(1).and_then(|v| v.trim().parse().ok()).unwrap_or(100);
            let db = client.database(database_name);
            let res = db.run_command(mongodb::bson::doc! { "profile": level, "slowms": slowms }, None).await.map_err(|e| format!("MongoDB setProfilingLevel error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB SetProfilingLevel", start, server_version);
        }

        // db.dropDatabase()
        if after_db.starts_with("dropDatabase(") || after_db == "dropDatabase" {
            let db = client.database(database_name);
            db.drop(None).await.map_err(|e| format!("MongoDB dropDatabase error: {}", e))?;
            return Ok(QueryResult {
                columns: vec![
                    ColumnMeta {
                        name: "dropped".to_string(),
                        data_type: "String".to_string(),
                        nullable: false,
                        is_primary_key: true,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: None,
                        extra: None,
                    },
                    ColumnMeta {
                        name: "status".to_string(),
                        data_type: "String".to_string(),
                        nullable: false,
                        is_primary_key: false,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: None,
                        extra: None,
                    },
                ],
                rows: vec![serde_json::json!({
                    "dropped": database_name,
                    "status": "Database dropped successfully"
                })],
                affected_rows: 1,
                last_insert_id: None,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                command_type: "MongoDB DropDatabase".to_string(),
                server_version,
                warnings: Vec::new(),
                all_results: None,
            });
        }

        // db.stats()
        if after_db.starts_with("stats(") || after_db == "stats" {
            let db = client.database(database_name);
            let res = db.run_command(mongodb::bson::doc! { "dbStats": 1 }, None).await.map_err(|e| format!("MongoDB stats error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB Stats", start, server_version);
        }

        // db.getCollectionNames() or db.getCollectionInfos()
        if after_db.starts_with("getCollectionNames(") || after_db == "getCollectionNames"
            || after_db.starts_with("getCollectionInfos(") || after_db == "getCollectionInfos" {
            let db = client.database(database_name);
            let colls = db.list_collection_names(None).await.map_err(|e| format!("MongoDB error: {}", e))?;
            let rows: Vec<serde_json::Value> = colls.into_iter().map(|c| serde_json::json!({ "collection": c })).collect();
            let total = rows.len() as u64;
            return Ok(QueryResult {
                columns: vec![ColumnMeta {
                    name: "collection".to_string(),
                    data_type: "String".to_string(),
                    nullable: false,
                    is_primary_key: true,
                    is_foreign_key: false,
                    referenced_table: None,
                    referenced_column: None,
                    default_value: None,
                    extra: None,
                }],
                rows,
                affected_rows: total,
                last_insert_id: None,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                command_type: "MongoDB getCollectionNames".to_string(),
                server_version,
                warnings: Vec::new(),
                all_results: None,
            });
        }

        // db.serverStatus()
        if after_db.starts_with("serverStatus(") || after_db == "serverStatus" {
            let db = client.database("admin");
            let res = db.run_command(mongodb::bson::doc! { "serverStatus": 1 }, None).await.map_err(|e| format!("MongoDB serverStatus error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB ServerStatus", start, server_version);
        }

        // db.getName()
        if after_db.starts_with("getName(") || after_db == "getName" {
            return Ok(QueryResult {
                columns: vec![ColumnMeta {
                    name: "database".to_string(),
                    data_type: "String".to_string(),
                    nullable: false,
                    is_primary_key: true,
                    is_foreign_key: false,
                    referenced_table: None,
                    referenced_column: None,
                    default_value: None,
                    extra: None,
                }],
                rows: vec![serde_json::json!({ "database": database_name })],
                affected_rows: 1,
                last_insert_id: None,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                command_type: "MongoDB getName".to_string(),
                server_version,
                warnings: Vec::new(),
                all_results: None,
            });
        }

        // db.version()
        if after_db.starts_with("version(") || after_db == "version" {
            let db = client.database("admin");
            let res = db.run_command(mongodb::bson::doc! { "buildInfo": 1 }, None).await.map_err(|e| format!("MongoDB version error: {}", e))?;
            return unpack_mongo_command_result(res, "MongoDB Version", start, server_version);
        }

        // ── B. Collection-level Methods on `db.<coll>` ─────────────────

        // Determine collection name and remaining method chain:
        let (coll_name, rest) = if after_db.starts_with("getCollection(") {
            let inner = after_db[14..].trim();
            let quote = if inner.starts_with('"') || inner.starts_with('\'') || inner.starts_with('`') {
                inner.chars().next().unwrap()
            } else {
                ')'
            };
            let coll = if quote == ')' {
                inner.split(')').next().unwrap_or("").trim()
            } else {
                inner[1..].split(quote).next().unwrap_or("").trim()
            };
            let rem_idx = after_db.find(')').map(|p| p + 1).unwrap_or(after_db.len());
            (coll.to_string(), after_db[rem_idx..].trim_start_matches('.'))
        } else if after_db.starts_with('[') {
            // db["coll"] or db['coll']
            let inner = after_db[1..].trim();
            let quote = if inner.starts_with('"') || inner.starts_with('\'') || inner.starts_with('`') {
                inner.chars().next().unwrap()
            } else {
                ']'
            };
            let coll = if quote == ']' {
                inner.split(']').next().unwrap_or("").trim()
            } else {
                inner[1..].split(quote).next().unwrap_or("").trim()
            };
            let rem_idx = after_db.find(']').map(|p| p + 1).unwrap_or(after_db.len());
            (coll.to_string(), after_db[rem_idx..].trim_start_matches('.'))
        } else {
            // Standard dotted syntax, e.g. system.users.find({}).limit(50) or curd.find({})
            if let Some(first_paren) = after_db.find('(') {
                let before_paren = after_db[..first_paren].trim_end();
                if let Some(dot_idx) = before_paren.rfind('.') {
                    let coll = before_paren[..dot_idx].trim().to_string();
                    let rest = &after_db[dot_idx..];
                    (coll, rest)
                } else {
                    (after_db.trim().to_string(), "")
                }
            } else {
                // No parenthesis, e.g. db.system.users
                (after_db.trim().to_string(), "")
            }
        };

        if coll_name.is_empty() {
            return Err("MongoDB collection name could not be determined".to_string());
        }

        let methods = parse_method_calls(rest);
        if methods.is_empty() {
            let coll = client.database(database_name).collection::<mongodb::bson::Document>(&coll_name);
            let find_opts = mongodb::options::FindOptions::builder().limit(Some(limit_override as i64)).build();
            let mut cursor = coll.find(None, find_opts).await.map_err(|e| format!("MongoDB error: {}", e))?;
            return collect_mongo_cursor_results(&mut cursor, "MongoDB Find", start, server_version, limit_override).await;
        }

        let primary_method = &methods[0].0;
        let primary_args = &methods[0].1;
        let coll = client.database(database_name).collection::<mongodb::bson::Document>(&coll_name);

        match primary_method.as_str() {
            "find" => {
                let filter_doc = parse_relaxed_document(primary_args)?;
                let mut find_opts = mongodb::options::FindOptions::default();
                let mut limit = limit_override as i64;
                let mut skip = None;
                let mut sort = None;
                let mut projection = None;

                for (m_name, m_args) in &methods[1..] {
                    match m_name.as_str() {
                        "limit" => {
                            if let Ok(l) = m_args.trim().parse::<i64>() {
                                limit = l;
                            }
                        }
                        "skip" => {
                            if let Ok(s) = m_args.trim().parse::<u64>() {
                                skip = Some(s);
                            }
                        }
                        "sort" => {
                            if let Ok(s_doc) = parse_relaxed_document(m_args) {
                                sort = Some(s_doc);
                            }
                        }
                        "project" | "projection" => {
                            if let Ok(p_doc) = parse_relaxed_document(m_args) {
                                projection = Some(p_doc);
                            }
                        }
                        _ => {}
                    }
                }

                find_opts.limit = Some(limit);
                find_opts.skip = skip;
                find_opts.sort = sort;
                find_opts.projection = projection;

                let mut cursor = coll.find(filter_doc, find_opts).await.map_err(|e| format!("MongoDB find error: {}", e))?;
                return collect_mongo_cursor_results(&mut cursor, "MongoDB Find", start, server_version, limit as usize).await;
            }

            "findOne" => {
                let filter_doc = parse_relaxed_document(primary_args)?;
                let doc_opt = coll.find_one(filter_doc, None).await.map_err(|e| format!("MongoDB findOne error: {}", e))?;
                if let Some(doc) = doc_opt {
                    return unpack_mongo_command_result(doc, "MongoDB findOne", start, server_version);
                } else {
                    return Ok(QueryResult {
                        columns: vec![ColumnMeta {
                            name: "result".to_string(),
                            data_type: "Document".to_string(),
                            nullable: true,
                            is_primary_key: false,
                            is_foreign_key: false,
                            referenced_table: None,
                            referenced_column: None,
                            default_value: None,
                            extra: None,
                        }],
                        rows: Vec::new(),
                        affected_rows: 0,
                        last_insert_id: None,
                        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                        command_type: "MongoDB findOne".to_string(),
                        server_version,
                        warnings: Vec::new(),
                        all_results: None,
                    });
                }
            }

            "aggregate" => {
                let pipeline = if primary_args.trim().starts_with('[') {
                    let strict = relax_to_strict_json(primary_args);
                    let val: serde_json::Value = serde_json::from_str(&strict)
                        .map_err(|e| format!("Invalid MongoDB aggregate pipeline: {}", e))?;
                    if let serde_json::Value::Array(items) = val {
                        let mut docs = Vec::new();
                        for item in items {
                            docs.push(json_to_bson_document(item)?);
                        }
                        docs
                    } else {
                        Vec::new()
                    }
                } else {
                    vec![parse_relaxed_document(primary_args)?]
                };

                let mut cursor = coll.aggregate(pipeline, None).await.map_err(|e| format!("MongoDB aggregate error: {}", e))?;
                return collect_mongo_cursor_results(&mut cursor, "MongoDB Aggregate", start, server_version, limit_override).await;
            }

            "countDocuments" | "count" => {
                let filter_doc = parse_relaxed_document(primary_args)?;
                let count = coll.count_documents(filter_doc, None).await.map_err(|e| format!("MongoDB count error: {}", e))?;
                return Ok(QueryResult {
                    columns: vec![ColumnMeta {
                        name: "count".to_string(),
                        data_type: "Int64".to_string(),
                        nullable: false,
                        is_primary_key: false,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: None,
                        extra: None,
                    }],
                    rows: vec![serde_json::json!({ "count": count })],
                    affected_rows: count,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB Count".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "estimatedDocumentCount" => {
                let count = coll.estimated_document_count(None).await.map_err(|e| format!("MongoDB estimatedDocumentCount error: {}", e))?;
                return Ok(QueryResult {
                    columns: vec![ColumnMeta {
                        name: "count".to_string(),
                        data_type: "Int64".to_string(),
                        nullable: false,
                        is_primary_key: false,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: None,
                        extra: None,
                    }],
                    rows: vec![serde_json::json!({ "count": count })],
                    affected_rows: count,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB EstimatedDocumentCount".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "distinct" => {
                let args = split_top_level_args(primary_args);
                if args.is_empty() {
                    return Err("distinct requires field name argument, e.g. distinct(\"field\")".to_string());
                }
                let field = args[0].trim().trim_matches(|c| c == '\'' || c == '"' || c == '`');
                let filter_doc = if args.len() > 1 && !args[1].trim().is_empty() {
                    Some(parse_relaxed_document(&args[1])?)
                } else {
                    None
                };
                let vals = coll.distinct(field, filter_doc, None).await.map_err(|e| format!("MongoDB distinct error: {}", e))?;
                let rows: Vec<serde_json::Value> = vals.into_iter().map(bson_to_clean_json).map(|v| serde_json::json!({ "value": v })).collect();
                let count = rows.len() as u64;
                return Ok(QueryResult {
                    columns: vec![ColumnMeta {
                        name: "value".to_string(),
                        data_type: "Field".to_string(),
                        nullable: true,
                        is_primary_key: false,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: None,
                        extra: None,
                    }],
                    rows,
                    affected_rows: count,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB Distinct".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "insertOne" => {
                let doc = parse_relaxed_document(primary_args)?;
                let res = coll.insert_one(doc, None).await.map_err(|e| format!("MongoDB insertOne error: {}", e))?;
                let clean_id = bson_to_clean_json(res.inserted_id);
                return Ok(QueryResult {
                    columns: vec![ColumnMeta {
                        name: "inserted_id".to_string(),
                        data_type: "ObjectId".to_string(),
                        nullable: false,
                        is_primary_key: true,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: None,
                        extra: None,
                    }],
                    rows: vec![serde_json::json!({ "inserted_id": clean_id })],
                    affected_rows: 1,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB Insert".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "insertMany" => {
                let strict = relax_to_strict_json(primary_args);
                let val: serde_json::Value = serde_json::from_str(&strict)
                    .map_err(|e| format!("Invalid MongoDB insertMany array: {}", e))?;
                let docs = if let serde_json::Value::Array(items) = val {
                    let mut docs = Vec::new();
                    for item in items {
                        docs.push(json_to_bson_document(item)?);
                    }
                    docs
                } else {
                    return Err("insertMany requires an array of documents".to_string());
                };
                let count = docs.len() as u64;
                let res = coll.insert_many(docs, None).await.map_err(|e| format!("MongoDB insertMany error: {}", e))?;
                let mut rows = Vec::new();
                for (idx, id) in res.inserted_ids {
                    rows.push(serde_json::json!({ "index": idx, "inserted_id": bson_to_clean_json(id) }));
                }
                return Ok(QueryResult {
                    columns: vec![
                        ColumnMeta {
                            name: "index".to_string(),
                            data_type: "Int32".to_string(),
                            nullable: false,
                            is_primary_key: false,
                            is_foreign_key: false,
                            referenced_table: None,
                            referenced_column: None,
                            default_value: None,
                            extra: None,
                        },
                        ColumnMeta {
                            name: "inserted_id".to_string(),
                            data_type: "ObjectId".to_string(),
                            nullable: false,
                            is_primary_key: true,
                            is_foreign_key: false,
                            referenced_table: None,
                            referenced_column: None,
                            default_value: None,
                            extra: None,
                        },
                    ],
                    rows,
                    affected_rows: count,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB InsertMany".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "updateOne" => {
                let args = split_top_level_args(primary_args);
                if args.len() < 2 {
                    return Err("updateOne requires (filter, update) arguments".to_string());
                }
                let filter_doc = parse_relaxed_document(&args[0])?;
                let update_doc = parse_relaxed_document(&args[1])?;
                let res = coll.update_one(filter_doc, update_doc, None).await.map_err(|e| format!("MongoDB updateOne error: {}", e))?;
                return Ok(QueryResult {
                    columns: vec![
                        ColumnMeta {
                            name: "matched_count".to_string(),
                            data_type: "Int64".to_string(),
                            nullable: false,
                            is_primary_key: false,
                            is_foreign_key: false,
                            referenced_table: None,
                            referenced_column: None,
                            default_value: None,
                            extra: None,
                        },
                        ColumnMeta {
                            name: "modified_count".to_string(),
                            data_type: "Int64".to_string(),
                            nullable: false,
                            is_primary_key: false,
                            is_foreign_key: false,
                            referenced_table: None,
                            referenced_column: None,
                            default_value: None,
                            extra: None,
                        },
                    ],
                    rows: vec![serde_json::json!({ "matched_count": res.matched_count, "modified_count": res.modified_count })],
                    affected_rows: res.modified_count,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB Update".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "updateMany" => {
                let args = split_top_level_args(primary_args);
                if args.len() < 2 {
                    return Err("updateMany requires (filter, update) arguments".to_string());
                }
                let filter_doc = parse_relaxed_document(&args[0])?;
                let update_doc = parse_relaxed_document(&args[1])?;
                let res = coll.update_many(filter_doc, update_doc, None).await.map_err(|e| format!("MongoDB updateMany error: {}", e))?;
                return Ok(QueryResult {
                    columns: vec![
                        ColumnMeta {
                            name: "matched_count".to_string(),
                            data_type: "Int64".to_string(),
                            nullable: false,
                            is_primary_key: false,
                            is_foreign_key: false,
                            referenced_table: None,
                            referenced_column: None,
                            default_value: None,
                            extra: None,
                        },
                        ColumnMeta {
                            name: "modified_count".to_string(),
                            data_type: "Int64".to_string(),
                            nullable: false,
                            is_primary_key: false,
                            is_foreign_key: false,
                            referenced_table: None,
                            referenced_column: None,
                            default_value: None,
                            extra: None,
                        },
                    ],
                    rows: vec![serde_json::json!({ "matched_count": res.matched_count, "modified_count": res.modified_count })],
                    affected_rows: res.modified_count,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB UpdateMany".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "replaceOne" => {
                let args = split_top_level_args(primary_args);
                if args.len() < 2 {
                    return Err("replaceOne requires (filter, replacement) arguments".to_string());
                }
                let filter_doc = parse_relaxed_document(&args[0])?;
                let replacement_doc = parse_relaxed_document(&args[1])?;
                let res = coll.replace_one(filter_doc, replacement_doc, None).await.map_err(|e| format!("MongoDB replaceOne error: {}", e))?;
                return Ok(QueryResult {
                    columns: vec![
                        ColumnMeta {
                            name: "matched_count".to_string(),
                            data_type: "Int64".to_string(),
                            nullable: false,
                            is_primary_key: false,
                            is_foreign_key: false,
                            referenced_table: None,
                            referenced_column: None,
                            default_value: None,
                            extra: None,
                        },
                        ColumnMeta {
                            name: "modified_count".to_string(),
                            data_type: "Int64".to_string(),
                            nullable: false,
                            is_primary_key: false,
                            is_foreign_key: false,
                            referenced_table: None,
                            referenced_column: None,
                            default_value: None,
                            extra: None,
                        },
                    ],
                    rows: vec![serde_json::json!({ "matched_count": res.matched_count, "modified_count": res.modified_count })],
                    affected_rows: res.modified_count,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB ReplaceOne".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "deleteOne" => {
                let filter_doc = parse_relaxed_document(primary_args)?;
                let res = coll.delete_one(filter_doc, None).await.map_err(|e| format!("MongoDB deleteOne error: {}", e))?;
                return Ok(QueryResult {
                    columns: vec![ColumnMeta {
                        name: "deleted_count".to_string(),
                        data_type: "Int64".to_string(),
                        nullable: false,
                        is_primary_key: false,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: None,
                        extra: None,
                    }],
                    rows: vec![serde_json::json!({ "deleted_count": res.deleted_count })],
                    affected_rows: res.deleted_count,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB Delete".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "deleteMany" => {
                let filter_doc = parse_relaxed_document(primary_args)?;
                let res = coll.delete_many(filter_doc, None).await.map_err(|e| format!("MongoDB deleteMany error: {}", e))?;
                return Ok(QueryResult {
                    columns: vec![ColumnMeta {
                        name: "deleted_count".to_string(),
                        data_type: "Int64".to_string(),
                        nullable: false,
                        is_primary_key: false,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: None,
                        extra: None,
                    }],
                    rows: vec![serde_json::json!({ "deleted_count": res.deleted_count })],
                    affected_rows: res.deleted_count,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB DeleteMany".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "drop" => {
                coll.drop(None).await.map_err(|e| format!("MongoDB drop error: {}", e))?;
                return Ok(QueryResult {
                    columns: vec![ColumnMeta {
                        name: "status".to_string(),
                        data_type: "String".to_string(),
                        nullable: false,
                        is_primary_key: false,
                        is_foreign_key: false,
                        referenced_table: None,
                        referenced_column: None,
                        default_value: None,
                        extra: None,
                    }],
                    rows: vec![serde_json::json!({ "status": "Collection dropped successfully" })],
                    affected_rows: 1,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB Drop".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "createIndex" | "createIndexes" => {
                let doc = parse_relaxed_document(primary_args)?;
                let db = client.database(database_name);
                let res = db.run_command(mongodb::bson::doc! {
                    "createIndexes": &coll_name,
                    "indexes": [
                        mongodb::bson::doc! {
                            "key": doc,
                            "name": "idx_custom"
                        }
                    ]
                }, None).await.map_err(|e| format!("MongoDB createIndex error: {}", e))?;
                return unpack_mongo_command_result(res, "MongoDB CreateIndex", start, server_version);
            }

            "dropIndex" | "dropIndexes" => {
                let idx_name = primary_args.trim().trim_matches(|c| c == '\'' || c == '"' || c == '`');
                let db = client.database(database_name);
                let res = db.run_command(mongodb::bson::doc! {
                    "dropIndexes": &coll_name,
                    "index": idx_name
                }, None).await.map_err(|e| format!("MongoDB dropIndex error: {}", e))?;
                return unpack_mongo_command_result(res, "MongoDB DropIndex", start, server_version);
            }

            "getIndexes" | "indexes" => {
                let db = client.database(database_name);
                let res = db.run_command(mongodb::bson::doc! {
                    "listIndexes": &coll_name
                }, None).await.map_err(|e| format!("MongoDB listIndexes error: {}", e))?;
                return unpack_mongo_command_result(res, "MongoDB ListIndexes", start, server_version);
            }

            "stats" => {
                let db = client.database(database_name);
                let res = db.run_command(mongodb::bson::doc! {
                    "collStats": &coll_name
                }, None).await.map_err(|e| format!("MongoDB collStats error: {}", e))?;
                return unpack_mongo_command_result(res, "MongoDB CollStats", start, server_version);
            }

            "validate" => {
                let mut cmd = mongodb::bson::Document::new();
                cmd.insert("validate", &coll_name);
                let trimmed_args = primary_args.trim();
                if trimmed_args == "true" {
                    cmd.insert("full", true);
                } else if trimmed_args == "false" {
                    cmd.insert("full", false);
                } else if !trimmed_args.is_empty() {
                    if let Ok(doc) = parse_relaxed_document(trimmed_args) {
                        for (k, v) in doc {
                            let tk = k.trim().to_string();
                            if tk != "validate" {
                                cmd.insert(tk, v);
                            }
                        }
                    }
                }
                let db = client.database(database_name);
                let res = db.run_command(cmd, None).await.map_err(|e| format!("MongoDB validate error: {}", e))?;
                return unpack_mongo_command_result(res, "MongoDB Validate", start, server_version);
            }

            "bulkWrite" => {
                let args = split_top_level_args(primary_args);
                if args.is_empty() {
                    return Err("bulkWrite requires an array of operations".to_string());
                }
                let strict = relax_to_strict_json(&args[0]);
                let val: serde_json::Value = serde_json::from_str(&strict)
                    .map_err(|e| format!("Invalid bulkWrite array: {}", e))?;
                let ops = match val {
                    serde_json::Value::Array(arr) => arr,
                    _ => return Err("bulkWrite operations must be an array".to_string()),
                };

                let mut inserted_count = 0u64;
                let mut matched_count = 0u64;
                let mut modified_count = 0u64;
                let mut deleted_count = 0u64;
                let mut upserted_count = 0u64;
                let mut errors = Vec::new();

                for (idx, op_val) in ops.into_iter().enumerate() {
                    if let serde_json::Value::Object(map) = op_val {
                        for (op_name, op_body) in map {
                            let op_trimmed = op_name.trim();
                            match op_trimmed {
                                "insertOne" => {
                                    let doc_val = op_body.get("document").cloned().unwrap_or(op_body.clone());
                                    match json_to_bson_document(doc_val) {
                                        Ok(d) => match coll.insert_one(d, None).await {
                                            Ok(_) => inserted_count += 1,
                                            Err(e) => errors.push(format!("Op {}: insertOne error: {}", idx, e)),
                                        },
                                        Err(e) => errors.push(format!("Op {}: invalid document: {}", idx, e)),
                                    }
                                }
                                "updateOne" => {
                                    let filter = op_body.get("filter").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                                    let update = op_body.get("update").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                                    let upsert = op_body.get("upsert").and_then(|v| v.as_bool()).unwrap_or(false);
                                    let opts = mongodb::options::UpdateOptions::builder().upsert(Some(upsert)).build();
                                    match (json_to_bson_document(filter), json_to_bson_document(update)) {
                                        (Ok(f), Ok(u)) => match coll.update_one(f, u, opts).await {
                                            Ok(res) => {
                                                matched_count += res.matched_count;
                                                modified_count += res.modified_count;
                                                if res.upserted_id.is_some() {
                                                    upserted_count += 1;
                                                }
                                            }
                                            Err(e) => errors.push(format!("Op {}: updateOne error: {}", idx, e)),
                                        },
                                        (Err(e), _) | (_, Err(e)) => errors.push(format!("Op {}: {}", idx, e)),
                                    }
                                }
                                "updateMany" => {
                                    let filter = op_body.get("filter").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                                    let update = op_body.get("update").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                                    let upsert = op_body.get("upsert").and_then(|v| v.as_bool()).unwrap_or(false);
                                    let opts = mongodb::options::UpdateOptions::builder().upsert(Some(upsert)).build();
                                    match (json_to_bson_document(filter), json_to_bson_document(update)) {
                                        (Ok(f), Ok(u)) => match coll.update_many(f, u, opts).await {
                                            Ok(res) => {
                                                matched_count += res.matched_count;
                                                modified_count += res.modified_count;
                                                if res.upserted_id.is_some() {
                                                    upserted_count += 1;
                                                }
                                            }
                                            Err(e) => errors.push(format!("Op {}: updateMany error: {}", idx, e)),
                                        },
                                        (Err(e), _) | (_, Err(e)) => errors.push(format!("Op {}: {}", idx, e)),
                                    }
                                }
                                "deleteOne" => {
                                    let filter = op_body.get("filter").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                                    match json_to_bson_document(filter) {
                                        Ok(f) => match coll.delete_one(f, None).await {
                                            Ok(res) => deleted_count += res.deleted_count,
                                            Err(e) => errors.push(format!("Op {}: deleteOne error: {}", idx, e)),
                                        },
                                        Err(e) => errors.push(format!("Op {}: {}", idx, e)),
                                    }
                                }
                                "deleteMany" => {
                                    let filter = op_body.get("filter").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                                    match json_to_bson_document(filter) {
                                        Ok(f) => match coll.delete_many(f, None).await {
                                            Ok(res) => deleted_count += res.deleted_count,
                                            Err(e) => errors.push(format!("Op {}: deleteMany error: {}", idx, e)),
                                        },
                                        Err(e) => errors.push(format!("Op {}: {}", idx, e)),
                                    }
                                }
                                "replaceOne" => {
                                    let filter = op_body.get("filter").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                                    let replacement = op_body.get("replacement").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
                                    let upsert = op_body.get("upsert").and_then(|v| v.as_bool()).unwrap_or(false);
                                    let opts = mongodb::options::ReplaceOptions::builder().upsert(Some(upsert)).build();
                                    match (json_to_bson_document(filter), json_to_bson_document(replacement)) {
                                        (Ok(f), Ok(r)) => match coll.replace_one(f, r, opts).await {
                                            Ok(res) => {
                                                matched_count += res.matched_count;
                                                modified_count += res.modified_count;
                                                if res.upserted_id.is_some() {
                                                    upserted_count += 1;
                                                }
                                            }
                                            Err(e) => errors.push(format!("Op {}: replaceOne error: {}", idx, e)),
                                        },
                                        (Err(e), _) | (_, Err(e)) => errors.push(format!("Op {}: {}", idx, e)),
                                    }
                                }
                                unk => {
                                    errors.push(format!("Op {}: unknown bulk operation '{}'", idx, unk));
                                }
                            }
                        }
                    }
                }

                let total_affected = inserted_count + modified_count + deleted_count + upserted_count;
                return Ok(QueryResult {
                    columns: vec![
                        ColumnMeta { name: "inserted_count".to_string(), data_type: "Int64".to_string(), nullable: false, is_primary_key: false, is_foreign_key: false, referenced_table: None, referenced_column: None, default_value: None, extra: None },
                        ColumnMeta { name: "matched_count".to_string(), data_type: "Int64".to_string(), nullable: false, is_primary_key: false, is_foreign_key: false, referenced_table: None, referenced_column: None, default_value: None, extra: None },
                        ColumnMeta { name: "modified_count".to_string(), data_type: "Int64".to_string(), nullable: false, is_primary_key: false, is_foreign_key: false, referenced_table: None, referenced_column: None, default_value: None, extra: None },
                        ColumnMeta { name: "deleted_count".to_string(), data_type: "Int64".to_string(), nullable: false, is_primary_key: false, is_foreign_key: false, referenced_table: None, referenced_column: None, default_value: None, extra: None },
                        ColumnMeta { name: "upserted_count".to_string(), data_type: "Int64".to_string(), nullable: false, is_primary_key: false, is_foreign_key: false, referenced_table: None, referenced_column: None, default_value: None, extra: None },
                    ],
                    rows: vec![serde_json::json!({
                        "inserted_count": inserted_count,
                        "matched_count": matched_count,
                        "modified_count": modified_count,
                        "deleted_count": deleted_count,
                        "upserted_count": upserted_count,
                    })],
                    affected_rows: total_affected,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB BulkWrite".to_string(),
                    server_version,
                    warnings: errors,
                    all_results: None,
                });
            }

            "renameCollection" | "rename" => {
                let args = split_top_level_args(primary_args);
                if args.is_empty() {
                    return Err("renameCollection requires new collection name".to_string());
                }
                let target_name = args[0].trim().trim_matches(|c| c == '\'' || c == '"' || c == '`');
                let drop_target = if args.len() > 1 {
                    args[1].trim() == "true"
                } else {
                    false
                };
                let from_ns = format!("{}.{}", database_name, coll_name);
                let to_ns = format!("{}.{}", database_name, target_name);
                let admin_db = client.database("admin");
                let res = admin_db.run_command(mongodb::bson::doc! {
                    "renameCollection": from_ns,
                    "to": to_ns,
                    "dropTarget": drop_target,
                }, None).await.map_err(|e| format!("MongoDB renameCollection error: {}", e))?;
                return unpack_mongo_command_result(res, "MongoDB RenameCollection", start, server_version);
            }

            "reIndex" => {
                let db = client.database(database_name);
                let res = db.run_command(mongodb::bson::doc! {
                    "reIndex": &coll_name
                }, None).await.map_err(|e| format!("MongoDB reIndex error: {}", e))?;
                return unpack_mongo_command_result(res, "MongoDB ReIndex", start, server_version);
            }

            "compact" => {
                let db = client.database(database_name);
                let res = db.run_command(mongodb::bson::doc! {
                    "compact": &coll_name
                }, None).await.map_err(|e| format!("MongoDB compact error: {}", e))?;
                return unpack_mongo_command_result(res, "MongoDB Compact", start, server_version);
            }

            "isCapped" => {
                let db = client.database(database_name);
                let res = db.run_command(mongodb::bson::doc! {
                    "collStats": &coll_name
                }, None).await;
                let is_capped = match res {
                    Ok(doc) => doc.get_bool("capped").unwrap_or(false),
                    Err(_) => false,
                };
                return Ok(QueryResult {
                    columns: vec![ColumnMeta { name: "isCapped".to_string(), data_type: "Boolean".to_string(), nullable: false, is_primary_key: false, is_foreign_key: false, referenced_table: None, referenced_column: None, default_value: None, extra: None }],
                    rows: vec![serde_json::json!({ "isCapped": is_capped })],
                    affected_rows: 1,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: "MongoDB isCapped".to_string(),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "dataSize" | "storageSize" | "totalSize" | "totalIndexSize" => {
                let db = client.database(database_name);
                let res = db.run_command(mongodb::bson::doc! {
                    "collStats": &coll_name
                }, None).await.map_err(|e| format!("MongoDB {} error: {}", primary_method, e))?;
                let key = match primary_method.as_str() {
                    "dataSize" => "size",
                    "storageSize" => "storageSize",
                    "totalIndexSize" => "totalIndexSize",
                    _ => "totalSize",
                };
                let bytes = res.get_i64(key).or_else(|_| res.get_i32(key).map(|v| v as i64)).unwrap_or(0);
                return Ok(QueryResult {
                    columns: vec![
                        ColumnMeta { name: primary_method.to_string(), data_type: "Int64".to_string(), nullable: false, is_primary_key: false, is_foreign_key: false, referenced_table: None, referenced_column: None, default_value: None, extra: None },
                        ColumnMeta { name: "formatted".to_string(), data_type: "String".to_string(), nullable: false, is_primary_key: false, is_foreign_key: false, referenced_table: None, referenced_column: None, default_value: None, extra: None },
                    ],
                    rows: vec![serde_json::json!({
                        primary_method.as_str(): bytes,
                        "formatted": format!("{:.2} MB ({} bytes)", bytes as f64 / (1024.0 * 1024.0), bytes)
                    })],
                    affected_rows: 1,
                    last_insert_id: None,
                    execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                    command_type: format!("MongoDB {}", primary_method),
                    server_version,
                    warnings: Vec::new(),
                    all_results: None,
                });
            }

            "findOneAndUpdate" => {
                let args = split_top_level_args(primary_args);
                if args.len() < 2 {
                    return Err("findOneAndUpdate requires (filter, update) arguments".to_string());
                }
                let filter = parse_relaxed_document(&args[0])?;
                let update = parse_relaxed_document(&args[1])?;
                let doc = coll.find_one_and_update(filter, update, None).await.map_err(|e| format!("MongoDB findOneAndUpdate error: {}", e))?;
                if let Some(d) = doc {
                    return unpack_mongo_command_result(d, "MongoDB findOneAndUpdate", start, server_version);
                } else {
                    return unpack_mongo_command_result(mongodb::bson::doc! { "result": null }, "MongoDB findOneAndUpdate", start, server_version);
                }
            }

            "findOneAndDelete" => {
                let filter = parse_relaxed_document(primary_args)?;
                let doc = coll.find_one_and_delete(filter, None).await.map_err(|e| format!("MongoDB findOneAndDelete error: {}", e))?;
                if let Some(d) = doc {
                    return unpack_mongo_command_result(d, "MongoDB findOneAndDelete", start, server_version);
                } else {
                    return unpack_mongo_command_result(mongodb::bson::doc! { "result": null }, "MongoDB findOneAndDelete", start, server_version);
                }
            }

            "findOneAndReplace" => {
                let args = split_top_level_args(primary_args);
                if args.len() < 2 {
                    return Err("findOneAndReplace requires (filter, replacement) arguments".to_string());
                }
                let filter = parse_relaxed_document(&args[0])?;
                let replacement = parse_relaxed_document(&args[1])?;
                let doc = coll.find_one_and_replace(filter, replacement, None).await.map_err(|e| format!("MongoDB findOneAndReplace error: {}", e))?;
                if let Some(d) = doc {
                    return unpack_mongo_command_result(d, "MongoDB findOneAndReplace", start, server_version);
                } else {
                    return unpack_mongo_command_result(mongodb::bson::doc! { "result": null }, "MongoDB findOneAndReplace", start, server_version);
                }
            }

            "explain" => {
                let db = client.database(database_name);
                if methods.len() > 1 {
                    let next_m = &methods[1].0;
                    let next_args = &methods[1].1;
                    if next_m == "find" {
                        let filter_doc = parse_relaxed_document(next_args)?;
                        let explain_cmd = mongodb::bson::doc! {
                            "explain": mongodb::bson::doc! {
                                "find": &coll_name,
                                "filter": filter_doc
                            }
                        };
                        let res = db.run_command(explain_cmd, None).await.map_err(|e| format!("MongoDB explain error: {}", e))?;
                        return unpack_mongo_command_result(res, "MongoDB Explain", start, server_version);
                    } else if next_m == "aggregate" {
                        let pipeline = if next_args.trim().starts_with('[') {
                            let strict = relax_to_strict_json(next_args);
                            let val: serde_json::Value = serde_json::from_str(&strict).unwrap_or(serde_json::Value::Array(Vec::new()));
                            if let serde_json::Value::Array(items) = val {
                                items.into_iter().filter_map(|it| json_to_bson_document(it).ok()).map(mongodb::bson::Bson::Document).collect()
                            } else {
                                Vec::new()
                            }
                        } else {
                            vec![mongodb::bson::Bson::Document(parse_relaxed_document(next_args)?)]
                        };
                        let explain_cmd = mongodb::bson::doc! {
                            "explain": mongodb::bson::doc! {
                                "aggregate": &coll_name,
                                "pipeline": pipeline,
                                "cursor": mongodb::bson::doc! {}
                            }
                        };
                        let res = db.run_command(explain_cmd, None).await.map_err(|e| format!("MongoDB explain error: {}", e))?;
                        return unpack_mongo_command_result(res, "MongoDB Explain", start, server_version);
                    }
                }
                let explain_cmd = mongodb::bson::doc! {
                    "explain": mongodb::bson::doc! {
                        "find": &coll_name
                    }
                };
                let res = db.run_command(explain_cmd, None).await.map_err(|e| format!("MongoDB explain error: {}", e))?;
                return unpack_mongo_command_result(res, "MongoDB Explain", start, server_version);
            }

            other => {
                return Err(format!(
                    "Unsupported MongoDB method '{}'. Supported methods: find(), findOne(), aggregate(), countDocuments(), count(), estimatedDocumentCount(), distinct(), insertOne(), insertMany(), updateOne(), updateMany(), replaceOne(), deleteOne(), deleteMany(), drop(), createIndex(), dropIndex(), getIndexes(), stats(), validate(), bulkWrite(), explain(), renameCollection(), reIndex(), compact(), isCapped(), storageSize(), dataSize(), findOneAndUpdate(), findOneAndDelete(), findOneAndReplace()",
                    other
                ));
            }
        }
    }

    // 7. Try parsing as relaxed JSON document command as final fallback
    if let Ok(doc_cmd) = parse_relaxed_document(&clean) {
        let db = client.database(database_name);
        if let Ok(res) = db.run_command(doc_cmd, None).await {
            return unpack_mongo_command_result(res, "MongoDB Command", start, server_version);
        }
    }

    Err(format!(
        "Invalid MongoDB expression: '{}'. Supported syntax: use <database>, db.createCollection(\"name\", {{...}}), db.<collection>.find({{...}}), db.<collection>.aggregate([...]), SELECT * FROM <collection>, or JSON commands like {{ ping: 1 }}.",
        clean
    ))
}

pub async fn execute_mongodb_query(
    client: &mongodb::Client,
    database_name: &str,
    raw_query: &str,
    limit_override: usize,
    server_version: Option<String>,
) -> Result<QueryResult, String> {
    let start = Instant::now();
    let statements = split_mongo_statements(raw_query);
    if statements.is_empty() {
        return Err("MongoDB query is empty".to_string());
    }

    let mut current_db = database_name.to_string();

    if statements.len() == 1 {
        let mut single_res = execute_mongodb_single_command(client, &current_db, &statements[0], limit_override, server_version).await?;
        let batch_item = BatchStatementResult {
            statement: statements[0].clone(),
            columns: single_res.columns.clone(),
            rows: single_res.rows.clone(),
            affected_rows: single_res.affected_rows,
            last_insert_id: single_res.last_insert_id,
            execution_time_ms: single_res.execution_time_ms,
            error: None,
        };
        single_res.all_results = Some(vec![batch_item]);
        return Ok(single_res);
    }

    let mut batch_results = Vec::new();
    let mut last_res = None;
    let mut total_affected = 0u64;

    for stmt in &statements {
        let stmt_start = Instant::now();
        match execute_mongodb_single_command(client, &current_db, stmt, limit_override, server_version.clone()).await {
            Ok(res) => {
                total_affected += res.affected_rows;
                if res.command_type == "MongoDB Use" {
                    if let Some(first_row) = res.rows.first() {
                        if let Some(new_db) = first_row.get("database").and_then(|v| v.as_str()) {
                            current_db = new_db.to_string();
                        }
                    }
                }
                batch_results.push(BatchStatementResult {
                    statement: stmt.clone(),
                    columns: res.columns.clone(),
                    rows: res.rows.clone(),
                    affected_rows: res.affected_rows,
                    last_insert_id: res.last_insert_id,
                    execution_time_ms: res.execution_time_ms,
                    error: None,
                });
                last_res = Some(res);
            }
            Err(e) => {
                batch_results.push(BatchStatementResult {
                    statement: stmt.clone(),
                    columns: Vec::new(),
                    rows: Vec::new(),
                    affected_rows: 0,
                    last_insert_id: None,
                    execution_time_ms: stmt_start.elapsed().as_secs_f64() * 1000.0,
                    error: Some(e),
                });
            }
        }
    }

    let fallback_res = last_res.unwrap_or_else(|| QueryResult {
        columns: Vec::new(),
        rows: Vec::new(),
        affected_rows: 0,
        last_insert_id: None,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        command_type: "MongoDB".to_string(),
        server_version: server_version.clone(),
        warnings: Vec::new(),
        all_results: None,
    });

    Ok(QueryResult {
        columns: fallback_res.columns,
        rows: fallback_res.rows,
        affected_rows: total_affected,
        last_insert_id: fallback_res.last_insert_id,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        command_type: "MongoDB Batch".to_string(),
        server_version,
        warnings: Vec::new(),
        all_results: Some(batch_results),
    })
}

pub async fn list_collections_mongo(
    client: &mongodb::Client,
    session: &ActiveDatabaseSession,
) -> Result<Vec<DatabaseObject>, String> {
    let db_name = get_effective_mongo_db(&session.config.database);
    let db = client.database(db_name);
    let collections = db.list_collection_names(None).await.map_err(|e| e.to_string())?;
    Ok(collections
        .into_iter()
        .map(|c| DatabaseObject {
            name: c,
            object_type: "collection".to_string(),
            schema: Some(db_name.to_string()),
            row_count: None,
            size_bytes: None,
            definition: None,
        })
        .collect())
}

pub async fn get_collection_columns_mongo(
    client: &mongodb::Client,
    session: &ActiveDatabaseSession,
    table_name: &str,
) -> Result<Vec<ColumnMeta>, String> {
    let db_name = get_effective_mongo_db(&session.config.database);
    let db = client.database(db_name);
    let coll = db.collection::<mongodb::bson::Document>(table_name);
    use futures::StreamExt;
    let find_opts = mongodb::options::FindOptions::builder().limit(Some(5)).build();
    let mut cursor = coll.find(None, find_opts).await.map_err(|e| e.to_string())?;

    let mut key_order = Vec::new();
    let mut key_types: HashMap<String, String> = HashMap::new();

    while let Some(doc_res) = cursor.next().await {
        if let Ok(doc) = doc_res {
            for (k, v) in doc {
                if !key_types.contains_key(&k) {
                    if k == "_id" {
                        key_order.insert(0, k.clone());
                    } else {
                        key_order.push(k.clone());
                    }
                    let t_name = match v.element_type() {
                        mongodb::bson::spec::ElementType::ObjectId => "ObjectId".to_string(),
                        mongodb::bson::spec::ElementType::String => "String".to_string(),
                        mongodb::bson::spec::ElementType::Int32 => "Int32".to_string(),
                        mongodb::bson::spec::ElementType::Int64 => "Int64".to_string(),
                        mongodb::bson::spec::ElementType::Double => "Double".to_string(),
                        mongodb::bson::spec::ElementType::Boolean => "Boolean".to_string(),
                        mongodb::bson::spec::ElementType::DateTime => "Date".to_string(),
                        mongodb::bson::spec::ElementType::Array => "Array".to_string(),
                        mongodb::bson::spec::ElementType::EmbeddedDocument => "Document".to_string(),
                        mongodb::bson::spec::ElementType::Null => "Null".to_string(),
                        mongodb::bson::spec::ElementType::Binary => "Binary".to_string(),
                        other => format!("{:?}", other),
                    };
                    key_types.insert(k, t_name);
                }
            }
        }
    }

    if key_order.is_empty() {
        Ok(vec![ColumnMeta {
            name: "_id".to_string(),
            data_type: "ObjectId".to_string(),
            nullable: false,
            is_primary_key: true,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        }])
    } else {
        let cols = key_order.into_iter().map(|k| {
            let dt = key_types.get(&k).cloned().unwrap_or_else(|| "Field".to_string());
            let is_id = k == "_id";
            ColumnMeta {
                name: k,
                data_type: dt,
                nullable: !is_id,
                is_primary_key: is_id,
                is_foreign_key: false,
                referenced_table: None,
                referenced_column: None,
                default_value: None,
                extra: None,
            }
        }).collect();
        Ok(cols)
    }
}

pub async fn execute_operation_mongo(
    client: &mongodb::Client,
    session: &ActiveDatabaseSession,
    operation: &DatabaseOperation,
    start: Instant,
) -> Result<OperationResult, String> {
    let db = client.database(get_effective_mongo_db(&session.config.database));
    match operation {
        DatabaseOperation::CreateTable { table, .. } => {
            db.create_collection(table, None).await.map_err(|e| e.to_string())?;
            Ok(OperationResult {
                success: true,
                message: format!("Collection '{}' created successfully", table),
                affected_rows: 0,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                generated_sql: None,
                definition: None,
            })
        }
        DatabaseOperation::DropObject { name, .. } => {
            db.collection::<mongodb::bson::Document>(name).drop(None).await.map_err(|e| e.to_string())?;
            Ok(OperationResult {
                success: true,
                message: format!("Collection '{}' dropped successfully", name),
                affected_rows: 0,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                generated_sql: None,
                definition: None,
            })
        }
        DatabaseOperation::TruncateTable { table, .. } => {
            let coll = db.collection::<mongodb::bson::Document>(table);
            let res = coll.delete_many(mongodb::bson::doc! {}, None).await.map_err(|e| e.to_string())?;
            Ok(OperationResult {
                success: true,
                message: format!("Collection '{}' emptied ({} documents deleted)", table, res.deleted_count),
                affected_rows: res.deleted_count,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                generated_sql: None,
                definition: None,
            })
        }
        DatabaseOperation::CreateIndex { table, index_name, columns, is_unique, .. } => {
            let coll = db.collection::<mongodb::bson::Document>(table);
            let mut keys_doc = mongodb::bson::Document::new();
            for col in columns {
                keys_doc.insert(col, 1);
            }
            let index_model = mongodb::IndexModel::builder()
                .keys(keys_doc)
                .options(Some(
                    mongodb::options::IndexOptions::builder()
                        .name(Some(index_name.clone()))
                        .unique(Some(*is_unique))
                        .build(),
                ))
                .build();
            coll.create_index(index_model, None).await.map_err(|e| e.to_string())?;
            Ok(OperationResult {
                success: true,
                message: format!("Index '{}' created on collection '{}'", index_name, table),
                affected_rows: 1,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                generated_sql: None,
                definition: None,
            })
        }
        DatabaseOperation::DropIndex { table, index_name, .. } => {
            let coll = db.collection::<mongodb::bson::Document>(table);
            coll.drop_index(index_name.clone(), None).await.map_err(|e| e.to_string())?;
            Ok(OperationResult {
                success: true,
                message: format!("Index '{}' dropped from collection '{}'", index_name, table),
                affected_rows: 1,
                execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
                generated_sql: None,
                definition: None,
            })
        }
        _ => Err("Operation not supported for MongoDB".to_string()),
    }
}

pub async fn get_object_definition_mongo(
    client: &mongodb::Client,
    session: &ActiveDatabaseSession,
    name: &str,
) -> Result<String, String> {
    let db = client.database(get_effective_mongo_db(&session.config.database));
    let coll = db.collection::<mongodb::bson::Document>(name);
    let count = coll.count_documents(mongodb::bson::doc! {}, None).await.unwrap_or(0);
    Ok(format!("// MongoDB Collection: {}\n// Document Count: {}\ndb.getCollection('{}').find({{}});", name, count, name))
}

// ─── MongoDB Specific Tauri Commands ─────────────────────────────────

#[tauri::command]
pub async fn mongodb_list_collections(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    database: Option<String>,
) -> Result<Vec<String>, String> {
    let mut lock = db_mgr.sessions.lock().await;
    let session = lock
        .get_mut(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let DriverInstance::Mongo(client) = &session.driver {
        if let Some(ref db_target) = database {
            if !db_target.trim().is_empty() {
                session.config.database = db_target.trim().to_string();
            }
        }
        let db_target = database.as_deref().unwrap_or(&session.config.database);
        let db = client.database(get_effective_mongo_db(db_target));
        db.list_collection_names(None).await.map_err(|e| e.to_string())
    } else {
        Err("Active connection is not MongoDB".to_string())
    }
}

#[tauri::command]
pub async fn mongodb_find_documents(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    collection: String,
    filter_json: Option<String>,
    skip: Option<u64>,
    limit: Option<i64>,
) -> Result<QueryResult, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let DriverInstance::Mongo(client) = &session.driver {
        let db = client.database(get_effective_mongo_db(&session.config.database));
        let coll = db.collection::<mongodb::bson::Document>(&collection);

        let filter_doc = if let Some(ref fj) = filter_json {
            if !fj.trim().is_empty() {
                serde_json::from_str(fj).map_err(|e| format!("Invalid filter JSON: {}", e))?
            } else {
                mongodb::bson::doc! {}
            }
        } else {
            mongodb::bson::doc! {}
        };

        let mut find_options = mongodb::options::FindOptions::default();
        find_options.skip = skip;
        find_options.limit = Some(limit.unwrap_or(100));

        let start = Instant::now();
        let mut cursor = coll.find(filter_doc, find_options).await.map_err(|e| e.to_string())?;
        collect_mongo_cursor_results(&mut cursor, "MongoDB Find", start, Some(session.capabilities.server_version.clone()), limit.unwrap_or(100) as usize).await
    } else {
        Err("Active connection is not MongoDB".to_string())
    }
}

#[tauri::command]
pub async fn mongodb_insert_document(
    db_mgr: tauri::State<'_, Arc<DatabaseManager>>,
    connection_id: String,
    collection: String,
    doc_json: String,
) -> Result<String, String> {
    let lock = db_mgr.sessions.lock().await;
    let session = lock
        .get(&connection_id)
        .ok_or_else(|| "Database connection not active".to_string())?;

    if let DriverInstance::Mongo(client) = &session.driver {
        let db = client.database(get_effective_mongo_db(&session.config.database));
        let coll = db.collection::<mongodb::bson::Document>(&collection);

        let doc: mongodb::bson::Document = serde_json::from_str(&doc_json).map_err(|e| e.to_string())?;
        let res = coll.insert_one(doc, None).await.map_err(|e| e.to_string())?;

        Ok(format!("{:?}", res.inserted_id))
    } else {
        Err("Active connection is not MongoDB".to_string())
    }
}
