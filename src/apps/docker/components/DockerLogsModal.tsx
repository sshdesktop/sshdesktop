import React, { useRef } from 'react';
import { FileText, Search, Zap, Check, Copy, RefreshCw } from 'lucide-react';
import { ContainerItem } from '../types';

interface DockerLogsModalProps {
  container: ContainerItem | null;
  logsText: string;
  logsLines: number;
  logsAutoRefresh: boolean;
  logsCopied: boolean;
  logsFilter: string;
  onClose: () => void;
  onLinesChange: (lines: number) => void;
  onToggleAutoRefresh: () => void;
  onCopyLogs: () => void;
  onRefresh: () => void;
  onFilterChange: (filter: string) => void;
}

export const DockerLogsModal: React.FC<DockerLogsModalProps> = ({
  container,
  logsText,
  logsLines,
  logsAutoRefresh,
  logsCopied,
  logsFilter,
  onClose,
  onLinesChange,
  onToggleAutoRefresh,
  onCopyLogs,
  onRefresh,
  onFilterChange,
}) => {
  const logsEndRef = useRef<HTMLDivElement>(null);

  if (!container) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col h-[600px]">
        {/* Terminal Window Header (macOS Traffic Lights) */}
        <div className="px-5 py-3.5 bg-[#12121a] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            {/* Traffic lights */}
            <div className="flex items-center space-x-1.5">
              <button onClick={onClose} className="w-3 h-3 rounded-full bg-[#ff5f56] hover:opacity-80 transition-opacity cursor-pointer" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
            </div>
            <div className="flex items-center space-x-2 pl-2">
              <FileText className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-mono font-bold text-white">docker logs {container.name}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center space-x-2">
            {/* Tail line count */}
            <select
              value={logsLines}
              onChange={e => onLinesChange(Number(e.target.value))}
              className="bg-[#1e1e2e] border border-white/10 rounded-lg px-2 py-1 text-[11px] text-gray-300 focus:outline-none cursor-pointer"
            >
              <option value={50}>Tail 50</option>
              <option value={100}>Tail 100</option>
              <option value={250}>Tail 250</option>
              <option value={500}>Tail 500</option>
              <option value={1000}>Tail 1000</option>
            </select>

            {/* Auto Refresh Toggle */}
            <button
              onClick={onToggleAutoRefresh}
              className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all border cursor-pointer ${
                logsAutoRefresh 
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
                  : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
              }`}
              title="Auto-refresh logs every 2.5 seconds"
            >
              <Zap className={`w-3 h-3 inline mr-1 ${logsAutoRefresh ? 'animate-pulse text-emerald-400' : ''}`} />
              Live (2.5s)
            </button>

            {/* Copy logs */}
            <button
              onClick={onCopyLogs}
              className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-[11px] flex items-center space-x-1 cursor-pointer"
            >
              {logsCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{logsCopied ? 'Copied' : 'Copy'}</span>
            </button>

            {/* Refresh */}
            <button
              onClick={onRefresh}
              className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 cursor-pointer"
              title="Reload Logs Now"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Filter Sub-header */}
        <div className="px-4 py-2 bg-[#161622] border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center space-x-2 text-xs text-gray-400">
            <Search className="w-3.5 h-3.5" />
            <input
              type="text"
              placeholder="Grep / filter logs output..."
              value={logsFilter}
              onChange={e => onFilterChange(e.target.value)}
              className="bg-transparent border-none text-xs text-white placeholder-gray-500 focus:outline-none w-64"
            />
          </div>
          <span className="text-[11px] text-gray-500 font-mono">
            {logsText.split('\n').length} lines
          </span>
        </div>

        {/* Terminal Body */}
        <div className="flex-1 p-4 font-mono text-[11px] text-gray-300 bg-[#0d0e15] overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
          {logsText
            .split('\n')
            .filter(l => !logsFilter || l.toLowerCase().includes(logsFilter.toLowerCase()))
            .map((line, idx) => {
              let colorClass = 'text-gray-300';
              if (line.includes('ERROR') || line.includes('ERR') || line.includes('FATAL')) colorClass = 'text-rose-400 font-semibold';
              else if (line.includes('WARN')) colorClass = 'text-amber-400';
              else if (line.includes('INFO')) colorClass = 'text-cyan-300';
              return (
                <div key={idx} className={`${colorClass} hover:bg-white/[0.04] px-1 py-0.2 rounded transition-colors`}>
                  {line}
                </div>
              );
            })}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
