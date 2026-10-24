use serde::{Deserialize, Serialize};
use reqwest::header::{HeaderMap, HeaderValue};
use std::time::Duration;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProxiedPageResponse {
    pub status: u16,
    pub content_type: String,
    pub body: String,
    pub final_url: String,
}

#[tauri::command]
pub async fn browser_proxy_fetch(url: String) -> Result<ProxiedPageResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .danger_accept_invalid_certs(true)
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
        .map_err(|e| format!("Proxy request to '{}' failed: {}", url, e))?;

    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/html")
        .to_string();

    let mut body = response
        .text()
        .await
        .map_err(|e| format!("Failed to read proxy response body: {}", e))?;

    // If HTML, inject base href and remove frame-busting scripts / tags
    if content_type.contains("text/html") {
        let base_tag = format!("<base href=\"{}\" />\n", final_url);
        if let Some(pos) = body.to_lowercase().find("<head>") {
            body.insert_str(pos + 6, &base_tag);
        } else if let Some(pos) = body.to_lowercase().find("<html>") {
            body.insert_str(pos + 6, &format!("<head>{}</head>", base_tag));
        } else {
            body = format!("{}\n{}", base_tag, body);
        }
    }

    Ok(ProxiedPageResponse {
        status,
        content_type,
        body,
        final_url,
    })
}
