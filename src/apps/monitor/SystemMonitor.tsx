import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Cpu, MemoryStick, HardDrive, Wifi, Server, Clock, Activity, Zap } from 'lucide-react';
import { useConnectionStore } from '../../lib/store';
import { systemGetStats, systemGetNetwork } from '../../lib/tauri-bridge';

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
  uptime: string;
  loadAvg: string;
  cpuPercent: number;
  ramPercent: number;
}

export default function SystemMonitor() {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [prevNet, setPrevNet] = useState<{ rx: number; tx: number; time: number } | null>(null);

  const [liveInfo, setLiveInfo] = useState<LiveStats>({
    hostname: 'Connecting...',
    osName: 'Linux',
    osVersion: '',
    kernel: '',
    uptime: '—',
    loadAvg: '0.0, 0.0, 0.0',
    cpuPercent: 0,
    ramPercent: 0,
  });

  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  useEffect(() => {
    let isMounted = true;

    const fetchLive = async () => {
      try {
        const [stats, netList] = await Promise.all([
          systemGetStats(activeConnId),
          systemGetNetwork(activeConnId)
        ]);

        if (!isMounted) return;

        if (stats) {
          const avgCpu = Array.isArray(stats.cpu_percent) && stats.cpu_percent.length > 0
            ? Math.round(stats.cpu_percent[0])
            : 0;

          const ramTotal = stats.ram_total || 1;
          const ramUsed = stats.ram_used || 0;
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
            uptime: `${days}d ${hours}h ${mins}m`,
            loadAvg: loads,
            cpuPercent: avgCpu,
            ramPercent: ramPct,
          });

          // Calculate real network KB/s delta
          let totalRx = 0;
          let totalTx = 0;
          if (Array.isArray(netList)) {
            netList.forEach((n: any) => {
              totalRx += n.rx_bytes || 0;
              totalTx += n.tx_bytes || 0;
            });
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
            return updated.length > 20 ? updated.slice(updated.length - 20) : updated;
          });
        }
      } catch (err) {
        console.warn('System monitor fetch error:', err);
      }
    };

    fetchLive();
    const interval = setInterval(fetchLive, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeConnId, activeServer]);

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto select-none">
      {/* Top Node Specs Banner */}
      <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-base text-white">{liveInfo.hostname}</span>
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-400">
                LIVE SSH
              </span>
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {liveInfo.osName} {liveInfo.osVersion} · Kernel: {liveInfo.kernel}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-6 text-xs font-mono">
          <div>
            <span className="text-gray-500 block text-[10px]">UPTIME</span>
            <span className="text-gray-200">{liveInfo.uptime}</span>
          </div>
          <div>
            <span className="text-gray-500 block text-[10px]">LOAD AVERAGE</span>
            <span className="text-gray-200">{liveInfo.loadAvg}</span>
          </div>
        </div>
      </div>

      {/* Real-time Metric Gauges */}
      <div className="grid grid-cols-2 gap-3 shrink-0">
        <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2 text-xs text-gray-400">
              <Cpu className="w-4 h-4 text-blue-400" />
              <span>CPU Utilization</span>
            </div>
            <div className="text-3xl font-bold font-mono text-white mt-2">
              {liveInfo.cpuPercent}%
            </div>
            <div className="text-[11px] text-gray-500 mt-1">Queried live from /proc/stat</div>
          </div>
          <div className="w-24 h-24 rounded-full border-4 border-blue-500/20 flex items-center justify-center relative">
            <div
              className="absolute inset-0 rounded-full border-4 border-blue-400 border-t-transparent animate-spin"
              style={{ animationDuration: '6s' }}
            />
            <span className="font-bold font-mono text-sm text-blue-400">{liveInfo.cpuPercent}%</span>
          </div>
        </div>

        <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex items-center justify-between">
          <div>
            <div className="flex items-center space-x-2 text-xs text-gray-400">
              <MemoryStick className="w-4 h-4 text-purple-400" />
              <span>Memory Usage</span>
            </div>
            <div className="text-3xl font-bold font-mono text-white mt-2">
              {liveInfo.ramPercent}%
            </div>
            <div className="text-[11px] text-gray-500 mt-1">Queried live from /proc/meminfo</div>
          </div>
          <div className="w-24 h-24 rounded-full border-4 border-purple-500/20 flex items-center justify-center relative">
            <div
              className="absolute inset-0 rounded-full border-4 border-purple-400 border-t-transparent animate-spin"
              style={{ animationDuration: '8s' }}
            />
            <span className="font-bold font-mono text-sm text-purple-400">{liveInfo.ramPercent}%</span>
          </div>
        </div>
      </div>

      {/* Real-time Trend Charts */}
      <div className="grid grid-cols-2 gap-4 flex-1 min-h-[220px]">
        {/* CPU Chart */}
        <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-300">CPU Usage History</span>
            <span className="text-xs font-mono text-blue-400">{liveInfo.cpuPercent}%</span>
          </div>
          <div className="flex-1 w-full min-h-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#89b4fa" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#89b4fa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" hide />
                <YAxis domain={[0, 100]} hide />
                <Tooltip
                  contentStyle={{ backgroundColor: '#181825', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
                />
                <Area type="monotone" dataKey="cpu" stroke="#89b4fa" strokeWidth={2} fill="url(#cpuGrad)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Memory Chart */}
        <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-300">Memory Trend</span>
            <span className="text-xs font-mono text-purple-400">{liveInfo.ramPercent}%</span>
          </div>
          <div className="flex-1 w-full min-h-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#cba6f7" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#cba6f7" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="time" hide />
                <YAxis domain={[0, 100]} hide />
                <Tooltip
                  contentStyle={{ backgroundColor: '#181825', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
                />
                <Area type="monotone" dataKey="mem" stroke="#cba6f7" strokeWidth={2} fill="url(#memGrad)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
