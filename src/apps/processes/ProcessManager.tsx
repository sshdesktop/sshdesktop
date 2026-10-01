import React, { useState, useEffect, useCallback } from 'react';
import { Activity, Search, Trash2, Sliders, RefreshCw, AlertCircle, Play, Square } from 'lucide-react';
import { processList, processKill } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface ProcessRow {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  vsz: string;
  rss: string;
  stat: string;
  start: string;
  command: string;
}

const SAMPLE_PROCESSES: ProcessRow[] = [
  { pid: 1, user: 'root', cpu: 0.1, mem: 0.2, vsz: '168M', rss: '12M', stat: 'S', start: 'Sep01', command: '/sbin/init' },
  { pid: 489, user: 'root', cpu: 0.0, mem: 0.4, vsz: '24M', rss: '8M', stat: 'S', start: 'Sep01', command: '/lib/systemd/systemd-journald' },
  { pid: 1042, user: 'root', cpu: 0.0, mem: 0.2, vsz: '18M', rss: '6M', stat: 'S', start: 'Sep01', command: 'sshd: /usr/sbin/sshd -D' },
  { pid: 1420, user: 'www-data', cpu: 1.2, mem: 0.8, vsz: '82M', rss: '34M', stat: 'S', start: 'Sep02', command: 'nginx: worker process' },
  { pid: 1840, user: 'postgres', cpu: 2.4, mem: 3.1, vsz: '412M', rss: '210M', stat: 'S', start: 'Sep02', command: 'postgres: checkpointer' },
  { pid: 2104, user: 'redis', cpu: 0.4, mem: 1.2, vsz: '64M', rss: '28M', stat: 'S', start: 'Sep02', command: 'redis-server 127.0.0.1:6379' },
  { pid: 3201, user: 'deploy', cpu: 5.8, mem: 4.6, vsz: '1.2G', rss: '380M', stat: 'S', start: '18:14', command: 'node /opt/clouddesk/server.js' },
  { pid: 4120, user: 'root', cpu: 0.8, mem: 1.0, vsz: '1.4G', rss: '120M', stat: 'S', start: 'Sep01', command: '/usr/bin/dockerd -H fd://' },
  { pid: 5012, user: 'root', cpu: 0.0, mem: 0.1, vsz: '12M', rss: '3M', stat: 'S', start: 'Sep01', command: '/usr/sbin/cron -f' },
  { pid: 6184, user: 'deploy', cpu: 0.2, mem: 0.3, vsz: '22M', rss: '8M', stat: 'R', start: '19:40', command: 'ps aux --sort=-%cpu' }
];

export default function ProcessManager() {
  const [processes, setProcesses] = useState<ProcessRow[]>(SAMPLE_PROCESSES);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'cpu' | 'mem' | 'pid'>('cpu');
  const [sortAsc, setSortAsc] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const loadProcesses = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await processList(activeConnId);
      if (list && list.length > 0) {
        setProcesses(list.map((p: any) => ({
          pid: p.pid,
          user: p.user,
          cpu: p.cpu_percent,
          mem: p.mem_percent,
          vsz: `${Math.round((p.vsz || 0) / 1024)}M`,
          rss: `${Math.round((p.rss || 0) / 1024)}M`,
          stat: p.status || 'S',
          start: p.start_time || '—',
          command: p.command || p.name,
        })));
      }
    } catch {}
    setIsLoading(false);
  }, [activeConnId]);

  useEffect(() => {
    loadProcesses();
    if (!autoRefresh) return;
    const interval = setInterval(loadProcesses, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadProcesses]);

  const killProcess = async (pid: number) => {
    try {
      await processKill(activeConnId, pid, 'TERM');
    } catch {}
    setProcesses(prev => prev.filter(p => p.pid !== pid));
    setTimeout(loadProcesses, 800);
  };

  const handleSort = (field: 'cpu' | 'mem' | 'pid') => {
    if (sortBy === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(field);
      setSortAsc(false);
    }
  };

  const filtered = processes
    .filter(p => p.command.toLowerCase().includes(search.toLowerCase()) || p.user.toLowerCase().includes(search.toLowerCase()) || String(p.pid).includes(search))
    .sort((a, b) => {
      const valA = a[sortBy];
      const valB = b[sortBy];
      return sortAsc ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
    });

  const totalCpu = processes.reduce((acc, p) => acc + p.cpu, 0).toFixed(1);
  const totalMem = processes.reduce((acc, p) => acc + p.mem, 0).toFixed(1);

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Metrics Row */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs">Total Processes</div>
          <div className="text-xl font-bold mt-1">{processes.length} tasks</div>
          <div className="text-[11px] text-emerald-400 mt-0.5">1 running, {processes.length - 1} sleeping</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs">Aggregate CPU</div>
          <div className="text-xl font-bold text-blue-400 mt-1">{totalCpu}%</div>
          <div className="text-[11px] text-gray-500 mt-0.5">4 cores active</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs">Process Memory</div>
          <div className="text-xl font-bold text-purple-400 mt-1">{totalMem}%</div>
          <div className="text-[11px] text-gray-500 mt-0.5">~1.8 GB RSS</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs">Auto Refresh</div>
          <div className="flex items-center space-x-2 mt-1">
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-2.5 py-1 rounded text-xs font-bold ${
                autoRefresh ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'
              }`}
            >
              {autoRefresh ? '2s Live' : 'Paused'}
            </button>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search process, user, PID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-[#1e1e2e] border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-[var(--accent)] w-64"
          />
        </div>

        <span className="text-xs text-gray-500">Click column header to sort</span>
      </div>

      {/* Process Table */}
      <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] select-none">
            <tr>
              <th onClick={() => handleSort('pid')} className="py-2.5 px-3 cursor-pointer hover:text-white">
                PID {sortBy === 'pid' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th className="py-2.5 px-3">User</th>
              <th onClick={() => handleSort('cpu')} className="py-2.5 px-3 cursor-pointer hover:text-white">
                CPU % {sortBy === 'cpu' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th onClick={() => handleSort('mem')} className="py-2.5 px-3 cursor-pointer hover:text-white">
                MEM % {sortBy === 'mem' ? (sortAsc ? '▲' : '▼') : ''}
              </th>
              <th className="py-2.5 px-3">VSZ</th>
              <th className="py-2.5 px-3">RSS</th>
              <th className="py-2.5 px-3">State</th>
              <th className="py-2.5 px-3">Command</th>
              <th className="py-2.5 px-3 text-right">Kill</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {filtered.map(p => (
              <tr key={p.pid} className="hover:bg-white/[0.02]">
                <td className="py-2 px-3 font-bold text-white">{p.pid}</td>
                <td className="py-2 px-3 text-gray-400">{p.user}</td>
                <td className={`py-2 px-3 font-bold ${p.cpu > 2 ? 'text-amber-400' : 'text-gray-300'}`}>
                  {p.cpu}%
                </td>
                <td className="py-2 px-3 text-gray-300">{p.mem}%</td>
                <td className="py-2 px-3 text-gray-500">{p.vsz}</td>
                <td className="py-2 px-3 text-gray-400">{p.rss}</td>
                <td className="py-2 px-3">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    p.stat === 'R' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {p.stat}
                  </span>
                </td>
                <td className="py-2 px-3 text-gray-200 truncate max-w-sm">{p.command}</td>
                <td className="py-2 px-3 text-right">
                  <button
                    onClick={() => killProcess(p.pid)}
                    className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400"
                    title="Kill Process (SIGTERM)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
