import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Flame,
  ShieldCheck,
  ShieldAlert,
  Plus,
  Trash2,
  Power,
  RotateCw,
  CheckCircle2,
  RefreshCw,
  Search,
  Filter,
  Globe,
  Lock,
  Radio,
  Server,
  Ban,
  ArrowUpRight,
  ArrowDownLeft,
  SlidersHorizontal,
  Info,
  ExternalLink,
  Zap,
  Layers,
  X,
  ShieldOff,
  Copy
} from 'lucide-react';
import { firewallStatus, firewallRules, firewallAddRule, firewallDeleteRule, firewallToggle, sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface FirewallRule {
  id: string;
  number: number;
  port: string;
  proto: 'TCP' | 'UDP' | 'BOTH';
  action: 'ALLOW' | 'DENY';
  source: string;
  comment: string;
}

interface BannedIP {
  ip: string;
  jail: string;
  failures: number;
  bannedAt: string;
}

interface ListeningPort {
  port: string;
  proto: string;
  process: string;
  isAllowedInFirewall: boolean;
}

export default function FirewallManager() {
  const [enabled, setEnabled] = useState(true);
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'rules' | 'listening' | 'banned'>('rules');
  const [searchFilter, setSearchFilter] = useState('');
  
  // Quick Presets Modal
  const [showAdd, setShowAdd] = useState(false);
  const [newRule, setNewRule] = useState<{
    port: string;
    proto: 'TCP' | 'UDP' | 'BOTH';
    action: 'ALLOW' | 'DENY';
    source: string;
    comment: string;
  }>({
    port: '',
    proto: 'TCP',
    action: 'ALLOW',
    source: 'Anywhere',
    comment: ''
  });
  const [ruleError, setRuleError] = useState<string | null>(null);

  // Fail2ban / Banned Attackers
  const [bannedList, setBannedList] = useState<BannedIP[]>([]);
  const [unbanningIp, setUnbanningIp] = useState<string | null>(null);

  // Listening ports from server (ss -tulpn)
  const [listeningPorts, setListeningPorts] = useState<ListeningPort[]>([]);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const loadFirewall = useCallback(async () => {
    setLoading(true);
    try {
      const [statusStr, rList] = await Promise.all([
        firewallStatus(activeConnId),
        firewallRules(activeConnId)
      ]);

      setEnabled(statusStr.toLowerCase().includes('active'));

      if (rList && Array.isArray(rList)) {
        setRules(rList.map((r: any, idx: number) => ({
          id: String(r.number || idx + 1),
          number: r.number || idx + 1,
          port: String(r.to_port || r.port || 'Any'),
          proto: (r.protocol || 'TCP').toUpperCase() as any,
          action: (r.action || 'ALLOW').toUpperCase() as any,
          source: r.from_ip || r.source || 'Anywhere',
          comment: r.comment || ''
        })));
      }

      // Also query live listening ports from server
      try {
        const portsRes = await sshExec(activeConnId, 'ss -tulpn | grep LISTEN');
        if (portsRes.exit_code === 0 && portsRes.stdout.trim()) {
          const lines = portsRes.stdout.trim().split('\n');
          const parsed = lines.map(line => {
            const parts = line.split(/\s+/);
            const addr = parts[4] || '';
            const port = addr.split(':').pop() || '';
            const proc = (parts[6] || '').replace(/.*users:\(\("([^"]+)".*/, '$1') || 'process';
            return {
              port,
              proto: parts[0] || 'tcp',
              process: proc,
              isAllowedInFirewall: false
            };
          }).filter(p => p.port && !isNaN(Number(p.port)));
          
          if (parsed.length > 0) {
            setListeningPorts(parsed);
          }
        }
      } catch {
        // Fallback to static mock ports
      }
    } catch (err) {
      console.warn('Failed to load firewall:', err);
    } finally {
      setLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadFirewall();
  }, [loadFirewall]);

  const handleToggle = async () => {
    const nextState = !enabled;
    try {
      await firewallToggle(activeConnId, nextState);
      setEnabled(nextState);
    } catch (err) {
      console.warn('Failed to toggle firewall:', err);
    }
  };

  const deleteRule = async (ruleNum: number) => {
    try {
      await firewallDeleteRule(activeConnId, ruleNum);
      await loadFirewall();
    } catch (err) {
      console.warn('Failed to delete rule:', err);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRule.port) return;
    setRuleError(null);
    try {
      await firewallAddRule(activeConnId, newRule.port, newRule.proto.toLowerCase(), newRule.action.toLowerCase());
      setShowAdd(false);
      setRuleError(null);
      setNewRule({ port: '', proto: 'TCP', action: 'ALLOW', source: 'Anywhere', comment: '' });
      await loadFirewall();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setRuleError(msg);
      console.warn('Failed to add rule:', err);
    }
  };

  const handleQuickAllow = async (port: string, proto: 'TCP' | 'UDP', comment: string) => {
    try {
      await firewallAddRule(activeConnId, port, proto.toLowerCase(), 'allow');
      await loadFirewall();
    } catch (err) {
      console.warn('Failed to quick-add rule:', err);
    }
  };

  const handleUnban = async (ip: string) => {
    setUnbanningIp(ip);
    try {
      await sshExec(activeConnId, `sudo fail2ban-client set sshd unbanip ${ip}`);
      setBannedList(prev => prev.filter(b => b.ip !== ip));
    } catch (err) {
      console.warn('Failed to unban IP:', err);
    } finally {
      setUnbanningIp(null);
    }
  };

  // Quick preset buttons for web & dev services
  const presets = [
    { label: 'SSH (22)', port: '22', proto: 'TCP' as const },
    { label: 'Web (80, 443)', port: '80,443', proto: 'TCP' as const },
    { label: 'MySQL (3306)', port: '3306', proto: 'TCP' as const },
    { label: 'Postgres (5432)', port: '5432', proto: 'TCP' as const },
    { label: 'Node (3000)', port: '3000', proto: 'TCP' as const },
    { label: 'Vite (5173)', port: '5173', proto: 'TCP' as const },
    { label: 'Redis (6379)', port: '6379', proto: 'TCP' as const }
  ];

  const filteredRules = useMemo(() => {
    if (!searchFilter.trim()) return rules;
    const q = searchFilter.toLowerCase();
    return rules.filter(r =>
      r.port.toLowerCase().includes(q) ||
      r.comment.toLowerCase().includes(q) ||
      r.source.toLowerCase().includes(q) ||
      r.proto.toLowerCase().includes(q)
    );
  }, [rules, searchFilter]);

  const allowCount = rules.filter(r => r.action === 'ALLOW').length;
  const denyCount = rules.filter(r => r.action === 'DENY').length;

  return (
    <div className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] font-sans antialiased overflow-hidden select-none relative ${loading ? 'cursor-mac-wait' : ''}`}>
      {loading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-30 pointer-events-none" />
      )}
      {/* Top macOS Acrylic Status Hero */}
      <div className="p-4 bg-[#14141e]/90 backdrop-blur-xl border-b border-white/[0.08] shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Status Badge & Title */}
          <div className="flex items-center space-x-3.5">
            <div
              className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-lg transition-all ${
                enabled
                  ? 'bg-gradient-to-tr from-emerald-600 to-teal-500 shadow-emerald-500/20 text-white'
                  : 'bg-gradient-to-tr from-rose-600 to-red-500 shadow-rose-500/20 text-white'
              }`}
            >
              {enabled ? <ShieldCheck className="w-6 h-6 animate-pulse" /> : <ShieldAlert className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="font-bold text-base text-white tracking-tight">Little Snitch Firewall Studio</h1>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    enabled
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                  }`}
                >
                  {enabled ? 'Protected' : 'Firewall Disabled'}
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                {enabled
                  ? 'Active packet filtering enabled. Incoming connections rejected unless explicitly permitted.'
                  : 'Warning: Firewall is inactive. All open network ports are directly exposed to the internet.'}
              </p>
            </div>
          </div>

          {/* Quick Controls */}
          <div className="flex items-center space-x-2">
            <button
              onClick={loadFirewall}
              disabled={loading}
              title="Refresh Firewall Rules"
              className="p-2 bg-[#1e1e2e] hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 hover:text-white transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
            </button>

            {/* macOS Style Toggle Slider */}
            <button
              onClick={handleToggle}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-sm ${
                enabled
                  ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30'
                  : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              <span>{enabled ? 'Turn Off' : 'Turn On'}</span>
            </button>

            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center space-x-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs px-3.5 py-1.5 rounded-xl font-medium shadow-md shadow-blue-500/25 transition-all active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Rule</span>
            </button>
          </div>
        </div>

        {/* 1-Click Quick Allow Presets Bar */}
        <div className="mt-3.5 pt-3 border-t border-white/[0.06] flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-400" /> Quick Allow:
          </span>
          {presets.map(p => (
            <button
              key={p.label}
              onClick={() => handleQuickAllow(p.port, p.proto, `Quick Allow ${p.label}`)}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/5 hover:border-white/20 transition-all shrink-0 text-xs flex items-center gap-1.5 group"
            >
              <Plus className="w-3 h-3 text-emerald-400 group-hover:scale-125 transition-transform" />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Navigation Sub-Tabs & Filter Bar */}
      <div className="h-10 bg-[#1e1e2e]/90 backdrop-blur-md border-b border-white/[0.08] px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'rules'
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Rules ({rules.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('listening')}
            className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'listening'
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Listening Ports ({listeningPorts.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('banned')}
            className={`px-3 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'banned'
                ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Ban className="w-3.5 h-3.5" />
            <span>Banned Attackers ({bannedList.length})</span>
          </button>
        </div>

        {/* Search Rules Filter */}
        <div className="flex items-center space-x-3 text-xs">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2" />
            <input
              type="text"
              placeholder="Filter rules..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              className="bg-[#11111b] border border-white/10 rounded-lg pl-7 pr-3 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/80 w-44"
            />
          </div>
          <div className="hidden sm:flex items-center space-x-2 text-[11px] text-gray-400">
            <span className="text-emerald-400 font-medium">{allowCount} Allowed</span>
            <span>•</span>
            <span className="text-rose-400 font-medium">{denyCount} Denied</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto bg-[#181825] p-3">
        {/* Tab 1: Rules Table */}
        {activeTab === 'rules' && (
          <div className="bg-[#1e1e2e]/90 rounded-xl border border-white/[0.08] overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0">
                <tr>
                  <th className="py-2.5 px-3 text-center w-12 text-gray-500 font-normal">#</th>
                  <th className="py-2.5 px-3 font-semibold text-gray-300">Port / Service</th>
                  <th className="py-2.5 px-3 font-semibold text-gray-300">Protocol</th>
                  <th className="py-2.5 px-3 font-semibold text-gray-300">Action</th>
                  <th className="py-2.5 px-3 font-semibold text-gray-300">Source Host</th>
                  <th className="py-2.5 px-3 font-semibold text-gray-300">Comment / Service</th>
                  <th className="py-2.5 px-3 text-right font-semibold text-gray-300">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredRules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-gray-500">
                      {loading ? (
                        <div className="flex items-center justify-center space-x-2">
                          <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                          <span>Scanning server firewall rules...</span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="font-semibold text-gray-400">No matching firewall rules found</p>
                          <p className="text-xs text-gray-600">Use the Quick Allow bar above or click "New Rule".</p>
                        </div>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredRules.map(rule => (
                    <tr key={rule.id} className="hover:bg-white/[0.02] transition-colors group">
                      <td className="py-2.5 px-3 font-mono text-gray-500 text-center">{rule.number}</td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-white">
                        <span className="bg-white/5 px-2 py-0.5 rounded border border-white/10">
                          {rule.port}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="text-[11px] font-mono uppercase text-gray-400">
                          {rule.proto}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase inline-flex items-center gap-1 ${
                            rule.action === 'ALLOW'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                          }`}
                        >
                          {rule.action === 'ALLOW' ? <ArrowDownLeft className="w-2.5 h-2.5" /> : <Ban className="w-2.5 h-2.5" />}
                          {rule.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-gray-300">
                        {rule.source === 'Anywhere' ? (
                          <span className="text-gray-400 flex items-center gap-1">
                            <Globe className="w-3 h-3 text-blue-400" /> Anywhere
                          </span>
                        ) : (
                          rule.source
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-gray-400">
                        {rule.comment || <span className="text-gray-600 italic">No description</span>}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => deleteRule(rule.number)}
                          title="Delete Rule"
                          className="p-1 rounded-lg hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 2: Listening Ports */}
        {activeTab === 'listening' && (
          <div className="bg-[#1e1e2e]/90 rounded-xl border border-white/[0.08] overflow-hidden p-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-xs font-semibold text-white">Active Server Listening Sockets</h3>
                <p className="text-[11px] text-gray-400">Processes currently bound to network ports on this Linux host.</p>
              </div>
            </div>
            {listeningPorts.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                <Radio className="w-8 h-8 mx-auto text-gray-600 mb-2" />
                <p className="font-semibold text-gray-400">No active listening sockets discovered</p>
                <p className="text-xs text-gray-600 mt-1">Click the refresh button above to query network ports via SSH.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {listeningPorts.map(p => (
                  <div key={p.port} className="p-3 bg-[#11111b] border border-white/[0.06] rounded-xl flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                        <Radio className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-mono text-xs font-bold text-white">
                          Port {p.port} <span className="text-[10px] text-gray-500 font-normal uppercase">({p.proto})</span>
                        </div>
                        <div className="text-[11px] text-gray-400">Process: <span className="text-emerald-400 font-mono">{p.process}</span></div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleQuickAllow(p.port, 'TCP', `Allow ${p.process}`)}
                      className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
                    >
                      Allow
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Banned Attackers */}
        {activeTab === 'banned' && (
          <div className="bg-[#1e1e2e]/90 rounded-xl border border-white/[0.08] overflow-hidden p-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-xs font-semibold text-white">Fail2ban Intrusion Prevention Jail</h3>
                <p className="text-[11px] text-gray-400">Malicious IPs temporarily or permanently banned due to repeated failed logins.</p>
              </div>
            </div>
            {bannedList.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                <ShieldCheck className="w-8 h-8 mx-auto text-emerald-500/60 mb-2" />
                <p className="font-semibold text-gray-400">No attacker IPs currently jailed by fail2ban</p>
                <p className="text-xs text-gray-600 mt-1">Your server is secure and has zero active IP bans.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {bannedList.map(b => (
                  <div key={b.ip} className="p-3 bg-[#11111b] border border-white/[0.06] rounded-xl flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                        <Ban className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-mono text-xs font-bold text-rose-300 flex items-center gap-2">
                          <span>{b.ip}</span>
                          <span className="text-[9px] bg-rose-500/20 px-1.5 py-0.2 rounded font-normal uppercase">{b.jail}</span>
                        </div>
                        <div className="text-[10px] text-gray-500">
                          {b.failures} failed attempts • Banned {b.bannedAt}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnban(b.ip)}
                      disabled={unbanningIp === b.ip}
                      className="px-3 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {unbanningIp === b.ip ? 'Unbanning...' : 'Unban IP'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* macOS Sheet Modal for Adding Rule */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleAdd}
            className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-md p-5 space-y-4 shadow-2xl relative"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
              <div className="flex items-center space-x-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <h3 className="font-bold text-sm text-white">Create Firewall Rule</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="text-gray-400 hover:text-white p-1 rounded-md hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-gray-400 block mb-1 font-medium">Port / Port Range</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 8080 or 8000:8010"
                    value={newRule.port}
                    onChange={e => setNewRule({ ...newRule, port: e.target.value })}
                    className="w-full bg-[#11111b] border border-white/10 rounded-lg px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-blue-500/80"
                  />
                </div>
                <div>
                  <label className="text-gray-400 block mb-1 font-medium">Protocol</label>
                  <select
                    value={newRule.proto}
                    onChange={e => setNewRule({ ...newRule, proto: e.target.value as any })}
                    className="w-full bg-[#11111b] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500/80"
                  >
                    <option value="TCP">TCP</option>
                    <option value="UDP">UDP</option>
                    <option value="BOTH">BOTH</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-gray-400 block mb-1 font-medium">Action</label>
                <select
                  value={newRule.action}
                  onChange={e => setNewRule({ ...newRule, action: e.target.value as any })}
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500/80"
                >
                  <option value="ALLOW">ALLOW (Accept traffic)</option>
                  <option value="DENY">DENY (Silently drop packet)</option>
                </select>
              </div>

              <div>
                <label className="text-gray-400 block mb-1 font-medium">Allowed Source IP / Subnet</label>
                <input
                  type="text"
                  value={newRule.source}
                  onChange={e => setNewRule({ ...newRule, source: e.target.value })}
                  placeholder="Anywhere or 192.168.1.0/24"
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-blue-500/80"
                />
              </div>

              <div>
                <label className="text-gray-400 block mb-1 font-medium">Description / Service Tag</label>
                <input
                  type="text"
                  value={newRule.comment}
                  onChange={e => setNewRule({ ...newRule, comment: e.target.value })}
                  placeholder="e.g. Staging Web Server"
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-2.5 py-1.5 text-white focus:outline-none focus:border-blue-500/80"
                />
              </div>
            </div>

            {ruleError && (
              <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5 animate-in fade-in duration-150">
                <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 font-mono text-[11px] leading-relaxed break-words">{ruleError}</div>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={() => { setShowAdd(false); setRuleError(null); }}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium shadow-md shadow-blue-500/30 transition-all active:scale-95"
              >
                Add Rule
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
