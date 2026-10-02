import React, { useState, useEffect, useCallback } from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer 
} from 'recharts';
import { 
  Cpu, MemoryStick, HardDrive, Wifi, Server, Clock, Activity, 
  Search, RefreshCw, Layers, ArrowDown, ArrowUp, Zap, Database
} from 'lucide-react';
import { useConnectionStore } from '../../lib/store';
import { systemGetStats, systemGetDisks, systemGetNetwork, processList } from '../../lib/tauri-bridge';

interface HistoryPoint {
  time: string;
  cpu: number;
  mem: number;
  rx: number;
  tx: number;
}

interface LiveStats {
  hostname: string;
  osName: string;
  osVersion: string;
  kernel: string;
  arch: string;
  uptime: string;
  loadAvg: string;
  cpuPercent: number;
  ramPercent: number;
  ramTotal: number;
  ramUsed: number;
  ramFree: number;
  ramCached: number;
  swapTotal: number;
  swapUsed: number;
}

interface DiskInfo {
  mount_point: string;
  filesystem: string;
  total: string;
  used: string;
  available: string;
  percent: number;
}

interface NetInterface {
  name: string;
  ip: string;
  mac: string;
  rx_bytes: number;
  tx_bytes: number;
}

interface TopProcess {
  pid: number;
  name: string;
  user: string;
  cpu: number;
  mem: number;
}

export default function SystemMonitor() {
  const [activeTab, setActiveTab] = useState<'cpu' | 'memory' | 'disk' | 'network' | 'overview'>('overview');
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [prevNet, setPrevNet] = useState<{ rx: number; tx: number; time: number } | null>(null);
  const [disks, setDisks] = useState<DiskInfo[]>([]);
  const [netInterfaces, setNetInterfaces] = useState<NetInterface[]>([]);
  const [processes, setProcesses] = useState<TopProcess[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const [liveInfo, setLiveInfo] = useState<LiveStats>({
    hostname: 'Connecting...',
    osName: 'Linux',
    osVersion: '',
    kernel: '',
    arch: 'x86_64',
    uptime: '—',
    loadAvg: '0.0, 0.0, 0.0',
    cpuPercent: 0,
    ramPercent: 0,
    ramTotal: 0,
    ramUsed: 0,
    ramFree: 0,
    ramCached: 0,
    swapTotal: 0,
    swapUsed: 0,
  });

  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const fetchData = useCallback(async () => {
    try {
      const [stats, diskList, netList, procList] = await Promise.all([
        systemGetStats(activeConnId),
        systemGetDisks(activeConnId),
        systemGetNetwork(activeConnId),
        processList(activeConnId)
      ]);

      if (stats) {
        const avgCpu = Array.isArray(stats.cpu_percent) && stats.cpu_percent.length > 0
          ? Math.round(stats.cpu_percent[0])
          : 0;

        const ramTotal = stats.ram_total || 1;
        const ramUsed = stats.ram_used || 0;
        const ramCached = stats.ram_cached || 0;
        const ramFree = stats.ram_free || 0;
        const ramPct = Math.round((ramUsed / ramTotal) * 100);

        const days = Math.floor((stats.uptime_seconds || 0) / 86400);
        const hours = Math.floor(((stats.uptime_seconds || 0) % 86400) / 3600);
        const mins = Math.floor(((stats.uptime_seconds || 0) % 3600) / 60);

        const loads = typeof stats.load_avg === 'object' && stats.load_avg !== null
          ? `${(stats.load_avg as any)[0] ?? 0}, ${(stats.load_avg as any)[1] ?? 0}, ${(stats.load_avg as any)[2] ?? 0}`
          : '0.0, 0.0, 0.0';

        setLiveInfo({
          hostname: stats.hostname || activeServer?.name || 'linux-server',
          osName: stats.os_name || 'Linux',
          osVersion: stats.os_version || '',
          kernel: stats.kernel || '',
          arch: stats.arch || 'x86_64',
          uptime: `${days}d ${hours}h ${mins}m`,
          loadAvg: loads,
          cpuPercent: avgCpu,
          ramPercent: ramPct,
          ramTotal,
          ramUsed,
          ramFree,
          ramCached,
          swapTotal: stats.swap_total || 0,
          swapUsed: stats.swap_used || 0,
        });

        // Network throughput calculations
        let totalRx = 0;
        let totalTx = 0;
        if (Array.isArray(netList)) {
          netList.forEach((n: any) => {
            totalRx += n.rx_bytes || 0;
            totalTx += n.tx_bytes || 0;
          });
          setNetInterfaces(netList);
        }

        const now = Date.now();
        let rxRate = 0;
        let txRate = 0;

        if (prevNet && now > prevNet.time) {
          const dt = (now - prevNet.time) / 1000;
          if (dt > 0) {
            rxRate = Math.max(0, Math.round(((totalRx - prevNet.rx) / 1024) / dt));
            txRate = Math.max(0, Math.round(((totalTx - prevNet.tx) / 1024) / dt));
          }
        }
        setPrevNet({ rx: totalRx, tx: totalTx, time: now });

        setHistory(prev => {
          const point: HistoryPoint = {
            time: new Date().toTimeString().split(' ')[0].slice(3),
            cpu: avgCpu,
            mem: ramPct,
            rx: rxRate,
            tx: txRate,
          };
          const updated = [...prev, point];
          return updated.length > 25 ? updated.slice(updated.length - 25) : updated;
        });
      }

      if (diskList && Array.isArray(diskList)) {
        setDisks(diskList.map((d: any) => ({
          mount_point: d.mount_point || '/',
          filesystem: d.filesystem || 'ext4',
          total: d.total || '0',
          used: d.used || '0',
          available: d.available || '0',
          percent: typeof d.percent === 'number' ? d.percent : parseInt(String(d.percent || '0').replace('%', ''), 10) || 0,
        })));
      }

      if (procList && Array.isArray(procList)) {
        setProcesses(procList.map((p: any) => ({
          pid: p.pid || 0,
          name: p.name || p.command?.split(' ')[0] || 'process',
          user: p.user || 'root',
          cpu: p.cpu_percent || 0,
          mem: p.mem_percent || 0,
        })));
      }
    } catch (err) {
      console.warn('System monitor fetch error:', err);
    }
  }, [activeConnId, activeServer, prevNet]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2500);
    return () => clearInterval(interval);
  }, [fetchData]);

  const filteredProcesses = processes.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.user.toLowerCase().includes(search.toLowerCase()) ||
    String(p.pid).includes(search)
  );

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-hidden select-none">
      {/* Top macOS Segmented Control Tabs */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex space-x-1 bg-[#1e1e2e] p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors ${
              activeTab === 'overview' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-blue-400" />
            <span>Overview</span>
          </button>
          <button
            onClick={() => setActiveTab('cpu')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors ${
              activeTab === 'cpu' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-sky-400" />
            <span>CPU</span>
          </button>
          <button
            onClick={() => setActiveTab('memory')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors ${
              activeTab === 'memory' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <MemoryStick className="w-3.5 h-3.5 text-purple-400" />
            <span>Memory</span>
          </button>
          <button
            onClick={() => setActiveTab('disk')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors ${
              activeTab === 'disk' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
            <span>Disk Storage</span>
          </button>
          <button
            onClick={() => setActiveTab('network')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors ${
              activeTab === 'network' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Wifi className="w-3.5 h-3.5 text-amber-400" />
            <span>Network</span>
          </button>
        </div>

        <div className="flex items-center space-x-2">
          {['cpu', 'memory'].includes(activeTab) && (
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Filter process..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#1e1e2e] border border-white/10 rounded-lg pl-8 pr-3 py-1 text-xs text-gray-200 focus:outline-none w-48"
              />
            </div>
          )}

          <button
            onClick={fetchData}
            className="p-1.5 bg-[#1e1e2e] hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 hover:text-white transition-colors"
            title="Refresh Stats"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* TAB 1: SYSTEM OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Top Host Specs Banner */}
          <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
                <Server className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-lg text-white">{liveInfo.hostname}</span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    LIVE METRICS
                  </span>
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {liveInfo.osName} {liveInfo.osVersion} · Kernel: {liveInfo.kernel} ({liveInfo.arch})
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-6 text-xs font-mono">
              <div>
                <span className="text-gray-500 block text-[10px]">UPTIME</span>
                <span className="text-gray-200 font-semibold">{liveInfo.uptime}</span>
              </div>
              <div>
                <span className="text-gray-500 block text-[10px]">LOAD AVERAGE</span>
                <span className="text-gray-200 font-semibold">{liveInfo.loadAvg}</span>
              </div>
            </div>
          </div>

          {/* 4 macOS Activity Gauges (CPU, Memory, Disk, Network) */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08]">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="flex items-center space-x-1.5">
                  <Cpu className="w-4 h-4 text-sky-400" />
                  <span>CPU Usage</span>
                </span>
                <span className="font-mono text-sky-400 font-bold">{liveInfo.cpuPercent}%</span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden mt-3">
                <div 
                  className="bg-gradient-to-r from-sky-400 to-blue-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${Math.min(100, liveInfo.cpuPercent)}%` }} 
                />
              </div>
              <div className="text-[11px] text-gray-500 mt-2 font-mono">Load: {liveInfo.loadAvg.split(',')[0]}</div>
            </div>

            <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08]">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="flex items-center space-x-1.5">
                  <MemoryStick className="w-4 h-4 text-purple-400" />
                  <span>Memory</span>
                </span>
                <span className="font-mono text-purple-400 font-bold">{liveInfo.ramPercent}%</span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden mt-3">
                <div 
                  className="bg-gradient-to-r from-purple-400 to-pink-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${Math.min(100, liveInfo.ramPercent)}%` }} 
                />
              </div>
              <div className="text-[11px] text-gray-500 mt-2 font-mono">
                {(liveInfo.ramUsed / (1024 * 1024 * 1024)).toFixed(1)} GB / {(liveInfo.ramTotal / (1024 * 1024 * 1024)).toFixed(1)} GB
              </div>
            </div>

            <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08]">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="flex items-center space-x-1.5">
                  <HardDrive className="w-4 h-4 text-emerald-400" />
                  <span>Storage</span>
                </span>
                <span className="font-mono text-emerald-400 font-bold">
                  {disks[0]?.percent ?? 0}%
                </span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden mt-3">
                <div 
                  className="bg-gradient-to-r from-emerald-400 to-teal-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${Math.min(100, disks[0]?.percent || 0)}%` }} 
                />
              </div>
              <div className="text-[11px] text-gray-500 mt-2 font-mono truncate">
                {disks[0]?.used || '0'} / {disks[0]?.total || '0'} ({disks[0]?.mount_point || '/'})
              </div>
            </div>

            <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08]">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="flex items-center space-x-1.5">
                  <Wifi className="w-4 h-4 text-amber-400" />
                  <span>Throughput</span>
                </span>
                <span className="font-mono text-amber-400 font-bold">
                  {history[history.length - 1]?.rx || 0} KB/s
                </span>
              </div>
              <div className="w-full bg-white/5 h-2 rounded-full overflow-hidden mt-3">
                <div 
                  className="bg-gradient-to-r from-amber-400 to-orange-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${Math.min(100, (history[history.length - 1]?.rx || 0) / 10)}%` }} 
                />
              </div>
              <div className="text-[11px] text-gray-500 mt-2 font-mono">
                TX: {history[history.length - 1]?.tx || 0} KB/s
              </div>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-2 gap-4 min-h-[220px]">
            <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-300">CPU Usage History</span>
                <span className="text-xs font-mono text-sky-400 font-bold">{liveInfo.cpuPercent}%</span>
              </div>
              <div className="flex-1 w-full min-h-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <defs>
                      <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" hide />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip contentStyle={{ backgroundColor: '#181825', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                    <Area type="monotone" dataKey="cpu" stroke="#38bdf8" strokeWidth={2} fill="url(#cpuGrad)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-gray-300">Memory Allocation Trend</span>
                <span className="text-xs font-mono text-purple-400 font-bold">{liveInfo.ramPercent}%</span>
              </div>
              <div className="flex-1 w-full min-h-[140px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <defs>
                      <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#c084fc" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#c084fc" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="time" hide />
                    <YAxis domain={[0, 100]} hide />
                    <Tooltip contentStyle={{ backgroundColor: '#181825', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                    <Area type="monotone" dataKey="mem" stroke="#c084fc" strokeWidth={2} fill="url(#memGrad)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CPU PROCESSES & DETAILS */}
      {activeTab === 'cpu' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-3">
          <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex items-center justify-between shrink-0">
            <div>
              <div className="text-xs text-gray-400">Total CPU Utilization</div>
              <div className="text-3xl font-bold font-mono text-sky-400 mt-1">{liveInfo.cpuPercent}%</div>
              <div className="text-[11px] text-gray-500 mt-0.5">Loads: {liveInfo.loadAvg}</div>
            </div>
            <div className="w-72 h-16">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="cpuMini" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis domain={[0, 100]} hide />
                  <Area type="monotone" dataKey="cpu" stroke="#38bdf8" strokeWidth={2} fill="url(#cpuMini)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="flex-1 min-h-0 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
            <div className="p-3 border-b border-white/[0.08] text-xs font-bold text-gray-300">
              Top Processes by %CPU
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Process Name</th>
                    <th className="py-2 px-3">PID</th>
                    <th className="py-2 px-3">User</th>
                    <th className="py-2 px-3 text-right">% CPU</th>
                    <th className="py-2 px-3 text-right">% Memory</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {[...filteredProcesses].sort((a, b) => b.cpu - a.cpu).map(p => (
                    <tr key={p.pid} className="hover:bg-white/[0.02]">
                      <td className="py-2 px-3 font-bold text-white truncate max-w-xs">{p.name}</td>
                      <td className="py-2 px-3 text-gray-500">{p.pid}</td>
                      <td className="py-2 px-3 text-gray-400">{p.user}</td>
                      <td className="py-2 px-3 text-right font-bold text-sky-400">{p.cpu}%</td>
                      <td className="py-2 px-3 text-right text-gray-400">{p.mem}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: MEMORY DETAILS & ALLOCATIONS */}
      {activeTab === 'memory' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-3">
          <div className="grid grid-cols-4 gap-3 shrink-0">
            <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
              <div className="text-gray-400 text-xs">Used Physical Memory</div>
              <div className="text-xl font-bold font-mono text-purple-400 mt-1">
                {(liveInfo.ramUsed / (1024 * 1024 * 1024)).toFixed(2)} GB
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">{liveInfo.ramPercent}% of Total</div>
            </div>
            <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
              <div className="text-gray-400 text-xs">Available / Free</div>
              <div className="text-xl font-bold font-mono text-emerald-400 mt-1">
                {(liveInfo.ramFree / (1024 * 1024 * 1024)).toFixed(2)} GB
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">Unallocated RAM</div>
            </div>
            <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
              <div className="text-gray-400 text-xs">Cached Buffers</div>
              <div className="text-xl font-bold font-mono text-sky-400 mt-1">
                {(liveInfo.ramCached / (1024 * 1024 * 1024)).toFixed(2)} GB
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">OS File Cache</div>
            </div>
            <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
              <div className="text-gray-400 text-xs">Swap Space</div>
              <div className="text-xl font-bold font-mono text-amber-400 mt-1">
                {(liveInfo.swapUsed / (1024 * 1024 * 1024)).toFixed(2)} GB
              </div>
              <div className="text-[10px] text-gray-500 mt-0.5">of {(liveInfo.swapTotal / (1024 * 1024 * 1024)).toFixed(2)} GB Total</div>
            </div>
          </div>

          <div className="flex-1 min-h-0 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
            <div className="p-3 border-b border-white/[0.08] text-xs font-bold text-gray-300">
              Top Processes by %Memory
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Process Name</th>
                    <th className="py-2 px-3">PID</th>
                    <th className="py-2 px-3">User</th>
                    <th className="py-2 px-3 text-right">% Memory</th>
                    <th className="py-2 px-3 text-right">% CPU</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {[...filteredProcesses].sort((a, b) => b.mem - a.mem).map(p => (
                    <tr key={p.pid} className="hover:bg-white/[0.02]">
                      <td className="py-2 px-3 font-bold text-white truncate max-w-xs">{p.name}</td>
                      <td className="py-2 px-3 text-gray-500">{p.pid}</td>
                      <td className="py-2 px-3 text-gray-400">{p.user}</td>
                      <td className="py-2 px-3 text-right font-bold text-purple-400">{p.mem}%</td>
                      <td className="py-2 px-3 text-right text-gray-400">{p.cpu}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: DISK & STORAGE VOLUMES */}
      {activeTab === 'disk' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-3">
          <div className="bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex-1 flex flex-col">
            <div className="p-3 border-b border-white/[0.08] flex items-center justify-between">
              <span className="text-xs font-bold text-gray-300">Mounted Filesystems & Disks (df -h)</span>
              <span className="text-xs text-gray-400">{disks.length} mounts</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Mount Point</th>
                    <th className="py-2.5 px-3">Filesystem</th>
                    <th className="py-2.5 px-3">Size</th>
                    <th className="py-2.5 px-3">Used</th>
                    <th className="py-2.5 px-3">Available</th>
                    <th className="py-2.5 px-3 w-48">Usage Bar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {disks.map((d, i) => (
                    <tr key={`${d.mount_point}-${i}`} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-bold text-white flex items-center space-x-2">
                        <HardDrive className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{d.mount_point}</span>
                      </td>
                      <td className="py-2.5 px-3 text-gray-400">{d.filesystem}</td>
                      <td className="py-2.5 px-3 text-gray-300 font-semibold">{d.total}</td>
                      <td className="py-2.5 px-3 text-gray-400">{d.used}</td>
                      <td className="py-2.5 px-3 text-emerald-400 font-semibold">{d.available}</td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center space-x-2">
                          <div className="flex-1 bg-white/5 h-2 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                d.percent > 90 ? 'bg-rose-500' : d.percent > 75 ? 'bg-amber-400' : 'bg-emerald-400'
                              }`}
                              style={{ width: `${Math.min(100, d.percent)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-mono w-8 text-right">{d.percent}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: NETWORK ACTIVITY & INTERFACES */}
      {activeTab === 'network' && (
        <div className="flex-1 flex flex-col min-h-0 space-y-4">
          {/* Live Network Throughput Chart */}
          <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex flex-col h-56 shrink-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-gray-300">Live Network Throughput (KB/s)</span>
              <div className="flex items-center space-x-4 text-xs font-mono">
                <span className="text-sky-400 flex items-center space-x-1">
                  <ArrowDown className="w-3.5 h-3.5" />
                  <span>RX: {history[history.length - 1]?.rx || 0} KB/s</span>
                </span>
                <span className="text-emerald-400 flex items-center space-x-1">
                  <ArrowUp className="w-3.5 h-3.5" />
                  <span>TX: {history[history.length - 1]?.tx || 0} KB/s</span>
                </span>
              </div>
            </div>
            <div className="flex-1 w-full min-h-[140px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history}>
                  <defs>
                    <linearGradient id="rxGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="txGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34d399" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" hide />
                  <YAxis hide />
                  <Tooltip contentStyle={{ backgroundColor: '#181825', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="rx" stroke="#38bdf8" strokeWidth={2} fill="url(#rxGrad)" name="Download (RX)" />
                  <Area type="monotone" dataKey="tx" stroke="#34d399" strokeWidth={2} fill="url(#txGrad)" name="Upload (TX)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Network Interfaces Table */}
          <div className="bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex-1 flex flex-col">
            <div className="p-3 border-b border-white/[0.08] flex items-center justify-between">
              <span className="text-xs font-bold text-gray-300">Network Interfaces</span>
              <span className="text-xs text-gray-400">{netInterfaces.length} active interfaces</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0">
                  <tr>
                    <th className="py-2.5 px-3">Interface</th>
                    <th className="py-2.5 px-3">IP Address</th>
                    <th className="py-2.5 px-3">MAC Hardware Address</th>
                    <th className="py-2.5 px-3 text-right">Received (RX)</th>
                    <th className="py-2.5 px-3 text-right">Transmitted (TX)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {netInterfaces.map(iface => (
                    <tr key={iface.name} className="hover:bg-white/[0.02]">
                      <td className="py-2.5 px-3 font-bold text-white flex items-center space-x-2">
                        <Wifi className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span>{iface.name}</span>
                      </td>
                      <td className="py-2.5 px-3 text-sky-400">{iface.ip || '—'}</td>
                      <td className="py-2.5 px-3 text-gray-500">{iface.mac || '—'}</td>
                      <td className="py-2.5 px-3 text-right text-gray-300">
                        {((iface.rx_bytes || 0) / (1024 * 1024)).toFixed(1)} MB
                      </td>
                      <td className="py-2.5 px-3 text-right text-gray-300">
                        {((iface.tx_bytes || 0) / (1024 * 1024)).toFixed(1)} MB
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
