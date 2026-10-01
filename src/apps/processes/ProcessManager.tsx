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

export default function ProcessManager() {
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
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
      if (list && Array.isArray(list)) {
        setProcesses(list.map((p: any) => ({
          pid: p.pid,
          user: p.user || 'root',
          cpu: p.cpu_percent || 0,
          mem: p.mem_percent || 0,
          vsz: p.vsz ? `${(p.vsz / 1024).toFixed(0)}M` : '—',
          rss: p.rss ? `${(p.rss / 1024).toFixed(0)}M` : '—',
          stat: p.status || 'S',
          start: p.start_time || '',
          command: p.command || p.name || 'process'
        })));
      } else {
        setProcesses([]);
      }
    } catch (err) {
      console.warn('Process list failed:', err);
      setProcesses([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadProcesses();
  }, [loadProcesses]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(loadProcesses, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadProcesses]);

  const killProcess = async (pid: number) => {
    if (!confirm(`Are you sure you want to terminate PID ${pid}?`)) return;
    try {
      await processKill(activeConnId, pid, 'TERM');
      await loadProcesses();
    } catch (err) {
      alert(`Failed to kill process: ${err}`);
    }
  };

  const sorted = [...processes]
    .filter(p =>
      p.command.toLowerCase().includes(search.toLowerCase()) ||
      p.user.toLowerCase().includes(search.toLowerCase()) ||
      String(p.pid).includes(search)
    )
    .sort((a, b) => {
      let diff = 0;
      if (sortBy === 'cpu') diff = a.cpu - b.cpu;
      else if (sortBy === 'mem') diff = a.mem - b.mem;
      else if (sortBy === 'pid') diff = a.pid - b.pid;
      return sortAsc ? diff : -diff;
    });

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Top Controls */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-rose-400" />
            <h2 className="font-bold text-sm text-white">Process Manager</h2>
            <span className="text-xs text-gray-400">({processes.length} active processes)</span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search PID, name, user..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#1e1e2e] border border-white/10 rounded-lg pl-8 pr-3 py-1 text-xs text-gray-200 focus:outline-none w-56"
            />
          </div>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              autoRefresh ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-gray-400 hover:text-white'
            }`}
          >
            {autoRefresh ? 'Auto 3s: ON' : 'Auto: OFF'}
          </button>

          <button
            onClick={loadProcesses}
            disabled={isLoading}
            className="p-1.5 bg-[#1e1e2e] hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 hover:text-white transition-colors"
            title="Refresh Processes"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Process Table */}
      <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] select-none">
            <tr>
              <th
                onClick={() => {
                  if (sortBy === 'pid') setSortAsc(!sortAsc);
                  else { setSortBy('pid'); setSortAsc(false); }
                }}
                className="py-2.5 px-3 cursor-pointer hover:text-white"
              >
                PID {sortBy === 'pid' && (sortAsc ? '▲' : '▼')}
              </th>
              <th className="py-2.5 px-3">User</th>
              <th
                onClick={() => {
                  if (sortBy === 'cpu') setSortAsc(!sortAsc);
                  else { setSortBy('cpu'); setSortAsc(false); }
                }}
                className="py-2.5 px-3 cursor-pointer hover:text-white"
              >
                CPU% {sortBy === 'cpu' && (sortAsc ? '▲' : '▼')}
              </th>
              <th
                onClick={() => {
                  if (sortBy === 'mem') setSortAsc(!sortAsc);
                  else { setSortBy('mem'); setSortAsc(false); }
                }}
                className="py-2.5 px-3 cursor-pointer hover:text-white"
              >
                MEM% {sortBy === 'mem' && (sortAsc ? '▲' : '▼')}
              </th>
              <th className="py-2.5 px-3">VSZ / RSS</th>
              <th className="py-2.5 px-3">Stat</th>
              <th className="py-2.5 px-3">Command</th>
              <th className="py-2.5 px-3 text-right">Kill</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center text-gray-500 font-sans text-xs">
                  {isLoading ? 'Scanning processes via ps aux...' : 'No processes found'}
                </td>
              </tr>
            ) : (
              sorted.map(proc => (
                <tr key={proc.pid} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2 px-3 font-bold text-white">{proc.pid}</td>
                  <td className="py-2 px-3 text-purple-400">{proc.user}</td>
                  <td className={`py-2 px-3 ${proc.cpu > 5 ? 'text-amber-400 font-bold' : 'text-gray-300'}`}>
                    {proc.cpu.toFixed(1)}%
                  </td>
                  <td className="py-2 px-3 text-gray-300">{proc.mem.toFixed(1)}%</td>
                  <td className="py-2 px-3 text-gray-500">{proc.vsz} / {proc.rss}</td>
                  <td className="py-2 px-3 text-gray-400">{proc.stat}</td>
                  <td className="py-2 px-3 text-gray-200 truncate max-w-sm">{proc.command}</td>
                  <td className="py-2 px-3 text-right">
                    <button
                      onClick={() => killProcess(proc.pid)}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400"
                      title="Terminate (SIGTERM)"
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
    </div>
  );
}
