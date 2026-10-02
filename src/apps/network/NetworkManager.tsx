import React, { useState, useEffect, useCallback } from 'react';
import { 
  Globe, Radio, Activity, Network as NetworkIcon, Search, Play, 
  CheckCircle2, Shield, RefreshCw, Plus, X, PowerOff, ShieldAlert, Trash2 
} from 'lucide-react';
import { 
  networkPorts, networkConnections, systemGetNetwork, networkPing, 
  sshExec, processKill 
} from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

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
}

export default function NetworkManager() {
  const [tab, setTab] = useState<'ports' | 'conns' | 'interfaces' | 'ping'>('ports');
  const [ports, setPorts] = useState<ListeningPort[]>([]);
  const [conns, setConns] = useState<ActiveConn[]>([]);
  const [interfaces, setInterfaces] = useState<InterfaceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [pingHost, setPingHost] = useState('8.8.8.8');
  const [pingResults, setPingResults] = useState<string[]>([]);
  const [pinging, setPinging] = useState(false);

  // Open Port Modal State
  const [showOpenPortModal, setShowOpenPortModal] = useState(false);
  const [newPortNum, setNewPortNum] = useState('');
  const [newPortProto, setNewPortProto] = useState<'tcp' | 'udp'>('tcp');

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const handleOpenPort = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPortNum.trim()) return;
    try {
      await sshExec(activeConnId, `sudo ufw allow ${newPortNum.trim()}/${newPortProto}`);
      setShowOpenPortModal(false);
      setNewPortNum('');
      await loadNetworkData();
      alert(`Port ${newPortNum.trim()}/${newPortProto} allowed in firewall.`);
    } catch (err: any) {
      alert(`Failed to open port: ${err?.message || err}`);
    }
  };

  const handleClosePort = async (port: number, protocol: string) => {
    if (!confirm(`Block / close port ${port}/${protocol} in server firewall (UFW)?`)) return;
    try {
      await sshExec(activeConnId, `sudo ufw deny ${port}/${protocol}`);
      await loadNetworkData();
      alert(`Port ${port}/${protocol} blocked in firewall.`);
    } catch (err: any) {
      alert(`Failed to block port: ${err?.message || err}`);
    }
  };

  const handleKillPortProcess = async (pid: number, port: number) => {
    if (!confirm(`Terminate process PID ${pid} listening on port ${port}?`)) return;
    try {
      await processKill(activeConnId, pid, 'KILL');
      await loadNetworkData();
      alert(`Process ${pid} terminated.`);
    } catch (err: any) {
      alert(`Failed to kill process: ${err?.message || err}`);
    }
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
          protocol: p.protocol || 'tcp',
          port: p.local_port || p.port || 0,
          bindAddr: p.local_addr || p.bindAddr || '0.0.0.0',
          process: p.process_name || p.process || 'system',
          pid: p.pid || 0
        })));
      }

      if (cList && Array.isArray(cList)) {
        setConns(cList.map((c: any) => ({
          protocol: (c.protocol || 'TCP').toUpperCase(),
          local: c.local_addr || c.local || '',
          remote: c.remote_addr || c.remote || '',
          state: c.state || 'ESTABLISHED',
          pid: c.pid || 0
        })));
      }

      if (ifList && Array.isArray(ifList)) {
        setInterfaces(ifList.map((i: any) => ({
          name: i.name,
          ipv4: i.ip || '—',
          ipv6: '—',
          mac: i.mac || '—',
          state: 'UP',
          rx: `${((i.rx_bytes || 0) / (1024 * 1024)).toFixed(1)} MB`,
          tx: `${((i.tx_bytes || 0) / (1024 * 1024)).toFixed(1)} MB`
        })));
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

  const runPing = async () => {
    if (!pingHost) return;
    setPinging(true);
    setPingResults([`PING ${pingHost} from Linux server...`]);
    try {
      const res = await networkPing(activeConnId, pingHost);
      const lines = res.split('\n').filter(Boolean);
      setPingResults(lines.length > 0 ? lines : ['No response from host.']);
    } catch (err) {
      setPingResults([`Ping failed: ${err}`]);
    } finally {
      setPinging(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Top Navigation */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex space-x-1 bg-[#1e1e2e] p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => setTab('ports')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'ports' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Listening Ports ({ports.length})
          </button>
          <button
            onClick={() => setTab('conns')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'conns' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Active Connections ({conns.length})
          </button>
          <button
            onClick={() => setTab('interfaces')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'interfaces' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Interfaces ({interfaces.length})
          </button>
          <button
            onClick={() => setTab('ping')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'ping' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            Diagnostics (Ping)
          </button>
        </div>

        <div className="flex items-center space-x-2">
          {tab === 'ports' && (
            <button
              onClick={() => setShowOpenPortModal(true)}
              className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Open Port</span>
            </button>
          )}

          {tab !== 'ping' && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Filter..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#1e1e2e] border border-white/10 rounded-lg pl-8 pr-3 py-1 text-xs text-gray-200 focus:outline-none w-44"
              />
            </div>
          )}

          <button
            onClick={loadNetworkData}
            disabled={loading}
            className="p-1.5 bg-[#1e1e2e] hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 hover:text-white transition-colors"
            title="Refresh Network Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Tab: Listening Ports */}
      {tab === 'ports' && (
        <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
              <tr>
                <th className="py-2.5 px-3">Protocol</th>
                <th className="py-2.5 px-3">Port</th>
                <th className="py-2.5 px-3">Bind Address</th>
                <th className="py-2.5 px-3">Process</th>
                <th className="py-2.5 px-3">PID</th>
                <th className="py-2.5 px-3">Access</th>
                <th className="py-2.5 px-3 text-right">Controls</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {ports.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-gray-500">
                    {loading ? 'Scanning listening sockets...' : 'No listening ports detected'}
                  </td>
                </tr>
              ) : (
                ports
                  .filter(p => String(p.port).includes(search) || p.process.toLowerCase().includes(search.toLowerCase()))
                  .map((port, idx) => (
                    <tr key={`${port.protocol}-${port.port}-${idx}`} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 uppercase font-mono text-blue-400">{port.protocol}</td>
                      <td className="py-2.5 px-3 font-mono font-bold text-white">:{port.port}</td>
                      <td className="py-2.5 px-3 font-mono text-gray-400">{port.bindAddr}</td>
                      <td className="py-2.5 px-3 font-medium text-emerald-400">{port.process}</td>
                      <td className="py-2.5 px-3 font-mono text-gray-500">{port.pid || '—'}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          port.bindAddr === '0.0.0.0' || port.bindAddr === '*' || port.bindAddr === '::'
                            ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                          {port.bindAddr === '0.0.0.0' || port.bindAddr === '*' || port.bindAddr === '::' ? 'Public' : 'Localhost'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right space-x-1">
                        <button
                          onClick={() => handleClosePort(port.port, port.protocol)}
                          className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 text-[10px] font-medium transition-colors"
                          title="Block / Close Port in Firewall"
                        >
                          Close Port
                        </button>
                        {port.pid > 0 && (
                          <button
                            onClick={() => handleKillPortProcess(port.pid, port.port)}
                            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors"
                            title={`Terminate process ${port.pid}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Active Connections */}
      {tab === 'conns' && (
        <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
              <tr>
                <th className="py-2.5 px-3">Proto</th>
                <th className="py-2.5 px-3">Local Address</th>
                <th className="py-2.5 px-3">Remote Address</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3">PID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {conns.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500">
                    {loading ? 'Reading active connections...' : 'No active connections'}
                  </td>
                </tr>
              ) : (
                conns
                  .filter(c => c.local.includes(search) || c.remote.includes(search))
                  .map((c, i) => (
                    <tr key={i} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-mono text-blue-400">{c.protocol}</td>
                      <td className="py-2.5 px-3 font-mono text-white">{c.local}</td>
                      <td className="py-2.5 px-3 font-mono text-gray-300">{c.remote}</td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                          c.state === 'ESTABLISHED' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'
                        }`}>
                          {c.state}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-gray-500">{c.pid || '—'}</td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab: Interfaces */}
      {tab === 'interfaces' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {interfaces.length === 0 ? (
            <div className="col-span-2 text-center py-12 text-gray-500">
              {loading ? 'Reading network interfaces...' : 'No interfaces found'}
            </div>
          ) : (
            interfaces.map(iface => (
              <div key={iface.name} className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Globe className="w-5 h-5 text-blue-400" />
                    <span className="font-mono font-bold text-base text-white">{iface.name}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-500/20 text-emerald-400">
                    {iface.state}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div>
                    <span className="text-gray-500 block text-[10px]">IPv4</span>
                    <span className="text-gray-200">{iface.ipv4}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block text-[10px]">MAC</span>
                    <span className="text-gray-400">{iface.mac}</span>
                  </div>
                </div>
                <div className="pt-2 border-t border-white/[0.05] flex justify-between text-xs text-gray-400">
                  <span>RX: {iface.rx}</span>
                  <span>TX: {iface.tx}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Ping Tool */}
      {tab === 'ping' && (
        <div className="flex-1 bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex flex-col space-y-3">
          <div className="flex items-center space-x-2">
            <input
              type="text"
              value={pingHost}
              onChange={e => setPingHost(e.target.value)}
              placeholder="Hostname or IP"
              className="bg-[#11111b] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none w-64"
            />
            <button
              onClick={runPing}
              disabled={pinging}
              className="flex items-center space-x-1.5 bg-[var(--accent)] hover:bg-blue-600 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{pinging ? 'Pinging from Server...' : 'Start Ping'}</span>
            </button>
          </div>

          <div className="flex-1 bg-[#11111b] rounded-lg p-3 font-mono text-xs text-gray-300 overflow-y-auto space-y-1">
            {pingResults.length === 0 ? (
              <div className="text-gray-500">Enter a remote target and click Start Ping</div>
            ) : (
              pingResults.map((line, idx) => (
                <div key={idx} className={line.includes('statistics') || line.includes('rtt') ? 'text-amber-300 pt-2 font-bold' : ''}>
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Open Port Modal */}
      {showOpenPortModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form 
            onSubmit={handleOpenPort} 
            className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-white font-bold text-sm">
                <Shield className="w-4 h-4 text-blue-400" />
                <span>Open Firewall Port (UFW)</span>
              </div>
              <button 
                type="button" 
                onClick={() => setShowOpenPortModal(false)} 
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Port Number</label>
                <input
                  type="number"
                  required
                  autoFocus
                  value={newPortNum}
                  onChange={e => setNewPortNum(e.target.value)}
                  placeholder="e.g. 80, 443, 8080, 3000, 5432"
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Protocol</label>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setNewPortProto('tcp')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors ${
                      newPortProto === 'tcp' ? 'bg-blue-600 text-white' : 'bg-[#11111b] text-gray-400 hover:text-white'
                    }`}
                  >
                    TCP
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewPortProto('udp')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-mono font-bold transition-colors ${
                      newPortProto === 'udp' ? 'bg-blue-600 text-white' : 'bg-[#11111b] text-gray-400 hover:text-white'
                    }`}
                  >
                    UDP
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowOpenPortModal(false)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!newPortNum.trim()}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white"
              >
                Allow Port
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
