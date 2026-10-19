import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Variable, Plus, Trash2, Edit3, Search, RefreshCw, Save, ArrowUp, ArrowDown,
  CheckCircle2, AlertTriangle, XCircle, Shield, Folder, Copy, Check, Terminal,
  Sliders, Info, FileText, Undo2, ExternalLink, HelpCircle, HardDrive, Sparkles
} from 'lucide-react';
import { useConnectionStore } from '../../lib/store';
import { sshExec, sftpReadTextFile, sftpWriteTextFile, sftpMkdir, sendDesktopNotification } from '../../lib/tauri-bridge';

export type EnvScope = 'all' | 'user' | 'system' | 'session';

export interface EnvItem {
  key: string;
  value: string;
  scope: 'user' | 'system' | 'session';
  sourceFile: string;
  isMultiPath: boolean;
  paths?: string[];
  isCoreSystem?: boolean;
}

const KNOWN_MULTI_PATH_KEYS = new Set([
  'PATH',
  'LD_LIBRARY_PATH',
  'PYTHONPATH',
  'PKG_CONFIG_PATH',
  'MANPATH',
  'INFOPATH',
  'CDPATH',
  'CLASSPATH',
  'NODE_PATH',
  'CMAKE_PREFIX_PATH',
  'XDG_DATA_DIRS',
  'XDG_CONFIG_DIRS'
]);

const CORE_SYSTEM_VARS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'TERM'
]);

const COMMON_PRESETS = [
  { key: 'JAVA_HOME', label: 'Java JDK Path', value: '/usr/lib/jvm/java-17-openjdk-amd64', multi: false },
  { key: 'NODE_ENV', label: 'Node Environment', value: 'production', multi: false },
  { key: 'EDITOR', label: 'Default Shell Editor', value: 'nano', multi: false },
  { key: 'GOPATH', label: 'Go Workspace', value: '$HOME/go', multi: false },
  { key: 'CARGO_HOME', label: 'Rust Cargo Home', value: '$HOME/.cargo', multi: false },
  { key: 'PORT', label: 'Default App Port', value: '8080', multi: false },
  { key: 'LANG', label: 'System Locale', value: 'en_US.UTF-8', multi: false },
];

export default function EnvManager() {
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });
  const currentUsername = activeServer?.username || 'root';
  const userHome = currentUsername === 'root' ? '/root' : `/home/${currentUsername}`;

  // Main State
  const [variables, setVariables] = useState<EnvItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [scopeFilter, setScopeFilter] = useState<EnvScope>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'multipath' | 'single'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Path Validations cache { [path: string]: 'exists' | 'missing' | 'file' }
  const [pathStatusMap, setPathStatusMap] = useState<Record<string, 'exists' | 'missing' | 'file'>>({});
  const [isValidatingPaths, setIsValidatingPaths] = useState(false);

  // Edit / Add Modal State
  const [editingVar, setEditingVar] = useState<{
    originalKey?: string;
    key: string;
    value: string;
    scope: 'user' | 'system';
    isMultiPath: boolean;
    paths: string[];
  } | null>(null);

  // Quick Preset Add Drawer
  const [showPresets, setShowPresets] = useState(false);

  // Raw Config Inspector Modal
  const [rawModal, setRawModal] = useState<{ title: string; content: string; path: string } | null>(null);

  // Status Banners / Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 1. Fetch Environment Variables from Server
  const loadEnvironment = useCallback(async () => {
    if (!activeConnId) return;
    setIsLoading(true);
    try {
      // a. Read Live Session variables via printenv -0
      const liveRes = await sshExec(activeConnId, 'printenv -0');
      const liveMap = new Map<string, string>();
      if (liveRes && liveRes.stdout) {
        const parts = liveRes.stdout.split('\0').filter(Boolean);
        for (const p of parts) {
          const eq = p.indexOf('=');
          if (eq > 0) {
            const k = p.substring(0, eq);
            const v = p.substring(eq + 1);
            liveMap.set(k, v);
          }
        }
      }

      // b. Read User environment directly from ~/.bashrc (or ~/.profile fallback)
      const bashrcPath = `${userHome}/.bashrc`;
      let bashrcContent = await sftpReadTextFile(activeConnId, bashrcPath).catch(() => '');
      if (!bashrcContent) {
        bashrcContent = await sftpReadTextFile(activeConnId, `${userHome}/.profile`).catch(() => '');
      }

      const userCustomMap = new Map<string, string>();
      if (bashrcContent) {
        const lines = bashrcContent.split('\n');
        for (const l of lines) {
          const trimmed = l.trim();
          if (trimmed.startsWith('#') || !trimmed) continue;
          const match = trimmed.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
          if (match) {
            let val = match[2].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            userCustomMap.set(match[1], val);
          }
        }
      }

      // Clean up legacy ~/.clouddesk/env.sh if present and migrate any missing vars to ~/.bashrc
      const legacyEnvPath = `${userHome}/.clouddesk/env.sh`;
      const legacyEnvContent = await sftpReadTextFile(activeConnId, legacyEnvPath).catch(() => '');
      if (legacyEnvContent) {
        const legacyLines = legacyEnvContent.split('\n');
        let needsBashrcUpdate = false;
        for (const l of legacyLines) {
          const trimmed = l.trim();
          if (trimmed.startsWith('#') || !trimmed) continue;
          const match = trimmed.match(/^export\s+([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
          if (match && !userCustomMap.has(match[1])) {
            let val = match[2].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            userCustomMap.set(match[1], val);
            needsBashrcUpdate = true;
          }
        }

        // Delete legacy env.sh and any .bak files, and remove legacy source line from .bashrc
        await sshExec(activeConnId, `rm -f "${userHome}/.clouddesk/env.sh"* "${userHome}/.bashrc.clouddesk.bak"* "/etc/environment.clouddesk.bak"*`).catch(() => {});
        if (bashrcContent && (bashrcContent.includes('.clouddesk/env.sh') || needsBashrcUpdate)) {
          const cleanedLines = bashrcContent
            .split('\n')
            .filter(l => !l.includes('.clouddesk/env.sh') && !l.includes('# CloudDesk Environment Integration'));
          if (needsBashrcUpdate) {
            Array.from(userCustomMap.entries()).forEach(([k, v]) => {
              if (!cleanedLines.some(l => l.trim().startsWith(`export ${k}=`))) {
                cleanedLines.push(`export ${k}="${v}"`);
              }
            });
          }
          await sftpWriteTextFile(activeConnId, bashrcPath, cleanedLines.join('\n')).catch(() => {});
        }
      }

      // c. Read System /etc/environment
      const sysEnvContent = await sftpReadTextFile(activeConnId, '/etc/environment').catch(() => '');
      const sysMap = new Map<string, string>();
      if (sysEnvContent) {
        const lines = sysEnvContent.split('\n');
        for (const l of lines) {
          const trimmed = l.trim();
          if (trimmed.startsWith('#') || !trimmed) continue;
          const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
          if (match) {
            let val = match[2].trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            sysMap.set(match[1], val);
          }
        }
      }

      // d. Compile merged items list
      const allKeys = new Set<string>([
        ...Array.from(userCustomMap.keys()),
        ...Array.from(sysMap.keys()),
        ...Array.from(liveMap.keys())
      ]);

      const items: EnvItem[] = [];

      for (const k of Array.from(allKeys)) {
        const isUserConfigured = userCustomMap.has(k);
        const isSysConfigured = sysMap.has(k);

        const val = isUserConfigured 
          ? userCustomMap.get(k)! 
          : (isSysConfigured ? sysMap.get(k)! : (liveMap.get(k) || ''));

        const scope: 'user' | 'system' | 'session' = isUserConfigured
          ? 'user'
          : (isSysConfigured ? 'system' : 'session');

        const sourceFile = isUserConfigured
          ? '~/.bashrc'
          : (isSysConfigured ? '/etc/environment' : 'Live Shell (session)');

        const isMulti = KNOWN_MULTI_PATH_KEYS.has(k) || (val.includes(':') && (val.includes('/') || val.includes('~')));
        const paths = isMulti ? val.split(':').filter(Boolean) : undefined;

        items.push({
          key: k,
          value: val,
          scope,
          sourceFile,
          isMultiPath: isMulti,
          paths,
          isCoreSystem: CORE_SYSTEM_VARS.has(k)
        });
      }

      // Sort: PATH first, then Core System, then User, then alphabetical
      items.sort((a, b) => {
        if (a.key === 'PATH') return -1;
        if (b.key === 'PATH') return 1;
        if (a.scope === 'user' && b.scope !== 'user') return -1;
        if (a.scope !== 'user' && b.scope === 'user') return 1;
        return a.key.localeCompare(b.key);
      });

      setVariables(items);

      // Validate all directory paths extracted from multi-path variables
      const pathsToValidate = new Set<string>();
      items.forEach(it => {
        if (it.isMultiPath && it.paths) {
          it.paths.forEach(p => {
            if (p.startsWith('/') || p.startsWith('~')) pathsToValidate.add(p);
          });
        }
      });
      validateRemotePaths(Array.from(pathsToValidate));

    } catch (err: any) {
      console.error('Failed to load environment variables:', err);
      showToast(`Load error: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnId, userHome]);

  // 2. Validate Remote Directory Paths in one SSH batch
  const validateRemotePaths = async (paths: string[]) => {
    if (paths.length === 0 || !activeConnId) return;
    setIsValidatingPaths(true);
    try {
      // Expand ~ to userHome and test in batch
      const checks = paths.map(p => {
        const expanded = p.replace(/^~/, userHome);
        return `if [ -d "${expanded}" ]; then echo "DIR:${p}"; elif [ -f "${expanded}" ]; then echo "FILE:${p}"; else echo "MISS:${p}"; fi`;
      }).join('; ');

      const res = await sshExec(activeConnId, checks);
      if (res && res.stdout) {
        const statusObj: Record<string, 'exists' | 'missing' | 'file'> = {};
        const lines = res.stdout.split('\n').filter(Boolean);
        for (const l of lines) {
          if (l.startsWith('DIR:')) statusObj[l.substring(4)] = 'exists';
          else if (l.startsWith('FILE:')) statusObj[l.substring(5)] = 'file';
          else if (l.startsWith('MISS:')) statusObj[l.substring(5)] = 'missing';
        }
        setPathStatusMap(prev => ({ ...prev, ...statusObj }));
      }
    } catch {
      // Non-critical path validation failure
    } finally {
      setIsValidatingPaths(false);
    }
  };

  useEffect(() => {
    loadEnvironment();
  }, [loadEnvironment]);

  // 3. Save or Update Variable (with safety backup & immediate terminal broadcast)
  const handleSaveVariable = async (item: {
    originalKey?: string;
    key: string;
    value: string;
    scope: 'user' | 'system';
    isMultiPath: boolean;
    paths: string[];
  }) => {
    if (!item.key.trim()) {
      alert('Variable name cannot be empty');
      return;
    }
    const cleanKey = item.key.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanKey)) {
      alert('Variable name must be a valid shell identifier (letters, numbers, underscore; cannot start with number)');
      return;
    }

    // PATH safety guard: ensure /bin or /usr/bin is preserved
    let finalValue = item.isMultiPath ? item.paths.join(':') : item.value;
    if (cleanKey === 'PATH') {
      if (!finalValue.includes('/bin') && !finalValue.includes('/usr/bin')) {
        const ok = confirm('CRITICAL WARNING: Your new PATH does not include /bin or /usr/bin. This may break command execution in terminals. Do you want to continue?');
        if (!ok) return;
      }
    }

    setIsLoading(true);
    try {
      if (item.scope === 'user') {
        const bashrcPath = `${userHome}/.bashrc`;
        let existingContent = await sftpReadTextFile(activeConnId, bashrcPath).catch(() => '');

        // Parse lines, replace or append directly in ~/.bashrc (NO .bak files)
        const lines = existingContent ? existingContent.split('\n') : [];
        let replaced = false;
        const newLines: string[] = [];
        const targetKey = item.originalKey || cleanKey;

        for (const l of lines) {
          const trimmed = l.trim();
          // Remove legacy env.sh integration line if present
          if (trimmed.includes('.clouddesk/env.sh') || trimmed.includes('# CloudDesk Environment Integration')) {
            continue;
          }
          if (trimmed.startsWith(`export ${targetKey}=`)) {
            newLines.push(`export ${cleanKey}="${finalValue}"`);
            replaced = true;
          } else {
            newLines.push(l);
          }
        }

        if (!replaced) {
          if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== '') {
            newLines.push('');
          }
          newLines.push(`export ${cleanKey}="${finalValue}"`);
        }

        await sftpWriteTextFile(activeConnId, bashrcPath, newLines.join('\n'));

        // Clean up legacy env.sh and any old backup files from remote server
        await sshExec(activeConnId, `rm -f "${userHome}/.clouddesk/env.sh"* "${userHome}/.bashrc.clouddesk.bak"*`).catch(() => {});

      } else {
        // System Scope: Update /etc/environment (NO .bak files)
        const sysPath = '/etc/environment';
        let existingContent = await sftpReadTextFile(activeConnId, sysPath).catch(() => '');

        const lines = existingContent ? existingContent.split('\n') : [];
        let replaced = false;
        const newLines: string[] = [];
        const targetKey = item.originalKey || cleanKey;

        for (const l of lines) {
          const trimmed = l.trim();
          if (trimmed.startsWith(`${targetKey}=`)) {
            newLines.push(`${cleanKey}="${finalValue}"`);
            replaced = true;
          } else {
            newLines.push(l);
          }
        }

        if (!replaced) {
          newLines.push(`${cleanKey}="${finalValue}"`);
        }

        const writeRes = await sshExec(activeConnId, `echo '${newLines.join('\n').replace(/'/g, "'\\''")}' > ${sysPath}`);
        if (writeRes.exit_code !== 0 && currentUsername !== 'root') {
          // If non-root, try with sudo
          await sshExec(activeConnId, `sudo bash -c "cat << 'EOF' > ${sysPath}\n${newLines.join('\n')}\nEOF"`);
        }

        // Clean up any old system backup files
        await sshExec(activeConnId, `rm -f "${sysPath}.clouddesk.bak"*`).catch(() => {});
      }

      // If key was renamed, unset the old key
      if (item.originalKey && item.originalKey !== cleanKey) {
        window.dispatchEvent(new CustomEvent('clouddesk:env-sync', {
          detail: { key: item.originalKey, value: '', action: 'delete' }
        }));
      }

      // Immediate Reflection in ALL active terminals
      window.dispatchEvent(new CustomEvent('clouddesk:env-sync', {
        detail: { key: cleanKey, value: finalValue, action: 'set' }
      }));

      showToast(`Saved $${cleanKey} & synced to all active terminals`);
      await sendDesktopNotification('Environment Variable Updated', `Saved $${cleanKey} and reflected immediately in all terminal shells.`);

      setEditingVar(null);
      await loadEnvironment();
    } catch (err: any) {
      alert(`Save failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Delete Environment Variable
  const handleDeleteVariable = async (item: EnvItem) => {
    if (item.isCoreSystem) {
      const ok = confirm(`DANGER: "${item.key}" is a critical system variable. Deleting it may break bash or terminal logins. Are you absolutely certain?`);
      if (!ok) return;
    } else {
      const ok = confirm(`Delete environment variable "${item.key}" from ${item.sourceFile}?`);
      if (!ok) return;
    }

    setIsLoading(true);
    try {
      if (item.scope === 'user') {
        const bashrcPath = `${userHome}/.bashrc`;
        const content = await sftpReadTextFile(activeConnId, bashrcPath).catch(() => '');
        if (content) {
          const filtered = content
            .split('\n')
            .filter(l => {
              const trimmed = l.trim();
              if (trimmed.startsWith(`export ${item.key}=`)) return false;
              if (trimmed.includes('.clouddesk/env.sh')) return false;
              return true;
            })
            .join('\n');
          await sftpWriteTextFile(activeConnId, bashrcPath, filtered);
        }
        // Clean up any lingering env.sh files
        await sshExec(activeConnId, `rm -f "${userHome}/.clouddesk/env.sh"*`).catch(() => {});
      } else if (item.scope === 'system') {
        const sysPath = '/etc/environment';
        const content = await sftpReadTextFile(activeConnId, sysPath).catch(() => '');
        if (content) {
          const filtered = content.split('\n').filter(l => !l.trim().startsWith(`${item.key}=`)).join('\n');
          const writeRes = await sshExec(activeConnId, `echo '${filtered.replace(/'/g, "'\\''")}' > ${sysPath}`);
          if (writeRes.exit_code !== 0 && currentUsername !== 'root') {
            await sshExec(activeConnId, `sudo bash -c "cat << 'EOF' > ${sysPath}\n${filtered}\nEOF"`);
          }
        }
      }

      // Immediately Unset in ALL active terminals
      window.dispatchEvent(new CustomEvent('clouddesk:env-sync', {
        detail: { key: item.key, value: '', action: 'delete' }
      }));

      showToast(`Deleted $${item.key} and unset across all active terminals`);
      await sendDesktopNotification('Environment Variable Removed', `Unset $${item.key} in all active terminal sessions.`);

      await loadEnvironment();
    } catch (err: any) {
      alert(`Delete failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 5. Force Re-Broadcast all user variables to active terminals
  const handleSyncAllToTerminals = () => {
    let count = 0;
    variables.forEach(v => {
      window.dispatchEvent(new CustomEvent('clouddesk:env-sync', {
        detail: { key: v.key, value: v.value, action: 'set' }
      }));
      count++;
    });
    showToast(`Reflected ${count} environment variables in all active terminal shells`);
  };

  // Filtered List
  const filteredVariables = useMemo(() => {
    return variables.filter(v => {
      // Scope filter
      if (scopeFilter !== 'all' && v.scope !== scopeFilter) return false;
      // Type filter
      if (typeFilter === 'multipath' && !v.isMultiPath) return false;
      if (typeFilter === 'single' && v.isMultiPath) return false;
      // Search
      if (search.trim()) {
        const s = search.toLowerCase();
        return v.key.toLowerCase().includes(s) || v.value.toLowerCase().includes(s);
      }
      return true;
    });
  }, [variables, scopeFilter, typeFilter, search]);

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none overflow-hidden font-sans relative">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="absolute top-3 right-4 z-50 bg-emerald-600/90 backdrop-blur-md text-white text-xs px-4 py-2 rounded-xl shadow-2xl flex items-center space-x-2 border border-emerald-400/40 animate-in fade-in slide-in-from-top-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-200 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Top macOS App Header */}
      <div className="px-5 py-3 bg-[#14141e]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-600 to-pink-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Variable className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm font-bold text-white tracking-wide">Environment Variables</h2>
              <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full font-mono text-purple-300">
                {currentUsername}@{activeServer?.name || activeServer?.host || 'remote'}
              </span>
            </div>
            <p className="text-[11px] text-gray-400">
              Manage system & user variables. Changes immediately reflect in all active terminal shells.
            </p>
          </div>
        </div>

        {/* Global Action Toolbar */}
        <div className="flex items-center space-x-2">
          <button
            onClick={handleSyncAllToTerminals}
            className="px-3 py-1.5 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-sm"
            title="Export all variables and refresh hash in all active terminals"
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Sync to Terminals</span>
          </button>

          <button
            onClick={() => setShowPresets(true)}
            className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 text-xs font-medium flex items-center space-x-1.5 transition-all"
            title="Quick-add common variables"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Presets</span>
          </button>

          <button
            onClick={() => {
              setEditingVar({
                key: '',
                value: '',
                scope: 'user',
                isMultiPath: false,
                paths: [],
              });
            }}
            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md shadow-blue-600/30 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Variable</span>
          </button>

          <button
            onClick={loadEnvironment}
            disabled={isLoading}
            className={`p-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors border border-white/10 ${isLoading ? 'animate-spin text-blue-400' : ''}`}
            title="Reload from server"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter and Search Navigation Bar */}
      <div className="px-5 py-2.5 bg-[#12121c] border-b border-white/[0.06] flex items-center justify-between shrink-0 space-x-4">
        {/* Scope Segmented Pill */}
        <div className="flex items-center space-x-1 bg-[#0d0d15] p-1 rounded-xl border border-white/10 text-xs">
          <button
            onClick={() => setScopeFilter('all')}
            className={`px-3 py-1 rounded-lg font-medium transition-all ${scopeFilter === 'all' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            All ({variables.length})
          </button>
          <button
            onClick={() => setScopeFilter('user')}
            className={`px-3 py-1 rounded-lg font-medium transition-all ${scopeFilter === 'user' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            User Variables ({variables.filter(v => v.scope === 'user').length})
          </button>
          <button
            onClick={() => setScopeFilter('system')}
            className={`px-3 py-1 rounded-lg font-medium transition-all ${scopeFilter === 'system' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            System Variables ({variables.filter(v => v.scope === 'system').length})
          </button>
          <button
            onClick={() => setScopeFilter('session')}
            className={`px-3 py-1 rounded-lg font-medium transition-all ${scopeFilter === 'session' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
          >
            Live Shell ({variables.filter(v => v.scope === 'session').length})
          </button>
        </div>

        {/* Type Filter & Search Bar */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1 bg-[#0d0d15] p-1 rounded-xl border border-white/10 text-xs">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-lg transition-all ${typeFilter === 'all' ? 'bg-white/15 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
            >
              All Types
            </button>
            <button
              onClick={() => setTypeFilter('multipath')}
              className={`px-2.5 py-1 rounded-lg transition-all flex items-center space-x-1 ${typeFilter === 'multipath' ? 'bg-amber-600/30 text-amber-300 font-medium' : 'text-gray-400 hover:text-white'}`}
              title="Show multi-path colon-separated variables like PATH"
            >
              <Folder className="w-3 h-3" />
              <span>Multi-Path Only</span>
            </button>
            <button
              onClick={() => setTypeFilter('single')}
              className={`px-2.5 py-1 rounded-lg transition-all ${typeFilter === 'single' ? 'bg-white/15 text-white font-medium' : 'text-gray-400 hover:text-white'}`}
            >
              Single Value
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search variable or path..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#0d0d15] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-52 focus:w-64 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Main Variable Grid & Inspector */}
      <div className="flex-1 overflow-y-auto p-5 space-y-3">
        {isLoading && variables.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center space-y-3 text-gray-400">
            <RefreshCw className="w-6 h-6 animate-spin text-purple-400" />
            <span className="text-xs">Reading server environment...</span>
          </div>
        ) : filteredVariables.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center space-y-3 text-gray-500">
            <Variable className="w-12 h-12 opacity-20" />
            <span className="text-xs">No environment variables match current filter</span>
          </div>
        ) : (
          filteredVariables.map((item) => {
            const isPathVar = item.key === 'PATH';

            return (
              <div
                key={item.key}
                className={`bg-[#141420] border rounded-2xl p-4 transition-all hover:border-white/20 shadow-md ${
                  isPathVar
                    ? 'border-amber-500/40 bg-gradient-to-r from-amber-500/[0.04] to-transparent ring-1 ring-amber-500/20'
                    : 'border-white/[0.08]'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                      item.isMultiPath
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    }`}>
                      {item.isMultiPath ? <Folder className="w-4 h-4" /> : <Variable className="w-4 h-4" />}
                    </div>

                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-sm text-white tracking-wide">
                          {item.key}
                        </span>

                        {/* Scope Badge */}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          item.scope === 'user'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : item.scope === 'system'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-white/10 text-gray-400'
                        }`}>
                          {item.scope === 'user' ? 'User Scope' : item.scope === 'system' ? 'System Scope' : 'Active Shell'}
                        </span>

                        {/* Multi-Path Badge */}
                        {item.isMultiPath && (
                          <span className="text-[10px] bg-amber-500/15 text-amber-300 border border-amber-500/25 px-2 py-0.5 rounded-full font-mono">
                            {item.paths?.length || 0} Path Entries
                          </span>
                        )}

                        {/* Core Protection Badge */}
                        {item.isCoreSystem && (
                          <span className="text-[10px] bg-rose-500/15 text-rose-300 border border-rose-500/25 px-2 py-0.5 rounded-full flex items-center space-x-1">
                            <Shield className="w-2.5 h-2.5" />
                            <span>System Core</span>
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-gray-400 mt-0.5 font-mono">
                        Source: <span className="text-gray-300">{item.sourceFile}</span>
                      </div>
                    </div>
                  </div>

                  {/* Row Actions */}
                  <div className="flex items-center space-x-1.5 shrink-0">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(item.value);
                        setCopiedKey(item.key);
                        setTimeout(() => setCopiedKey(null), 2000);
                        showToast(`Copied $${item.key} to clipboard`);
                      }}
                      className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                      title="Copy value"
                    >
                      {copiedKey === item.key ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>

                    <button
                      onClick={() => {
                        setEditingVar({
                          originalKey: item.key,
                          key: item.key,
                          value: item.value,
                          scope: item.scope === 'system' ? 'system' : 'user',
                          isMultiPath: item.isMultiPath,
                          paths: item.paths ? [...item.paths] : (item.value.includes(':') ? item.value.split(':').filter(Boolean) : [item.value]),
                        });
                      }}
                      className="px-2.5 py-1 rounded-xl bg-white/5 hover:bg-blue-600/30 text-gray-300 hover:text-blue-300 border border-white/10 text-xs font-medium flex items-center space-x-1 transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    <button
                      onClick={() => handleDeleteVariable(item)}
                      className="p-1.5 rounded-xl hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors"
                      title="Delete variable"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Content Value Rendering (Multi-Path vs Single) */}
                <div className="mt-3">
                  {item.isMultiPath && item.paths && item.paths.length > 0 ? (
                    <div className="space-y-1.5 bg-[#0d0d15] rounded-xl p-3 border border-white/[0.05]">
                      <div className="text-[10px] uppercase font-semibold text-gray-500 tracking-wider flex items-center justify-between mb-1">
                        <span>Directory Priority Chain (Evaluated Left-to-Right)</span>
                        {isValidatingPaths && <span className="text-amber-400 lowercase">verifying paths on server...</span>}
                      </div>

                      {item.paths.map((p, idx) => {
                        const status = pathStatusMap[p];
                        const isDuplicate = item.paths!.indexOf(p) !== idx;

                        return (
                          <div
                            key={`${p}-${idx}`}
                            className={`flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-mono transition-colors ${
                              isDuplicate
                                ? 'bg-amber-500/10 text-amber-200 border border-amber-500/30'
                                : status === 'missing'
                                ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                                : 'bg-white/[0.03] text-gray-300 hover:bg-white/[0.06]'
                            }`}
                          >
                            <div className="flex items-center space-x-2 truncate">
                              <span className="text-[10px] text-gray-500 font-sans w-5">#{idx + 1}</span>
                              <span className="truncate">{p}</span>
                            </div>

                            <div className="flex items-center space-x-2 shrink-0 pl-2">
                              {isDuplicate && (
                                <span className="text-[10px] text-amber-400 font-sans">duplicate</span>
                              )}

                              {status === 'exists' ? (
                                <span className="flex items-center space-x-1 text-emerald-400 text-[10px] font-sans" title="Directory exists & verified on server">
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>valid</span>
                                </span>
                              ) : status === 'file' ? (
                                <span className="flex items-center space-x-1 text-amber-400 text-[10px] font-sans" title="Warning: Target is a file, not a directory">
                                  <AlertTriangle className="w-3 h-3" />
                                  <span>file</span>
                                </span>
                              ) : status === 'missing' ? (
                                <span className="flex items-center space-x-1 text-rose-400 text-[10px] font-sans" title="Target path does not exist on server">
                                  <XCircle className="w-3 h-3" />
                                  <span>missing</span>
                                </span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="bg-[#0d0d15] rounded-xl px-3.5 py-2 font-mono text-xs text-gray-300 break-all border border-white/[0.05] select-text">
                      {item.value || <span className="text-gray-600 italic">(Empty value)</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Quick Presets Modal Drawer */}
      {showPresets && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="bg-[#1e1e2e] border border-white/20 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-sm text-white">Quick-Add Standard Presets</h3>
              </div>
              <button onClick={() => setShowPresets(false)} className="text-gray-400 hover:text-white">
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-400">
              Select a popular Linux developer environment variable to prefill and configure:
            </p>

            <div className="space-y-2 max-h-[360px] overflow-y-auto">
              {COMMON_PRESETS.map((preset) => (
                <div
                  key={preset.key}
                  onClick={() => {
                    setEditingVar({
                      key: preset.key,
                      value: preset.value,
                      scope: 'user',
                      isMultiPath: preset.multi,
                      paths: [preset.value],
                    });
                    setShowPresets(false);
                  }}
                  className="p-3 bg-[#14141e] hover:bg-blue-600/20 border border-white/10 rounded-xl cursor-pointer transition-colors flex items-center justify-between group"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-xs text-white group-hover:text-blue-300">{preset.key}</span>
                      <span className="text-[10px] text-gray-400">({preset.label})</span>
                    </div>
                    <span className="text-[11px] text-gray-500 font-mono truncate block mt-0.5">{preset.value}</span>
                  </div>
                  <Plus className="w-4 h-4 text-gray-400 group-hover:text-blue-400 shrink-0" />
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowPresets(false)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-gray-200 rounded-xl text-xs font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Create Variable Modal */}
      {editingVar && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveVariable(editingVar);
            }}
            className="bg-[#1e1e2e] border border-white/20 rounded-3xl w-full max-w-2xl p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col"
          >
            {/* Modal Title */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <Variable className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-base text-white">
                  {editingVar.originalKey ? `Edit $${editingVar.originalKey}` : 'Create Environment Variable'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingVar(null)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* Variable Key and Scope */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <label className="text-xs font-semibold text-gray-300">Variable Identifier (Name)</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. JAVA_HOME or PATH"
                    value={editingVar.key}
                    onChange={e => {
                      const k = e.target.value.toUpperCase();
                      const isMulti = KNOWN_MULTI_PATH_KEYS.has(k) || editingVar.isMultiPath;
                      setEditingVar(prev => prev ? {
                        ...prev,
                        key: k,
                        isMultiPath: isMulti
                      } : null);
                    }}
                    className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3.5 py-2 text-sm font-mono text-white focus:outline-none focus:border-blue-500 uppercase"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-300">Target Scope</label>
                  <select
                    value={editingVar.scope}
                    onChange={e => setEditingVar(prev => prev ? { ...prev, scope: e.target.value as any } : null)}
                    className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="user">User (~/.bashrc)</option>
                    <option value="system">System (/etc/environment)</option>
                  </select>
                </div>
              </div>

              {/* Mode Toggle: Multi-Path vs Single String */}
              <div className="flex items-center justify-between p-3 bg-[#14141e] rounded-2xl border border-white/10">
                <div>
                  <span className="text-xs font-bold text-white block">Multi-Path Mode (Colon Separated)</span>
                  <span className="text-[11px] text-gray-400 block">
                    Enable to manage individual directory paths with ordering, verification, and auto-colon joining.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !editingVar.isMultiPath;
                    setEditingVar(prev => {
                      if (!prev) return null;
                      const paths = next
                        ? (prev.value.includes(':') ? prev.value.split(':').filter(Boolean) : [prev.value].filter(Boolean))
                        : prev.paths;
                      return {
                        ...prev,
                        isMultiPath: next,
                        paths
                      };
                    });
                  }}
                  className={`w-11 h-6 rounded-full transition-colors p-1 flex items-center ${
                    editingVar.isMultiPath ? 'bg-blue-600 justify-end' : 'bg-white/20 justify-start'
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-white shadow-md" />
                </button>
              </div>

              {/* Multi-Path Interactive List Editor */}
              {editingVar.isMultiPath ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-300">
                      Directory Paths ({editingVar.paths.length})
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        const newPath = prompt('Enter new directory path:', '/usr/local/bin');
                        if (newPath?.trim()) {
                          setEditingVar(prev => prev ? {
                            ...prev,
                            paths: [...prev.paths, newPath.trim()]
                          } : null);
                        }
                      }}
                      className="px-2.5 py-1 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-medium flex items-center space-x-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Path</span>
                    </button>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto">
                    {editingVar.paths.length === 0 ? (
                      <div className="p-4 rounded-xl bg-[#11111b] text-center text-xs text-gray-500 border border-white/5">
                        No paths added yet. Click &quot;Add Path&quot; to begin.
                      </div>
                    ) : (
                      editingVar.paths.map((p, idx) => (
                        <div
                          key={`${p}-${idx}`}
                          className="flex items-center justify-between p-2.5 bg-[#11111b] rounded-xl border border-white/10 group"
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <span className="text-[10px] text-gray-500 font-mono w-5">#{idx + 1}</span>
                            <span className="text-xs font-mono text-gray-200 truncate">{p}</span>
                          </div>

                          <div className="flex items-center space-x-1 shrink-0">
                            {/* Reorder Buttons */}
                            <button
                              type="button"
                              disabled={idx === 0}
                              onClick={() => {
                                const next = [...editingVar.paths];
                                const temp = next[idx - 1];
                                next[idx - 1] = next[idx];
                                next[idx] = temp;
                                setEditingVar(prev => prev ? { ...prev, paths: next } : null);
                              }}
                              className="p-1 text-gray-500 hover:text-white disabled:opacity-20"
                              title="Move up (higher priority)"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              disabled={idx === editingVar.paths.length - 1}
                              onClick={() => {
                                const next = [...editingVar.paths];
                                const temp = next[idx + 1];
                                next[idx + 1] = next[idx];
                                next[idx] = temp;
                                setEditingVar(prev => prev ? { ...prev, paths: next } : null);
                              }}
                              className="p-1 text-gray-500 hover:text-white disabled:opacity-20"
                              title="Move down (lower priority)"
                            >
                              <ArrowDown className="w-3.5 h-3.5" />
                            </button>

                            {/* Edit Path inline */}
                            <button
                              type="button"
                              onClick={() => {
                                const updated = prompt('Edit path:', p);
                                if (updated?.trim()) {
                                  const next = [...editingVar.paths];
                                  next[idx] = updated.trim();
                                  setEditingVar(prev => prev ? { ...prev, paths: next } : null);
                                }
                              }}
                              className="p-1 text-gray-500 hover:text-blue-300"
                              title="Edit path"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete Path */}
                            <button
                              type="button"
                              onClick={() => {
                                const next = editingVar.paths.filter((_, i) => i !== idx);
                                setEditingVar(prev => prev ? { ...prev, paths: next } : null);
                              }}
                              className="p-1 text-gray-500 hover:text-rose-400"
                              title="Remove path"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Compiled String Preview */}
                  <div className="text-[11px] text-gray-400 space-y-1">
                    <span className="font-semibold text-gray-500">Compiled String Preview:</span>
                    <div className="bg-[#0c0c14] border border-white/10 rounded-xl p-2.5 font-mono text-[11px] text-gray-300 break-all select-text">
                      {editingVar.paths.join(':') || '(empty)'}
                    </div>
                  </div>
                </div>
              ) : (
                /* Single String Editor */
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-300">Variable Value</label>
                  <textarea
                    rows={4}
                    required
                    placeholder="e.g. /usr/lib/jvm/java-17-openjdk-amd64"
                    value={editingVar.value}
                    onChange={e => setEditingVar(prev => prev ? { ...prev, value: e.target.value } : null)}
                    className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3.5 py-2 text-xs font-mono text-white focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
              )}
            </div>

            {/* Modal Buttons */}
            <div className="flex items-center justify-between border-t border-white/10 pt-3">
              <span className="text-[11px] text-gray-400 flex items-center space-x-1">
                <Shield className="w-3 h-3 text-emerald-400" />
                <span>Direct sync to ~/.bashrc and active terminal shells</span>
              </span>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setEditingVar(null)}
                  className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-600/30 flex items-center space-x-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save & Apply</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
