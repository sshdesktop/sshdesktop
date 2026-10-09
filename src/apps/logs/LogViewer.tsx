import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  ScrollText, Play, Pause, Trash2, Download, Search, Filter, ArrowDown, 
  RefreshCw, FileText, Server, AlertCircle, AlertTriangle, Shield, Check, 
  Copy, Terminal, Info, CheckCircle2, X, ChevronRight, FolderOpen, Zap, 
  Sliders, ArrowUpRight, Flame, Database, Globe, Layers, Eye
} from 'lucide-react';
import { logsJournal, logsFile, logsDmesg, sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  subsystem: string;
  pid?: string;
  message: string;
  raw: string;
}

interface LogSourceItem {
  id: string;
  name: string;
  category: 'system' | 'services' | 'security' | 'custom';
  icon: React.ElementType;
  path?: string;
  unit?: string;
  desc: string;
}

const PRESET_SOURCES: LogSourceItem[] = [
  { id: 'journalctl', name: 'Unified Systemd', category: 'system', icon: Layers, desc: 'Real-time Linux systemd journal logs' },
  { id: 'dmesg', name: 'Kernel Ring Buffer (dmesg)', category: 'system', icon: Terminal, desc: 'Hardware & kernel level diagnostic events' },
  { id: 'syslog', name: 'System Log (/var/log/syslog)', category: 'system', icon: FileText, path: '/var/log/syslog', desc: 'General system messages and daemon activities' },
  { id: 'auth', name: 'SSH & Auth (/var/log/auth.log)', category: 'security', icon: Shield, path: '/var/log/auth.log', desc: 'User authentications, sudo commands & SSH sessions' },
  { id: 'boot', name: 'Current Boot (journalctl -b)', category: 'system', icon: Zap, desc: 'Boot sequence initialization logs' },
  { id: 'nginx_access', name: 'Nginx Access Log', category: 'services', icon: Globe, path: '/var/log/nginx/access.log', desc: 'HTTP request headers, client IPs & response status' },
  { id: 'nginx_error', name: 'Nginx Error Log', category: 'services', icon: AlertTriangle, path: '/var/log/nginx/error.log', desc: 'Web server connection warnings & failures' },
  { id: 'docker', name: 'Docker Daemon Service', category: 'services', icon: Layers, unit: 'docker', desc: 'Container engine startup and execution logs' },
  { id: 'cron', name: 'Cron Scheduled Jobs', category: 'services', icon: ScrollText, unit: 'cron', desc: 'Automated crontab execution history' },
];

function parseLogLine(line: string, idx: number): LogEntry {
  const trimmed = line.trim();
  let level: 'info' | 'warn' | 'error' | 'debug' = 'info';
  const lower = trimmed.toLowerCase();

  if (lower.includes('err') || lower.includes('failed') || lower.includes('fatal') || lower.includes('crit') || lower.includes('panic') || lower.includes('segfault')) {
    level = 'error';
  } else if (lower.includes('warn') || lower.includes('conflict') || lower.includes('deprecated') || lower.includes('timeout')) {
    level = 'warn';
  } else if (lower.includes('debug') || lower.includes('trace')) {
    level = 'debug';
  }

  // Common syslog / journalctl format: "Month Day HH:MM:SS host unit[pid]: message"
  const syslogMatch = trimmed.match(/^([A-Z][a-z]{2}\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+([^:\[]+)(?:\[(\d+)\])?:\s*(.*)$/);
  if (syslogMatch) {
    return {
      id: `${Date.now()}-${idx}`,
      timestamp: syslogMatch[1],
      level,
      subsystem: syslogMatch[3],
      pid: syslogMatch[4],
      message: syslogMatch[5],
      raw: trimmed
    };
  }

  // Systemd iso timestamp format: "2026-10-02T15:20:00+0000 host unit[pid]: message"
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}T[\d:]+)\S*\s+\S+\s+([^:\[]+)(?:\[(\d+)\])?:\s*(.*)$/);
  if (isoMatch) {
    return {
      id: `${Date.now()}-${idx}`,
      timestamp: isoMatch[1].replace('T', ' '),
      level,
      subsystem: isoMatch[2],
      pid: isoMatch[3],
      message: isoMatch[4],
      raw: trimmed
    };
  }

  // Fallback split
  return {
    id: `${Date.now()}-${idx}`,
    timestamp: new Date().toLocaleTimeString(),
    level,
    subsystem: 'system',
    message: trimmed,
    raw: trimmed
  };
}

export default function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<LogEntry | null>(null);
  const [isStreaming, setIsStreaming] = useState(true);
  const [filterLevel, setFilterLevel] = useState<'all' | 'error' | 'warn' | 'info' | 'debug'>('all');
  const [activeSourceId, setActiveSourceId] = useState<string>('journalctl');
  const [customPath, setCustomPath] = useState('');
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [tailLines, setTailLines] = useState<number>(200);
  const [loading, setLoading] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isFetchingRef = useRef(false);
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  // Fetch Logs from Server
  const fetchLogs = useCallback(async () => {
    if (isFetchingRef.current || (typeof document !== 'undefined' && document.hidden)) return;
    isFetchingRef.current = true;
    try {
      let raw = '';
      const selectedSource = PRESET_SOURCES.find(s => s.id === activeSourceId);

      if (activeSourceId === 'journalctl') {
        raw = await logsJournal(activeConnId, undefined, tailLines);
      } else if (activeSourceId === 'dmesg') {
        raw = await logsDmesg(activeConnId);
      } else if (activeSourceId === 'boot') {
        const res = await sshExec(activeConnId, `journalctl -b -n ${tailLines} --no-pager`);
        raw = res.stdout || '';
      } else if (selectedSource?.unit) {
        raw = await logsJournal(activeConnId, selectedSource.unit, tailLines);
      } else if (selectedSource?.path) {
        raw = await logsFile(activeConnId, selectedSource.path);
      } else if (customPath) {
        const res = await sshExec(activeConnId, `tail -n ${tailLines} ${customPath}`);
        raw = res.stdout || '';
      }

      if (raw && raw.trim().length > 0) {
        const lines = raw.trim().split('\n').filter(Boolean);
        const parsed = lines.slice(-tailLines).map((l, i) => parseLogLine(l, i));
        setLogs(parsed);
      } else if (!raw) {
        setLogs([]);
      }
    } catch (err) {
      console.warn('Failed to fetch logs:', err);
    } finally {
      isFetchingRef.current = false;
    }
  }, [activeConnId, activeSourceId, customPath, tailLines]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetchLogs().finally(() => setLoading(false));
  }, [fetchLogs]);

  // Live polling when streaming is active
  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      fetchLogs();
    }, 5000);
    return () => clearInterval(interval);
  }, [isStreaming, fetchLogs]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Filtered Logs
  const filtered = useMemo(() => {
    return logs.filter(log => {
      const matchesLevel = filterLevel === 'all' || log.level === filterLevel;
      const matchesSearch = !search || 
        log.message.toLowerCase().includes(search.toLowerCase()) || 
        log.subsystem.toLowerCase().includes(search.toLowerCase()) ||
        (log.pid && log.pid.includes(search));
      return matchesLevel && matchesSearch;
    });
  }, [logs, filterLevel, search]);

  // Error and Warning counts for stats banner
  const errorCount = useMemo(() => logs.filter(l => l.level === 'error').length, [logs]);
  const warnCount = useMemo(() => logs.filter(l => l.level === 'warn').length, [logs]);

  // Export Log File
  const handleExportLogs = () => {
    const textContent = filtered.map(l => `[${l.timestamp}] [${l.level.toUpperCase()}] ${l.subsystem}${l.pid ? `[${l.pid}]` : ''}: ${l.message}`).join('\n');
    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `server-console-${activeSourceId}-${Date.now()}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Copy Selected Log
  const handleCopyLog = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2000);
  };

  return (
    <div className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none overflow-hidden font-sans relative ${loading ? 'cursor-mac-wait' : ''}`}>
      {loading && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-30 pointer-events-none" />
      )}
      
      {/* Toast Notification */}
      {copiedNotification && (
        <div className="fixed top-12 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="px-4 py-2 rounded-2xl shadow-2xl backdrop-blur-xl border border-emerald-500/40 bg-emerald-950/85 text-emerald-200 text-xs font-medium flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Copied to clipboard</span>
          </div>
        </div>
      )}

      {/* 1. macOS Top Header Toolbar */}
      <header className="px-5 py-3 bg-[#14141e]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between shrink-0">
        
        {/* Left: App Identity */}
        <div className="flex items-center space-x-3.5">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/25 border border-white/20">
            <ScrollText className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-sm font-semibold tracking-tight text-white">Console Log Studio</span>
              <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Live Feed</span>
              </span>
            </div>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5">macOS Unified System & Kernel Log Inspector</p>
          </div>
        </div>

        {/* Center: Severity Filter Control Pills */}
        <div className="flex items-center bg-[#1e1e2e]/90 p-1 rounded-2xl border border-white/10 shadow-inner">
          <button
            onClick={() => setFilterLevel('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
              filterLevel === 'all'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            All Logs ({logs.length})
          </button>

          <button
            onClick={() => setFilterLevel('error')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center space-x-1.5 ${
              filterLevel === 'error'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30 font-semibold'
                : 'text-gray-400 hover:text-rose-400 hover:bg-white/5'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            <span>Errors</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${filterLevel === 'error' ? 'bg-white/20' : 'bg-rose-500/20 text-rose-300'}`}>
              {errorCount}
            </span>
          </button>

          <button
            onClick={() => setFilterLevel('warn')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center space-x-1.5 ${
              filterLevel === 'warn'
                ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 font-semibold'
                : 'text-gray-400 hover:text-amber-400 hover:bg-white/5'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            <span>Warnings</span>
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${filterLevel === 'warn' ? 'bg-white/20' : 'bg-amber-500/20 text-amber-300'}`}>
              {warnCount}
            </span>
          </button>

          <button
            onClick={() => setFilterLevel('info')}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center space-x-1.5 ${
              filterLevel === 'info'
                ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                : 'text-gray-400 hover:text-sky-400 hover:bg-white/5'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            <span>Info</span>
          </button>
        </div>

        {/* Right: Actions (Stream toggle, Tail lines, Export, Refresh) */}
        <div className="flex items-center space-x-2">
          {/* Stream / Pause Button */}
          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border active:scale-95 ${
              isStreaming
                ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40 shadow-sm'
                : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40 shadow-sm'
            }`}
          >
            {isStreaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isStreaming ? 'Pause Stream' : 'Live Stream'}</span>
          </button>

          {/* Lines Tail Selector */}
          <select
            value={tailLines}
            onChange={e => {
              setTailLines(Number(e.target.value));
              setTimeout(() => fetchLogs(), 50);
            }}
            className="bg-[#1e1e2e] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none cursor-pointer"
            title="Max log lines to retain"
          >
            <option value={100}>100 lines</option>
            <option value={200}>200 lines</option>
            <option value={500}>500 lines</option>
            <option value={1000}>1000 lines</option>
          </select>

          {/* Export / Download */}
          <button
            onClick={handleExportLogs}
            className="p-2 bg-white/5 hover:bg-white/10 active:scale-95 text-gray-300 hover:text-white rounded-xl transition-all border border-white/10"
            title="Download Logs as File"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Clear Buffer */}
          <button
            onClick={() => {
              setLogs([]);
              setSelectedLog(null);
            }}
            className="p-2 bg-white/5 hover:bg-white/10 active:scale-95 text-gray-300 hover:text-rose-400 rounded-xl transition-all border border-white/10"
            title="Clear Current Log Buffer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          {/* Manual Refresh */}
          <button
            onClick={() => {
              setLoading(true);
              fetchLogs().finally(() => setLoading(false));
            }}
            disabled={loading}
            className="p-2 bg-white/5 hover:bg-white/10 active:scale-95 text-gray-300 hover:text-white rounded-xl transition-all border border-white/10"
            title="Refresh Logs Now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </header>

      {/* 2. Main Master-Detail Work Area */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        
        {/* Left Sidebar: Log Sources & Channels */}
        <aside className="w-64 bg-[#14141e]/70 border-r border-white/[0.08] flex flex-col shrink-0">
          <div className="p-3 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider font-mono">
              Log Channels
            </span>
            <button
              onClick={() => setShowCustomModal(true)}
              className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center space-x-1"
            >
              <FolderOpen className="w-3 h-3" />
              <span>Custom</span>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {PRESET_SOURCES.map(source => {
              const Icon = source.icon;
              const isActive = activeSourceId === source.id;
              return (
                <button
                  key={source.id}
                  onClick={() => {
                    setActiveSourceId(source.id);
                    setCustomPath('');
                  }}
                  className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-start space-x-2.5 ${
                    isActive 
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 font-semibold' 
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{source.name}</div>
                    <div className={`text-[10px] truncate mt-0.5 ${isActive ? 'text-blue-100' : 'text-gray-500'}`}>
                      {source.desc}
                    </div>
                  </div>
                </button>
              );
            })}

            {customPath && (
              <button
                onClick={() => setActiveSourceId('custom')}
                className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex items-start space-x-2.5 ${
                  activeSourceId === 'custom' 
                    ? 'bg-blue-600 text-white shadow-md font-semibold' 
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <FileText className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono">Custom File</div>
                  <div className="text-[10px] truncate text-gray-500">{customPath}</div>
                </div>
              </button>
            )}
          </div>
        </aside>

        {/* Center / Right: Logs Canvas & Table */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#161622]">
          
          {/* Subheader: Filter & Live Stats Bar */}
          <div className="px-4 py-2.5 bg-[#12121c] border-b border-white/[0.08] flex items-center justify-between gap-4 shrink-0">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Filter logs by message, subsystem, or PID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full bg-[#1e1e2e] border border-white/10 rounded-xl pl-8 pr-8 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Metrics */}
            <div className="flex items-center space-x-3 text-xs font-mono">
              <span className="text-gray-400">
                Displaying <span className="text-white font-bold">{filtered.length}</span> of {logs.length}
              </span>
              <span className="text-gray-600">|</span>
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-[11px] font-sans border transition-all ${
                  autoScroll 
                    ? 'bg-blue-600/20 text-blue-300 border-blue-500/30' 
                    : 'bg-white/5 text-gray-400 border-white/5 hover:text-white'
                }`}
              >
                <ArrowDown className={`w-3 h-3 ${autoScroll ? 'animate-bounce text-blue-400' : ''}`} />
                <span>Auto-Scroll {autoScroll ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          {/* Master Table of Logs */}
          <div className="flex-1 min-h-0 overflow-y-auto select-text font-mono text-xs" ref={scrollRef}>
            <table className="w-full text-left border-collapse">
              <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 sticky top-0 z-10 text-[10px] uppercase tracking-wider font-mono">
                <tr>
                  <th className="py-2 px-3 w-10 text-center">Type</th>
                  <th className="py-2 px-3 w-32">Timestamp</th>
                  <th className="py-2 px-3 w-36">Subsystem</th>
                  <th className="py-2 px-3">Log Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-20 text-center text-gray-500 font-sans">
                      {loading ? 'Streaming logs from remote Linux host...' : 'No matching log entries found'}
                    </td>
                  </tr>
                ) : (
                  filtered.map((log, idx) => {
                    const isSelected = selectedLog?.id === log.id;
                    return (
                      <tr
                        key={log.id}
                        onClick={() => setSelectedLog(log)}
                        className={`cursor-pointer transition-colors ${
                          isSelected 
                            ? 'bg-blue-600 text-white font-medium' 
                            : idx % 2 === 0 ? 'bg-transparent hover:bg-white/[0.03]' : 'bg-white/[0.015] hover:bg-white/[0.03]'
                        }`}
                      >
                        {/* Level Dot Indicator */}
                        <td className="py-1.5 px-3 text-center">
                          <span className={`inline-block w-2 h-2 rounded-full ${
                            log.level === 'error'
                              ? 'bg-rose-500 shadow-sm shadow-rose-500/50'
                              : log.level === 'warn'
                              ? 'bg-amber-400 shadow-sm shadow-amber-400/50'
                              : log.level === 'debug'
                              ? 'bg-purple-400'
                              : 'bg-sky-400'
                          }`} />
                        </td>

                        {/* Timestamp */}
                        <td className={`py-1.5 px-3 whitespace-nowrap text-[11px] ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
                          {log.timestamp}
                        </td>

                        {/* Subsystem & PID */}
                        <td className={`py-1.5 px-3 truncate max-w-[140px] text-[11px] font-semibold ${
                          isSelected ? 'text-white' : 'text-purple-400'
                        }`}>
                          {log.subsystem}{log.pid ? `[${log.pid}]` : ''}
                        </td>

                        {/* Message */}
                        <td className={`py-1.5 px-3 break-all leading-relaxed ${
                          isSelected 
                            ? 'text-white' 
                            : log.level === 'error' 
                            ? 'text-rose-300 font-medium' 
                            : log.level === 'warn' 
                            ? 'text-amber-200' 
                            : 'text-gray-300'
                        }`}>
                          {log.message}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 3. Detail Inspector Bottom Drawer (macOS Console Inspector) */}
          {selectedLog && (
            <div className="h-44 bg-[#12121a] border-t border-white/10 p-4 flex flex-col shrink-0 animate-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-white/10 mb-2">
                <div className="flex items-center space-x-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${
                    selectedLog.level === 'error'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : selectedLog.level === 'warn'
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                  }`}>
                    {selectedLog.level}
                  </span>
                  <span className="font-mono text-xs text-white font-bold">{selectedLog.subsystem}</span>
                  {selectedLog.pid && <span className="font-mono text-xs text-gray-500">PID: {selectedLog.pid}</span>}
                  <span className="font-mono text-[11px] text-gray-500">· {selectedLog.timestamp}</span>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleCopyLog(selectedLog.raw)}
                    className="flex items-center space-x-1 px-2.5 py-1 bg-white/5 hover:bg-white/10 rounded-lg text-xs text-gray-300 hover:text-white border border-white/10"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </button>
                  <button
                    onClick={() => setSelectedLog(null)}
                    className="w-6 h-6 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Raw Log Detail Payload */}
              <div className="flex-1 bg-[#0a0a0f] p-3 rounded-xl border border-white/5 font-mono text-xs text-gray-300 overflow-y-auto whitespace-pre-wrap select-text leading-relaxed">
                {selectedLog.raw}
              </div>
            </div>
          )}

        </main>
      </div>

      {/* ================= MODAL: CUSTOM LOG FILE PATH ================= */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-md shadow-2xl p-6 flex flex-col space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-2xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center text-blue-400">
                <FolderOpen className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Open Custom Log File</h3>
                <p className="text-[11px] text-gray-400">Specify an absolute path on your Linux server</p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Server File Path</label>
              <input
                type="text"
                placeholder="e.g. /var/log/redis/redis-server.log"
                value={customPath}
                onChange={e => setCustomPath(e.target.value)}
                className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="pt-2 flex items-center justify-end space-x-2.5">
              <button
                onClick={() => setShowCustomModal(false)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-xl text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (customPath.trim()) {
                    setActiveSourceId('custom');
                    setShowCustomModal(false);
                    fetchLogs();
                  }
                }}
                disabled={!customPath.trim()}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-md active:scale-95 transition-all"
              >
                Stream Log
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export { LogViewer };
