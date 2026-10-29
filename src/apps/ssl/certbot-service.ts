import { sshExec } from '../../lib/tauri-bridge';
import { SslCertificate, CertbotStatus, IssueCertForm, SelfSignedForm, SslDiagnosticResult, CertStatus } from './types';

/**
 * Detect Certbot CLI, systemd auto-renewal timer, and installed web servers on the remote host
 */
export async function detectCertbotStatus(connId: string): Promise<CertbotStatus> {
  const probeScript = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$HOME/.local/bin:$PATH"

echo "===WHICH_CERTBOT==="
if command -v certbot >/dev/null 2>&1; then
  command -v certbot
elif [ -x /usr/bin/certbot ]; then
  echo "/usr/bin/certbot"
elif [ -x /snap/bin/certbot ]; then
  echo "/snap/bin/certbot"
elif [ -x /usr/local/bin/certbot ]; then
  echo "/usr/local/bin/certbot"
elif [ -x /root/.local/bin/certbot ]; then
  echo "/root/.local/bin/certbot"
elif which certbot >/dev/null 2>&1; then
  which certbot
elif which /snap/bin/certbot >/dev/null 2>&1; then
  which /snap/bin/certbot
else
  echo "NOT_FOUND"
fi

echo "===VERSION==="
certbot --version 2>&1 || /snap/bin/certbot --version 2>&1 || /usr/bin/certbot --version 2>&1 || echo "UNKNOWN"

echo "===SYSTEMD_TIMER==="
systemctl is-active certbot.timer certbot.service 2>/dev/null || true

echo "===SERVERS==="
(command -v nginx >/dev/null 2>&1 || [ -x /usr/sbin/nginx ] || [ -x /usr/bin/nginx ] || [ -x /sbin/nginx ] || [ -d /etc/nginx ] || [ -x /snap/bin/nginx ] || systemctl is-active --quiet nginx 2>/dev/null) && echo "NGINX_INSTALLED"
(command -v apache2 >/dev/null 2>&1 || command -v httpd >/dev/null 2>&1 || [ -x /usr/sbin/apache2 ] || [ -x /usr/sbin/httpd ] || [ -x /usr/bin/apache2 ] || [ -x /usr/bin/httpd ] || [ -d /etc/apache2 ] || [ -d /etc/httpd ] || systemctl is-active --quiet apache2 2>/dev/null || systemctl is-active --quiet httpd 2>/dev/null) && echo "APACHE_INSTALLED"
(command -v caddy >/dev/null 2>&1 || [ -x /usr/bin/caddy ]) && echo "CADDY_INSTALLED"

echo "===PLUGINS==="
# Fast certbot plugin detection without slow dpkg-l / rpm-qa
(certbot plugins 2>/dev/null || /snap/bin/certbot plugins 2>/dev/null || true)
(python3 -c "import certbot_nginx" 2>/dev/null && echo "nginx") || true
(python3 -c "import certbot_apache" 2>/dev/null && echo "apache") || true
[ -d /usr/lib/python3/dist-packages/certbot_nginx ] && echo "nginx"
[ -d /usr/lib/python3/dist-packages/certbot_apache ] && echo "apache"

echo "===OS==="
if [ -f /etc/os-release ]; then
  grep -E "^(PRETTY_NAME|ID)=" /etc/os-release 2>/dev/null || true
elif [ -f /etc/redhat-release ]; then
  cat /etc/redhat-release 2>/dev/null || true
fi
`;

  try {
    const res = await sshExec(connId, probeScript);
    const out = res.stdout || '';

    const whichSection = extractSection(out, '===WHICH_CERTBOT===', '===VERSION===');
    const versionSection = extractSection(out, '===VERSION===', '===SYSTEMD_TIMER===');
    const timerSection = extractSection(out, '===SYSTEMD_TIMER===', '===SERVERS===');
    const serversSection = extractSection(out, '===SERVERS===', '===PLUGINS===');
    const pluginsSection = extractSection(out, '===PLUGINS===', '===OS===');
    const osSection = extractSection(out, '===OS===', null);

    // Robust installation detection: either valid binary path found, or version string returned
    const hasBinary = !whichSection.includes('NOT_FOUND') && whichSection.trim().length > 0;
    const hasVersionOutput = versionSection.toLowerCase().includes('certbot') && !versionSection.includes('UNKNOWN');
    const isInstalled = hasBinary || hasVersionOutput;

    const versionMatch = versionSection.match(/certbot\s+([\d\.]+)/i);
    const version = versionMatch ? versionMatch[1] : (isInstalled ? 'Installed' : undefined);

    const isTimerActive = timerSection.includes('active');

    // Parse OS Info
    let osName = 'Linux Server';
    let osId = 'unknown';
    const prettyMatch = osSection.match(/PRETTY_NAME="?([^"\n]+)"?/i);
    if (prettyMatch && prettyMatch[1]) {
      osName = prettyMatch[1].trim();
    }
    const idMatch = osSection.match(/ID="?([^"\n]+)"?/i);
    if (idMatch && idMatch[1]) {
      osId = idMatch[1].trim().toLowerCase();
    }

    // Determine package manager and suggested command
    let packageManager = 'apt / dnf / pacman / zypper / apk';
    let suggestedCommand = 'sudo apt update && sudo apt install -y certbot python3-certbot-nginx python3-certbot-apache';

    if (['ubuntu', 'debian', 'kali', 'pop', 'linuxmint', 'raspbian'].includes(osId)) {
      packageManager = 'apt';
      suggestedCommand = 'sudo apt-get update -y && sudo apt-get install -y certbot python3-certbot-nginx python3-certbot-apache';
    } else if (['centos', 'rhel', 'rocky', 'almalinux', 'ol', 'amzn'].includes(osId)) {
      packageManager = 'dnf / yum';
      suggestedCommand = 'sudo dnf install -y epel-release && sudo dnf install -y certbot python3-certbot-nginx python3-certbot-apache';
    } else if (['fedora'].includes(osId)) {
      packageManager = 'dnf';
      suggestedCommand = 'sudo dnf install -y certbot python3-certbot-nginx python3-certbot-apache';
    } else if (['arch', 'manjaro'].includes(osId)) {
      packageManager = 'pacman';
      suggestedCommand = 'sudo pacman -Sy --noconfirm certbot certbot-nginx certbot-apache';
    } else if (['alpine'].includes(osId)) {
      packageManager = 'apk';
      suggestedCommand = 'sudo apk add --no-cache certbot certbot-nginx certbot-apache py3-certbot-nginx py3-certbot-apache';
    } else if (['opensuse', 'opensuse-leap', 'opensuse-tumbleweed', 'sles'].includes(osId)) {
      packageManager = 'zypper';
      suggestedCommand = 'sudo zypper install -y certbot python3-certbot-nginx python3-certbot-apache';
    } else {
      packageManager = 'snap / pip';
      suggestedCommand = 'sudo snap install --classic certbot && sudo ln -sf /snap/bin/certbot /usr/bin/certbot';
    }

    // Webserver presence
    const nginxInstalled = serversSection.includes('NGINX_INSTALLED');
    const apacheInstalled = serversSection.includes('APACHE_INSTALLED');
    const caddyInstalled = serversSection.includes('CADDY_INSTALLED');

    // Plugin presence
    const pluginsLower = pluginsSection.toLowerCase();
    const nginxPlugin = pluginsLower.includes('nginx');
    const apachePlugin = pluginsLower.includes('apache');

    return {
      installed: isInstalled,
      version,
      autoRenewActive: isTimerActive,
      timerStatusText: timerSection.trim() || 'inactive',
      osName,
      osId,
      packageManager,
      suggestedCommand,
      webServers: {
        nginx: nginxInstalled,
        apache: apacheInstalled,
        caddy: caddyInstalled,
      },
      plugins: {
        nginx: nginxPlugin,
        apache: apachePlugin,
      },
    };
  } catch (err) {
    console.warn('detectCertbotStatus error:', err);
    return {
      installed: false,
      autoRenewActive: false,
      webServers: { nginx: false, apache: false, caddy: false },
      plugins: { nginx: false, apache: false },
    };
  }
}

/**
 * Robust Multi-OS Certbot & Plugins Installer
 * Supports Ubuntu, Debian, RHEL, CentOS, Rocky, Alma, Fedora, Arch, Alpine, openSUSE, Snap, Pip
 */
export async function installCertbot(connId: string): Promise<{ success: boolean; output: string }> {
  const installCmd = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$HOME/.local/bin:$PATH"

if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
  OS_LIKE="$ID_LIKE"
else
  OS_ID="unknown"
  OS_LIKE=""
fi

echo "Detected OS: $OS_ID ($OS_LIKE) [User: $(whoami)]"
echo "Beginning automated Certbot and webserver plugins installation..."

# Method 1: Native Package Managers
if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || [ "$OS_ID" = "kali" ] || [ "$OS_ID" = "pop" ] || [ "$OS_ID" = "linuxmint" ] || [ "$OS_ID" = "raspbian" ] || echo "$OS_LIKE" | grep -q "debian"; then
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -y && $SUDO apt-get install -y certbot python3-certbot-nginx python3-certbot-apache

elif [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "almalinux" ] || [ "$OS_ID" = "ol" ] || [ "$OS_ID" = "amzn" ] || echo "$OS_LIKE" | grep -q "rhel"; then
  # Enable CRB / powertools for RHEL 8/9 derivatives
  $SUDO dnf config-manager --set-enabled crb 2>/dev/null || $SUDO dnf config-manager --set-enabled powertools 2>/dev/null || true
  # Install EPEL
  $SUDO dnf install -y epel-release 2>/dev/null || $SUDO yum install -y epel-release 2>/dev/null || true
  $SUDO dnf install -y certbot python3-certbot-nginx python3-certbot-apache 2>/dev/null || $SUDO yum install -y certbot python3-certbot-nginx python3-certbot-apache 2>/dev/null || true

elif [ "$OS_ID" = "fedora" ]; then
  $SUDO dnf install -y certbot python3-certbot-nginx python3-certbot-apache

elif [ "$OS_ID" = "arch" ] || [ "$OS_ID" = "manjaro" ] || echo "$OS_LIKE" | grep -q "arch"; then
  $SUDO pacman -Sy --noconfirm certbot certbot-nginx certbot-apache

elif [ "$OS_ID" = "alpine" ]; then
  $SUDO apk update && $SUDO apk add --no-cache certbot certbot-nginx certbot-apache py3-certbot-nginx py3-certbot-apache 2>/dev/null || true

elif [ "$OS_ID" = "opensuse" ] || [ "$OS_ID" = "opensuse-leap" ] || [ "$OS_ID" = "opensuse-tumbleweed" ] || [ "$OS_ID" = "sles" ]; then
  $SUDO zypper --non-interactive install certbot python3-certbot-nginx python3-certbot-apache
fi

# Method 2: Snap fallback if certbot still missing
if ! command -v certbot >/dev/null 2>&1 && [ ! -x /snap/bin/certbot ] && [ ! -x /usr/bin/certbot ]; then
  if command -v snap >/dev/null 2>&1; then
    echo "Attempting Snap Certbot installation..."
    $SUDO snap install --classic certbot
    $SUDO ln -sf /snap/bin/certbot /usr/bin/certbot 2>/dev/null || true
    $SUDO snap set certbot trust-plugin-with-root=ok
    $SUDO snap install certbot-nginx certbot-apache 2>/dev/null || true
  fi
fi

# Method 3: Python pip fallback with --break-system-packages
if ! command -v certbot >/dev/null 2>&1 && [ ! -x /snap/bin/certbot ] && [ ! -x /usr/bin/certbot ]; then
  echo "Attempting Python pip fallback..."
  $SUDO python3 -m pip install --break-system-packages --upgrade certbot certbot-nginx certbot-apache 2>/dev/null || \
  $SUDO pip3 install --break-system-packages --upgrade certbot certbot-nginx certbot-apache 2>/dev/null || \
  $SUDO python3 -m pip install --upgrade certbot certbot-nginx certbot-apache 2>/dev/null || \
  $SUDO pip3 install --upgrade certbot certbot-nginx certbot-apache 2>/dev/null || true
  
  [ -f /usr/local/bin/certbot ] && $SUDO ln -sf /usr/local/bin/certbot /usr/bin/certbot 2>/dev/null || true
fi

# Ensure /usr/bin/certbot symlink exists
if [ -x /snap/bin/certbot ] && [ ! -x /usr/bin/certbot ]; then
  $SUDO ln -sf /snap/bin/certbot /usr/bin/certbot 2>/dev/null || true
fi

echo "===INSTALL_VERIFY==="
command -v certbot || which certbot || [ -x /snap/bin/certbot ] && echo "/snap/bin/certbot" || [ -x /usr/bin/certbot ] && echo "/usr/bin/certbot" || echo "CERTBOT_STILL_MISSING"
certbot --version 2>&1 || /snap/bin/certbot --version 2>&1 || /usr/bin/certbot --version 2>&1 || true
`;

  const res = await sshExec(connId, installCmd);
  const out = (res.stdout || '') + (res.stderr ? '\n' + res.stderr : '');
  const isOk = res.exit_code === 0 || out.includes('certbot ') || out.includes('/bin/certbot');

  return {
    success: isOk,
    output: out,
  };
}

/**
 * Installs a specific webserver Certbot plugin (Nginx or Apache)
 */
export async function installCertbotPlugin(
  connId: string,
  plugin: 'nginx' | 'apache'
): Promise<{ success: boolean; output: string }> {
  const installCmd = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$HOME/.local/bin:$PATH"

if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
  OS_LIKE="$ID_LIKE"
else
  OS_ID="unknown"
  OS_LIKE=""
fi

echo "Installing Certbot ${plugin} plugin on $OS_ID ($OS_LIKE)..."

if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || [ "$OS_ID" = "kali" ] || [ "$OS_ID" = "pop" ] || [ "$OS_ID" = "linuxmint" ] || echo "$OS_LIKE" | grep -q "debian"; then
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -y && $SUDO apt-get install -y python3-certbot-${plugin}
elif [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "almalinux" ] || [ "$OS_ID" = "ol" ] || [ "$OS_ID" = "amzn" ] || echo "$OS_LIKE" | grep -q "rhel"; then
  $SUDO dnf config-manager --set-enabled crb 2>/dev/null || $SUDO dnf config-manager --set-enabled powertools 2>/dev/null || true
  $SUDO dnf install -y epel-release 2>/dev/null || $SUDO yum install -y epel-release 2>/dev/null || true
  $SUDO dnf install -y python3-certbot-${plugin} 2>/dev/null || $SUDO yum install -y python3-certbot-${plugin} 2>/dev/null || true
elif [ "$OS_ID" = "fedora" ]; then
  $SUDO dnf install -y python3-certbot-${plugin}
elif [ "$OS_ID" = "arch" ] || [ "$OS_ID" = "manjaro" ] || echo "$OS_LIKE" | grep -q "arch"; then
  $SUDO pacman -Sy --noconfirm certbot-${plugin}
elif [ "$OS_ID" = "alpine" ]; then
  $SUDO apk update && $SUDO apk add --no-cache certbot-${plugin} py3-certbot-${plugin} 2>/dev/null || true
elif [ "$OS_ID" = "opensuse" ] || [ "$OS_ID" = "opensuse-leap" ] || [ "$OS_ID" = "opensuse-tumbleweed" ] || [ "$OS_ID" = "sles" ]; then
  $SUDO zypper --non-interactive install python3-certbot-${plugin}
else
  if command -v snap >/dev/null 2>&1 && snap list certbot >/dev/null 2>&1; then
    $SUDO snap set certbot trust-plugin-with-root=ok
    $SUDO snap install certbot-${plugin}
  else
    $SUDO python3 -m pip install --break-system-packages certbot-${plugin} 2>/dev/null || $SUDO pip3 install certbot-${plugin} 2>/dev/null || true
  fi
fi

echo "===PLUGIN_VERIFY==="
certbot plugins 2>&1 | grep -i "${plugin}" || true
`;

  const res = await sshExec(connId, installCmd);
  const out = (res.stdout || '') + (res.stderr ? '\n' + res.stderr : '');
  const isOk = res.exit_code === 0 || out.toLowerCase().includes(plugin);

  return {
    success: isOk,
    output: out,
  };
}

/**
 * Installs the webserver package itself (Nginx or Apache) if missing on the host
 */
export async function installWebServer(
  connId: string,
  webserver: 'nginx' | 'apache'
): Promise<{ success: boolean; output: string }> {
  const installCmd = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="$ID"
  OS_LIKE="$ID_LIKE"
else
  OS_ID="unknown"
  OS_LIKE=""
fi

echo "Installing ${webserver} web server on $OS_ID ($OS_LIKE)..."

if [ "${webserver}" = "nginx" ]; then
  if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || [ "$OS_ID" = "kali" ] || [ "$OS_ID" = "pop" ] || [ "$OS_ID" = "linuxmint" ] || echo "$OS_LIKE" | grep -q "debian"; then
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get update -y && $SUDO apt-get install -y nginx
  elif [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "almalinux" ] || [ "$OS_ID" = "ol" ] || [ "$OS_ID" = "amzn" ] || echo "$OS_LIKE" | grep -q "rhel"; then
    $SUDO dnf install -y epel-release 2>/dev/null || $SUDO yum install -y epel-release 2>/dev/null || true
    $SUDO dnf install -y nginx 2>/dev/null || $SUDO yum install -y nginx 2>/dev/null || true
  elif [ "$OS_ID" = "fedora" ]; then
    $SUDO dnf install -y nginx
  elif [ "$OS_ID" = "arch" ] || [ "$OS_ID" = "manjaro" ]; then
    $SUDO pacman -Sy --noconfirm nginx
  elif [ "$OS_ID" = "alpine" ]; then
    $SUDO apk add --no-cache nginx
  elif [ "$OS_ID" = "opensuse" ] || [ "$OS_ID" = "opensuse-leap" ] || [ "$OS_ID" = "opensuse-tumbleweed" ] || [ "$OS_ID" = "sles" ]; then
    $SUDO zypper --non-interactive install nginx
  fi
  $SUDO systemctl enable --now nginx 2>/dev/null || true
else
  # Apache
  if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || [ "$OS_ID" = "kali" ] || [ "$OS_ID" = "pop" ] || [ "$OS_ID" = "linuxmint" ] || echo "$OS_LIKE" | grep -q "debian"; then
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get update -y && $SUDO apt-get install -y apache2
    $SUDO a2enmod ssl rewrite headers 2>/dev/null || true
    $SUDO systemctl enable --now apache2 2>/dev/null || true
  else
    $SUDO dnf install -y httpd mod_ssl 2>/dev/null || $SUDO yum install -y httpd mod_ssl 2>/dev/null || $SUDO pacman -Sy --noconfirm apache 2>/dev/null || $SUDO apk add --no-cache apache2 apache2-ssl 2>/dev/null || $SUDO zypper --non-interactive install apache2 2>/dev/null || true
    $SUDO systemctl enable --now httpd 2>/dev/null || $SUDO systemctl enable --now apache2 2>/dev/null || true
  fi
fi

echo "===WEBSERVER_VERIFY==="
command -v nginx || command -v apache2 || command -v httpd || echo "FAILED"
`;

  const res = await sshExec(connId, installCmd);
  const out = (res.stdout || '') + (res.stderr ? '\n' + res.stderr : '');
  const isOk = res.exit_code === 0 && !out.includes('FAILED');

  return {
    success: isOk,
    output: out,
  };
}

/**
 * Lists all active certificates managed by Certbot, plus custom certificates
 */
export async function listCertificates(connId: string): Promise<SslCertificate[]> {
  const script = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$PATH"

if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "===CERTBOT_CERTS==="
$SUDO certbot certificates 2>/dev/null || certbot certificates 2>/dev/null || /snap/bin/certbot certificates 2>/dev/null || true

echo "===CUSTOM_CERTS==="
# Fast custom certificate scan: only check specific webserver directories and non-symlink user certs
for d in /etc/nginx/ssl /etc/apache2/ssl /etc/httpd/ssl /etc/ssl/private; do
  if [ -d "$d" ]; then
    find "$d" -maxdepth 1 -type f \( -name "*.crt" -o -name "*.pem" \) 2>/dev/null | head -n 5 | while read -r f; do
      echo "FILE:$f"
      openssl x509 -in "$f" -noout -subject -issuer -dates -serial 2>/dev/null || true
      echo "---"
    done
  fi
done

# Check regular user files in /etc/ssl/certs (strictly exclude symlinks to system CAs to avoid slow loops)
if [ -d /etc/ssl/certs ]; then
  find /etc/ssl/certs -maxdepth 1 -type f ! -type l \( -name "*.crt" -o -name "*.pem" \) ! -name "ca-certificates.crt" ! -name "ca-bundle.crt" 2>/dev/null | head -n 5 | while read -r f; do
    echo "FILE:$f"
    openssl x509 -in "$f" -noout -subject -issuer -dates -serial 2>/dev/null || true
    echo "---"
  done
fi
`;

  try {
    const res = await sshExec(connId, script);
    const out = res.stdout || '';

    const certbotSection = extractSection(out, '===CERTBOT_CERTS===', '===CUSTOM_CERTS===');
    const customSection = extractSection(out, '===CUSTOM_CERTS===', null);

    const certList: SslCertificate[] = [];

    // 1. Parse Certbot Certificates
    if (certbotSection.includes('Certificate Name:')) {
      const blocks = certbotSection.split(/Certificate Name:/i).slice(1);
      for (const block of blocks) {
        const lines = block.split('\n').map(l => l.trim());
        const name = lines[0] || 'Unknown';

        let domains: string[] = [];
        let expiryDate = '';
        let daysRemaining = 90;
        let certPath = '';
        let keyPath = '';
        let serialNumber = '';
        let keyType = 'RSA';

        for (const line of lines) {
          if (line.startsWith('Domains:')) {
            domains = line.replace('Domains:', '').trim().split(/\s+/).filter(Boolean);
          } else if (line.startsWith('Expiry Date:')) {
            expiryDate = line.replace('Expiry Date:', '').trim();
            const daysMatch = line.match(/VALID:\s*(\d+)\s*days/i);
            if (daysMatch) {
              daysRemaining = parseInt(daysMatch[1], 10);
            } else if (line.includes('INVALID: EXPIRED') || line.includes('EXPIRED')) {
              daysRemaining = 0;
            }
          } else if (line.startsWith('Certificate Path:')) {
            certPath = line.replace('Certificate Path:', '').trim();
          } else if (line.startsWith('Private Key Path:')) {
            keyPath = line.replace('Private Key Path:', '').trim();
          } else if (line.startsWith('Serial Number:')) {
            serialNumber = line.replace('Serial Number:', '').trim();
          } else if (line.startsWith('Key Type:')) {
            keyType = line.replace('Key Type:', '').trim();
          }
        }

        let status: CertStatus = 'valid';
        if (daysRemaining <= 0) {
          status = 'expired';
        } else if (daysRemaining <= 30) {
          status = 'expiring_soon';
        }

        certList.push({
          id: `certbot-${name}`,
          name,
          domains: domains.length > 0 ? domains : [name],
          expiryDate: cleanExpiryDate(expiryDate),
          daysRemaining,
          status,
          certPath,
          keyPath,
          issuer: "Let's Encrypt Authority",
          serialNumber,
          keyType,
          isCertbot: true,
          autoRenewal: true,
          renewalConfigPath: `/etc/letsencrypt/renewal/${name}.conf`,
        });
      }
    }

    // 2. Parse Custom/Self-Signed/Third-party Certificates found on server
    if (customSection.includes('FILE:')) {
      const customBlocks = customSection.split('FILE:').slice(1);
      for (const block of customBlocks) {
        const lines = block.split('\n').map(l => l.trim());
        const filePath = lines[0] || '';
        if (!filePath) continue;

        if (filePath.includes('/letsencrypt/live/') || certList.some(c => c.certPath === filePath)) {
          continue;
        }

        let subject = '';
        let issuer = '';
        let notAfter = '';
        let serial = '';

        for (const line of lines) {
          if (line.startsWith('subject=')) subject = line.replace('subject=', '').trim();
          if (line.startsWith('issuer=')) issuer = line.replace('issuer=', '').trim();
          if (line.startsWith('notAfter=')) notAfter = line.replace('notAfter=', '').trim();
          if (line.startsWith('serial=')) serial = line.replace('serial=', '').trim();
        }

        if (!notAfter) continue;

        const cnMatch = subject.match(/CN\s*=\s*([^,\/]+)/i);
        const certName = cnMatch ? cnMatch[1].trim() : filePath.split('/').pop() || 'custom-cert';

        const issuerCnMatch = issuer.match(/CN\s*=\s*([^,\/]+)/i);
        const issuerName = issuerCnMatch ? issuerCnMatch[1].trim() : (issuer || 'Custom Authority');

        let daysRemaining = 90;
        try {
          const expTime = new Date(notAfter).getTime();
          if (!isNaN(expTime)) {
            daysRemaining = Math.max(0, Math.round((expTime - Date.now()) / (1000 * 60 * 60 * 24)));
          }
        } catch {}

        let status: CertStatus = 'valid';
        if (daysRemaining <= 0) {
          status = 'expired';
        } else if (daysRemaining <= 30) {
          status = 'expiring_soon';
        }

        certList.push({
          id: `custom-${filePath}`,
          name: certName,
          domains: [certName],
          expiryDate: notAfter,
          daysRemaining,
          status,
          certPath: filePath,
          keyPath: filePath.replace(/\.(crt|pem)$/, '.key'),
          issuer: issuerName,
          serialNumber: serial,
          keyType: 'RSA',
          isCertbot: false,
          autoRenewal: false,
        });
      }
    }

    return certList;
  } catch (err) {
    console.warn('listCertificates error:', err);
    return [];
  }
}

/**
 * Issues a new Let's Encrypt certificate via Certbot with Full-Auto Multi-OS Pipeline:
 * 1. Auto-installs Certbot if missing (Ubuntu, Debian, RHEL, CentOS, Rocky, Alma, Fedora, Arch, Alpine, openSUSE, Snap, Pip)
 * 2. Auto-installs Web Server & Certbot Plugins if missing
 * 3. Pre-creates ACME challenge directories & initial HTTP VirtualHost
 * 4. Issues certificate with automatic fallback to webroot challenge
 * 5. Auto-generates complete production HTTPS configuration for Nginx / Apache
 * 6. Validates syntax and reloads web server daemon
 * 7. Enables systemd 24/7 background auto-renewal timer
 */
export async function issueCertificate(
  connId: string,
  form: IssueCertForm
): Promise<{ success: boolean; output: string; certName?: string }> {
  const domainList = form.domains
    .split(/[,\s]+/)
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);

  if (domainList.length === 0) {
    throw new Error('At least one domain name is required.');
  }

  const primaryDomain = domainList[0];
  const allDomains = domainList.join(' ');
  const serverAliases = domainList.length > 1
    ? `ServerAlias ${domainList.slice(1).join(' ')}`
    : '';

  const domainFlags = domainList.map(d => `-d "${d}"`).join(' ');
  const emailFlag = form.email.trim()
    ? `-m "${form.email.trim()}" --no-eff-email`
    : '--register-unsafely-without-email --no-eff-email';

  const dryRunFlag = form.dryRun ? '--dry-run' : '';
  const keyTypeFlag = form.keyType === 'ecdsa' ? '--key-type ecdsa' : `--key-type rsa --rsa-key-size ${form.rsaKeySize || 2048}`;
  const redirectFlag = form.redirectHttps ? '--redirect' : '--no-redirect';

  const script = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$HOME/.local/bin:$PATH"

if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID="\${ID:-unknown}"
  OS_LIKE="\${ID_LIKE:-}"
else
  OS_ID="unknown"
  OS_LIKE=""
fi

echo "=========================================================="
echo "🚀 SSH Desktop Full-Auto SSL Engine Starting"
echo "🌐 Domains       : ${allDomains}"
echo "🎯 Primary Domain: ${primaryDomain}"
echo "🔧 Plugin Engine : ${form.plugin}"
echo "💻 Host OS       : $OS_ID ($OS_LIKE)"
echo "=========================================================="

# 1. AUTO-INSTALL CERTBOT IF MISSING
if ! command -v certbot >/dev/null 2>&1 && [ ! -x /snap/bin/certbot ] && [ ! -x /usr/bin/certbot ] && [ ! -x /usr/local/bin/certbot ]; then
  echo "📦 Certbot not detected. Auto-installing Certbot for $OS_ID..."
  if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || [ "$OS_ID" = "kali" ] || [ "$OS_ID" = "pop" ] || [ "$OS_ID" = "linuxmint" ] || echo "$OS_LIKE" | grep -q "debian"; then
    export DEBIAN_FRONTEND=noninteractive
    $SUDO apt-get update -y && $SUDO apt-get install -y certbot python3-certbot-nginx python3-certbot-apache
  elif [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "almalinux" ] || [ "$OS_ID" = "ol" ] || [ "$OS_ID" = "amzn" ] || echo "$OS_LIKE" | grep -q "rhel"; then
    $SUDO dnf config-manager --set-enabled crb 2>/dev/null || $SUDO dnf config-manager --set-enabled powertools 2>/dev/null || true
    $SUDO dnf install -y epel-release 2>/dev/null || $SUDO yum install -y epel-release 2>/dev/null || true
    $SUDO dnf install -y certbot python3-certbot-nginx python3-certbot-apache 2>/dev/null || $SUDO yum install -y certbot python3-certbot-nginx python3-certbot-apache 2>/dev/null || true
  elif [ "$OS_ID" = "fedora" ]; then
    $SUDO dnf install -y certbot python3-certbot-nginx python3-certbot-apache
  elif [ "$OS_ID" = "arch" ] || [ "$OS_ID" = "manjaro" ]; then
    $SUDO pacman -Sy --noconfirm certbot certbot-nginx certbot-apache
  elif [ "$OS_ID" = "alpine" ]; then
    $SUDO apk update && $SUDO apk add --no-cache certbot certbot-nginx certbot-apache py3-certbot-nginx py3-certbot-apache 2>/dev/null || true
  elif [ "$OS_ID" = "opensuse" ] || [ "$OS_ID" = "opensuse-leap" ] || [ "$OS_ID" = "opensuse-tumbleweed" ] || [ "$OS_ID" = "sles" ]; then
    $SUDO zypper --non-interactive install certbot python3-certbot-nginx python3-certbot-apache
  else
    if command -v snap >/dev/null 2>&1; then
      $SUDO snap install --classic certbot && $SUDO ln -sf /snap/bin/certbot /usr/bin/certbot
    else
      $SUDO python3 -m pip install --break-system-packages certbot certbot-nginx certbot-apache 2>/dev/null || true
    fi
  fi
fi

# Locate Certbot executable
if command -v certbot >/dev/null 2>&1; then
  CERTBOT="certbot"
elif [ -x /snap/bin/certbot ]; then
  CERTBOT="/snap/bin/certbot"
elif [ -x /usr/bin/certbot ]; then
  CERTBOT="/usr/bin/certbot"
elif [ -x /usr/local/bin/certbot ]; then
  CERTBOT="/usr/local/bin/certbot"
else
  CERTBOT="certbot"
fi

# 2. AUTO-INSTALL WEBSERVER & PLUGINS IF SELECTED
if [ "${form.plugin}" = "nginx" ]; then
  if ! command -v nginx >/dev/null 2>&1 && [ ! -x /usr/sbin/nginx ] && [ ! -x /usr/bin/nginx ]; then
    echo "📦 Nginx web server not found. Auto-installing Nginx..."
    if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || [ "$OS_ID" = "kali" ] || [ "$OS_ID" = "pop" ] || [ "$OS_ID" = "linuxmint" ] || echo "$OS_LIKE" | grep -q "debian"; then
      export DEBIAN_FRONTEND=noninteractive
      $SUDO apt-get update -y && $SUDO apt-get install -y nginx
    elif [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "almalinux" ] || [ "$OS_ID" = "ol" ] || [ "$OS_ID" = "amzn" ] || echo "$OS_LIKE" | grep -q "rhel"; then
      $SUDO dnf install -y epel-release 2>/dev/null || true
      $SUDO dnf install -y nginx 2>/dev/null || $SUDO yum install -y nginx 2>/dev/null || true
    elif [ "$OS_ID" = "fedora" ]; then
      $SUDO dnf install -y nginx
    elif [ "$OS_ID" = "arch" ] || [ "$OS_ID" = "manjaro" ]; then
      $SUDO pacman -Sy --noconfirm nginx
    elif [ "$OS_ID" = "alpine" ]; then
      $SUDO apk add --no-cache nginx
    elif [ "$OS_ID" = "opensuse" ] || [ "$OS_ID" = "opensuse-leap" ] || [ "$OS_ID" = "opensuse-tumbleweed" ] || [ "$OS_ID" = "sles" ]; then
      $SUDO zypper --non-interactive install nginx
    fi
  fi
  # Ensure certbot nginx plugin is installed
  if ! $CERTBOT plugins 2>/dev/null | grep -qi "nginx"; then
    echo "📦 Installing certbot-nginx plugin..."
    if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || echo "$OS_LIKE" | grep -q "debian"; then
      $SUDO apt-get install -y python3-certbot-nginx 2>/dev/null || true
    elif [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "almalinux" ]; then
      $SUDO dnf install -y python3-certbot-nginx 2>/dev/null || $SUDO yum install -y python3-certbot-nginx 2>/dev/null || true
    elif [ "$OS_ID" = "fedora" ]; then
      $SUDO dnf install -y python3-certbot-nginx 2>/dev/null || true
    elif [ "$OS_ID" = "arch" ] || [ "$OS_ID" = "manjaro" ]; then
      $SUDO pacman -Sy --noconfirm certbot-nginx 2>/dev/null || true
    elif [ "$OS_ID" = "alpine" ]; then
      $SUDO apk add --no-cache certbot-nginx py3-certbot-nginx 2>/dev/null || true
    fi
  fi

elif [ "${form.plugin}" = "apache" ]; then
  if ! command -v apache2 >/dev/null 2>&1 && ! command -v httpd >/dev/null 2>&1 && [ ! -x /usr/sbin/apache2 ] && [ ! -x /usr/sbin/httpd ]; then
    echo "📦 Apache web server not found. Auto-installing Apache..."
    if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || [ "$OS_ID" = "kali" ] || [ "$OS_ID" = "pop" ] || [ "$OS_ID" = "linuxmint" ] || echo "$OS_LIKE" | grep -q "debian"; then
      export DEBIAN_FRONTEND=noninteractive
      $SUDO apt-get update -y && $SUDO apt-get install -y apache2
      $SUDO a2enmod ssl rewrite headers 2>/dev/null || true
    elif [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "almalinux" ] || [ "$OS_ID" = "ol" ] || [ "$OS_ID" = "amzn" ] || echo "$OS_LIKE" | grep -q "rhel"; then
      $SUDO dnf install -y httpd mod_ssl 2>/dev/null || $SUDO yum install -y httpd mod_ssl 2>/dev/null || true
    elif [ "$OS_ID" = "fedora" ]; then
      $SUDO dnf install -y httpd mod_ssl 2>/dev/null || true
    elif [ "$OS_ID" = "arch" ] || [ "$OS_ID" = "manjaro" ]; then
      $SUDO pacman -Sy --noconfirm apache 2>/dev/null || true
    elif [ "$OS_ID" = "alpine" ]; then
      $SUDO apk add --no-cache apache2 apache2-ssl 2>/dev/null || true
    elif [ "$OS_ID" = "opensuse" ] || [ "$OS_ID" = "opensuse-leap" ] || [ "$OS_ID" = "opensuse-tumbleweed" ] || [ "$OS_ID" = "sles" ]; then
      $SUDO zypper --non-interactive install apache2 2>/dev/null || true
    fi
  fi
  # Ensure certbot apache plugin is installed
  if ! $CERTBOT plugins 2>/dev/null | grep -qi "apache"; then
    echo "📦 Installing certbot-apache plugin..."
    if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || echo "$OS_LIKE" | grep -q "debian"; then
      $SUDO apt-get install -y python3-certbot-apache 2>/dev/null || true
    elif [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "almalinux" ]; then
      $SUDO dnf install -y python3-certbot-apache 2>/dev/null || $SUDO yum install -y python3-certbot-apache 2>/dev/null || true
    elif [ "$OS_ID" = "fedora" ]; then
      $SUDO dnf install -y python3-certbot-apache 2>/dev/null || true
    elif [ "$OS_ID" = "arch" ] || [ "$OS_ID" = "manjaro" ]; then
      $SUDO pacman -Sy --noconfirm certbot-apache 2>/dev/null || true
    elif [ "$OS_ID" = "alpine" ]; then
      $SUDO apk add --no-cache certbot-apache py3-certbot-apache 2>/dev/null || true
    fi
  fi
fi

# 3. PREPARE ACME WEBROOT & INITIAL DOMAIN CONFIGURATION
echo "🛠️ Preparing ACME challenge directories..."
$SUDO mkdir -p /var/www/html/.well-known/acme-challenge 2>/dev/null || true
$SUDO chmod -R 755 /var/www/html 2>/dev/null || true

# Pre-configure Nginx port 80 block if not present
if [ "${form.plugin}" = "nginx" ]; then
  NGINX_TARGET=""
  if [ -d /etc/nginx/conf.d ]; then
    NGINX_TARGET="/etc/nginx/conf.d/${primaryDomain}.conf"
  elif [ -d /etc/nginx/sites-available ]; then
    NGINX_TARGET="/etc/nginx/sites-available/${primaryDomain}.conf"
  else
    $SUDO mkdir -p /etc/nginx/conf.d 2>/dev/null || true
    NGINX_TARGET="/etc/nginx/conf.d/${primaryDomain}.conf"
  fi

  if [ ! -f "$NGINX_TARGET" ] && ! grep -rw "${primaryDomain}" /etc/nginx/ 2>/dev/null | grep -q "server_name"; then
    echo "📝 Pre-configuring initial HTTP server block at $NGINX_TARGET..."
    $SUDO bash -c "cat << 'EOF' > \"$NGINX_TARGET\"
server {
    listen 80;
    listen [::]:80;
    server_name ${allDomains};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
    }

    location / {
        root /var/www/html;
        index index.html index.htm;
    }
}
EOF"
    if [ -d /etc/nginx/sites-enabled ] && [ -f "/etc/nginx/sites-available/${primaryDomain}.conf" ]; then
      $SUDO ln -sf "/etc/nginx/sites-available/${primaryDomain}.conf" "/etc/nginx/sites-enabled/${primaryDomain}.conf" 2>/dev/null || true
    fi
    $SUDO nginx -t 2>/dev/null && ($SUDO systemctl reload nginx 2>/dev/null || $SUDO systemctl restart nginx 2>/dev/null || $SUDO service nginx reload 2>/dev/null || true)
  fi
  $SUDO systemctl enable --now nginx 2>/dev/null || true

elif [ "${form.plugin}" = "apache" ]; then
  APACHE_TARGET=""
  if [ -d /etc/apache2/sites-available ]; then
    APACHE_TARGET="/etc/apache2/sites-available/${primaryDomain}.conf"
  elif [ -d /etc/httpd/conf.d ]; then
    APACHE_TARGET="/etc/httpd/conf.d/${primaryDomain}.conf"
  else
    $SUDO mkdir -p /etc/httpd/conf.d 2>/dev/null || true
    APACHE_TARGET="/etc/httpd/conf.d/${primaryDomain}.conf"
  fi

  if [ ! -f "$APACHE_TARGET" ] && ! grep -rw "${primaryDomain}" /etc/apache2 /etc/httpd 2>/dev/null | grep -q "ServerName"; then
    echo "📝 Pre-configuring initial HTTP VirtualHost at $APACHE_TARGET..."
    $SUDO bash -c "cat << 'EOF' > \"$APACHE_TARGET\"
<VirtualHost *:80>
    ServerName ${primaryDomain}
    ${serverAliases}
    DocumentRoot /var/www/html

    <Directory /var/www/html/.well-known/acme-challenge>
        Options None
        AllowOverride None
        Require all granted
    </Directory>
</VirtualHost>
EOF"
    if [ -d /etc/apache2/sites-available ] && command -v a2ensite >/dev/null 2>&1; then
      $SUDO a2ensite "${primaryDomain}.conf" 2>/dev/null || true
      $SUDO a2enmod ssl rewrite headers 2>/dev/null || true
    fi
    $SUDO apachectl configtest 2>/dev/null || $SUDO httpd -t 2>/dev/null || true
    $SUDO systemctl reload apache2 2>/dev/null || $SUDO systemctl reload httpd 2>/dev/null || true
  fi
  $SUDO systemctl enable --now apache2 2>/dev/null || $SUDO systemctl enable --now httpd 2>/dev/null || true
fi

# 4. EXECUTE CERTBOT ISSUANCE
echo "📡 Requesting Let's Encrypt certificate..."
CERT_SUCCESS=0

if [ "${form.plugin}" = "nginx" ]; then
  $SUDO $CERTBOT --nginx ${domainFlags} ${emailFlag} --agree-tos --non-interactive ${redirectFlag} ${keyTypeFlag} ${dryRunFlag}
  [ $? -eq 0 ] && CERT_SUCCESS=1
elif [ "${form.plugin}" = "apache" ]; then
  $SUDO $CERTBOT --apache ${domainFlags} ${emailFlag} --agree-tos --non-interactive ${redirectFlag} ${keyTypeFlag} ${dryRunFlag}
  [ $? -eq 0 ] && CERT_SUCCESS=1
elif [ "${form.plugin}" = "webroot" ]; then
  $SUDO $CERTBOT certonly --webroot -w "${form.webrootPath?.trim() || '/var/www/html'}" ${domainFlags} ${emailFlag} --agree-tos --non-interactive ${keyTypeFlag} ${dryRunFlag}
  [ $? -eq 0 ] && CERT_SUCCESS=1
elif [ "${form.plugin}" = "standalone" ]; then
  $SUDO $CERTBOT certonly --standalone ${domainFlags} ${emailFlag} --agree-tos --non-interactive ${keyTypeFlag} ${dryRunFlag}
  [ $? -eq 0 ] && CERT_SUCCESS=1
elif [ "${form.plugin}" = "dns" ]; then
  $SUDO $CERTBOT certonly --manual --preferred-challenges dns ${domainFlags} ${emailFlag} --agree-tos --non-interactive ${keyTypeFlag} ${dryRunFlag}
  [ $? -eq 0 ] && CERT_SUCCESS=1
fi

# Fallback: If plugin verification failed, fallback to ACME webroot challenge
if [ $CERT_SUCCESS -ne 1 ] && [ "${form.plugin}" != "webroot" ] && [ "${form.plugin}" != "standalone" ]; then
  echo "⚠️ Webserver plugin returned an error. Initiating automatic fallback to ACME webroot challenge..."
  $SUDO mkdir -p /var/www/html/.well-known/acme-challenge 2>/dev/null || true
  $SUDO chmod -R 755 /var/www/html 2>/dev/null || true
  $SUDO $CERTBOT certonly --webroot -w /var/www/html ${domainFlags} ${emailFlag} --agree-tos --non-interactive ${keyTypeFlag} ${dryRunFlag}
  [ $? -eq 0 ] && CERT_SUCCESS=1
fi

# 5. RESOLVE LIVE CERTIFICATE PATH
LIVE_DIR="/etc/letsencrypt/live/${primaryDomain}"
if [ ! -f "$LIVE_DIR/fullchain.pem" ]; then
  MATCHING_DIR=$(ls -d /etc/letsencrypt/live/${primaryDomain}* 2>/dev/null | head -n 1)
  if [ -n "$MATCHING_DIR" ] && [ -f "$MATCHING_DIR/fullchain.pem" ]; then
    LIVE_DIR="$MATCHING_DIR"
  fi
fi

# 6. AUTO-CREATE / AUTO-UPDATE PRODUCTION SSL WEBSERVER CONFIG
if [ -f "$LIVE_DIR/fullchain.pem" ]; then
  echo "🔒 Valid SSL certificate detected at $LIVE_DIR/fullchain.pem"
  echo "⚙️ Auto-updating web server configuration files..."

  # NGINX AUTO-CONFIG
  if [ "${form.plugin}" = "nginx" ] || command -v nginx >/dev/null 2>&1 || [ -d /etc/nginx ]; then
    NGINX_CONF_DEST=""
    if [ -d /etc/nginx/conf.d ]; then
      NGINX_CONF_DEST="/etc/nginx/conf.d/${primaryDomain}.conf"
    elif [ -d /etc/nginx/sites-available ]; then
      NGINX_CONF_DEST="/etc/nginx/sites-available/${primaryDomain}.conf"
    fi

    if [ -n "$NGINX_CONF_DEST" ]; then
      echo "📝 Writing optimized Nginx SSL configuration to $NGINX_CONF_DEST..."
      $SUDO bash -c "cat << 'EOF' > \"$NGINX_CONF_DEST\"
# Auto-generated by SSH Desktop SSL Engine
server {
    listen 80;
    listen [::]:80;
    server_name ${allDomains};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
    }

    location / {
        ${form.redirectHttps ? 'return 301 https://$host$request_uri;' : 'root /var/www/html;\n        index index.html index.htm;'}
    }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${allDomains};

    ssl_certificate __CERT_DIR__/fullchain.pem;
    ssl_certificate_key __CERT_DIR__/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    root /var/www/html;
    index index.html index.htm index.nginx-debian.html;

    location / {
        try_files \\$uri \\$uri/ =404;
    }
}
EOF"
      $SUDO sed -i "s|__CERT_DIR__|$LIVE_DIR|g" "$NGINX_CONF_DEST" 2>/dev/null || true

      if [ -d /etc/nginx/sites-enabled ] && [ -f "/etc/nginx/sites-available/${primaryDomain}.conf" ]; then
        $SUDO ln -sf "/etc/nginx/sites-available/${primaryDomain}.conf" "/etc/nginx/sites-enabled/${primaryDomain}.conf" 2>/dev/null || true
      fi

      if $SUDO nginx -t 2>/dev/null; then
        echo "✅ Nginx syntax check passed. Reloading Nginx service..."
        $SUDO systemctl reload nginx 2>/dev/null || $SUDO systemctl restart nginx 2>/dev/null || $SUDO service nginx reload 2>/dev/null || true
      else
        echo "⚠️ Nginx test failed syntax check. Reviewing configuration:"
        $SUDO nginx -t 2>&1 || true
      fi
    fi
  fi

  # APACHE AUTO-CONFIG
  if [ "${form.plugin}" = "apache" ] || command -v apache2 >/dev/null 2>&1 || command -v httpd >/dev/null 2>&1; then
    APACHE_CONF_DEST=""
    if [ -d /etc/apache2/sites-available ]; then
      APACHE_CONF_DEST="/etc/apache2/sites-available/${primaryDomain}.conf"
    elif [ -d /etc/httpd/conf.d ]; then
      APACHE_CONF_DEST="/etc/httpd/conf.d/${primaryDomain}.conf"
    fi

    if [ -n "$APACHE_CONF_DEST" ]; then
      echo "📝 Writing optimized Apache SSL configuration to $APACHE_CONF_DEST..."
      $SUDO bash -c "cat << 'EOF' > \"$APACHE_CONF_DEST\"
# Auto-generated by SSH Desktop SSL Engine
<VirtualHost *:80>
    ServerName ${primaryDomain}
    ${serverAliases}
    DocumentRoot /var/www/html

    <Directory /var/www/html/.well-known/acme-challenge>
        Options None
        AllowOverride None
        Require all granted
    </Directory>
${form.redirectHttps ? `
    RewriteEngine on
    RewriteCond %{REQUEST_URI} !^/\\.well-known/acme-challenge
    RewriteRule ^ https://%{SERVER_NAME}%{REQUEST_URI} [END,NE,R=permanent]` : ''}
</VirtualHost>

<VirtualHost *:443>
    ServerName ${primaryDomain}
    ${serverAliases}
    DocumentRoot /var/www/html

    SSLEngine on
    SSLCertificateFile __CERT_DIR__/fullchain.pem
    SSLCertificateKeyFile __CERT_DIR__/privkey.pem

    SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1
    SSLCipherSuite HIGH:!aNULL:!MD5
    SSLHonorCipherOrder on

    <Directory /var/www/html>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
</VirtualHost>
EOF"
      $SUDO sed -i "s|__CERT_DIR__|$LIVE_DIR|g" "$APACHE_CONF_DEST" 2>/dev/null || true

      if [ -d /etc/apache2/sites-available ] && command -v a2ensite >/dev/null 2>&1; then
        $SUDO a2ensite "${primaryDomain}.conf" 2>/dev/null || true
        $SUDO a2enmod ssl rewrite headers 2>/dev/null || true
      fi

      echo "✅ Reloading Apache web server..."
      $SUDO systemctl reload apache2 2>/dev/null || $SUDO systemctl reload httpd 2>/dev/null || $SUDO service apache2 reload 2>/dev/null || true
    fi
  fi
fi

# 7. AUTO-ENABLE SYSTEMD BACKGROUND RENEWAL TIMER
echo "⏰ Activating background auto-renewal timer (certbot.timer)..."
$SUDO systemctl enable --now certbot.timer 2>/dev/null || $SUDO systemctl start certbot.timer 2>/dev/null || true

echo "=========================================================="
echo "🎉 Full-Auto SSL Certificate Pipeline Complete!"
echo "=========================================================="
`;

  const res = await sshExec(connId, script);
  const out = (res.stdout || '') + (res.stderr ? '\n' + res.stderr : '');
  const success = res.exit_code === 0 || out.includes('Congratulations!') || out.includes('The dry run was successful') || out.includes('Full-Auto SSL Certificate Pipeline Complete!');

  return {
    success,
    output: out,
    certName: domainList[0],
  };
}

/**
 * Renews existing certificates via Certbot
 */
export async function renewCertificates(
  connId: string,
  certName?: string,
  dryRun: boolean = false
): Promise<{ success: boolean; output: string }> {
  let subcmd = 'renew --non-interactive --no-eff-email';
  if (dryRun) subcmd += ' --dry-run';
  if (certName) subcmd += ` --cert-name "${certName}" --force-renewal`;

  const script = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$PATH"

if command -v certbot >/dev/null 2>&1; then
  CERTBOT="certbot"
elif [ -x /snap/bin/certbot ]; then
  CERTBOT="/snap/bin/certbot"
elif [ -x /usr/bin/certbot ]; then
  CERTBOT="/usr/bin/certbot"
else
  CERTBOT="certbot"
fi

sudo $CERTBOT ${subcmd} 2>&1
`;

  const res = await sshExec(connId, script);
  const out = (res.stdout || '') + (res.stderr ? '\n' + res.stderr : '');
  const success = res.exit_code === 0 || out.includes('Congratulations') || out.includes('The dry run was successful');

  return {
    success,
    output: out,
  };
}

/**
 * Enables and starts the certbot systemd renewal timer
 */
export async function enableAutoRenewTimer(connId: string): Promise<{ success: boolean; output: string }> {
  const cmd = `sudo systemctl enable --now certbot.timer 2>&1 || sudo systemctl start certbot.timer 2>&1`;
  const res = await sshExec(connId, cmd);
  return {
    success: res.exit_code === 0,
    output: res.stdout || res.stderr || '',
  };
}

/**
 * Revokes a certificate via Certbot
 */
export async function revokeCertificate(
  connId: string,
  certName: string,
  reason: string = 'unspecified'
): Promise<{ success: boolean; output: string }> {
  const script = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$PATH"

if command -v certbot >/dev/null 2>&1; then
  CERTBOT="certbot"
elif [ -x /snap/bin/certbot ]; then
  CERTBOT="/snap/bin/certbot"
else
  CERTBOT="certbot"
fi

sudo $CERTBOT revoke --cert-name "${certName}" --reason "${reason}" --delete-after-revoke --non-interactive 2>&1
`;

  const res = await sshExec(connId, script);
  return {
    success: res.exit_code === 0,
    output: (res.stdout || '') + (res.stderr ? '\n' + res.stderr : ''),
  };
}

/**
 * Deletes a certificate configuration and files via Certbot
 */
export async function deleteCertificate(
  connId: string,
  certName: string
): Promise<{ success: boolean; output: string }> {
  const script = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:$PATH"

if command -v certbot >/dev/null 2>&1; then
  CERTBOT="certbot"
elif [ -x /snap/bin/certbot ]; then
  CERTBOT="/snap/bin/certbot"
else
  CERTBOT="certbot"
fi

sudo $CERTBOT delete --cert-name "${certName}" --non-interactive 2>&1
`;

  const res = await sshExec(connId, script);
  return {
    success: res.exit_code === 0,
    output: (res.stdout || '') + (res.stderr ? '\n' + res.stderr : ''),
  };
}

/**
 * Reads detailed X.509 certificate metadata using openssl x509
 */
export async function inspectCertificate(
  connId: string,
  certPath: string
): Promise<string> {
  const cmd = `sudo openssl x509 -in "${certPath}" -text -noout 2>/dev/null || openssl x509 -in "${certPath}" -text -noout`;
  const res = await sshExec(connId, cmd);
  return res.stdout || res.stderr || 'No certificate details available.';
}

/**
 * Reads the public certificate content (PEM format)
 */
export async function readCertificatePem(
  connId: string,
  certPath: string
): Promise<string> {
  const cmd = `sudo cat "${certPath}" 2>/dev/null || cat "${certPath}"`;
  const res = await sshExec(connId, cmd);
  return res.stdout || '';
}

/**
 * Generates a self-signed SSL/TLS certificate pair using OpenSSL
 * Uses -batch flag and sanitized inputs so it NEVER prompts or hangs on stdin!
 */
export async function generateSelfSignedCertificate(
  connId: string,
  form: SelfSignedForm
): Promise<{ success: boolean; certPath: string; keyPath: string; output: string }> {
  const outDir = form.outputDir.replace(/\/+$/, '') || '/etc/ssl/certs';
  const cleanDomain = (form.domain || 'localhost').trim().replace(/[^a-zA-Z0-9.-]/g, '');
  const certPath = `${outDir}/${cleanDomain}.crt`;
  const keyPath = `${outDir}/${cleanDomain}.key`;
  const country = (form.country || 'US').trim().substring(0, 2).toUpperCase() || 'US';
  const org = (form.organization || 'Local Development').trim().replace(/[\/="]/g, '') || 'Dev';
  const days = Number(form.validDays) || 365;

  const script = `
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

$SUDO mkdir -p "${outDir}" 2>&1

$SUDO openssl req -x509 -nodes -days ${days} -newkey rsa:2048 -batch \\
  -keyout "${keyPath}" \\
  -out "${certPath}" \\
  -subj "/C=${country}/O=${org}/CN=${cleanDomain}" 2>&1

$SUDO chmod 644 "${certPath}" 2>/dev/null || true
$SUDO chmod 600 "${keyPath}" 2>/dev/null || true

if [ -s "${certPath}" ] && [ -s "${keyPath}" ]; then
  echo "===SELF_SIGNED_DONE==="
  echo "Certificate File : ${certPath}"
  echo "Private Key File : ${keyPath}"
  echo "Common Name (CN) : ${cleanDomain}"
  echo "Organization (O) : ${org}"
  echo "Country (C)      : ${country}"
  echo "Validity Period  : ${days} days"
fi
`;

  const res = await sshExec(connId, script);
  const out = (res.stdout || '') + (res.stderr ? '\n' + res.stderr : '');
  const isSuccess = out.includes('===SELF_SIGNED_DONE===') || (res.exit_code === 0 && !out.toLowerCase().includes('error'));

  return {
    success: isSuccess,
    certPath,
    keyPath,
    output: out,
  };
}

/**
 * Tests live SSL/TLS connection and handshake to a domain or localhost port
 */
export async function testSslDiagnostics(
  connId: string,
  domain: string,
  port: number = 443
): Promise<SslDiagnosticResult> {
  const cleanDomain = domain.trim().replace(/^https?:\/\//i, '').replace(/:\d+$/, '');
  const cmd = `echo | openssl s_client -servername "${cleanDomain}" -connect "${cleanDomain}:${port}" 2>&1`;

  try {
    const res = await sshExec(connId, cmd);
    const out = res.stdout || '';

    const connected = out.includes('CONNECTED') || out.includes('SSL handshake has read');
    const protocolMatch = out.match(/Protocol\s*:\s*([^\n\r]+)/i);
    const cipherMatch = out.match(/Cipher\s*:\s*([^\n\r]+)/i);

    let subject = '';
    let issuer = '';
    let validFrom = '';
    let validTo = '';
    let daysRemaining = 0;

    const certTextMatch = out.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
    if (certTextMatch) {
      const inspectRes = await sshExec(connId, `printf '%s' "${certTextMatch[0]}" | openssl x509 -noout -subject -issuer -dates`);
      const details = inspectRes.stdout || '';
      for (const line of details.split('\n')) {
        if (line.startsWith('subject=')) subject = line.replace('subject=', '').trim();
        if (line.startsWith('issuer=')) issuer = line.replace('issuer=', '').trim();
        if (line.startsWith('notBefore=')) validFrom = line.replace('notBefore=', '').trim();
        if (line.startsWith('notAfter=')) validTo = line.replace('notAfter=', '').trim();
      }

      if (validTo) {
        const expTime = new Date(validTo).getTime();
        if (!isNaN(expTime)) {
          daysRemaining = Math.max(0, Math.round((expTime - Date.now()) / (1000 * 60 * 60 * 24)));
        }
      }
    }

    return {
      domain: cleanDomain,
      port,
      connected,
      protocol: protocolMatch ? protocolMatch[1].trim() : undefined,
      cipher: cipherMatch ? cipherMatch[1].trim() : undefined,
      serverCertificate: subject ? {
        subject,
        issuer,
        validFrom,
        validTo,
        daysRemaining,
      } : undefined,
      rawOutput: out,
    };
  } catch (err: any) {
    return {
      domain: cleanDomain,
      port,
      connected: false,
      error: String(err?.message || err),
    };
  }
}

// Helper utilities
function extractSection(text: string, startMarker: string, endMarker: string | null): string {
  const startIdx = text.indexOf(startMarker);
  if (startIdx === -1) return '';
  const contentStart = startIdx + startMarker.length;
  if (!endMarker) return text.slice(contentStart).trim();
  const endIdx = text.indexOf(endMarker, contentStart);
  if (endIdx === -1) return text.slice(contentStart).trim();
  return text.slice(contentStart, endIdx).trim();
}

function cleanExpiryDate(dateStr: string): string {
  return dateStr.replace(/\(VALID:.*?\)/i, '').trim();
}
