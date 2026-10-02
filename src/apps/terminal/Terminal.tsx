import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Plus, X, Terminal as TerminalIcon, Trash2, ChevronDown, Server } from 'lucide-react';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';
import { sshExec } from '../../lib/tauri-bridge';

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
  history: string[];
  historyIndex: number;
  currentLine: string;
}

export default function TerminalApp() {
  const connections = useConnectionStore(s => s.connections);
  const activeConnectionId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const activeServer = connections.find(c => c.id === activeConnectionId);

  const [tabs, setTabs] = useState<Tab[]>([
    { 
      id: '1', 
      title: activeServer ? `${activeServer.name || activeServer.host}` : 'bash (1)', 
      shell: '/bin/bash',
      connId: activeConnectionId,
      serverName: activeServer?.name || activeServer?.host || 'server'
    }
  ]);
  const [activeTab, setActiveTab] = useState<string>('1');
  const [showServerMenu, setShowServerMenu] = useState(false);
  const tabInstances = useRef<Map<string, TabInstance>>(new Map());
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const { openApp } = useWindowManager();
  const { openFileInEditor } = useEditorStore();

  const getPromptForTab = useCallback((tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    const connId = tab?.connId || activeConnectionId;
    const s = connections.find(c => c.id === connId) || activeServer;
    const u = s?.username || 'root';
    const h = s?.host || 'server';
    return `\x1b[1;32m${u}@${h}\x1b[0m:\x1b[1;34m~\x1b[0m$ `;
  }, [tabs, connections, activeConnectionId, activeServer]);

  const executeCommand = async (cmd: string, tabId: string) => {
    const instance = tabInstances.current.get(tabId);
    if (!instance) return;
    const term = instance.term;

    const prompt = getPromptForTab(tabId);
    const tab = tabs.find(t => t.id === tabId);
    const connId = tab?.connId || activeConnectionId || 'default';

    if (!cmd) {
      term.write(prompt);
      return;
    }

    if (cmd === 'clear') {
      term.clear();
      term.write(prompt);
      return;
    }

    const trimmed = cmd.trim();
    const parts = trimmed.split(/\s+/);
    const action = parts[0]?.toLowerCase();
    const targetFile = parts.slice(1).join(' ');

    // Seamless GUI integration for interactive editors
    if (['nano', 'vi', 'vim', 'edit', 'code'].includes(action)) {
      if (targetFile) {
        openFileInEditor(targetFile);
        openApp('editor', `Edit: ${targetFile}`);
        term.writeln(`\x1b[1;32m[CloudDesk]\x1b[0m Launched graphical Code Editor for \x1b[1m${targetFile}\x1b[0m`);
      } else {
        openApp('editor', 'Code Editor');
        term.writeln('\x1b[1;32m[CloudDesk]\x1b[0m Launched graphical Code Editor.');
      }
      term.write(prompt);
      return;
    }

    // Seamless GUI integration for interactive top / htop
    if (action === 'top' || action === 'htop') {
      openApp('processes', 'Processes');
      term.writeln('\x1b[1;36m[CloudDesk]\x1b[0m Launched Process Manager app for live process inspection & termination.');
      try {
        const res = await sshExec(connId, 'top -b -n 1 | head -n 25');
        if (res.stdout) {
          term.write(res.stdout.replace(/\r?\n/g, '\r\n') + '\r\n');
        }
      } catch {}
      term.write(prompt);
      return;
    }

    if (cmd === 'help') {
      term.writeln('\x1b[1mBuilt-in & Remote Commands:\x1b[0m');
      term.writeln('  nano / vi <file> - Open file in CloudDesk Code Editor');
      term.writeln('  top / htop       - Launch Process Manager & print snapshot');
      term.writeln('  neofetch         - Show system hardware/OS information');
      term.writeln('  df -h            - Mounted filesystem usage');
      term.writeln('  free -m          - RAM memory statistics');
      term.writeln('  uname -a         - Kernel and architecture');
      term.writeln('  docker ps        - List running containers');
      term.writeln('  uptime           - Server uptime and load');
      term.writeln('  clear            - Clear terminal screen');
      term.write(prompt);
      return;
    }

    try {
      const res = await sshExec(connId, cmd);
      if (res.stdout) {
        term.write(res.stdout.replace(/\r?\n/g, '\r\n'));
      }
      if (res.stderr) {
        term.write('\x1b[31m' + res.stderr.replace(/\r?\n/g, '\r\n') + '\x1b[0m');
      }
    } catch (err: any) {
      term.writeln(`\x1b[31mExecution error: ${err?.message || err}\x1b[0m`);
    }

    term.write(prompt);
  };

  const setupTabInstance = useCallback((tabId: string, el: HTMLDivElement) => {
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
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: '#181825',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: 'rgba(137, 180, 250, 0.3)',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#cba6f7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8',
      },
      allowTransparency: true,
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
      history: [],
      historyIndex: -1,
      currentLine: '',
    };

    const prompt = getPromptForTab(tabId);
    const tab = tabs.find(t => t.id === tabId);
    const tabServer = tab ? connections.find(c => c.id === tab.connId) || activeServer : activeServer;
    const user = tabServer?.username || 'root';
    const host = tabServer?.host || 'server';

    tabInstances.current.set(tabId, instance);

    // Welcome banner
    term.writeln('\x1b[1;34m╔════════════════════════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[1;34m║\x1b[0m   \x1b[1;36mCloudDesk Remote Terminal Shell\x1b[0m                          \x1b[1;34m║\x1b[0m');
    term.writeln(`\x1b[1;34m║\x1b[0m   Connected to: \x1b[1;32m${user}@${host}\x1b[0m                            \x1b[1;34m║\x1b[0m`);
    term.writeln('\x1b[1;34m╚════════════════════════════════════════════════════════════╝\x1b[0m\r\n');
    term.write(prompt);

    term.onData(data => {
      const code = data.charCodeAt(0);
      if (code === 13) { // Enter
        term.writeln('');
        const trimmed = instance.currentLine.trim();
        if (trimmed) {
          instance.history.push(trimmed);
          instance.historyIndex = instance.history.length;
        }
        executeCommand(trimmed, tabId);
        instance.currentLine = '';
      } else if (code === 127) { // Backspace
        if (instance.currentLine.length > 0) {
          instance.currentLine = instance.currentLine.slice(0, -1);
          term.write('\b \b');
        }
      } else if (code === 3) { // Ctrl+C
        term.writeln('^C');
        instance.currentLine = '';
        term.write(getPromptForTab(tabId));
      } else if (data === '\x1b[A') { // Up Arrow (history)
        if (instance.history.length > 0 && instance.historyIndex > 0) {
          instance.historyIndex--;
          const prev = instance.history[instance.historyIndex];
          // Clear current line on screen
          while (instance.currentLine.length > 0) {
            term.write('\b \b');
            instance.currentLine = instance.currentLine.slice(0, -1);
          }
          instance.currentLine = prev;
          term.write(prev);
        }
      } else if (data === '\x1b[B') { // Down Arrow (history)
        if (instance.history.length > 0 && instance.historyIndex < instance.history.length - 1) {
          instance.historyIndex++;
          const next = instance.history[instance.historyIndex];
          while (instance.currentLine.length > 0) {
            term.write('\b \b');
            instance.currentLine = instance.currentLine.slice(0, -1);
          }
          instance.currentLine = next;
          term.write(next);
        } else if (instance.historyIndex >= instance.history.length - 1) {
          instance.historyIndex = instance.history.length;
          while (instance.currentLine.length > 0) {
            term.write('\b \b');
            instance.currentLine = instance.currentLine.slice(0, -1);
          }
        }
      } else if (code >= 32) {
        instance.currentLine += data;
        term.write(data);
      }
    });
  }, [getPromptForTab, tabs, connections, activeServer]);

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

  // Trigger fit when switching tab
  useEffect(() => {
    const timer = setTimeout(() => {
      const activeInst = tabInstances.current.get(activeTab);
      try {
        activeInst?.fitAddon.fit();
        activeInst?.term.focus();
      } catch {}
    }, 30);
    return () => clearTimeout(timer);
  }, [activeTab]);

  const addTab = (chosenConnId?: string) => {
    const newId = String(Date.now());
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

    // Dispose removed tab
    const inst = tabInstances.current.get(id);
    if (inst) {
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

  return (
    <div className="flex flex-col h-full bg-[#181825] text-gray-200 select-none">
      {/* Tab Bar */}
      <div className="flex items-center bg-[#11111b] border-b border-white/[0.08] px-2 pt-1.5 space-x-1 shrink-0 overflow-x-auto">
        {tabs.map(tab => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-t-lg text-xs font-mono transition-colors cursor-pointer group ${
              activeTab === tab.id
                ? 'bg-[#181825] text-[var(--accent)] font-medium border-t-2 border-t-[var(--accent)]'
                : 'text-gray-400 hover:bg-white/[0.05] hover:text-gray-200'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
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
          <div className="flex items-center bg-white/[0.04] rounded-md">
            <button
              onClick={() => addTab()}
              className="p-1.5 hover:bg-white/[0.08] rounded-l-md text-gray-400 hover:text-white transition-colors"
              title="New Tab (Active Server)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            {connections.length > 1 && (
              <button
                onClick={() => setShowServerMenu(!showServerMenu)}
                className="p-1.5 hover:bg-white/[0.08] rounded-r-md text-gray-400 hover:text-white border-l border-white/10"
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
                  className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black cursor-pointer flex items-center space-x-2"
                >
                  <Server className="w-3.5 h-3.5" />
                  <span className="truncate">{c.name || c.host}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1" />

        <button
          onClick={() => {
            const inst = tabInstances.current.get(activeTab);
            if (inst) {
              inst.term.clear();
              inst.term.write(getPromptForTab(activeTab));
            }
          }}
          className="p-1 text-gray-400 hover:text-red-400 hover:bg-white/5 rounded text-xs flex items-center space-x-1 px-2"
          title="Clear Current Terminal"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>
      </div>

      {/* Terminal Viewports Container - Each tab keeps its DOM alive! */}
      <div className="flex-1 relative bg-[#181825] overflow-hidden">
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
      <div className="h-6 bg-[#11111b] border-t border-white/[0.08] px-3 flex items-center justify-between text-[11px] font-mono text-gray-400 shrink-0">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Connected</span>
          </span>
          <span>SSH2 (aes256-gcm)</span>
          <span>UTF-8</span>
          <span className="text-gray-500">Active Tab: {activeTab}</span>
        </div>
        <div className="flex items-center space-x-3">
          <span>{activeServer?.username || 'root'}@{activeServer?.host || 'server'}</span>
          <span>/bin/bash</span>
        </div>
      </div>
    </div>
  );
}
