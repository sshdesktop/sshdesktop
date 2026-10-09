import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Globe, Radio, Activity, Network as NetworkIcon, Search, Play, 
  CheckCircle2, Shield, RefreshCw, Plus, X, PowerOff, ShieldAlert, Trash2,
  Wifi, ArrowDownUp, HardDrive, Compass, Copy, Terminal, ExternalLink,
  ChevronDown, ChevronUp, AlertCircle, Check, ArrowRight, Zap, Laptop
} from 'lucide-react';
import { 
  networkPorts, networkConnections, systemGetNetwork, networkPing, 
  networkDnsLookup, sshExec, processKill 
} from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';

interface ListeningPort {
  protocol: string;
  port: number;
  bindAddr: string;
  process: string;
  pid: number;
}

interface ActiveConn {
  protocol: string;
  local: string;
  remote: string;
  state: string;
  pid: number;
}

interface InterfaceItem {
  name: string;
  ipv4: string;
  ipv6: string;
  mac: string;
  state: 'UP' | 'DOWN';
  rx: string;
  tx: string;
  rxBytes?: number;
  txBytes?: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  port?: ListeningPort;
  conn?: ActiveConn;
}

export default function NetworkManager() {
  const [tab, setTab] = useState<'interfaces' | 'ports' | 'conns' | 'ping' | 'dns'>('interfaces');
  const [ports, setPorts] = useState<ListeningPort[]>([]);
  const [conns, setConns] = useState<ActiveConn[]>([]);
  const [interfaces, setInterfaces] = useState<InterfaceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  
  // Selected items for macOS selection highlight
  const [selectedPortNum, setSelectedPortNum] = useState<number | null>(null);
  const [selectedConnKey, setSelectedConnKey] = useState<string | null>(null);
  const [selectedIface, setSelectedIface] = useState<string | null>(null);

  // Ping Tool State
  const [pingHost, setPingHost] = useState('8.8.8.8');
  const [pingCount, setPingCount] = useState<number>(4);
  const [pingResults, setPingResults] = useState<string[]>([]);
  const [pinging, setPinging] = useState(false);

  // DNS Lookup Tool State
  const [dnsDomain, setDnsDomain] = useState('google.com');
  const [dnsResults, setDnsResults] = useState<string>('');
  const [dnsLoading, setDnsLoading] = useState(false);

  // Open Port Modal State
  const [showOpenPortModal, setShowOpenPortModal] = useState(false);
  const [newPortNum, setNewPortNum] = useState('');
  const [newPortProto, setNewPortProto] = useState<'tcp' | 'udp'>('tcp');
  const [newPortDesc, setNewPortDesc] = useState('');

  // Notification Toast
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { openApp } = useWindowManager();
  const { runTerminalCommand } = useEditorStore();

  const loadNetworkData = useCallback(async () => {
    setLoading(true);
    try {
      const [pList, cList, ifList] = await Promise.all([
        networkPorts(activeConnId),
        networkConnections(activeConnId),
        systemGetNetwork(activeConnId)
      ]);

      if (pList && Array.isArray(pList)) {
        setPorts(pList.map((p: any) => ({
          protocol: p.protocol || 'tcp',
          port: p.local_port || p.port || 0,
          bindAddr: p.local_addr || p.bindAddr || '0.0.0.0',
          process: p.process_name || p.process || 'system',
          pid: p.pid || 0
        })));
      } else {
        setPorts([]);
      }

      if (cList && Array.isArray(cList)) {
        setConns(cList.map((c: any) => ({
          protocol: (c.protocol || 'TCP').toUpperCase(),
          local: c.local_addr || c.local || '',
          remote: c.remote_addr || c.remote || '',
          state: c.state || 'ESTABLISHED',
          pid: c.pid || 0
        })));
      } else {
        setConns([]);
      }

      if (ifList && Array.isArray(ifList)) {
        setInterfaces(ifList.map((i: any) => ({
          name: i.name,
          ipv4: i.ip || '—',
          ipv6: 'fe80::/64',
          mac: i.mac || '—',
          state: 'UP',
          rx: `${((i.rx_bytes || 0) / (1024 * 1024)).toFixed(1)} MB`,
          tx: `${((i.tx_bytes || 0) / (1024 * 1024)).toFixed(1)} MB`,
          rxBytes: i.rx_bytes || 0,
          txBytes: i.tx_bytes || 0,
        })));
      } else {
        setInterfaces([]);
      }
    } catch (err) {
      console.warn('Failed to load network stats:', err);
    } finally {
      setLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadNetworkData();
  }, [loadNetworkData]);

  // Close context menu on window click
  useEffect(() => {
    const handleClose = () => setContextMenu(null);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, []);

  const handleOpenPort = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPortNum.trim()) return;
    try {
      await sshExec(activeConnId, `sudo ufw allow ${newPortNum.trim()}/${newPortProto} comment "${newPortDesc || 'CloudDesk'}" || ufw allow ${newPortNum.trim()}/${newPortProto}`);
      setShowOpenPortModal(false);
      setNewPortNum('');
      setNewPortDesc('');
      setNotice({ text: `Port ${newPortNum.trim()}/${newPortProto} allowed in firewall.`, isError: false });
      setTimeout(() => setNotice(null), 3500);
      await loadNetworkData();
    } catch (err: any) {
      setNotice({ text: `Failed to open port: ${err?.message || err}`, isError: true });
    }
  };

  const handleClosePort = async (port: number, protocol: string) => {
    setContextMenu(null);
    if (!confirm(`Block / close port ${port}/${protocol} in server firewall (UFW)?`)) return;
    try {
      await sshExec(activeConnId, `sudo ufw deny ${port}/${protocol} || ufw deny ${port}/${protocol}`);
      setNotice({ text: `Port ${port}/${protocol} blocked in firewall.`, isError: false });
      setTimeout(() => setNotice(null), 3500);
      await loadNetworkData();
    } catch (err: any) {
      setNotice({ text: `Failed to block port: ${err?.message || err}`, isError: true });
    }
  };

  const handleKillPortProcess = async (pid: number, port: number) => {
    setContextMenu(null);
    if (!confirm(`Terminate process PID ${pid} listening on port ${port}?`)) return;
    try {
      await processKill(activeConnId, pid, 'KILL');
      setNotice({ text: `Process PID ${pid} terminated.`, isError: false });
      setTimeout(() => setNotice(null), 3500);
      await loadNetworkData();
    } catch (err: any) {
      setNotice({ text: `Failed to kill process: ${err?.message || err}`, isError: true });
    }
  };

  const runPing = async () => {
    if (!pingHost.trim()) return;
    setPinging(true);
    setPingResults([`PING ${pingHost} (${pingCount} packets) from Linux server...`]);
    try {
      const res = await sshExec(activeConnId, `ping -c ${pingCount} ${pingHost.trim()}`);
      const output = res.stdout || res.stderr || 'No response.';
      const lines = output.split('\n').filter(Boolean);
      setPingResults(lines);
    } catch (err: any) {
      setPingResults([`Ping failed: ${err?.message || err}`]);
    } finally {
      setPinging(false);
    }
  };

  const runDnsLookup = async () => {
    if (!dnsDomain.trim()) return;
    setDnsLoading(true);
    setDnsResults('Running DNS query on Linux server...');
    try {
      const res = await sshExec(activeConnId, `dig +noall +answer ${dnsDomain.trim()} ANY || nslookup ${dnsDomain.trim()}`);
      setDnsResults(res.stdout || res.stderr || 'No DNS records found.');
    } catch (err: any) {
      setDnsResults(`DNS lookup error: ${err?.message || err}`);
    } finally {
      setDnsLoading(false);
    }
  };

  const filteredPorts = useMemo(() => {
    return ports.filter(p => 
      String(p.port).includes(search) || 
      p.process.toLowerCase().includes(search.toLowerCase()) ||
      p.bindAddr.includes(search) ||
      p.protocol.toLowerCase().includes(search.toLowerCase())
    );
  }, [ports, search]);

  const filteredConns = useMemo(() => {
    return conns.filter(c => 
      c.local.includes(search) || 
      c.remote.includes(search) || 
      c.state.toLowerCase().includes(search.toLowerCase()) ||
      c.protocol.toLowerCase().includes(search.toLowerCase())
    );
  }, [conns, search]);

  return (
    <div className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none font-sans overflow-hidden relative ${loading ? 'cursor-mac-wait' : ''}`}>
      {loading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-30 pointer-events-none" />
      )}
      {/* macOS Top Navigation Toolbar */}
      <div className="bg-[#14141e]/90 backdrop-blur-2xl border-b border-white/[0.08] px-4 py-2.5 flex items-center justify-between shrink-0 space-x-3">
        {/* macOS Segmented Tab Bar */}
        <div className="flex items-center space-x-2">
          <div className="flex items-center bg-white/[0.06] rounded-xl p-0.5 border border-white/10">
            <button
              onClick={() => setTab('interfaces')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'interfaces' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <NetworkIcon className="w-3.5 h-3.5" />
              <span>Interfaces ({interfaces.length})</span>
            </button>
            <button
              onClick={() => setTab('ports')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'ports' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Listening Ports ({ports.length})</span>
            </button>
            <button
              onClick={() => setTab('conns')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'conns' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Active Sockets ({conns.length})</span>
            </button>
            <button
              onClick={() => setTab('ping')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'ping' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Ping</span>
            </button>
            <button
              onClick={() => setTab('dns')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'dns' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>DNS Lookup</span>
            </button>
          </div>
        </div>

        {/* Right Tools: Open Port, Search, Refresh */}
        <div className="flex items-center space-x-2">
          {tab === 'ports' && (
            <button
              onClick={() => setShowOpenPortModal(true)}
              className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1 rounded-xl transition-all font-medium shadow-md active:scale-95"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Open Port</span>
            </button>
          )}

          {['ports', 'conns'].includes(tab) && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Filter sockets..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#101018] border border-white/10 rounded-xl pl-8 pr-7 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 w-36 focus:w-52 transition-all shadow-inner"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          <button
            onClick={loadNetworkData}
            disabled={loading}
            className="p-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-gray-300 hover:text-white transition-all active:scale-95 disabled:opacity-50"
            title="Refresh Network Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notice Toast */}
      {notice && (
        <div className={`mx-4 mt-2 px-3 py-2 rounded-xl text-xs flex items-center justify-between animate-in fade-in slide-in-from-top-1 ${
          notice.isError ? 'bg-red-500/20 text-red-300 border border-red-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
        }`}>
          <span className="font-mono">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-gray-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 bg-[#161622] flex flex-col overflow-hidden relative">
        {/* 1. INTERFACES TAB */}
        {tab === 'interfaces' && (
          <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {interfaces.length === 0 ? (
                <div className="col-span-2 text-center py-16 text-gray-500 text-xs">
                  {loading ? 'Detecting network hardware interfaces...' : 'No interfaces found'}
                </div>
              ) : (
                interfaces.map(iface => {
                  const isLoopback = iface.name === 'lo';
                  const isSelected = selectedIface === iface.name;

                  return (
                    <div 
                      key={iface.name} 
                      onClick={() => setSelectedIface(iface.name)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between space-y-4 ${
                        isSelected 
                          ? 'bg-blue-600/15 border-blue-500/60 shadow-lg' 
                          : 'bg-[#1a1d2e] border-white/[0.08] hover:border-white/20 hover:bg-[#20243a]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3">
                          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                            isLoopback 
                              ? 'bg-purple-500/15 border-purple-500/30 text-purple-400' 
                              : 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                          }`}>
                            {isLoopback ? <Radio className="w-5 h-5" /> : <NetworkIcon className="w-5 h-5" />}
                          </div>
                          <div>
                            <div className="font-mono font-bold text-sm text-white">{iface.name}</div>
                            <div className="text-[10px] text-gray-400">{isLoopback ? 'Local Loopback' : 'Physical Network Adapter'}</div>
                          </div>
                        </div>

                        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold flex items-center space-x-1.5 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          <span>Connected</span>
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-xs font-mono bg-[#11111b] p-3 rounded-xl border border-white/[0.05]">
                        <div>
                          <span className="text-gray-500 block text-[10px] uppercase font-bold tracking-wider">IPv4 Address</span>
                          <span className="text-white font-semibold">{iface.ipv4}</span>
                        </div>
                        <div>
                          <span className="text-gray-500 block text-[10px] uppercase font-bold tracking-wider">MAC Address</span>
                          <span className="text-gray-400 truncate block">{iface.mac}</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs text-gray-400">
                        <div className="flex items-center space-x-3 font-mono text-[11px]">
                          <span className="flex items-center space-x-1 text-emerald-400">
                            <span>↓</span>
                            <span>{iface.rx}</span>
                          </span>
                          <span className="flex items-center space-x-1 text-blue-400">
                            <span>↑</span>
                            <span>{iface.tx}</span>
                          </span>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            runTerminalCommand(`ip -s link show ${iface.name}\n`);
                            openApp('terminal', 'Terminal');
                          }}
                          className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 text-[11px] flex items-center space-x-1 transition-colors"
                        >
                          <Terminal className="w-3 h-3 text-emerald-400" />
                          <span>Inspect</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 2. LISTENING PORTS TAB */}
        {tab === 'ports' && (
          <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead className="bg-[#11111a] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3 w-20">Protocol</th>
                  <th className="py-2.5 px-3 w-24">Port</th>
                  <th className="py-2.5 px-3">Bind Address</th>
                  <th className="py-2.5 px-3">Listening Process</th>
                  <th className="py-2.5 px-3 w-20">PID</th>
                  <th className="py-2.5 px-3 w-24 text-center">Exposure</th>
                  <th className="py-2.5 px-3 text-right w-40">Firewall & Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredPorts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-gray-500 font-sans text-xs">
                      {loading ? 'Scanning listening sockets via ss -tulpn...' : 'No matching listening ports found'}
                    </td>
                  </tr>
                ) : (
                  filteredPorts.map((port, idx) => {
                    const isSelected = selectedPortNum === port.port;
                    const isPublic = port.bindAddr === '0.0.0.0' || port.bindAddr === '*' || port.bindAddr === '::';

                    return (
                      <tr
                        key={`${port.protocol}-${port.port}-${idx}`}
                        onClick={() => setSelectedPortNum(port.port)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSelectedPortNum(port.port);
                          setContextMenu({ x: e.clientX, y: e.clientY, port });
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-600/25 border-l-2 border-l-blue-500 text-white font-medium'
                            : idx % 2 === 1
                            ? 'bg-white/[0.015] hover:bg-white/[0.04]'
                            : 'bg-transparent hover:bg-white/[0.04]'
                        }`}
                      >
                        <td className="py-2 px-3 uppercase font-bold text-blue-400">
                          {port.protocol}
                        </td>
                        <td className="py-2 px-3 font-bold text-white">
                          :{port.port}
                        </td>
                        <td className="py-2 px-3 text-gray-300">
                          {port.bindAddr}
                        </td>
                        <td className="py-2 px-3 font-semibold text-emerald-400 font-sans truncate max-w-xs">
                          {port.process}
                        </td>
                        <td className="py-2 px-3 text-gray-400">
                          {port.pid || '—'}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isPublic
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                          }`}>
                            {isPublic ? 'Public' : 'Localhost'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right space-x-1.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClosePort(port.port, port.protocol);
                            }}
                            className="px-2 py-0.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[10px] font-medium transition-colors"
                            title="Block Port in Firewall"
                          >
                            Block
                          </button>
                          {port.pid > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleKillPortProcess(port.pid, port.port);
                              }}
                              className="p-1 rounded-lg hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors"
                              title={`Terminate Process PID ${port.pid}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 3. ACTIVE CONNECTIONS TAB */}
        {tab === 'conns' && (
          <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-3 w-20">Protocol</th>
                  <th className="py-2.5 px-3">Local Address & Port</th>
                  <th className="py-2.5 px-3">Remote Host & Port</th>
                  <th className="py-2.5 px-3 w-32">Socket State</th>
                  <th className="py-2.5 px-3 w-20 text-right">PID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredConns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-16 text-center text-gray-500 font-sans text-xs">
                      {loading ? 'Reading active TCP/UDP connections...' : 'No active connections'}
                    </td>
                  </tr>
                ) : (
                  filteredConns.map((c, i) => {
                    const key = `${c.local}-${c.remote}-${i}`;
                    const isSelected = selectedConnKey === key;

                    return (
                      <tr 
                        key={key}
                        onClick={() => setSelectedConnKey(key)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-600/25 border-l-2 border-l-blue-500 text-white font-medium'
                            : i % 2 === 1
                            ? 'bg-white/[0.015] hover:bg-white/[0.04]'
                            : 'bg-transparent hover:bg-white/[0.04]'
                        }`}
                      >
                        <td className="py-2 px-3 uppercase text-blue-400 font-bold">{c.protocol}</td>
                        <td className="py-2 px-3 text-white font-semibold">{c.local}</td>
                        <td className="py-2 px-3 text-gray-300">{c.remote}</td>
                        <td className="py-2 px-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            c.state === 'ESTABLISHED'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : c.state === 'LISTEN'
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}>
                            {c.state}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right text-gray-400">{c.pid || '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 4. PING DIAGNOSTICS TAB */}
        {tab === 'ping' && (
          <div className="flex-1 p-6 flex flex-col space-y-4 overflow-y-auto">
            <div className="bg-[#1a1d2e] p-5 rounded-2xl border border-white/[0.08] shadow-sm space-y-4 max-w-2xl">
              <div>
                <h3 className="font-bold text-sm text-white">Ping Remote Host from Linux Server</h3>
                <p className="text-xs text-gray-400 mt-0.5">Test network latency and packet loss from the remote server to any target.</p>
              </div>

              <div className="flex items-center space-x-3">
                <input
                  type="text"
                  value={pingHost}
                  onChange={e => setPingHost(e.target.value)}
                  placeholder="e.g. 8.8.8.8, 1.1.1.1, google.com"
                  className="bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 flex-1 font-mono shadow-inner"
                />

                <select
                  value={pingCount}
                  onChange={e => setPingCount(Number(e.target.value))}
                  className="bg-[#101018] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none font-mono"
                >
                  <option value="4">4 Packets</option>
                  <option value="8">8 Packets</option>
                  <option value="16">16 Packets</option>
                </select>

                <button
                  onClick={runPing}
                  disabled={pinging}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center space-x-1.5"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>{pinging ? 'Pinging...' : 'Start Ping'}</span>
                </button>
              </div>
            </div>

            {/* Ping Output Console */}
            <div className="flex-1 bg-[#101018] rounded-2xl p-4 font-mono text-xs text-gray-300 overflow-y-auto border border-white/10 space-y-1.5 max-w-2xl min-h-[220px]">
              {pingResults.length === 0 ? (
                <div className="text-gray-500 py-6 text-center">Click Start Ping to run diagnostic ICMP echo from server.</div>
              ) : (
                pingResults.map((line, idx) => (
                  <div key={idx} className={line.includes('rtt') || line.includes('packet loss') ? 'text-emerald-400 font-bold pt-1' : ''}>
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* 5. DNS LOOKUP TAB */}
        {tab === 'dns' && (
          <div className="flex-1 p-6 flex flex-col space-y-4 overflow-y-auto">
            <div className="bg-[#1a1d2e] p-5 rounded-2xl border border-white/[0.08] shadow-sm space-y-4 max-w-2xl">
              <div>
                <h3 className="font-bold text-sm text-white">DNS Lookup & Dig</h3>
                <p className="text-xs text-gray-400 mt-0.5">Query domain nameservers, A, AAAA, MX, and TXT records directly from the server.</p>
              </div>

              <div className="flex items-center space-x-3">
                <input
                  type="text"
                  value={dnsDomain}
                  onChange={e => setDnsDomain(e.target.value)}
                  placeholder="e.g. google.com, github.com"
                  className="bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 flex-1 font-mono shadow-inner"
                />

                <button
                  onClick={runDnsLookup}
                  disabled={dnsLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center space-x-1.5"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>{dnsLoading ? 'Resolving...' : 'Lookup DNS'}</span>
                </button>
              </div>
            </div>

            {/* DNS Output Console */}
            <div className="flex-1 bg-[#101018] rounded-2xl p-4 font-mono text-xs text-gray-300 overflow-y-auto border border-white/10 max-w-2xl min-h-[220px] whitespace-pre-wrap select-text">
              {dnsResults || <div className="text-gray-500 py-6 text-center">Enter a domain and click Lookup DNS.</div>}
            </div>
          </div>
        )}

        {/* macOS Bottom Stats Bar */}
        <div className="bg-[#11111a] border-t border-white/[0.08] px-4 py-2 flex items-center justify-between text-xs text-gray-400 shrink-0 font-sans">
          <div className="flex items-center space-x-4">
            <span>Listening Ports: <b className="text-white font-mono">{ports.length}</b></span>
            <span>·</span>
            <span>Active Connections: <b className="text-white font-mono">{conns.length}</b></span>
            <span>·</span>
            <span>Network Devices: <b className="text-white font-mono">{interfaces.length}</b></span>
          </div>

          <div className="flex items-center space-x-2 text-[11px]">
            <Shield className="w-3.5 h-3.5 text-blue-400" />
            <span>Firewall Managed via UFW / IPTables</span>
          </div>
        </div>
      </div>

      {/* Open Port Modal */}
      {showOpenPortModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <form 
            onSubmit={handleOpenPort} 
            className="bg-[#181a2c] border border-white/15 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center space-x-2 text-white font-bold text-sm">
                <Shield className="w-4 h-4 text-blue-400" />
                <span>Open Firewall Port (UFW)</span>
              </div>
              <button 
                type="button" 
                onClick={() => setShowOpenPortModal(false)} 
                className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-300 block mb-1 font-medium">Port Number</label>
                <input
                  type="number"
                  required
                  autoFocus
                  value={newPortNum}
                  onChange={e => setNewPortNum(e.target.value)}
                  placeholder="e.g. 80, 443, 8080, 3000, 5432"
                  className="w-full bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-gray-300 block mb-1 font-medium">Protocol</label>
                <div className="flex bg-[#101018] p-1 rounded-xl border border-white/10">
                  <button
                    type="button"
                    onClick={() => setNewPortProto('tcp')}
                    className={`flex-1 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                      newPortProto === 'tcp' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    TCP
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewPortProto('udp')}
                    className={`flex-1 py-1 rounded-lg text-xs font-mono font-bold transition-all ${
                      newPortProto === 'udp' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    UDP
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-300 block mb-1 font-medium">Comment / Rule Description</label>
                <input
                  type="text"
                  value={newPortDesc}
                  onChange={e => setNewPortDesc(e.target.value)}
                  placeholder="e.g. Node API, Web Server"
                  className="w-full bg-[#101018] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowOpenPortModal(false)}
                className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newPortNum.trim()}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white shadow-md transition-all active:scale-95"
              >
                Allow Port
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl py-1.5 w-56 text-xs text-gray-200 font-sans select-none animate-in fade-in duration-100"
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 200),
            left: Math.min(contextMenu.x, window.innerWidth - 240)
          }}
          onClick={e => e.stopPropagation()}
        >
          {contextMenu.port && (
            <>
              <div className="px-3.5 py-1 text-[11px] font-bold text-gray-400 border-b border-white/10 mb-1">
                Port {contextMenu.port.port} ({contextMenu.port.process})
              </div>
              <div
                onClick={() => {
                  navigator.clipboard.writeText(String(contextMenu.port!.port));
                  setContextMenu(null);
                }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Port Number</span>
              </div>
              <div
                onClick={() => handleClosePort(contextMenu.port!.port, contextMenu.port!.protocol)}
                className="px-3.5 py-1.5 hover:bg-amber-600 hover:text-white flex items-center space-x-2 cursor-pointer text-amber-300"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Block in Firewall</span>
              </div>
              {contextMenu.port.pid > 0 && (
                <div
                  onClick={() => handleKillPortProcess(contextMenu.port!.pid, contextMenu.port!.port)}
                  className="px-3.5 py-1.5 hover:bg-rose-600 hover:text-white flex items-center space-x-2 cursor-pointer text-rose-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Kill Listening Process</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
