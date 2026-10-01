import React, { useState, useEffect } from 'react';
import { Cloud, Bell, LogOut, Settings, ShieldCheck, Terminal, Cpu, MemoryStick } from 'lucide-react';
import { useConnectionStore } from '../lib/store';
import { useWindowManager } from '../lib/hooks/useWindowManager';

export default function Taskbar() {
  const { activeConnectionId, connectedServers, disconnect } = useConnectionStore();
  const { openApp } = useWindowManager();
  const [time, setTime] = useState('');
  const [showAppleMenu, setShowAppleMenu] = useState(false);

  const server = activeConnectionId ? connectedServers.get(activeConnectionId) : null;

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

  return (
    <div className="absolute top-0 left-0 w-full h-8 bg-[#181825]/85 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between px-3 z-50 text-xs text-gray-300 window-drag select-none shadow-sm">
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
              className="absolute left-0 top-8 w-52 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl py-1 z-50 text-xs"
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
                <span>Disconnect Server</span>
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
      <div className="flex items-center space-x-3.5 window-no-drag font-mono text-[11px]">
        {/* Active Node Badge */}
        {server && (
          <div className="flex items-center space-x-1.5 bg-white/5 px-2.5 py-0.5 rounded-full border border-white/10">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-gray-200 font-sans">{server.name}</span>
          </div>
        )}

        {/* Live Gauges */}
        <div className="flex items-center space-x-1 text-blue-400">
          <Cpu className="w-3 h-3" />
          <span>18%</span>
        </div>
        <div className="flex items-center space-x-1 text-purple-400">
          <MemoryStick className="w-3 h-3" />
          <span>42%</span>
        </div>

        {/* Clock */}
        <span className="text-gray-200 font-sans pl-1">{time}</span>
      </div>
    </div>
  );
}
