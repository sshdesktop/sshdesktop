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

    // Route through SSH when enabled
    if req.use_ssh_tunnel {
        let conn_id = match req.conn_id.as_deref() {
            Some(id) if !id.trim().is_empty() => id.to_string(),
            _ => {
                let connections = state.connections.lock();
                connections.keys().next().cloned().ok_or_else(|| {
                    "No active SSH connection found. Please connect to an SSH server in SSH Desktop to route requests through SSH, or toggle SSH Tunnel OFF for direct requests.".to_string()
                })?
            }
        };

        // 1. Primary path: Execute request via remote SSH server (natively handles HTTPS, TLS/SNI, and public/internal APIs)
        match execute_remote_ssh_request(&state, &conn_id, &req, &parsed_url).await {
            Ok(resp) => return Ok(resp),
            Err(remote_err) => {
                log::warn!("SSH Desktop: Remote SSH curl execution failed ({}), checking local tunnel fallback...", remote_err);

                let is_localhost = original_host.eq_ignore_ascii_case("localhost")
                    || original_host == "127.0.0.1"
                    || original_host == "0.0.0.0"
                    || original_host == "::1";

                // If target is a local plain HTTP service, attempt port forwarding tunnel fallback
                if scheme == "http" && is_localhost {
                    return execute_local_tunneled_request(&state, &conn_id, &req, &parsed_url, original_port).await;
                } else {
                    return Err(remote_err);
                }
            }
        }
    }

    // Direct local network execution (SSH Tunnel: OFF)
    execute_direct_request(&req, &parsed_url).await
}

/// Executes an HTTP/HTTPS request directly on the remote Linux host over SSH
async fn execute_remote_ssh_request(
    state: &tauri::State<'_, AppState>,
    conn_id: &str,
    req: &ApiRequest,
    parsed_url: &url::Url,
) -> Result<ApiResponse, String> {
    // 1. Append enabled query parameters to URL
    let mut target_url = parsed_url.clone();
    {
        let mut query_pairs = target_url.query_pairs().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>();
        for q in &req.query_params {
            if q.enabled && !q.key.trim().is_empty() {
                query_pairs.push((q.key.trim().to_string(), q.value.to_string()));
            }
        }
        if !req.query_params.is_empty() {
            target_url.set_query(None);
            let mut serializer = target_url.query_pairs_mut();
            for (k, v) in query_pairs {
                serializer.append_pair(&k, &v);
            }
        }
    }
    let target_url_str = target_url.to_string();

    // 2. Build curl arguments
    let timeout_secs = req.timeout_seconds.unwrap_or(30).clamp(1, 300);
    let mut curl_args = format!("-s -S -i -X {} --max-time {}", req.method.to_uppercase(), timeout_secs);

    if req.follow_redirects.unwrap_or(true) {
        curl_args.push_str(" -L");
    }
    if !req.verify_ssl.unwrap_or(false) {
        curl_args.push_str(" -k");
    }

    let mut has_content_type = false;
    for h in &req.headers {
        if h.enabled && !h.key.trim().is_empty() {
            let key = h.key.trim();
            if key.eq_ignore_ascii_case("content-type") {
                has_content_type = true;
            }
            curl_args.push_str(&format!(" -H '{}: {}'", key.replace('\'', "'\\''"), h.value.replace('\'', "'\\''")));
        }
    }

    // Body preparation
    let body_type = req.body_type.to_lowercase();
    let body_bytes_opt: Option<Vec<u8>> = match body_type.as_str() {
        "json" => {
            if let Some(raw) = &req.raw_body {
                if !has_content_type {
                    curl_args.push_str(" -H 'Content-Type: application/json'");
                }
                Some(raw.as_bytes().to_vec())
            } else {
                None
            }
        }
        "x-www-form-urlencoded" => {
            if let Some(raw) = &req.raw_body {
                if !has_content_type {
                    curl_args.push_str(" -H 'Content-Type: application/x-www-form-urlencoded'");
                }
                Some(raw.as_bytes().to_vec())
            } else if let Some(items) = &req.form_data {
                let params: Vec<String> = items.iter().filter(|i| i.enabled && !i.key.trim().is_empty())
                    .map(|i| {
                        let k = url::form_urlencoded::byte_serialize(i.key.as_bytes()).collect::<String>();
                        let v = url::form_urlencoded::byte_serialize(i.value.as_bytes()).collect::<String>();
                        format!("{}={}", k, v)
                    })
                    .collect();
                if !has_content_type {
                    curl_args.push_str(" -H 'Content-Type: application/x-www-form-urlencoded'");
                }
                Some(params.join("&").into_bytes())
            } else {
                None
            }
        }
        "text" | "raw" => {
            if let Some(raw) = &req.raw_body {
                if !has_content_type {
                    curl_args.push_str(" -H 'Content-Type: text/plain; charset=utf-8'");
                }
                Some(raw.as_bytes().to_vec())
            } else {
                None
            }
        }
        _ => None,
    };

    curl_args.push_str(&format!(" '{}'", target_url_str.replace('\'', "'\\''")));

    // 3. Assemble shell pipeline with base64 for safe binary/text transfer
    let remote_cmd = if let Some(body_bytes) = body_bytes_opt {
        let b64 = to_base64(&body_bytes);
        format!("printf '%s' '{}' | base64 -d | curl {} --data-binary @- 2>&1 | base64", b64, curl_args)
    } else {
        format!("curl {} 2>&1 | base64", curl_args)
    };

    let start_time = Instant::now();
    let (stdout, exit_code) = crate::ssh::exec::run_cmd(state, conn_id, &remote_cmd).await;
    let duration_ms = start_time.elapsed().as_millis() as u64;

    // Decode base64 stdout
    let raw_bytes = if let Some(bytes) = crate::database::tunnel::from_base64(&stdout) {
        bytes
    } else {
        if exit_code != 0 && stdout.trim().is_empty() {
            return Err("Remote SSH process failed to execute request. Ensure the remote SSH server is reachable and active.".to_string());
        }
        stdout.into_bytes()
    };

    parse_curl_bytes(&raw_bytes, duration_ms, &target_url_str, conn_id)
}

/// Parses raw HTTP response output from curl -i
fn parse_curl_bytes(
    bytes: &[u8],
    duration_ms: u64,
    effective_url: &str,
    server_info: &str,
) -> Result<ApiResponse, String> {
    if bytes.is_empty() {
        return Err("Remote SSH server returned an empty response. Check if target server is listening and reachable from the remote host.".to_string());
    }

    // A curl -i response contains HTTP response blocks.
    // If redirects were followed, there may be multiple "HTTP/..." blocks.
    // We look for the last block delimiter where the block starts with b"HTTP/".
    let mut header_start = 0;
    let mut header_end = None;
    let mut delim_len = 4;

    let mut idx = 0;
    while idx + 4 <= bytes.len() {
        if &bytes[idx..idx + 4] == b"\r\n\r\n" {
            let next_pos = idx + 4;
            if next_pos + 5 <= bytes.len() && &bytes[next_pos..next_pos + 5] == b"HTTP/" {
                header_start = next_pos;
                idx = next_pos;
                continue;
            } else {
                header_end = Some(idx);
                delim_len = 4;
                break;
            }
        }
        idx += 1;
    }

    if header_end.is_none() {
        idx = 0;
        while idx + 2 <= bytes.len() {
            if &bytes[idx..idx + 2] == b"\n\n" {
                let next_pos = idx + 2;
                if next_pos + 5 <= bytes.len() && &bytes[next_pos..next_pos + 5] == b"HTTP/" {
                    header_start = next_pos;
                    idx = next_pos;
                    continue;
                } else {
                    header_end = Some(idx);
                    delim_len = 2;
                    break;
                }
            }
            idx += 1;
        }
    }

    let end_idx = match header_end {
        Some(e) => e,
        None => {
            // Did not find HTTP delimiter, output is likely a curl error or failure message
            let text = String::from_utf8_lossy(bytes);
            return Err(format!("Remote SSH request failed: {}", text.trim()));
        }
    };

    let header_bytes = &bytes[header_start..end_idx];
    let body_bytes = &bytes[end_idx + delim_len..];

    let header_str = String::from_utf8_lossy(header_bytes);
    let mut lines = header_str.lines();

    let status_line = lines.next().ok_or_else(|| "Empty HTTP status line from SSH response".to_string())?;
    let mut status_parts = status_line.split_whitespace();
    let _http_version = status_parts.next().unwrap_or("HTTP/1.1");
    let status_code: u16 = status_parts
        .next()
        .and_then(|c| c.parse().ok())
        .unwrap_or(200);
    let status_text = status_parts.collect::<Vec<_>>().join(" ");

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_string(), v.trim().to_string());
        }
    }

    let size_bytes = body_bytes.len();
    let (body_text, is_binary, is_json) = match std::str::from_utf8(body_bytes) {
        Ok(valid_str) => {
            let is_j = serde_json::from_str::<serde_json::Value>(valid_str).is_ok();
            (valid_str.to_string(), false, is_j)
        }
        Err(_) => {
            (to_base64(body_bytes), true, false)
        }
    };

    Ok(ApiResponse {
        status: status_code,
        status_text,
        headers,
        body: body_text,
        is_json,
        is_binary,
        size_bytes,
        duration_ms,
        tunnel_used: true,
        tunneled_target: Some(format!("{} (via SSH on {})", effective_url, server_info)),
        effective_url: effective_url.to_string(),
    })
}

/// Fallback for localhost plain HTTP services via local port forwarding tunnel
async fn execute_local_tunneled_request(
    state: &tauri::State<'_, AppState>,
    conn_id: &str,
    req: &ApiRequest,
    parsed_url: &url::Url,
    original_port: u16,
) -> Result<ApiResponse, String> {
    let local_tunnel_port = crate::ssh::tunnel::ssh_start_tunnel(
        (*state).clone(),
        conn_id.to_string(),
        0,
        "127.0.0.1".to_string(),
        original_port,
        None,
    ).await.map_err(|e| format!("Failed to establish SSH tunnel for API request: {}", e))?;

    let path_and_query = match parsed_url.query() {
        Some(q) => format!("{}?{}", parsed_url.path(), q),
        None => parsed_url.path().to_string(),
    };

    let tunneled_url_str = format!("http://127.0.0.1:{}{}", local_tunnel_port, path_and_query);
    let tunneled_url = url::Url::parse(&tunneled_url_str)
        .map_err(|e| format!("Failed to parse tunneled URL: {}", e))?;

    let mut direct_resp = execute_direct_request(req, &tunneled_url).await?;
    direct_resp.tunnel_used = true;
    direct_resp.tunneled_target = Some(format!("127.0.0.1:{} (via local :{})", original_port, local_tunnel_port));
    direct_resp.effective_url = parsed_url.to_string();
    Ok(direct_resp)
}

/// Direct HTTP client execution via local reqwest
async fn execute_direct_request(
    req: &ApiRequest,
    parsed_url: &url::Url,
) -> Result<ApiResponse, String> {
    let mut request_url = parsed_url.clone();
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

    let timeout_secs = req.timeout_seconds.unwrap_or(30).clamp(1, 300);
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .danger_accept_invalid_certs(!req.verify_ssl.unwrap_or(false));

    if let Some(false) = req.follow_redirects {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    }

    let client = builder.build().map_err(|e| format!("Failed to build HTTP client: {}", e))?;

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

    req_builder = req_builder.header("User-Agent", "SSHDesktop-API-Studio/1.0");

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
        _ => {}
    }

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
        tunnel_used: false,
        tunneled_target: None,
        effective_url: request_url.to_string(),
    })
}
