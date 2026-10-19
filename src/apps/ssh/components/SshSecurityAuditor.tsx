import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, ShieldAlert, Key, Plus, Trash2, RefreshCw, 
  Check, Copy, AlertTriangle, Lock, Server, FileText, ChevronRight,
  X, CheckCircle2
} from 'lucide-react';
import { RemoteAuthorizedKey, RemoteKnownHost, SshdSecurityAudit } from '../types';
import { parseAuthorizedKeyLine } from '../utils/sshKeyCrypto';
import { useConnectionStore } from '../../../lib/store';
import { sshExec } from '../../../lib/tauri-bridge';
import { useSshStore } from '../sshStore';

export default function SshSecurityAuditor({ isLight = false }: { isLight?: boolean }) {
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);
  const { addAuditLog } = useSshStore();

  const [activeTab, setActiveTab] = useState<'authorized' | 'known_hosts' | 'sshd_audit'>('authorized');
  const [authorizedKeys, setAuthorizedKeys] = useState<RemoteAuthorizedKey[]>([]);
  const [knownHosts, setKnownHosts] = useState<RemoteKnownHost[]>([]);
  const [sshdAudit, setSshdAudit] = useState<SshdSecurityAudit | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showAddKeyModal, setShowAddKeyModal] = useState(false);
  const [newKeyText, setNewKeyText] = useState('');

  // Revoke Modal State
  const [keyToRevoke, setKeyToRevoke] = useState<RemoteAuthorizedKey | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  // Load Remote Data
  const loadRemoteData = async () => {
    if (!activeConnectionId) {
      setError('Please connect to a server to audit authorized keys and SSH daemon security.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // 1. Read authorized_keys
      const authRes = await sshExec(activeConnectionId, 'cat ~/.ssh/authorized_keys 2>/dev/null || true');
      if (authRes.exit_code === 0) {
        const lines = authRes.stdout.split('\n');
        const parsedKeys: RemoteAuthorizedKey[] = [];
        for (let i = 0; i < lines.length; i++) {
          const parsed = await parseAuthorizedKeyLine(lines[i], i);
          if (parsed) parsedKeys.push(parsed);
        }
        setAuthorizedKeys(parsedKeys);
      }

      // 2. Read known_hosts
      const knownRes = await sshExec(activeConnectionId, 'cat ~/.ssh/known_hosts 2>/dev/null || true');
      if (knownRes.exit_code === 0) {
        const lines = knownRes.stdout.split('\n');
        const hosts: RemoteKnownHost[] = [];
        lines.forEach((line, idx) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
              hosts.push({
                id: `known-${idx}-${Date.now()}`,
                raw: trimmed,
                host: parts[0],
                keyType: parts[1],
                fingerprint: `Key: ${parts[2]?.slice(0, 16) || parts[1]}...`,
              });
            }
          }
        });
        setKnownHosts(hosts);
      }

      // 3. Audit sshd_config
      const sshdRes = await sshExec(
        activeConnectionId,
        'grep -E "^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|Port|MaxAuthTries|X11Forwarding)" /etc/ssh/sshd_config 2>/dev/null || true'
      );

      const sshdOut = sshdRes.stdout;
      const permitRoot = sshdOut.match(/PermitRootLogin\s+(\S+)/i)?.[1]?.toLowerCase() as any || 'prohibit-password';
      const passwordAuth = sshdOut.match(/PasswordAuthentication\s+(\S+)/i)?.[1]?.toLowerCase() as any || 'yes';
      const pubkeyAuth = sshdOut.match(/PubkeyAuthentication\s+(\S+)/i)?.[1]?.toLowerCase() as any || 'yes';
      const port = Number(sshdOut.match(/Port\s+(\d+)/i)?.[1]) || 22;
      const maxAuthTries = Number(sshdOut.match(/MaxAuthTries\s+(\d+)/i)?.[1]) || 6;
      const x11 = sshdOut.match(/X11Forwarding\s+(\S+)/i)?.[1]?.toLowerCase() as any || 'no';

      let score = 100;
      const issues: string[] = [];
      const recommendations: string[] = [];

      if (permitRoot === 'yes') {
        score -= 30;
        issues.push('Direct root login via SSH is enabled (PermitRootLogin yes).');
        recommendations.push('Set "PermitRootLogin prohibit-password" or "no" and use sudo instead.');
      }

      if (passwordAuth === 'yes') {
        score -= 20;
        issues.push('Password authentication is enabled, susceptible to brute-force attacks.');
        recommendations.push('Switch to SSH key-based authentication only (PasswordAuthentication no).');
      }

      if (port === 22) {
        score -= 10;
        issues.push('Default port 22 is used, heavily scanned by automated bots.');
        recommendations.push('Change Port in /etc/ssh/sshd_config to a non-standard port (e.g. 2222 or 52222).');
      }

      if (maxAuthTries > 3) {
        score -= 10;
        issues.push(`MaxAuthTries is set to ${maxAuthTries}, allowing multiple login attempts.`);
        recommendations.push('Set MaxAuthTries to 3 to quickly drop brute-force attacks.');
      }

      if (x11 === 'yes') {
        score -= 10;
        issues.push('X11Forwarding is enabled, introducing potential GUI display security risks.');
        recommendations.push('Disable X11Forwarding if graphical application remoting is not required.');
      }

      setSshdAudit({
        permitRootLogin: permitRoot,
        passwordAuthentication: passwordAuth,
        pubkeyAuthentication: pubkeyAuth,
        port,
        maxAuthTries,
        x11Forwarding: x11,
        score: Math.max(20, score),
        issues,
        recommendations,
      });

    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRemoteData();
  }, [activeConnectionId]);

  // Revoke / Delete key from authorized_keys (Clean Base64 line filtering, no broken sed)
  const confirmRevokeKey = async (key: RemoteAuthorizedKey) => {
    if (!activeConnectionId) return;
    setIsRevoking(true);
    setError(null);

    try {
      const readRes = await sshExec(activeConnectionId, 'cat ~/.ssh/authorized_keys 2>/dev/null || true');
      const lines = (readRes.stdout || '').split('\n');

      const targetPub = key.publicKeyBase64.trim();
      const targetRaw = key.raw.trim();

      const remainingLines = lines.filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        if (trimmed === targetRaw) return false;
        if (targetPub && trimmed.includes(targetPub)) return false;
        return true;
      });

      const newContent = remainingLines.join('\n') + (remainingLines.length > 0 ? '\n' : '');
      const b64 = btoa(unescape(encodeURIComponent(newContent)));

      const writeCmd = `mkdir -p ~/.ssh && echo "${b64}" | base64 -d > ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
      const res = await sshExec(activeConnectionId, writeCmd);

      if (res.exit_code === 0) {
        setAuthorizedKeys(prev => prev.filter(k => k.id !== key.id));
        setKeyToRevoke(null);
        setToastMessage(`Revoked key "${key.comment}" successfully from authorized_keys.`);
        setTimeout(() => setToastMessage(null), 3500);

        addAuditLog({
          action: 'Revoked SSH Key',
          host: activeServer?.host || 'server',
          username: activeServer?.username || 'root',
          status: 'warning',
          details: `Revoked key "${key.comment}" (${key.fingerprint}) from ~/.ssh/authorized_keys`,
        });
      } else {
        setError(`Failed to revoke key: ${res.stderr || res.stdout}`);
      }
    } catch (err: any) {
      setError(`Error revoking key: ${err?.message || err}`);
    } finally {
      setIsRevoking(false);
    }
  };

  // Add new key to authorized_keys
  const handleAddAuthorizedKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeConnectionId || !newKeyText.trim()) return;

    try {
      const sanitized = newKeyText.trim().replace(/'/g, "'\\''");
      const appendCmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${sanitized}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`;
      const res = await sshExec(activeConnectionId, appendCmd);
      if (res.exit_code === 0) {
        setShowAddKeyModal(false);
        setNewKeyText('');
        loadRemoteData();
        setToastMessage('Public key added to ~/.ssh/authorized_keys');
        setTimeout(() => setToastMessage(null), 3000);

        addAuditLog({
          action: 'Added Authorized Key',
          host: activeServer?.host || 'server',
          username: activeServer?.username || 'root',
          status: 'success',
          details: 'Added new public key to ~/.ssh/authorized_keys',
        });
      } else {
        setError(res.stderr || 'Failed to add key');
      }
    } catch (err: any) {
      setError(`Error: ${err?.message || err}`);
    }
  };

  // Delete host from known_hosts
  const handleDeleteKnownHost = async (host: RemoteKnownHost) => {
    if (!activeConnectionId) return;
    try {
      const readRes = await sshExec(activeConnectionId, 'cat ~/.ssh/known_hosts 2>/dev/null || true');
      const lines = (readRes.stdout || '').split('\n');
      const targetRaw = host.raw.trim();
      const remaining = lines.filter(l => l.trim() && l.trim() !== targetRaw);
      const newContent = remaining.join('\n') + (remaining.length > 0 ? '\n' : '');
      const b64 = btoa(unescape(encodeURIComponent(newContent)));

      await sshExec(activeConnectionId, `echo "${b64}" | base64 -d > ~/.ssh/known_hosts && chmod 644 ~/.ssh/known_hosts`);
      setKnownHosts(prev => prev.filter(h => h.id !== host.id));
      setToastMessage(`Removed ${host.host} from known_hosts`);
      setTimeout(() => setToastMessage(null), 3000);
    } catch (err: any) {
      setError(`Error: ${err?.message || err}`);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e2e]/90 text-gray-200 select-none overflow-hidden font-sans">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#181825] border-b border-white/[0.08]">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <span>SSH Security & Key Auditor</span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Audit authorized_keys, known_hosts, and inspect Linux SSH daemon security posture
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          {activeTab === 'authorized' && (
            <button
              onClick={() => setShowAddKeyModal(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-md transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Key</span>
            </button>
          )}

          <button
            onClick={loadRemoteData}
            disabled={isLoading}
            className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Audit Now</span>
          </button>
        </div>
      </div>

      {/* Tabs Subheader */}
      <div className="flex items-center space-x-2 px-6 py-2.5 bg-[#181825]/60 border-b border-white/[0.06] text-xs">
        <button
          onClick={() => setActiveTab('authorized')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
            activeTab === 'authorized'
              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-semibold'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>Authorized Keys ({authorizedKeys.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('sshd_audit')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
            activeTab === 'sshd_audit'
              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-semibold'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>sshd_config Security Posture</span>
          {sshdAudit && (
            <span className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
              sshdAudit.score >= 80 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
            }`}>
              {sshdAudit.score}/100
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('known_hosts')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
            activeTab === 'known_hosts'
              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-semibold'
              : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Server className="w-3.5 h-3.5" />
          <span>Known Hosts ({knownHosts.length})</span>
        </button>
      </div>

      {/* Notification Toast */}
      {toastMessage && (
        <div className="px-6 py-2 bg-emerald-500/20 border-b border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
          <button onClick={() => setToastMessage(null)} className="text-gray-400 hover:text-white cursor-pointer">✕</button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {error && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300 flex items-center space-x-2 mb-4">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Tab 1: Authorized Keys */}
        {activeTab === 'authorized' && (
          <div className="space-y-3">
            {authorizedKeys.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center text-gray-400">
                <Key className="w-12 h-12 text-gray-600 mb-3" />
                <p className="text-sm font-medium text-gray-300">No authorized keys found</p>
                <p className="text-xs text-gray-500 mt-1 max-w-sm">
                  Add public keys to ~/.ssh/authorized_keys to allow passwordless SSH login.
                </p>
                <button
                  onClick={() => setShowAddKeyModal(true)}
                  className="mt-4 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-all shadow-md cursor-pointer"
                >
                  Add First Authorized Key
                </button>
              </div>
            ) : (
              authorizedKeys.map(k => (
                <div
                  key={k.id}
                  className="p-4 rounded-2xl bg-[#181825] border border-white/[0.08] hover:border-white/[0.15] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center space-x-2.5">
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-mono uppercase font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        {k.keyType}
                      </span>
                      <h4 className="text-sm font-semibold text-white truncate">{k.comment}</h4>
                    </div>

                    <div className="text-xs font-mono text-cyan-300 truncate">
                      {k.fingerprint}
                    </div>

                    <div className="text-[11px] font-mono text-gray-500 truncate max-w-xl">
                      {k.publicKeyBase64.slice(0, 48)}...
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(k.raw);
                        setCopiedId(k.id);
                        setTimeout(() => setCopiedId(null), 2000);
                      }}
                      className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs transition-colors cursor-pointer"
                      title="Copy full authorized_keys line"
                    >
                      {copiedId === k.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedId === k.id ? 'Copied' : 'Copy'}</span>
                    </button>

                    <button
                      onClick={() => setKeyToRevoke(k)}
                      className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs transition-colors cursor-pointer"
                      title="Revoke and remove key from server"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Revoke</span>
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tab 2: sshd_config Security Audit */}
        {activeTab === 'sshd_audit' && sshdAudit && (
          <div className="space-y-6">
            {/* Score Card */}
            <div className="p-6 rounded-3xl bg-[#181825] border border-white/10 flex flex-col md:flex-row items-center justify-between gap-6">
              <div className="space-y-1">
                <span className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Security Health Score</span>
                <h3 className="text-2xl font-bold text-white flex items-center space-x-3">
                  <span>{sshdAudit.score} / 100</span>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                    sshdAudit.score >= 80 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                  }`}>
                    {sshdAudit.score >= 80 ? 'Strong Security' : 'Hardening Recommended'}
                  </span>
                </h3>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="p-3 rounded-2xl bg-white/5 border border-white/5">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">Root Login</div>
                  <div className={`text-xs font-mono font-bold mt-1 ${
                    sshdAudit.permitRootLogin === 'no' || sshdAudit.permitRootLogin === 'prohibit-password'
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}>
                    {sshdAudit.permitRootLogin}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-white/5 border border-white/5">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">Password Auth</div>
                  <div className={`text-xs font-mono font-bold mt-1 ${
                    sshdAudit.passwordAuthentication === 'no' ? 'text-emerald-400' : 'text-amber-400'
                  }`}>
                    {sshdAudit.passwordAuthentication}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-white/5 border border-white/5">
                  <div className="text-[10px] text-gray-400 uppercase font-semibold">Port</div>
                  <div className={`text-xs font-mono font-bold mt-1 ${
                    sshdAudit.port !== 22 ? 'text-emerald-400' : 'text-gray-300'
                  }`}>
                    {sshdAudit.port}
                  </div>
                </div>
              </div>
            </div>

            {/* Recommendations & Issues */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 rounded-3xl bg-[#181825] border border-white/10 space-y-3">
                <h4 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span>Detected Security Weaknesses</span>
                </h4>
                {sshdAudit.issues.length === 0 ? (
                  <p className="text-xs text-emerald-400">No major security weaknesses detected.</p>
                ) : (
                  <ul className="space-y-2 text-xs text-gray-300">
                    {sshdAudit.issues.map((issue, idx) => (
                      <li key={idx} className="flex items-start space-x-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                        <span>{issue}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="p-5 rounded-3xl bg-[#181825] border border-white/10 space-y-3">
                <h4 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Hardening Recommendations</span>
                </h4>
                {sshdAudit.recommendations.length === 0 ? (
                  <p className="text-xs text-gray-400">Server configuration follows OpenSSH security guidelines.</p>
                ) : (
                  <ul className="space-y-2 text-xs text-gray-300">
                    {sshdAudit.recommendations.map((rec, idx) => (
                      <li key={idx} className="flex items-start space-x-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Known Hosts */}
        {activeTab === 'known_hosts' && (
          <div className="space-y-3">
            {knownHosts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center text-gray-400">
                <Server className="w-12 h-12 text-gray-600 mb-3" />
                <p className="text-sm font-medium text-gray-300">No known hosts records found</p>
              </div>
            ) : (
              knownHosts.map(h => (
                <div
                  key={h.id}
                  className="p-4 rounded-2xl bg-[#181825] border border-white/[0.08] hover:border-white/[0.15] transition-all flex items-center justify-between gap-4 text-xs font-mono shadow-sm"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="font-semibold text-white truncate font-sans text-sm">{h.host}</div>
                    <div className="text-gray-400 truncate text-[11px]">{h.fingerprint}</div>
                  </div>

                  <button
                    onClick={() => handleDeleteKnownHost(h)}
                    className="p-1.5 rounded-xl hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors cursor-pointer"
                    title="Delete from known_hosts"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Revoke Key Confirmation Modal */}
      {keyToRevoke && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setKeyToRevoke(null)}
        >
          <div 
            className="bg-[#181825] border border-rose-500/30 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center space-x-3 border-b border-white/10 pb-3">
              <div className="p-2 rounded-xl bg-rose-500/20 text-rose-400">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Revoke SSH Key</h3>
                <p className="text-xs text-gray-400">Remove key access from authorized_keys</p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              Are you sure you want to permanently revoke this key from <code className="text-white">~/.ssh/authorized_keys</code>? Any user using this key will be denied login.
            </p>

            <div className="p-3 rounded-2xl bg-black/30 border border-white/10 space-y-1.5 font-mono text-xs">
              <div>
                <span className="text-gray-500">Key:</span>{' '}
                <span className="text-white font-semibold">{keyToRevoke.comment}</span>
              </div>
              <div>
                <span className="text-gray-500">Type:</span>{' '}
                <span className="text-emerald-300">{keyToRevoke.keyType}</span>
              </div>
              <div className="truncate">
                <span className="text-gray-500">Fingerprint:</span>{' '}
                <span className="text-cyan-300">{keyToRevoke.fingerprint}</span>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setKeyToRevoke(null)}
                disabled={isRevoking}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmRevokeKey(keyToRevoke)}
                disabled={isRevoking}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center space-x-1.5"
              >
                {isRevoking ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>{isRevoking ? 'Revoking...' : 'Confirm Revoke'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Key Modal */}
      {showAddKeyModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setShowAddKeyModal(false)}
        >
          <div 
            className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                <Plus className="w-5 h-5 text-emerald-400" />
                <span>Add Key to authorized_keys</span>
              </h3>
              <button onClick={() => setShowAddKeyModal(false)} className="text-gray-400 hover:text-white cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleAddAuthorizedKey} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Public Key Text</label>
                <textarea
                  rows={4}
                  required
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... user@laptop"
                  value={newKeyText}
                  onChange={e => setNewKeyText(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowAddKeyModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-md transition-all cursor-pointer"
                >
                  Append Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
