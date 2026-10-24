import React, { useState, useEffect, useCallback } from 'react';
import { 
  ArrowRightLeft, Plus, Play, Square, Copy, Check, Trash2, 
  Settings, AlertCircle, ArrowRight, ShieldCheck, Globe, Database,
  Cpu, HardDrive, RefreshCw, Radio, Terminal, ExternalLink, Loader2,
  CheckCircle2
} from 'lucide-react';
import { SshTunnelRule, TunnelType } from '../types';
import { useSshStore } from '../sshStore';
import { useConnectionStore } from '../../../lib/store';
import { 
  sshStartTunnel, 
  sshStopTunnel, 
  sshListTunnels, 
  sshStartSocks5, 
  sshStopSocks5,
  openExternalUrl,
  sshExec,
  sftpReadTextFile,
  sftpWriteTextFile,
  sftpMkdir
} from '../../../lib/tauri-bridge';

const PRESETS: { name: string; type: TunnelType; localPort: number; remotePort: number; remoteHost: string; desc: string }[] = [
  { name: 'Web Dev Proxy (Port 80)', type: 'local', localPort: 8080, remotePort: 80, remoteHost: '127.0.0.1', desc: 'Forward remote HTTP web server port 80 to localhost:8080' },
  { name: 'PostgreSQL Database', type: 'local', localPort: 5432, remotePort: 5432, remoteHost: '127.0.0.1', desc: 'Forward remote PostgreSQL port 5432 to localhost:5432' },
  { name: 'MySQL / MariaDB', type: 'local', localPort: 3306, remotePort: 3306, remoteHost: '127.0.0.1', desc: 'Forward remote MySQL port 3306 to localhost:3306' },
  { name: 'Redis Cache Server', type: 'local', localPort: 6379, remotePort: 6379, remoteHost: '127.0.0.1', desc: 'Forward remote Redis in-memory cache to localhost:6379' },
  { name: 'MongoDB Server', type: 'local', localPort: 27017, remotePort: 27017, remoteHost: '127.0.0.1', desc: 'Forward remote MongoDB database to localhost:27017' },
  { name: 'Remote Webhook Ingress', type: 'remote', localPort: 3000, remotePort: 9000, remoteHost: '127.0.0.1', desc: 'Expose local port 3000 to remote port 9000' },
  { name: 'Encrypted SOCKS5 Proxy', type: 'dynamic', localPort: 1080, remotePort: 1080, remoteHost: '127.0.0.1', desc: 'Secure browser and app tunneling via SOCKS5 port 1080' },
];

export default function SshTunnelsManager({ isLight = false }: { isLight?: boolean }) {
  const { tunnels, setTunnels, addTunnel, removeTunnel, updateTunnel, setTunnelStatus, addAuditLog } = useSshStore();
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);

  const [activeFilter, setActiveFilter] = useState<'all' | 'local' | 'remote' | 'dynamic'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loadingTunnelId, setLoadingTunnelId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<SshTunnelRule | null>(null);

  // User home directory calculation (~/.sshdesktop/tunnels.json)
  const username = activeServer?.username || 'sharuk';
  const [userHome, setUserHome] = useState<string>(() => {
    return (!username || username === 'root') ? '/root' : `/home/${username}`;
  });
  const [isSyncingServer, setIsSyncingServer] = useState(false);
  const [lastServerSync, setLastServerSync] = useState<string | null>(null);

  // Discover actual remote $HOME when connected
  useEffect(() => {
    let isMounted = true;
    if (activeConnectionId) {
      sshExec(activeConnectionId, 'echo $HOME').then(res => {
        if (isMounted && res.exit_code === 0 && res.stdout.trim().startsWith('/')) {
          setUserHome(res.stdout.trim());
        }
      }).catch(() => {});
    } else {
      setUserHome((!username || username === 'root') ? '/root' : `/home/${username}`);
    }
    return () => { isMounted = false; };
  }, [activeConnectionId, username]);

  const tunnelsFilePath = `${userHome}/.sshdesktop/tunnels.json`;
  const legacyTunnelsFilePath = `${userHome}/.clouddesk/tunnels.json`;

  // Helper to persist tunnels list to remote server file ~/.sshdesktop/tunnels.json
  const persistTunnelsToServer = useCallback(async (currentTunnels: SshTunnelRule[], showToast = false) => {
    if (!activeConnectionId) return;
    setIsSyncingServer(true);
    try {
      await sftpMkdir(activeConnectionId, `${userHome}/.sshdesktop`).catch(() => {});

      const cleanRules = currentTunnels.map(t => ({
        id: t.id,
        name: t.name,
        type: t.type,
        localPort: Number(t.localPort),
        remoteHost: t.remoteHost || '127.0.0.1',
        remotePort: Number(t.remotePort),
        bindAddress: t.bindAddress,
        description: t.description || '',
        autoStart: t.autoStart,
        status: 'inactive' as const,
        createdAt: t.createdAt || Date.now(),
      }));

      const jsonStr = JSON.stringify(cleanRules, null, 2);
      let success = false;
      try {
        await sftpWriteTextFile(activeConnectionId, tunnelsFilePath, jsonStr);
        success = true;
      } catch (sftpErr) {
        console.warn('[SSH Tunnels] SFTP write failed, trying sshExec fallback:', sftpErr);
      }

      if (!success) {
        const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
        const res = await sshExec(
          activeConnectionId,
          `mkdir -p "${userHome}/.sshdesktop" && printf '%s' '${b64}' | base64 -d > "${tunnelsFilePath}"`
        );
        success = res.exit_code === 0;
      }

      if (success) {
        const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLastServerSync(nowStr);
        if (showToast) {
          setSuccessMessage(`Tunnels saved to ${tunnelsFilePath}`);
        }
      }
    } catch (err) {
      console.warn('[SSH Tunnels] Failed to save tunnels to server:', err);
    } finally {
      setIsSyncingServer(false);
    }
  }, [activeConnectionId, tunnelsFilePath, userHome]);

  // Hydrate tunnels from server ~/.sshdesktop/tunnels.json when connecting
  useEffect(() => {
    if (!activeConnectionId) return;
    let isMounted = true;

    const hydrateServerTunnels = async () => {
      setIsSyncingServer(true);
      try {
        let fileContent = await sftpReadTextFile(activeConnectionId, tunnelsFilePath).catch(() => '');
        if (!fileContent) {
          fileContent = await sftpReadTextFile(activeConnectionId, legacyTunnelsFilePath).catch(() => '');
        }
        if (!fileContent) {
          const res = await sshExec(
            activeConnectionId,
            `cat "${tunnelsFilePath}" 2>/dev/null || cat "${legacyTunnelsFilePath}" 2>/dev/null`
          ).catch(() => null);
          if (res && res.exit_code === 0 && res.stdout.trim()) {
            fileContent = res.stdout;
          }
        }

        if (fileContent && fileContent.trim().startsWith('[') && isMounted) {
          try {
            const parsed = JSON.parse(fileContent);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const serverRules: SshTunnelRule[] = parsed.filter(item => item && item.id && item.name && item.type).map(item => ({
                id: String(item.id),
                name: String(item.name),
                type: (item.type === 'remote' || item.type === 'dynamic' ? item.type : 'local') as TunnelType,
                localPort: Number(item.localPort) || 8080,
                remoteHost: String(item.remoteHost || '127.0.0.1'),
                remotePort: Number(item.remotePort) || 80,
                description: String(item.description || ''),
                bindAddress: item.bindAddress ? String(item.bindAddress) : undefined,
                autoStart: Boolean(item.autoStart),
                status: 'inactive',
                createdAt: Number(item.createdAt) || Date.now(),
              }));

              if (serverRules.length > 0) {
                setTunnels(serverRules);
                const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                setLastServerSync(nowStr);
                return;
              }
            }
          } catch (jsonErr) {
            console.warn('[SSH Tunnels] Failed to parse tunnels JSON from server:', jsonErr);
          }
        }

        // If file does not exist yet on server, write the existing default/local tunnels to ~/.sshdesktop/tunnels.json
        if (isMounted && tunnels.length > 0) {
          await persistTunnelsToServer(tunnels);
        }
      } catch (err) {
        console.warn('[SSH Tunnels] Failed to hydrate tunnels from server:', err);
      } finally {
        if (isMounted) setIsSyncingServer(false);
      }
    };

    hydrateServerTunnels();
    return () => { isMounted = false; };
  }, [activeConnectionId, tunnelsFilePath, userHome]);

  // Form State
  const [ruleName, setRuleName] = useState('');
  const [ruleType, setRuleType] = useState<TunnelType>('local');
  const [localPort, setLocalPort] = useState<number>(8080);
  const [remoteHost, setRemoteHost] = useState('127.0.0.1');
  const [remotePort, setRemotePort] = useState<number>(80);
  const [ruleDescription, setRuleDescription] = useState('');

  // Synchronize active background tunnels with local rules
  useEffect(() => {
    let isMounted = true;
    const syncActiveTunnels = async () => {
      try {
        const activeTunnels = await sshListTunnels();
        if (isMounted && activeTunnels && activeTunnels.length > 0) {
          tunnels.forEach(rule => {
            const match = activeTunnels.find(at => {
              if (rule.type === 'dynamic') {
                return at.tunnel_id.includes('socks5');
              }
              if (rule.type === 'local') {
                return at.tunnel_id === rule.activeTunnelId || (rule.localPort > 0 && at.local_port === rule.localPort);
              }
              if (rule.type === 'remote') {
                return at.tunnel_id === rule.activeTunnelId || at.tunnel_id.includes(`remote:${rule.remotePort}`) || (rule.localPort > 0 && at.local_port === rule.localPort);
              }
              return false;
            });
            if (match && rule.status !== 'active') {
              updateTunnel(rule.id, {
                status: 'active',
                activeTunnelId: match.tunnel_id,
                localPort: rule.localPort || match.local_port,
              });
            }
          });
        }
      } catch (err) {
        console.warn('Failed to sync active tunnels:', err);
      }
    };
    syncActiveTunnels();
    return () => { isMounted = false; };
  }, [activeConnectionId]);

  const filteredTunnels = tunnels.filter(t => {
    const matchesFilter = activeFilter === 'all' || t.type === activeFilter;
    const matchesSearch = t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.localPort.toString().includes(searchQuery) ||
      t.remotePort.toString().includes(searchQuery) ||
      (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesFilter && matchesSearch;
  });

  // Generate runnable OpenSSH CLI command string
  const getSshCliCommand = (t: SshTunnelRule) => {
    const user = activeServer?.username || 'root';
    const host = activeServer?.host || 'server-ip';
    const port = activeServer?.port || 22;
    const portFlag = port !== 22 ? ` -p ${port}` : '';

    if (t.type === 'local') {
      return `ssh -N -L ${t.localPort}:${t.remoteHost || '127.0.0.1'}:${t.remotePort} ${user}@${host}${portFlag}`;
    } else if (t.type === 'remote') {
      return `ssh -N -R ${t.remotePort}:${t.remoteHost || '127.0.0.1'}:${t.localPort} ${user}@${host}${portFlag}`;
    } else {
      return `ssh -N -D ${t.localPort} ${user}@${host}${portFlag}`;
    }
  };

  const handleCopyCommand = (t: SshTunnelRule) => {
    const cmd = getSshCliCommand(t);
    navigator.clipboard.writeText(cmd);
    setCopiedId(t.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleToggleTunnel = async (t: SshTunnelRule) => {
    setErrorMessage(null);
    setSuccessMessage(null);

    // If starting and not connected to an SSH server
    if (t.status !== 'active' && !activeConnectionId) {
      setErrorMessage(`No active SSH connection. Please connect to your server (${activeServer?.host || '13.233.150.163'}) in SSH Desktop before starting tunnels.`);
      return;
    }

    setLoadingTunnelId(t.id);

    try {
      if (t.status === 'active') {
        // STOP TUNNEL
        if (t.type === 'dynamic') {
          if (activeConnectionId) {
            await sshStopSocks5(activeConnectionId);
          }
          await sshStopTunnel(`socks5:${activeConnectionId}`);
        } else {
          const keyToStop = t.activeTunnelId || `${activeConnectionId || ''}:${t.remoteHost || '127.0.0.1'}:${t.remotePort}`;
          await sshStopTunnel(keyToStop);
          await sshStopTunnel(String(t.localPort));
        }

        updateTunnel(t.id, {
          status: 'inactive',
          activeTunnelId: undefined,
          error: undefined,
        });

        addAuditLog({
          action: 'Stopped SSH Tunnel',
          host: activeServer?.host || 'remote',
          username: activeServer?.username || 'user',
          status: 'warning',
          details: `Stopped ${t.type.toUpperCase()} tunnel: ${t.name} (Port ${t.localPort})`,
        });

        setSuccessMessage(`Tunnel "${t.name}" stopped successfully.`);
      } else {
        // START TUNNEL
        if (t.type === 'dynamic') {
          const boundPort = await sshStartSocks5(activeConnectionId!, t.localPort || 1080);
          if (boundPort && boundPort > 0) {
            updateTunnel(t.id, {
              status: 'active',
              localPort: t.localPort || boundPort,
              activeTunnelId: `socks5:${activeConnectionId}`,
              serverId: activeConnectionId || undefined,
              serverName: activeServer?.name || activeServer?.host || undefined,
              error: undefined,
            });

            addAuditLog({
              action: 'Started SOCKS5 Proxy',
              host: activeServer?.host || 'remote',
              username: activeServer?.username || 'user',
              status: 'success',
              details: `Active SOCKS5 dynamic proxy on 127.0.0.1:${boundPort}`,
            });

            setSuccessMessage(`Dynamic SOCKS5 Proxy active on port ${boundPort}!`);
          } else {
            throw new Error(`Failed to bind SOCKS5 proxy on port ${t.localPort}`);
          }
        } else if (t.type === 'local') {
          // If destination is remote host or empty, map to 127.0.0.1 on the remote machine
          const targetHost = (!t.remoteHost || t.remoteHost === activeServer?.host || t.remoteHost === 'localhost') 
            ? '127.0.0.1' 
            : t.remoteHost;

          const boundPort = await sshStartTunnel(
            activeConnectionId!,
            t.localPort || 0,
            targetHost,
            t.remotePort,
            'local'
          );

          if (boundPort && boundPort > 0) {
            const tunnelKey = `${activeConnectionId}:${targetHost}:${t.remotePort}`;
            updateTunnel(t.id, {
              status: 'active',
              localPort: t.localPort || boundPort,
              activeTunnelId: tunnelKey,
              serverId: activeConnectionId || undefined,
              serverName: activeServer?.name || activeServer?.host || undefined,
              error: undefined,
            });

            addAuditLog({
              action: 'Started SSH Tunnel',
              host: activeServer?.host || 'remote',
              username: activeServer?.username || 'user',
              status: 'success',
              details: `Forwarding local port ${boundPort} -> remote ${targetHost}:${t.remotePort}`,
            });

            setSuccessMessage(`Tunnel "${t.name}" active! Local port ${boundPort} forwards to remote port ${t.remotePort}.`);
          } else {
            throw new Error(`Failed to bind local tunnel port ${t.localPort} -> remote port ${t.remotePort}. Remote service might not be listening.`);
          }
        } else {
          // REMOTE TUNNEL (-R)
          const boundPort = await sshStartTunnel(
            activeConnectionId!,
            t.localPort || 0,
            t.remoteHost || '127.0.0.1',
            t.remotePort,
            'remote'
          );

          if (boundPort && boundPort > 0) {
            const tunnelKey = `${activeConnectionId}:remote:${t.remotePort}:${t.localPort}`;
            updateTunnel(t.id, {
              status: 'active',
              activeTunnelId: tunnelKey,
              serverId: activeConnectionId || undefined,
              serverName: activeServer?.name || activeServer?.host || undefined,
              error: undefined,
            });

            addAuditLog({
              action: 'Started Remote Tunnel',
              host: activeServer?.host || 'remote',
              username: activeServer?.username || 'user',
              status: 'success',
              details: `Exposing local port ${t.localPort} to remote port ${t.remotePort}`,
            });

            setSuccessMessage(`Remote Tunnel active! Server port ${t.remotePort} forwards to local port ${t.localPort}.`);
          } else {
            throw new Error(`Failed to bind remote tunnel on port ${t.remotePort}`);
          }
        }
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      setErrorMessage(`Tunnel failed: ${msg}`);
      updateTunnel(t.id, { status: 'error', error: msg });
    } finally {
      setLoadingTunnelId(null);
    }
  };

  const handleSelectPreset = (p: typeof PRESETS[0]) => {
    setRuleName(p.name);
    setRuleType(p.type);
    setLocalPort(p.localPort);
    setRemotePort(p.remotePort);
    setRemoteHost(p.remoteHost);
    setRuleDescription(p.desc);
  };

  const handleCreateTunnel = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName.trim()) return;

    const newTunnel: SshTunnelRule = {
      id: `tunnel-${Date.now()}`,
      name: ruleName.trim(),
      type: ruleType,
      localPort: Number(localPort),
      remoteHost: remoteHost.trim() || '127.0.0.1',
      remotePort: Number(remotePort),
      description: ruleDescription.trim(),
      serverId: activeConnectionId || undefined,
      serverName: activeServer?.name || activeServer?.host || undefined,
      status: 'inactive',
      createdAt: Date.now(),
    };

    const nextTunnels = [newTunnel, ...tunnels.filter(t => t.id !== newTunnel.id)];
    addTunnel(newTunnel);
    setShowAddModal(false);

    if (activeConnectionId) {
      persistTunnelsToServer(nextTunnels);
    }
    setSuccessMessage(`Tunnel "${newTunnel.name}" configured and saved to ${tunnelsFilePath}.`);

    // Reset Form
    setRuleName('');
    setLocalPort(8080);
    setRemotePort(80);
    setRuleDescription('');

    addAuditLog({
      action: 'Created SSH Tunnel Rule',
      host: activeServer?.host || 'localhost',
      username: activeServer?.username || 'root',
      status: 'success',
      details: `Configured ${ruleType.toUpperCase()} rule: ${newTunnel.name}`,
    });
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e2e]/90 text-gray-200 select-none overflow-hidden font-sans">
      {/* Top Header & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#181825] border-b border-white/[0.08]">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center space-x-2">
            <ArrowRightLeft className="w-5 h-5 text-blue-400" />
            <span>SSH Port Forwarding & Tunnels</span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Create encrypted Local (-L), Remote (-R), and Dynamic SOCKS5 (-D) tunnels
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          {/* Server Sync Location Pill */}
          <div 
            className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-300"
            title={`Tunnels stored on server in ${tunnelsFilePath}`}
          >
            <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="text-gray-400">Server File:</span>
            <span className="font-mono text-amber-300 font-semibold truncate max-w-[200px]">
              {tunnelsFilePath}
            </span>
            {lastServerSync && (
              <span className="text-emerald-400 text-[10px] ml-1 shrink-0">✓ Synced</span>
            )}
          </div>

          {/* Sync Button */}
          <button
            onClick={() => {
              if (activeConnectionId) {
                persistTunnelsToServer(tunnels, true);
              } else {
                setErrorMessage('Connect to an SSH server to sync tunnels with ~/.sshdesktop/tunnels.json');
              }
            }}
            disabled={isSyncingServer || !activeConnectionId}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-medium transition-all cursor-pointer disabled:opacity-40"
            title={`Sync tunnels with ${tunnelsFilePath}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 text-blue-400 ${isSyncingServer ? 'animate-spin' : ''}`} />
            <span>{isSyncingServer ? 'Saving...' : 'Sync Server'}</span>
          </button>

          {/* Search box */}
          <input
            type="text"
            placeholder="Search rules or ports..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-40"
          />

          {/* New Rule Button */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Tunnel Rule</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2 px-6 py-2.5 bg-[#181825]/60 border-b border-white/[0.06] text-xs">
        <span className="text-gray-400 mr-2 font-medium">Filter:</span>
        {(['all', 'local', 'remote', 'dynamic'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveFilter(tab)}
            className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer capitalize ${
              activeFilter === tab
                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {tab === 'all' ? 'All Tunnels' : `${tab} (-${tab[0].toUpperCase()})`}
          </button>
        ))}
      </div>

      {/* Alert / Notification Banners */}
      {errorMessage && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button 
            onClick={() => setErrorMessage(null)}
            className="text-rose-400 hover:text-white ml-2 cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {successMessage && (
        <div className="mx-6 mt-3 px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button 
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-400 hover:text-white ml-2 cursor-pointer font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Tunnels Grid / List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {filteredTunnels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center text-gray-400">
            <ArrowRightLeft className="w-12 h-12 text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-300">No SSH tunnels found</p>
            <p className="text-xs text-gray-500 mt-1 max-w-sm">
              Forward database, web service, or SOCKS5 proxy ports securely across your SSH connection.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-4 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-blue-400 text-xs font-medium border border-blue-500/20 transition-all cursor-pointer"
            >
              Configure First Tunnel
            </button>
          </div>
        ) : (
          filteredTunnels.map(t => {
            const isRunning = t.status === 'active';
            const hasError = t.status === 'error';
            const typeColor = 
              t.type === 'local' ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30' :
              t.type === 'remote' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' :
              'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';

            return (
              <div
                key={t.id}
                className="p-4 rounded-2xl bg-[#181825] border border-white/[0.08] hover:border-white/[0.15] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
              >
                {/* Left: Info */}
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center space-x-2.5">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono uppercase font-semibold border ${typeColor}`}>
                      {t.type} (-{t.type[0].toUpperCase()})
                    </span>
                    <h3 className="text-sm font-semibold text-white truncate">{t.name}</h3>

                    {/* Active Status Badge */}
                    <span className={`flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                      isRunning 
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                        : hasError
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : hasError ? 'bg-rose-400' : 'bg-gray-400'}`} />
                      <span>{isRunning ? 'Active Forwarding' : hasError ? 'Error' : 'Stopped'}</span>
                    </span>
                  </div>

                  {/* Port Mapping Visualization */}
                  <div className="flex items-center space-x-2 text-xs font-mono text-gray-300">
                    <span className="bg-white/5 px-2 py-0.5 rounded text-blue-300">
                      localhost:{t.localPort}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-500" />
                    <span className="bg-white/5 px-2 py-0.5 rounded text-amber-300">
                      {t.type === 'dynamic' ? 'Dynamic SOCKS5' : `${t.remoteHost || '127.0.0.1'}:${t.remotePort}`}
                    </span>
                  </div>

                  {t.description && (
                    <p className="text-xs text-gray-400 line-clamp-1">{t.description}</p>
                  )}

                  {t.error && (
                    <div className="flex items-center space-x-1.5 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1 rounded-lg mt-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{t.error}</span>
                    </div>
                  )}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center space-x-2 shrink-0">
                  {/* Direct Browser Button for Active Local Tunnels */}
                  {isRunning && t.type === 'local' && (
                    <button
                      onClick={() => openExternalUrl(`http://127.0.0.1:${t.localPort}`)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-medium transition-colors cursor-pointer"
                      title={`Open http://127.0.0.1:${t.localPort} in browser`}
                    >
                      <Globe className="w-3.5 h-3.5 text-blue-400" />
                      <span>Open http://localhost:{t.localPort}</span>
                      <ExternalLink className="w-3 h-3 text-blue-400/80" />
                    </button>
                  )}

                  {/* Start / Stop Toggle */}
                  <button
                    onClick={() => handleToggleTunnel(t)}
                    disabled={loadingTunnelId === t.id}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-sm disabled:opacity-50 ${
                      isRunning
                        ? 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                    }`}
                  >
                    {loadingTunnelId === t.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : isRunning ? (
                      <Square className="w-3.5 h-3.5" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>{loadingTunnelId === t.id ? 'Connecting...' : isRunning ? 'Stop' : 'Start'}</span>
                  </button>

                  {/* Copy CLI Command */}
                  <button
                    onClick={() => handleCopyCommand(t)}
                    className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs transition-colors cursor-pointer"
                    title="Copy equivalent SSH CLI command"
                  >
                    {copiedId === t.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === t.id ? 'Copied' : 'CLI'}</span>
                  </button>

                  {/* Delete Rule */}
                  <button
                    onClick={() => setRuleToDelete(t)}
                    className="p-1.5 rounded-xl hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 transition-colors cursor-pointer"
                    title="Delete tunnel rule"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* New Tunnel Rule Modal */}
      {showAddModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setShowAddModal(false)}
        >
          <div 
            className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                <ArrowRightLeft className="w-5 h-5 text-blue-400" />
                <span>Configure SSH Port Forwarding</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-white cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Server Storage Location Hint */}
            <div className="flex items-center space-x-2 p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-300">
              <HardDrive className="w-3.5 h-3.5 shrink-0 text-blue-400" />
              <span>Will be saved to <strong className="font-mono text-amber-300">{tunnelsFilePath}</strong> on server</span>
            </div>

            {/* Quick Presets */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Quick Presets</label>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectPreset(p)}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-blue-600/20 hover:text-blue-300 text-[11px] text-gray-300 border border-white/10 transition-colors cursor-pointer"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleCreateTunnel} className="space-y-3.5">
              {/* Rule Name */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Tunnel Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Remote PostgreSQL"
                  value={ruleName}
                  onChange={e => setRuleName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Tunnel Type Selection */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Tunnel Forwarding Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'local', label: 'Local (-L)', desc: 'Port on client -> Remote service' },
                    { id: 'remote', label: 'Remote (-R)', desc: 'Port on server -> Local service' },
                    { id: 'dynamic', label: 'SOCKS5 (-D)', desc: 'Dynamic browser/app proxy' },
                  ].map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setRuleType(item.id as TunnelType)}
                      className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                        ruleType === item.id
                          ? 'bg-blue-600/20 border-blue-500 text-white font-medium'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      <div className="text-xs font-semibold">{item.label}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Ports and Host */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    {ruleType === 'remote' ? 'Remote Bound Port' : 'Local Client Port'}
                  </label>
                  <input
                    type="number"
                    required
                    min={1}
                    max={65535}
                    value={localPort}
                    onChange={e => setLocalPort(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {ruleType !== 'dynamic' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-300 mb-1">
                      {ruleType === 'remote' ? 'Local Destination Port' : 'Remote Destination Port'}
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={65535}
                      value={remotePort}
                      onChange={e => setRemotePort(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>

              {ruleType !== 'dynamic' && (
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Destination Host</label>
                  <input
                    type="text"
                    required
                    placeholder="127.0.0.1 or internal hostname"
                    value={remoteHost}
                    onChange={e => setRemoteHost(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Description / Notes (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Access staging database cluster"
                  value={ruleDescription}
                  onChange={e => setRuleDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-md transition-all cursor-pointer"
                >
                  Save Tunnel Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Rule Confirmation Modal */}
      {ruleToDelete && (
        <div 
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setRuleToDelete(null)}
        >
          <div 
            className="bg-[#181825] border border-rose-500/30 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center space-x-3 text-rose-400">
              <div className="p-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/20">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-white">Confirm Rule Deletion</h3>
                <p className="text-xs text-gray-400">Are you sure you want to delete this rule?</p>
              </div>
            </div>

            <div className="bg-white/5 rounded-2xl p-4 border border-white/10 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Rule Name:</span>
                <span className="font-semibold text-white">{ruleToDelete.name}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Tunnel Type:</span>
                <span className="uppercase font-mono text-[11px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {ruleToDelete.type}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Port Mapping:</span>
                <span className="font-mono text-emerald-400">
                  {ruleToDelete.type === 'dynamic' 
                    ? `127.0.0.1:${ruleToDelete.localPort} (SOCKS5)`
                    : `127.0.0.1:${ruleToDelete.localPort} ➔ ${ruleToDelete.remoteHost || '127.0.0.1'}:${ruleToDelete.remotePort}`}
                </span>
              </div>
              <div className="flex justify-between items-center text-[11px] pt-1 border-t border-white/5">
                <span className="text-gray-400">Server File:</span>
                <span className="font-mono text-amber-300 truncate max-w-[220px]">{tunnelsFilePath}</span>
              </div>
              {ruleToDelete.status === 'active' && (
                <div className="pt-2 text-amber-400 border-t border-white/10 flex items-center space-x-1.5 text-[11px]">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>This tunnel is currently running and will be stopped before deletion.</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setRuleToDelete(null)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = ruleToDelete;
                  setRuleToDelete(null);
                  if (target.status === 'active') {
                    await handleToggleTunnel(target);
                  }
                  const nextTunnels = tunnels.filter(t => t.id !== target.id);
                  removeTunnel(target.id);
                  if (activeConnectionId) {
                    persistTunnelsToServer(nextTunnels);
                  }
                  setSuccessMessage(`Tunnel rule "${target.name}" deleted and updated in ${tunnelsFilePath}.`);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-600/30 transition-all cursor-pointer flex items-center space-x-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Rule</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
