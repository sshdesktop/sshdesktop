use std::time::Instant;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use base64::prelude::*;
use serde_json::{json, Value};
use super::types::{
    ActiveDatabaseSession, ColumnMeta, DatabaseConnectionConfig, DatabaseObject,
    DriverInstance, QueryResult, ServerCapabilities,
};

type HmacSha256 = Hmac<Sha256>;

/// Generate an Azure Cosmos DB Master Key authorization header
pub fn generate_cosmos_auth_token(
    verb: &str,
    resource_type: &str,
    resource_id: &str,
    date_str: &str,
    master_key_b64: &str,
) -> Result<String, String> {
    let key_bytes = BASE64_STANDARD.decode(master_key_b64.trim())
        .map_err(|e| format!("Invalid base64 Cosmos DB master key: {}", e))?;

    let payload = format!(
        "{}\n{}\n{}\n{}\n\n",
        verb.to_lowercase(),
        resource_type.to_lowercase(),
        resource_id,
        date_str.to_lowercase(),
    );

    let mut mac = HmacSha256::new_from_slice(&key_bytes)
        .map_err(|e| format!("HMAC key initialization failed: {}", e))?;
    mac.update(payload.as_bytes());
    let sig_bytes = mac.finalize().into_bytes();
    let sig_b64 = BASE64_STANDARD.encode(sig_bytes);

    let auth_str = format!("type=master&ver=1.0&sig={}", urlencoding::encode(&sig_b64));
    Ok(auth_str)
}

mod urlencoding {
    pub fn encode(s: &str) -> String {
        url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
    }
}

pub async fn connect_cosmos(
    effective_host: &str,
    effective_port: u16,
    config: &DatabaseConnectionConfig,
) -> Result<(DriverInstance, ServerCapabilities), String> {
    let endpoint = if let Some(ref ep) = config.endpoint_url {
        if !ep.trim().is_empty() {
            ep.trim().trim_end_matches('/').to_string()
        } else {
            format!("https://{}.documents.azure.com:{}", effective_host, effective_port)
        }
    } else if effective_host.contains(".documents.azure.com") {
        format!("https://{}:{}", effective_host, effective_port)
    } else {
        format!("https://{}.documents.azure.com:{}", effective_host, effective_port)
    };

    let database = if !config.database.trim().is_empty() {
        config.database.trim().to_string()
    } else {
        return Err("Cosmos Database ID is required.".into());
    };

    let master_key = config.password.as_deref()
        .or(config.secret_access_key.as_deref())
        .unwrap_or_default();

    if master_key.is_empty() {
        return Err("Azure Cosmos DB Primary / Master Key is required.".into());
    }

    // Test connectivity by querying collections in the specified database
    let now = chrono::Utc::now();
    let date_str = now.format("%a, %d %b %Y %H:%M:%S GMT").to_string();
    let resource_id = format!("dbs/{}", database);
    let auth = generate_cosmos_auth_token("GET", "colls", &resource_id, &date_str, master_key)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let coll_url = format!("{}/dbs/{}/colls", endpoint, database);
    let res = client.get(&coll_url)
        .header("x-ms-date", &date_str)
        .header("x-ms-version", "2018-12-31")
        .header("authorization", auth)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Azure Cosmos DB connection failed: {}", e))?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Cosmos DB error (HTTP {}): {}", status.as_u16(), text));
    }

    let capabilities = ServerCapabilities {
        engine: "cosmos".to_string(),
        server_version: "Azure Cosmos DB (Core SQL API)".to_string(),
        supports_transactions: true,
        supports_schemas: false,
        supports_procedures: true,
        supports_functions: true,
        supports_triggers: true,
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
        DriverInstance::CosmosDb {
            endpoint,
            database,
        },
        capabilities,
    ))
}

pub async fn list_tables_cosmos(
    session: &ActiveDatabaseSession,
) -> Result<Vec<DatabaseObject>, String> {
    let (endpoint, database) = match &session.driver {
        DriverInstance::CosmosDb { endpoint, database } => (endpoint, database),
        _ => return Err("Invalid driver instance for Cosmos DB".into()),
    };

    let master_key = session.config.password.as_deref()
        .or(session.config.secret_access_key.as_deref())
        .unwrap_or_default();

    let now = chrono::Utc::now();
    let date_str = now.format("%a, %d %b %Y %H:%M:%S GMT").to_string();
    let resource_id = format!("dbs/{}", database);
    let auth = generate_cosmos_auth_token("GET", "colls", &resource_id, &date_str, master_key)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let coll_url = format!("{}/dbs/{}/colls", endpoint, database);
    let res = client.get(&coll_url)
        .header("x-ms-date", &date_str)
        .header("x-ms-version", "2018-12-31")
        .header("authorization", auth)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to list Cosmos collections: {}", e))?;

    let text = res.text().await.map_err(|e| e.to_string())?;
    let val: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({}));
    let colls = val.get("DocumentCollections").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    let objects = colls
        .into_iter()
        .filter_map(|c| c.get("id").and_then(|id| id.as_str()).map(|s| s.to_string()))
        .map(|name| DatabaseObject {
            name,
            object_type: "collection".to_string(),
            schema: Some(database.clone()),
            row_count: None,
            size_bytes: None,
            definition: None,
        })
        .collect();

    Ok(objects)
}

pub async fn get_table_columns_cosmos(
    _session: &ActiveDatabaseSession,
) -> Result<Vec<ColumnMeta>, String> {
    // Cosmos DB documents have dynamic JSON schemata. Return universal core document attributes:
    Ok(vec![
        ColumnMeta {
            name: "id".to_string(),
            data_type: "string".to_string(),
            nullable: false,
            is_primary_key: true,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: Some("Unique Document Identifier".to_string()),
        },
        ColumnMeta {
            name: "_rid".to_string(),
            data_type: "string".to_string(),
            nullable: false,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: Some("Resource ID".to_string()),
        },
        ColumnMeta {
            name: "_etag".to_string(),
            data_type: "string".to_string(),
            nullable: false,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: Some("Entity Tag".to_string()),
        },
        ColumnMeta {
            name: "_ts".to_string(),
            data_type: "integer".to_string(),
            nullable: false,
            is_primary_key: false,
            is_foreign_key: false,
            referenced_table: None,
            referenced_column: None,
            default_value: None,
            extra: Some("Timestamp".to_string()),
        },
    ])
}

pub async fn execute_query_cosmos(
    query: &str,
    session: &ActiveDatabaseSession,
    start: Instant,
) -> Result<QueryResult, String> {
    let (endpoint, database) = match &session.driver {
        DriverInstance::CosmosDb { endpoint, database } => (endpoint, database),
        _ => return Err("Invalid driver instance for Cosmos DB".into()),
    };

    let master_key = session.config.password.as_deref()
        .or(session.config.secret_access_key.as_deref())
        .unwrap_or_default();

    // Determine target collection from query or default
    let coll_name = session.config.schema.as_deref()
        .unwrap_or("items");

    let now = chrono::Utc::now();
    let date_str = now.format("%a, %d %b %Y %H:%M:%S GMT").to_string();
    let resource_id = format!("dbs/{}/colls/{}", database, coll_name);
    let auth = generate_cosmos_auth_token("POST", "docs", &resource_id, &date_str, master_key)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let docs_url = format!("{}/dbs/{}/colls/{}/docs", endpoint, database, coll_name);
    let query_body = json!({
        "query": query.trim()
    });

    let res = client.post(&docs_url)
        .header("x-ms-date", &date_str)
        .header("x-ms-version", "2018-12-31")
        .header("x-ms-documentdb-isquery", "True")
        .header("content-type", "application/query+json")
        .header("authorization", auth)
        .body(query_body.to_string())
        .send()
        .await
        .map_err(|e| format!("Cosmos DB query failed: {}", e))?;

    let status = res.status();
    let text = res.text().await.map_err(|e| e.to_string())?;
    let val: Value = serde_json::from_str(&text).unwrap_or_else(|_| json!({ "raw": text }));

    if !status.is_success() {
        let msg = val.get("message").and_then(|m| m.as_str()).unwrap_or(&text);
        return Err(format!("Cosmos query error (HTTP {}): {}", status.as_u16(), msg));
    }

    let documents = val.get("Documents").and_then(|d| d.as_array()).cloned().unwrap_or_default();

    let mut col_names = std::collections::HashSet::new();
    for doc in &documents {
        if let Some(obj) = doc.as_object() {
            for k in obj.keys() {
                col_names.insert(k.clone());
            }
        }
    }

    let mut cols: Vec<ColumnMeta> = col_names
        .into_iter()
        .map(|name| ColumnMeta {
            is_primary_key: name == "id",
            name,
            data_type: "document_property".to_string(),
            nullable: true,
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
        rows: documents,
        affected_rows: 0,
        last_insert_id: None,
        execution_time_ms: start.elapsed().as_secs_f64() * 1000.0,
        command_type: "SELECT".to_string(),
        server_version: Some("Azure Cosmos DB".to_string()),
        warnings: Vec::new(),
        all_results: None,
    })
}
