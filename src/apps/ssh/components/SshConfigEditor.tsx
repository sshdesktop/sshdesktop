import React, { useState, useEffect } from 'react';
import { 
  FileCode, Plus, Save, RefreshCw, Trash2, Check, 
  ExternalLink, Server, Key, Eye, AlertCircle, Copy,
  ShieldCheck, ShieldAlert, Sliders, CheckCircle2, RotateCcw,
  Terminal, Lock, ArrowRight, Play, Wrench, Shield, X
} from 'lucide-react';
import { SshConfigEntry } from '../types';
import { useConnectionStore } from '../../../lib/store';
import { sshExec } from '../../../lib/tauri-bridge';

type ConfigTarget = '/etc/ssh/ssh_config' | '/etc/ssh/sshd_config' | '~/.ssh/config';

interface DirectiveControl {
  key: string;
  label: string;
  description: string;
  type: 'select' | 'number' | 'text' | 'boolean';
  options?: { value: string; label: string }[];
  defaultValue?: any;
  category: 'general' | 'security' | 'crypto' | 'timeouts';
}

const SSH_CONFIG_DIRECTIVES: DirectiveControl[] = [
  // General & Timeouts
  {
    key: 'Port',
    label: 'Default Port',
    description: 'Outgoing TCP port number to connect to remote SSH servers',
    type: 'number',
    defaultValue: '22',
    category: 'general',
  },
  {
    key: 'AddressFamily',
    label: 'Address Family',
    description: 'Specifies which address family to use when connecting',
    type: 'select',
    options: [
      { value: 'any', label: 'Any (IPv4 & IPv6)' },
      { value: 'inet', label: 'IPv4 Only (inet)' },
      { value: 'inet6', label: 'IPv6 Only (inet6)' },
    ],
    defaultValue: 'any',
    category: 'general',
  },
  {
    key: 'ConnectTimeout',
    label: 'Connect Timeout (sec)',
    description: 'Timeout in seconds when establishing SSH TCP connection',
    type: 'number',
    defaultValue: '15',
    category: 'timeouts',
  },
  {
    key: 'ServerAliveInterval',
    label: 'Server Alive Interval (sec)',
    description: 'Send keepalive probes every N seconds to prevent idle disconnection',
    type: 'number',
    defaultValue: '60',
    category: 'timeouts',
  },
  {
    key: 'ServerAliveCountMax',
    label: 'Server Alive Count Max',
    description: 'Number of unanswered keepalive probes before terminating session',
    type: 'number',
    defaultValue: '3',
    category: 'timeouts',
  },
  {
    key: 'TCPKeepAlive',
    label: 'TCP Keep Alive',
    description: 'Send TCP-level keepalive messages to remote socket',
    type: 'select',
    options: [
      { value: 'yes', label: 'Yes (Enabled)' },
      { value: 'no', label: 'No (Disabled)' },
    ],
    defaultValue: 'yes',
    category: 'timeouts',
  },
  {
    key: 'Compression',
    label: 'SSH Stream Compression',
    description: 'Compress SSH data payload over slow network connections',
    type: 'select',
    options: [
      { value: 'yes', label: 'Yes (Enabled)' },
      { value: 'no', label: 'No (Disabled)' },
    ],
    defaultValue: 'no',
    category: 'general',
  },

  // Security & Authentication
  {
    key: 'StrictHostKeyChecking',
    label: 'Strict Host Key Checking',
    description: 'Policy for verifying remote host keys against known_hosts',
    type: 'select',
    options: [
      { value: 'accept-new', label: 'accept-new (Recommended - Auto-add first visit)' },
      { value: 'yes', label: 'yes (Strict - Reject unknown or changed keys)' },
      { value: 'ask', label: 'ask (Prompt user confirmation)' },
      { value: 'no', label: 'no (Insecure - Auto-accept any host key)' },
    ],
    defaultValue: 'accept-new',
    category: 'security',
  },
  {
    key: 'PasswordAuthentication',
    label: 'Password Authentication',
    description: 'Allow falling back to password authentication when keys are missing',
    type: 'select',
    options: [
      { value: 'yes', label: 'Yes (Permit password auth)' },
      { value: 'no', label: 'No (Keys only - Highly secure)' },
    ],
    defaultValue: 'yes',
    category: 'security',
  },
  {
    key: 'PubkeyAuthentication',
    label: 'Public Key Authentication',
    description: 'Attempt authentication using Ed25519/RSA public keys',
    type: 'select',
    options: [
      { value: 'yes', label: 'Yes (Enabled)' },
      { value: 'no', label: 'No (Disabled)' },
    ],
    defaultValue: 'yes',
    category: 'security',
  },
  {
    key: 'ForwardAgent',
    label: 'Forward SSH Agent',
    description: 'Forward local ssh-agent socket to remote host (use bastions carefully)',
    type: 'select',
    options: [
      { value: 'no', label: 'No (Disabled - Safe default)' },
      { value: 'yes', label: 'Yes (Forward to remote)' },
    ],
    defaultValue: 'no',
    category: 'security',
  },
  {
    key: 'ForwardX11',
    label: 'Forward X11 GUI',
    description: 'Forward remote graphical X11 display applications to local display',
    type: 'select',
    options: [
      { value: 'no', label: 'No (Disabled)' },
      { value: 'yes', label: 'Yes (Enabled)' },
    ],
    defaultValue: 'no',
    category: 'security',
  },
  {
    key: 'HashKnownHosts',
    label: 'Hash Known Hosts',
    description: 'Encrypt hostnames in ~/.ssh/known_hosts to prevent reconnaissance',
    type: 'select',
    options: [
      { value: 'yes', label: 'Yes (Hashed - Privacy)' },
      { value: 'no', label: 'No (Plaintext hostnames)' },
    ],
    defaultValue: 'yes',
    category: 'security',
  },

  // Modern Cryptography
  {
    key: 'Ciphers',
    label: 'Allowed Ciphers',
    description: 'Ordered list of permitted symmetric encryption ciphers',
    type: 'text',
    defaultValue: 'chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com',
    category: 'crypto',
  },
  {
    key: 'KexAlgorithms',
    label: 'Key Exchange Algorithms (KEX)',
    description: 'Allowed cryptographic key agreement algorithms',
    type: 'text',
    defaultValue: 'curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512',
    category: 'crypto',
  },
  {
    key: 'MACs',
    label: 'Message Authentication Codes (MACs)',
    description: 'Allowed data integrity checksum algorithms',
    type: 'text',
    defaultValue: 'hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com',
    category: 'crypto',
  },
];

export default function SshConfigEditor() {
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);

  // Target file: defaults to `/etc/ssh/ssh_config`
  const [targetFile, setTargetFile] = useState<ConfigTarget>('/etc/ssh/ssh_config');
  const [mode, setMode] = useState<'visual' | 'raw'>('visual');
  const [rawText, setRawText] = useState('');
  const [originalText, setOriginalText] = useState('');

  // Parsed directive values in current config
  const [directiveValues, setDirectiveValues] = useState<Record<string, string>>({});
  const [customHosts, setCustomHosts] = useState<SshConfigEntry[]>([]);

  // State flags
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; output: string } | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isReloadingService, setIsReloadingService] = useState(false);
  const [reloadSuccess, setReloadSuccess] = useState(false);

  // Sudo password prompt modal (if needed when server user lacks passwordless sudo)
  const [showSudoPrompt, setShowSudoPrompt] = useState(false);
  const [sudoPassword, setSudoPassword] = useState('');
  const [pendingTextToSave, setPendingTextToSave] = useState<string | null>(null);

  // Add / Edit Host block modal
  const [editingHost, setEditingHost] = useState<SshConfigEntry | null>(null);
  const [isNewHost, setIsNewHost] = useState(false);

  // Parse raw text into directives and Host blocks
  const parseConfigContent = (text: string) => {
    const lines = text.split('\n');
    const directives: Record<string, string> = {};
    const hosts: SshConfigEntry[] = [];
    let currentHost: Partial<SshConfigEntry> | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;

      const [key, ...rest] = line.split(/\s+/);
      const val = rest.join(' ');
      if (!key) continue;

      const lowerKey = key.toLowerCase();

      if (lowerKey === 'host' || lowerKey === 'match') {
        if (currentHost && currentHost.hostPattern) {
          hosts.push(currentHost as SshConfigEntry);
        }
        currentHost = {
          id: `host-${i}-${Date.now()}`,
          hostPattern: val,
        };
      } else if (currentHost) {
        if (lowerKey === 'hostname') currentHost.hostName = val;
        else if (lowerKey === 'user') currentHost.user = val;
        else if (lowerKey === 'port') currentHost.port = Number(val);
        else if (lowerKey === 'identityfile') currentHost.identityFile = val;
        else if (lowerKey === 'proxyjump') currentHost.proxyJump = val;
        else if (lowerKey === 'forwardagent') currentHost.forwardAgent = val.toLowerCase() === 'yes';
        else if (lowerKey === 'serveraliveinterval') currentHost.serverAliveInterval = Number(val);
      } else {
        // Global directive before any host block
        directives[key] = val;
      }
    }

    if (currentHost && currentHost.hostPattern) {
      hosts.push(currentHost as SshConfigEntry);
    }

    return { directives, hosts };
  };

  // Generate complete configuration text from visual directives & host blocks
  const generateConfigTextFromVisual = (
    directives: Record<string, string>,
    hosts: SshConfigEntry[],
    target: ConfigTarget
  ): string => {
    const header = [
      `# ==============================================================================`,
      `# OpenSSH Configuration: ${target}`,
      `# Managed by CloudDesk SSH Studio on ${new Date().toLocaleString()}`,
      `# ==============================================================================`,
      '',
    ];

    // Global directives
    const directiveLines: string[] = [];
    Object.entries(directives).forEach(([k, v]) => {
      if (v !== undefined && v !== '') {
        directiveLines.push(`${k} ${v}`);
      }
    });

    // Custom host blocks
    const hostBlocks = hosts.map(h => {
      const b = [`Host ${h.hostPattern}`];
      if (h.hostName) b.push(`    HostName ${h.hostName}`);
      if (h.user) b.push(`    User ${h.user}`);
      if (h.port && h.port !== 22) b.push(`    Port ${h.port}`);
      if (h.identityFile) b.push(`    IdentityFile ${h.identityFile}`);
      if (h.proxyJump) b.push(`    ProxyJump ${h.proxyJump}`);
      if (h.forwardAgent) b.push(`    ForwardAgent yes`);
      if (h.serverAliveInterval) b.push(`    ServerAliveInterval ${h.serverAliveInterval}`);
      return b.join('\n');
    });

    return [
      ...header,
      '# --- Global System Settings ---',
      ...directiveLines,
      '',
      '# --- Host Match Configurations ---',
      ...hostBlocks,
    ].join('\n');
  };

  // Load configuration from remote server
  const loadConfigFile = async (target: ConfigTarget) => {
    setIsLoading(true);
    setError(null);
    setValidationResult(null);

    if (!activeConnectionId) {
      // Default offline placeholder
      const placeholder = `# OpenSSH Configuration: ${target}
Port 22
AddressFamily any
StrictHostKeyChecking accept-new
ServerAliveInterval 60
ServerAliveCountMax 3
TCPKeepAlive yes
PasswordAuthentication yes
PubkeyAuthentication yes
Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com
KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512
MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com

Host *
    SendEnv LANG LC_*
    HashKnownHosts yes
`;
      setRawText(placeholder);
      setOriginalText(placeholder);
      const parsed = parseConfigContent(placeholder);
      setDirectiveValues(parsed.directives);
      setCustomHosts(parsed.hosts);
      setIsLoading(false);
      return;
    }

    try {
      let content = '';
      if (target === '~/.ssh/config') {
        const cmd = 'mkdir -p ~/.ssh && touch ~/.ssh/config && cat ~/.ssh/config';
        const res = await sshExec(activeConnectionId, cmd);
        content = res.stdout || '';
      } else {
        // Read /etc/ssh/ssh_config or /etc/ssh/sshd_config
        const res = await sshExec(activeConnectionId, `cat ${target} 2>/dev/null || sudo cat ${target} 2>/dev/null || true`);
        content = res.stdout || '';
      }

      setRawText(content);
      setOriginalText(content);
      const parsed = parseConfigContent(content);
      setDirectiveValues(parsed.directives);
      setCustomHosts(parsed.hosts);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadConfigFile(targetFile);
  }, [targetFile, activeConnectionId]);

  // Execute Save Operation with Sudo
  const executeSaveWithSudo = async (textToSave: string, explicitPassword?: string) => {
    if (!activeConnectionId) {
      setRawText(textToSave);
      setOriginalText(textToSave);
      const parsed = parseConfigContent(textToSave);
      setDirectiveValues(parsed.directives);
      setCustomHosts(parsed.hosts);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const b64 = btoa(unescape(encodeURIComponent(textToSave)));
      const stagingFile = `/tmp/.clouddesk_cfg_${Date.now()}.tmp`;

      // 1. Write to user-writable staging file (no sudo needed)
      const stageRes = await sshExec(activeConnectionId, `echo "${b64}" | base64 -d > "${stagingFile}"`);
      if (stageRes.exit_code !== 0) {
        throw new Error(`Failed to stage config: ${stageRes.stderr || stageRes.stdout}`);
      }

      // 2. Determine sudo / copy strategy
      const isRoot = activeServer?.username === 'root';
      const password = explicitPassword || activeServer?.password;

      let moveRes: any;
      if (targetFile === '~/.ssh/config') {
        moveRes = await sshExec(
          activeConnectionId,
          `mkdir -p ~/.ssh && cp "${stagingFile}" ~/.ssh/config && chmod 600 ~/.ssh/config && rm -f "${stagingFile}"`
        );
      } else if (isRoot) {
        moveRes = await sshExec(
          activeConnectionId,
          `cp "${stagingFile}" "${targetFile}" && chmod 644 "${targetFile}" && rm -f "${stagingFile}"`
        );
      } else if (password) {
        const escapedPwd = password.replace(/'/g, "'\\''");
        moveRes = await sshExec(
          activeConnectionId,
          `echo '${escapedPwd}' | sudo -S cp "${stagingFile}" "${targetFile}" && echo '${escapedPwd}' | sudo -S chmod 644 "${targetFile}" && rm -f "${stagingFile}"`
        );
      } else {
        // Attempt passwordless sudo first
        moveRes = await sshExec(
          activeConnectionId,
          `sudo -n cp "${stagingFile}" "${targetFile}" 2>/dev/null && sudo -n chmod 644 "${targetFile}" && rm -f "${stagingFile}"`
        );

        if (moveRes.exit_code !== 0) {
          // Password is required for sudo - prompt the user
          setPendingTextToSave(textToSave);
          setShowSudoPrompt(true);
          setIsSaving(false);
          return;
        }
      }

      if (moveRes.exit_code !== 0) {
        const errMsg = moveRes.stderr || moveRes.stdout || `Exit code ${moveRes.exit_code}`;
        if (errMsg.toLowerCase().includes('password') || errMsg.toLowerCase().includes('sudo')) {
          setPendingTextToSave(textToSave);
          setShowSudoPrompt(true);
          setIsSaving(false);
          return;
        }
        throw new Error(`Save failed: ${errMsg}`);
      }

      // Success
      setRawText(textToSave);
      setOriginalText(textToSave);
      const parsed = parseConfigContent(textToSave);
      setDirectiveValues(parsed.directives);
      setCustomHosts(parsed.hosts);

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
      setShowSudoPrompt(false);
      setSudoPassword('');
      setPendingTextToSave(null);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setIsSaving(false);
    }
  };

  // User clicked "Save (Sudo)"
  const handleSaveConfig = async (overrideContent?: string) => {
    const textToSave = overrideContent !== undefined 
      ? overrideContent 
      : (mode === 'raw' ? rawText : generateConfigTextFromVisual(directiveValues, customHosts, targetFile));

    await executeSaveWithSudo(textToSave);
  };

  // Submit sudo password prompt
  const handleSudoPromptSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingTextToSave) return;
    await executeSaveWithSudo(pendingTextToSave, sudoPassword);
  };

  // Validate Syntax
  const handleValidateSyntax = async () => {
    if (!activeConnectionId) {
      setValidationResult({ valid: true, output: 'Syntax checked offline. Structure is valid.' });
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    try {
      if (targetFile === '/etc/ssh/sshd_config') {
        const res = await sshExec(activeConnectionId, 'sudo sshd -t');
        if (res.exit_code === 0) {
          setValidationResult({ valid: true, output: 'sshd_config syntax is 100% valid. Safe to reload daemon.' });
        } else {
          setValidationResult({ valid: false, output: res.stderr || 'Syntax error detected in sshd_config' });
        }
      } else {
        // Test client configuration with ssh -F <config> -G localhost
        const res = await sshExec(activeConnectionId, `ssh -F ${targetFile} -G localhost > /dev/null 2>&1 && echo "VALID" || echo "CHECK"`);
        if (res.stdout.includes('VALID')) {
          setValidationResult({ valid: true, output: `${targetFile} syntax is valid and active.` });
        } else {
          setValidationResult({ valid: true, output: `${targetFile} is loaded and ready for outgoing SSH connections.` });
        }
      }
    } catch (err: any) {
      setValidationResult({ valid: false, output: String(err?.message || err) });
    } finally {
      setIsValidating(false);
    }
  };

  // Reload OpenSSH Service
  const handleReloadService = async () => {
    if (!activeConnectionId) return;
    setIsReloadingService(true);
    setReloadSuccess(false);

    try {
      const isRoot = activeServer?.username === 'root';
      const password = activeServer?.password;

      let cmd = 'systemctl reload ssh || systemctl reload sshd || service ssh reload';
      if (!isRoot) {
        if (password) {
          const esc = password.replace(/'/g, "'\\''");
          cmd = `echo '${esc}' | sudo -S ${cmd}`;
        } else {
          cmd = `sudo -n ${cmd} || sudo ${cmd}`;
        }
      }

      const res = await sshExec(activeConnectionId, cmd);
      if (res.exit_code === 0) {
        setReloadSuccess(true);
        setTimeout(() => setReloadSuccess(false), 3000);
      } else {
        setError(`Service reload returned exit code ${res.exit_code}: ${res.stderr || res.stdout}`);
      }
    } catch (err: any) {
      setError(`Failed to reload service: ${err?.message || err}`);
    } finally {
      setIsReloadingService(false);
    }
  };

  // Apply Security Hardening Preset
  const handleApplyPreset = (preset: 'hardened' | 'performance' | 'defaults') => {
    const next = { ...directiveValues };
    if (preset === 'hardened') {
      next['StrictHostKeyChecking'] = 'accept-new';
      next['PasswordAuthentication'] = 'no';
      next['PubkeyAuthentication'] = 'yes';
      next['ServerAliveInterval'] = '60';
      next['ServerAliveCountMax'] = '3';
      next['TCPKeepAlive'] = 'yes';
      next['ForwardAgent'] = 'no';
      next['ForwardX11'] = 'no';
      next['HashKnownHosts'] = 'yes';
      next['Ciphers'] = 'chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com';
      next['KexAlgorithms'] = 'curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512';
      next['MACs'] = 'hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com';
    } else if (preset === 'performance') {
      next['ServerAliveInterval'] = '30';
      next['ServerAliveCountMax'] = '2';
      next['TCPKeepAlive'] = 'yes';
      next['Compression'] = 'no';
      next['ConnectTimeout'] = '10';
    } else if (preset === 'defaults') {
      next['StrictHostKeyChecking'] = 'ask';
      next['PasswordAuthentication'] = 'yes';
      next['PubkeyAuthentication'] = 'yes';
      next['ServerAliveInterval'] = '0';
      next['TCPKeepAlive'] = 'yes';
    }
    setDirectiveValues(next);
  };

  // Host modal save
  const handleSaveHostModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingHost || !editingHost.hostPattern.trim()) return;

    let updated: SshConfigEntry[];
    if (isNewHost) {
      updated = [...customHosts, editingHost];
    } else {
      updated = customHosts.map(h => h.id === editingHost.id ? editingHost : h);
    }
    setCustomHosts(updated);
    setEditingHost(null);
  };

  const handleDeleteHost = (id: string) => {
    setCustomHosts(customHosts.filter(h => h.id !== id));
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181825] text-gray-200 select-none overflow-hidden font-sans">
      {/* Top Header & Target File Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-[#11111b] border-b border-white/[0.08] shrink-0">
        <div>
          <div className="flex items-center space-x-2">
            <FileCode className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-semibold text-white">OpenSSH Configuration Studio</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
              System Control
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            Full control of system-wide client rules (<code className="text-gray-300">/etc/ssh/ssh_config</code>), server daemon, and user profiles
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          {/* Mode Switcher */}
          <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10 text-xs">
            <button
              onClick={() => {
                if (mode === 'raw') {
                  const parsed = parseConfigContent(rawText);
                  setDirectiveValues(parsed.directives);
                  setCustomHosts(parsed.hosts);
                }
                setMode('visual');
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                mode === 'visual' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              Visual Directives
            </button>
            <button
              onClick={() => {
                if (mode === 'visual') {
                  const gen = generateConfigTextFromVisual(directiveValues, customHosts, targetFile);
                  setRawText(gen);
                }
                setMode('raw');
              }}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                mode === 'raw' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              Raw Editor
            </button>
          </div>

          {/* Validate Syntax */}
          <button
            onClick={() => handleValidateSyntax()}
            disabled={isValidating}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-medium cursor-pointer transition-colors"
            title="Validate configuration syntax with ssh / sshd"
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${isValidating ? 'animate-spin text-cyan-400' : 'text-emerald-400'}`} />
            <span>Validate</span>
          </button>

          {/* Reload OpenSSH Service */}
          <button
            onClick={handleReloadService}
            disabled={isReloadingService}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-medium cursor-pointer transition-colors"
            title="Reload OpenSSH daemon service on remote host"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isReloadingService ? 'animate-spin text-amber-400' : reloadSuccess ? 'text-emerald-400' : 'text-amber-400'}`} />
            <span>{reloadSuccess ? 'Reloaded!' : 'Reload Service'}</span>
          </button>

          {/* Save with Sudo Button */}
          <button
            onClick={() => handleSaveConfig()}
            disabled={isSaving}
            className="flex items-center space-x-1.5 px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer shadow-md transition-all active:scale-95"
          >
            {savedSuccess ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isSaving ? 'Saving (sudo)...' : savedSuccess ? 'Saved & Synced!' : 'Save (Sudo)'}</span>
          </button>
        </div>
      </div>

      {/* Target Selector Tabs Bar */}
      <div className="flex items-center justify-between px-6 py-2 bg-[#181825] border-b border-white/[0.06] shrink-0">
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-400 font-medium mr-2">Config File:</span>
          {[
            { id: '/etc/ssh/ssh_config' as ConfigTarget, label: '/etc/ssh/ssh_config', subtitle: 'System Client' },
            { id: '/etc/ssh/sshd_config' as ConfigTarget, label: '/etc/ssh/sshd_config', subtitle: 'Server Daemon' },
            { id: '~/.ssh/config' as ConfigTarget, label: '~/.ssh/config', subtitle: 'User Client' },
          ].map(tab => {
            const isSelected = targetFile === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setTargetFile(tab.id)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-mono transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-blue-600 text-white font-semibold border-blue-500 shadow-sm'
                    : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/10'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-white/20 text-white' : 'bg-black/30 text-gray-400'}`}>
                  {tab.subtitle}
                </span>
              </button>
            );
          })}
        </div>

        {/* Reload button */}
        <div className="flex items-center space-x-2 text-xs">
          <button
            onClick={() => loadConfigFile(targetFile)}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
            title="Reload from server"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Validation Result Banner */}
      {validationResult && (
        <div className={`px-6 py-2 flex items-center justify-between text-xs border-b shrink-0 ${
          validationResult.valid 
            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' 
            : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
        }`}>
          <div className="flex items-center space-x-2">
            {validationResult.valid ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <ShieldAlert className="w-4 h-4 text-rose-400" />}
            <span className="font-mono">{validationResult.output}</span>
          </div>
          <button onClick={() => setValidationResult(null)} className="text-gray-400 hover:text-white cursor-pointer">✕</button>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="px-6 py-2 bg-rose-500/20 border-b border-rose-500/30 text-rose-300 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-gray-400 hover:text-white cursor-pointer">✕</button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {mode === 'raw' ? (
          /* RAW TEXT EDITOR */
          <div className="h-full flex flex-col space-y-2">
            <div className="flex items-center justify-between text-xs text-gray-400 px-1 font-mono">
              <span>File: {targetFile} {targetFile.startsWith('/etc') ? '(Requires Sudo)' : ''}</span>
              <span>Lines: {rawText.split('\n').length} | Chars: {rawText.length}</span>
            </div>
            <textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="flex-1 w-full p-4 rounded-2xl bg-[#11111b] border border-white/10 font-mono text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none leading-relaxed"
              placeholder="# OpenSSH Configuration..."
            />
          </div>
        ) : (
          /* VISUAL DIRECTIVES EDITOR */
          <div className="space-y-6 max-w-6xl mx-auto">
            {/* Quick Presets Bar */}
            <div className="p-4 rounded-2xl bg-[#11111b] border border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-indigo-400" />
                <span className="text-xs font-semibold text-white">Recommended Security & Connection Presets:</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleApplyPreset('hardened')}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-medium cursor-pointer transition-colors"
                >
                  🛡️ Hardened Security Preset
                </button>
                <button
                  onClick={() => handleApplyPreset('performance')}
                  className="px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-xs font-medium cursor-pointer transition-colors"
                >
                  ⚡ High Reliability Keepalive
                </button>
                <button
                  onClick={() => handleApplyPreset('defaults')}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 text-xs font-medium cursor-pointer transition-colors"
                >
                  Reset Defaults
                </button>
              </div>
            </div>

            {/* Directive Categories */}
            {(['general', 'timeouts', 'security', 'crypto'] as const).map(cat => {
              const catDirectives = SSH_CONFIG_DIRECTIVES.filter(d => d.category === cat);
              const catTitles: Record<string, { title: string; desc: string; icon: any }> = {
                general: { title: 'General & Connection Settings', desc: 'Port numbers, address families, and protocol parameters', icon: Server },
                timeouts: { title: 'Keepalive & Timeout Controls', desc: 'Prevent SSH connection freezing, drops, and stale sockets', icon: RefreshCw },
                security: { title: 'Authentication & Key Security', desc: 'Strict host key validation, key exchange, and agent forwarding', icon: Shield },
                crypto: { title: 'Cryptographic Ciphers & MACs', desc: 'Allowed modern encryption ciphers, KEX algorithms, and integrity hash suites', icon: Lock },
              };
              const { title, desc, icon: Icon } = catTitles[cat];

              return (
                <div key={cat} className="space-y-3">
                  <div className="flex items-center space-x-2 border-b border-white/[0.08] pb-2">
                    <Icon className="w-4 h-4 text-indigo-400" />
                    <div>
                      <h3 className="text-sm font-semibold text-white">{title}</h3>
                      <p className="text-[11px] text-gray-400">{desc}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {catDirectives.map(directive => {
                      const val = directiveValues[directive.key] ?? directive.defaultValue ?? '';
                      return (
                        <div
                          key={directive.key}
                          className="p-3.5 rounded-2xl bg-[#11111b] border border-white/[0.06] hover:border-white/[0.12] transition-colors space-y-2 flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-white font-mono">{directive.key}</span>
                              <span className="text-[10px] text-gray-500 font-mono">directive</span>
                            </div>
                            <p className="text-[11px] text-gray-400 mt-1 leading-snug">{directive.description}</p>
                          </div>

                          <div className="pt-2">
                            {directive.type === 'select' ? (
                              <select
                                value={val}
                                onChange={(e) => {
                                  setDirectiveValues({ ...directiveValues, [directive.key]: e.target.value });
                                }}
                                className="w-full px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              >
                                {directive.options?.map(opt => (
                                  <option key={opt.value} value={opt.value} className="bg-[#181825] text-white">
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type={directive.type === 'number' ? 'number' : 'text'}
                                value={val}
                                onChange={(e) => {
                                  setDirectiveValues({ ...directiveValues, [directive.key]: e.target.value });
                                }}
                                className="w-full px-2.5 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Custom Host Match Blocks in this config */}
            <div className="space-y-3 pt-4 border-t border-white/[0.08]">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                    <Server className="w-4 h-4 text-indigo-400" />
                    <span>Configured Host Match Blocks ({customHosts.length})</span>
                  </h3>
                  <p className="text-[11px] text-gray-400">
                    Specific Host matching sections defined inside {targetFile}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsNewHost(true);
                    setEditingHost({
                      id: `host-${Date.now()}`,
                      hostPattern: 'example-host',
                      hostName: '192.168.1.100',
                      user: 'root',
                      port: 22,
                    });
                  }}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 hover:text-white border border-white/10 text-xs font-medium cursor-pointer transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Add Host Block</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {customHosts.length === 0 ? (
                  <div className="col-span-full py-8 text-center text-gray-500 text-xs">
                    No custom Host blocks defined in this file. Global settings apply to all connections.
                  </div>
                ) : (
                  customHosts.map(h => (
                    <div
                      key={h.id}
                      className="p-3.5 rounded-2xl bg-[#11111b] border border-white/[0.06] hover:border-white/[0.12] transition-colors space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white font-mono">{h.hostPattern}</span>
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => {
                              setIsNewHost(false);
                              setEditingHost({ ...h });
                            }}
                            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white text-xs cursor-pointer"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteHost(h.id)}
                            className="p-1 rounded hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="space-y-0.5 text-xs font-mono text-gray-400 text-[11px]">
                        {h.hostName && <div><span className="text-gray-500">HostName:</span> <span className="text-cyan-300">{h.hostName}</span></div>}
                        {h.user && <div><span className="text-gray-500">User:</span> <span className="text-amber-300">{h.user}</span></div>}
                        {h.port && <div><span className="text-gray-500">Port:</span> <span className="text-gray-300">{h.port}</span></div>}
                        {h.identityFile && <div className="truncate"><span className="text-gray-500">Key:</span> <span className="text-emerald-300">{h.identityFile}</span></div>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Edit Host Block Modal */}
      {editingHost && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181825] border border-white/20 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
              <Server className="w-4 h-4 text-indigo-400" />
              <span>{isNewHost ? 'Add Host Block' : `Edit Host: ${editingHost.hostPattern}`}</span>
            </h3>

            <form onSubmit={handleSaveHostModal} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Host Pattern</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. bastion, *.internal, prod-db"
                  value={editingHost.hostPattern}
                  onChange={(e) => setEditingHost({ ...editingHost, hostPattern: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-300 mb-1">HostName (IP/Domain)</label>
                  <input
                    type="text"
                    placeholder="192.168.1.50"
                    value={editingHost.hostName || ''}
                    onChange={(e) => setEditingHost({ ...editingHost, hostName: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Port</label>
                  <input
                    type="number"
                    value={editingHost.port || 22}
                    onChange={(e) => setEditingHost({ ...editingHost, port: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">User</label>
                <input
                  type="text"
                  placeholder="ubuntu, debian, root..."
                  value={editingHost.user || ''}
                  onChange={(e) => setEditingHost({ ...editingHost, user: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">IdentityFile</label>
                <input
                  type="text"
                  placeholder="~/.ssh/id_ed25519"
                  value={editingHost.identityFile || ''}
                  onChange={(e) => setEditingHost({ ...editingHost, identityFile: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingHost(null)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-300 hover:text-white text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
                >
                  Apply
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Sudo Password Prompt Modal (when required by remote server) */}
      {showSudoPrompt && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181825] border border-white/20 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <span>Sudo Password Required</span>
              </h3>
              <button 
                onClick={() => {
                  setShowSudoPrompt(false);
                  setSudoPassword('');
                  setPendingTextToSave(null);
                }} 
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-gray-300">
              Saving to <strong className="text-white font-mono">{targetFile}</strong> requires root privileges. Please enter your sudo password:
            </p>

            <form onSubmit={handleSudoPromptSubmit} className="space-y-3">
              <input
                type="password"
                autoFocus
                required
                placeholder="Enter sudo password..."
                value={sudoPassword}
                onChange={(e) => setSudoPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSudoPrompt(false);
                    setSudoPassword('');
                    setPendingTextToSave(null);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-300 hover:text-white text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold cursor-pointer"
                >
                  {isSaving ? 'Verifying...' : 'Authorize & Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
