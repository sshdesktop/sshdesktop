import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { 
  Cloud, Bell, LogOut, Settings, ShieldCheck, Terminal, Cpu, MemoryStick,
  Palette, Sun, Moon, Minimize2, Eye, EyeOff, Server, ChevronDown, Check, Plus, X, Lock,
  Trash2, Search, Key, Upload, FileCode, ArrowRight, Shield, Globe, RefreshCw,
  Folder, Activity, Container, Database, HardDrive, Flame, ScrollText, Package,
  Users, Clock, StickyNote, Variable, KeyRound, Compass, Send, LayoutGrid, Monitor
} from 'lucide-react';
import { useConnectionStore, useSettingsStore, useWindowStore, useTelemetryStore } from '../lib/store';
import { useWindowManager } from '../lib/hooks/useWindowManager';
import { pickKeyFile } from '../lib/tauri-bridge';

const TASKBAR_ICONS: Record<string, React.ElementType> = {
  terminal: Terminal,
  files: Folder,
  editor: FileCode,
  ssh: KeyRound,
  browser: Compass,
  api: Send,
  monitor: Monitor,
  processes: Activity,
  services: Server,
  docker: Container,
  logs: ScrollText,
  env: Variable,
  database: Database,
  disks: HardDrive,
  network: Globe,
  firewall: Flame,
  packages: Package,
  users: Users,
  cron: Clock,
  security: Shield,
  notes: StickyNote,
  settings: Settings,
};

function getTaskbarIcon(appId: string): React.ElementType {
  return TASKBAR_ICONS[appId] || Terminal;
}

export default function Taskbar({ 
  onOpenWallpapers, 
  onLockScreen,
  onToggleLauncher,
}: { 
  onOpenWallpapers?: () => void;
  onLockScreen?: () => void;
  onToggleLauncher?: () => void;
}) {
  const { 
    activeConnectionId, 
    connections, 
    connectedServers,
    setActive, 
    disconnect, 
    connect, 
    addConnection, 
    updateConnection,
    removeConnection 
  } = useConnectionStore();
  const { theme, updateSettings } = useSettingsStore();
  const { minimizeAllWindows, windows, closeWindow, minimizeWindow, restoreWindow, focusWindow, bringToFront } = useWindowStore();
  const { openApp } = useWindowManager();

  const [time, setTime] = useState('');
  const [showAppleMenu, setShowAppleMenu] = useState(false);
  const [showAddServerModal, setShowAddServerModal] = useState(false);
  const [modalTab, setModalTab] = useState<'saved' | 'new'>('saved');
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  // Search & Credential Prompt State
  const [serverSearchQuery, setServerSearchQuery] = useState('');
  const [promptConn, setPromptConn] = useState<any | null>(null);
  const [promptPassword, setPromptPassword] = useState('');
  const [showPromptPassword, setShowPromptPassword] = useState(false);
  const [promptKeyPath, setPromptKeyPath] = useState('');
  const [promptSaveCredentials, setPromptSaveCredentials] = useState(true);
  const [saveNewServerCredentials, setSaveNewServerCredentials] = useState(true);

  // New server form state
  const [authMethod, setAuthMethod] = useState<'password' | 'key'>('password');
  const [showPassword, setShowPassword] = useState(false);
  const [uploadedKeyFile, setUploadedKeyFile] = useState<{ name: string; size: string; content: string } | null>(null);
  const keyFileInputRef = useRef<HTMLInputElement | null>(null);

  const [newServerForm, setNewServerForm] = useState({
    name: '',
    host: '',
    port: 22,
    username: 'root',
    password: '',
    privateKeyPath: '',
  });

  const cpuUsage = useTelemetryStore(s => s.cpu);
  const ramUsage = useTelemetryStore(s => s.ramPct);

  // Live Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSelectKeyFile = async () => {
    const selectedPath = await pickKeyFile();
    if (selectedPath) {
      const fileName = selectedPath.split(/[\\/]/).pop() || selectedPath;
      setNewServerForm(f => ({ ...f, privateKeyPath: selectedPath }));
      setUploadedKeyFile({
        name: `${fileName} [OpenSSH (.pem)]`,
        size: 'Local file',
        content: selectedPath,
      });
    } else {
      keyFileInputRef.current?.click();
    }
  };

  const handleKeyFileUpload = (file: File) => {
    const nativePath = (file as any).path;
    if (nativePath) {
      setNewServerForm(f => ({ ...f, privateKeyPath: nativePath }));
      setUploadedKeyFile({
        name: `${file.name} [OpenSSH (.pem)]`,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        content: nativePath,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      let detectedType = 'OpenSSH Private Key (.pem)';
      if (text.includes('OPENSSH PRIVATE KEY')) detectedType = 'OpenSSH (.pem)';
      else if (text.includes('RSA PRIVATE KEY')) detectedType = 'RSA (.pem)';
      else if (file.name.toLowerCase().endsWith('.pem')) detectedType = 'PEM (.pem)';

      setUploadedKeyFile({
        name: `${file.name} [${detectedType}]`,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        content: text,
      });
      setNewServerForm(f => ({ ...f, privateKeyPath: text }));
    };
    reader.readAsText(file);
  };

  const handleConnectNewServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerForm.host.trim() || !newServerForm.username.trim()) return;
    setIsConnecting(true);
    setConnectError(null);
    try {
      const isFilePath = (str?: string) => str && !str.includes('\n') && (str.includes('/') || str.includes('\\') || str.endsWith('.pem'));
      const targetId = `server-${Date.now()}`;
      const effectiveKey = newServerForm.privateKeyPath || uploadedKeyFile?.content;
      const targetConfig: any = {
        id: targetId,
        name: newServerForm.name.trim() || `${newServerForm.username.trim()}@${newServerForm.host.trim()}`,
        host: newServerForm.host.trim(),
        port: Number(newServerForm.port) || 22,
        username: newServerForm.username.trim(),
        authMethod,
        password: newServerForm.password?.trim() || undefined,
        privateKeyPath: authMethod === 'key' ? effectiveKey : undefined,
        color: '#89b4fa',
        group: 'Servers',
        tags: ['Linux', 'SSH2 direct'],
        created_at: Date.now()
      };
      const profileToSave = {
        ...targetConfig,
        password: saveNewServerCredentials ? (newServerForm.password?.trim() || undefined) : undefined,
        privateKeyPath: saveNewServerCredentials && authMethod === 'key' ? targetConfig.privateKeyPath : undefined,
      };
      addConnection(profileToSave);
      await connect(targetId, targetConfig);
      setShowAddServerModal(false);
      setNewServerForm({ name: '', host: '', port: 22, username: 'root', password: '', privateKeyPath: '' });
      setUploadedKeyFile(null);
    } catch (err: any) {
      setConnectError(err?.message || 'Failed to connect to server');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleQuickConnectSaved = async (connId: string) => {
    setConnectError(null);
    const target = connections.find(c => c.id === connId);
    if (!target) return;

    const isKeyAuth = target.authMethod === 'key' || (target as any).auth_method === 'key';
    const hasKey = target.privateKeyPath || (target as any).private_key_path;
    const hasPassword = Boolean(target.password);

    if (isKeyAuth && !hasKey) {
      setPromptConn(target);
      setPromptPassword('');
      setPromptKeyPath('');
      return;
    }

    if (!isKeyAuth && !hasPassword) {
      setPromptConn(target);
      setPromptPassword('');
      setPromptKeyPath('');
      return;
    }

    setIsConnecting(true);
    try {
      await connect(connId, target);
      setShowAddServerModal(false);
    } catch (err: any) {
      setConnectError(err?.message || 'Failed to connect to saved server');
    } finally {
      setIsConnecting(false);
    }
  };

  const handlePromptConnect = async () => {
    if (!promptConn) return;
    setIsConnecting(true);
    setConnectError(null);
    try {
      const effectiveConfig = {
        ...promptConn,
        password: promptPassword || promptConn.password,
        privateKeyPath: promptKeyPath || promptConn.privateKeyPath,
      };
      if (promptSaveCredentials) {
        const toSave = {
          ...effectiveConfig,
          privateKeyPath: effectiveConfig.privateKeyPath,
        };
        updateConnection(promptConn.id, toSave);
      }
      await connect(promptConn.id, effectiveConfig);
      setPromptConn(null);
      setShowAddServerModal(false);
    } catch (err: any) {
      setConnectError(err?.message || 'Authentication failed');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDeleteProfile = (connId: string, profileName: string) => {
    if (confirm(`Are you sure you want to delete profile "${profileName}"?`)) {
      removeConnection(connId);
    }
  };

  const handleDisconnectServer = async (connId: string, connName: string) => {
    if (!confirm(`Are you sure you want to disconnect from server "${connName}"?`)) {
      return;
    }
    // Close only windows belonging to this server
    windows.filter(w => w.serverId === connId).forEach(w => closeWindow(w.id));
    await disconnect(connId);
    // If there are other connected servers, select the first remaining one
    const remaining = Array.from(connectedServers.keys()).filter(id => id !== connId);
    if (remaining.length > 0) {
      setActive(remaining[0]);
    }
  };

  const isLight = theme === 'light';

  return (
    <div className={`taskbar-bar fixed top-0 left-0 w-full h-8 backdrop-blur-xl border-b flex items-center justify-between px-2.5 z-[999999] text-xs window-drag select-none shadow-sm ${
      isLight ? 'bg-white/85 text-slate-800 border-black/10' : 'bg-[#14141e]/90 text-gray-300 border-white/[0.08]'
    }`}>
      {/* LEFT SECTION: 1st = START, 2nd = SOFTWARE (Professionally Aligned) */}
      <div className="flex items-center space-x-2 window-no-drag flex-1 min-w-0 pr-4">
        {/* 1st: START BUTTON */}
        <div className="relative shrink-0">
          <button
            onClick={() => onToggleLauncher?.()}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg font-bold transition-all cursor-pointer select-none border shadow-sm active:scale-95 ${
              isLight
                ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-500 shadow-blue-500/20'
                : 'bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:brightness-110 text-white border-blue-400/40 shadow-[0_2px_12px_rgba(37,99,235,0.35)]'
            }`}
            title="Start Menu - All Software & Tools (Click to open Launchpad)"
          >
            <Cloud className="w-4 h-4 text-white" />
            <span className="font-bold tracking-tight text-xs">Start</span>
          </button>
        </div>

        {/* System Controls Dropdown (System ▾) */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowAppleMenu(!showAppleMenu)}
            className={`flex items-center space-x-1 px-2 py-1 rounded-lg font-medium transition-colors cursor-pointer border ${
              isLight 
                ? 'hover:bg-black/5 text-slate-800 border-black/10' 
                : 'hover:bg-white/10 text-gray-300 border-white/10 bg-white/[0.03]'
            }`}
            title="CloudDesk System Preferences & Controls"
          >
            <span className="font-semibold text-[11px]">System</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {showAppleMenu && (
            <div
              className={`absolute left-0 top-8 w-56 backdrop-blur-2xl border rounded-xl shadow-2xl py-1 z-50 text-xs ${
                isLight ? 'bg-white/95 border-black/10 text-slate-800' : 'bg-[#1e1e2e]/95 border-white/10 text-gray-200'
              }`}
              onClick={() => setShowAppleMenu(false)}
            >
              <div
                onClick={() => openApp('settings', 'System Settings')}
                className="px-3 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>System Settings...</span>
              </div>
              <div
                onClick={() => onOpenWallpapers?.()}
                className="px-3 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
              >
                <Palette className="w-3.5 h-3.5 text-pink-400" />
                <span>Desktop Wallpapers (4K)...</span>
              </div>
              <div className={`my-1 border-t ${isLight ? 'border-slate-200' : 'border-white/10'}`} />
              <div
                onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
                className="px-3 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center space-x-2">
                  {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-blue-400" />}
                  <span>{theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}</span>
                </div>
              </div>
              <div
                onClick={() => minimizeAllWindows()}
                className="px-3 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Show Desktop (Minimize All)</span>
              </div>
              <div
                onClick={() => onLockScreen?.()}
                className="px-3 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between"
              >
                <div className="flex items-center space-x-2">
                  <Lock className="w-3.5 h-3.5 text-amber-400" />
                  <span>Lock Screen</span>
                </div>
                <span className="text-[10px] text-gray-400 font-mono">⌃⌘L / ⊞L</span>
              </div>
              <div className={`my-1 border-t ${isLight ? 'border-slate-200' : 'border-white/10'}`} />
              <div
                onClick={() => {
                  if (activeConnectionId) {
                    const currentConn = connections.find(c => c.id === activeConnectionId);
                    handleDisconnectServer(activeConnectionId, currentConn?.name || currentConn?.host || 'server');
                  }
                }}
                className="px-3 py-1.5 hover:bg-red-600/20 text-red-500 cursor-pointer flex items-center space-x-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out Server</span>
              </div>
            </div>
          )}
        </div>

        {/* Divider between 1st (Start) and 2nd (Software) */}
        <div className={`w-px h-5 mx-0.5 shrink-0 ${isLight ? 'bg-black/15' : 'bg-white/15'}`} />

        {/* 2nd: SOFTWARE (Active Running Windows & Quick-Launch Software) */}
        <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none py-0.5 min-w-0">
          {/* Running Software Window Tabs */}
          {windows.map(win => {
            const isFocused = win.focused && !win.minimized;
            const Icon = getTaskbarIcon(win.appId);
            return (
              <button
                key={win.id}
                onClick={() => {
                  if (win.focused && !win.minimized) {
                    minimizeWindow(win.id);
                  } else {
                    restoreWindow(win.id);
                    bringToFront(win.id);
                    focusWindow(win.id);
                  }
                }}
                className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-lg text-xs transition-all cursor-pointer max-w-[170px] truncate border group select-none shrink-0 ${
                  isFocused
                    ? 'bg-blue-600/35 border-blue-400/70 text-white font-semibold shadow-sm ring-1 ring-blue-400/30'
                    : win.minimized
                    ? 'bg-black/25 border-white/10 text-gray-400 hover:text-white opacity-70'
                    : isLight
                    ? 'bg-black/5 border-black/10 text-slate-700 hover:text-slate-900 hover:bg-black/10'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:text-white hover:bg-white/10'
                }`}
                title={`${win.title}${win.minimized ? ' (Minimized)' : ''}`}
              >
                <Icon className={`w-3.5 h-3.5 shrink-0 ${isFocused ? 'text-blue-400' : 'text-gray-400'}`} />
                <span className="truncate text-[11px] font-sans">{win.title}</span>
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    closeWindow(win.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 rounded text-[10px] ml-auto transition-opacity"
                  title="Close Window"
                >
                  ✕
                </span>
              </button>
            );
          })}

          {/* Quick-Launch Software shortcuts when no windows are open */}
          {windows.length === 0 && (
            <div className="flex items-center space-x-1 text-gray-400 shrink-0">
              {[
                { id: 'terminal', label: 'Terminal', icon: Terminal },
                { id: 'files', label: 'Files', icon: Folder },
                { id: 'editor', label: 'Editor', icon: FileCode },
                { id: 'monitor', label: 'Monitor', icon: Monitor },
                { id: 'docker', label: 'Docker', icon: Container },
              ].map(app => {
                const AppIcon = app.icon;
                return (
                  <button
                    key={app.id}
                    onClick={() => openApp(app.id, app.label)}
                    className={`flex items-center space-x-1.5 px-2.5 py-0.5 rounded-lg transition-all text-[11px] font-medium border cursor-pointer ${
                      isLight
                        ? 'bg-black/5 border-black/5 text-slate-700 hover:bg-blue-600 hover:text-white hover:border-blue-500'
                        : 'bg-white/5 border-white/5 text-gray-300 hover:bg-blue-600 hover:text-white hover:border-blue-500'
                    }`}
                    title={`Launch ${app.label}`}
                  >
                    <AppIcon className="w-3.5 h-3.5 text-blue-400 group-hover:text-white" />
                    <span>{app.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right System Tray */}
      <div className="flex items-center space-x-3 window-no-drag font-mono text-[11px] shrink-0">
        {/* Connected Servers Horizontal Tab Bar with + button */}
        <div className="flex items-center space-x-1 max-w-lg overflow-x-auto scrollbar-none py-0.5">
          {(() => {
            const connectedList = connections.filter(c => connectedServers?.has(c.id));
            const displayServers = connectedList.length > 0 
              ? connectedList 
              : (activeConnectionId ? connections.filter(c => c.id === activeConnectionId) : []);

            return displayServers.map(c => {
              const isActive = c.id === activeConnectionId;
              return (
                <div
                  key={c.id}
                  onClick={async () => {
                    setActive(c.id);
                    try {
                      await connect(c.id, c);
                    } catch (e) {
                      console.warn('Switch server connect notice:', e);
                    }
                  }}
                  className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg text-xs font-sans transition-all cursor-pointer select-none group shrink-0 ${
                    isActive
                      ? 'bg-blue-600 text-white font-semibold shadow-sm'
                      : isLight
                      ? 'bg-black/5 text-slate-700 hover:text-slate-900 hover:bg-black/10 border border-black/5'
                      : 'bg-white/5 text-gray-300 hover:text-white hover:bg-white/10 border border-white/5'
                  }`}
                  title={`Active Server: ${c.username}@${c.host}:${c.port}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-300 animate-pulse' : 'bg-gray-400'}`} />
                  <span className="truncate max-w-[120px]">{c.name || c.host}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDisconnectServer(c.id, c.name || c.host);
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-red-400 p-0.5 rounded transition-opacity"
                    title="Disconnect server tab"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              );
            });
          })()}

          {/* Plus button to open centered Connect Server modal */}
          <button
            onClick={() => {
              setConnectError(null);
              setModalTab(connections.length > 0 ? 'saved' : 'new');
              setShowAddServerModal(true);
            }}
            className="flex items-center justify-center w-6 h-6 rounded-lg bg-blue-600/20 hover:bg-blue-600/50 text-blue-300 hover:text-white border border-blue-400/30 transition-all cursor-pointer shadow-sm active:scale-90 shrink-0"
            title="Connect another Linux server (+)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Live Gauges */}
        <div className="flex items-center space-x-1 text-blue-400" title="Live CPU Utilization">
          <Cpu className="w-3 h-3" />
          <span>{cpuUsage}%</span>
        </div>
        <div className="flex items-center space-x-1 text-purple-400" title="Live Memory Utilization">
          <MemoryStick className="w-3 h-3" />
          <span>{ramUsage}%</span>
        </div>

        {/* Theme Quick Toggle */}
        <button
          onClick={() => updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })}
          className="p-1 rounded hover:bg-white/10 text-gray-300 hover:text-amber-300 transition-colors"
          title={`Switch to ${theme === 'dark' ? 'Light Mode' : 'Dark Mode'}`}
        >
          {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-blue-400" />}
        </button>

        {/* Glance Desktop button */}
        <button
          onClick={() => minimizeAllWindows()}
          className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
          title="Minimize All Windows"
        >
          <Minimize2 className="w-3.5 h-3.5" />
        </button>

        {/* Prominent Log Out Button */}
        <button
          onClick={() => {
            if (activeConnectionId) {
              const currentConn = connections.find(c => c.id === activeConnectionId);
              handleDisconnectServer(activeConnectionId, currentConn?.name || currentConn?.host || 'server');
            }
          }}
          className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 hover:text-white border border-rose-500/30 transition-all font-sans cursor-pointer"
          title="Log Out & Disconnect Server"
        >
          <LogOut className="w-3 h-3" />
          <span className="font-semibold text-[11px]">Log Out</span>
        </button>

        {/* Clock */}
        <span className="text-gray-200 font-sans pl-1">{time}</span>
      </div>

      {/* Centered Connect Another Linux Server Modal */}
      {showAddServerModal && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-md z-[99999] flex items-center justify-center p-4 window-no-drag animate-in fade-in duration-150 select-none"
          onClick={() => setShowAddServerModal(false)}
        >
          <div 
            className="bg-[#1e1e2e]/98 border border-white/20 rounded-3xl w-full max-w-lg p-6 shadow-[0_30px_90px_rgba(0,0,0,0.8)] space-y-4 max-h-[90vh] flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <Server className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-base text-white">Server Connections</h3>
              </div>
              <button 
                onClick={() => setShowAddServerModal(false)} 
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Segmented Tab Switcher */}
            <div className="flex bg-black/40 p-1 rounded-xl border border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setModalTab('saved')}
                className={`flex-1 py-1.5 rounded-lg flex items-center justify-center space-x-2 transition-all font-medium ${
                  modalTab === 'saved'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Server className="w-3.5 h-3.5" />
                <span>Saved Profiles ({connections.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setModalTab('new')}
                className={`flex-1 py-1.5 rounded-lg flex items-center justify-center space-x-2 transition-all font-medium ${
                  modalTab === 'new'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Connect New Server</span>
              </button>
            </div>

            {/* Error Message */}
            {connectError && (
              <div className="p-2.5 bg-rose-500/15 border border-rose-500/30 rounded-xl text-rose-300 text-xs flex items-center space-x-2">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                <span className="flex-1">{connectError}</span>
              </div>
            )}

            {/* Tab 1: Saved Server Profiles */}
            {modalTab === 'saved' && (
              <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[400px]">
                {/* Search Bar */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search saved servers by name, IP, user..."
                    value={serverSearchQuery}
                    onChange={(e) => setServerSearchQuery(e.target.value)}
                    className="w-full bg-[#11111b] border border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  {serverSearchQuery && (
                    <button
                      onClick={() => setServerSearchQuery('')}
                      className="absolute right-2.5 top-2 text-gray-400 hover:text-white"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Inline Credential Prompt when credentials are missing */}
                {promptConn && (
                  <div className="p-3.5 rounded-2xl bg-blue-600/15 border border-blue-500/40 space-y-3 animate-in fade-in duration-150">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Lock className="w-4 h-4 text-amber-400" />
                        <span className="font-semibold text-xs text-white">
                          Credentials Required: {promptConn.name || promptConn.host}
                        </span>
                      </div>
                      <button
                        onClick={() => setPromptConn(null)}
                        className="text-gray-400 hover:text-white"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {(promptConn.authMethod === 'key' || (promptConn as any).auth_method === 'key') ? (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-gray-300 block">Select SSH Private Key</label>
                        <div 
                          onClick={async () => {
                            const p = await pickKeyFile();
                            if (p) setPromptKeyPath(p);
                          }}
                          className="cursor-pointer bg-[#11111b] border border-dashed border-white/20 hover:border-blue-500/60 rounded-xl p-2.5 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <Key className="w-4 h-4 text-blue-400 shrink-0" />
                            <span className="text-gray-300 truncate font-mono text-[11px]">
                              {promptKeyPath || 'Click to select key (.pem, id_rsa, id_ed25519)...'}
                            </span>
                          </div>
                          <span className="text-[10px] text-blue-400 shrink-0 font-medium ml-2">Browse</span>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <label className="text-[11px] text-gray-300 block">Password</label>
                        <div className="relative flex items-center">
                          <input
                            type={showPromptPassword ? 'text' : 'password'}
                            autoFocus
                            placeholder="Enter SSH password..."
                            value={promptPassword}
                            onChange={e => setPromptPassword(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handlePromptConnect(); }}
                            className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 pr-9 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPromptPassword(!showPromptPassword)}
                            className="absolute right-2.5 text-gray-400 hover:text-white"
                          >
                            {showPromptPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <label className="flex items-center space-x-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={promptSaveCredentials}
                          onChange={e => setPromptSaveCredentials(e.target.checked)}
                          className="w-3.5 h-3.5 rounded border-white/20 bg-white/10 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <span className="text-[11px] text-gray-300">Save credentials to this profile</span>
                      </label>
                      <button
                        onClick={handlePromptConnect}
                        disabled={isConnecting}
                        className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center space-x-1.5 transition-colors shadow-sm disabled:opacity-50"
                      >
                        {isConnecting && <RefreshCw className="w-3 h-3 animate-spin" />}
                        <span>Connect</span>
                      </button>
                    </div>
                  </div>
                )}

                {connections.length === 0 ? (
                  <div className="py-8 text-center space-y-3">
                    <Server className="w-10 h-10 text-gray-500 mx-auto" />
                    <p className="text-xs text-gray-400">No saved server profiles found.</p>
                    <button
                      onClick={() => setModalTab('new')}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium"
                    >
                      Create First Connection
                    </button>
                  </div>
                ) : (
                  connections
                    .filter(c => {
                      if (!serverSearchQuery.trim()) return true;
                      const q = serverSearchQuery.trim().toLowerCase();
                      return (c.name || '').toLowerCase().includes(q) ||
                        (c.host || '').toLowerCase().includes(q) ||
                        (c.username || '').toLowerCase().includes(q);
                    })
                    .map(conn => {
                      const isCurrent = conn.id === activeConnectionId;

                      return (
                        <div
                          key={conn.id}
                          className={`p-3 rounded-2xl border transition-all flex items-center justify-between space-x-3 group ${
                            isCurrent
                              ? 'bg-blue-600/15 border-blue-500/40 shadow-sm'
                              : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                          }`}
                        >
                          {/* Profile Info */}
                          <div className="flex items-center space-x-3 min-w-0 flex-1">
                            <div 
                              className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm text-white shrink-0 shadow-md border border-white/20"
                              style={{ backgroundColor: conn.color || '#3b82f6' }}
                            >
                              {conn.name ? conn.name[0].toUpperCase() : 'S'}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center space-x-2">
                                <span className="font-semibold text-xs text-white truncate">
                                  {conn.name || conn.host}
                                </span>
                                {isCurrent && (
                                  <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 text-[9px] font-semibold">
                                    Current
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-gray-400 font-mono truncate">
                                {conn.username}@{conn.host}:{conn.port || 22}
                              </div>
                            </div>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center space-x-1.5 shrink-0">
                            {/* Quick Connect Button */}
                            <button
                              onClick={() => handleQuickConnectSaved(conn.id)}
                              disabled={isConnecting}
                              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs flex items-center space-x-1 transition-colors shadow-sm disabled:opacity-50"
                            >
                              <ArrowRight className="w-3.5 h-3.5" />
                              <span>Connect</span>
                            </button>

                            {/* Delete Profile Button */}
                            <button
                              onClick={() => handleDeleteProfile(conn.id, conn.name || conn.host)}
                              className="p-1.5 rounded-xl hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 transition-colors"
                              title="Delete Saved Profile"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            )}

            {/* Tab 2: Connect New Server Form */}
            {modalTab === 'new' && (
              <form onSubmit={handleConnectNewServer} className="space-y-3 text-xs overflow-y-auto max-h-[420px] pr-1">
                <div>
                  <label className="text-gray-400 block mb-1 font-medium">Server Name / Label</label>
                  <input
                    type="text"
                    placeholder="e.g. Production Cluster, Database Node"
                    value={newServerForm.name}
                    onChange={e => setNewServerForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-sans"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-gray-400 block mb-1 font-medium">Host IP / Domain</label>
                    <input
                      type="text"
                      required
                      placeholder="192.168.1.100 or server.domain.com"
                      value={newServerForm.host}
                      onChange={e => setNewServerForm(f => ({ ...f, host: e.target.value }))}
                      className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-gray-400 font-medium">Port</label>
                      <div className="flex items-center space-x-1">
                        <button type="button" onClick={() => setNewServerForm(f => ({ ...f, port: 22 }))} className={`px-1.5 py-0.5 rounded text-[10px] ${newServerForm.port === 22 ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-400 hover:text-white'}`}>22 (SSH)</button>
                      </div>
                    </div>
                    <input
                      type="number"
                      value={newServerForm.port || ''}
                      placeholder="22"
                      onChange={e => setNewServerForm(f => ({ ...f, port: e.target.value === '' ? ('' as any) : (parseInt(e.target.value) || 0) }))}
                      onBlur={() => setNewServerForm(f => ({ ...f, port: Number(f.port) || 22 }))}
                      className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono text-center"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-gray-400 block mb-1 font-medium">SSH Username</label>
                  <input
                    type="text"
                    required
                    placeholder="root or ubuntu"
                    value={newServerForm.username}
                    onChange={e => setNewServerForm(f => ({ ...f, username: e.target.value }))}
                    className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                {/* Authentication Method Selector: [ Password | SSH Key ] */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-gray-400 block font-medium">Authentication Method</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setAuthMethod('password')}
                      className={`py-2 px-3 rounded-xl border flex items-center justify-center space-x-2 transition-all ${
                        authMethod === 'password'
                          ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                          : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                      }`}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Password</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setAuthMethod('key')}
                      className={`py-2 px-3 rounded-xl border flex items-center justify-center space-x-2 transition-all ${
                        authMethod === 'key'
                          ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                          : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                      }`}
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>SSH Private Key</span>
                    </button>
                  </div>
                </div>

                {/* Password Field */}
                {authMethod === 'password' ? (
                  <div>
                    <label className="text-gray-400 block mb-1 font-medium">Password</label>
                    <div className="relative flex items-center">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Enter SSH user password..."
                        value={newServerForm.password}
                        onChange={e => setNewServerForm(f => ({ ...f, password: e.target.value }))}
                        className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 pr-9 text-white focus:outline-none focus:border-blue-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 text-gray-400 hover:text-white"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                ) : (
                  /* SSH Key Upload / Drag & Drop */
                  <div className="space-y-2">
                    <input
                      type="file"
                      ref={keyFileInputRef}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleKeyFileUpload(e.target.files[0]);
                        }
                      }}
                      className="hidden"
                    />

                    {uploadedKeyFile ? (
                      <div className="p-3 rounded-xl bg-blue-600/15 border border-blue-500/40 flex items-center justify-between">
                        <div className="flex items-center space-x-2.5 overflow-hidden">
                          <FileCode className="w-5 h-5 text-blue-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-white truncate text-xs">{uploadedKeyFile.name}</div>
                            <div className="text-[10px] text-gray-400">{uploadedKeyFile.size}</div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setUploadedKeyFile(null);
                            setNewServerForm(f => ({ ...f, privateKeyPath: '' }));
                          }}
                          className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-rose-400"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div
                        onClick={handleSelectKeyFile}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                            handleKeyFileUpload(e.dataTransfer.files[0]);
                          }
                        }}
                        className="border-2 border-dashed border-white/20 hover:border-blue-500/60 rounded-xl p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-white/[0.02] hover:bg-blue-600/5 space-y-1"
                      >
                        <Upload className="w-5 h-5 text-gray-400" />
                        <span className="text-xs text-gray-300 font-medium">Click to browse or drop SSH key file</span>
                        <span className="text-[10px] text-gray-500">Supports OpenSSH (.pem), id_rsa, id_ed25519, id_ecdsa</span>
                      </div>
                    )}

                    {/* Sudo Password (Optional - for admin/root commands) */}
                    <div>
                      <label className="text-gray-400 block mb-1 font-medium text-[11px] flex items-center space-x-1">
                        <Shield className="w-3.5 h-3.5 text-amber-400" />
                        <span>Sudo Password (Optional - for admin/root commands)</span>
                      </label>
                      <div className="relative flex items-center">
                        <input
                          type={showPassword ? 'text' : 'password'}
                          placeholder="Enter sudo password if user requires it..."
                          value={newServerForm.password}
                          onChange={e => setNewServerForm(f => ({ ...f, password: e.target.value }))}
                          className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 pr-9 text-white focus:outline-none focus:border-blue-500 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-2.5 text-gray-400 hover:text-white"
                        >
                          {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-2 pt-1 pb-1">
                  <input
                    type="checkbox"
                    id="save-new-server-creds"
                    checked={saveNewServerCredentials}
                    onChange={e => setSaveNewServerCredentials(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-white/20 bg-white/10 text-blue-600 focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="save-new-server-creds" className="text-[11px] text-gray-300 cursor-pointer select-none">
                    Save password / private key in server profile
                  </label>
                </div>

                <div className="flex justify-end space-x-2 pt-3 border-t border-white/10">
                  <button
                    type="button"
                    onClick={() => setShowAddServerModal(false)}
                    className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isConnecting}
                    className="px-5 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md transition-colors disabled:opacity-50 flex items-center space-x-1.5"
                  >
                    {isConnecting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{isConnecting ? 'Connecting...' : 'Save & Connect'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
