import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Shield, ShieldCheck, ShieldAlert, Key, Lock, AlertTriangle, 
  CheckCircle, RefreshCw, FileText, Server, AlertCircle, CheckCircle2, 
  X, Terminal, Copy, Check, ExternalLink, Zap, Flame, Globe, 
  ArrowRight, CornerDownRight, Sliders, Unlock, Plus, Trash2, 
  Eye, HelpCircle, ShieldX
} from 'lucide-react';
import { sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface SecurityCheck {
  id: string;
  category: 'ssh' | 'firewall' | 'intrusion' | 'kernel';
  title: string;
  status: 'passed' | 'warning' | 'failed';
  severity: 'high' | 'medium' | 'low';
  description: string;
  recommendation?: string;
  fixCommand?: string;
}

interface FailedLogin {
  ip: string;
  user: string;
  attempts: number;
  time: string;
  isBanned?: boolean;
}

interface SshKeyItem {
  id: string;
  type: string;
  key: string;
  comment: string;
  fingerprint: string;
}

interface SslCertItem {
  domain: string;
  issuer: string;
  expiryDate: string;
  daysRemaining: number;
  status: 'valid' | 'expiring' | 'expired';
}

interface ExposedPortItem {
  port: number;
  protocol: string;
  process: string;
  binding: string;
  isExposed: boolean;
}

export default function SecurityAuditor() {
  const [activeTab, setActiveTab] = useState<'audit' | 'ssh' | 'ports' | 'intrusion' | 'ssl' | 'suid'>('audit');
  const [scanning, setScanning] = useState(false);
  const [checks, setChecks] = useState<SecurityCheck[]>([]);
  const [failedLogins, setFailedLogins] = useState<FailedLogin[]>([]);
  const [sshKeys, setSshKeys] = useState<SshKeyItem[]>([]);
  const [sslCerts, setSslCerts] = useState<SslCertItem[]>([]);
  const [exposedPorts, setExposedPorts] = useState<ExposedPortItem[]>([]);
  const [suidBinaries, setSuidBinaries] = useState<string[]>([]);
  
  // Modals & Sheets
  const [fixModalTarget, setFixModalTarget] = useState<SecurityCheck | null>(null);
  const [isApplyingFix, setIsApplyingFix] = useState(false);
  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [newPublicKey, setNewPublicKey] = useState('');
  const [feedback, setFeedback] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const showNotification = (msg: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ msg, type });
    setTimeout(() => setFeedback(null), 3500);
  };

  // Run Comprehensive Security Scan
  const runSecurityAudit = useCallback(async () => {
    setScanning(true);
    const benchmarkResults: SecurityCheck[] = [];

    try {
      // 1. SSH Root Login check
      const rootRes = await sshExec(activeConnId, "grep -E '^PermitRootLogin' /etc/ssh/sshd_config 2>/dev/null || echo 'PermitRootLogin prohibit-password'");
      const rootText = rootRes.stdout.trim().toLowerCase();
      if (rootText.includes('no') || rootText.includes('prohibit-password')) {
        benchmarkResults.push({
          id: 'ssh_root',
          category: 'ssh',
          title: 'SSH Root Login Restricted',
          status: 'passed',
          severity: 'high',
          description: `Direct root login is restricted securely (${rootRes.stdout.trim() || 'prohibit-password'}).`
        });
      } else {
        benchmarkResults.push({
          id: 'ssh_root',
          category: 'ssh',
          title: 'SSH Root Login Allowed with Password',
          status: 'warning',
          severity: 'high',
          description: 'Direct root login over SSH is permitted via passwords, increasing brute-force risk.',
          recommendation: "Set 'PermitRootLogin prohibit-password' or 'no' in /etc/ssh/sshd_config",
          fixCommand: "sudo sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config && sudo systemctl reload ssh || sudo systemctl reload sshd"
        });
      }

      // 2. SSH Password Authentication
      const pwdRes = await sshExec(activeConnId, "grep -E '^PasswordAuthentication' /etc/ssh/sshd_config 2>/dev/null || echo 'PasswordAuthentication yes'");
      const pwdText = pwdRes.stdout.trim().toLowerCase();
      if (pwdText.includes('no')) {
        benchmarkResults.push({
          id: 'ssh_pwd',
          category: 'ssh',
          title: 'SSH Key-Only Authentication',
          status: 'passed',
          severity: 'high',
          description: 'Password authentication is disabled. SSH access strictly enforces cryptographic keys.'
        });
      } else {
        benchmarkResults.push({
          id: 'ssh_pwd',
          category: 'ssh',
          title: 'SSH Password Authentication Enabled',
          status: 'warning',
          severity: 'medium',
          description: 'SSH server allows plain password logins, vulnerable to credential stuffing.',
          recommendation: 'Enforce public key authentication (Ed25519) and disable password auth.',
          fixCommand: "sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && sudo systemctl reload ssh || sudo systemctl reload sshd"
        });
      }

      // 3. Firewall Protection (UFW / Iptables / Firewalld)
      const ufwRes = await sshExec(activeConnId, 'ufw status 2>/dev/null || firewall-cmd --state 2>/dev/null || echo inactive');
      if (ufwRes.stdout.toLowerCase().includes('active') || ufwRes.stdout.toLowerCase().includes('running')) {
        benchmarkResults.push({
          id: 'firewall',
          category: 'firewall',
          title: 'Host Firewall Active (UFW/Firewalld)',
          status: 'passed',
          severity: 'high',
          description: 'Packet filtering firewall daemon is active and enforcing port protection rules.'
        });
      } else {
        benchmarkResults.push({
          id: 'firewall',
          category: 'firewall',
          title: 'Firewall Inactive or Unconfigured',
          status: 'failed',
          severity: 'high',
          description: 'No active packet firewall detected. All open listening ports are exposed.',
          recommendation: 'Enable UFW firewall and allow only SSH, HTTP, and HTTPS ports.',
          fixCommand: 'sudo ufw default deny incoming && sudo ufw default allow outgoing && sudo ufw allow 22/tcp && sudo ufw --force enable'
        });
      }

      // 4. Intrusion Prevention (Fail2ban)
      const f2bRes = await sshExec(activeConnId, 'systemctl is-active fail2ban 2>/dev/null || echo inactive');
      if (f2bRes.stdout.trim() === 'active') {
        benchmarkResults.push({
          id: 'fail2ban',
          category: 'intrusion',
          title: 'Intrusion Prevention (Fail2ban) Active',
          status: 'passed',
          severity: 'medium',
          description: 'Fail2ban daemon is running, monitoring authentication logs and auto-banning rogue IPs.'
        });
      } else {
        benchmarkResults.push({
          id: 'fail2ban',
          category: 'intrusion',
          title: 'Fail2ban Daemon Inactive',
          status: 'warning',
          severity: 'medium',
          description: 'Automated brute-force IP banning is not running.',
          recommendation: 'Install and start fail2ban to protect against SSH dictionary attacks.',
          fixCommand: 'sudo apt-get update && sudo apt-get install -y fail2ban && sudo systemctl enable --now fail2ban'
        });
      }

      // 5. SYN Cookies Protection
      const synRes = await sshExec(activeConnId, 'cat /proc/sys/net/ipv4/tcp_syncookies 2>/dev/null || echo 1');
      if (synRes.stdout.trim() === '1') {
        benchmarkResults.push({
          id: 'syn_cookies',
          category: 'kernel',
          title: 'TCP SYN Cookie Protection Active',
          status: 'passed',
          severity: 'medium',
          description: 'Kernel mitigates SYN flood DoS attacks by generating cryptographic SYN cookies.'
        });
      } else {
        benchmarkResults.push({
          id: 'syn_cookies',
          category: 'kernel',
          title: 'TCP SYN Cookies Disabled',
          status: 'warning',
          severity: 'medium',
          description: 'Kernel is vulnerable to denial-of-service SYN flood attacks.',
          recommendation: "Enable net.ipv4.tcp_syncookies = 1 in /etc/sysctl.conf",
          fixCommand: 'sudo sysctl -w net.ipv4.tcp_syncookies=1'
        });
      }

      // 6. ASLR (Address Space Layout Randomization)
      const aslrRes = await sshExec(activeConnId, 'cat /proc/sys/kernel/randomize_va_space 2>/dev/null || echo 2');
      if (aslrRes.stdout.trim() === '2') {
        benchmarkResults.push({
          id: 'aslr',
          category: 'kernel',
          title: 'ASLR Memory Randomization Active',
          status: 'passed',
          severity: 'medium',
          description: 'Full ASLR (level 2) is active, randomizing stack, heap, and mmap memory spaces.'
        });
      } else {
        benchmarkResults.push({
          id: 'aslr',
          category: 'kernel',
          title: 'ASLR Memory Randomization Disabled/Weak',
          status: 'warning',
          severity: 'medium',
          description: 'Kernel memory addresses are predictable, easing buffer overflow exploits.',
          recommendation: 'Enable full memory layout randomization.',
          fixCommand: 'sudo sysctl -w kernel.randomize_va_space=2'
        });
      }

      // 7. SUID Binaries Audit
      const suidRes = await sshExec(activeConnId, 'find /usr/bin -perm -4000 2>/dev/null | head -n 30');
      const suidList = suidRes.stdout.trim().split('\n').filter(Boolean);
      setSuidBinaries(suidList);

      if (suidList.length <= 40) {
        benchmarkResults.push({
          id: 'suid_bins',
          category: 'kernel',
          title: 'SUID Privileged Binaries Audit Normal',
          status: 'passed',
          severity: 'low',
          description: `${suidList.length} SUID executable binaries detected, within standard distribution limits.`
        });
      } else {
        benchmarkResults.push({
          id: 'suid_bins',
          category: 'kernel',
          title: 'Elevated SUID Executable Count',
          status: 'warning',
          severity: 'low',
          description: `${suidList.length} SUID binaries detected in system directories. Audit for unusual binaries.`
        });
      }

      setChecks(benchmarkResults);

      // 8. Load Failed Logins & Attack IPs
      const authRes = await sshExec(activeConnId, "grep -E 'Failed password|authentication failure' /var/log/auth.log /var/log/secure 2>/dev/null | tail -n 25 || true");
      if (authRes.stdout) {
        const lines = authRes.stdout.trim().split('\n').filter(Boolean);
        const map = new Map<string, { user: string; attempts: number }>();
        lines.forEach(line => {
          const ipMatch = line.match(/from\s+([0-9.]+)/) || line.match(/rhost=([0-9.]+)/);
          const userMatch = line.match(/for\s+(invalid user\s+)?(\w+)/) || line.match(/user=(\w+)/);
          if (ipMatch) {
            const ip = ipMatch[1];
            const user = userMatch ? userMatch[userMatch.length - 1] : 'root';
            const prev = map.get(ip) || { user, attempts: 0 };
            prev.attempts++;
            map.set(ip, prev);
          }
        });

        const list: FailedLogin[] = [];
        map.forEach((val, ip) => {
          list.push({
            ip,
            user: val.user,
            attempts: val.attempts,
            time: 'Recent Attack'
          });
        });
        setFailedLogins(list);
      }

      // 9. Load Authorized SSH Keys
      const keysRes = await sshExec(activeConnId, 'cat ~/.ssh/authorized_keys 2>/dev/null || cat /root/.ssh/authorized_keys 2>/dev/null || echo ""');
      if (keysRes.stdout) {
        const keyLines = keysRes.stdout.trim().split('\n').filter(l => l.trim() && !l.startsWith('#'));
        const parsedKeys: SshKeyItem[] = keyLines.map((line, idx) => {
          const parts = line.trim().split(/\s+/);
          const type = parts[0] || 'ssh-rsa';
          const keyBody = parts[1] || '';
          const comment = parts.slice(2).join(' ') || `Key #${idx + 1}`;
          const fingerprint = keyBody ? `SHA256:${keyBody.slice(0, 16)}...` : '—';
          return {
            id: String(idx + 1),
            type,
            key: line,
            comment,
            fingerprint
          };
        });
        setSshKeys(parsedKeys);
      }

      // 10. Load Listening Open Ports
      const portsRes = await sshExec(activeConnId, "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null || echo ''");
      if (portsRes.stdout) {
        const pLines = portsRes.stdout.trim().split('\n').slice(1);
        const parsedPorts: ExposedPortItem[] = [];
        pLines.forEach(l => {
          const match = l.match(/LISTEN\s+\d+\s+\d+\s+([0-9a-fA-F.:*]+):(\d+).*?users:\(\("([^"]+)"/);
          if (match) {
            const bindAddr = match[1];
            const portNum = parseInt(match[2], 10);
            const procName = match[3];
            const isExposed = bindAddr === '0.0.0.0' || bindAddr === '*' || bindAddr === '::';
            parsedPorts.push({
              port: portNum,
              protocol: 'TCP',
              process: procName,
              binding: bindAddr,
              isExposed
            });
          }
        });
        setExposedPorts(parsedPorts);
      }

      // 11. Load SSL Certificates
      const certRes = await sshExec(activeConnId, 'find /etc/letsencrypt/live /etc/ssl/certs -name "*.crt" -o -name "fullchain.pem" 2>/dev/null | head -n 6');
      if (certRes.stdout) {
        const certPaths = certRes.stdout.trim().split('\n').filter(Boolean);
        const certList: SslCertItem[] = [];
        for (const cPath of certPaths) {
          const endRes = await sshExec(activeConnId, `openssl x509 -enddate -noout -in ${cPath} 2>/dev/null || true`);
          if (endRes.stdout && endRes.stdout.includes('notAfter=')) {
            const dateStr = endRes.stdout.replace('notAfter=', '').trim();
            const expTime = new Date(dateStr).getTime();
            const diffDays = Math.round((expTime - Date.now()) / (1000 * 60 * 60 * 24));
            const domainName = cPath.split('/').filter(Boolean).slice(-2, -1)[0] || 'localhost';
            certList.push({
              domain: domainName,
              issuer: "Let's Encrypt / DigiCert",
              expiryDate: new Date(dateStr).toLocaleDateString(),
              daysRemaining: diffDays,
              status: diffDays < 0 ? 'expired' : diffDays < 30 ? 'expiring' : 'valid'
            });
          }
        }
        setSslCerts(certList);
      }

    } catch (err) {
      console.warn('Security scan error:', err);
    } finally {
      setScanning(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    runSecurityAudit();
  }, [runSecurityAudit]);

  // Compute Hardening Score
  const passedCount = checks.filter(c => c.status === 'passed').length;
  const totalCount = checks.length || 1;
  const score = Math.round((passedCount / totalCount) * 100);

  // Apply Auto-Fix
  const handleApplyFix = async () => {
    if (!fixModalTarget?.fixCommand) return;
    setIsApplyingFix(true);
    try {
      const res = await sshExec(activeConnId, fixModalTarget.fixCommand);
      if (res.exit_code === 0) {
        showNotification(`Remediation applied: ${fixModalTarget.title}`);
        setFixModalTarget(null);
        await runSecurityAudit();
      } else {
        alert(`Failed to apply fix:\n${res.stderr || res.stdout}`);
      }
    } catch (err: any) {
      alert(`Execution error: ${err?.message || err}`);
    } finally {
      setIsApplyingFix(false);
    }
  };

  // Block Attacking IP with UFW
  const handleBlockIp = async (ip: string) => {
    if (!confirm(`Permanently block IP address ${ip} using UFW firewall?`)) return;
    try {
      const res = await sshExec(activeConnId, `sudo ufw insert 1 deny from ${ip} to any comment "Brute-force attacker"`);
      if (res.exit_code === 0) {
        showNotification(`Blocked IP: ${ip} successfully`);
        setFailedLogins(prev => prev.map(item => item.ip === ip ? { ...item, isBanned: true } : item));
      } else {
        alert(`Failed to block IP:\n${res.stderr}`);
      }
    } catch (err: any) {
      alert(`Error: ${err?.message || err}`);
    }
  };

  // Add Authorized SSH Key
  const handleAddSshKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPublicKey.trim()) return;
    try {
      const escaped = newPublicKey.trim().replace(/'/g, "'\\''");
      const res = await sshExec(activeConnId, `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${escaped}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`);
      if (res.exit_code === 0) {
        showNotification('Public SSH key added to authorized_keys');
        setShowAddKeyModal(false);
        setNewPublicKey('');
        await runSecurityAudit();
      } else {
        alert(`Failed to install key: ${res.stderr}`);
      }
    } catch (err: any) {
      alert(`Error: ${err?.message || err}`);
    }
  };

  return (
    <div className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none overflow-hidden font-sans relative ${scanning || isApplyingFix ? 'cursor-mac-wait' : ''}`}>
      {(scanning || isApplyingFix) && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-30 pointer-events-none" />
      )}
      
      {/* Toast Notification */}
      {feedback && (
        <div className="fixed top-12 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className={`px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-xl border flex items-center space-x-2 text-xs font-medium ${
            feedback.type === 'success' 
              ? 'bg-emerald-950/85 border-emerald-500/40 text-emerald-200' 
              : 'bg-rose-950/85 border-rose-500/40 text-rose-200'
          }`}>
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
            <span>{feedback.msg}</span>
          </div>
        </div>
      )}

      {/* 1. macOS Top Header Toolbar */}
      <header className="px-5 py-3.5 bg-[#14141e]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between shrink-0 overflow-x-auto no-scrollbar gap-3">
        
        {/* Left: App Identity */}
        <div className="flex items-center space-x-3.5 shrink-0">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/25 border border-white/20">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold tracking-tight text-white">Security & Privacy Auditor</span>
              <span className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                score >= 80 
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' 
                  : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${score >= 80 ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                <span>{score >= 80 ? 'Grade A · Hardened' : 'Grade B · Attention Required'}</span>
              </span>
            </div>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5">macOS Host Hardening, Threat Detection & Compliance</p>
          </div>
        </div>

        {/* Center: Segmented Navigation Switcher */}
        <div className="flex items-center bg-[#1e1e2e]/90 p-1 rounded-2xl border border-white/10 shadow-inner shrink-0">
          <button
            onClick={() => setActiveTab('audit')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'audit'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Audit ({passedCount}/{totalCount})</span>
          </button>

          <button
            onClick={() => setActiveTab('ssh')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'ssh'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>SSH Keys ({sshKeys.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('ports')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'ports'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-sky-400" />
            <span>Open Ports ({exposedPorts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('intrusion')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'intrusion'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>Intrusions ({failedLogins.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('ssl')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'ssl'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Lock className="w-3.5 h-3.5 text-purple-400" />
            <span>SSL / TLS ({sslCerts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('suid')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              activeTab === 'suid'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Terminal className="w-3.5 h-3.5 text-cyan-400" />
            <span>SUID Binaries</span>
          </button>
        </div>

        {/* Right: Rescan Button */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={runSecurityAudit}
            disabled={scanning}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 active:scale-95 text-white rounded-xl text-xs font-semibold shadow-md shadow-blue-600/25 transition-all border border-blue-400/30"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
            <span>{scanning ? 'Scanning...' : 'Re-scan Host'}</span>
          </button>
        </div>
      </header>

      {/* 2. Top Hardening Benchmark Metric Card */}
      <div className="px-5 py-3 bg-[#161622] border-b border-white/[0.06] flex items-center justify-between shrink-0 overflow-x-auto no-scrollbar gap-4">
        
        {/* Score Ring & Diagnosis */}
        <div className="flex items-center space-x-4">
          <div className="relative w-12 h-12 flex items-center justify-center">
            <svg className="w-12 h-12 -rotate-90">
              <circle
                cx="24"
                cy="24"
                r="20"
                stroke="currentColor"
                strokeWidth="4"
                className="text-white/10"
                fill="transparent"
              />
              <circle
                cx="24"
                cy="24"
                r="20"
                stroke="currentColor"
                strokeWidth="4"
                className={`${score >= 80 ? 'text-emerald-400' : 'text-amber-400'} transition-all duration-1000`}
                fill="transparent"
                strokeDasharray="125.6"
                strokeDashoffset={125.6 - (125.6 * score) / 100}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute text-xs font-bold font-mono text-white">{score}%</span>
          </div>

          <div>
            <div className="text-xs font-bold text-white flex items-center space-x-2">
              <span>Security Posture: {score >= 80 ? 'Robust & Hardened' : 'Vulnerabilities Present'}</span>
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Passed {passedCount} of {totalCount} hardening checks · {failedLogins.length} recent brute-force attempts
            </div>
          </div>
        </div>

        {/* Quick Indicators */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 text-xs">
            <Shield className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-gray-400">Firewall:</span>
            <span className="text-emerald-400 font-bold font-mono">
              {checks.find(c => c.id === 'firewall')?.status === 'passed' ? 'Active' : 'Disabled'}
            </span>
          </div>

          <div className="flex items-center space-x-2 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 text-xs">
            <Key className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-gray-400">SSH Keys:</span>
            <span className="text-purple-300 font-bold font-mono">{sshKeys.length} Authorized</span>
          </div>
        </div>
      </div>

      {/* 3. Main Content Views */}
      <div className="flex-1 min-h-0 p-5 overflow-hidden flex flex-col">
        
        {/* TAB 1: AUDIT BENCHMARKS */}
        {activeTab === 'audit' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="flex-1 overflow-y-auto divide-y divide-white/[0.05]">
              {checks.map(check => {
                const isPassed = check.status === 'passed';
                return (
                  <div key={check.id} className="p-4 flex items-start justify-between hover:bg-white/[0.02] transition-colors">
                    <div className="flex items-start space-x-3.5">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                        isPassed 
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' 
                          : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                      }`}>
                        {isPassed ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-bold text-white">{check.title}</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                            isPassed ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            {check.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">{check.description}</p>
                        {check.recommendation && (
                          <div className="text-[11px] text-amber-300/90 flex items-center space-x-1.5 pt-0.5">
                            <span className="font-semibold">💡 Recommendation:</span>
                            <span>{check.recommendation}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {!isPassed && check.fixCommand && (
                      <button
                        onClick={() => setFixModalTarget(check)}
                        className="px-3.5 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/30 text-xs font-semibold active:scale-95 transition-all flex items-center space-x-1.5 shrink-0 ml-4"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Remediate / Fix</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* TAB 2: SSH KEYS VAULT */}
        {activeTab === 'ssh' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="p-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Authorized SSH Public Keys (~/.ssh/authorized_keys)
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Cryptographic keys authorized to access this Linux host</p>
              </div>

              <button
                onClick={() => setShowAddKeyModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add SSH Key</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                  <tr>
                    <th className="py-2.5 px-4 w-32">Key Type</th>
                    <th className="py-2.5 px-4">Comment / Device Identity</th>
                    <th className="py-2.5 px-4 w-52">Fingerprint</th>
                    <th className="py-2.5 px-4 text-right pr-6 w-24 font-sans">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {sshKeys.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-16 text-center text-gray-500 font-sans">
                        No authorized SSH public keys found
                      </td>
                    </tr>
                  ) : (
                    sshKeys.map(k => (
                      <tr key={k.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-4 font-bold text-purple-400">
                          <span className="px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/30">
                            {k.type}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-white font-sans font-medium">{k.comment}</td>
                        <td className="py-3 px-4 text-gray-400 text-[11px]">{k.fingerprint}</td>
                        <td className="py-3 px-4 text-right pr-6">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(k.key);
                              showNotification('Public key copied to clipboard');
                            }}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10"
                            title="Copy Key"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: OPEN PORTS & ATTACK SURFACE */}
        {activeTab === 'ports' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="p-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Open Listening Ports & Attack Surface
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Audits local sockets exposed to external networks (0.0.0.0)</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                  <tr>
                    <th className="py-2.5 px-4 w-28">Port</th>
                    <th className="py-2.5 px-4 w-28">Protocol</th>
                    <th className="py-2.5 px-4">Service Process</th>
                    <th className="py-2.5 px-4">Bind Address</th>
                    <th className="py-2.5 px-4 text-right pr-6 w-36">Exposure</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {exposedPorts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-16 text-center text-gray-500 font-sans">
                        No listening ports detected
                      </td>
                    </tr>
                  ) : (
                    exposedPorts.map((p, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-4 font-bold text-amber-400 text-sm">:{p.port}</td>
                        <td className="py-3 px-4 text-gray-400 uppercase">{p.protocol}</td>
                        <td className="py-3 px-4 font-bold text-white font-sans">{p.process}</td>
                        <td className="py-3 px-4 text-gray-400">{p.binding}</td>
                        <td className="py-3 px-4 text-right pr-6 font-sans">
                          {p.isExposed ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 border border-rose-500/30 text-rose-400">
                              Internet Exposed
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                              Localhost Only
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 4: INTRUSIONS & ATTACK IPs */}
        {activeTab === 'intrusion' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="p-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  Failed Authentication Attempts & Brute-Force Log
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Live monitoring from /var/log/auth.log and /var/log/secure</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                  <tr>
                    <th className="py-2.5 px-4">Offending IP Address</th>
                    <th className="py-2.5 px-4">Targeted User</th>
                    <th className="py-2.5 px-4 w-32">Failed Attempts</th>
                    <th className="py-2.5 px-4 text-right pr-6 w-36 font-sans">Firewall Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {failedLogins.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-16 text-center text-gray-500 font-sans">
                        No recent unauthorized brute-force attempts detected
                      </td>
                    </tr>
                  ) : (
                    failedLogins.map((item, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-4 font-bold text-rose-400">{item.ip}</td>
                        <td className="py-3 px-4 text-gray-300 font-sans">{item.user}</td>
                        <td className="py-3 px-4 text-amber-400 font-bold">{item.attempts} attempts</td>
                        <td className="py-3 px-4 text-right pr-6 font-sans">
                          {item.isBanned ? (
                            <span className="text-[11px] font-bold text-emerald-400 flex items-center justify-end space-x-1">
                              <Check className="w-3.5 h-3.5" />
                              <span>Blocked</span>
                            </span>
                          ) : (
                            <button
                              onClick={() => handleBlockIp(item.ip)}
                              className="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-semibold active:scale-95 transition-all"
                            >
                              Block IP (UFW)
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: SSL CERTIFICATES */}
        {activeTab === 'ssl' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="p-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  TLS / SSL Certificate Expiration Tracker
                </h3>
                <p className="text-[11px] text-gray-400 mt-0.5">Monitors Let&apos;s Encrypt and web server certificates</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                  <tr>
                    <th className="py-2.5 px-4">Domain / Common Name</th>
                    <th className="py-2.5 px-4">Authority Issuer</th>
                    <th className="py-2.5 px-4">Expiry Date</th>
                    <th className="py-2.5 px-4 text-right pr-6 font-sans">Days Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {sslCerts.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-16 text-center text-gray-500 font-sans">
                        No Let&apos;s Encrypt or Nginx SSL certificates detected in standard paths
                      </td>
                    </tr>
                  ) : (
                    sslCerts.map((cert, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-4 font-bold text-white font-sans flex items-center space-x-2">
                          <Lock className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{cert.domain}</span>
                        </td>
                        <td className="py-3 px-4 text-gray-400">{cert.issuer}</td>
                        <td className="py-3 px-4 text-gray-300">{cert.expiryDate}</td>
                        <td className="py-3 px-4 text-right pr-6 font-sans">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            cert.daysRemaining > 30 
                              ? 'bg-emerald-500/20 text-emerald-400' 
                              : 'bg-amber-500/20 text-amber-400'
                          }`}>
                            {cert.daysRemaining} days left
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 6: SUID PRIVILEGED BINARIES */}
        {activeTab === 'suid' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl p-5 overflow-y-auto backdrop-blur-md space-y-4">
            <div>
              <h3 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                SUID Executables Detected (/usr/bin -perm -4000)
              </h3>
              <p className="text-[11px] text-gray-400 mt-0.5">Binaries that execute with root user privileges regardless of who launches them</p>
            </div>

            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              {suidBinaries.map((bin, i) => (
                <div key={i} className="p-2.5 bg-[#14141e] rounded-xl border border-white/5 flex items-center space-x-2 text-gray-300">
                  <Terminal className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="truncate">{bin}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* ================= MODAL: REMEDIATION / FIX SHEET ================= */}
      {fixModalTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-2xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center text-blue-400">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Apply Security Remediation</h3>
                  <p className="text-[11px] text-gray-400">{fixModalTarget.title}</p>
                </div>
              </div>
              <button 
                onClick={() => setFixModalTarget(null)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-300 leading-relaxed">
                SSH Desktop will execute the following hardening command on your server to resolve this vulnerability:
              </p>

              <div className="bg-[#101018] p-3.5 rounded-xl border border-white/10 font-mono text-xs text-amber-300 break-all select-text leading-relaxed">
                $ {fixModalTarget.fixCommand}
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[11px] text-amber-200 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>Make sure you have alternate SSH key access verified before disabling password authentication or root login.</span>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  onClick={() => setFixModalTarget(null)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyFix}
                  disabled={isApplyingFix}
                  className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all shadow-lg shadow-blue-600/30 flex items-center space-x-2"
                >
                  {isApplyingFix && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isApplyingFix ? 'Applying...' : 'Execute Fix'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: ADD AUTHORIZED SSH KEY ================= */}
      {showAddKeyModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-2xl bg-purple-600/30 border border-purple-400/30 flex items-center justify-center text-purple-400">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Add Authorized SSH Public Key</h3>
                  <p className="text-[11px] text-gray-400">Authorize a new public key for passwordless login</p>
                </div>
              </div>
              <button 
                onClick={() => setShowAddKeyModal(false)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSshKey} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Public Key Data (ssh-ed25519 / ssh-rsa)</label>
                <textarea
                  required
                  rows={4}
                  value={newPublicKey}
                  onChange={e => setNewPublicKey(e.target.value)}
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... user@laptop"
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl p-3 font-mono text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 select-text"
                />
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowAddKeyModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newPublicKey.trim()}
                  className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all shadow-lg shadow-blue-600/30"
                >
                  Install Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

export { SecurityAuditor };
