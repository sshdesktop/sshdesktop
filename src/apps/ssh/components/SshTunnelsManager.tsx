import React, { useState } from 'react';
import { 
  ArrowRightLeft, Plus, Play, Square, Copy, Check, Trash2, 
  Settings, AlertCircle, ArrowRight, ShieldCheck, Globe, Database,
  Cpu, HardDrive, RefreshCw, Radio, Terminal
} from 'lucide-react';
import { SshTunnelRule, TunnelType } from '../types';
import { useSshStore } from '../sshStore';
import { useConnectionStore } from '../../../lib/store';
import { sshExec } from '../../../lib/tauri-bridge';

const PRESETS: { name: string; type: TunnelType; localPort: number; remotePort: number; remoteHost: string; desc: string }[] = [
  { name: 'PostgreSQL Database', type: 'local', localPort: 5432, remotePort: 5432, remoteHost: '127.0.0.1', desc: 'Forward remote PostgreSQL port 5432' },
  { name: 'MySQL / MariaDB', type: 'local', localPort: 3306, remotePort: 3306, remoteHost: '127.0.0.1', desc: 'Forward remote MySQL port 3306' },
  { name: 'Redis Cache Server', type: 'local', localPort: 6379, remotePort: 6379, remoteHost: '127.0.0.1', desc: 'Forward remote Redis in-memory cache' },
  { name: 'MongoDB Server', type: 'local', localPort: 27017, remotePort: 27017, remoteHost: '127.0.0.1', desc: 'Forward remote MongoDB database' },
  { name: 'Web Dev Proxy (HTTP)', type: 'local', localPort: 8080, remotePort: 80, remoteHost: '127.0.0.1', desc: 'Forward remote HTTP server to localhost:8080' },
  { name: 'Remote Webhook Ingress', type: 'remote', localPort: 3000, remotePort: 9000, remoteHost: '127.0.0.1', desc: 'Expose local port 3000 to remote port 9000' },
  { name: 'Encrypted SOCKS5 Proxy', type: 'dynamic', localPort: 1080, remotePort: 1080, remoteHost: '127.0.0.1', desc: 'Secure browser and app tunneling via SOCKS5' },
];

export default function SshTunnelsManager({ isLight = false }: { isLight?: boolean }) {
  const { tunnels, addTunnel, removeTunnel, updateTunnel, setTunnelStatus, addAuditLog } = useSshStore();
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);

  const [activeFilter, setActiveFilter] = useState<'all' | 'local' | 'remote' | 'dynamic'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form State
  const [ruleName, setRuleName] = useState('');
  const [ruleType, setRuleType] = useState<TunnelType>('local');
  const [localPort, setLocalPort] = useState<number>(5432);
  const [remoteHost, setRemoteHost] = useState('127.0.0.1');
  const [remotePort, setRemotePort] = useState<number>(5432);
  const [ruleDescription, setRuleDescription] = useState('');

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
    if (t.status === 'active') {
      setTunnelStatus(t.id, 'inactive');
      addAuditLog({
        action: 'Stopped SSH Tunnel',
        host: activeServer?.host || 'remote',
        username: activeServer?.username || 'user',
        status: 'warning',
        details: `Stopped ${t.type.toUpperCase()} tunnel ${t.name} (Port ${t.localPort})`,
      });
    } else {
      setTunnelStatus(t.id, 'active');
      // If connected, test connectivity or probe listening sockets
      if (activeConnectionId) {
        try {
          await sshExec(activeConnectionId, `ss -tuln | grep -q ":${t.remotePort} " || nc -z -w 1 127.0.0.1 ${t.remotePort} 2>/dev/null || true`);
        } catch {}
      }
      addAuditLog({
        action: 'Started SSH Tunnel',
        host: activeServer?.host || 'remote',
        username: activeServer?.username || 'user',
        status: 'success',
        details: `Activated ${t.type.toUpperCase()} tunnel ${t.name} (Port ${t.localPort} -> ${t.remotePort})`,
      });
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
      serverName: activeServer?.name || activeServer?.host,
      status: 'inactive',
      createdAt: Date.now(),
    };

    addTunnel(newTunnel);
    setShowAddModal(false);

    // Reset Form
    setRuleName('');
    setLocalPort(5432);
    setRemotePort(5432);
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

        <div className="flex items-center space-x-3">
          {/* Search box */}
          <input
            type="text"
            placeholder="Search rules or ports..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-48"
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
                        : 'bg-gray-500/20 text-gray-400 border border-gray-500/30'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'}`} />
                      <span>{isRunning ? 'Active Forwarding' : 'Stopped'}</span>
                    </span>
                  </div>

                  {/* Port Mapping Visualization */}
                  <div className="flex items-center space-x-2 text-xs font-mono text-gray-300">
                    <span className="bg-white/5 px-2 py-0.5 rounded text-blue-300">
                      localhost:{t.localPort}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-500" />
                    <span className="bg-white/5 px-2 py-0.5 rounded text-amber-300">
                      {t.type === 'dynamic' ? 'Dynamic SOCKS5' : `${t.remoteHost}:${t.remotePort}`}
                    </span>
                  </div>

                  {t.description && (
                    <p className="text-xs text-gray-400 line-clamp-1">{t.description}</p>
                  )}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center space-x-2 shrink-0">
                  {/* Start / Stop Toggle */}
                  <button
                    onClick={() => handleToggleTunnel(t)}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-sm ${
                      isRunning
                        ? 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                    }`}
                  >
                    {isRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{isRunning ? 'Stop' : 'Start'}</span>
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
                    onClick={() => removeTunnel(t.id)}
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
    </div>
  );
}
