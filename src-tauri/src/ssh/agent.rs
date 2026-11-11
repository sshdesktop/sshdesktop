use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentIdentity {
    pub bits: u32,
    pub fingerprint: String,
    pub comment: String,
    pub key_type: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SshAgentStatus {
    pub is_running: bool,
    pub identities: Vec<AgentIdentity>,
    pub socket_path: Option<String>,
    pub message: String,
}

#[tauri::command]
pub async fn ssh_agent_get_status() -> Result<SshAgentStatus, String> {
    let mut cmd = tokio::process::Command::new("ssh-add");
    #[cfg(windows)]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    cmd.arg("-l");

    cmd.kill_on_drop(true);
    let output = match tokio::time::timeout(std::time::Duration::from_secs(15), cmd.output()).await {
        Ok(Ok(out)) => out,
        Ok(Err(e)) => {
            return Ok(SshAgentStatus {
                is_running: false,
                identities: Vec::new(),
                socket_path: None,
                message: format!("ssh-add binary not available or failed: {}", e),
            });
        }
        Err(_) => {
            return Ok(SshAgentStatus {
                is_running: false,
                identities: Vec::new(),
                socket_path: std::env::var("SSH_AUTH_SOCK").ok(),
                message: "SSH agent status check timed out after 15 seconds".to_string(),
            });
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    let socket_path = std::env::var("SSH_AUTH_SOCK").ok();

    if !output.status.success() {
        if stdout.contains("The agent has no identities") || stderr.contains("The agent has no identities") {
            return Ok(SshAgentStatus {
                is_running: true,
                identities: Vec::new(),
                socket_path,
                message: "SSH Agent is running (no keys loaded currently)".to_string(),
            });
        }

        if stderr.contains("Could not open a connection") || stderr.contains("Communication with agent failed") {
            return Ok(SshAgentStatus {
                is_running: false,
                identities: Vec::new(),
                socket_path,
                message: "SSH Agent service is not currently running".to_string(),
            });
        }
    }

    let mut identities = Vec::new();

    // Parse standard OpenSSH ssh-add -l output:
    // e.g.: "256 SHA256:abcd1234... /home/user/.ssh/id_ed25519 (ED25519)"
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 {
            let bits = parts[0].parse::<u32>().unwrap_or(0);
            let fingerprint = parts[1].to_string();
            let raw_comment = parts[2..].join(" ");

            let (comment, ktype) = if let Some(idx) = raw_comment.rfind('(') {
                let c = raw_comment[..idx].trim().to_string();
                let kt = raw_comment[idx..].trim_matches('(').trim_matches(')').trim().to_string();
                (c, kt)
            } else {
                (raw_comment, "Unknown".to_string())
            };

            identities.push(AgentIdentity {
                bits,
                fingerprint,
                comment,
                key_type: ktype,
            });
        }
    }

    Ok(SshAgentStatus {
        is_running: true,
        identities,
        socket_path,
        message: "SSH Agent active".to_string(),
    })
}
