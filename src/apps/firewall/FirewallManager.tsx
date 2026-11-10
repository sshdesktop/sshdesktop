import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Flame, ShieldCheck, ShieldAlert, Plus, Trash2, Power, RotateCw,
  CheckCircle2, RefreshCw, Search, Filter, Globe, Lock, Radio, Server,
  Ban, ArrowUpRight, ArrowDownLeft, SlidersHorizontal, Info, ExternalLink,
  Zap, Layers, X, ShieldOff, Copy, AlertTriangle, AlertCircle, Edit,
  Shield, Check, Wrench, DownloadCloud
} from 'lucide-react';
import {
  firewallDetectBackend, firewallRules, firewallAddRuleAdvanced,
  firewallDeleteRuleAdvanced, firewallToggle, firewallInstall,
  firewallReset, firewallReload, sshExec,
  FirewallStatusInfo, FirewallRuleItem, AddRuleRequest
} from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';
import { useUserPrivilege } from '../../lib/permissions';
import PermissionAlertBanner from '../../components/PermissionAlertBanner';
import PermissionAlertModal from '../../components/PermissionAlertModal';

// Subcomponents and Modals
import FirewallContextMenu from './components/FirewallContextMenu';
import FirewalldZoneManager from './components/FirewalldZoneManager';
import AddRuleModal from './modals/AddRuleModal';
import DeleteRuleModal from './modals/DeleteRuleModal';
import PolicyModal from './modals/PolicyModal';

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
  const [statusInfo, setStatusInfo] = useState<FirewallStatusInfo>({
    backend: 'ufw',
    installed: true,
    active: true,
    ufw_installed: true,
    ufw_active: true,
    firewalld_installed: false,
    firewalld_active: false,
    default_incoming: 'deny',
    default_outgoing: 'allow',
    default_routed: 'disabled',
    all_zones: [],
    raw_status: '',
  });

  const [activeBackend, setActiveBackend] = useState<'ufw' | 'firewalld'>('ufw');
  const [rules, setRules] = useState<FirewallRuleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'rules' | 'zones' | 'listening' | 'banned'>('rules');
  const [searchFilter, setSearchFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<'ALL' | 'ALLOW' | 'DENY'>('ALL');
  const [toastMessage, setToastMessage] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Modals & Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rule: FirewallRuleItem } | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingRule, setEditingRule] = useState<FirewallRuleItem | null>(null);
  const [deletingRule, setDeletingRule] = useState<FirewallRuleItem | null>(null);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [installingTool, setInstallingTool] = useState<string | null>(null);

  // Fail2ban / Banned Attackers
  const [bannedList, setBannedList] = useState<BannedIP[]>([]);
  const [unbanningIp, setUnbanningIp] = useState<string | null>(null);

  // Listening ports from server (ss -tulpn)
  const [listeningPorts, setListeningPorts] = useState<ListeningPort[]>([]);
  const [restrictedAction, setRestrictedAction] = useState<string | null>(null);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { hasSudo, isRoot, username } = useUserPrivilege();

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToastMessage({ message, type });
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Load firewall backend and status
  const loadFirewall = useCallback(async () => {
    setLoading(true);
    try {
      const [detected, rList] = await Promise.all([
        firewallDetectBackend(activeConnId).catch((): FirewallStatusInfo => ({
          backend: 'ufw',
          installed: false,
          active: false,
          ufw_installed: false,
          ufw_active: false,
          firewalld_installed: false,
          firewalld_active: false,
          default_incoming: 'deny',
          default_outgoing: 'allow',
          default_routed: 'disabled',
          all_zones: [],
          raw_status: '',
        })),
        firewallRules(activeConnId).catch(() => [])
      ]);

      setStatusInfo(detected);
      if (detected.backend === 'firewalld' || detected.backend === 'ufw') {
        setActiveBackend(detected.backend as any);
      }

      setRules(rList);

      // Query live listening ports from server
      try {
        const portsRes = await sshExec(activeConnId, 'ss -tulpn 2>/dev/null | grep LISTEN');
        if (portsRes.exit_code === 0 && portsRes.stdout.trim()) {
          const lines = portsRes.stdout.trim().split('\n');
          const parsed = lines.map(line => {
            const parts = line.split(/\s+/);
            const proto = (parts[0] || 'tcp').toLowerCase();
            const addr = parts[4] || '';
            const port = addr.split(':').pop() || '';
            const proc = (parts[6] || '').replace(/.*users:\(\("([^"]+)".*/, '$1') || 'process';
            const isAllowed = rList.some(r => r.to_port === port && r.action === 'ALLOW');
            return {
              port,
              proto,
              process: proc,
              isAllowedInFirewall: isAllowed
            };
          }).filter(p => p.port && !isNaN(Number(p.port)));

          // Deduplicate
          const uniquePorts = Array.from(new Map(parsed.map(p => [`${p.port}-${p.proto}`, p])).values());
          setListeningPorts(uniquePorts);
        }
      } catch {
        // Fallback
      }

      // Query Fail2ban status
      try {
        const f2bRes = await sshExec(activeConnId, 'sudo fail2ban-client status sshd 2>/dev/null || fail2ban-client status sshd 2>/dev/null');
        if (f2bRes.stdout && f2bRes.stdout.includes('Banned IP list:')) {
          const bannedLine = f2bRes.stdout.split('Banned IP list:')[1] || '';
          const ips = bannedLine.trim().split(/\s+/).filter(ip => ip.length > 0);
          setBannedList(ips.map(ip => ({
            ip,
            jail: 'sshd',
            failures: 5,
            bannedAt: new Date().toLocaleTimeString(),
          })));
        }
      } catch {
        // Fallback
      }
    } catch (err: any) {
      console.warn('Failed to load firewall:', err);
    } finally {
      setLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadFirewall();
  }, [loadFirewall]);

  // Toggle firewall power
  const handleToggle = async () => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction('Toggle Firewall Power State');
      return;
    }
    const nextState = !statusInfo.active;

    // Safety check: if enabling firewall without SSH port 22 allowed, warn user
    if (nextState) {
      const hasSsh = rules.some(r => (r.to_port === '22' || r.to_port.toLowerCase() === 'ssh') && r.action === 'ALLOW');
      if (!hasSsh) {
        const confirmEnable = window.confirm(
          'Warning: SSH port 22 is not explicitly allowed in your rules list! Enabling the firewall might lock you out of this SSH session. Would you like to automatically allow SSH (22/tcp) first?'
        );
        if (confirmEnable) {
          try {
            await firewallAddRuleAdvanced(activeConnId, {
              port: '22',
              protocol: 'tcp',
              action: 'allow',
              direction: 'in',
              backend: activeBackend,
              comment: 'SSH remote management',
            });
            showToast('Allowed SSH port 22/tcp before enabling firewall.');
          } catch (e) {
            console.warn(e);
          }
        }
      }
    }

    try {
      const res = await firewallToggle(activeConnId, nextState);
      showToast(res || `Firewall is now ${nextState ? 'enabled' : 'disabled'}.`);
      loadFirewall();
    } catch (err: any) {
      showToast(err?.message || String(err), 'error');
    }
  };

  // Toggle rule action (Allow <-> Deny)
  const handleToggleRuleAction = async (rule: FirewallRuleItem) => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction('Modify Firewall Rule');
      return;
    }
    const newAct = rule.action === 'ALLOW' ? 'deny' : 'allow';
    try {
      // Delete old and add new
      await firewallDeleteRuleAdvanced(activeConnId, rule.number, rule.to_port, rule.protocol, activeBackend, rule.zone);
      await firewallAddRuleAdvanced(activeConnId, {
        port: rule.to_port,
        protocol: rule.protocol.toLowerCase(),
        action: newAct,
        direction: rule.direction.toLowerCase(),
        from_ip: rule.from_ip === 'Anywhere' ? undefined : rule.from_ip,
        backend: activeBackend,
        zone: rule.zone,
        comment: rule.comment,
      });
      showToast(`Rule #${rule.number} updated to ${newAct.toUpperCase()}`);
      loadFirewall();
    } catch (err: any) {
      showToast(err?.message || String(err), 'error');
    }
  };

  // Install Firewall Software
  const handleInstallFirewall = async (tool: 'ufw' | 'firewalld') => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Install ${tool.toUpperCase()} Firewall`);
      return;
    }
    setInstallingTool(tool);
    try {
      const res = await firewallInstall(activeConnId, tool);
      showToast(res || `${tool.toUpperCase()} installed successfully!`);
      loadFirewall();
    } catch (err: any) {
      showToast(err?.message || String(err), 'error');
    } finally {
      setInstallingTool(null);
    }
  };

  // Reload rules
  const handleReload = async () => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction('Reload Firewall');
      return;
    }
    try {
      const res = await firewallReload(activeConnId);
      showToast(res || 'Firewall reloaded successfully.');
      loadFirewall();
    } catch (err: any) {
      showToast(err?.message || String(err), 'error');
    }
  };

  // Reset firewall
  const handleReset = async () => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction('Reset Firewall');
      return;
    }
    try {
      const res = await firewallReset(activeConnId);
      showToast(res || 'Firewall reset to default.');
      setShowResetConfirm(false);
      loadFirewall();
    } catch (err: any) {
      showToast(err?.message || String(err), 'error');
    }
  };

  // Quick allow port
  const handleQuickAllow = async (port: string, proto: string = 'tcp', comment: string = '') => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Allow Port ${port}/${proto}`);
      return;
    }
    try {
      await firewallAddRuleAdvanced(activeConnId, {
        port,
        protocol: proto.toLowerCase(),
        action: 'allow',
        direction: 'in',
        backend: activeBackend,
        comment,
      });
      showToast(`Allowed port ${port}/${proto}`);
      loadFirewall();
    } catch (err: any) {
      showToast(err?.message || String(err), 'error');
    }
  };

  // Unban Fail2ban IP
  const handleUnban = async (ip: string) => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction(`Unban IP ${ip}`);
      return;
    }
    setUnbanningIp(ip);
    try {
      await sshExec(activeConnId, `sudo fail2ban-client set sshd unbanip ${ip}`);
      setBannedList(prev => prev.filter(b => b.ip !== ip));
      showToast(`Unbanned IP: ${ip}`);
    } catch (err: any) {
      showToast(err?.message || String(err), 'error');
    } finally {
      setUnbanningIp(null);
    }
  };

  // Filtered rules
  const filteredRules = useMemo(() => {
    return rules.filter(r => {
      if (actionFilter !== 'ALL' && r.action !== actionFilter) return false;
      if (searchFilter.trim()) {
        const query = searchFilter.toLowerCase();
        return (
          r.to_port.toLowerCase().includes(query) ||
          r.protocol.toLowerCase().includes(query) ||
          r.from_ip.toLowerCase().includes(query) ||
          r.comment.toLowerCase().includes(query) ||
          String(r.number).includes(query)
        );
      }
      return true;
    });
  }, [rules, actionFilter, searchFilter]);

  const hasSshRule = rules.some(r => (r.to_port === '22' || r.to_port.toLowerCase() === 'ssh') && r.action === 'ALLOW');

  return (
    <div className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none font-sans overflow-hidden relative ${loading ? 'cursor-mac-wait' : ''}`}>
      {loading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-30 pointer-events-none" />
      )}

      {/* Top Header Toolbar */}
      <div className="h-14 bg-[#14141e]/90 backdrop-blur-xl border-b border-white/10 px-4 flex items-center justify-between shrink-0 gap-3 overflow-x-auto scrollbar-thin">
        {/* Left: Backend status & switcher */}
        <div className="flex items-center space-x-3 shrink-0">
          <div className="flex items-center space-x-2">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
              !statusInfo.installed
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                : statusInfo.active
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
            }`}>
              <Flame className="w-4 h-4" />
            </div>

            <div>
              <div className="flex items-center space-x-2">
                <span className="text-xs font-bold text-white">Firewall Manager</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase inline-flex items-center space-x-1 ${
                  !statusInfo.installed
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                    : statusInfo.active
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${!statusInfo.installed ? 'bg-amber-400' : statusInfo.active ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                  <span>{!statusInfo.installed ? 'Not Installed' : statusInfo.active ? 'Active' : 'Disabled'}</span>
                </span>
              </div>
              <div className="text-[10px] text-gray-400 font-mono">
                Engine: <strong className="text-white uppercase">{activeBackend}</strong> • Incoming: <strong className="text-blue-300 uppercase">{statusInfo.default_incoming}</strong>
              </div>
            </div>
          </div>

          {/* Backend Selector (UFW vs Firewalld) */}
          {(statusInfo.ufw_installed || statusInfo.firewalld_installed) && (
            <div className="flex items-center space-x-1 bg-black/40 p-1 rounded-xl border border-white/10 ml-2">
              {statusInfo.ufw_installed && (
                <button
                  onClick={() => { setActiveBackend('ufw'); loadFirewall(); }}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold font-mono transition-all ${
                    activeBackend === 'ufw'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  UFW
                </button>
              )}
              {statusInfo.firewalld_installed && (
                <button
                  onClick={() => { setActiveBackend('firewalld'); loadFirewall(); }}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold font-mono transition-all ${
                    activeBackend === 'firewalld'
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Firewalld
                </button>
              )}
            </div>
          )}
        </div>

        {/* Center: Tabs */}
        <div className="flex items-center space-x-1 bg-black/40 p-1 rounded-xl border border-white/10 shrink-0">
          <button
            onClick={() => setActiveTab('rules')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'rules' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            Rules ({rules.length})
          </button>

          {activeBackend === 'firewalld' && (
            <button
              onClick={() => setActiveTab('zones')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'zones' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              Zones
            </button>
          )}

          <button
            onClick={() => setActiveTab('listening')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'listening' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            Listening Ports ({listeningPorts.length})
          </button>

          <button
            onClick={() => setActiveTab('banned')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'banned' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'
            }`}
          >
            Fail2ban ({bannedList.length})
          </button>
        </div>

        {/* Right Actions: Power switch, Reload, Policy */}
        <div className="flex items-center space-x-2 shrink-0">
          {statusInfo.installed && (
            <>
              {/* Power Toggle Button */}
              <button
                onClick={handleToggle}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all ${
                  statusInfo.active
                    ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
                title={statusInfo.active ? 'Disable Firewall' : 'Enable Firewall'}
              >
                <Power className="w-3.5 h-3.5" />
                <span>{statusInfo.active ? 'Turn Off' : 'Turn On'}</span>
              </button>

              {/* Reload Button */}
              <button
                onClick={handleReload}
                className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition-colors"
                title="Reload firewall rules"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>

              {/* Policy Settings Button */}
              <button
                onClick={() => {
                  if (!hasSudo && !isRoot) {
                    setRestrictedAction('Configure Default Policies');
                    return;
                  }
                  setShowPolicyModal(true);
                }}
                className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition-colors"
                title="Configure default policies"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <button
            onClick={loadFirewall}
            disabled={loading}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border border-white/10 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <PermissionAlertBanner appName="Firewall Manager" />
        {/* Toast Notification */}
        {toastMessage && (
          <div className={`p-3 rounded-2xl text-xs flex items-center space-x-2 animate-in fade-in duration-200 ${
            toastMessage.type === 'error'
              ? 'bg-rose-500/20 border border-rose-500/40 text-rose-300'
              : 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
          }`}>
            {toastMessage.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>{toastMessage.message}</span>
          </div>
        )}

        {/* ========================================================= */}
        {/* ALERT BANNER: NOT INSTALLED                               */}
        {/* ========================================================= */}
        {!statusInfo.installed && (
          <div className="p-6 bg-amber-500/10 border border-amber-500/30 rounded-3xl space-y-4 shadow-xl">
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-white">Firewall Software Not Installed</h3>
                <p className="text-xs text-amber-200/90 leading-relaxed">
                  Neither <strong className="font-mono text-white">UFW</strong> (Uncomplicated Firewall) nor <strong className="font-mono text-white">Firewalld</strong> is currently installed on this server. Without a firewall, incoming ports are unfiltered.
                </p>
                <p className="text-xs text-gray-400">
                  Select a firewall engine below to install it with 1-click via the server's native package manager:
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                onClick={() => handleInstallFirewall('ufw')}
                disabled={installingTool !== null}
                className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-2"
              >
                {installingTool === 'ufw' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="w-3.5 h-3.5" />
                )}
                <span>Install UFW (Recommended for Ubuntu/Debian)</span>
              </button>

              <button
                onClick={() => handleInstallFirewall('firewalld')}
                disabled={installingTool !== null}
                className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-2"
              >
                {installingTool === 'firewalld' ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <DownloadCloud className="w-3.5 h-3.5" />
                )}
                <span>Install Firewalld (Recommended for RHEL/CentOS/Fedora)</span>
              </button>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* ALERT BANNER: INSTALLED BUT INACTIVE                      */}
        {/* ========================================================= */}
        {statusInfo.installed && !statusInfo.active && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-3xl flex flex-wrap items-center justify-between gap-4 shadow-lg">
            <div className="flex items-center space-x-3.5">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                <ShieldOff className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Firewall Service is Currently Inactive</h4>
                <p className="text-xs text-rose-200/80 mt-0.5">
                  Your server is unprotected from unauthorized network scans and connections.
                  {!hasSshRule && ' (Warning: Ensure SSH port 22 is allowed before enabling!)'}
                </p>
              </div>
            </div>

            <button
              onClick={handleToggle}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-2"
            >
              <Power className="w-3.5 h-3.5" />
              <span>Enable Firewall Protection Now</span>
            </button>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB: RULES LIST                                           */}
        {/* ========================================================= */}
        {activeTab === 'rules' && (
          <div className="space-y-4">
            {/* Filter & Add Rule Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder="Search port, protocol, source, comment..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-xs text-white placeholder-gray-500 font-mono"
                  />
                </div>

                <select
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value as any)}
                  className="px-3 py-1.5 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-xs text-white"
                >
                  <option value="ALL">All Actions</option>
                  <option value="ALLOW">Allow Only</option>
                  <option value="DENY">Deny Only</option>
                </select>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    if (!hasSudo && !isRoot) {
                      setRestrictedAction('Reset Firewall Defaults');
                      return;
                    }
                    setShowResetConfirm(true);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 border border-white/10 transition-colors text-xs"
                  title="Reset firewall to default"
                >
                  Reset Defaults
                </button>

                <button
                  onClick={() => {
                    if (!hasSudo && !isRoot) {
                      setRestrictedAction('Add Firewall Rule');
                      return;
                    }
                    setEditingRule(null);
                    setShowAddModal(true);
                  }}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md active:scale-95 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Rule</span>
                </button>
              </div>
            </div>

            {/* Rules Table */}
            <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-black/30 text-gray-400 border-b border-white/10 font-sans">
                  <tr>
                    <th className="py-3 px-4 w-12">#</th>
                    <th className="py-3 px-4">Port / Service</th>
                    <th className="py-3 px-4">Protocol</th>
                    <th className="py-3 px-4">Action</th>
                    <th className="py-3 px-4">Direction</th>
                    <th className="py-3 px-4">Source IP</th>
                    <th className="py-3 px-4">Comment</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredRules.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-gray-500 font-sans text-xs">
                        {searchFilter ? 'No rules matching query.' : 'No active firewall rules defined. Click "Add Rule" to configure open ports.'}
                      </td>
                    </tr>
                  ) : (
                    filteredRules.map(rule => (
                      <tr
                        key={rule.id || rule.number}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, rule });
                        }}
                        className="hover:bg-white/[0.03] transition-colors group cursor-pointer"
                      >
                        <td className="py-3 px-4 text-gray-500 font-mono text-[11px]">{rule.number}</td>
                        <td className="py-3 px-4 font-bold text-white flex items-center space-x-2">
                          <Flame className={`w-3.5 h-3.5 ${rule.action === 'ALLOW' ? 'text-emerald-400' : 'text-rose-400'}`} />
                          <span>{rule.to_port}</span>
                        </td>
                        <td className="py-3 px-4 uppercase text-purple-300 font-semibold">{rule.protocol}</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-sans font-bold ${
                            rule.action === 'ALLOW'
                              ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                              : rule.action === 'DENY'
                              ? 'bg-rose-500/15 border border-rose-500/30 text-rose-400'
                              : 'bg-amber-500/15 border border-amber-500/30 text-amber-400'
                          }`}>
                            {rule.action}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-gray-300 text-[11px] font-sans">
                          {rule.direction === 'OUT' ? 'Outbound' : 'Inbound'}
                        </td>
                        <td className="py-3 px-4 text-blue-300 truncate max-w-[140px]" title={rule.from_ip}>
                          {rule.from_ip}
                        </td>
                        <td className="py-3 px-4 text-gray-400 text-[11px] truncate max-w-[180px]">
                          {rule.comment || '—'}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end space-x-2">
                            <button
                              onClick={() => {
                                if (!hasSudo && !isRoot) {
                                  setRestrictedAction('Edit Firewall Rule');
                                  return;
                                }
                                setEditingRule(rule);
                                setShowAddModal(true);
                              }}
                              className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                              title="Edit rule"
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                if (!hasSudo && !isRoot) {
                                  setRestrictedAction('Delete Firewall Rule');
                                  return;
                                }
                                setDeletingRule(rule);
                              }}
                              className="p-1 rounded-lg hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors"
                              title="Delete rule"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================= */}
        {/* TAB: FIREWALLD ZONES                                      */}
        {/* ========================================================= */}
        {activeTab === 'zones' && (
          <FirewalldZoneManager
            connId={activeConnId}
            activeZone={statusInfo.active_zone}
            allZones={statusInfo.all_zones}
            onAddRuleClick={() => { setEditingRule(null); setShowAddModal(true); }}
            onRefresh={loadFirewall}
          />
        )}

        {/* ========================================================= */}
        {/* TAB: LISTENING PORTS                                      */}
        {/* ========================================================= */}
        {activeTab === 'listening' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Radio className="w-4 h-4 text-emerald-400" />
                  <span>Live Server Listening Ports</span>
                </h3>
                <p className="text-xs text-gray-400">
                  Processes currently listening for network connections on this host (ss -tulpn)
                </p>
              </div>
            </div>

            <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-black/30 text-gray-400 border-b border-white/10 font-sans">
                  <tr>
                    <th className="py-3 px-4">Port</th>
                    <th className="py-3 px-4">Protocol</th>
                    <th className="py-3 px-4">Process Name</th>
                    <th className="py-3 px-4">Firewall Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {listeningPorts.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-gray-500 font-sans text-xs">
                        No listening ports detected or insufficient permissions.
                      </td>
                    </tr>
                  ) : (
                    listeningPorts.map((lp, idx) => (
                      <tr key={idx} className="hover:bg-white/[0.03] transition-colors">
                        <td className="py-3 px-4 font-bold text-white flex items-center space-x-2">
                          <Zap className="w-3.5 h-3.5 text-blue-400" />
                          <span>{lp.port}</span>
                        </td>
                        <td className="py-3 px-4 uppercase text-purple-300">{lp.proto}</td>
                        <td className="py-3 px-4 text-gray-300 font-sans">{lp.process}</td>
                        <td className="py-3 px-4">
                          {lp.isAllowedInFirewall ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[10px] font-sans font-medium inline-flex items-center space-x-1">
                              <Check className="w-2.5 h-2.5" />
                              <span>Allowed in Firewall</span>
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[10px] font-sans font-medium">
                              Not in Rules List
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {!lp.isAllowedInFirewall && (
                            <button
                              onClick={() => handleQuickAllow(lp.port, lp.proto, `Allow ${lp.process}`)}
                              className="px-3 py-1 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-sans font-medium transition-colors"
                            >
                              Allow In Firewall
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

        {/* ========================================================= */}
        {/* TAB: FAIL2BAN / BANNED ATTACKERS                          */}
        {/* ========================================================= */}
        {activeTab === 'banned' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Ban className="w-4 h-4 text-rose-400" />
                  <span>Fail2ban Banned Attackers</span>
                </h3>
                <p className="text-xs text-gray-400">
                  IP addresses blocked by intrusion prevention daemon due to brute-force authentication failures
                </p>
              </div>
            </div>

            <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl overflow-hidden shadow-xl">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-black/30 text-gray-400 border-b border-white/10 font-sans">
                  <tr>
                    <th className="py-3 px-4">Banned IP Address</th>
                    <th className="py-3 px-4">Protection Jail</th>
                    <th className="py-3 px-4">Failed Attempts</th>
                    <th className="py-3 px-4">Detected At</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {bannedList.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-gray-500 font-sans text-xs">
                        No active IP bans currently recorded by Fail2ban.
                      </td>
                    </tr>
                  ) : (
                    bannedList.map(b => (
                      <tr key={b.ip} className="hover:bg-white/[0.03] transition-colors">
                        <td className="py-3 px-4 font-bold text-rose-300 flex items-center space-x-2">
                          <Ban className="w-3.5 h-3.5 text-rose-400" />
                          <span>{b.ip}</span>
                        </td>
                        <td className="py-3 px-4 text-purple-300">{b.jail}</td>
                        <td className="py-3 px-4 text-gray-300">{b.failures}</td>
                        <td className="py-3 px-4 text-gray-400">{b.bannedAt}</td>
                        <td className="py-3 px-4 text-right">
                          <button
                            onClick={() => handleUnban(b.ip)}
                            disabled={unbanningIp === b.ip}
                            className="px-3 py-1 rounded-xl bg-white/5 hover:bg-white/15 text-emerald-300 text-[11px] font-sans font-medium transition-colors"
                          >
                            {unbanningIp === b.ip ? 'Unbanning...' : 'Unban IP'}
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
      </div>

      {/* ========================================================= */}
      {/* CONTEXT MENU                                              */}
      {/* ========================================================= */}
      {contextMenu && (
        <FirewallContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          rule={contextMenu.rule}
          backend={activeBackend}
          onClose={() => setContextMenu(null)}
          onDelete={(r) => {
            if (!hasSudo && !isRoot) {
              setRestrictedAction('Delete Firewall Rule');
              return;
            }
            setDeletingRule(r);
          }}
          onEdit={(r) => {
            if (!hasSudo && !isRoot) {
              setRestrictedAction('Edit Firewall Rule');
              return;
            }
            setEditingRule(r);
            setShowAddModal(true);
          }}
          onToggleAction={handleToggleRuleAction}
          onTestPort={(r) => {
            const isListening = listeningPorts.some(lp => lp.port === r.to_port);
            showToast(isListening ? `Port ${r.to_port} is listening on the server!` : `Port ${r.to_port} is not currently listening.`);
          }}
        />
      )}

      {/* ========================================================= */}
      {/* MODALS                                                    */}
      {/* ========================================================= */}
      {showAddModal && (
        <AddRuleModal
          connId={activeConnId}
          backend={activeBackend}
          zones={statusInfo.all_zones}
          initialRule={editingRule}
          onClose={() => { setShowAddModal(false); setEditingRule(null); }}
          onSuccess={(msg) => {
            showToast(msg);
            loadFirewall();
          }}
        />
      )}

      {deletingRule && (
        <DeleteRuleModal
          connId={activeConnId}
          rule={deletingRule}
          backend={activeBackend}
          onClose={() => setDeletingRule(null)}
          onSuccess={(msg) => {
            showToast(msg);
            loadFirewall();
          }}
        />
      )}

      {showPolicyModal && (
        <PolicyModal
          connId={activeConnId}
          defaultIncoming={statusInfo.default_incoming}
          defaultOutgoing={statusInfo.default_outgoing}
          onClose={() => setShowPolicyModal(false)}
          onSuccess={(msg) => {
            showToast(msg);
            loadFirewall();
          }}
        />
      )}

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-[#181825]/95 border border-white/20 rounded-3xl max-w-md w-full shadow-2xl p-6 space-y-4">
            <div className="flex items-center space-x-3 pb-3 border-b border-white/10">
              <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Reset Firewall to Default</h3>
                <p className="text-xs text-gray-400">Wipe custom rules and disable firewall</p>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              Are you sure you want to reset <strong className="text-white font-mono">{activeBackend.toUpperCase()}</strong>? All existing custom port allowances and blocklists will be permanently removed.
            </p>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 font-medium transition-colors text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleReset}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold shadow-md active:scale-95 transition-all text-xs"
              >
                Reset Firewall
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permission Denied Alert Modal */}
      <PermissionAlertModal
        isOpen={!!restrictedAction}
        onClose={() => setRestrictedAction(null)}
        actionName={restrictedAction || ''}
        username={username}
        appName="Firewall Manager"
      />
    </div>
  );
}
