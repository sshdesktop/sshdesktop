import React, { useState } from 'react';
import { 
  Globe, Server, Search, ArrowRight, Sparkles, 
  ExternalLink, Bookmark as BookmarkIcon, Radio, 
  ShieldCheck, Laptop, Cpu, Check
} from 'lucide-react';
import { BrowserBookmark } from '../types';

interface BrowserStartPageProps {
  onNavigate: (url: string) => void;
  networkMode: 'server' | 'user';
  onToggleNetworkMode: () => void;
  serverHost: string;
  isConnected: boolean;
  bookmarks: BrowserBookmark[];
  onSelectBookmark: (url: string) => void;
}

const COMMON_PORT_PRESETS = [
  { label: 'Web Server', port: 80, desc: 'HTTP (Nginx/Apache)' },
  { label: 'App Server', port: 8080, desc: 'Tomcat/Spring/Jenkins' },
  { label: 'Frontend / UI', port: 3000, desc: 'React/Node/Grafana' },
  { label: 'API Backend', port: 8000, desc: 'Django/FastAPI' },
  { label: 'Python Service', port: 5000, desc: 'Flask/AI Model' },
  { label: 'Docker Panel', port: 9000, desc: 'Portainer UI' },
];

export default function BrowserStartPage({
  onNavigate,
  networkMode,
  onToggleNetworkMode,
  serverHost,
  isConnected,
  bookmarks,
  onSelectBookmark,
}: BrowserStartPageProps) {
  const [searchInput, setSearchInput] = useState('');

  const handleOpen = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchInput.trim()) return;
    onNavigate(searchInput.trim());
  };

  return (
    <div className="w-full h-full overflow-y-auto bg-gradient-to-b from-[#181825] via-[#1e1e2e] to-[#11111b] text-gray-200 flex flex-col items-center justify-start py-12 px-4 select-none">
      <div className="w-full max-w-2xl flex flex-col items-center text-center space-y-6">
        
        {/* Logo and Title */}
        <div className="flex flex-col items-center space-y-3">
          <div className="relative flex items-center justify-center">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-400 p-0.5 shadow-2xl shadow-blue-500/20">
              <div className="w-full h-full bg-[#1e1e2e] rounded-3xl flex items-center justify-center space-x-1">
                {networkMode === 'server' ? (
                  <Server className="w-9 h-9 text-emerald-400 animate-pulse" />
                ) : (
                  <Globe className="w-9 h-9 text-blue-400" />
                )}
              </div>
            </div>
            <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-[#11111b] border border-white/10 shadow-md">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-center space-x-2">
              <h1 className="text-2xl font-bold text-white tracking-tight">SSH Desktop Browser</h1>
              <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                v2.0
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1 max-w-md">
              Isolated web browser with per-tab SSH Port Forwarding Tunneling and Direct Network options.
            </p>
          </div>
        </div>

        {/* Central Omnibox / Search Box */}
        <form onSubmit={handleOpen} className="w-full">
          <div className="flex items-center bg-[#11111b]/90 border border-white/15 hover:border-white/30 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/20 rounded-2xl p-2 shadow-2xl backdrop-blur-xl transition-all">
            
            {/* Per-Tab SSH ON / OFF Toggle Pill */}
            <button
              type="button"
              onClick={onToggleNetworkMode}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer shrink-0 shadow-sm ${
                networkMode === 'server'
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
                  : 'bg-blue-500/15 border-blue-500/40 text-blue-300 hover:bg-blue-500/25'
              }`}
              title={
                networkMode === 'server'
                  ? 'Server Network active. Click to switch to User Network (SSH: OFF)'
                  : 'User Network active. Click to switch to Server Network (SSH: ON)'
              }
            >
              {networkMode === 'server' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <Server className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-bold">SSH: ON</span>
                  <span className="text-[10px] text-emerald-400/90 font-mono hidden sm:inline">(Server Network)</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  <Laptop className="w-3.5 h-3.5 text-blue-400" />
                  <span className="font-bold">SSH: OFF</span>
                  <span className="text-[10px] text-blue-300/90 font-mono hidden sm:inline">(User Network)</span>
                </>
              )}
            </button>

            {/* Input Field */}
            <input
              type="text"
              autoFocus
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Enter URL or server port (e.g. localhost:8080, 192.168.74.43:3000, or domain)..."
              className="flex-1 bg-transparent border-none text-sm text-white px-3 py-1 font-mono focus:outline-none placeholder-gray-500"
            />

            {/* Open / Go Button */}
            <button
              type="submit"
              disabled={!searchInput.trim()}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:hover:bg-blue-600 text-white text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center space-x-1 shrink-0"
            >
              <span>Open</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>

        {/* Network Mode Status Banner */}
        <div className="w-full bg-white/[0.03] border border-white/10 rounded-2xl p-3 flex items-start space-x-3 text-left">
          {networkMode === 'server' ? (
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 shrink-0 mt-0.5">
              <Server className="w-4 h-4" />
            </div>
          ) : (
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0 mt-0.5">
              <Globe className="w-4 h-4" />
            </div>
          )}
          <div className="flex-1 text-xs">
            <div className="flex items-center space-x-2 font-semibold text-white">
              <span>{networkMode === 'server' ? 'Server Network Mode (SSH Tunnel: ON)' : 'User Network Mode (SSH Tunnel: OFF)'}</span>
              {isConnected ? (
                <span className="flex items-center space-x-1 text-emerald-400 text-[10px] font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span>Connected: {serverHost}</span>
                </span>
              ) : (
                <span className="text-gray-400 text-[10px] font-mono">No SSH Server Connected</span>
              )}
            </div>
            <p className="text-gray-400 text-[11px] mt-0.5 leading-relaxed">
              {networkMode === 'server'
                ? `Server Network (SSH: ON): Requests route through your remote SSH server (${serverHost}) via encrypted port tunnels. Access internal server ports (localhost:8080, :3000) directly.`
                : 'User Network (SSH: OFF): Opens destinations in your PC browser with full redirect support, SSO logins, cookies, and extensions.'}
            </p>
          </div>
        </div>

        {/* Quick Port Shortcuts */}
        <div className="w-full space-y-2.5">
          <div className="flex items-center justify-between text-xs text-gray-400 px-1">
            <span className="font-semibold uppercase tracking-wider text-[11px]">Quick Port Shortcuts</span>
            <span className="text-[11px] text-gray-500 font-mono">Click to launch</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {COMMON_PORT_PRESETS.map((preset) => (
              <button
                key={preset.port}
                onClick={() => onNavigate(`http://localhost:${preset.port}`)}
                className="flex flex-col items-start p-3 rounded-xl bg-[#11111b]/80 hover:bg-white/10 border border-white/5 hover:border-white/20 transition-all text-left cursor-pointer group shadow-sm"
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="font-mono text-xs font-bold text-white group-hover:text-blue-400 transition-colors">
                    :{preset.port}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">HTTP</span>
                </div>
                <div className="text-xs text-gray-300 font-medium">{preset.label}</div>
                <div className="text-[10px] text-gray-500 truncate w-full">{preset.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Saved Server Bookmarks */}
        {bookmarks && bookmarks.length > 0 && (
          <div className="w-full space-y-2.5 pt-2">
            <div className="flex items-center space-x-1.5 text-xs text-gray-400 px-1">
              <BookmarkIcon className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold uppercase tracking-wider text-[11px]">Server Bookmarks</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {bookmarks.map((bm) => (
                <button
                  key={bm.id}
                  onClick={() => onSelectBookmark(bm.url)}
                  className="flex items-center space-x-2.5 p-2.5 rounded-xl bg-[#11111b]/60 hover:bg-white/10 border border-white/5 hover:border-white/15 transition-all text-left cursor-pointer group"
                >
                  <span className={`w-2 h-2 rounded-full shrink-0 ${bm.tag === 'dev' ? 'bg-emerald-400' : 'bg-blue-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-white truncate group-hover:text-cyan-300 transition-colors">
                      {bm.title}
                    </div>
                    <div className="text-[10px] font-mono text-gray-500 truncate">
                      {bm.url}
                    </div>
                  </div>
                  <ExternalLink className="w-3 h-3 text-gray-500 group-hover:text-white shrink-0" />
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
