import React, { useState } from 'react';
import { 
  Terminal, Code2, Globe, Shield, Copy, Check, X, 
  Clock, ArrowRight, Layers, FileText, Activity
} from 'lucide-react';
import { BrowserTab, DevToolsPanel } from '../types';

interface BrowserDevToolsProps {
  activeTab: BrowserTab;
  activePanel?: DevToolsPanel;
  onPanelChange?: (panel: DevToolsPanel) => void;
  onClose: () => void;
  isLight?: boolean;
}

export default function BrowserDevTools({
  activeTab,
  activePanel,
  onPanelChange,
  onClose,
  isLight = false,
}: BrowserDevToolsProps) {
  const currentPanel: DevToolsPanel = activePanel || activeTab.activeDevToolsPanel || 'network';
  const [copied, setCopied] = useState(false);

  const handleCopySource = () => {
    const text = activeTab.htmlContent || (activeTab.jsonContent ? JSON.stringify(activeTab.jsonContent, null, 2) : activeTab.textContent) || '';
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePanelClick = (panel: DevToolsPanel) => {
    if (onPanelChange) {
      onPanelChange(panel);
    }
  };

  return (
    <div className="h-64 bg-[#181825] border-t border-white/[0.1] flex flex-col select-none text-xs text-gray-300 font-sans z-30 shrink-0 shadow-2xl">
      {/* DevTools Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#11111b] border-b border-white/[0.08]">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-white text-[11px] uppercase tracking-wider flex items-center space-x-1.5">
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Developer Tools & Network Inspector</span>
          </span>

          <div className="flex items-center space-x-1 border-l border-white/10 pl-2">
            {[
              { id: 'network' as DevToolsPanel, label: 'Headers & Network', icon: Globe },
              { id: 'source' as DevToolsPanel, label: 'Response Source', icon: Code2 },
              { id: 'ssh-command' as DevToolsPanel, label: 'SSH Tunnel Info', icon: Terminal },
            ].map(tab => {
              const Icon = tab.icon;
              const isSelected = currentPanel === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => handlePanelClick(tab.id)}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white font-semibold shadow-sm'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center space-x-1">
          {currentPanel === 'source' && (
            <button
              onClick={handleCopySource}
              className="flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 cursor-pointer mr-1"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy Source'}</span>
            </button>
          )}

          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
            title="Close DevTools"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {currentPanel === 'network' && (
          <div className="space-y-3">
            {/* Summary status pill */}
            <div className="flex items-center space-x-3 text-xs font-mono">
              <span className={`px-2 py-0.5 rounded-md font-bold ${
                (activeTab.statusCode || 200) < 400 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
              }`}>
                {activeTab.statusCode || 200} {activeTab.statusText || 'OK'}
              </span>

              <span className="text-gray-400">Method: <strong className="text-white">GET</strong></span>
              <span className="text-gray-400">Latency: <strong className="text-cyan-300">{activeTab.latencyMs || 15} ms</strong></span>
              <span className="text-gray-400">Content-Type: <strong className="text-amber-300">{activeTab.contentType || 'text/html'}</strong></span>
            </div>

            {/* Response Headers */}
            <div>
              <div className="text-[11px] font-semibold text-gray-400 mb-1 uppercase tracking-wider">
                Response Headers ({Object.keys(activeTab.headers || {}).length})
              </div>
              <div className="bg-black/30 rounded-xl p-2.5 border border-white/10 space-y-1 font-mono text-[11px]">
                {Object.keys(activeTab.headers || {}).length === 0 ? (
                  <div className="text-gray-500 italic">No custom headers captured</div>
                ) : (
                  Object.entries(activeTab.headers || {}).map(([key, val]) => (
                    <div key={key} className="flex">
                      <span className="text-cyan-400 font-semibold w-40 shrink-0 truncate">{key}:</span>
                      <span className="text-gray-300 break-all">{val}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {currentPanel === 'source' && (
          <div className="h-full flex flex-col font-mono text-[11px]">
            <div className="flex-1 bg-black/40 rounded-xl p-3 border border-white/10 overflow-auto text-gray-200 select-all whitespace-pre leading-relaxed">
              {activeTab.htmlContent || (activeTab.jsonContent ? JSON.stringify(activeTab.jsonContent, null, 2) : activeTab.textContent) || (
                <span className="text-gray-500 italic">No response body captured</span>
              )}
            </div>
          </div>
        )}

        {currentPanel === 'ssh-command' && (
          <div className="space-y-2.5 font-mono text-xs">
            <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider font-sans">
              SSH Dynamic SOCKS5 Proxy & Port Forwarding
            </div>

            <div className="bg-black/40 rounded-xl p-3 border border-white/10 text-cyan-300 select-all whitespace-pre-wrap break-all">
              {activeTab.networkMode === 'server' ? (
                <>
                  <div className="text-emerald-400 font-semibold mb-1"># Dynamic SOCKS5 Proxy (Routes all TCP/Subnets/Web through SSH):</div>
                  <div>ssh -N -D 127.0.0.1:{activeTab.socks5Port || 1080} {activeTab.serverHost || 'user@host'}</div>
                  {activeTab.isTunneled && (
                    <>
                      <div className="text-emerald-400 font-semibold mt-2 mb-1"># Single Port Forwarding Tunnel:</div>
                      <div>ssh -N -L 127.0.0.1:{activeTab.tunnelPort}:127.0.0.1:{activeTab.tunnelPort} {activeTab.serverHost || 'user@host'}</div>
                    </>
                  )}
                </>
              ) : (
                <div className="text-blue-300"># Direct Route (SSH: OFF - Local PC Network): {activeTab.displayUrl || activeTab.url || 'Start Page'}</div>
              )}
            </div>

            <div className="text-[11px] text-gray-400 font-sans space-y-1">
              <div>• <strong>Mode:</strong> {activeTab.networkMode === 'server' ? (activeTab.isTunneled ? 'SSH Port Tunnel & SOCKS5 (Active)' : 'Server Network with SOCKS5 Proxy (Active)') : 'User Network (Direct Local PC Access)'}</div>
              <div>• <strong>SOCKS5 Proxy:</strong> {activeTab.networkMode === 'server' && activeTab.socks5Port ? `127.0.0.1:${activeTab.socks5Port} (Listening)` : 'Disabled (SSH: OFF)'}</div>
              <div>• <strong>Local Listener:</strong> {activeTab.isTunneled ? `127.0.0.1:${activeTab.tunnelPort}` : (activeTab.socks5Port ? `127.0.0.1:${activeTab.socks5Port} (SOCKS5)` : 'Direct')}</div>
              <div>• <strong>Target:</strong> {activeTab.displayUrl || activeTab.url || 'Start Page'}</div>
              <div>• <strong>Routing Network:</strong> {activeTab.networkMode === 'server' ? 'Server Network (SSH: ON)' : 'User Network (SSH: OFF)'}</div>
              <div>• <strong>Engine:</strong> SSH Dynamic Port Forwarding (-D SOCKS5) and TCP socket tunnel. Native browser runtime with full JS, WebSockets, cookies and assets enabled.</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
