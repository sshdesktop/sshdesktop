import React, { useState } from 'react';
import { 
  Play, Square, Shield, Globe, Save, Code2, 
  ChevronDown, Server, Sparkles, Check, AlertCircle, RefreshCw 
} from 'lucide-react';
import { HttpMethod, ApiTabState } from '../types';
import { useApiStore } from '../apiStore';
import { useConnectionStore } from '../../../lib/store';

const METHOD_COLORS: Record<HttpMethod, { text: string; bg: string; border: string }> = {
  GET: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  POST: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30' },
  PUT: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30' },
  PATCH: { text: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
  DELETE: { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/30' },
  HEAD: { text: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30' },
  OPTIONS: { text: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/30' },
};

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

interface RequestUrlBarProps {
  activeTab: ApiTabState;
  onSend: () => void;
  onCancel: () => void;
  onOpenSaveModal: () => void;
  onOpenCodeModal: () => void;
}

export default function RequestUrlBar({
  activeTab,
  onSend,
  onCancel,
  onOpenSaveModal,
  onOpenCodeModal,
}: RequestUrlBarProps) {
  const { updateActiveTab, resolveVariables } = useApiStore();
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);

  const [showMethodDropdown, setShowMethodDropdown] = useState(false);

  const resolvedUrlPreview = resolveVariables(activeTab.url);
  const hasVariables = resolvedUrlPreview !== activeTab.url;

  const currentMethodColor = METHOD_COLORS[activeTab.method] || METHOD_COLORS.GET;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!activeTab.isLoading) {
        onSend();
      }
    }
  };

  return (
    <div className="flex flex-col space-y-1.5 p-3 bg-[#181825] border-b border-white/[0.08] select-none">
      <div className="flex items-center space-x-2">
        {/* URL Input Box with Method Selector */}
        <div className="flex-1 flex items-center bg-[#11111b] border border-white/10 rounded-xl overflow-hidden focus-within:border-blue-500/60 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all shadow-inner">
          {/* Method Selector Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMethodDropdown(!showMethodDropdown)}
              className={`px-3.5 py-2 font-mono text-xs font-bold flex items-center space-x-1.5 transition-colors border-r border-white/10 ${currentMethodColor.text} ${currentMethodColor.bg} hover:brightness-110`}
            >
              <span>{activeTab.method}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </button>

            {showMethodDropdown && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setShowMethodDropdown(false)} 
                />
                <div className="absolute left-0 top-full mt-1 z-50 w-32 bg-[#1e1e2e] border border-white/15 rounded-xl shadow-2xl py-1 backdrop-blur-xl">
                  {METHODS.map((m) => {
                    const c = METHOD_COLORS[m];
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => {
                          updateActiveTab({ method: m });
                          setShowMethodDropdown(false);
                        }}
                        className={`w-full px-3 py-1.5 text-left text-xs font-mono font-bold hover:bg-white/10 transition-colors flex items-center justify-between ${c.text}`}
                      >
                        <span>{m}</span>
                        {activeTab.method === m && <Check className="w-3.5 h-3.5" />}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* URL Input */}
          <input
            type="text"
            value={activeTab.url}
            onChange={(e) => updateActiveTab({ url: e.target.value })}
            onKeyDown={handleKeyDown}
            placeholder="http://localhost:8080/api/users or https://api.example.com"
            className="flex-1 bg-transparent px-3.5 py-2 text-xs font-mono text-gray-100 placeholder-gray-500 focus:outline-none"
          />

          {/* SSH Tunnel Toggle Pill inside URL bar */}
          <div className="px-2 shrink-0">
            <button
              type="button"
              onClick={() => updateActiveTab({ useSshTunnel: !activeTab.useSshTunnel })}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex items-center space-x-1.5 transition-all border ${
                activeTab.useSshTunnel
                  ? 'bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30'
                  : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
              }`}
              title={
                activeTab.useSshTunnel
                  ? `SSH Tunnel ENABLED: Routes request through port-forwarding tunnel on ${activeServer?.name || activeServer?.host || 'active server'} (no curl used)`
                  : 'SSH Tunnel DISABLED: Sends request directly from local network'
              }
            >
              <Server className={`w-3 h-3 ${activeTab.useSshTunnel ? 'text-blue-400 animate-pulse' : 'text-gray-500'}`} />
              <span>{activeTab.useSshTunnel ? 'SSH Tunnel: ON' : 'Direct (No Tunnel)'}</span>
            </button>
          </div>
        </div>

        {/* Send / Cancel Button */}
        {activeTab.isLoading ? (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-md active:scale-95"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Cancel</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-md shadow-blue-500/20 active:scale-95 cursor-pointer"
            title="Send Request (⌘ Enter / Ctrl+Enter)"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Send</span>
          </button>
        )}

        {/* Save to Collection Button */}
        <button
          type="button"
          onClick={onOpenSaveModal}
          className="p-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 rounded-xl transition-colors cursor-pointer"
          title="Save request to Collection"
        >
          <Save className="w-4 h-4" />
        </button>

        {/* Generate Code Snippet */}
        <button
          type="button"
          onClick={onOpenCodeModal}
          className="p-2 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 rounded-xl transition-colors cursor-pointer"
          title="Export as Code Snippet (Python, JS, Go, Rust, curl)"
        >
          <Code2 className="w-4 h-4" />
        </button>
      </div>

      {/* Resolved URL Preview strip when {{variables}} are present or SSH tunnel target info */}
      <div className="flex items-center justify-between text-[11px] text-gray-400 px-1 font-mono">
        <div className="flex items-center space-x-2 truncate">
          {hasVariables ? (
            <span className="text-purple-400 truncate flex items-center space-x-1">
              <Sparkles className="w-3 h-3 shrink-0" />
              <span>Resolved: <span className="text-gray-200">{resolvedUrlPreview}</span></span>
            </span>
          ) : (
            <span className="text-gray-500 truncate">
              {activeTab.useSshTunnel ? (
                <span className="text-blue-400">
                  Target routed via SSH tunnel to {activeServer ? `${activeServer.username}@${activeServer.host}` : 'remote server'}
                </span>
              ) : (
                <span>Direct client request</span>
              )}
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2 text-[10px] text-gray-500 shrink-0">
          <span>Shortcuts: <kbd className="bg-white/10 px-1 rounded text-gray-300 font-sans">⌘↵</kbd> Send</span>
        </div>
      </div>
    </div>
  );
}
