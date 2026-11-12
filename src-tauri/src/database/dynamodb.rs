use std::time::Instant;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use serde_json::{json, Value};
use super::types::{
    ActiveDatabaseSession, ColumnMeta, DatabaseConnectionConfig, DatabaseObject,
    DriverInstance, QueryResult, ServerCapabilities,
};

type HmacSha256 = Hmac<Sha256>;

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC can take key of any size");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn hex_encode(data: &[u8]) -> String {
    data.iter().map(|b| format!("{:02x}", b)).collect()
}

fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hex_encode(&hasher.finalize())
}

/// Sign an AWS request using AWS Signature Version 4 (SigV4)
pub fn sign_aws_v4(
    method: &str,
    url_str: &str,
    service: &str,
    region: &str,
    access_key: &str,
    secret_key: &str,
    amz_target: &str,
    payload: &str,
    amz_date: &str,
    date_stamp: &str,
) -> (String, String) {
    let url = url::Url::parse(url_str).unwrap_or_else(|_| url::Url::parse("http://127.0.0.1:8000").unwrap());
    let host = url.host_str().unwrap_or("127.0.0.1");
    let host_header = if let Some(port) = url.port() {
        format!("{}:{}", host, port)
    } else {
        host.to_string()
    };
    let path = if url.path().is_empty() { "/" } else { url.path() };

    let payload_hash = sha256_hex(payload.as_bytes());

    let canonical_headers = format!(
        "content-type:application/x-amz-json-1.0\nhost:{}\nx-amz-date:{}\nx-amz-target:{}\n",
        host_header, amz_date, amz_target
    );
    let signed_headers = "content-type;host;x-amz-date;x-amz-target";

    let canonical_request = format!(
        "{}\n{}\n\n{}\n{}\n{}",
        method, path, canonical_headers, signed_headers, payload_hash
    );

    let credential_scope = format!("{}/{}/{}/aws4_request", date_stamp, region, service);
    let string_to_sign = format!(
        "AWS4-HMAC-SHA256\n{}\n{}\n{}",
        amz_date,
        credential_scope,
        sha256_hex(canonical_request.as_bytes())
    );

    let k_secret = format!("AWS4{}", secret_key);
    let k_date = hmac_sha256(k_secret.as_bytes(), date_stamp.as_bytes());
    let k_region = hmac_sha256(&k_date, region.as_bytes());
    let k_service = hmac_sha256(&k_region, service.as_bytes());
    let k_signing = hmac_sha256(&k_service, b"aws4_request");
    let signature = hex_encode(&hmac_sha256(&k_signing, string_to_sign.as_bytes()));

    let auth_header = format!(
        "AWS4-HMAC-SHA256 Credential={}/{}, SignedHeaders={}, Signature={}",
        access_key, credential_scope, signed_headers, signature
    );

    (auth_header, host_header)
}

async fn call_dynamodb(
    endpoint: &str,
    region: &str,
    access_key: &str,
    secret_key: &str,
    action: &str,
    payload: &Value,
) -> Result<Value, String> {
    let now = chrono::Utc::now();
    let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date_stamp = now.format("%Y%m%d").to_string();
    let target = format!("DynamoDB_20120810.{}", action);
    let body_str = payload.to_string();

    let (auth_header, host_header) = sign_aws_v4(
        "POST",
        endpoint,
        "dynamodb",
        region,
        access_key,
        secret_key,
        &target,
        &body_str,
        &amz_date,
        &date_stamp,
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .post(endpoint)
        .header("host", host_header)
        .header("content-type", "application/x-amz-json-1.0")
        .header("x-amz-date", amz_date)
        .header("x-amz-target", target)
        .header("authorization", auth_header)
        .body(body_str)
        .send()
        .await
        .map_err(|e| format!("DynamoDB request failed: {}", e))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;

    let val: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }));
    if !status.is_success() {
        let msg = val.get("message")
            .or_else(|| val.get("Message"))
            .and_then(|m| m.as_str())
            .unwrap_or(&text);
        return Err(format!("DynamoDB error (HTTP {}): {}", status.as_u16(), msg));
    }

    Ok(val)
}

pub async fn connect_dynamodb(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let region = config.region.clone().unwrap_or_else(|| "us-east-1".to_string());
    let endpoint = if let Some(ref ep) = config.endpoint_url {
        if !ep.trim().is_empty() {
            ep.trim().to_string()
        } else {
            format!("https://dynamodb.{}.amazonaws.com", region)
        }
    } else if effective_host == "127.0.0.1" || effective_host == "localhost" {
        format!("http://{}:{}", effective_host, effective_port)
    } else {
        format!("https://dynamodb.{}.amazonaws.com", region)
    };

    let access_key = config.access_key_id.clone().unwrap_or_default();
    let secret_key = config.secret_access_key.clone()
        .or_else(|| config.password.clone())
        .unwrap_or_default();

    if access_key.is_empty() || secret_key.is_empty() {
        return Err("AWS Access Key ID and Secret Access Key are required for DynamoDB.".into());
    }

    // Verify connectivity by running ListTables with Limit 1
    call_dynamodb(&endpoint, &region, &access_key, &secret_key, "ListTables", &json!({ "Limit": 1 })).await?;

    let capabilities = ServerCapabilities {
        engine: "dynamodb".to_string(),
        server_version: format!("Amazon DynamoDB ({})", region),
        supports_transactions: true,
        supports_schemas: false,
        supports_procedures: false,
        supports_functions: false,
        supports_triggers: false,
        supports_views: false,
        supports_indexes: true,
        supports_foreign_keys: false,
        supports_explain: false,
        supports_process_list: false,
        read_only: config.read_only,
        supports_rename_table: false,
        supports_alter_column: false,
    };

    Ok((
        DriverInstance::DynamoDb {
            endpoint,
            region,
        },
        capabilities,
    ))
}

pub async fn list_tables_dynamodb(
    session: &ActiveDatabaseSession,
) -> Result<Vec<DatabaseObject>, String> {
    let (endpoint, region) = match &session.driver {
        DriverInstance::DynamoDb { endpoint, region } => (endpoint, region),
        _ => return Err("Invalid driver instance for DynamoDB".into()),
    };
    let access_key = session.config.access_key_id.as_deref().unwrap_or_default();
    let secret_key = session.config.secret_access_key.as_deref()
        .or(session.config.password.as_deref())
        .unwrap_or_default();

    let val = call_dynamodb(endpoint, region, access_key, secret_key, "ListTables", &json!({ "Limit": 100 })).await?;
    let table_names = val.get("TableNames").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let objects = table_names
        .into_iter()
        .filter_map(|t| t.as_str().map(|s| s.to_string()))
        .map(|name| DatabaseObject {
            name,
            object_type: "table".to_string(),
            schema: None,
            row_count: None,
            size_bytes: None,
            definition: None,
        })
        .collect();

    Ok(objects)
}

pub async fn get_table_columns_dynamodb(
    session: &ActiveDatabaseSession,
    table_name: &str,
) -> Result<Vec<ColumnMeta>, String> {
    let (endpoint, region) = match &session.driver {
        DriverInstance::DynamoDb { endpoint, region } => (endpoint, region),
        _ => return Err("Invalid driver instance for DynamoDB".into()),
    };
    let access_key = session.config.access_key_id.as_deref().unwrap_or_default();
    let secret_key = session.config.secret_access_key.as_deref()
        .or(session.config.password.as_deref())
        .unwrap_or_default();

    let val = call_dynamodb(
        endpoint,
        region,
        access_key,
        secret_key,
        "DescribeTable",
        &json!({ "TableName": table_name }),
    ).await?;

    let table = val.get("Table").cloned().unwrap_or_default();
    let key_schema = table.get("KeySchema").and_then(|k| k.as_array()).cloned().unwrap_or_default();
    let attrs = table.get("AttributeDefinitions").and_then(|a| a.as_array()).cloned().unwrap_or_default();

    let mut cols = Vec::new();
    for attr in attrs {
        let name = attr.get("AttributeName").and_then(|n| n.as_str()).unwrap_or("").to_string();
        let ty_code = attr.get("AttributeType").and_then(|t| t.as_str()).unwrap_or("S");
        let ty_label = match ty_code {
            "S" => "String (S)",
            "N" => "Number (N)",
            "B" => "Binary (B)",
            _ => ty_code,
        }.to_string();

        let is_pk = key_schema.iter().any(|k| {
            k.get("AttributeName").and_then(|n| n.as_str()) == Some(&name)
        });

        cols.push(ColumnMeta {
            name,
            data_type: ty_label,
            nullable: false,
            is_primary_key: is_pk,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        });
    }

    Ok(cols)
}

fn unwrap_dynamodb_attribute(v: &Value) -> Value {
    if let Some(obj) = v.as_object() {
        if let Some(s) = obj.get("S").and_then(|x| x.as_str()) {
            return Value::String(s.to_string());
        }
        if let Some(n) = obj.get("N").and_then(|x| x.as_str()) {
            if let Ok(num) = n.parse::<i64>() {
                return json!(num);
            }
            if let Ok(flt) = n.parse::<f64>() {
                return json!(flt);
            }
            return Value::String(n.to_string());
        }
        if let Some(b) = obj.get("BOOL").and_then(|x| x.as_bool()) {
            return Value::Bool(b);
        }
        if obj.get("NULL").is_some() {
            return Value::Null;
        }
        if let Some(arr) = obj.get("L").and_then(|x| x.as_array()) {
            return Value::Array(arr.iter().map(unwrap_dynamodb_attribute).collect());
        }
        if let Some(map) = obj.get("M").and_then(|x| x.as_object()) {
            let mut out = serde_json::Map::new();
            for (k, val) in map {
                out.insert(k.clone(), unwrap_dynamodb_attribute(val));
            }
            return Value::Object(out);
        }
    }
    v.clone()
}

pub async fn execute_query_dynamodb(
    query: &str,
    session: &ActiveDatabaseSession,
    start: Instant,
) -> Result<QueryResult, String> {
    let (endpoint, region) = match &session.driver {
        DriverInstance::DynamoDb { endpoint, region } => (endpoint, region),
        _ => return Err("Invalid driver instance for DynamoDB".into()),
    };
    let access_key = session.config.access_key_id.as_deref().unwrap_or_default();
    let secret_key = session.config.secret_access_key.as_deref()
        .or(session.config.password.as_deref())
        .unwrap_or_default();

    let trimmed = query.trim();
    let is_json = trimmed.starts_with('{') && trimmed.ends_with('}');

    let (items, affected) = if is_json {
        let payload: Value = serde_json::from_str(trimmed)
            .map_err(|e| format!("Invalid JSON command for DynamoDB: {}", e))?;
        let action = payload.get("action").and_then(|a| a.as_str()).unwrap_or("Scan");
        let res = call_dynamodb(endpoint, region, access_key, secret_key, action, &payload).await?;
        let items_raw = res.get("Items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
        (items_raw, 0u64)
    } else {
        // AWS DynamoDB PartiQL syntax: SELECT * FROM "TableName" WHERE ...
        let payload = json!({
            "Statement": trimmed
        });
        let res = call_dynamodb(endpoint, region, access_key, secret_key, "ExecuteStatement", &payload).await?;
        let items_raw = res.get("Items").and_then(|i| i.as_array()).cloned().unwrap_or_default();
        (items_raw, 0u64)
    };

    let mut rows: Vec<Value> = Vec::new();
    let mut col_names = std::collections::HashSet::new();

    for item in items {
        if let Some(obj) = item.as_object() {
            let mut row_map = serde_json::Map::new();
            for (k, v) in obj {
                col_names.insert(k.clone());
                row_map.insert(k.clone(), unwrap_dynamodb_attribute(v));
            }
            rows.push(Value::Object(row_map));
        }
    }

    let mut cols: Vec<ColumnMeta> = col_names
        .into_iter()
        .map(|name| ColumnMeta {
            name,
            data_type: "attribute".to_string(),
            nullable: true,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: None,
        })
        .collect();
    cols.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(QueryResult {
        columns: cols,
        rows,
        affected_rows: affected,
        last_insert_id: None,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        command_type: "SELECT".to_string(),
        server_version: Some(format!("Amazon DynamoDB ({})", region)),
        warnings: Vec::new(),
        all_results: None,
    })
}
