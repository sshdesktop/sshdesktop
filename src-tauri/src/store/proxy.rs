use serde::{Deserialize, Serialize};
use std::time::Duration;
use futures::StreamExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProxiedPageResponse {
    pub status: u16,
    pub content_type: String,
    pub body: String,
    pub final_url: String,
}

fn is_public_ip(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            let o = ip.octets();
            let shared_address_space = o[0] == 100 && (64..=127).contains(&o[1]);
            let reserved = o[0] == 0
                || (o[0] == 192 && o[1] == 0 && o[2] == 0)
                || (o[0] == 192 && o[1] == 0 && o[2] == 2)
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19 || o[1] == 51 && o[2] == 100))
                || (o[0] == 203 && o[1] == 0 && o[2] == 113)
                || o[0] >= 240;
            !ip.is_private()
                && !ip.is_loopback()
                && !ip.is_link_local()
                && !ip.is_broadcast()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !shared_address_space
                && !reserved
        }
        std::net::IpAddr::V6(ip) => {
            let segments = ip.segments();
            let global_unicast = (segments[0] & 0xe000) == 0x2000;
            let documentation = segments[0] == 0x2001 && segments[1] == 0x0db8;
            global_unicast
                && !documentation
                && !ip.is_loopback()
                && !ip.is_unspecified()
                && !ip.is_multicast()
                && !ip.is_unique_local()
                && !ip.is_unicast_link_local()
                && ip.to_ipv4_mapped().map(is_public_ip).unwrap_or(true)
        }
    }
}

async fn resolve_public_url(url: &url::Url) -> Result<Vec<std::net::SocketAddr>, String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Only HTTP and HTTPS URLs are allowed".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("URLs containing embedded credentials are not allowed".into());
    }
    let host = url.host_str().ok_or_else(|| "URL has no hostname".to_string())?;
    if host.eq_ignore_ascii_case("localhost")
        || host.ends_with(".localhost")
        || host.ends_with(".local")
    {
        return Err("Requests to local hostnames are blocked".into());
    }
    let port = url.port_or_known_default().ok_or_else(|| "Unsupported URL port".to_string())?;
    let addresses: Vec<std::net::SocketAddr> = match host.parse::<std::net::IpAddr>() {
        Ok(ip) => vec![std::net::SocketAddr::new(ip, port)],
        Err(_) => tokio::net::lookup_host((host, port))
            .await
            .map_err(|e| format!("Could not resolve URL hostname: {}", e))?
            .collect(),
    };
    if addresses.is_empty() || addresses.iter().any(|addr| !is_public_ip(addr.ip())) {
        return Err("Requests to private, loopback, link-local, or reserved IP addresses are blocked".into());
    }
    Ok(addresses)
}

#[tauri::command]
pub async fn browser_proxy_fetch(url: String) -> Result<ProxiedPageResponse, String> {
    let mut current = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    let response = {
        let mut response = None;
        for _ in 0..=5 {
            // Resolve and validate each redirect target, then pin reqwest to those
            // validated addresses to reduce DNS-rebinding/TOCTOU SSRF exposure.
            let addresses = resolve_public_url(&current).await?;
            let host = current.host_str().ok_or_else(|| "URL has no hostname".to_string())?;
            let mut builder = reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none());
            if host.parse::<std::net::IpAddr>().is_err() {
                builder = builder.resolve_to_addrs(host, &addresses);
            }
            let client = builder.build()
                .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
            let candidate = client
                .get(current.clone())
                .header("User-Agent", "Mozilla/5.0 (compatible; SSHDesktop/2.x)")
                .send()
                .await
                .map_err(|e| format!("Proxy request failed: {}", e))?;
            if candidate.status().is_redirection() {
                let location = candidate.headers().get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| "Redirect response did not include a valid Location header".to_string())?;
                current = current.join(location)
                    .map_err(|e| format!("Invalid redirect URL: {}", e))?;
                continue;
            }
            response = Some(candidate);
            break;
        }
        response.ok_or_else(|| "Too many redirects".to_string())?
    };

    let status = response.status().as_u16();
    let final_url = response.url().to_string();
    let content_type = response.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("text/plain")
        .to_string();

    if response.content_length().map(|n| n > 5 * 1024 * 1024).unwrap_or(false) {
        return Err("Proxy response exceeded the 5 MiB size limit".into());
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Failed to read proxy response body: {}", e))?;
        if bytes.len().saturating_add(chunk.len()) > 5 * 1024 * 1024 {
            return Err("Proxy response exceeded the 5 MiB size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let mut body = String::from_utf8_lossy(&bytes).into_owned();

    if content_type.to_ascii_lowercase().contains("text/html") {
        let base_tag = format!("<base href=\"{}\" />\n", final_url);
        let lower = body.to_lowercase();
        if let Some(pos) = lower.find("<head>") {
            body.insert_str(pos + 6, &base_tag);
        } else if let Some(pos) = lower.find("<html>") {
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
