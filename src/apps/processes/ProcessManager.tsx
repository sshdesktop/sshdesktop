import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Activity, Search, Trash2, Sliders, RefreshCw, AlertCircle, 
  Play, Square, Copy, ShieldAlert, X, Terminal, CornerDownRight,
  Info, Pause, PlayCircle, RotateCcw, Filter, ChevronUp, ChevronDown,
  Layers, HardDrive, Cpu, MemoryStick, OctagonX, CheckCircle2, Clock,
  FileCode, Network, GitFork, ListFilter, ArrowDownUp, Check, ExternalLink,
  Flame, Lock, Shield, Gauge
} from 'lucide-react';
import { processList, processKill, processRenice, sshExec, systemGetStats } from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';

interface ProcessRow {
  pid: number;
  ppid?: number;
  user: string;
  cpu: number;
  mem: number;
  vsz: string;
  rss: string;
  stat: string;
  start: string;
  command: string;
  name: string;
  children?: ProcessRow[];
  depth?: number;
}

interface ProcessDetails {
  pid: number;
  ppid?: number;
  name: string;
  user: string;
  cpu: number;
  mem: number;
  rss: string;
  vsz: string;
  stat: string;
  start: string;
  command: string;
  threads?: number;
  nice?: number;
  openFiles?: string[];
  sampleStack?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  process: ProcessRow;
}

export default function ProcessManager() {
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState<'all' | 'user' | 'system' | 'active'>('all');
  const [viewLayout, setViewLayout] = useState<'flat' | 'tree'>('flat');
  const [activeTab, setActiveTab] = useState<'cpu' | 'memory' | 'status'>('cpu');
  const [sortBy, setSortBy] = useState<'cpu' | 'mem' | 'pid' | 'name' | 'user'>('cpu');
  const [sortAsc, setSortAsc] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState<number>(5); // seconds, 0 = paused
  const [isLoading, setIsLoading] = useState(false);
  const [systemStats, setSystemStats] = useState<any>(null);
  const isFetchingRef = useRef(false);
  
  // Modals & Inspector
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [inspectProcess, setInspectProcess] = useState<ProcessDetails | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'stats' | 'files' | 'sample'>('stats');
  const [loadingInspectorData, setLoadingInspectorData] = useState(false);
  const [reniceValue, setReniceValue] = useState<number>(0);

  const [showQuitModal, setShowQuitModal] = useState<ProcessRow | null>(null);
  const [actionNotice, setActionNotice] = useState<{ text: string; isError: boolean } | null>(null);

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });
  const currentUsername = activeServer?.username || 'root';
  const { openApp } = useWindowManager();
  const { runTerminalCommand } = useEditorStore();

  const loadProcesses = useCallback(async () => {
    if (isFetchingRef.current || (typeof document !== 'undefined' && document.hidden)) return;
    isFetchingRef.current = true;
    setIsLoading(true);
    try {
      // Run ps -eo pid,ppid,user,%cpu,%mem,vsz,rss,stat,start,comm,args alongside system stats
      const [list, stats] = await Promise.all([
        processList(activeConnId).catch(() => []),
        systemGetStats(activeConnId).catch(() => null)
      ]);
      if (stats) {
        setSystemStats(stats);
      }
      if (list && Array.isArray(list)) {
        setProcesses(list.map((p: any) => {
          const cmd = p.command || p.name || 'process';
          const parts = cmd.trim().split(/\s+/);
          const fullExe = parts[0] || 'process';
          const exeName = fullExe.split('/').pop() || fullExe;

          return {
            pid: p.pid,
            ppid: p.ppid || 1,
            user: p.user || 'root',
            cpu: Number(p.cpu_percent) || 0,
            mem: Number(p.mem_percent) || 0,
            vsz: p.vsz ? `${(p.vsz / 1024).toFixed(0)}M` : '—',
            rss: p.rss ? `${(p.rss / 1024).toFixed(0)}M` : '—',
            stat: p.status || 'S',
            start: p.start_time || '',
            command: cmd,
            name: exeName
          };
        }));
      } else {
        setProcesses([]);
      }
    } catch (err) {
      console.warn('Process list failed:', err);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, [activeConnId]);

  useEffect(() => {
    loadProcesses();
  }, [loadProcesses]);

  useEffect(() => {
    if (refreshInterval <= 0) return;
    const interval = setInterval(loadProcesses, refreshInterval * 1000);
    return () => clearInterval(interval);
  }, [refreshInterval, loadProcesses]);

  // Close context menu on outside click
  useEffect(() => {
    const handleCloseMenu = () => setContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, []);

  const selectedProcess = useMemo(() => {
    return processes.find(p => p.pid === selectedPid) || null;
  }, [processes, selectedPid]);

  // Inspector opener with deep details
  const handleOpenInspector = async (proc: ProcessRow) => {
    setInspectorTab('stats');
    setInspectProcess({
      ...proc,
      threads: 1,
      nice: 0,
      openFiles: [],
      sampleStack: 'Sampling kernel state...'
    });

    setLoadingInspectorData(true);
    try {
      const res = await sshExec(
        activeConnId, 
        `ps -o ppid=,nlwp=,nice= -p ${proc.pid} 2>/dev/null; ls -l /proc/${proc.pid}/fd 2>/dev/null | head -n 30 | awk '{print $9, "->", $11}'; cat /proc/${proc.pid}/wchan 2>/dev/null; cat /proc/${proc.pid}/stack 2>/dev/null`
      );

      const out = res.stdout || '';
      const lines = out.split('\n');
      const psStats = lines[0]?.trim().split(/\s+/);
      const ppid = psStats && psStats[0] ? parseInt(psStats[0], 10) : 1;
      const threads = psStats && psStats[1] ? parseInt(psStats[1], 10) : 1;
      const nice = psStats && psStats[2] ? parseInt(psStats[2], 10) : 0;
      setReniceValue(nice);

      // Open files
      const fdLines = lines.slice(1).filter(l => l.includes('->'));
      const sampleText = lines.filter(l => !l.includes('->')).slice(1).join('\n').trim();

      setInspectProcess(prev => prev ? {
        ...prev,
        ppid,
        threads,
        nice,
        openFiles: fdLines.length > 0 ? fdLines : ['(No accessible file descriptors)'],
        sampleStack: sampleText || 'Process is currently idling or waiting for I/O events.'
      } : null);
    } catch {
      // Fallback
    } finally {
      setLoadingInspectorData(false);
    }
  };

  // Signal Handlers
  const handleSignal = async (pid: number, signal: string, label: string) => {
    setContextMenu(null);
    setShowQuitModal(null);
    try {
      if (signal === 'TERM' || signal === 'KILL') {
        await processKill(activeConnId, pid, signal);
      } else {
        await sshExec(activeConnId, `kill -${signal} ${pid}`);
      }
      setActionNotice({ text: `Sent SIG${signal} (${label}) to PID ${pid}`, isError: false });
      setTimeout(() => setActionNotice(null), 3500);
      await loadProcesses();
      if (inspectProcess?.pid === pid && signal === 'KILL') {
        setInspectProcess(null);
      }
    } catch (err: any) {
      setActionNotice({ text: `Signal failed: ${err?.message || err}`, isError: true });
    }
  };

  const handleApplyRenice = async (pid: number, val: number) => {
    try {
      await processRenice(activeConnId, pid, val);
      setActionNotice({ text: `Priority for PID ${pid} set to ${val}`, isError: false });
      setTimeout(() => setActionNotice(null), 3500);
      await loadProcesses();
    } catch (err: any) {
      setActionNotice({ text: `Renice failed: ${err?.message || err}`, isError: true });
    }
  };

  const handleOpenTerminalInspect = (proc: ProcessRow) => {
    setContextMenu(null);
    runTerminalCommand(`ps -fp ${proc.pid} && top -p ${proc.pid}\n`);
    openApp('terminal', 'Terminal');
  };

  // Filter processes
  const filtered = useMemo(() => {
    return processes.filter(p => {
      const matchesSearch = 
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.command.toLowerCase().includes(search.toLowerCase()) ||
        p.user.toLowerCase().includes(search.toLowerCase()) ||
        String(p.pid).includes(search);

      if (!matchesSearch) return false;

      if (filterCategory === 'user') return p.user === currentUsername;
      if (filterCategory === 'system') return p.user === 'root';
      if (filterCategory === 'active') return p.cpu > 0.1 || p.mem > 0.5;
      return true;
    });
  }, [processes, search, filterCategory, currentUsername]);

  // Hierarchical Tree View calculation
  const treeSorted = useMemo(() => {
    if (viewLayout === 'flat') {
      return [...filtered].sort((a, b) => {
        let diff = 0;
        if (sortBy === 'cpu') diff = a.cpu - b.cpu;
        else if (sortBy === 'mem') diff = a.mem - b.mem;
        else if (sortBy === 'pid') diff = a.pid - b.pid;
        else if (sortBy === 'name') diff = a.name.localeCompare(b.name);
        else if (sortBy === 'user') diff = a.user.localeCompare(b.user);
        return sortAsc ? diff : -diff;
      });
    }

    // Build tree
    const map = new Map<number, ProcessRow>();
    const roots: ProcessRow[] = [];
    filtered.forEach(p => map.set(p.pid, { ...p, children: [] }));

    map.forEach(p => {
      if (p.ppid && map.has(p.ppid) && p.ppid !== p.pid) {
        map.get(p.ppid)!.children!.push(p);
      } else {
        roots.push(p);
      }
    });

    const flattened: ProcessRow[] = [];
    const traverse = (node: ProcessRow, depth: number) => {
      flattened.push({ ...node, depth });
      if (node.children && node.children.length > 0) {
        node.children.sort((a, b) => b.cpu - a.cpu);
        node.children.forEach(c => traverse(c, depth + 1));
      }
    };

    roots.sort((a, b) => b.cpu - a.cpu);
    roots.forEach(r => traverse(r, 0));
    return flattened;
  }, [filtered, viewLayout, sortBy, sortAsc]);

  // Aggregate Metrics for macOS Gauges
  const totalCpuUsage = useMemo(() => {
    if (systemStats?.cpu_percent && Array.isArray(systemStats.cpu_percent) && systemStats.cpu_percent.length > 0) {
      return Math.min(100, Math.max(0, parseFloat((Number(systemStats.cpu_percent[0]) || 0).toFixed(1))));
    }
    const cores = systemStats?.cpu_cores || 4;
    const sumCpu = processes.reduce((acc, p) => acc + (p.cpu || 0), 0);
    return Math.min(100, Math.max(0, parseFloat((sumCpu / (cores * 10)).toFixed(1))));
  }, [systemStats, processes]);

  const totalMemUsage = useMemo(() => {
    if (systemStats?.ram_total && systemStats.ram_total > 0) {
      return Math.min(100, Math.max(0, parseFloat(((systemStats.ram_used / systemStats.ram_total) * 100).toFixed(1))));
    }
    return Math.min(100, parseFloat((processes.reduce((acc, p) => acc + p.mem, 0) / 4).toFixed(1)));
  }, [systemStats, processes]);

  const runningCount = useMemo(() => processes.filter(p => p.stat.includes('R')).length, [processes]);
  const sleepingCount = useMemo(() => processes.filter(p => p.stat.includes('S') || p.stat.includes('I')).length, [processes]);
  const zombieCount = useMemo(() => processes.filter(p => p.stat.includes('Z')).length, [processes]);

  const handleSort = (column: 'cpu' | 'mem' | 'pid' | 'name' | 'user') => {
    if (sortBy === column) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(column);
      setSortAsc(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none min-h-0 overflow-hidden font-sans">
      {/* macOS Top Toolbar & Segmented View Bar */}
      <div className="bg-[#14141e]/90 backdrop-blur-2xl border-b border-white/[0.08] px-4 py-2.5 flex items-center justify-between shrink-0 space-x-3">
        {/* Left: macOS Stop (Quit Process) & Inspect buttons */}
        <div className="flex items-center space-x-2">
          {/* Quit Process Button (macOS Octagon-X icon) */}
          <button
            onClick={() => selectedProcess && setShowQuitModal(selectedProcess)}
            disabled={!selectedProcess}
            className={`mac-btn mac-btn-danger mac-btn-sheen flex items-center space-x-1.5 ${
              !selectedProcess ? 'opacity-40 cursor-not-allowed' : ''
            }`}
            title="Quit or Force Quit Process"
          >
            <OctagonX className="w-4 h-4" />
            <span>Quit Process</span>
          </button>

          {/* Inspect Process Button */}
          <button
            onClick={() => selectedProcess && handleOpenInspector(selectedProcess)}
            disabled={!selectedProcess}
            className={`mac-btn mac-btn-secondary mac-btn-sheen flex items-center space-x-1.5 ${
              !selectedProcess ? 'opacity-40 cursor-not-allowed' : ''
            }`}
            title="Inspect Process Details"
          >
            <Info className="w-4 h-4 text-blue-400" />
            <span>Inspect</span>
          </button>

          <div className="h-4 w-px bg-white/10 mx-1" />

          {/* Segmented View Mode Tabs: [ CPU | Memory | Status ] */}
          <div className="mac-segmented-container">
            <button
              onClick={() => { setActiveTab('cpu'); setSortBy('cpu'); setSortAsc(false); }}
              className={`mac-segmented-item ${activeTab === 'cpu' ? 'active' : ''}`}
            >
              CPU
            </button>
            <button
              onClick={() => { setActiveTab('memory'); setSortBy('mem'); setSortAsc(false); }}
              className={`mac-segmented-item ${activeTab === 'memory' ? 'active' : ''}`}
            >
              Memory
            </button>
            <button
              onClick={() => setActiveTab('status')}
              className={`mac-segmented-item ${activeTab === 'status' ? 'active' : ''}`}
            >
              State & I/O
            </button>
          </div>

          {/* Flat List vs Hierarchical Tree View Toggle */}
          <div className="mac-segmented-container">
            <button
              onClick={() => setViewLayout('flat')}
              className={`mac-segmented-item ${viewLayout === 'flat' ? 'active' : ''}`}
              title="Flat Process List"
            >
              Flat
            </button>
            <button
              onClick={() => setViewLayout('tree')}
              className={`mac-segmented-item flex items-center space-x-1 ${viewLayout === 'tree' ? 'active' : ''}`}
              title="Hierarchical Process Tree (Parent/Child)"
            >
              <GitFork className="w-3 h-3" />
              <span>Tree</span>
            </button>
          </div>
        </div>

        {/* Right Controls: Filter Selector, Search Pill, Auto Refresh */}
        <div className="flex items-center space-x-2">
          {/* Filter Dropdown */}
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value as any)}
            className="bg-[#101018] border border-white/10 rounded-xl px-2.5 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-400 font-sans"
          >
            <option value="all">All Processes ({processes.length})</option>
            <option value="user">My Processes ({processes.filter(p => p.user === currentUsername).length})</option>
            <option value="system">System (root) Processes</option>
            <option value="active">Active Processes (&gt;0.1% CPU)</option>
          </select>

          {/* Search Pill */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#101018] border border-white/10 rounded-xl pl-8 pr-7 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 w-36 focus:w-48 transition-all shadow-inner"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white p-0.5">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Refresh Interval Selector */}
          <select
            value={refreshInterval}
            onChange={(e) => setRefreshInterval(Number(e.target.value))}
            className="bg-[#101018] border border-white/10 rounded-xl px-2 py-1 text-xs text-gray-300 focus:outline-none font-mono"
            title="Update Frequency"
          >
            <option value="1">1s</option>
            <option value="3">3s</option>
            <option value="5">5s</option>
            <option value="0">Pause</option>
          </select>

          {/* Manual Refresh Button */}
          <button
            onClick={loadProcesses}
            disabled={isLoading}
            className="mac-btn-icon"
            title="Refresh Process List"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Action Notification Toast */}
      {actionNotice && (
        <div className={`mx-4 mt-2 px-3 py-2 rounded-xl text-xs flex items-center justify-between animate-in fade-in slide-in-from-top-1 ${
          actionNotice.isError ? 'bg-red-500/20 text-red-300 border border-red-500/40' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
        }`}>
          <div className="flex items-center space-x-2">
            {actionNotice.isError ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            <span className="font-medium font-mono">{actionNotice.text}</span>
          </div>
          <button onClick={() => setActionNotice(null)} className="text-gray-400 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Process Table with macOS Highlighting & Indented Tree View */}
      <div className={`flex-1 min-h-0 bg-[#161622] flex flex-col overflow-hidden relative ${isLoading ? 'cursor-mac-wait' : ''}`}>
        {isLoading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-20 pointer-events-none" />
        )}
        <div className="flex-1 overflow-y-auto overflow-x-auto scrollbar-thin">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead className="bg-[#11111a] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10 shadow-sm">
              <tr>
                <th
                  onClick={() => handleSort('name')}
                  className="py-2 px-3 cursor-pointer hover:text-white transition-colors"
                >
                  <div className="flex items-center space-x-1 font-sans">
                    <span>Process Name</span>
                    {sortBy === 'name' && (sortAsc ? <ChevronUp className="w-3 h-3 text-blue-400" /> : <ChevronDown className="w-3 h-3 text-blue-400" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('pid')}
                  className="py-2 px-3 cursor-pointer hover:text-white transition-colors w-20 text-right"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>PID</span>
                    {sortBy === 'pid' && (sortAsc ? <ChevronUp className="w-3 h-3 text-blue-400" /> : <ChevronDown className="w-3 h-3 text-blue-400" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('cpu')}
                  className="py-2 px-3 cursor-pointer hover:text-white transition-colors w-24 text-right"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>% CPU</span>
                    {sortBy === 'cpu' && (sortAsc ? <ChevronUp className="w-3 h-3 text-blue-400" /> : <ChevronDown className="w-3 h-3 text-blue-400" />)}
                  </div>
                </th>
                <th
                  onClick={() => handleSort('mem')}
                  className="py-2 px-3 cursor-pointer hover:text-white transition-colors w-24 text-right"
                >
                  <div className="flex items-center justify-end space-x-1">
                    <span>% MEM</span>
                    {sortBy === 'mem' && (sortAsc ? <ChevronUp className="w-3 h-3 text-blue-400" /> : <ChevronDown className="w-3 h-3 text-blue-400" />)}
                  </div>
                </th>
                <th className="py-2 px-3 text-right w-24">Real Mem (RSS)</th>
                <th className="py-2 px-3 text-right w-24">Virtual (VSZ)</th>
                <th
                  onClick={() => handleSort('user')}
                  className="py-2 px-3 cursor-pointer hover:text-white transition-colors w-28"
                >
                  <div className="flex items-center space-x-1 font-sans">
                    <span>User</span>
                    {sortBy === 'user' && (sortAsc ? <ChevronUp className="w-3 h-3 text-blue-400" /> : <ChevronDown className="w-3 h-3 text-blue-400" />)}
                  </div>
                </th>
                <th className="py-2 px-3 w-16 text-center">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {treeSorted.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-gray-500 font-sans text-xs">
                    {isLoading ? 'Scanning processes via ps aux...' : 'No matching processes found'}
                  </td>
                </tr>
              ) : (
                treeSorted.map((proc, index) => {
                  const isSelected = selectedPid === proc.pid;
                  const isZebra = index % 2 === 1;
                  const isHighCpu = proc.cpu > 15;
                  const depth = proc.depth || 0;

                  return (
                    <tr
                      key={proc.pid}
                      onClick={() => setSelectedPid(proc.pid)}
                      onDoubleClick={() => handleOpenInspector(proc)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedPid(proc.pid);
                        setContextMenu({ x: e.clientX, y: e.clientY, process: proc });
                      }}
                      className={`cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white font-medium shadow-inner'
                          : isZebra
                          ? 'bg-white/[0.015] hover:bg-white/[0.04]'
                          : 'bg-transparent hover:bg-white/[0.04]'
                      }`}
                    >
                      <td className="py-1.5 px-3 truncate max-w-xs font-sans">
                        <div 
                          className="flex items-center space-x-2"
                          style={{ paddingLeft: `${depth * 16}px` }}
                        >
                          {depth > 0 && <span className="text-gray-500 font-mono text-[10px]">└──</span>}
                          {isHighCpu && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping shrink-0" />
                          )}
                          <Activity className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-white' : 'text-blue-400'}`} />
                          <span className="truncate font-medium">{proc.name}</span>
                          <span className={`text-[10px] truncate max-w-xs ${isSelected ? 'text-blue-100' : 'text-gray-500'}`} title={proc.command}>
                            {proc.command}
                          </span>
                        </div>
                      </td>
                      <td className={`py-1.5 px-3 text-right font-mono ${isSelected ? 'text-white' : 'text-gray-400'}`}>
                        {proc.pid}
                      </td>
                      <td className={`py-1.5 px-3 text-right font-mono ${
                        isSelected 
                          ? 'text-white font-bold' 
                          : proc.cpu > 5 
                          ? 'text-amber-400 font-bold' 
                          : 'text-gray-300'
                      }`}>
                        {proc.cpu.toFixed(1)}%
                      </td>
                      <td className={`py-1.5 px-3 text-right font-mono ${isSelected ? 'text-white' : 'text-gray-300'}`}>
                        {proc.mem.toFixed(1)}%
                      </td>
                      <td className={`py-1.5 px-3 text-right font-mono ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
                        {proc.rss}
                      </td>
                      <td className={`py-1.5 px-3 text-right font-mono ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                        {proc.vsz}
                      </td>
                      <td className={`py-1.5 px-3 truncate font-sans ${isSelected ? 'text-white' : 'text-purple-300'}`}>
                        {proc.user}
                      </td>
                      <td className="py-1.5 px-3 text-center">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : proc.stat.includes('R')
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : proc.stat.includes('Z')
                            ? 'bg-rose-500/20 text-rose-400'
                            : 'bg-white/5 text-gray-400'
                        }`}>
                          {proc.stat}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* macOS Activity Monitor Live Bottom Dashboard with Animated Visual Gauges */}
        <div className="bg-[#11111a] border-t border-white/[0.08] px-5 py-3 flex items-center justify-between text-xs shrink-0 font-sans shadow-lg">
          <div className="flex items-center space-x-8">
            {/* CPU Load Gauge Bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span className="flex items-center space-x-1.5">
                  <Cpu className="w-3.5 h-3.5 text-blue-400" />
                  <span>CPU Load</span>
                </span>
                <span className="font-mono font-bold text-white ml-2">{totalCpuUsage.toFixed(1)}%</span>
              </div>
              <div className="w-36 h-2 bg-gray-800 rounded-full overflow-hidden border border-white/10">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-300"
                  style={{ width: `${totalCpuUsage}%` }}
                />
              </div>
            </div>

            {/* Memory Pressure Gauge Bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span className="flex items-center space-x-1.5">
                  <MemoryStick className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Memory Usage</span>
                </span>
                <span className="font-mono font-bold text-white ml-2">{totalMemUsage.toFixed(1)}%</span>
              </div>
              <div className="w-36 h-2 bg-gray-800 rounded-full overflow-hidden border border-white/10">
                <div 
                  className={`h-full rounded-full transition-all duration-300 ${
                    totalMemUsage > 80 ? 'bg-rose-500' : totalMemUsage > 50 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${totalMemUsage}%` }}
                />
              </div>
            </div>

            {/* Process Count Badges */}
            <div className="flex items-center space-x-3 text-xs text-gray-400">
              <span className="flex items-center space-x-1.5">
                <Activity className="w-3.5 h-3.5 text-blue-400" />
                <span><b>{processes.length}</b> Processes</span>
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold border border-emerald-500/30">
                {runningCount} Running
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/5 text-gray-400 text-[10px]">
                {sleepingCount} Sleeping
              </span>
              {zombieCount > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-semibold">
                  {zombieCount} Zombie
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-3 text-[11px] text-gray-500">
            <span>Double click to Inspect</span>
            <span>·</span>
            <span>Right-click for Signal controls</span>
          </div>
        </div>
      </div>

      {/* macOS Quit Process Confirmation Sheet */}
      {showQuitModal && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150"
          onClick={() => setShowQuitModal(null)}
        >
          <div 
            className="bg-[#1e1e2e]/95 border border-white/20 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start space-x-3">
              <div className="w-11 h-11 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
                <OctagonX className="w-6 h-6 text-rose-400" />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-white">
                  Quit &ldquo;{showQuitModal.name}&rdquo;?
                </h3>
                <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                  Are you sure you want to quit this process? PID: <span className="font-mono text-white">{showQuitModal.pid}</span> (User: {showQuitModal.user}).
                </p>
              </div>
            </div>

            <div className="p-3 bg-[#11111b] rounded-2xl border border-white/10 font-mono text-[11px] text-gray-300 truncate">
              {showQuitModal.command}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
              <button
                onClick={() => setShowQuitModal(null)}
                className="px-4 py-2 rounded-xl text-xs text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSignal(showQuitModal.pid, 'TERM', 'Quit')}
                className="px-4 py-2 rounded-xl text-xs bg-amber-600 hover:bg-amber-500 text-white font-medium transition-all shadow-md active:scale-95"
              >
                Quit (SIGTERM)
              </button>
              <button
                onClick={() => handleSignal(showQuitModal.pid, 'KILL', 'Force Quit')}
                className="px-4 py-2 rounded-xl text-xs bg-rose-600 hover:bg-rose-500 text-white font-medium transition-all shadow-md active:scale-95"
              >
                Force Quit (SIGKILL)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* macOS Process Inspector Sheet (With Tabs: Stats, Open Files, Sample Stack) */}
      {inspectProcess && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150"
          onClick={() => setInspectProcess(null)}
        >
          <div 
            className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-4 font-sans max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">{inspectProcess.name}</h3>
                  <div className="text-xs text-gray-400 font-mono">PID: {inspectProcess.pid} · User: {inspectProcess.user}</div>
                </div>
              </div>
              <button
                onClick={() => setInspectProcess(null)}
                className="p-1.5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inspector Segmented Tabs */}
            <div className="flex items-center bg-white/[0.06] rounded-xl p-0.5 border border-white/10 shrink-0">
              <button
                onClick={() => setInspectorTab('stats')}
                className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
                  inspectorTab === 'stats' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                }`}
              >
                Metrics & Priority
              </button>
              <button
                onClick={() => setInspectorTab('files')}
                className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
                  inspectorTab === 'files' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                }`}
              >
                Open Files & Sockets
              </button>
              <button
                onClick={() => setInspectorTab('sample')}
                className={`flex-1 py-1 rounded-lg text-xs font-semibold transition-all ${
                  inspectorTab === 'sample' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                }`}
              >
                Sample Process Stack
              </button>
            </div>

            {/* TAB 1: METRICS & PRIORITY */}
            {inspectorTab === 'stats' && (
              <div className="space-y-4 overflow-y-auto scrollbar-thin flex-1 pr-1">
                {/* Metrics Grid */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-[#12121e] border border-white/10 rounded-2xl p-3 text-center">
                    <div className="text-[10px] uppercase font-bold text-gray-500">CPU Usage</div>
                    <div className="text-lg font-bold font-mono text-white mt-1">{inspectProcess.cpu.toFixed(1)}%</div>
                  </div>
                  <div className="bg-[#12121e] border border-white/10 rounded-2xl p-3 text-center">
                    <div className="text-[10px] uppercase font-bold text-gray-500">Memory (RSS)</div>
                    <div className="text-lg font-bold font-mono text-emerald-400 mt-1">{inspectProcess.rss}</div>
                  </div>
                  <div className="bg-[#12121e] border border-white/10 rounded-2xl p-3 text-center">
                    <div className="text-[10px] uppercase font-bold text-gray-500">Threads</div>
                    <div className="text-lg font-bold font-mono text-purple-400 mt-1">{inspectProcess.threads || 1}</div>
                  </div>
                </div>

                {/* Priority (Renice) Slider */}
                <div className="bg-[#12121e] border border-white/10 rounded-2xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="text-gray-300">Process Nice Priority (-20 to +19)</span>
                    <span className="font-mono text-blue-400 font-bold">{reniceValue}</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="text-[10px] text-gray-500">High (-20)</span>
                    <input
                      type="range"
                      min="-20"
                      max="19"
                      value={reniceValue}
                      onChange={e => setReniceValue(Number(e.target.value))}
                      className="flex-1 accent-blue-500 cursor-pointer"
                    />
                    <span className="text-[10px] text-gray-500">Low (+19)</span>
                    <button
                      onClick={() => handleApplyRenice(inspectProcess.pid, reniceValue)}
                      className="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold"
                    >
                      Apply
                    </button>
                  </div>
                </div>

                {/* Details List */}
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-white/[0.06]">
                    <span className="text-gray-400">Parent PID (PPID):</span>
                    <span className="font-mono text-white">{inspectProcess.ppid || '1'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-white/[0.06]">
                    <span className="text-gray-400">Virtual Memory Size (VSZ):</span>
                    <span className="font-mono text-white">{inspectProcess.vsz}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-white/[0.06]">
                    <span className="text-gray-400">Execution Status:</span>
                    <span className="font-mono text-blue-300">{inspectProcess.stat}</span>
                  </div>

                  <div>
                    <span className="text-gray-400 block mb-1">Full Command Line:</span>
                    <div className="bg-[#101018] p-3 rounded-2xl border border-white/10 font-mono text-[11px] text-gray-200 break-all max-h-24 overflow-y-auto">
                      {inspectProcess.command}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: OPEN FILES & SOCKETS */}
            {inspectorTab === 'files' && (
              <div className="flex-1 overflow-y-auto scrollbar-thin bg-[#101018] rounded-2xl p-3 border border-white/10 font-mono text-[11px] text-gray-300 space-y-1">
                {inspectProcess.openFiles?.map((file, i) => (
                  <div key={i} className="truncate hover:text-white py-0.5">
                    {file}
                  </div>
                ))}
              </div>
            )}

            {/* TAB 3: SAMPLE PROCESS STACK */}
            {inspectorTab === 'sample' && (
              <div className="flex-1 overflow-y-auto scrollbar-thin bg-[#101018] rounded-2xl p-3 border border-white/10 font-mono text-[11px] text-gray-300 whitespace-pre-wrap select-text leading-relaxed">
                {inspectProcess.sampleStack}
              </div>
            )}

            {/* Inspector Footer Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-white/10 shrink-0">
              <button
                onClick={() => handleOpenTerminalInspect(inspectProcess)}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs flex items-center space-x-1.5 transition-colors"
              >
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>Open in Terminal</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleSignal(inspectProcess.pid, 'TERM', 'Quit')}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold shadow-sm active:scale-95"
                >
                  Quit Process
                </button>
                <button
                  onClick={() => handleSignal(inspectProcess.pid, 'KILL', 'Force Quit')}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-sm active:scale-95"
                >
                  Force Kill
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right-Click macOS Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl py-1.5 w-64 text-xs text-gray-200 font-sans select-none animate-in fade-in duration-100"
          style={{
            top: Math.min(contextMenu.y, window.innerHeight - 340),
            left: Math.min(contextMenu.x, window.innerWidth - 270)
          }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3.5 py-1 text-[11px] font-bold text-gray-400 border-b border-white/10 mb-1 flex items-center justify-between">
            <span className="truncate">{contextMenu.process.name}</span>
            <span className="font-mono text-gray-500">PID {contextMenu.process.pid}</span>
          </div>

          <div
            onClick={() => { handleOpenInspector(contextMenu.process); setContextMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium"
          >
            <Info className="w-3.5 h-3.5 text-blue-400" />
            <span>Inspect Process Details...</span>
          </div>

          <div className="my-1 border-t border-white/10" />

          <div
            onClick={() => handleSignal(contextMenu.process.pid, 'TERM', 'Quit')}
            className="px-3.5 py-1.5 hover:bg-amber-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-amber-300"
          >
            <Square className="w-3.5 h-3.5" />
            <span>Quit Process (SIGTERM -15)</span>
          </div>

          <div
            onClick={() => handleSignal(contextMenu.process.pid, 'KILL', 'Force Quit')}
            className="px-3.5 py-1.5 hover:bg-rose-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-rose-400"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Force Kill (SIGKILL -9)</span>
          </div>

          <div
            onClick={() => handleSignal(contextMenu.process.pid, 'HUP', 'Reload')}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Reload Configuration (SIGHUP -1)</span>
          </div>

          <div
            onClick={() => handleSignal(contextMenu.process.pid, 'STOP', 'Pause')}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Pause className="w-3.5 h-3.5 text-amber-400" />
            <span>Pause Process (SIGSTOP -19)</span>
          </div>

          <div
            onClick={() => handleSignal(contextMenu.process.pid, 'CONT', 'Resume')}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <PlayCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>Resume Process (SIGCONT -18)</span>
          </div>

          <div className="my-1 border-t border-white/10" />

          <div
            onClick={() => handleOpenTerminalInspect(contextMenu.process)}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Open in Terminal (ps / top)</span>
          </div>

          <div
            onClick={() => {
              navigator.clipboard.writeText(String(contextMenu.process.pid));
              setContextMenu(null);
            }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy PID ({contextMenu.process.pid})</span>
          </div>

          <div
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.process.command);
              setContextMenu(null);
            }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <CornerDownRight className="w-3.5 h-3.5" />
            <span>Copy Command Line</span>
          </div>
        </div>
      )}
    </div>
  );
}
