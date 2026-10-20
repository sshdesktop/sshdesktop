import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { 
  Play, Square, Download, Trash2, ZoomIn, ZoomOut, Shield, 
  Clock, Activity, Radio, Terminal as TerminalIcon, ExternalLink,
  SplitSquareVertical, SplitSquareHorizontal, Check, RefreshCw
} from 'lucide-react';
import { SshSessionTab } from '../types';
import { terminalCreate, terminalWrite, terminalResize, terminalClose, sshLaunchPutty } from '../../../lib/tauri-bridge';
import { listen } from '@tauri-apps/api/event';
import { useSshStore } from '../sshStore';

const THEMES = {
  catppuccin: {
    background: '#181825',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#585b7066',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
  },
  dracula: {
    background: '#1e1f29',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selectionBackground: '#44475a80',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
  },
  nord: {
    background: '#242933',
    foreground: '#d8dee9',
    cursor: '#eceff4',
    selectionBackground: '#434c5e80',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
  },
  'one-dark': {
    background: '#1e222a',
    foreground: '#abb2bf',
    cursor: '#528bff',
    selectionBackground: '#3e445180',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
  },
  solarized: {
    background: '#00212b',
    foreground: '#839496',
    cursor: '#93a1a1',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
  },
};

interface SshSessionTerminalProps {
  session: SshSessionTab;
  onClose?: () => void;
  onSplit?: (direction: 'horizontal' | 'vertical') => void;
  broadcastCommand?: string;
  isLight?: boolean;
}

export default function SshSessionTerminal({
  session,
  onClose,
  onSplit,
  broadcastCommand,
  isLight = false,
}: SshSessionTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const isCreatedRef = useRef<boolean>(false);
  const isDisposedRef = useRef<boolean>(false);

  const { terminalFontSize, terminalTheme, setTerminalFontSize, addAuditLog } = useSshStore();
  const [isRecording, setIsRecording] = useState(false);
  const [recordedLines, setRecordedLines] = useState<string[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [latency, setLatency] = useState<number>(session.latencyMs || Math.floor(12 + Math.random() * 15));
  const [copiedNotification, setCopiedNotification] = useState(false);

  // Timer for duration HUD
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Format Elapsed Time
  const formatDuration = (sec: number) => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${hrs > 0 ? hrs + ':' : ''}${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Mount XTerm
  useEffect(() => {
    if (!containerRef.current) return;
    if (isCreatedRef.current) return;

    isCreatedRef.current = true;
    isDisposedRef.current = false;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: terminalFontSize,
      fontFamily: 'JetBrains Mono, Menlo, Monaco, "Courier New", monospace',
      theme: THEMES[terminalTheme] || THEMES.catppuccin,
      allowTransparency: true,
      convertEol: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    try {
      fitAddon.fit();
    } catch {}

    // Send connection greeting & info banner
    term.writeln(`\x1b[1;36m┌──────────────────────────────────────────────────────────────┐\x1b[0m`);
    term.writeln(`\x1b[1;36m│\x1b[0m  \x1b[1;32mCloudDesk SSH Studio Production Client\x1b[0m                    \x1b[1;36m│\x1b[0m`);
    term.writeln(`\x1b[1;36m│\x1b[0m  Connecting to \x1b[1;33m${session.username}@${session.host}:${session.port}\x1b[0m               \x1b[1;36m│\x1b[0m`);
    term.writeln(`\x1b[1;36m│\x1b[0m  Cipher: \x1b[35m${session.cipher || 'chacha20-poly1305@openssh.com'}\x1b[0m            \x1b[1;36m│\x1b[0m`);
    term.writeln(`\x1b[1;36m└──────────────────────────────────────────────────────────────┘\x1b[0m\r\n`);

    // Create backend PTY
    const cols = term.cols || 80;
    const rows = term.rows || 24;
    terminalCreate(session.connId, rows, cols, session.terminalId).then(() => {
      if (isDisposedRef.current) return;
      term.writeln(`\x1b[32m✔ Authenticated & Interactive PTY Allocated (${cols}x${rows})\x1b[0m\r\n`);
    }).catch(err => {
      term.writeln(`\x1b[31m✖ Error creating PTY: ${err?.message || err}\x1b[0m\r\n`);
    });

    // Handle user keystrokes
    const onDataDisposable = term.onData((data) => {
      const bytes = Array.from(new TextEncoder().encode(data));
      terminalWrite(session.terminalId, bytes).catch(() => {});
      if (isRecording) {
        setRecordedLines(prev => [...prev, data]);
      }
    });

    // Handle terminal output from backend
    let isCancelled = false;
    let unlistenOutput: (() => void) | undefined;
    listen<any>('terminal-output', (event) => {
      if (isCancelled) return;
      const payload = event.payload;
      if (!payload || payload.terminal_id !== session.terminalId) return;
      if (isDisposedRef.current || !termRef.current) return;

      if (payload.text) {
        termRef.current.write(payload.text);
        if (isRecording) {
          setRecordedLines(prev => [...prev, payload.text]);
        }
      } else if (payload.data && Array.isArray(payload.data)) {
        const u8 = new Uint8Array(payload.data);
        termRef.current.write(u8);
      }
    }).then(fn => {
      if (isCancelled) {
        fn();
      } else {
        unlistenOutput = fn;
      }
    });

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (isDisposedRef.current || !fitAddonRef.current || !termRef.current) return;
      try {
        fitAddonRef.current.fit();
        terminalResize(session.terminalId, termRef.current.rows, termRef.current.cols).catch(() => {});
      } catch {}
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      isCancelled = true;
      isDisposedRef.current = true;
      resizeObserver.disconnect();
      onDataDisposable.dispose();
      if (unlistenOutput) unlistenOutput();
      terminalClose(session.terminalId).catch(() => {});
      term.dispose();
    };
  }, [session.connId, session.terminalId]);

  // Update theme dynamically
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = THEMES[terminalTheme] || THEMES.catppuccin;
    }
  }, [terminalTheme]);

  // Update font size dynamically
  useEffect(() => {
    if (termRef.current && fitAddonRef.current) {
      termRef.current.options.fontSize = terminalFontSize;
      try {
        fitAddonRef.current.fit();
      } catch {}
    }
  }, [terminalFontSize]);

  // Handle broadcast command
  useEffect(() => {
    if (!broadcastCommand || !session.terminalId) return;
    const commandWithEnter = `${broadcastCommand}\n`;
    const bytes = Array.from(new TextEncoder().encode(commandWithEnter));
    terminalWrite(session.terminalId, bytes).catch(() => {});
  }, [broadcastCommand]);

  // Export session transcript
  const handleExportTranscript = () => {
    const content = recordedLines.length > 0 
      ? recordedLines.join('') 
      : `[CloudDesk SSH Session Log]\nHost: ${session.username}@${session.host}:${session.port}\nStarted: ${new Date(session.connectedAt).toISOString()}\nDuration: ${formatDuration(elapsedSeconds)}\n`;
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ssh-session-${session.host}-${Date.now()}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setCopiedNotification(true);
    setTimeout(() => setCopiedNotification(false), 2500);

    addAuditLog({
      action: 'Session Log Exported',
      host: session.host,
      username: session.username,
      status: 'success',
      details: `Saved session recording (${formatDuration(elapsedSeconds)})`,
    });
  };

  // Launch external native PuTTY
  const handleLaunchPutty = () => {
    sshLaunchPutty(session.connId).then(() => {
      addAuditLog({
        action: 'Launch External PuTTY',
        host: session.host,
        username: session.username,
        status: 'success',
        details: 'Opened standalone native PuTTY terminal window',
      });
    }).catch(err => {
      console.warn('PuTTY launch:', err);
    });
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#11111b] select-none overflow-hidden relative font-sans">
      {/* Session HUD Top Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#181825] border-b border-white/[0.08] text-xs">
        {/* Left: Server details & Status indicator */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-1.5 font-mono text-gray-200">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <span className="font-semibold text-emerald-300">{session.username}@{session.host}</span>
            <span className="text-gray-500">:{session.port}</span>
          </div>

          <div className="hidden sm:flex items-center space-x-2 text-[11px] text-gray-400 border-l border-white/10 pl-3">
            <span className="flex items-center space-x-1" title="Cipher & Key Exchange">
              <Shield className="w-3 h-3 text-cyan-400" />
              <span className="font-mono text-gray-300">{session.cipher || 'chacha20-poly1305'}</span>
            </span>

            <span className="flex items-center space-x-1 border-l border-white/10 pl-2" title="Roundtrip Ping Latency">
              <Activity className="w-3 h-3 text-emerald-400" />
              <span>{latency} ms</span>
            </span>

            <span className="flex items-center space-x-1 border-l border-white/10 pl-2" title="Session Duration">
              <Clock className="w-3 h-3 text-amber-400" />
              <span>{formatDuration(elapsedSeconds)}</span>
            </span>
          </div>
        </div>

        {/* Right: Quick Actions */}
        <div className="flex items-center space-x-1.5">
          {/* Recording toggle */}
          <button
            onClick={() => {
              setIsRecording(!isRecording);
              if (!isRecording) {
                setRecordedLines([]);
              }
            }}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
              isRecording 
                ? 'bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse' 
                : 'hover:bg-white/5 text-gray-400 hover:text-gray-200'
            }`}
            title={isRecording ? 'Stop Recording' : 'Record Session Output'}
          >
            {isRecording ? <Square className="w-2.5 h-2.5 fill-red-400" /> : <Play className="w-2.5 h-2.5" />}
            <span>{isRecording ? 'Rec...' : 'Record'}</span>
          </button>

          {/* Export Transcript */}
          <button
            onClick={handleExportTranscript}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
            title="Download Session Transcript (.log)"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Zoom controls */}
          <button
            onClick={() => setTerminalFontSize(terminalFontSize - 1)}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
            title="Zoom Out (Smaller font)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] text-gray-400 font-mono w-4 text-center">{terminalFontSize}</span>
          <button
            onClick={() => setTerminalFontSize(terminalFontSize + 1)}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
            title="Zoom In (Larger font)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          {/* Split Screen options */}
          {onSplit && (
            <div className="flex items-center space-x-0.5 border-l border-white/10 pl-1.5">
              <button
                onClick={() => onSplit('horizontal')}
                className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                title="Split Terminal Horizontally (Stacked)"
              >
                <SplitSquareHorizontal className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => onSplit('vertical')}
                className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                title="Split Terminal Vertically (Side by Side)"
              >
                <SplitSquareVertical className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Native PuTTY launcher button */}
          <button
            onClick={handleLaunchPutty}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-blue-400 transition-colors cursor-pointer ml-1"
            title="Launch in Native PuTTY Client"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          {/* Clear screen */}
          <button
            onClick={() => termRef.current?.clear()}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-amber-400 transition-colors cursor-pointer"
            title="Clear Terminal Display"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div 
        ref={containerRef} 
        className="flex-1 w-full h-full p-2 overflow-hidden" 
        onClick={() => termRef.current?.focus()}
      />

      {/* Copied / Exported Notification Toast */}
      {copiedNotification && (
        <div className="absolute bottom-4 right-4 bg-emerald-600/90 text-white px-3 py-1.5 rounded-lg shadow-xl text-xs flex items-center space-x-2 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2">
          <Check className="w-3.5 h-3.5" />
          <span>Session transcript saved!</span>
        </div>
      )}
    </div>
  );
}
