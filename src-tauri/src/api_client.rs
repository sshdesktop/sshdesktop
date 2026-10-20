use std::collections::HashMap;
use std::time::Instant;
use serde::{Deserialize, Serialize};
use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiHeader {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiQueryParam {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiFormDataItem {
    pub key: String,
    pub value: String,
    pub item_type: String, // "text" or "file"
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiRequest {
    pub id: Option<String>,
    pub conn_id: Option<String>,
    pub use_ssh_tunnel: bool,
    pub method: String,
    pub url: String,
    pub headers: Vec<ApiHeader>,
    pub query_params: Vec<ApiQueryParam>,
    pub body_type: String, // "none", "json", "text", "form-data", "x-www-form-urlencoded", "raw"
    pub raw_body: Option<String>,
    pub form_data: Option<Vec<ApiFormDataItem>>,
    pub timeout_seconds: Option<u64>,
    pub follow_redirects: Option<bool>,
    pub verify_ssl: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub is_json: bool,
    pub is_binary: bool,
    pub size_bytes: usize,
    pub duration_ms: u64,
    pub tunnel_used: bool,
    pub tunneled_target: Option<String>,
    pub effective_url: String,
}

const B64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn to_base64(bytes: &[u8]) -> String {
    let mut result = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0];
        let b1 = chunk.get(1).copied().unwrap_or(0);
        let b2 = chunk.get(2).copied().unwrap_or(0);
        result.push(B64_CHARS[(b0 >> 2) as usize] as char);
        result.push(B64_CHARS[(((b0 & 3) << 4) | (b1 >> 4)) as usize] as char);
        if chunk.len() > 1 {
            result.push(B64_CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(B64_CHARS[(b2 & 0x3f) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

#[tauri::command]
pub async fn api_send_request(
    state: tauri::State<'_, AppState>,
    req: ApiRequest,
) -> Result<ApiResponse, String> {
    if req.url.trim().is_empty() {
        return Err("Target URL cannot be empty".to_string());
    }

    let raw_url = req.url.trim();
    let formatted_url = if !raw_url.starts_with("http://") && !raw_url.starts_with("https://") {
        format!("http://{}", raw_url)
    } else {
        raw_url.to_string()
    };

    let parsed_url = url::Url::parse(&formatted_url)
        .map_err(|e| format!("Invalid URL '{}': {}", formatted_url, e))?;

    let scheme = parsed_url.scheme();
    let original_host = parsed_url.host_str().unwrap_or("127.0.0.1").to_string();
    let default_port = if scheme == "https" { 443 } else { 80 };
    let original_port = parsed_url.port().unwrap_or(default_port);

    let mut tunnel_used = false;
    let mut tunneled_target = None;
    let mut request_url = parsed_url.clone();
    let mut host_header_override = None;

    // Route through SSH tunnel if enabled
    if req.use_ssh_tunnel {
        let conn_id = match req.conn_id.as_deref() {
            Some(id) if !id.trim().is_empty() => id.to_string(),
            _ => {
                // Find first active connection if not explicitly provided
                let connections = state.connections.lock();
                connections.keys().next().cloned().ok_or_else(|| {
                    "No active SSH connection found. Please connect to an SSH server to route requests through the tunnel, or toggle SSH Tunnel off for direct requests.".to_string()
                })?
            }
        };

        let is_localhost = original_host.eq_ignore_ascii_case("localhost")
            || original_host == "127.0.0.1"
            || original_host == "0.0.0.0"
            || original_host == "::1";

        let remote_target = if is_localhost {
            "127.0.0.1".to_string()
        } else {
            original_host.clone()
        };

        log::info!(
            "SSH Desktop API Studio: Starting SSH tunnel to {}:{} via connection '{}'",
            remote_target, original_port, conn_id
        );

        let local_tunnel_port = crate::ssh::tunnel::ssh_start_tunnel(
            state.clone(),
            conn_id.clone(),
            0,
            remote_target.clone(),
            original_port,
        ).await.map_err(|e| format!("Failed to establish SSH tunnel for API request: {}", e))?;

        // Reconstruct URL pointing to the local tunnel endpoint
        let path_and_query = match parsed_url.query() {
            Some(q) => format!("{}?{}", parsed_url.path(), q),
            None => parsed_url.path().to_string(),
        };

        let new_url_str = format!("http://127.0.0.1:{}{}", local_tunnel_port, path_and_query);
        request_url = url::Url::parse(&new_url_str)
            .map_err(|e| format!("Failed to parse tunneled URL: {}", e))?;

        // Preserve Host header for virtual hosting (e.g. Nginx/Apache/Express)
        host_header_override = Some(if original_port == 80 || original_port == 443 {
            original_host.clone()
        } else {
            format!("{}:{}", original_host, original_port)
        });

        tunnel_used = true;
        tunneled_target = Some(format!("{}:{} (via local :{})", remote_target, original_port, local_tunnel_port));
    }

    // Append enabled query parameters
    {
        let mut query_pairs = request_url.query_pairs().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>();
        for q in &req.query_params {
            if q.enabled && !q.key.trim().is_empty() {
                query_pairs.push((q.key.trim().to_string(), q.value.to_string()));
            }
        }
        if !req.query_params.is_empty() {
            request_url.set_query(None);
            let mut serializer = request_url.query_pairs_mut();
            for (k, v) in query_pairs {
                serializer.append_pair(&k, &v);
            }
        }
    }

    // Configure reqwest client
    let timeout_secs = req.timeout_seconds.unwrap_or(30).clamp(1, 300);
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .danger_accept_invalid_certs(!req.verify_ssl.unwrap_or(false)); // default true acceptance for local dev

    if let Some(false) = req.follow_redirects {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }

    let client = builder.build().map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    // Parse method
    let method = match req.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        other => return Err(format!("Unsupported HTTP method '{}'", other)),
    };

    let mut req_builder = client.request(method, request_url.clone());

    // Inject headers
    let mut has_content_type = false;
    for h in &req.headers {
        if h.enabled && !h.key.trim().is_empty() {
            let key = h.key.trim();
            if key.eq_ignore_ascii_case("content-type") {
                has_content_type = true;
            }
            if let (Ok(header_name), Ok(header_val)) = (
                reqwest::header::HeaderName::from_bytes(key.as_bytes()),
                reqwest::header::HeaderValue::from_str(&h.value)
            ) {
                req_builder = req_builder.header(header_name, header_val);
            }
        }
    }

    // Set host header override if tunneled
    if let Some(host_override) = host_header_override {
        if let Ok(val) = reqwest::header::HeaderValue::from_str(&host_override) {
            req_builder = req_builder.header(reqwest::header::HOST, val);
        }
    }

    // Inject User-Agent if not already provided
    req_builder = req_builder.header("User-Agent", "SSHDesktop-API-Studio/1.0");

    // Apply Body
    let body_type = req.body_type.to_lowercase();
    match body_type.as_str() {
        "json" => {
            if let Some(raw) = &req.raw_body {
                if !has_content_type {
                    req_builder = req_builder.header("Content-Type", "application/json");
                }
                req_builder = req_builder.body(raw.clone());
            }
        }
        "x-www-form-urlencoded" => {
            if let Some(raw) = &req.raw_body {
                if !has_content_type {
                    req_builder = req_builder.header("Content-Type", "application/x-www-form-urlencoded");
                }
                req_builder = req_builder.body(raw.clone());
            } else if let Some(items) = &req.form_data {
                let params: Vec<(&str, &str)> = items
                    .iter()
                    .filter(|i| i.enabled && !i.key.trim().is_empty())
                    .map(|i| (i.key.as_str(), i.value.as_str()))
                    .collect();
                req_builder = req_builder.form(&params);
            }
        }
        "form-data" => {
            if let Some(items) = &req.form_data {
                let mut form = reqwest::multipart::Form::new();
                for item in items.iter().filter(|i| i.enabled && !i.key.trim().is_empty()) {
                    form = form.text(item.key.clone(), item.value.clone());
                }
                req_builder = req_builder.multipart(form);
            }
        }
        "text" | "raw" => {
            if let Some(raw) = &req.raw_body {
                if !has_content_type {
                    req_builder = req_builder.header("Content-Type", "text/plain; charset=utf-8");
                }
                req_builder = req_builder.body(raw.clone());
            }
        }
        _ => {
            // "none" or other -> do not add body
        }
    }

    // Execute request with high-precision timing
    let start_time = Instant::now();
    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    let duration_ms = start_time.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("").to_string();

    let mut resp_headers = HashMap::new();
    for (name, val) in response.headers().iter() {
        if let Ok(v_str) = val.to_str() {
            resp_headers.insert(name.as_str().to_string(), v_str.to_string());
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;
    let size_bytes = bytes.len();

    let (body_text, is_binary, is_json) = match std::str::from_utf8(&bytes) {
        Ok(valid_str) => {
            let is_j = serde_json::from_str::<serde_json::Value>(valid_str).is_ok();
            (valid_str.to_string(), false, is_j)
        }
        Err(_) => {
            // Binary response: encode as Base64
            (to_base64(&bytes), true, false)
        }
    };

    Ok(ApiResponse {
        status,
        status_text,
        headers: resp_headers,
        body: body_text,
        is_json,
        is_binary,
        size_bytes,
        duration_ms,
        tunnel_used,
        tunneled_target,
        effective_url: request_url.to_string(),
    })
}
