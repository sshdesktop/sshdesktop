use std::sync::Arc;
use russh::*;
use russh::client::*;
use russh_keys::PublicKeyBase64;
use directories::BaseDirs;

pub struct ClientHandler {
    pub host: String,
    pub port: u16,
}

#[async_trait::async_trait]
impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let key_type = server_public_key.name().to_string();
        let b64 = server_public_key.public_key_base64();

        let (status, msg, _) = crate::ssh::known_hosts::check_known_hosts(&self.host, self.port, &key_type, &b64);
        if status == "trusted" {
            return Ok(true);
        }

        if status == "changed" {
            log::error!(
                "SECURITY ALERT: Remote host identification for {}:{} has changed! {}",
                self.host, self.port, msg
            );
            return Ok(false);
        }

        log::warn!(
            "Host {}:{} is not verified in known_hosts (status: {}). Connection rejected until host key is explicitly verified and trusted by user.",
            self.host, self.port, status
        );
        Ok(false)
    }
}

pub type ClientHandle = russh::client::Handle<ClientHandler>;

pub async fn run_exec_channel(
    handle: &ClientHandle,
    cmd: &str,
) -> Result<(String, i32), Box<dyn std::error::Error + Send + Sync>> {
    let mut channel = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        handle.channel_open_session()
    ).await.map_err(|_| "Timed out opening SSH execution channel")??;
    // Non-interactive commands must not allocate a PTY: PTYs transform line endings,
    // merge streams, and can corrupt structured/binary command output.
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        channel.exec(true, cmd)
    ).await.map_err(|_| "Timed out starting remote command")??;
    let mut stdout = Vec::new();
    let mut exit_code = -1;
    const MAX_OUTPUT_BYTES: usize = 80 * 1024 * 1024;

    let completed = tokio::time::timeout(std::time::Duration::from_secs(120), async {
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { ref data } => {
                    if stdout.len().saturating_add(data.len()) > MAX_OUTPUT_BYTES {
                        return true;
                    }
                    stdout.extend_from_slice(data);
                }
                ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                    if stdout.len().saturating_add(data.len()) > MAX_OUTPUT_BYTES {
                        return true;
                    }
                    stdout.extend_from_slice(data);
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = exit_status as i32;
                }
                _ => {}
            }
        }
        false
    }).await;

    match completed {
        Err(_) => return Err("Remote command timed out after 120 seconds; SSH channel was closed.".into()),
        Ok(true) => return Err("Remote command output exceeded the 80 MiB safety limit.".into()),
        Ok(false) => {}
    }

    let clean_out = String::from_utf8_lossy(&stdout).replace("\r\n", "\n");
    Ok((clean_out, exit_code))
}

pub async fn run_exec_channel_with_stdin(
    handle: &ClientHandle,
    cmd: &str,
    stdin_data: &[u8],
) -> Result<(String, i32), Box<dyn std::error::Error + Send + Sync>> {
    let result = tokio::time::timeout(std::time::Duration::from_secs(300), async {
        let mut channel = tokio::time::timeout(
            std::time::Duration::from_secs(15),
            handle.channel_open_session()
        ).await.map_err(|_| "Timed out opening SSH input channel")??;
        // Stdin pipes require a non-PTY channel and a real EOF.
        tokio::time::timeout(
            std::time::Duration::from_secs(15),
            channel.exec(true, cmd)
        ).await.map_err(|_| "Timed out starting remote input command")??;

        // SSH channel packets are small; send large file payloads in bounded chunks.
        for chunk in stdin_data.chunks(32 * 1024) {
            channel.data(chunk).await?;
        }
        channel.eof().await?;

        let mut stdout = Vec::new();
        let mut exit_code = -1;
        const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { ref data } => {
                    if stdout.len().saturating_add(data.len()) > MAX_OUTPUT_BYTES {
                        return Err("Remote command output exceeded the 16 MiB safety limit.".into());
                    }
                    stdout.extend_from_slice(data);
                }
                ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                    if stdout.len().saturating_add(data.len()) > MAX_OUTPUT_BYTES {
                        return Err("Remote command output exceeded the 16 MiB safety limit.".into());
                    }
                    stdout.extend_from_slice(data);
                }
                ChannelMsg::ExitStatus { exit_status } => exit_code = exit_status as i32,
                _ => {}
            }
        }
        let clean_out = String::from_utf8_lossy(&stdout).replace("\r\n", "\n");
        Ok::<(String, i32), Box<dyn std::error::Error + Send + Sync>>((clean_out, exit_code))
    }).await;

    match result {
        Ok(inner) => inner,
        Err(_) => {
            log::warn!("SSH Desktop: run_exec_channel_with_stdin timed out after 300s for cmd: {}", cmd);
            Err("Command timed out while sending input or waiting for remote completion.".into())
        }
    }
}

pub async fn run_stream_channel(
    app: &tauri::AppHandle,
    handle: &ClientHandle,
    stream_id: &str,
    cmd: &str,
) -> Result<i32, Box<dyn std::error::Error + Send + Sync>> {
    use tauri::Emitter;
    let mut channel = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        handle.channel_open_session()
    ).await.map_err(|_| "Timed out opening SSH execution channel")??;
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        channel.exec(true, cmd)
    ).await.map_err(|_| "Timed out starting remote command")??;
    let mut exit_code = -1;

    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { ref data } => {
                let text = String::from_utf8_lossy(data).to_string();
                let _ = app.emit("exec-output", crate::ssh::exec::StreamChunk {
                    stream_id: stream_id.to_string(),
                    data: text,
                    is_stderr: false,
                    is_done: false,
                    exit_code: None,
                });
            }
            ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                let text = String::from_utf8_lossy(data).to_string();
                let _ = app.emit("exec-output", crate::ssh::exec::StreamChunk {
                    stream_id: stream_id.to_string(),
                    data: text,
                    is_stderr: true,
                    is_done: false,
                    exit_code: None,
                });
            }
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = exit_status as i32;
            }
            _ => {}
        }
    }

    let _ = app.emit("exec-output", crate::ssh::exec::StreamChunk {
        stream_id: stream_id.to_string(),
        data: String::new(),
        is_stderr: false,
        is_done: true,
        exit_code: Some(exit_code),
    });

    Ok(exit_code)
}

pub async fn run_log_stream_channel(
    app: &tauri::AppHandle,
    handle: &ClientHandle,
    stream_id: &str,
    command: &str,
) -> Result<i32, Box<dyn std::error::Error + Send + Sync>> {
    use tauri::Emitter;
    let mut channel = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        handle.channel_open_session()
    ).await.map_err(|_| "Timed out opening SSH log channel")??;
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        channel.exec(true, command)
    ).await.map_err(|_| "Timed out starting remote log stream")??;
    let mut exit_code = -1;
    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { ref data } => {
                let _ = app.emit("log-stream-data", serde_json::json!({
                    "stream_id": stream_id,
                    "data": String::from_utf8_lossy(data).to_string(),
                    "done": false
                }));
            }
            ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                let _ = app.emit("log-stream-data", serde_json::json!({
                    "stream_id": stream_id,
                    "data": String::from_utf8_lossy(data).to_string(),
                    "done": false
                }));
            }
            ChannelMsg::ExitStatus { exit_status } => exit_code = exit_status as i32,
            _ => {}
        }
    }
    let _ = app.emit("log-stream-data", serde_json::json!({
        "stream_id": stream_id,
        "data": "",
        "done": true,
        "exit_code": exit_code
    }));
    Ok(exit_code)
}

pub async fn connect_session(
    host: &str,
    port: u16,
    user: &str,
    password: Option<&str>,
    key_path: Option<&str>,
) -> Result<ClientHandle, Box<dyn std::error::Error + Send + Sync>> {
    connect_session_with_passphrase(host, port, user, password, key_path, None).await
}

pub async fn connect_session_with_passphrase(
    host: &str,
    port: u16,
    user: &str,
    password: Option<&str>,
    key_path: Option<&str>,
    passphrase: Option<&str>,
) -> Result<ClientHandle, Box<dyn std::error::Error + Send + Sync>> {
    connect_session_with_passphrase_auth(host, port, user, password, key_path, passphrase, true).await
}

pub async fn connect_session_with_passphrase_auth(
    host: &str,
    port: u16,
    user: &str,
    password: Option<&str>,
    key_path: Option<&str>,
    passphrase: Option<&str>,
    allow_default_keys: bool,
) -> Result<ClientHandle, Box<dyn std::error::Error + Send + Sync>> {
    let config = Arc::new(russh::client::Config::default());
    let handler = ClientHandler {
        host: host.to_string(),
        port,
    };
    let mut handle = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        russh::client::connect(config, (host, port), handler)
    ).await??;

    let mut authenticated = false;

    // Priority 1 & 3: Custom or specified Key path
    if let Some(key_p) = key_path {
        let trimmed_key = key_p.trim();
        if !trimmed_key.is_empty() {
            // 1. Try loading from file path
            if let Ok(key) = russh_keys::load_secret_key(trimmed_key, passphrase) {
                authenticated = tokio::time::timeout(
                    std::time::Duration::from_secs(15),
                    handle.authenticate_publickey(user, Arc::new(key))
                ).await.ok().and_then(Result::ok).unwrap_or(false);
            }
            // 2. Try decoding directly as PEM string
            if !authenticated {
                if let Ok(key) = russh_keys::decode_secret_key(trimmed_key, passphrase) {
                    authenticated = tokio::time::timeout(
                        std::time::Duration::from_secs(15),
                        handle.authenticate_publickey(user, Arc::new(key))
                    ).await.ok().and_then(Result::ok).unwrap_or(false);
                }
            }
            // 3. Try reading file on disk then decoding content
            if !authenticated {
                if let Ok(content) = std::fs::read_to_string(trimmed_key) {
                    if let Ok(key) = russh_keys::decode_secret_key(&content, passphrase) {
                        authenticated = tokio::time::timeout(
                            std::time::Duration::from_secs(15),
                            handle.authenticate_publickey(user, Arc::new(key))
                        ).await.ok().and_then(Result::ok).unwrap_or(false);
                    }
                }
            }
        }
    }

    // An explicitly selected identity is an authentication boundary. Never
    // silently substitute another local key or a password if that identity fails.
    if key_path.map(|p| !p.trim().is_empty()).unwrap_or(false) && !authenticated {
        return Err("Authentication failed: the explicitly selected SSH key was rejected or could not be loaded. No alternate credentials were attempted.".into());
    }

    // Only use agent-independent default identities when the user did not
    // explicitly select a key for this connection.
    // Priority 2: Standard ~/.ssh/ default keys (id_ed25519, id_rsa, id_ecdsa)
    if allow_default_keys && !authenticated && key_path.map(|p| p.trim().is_empty()).unwrap_or(true) {
        if let Some(base) = BaseDirs::new() {
            let ssh_dir = base.home_dir().join(".ssh");
            let default_keys = ["id_ed25519", "id_rsa", "id_ecdsa"];
            for key_name in default_keys {
                let candidate = ssh_dir.join(key_name);
                if candidate.exists() {
                    if let Ok(key) = russh_keys::load_secret_key(&candidate, passphrase) {
                        if tokio::time::timeout(
                            std::time::Duration::from_secs(15),
                            handle.authenticate_publickey(user, Arc::new(key))
                        ).await.ok().and_then(Result::ok).unwrap_or(false) {
                            log::info!("SSH Desktop: Authenticated successfully using default key ~/.ssh/{}", key_name);
                            authenticated = true;
                            break;
                        }
                    }
                }
            }
        }
    }

    // Priority 4: Password authentication fallback
    if !authenticated {
        if let Some(pwd) = password {
            if !pwd.is_empty() {
                authenticated = tokio::time::timeout(
                    std::time::Duration::from_secs(15),
                    handle.authenticate_password(user, pwd)
                ).await.map_err(|_| "SSH password authentication timed out")??;
            }
        }
    }

    if authenticated {
        Ok(handle)
    } else {
        Err("Authentication failed: No valid SSH keys or password accepted by server".into())
    }
}

pub async fn open_sftp(
    handle: &ClientHandle,
) -> Result<russh_sftp::client::SftpSession, Box<dyn std::error::Error + Send + Sync>> {
    let channel = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        handle.channel_open_session()
    ).await.map_err(|_| "Timed out opening SFTP channel")??;
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        channel.request_subsystem(true, "sftp")
    ).await.map_err(|_| "Timed out requesting the SFTP subsystem")??;
    let sftp = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        russh_sftp::client::SftpSession::new(channel.into_stream())
    ).await.map_err(|_| "Timed out initializing SFTP")??;
    Ok(sftp)
}

pub async fn open_pty_shell(
    handle: &ClientHandle,
    term: &str,
    cols: u32,
    rows: u32,
) -> Result<(tokio::io::ReadHalf<russh::ChannelStream<russh::client::Msg>>, tokio::io::WriteHalf<russh::ChannelStream<russh::client::Msg>>), Box<dyn std::error::Error + Send + Sync>> {
    let channel = tokio::time::timeout(
        std::time::Duration::from_secs(15),
        handle.channel_open_session()
    ).await.map_err(|_| "Timed out opening terminal channel")??;
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        channel.request_pty(false, term, cols, rows, 0, 0, &[])
    ).await.map_err(|_| "Timed out requesting terminal PTY")??;
    tokio::time::timeout(
        std::time::Duration::from_secs(15),
        channel.request_shell(true)
    ).await.map_err(|_| "Timed out starting remote shell")??;
    let stream = channel.into_stream();
    Ok(tokio::io::split(stream))
}
