use std::sync::Arc;
use russh::*;
use russh::client::*;

pub struct ClientHandler;

#[async_trait::async_trait]
impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub type ClientHandle = russh::client::Handle<ClientHandler>;

pub async fn run_exec_channel(
    handle: &ClientHandle,
    cmd: &str,
) -> Result<(String, i32), Box<dyn std::error::Error + Send + Sync>> {
    let mut channel = handle.channel_open_session().await?;
    channel.exec(true, cmd).await?;
    let mut stdout = Vec::new();
    let mut exit_code = 0;

    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { ref data } => {
                stdout.extend_from_slice(data);
            }
            ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                stdout.extend_from_slice(data);
            }
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = exit_status as i32;
            }
            _ => {}
        }
    }

    Ok((String::from_utf8_lossy(&stdout).to_string(), exit_code))
}

pub async fn run_exec_channel_with_stdin(
    handle: &ClientHandle,
    cmd: &str,
    stdin_data: &[u8],
) -> Result<(String, i32), Box<dyn std::error::Error + Send + Sync>> {
    let mut channel = handle.channel_open_session().await?;
    channel.exec(true, cmd).await?;
    if !stdin_data.is_empty() {
        channel.data(stdin_data).await?;
    }
    channel.eof().await?;
    let mut stdout = Vec::new();
    let mut exit_code = 0;

    while let Some(msg) = channel.wait().await {
        match msg {
            ChannelMsg::Data { ref data } => {
                stdout.extend_from_slice(data);
            }
            ChannelMsg::ExtendedData { ref data, ext: 1 } => {
                stdout.extend_from_slice(data);
            }
            ChannelMsg::ExitStatus { exit_status } => {
                exit_code = exit_status as i32;
            }
            _ => {}
        }
    }

    Ok((String::from_utf8_lossy(&stdout).to_string(), exit_code))
}

pub async fn run_stream_channel(
    app: &tauri::AppHandle,
    handle: &ClientHandle,
    stream_id: &str,
    cmd: &str,
) -> Result<i32, Box<dyn std::error::Error + Send + Sync>> {
    use tauri::Emitter;
    let mut channel = handle.channel_open_session().await?;
    channel.exec(true, cmd).await?;
    let mut exit_code = 0;

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

pub async fn connect_session(
    host: &str,
    port: u16,
    user: &str,
    password: Option<&str>,
    key_path: Option<&str>,
) -> Result<ClientHandle, Box<dyn std::error::Error + Send + Sync>> {
    let config = Arc::new(russh::client::Config::default());
    let mut handle = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        russh::client::connect(config, (host, port), ClientHandler)
    ).await??;

    let mut authenticated = false;

    if let Some(key_p) = key_path {
        let trimmed_key = key_p.trim();
        if !trimmed_key.is_empty() {
            // 1. Try loading from file path
            if let Ok(key) = russh_keys::load_secret_key(trimmed_key, None) {
                authenticated = handle.authenticate_publickey(user, Arc::new(key)).await.unwrap_or(false);
            }
            // 2. Try decoding directly as PEM string
            if !authenticated {
                if let Ok(key) = russh_keys::decode_secret_key(trimmed_key, None) {
                    authenticated = handle.authenticate_publickey(user, Arc::new(key)).await.unwrap_or(false);
                }
            }
            // 3. Try reading file on disk then decoding content
            if !authenticated {
                if let Ok(content) = std::fs::read_to_string(trimmed_key) {
                    if let Ok(key) = russh_keys::decode_secret_key(&content, None) {
                        authenticated = handle.authenticate_publickey(user, Arc::new(key)).await.unwrap_or(false);
                    }
                }
            }
        }
    }

    if !authenticated {
        if let Some(pwd) = password {
            if !pwd.is_empty() {
                authenticated = handle.authenticate_password(user, pwd).await?;
            }
        }
    }

    if authenticated {
        Ok(handle)
    } else {
        Err("Authentication failed".into())
    }
}

pub async fn open_sftp(
    handle: &ClientHandle,
) -> Result<russh_sftp::client::SftpSession, Box<dyn std::error::Error + Send + Sync>> {
    let channel = handle.channel_open_session().await?;
    channel.request_subsystem(true, "sftp").await?;
    let sftp = russh_sftp::client::SftpSession::new(channel.into_stream()).await?;
    Ok(sftp)
}

pub async fn open_pty_shell(
    handle: &ClientHandle,
    term: &str,
    cols: u32,
    rows: u32,
) -> Result<(tokio::io::ReadHalf<russh::ChannelStream<russh::client::Msg>>, tokio::io::WriteHalf<russh::ChannelStream<russh::client::Msg>>), Box<dyn std::error::Error + Send + Sync>> {
    let channel = handle.channel_open_session().await?;
    channel.request_pty(false, term, cols, rows, 0, 0, &[]).await?;
    channel.request_shell(true).await?;
    let stream = channel.into_stream();
    Ok(tokio::io::split(stream))
}







