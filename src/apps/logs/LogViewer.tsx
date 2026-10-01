import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ScrollText, Play, Pause, Trash2, Download, Search, Filter, ArrowDown, RefreshCw } from 'lucide-react';
import { logsJournal, logsFile, logsDmesg } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  unit: string;
  message: string;
}

function parseRawLogLine(line: string, idx: number): LogEntry {
  const trimmed = line.trim();
  let level: 'info' | 'warn' | 'error' | 'debug' = 'info';
  const lower = trimmed.toLowerCase();
  if (lower.includes('err') || lower.includes('failed') || lower.includes('fatal') || lower.includes('crit')) {
    level = 'error';
  } else if (lower.includes('warn')) {
    level = 'warn';
  } else if (lower.includes('debug')) {
    level = 'debug';
  }

  // Parse typical syslog / journalctl format: "Month Day HH:MM:SS host unit[pid]: message"
  const match = trimmed.match(/^([A-Z][a-z]{2}\s+\d+\s+\d+:\d+:\d+)\s+\S+\s+([^:]+):\s*(.*)$/);
  if (match) {
    return {
      id: `${Date.now()}-${idx}`,
      timestamp: match[1],
      level,
      unit: match[2],
      message: match[3]
    };
  }

  return {
    id: `${Date.now()}-${idx}`,
    timestamp: new Date().toLocaleTimeString(),
    level,
    unit: 'system',
    message: trimmed
  };
}

export default function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(true);
  const [filterLevel, setFilterLevel] = useState<string>('all');
  const [source, setSource] = useState('journalctl');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const fetchLogs = useCallback(async () => {
    try {
      let raw = '';
      if (source === 'journalctl') {
        raw = await logsJournal(activeConnId, undefined, 150);
      } else if (source === 'dmesg') {
        raw = await logsDmesg(activeConnId);
      } else {
        raw = await logsFile(activeConnId, source);
      }

      if (raw && raw.trim().length > 0) {
        const lines = raw.trim().split('\n').filter(Boolean);
        const parsed = lines.slice(-200).map((l, i) => parseRawLogLine(l, i));
        setLogs(parsed);
      }
    } catch (err) {
      console.warn('Failed to fetch logs:', err);
    }
  }, [activeConnId, source]);

  // Initial load when source or connection changes
  useEffect(() => {
    setLoading(true);
    fetchLogs().finally(() => setLoading(false));
  }, [fetchLogs]);

  // Live polling when streaming is active
  useEffect(() => {
    if (!isStreaming) return;
    const interval = setInterval(() => {
      fetchLogs();
    }, 4000);
    return () => clearInterval(interval);
  }, [isStreaming, fetchLogs]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = logs.filter(log => {
    const matchesLevel = filterLevel === 'all' || log.level === filterLevel;
    const matchesSearch = !search || log.message.toLowerCase().includes(search.toLowerCase()) || log.unit.toLowerCase().includes(search.toLowerCase());
    return matchesLevel && matchesSearch;
  });

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4]">
      {/* Top Toolbar */}
      <div className="flex items-center justify-between bg-[#1e1e2e] border-b border-white/[0.08] px-4 py-2 text-xs shrink-0">
        <div className="flex items-center space-x-2">
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            className="bg-[#313244] border border-white/10 rounded px-2.5 py-1 text-gray-200 focus:outline-none"
          >
            <option value="journalctl">journalctl (Live Systemd)</option>
            <option value="/var/log/auth.log">/var/log/auth.log (SSH Auth)</option>
            <option value="/var/log/syslog">/var/log/syslog (Kernel/Daemons)</option>
            <option value="/var/log/nginx/access.log">/var/log/nginx/access.log</option>
            <option value="/var/log/nginx/error.log">/var/log/nginx/error.log</option>
            <option value="dmesg">dmesg (Kernel Ring Buffer)</option>
          </select>

          <div className="flex items-center space-x-1 bg-[#313244] p-0.5 rounded">
            {(['all', 'info', 'warn', 'error'] as const).map(lvl => (
              <button
                key={lvl}
                onClick={() => setFilterLevel(lvl)}
                className={`px-2 py-0.5 rounded capitalize ${
                  filterLevel === lvl ? 'bg-[var(--accent)] text-white font-medium' : 'text-gray-400 hover:text-white'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search logs..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#313244] border border-white/10 rounded pl-7 pr-2 py-1 text-xs text-gray-200 focus:outline-none w-44"
            />
          </div>

          <button
            onClick={() => {
              setLoading(true);
              fetchLogs().finally(() => setLoading(false));
            }}
            disabled={loading}
            className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-white transition-colors"
            title="Refresh Logs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          <button
            onClick={() => setIsStreaming(!isStreaming)}
            className={`p-1.5 rounded flex items-center space-x-1 px-2 font-medium ${
              isStreaming ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400'
            }`}
          >
            {isStreaming ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{isStreaming ? 'Pause' : 'Stream'}</span>
          </button>

          <button
            onClick={() => setLogs([])}
            className="p-1.5 hover:bg-white/10 rounded text-gray-400 hover:text-red-400"
            title="Clear Buffer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Log Terminal Canvas */}
      <div className="flex-1 bg-[#11111b] p-3 font-mono text-xs overflow-y-auto space-y-1 select-text" ref={scrollRef}>
        {filtered.length === 0 ? (
          <div className="text-gray-500 text-center py-10">
            {loading ? 'Fetching live Linux logs...' : 'No matching log lines found'}
          </div>
        ) : (
          filtered.map(log => (
            <div key={log.id} className="flex items-start space-x-3 hover:bg-white/[0.03] py-0.5 rounded px-1">
              <span className="text-gray-500 shrink-0 select-none">{log.timestamp}</span>
              <span className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold shrink-0 ${
                log.level === 'error'
                  ? 'bg-rose-500/20 text-rose-400'
                  : log.level === 'warn'
                  ? 'bg-amber-500/20 text-amber-400'
                  : 'bg-blue-500/20 text-blue-400'
              }`}>
                {log.level}
              </span>
              <span className="text-purple-400 shrink-0 font-medium">{log.unit}:</span>
              <span className={log.level === 'error' ? 'text-rose-300' : log.level === 'warn' ? 'text-amber-200' : 'text-gray-300'}>
                {log.message}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Status Bar */}
      <div className="h-6 bg-[#181825] border-t border-white/[0.08] px-4 flex items-center justify-between text-xs text-gray-400 shrink-0">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1">
            <span className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span>{isStreaming ? 'Live Streaming' : 'Paused'}</span>
          </span>
          <span>Buffer: {filtered.length} lines</span>
          <span className="text-gray-500">Source: {source}</span>
        </div>

        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={`flex items-center space-x-1 ${autoScroll ? 'text-blue-400' : 'text-gray-500'}`}
        >
          <ArrowDown className="w-3 h-3" />
          <span>Auto-Scroll: {autoScroll ? 'ON' : 'OFF'}</span>
        </button>
      </div>
    </div>
  );
}
