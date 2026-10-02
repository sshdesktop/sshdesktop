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
  const [cpuUsage, setCpuUsage] = useState<number>(0);
  const [ramUsage, setRamUsage] = useState<number>(0);

  const server = activeConnectionId ? (connectedServers.get(activeConnectionId) || connections.find(c => c.id === activeConnectionId)) : null;

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
    <div className="absolute top-0 left-0 w-full h-8 bg-[#181825]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between px-3 z-50 text-xs text-gray-300 window-drag select-none shadow-sm">
      {/* Left Menu Items */}
      <div className="flex items-center space-x-3 window-no-drag">
        {/* Apple/CloudDesk Logo Menu */}
        <div className="relative">
          <button
            onClick={() => setShowAppleMenu(!showAppleMenu)}
            className="flex items-center space-x-1.5 p-1 rounded hover:bg-white/10 text-white font-bold"
          >
            <Cloud className="w-4 h-4 text-[var(--accent)]" />
            <span className="font-semibold tracking-tight">CloudDesk</span>
          </button>

          {showAppleMenu && (
            <div
              className="absolute left-0 top-8 w-56 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl py-1 z-50 text-xs"
              onClick={() => setShowAppleMenu(false)}
            >
              <div
                onClick={() => openApp('settings', 'System Settings')}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black cursor-pointer flex items-center space-x-2"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>System Settings...</span>
              </div>
              <div
                onClick={() => onOpenWallpapers?.()}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black cursor-pointer flex items-center space-x-2"
              >
                <Palette className="w-3.5 h-3.5" />
                <span>Change Wallpaper...</span>
              </div>
              <div
                onClick={() => minimizeAllWindows()}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black cursor-pointer flex items-center space-x-2"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Show Desktop (Minimize All)</span>
              </div>

              <div className="my-1 border-t border-white/10" />

              <div
                onClick={() => openApp('terminal', 'Terminal')}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black cursor-pointer flex items-center space-x-2"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Open Terminal</span>
              </div>
              <div
                onClick={() => openApp('security', 'Security Auditor')}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black cursor-pointer flex items-center space-x-2"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Security Overview</span>
              </div>

              <div className="my-1 border-t border-white/10" />

              <div
                onClick={() => activeConnectionId && disconnect(activeConnectionId)}
                className="px-3 py-1.5 hover:bg-red-500/20 text-red-400 cursor-pointer flex items-center space-x-2"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out ({server?.name || 'Server'})</span>
              </div>
            </div>
          )}
        </div>

        <span className="text-gray-400 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5" onClick={() => openApp('files', 'Finder')}>
          File
        </span>
        <span className="text-gray-400 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5" onClick={() => openApp('editor', 'Code Editor')}>
          Edit
        </span>
        <span className="text-gray-400 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5" onClick={() => openApp('monitor', 'System Monitor')}>
          Monitor
        </span>
        <span className="text-gray-400 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5" onClick={() => openApp('terminal', 'Terminal')}>
          Window
        </span>
      </div>

      {/* Right System Tray */}
      <div className="flex items-center space-x-3 window-no-drag font-mono text-[11px]">
        {/* Active Node Badge & Switcher */}
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
                className="absolute right-0 top-8 w-60 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-xl shadow-2xl py-1.5 z-50 text-xs font-sans"
                onClick={() => setShowServerSwitcher(false)}
              >
                <div className="px-3 py-1 text-[10px] uppercase font-bold text-gray-400 tracking-wider flex items-center justify-between">
                  <span>Connected Servers</span>
                  <span className="text-[10px] text-emerald-400">{connections.length} active</span>
                </div>

                <div className="space-y-0.5 my-1 max-h-48 overflow-y-auto">
                  {connections.map(c => {
                    const isActive = c.id === activeConnectionId;
                    return (
                      <div
                        key={c.id}
                        onClick={() => setActive(c.id)}
                        className={`px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black cursor-pointer flex items-center justify-between transition-colors ${
                          isActive ? 'bg-white/10 font-bold text-white' : 'text-gray-300'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <Server className="w-3.5 h-3.5 shrink-0" />
                          <div className="truncate">
                            <div className="truncate">{c.name}</div>
                            <div className="text-[10px] opacity-70 truncate">{c.username}@{c.host}</div>
                          </div>
                        </div>
                        {isActive && <Check className="w-3.5 h-3.5 shrink-0 text-emerald-400" />}
                      </div>
                    );
                  })}
                </div>

                <div className="my-1 border-t border-white/10" />

                <div
                  onClick={() => {
                    if (activeConnectionId) disconnect(activeConnectionId);
                  }}
                  className="px-3 py-1.5 hover:bg-rose-500/20 text-rose-400 cursor-pointer flex items-center space-x-2"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Disconnect Current Server</span>
                </div>
              </div>
            )}
          </div>
        )}

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
    </div>
  );
}
