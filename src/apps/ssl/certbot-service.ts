import { sshExec } from '../../lib/tauri-bridge';
import { SslCertificate, CertbotStatus, IssueCertForm, SelfSignedForm, SslDiagnosticResult, CertStatus } from './types';

/**
 * Detect Certbot CLI, systemd auto-renewal timer, and installed web servers on the remote host
 */
export async function detectCertbotStatus(connId: string): Promise<CertbotStatus> {
  const probeScript = `
echo "===WHICH_CERTBOT==="
which certbot 2>/dev/null || which /snap/bin/certbot 2>/dev/null || echo "NOT_FOUND"

echo "===VERSION==="
certbot --version 2>&1 || /snap/bin/certbot --version 2>&1 || echo "UNKNOWN"

echo "===SYSTEMD_TIMER==="
systemctl is-active certbot.timer certbot.service 2>/dev/null || true

echo "===SERVERS==="
which nginx 2>/dev/null || true
which apache2 2>/dev/null || true
which httpd 2>/dev/null || true
which caddy 2>/dev/null || true

echo "===PLUGINS==="
dpkg -l 2>/dev/null | grep -E "python3-certbot|certbot-nginx|certbot-apache" || rpm -qa 2>/dev/null | grep -E "certbot|certbot-nginx|certbot-apache" || true

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

    const isInstalled = !whichSection.includes('NOT_FOUND') && whichSection.trim().length > 0;
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
    let packageManager = 'apt / dnf / pacman';
    let suggestedCommand = 'sudo apt update && sudo apt install -y certbot python3-certbot-nginx python3-certbot-apache';

    if (['ubuntu', 'debian', 'kali', 'pop', 'linuxmint'].includes(osId)) {
      packageManager = 'apt';
      suggestedCommand = 'sudo apt-get update && sudo apt-get install -y certbot python3-certbot-nginx python3-certbot-apache';
    } else if (['centos', 'rhel', 'rocky', 'almalinux'].includes(osId)) {
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
      suggestedCommand = 'sudo apk add --no-cache certbot certbot-nginx certbot-apache';
    } else {
      packageManager = 'snap / pip';
      suggestedCommand = 'sudo snap install --classic certbot';
    }

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
        nginx: serversSection.includes('nginx'),
        apache: serversSection.includes('apache2') || serversSection.includes('httpd'),
        caddy: serversSection.includes('caddy'),
      },
      plugins: {
        nginx: pluginsSection.includes('nginx'),
        apache: pluginsSection.includes('apache'),
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
 * Installs Certbot and webserver plugins using the host's native package manager
 */
export async function installCertbot(connId: string, webserver?: 'nginx' | 'apache' | 'standalone'): Promise<{ success: boolean; output: string }> {
  const installCmd = `
# Determine if running as root or need sudo
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi

if [ -f /etc/os-release ]; then
  . /etc/os-release
  OS_ID=$ID
else
  OS_ID="unknown"
fi

echo "Detected OS: $OS_ID (Privilege: \${SUDO:-root})"
echo "Beginning automated Certbot installation..."

if [ "$OS_ID" = "ubuntu" ] || [ "$OS_ID" = "debian" ] || [ "$OS_ID" = "kali" ] || [ "$OS_ID" = "pop" ] || [ "$OS_ID" = "linuxmint" ]; then
  export DEBIAN_FRONTEND=noninteractive
  $SUDO apt-get update -y && $SUDO apt-get install -y certbot python3-certbot-nginx python3-certbot-apache
elif [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "rocky" ] || [ "$OS_ID" = "almalinux" ]; then
  $SUDO dnf install -y epel-release || $SUDO yum install -y epel-release || true
  $SUDO dnf install -y certbot python3-certbot-nginx python3-certbot-apache || $SUDO yum install -y certbot python3-certbot-nginx python3-certbot-apache
elif [ "$OS_ID" = "fedora" ]; then
  $SUDO dnf install -y certbot python3-certbot-nginx python3-certbot-apache
elif [ "$OS_ID" = "arch" ] || [ "$OS_ID" = "manjaro" ]; then
  $SUDO pacman -Sy --noconfirm certbot certbot-nginx certbot-apache
elif [ "$OS_ID" = "alpine" ]; then
  $SUDO apk add --no-cache certbot certbot-nginx certbot-apache
else
  # Generic fallback via snap or pip
  if command -v snap >/dev/null 2>&1; then
    $SUDO snap install --classic certbot && $SUDO ln -sf /snap/bin/certbot /usr/bin/certbot
  else
    $SUDO python3 -m pip install certbot certbot-nginx certbot-apache 2>/dev/null || $SUDO pip3 install certbot
  fi
fi

# Verify installation outcome
echo "===INSTALL_VERIFY==="
which certbot || which /snap/bin/certbot || echo "CERTBOT_STILL_MISSING"
certbot --version 2>&1 || /snap/bin/certbot --version 2>&1 || true
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
 * Lists all active certificates managed by Certbot, plus custom certificates
 */
export async function listCertificates(connId: string): Promise<SslCertificate[]> {
  const script = `
echo "===CERTBOT_CERTS==="
sudo certbot certificates 2>/dev/null || certbot certificates 2>/dev/null || true

echo "===CUSTOM_CERTS==="
# Scan for additional custom fullchain or server certs in /etc/ssl/certs and webservers
sudo find /etc/ssl/certs /etc/nginx/ssl /etc/apache2/ssl /etc/httpd/ssl /etc/ssl/private -maxdepth 2 -type f \\( -name "*.crt" -o -name "*.pem" \\) ! -name "ca-certificates.crt" ! -name "ca-bundle.crt" 2>/dev/null | head -n 15 | while read -r f; do
  if [ -r "$f" ]; then
    echo "FILE:$f"
    openssl x509 -in "$f" -noout -subject -issuer -dates -serial 2>/dev/null || true
    echo "---"
  fi
done
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

        // Skip if this cert is already captured via Let's Encrypt live path
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
 * Issues a new Let's Encrypt certificate via Certbot
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

  const domainFlags = domainList.map(d => `-d "${d}"`).join(' ');
  const emailFlag = form.email.trim() ? `-m "${form.email.trim()}"` : '--register-unsafely-without-email';
  const dryRunFlag = form.dryRun ? '--dry-run' : '';
  const keyTypeFlag = form.keyType === 'ecdsa' ? '--key-type ecdsa' : `--key-type rsa --rsa-key-size ${form.rsaKeySize || 2048}`;
  const redirectFlag = form.redirectHttps ? '--redirect' : '--no-redirect';

  let command = '';

  switch (form.plugin) {
    case 'nginx':
      command = `sudo certbot --nginx ${domainFlags} ${emailFlag} --agree-tos --non-interactive ${redirectFlag} ${keyTypeFlag} ${dryRunFlag}`;
      break;
    case 'apache':
      command = `sudo certbot --apache ${domainFlags} ${emailFlag} --agree-tos --non-interactive ${redirectFlag} ${keyTypeFlag} ${dryRunFlag}`;
      break;
    case 'webroot':
      const rootDir = form.webrootPath?.trim() || '/var/www/html';
      command = `sudo certbot certonly --webroot -w "${rootDir}" ${domainFlags} ${emailFlag} --agree-tos --non-interactive ${keyTypeFlag} ${dryRunFlag}`;
      break;
    case 'standalone':
      command = `sudo certbot certonly --standalone ${domainFlags} ${emailFlag} --agree-tos --non-interactive ${keyTypeFlag} ${dryRunFlag}`;
      break;
    case 'dns':
      command = `sudo certbot certonly --manual --preferred-challenges dns ${domainFlags} ${emailFlag} --agree-tos ${keyTypeFlag} ${dryRunFlag}`;
      break;
  }

  const res = await sshExec(connId, command);
  const out = (res.stdout || '') + (res.stderr ? '\n' + res.stderr : '');
  const success = res.exit_code === 0 || out.includes('Congratulations!') || out.includes('The dry run was successful');

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
  let cmd = 'sudo certbot renew';
  if (dryRun) cmd += ' --dry-run';
  if (certName) cmd += ` --cert-name "${certName}" --force-renewal`;

  const res = await sshExec(connId, cmd);
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
  const cmd = `sudo certbot revoke --cert-name "${certName}" --reason "${reason}" --delete-after-revoke --non-interactive`;
  const res = await sshExec(connId, cmd);
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
  const cmd = `sudo certbot delete --cert-name "${certName}" --non-interactive`;
  const res = await sshExec(connId, cmd);
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
 */
export async function generateSelfSignedCertificate(
  connId: string,
  form: SelfSignedForm
): Promise<{ success: boolean; certPath: string; keyPath: string; output: string }> {
  const outDir = form.outputDir.replace(/\/+$/, '') || '/etc/ssl/certs';
  const certPath = `${outDir}/${form.domain}.crt`;
  const keyPath = `${outDir}/${form.domain}.key`;

  const cmd = `
sudo mkdir -p "${outDir}"
sudo openssl req -x509 -nodes -days ${form.validDays || 365} -newkey rsa:2048 \\
  -keyout "${keyPath}" \\
  -out "${certPath}" \\
  -subj "/C=${form.country || 'US'}/O=${form.organization || 'Local Development'}/CN=${form.domain}"
`;

  const res = await sshExec(connId, cmd);
  return {
    success: res.exit_code === 0,
    certPath,
    keyPath,
    output: (res.stdout || '') + (res.stderr ? '\n' + res.stderr : ''),
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
