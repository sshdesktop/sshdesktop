import React, { useRef, useState, useEffect } from 'react';
import { 
  FileText, Search, Zap, Check, Copy, RefreshCw,
  ZoomIn, ZoomOut, WrapText, Download, ListOrdered
} from 'lucide-react';
import { ContainerItem } from '../types';
import { DockerCommandSnippet, DockerLogLine } from './DockerCodeViewer';

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

  // Appearance & Editor States
  const [fontSize, setFontSize] = useState<number>(12);
  const [isWordWrap, setIsWordWrap] = useState<boolean>(true);
  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(true);

  // Keyboard navigation / shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setFontSize(prev => Math.min(22, prev + 1));
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        setFontSize(prev => Math.max(9, prev - 1));
      } else if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setIsWordWrap(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleDownloadLogs = () => {
    if (!container) return;
    const blob = new Blob([logsText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docker-logs-${container.name || container.id}-${new Date().toISOString().slice(0, 10)}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!container) return null;

  const lines = logsText.split('\n');
  const filteredLines = lines.filter(l => !logsFilter || l.toLowerCase().includes(logsFilter.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[640px]">
        {/* Terminal Window Header */}
        <div className="px-5 py-3.5 bg-[#12121a] border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            {/* macOS traffic lights */}
            <div className="flex items-center space-x-1.5">
              <button onClick={onClose} className="w-3 h-3 rounded-full bg-[#ff5f56] hover:opacity-80 transition-opacity cursor-pointer" title="Close" />
              <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
              <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
            </div>
            <div className="flex items-center space-x-2 pl-2">
              <FileText className="w-4 h-4 text-blue-400" />
              <span className="text-xs font-mono font-bold text-white">docker logs {container.name}</span>
              <span className="text-[11px] text-gray-500 font-mono">({container.id.slice(0, 12)})</span>
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

            {/* Zoom Controls */}
            <div className="flex items-center bg-white/5 rounded-lg border border-white/10 px-1 py-0.5 space-x-1 text-gray-300">
              <button
                type="button"
                onClick={() => setFontSize(prev => Math.max(9, prev - 1))}
                className="hover:text-white text-gray-400 p-0.5 cursor-pointer"
                title="Zoom Out (Ctrl + -)"
              >
                <ZoomOut className="w-3 h-3" />
              </button>
              <span className="text-[10px] font-mono px-0.5">{fontSize}px</span>
              <button
                type="button"
                onClick={() => setFontSize(prev => Math.min(22, prev + 1))}
                className="hover:text-white text-blue-400 p-0.5 cursor-pointer"
                title="Zoom In (Ctrl + +)"
              >
                <ZoomIn className="w-3 h-3" />
              </button>
            </div>

            {/* Word Wrap Toggle */}
            <button
              onClick={() => setIsWordWrap(!isWordWrap)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                isWordWrap ? 'bg-blue-600/30 text-blue-300 border-blue-500/40' : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
              }`}
              title="Toggle Word Wrap (Alt + Z)"
            >
              <WrapText className="w-3.5 h-3.5" />
            </button>

            {/* Line Numbers Toggle */}
            <button
              onClick={() => setShowLineNumbers(!showLineNumbers)}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                showLineNumbers ? 'bg-blue-600/30 text-blue-300 border-blue-500/40' : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
              }`}
              title="Toggle Line Numbers"
            >
              <ListOrdered className="w-3.5 h-3.5" />
            </button>

            {/* Download Logs */}
            <button
              onClick={handleDownloadLogs}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
              title="Download full log file"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
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

        {/* CLI Snippet Bar & Search Sub-header */}
        <div className="px-5 py-2.5 bg-[#141420] border-b border-white/10 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex-1 min-w-[280px]">
            <DockerCommandSnippet 
              command={`docker logs -f --tail ${logsLines} ${container.name}`}
              label="Log Stream Command"
            />
          </div>

          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 text-xs text-gray-400 px-3 py-1.5 bg-[#0e0f18] rounded-xl border border-white/10">
              <Search className="w-3.5 h-3.5 text-blue-400" />
              <input
                type="text"
                placeholder="Grep / filter logs output..."
                value={logsFilter}
                onChange={e => onFilterChange(e.target.value)}
                className="bg-transparent border-none text-xs text-white placeholder-gray-500 focus:outline-none w-52"
              />
            </div>
            <span className="text-[11px] text-gray-400 font-mono">
              {filteredLines.length} / {lines.length} lines
            </span>
          </div>
        </div>

        {/* Terminal Colorful Body */}
        <div 
          style={{ fontSize: `${fontSize}px` }}
          className={`flex-1 p-3 bg-[#0a0b12] overflow-y-auto leading-relaxed select-text ${
            isWordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre overflow-x-auto'
          }`}
        >
          {filteredLines.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 font-mono text-xs">
              <span>No logs found matching filter "{logsFilter}".</span>
            </div>
          ) : (
            filteredLines.map((line, idx) => (
              <DockerLogLine
                key={idx}
                line={line}
                index={idx}
                showLineNumber={showLineNumbers}
              />
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};
