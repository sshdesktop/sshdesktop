import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Globe, Radio, Activity, Network as NetworkIcon, Search, Play, 
  CheckCircle2, RefreshCw, X, ArrowDownUp, HardDrive, Compass, Copy, 
  Terminal, ExternalLink, ChevronDown, ChevronUp, AlertCircle, Check, 
  ArrowRight, Zap, Laptop, Trash2
} from 'lucide-react';
import { 
  networkPorts, networkConnections, systemGetNetwork, networkPing, 
  networkDnsLookup, sshExec, processKill, networkKillPort 
} from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';

// Subcomponents and Modals
import NetworkContextMenu, { ContextMenuTarget } from './components/NetworkContextMenu';
import SpeedTestDashboard from './components/SpeedTestDashboard';
import KillPortModal from './modals/KillPortModal';

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

export default function NetworkManager() {
  const [tab, setTab] = useState<'interfaces' | 'speedtest' | 'ports' | 'conns' | 'ping' | 'dns'>('interfaces');
  const [ports, setPorts] = useState<ListeningPort[]>([]);
  const [conns, setConns] = useState<ActiveConn[]>([]);
  const [interfaces, setInterfaces] = useState<InterfaceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  
  // Selected items for macOS selection highlight
  const [selectedPort, setSelectedPort] = useState<ListeningPort | null>(null);
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

  // Kill Port Modal State
  const [killModalTarget, setKillModalTarget] = useState<{
    port?: number;
    protocol?: string;
    process?: string;
    pid?: number;
  } | null>(null);

  // Notification Toast
  const [notice, setNotice] = useState<{ text: string; isError: boolean } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: ContextMenuTarget } | null>(null);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { openApp } = useWindowManager();
  const { runTerminalCommand } = useEditorStore();

  const showToast = (text: string, isError: boolean = false) => {
    setNotice({ text, isError });
    setTimeout(() => setNotice(null), 4000);
  };

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
          protocol: p.protocol || 'TCP',
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

  // Keyboard navigation for selected port (Delete / Backspace to trigger Kill)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (tab === 'ports' && selectedPort) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          // If active element is an input, don't intercept
          if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
          e.preventDefault();
          setKillModalTarget({
            port: selectedPort.port,
            protocol: selectedPort.protocol,
            process: selectedPort.process,
            pid: selectedPort.pid,
          });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tab, selectedPort]);

  // Kill port execution
  const handleExecuteKillPort = async (
    port: number,
    protocol: string,
    pid?: number,
    signal: string = 'KILL'
  ) => {
    try {
      const res = await networkKillPort(
        activeConnId,
        port,
        protocol.toLowerCase(),
        pid && pid > 0 ? pid : undefined,
        signal
      );
      showToast(res || `Port :${port} (${protocol}) terminated.`);
      await loadNetworkData();
      if (selectedPort?.port === port) {
        setSelectedPort(null);
      }
    } catch (err: any) {
      showToast(`Failed to kill port :${port}: ${err?.message || err}`, true);
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
      <div className="bg-[#14141e]/90 backdrop-blur-2xl border-b border-white/[0.08] px-4 py-2.5 flex items-center justify-between shrink-0 space-x-3 overflow-x-auto scrollbar-thin gap-2">
        {/* macOS Segmented Tab Bar */}
        <div className="flex items-center space-x-2 shrink-0">
          <div className="flex items-center bg-white/[0.06] rounded-xl p-0.5 border border-white/10">
            {/* Hardware Interfaces Tab */}
            <button
              onClick={() => setTab('interfaces')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'interfaces' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <NetworkIcon className="w-3.5 h-3.5" />
              <span>Interfaces ({interfaces.length})</span>
            </button>

            {/* Speed Test Tab */}
            <button
              onClick={() => setTab('speedtest')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'speedtest' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>Speed Test</span>
            </button>

            {/* Listening Ports Tab */}
            <button
              onClick={() => setTab('ports')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'ports' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Listening Ports ({ports.length})</span>
            </button>

            {/* Active Sockets Tab */}
            <button
              onClick={() => setTab('conns')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'conns' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Active Sockets ({conns.length})</span>
            </button>

            {/* Diagnostic Ping Tab */}
            <button
              onClick={() => setTab('ping')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                tab === 'ping' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Compass className="w-3.5 h-3.5" />
              <span>Ping</span>
            </button>

            {/* DNS Lookup Tab */}
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

        {/* Right Tools: Port Kill Action, Search, Refresh */}
        <div className="flex items-center space-x-2 shrink-0">
          {tab === 'ports' && (
            <button
              onClick={() => {
                setKillModalTarget({
                  port: selectedPort ? selectedPort.port : undefined,
                  protocol: selectedPort ? selectedPort.protocol : 'TCP',
                  process: selectedPort ? selectedPort.process : '',
                  pid: selectedPort ? selectedPort.pid : undefined,
                });
              }}
              className="flex items-center space-x-1.5 bg-rose-600/90 hover:bg-rose-500 text-white text-xs px-3 py-1 rounded-xl transition-all font-semibold shadow-md active:scale-95 border border-rose-500/50"
              title="Kill Port / Terminate Process (Delete)"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{selectedPort ? `Kill Port :${selectedPort.port}` : 'Kill Port...'}</span>
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

        {/* 2. SPEED TEST TAB */}
        {tab === 'speedtest' && (
          <SpeedTestDashboard
            connId={activeConnId}
            onInspectTerminal={(cmd) => {
              runTerminalCommand(cmd, { title: 'Speed Test Console', newTab: true });
              openApp('terminal', 'Terminal', undefined, true);
            }}
          />
        )}

        {/* 2. INTERFACES TAB */}
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
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelectedIface(iface.name);
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          target: { type: 'iface', data: iface }
                        });
                      }}
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

                        <div className="flex items-center space-x-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              runTerminalCommand(`ip -s link show ${iface.name}\n`);
                              openApp('terminal', 'Terminal');
                            }}
                            className="px-2 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-gray-300 text-[11px] flex items-center space-x-1 transition-colors"
                          >
                            <Terminal className="w-3 h-3 text-blue-400" />
                            <span>Inspect</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 3. LISTENING PORTS TAB (Clean: Firewall & Action column removed, Right click option show, Port Kill enabled) */}
        {tab === 'ports' && (
          <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead className="bg-[#11111a] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-4 w-24">Protocol</th>
                  <th className="py-2.5 px-4 w-28">Port</th>
                  <th className="py-2.5 px-4">Bind Address</th>
                  <th className="py-2.5 px-4">Listening Process</th>
                  <th className="py-2.5 px-4 w-24">PID</th>
                  <th className="py-2.5 px-4 w-28 text-center">Exposure</th>
                  <th className="py-2.5 px-4 text-right w-28">Port Kill</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredPorts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-gray-500 font-sans text-xs">
                      {loading ? 'Scanning listening sockets via ss -tunlp...' : 'No matching listening ports found'}
                    </td>
                  </tr>
                ) : (
                  filteredPorts.map((port, idx) => {
                    const isSelected = selectedPort?.port === port.port && selectedPort?.protocol === port.protocol;
                    const isPublic = port.bindAddr === '0.0.0.0' || port.bindAddr === '*' || port.bindAddr === '::';
                    const isUdp = port.protocol.toUpperCase().includes('UDP');

                    return (
                      <tr
                        key={`${port.protocol}-${port.port}-${idx}`}
                        onClick={() => setSelectedPort(port)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSelectedPort(port);
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            target: { type: 'port', data: port }
                          });
                        }}
                        className={`cursor-pointer transition-colors group ${
                          isSelected
                            ? 'bg-blue-600/25 border-l-2 border-l-blue-500 text-white font-medium'
                            : idx % 2 === 1
                            ? 'bg-white/[0.015] hover:bg-white/[0.04]'
                            : 'bg-transparent hover:bg-white/[0.04]'
                        }`}
                      >
                        <td className="py-2.5 px-4">
                          <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                            isUdp 
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' 
                              : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          }`}>
                            {port.protocol}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-bold text-white text-sm">
                          :{port.port}
                        </td>
                        <td className="py-2.5 px-4 text-gray-300">
                          {port.bindAddr}
                        </td>
                        <td className="py-2.5 px-4 font-semibold text-emerald-400 font-sans truncate max-w-xs">
                          {port.process}
                        </td>
                        <td className="py-2.5 px-4 text-gray-400">
                          {port.pid > 0 ? (
                            <span className="text-gray-300 font-bold">{port.pid}</span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            isPublic
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                          }`}>
                            {isPublic ? 'Public' : 'Localhost'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setKillModalTarget({
                                port: port.port,
                                protocol: port.protocol,
                                process: port.process,
                                pid: port.pid,
                              });
                            }}
                            className="px-2.5 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/30 text-[11px] font-semibold transition-all inline-flex items-center space-x-1 active:scale-95"
                            title={`Kill Port :${port.port}`}
                          >
                            <Zap className="w-3 h-3 text-rose-400" />
                            <span>Kill</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 4. ACTIVE CONNECTIONS TAB */}
        {tab === 'conns' && (
          <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin">
            <table className="w-full text-left text-xs font-mono border-collapse">
              <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="py-2.5 px-4 w-20">Protocol</th>
                  <th className="py-2.5 px-4">Local Address & Port</th>
                  <th className="py-2.5 px-4">Remote Host & Port</th>
                  <th className="py-2.5 px-4 w-32">Socket State</th>
                  <th className="py-2.5 px-4 w-20 text-right">PID</th>
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
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSelectedConnKey(key);
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            target: { type: 'conn', data: c }
                          });
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-blue-600/25 border-l-2 border-l-blue-500 text-white font-medium'
                            : i % 2 === 1
                            ? 'bg-white/[0.015] hover:bg-white/[0.04]'
                            : 'bg-transparent hover:bg-white/[0.04]'
                        }`}
                      >
                        <td className="py-2.5 px-4 uppercase text-blue-400 font-bold">{c.protocol}</td>
                        <td className="py-2.5 px-4 text-white font-semibold">{c.local}</td>
                        <td className="py-2.5 px-4 text-gray-300">{c.remote}</td>
                        <td className="py-2.5 px-4">
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
                        <td className="py-2.5 px-4 text-right text-gray-400">{c.pid || '—'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* 5. PING DIAGNOSTICS TAB */}
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

        {/* 6. DNS LOOKUP TAB */}
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

        {/* macOS Bottom Status Bar */}
        <div className="bg-[#11111a] border-t border-white/[0.08] px-4 py-2 flex items-center justify-between text-xs text-gray-400 shrink-0 font-sans">
          <div className="flex items-center space-x-4">
            <span>Listening Ports: <b className="text-white font-mono">{ports.length}</b></span>
            <span>·</span>
            <span>Active Connections: <b className="text-white font-mono">{conns.length}</b></span>
            <span>·</span>
            <span>Network Devices: <b className="text-white font-mono">{interfaces.length}</b></span>
          </div>

          <div className="flex items-center space-x-3 text-[11px]">
            {tab === 'ports' && selectedPort ? (
              <div className="flex items-center space-x-2 text-rose-300 font-mono">
                <span>Selected: :{selectedPort.port} ({selectedPort.process})</span>
                <button
                  onClick={() => {
                    setKillModalTarget({
                      port: selectedPort.port,
                      protocol: selectedPort.protocol,
                      process: selectedPort.process,
                      pid: selectedPort.pid,
                    });
                  }}
                  className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold hover:bg-rose-500/30"
                >
                  Kill (Del)
                </button>
              </div>
            ) : (
              <span className="text-gray-500">
                Right-click rows for actions & port kill options
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Kill Port Modal */}
      {killModalTarget && (
        <KillPortModal
          initialPort={killModalTarget.port}
          initialProtocol={killModalTarget.protocol}
          initialProcess={killModalTarget.process}
          initialPid={killModalTarget.pid}
          connId={activeConnId}
          onClose={() => setKillModalTarget(null)}
          onSuccess={(msg) => {
            showToast(msg);
            loadNetworkData();
          }}
        />
      )}

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <NetworkContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          target={contextMenu.target}
          onClose={() => setContextMenu(null)}
          onKillPort={(port, protocol, pid, signal) => {
            handleExecuteKillPort(port, protocol, pid, signal);
          }}
          onOpenKillModal={(port, protocol, process, pid) => {
            setKillModalTarget({ port, protocol, process, pid });
          }}
          onInspectTerminal={(cmd) => {
            runTerminalCommand(cmd);
            openApp('terminal', 'Terminal');
          }}
          onOpenProcessManager={(pid) => {
            openApp('processes', 'Processes');
          }}
          onSwitchToSpeedTest={() => {
            setTab('speedtest');
          }}
          onPingHost={(host) => {
            setTab('ping');
            setPingHost(host);
            setTimeout(() => runPing(), 200);
          }}
        />
      )}
    </div>
  );
}
