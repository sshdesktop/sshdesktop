import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { 
  Plus, X, Terminal as TerminalIcon, Trash2, ChevronDown, Server, 
  ExternalLink, ShieldAlert, Activity, RefreshCw, Copy, CornerDownLeft,
  ZoomIn, ZoomOut, Clipboard, RotateCcw, Check, Sparkles, Palette
} from 'lucide-react';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';
import { 
  terminalCreate, terminalWrite, terminalResize, terminalClose, sshLaunchPutty 
} from '../../lib/tauri-bridge';
import { listen } from '@tauri-apps/api/event';
import { PortalContextMenu } from '../../components/PortalContextMenu';

export interface TerminalThemeConfig {
  id: string;
  name: string;
  dotColor: string;
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export const TERMINAL_THEMES: TerminalThemeConfig[] = [
  {
    id: 'tokyo-night',
    name: 'Tokyo Night Vivid',
    dotColor: '#7aa2f7',
    background: '#13141f',
    foreground: '#d5dcfe',
    cursor: '#7aa2f7',
    cursorAccent: '#13141f',
    selectionBackground: 'rgba(122, 162, 247, 0.35)',
    black: '#1f2335',
    red: '#f7768e',
    green: '#41e998',
    yellow: '#ffca5b',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#2ac3de',
    white: '#c0caf5',
    brightBlack: '#565f89',
    brightRed: '#ff7b72',
    brightGreen: '#73fadc',
    brightYellow: '#ffea79',
    brightBlue: '#89ddff',
    brightMagenta: '#d19eff',
    brightCyan: '#7dcfff',
    brightWhite: '#ffffff',
  },
  {
    id: 'cyberpunk-neon',
    name: 'Cyberpunk Neon',
    dotColor: '#00f5ff',
    background: '#0d0f18',
    foreground: '#f8fafc',
    cursor: '#00f5ff',
    cursorAccent: '#0d0f18',
    selectionBackground: 'rgba(0, 245, 255, 0.3)',
    black: '#1e2030',
    red: '#ff5370',
    green: '#22c55e',
    yellow: '#fbbf24',
    blue: '#3b82f6',
    magenta: '#d946ef',
    cyan: '#06b6d4',
    white: '#e2e8f0',
    brightBlack: '#64748b',
    brightRed: '#ff6e88',
    brightGreen: '#4ade80',
    brightYellow: '#fde047',
    brightBlue: '#60a5fa',
    brightMagenta: '#f472b6',
    brightCyan: '#22d3ee',
    brightWhite: '#ffffff',
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    dotColor: '#a6e3a1',
    background: '#181825',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    cursorAccent: '#181825',
    selectionBackground: 'rgba(137, 180, 250, 0.3)',
    black: '#313244',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#cba6f7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#eba0ac',
    brightGreen: '#b5e8b0',
    brightYellow: '#fae3b0',
    brightBlue: '#96cdfb',
    brightMagenta: '#f5c2e7',
    brightCyan: '#89dceb',
    brightWhite: '#ffffff',
  },
  {
    id: 'one-dark',
    name: 'One Dark Vivid',
    dotColor: '#61afef',
    background: '#1e222a',
    foreground: '#abb2bf',
    cursor: '#528bff',
    cursorAccent: '#1e222a',
    selectionBackground: 'rgba(62, 68, 82, 0.8)',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#be5046',
    brightGreen: '#b1e08e',
    brightYellow: '#ebcb8b',
    brightBlue: '#73baff',
    brightMagenta: '#d68ff6',
    brightCyan: '#6cdad1',
    brightWhite: '#ffffff',
  },
  {
    id: 'monokai-pro',
    name: 'Monokai Pro',
    dotColor: '#ffd866',
    background: '#19181a',
    foreground: '#fcfcfa',
    cursor: '#ffd866',
    cursorAccent: '#19181a',
    selectionBackground: 'rgba(255, 216, 102, 0.25)',
    black: '#2d2a2e',
    red: '#ff6188',
    green: '#a9dc76',
    yellow: '#ffd866',
    blue: '#78dce8',
    magenta: '#ab9df2',
    cyan: '#78dce8',
    white: '#fcfcfa',
    brightBlack: '#727072',
    brightRed: '#ff7b9b',
    brightGreen: '#b9e68a',
    brightYellow: '#ffe085',
    brightBlue: '#90e4ee',
    brightMagenta: '#beaff7',
    brightCyan: '#90e4ee',
    brightWhite: '#ffffff',
  },
];

interface Tab {
  id: string;
  title: string;
  shell: string;
  connId: string;
  serverName: string;
  dockerContainerId?: string;
}

interface TabInstance {
  term: XTerm;
  fitAddon: FitAddon;
  disposed: boolean;
  cleanup?: () => void;
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
  const initializingTabsRef = useRef<Set<string>>(new Set());
  const pendingInitialCommandsRef = useRef<Map<string, string>>(new Map());
  const [fontSize, setFontSize] = useState<number>(14);
  const fontSizeRef = useRef<number>(14);
  fontSizeRef.current = fontSize;

  // Terminal Theme state & persistence
  const [themeId, setThemeId] = useState<string>(() => {
    return localStorage.getItem('sshdesktop_terminal_theme') || 'tokyo-night';
  });
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const currentTheme = TERMINAL_THEMES.find(t => t.id === themeId) || TERMINAL_THEMES[0];
  const themeRef = useRef<TerminalThemeConfig>(currentTheme);
  themeRef.current = currentTheme;

  // 4-Sided Margin / Padding state & persistence
  const [padding, setPadding] = useState<number>(() => {
    const saved = localStorage.getItem('sshdesktop_terminal_padding');
    return saved ? parseInt(saved, 10) : 16; // default 16px for comfortable margin
  });
  const [showMarginMenu, setShowMarginMenu] = useState(false);

  const updateTheme = useCallback((newThemeId: string) => {
    setThemeId(newThemeId);
    localStorage.setItem('sshdesktop_terminal_theme', newThemeId);
    const targetTheme = TERMINAL_THEMES.find(t => t.id === newThemeId) || TERMINAL_THEMES[0];
    themeRef.current = targetTheme;
    tabInstances.current.forEach(inst => {
      if (!inst.disposed) {
        inst.term.options.theme = targetTheme;
      }
    });
  }, []);

  const updatePadding = useCallback((newPadding: number) => {
    setPadding(newPadding);
    localStorage.setItem('sshdesktop_terminal_padding', newPadding.toString());
    setTimeout(() => {
      tabInstances.current.forEach(inst => {
        if (!inst.disposed) {
          try {
            inst.fitAddon.fit();
          } catch {}
        }
      });
    }, 40);
  }, []);

  const updateZoom = useCallback((newSize: number) => {
    const clamped = Math.max(9, Math.min(32, newSize));
    setFontSize(clamped);
    fontSizeRef.current = clamped;
    tabInstances.current.forEach(inst => {
      if (!inst.disposed) {
        inst.term.options.fontSize = clamped;
        try {
          inst.fitAddon.fit();
        } catch {}
        requestAnimationFrame(() => {
          try {
            inst.fitAddon.fit();
          } catch {}
        });
      }
    });
  }, []);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; hasSelection: boolean } | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const inst = tabInstances.current.get(activeTab);
    const sel = inst?.term.getSelection() || '';
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      hasSelection: Boolean(sel && sel.trim().length > 0)
    });
  };

  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const handleCopySelection = () => {
    const inst = tabInstances.current.get(activeTab);
    const sel = inst?.term.getSelection();
    if (sel) {
      navigator.clipboard.writeText(sel);
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 2000);
    }
    setContextMenu(null);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const bytes = Array.from(new TextEncoder().encode(text));
        await terminalWrite(activeTab, bytes);
      }
    } catch (err) {
      console.warn('Clipboard paste notice:', err);
    }
    setContextMenu(null);
  };

  const handleSelectAll = () => {
    const inst = tabInstances.current.get(activeTab);
    inst?.term.selectAll();
    setContextMenu(null);
  };

  const handleClearScreen = () => {
    const inst = tabInstances.current.get(activeTab);
    inst?.term.clear();
    const bytes = Array.from(new TextEncoder().encode('clear\r'));
    terminalWrite(activeTab, bytes).catch(() => {});
    setContextMenu(null);
  };

  const handleResetTerminal = () => {
    const inst = tabInstances.current.get(activeTab);
    inst?.term.reset();
    inst?.fitAddon.fit();
    setContextMenu(null);
  };

  // Listen to Tauri terminal-output events globally with cancellation protection
  useEffect(() => {
    let isCancelled = false;
    let unlistenFn: (() => void) | undefined;

    const handlePayload = (payload: any) => {
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
    };

    // 1. Web / DOM event listener
    const handleWebTerminalOutput = (e: any) => {
      if (isCancelled) return;
      handlePayload(e.detail || e);
    };
    window.addEventListener('terminal-output', handleWebTerminalOutput);

    // 2. Native Tauri IPC listener
    listen<any>('terminal-output', (event) => {
      if (isCancelled) return;
      handlePayload(event.payload);
    }).then(fn => {
      if (isCancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    }).catch(() => {
      // In web mode without native Tauri
    });

    return () => {
      isCancelled = true;
      window.removeEventListener('terminal-output', handleWebTerminalOutput);
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Cleanup all terminal sessions and instances when Terminal window unmounts
  useEffect(() => {
    return () => {
      tabInstances.current.forEach((inst, id) => {
        inst.disposed = true;
        inst.cleanup?.();
        try { inst.term.dispose(); } catch {}
        terminalClose(id).catch(() => {});
      });
      tabInstances.current.clear();
      initializingTabsRef.current.clear();
      containersRef.current.clear();
    };
  }, []);

  // Listen for environment variable sync events to immediately update active shells
  useEffect(() => {
    const handleEnvSync = (e: any) => {
      const { key, value, action } = e.detail || {};
      if (!key) return;
      const encoder = new TextEncoder();
      tabs.forEach(tab => {
        let cmd = '';
        if (action === 'delete') {
          cmd = `unset ${key}; hash -r\n`;
        } else {
          const escapedVal = (value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          cmd = `export ${key}="${escapedVal}"; hash -r\n`;
        }
        terminalWrite(tab.id, Array.from(encoder.encode(cmd))).catch(err => {
          console.warn('Failed to sync env to terminal tab:', err);
        });
      });
    };

    window.addEventListener('sshdesktop:env-sync', handleEnvSync);
    window.addEventListener('clouddesk:env-sync', handleEnvSync);
    return () => {
      window.removeEventListener('sshdesktop:env-sync', handleEnvSync);
      window.removeEventListener('clouddesk:env-sync', handleEnvSync);
    };
  }, [tabs]);

  const setupTabInstance = useCallback(async (tabId: string, el: HTMLDivElement) => {
    if (tabInstances.current.has(tabId) || initializingTabsRef.current.has(tabId)) {
      const inst = tabInstances.current.get(tabId);
      try {
        inst?.fitAddon.fit();
      } catch {}
      return;
    }
    initializingTabsRef.current.add(tabId);
    el.innerHTML = '';

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: fontSizeRef.current,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      theme: themeRef.current,
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

    // Ctrl + Mouse Wheel Zoom (In / Out)
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopPropagation();
        if (e.deltaY < 0) {
          updateZoom(fontSizeRef.current + 1);
        } else if (e.deltaY > 0) {
          updateZoom(fontSizeRef.current - 1);
        }
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    // Keyboard Key Event Handler: Home / End command navigation & Ctrl Zoom shortcuts
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      // Home Key: Navigate to beginning/front of command line in bash/zsh/GNU Readline
      if (e.key === 'Home' || (!e.getModifierState?.('NumLock') && e.code === 'Numpad7')) {
        if (e.type === 'keydown') {
          // Standard Linux / VT220 readline beginning-of-line escape sequence (\x1b[1~)
          // For Ctrl+Home send \x1b[1;5H, Shift+Home send \x1b[1;2H
          const seq = e.ctrlKey ? '\x1b[1;5H' : e.shiftKey ? '\x1b[1;2H' : '\x1b[1~';
          terminalWrite(tabId, Array.from(new TextEncoder().encode(seq))).catch(() => {});
        }
        return false;
      }

      // End Key: Navigate to end of command line in bash/zsh/GNU Readline
      if (e.key === 'End' || (!e.getModifierState?.('NumLock') && e.code === 'Numpad1')) {
        if (e.type === 'keydown') {
          // Standard Linux / VT220 readline end-of-line escape sequence (\x1b[4~)
          // For Ctrl+End send \x1b[1;5F, Shift+End send \x1b[1;2F
          const seq = e.ctrlKey ? '\x1b[1;5F' : e.shiftKey ? '\x1b[1;2F' : '\x1b[4~';
          terminalWrite(tabId, Array.from(new TextEncoder().encode(seq))).catch(() => {});
        }
        return false;
      }

      // Keyboard Zoom Shortcuts (Ctrl+Plus, Ctrl+Minus, Ctrl+0)
      if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.key === 'Add')) {
        if (e.type === 'keydown') {
          updateZoom(fontSizeRef.current + 1);
        }
        return false;
      }
      if (e.ctrlKey && (e.key === '-' || e.key === '_' || e.key === 'Subtract')) {
        if (e.type === 'keydown') {
          updateZoom(fontSizeRef.current - 1);
        }
        return false;
      }
      if (e.ctrlKey && (e.key === '0' || e.key === 'NumPad0')) {
        if (e.type === 'keydown') {
          updateZoom(14);
        }
        return false;
      }
      return true;
    });

    const instance: TabInstance = {
      term,
      fitAddon,
      disposed: false,
      cleanup: () => {
        el.removeEventListener('wheel', handleWheel, { capture: true });
      },
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
      // Backend PTY is confirmed ready - dispatch queued initial command if present
      const initialCmd = pendingInitialCommandsRef.current.get(tabId);
      if (initialCmd) {
        pendingInitialCommandsRef.current.delete(tabId);
        setTimeout(async () => {
          const encoder = new TextEncoder();
          const bytes = Array.from(encoder.encode(initialCmd));
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              await terminalWrite(tabId, bytes);
              break;
            } catch (e) {
              if (attempt === 3) console.warn('Failed to send initial tab command:', e);
              await new Promise(r => setTimeout(r, 250));
            }
          }
        }, 300);
      }
    } catch (err: any) {
      initializingTabsRef.current.delete(tabId);
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

  // Execute external commands or directory requests sent to Terminal (e.g. Finder "Open Terminal Here")
  const pendingTerminalCommand = useEditorStore(s => s.pendingTerminalCommand);
  const clearTerminalCommand = useEditorStore(s => s.clearTerminalCommand);
  const pendingTerminalDir = useEditorStore(s => s.pendingTerminalDir);
  const clearPendingTerminalDir = useEditorStore(s => s.clearPendingTerminalDir);
  const isFirstMount = useRef(true);

  const addTab = (chosenConnId?: string, initialDir?: string) => {
    const newId = `tab-${Date.now()}`;
    const connId = chosenConnId || activeConnectionId || 'default';
    const s = connections.find(c => c.id === connId) || activeServer;
    const serverLabel = s?.name || s?.host || 'Server';
    const folderLabel = initialDir ? (initialDir === '/' ? '/' : initialDir.split('/').filter(Boolean).pop() || initialDir) : null;
    const nextNum = tabs.filter(t => t.connId === connId).length + 1;
    const title = folderLabel ? `${folderLabel} (${nextNum})` : `${serverLabel} (${nextNum})`;
    setTabs(prev => [
      ...prev,
      {
        id: newId,
        title,
        shell: '/bin/bash',
        connId,
        serverName: serverLabel
      }
    ]);
    setActiveTab(newId);
    setShowServerMenu(false);

    if (initialDir) {
      setTimeout(() => {
        const cmd = `cd "${initialDir}" && clear\r`;
        const encoder = new TextEncoder();
        const bytes = Array.from(encoder.encode(cmd));
        terminalWrite(newId, bytes).catch(() => {});
      }, 700);
    }
  };

  useEffect(() => {
    if (!pendingTerminalDir) return;
    const dir = pendingTerminalDir;
    clearPendingTerminalDir();

    if (isFirstMount.current && tabs.length === 1 && !tabInstances.current.has('tab-1')) {
      isFirstMount.current = false;
      const folderLabel = dir === '/' ? '/' : dir.split('/').filter(Boolean).pop() || dir;
      setTabs([{
        id: 'tab-1',
        title: `${folderLabel} (term)`,
        shell: '/bin/bash',
        connId: activeConnectionId,
        serverName: activeServer?.name || activeServer?.host || 'server'
      }]);
      setTimeout(() => {
        const cmd = `cd "${dir}" && clear\r`;
        const encoder = new TextEncoder();
        const bytes = Array.from(encoder.encode(cmd));
        terminalWrite('tab-1', bytes).catch(() => {});
      }, 700);
    } else {
      isFirstMount.current = false;
      addTab(activeConnectionId, dir);
    }
  }, [pendingTerminalDir, activeConnectionId, clearPendingTerminalDir]);

  useEffect(() => {
    if (!pendingTerminalCommand) return;
    const req = pendingTerminalCommand;
    clearTerminalCommand();

    const cmdStr = req.cmd.endsWith('\n') || req.cmd.endsWith('\r') ? req.cmd : req.cmd + '\n';

    // If a new tab is requested or if Terminal already has an active tab and newTab is specified
    if (req.newTab && (!isFirstMount.current || tabInstances.current.has('tab-1'))) {
      const newId = `tab-cmd-${Date.now()}`;
      const connId = activeConnectionId || 'default';
      const s = connections.find(c => c.id === connId) || activeServer;
      const serverLabel = s?.name || s?.host || 'Server';
      const tabTitle = req.title || 'terminal';

      pendingInitialCommandsRef.current.set(newId, cmdStr);

      setTabs(prev => [
        ...prev,
        {
          id: newId,
          title: tabTitle,
          shell: '/bin/bash',
          connId,
          serverName: serverLabel,
        }
      ]);
      setActiveTab(newId);
      return;
    }

    // If this is the initial mount and tab-1 has not connected yet:
    if (!tabInstances.current.has('tab-1')) {
      if (req.title) {
        setTabs(prev => prev.map(t => t.id === 'tab-1' ? { ...t, title: req.title! } : t));
      }
      pendingInitialCommandsRef.current.set('tab-1', cmdStr);
      return;
    }

    // Otherwise target activeTab with retries
    const targetTabId = activeTab;
    const sendWithRetry = async (attempts = 6) => {
      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(cmdStr));
      for (let i = 0; i < attempts; i++) {
        try {
          await terminalWrite(targetTabId, bytes);
          return;
        } catch (err) {
          if (i === attempts - 1) {
            console.warn('Failed terminalWrite after retries:', err);
          }
          await new Promise(r => setTimeout(r, 250));
        }
      }
    };
    sendWithRetry();
  }, [pendingTerminalCommand, activeTab, activeConnectionId, clearTerminalCommand, connections, activeServer]);

  // Also listen for direct window event dispatch for terminal commands
  useEffect(() => {
    const handleRunCmdEvent = (e: any) => {
      const detail = e.detail;
      if (!detail || !detail.cmd) return;
      const cmdStr = detail.cmd.endsWith('\n') || detail.cmd.endsWith('\r') ? detail.cmd : detail.cmd + '\n';
      if (detail.newTab) {
        const newId = `tab-cmd-${Date.now()}`;
        const connId = activeConnectionId || 'default';
        const s = connections.find(c => c.id === connId) || activeServer;
        const serverLabel = s?.name || s?.host || 'Server';
        const tabTitle = detail.title || 'terminal';
        pendingInitialCommandsRef.current.set(newId, cmdStr);
        setTabs(prev => [
          ...prev,
          {
            id: newId,
            title: tabTitle,
            shell: '/bin/bash',
            connId,
            serverName: serverLabel,
          }
        ]);
        setActiveTab(newId);
      } else {
        const encoder = new TextEncoder();
        terminalWrite(activeTab, Array.from(encoder.encode(cmdStr))).catch(() => {});
      }
    };

    window.addEventListener('sshdesktop:terminal-run-command', handleRunCmdEvent);
    window.addEventListener('clouddesk:terminal-run-command', handleRunCmdEvent);
    return () => {
      window.removeEventListener('sshdesktop:terminal-run-command', handleRunCmdEvent);
      window.removeEventListener('clouddesk:terminal-run-command', handleRunCmdEvent);
    };
  }, [activeTab, activeConnectionId, connections, activeServer]);

  const pendingDockerTerminal = useEditorStore(s => s.pendingDockerTerminal);
  const clearPendingDockerTerminal = useEditorStore(s => s.clearPendingDockerTerminal);

  useEffect(() => {
    if (!pendingDockerTerminal) return;
    const req = pendingDockerTerminal;
    clearPendingDockerTerminal();

    // Check if an existing tab is already running this container
    const existing = tabs.find(t => t.dockerContainerId === req.containerId);
    if (existing) {
      setActiveTab(existing.id);
      setTimeout(() => {
        const inst = tabInstances.current.get(existing.id);
        inst?.term.focus();
      }, 50);
      return;
    }

    const newId = `tab-docker-${Date.now()}`;
    const connId = activeConnectionId || 'default';
    const s = connections.find(c => c.id === connId) || activeServer;
    const serverLabel = s?.name || s?.host || 'Server';
    const execCmd = req.initialCmd || `docker exec -it ${req.containerId} sh -c "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"\n`;

    // Queue command for execution right after terminalCreate finishes
    pendingInitialCommandsRef.current.set(newId, execCmd);

    setTabs(prev => [
      ...prev,
      {
        id: newId,
        title: `🐳 ${req.containerName}`,
        shell: 'docker exec',
        connId,
        serverName: serverLabel,
        dockerContainerId: req.containerId,
      }
    ]);
    setActiveTab(newId);
  }, [pendingDockerTerminal, tabs, activeConnectionId, clearPendingDockerTerminal, connections, activeServer]);

  const removeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;

    terminalClose(id).catch(() => {});
    initializingTabsRef.current.delete(id);
    const inst = tabInstances.current.get(id);
    if (inst) {
      inst.disposed = true;
      inst.cleanup?.();
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
      <div className="flex items-center justify-between bg-[#11111a] border-b border-white/[0.08] px-2 pt-1.5 space-x-1 shrink-0 overflow-x-auto no-scrollbar gap-2">
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar shrink-0">
          {tabs.map(tab => (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-t-xl text-xs font-mono transition-colors cursor-pointer group shrink-0 ${
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

          <div className="relative shrink-0">
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
        <div className="flex items-center space-x-1.5 pb-1 shrink-0">
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
            onClick={() => sendQuickCommand("alias ls='ls --color=auto' grep='grep --color=auto' ll='ls -la --color=auto' 2>/dev/null; export TERM=xterm-256color COLORTERM=truecolor CLICOLOR=1; echo -e '\\033[1;32m✓ Full 256-Color & TrueColor Activated!\\033[0m'")}
            className="px-2.5 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/25 rounded-lg text-xs font-mono flex items-center space-x-1 transition-colors cursor-pointer"
            title="Enable full 256-color, truecolor, and colorful ls/grep command outputs in remote shell"
          >
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
            <span>Colorize</span>
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
      <div 
        className="flex-1 relative overflow-hidden terminal-app"
        style={{ backgroundColor: currentTheme.background }}
        onContextMenu={handleContextMenu}
        onClick={() => {
          if (showThemeMenu) setShowThemeMenu(false);
          if (showMarginMenu) setShowMarginMenu(false);
          if (showServerMenu) setShowServerMenu(false);
        }}
      >
        {tabs.map(tab => (
          <div
            key={tab.id}
            ref={el => {
              if (el) {
                containersRef.current.set(tab.id, el);
                setupTabInstance(tab.id, el);
              }
            }}
            className="absolute inset-0"
            style={{ 
              display: activeTab === tab.id ? 'block' : 'none',
              padding: `${padding}px`,
              backgroundColor: currentTheme.background
            }}
          />
        ))}
      </div>

      {/* Terminal Status Bar */}
      <div className="h-6 bg-[#0f0f18] border-t border-white/[0.08] px-3 flex items-center justify-between text-[11px] font-mono text-gray-400 shrink-0 relative select-none">
        <div className="flex items-center space-x-3">
          <span className="flex items-center space-x-1.5 text-emerald-400">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>PuTTY-Grade Raw PTY</span>
          </span>
          <span className="text-cyan-400 font-semibold flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <span>256color / TrueColor</span>
          </span>
          <span>UTF-8</span>
          <span className="text-gray-500">Session: {activeTab}</span>
        </div>
        <div className="flex items-center space-x-2">
          {/* Theme Selector Popover */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowThemeMenu(!showThemeMenu);
                setShowMarginMenu(false);
              }}
              className="flex items-center space-x-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded px-2 py-0.5 text-gray-300 transition-colors cursor-pointer"
              title="Change Terminal Color Theme"
            >
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: currentTheme.dotColor }} />
              <span className="text-[10px]">{currentTheme.name}</span>
              <ChevronDown className="w-2.5 h-2.5 text-gray-400" />
            </button>

            {showThemeMenu && (
              <div 
                className="absolute right-0 bottom-7 bg-[#1e1e2e] border border-white/15 rounded-xl shadow-2xl py-1 z-50 text-xs w-48 font-sans"
                onClick={e => e.stopPropagation()}
              >
                <div className="px-3 py-1 text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                  Color Themes
                </div>
                {TERMINAL_THEMES.map(t => (
                  <button
                    key={t.id}
                    onClick={() => {
                      updateTheme(t.id);
                      setShowThemeMenu(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-blue-600/30 hover:text-white cursor-pointer flex items-center justify-between transition-colors ${
                      themeId === t.id ? 'text-blue-400 font-semibold bg-white/[0.05]' : 'text-gray-300'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.dotColor }} />
                      <span className="text-xs">{t.name}</span>
                    </div>
                    {themeId === t.id && <Check className="w-3.5 h-3.5 text-blue-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Margin / Padding Selector Popover */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMarginMenu(!showMarginMenu);
                setShowThemeMenu(false);
              }}
              className="flex items-center space-x-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] rounded px-2 py-0.5 text-gray-300 transition-colors cursor-pointer"
              title="Terminal 4-Side Margins (Padding)"
            >
              <span className="text-[10px]">Margin: {padding}px</span>
              <ChevronDown className="w-2.5 h-2.5 text-gray-400" />
            </button>

            {showMarginMenu && (
              <div 
                className="absolute right-0 bottom-7 bg-[#1e1e2e] border border-white/15 rounded-xl shadow-2xl py-1 z-50 text-xs w-44 font-sans"
                onClick={e => e.stopPropagation()}
              >
                <div className="px-3 py-1 text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                  4-Side Margin
                </div>
                {[
                  { label: 'Comfortable (16px)', val: 16 },
                  { label: 'Spacious (20px)', val: 20 },
                  { label: 'Balanced (12px)', val: 12 },
                  { label: 'Compact (8px)', val: 8 },
                ].map(opt => (
                  <button
                    key={opt.val}
                    onClick={() => {
                      updatePadding(opt.val);
                      setShowMarginMenu(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 hover:bg-blue-600/30 hover:text-white cursor-pointer flex items-center justify-between transition-colors ${
                      padding === opt.val ? 'text-blue-400 font-semibold bg-white/[0.05]' : 'text-gray-300'
                    }`}
                  >
                    <span>{opt.label}</span>
                    {padding === opt.val && <Check className="w-3.5 h-3.5 text-blue-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Font Zoom Indicator & Controls */}
          <div className="flex items-center bg-white/[0.04] border border-white/[0.08] rounded px-1.5 py-0.5 space-x-1 text-gray-300">
            <button
              onClick={() => updateZoom(fontSizeRef.current - 1)}
              className="hover:text-white transition-colors cursor-pointer p-0.5"
              title="Zoom out (Ctrl + - or Ctrl + Scroll Down)"
            >
              <ZoomOut className="w-3 h-3 text-gray-400 hover:text-white" />
            </button>
            <button
              onClick={() => updateZoom(14)}
              className="hover:text-blue-400 transition-colors cursor-pointer text-[10px] font-mono px-1 hover:bg-white/[0.06] rounded"
              title="Reset zoom to 100% / 14px (Ctrl + 0 or Click)"
            >
              {fontSize}px ({Math.round((fontSize / 14) * 100)}%)
            </button>
            <button
              onClick={() => updateZoom(fontSizeRef.current + 1)}
              className="hover:text-white transition-colors cursor-pointer p-0.5"
              title="Zoom in (Ctrl + + or Ctrl + Scroll Up)"
            >
              <ZoomIn className="w-3 h-3 text-blue-400 hover:text-blue-300" />
            </button>
          </div>
          <span>{activeServer?.username || 'root'}@{activeServer?.host || 'server'}</span>
          <span>/bin/bash</span>
        </div>
      </div>

      {/* Floating Terminal Context Menu */}
      {contextMenu && (
        <PortalContextMenu 
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          className="w-52 bg-[#181825]/95 backdrop-blur-xl border border-white/15 rounded-xl shadow-[0_15px_50px_rgba(0,0,0,0.6)] py-1.5 text-xs text-gray-200 select-none font-sans"
        >
          {contextMenu.hasSelection && (
            <button
              onClick={handleCopySelection}
              className="w-full px-3 py-1.5 hover:bg-blue-600 hover:text-white flex items-center justify-between text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center space-x-2">
                <Copy className="w-3.5 h-3.5 text-blue-400" />
                <span>Copy Selection</span>
              </div>
              <span className="text-[10px] text-gray-400 font-mono">Ctrl+C</span>
            </button>
          )}

          <button
            onClick={handlePasteClipboard}
            className="w-full px-3 py-1.5 hover:bg-blue-600 hover:text-white flex items-center justify-between text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <Clipboard className="w-3.5 h-3.5 text-emerald-400" />
              <span>Paste from Clipboard</span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">Ctrl+V</span>
          </button>

          <button
            onClick={handleSelectAll}
            className="w-full px-3 py-1.5 hover:bg-blue-600 hover:text-white flex items-center justify-between text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <CornerDownLeft className="w-3.5 h-3.5 text-gray-400" />
              <span>Select All</span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">Ctrl+A</span>
          </button>

          <div className="my-1 border-t border-white/10 mx-2" />

          <button
            onClick={handleClearScreen}
            className="w-full px-3 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 text-left transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Clear Screen (clear)</span>
          </button>

          <button
            onClick={handleResetTerminal}
            className="w-full px-3 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 text-left transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Reset & Redraw</span>
          </button>

          <div className="my-1 border-t border-white/10 mx-2" />

          <button
            onClick={() => { addTab(); setContextMenu(null); }}
            className="w-full px-3 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 text-left transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>New Terminal Tab</span>
          </button>

          <button
            onClick={() => { handleLaunchPutty(); setContextMenu(null); }}
            className="w-full px-3 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 text-left transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
            <span>Launch Standalone PuTTY</span>
          </button>
        </PortalContextMenu>
      )}

      {/* Copy Toast */}
      {copiedNotice && (
        <div className="absolute bottom-10 right-4 bg-emerald-600/90 text-white px-3 py-1.5 rounded-lg shadow-xl text-xs flex items-center space-x-2 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 select-none z-[99999]">
          <Check className="w-3.5 h-3.5" />
          <span>Copied to clipboard!</span>
        </div>
      )}
    </div>
  );
}

