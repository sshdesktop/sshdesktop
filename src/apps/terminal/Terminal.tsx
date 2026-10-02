import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { 
  Plus, X, Terminal as TerminalIcon, Trash2, ChevronDown, Server, 
  ExternalLink, ShieldAlert, Activity, RefreshCw, Copy, CornerDownLeft
} from 'lucide-react';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';
import { 
  terminalCreate, terminalWrite, terminalResize, terminalClose, sshLaunchPutty 
} from '../../lib/tauri-bridge';
import { listen } from '@tauri-apps/api/event';

interface Tab {
  id: string;
  title: string;
  shell: string;
  connId: string;
  serverName: string;
}

interface TabInstance {
  term: XTerm;
  fitAddon: FitAddon;
  disposed: boolean;
}

export default function TerminalApp() {
  const connections = useConnectionStore(s => s.connections);
  const activeConnectionId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const activeServer = connections.find(c => c.id === activeConnectionId);

  const [tabs, setTabs] = useState<Tab[]>([
    { 
      id: 'tab-1', 
      title: activeServer ? `${activeServer.name || activeServer.host}` : 'bash (1)', 
      shell: '/bin/bash',
      connId: activeConnectionId,
      serverName: activeServer?.name || activeServer?.host || 'server'
    }
  ]);
  const [activeTab, setActiveTab] = useState<string>('tab-1');
  const [showServerMenu, setShowServerMenu] = useState(false);
  const tabInstances = useRef<Map<string, TabInstance>>(new Map());
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Listen to Tauri terminal-output events globally
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    listen<any>('terminal-output', (event) => {
      const payload = event.payload;
      if (!payload || !payload.terminal_id) return;
      const instance = tabInstances.current.get(payload.terminal_id);
      if (instance && !instance.disposed) {
        if (payload.text) {
          instance.term.write(payload.text);
        } else if (payload.data && Array.isArray(payload.data)) {
          const u8 = new Uint8Array(payload.data);
          instance.term.write(u8);
        }
      }
    }).then(fn => { unlistenFn = fn; });

    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const setupTabInstance = useCallback(async (tabId: string, el: HTMLDivElement) => {
    if (tabInstances.current.has(tabId)) {
      const inst = tabInstances.current.get(tabId);
      try {
        inst?.fitAddon.fit();
      } catch {}
      return;
    }

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: '#14141e',
        foreground: '#cdd6f4',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(88, 166, 255, 0.35)',
        black: '#303446',
        red: '#e78284',
        green: '#a6d189',
        yellow: '#e5c890',
        blue: '#8caaee',
        magenta: '#f4b8e4',
        cyan: '#81c8be',
        white: '#c6d0f5',
        brightBlack: '#626880',
        brightRed: '#ea999c',
        brightGreen: '#a6d189',
        brightYellow: '#e5c890',
        brightBlue: '#8caaee',
        brightMagenta: '#f4b8e4',
        brightCyan: '#81c8be',
        brightWhite: '#b5bfe2',
      },
      allowTransparency: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(el);
    setTimeout(() => {
      try {
        fitAddon.fit();
      } catch {}
    }, 50);

    const instance: TabInstance = {
      term,
      fitAddon,
      disposed: false,
    };
    tabInstances.current.set(tabId, instance);

    // Forward raw user keystrokes directly to PuTTY/plink PTY stream
    term.onData(data => {
      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(data));
      terminalWrite(tabId, bytes).catch(err => {
        console.warn('Terminal write notice:', err);
      });
    });

    // Resize event
    term.onResize(({ cols, rows }) => {
      terminalResize(tabId, rows, cols).catch(() => {});
    });

    // Create backend PTY session
    const tab = tabs.find(t => t.id === tabId);
    const connId = tab?.connId || activeConnectionId;
    try {
      await terminalCreate(connId, term.rows || 24, term.cols || 80, tabId);
    } catch (err: any) {
      term.writeln(`\r\n\x1b[31m[Failed to initialize PTY: ${err?.message || err}]\x1b[0m\r\n`);
    }
  }, [tabs, activeConnectionId]);

  // Window resize handler
  useEffect(() => {
    const handleResize = () => {
      const activeInst = tabInstances.current.get(activeTab);
      try {
        activeInst?.fitAddon.fit();
      } catch {}
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeTab]);

  // Fit and focus on tab change
  useEffect(() => {
    const timer = setTimeout(() => {
      const activeInst = tabInstances.current.get(activeTab);
      try {
        activeInst?.fitAddon.fit();
        activeInst?.term.focus();
      } catch {}
    }, 40);
    return () => clearTimeout(timer);
  }, [activeTab]);

  // Execute external commands sent to Terminal (e.g. Finder "Open Terminal Here")
  const pendingTerminalCommand = useEditorStore(s => s.pendingTerminalCommand);
  const clearTerminalCommand = useEditorStore(s => s.clearTerminalCommand);

  useEffect(() => {
    if (!pendingTerminalCommand) return;
    const cmd = pendingTerminalCommand;
    clearTerminalCommand();

    const timer = setTimeout(() => {
      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(cmd));
      terminalWrite(activeTab, bytes).catch(err => {
        console.warn('Failed to send pending terminal command:', err);
      });
    }, 400);

    return () => clearTimeout(timer);
  }, [pendingTerminalCommand, activeTab, clearTerminalCommand]);

  const addTab = (chosenConnId?: string) => {
    const newId = `tab-${Date.now()}`;
    const connId = chosenConnId || activeConnectionId || 'default';
    const s = connections.find(c => c.id === connId) || activeServer;
    const serverLabel = s?.name || s?.host || 'Server';
    const nextNum = tabs.filter(t => t.connId === connId).length + 1;
    setTabs(prev => [
      ...prev,
      {
        id: newId,
        title: `${serverLabel} (${nextNum})`,
        shell: '/bin/bash',
        connId,
        serverName: serverLabel
      }
    ]);
    setActiveTab(newId);
    setShowServerMenu(false);
  };

  const removeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;

    terminalClose(id).catch(() => {});
    const inst = tabInstances.current.get(id);
    if (inst) {
      inst.disposed = true;
      inst.term.dispose();
      tabInstances.current.delete(id);
    }
    containersRef.current.delete(id);

    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeTab === id) {
      setActiveTab(remaining[remaining.length - 1].id);
    }
  };

  const sendQuickCommand = (cmd: string) => {
    const encoder = new TextEncoder();
    const bytes = Array.from(encoder.encode(cmd + '\n'));
    terminalWrite(activeTab, bytes);
    const inst = tabInstances.current.get(activeTab);
    inst?.term.focus();
  };

  const handleLaunchPutty = async () => {
    const currentTab = tabs.find(t => t.id === activeTab);
    const connId = currentTab?.connId || activeConnectionId;
    try {
      await sshLaunchPutty(connId);
    } catch (err: any) {
      alert(`Could not launch PuTTY: ${err?.message || err}`);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#14141e] text-gray-200 select-none">
      {/* macOS Terminal Tab Bar & Quick Tools */}
      <div className="flex items-center justify-between bg-[#11111a] border-b border-white/[0.08] px-2 pt-1.5 space-x-1 shrink-0 overflow-x-auto">
        <div className="flex items-center space-x-1 overflow-x-auto">
          {tabs.map(tab => (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-t-xl text-xs font-mono transition-colors cursor-pointer group ${
                activeTab === tab.id
                  ? 'bg-[#14141e] text-blue-400 font-semibold border-t-2 border-t-blue-500 shadow-sm'
                  : 'text-gray-400 hover:bg-white/[0.05] hover:text-gray-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
              <TerminalIcon className="w-3.5 h-3.5" />
              <span className="truncate max-w-[130px]">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => removeTab(tab.id, e)}
                  className="opacity-0 group-hover:opacity-100 hover:bg-white/20 p-0.5 rounded transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}

          <div className="relative">
            <div className="flex items-center bg-white/[0.04] rounded-lg">
              <button
                onClick={() => addTab()}
                className="p-1.5 hover:bg-white/[0.08] rounded-l-lg text-gray-400 hover:text-white transition-colors"
                title="New Terminal Tab (Ctrl+T)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              {connections.length > 1 && (
                <button
                  onClick={() => setShowServerMenu(!showServerMenu)}
                  className="p-1.5 hover:bg-white/[0.08] rounded-r-lg text-gray-400 hover:text-white border-l border-white/10"
                  title="Select Server for New Tab"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              )}
            </div>

            {showServerMenu && (
              <div 
                className="absolute left-0 top-8 bg-[#1e1e2e] border border-white/15 rounded-xl shadow-2xl py-1 z-50 text-xs w-52 font-sans"
                onClick={() => setShowServerMenu(false)}
              >
                <div className="px-3 py-1 text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                  Open Tab On Server
                </div>
                {connections.map(c => (
                  <div
                    key={c.id}
                    onClick={() => addTab(c.id)}
                    className="px-3 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <Server className="w-3.5 h-3.5" />
                    <span className="truncate">{c.name || c.host}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Commands & PuTTY Launcher */}
        <div className="flex items-center space-x-1.5 pb-1">
          <button
            onClick={() => sendQuickCommand('sudo su -')}
            className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/20 rounded-lg text-xs font-mono flex items-center space-x-1 transition-colors"
            title="Switch to Root Shell (sudo su -)"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>sudo su -</span>
          </button>

          <button
            onClick={() => sendQuickCommand('top')}
            className="px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/20 rounded-lg text-xs font-mono flex items-center space-x-1 transition-colors"
            title="Interactive Live Process Monitor (top)"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>top</span>
          </button>

          <button
            onClick={handleLaunchPutty}
            className="px-2.5 py-1 bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/20 rounded-lg text-xs font-mono flex items-center space-x-1 transition-colors"
            title="Launch Standalone PuTTY Window with Auto-Login"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>PuTTY</span>
          </button>

          <button
            onClick={() => {
              const inst = tabInstances.current.get(activeTab);
              if (inst) {
                inst.term.clear();
              }
            }}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-lg text-xs"
            title="Clear Terminal Screen"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Viewports Container - Each tab keeps its DOM alive! */}
      <div className="flex-1 relative bg-[#14141e] overflow-hidden">
        {tabs.map(tab => (
          <div
            key={tab.id}
            ref={el => {
              if (el) {
                containersRef.current.set(tab.id, el);
                setupTabInstance(tab.id, el);
              }
            }}
            className="absolute inset-0 p-2"
            style={{ display: activeTab === tab.id ? 'block' : 'none' }}
          />
        ))}
      </div>

      {/* Terminal Status Bar */}
      <div className="h-6 bg-[#0f0f18] border-t border-white/[0.08] px-3 flex items-center justify-between text-[11px] font-mono text-gray-400 shrink-0">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1.5 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>PuTTY-Grade Raw PTY</span>
          </span>
          <span>xterm.js 256color</span>
          <span>UTF-8</span>
          <span className="text-gray-500">Session: {activeTab}</span>
        </div>
        <div className="flex items-center space-x-3">
          <span>{activeServer?.username || 'root'}@{activeServer?.host || 'server'}</span>
          <span>/bin/bash</span>
        </div>
      </div>
    </div>
  );
}

