import React, { useState, useEffect } from 'react';
import { 
  Cloud, Bell, LogOut, Settings, ShieldCheck, Terminal, Cpu, MemoryStick,
  Palette, Sun, Moon, Minimize2, Eye, Server, ChevronDown, Check, Plus
} from 'lucide-react';
import { useConnectionStore, useSettingsStore, useWindowStore } from '../lib/store';
import { useWindowManager } from '../lib/hooks/useWindowManager';
import { systemGetStats } from '../lib/tauri-bridge';

export default function Taskbar({ onOpenWallpapers }: { onOpenWallpapers?: () => void }) {
  const { activeConnectionId, connectedServers, connections, setActive, disconnect } = useConnectionStore();
  const { theme, updateSettings } = useSettingsStore();
  const { minimizeAllWindows } = useWindowStore();
  const { openApp } = useWindowManager();
  const [time, setTime] = useState('');
  const [showAppleMenu, setShowAppleMenu] = useState(false);
  const [showServerSwitcher, setShowServerSwitcher] = useState(false);
  const [showAddServerModal, setShowAddServerModal] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [newServerForm, setNewServerForm] = useState({
    name: '',
    host: '',
    port: 22,
    username: 'root',
    password: ''
  });
  const [cpuUsage, setCpuUsage] = useState<number>(0);
  const [ramUsage, setRamUsage] = useState<number>(0);

  const server = activeConnectionId ? (connectedServers.get(activeConnectionId) || connections.find(c => c.id === activeConnectionId)) : null;

  const handleConnectNewServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerForm.host || !newServerForm.username) return;
    setIsConnecting(true);
    setConnectError(null);
    try {
      const newId = `server-${Date.now()}`;
      const newConn = {
        id: newId,
        name: newServerForm.name.trim() || `${newServerForm.username}@${newServerForm.host}`,
        host: newServerForm.host.trim(),
        port: Number(newServerForm.port) || 22,
        username: newServerForm.username.trim(),
        authMethod: 'password' as const,
        password: newServerForm.password,
        tags: []
      };
      useConnectionStore.getState().addConnection(newConn);
      await useConnectionStore.getState().connect(newId);
      setShowAddServerModal(false);
      setNewServerForm({ name: '', host: '', port: 22, username: 'root', password: '' });
    } catch (err: any) {
      setConnectError(err?.message || String(err));
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTime(
        now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) +
        '  ' +
        now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Poll real stats for Taskbar gauges
  useEffect(() => {
    if (!activeConnectionId) return;
    const fetchGauges = async () => {
      try {
        const stats = await systemGetStats(activeConnectionId);
        if (stats) {
          const cpu = Array.isArray(stats.cpu_percent) && stats.cpu_percent.length > 0
            ? Math.round(stats.cpu_percent[0])
            : 0;
          const ram = stats.ram_total > 0
            ? Math.round((stats.ram_used / stats.ram_total) * 100)
            : 0;
          setCpuUsage(cpu);
          setRamUsage(ram);
        }
      } catch {}
    };

    fetchGauges();
    const interval = setInterval(fetchGauges, 3000);
    return () => clearInterval(interval);
  }, [activeConnectionId]);

  return (
    <div className="absolute top-0 left-0 w-full h-8 bg-[#14141e]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between px-3 z-50 text-xs text-gray-300 window-drag select-none shadow-sm">
      {/* Left Menu Items */}
      <div className="flex items-center space-x-3 window-no-drag">
        {/* Apple/CloudDesk Logo Menu */}
        <div className="relative">
          <button
            onClick={() => setShowAppleMenu(!showAppleMenu)}
            className="flex items-center space-x-1.5 p-1 rounded hover:bg-white/10 text-white font-bold"
          >
            <Cloud className="w-4 h-4 text-blue-400" />
            <span className="font-semibold tracking-tight">CloudDesk</span>
          </button>

          {showAppleMenu && (
            <div
              className="absolute left-0 top-8 w-56 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl py-1 z-50 text-xs"
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
                <Palette className="w-3.5 h-3.5" />
                <span>Change 4K Wallpaper...</span>
              </div>
              <div
                onClick={() => minimizeAllWindows()}
                className="px-3 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Show Desktop (Minimize All)</span>
              </div>
              <div className="my-1 border-t border-white/10" />
              <div
                onClick={() => {
                  if (activeConnectionId) disconnect(activeConnectionId);
                }}
                className="px-3 py-1.5 hover:bg-red-600/20 text-red-400 cursor-pointer flex items-center space-x-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </div>
            </div>
          )}
        </div>

        <span className="text-gray-400 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5" onClick={() => openApp('files', 'Finder')}>
          Finder
        </span>
        <span className="text-gray-400 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5" onClick={() => openApp('terminal', 'Terminal')}>
          Terminal
        </span>
        <span className="text-gray-400 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5" onClick={() => openApp('monitor', 'Activity Monitor')}>
          Monitor
        </span>
        <span className="text-gray-400 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5" onClick={() => openApp('editor', 'Code Editor')}>
          Editor
        </span>
      </div>

      {/* Right System Tray */}
      <div className="flex items-center space-x-3 window-no-drag font-mono text-[11px]">
        {/* Active Node Badge & Switcher */}
        <div className="flex items-center space-x-2">
          {server && (
            <div className="relative">
              <button
                onClick={() => setShowServerSwitcher(!showServerSwitcher)}
                className="flex items-center space-x-1.5 bg-white/5 hover:bg-white/10 px-2.5 py-0.5 rounded-full border border-white/10 transition-colors cursor-pointer"
                title="Click to switch or manage connected servers"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-gray-200 font-sans font-medium">{server.name}</span>
                <ChevronDown className="w-3 h-3 text-gray-400" />
              </button>

              {showServerSwitcher && (
                <div 
                  className="absolute right-0 top-8 w-64 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl py-2 z-50 text-xs font-sans"
                  onClick={() => setShowServerSwitcher(false)}
                >
                  <div className="px-3.5 py-1 text-[10px] uppercase font-bold text-gray-400 tracking-wider flex items-center justify-between">
                    <span>Connected Servers</span>
                    <span className="text-[10px] text-emerald-400">{connections.length} active</span>
                  </div>

                  <div className="space-y-0.5 my-1.5 max-h-48 overflow-y-auto">
                    {connections.map(c => {
                      const isActive = c.id === activeConnectionId;
                      return (
                        <div
                          key={c.id}
                          onClick={() => setActive(c.id)}
                          className={`px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between transition-colors ${
                            isActive ? 'bg-white/10 font-bold text-white' : 'text-gray-300'
                          }`}
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <Server className="w-3.5 h-3.5 shrink-0" />
                            <div className="truncate">
                              <div className="truncate">{c.name || c.host}</div>
                              <div className="text-[10px] opacity-70 truncate">{c.username}@{c.host}</div>
                            </div>
                          </div>
                          {isActive && <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />}
                        </div>
                      );
                    })}
                  </div>

                  <div className="my-1.5 border-t border-white/10 mx-2" />

                  <div
                    onClick={() => {
                      setShowAddServerModal(true);
                      setShowServerSwitcher(false);
                    }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2 text-blue-300"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Connect Another Server...</span>
                  </div>

                  <div
                    onClick={() => {
                      if (activeConnectionId) disconnect(activeConnectionId);
                    }}
                    className="px-3.5 py-1.5 hover:bg-red-600/20 text-red-400 cursor-pointer flex items-center space-x-2"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Disconnect Current Server</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Connect Another Server Button */}
          <button
            onClick={() => setShowAddServerModal(true)}
            className="flex items-center space-x-1.5 bg-blue-600/25 hover:bg-blue-600 border border-blue-500/40 text-blue-200 hover:text-white px-2.5 py-0.5 rounded-full transition-all cursor-pointer"
            title="Connect to another Linux server simultaneously"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="font-sans font-medium text-[11px]">Connect Server</span>
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

        {/* Theme Quick Toggle (Light / Dark) */}
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
              disconnect(activeConnectionId);
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

      {/* Connect Server Modal */}
      {showAddServerModal && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-[99999] flex items-center justify-center p-6 window-no-drag"
          onClick={() => setShowAddServerModal(false)}
        >
          <div 
            className="bg-[#1e1e2e] border border-white/20 rounded-3xl w-full max-w-md p-6 shadow-2xl space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <Server className="w-5 h-5 text-blue-400" />
                <h3 className="font-bold text-base text-white">Connect Another Linux Server</h3>
              </div>
              <button onClick={() => setShowAddServerModal(false)} className="text-gray-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleConnectNewServer} className="space-y-3 text-xs">
              <div>
                <label className="text-gray-400 block mb-1 font-medium">Server Display Name</label>
                <input
                  type="text"
                  placeholder="e.g. Production Web, Database Node"
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
                    placeholder="192.168.1.100"
                    value={newServerForm.host}
                    onChange={e => setNewServerForm(f => ({ ...f, host: e.target.value }))}
                    className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>
                <div>
                  <label className="text-gray-400 block mb-1 font-medium">Port</label>
                  <input
                    type="number"
                    defaultValue={22}
                    value={newServerForm.port}
                    onChange={e => setNewServerForm(f => ({ ...f, port: parseInt(e.target.value) || 22 }))}
                    className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono text-center"
                  />
                </div>
              </div>

              <div>
                <label className="text-gray-400 block mb-1 font-medium">Username</label>
                <input
                  type="text"
                  required
                  placeholder="root"
                  value={newServerForm.username}
                  onChange={e => setNewServerForm(f => ({ ...f, username: e.target.value }))}
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="text-gray-400 block mb-1 font-medium">Password</label>
                <input
                  type="password"
                  placeholder="Password"
                  value={newServerForm.password}
                  onChange={e => setNewServerForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {connectError && (
                <div className="p-2.5 bg-red-500/20 border border-red-500/30 rounded-xl text-red-300 text-[11px]">
                  {connectError}
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-2 border-t border-white/10">
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
                  className="px-5 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md transition-colors disabled:opacity-50"
                >
                  {isConnecting ? 'Connecting...' : 'Connect Server'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
