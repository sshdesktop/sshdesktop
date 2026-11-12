fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn valid_package_name(value: &str) -> bool {
    !value.is_empty()
        && !value.starts_with('-')
        && value.len() <= 200
        && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '_' | ':' | '@' | '=' | '-'))
}

use serde::{Deserialize, Serialize};
use crate::AppState;
use crate::ssh::exec::{run_cmd, run_cmd_priv};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PackageInfo {
    pub name: String,
    pub version: String,
    pub size: String,
    pub description: String,
    pub arch: String,
    pub status: String,
}

/// Detect the package manager available on the remote system.
/// Returns: "apt" | "dnf" | "yum" | "pacman" | "zypper" | "apk" | "unknown"
async fn detect_pkg_manager(state: &AppState, conn_id: &str) -> String {
    let (out, _) = run_cmd(
        state,
        conn_id,
        "command -v dnf yum apt-get pacman zypper apk 2>/dev/null | head -n 1",
    ).await;
    let out = out.trim().to_lowercase();
    if out.contains("dnf") { return "dnf".into(); }
    if out.contains("yum") { return "yum".into(); }
    if out.contains("apt") || out.contains("dpkg") { return "apt".into(); }
    if out.contains("pacman") { return "pacman".into(); }
    if out.contains("zypper") { return "zypper".into(); }
    if out.contains("apk") { return "apk".into(); }
    "unknown".into()
}

#[tauri::command]
pub async fn package_list(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<PackageInfo>, String> {
    let pm = detect_pkg_manager(&state, &conn_id).await;

    let (stdout, code) = match pm.as_str() {
        "apt" => run_cmd(
            &state,
            &conn_id,
            "dpkg-query -W -f='${Package}\t${Version}\t${Installed-Size}\t${Architecture}\t${binary:Summary}\n' 2>/dev/null",
        ).await,
        "dnf" | "yum" | "zypper" => run_cmd(
            &state,
            &conn_id,
            "rpm -qa --queryformat '%{NAME}\t%{VERSION}-%{RELEASE}\t%{SIZE}\t%{ARCH}\t%{SUMMARY}\n' 2>/dev/null",
        ).await,
        "pacman" => run_cmd(
            &state,
            &conn_id,
            r#"pacman -Q 2>/dev/null | awk '{print $1"\t"$2"\t0\tall\tpacman package"}'"#,
        ).await,
        "apk" => run_cmd(
            &state,
            &conn_id,
            r#"apk info -v 2>/dev/null | awk -F'-' '{print $1"\t"$2"\t0\tall\talpine package"}'"#,
        ).await,
        _ => return Err("No supported package manager found (apt/dnf/yum/pacman/zypper/apk).".into()),
    };

    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err(format!("Failed to list installed packages (exit code {}): {}", code, stdout.trim()));
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.len() >= 4 {
            let name    = parts[0].trim().to_string();
            let version = parts[1].trim().to_string();
            let size_kb = parts[2].trim().parse::<u64>().unwrap_or(0);
            let arch    = parts[3].trim().to_string();
            let description = if parts.len() > 4 { parts[4].trim().to_string() } else { name.clone() };
            let size = if size_kb > 1024 * 1024 {
                format!("{:.1} GB", size_kb as f64 / 1024.0 / 1024.0)
            } else if size_kb > 1024 {
                format!("{:.1} MB", size_kb as f64 / 1024.0)
            } else {
                format!("{} KB", size_kb)
            };

            if !name.is_empty() {
                list.push(PackageInfo {
                    name, version, size, description, arch,
                    status: "installed".into(),
                });
            }
        }
    }

    if list.is_empty() {
        return Err("No installed packages found.".into());
    }

    Ok(list)
}

#[tauri::command]
pub async fn package_search(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    query: String,
) -> Result<Vec<PackageInfo>, String> {
    // Validate query
    if query.trim().is_empty() || query.len() > 128 || query.chars().any(|c| c.is_control()) {
        return Err("Search query must be 1–128 characters and contain no control characters.".into());
    }
    let query_arg = shell_quote(query.trim());

    let pm = detect_pkg_manager(&state, &conn_id).await;

    let (stdout, code) = match pm.as_str() {
        "apt" => run_cmd(
            &state,
            &conn_id,
            &format!("apt-cache search {} 2>/dev/null | head -n 20", query_arg),
        ).await,
        "dnf" => run_cmd(
            &state,
            &conn_id,
            &format!("dnf search {} 2>/dev/null | grep -v '^=\\|^Last' | head -n 20", query_arg),
        ).await,
        "yum" => run_cmd(
            &state,
            &conn_id,
            &format!("yum search {} 2>/dev/null | head -n 20", query_arg),
        ).await,
        _ => return Err("No supported package manager found.".into()),
    };

    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        if let Some(dash) = line.find(" - ") {
            let name = line[..dash].trim().to_string();
            let desc = line[dash + 3..].trim().to_string();
            if !name.is_empty() {
                list.push(PackageInfo {
                    name, version: "latest".into(), size: "—".into(),
                    description: desc, arch: "all".into(), status: "available".into(),
                });
            }
        } else if line.contains(':') {
            // dnf/yum format: "name.arch : description"
            let parts: Vec<&str> = line.splitn(2, ':').collect();
            if parts.len() == 2 {
                let name = parts[0].trim().trim_end_matches(".noarch").trim_end_matches(".x86_64").to_string();
                let desc = parts[1].trim().to_string();
                if !name.is_empty() && !desc.is_empty() {
                    list.push(PackageInfo {
                        name, version: "latest".into(), size: "—".into(),
                        description: desc, arch: "all".into(), status: "available".into(),
                    });
                }
            }
        }
    }

    if list.is_empty() {
        return Err(format!("No packages found matching '{}'.", query));
    }

    Ok(list)
}

fn build_install_command(pm: &str, raw_name: &str) -> (String, Option<String>) {
    let name = raw_name.trim();
    let lower = name.to_lowercase();
    let package_arg = shell_quote(name);

    // 1. MySQL / MariaDB Database Server & Client
    if lower == "mysql-server" || lower == "mysql" || lower == "mariadb-server" || lower == "mariadb" || lower == "mariadb105-server" || lower == "default-mysql-server" {
        let install_cmd = match pm {
            "dnf" => "(dnf install -y mysql-server 2>&1 || dnf install -y mariadb105-server 2>&1 || dnf install -y mariadb-server 2>&1 || dnf install -y mariadb 2>&1 || dnf install -y community-mysql-server 2>&1) && (dnf install -y mysql 2>&1 || dnf install -y mariadb 2>&1 || dnf install -y mariadb105 2>&1 || true)",
            "yum" => "(yum install -y mysql-server 2>&1 || yum install -y mariadb-server 2>&1 || yum install -y mariadb 2>&1) && (yum install -y mysql 2>&1 || yum install -y mariadb 2>&1 || true)",
            "pacman" => "(pacman -S --noconfirm mariadb mariadb-clients 2>&1 || pacman -S --noconfirm mariadb 2>&1 || pacman -S --noconfirm mysql 2>&1)",
            "zypper" => "(zypper --non-interactive in mariadb mariadb-client 2>&1 || zypper --non-interactive in mysql-community-server 2>&1)",
            "apk" => "(apk add --no-cache mariadb mariadb-client mariadb-server-utils 2>&1 || apk add --no-cache mysql mysql-client 2>&1)",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-server 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y default-mysql-server 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-server 2>&1) && (DEBIAN_FRONTEND=noninteractive apt-get install -y mysql-client 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y default-mysql-client 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y mariadb-client 2>&1 || true)",
        }.to_string();

        let post = "if [ ! -d /var/lib/mysql/mysql ]; then (mariadb-install-db --user=mysql --basedir=/usr --datadir=/var/lib/mysql 2>/dev/null || mysql_install_db --user=mysql --datadir=/var/lib/mysql 2>/dev/null || true); fi; (systemctl enable --now mariadb 2>/dev/null || systemctl enable --now mysqld 2>/dev/null || systemctl enable --now mysql 2>/dev/null || rc-service mariadb start 2>/dev/null || service mariadb start 2>/dev/null || service mysql start 2>/dev/null || service mysqld start 2>/dev/null || true); DB_INIT_PWD=$(openssl rand -hex 16 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \\n'); if [ -n \"$DB_INIT_PWD\" ]; then umask 077 && printf 'MySQL/MariaDB Initial Root Password: %s\\n' \"$DB_INIT_PWD\" > /root/.sshdesktop-mysql-init.txt; mysql -e \"CREATE USER IF NOT EXISTS 'root'@'127.0.0.1' IDENTIFIED BY '$DB_INIT_PWD'; GRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION; FLUSH PRIVILEGES;\" 2>/dev/null || true; mysql -e \"ALTER USER IF EXISTS 'root'@'localhost' IDENTIFIED BY '$DB_INIT_PWD'; FLUSH PRIVILEGES;\" 2>/dev/null || true; fi".to_string();
        return (install_cmd, Some(post));
    }

    // 2. PostgreSQL Server & Client
    if lower == "postgresql" || lower == "postgresql-server" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y postgresql-server postgresql 2>&1 || yum install -y postgresql-server postgresql 2>&1 || dnf install -y postgresql 2>&1 || yum install -y postgresql 2>&1)",
            "pacman" => "pacman -S --noconfirm postgresql 2>&1",
            "zypper" => "zypper --non-interactive in postgresql-server postgresql 2>&1",
            "apk" => "apk add --no-cache postgresql postgresql-contrib 2>&1",
            _ => "DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-contrib 2>&1",
        }.to_string();

        let post = "if [ ! -f /var/lib/pgsql/data/PG_VERSION ] && [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then (postgresql-setup --initdb 2>/dev/null || postgresql-setup initdb 2>/dev/null || su - postgres -c \"initdb -D '/var/lib/pgsql/data'\" 2>/dev/null || true); fi; (systemctl enable --now postgresql 2>/dev/null || rc-service postgresql start 2>/dev/null || service postgresql start 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // 3. Docker Engine
    if lower == "docker" || lower == "docker.io" || lower == "docker-ce" {
        let install_cmd = match pm {
            "dnf" => "(dnf install -y docker 2>&1 || dnf install -y docker-ce 2>&1 || dnf install -y podman-docker 2>&1)",
            "yum" => "(amazon-linux-extras install -y docker 2>/dev/null || yum install -y docker 2>&1 || yum install -y docker-ce 2>&1)",
            "pacman" => "pacman -S --noconfirm docker 2>&1",
            "zypper" => "zypper --non-interactive in docker 2>&1",
            "apk" => "apk add --no-cache docker 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce 2>&1)",
        }.to_string();

        let post = "(systemctl enable --now docker 2>/dev/null || rc-service docker start 2>/dev/null || service docker start 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // 4. Docker Compose
    if lower == "docker-compose" || lower == "docker-compose-plugin" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y docker-compose-plugin 2>&1 || yum install -y docker-compose-plugin 2>&1 || dnf install -y docker-compose 2>&1 || yum install -y docker-compose 2>&1 || (curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m) -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose 2>&1))",
            "pacman" => "pacman -S --noconfirm docker-compose 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose-plugin 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y docker-compose 2>&1 || (curl -fsSL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m) -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose 2>&1))",
        }.to_string();
        return (install_cmd, None);
    }

    // 5. Redis Server & Tools
    if lower == "redis" || lower == "redis-server" || lower == "redis-tools" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y redis 2>&1 || yum install -y redis 2>&1)",
            "pacman" => "pacman -S --noconfirm redis 2>&1",
            "apk" => "apk add --no-cache redis 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y redis-server redis-tools 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y redis 2>&1)",
        }.to_string();

        let post = "(systemctl enable --now redis 2>/dev/null || systemctl enable --now redis-server 2>/dev/null || rc-service redis start 2>/dev/null || service redis start 2>/dev/null || service redis-server start 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // 6. Apache2 / httpd
    if lower == "apache2" || lower == "httpd" || lower == "apache" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y httpd 2>&1 || yum install -y httpd 2>&1)",
            "pacman" => "pacman -S --noconfirm apache 2>&1",
            _ => "DEBIAN_FRONTEND=noninteractive apt-get install -y apache2 2>&1",
        }.to_string();

        let post = "(systemctl enable --now httpd 2>/dev/null || systemctl enable --now apache2 2>/dev/null || rc-service apache2 start 2>/dev/null || service httpd start 2>/dev/null || service apache2 start 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // 7. Nginx
    if lower == "nginx" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y nginx 2>&1 || yum install -y nginx 2>&1)",
            "pacman" => "pacman -S --noconfirm nginx 2>&1",
            "apk" => "apk add --no-cache nginx 2>&1",
            _ => "DEBIAN_FRONTEND=noninteractive apt-get install -y nginx 2>&1",
        }.to_string();

        let post = "(systemctl enable --now nginx 2>/dev/null || rc-service nginx start 2>/dev/null || service nginx start 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // 8. OpenJDK Java
    if lower.contains("openjdk") || lower.contains("jdk") || lower == "java" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y java-17-openjdk-devel 2>&1 || yum install -y java-17-openjdk-devel 2>&1 || dnf install -y java-21-openjdk-devel 2>&1 || dnf install -y java-11-openjdk-devel 2>&1 || dnf install -y java-17-openjdk 2>&1 || yum install -y java-1.8.0-openjdk-devel 2>&1)",
            "pacman" => "pacman -S --noconfirm jdk-openjdk 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y default-jdk 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-17-jdk 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-11-jdk 2>&1)",
        }.to_string();
        return (install_cmd, None);
    }

    // 9. Node.js & NPM
    if lower == "nodejs" || lower == "node" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y nodejs npm 2>&1 || yum install -y nodejs npm 2>&1 || dnf install -y nodejs 2>&1 || yum install -y nodejs 2>&1)",
            "pacman" => "pacman -S --noconfirm nodejs npm 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs 2>&1)",
        }.to_string();
        return (install_cmd, None);
    }

    // 10. Python 3 & PIP
    if lower == "python3" || lower == "python" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y python3 python3-pip 2>&1 || yum install -y python3 python3-pip 2>&1 || dnf install -y python3 2>&1)",
            "pacman" => "pacman -S --noconfirm python python-pip 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y python3 python3-pip 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y python3 2>&1)",
        }.to_string();
        return (install_cmd, None);
    }

    // 11. Go (Golang)
    if lower == "golang" || lower == "go" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y golang 2>&1 || yum install -y golang 2>&1)",
            "pacman" => "pacman -S --noconfirm go 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y golang 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y golang-go 2>&1)",
        }.to_string();
        return (install_cmd, None);
    }

    // 12. Rust & Cargo
    if lower == "rust" || lower == "rustc" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y rust cargo 2>&1 || yum install -y rust cargo 2>&1 || dnf install -y rust 2>&1)",
            "pacman" => "pacman -S --noconfirm rust 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y rustc cargo 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y rustc 2>&1)",
        }.to_string();
        return (install_cmd, None);
    }

    // 13. PHP & PHP-FPM
    if lower == "php" || lower == "php-fpm" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y php php-fpm php-cli php-mysqlnd 2>&1 || yum install -y php php-fpm 2>&1 || dnf install -y php 2>&1)",
            "pacman" => "pacman -S --noconfirm php php-fpm 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y php php-fpm php-mysql 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y php 2>&1)",
        }.to_string();

        let post = "(systemctl enable --now php-fpm 2>/dev/null || systemctl enable --now php8.1-fpm 2>/dev/null || systemctl enable --now php8.2-fpm 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // 14. AWS CLI
    if lower == "awscli" || lower == "aws-cli" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y awscli 2>&1 || yum install -y awscli 2>&1 || dnf install -y aws-cli 2>&1 || (curl -fsSL 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o /tmp/awscliv2.zip && unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install --update && rm -rf /tmp/aws /tmp/awscliv2.zip 2>&1))",
            "pacman" => "(pacman -S --noconfirm aws-cli 2>&1 || pacman -S --noconfirm awscli 2>&1)",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y awscli 2>&1 || (curl -fsSL 'https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip' -o /tmp/awscliv2.zip && unzip -q /tmp/awscliv2.zip -d /tmp && /tmp/aws/install --update && rm -rf /tmp/aws /tmp/awscliv2.zip 2>&1))",
        }.to_string();
        return (install_cmd, None);
    }

    // 15. kubectl (Kubernetes CLI)
    if lower == "kubectl" {
        let install_cmd = match pm {
            "pacman" => "pacman -S --noconfirm kubectl 2>&1",
            _ => "((command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y kubectl 2>&1) || (command -v dnf >/dev/null && dnf install -y kubectl 2>&1) || (curl -fsSL -o /usr/local/bin/kubectl \"https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt 2>/dev/null || echo 'v1.29.0')/bin/linux/amd64/kubectl\" && chmod +x /usr/local/bin/kubectl 2>&1))",
        }.to_string();
        return (install_cmd, None);
    }

    // 16. Helm (Kubernetes Package Manager)
    if lower == "helm" {
        let install_cmd = match pm {
            "pacman" => "pacman -S --noconfirm helm 2>&1",
            _ => "((command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y helm 2>&1) || (command -v dnf >/dev/null && dnf install -y helm 2>&1) || (curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash 2>&1))",
        }.to_string();
        return (install_cmd, None);
    }

    // 17. Terraform
    if lower == "terraform" {
        let install_cmd = match pm {
            "pacman" => "pacman -S --noconfirm terraform 2>&1",
            _ => "((command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y terraform 2>&1) || (command -v dnf >/dev/null && dnf install -y terraform 2>&1) || (curl -fsSL https://releases.hashicorp.com/terraform/1.7.5/terraform_1.7.5_linux_amd64.zip -o /tmp/tf.zip && unzip -o /tmp/tf.zip -d /usr/local/bin/ && chmod +x /usr/local/bin/terraform && rm -f /tmp/tf.zip 2>&1))",
        }.to_string();
        return (install_cmd, None);
    }

    // 18. k9s
    if lower == "k9s" {
        let install_cmd = match pm {
            "pacman" => "pacman -S --noconfirm k9s 2>&1",
            _ => "((command -v apt-get >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y k9s 2>&1) || (command -v dnf >/dev/null && dnf install -y k9s 2>&1) || (curl -fsSL https://github.com/derailed/k9s/releases/download/v0.32.4/k9s_Linux_amd64.tar.gz | tar -xz -C /usr/local/bin k9s && chmod +x /usr/local/bin/k9s 2>&1))",
        }.to_string();
        return (install_cmd, None);
    }

    // 19. Firewalls: UFW / Firewalld
    if lower == "ufw" || lower == "firewalld" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y firewalld 2>&1 || yum install -y firewalld 2>&1)",
            "pacman" => "(pacman -S --noconfirm firewalld 2>&1 || pacman -S --noconfirm ufw 2>&1)",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y ufw 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y firewalld 2>&1)",
        }.to_string();

        let post = "(systemctl enable --now firewalld 2>/dev/null || systemctl enable --now ufw 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // 20. WireGuard
    if lower == "wireguard" || lower == "wireguard-tools" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y wireguard-tools 2>&1 || yum install -y wireguard-tools 2>&1)",
            "pacman" => "pacman -S --noconfirm wireguard-tools 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard wireguard-tools 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y wireguard 2>&1)",
        }.to_string();
        return (install_cmd, None);
    }

    // 21. sqlite3
    if lower == "sqlite3" || lower == "sqlite" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y sqlite 2>&1 || yum install -y sqlite 2>&1)",
            "pacman" => "pacman -S --noconfirm sqlite 2>&1",
            _ => "DEBIAN_FRONTEND=noninteractive apt-get install -y sqlite3 2>&1",
        }.to_string();
        return (install_cmd, None);
    }

    // 22. Fail2ban
    if lower == "fail2ban" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y fail2ban 2>&1 || yum install -y fail2ban 2>&1 || dnf install -y epel-release && dnf install -y fail2ban 2>&1)",
            "pacman" => "pacman -S --noconfirm fail2ban 2>&1",
            _ => "DEBIAN_FRONTEND=noninteractive apt-get install -y fail2ban 2>&1",
        }.to_string();

        let post = "(systemctl enable --now fail2ban 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // 23. Memcached
    if lower == "memcached" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y memcached 2>&1 || yum install -y memcached 2>&1)",
            "pacman" => "pacman -S --noconfirm memcached 2>&1",
            _ => "DEBIAN_FRONTEND=noninteractive apt-get install -y memcached 2>&1",
        }.to_string();

        let post = "(systemctl enable --now memcached 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // 24. HAProxy
    if lower == "haproxy" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y haproxy 2>&1 || yum install -y haproxy 2>&1)",
            "pacman" => "pacman -S --noconfirm haproxy 2>&1",
            _ => "DEBIAN_FRONTEND=noninteractive apt-get install -y haproxy 2>&1",
        }.to_string();

        let post = "(systemctl enable --now haproxy 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // 25. QEMU / KVM
    if lower == "qemu-kvm" || lower.starts_with("qemu") {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y qemu-kvm 2>&1 || yum install -y qemu-kvm 2>&1)",
            "pacman" => "(pacman -S --noconfirm qemu-base 2>&1 || pacman -S --noconfirm qemu-full 2>&1)",
            _ => "DEBIAN_FRONTEND=noninteractive apt-get install -y qemu-kvm 2>&1",
        }.to_string();
        return (install_cmd, None);
    }

    // 26. bat (bat / batcat)
    if lower == "bat" || lower == "batcat" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y bat 2>&1 || yum install -y bat 2>&1)",
            "pacman" => "pacman -S --noconfirm bat 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y bat 2>&1 && (ln -sf /usr/bin/batcat /usr/local/bin/bat 2>/dev/null || true))",
        }.to_string();
        return (install_cmd, None);
    }

    // 27. eza / exa
    if lower == "eza" || lower == "exa" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y eza 2>&1 || dnf install -y exa 2>&1 || yum install -y exa 2>&1)",
            "pacman" => "(pacman -S --noconfirm eza 2>&1 || pacman -S --noconfirm exa 2>&1)",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y eza 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y exa 2>&1)",
        }.to_string();
        return (install_cmd, None);
    }

    // 28. Certbot
    if lower == "certbot" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y certbot 2>&1 || yum install -y certbot 2>&1)",
            "pacman" => "pacman -S --noconfirm certbot 2>&1",
            _ => "DEBIAN_FRONTEND=noninteractive apt-get install -y certbot 2>&1",
        }.to_string();
        return (install_cmd, None);
    }

    // 29. MongoDB
    if lower == "mongodb" || lower == "mongodb-org" || lower == "mongod" {
        let install_cmd = match pm {
            "dnf" | "yum" => "(dnf install -y mongodb-org 2>&1 || yum install -y mongodb-org 2>&1 || dnf install -y mongodb 2>&1)",
            "pacman" => "pacman -S --noconfirm mongodb-bin 2>&1 || pacman -S --noconfirm mongodb 2>&1",
            _ => "(DEBIAN_FRONTEND=noninteractive apt-get install -y mongodb-org 2>&1 || DEBIAN_FRONTEND=noninteractive apt-get install -y mongodb 2>&1)",
        }.to_string();

        let post = "(systemctl enable --now mongod 2>/dev/null || systemctl enable --now mongodb 2>/dev/null || true)".to_string();
        return (install_cmd, Some(post));
    }

    // Generic fallback for any other package name
    let install_cmd = match pm {
        "dnf" => format!("dnf install -y {} 2>&1", package_arg),
        "yum" => format!("yum install -y {} 2>&1", package_arg),
        "pacman" => format!("pacman -S --noconfirm {} 2>&1", package_arg),
        "zypper" => format!("zypper --non-interactive in {} 2>&1", package_arg),
        "apk" => format!("apk add --no-cache {} 2>&1", package_arg),
        _ => format!("DEBIAN_FRONTEND=noninteractive apt-get install -y {} 2>&1", package_arg),
    };

    let service_arg = shell_quote(&format!("{}.service", name));
    let post = format!(
        "if systemctl list-unit-files {} >/dev/null 2>&1; then systemctl enable --now {} 2>/dev/null || true; fi",
        service_arg, service_arg
    );
    (install_cmd, Some(post))
}

#[tauri::command]
pub async fn package_install(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    name: String,
) -> Result<String, String> {
    if !valid_package_name(&name) {
        return Err("Invalid package name. Use letters, numbers, '.', '+', '_', ':', '@', '=' or '-'.".into());
    }
    let package_arg = shell_quote(&name);

    let pm = detect_pkg_manager(&state, &conn_id).await;
    if pm == "unknown" {
        return Err("No supported package manager found; installation was not attempted.".into());
    }
    let (install_cmd, post_setup) = build_install_command(&pm, &name);

    let full_cmd = if let Some(post) = post_setup {
        format!("{} && (systemctl daemon-reload 2>/dev/null || true) && ({})", install_cmd, post)
    } else {
        format!("{} && (systemctl daemon-reload 2>/dev/null || true)", install_cmd)
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, &full_cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err(format!("Install failed: {}", stdout.trim()));
    }

    log::info!("SSH Desktop: Installed package {}", name);
    Ok(if !stdout.is_empty() { stdout } else { format!("Package '{}' installed successfully.", name) })
}

#[tauri::command]
pub async fn package_remove(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    name: String,
) -> Result<String, String> {
    if !valid_package_name(&name) {
        return Err("Invalid package name.".into());
    }
    let package_arg = shell_quote(&name);

    let pm = detect_pkg_manager(&state, &conn_id).await;
    let lower = name.to_lowercase();
    let is_mysql = lower == "mysql-server" || lower == "mysql" || lower == "mariadb-server" || lower == "mariadb" || lower == "mariadb105-server";

    let cmd = match pm.as_str() {
        "apt" => {
            if is_mysql {
                "DEBIAN_FRONTEND=noninteractive apt-get remove -y mysql-server default-mysql-server mariadb-server 2>&1 && (systemctl daemon-reload 2>/dev/null || true)".to_string()
            } else {
                format!("DEBIAN_FRONTEND=noninteractive apt-get remove -y {} 2>&1 && (systemctl daemon-reload 2>/dev/null || true)", package_arg)
            }
        },
        "dnf" => {
            if is_mysql {
                "dnf remove -y mysql-server mariadb-server mariadb105-server mariadb 2>&1 && (systemctl daemon-reload 2>/dev/null || true)".to_string()
            } else {
                format!("dnf remove -y {} 2>&1 && (systemctl daemon-reload 2>/dev/null || true)", package_arg)
            }
        },
        "yum" => {
            if is_mysql {
                "yum remove -y mysql-server mariadb-server mariadb 2>&1 && (systemctl daemon-reload 2>/dev/null || true)".to_string()
            } else {
                format!("yum remove -y {} 2>&1 && (systemctl daemon-reload 2>/dev/null || true)", package_arg)
            }
        },
        "pacman" => {
            if is_mysql {
                "pacman -R --noconfirm mariadb mariadb-clients mysql 2>&1 && (systemctl daemon-reload 2>/dev/null || true)".to_string()
            } else {
                format!("pacman -R --noconfirm {} 2>&1 && (systemctl daemon-reload 2>/dev/null || true)", package_arg)
            }
        },
        "zypper" => format!("zypper --non-interactive rm {} 2>&1 && (systemctl daemon-reload 2>/dev/null || true)", package_arg),
        "apk" => format!("apk del {} 2>&1", package_arg),
        _ => return Err("No supported package manager found.".into()),
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err(format!("Remove failed: {}", stdout.trim()));
    }

    log::info!("SSH Desktop: Removed package {}", name);
    Ok(if !stdout.is_empty() { stdout } else { format!("Package '{}' removed successfully.", name) })
}

#[tauri::command]
pub async fn package_update(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    let pm = detect_pkg_manager(&state, &conn_id).await;
    let cmd = match pm.as_str() {
        "apt"    => "apt-get update 2>&1",
        "dnf"    => "dnf check-update 2>&1",
        "yum"    => "yum check-update 2>&1",
        "pacman" => "pacman -Sy 2>&1",
        _ => return Err("No supported package manager found.".into()),
    };

    let (stdout, code) = run_cmd_priv(&state, &conn_id, cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }

    // apt-get update exits 0 on success; dnf/yum check-update exits 100 if updates available
    let expected_update_available = matches!(pm.as_str(), "dnf" | "yum") && code == 100;
    if code != 0 && !expected_update_available {
        return Err(format!("Package repository update failed (exit code {}): {}", code, stdout.trim()));
    }
    if !stdout.is_empty() {
        return Ok(stdout);
    }

    Ok("Package repositories updated.".into())
}

#[tauri::command]
pub async fn package_upgradable(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<Vec<PackageInfo>, String> {
    let pm = detect_pkg_manager(&state, &conn_id).await;

    let (stdout, code) = match pm.as_str() {
        "apt" => run_cmd(
            &state,
            &conn_id,
            "apt list --upgradable 2>/dev/null | tail -n +2",
        ).await,
        "dnf" => run_cmd(
            &state,
            &conn_id,
            "dnf list updates 2>/dev/null | tail -n +2",
        ).await,
        "yum" => run_cmd(
            &state,
            &conn_id,
            "yum list updates 2>/dev/null | tail -n +2",
        ).await,
        "pacman" => return Ok(vec![]), // pacman has no built-in upgradable-list command.
        _ => return Err(format!("Upgradable package listing is not supported for package manager '{}'.", pm)),
    };

    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    if code != 0 {
        return Err(format!("Failed to check upgradable packages (exit code {}): {}", code, stdout.trim()));
    }

    let mut list = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }

        // apt format: "nginx/jammy-updates 1.26.1-1 amd64 [upgradable from: 1.24.0-2]"
        // dnf format: "nginx.x86_64   1:1.26.1-1.el9   appstream"
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() { continue; }

        let raw_name = parts[0];
        let name = raw_name.split('/').next().unwrap_or(raw_name);
        let name = ["x86_64", "aarch64", "noarch", "i686", "i386", "armv7hl", "ppc64le", "s390x"]
            .iter()
            .find_map(|arch| name.strip_suffix(&format!(".{}", arch)))
            .unwrap_or(name)
            .to_string();
        let version = parts.get(1).copied().unwrap_or("latest").to_string();

        if !name.is_empty() {
            list.push(PackageInfo {
                name, version, size: "—".into(),
                description: "Upgradable package".into(),
                arch: "amd64".into(),
                status: "upgradable".into(),
            });
        }
    }

    Ok(list)
}

#[tauri::command]
pub async fn package_detect_manager(
    state: tauri::State<'_, AppState>,
    conn_id: String,
) -> Result<String, String> {
    Ok(detect_pkg_manager(&state, &conn_id).await)
}

fn build_preview_command(pm: &str, name: &str, action: &str) -> Result<String, String> {
    let package_arg = shell_quote(name);
    let cmd = match (pm, action) {
        ("apt", "install") => format!("DEBIAN_FRONTEND=noninteractive apt-get -s install {} 2>&1", package_arg),
        ("apt", "remove") => format!("DEBIAN_FRONTEND=noninteractive apt-get -s remove {} 2>&1", package_arg),
        ("dnf", "install") => format!("dnf install --assumeno {} 2>&1 || true", package_arg),
        ("dnf", "remove") => format!("dnf remove --assumeno {} 2>&1 || true", package_arg),
        ("yum", "install") => format!("yum install --assumeno {} 2>&1 || true", package_arg),
        ("yum", "remove") => format!("yum remove --assumeno {} 2>&1 || true", package_arg),
        ("pacman", "install") => format!("pacman -Sp --print-format '%n %v %s' {} 2>&1", package_arg),
        ("pacman", "remove") => format!("pacman -Rsp --print-format '%n %v %s' {} 2>&1", package_arg),
        ("zypper", "install") => format!("zypper --non-interactive install --dry-run {} 2>&1", package_arg),
        ("zypper", "remove") => format!("zypper --non-interactive rm --dry-run {} 2>&1", package_arg),
        ("apk", "install") => format!("apk add --simulate {} 2>&1", package_arg),
        ("apk", "remove") => format!("apk del --simulate {} 2>&1", package_arg),
        _ => return Err(format!("Dependency simulation preview is unsupported for package manager '{}'.", pm)),
    };
    Ok(cmd)
}

#[tauri::command]
pub async fn package_preview(
    state: tauri::State<'_, AppState>,
    conn_id: String,
    name: String,
    action: String,
) -> Result<String, String> {
    if !valid_package_name(&name) {
        return Err("Invalid package name.".into());
    }
    let clean_action = match action.trim().to_ascii_lowercase().as_str() {
        "install" => "install",
        "remove" => "remove",
        _ => return Err("Action must be 'install' or 'remove'.".into()),
    };
    let pm = detect_pkg_manager(&state, &conn_id).await;
    let cmd = build_preview_command(&pm, &name, clean_action)?;
    let (stdout, code) = run_cmd_priv(&state, &conn_id, &cmd).await;
    if code == -1 {
        return Err("No active SSH connection.".into());
    }
    Ok(if stdout.trim().is_empty() {
        format!("No additional dependency changes reported for {} ({}).", name, clean_action)
    } else {
        stdout
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_command_uses_non_destructive_dry_run_flags() {
        assert!(build_preview_command("apt", "nginx", "install").unwrap().contains("apt-get -s install"));
        assert!(build_preview_command("dnf", "nginx", "remove").unwrap().contains("--assumeno"));
        assert!(build_preview_command("apk", "curl", "install").unwrap().contains("--simulate"));
        assert!(build_preview_command("unknown", "curl", "install").is_err());
    }
}
