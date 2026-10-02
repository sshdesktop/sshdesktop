import React, { useState, useEffect, useCallback } from 'react';
import { 
  Activity, Search, Trash2, Sliders, RefreshCw, AlertCircle, 
  Play, Square, Copy, ShieldAlert, X, Terminal, CornerDownRight
} from 'lucide-react';
import { processList, processKill, processRenice } from '../../lib/tauri-bridge';
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

interface ContextMenuState {
  x: number;
  y: number;
  process: ProcessRow;
}

export default function ProcessManager() {
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'cpu' | 'mem' | 'pid'>('cpu');
  const [sortAsc, setSortAsc] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  // Close context menu on outside click
  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const handleTerminate = async (pid: number) => {
    setContextMenu(null);
    if (!confirm(`Send SIGTERM to PID ${pid}?`)) return;
    try {
      await processKill(activeConnId, pid, 'TERM');
      await loadProcesses();
    } catch (err) {
      alert(`Failed to terminate process: ${err}`);
    }
  };

  const handleForceKill = async (pid: number) => {
    setContextMenu(null);
    if (!confirm(`Force kill (SIGKILL -9) PID ${pid}?`)) return;
    try {
      await processKill(activeConnId, pid, 'KILL');
      await loadProcesses();
    } catch (err) {
      alert(`Failed to force kill process: ${err}`);
    }
  };

  const handleRenice = async (proc: ProcessRow) => {
    setContextMenu(null);
    const val = prompt(`Set nice priority (-20 high priority to 19 low priority) for PID ${proc.pid}:`, '0');
    if (val === null) return;
    const num = parseInt(val, 10);
    if (isNaN(num)) return;
    try {
      await processRenice(activeConnId, proc.pid, num);
      await loadProcesses();
    } catch (err) {
      alert(`Renice failed: ${err}`);
    }
  };

  const handleCopyPid = (proc: ProcessRow) => {
    setContextMenu(null);
    navigator.clipboard.writeText(String(proc.pid));
  };

  const handleCopyCommand = (proc: ProcessRow) => {
    setContextMenu(null);
    navigator.clipboard.writeText(proc.command);
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
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-3 min-h-0 overflow-hidden select-none">
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

      {/* Process Table with Full Scroll and Sticky Header */}
      <div className="flex-1 min-h-0 bg-[#1e1e2e] rounded-xl border border-white/[0.08] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10 shadow-sm">
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
                  <tr 
                    key={proc.pid} 
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, process: proc });
                    }}
                    className="hover:bg-white/[0.04] transition-colors cursor-context-menu"
                  >
                    <td className="py-2 px-3 font-bold text-white">{proc.pid}</td>
                    <td className="py-2 px-3 text-purple-400">{proc.user}</td>
                    <td className={`py-2 px-3 ${proc.cpu > 5 ? 'text-amber-400 font-bold' : 'text-gray-300'}`}>
                      {proc.cpu.toFixed(1)}%
                    </td>
                    <td className="py-2 px-3 text-gray-300">{proc.mem.toFixed(1)}%</td>
                    <td className="py-2 px-3 text-gray-500">{proc.vsz} / {proc.rss}</td>
                    <td className="py-2 px-3 text-gray-400">{proc.stat}</td>
                    <td className="py-2 px-3 text-gray-200 truncate max-w-sm" title={proc.command}>{proc.command}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => handleTerminate(proc.pid)}
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

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl py-1.5 w-60 text-xs text-gray-200 font-sans select-none animate-in fade-in duration-100"
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 220),
            left: Math.min(contextMenu.x, window.innerWidth - 250)
          }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3.5 py-1 text-[11px] font-bold text-gray-400 border-b border-white/10 mb-1 truncate">
            PID {contextMenu.process.pid} ({contextMenu.process.user})
          </div>

          <div
            onClick={() => handleForceKill(contextMenu.process.pid)}
            className="px-3.5 py-1.5 hover:bg-rose-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-rose-400"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Force Kill (SIGKILL -9)</span>
          </div>

          <div
            onClick={() => handleTerminate(contextMenu.process.pid)}
            className="px-3.5 py-1.5 hover:bg-amber-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-amber-300"
          >
            <Square className="w-3.5 h-3.5" />
            <span>Quit Process (SIGTERM -15)</span>
          </div>

          <div
            onClick={() => handleRenice(contextMenu.process)}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Change Priority (renice)...</span>
          </div>

          <div className="my-1 border-t border-white/10" />

          <div
            onClick={() => handleCopyPid(contextMenu.process)}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy PID ({contextMenu.process.pid})</span>
          </div>

          <div
            onClick={() => handleCopyCommand(contextMenu.process)}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <CornerDownRight className="w-3.5 h-3.5" />
            <span>Copy Full Command</span>
          </div>
        </div>
      )}
    </div>
  );
}
