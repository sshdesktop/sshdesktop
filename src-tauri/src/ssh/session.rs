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
) -> Result<(String, String, i32), Box<dyn std::error::Error + Send + Sync>> {
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
    let mut stderr = Vec::new();
    let mut exit_code: Option<i32> = None;
    const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;

    let completed = tokio::time::timeout(std::time::Duration::from_secs(120), async {
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { ref data } => {
                    if stdout.len() + stderr.len() + data.len() <= MAX_OUTPUT_BYTES {
                        stdout.extend_from_slice(data);
                    } else {
                        return true;
                    }
                }
                ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                    if stdout.len() + stderr.len() + data.len() <= MAX_OUTPUT_BYTES {
                        stderr.extend_from_slice(data);
                    } else {
                        return true;
                    }
                }
                ChannelMsg::ExitStatus { exit_status } => {
                    exit_code = Some(exit_status as i32);
                }
                _ => {}
            }
        }
        false
    }).await;

    match completed {
        Err(_) => return Err("Remote command timed out after 120 seconds; SSH channel was closed.".into()),
        Ok(true) => return Err("Remote command output exceeded the 64 MiB safety limit.".into()),
        Ok(false) => {}
    }

    let exit_code = exit_code.ok_or("SSH channel closed without a remote exit status")?;
    let clean_stdout = String::from_utf8_lossy(&stdout).replace("\r\n", "\n");
    let clean_stderr = String::from_utf8_lossy(&stderr).replace("\r\n", "\n");
    Ok((clean_stdout, clean_stderr, exit_code))
}

pub async fn run_exec_channel_with_stdin(
    handle: &ClientHandle,
    cmd: &str,
    stdin_data: &[u8],
 ) -> Result<(String, i32), Box<dyn std::error::Error + Send + Sync>> {
    const MAX_STDIN_BYTES: usize = 64 * 1024 * 1024;
    if stdin_data.len() > MAX_STDIN_BYTES {
        return Err("Remote command input exceeded the 64 MiB safety limit.".into());
    }
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
            tokio::time::timeout(std::time::Duration::from_secs(15), channel.data(chunk))
                .await.map_err(|_| "Timed out sending SSH command input")??;
        }
        tokio::time::timeout(std::time::Duration::from_secs(15), channel.eof())
            .await.map_err(|_| "Timed out closing SSH command input")??;

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let mut exit_code: Option<i32> = None;
        const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
        while let Some(msg) = channel.wait().await {
            match msg {
                ChannelMsg::Data { ref data } => {
                    if stdout.len() + stderr.len() + data.len() > MAX_OUTPUT_BYTES {
                        return Err("Remote command output exceeded the 16 MiB safety limit.".into());
                    }
                    stdout.extend_from_slice(data);
                }
                ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                    if stdout.len() + stderr.len() + data.len() > MAX_OUTPUT_BYTES {
                        return Err("Remote command output exceeded the 16 MiB safety limit.".into());
                    }
                    stderr.extend_from_slice(data);
                }
                ChannelMsg::ExitStatus { exit_status } => exit_code = Some(exit_status as i32),
                _ => {}
            }
        }
        let exit_code = exit_code.ok_or("SSH input channel closed without a remote exit status")?;
        let clean_stdout = String::from_utf8_lossy(&stdout).replace("\r\n", "\n");
        let clean_stderr = String::from_utf8_lossy(&stderr).replace("\r\n", "\n");
        let clean_out = if !clean_stderr.is_empty() && !clean_stdout.is_empty() {
            format!("{}\n{}", clean_stdout.trim_end(), clean_stderr.trim_start())
        } else if !clean_stderr.is_empty() {
            clean_stderr
        } else {
            clean_stdout
        };
        Ok::<(String, i32), Box<dyn std::error::Error + Send + Sync>>((clean_out, exit_code))
    }).await;

    match result {
        Ok(inner) => inner,
        Err(_) => {
            log::warn!("SSH Desktop: run_exec_channel_with_stdin timed out after 300s");
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
    let mut exit_code: Option<i32> = None;
    let mut total_streamed: usize = 0;
    const MAX_STREAM_BYTES: usize = 64 * 1024 * 1024;

    loop {
        let msg = match tokio::time::timeout(std::time::Duration::from_secs(300), channel.wait()).await {
            Ok(msg) => msg,
            Err(_) => {
                let _ = app.emit("exec-output", crate::ssh::exec::StreamChunk {
                    stream_id: stream_id.to_string(),
                    data: "\r\n[SSH command stream timed out after 5 minutes without output]\r\n".into(),
                    is_stderr: true,
                    is_done: true,
                    exit_code: Some(1),
                });
                return Err("SSH command stream was idle for 5 minutes".into());
            }
        };
        let Some(msg) = msg else { break };
        match msg {
            ChannelMsg::Data { ref data } => {
                total_streamed = total_streamed.saturating_add(data.len());
                if total_streamed > MAX_STREAM_BYTES {
                    let _ = app.emit("exec-output", crate::ssh::exec::StreamChunk {
                        stream_id: stream_id.to_string(),
                        data: "\r\n[Stream output exceeded maximum 64 MiB safety buffer]\r\n".into(),
                        is_stderr: true,
                        is_done: true,
                        exit_code: Some(1),
                    });
                    let _ = channel.eof().await;
                    return Ok(1);
                }
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
                total_streamed = total_streamed.saturating_add(data.len());
                if total_streamed > MAX_STREAM_BYTES {
                    let _ = app.emit("exec-output", crate::ssh::exec::StreamChunk {
                        stream_id: stream_id.to_string(),
                        data: "\r\n[Stream output exceeded maximum 64 MiB safety buffer]\r\n".into(),
                        is_stderr: true,
                        is_done: true,
                        exit_code: Some(1),
                    });
                    let _ = channel.eof().await;
                    return Ok(1);
                }
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
                exit_code = Some(exit_status as i32);
            }
            ChannelMsg::Eof => {
                // RFC 4254 sends EOF before ExitStatus and Close; keep reading until Close.
            }
            ChannelMsg::Close => {
                break;
            }
            _ => {}
        }
    }

    let exit_code = exit_code.ok_or("SSH stream closed without a remote exit status")?;
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
    let mut total_streamed: usize = 0;
    const MAX_LOG_STREAM_BYTES: usize = 64 * 1024 * 1024;
    loop {
        let msg = match tokio::time::timeout(
            std::time::Duration::from_secs(300),
            channel.wait()
        ).await {
            Ok(msg) => msg,
            Err(_) => {
                let _ = app.emit("log-stream-data", serde_json::json!({
                    "stream_id": stream_id,
                    "data": "\r\n[SSH log stream timed out after 5 minutes without output]\r\n",
                    "done": true,
                    "exit_code": 1
                }));
                return Err("SSH log stream was idle for 5 minutes".into());
            }
        };
        let Some(msg) = msg else { break };
        match msg {
            ChannelMsg::Data { ref data } => {
                total_streamed = total_streamed.saturating_add(data.len());
                if total_streamed > MAX_LOG_STREAM_BYTES {
                    let _ = app.emit("log-stream-data", serde_json::json!({
                        "stream_id": stream_id,
                        "data": "\r\n[Log stream exceeded maximum 64 MiB safety limit]\r\n",
                        "done": true,
                        "exit_code": 1
                    }));
                    let _ = channel.eof().await;
                    return Ok(1);
                }
                let _ = app.emit("log-stream-data", serde_json::json!({
                    "stream_id": stream_id,
                    "data": String::from_utf8_lossy(data).to_string(),
                    "done": false
                }));
            }
            ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                total_streamed = total_streamed.saturating_add(data.len());
                if total_streamed > MAX_LOG_STREAM_BYTES {
                    let _ = app.emit("log-stream-data", serde_json::json!({
                        "stream_id": stream_id,
                        "data": "\r\n[Log stream exceeded maximum 64 MiB safety limit]\r\n",
                        "done": true,
                        "exit_code": 1
                    }));
                    let _ = channel.eof().await;
                    return Ok(1);
                }
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

async fn close_rejected_ssh_handle(handle: &ClientHandle) {
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(800),
        handle.disconnect(
            russh::Disconnect::ByApplication,
            "SSH authentication was not completed",
            "en",
        ),
    ).await;
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
    crate::ssh::connection::validate_ssh_target(host, port, user)
        .map_err(|error| format!("Invalid SSH connection target: {}", error))?;
    if key_path.map(|key| key.len() > 16 * 1024 * 1024).unwrap_or(false) {
        return Err("SSH identity input exceeds the 16 MiB safety limit.".into());
    }
    if password.map(|value| value.len() > 16 * 1024).unwrap_or(false) {
        return Err("SSH password exceeds the 16 KiB safety limit.".into());
    }
    if passphrase.map(|value| value.len() > 16 * 1024).unwrap_or(false) {
        return Err("SSH key passphrase exceeds the 16 KiB safety limit.".into());
    }
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
            // Validate a path before any parser follows it. Inline PEM content is
            // not a filesystem path and simply produces a NotFound result here.
            if let Ok(metadata) = std::fs::symlink_metadata(trimmed_key) {
                if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 {
                    close_rejected_ssh_handle(&handle).await;
                return Err("Selected SSH identity is not a regular non-symlink file or exceeds 16 MiB".into());
                }
            }
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
                if let Ok(metadata) = std::fs::symlink_metadata(trimmed_key) {
                    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 {
                        close_rejected_ssh_handle(&handle).await;
                        return Err("Selected SSH identity is not a regular file or exceeds 16 MiB".into());
                    }
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
    }

    // An explicitly selected identity is an authentication boundary. Never
    // silently substitute another local key or a password if that identity fails.
    if key_path.map(|p| !p.trim().is_empty()).unwrap_or(false) && !authenticated {
        close_rejected_ssh_handle(&handle).await;
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
                if let Ok(metadata) = std::fs::symlink_metadata(&candidate) {
                    if metadata.file_type().is_symlink() || !metadata.is_file() || metadata.len() > 16 * 1024 * 1024 {
                        continue;
                    }
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
        close_rejected_ssh_handle(&handle).await;
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

fn validate_pty_parameters(term: &str, cols: u32, rows: u32) -> Result<(), &'static str> {
    if term.is_empty()
        || term.len() > 64
        || term.chars().any(|ch| ch.is_control() || ch.is_whitespace())
    {
        return Err("Invalid terminal type.");
    }
    if !(1..=1000).contains(&cols) || !(1..=1000).contains(&rows) {
        return Err("Terminal dimensions must be between 1 and 1000.");
    }
    Ok(())
}

pub async fn open_pty_channel(
    handle: &ClientHandle,
    term: &str,
    cols: u32,
    rows: u32,
) -> Result<russh::Channel<russh::client::Msg>, Box<dyn std::error::Error + Send + Sync>> {
    validate_pty_parameters(term, cols, rows)?;
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
    Ok(channel)
}

pub async fn open_pty_shell(
    handle: &ClientHandle,
    term: &str,
    cols: u32,
    rows: u32,
) -> Result<(tokio::io::ReadHalf<russh::ChannelStream<russh::client::Msg>>, tokio::io::WriteHalf<russh::ChannelStream<russh::client::Msg>>), Box<dyn std::error::Error + Send + Sync>> {
    validate_pty_parameters(term, cols, rows)?;
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
