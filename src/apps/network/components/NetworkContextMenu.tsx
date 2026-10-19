import React, { useEffect, useRef } from 'react';
import { 
  Copy, Zap, Terminal, ExternalLink, Compass, Activity, 
  Trash2, ShieldAlert, ArrowDownUp, Shield, Network as NetworkIcon,
  Radio, Check
} from 'lucide-react';

export interface ContextMenuTarget {
  type: 'port' | 'conn' | 'iface';
  data: any;
}

interface NetworkContextMenuProps {
  x: number;
  y: number;
  target: ContextMenuTarget;
  onClose: () => void;
  onKillPort: (port: number, protocol: string, pid?: number, signal?: string) => void;
  onOpenKillModal: (port: number, protocol: string, process?: string, pid?: number) => void;
  onInspectTerminal: (cmd: string) => void;
  onOpenProcessManager?: (pid: number) => void;
  onSwitchToSpeedTest?: () => void;
  onPingHost?: (host: string) => void;
}

export default function NetworkContextMenu({
  x,
  y,
  target,
  onClose,
  onKillPort,
  onOpenKillModal,
  onInspectTerminal,
  onOpenProcessManager,
  onSwitchToSpeedTest,
  onPingHost,
}: NetworkContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust coordinates if menu overflows window edges
  const posX = Math.min(x, window.innerWidth - 240);
  const posY = Math.min(y, window.innerHeight - 340);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    onClose();
  };

  const { type, data } = target;

  return (
    <div
      ref={menuRef}
      style={{ left: posX, top: posY }}
      className="fixed z-50 w-56 bg-[#181825]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl py-1.5 text-xs text-gray-200 select-none animate-in fade-in zoom-in-95 duration-100"
    >
      {/* 1. PORT TARGET */}
      {type === 'port' && (
        <>
          <div className="px-3.5 py-1.5 border-b border-white/10 flex items-center justify-between font-mono text-[11px] text-gray-400">
            <div className="flex items-center space-x-1.5 truncate">
              <Radio className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="font-bold text-white truncate">:{data.port}</span>
              <span className="text-[10px] text-gray-400">({data.protocol})</span>
            </div>
            {data.pid > 0 && (
              <span className="text-[10px] bg-white/5 px-1 rounded text-emerald-400">
                PID {data.pid}
              </span>
            )}
          </div>

          <div className="py-1">
            {/* Kill Port Actions */}
            <button
              onClick={() => {
                onOpenKillModal(data.port, data.protocol, data.process, data.pid);
                onClose();
              }}
              className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-rose-500/20 text-left transition-colors text-rose-400 font-semibold"
            >
              <Zap className="w-3.5 h-3.5 text-rose-400" />
              <span>Kill Port & Process...</span>
            </button>

            <button
              onClick={() => {
                onKillPort(data.port, data.protocol, data.pid, 'KILL');
                onClose();
              }}
              className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-rose-500/20 text-left transition-colors text-rose-300"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Force Terminate (SIGKILL)</span>
            </button>

            <button
              onClick={() => {
                onKillPort(data.port, data.protocol, data.pid, 'TERM');
                onClose();
              }}
              className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-amber-300"
            >
              <Terminal className="w-3.5 h-3.5 text-amber-400" />
              <span>Graceful Stop (SIGTERM)</span>
            </button>

            <div className="my-1 border-t border-white/10" />

            {/* Copy Actions */}
            <button
              onClick={() => copyToClipboard(String(data.port))}
              className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-300"
            >
              <Copy className="w-3.5 h-3.5 text-gray-400" />
              <span>Copy Port Number</span>
            </button>

            <button
              onClick={() => copyToClipboard(`${data.bindAddr}:${data.port}`)}
              className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-300"
            >
              <Copy className="w-3.5 h-3.5 text-gray-400" />
              <span>Copy Full Address</span>
            </button>

            {data.process && (
              <button
                onClick={() => copyToClipboard(data.process)}
                className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-300"
              >
                <Copy className="w-3.5 h-3.5 text-gray-400" />
                <span>Copy Process Name</span>
              </button>
            )}

            {data.pid > 0 && (
              <button
                onClick={() => copyToClipboard(String(data.pid))}
                className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-300"
              >
                <Copy className="w-3.5 h-3.5 text-gray-400" />
                <span>Copy PID ({data.pid})</span>
              </button>
            )}

            <div className="my-1 border-t border-white/10" />

            {/* Inspection Actions */}
            <button
              onClick={() => {
                onInspectTerminal(`ss -lptn 'sport = :${data.port}' || lsof -i :${data.port}\n`);
                onClose();
              }}
              className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-blue-300"
            >
              <Terminal className="w-3.5 h-3.5 text-blue-400" />
              <span>Inspect Socket in Terminal</span>
            </button>

            {data.pid > 0 && onOpenProcessManager && (
              <button
                onClick={() => {
                  onOpenProcessManager(data.pid);
                  onClose();
                }}
                className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-emerald-300"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>View in Process Manager</span>
              </button>
            )}

            <button
              onClick={() => {
                onInspectTerminal(`curl -I http://127.0.0.1:${data.port} || nc -zv 127.0.0.1 ${data.port}\n`);
                onClose();
              }}
              className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-400"
            >
              <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
              <span>Test Port Connectivity</span>
            </button>
          </div>
        </>
      )}

      {/* 2. ACTIVE CONNECTION TARGET */}
      {type === 'conn' && (
        <>
          <div className="px-3.5 py-1.5 border-b border-white/10 flex items-center justify-between font-mono text-[11px] text-gray-400">
            <span className="font-bold text-white truncate">{data.local}</span>
            <span className="text-[10px] uppercase bg-white/5 px-1 rounded text-blue-400">
              {data.state}
            </span>
          </div>

          <div className="py-1">
            <button
              onClick={() => copyToClipboard(data.local)}
              className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-300"
            >
              <Copy className="w-3.5 h-3.5 text-gray-400" />
              <span>Copy Local Address</span>
            </button>

            <button
              onClick={() => copyToClipboard(data.remote)}
              className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-300"
            >
              <Copy className="w-3.5 h-3.5 text-gray-400" />
              <span>Copy Remote Address</span>
            </button>

            {onPingHost && data.remote && (
              <button
                onClick={() => {
                  const host = data.remote.split(':')[0].trim().replace(/^\[|\]$/g, '');
                  if (host) onPingHost(host);
                  onClose();
                }}
                className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-blue-300"
              >
                <Compass className="w-3.5 h-3.5 text-blue-400" />
                <span>Ping Remote Host</span>
              </button>
            )}

            {data.pid > 0 && (
              <>
                <div className="my-1 border-t border-white/10" />
                <button
                  onClick={() => {
                    const localPortMatch = data.local.match(/:(\d+)$/);
                    const portNum = localPortMatch ? parseInt(localPortMatch[1], 10) : 0;
                    onKillPort(portNum, 'tcp', data.pid, 'KILL');
                    onClose();
                  }}
                  className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-rose-500/20 text-left transition-colors text-rose-400 font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-400" />
                  <span>Terminate Socket PID {data.pid}</span>
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* 3. INTERFACE TARGET */}
      {type === 'iface' && (
        <>
          <div className="px-3.5 py-1.5 border-b border-white/10 flex items-center justify-between font-mono text-[11px] text-gray-400">
            <div className="flex items-center space-x-1.5 truncate">
              <NetworkIcon className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span className="font-bold text-white truncate">{data.name}</span>
            </div>
            <span className="text-[10px] text-emerald-400">Active</span>
          </div>

          <div className="py-1">
            {data.ipv4 && data.ipv4 !== '—' && (
              <button
                onClick={() => copyToClipboard(data.ipv4)}
                className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-300"
              >
                <Copy className="w-3.5 h-3.5 text-gray-400" />
                <span>Copy IPv4 Address</span>
              </button>
            )}

            {data.mac && data.mac !== '—' && (
              <button
                onClick={() => copyToClipboard(data.mac)}
                className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-300"
              >
                <Copy className="w-3.5 h-3.5 text-gray-400" />
                <span>Copy MAC Address</span>
              </button>
            )}

            <div className="my-1 border-t border-white/10" />

            {onSwitchToSpeedTest && (
              <button
                onClick={() => {
                  onSwitchToSpeedTest();
                  onClose();
                }}
                className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-amber-300 font-medium"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Run Speed Test</span>
              </button>
            )}

            <button
              onClick={() => {
                onInspectTerminal(`ip -s link show ${data.name}\n`);
                onClose();
              }}
              className="w-full px-3.5 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-blue-300"
            >
              <Terminal className="w-3.5 h-3.5 text-blue-400" />
              <span>Inspect Interface in Terminal</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
