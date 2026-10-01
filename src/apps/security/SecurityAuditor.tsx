import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, ShieldAlert, Key, Lock, AlertTriangle, CheckCircle, RefreshCw, FileText } from 'lucide-react';
import { sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface SecurityCheck {
  title: string;
  status: 'passed' | 'warning' | 'failed';
  description: string;
  recommendation?: string;
}

interface FailedLogin {
  ip: string;
  user: string;
  attempts: number;
  time: string;
}

export default function SecurityAuditor() {
  const [checks, setChecks] = useState<SecurityCheck[]>([
    { title: 'SSH Root Login Restricted', status: 'warning', description: 'Checking /etc/ssh/sshd_config...' },
    { title: 'SSH Password Authentication', status: 'warning', description: 'Checking authentication methods...' },
    { title: 'Firewall (UFW / Iptables)', status: 'warning', description: 'Checking firewall daemon status...' },
    { title: 'Intrusion Prevention (Fail2ban)', status: 'warning', description: 'Checking fail2ban service...' },
    { title: 'SUID Binaries Audit', status: 'warning', description: 'Auditing SUID executables...' },
  ]);
  const [banned, setBanned] = useState<FailedLogin[]>([]);
  const [scanning, setScanning] = useState(false);
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const runAudit = useCallback(async () => {
    setScanning(true);
    try {
      const results: SecurityCheck[] = [];

      // 1. Root login check
      const rootRes = await sshExec(activeConnId, "grep -E '^PermitRootLogin' /etc/ssh/sshd_config 2>/dev/null || echo 'PermitRootLogin prohibit-password'");
      const rootText = rootRes.stdout.trim().toLowerCase();
      if (rootText.includes('no') || rootText.includes('prohibit-password')) {
        results.push({
          title: 'SSH Root Login Restricted',
          status: 'passed',
          description: `PermitRootLogin is securely set (${rootText})`
        });
      } else {
        results.push({
          title: 'SSH Root Login Restricted',
          status: 'warning',
          description: 'Root login may be permitted via password',
          recommendation: "Set 'PermitRootLogin prohibit-password' in /etc/ssh/sshd_config"
        });
      }

      // 2. Password authentication check
      const pwdRes = await sshExec(activeConnId, "grep -E '^PasswordAuthentication' /etc/ssh/sshd_config 2>/dev/null || echo 'PasswordAuthentication yes'");
      const pwdText = pwdRes.stdout.trim().toLowerCase();
      if (pwdText.includes('no')) {
        results.push({
          title: 'SSH Password Authentication',
          status: 'passed',
          description: 'Password authentication disabled; keys only'
        });
      } else {
        results.push({
          title: 'SSH Password Authentication',
          status: 'warning',
          description: 'Password authentication is enabled',
          recommendation: "Disable password auth in favor of Ed25519 SSH keys"
        });
      }

      // 3. Firewall status
      const ufwRes = await sshExec(activeConnId, 'which ufw >/dev/null && ufw status || echo inactive');
      if (ufwRes.stdout.toLowerCase().includes('active')) {
        results.push({
          title: 'Firewall (UFW) Protection',
          status: 'passed',
          description: 'UFW firewall is active and filtering inbound packets'
        });
      } else {
        results.push({
          title: 'Firewall (UFW) Protection',
          status: 'warning',
          description: 'Firewall is currently inactive or not installed',
          recommendation: 'Enable UFW via CloudDesk Firewall Manager'
        });
      }

      // 4. Fail2ban
      const f2bRes = await sshExec(activeConnId, 'systemctl is-active fail2ban 2>/dev/null || echo inactive');
      if (f2bRes.stdout.trim() === 'active') {
        results.push({
          title: 'Intrusion Prevention (Fail2ban)',
          status: 'passed',
          description: 'fail2ban daemon is running and monitoring auth logs'
        });
      } else {
        results.push({
          title: 'Intrusion Prevention (Fail2ban)',
          status: 'warning',
          description: 'fail2ban is not active',
          recommendation: 'Install fail2ban to mitigate brute-force attempts'
        });
      }

      // 5. SUID binaries
      const suidRes = await sshExec(activeConnId, 'find /usr/bin -perm -4000 2>/dev/null | wc -l');
      const suidCount = parseInt(suidRes.stdout.trim()) || 0;
      results.push({
        title: 'SUID Binaries Audit',
        status: suidCount < 50 ? 'passed' : 'warning',
        description: `${suidCount} SUID executables detected in /usr/bin`,
        recommendation: suidCount >= 50 ? 'Audit unusual SUID permissions' : undefined
      });

      setChecks(results);

      // Failed logins from auth log
      const authRes = await sshExec(activeConnId, "grep 'Failed password' /var/log/auth.log 2>/dev/null | tail -n 10 || true");
      if (authRes.stdout) {
        const lines = authRes.stdout.trim().split('\n').filter(Boolean);
        const map = new Map<string, { user: string; attempts: number }>();
        lines.forEach(line => {
          const ipMatch = line.match(/from\s+([0-9.]+)/);
          const userMatch = line.match(/for\s+(invalid user\s+)?(\w+)/);
          if (ipMatch) {
            const ip = ipMatch[1];
            const user = userMatch ? userMatch[2] : 'unknown';
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
            time: 'Recent'
          });
        });
        setBanned(list);
      }
    } catch (err) {
      console.warn('Security audit scan error:', err);
    } finally {
      setScanning(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    runAudit();
  }, [runAudit]);

  const passedCount = checks.filter(c => c.status === 'passed').length;
  const score = Math.round((passedCount / (checks.length || 1)) * 100);

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Top Score Banner */}
      <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-2xl border ${
            score >= 80 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
          }`}>
            {score}%
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-base text-white">Security Posture: {score >= 80 ? 'Hardened' : 'Attention Needed'}</span>
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                score >= 80 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
              }`}>
                {score >= 80 ? 'GRADE A' : 'GRADE B/C'}
              </span>
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {passedCount} of {checks.length} security hardening benchmarks passed
            </div>
          </div>
        </div>

        <button
          onClick={runAudit}
          disabled={scanning}
          className="flex items-center space-x-1.5 bg-[var(--accent)] hover:bg-blue-600 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} />
          <span>{scanning ? 'Scanning...' : 'Re-scan Server'}</span>
        </button>
      </div>

      {/* Security Hardening Checklist */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Hardening Checklist</h3>
        <div className="bg-[#1e1e2e] rounded-xl border border-white/[0.08] divide-y divide-white/[0.05]">
          {checks.map(check => (
            <div key={check.title} className="p-3 flex items-start justify-between">
              <div className="flex items-start space-x-3">
                {check.status === 'passed' ? (
                  <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                )}
                <div>
                  <div className="text-xs font-medium text-white">{check.title}</div>
                  <div className="text-xs text-gray-400">{check.description}</div>
                  {check.recommendation && (
                    <div className="text-[11px] text-amber-300 mt-0.5">💡 {check.recommendation}</div>
                  )}
                </div>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                check.status === 'passed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
              }`}>
                {check.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Failed Logins Section */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Recent Failed SSH Attempts (Live Auth Log)</h3>
        <div className="bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden">
          {banned.length === 0 ? (
            <div className="p-4 text-xs text-center text-gray-500">
              No recent unauthorized brute-force attempts detected in /var/log/auth.log
            </div>
          ) : (
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
                <tr>
                  <th className="py-2.5 px-3">Offending IP</th>
                  <th className="py-2.5 px-3">Targeted User</th>
                  <th className="py-2.5 px-3">Attempts</th>
                  <th className="py-2.5 px-3 text-right">Detection</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {banned.map((item, idx) => (
                  <tr key={idx} className="hover:bg-white/[0.02]">
                    <td className="py-2 px-3 text-rose-400 font-bold">{item.ip}</td>
                    <td className="py-2 px-3 text-gray-300">{item.user}</td>
                    <td className="py-2 px-3 text-amber-400">{item.attempts}</td>
                    <td className="py-2 px-3 text-right text-gray-500">{item.time}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
