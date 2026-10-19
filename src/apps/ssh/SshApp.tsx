import React, { useState } from 'react';
import { 
  ArrowRightLeft, Key, ShieldCheck, FileCode, 
  Server, ShieldAlert, Sparkles, Terminal
} from 'lucide-react';
import SshTunnelsManager from './components/SshTunnelsManager';
import SshKeyVault from './components/SshKeyVault';
import SshSecurityAuditor from './components/SshSecurityAuditor';
import SshConfigEditor from './components/SshConfigEditor';
import { useConnectionStore } from '../../lib/store';
import { useSshStore } from './sshStore';

export default function SshApp() {
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);
  const { tunnels, keys } = useSshStore();

  // Active main tab: defaults to config
  const [activeMainTab, setActiveMainTab] = useState<'config' | 'tunnels' | 'keys' | 'security'>('config');

  const navTabs = [
    { 
      id: 'config' as const, 
      label: 'SSH Config (/etc/ssh)', 
      icon: FileCode,
      badge: 'Control'
    },
    { 
      id: 'tunnels' as const, 
      label: 'Tunnels & Forwarding', 
      icon: ArrowRightLeft, 
      count: tunnels.filter(t => t.status === 'active').length 
    },
    { 
      id: 'keys' as const, 
      label: 'Key Vault', 
      icon: Key, 
      count: keys.length 
    },
    { 
      id: 'security' as const, 
      label: 'Security & Auditor', 
      icon: ShieldCheck 
    },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e2e] text-[#cdd6f4] select-none overflow-hidden font-sans">
      {/* Top Main Navigation Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#181825] border-b border-white/[0.08] shrink-0">
        {/* Left: App Logo & Navigation Tabs */}
        <div className="flex items-center space-x-1">
          <div className="flex items-center space-x-2 mr-3 pr-3 border-r border-white/10">
            <div className="p-1.5 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 shadow-md">
              <Terminal className="w-4 h-4 text-white" />
            </div>
            <div>
              <span className="font-bold text-white text-xs tracking-wide">SSH Studio</span>
              <span className="text-[10px] text-blue-400 font-mono block leading-none">v3.0 Pro</span>
            </div>
          </div>

          {/* Navigation Tabs */}
          {navTabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeMainTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveMainTab(tab.id)}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm font-semibold'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {tab.count !== undefined && tab.count > 0 && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    isActive ? 'bg-white/20 text-white' : 'bg-white/10 text-gray-300'
                  }`}>
                    {tab.count}
                  </span>
                )}
                {tab.badge && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-mono uppercase tracking-wider ${
                    isActive ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Right: Active Server Status Badge */}
        <div className="flex items-center space-x-2">
          {activeServer ? (
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-white/5 border border-white/10 text-xs text-gray-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
              <span className="font-semibold text-emerald-300 font-mono truncate max-w-[160px]">
                {activeServer.name || activeServer.host}
              </span>
              <span className="text-gray-500 font-mono text-[10px]">
                ({activeServer.username || 'root'})
              </span>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>Offline / Standalone</span>
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden relative flex">
        {/* VIEW 1: SSH CONFIG & /etc/ssh/ssh_config CONTROL */}
        {activeMainTab === 'config' && <SshConfigEditor />}

        {/* VIEW 2: SSH TUNNELS & FORWARDING */}
        {activeMainTab === 'tunnels' && <SshTunnelsManager />}

        {/* VIEW 3: SSH KEY VAULT */}
        {activeMainTab === 'keys' && <SshKeyVault />}

        {/* VIEW 4: SECURITY AUDITOR */}
        {activeMainTab === 'security' && <SshSecurityAuditor />}
      </div>
    </div>
  );
}
