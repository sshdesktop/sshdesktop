import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  WifiOff, RefreshCw, AlertTriangle, ArrowRight, ShieldAlert, 
  LogOut, CheckCircle2, Server, Zap, Globe, Pause, Play, Check, X,
  Layers, ArrowLeftRight, Power
} from 'lucide-react';
import { useConnectionStore } from '../lib/store';
import { sshTestConnection } from '../lib/tauri-bridge';

export default function DisconnectAlertModal() {
  const { 
    isDisconnected, 
    disconnectReason, 
    disconnectedServerId,
    isReconnecting, 
    reconnectAttempts, 
    reconnectError, 
    reconnect, 
    closeServer,
    switchToOtherServer,
    returnToServersList, 
    activeConnectionId, 
    connectedServers,
    connections 
  } = useConnectionStore();

  const [countdown, setCountdown] = useState<number>(8);
  const [isAutoPaused, setIsAutoPaused] = useState<boolean>(false);
  const [isTestingProbe, setIsTestingProbe] = useState<boolean>(false);
  const [probeStatus, setProbeStatus] = useState<'idle' | 'reachable' | 'unreachable'>('idle');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Identify the exact disconnected/stopped server profile
  const targetServerId = disconnectedServerId || activeConnectionId;
  const activeServer = connections.find(c => c.id === targetServerId) 
    || connections.find(c => c.id === activeConnectionId)
    || (connections.length > 0 ? connections[0] : null);

  const serverName = activeServer?.name || activeServer?.host || 'Linux Server';
  const serverHost = activeServer?.host || 'remote-server';
  const serverPort = activeServer?.port || 22;
  const serverUser = activeServer?.username || 'root';

  // Discover other servers for multi-server management
  const otherConnected = connections.filter(c => c.id !== targetServerId && connectedServers.has(c.id));
  const otherSaved = connections.filter(c => c.id !== targetServerId && !connectedServers.has(c.id));

  // Auto-reconnect countdown timer
  useEffect(() => {
    if (!isDisconnected) {
      setCountdown(8);
      setIsAutoPaused(false);
      setProbeStatus('idle');
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    if (isReconnecting || isAutoPaused) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          handleManualReconnect();
          return 8;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isDisconnected, isReconnecting, isAutoPaused]);

  const handleManualReconnect = useCallback(async () => {
    try {
      await reconnect(targetServerId || undefined);
    } catch {
      // Reconnect failed, reset countdown to 10s for next auto-retry
      setCountdown(10);
    }
  }, [reconnect, targetServerId]);

  // Test reachability probe
  const handleTestProbe = async () => {
    if (!activeServer) return;
    setIsTestingProbe(true);
    setProbeStatus('idle');
    try {
      const ok = await sshTestConnection({
        host: activeServer.host,
        port: activeServer.port,
        username: activeServer.username,
        name: activeServer.name,
        tags: activeServer.tags || [],
      });
      setProbeStatus(ok ? 'reachable' : 'unreachable');
    } catch {
      setProbeStatus('unreachable');
    } finally {
      setIsTestingProbe(false);
    }
  };

  // Close this disconnected server session
  const handleCloseServer = async () => {
    if (targetServerId) {
      await closeServer(targetServerId);
    } else {
      returnToServersList();
    }
  };

  // Return to server list
  const handleReturnToLogin = () => {
    returnToServersList();
  };

  if (!isDisconnected) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200 select-none">
      {/* macOS Sonoma Floating Alert Sheet */}
      <div className="w-full max-w-lg bg-[#1e1e2e]/95 backdrop-blur-3xl border border-white/[0.15] rounded-3xl shadow-[0_30px_90px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 max-h-[92vh]">
        
        {/* Titlebar with Traffic Lights */}
        <div className="px-5 pt-4 pb-2.5 flex items-center justify-between border-b border-white/[0.08] shrink-0">
          <div className="flex items-center space-x-2">
            <button 
              onClick={handleCloseServer}
              className="w-3 h-3 rounded-full bg-red-500/80 hover:bg-red-500 border border-red-600/40 transition-colors"
              title="Close this server session"
            />
            <div className="w-3 h-3 rounded-full bg-amber-500/80 border border-amber-600/40" />
            <div className="w-3 h-3 rounded-full bg-green-500/80 border border-green-600/40" />
          </div>
          <span className="text-[11px] font-semibold text-gray-400 font-sans tracking-wide">
            CloudDesk Connection Alert
          </span>
          <button 
            onClick={handleReturnToLogin}
            className="text-xs text-gray-500 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
            title="Return to Servers"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 flex flex-col items-center text-center space-y-4 overflow-y-auto">
          
          {/* Animated Warning Icon with Radar Ring */}
          <div className="relative flex items-center justify-center my-1 shrink-0">
            <div className="absolute w-20 h-20 rounded-full bg-rose-500/20 animate-ping opacity-60" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500/25 to-amber-500/25 border border-rose-500/40 flex items-center justify-center text-rose-400 shadow-xl shadow-rose-500/20">
              <WifiOff className="w-8 h-8" />
            </div>
          </div>

          {/* Heading & Host Subtitle */}
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Server Stopped or Offline
            </h2>
            <div className="mt-1 flex items-center justify-center space-x-2 text-xs text-gray-300">
              <Server className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-semibold text-white">{serverName}</span>
              <span className="text-gray-500">•</span>
              <span className="font-mono text-gray-300 bg-white/5 px-2 py-0.5 rounded-lg border border-white/10">
                {serverUser}@{serverHost}:{serverPort}
              </span>
            </div>
          </div>

          {/* Disconnect Reason Box */}
          <div className="w-full bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 text-left space-y-1">
            <div className="text-[10px] uppercase font-bold tracking-wider text-rose-400 flex items-center space-x-1.5">
              <AlertTriangle className="w-3 h-3" />
              <span>Connection Interrupted</span>
            </div>
            <p className="text-xs text-gray-300 font-sans leading-relaxed">
              {disconnectReason || 'The remote SSH host connection timed out or the server was stopped.'}
            </p>
          </div>

          {/* Multi-Server Connect: Close This & Use Another Server */}
          {(otherConnected.length > 0 || otherSaved.length > 0) && (
            <div className="w-full bg-[#13131e] border border-blue-500/20 rounded-2xl p-3.5 text-left space-y-2.5">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                <span className="text-[11px] font-bold text-gray-200 uppercase tracking-wider flex items-center space-x-1.5">
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  <span>Use Another Server</span>
                </span>
                <span className="text-[10px] text-gray-400 font-mono">
                  {otherConnected.length > 0 ? `${otherConnected.length} other active` : `${otherSaved.length} saved`}
                </span>
              </div>

              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {/* Active Connected Servers */}
                {otherConnected.map((srv) => (
                  <div
                    key={srv.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-500/[0.07] hover:bg-emerald-500/[0.12] border border-emerald-500/20 transition-all group"
                  >
                    <div className="flex items-center space-x-2.5 truncate">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                      <div className="truncate">
                        <div className="text-xs font-semibold text-white truncate">{srv.name || srv.host}</div>
                        <div className="text-[10px] text-gray-400 font-mono truncate">{srv.username}@{srv.host}:{srv.port || 22}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => switchToOtherServer(srv.id)}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shrink-0 flex items-center space-x-1 shadow-md shadow-emerald-600/30 transition-transform active:scale-95"
                    >
                      <span>Switch to Server</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                ))}

                {/* Other Saved Servers (if no other server connected currently) */}
                {otherConnected.length === 0 && otherSaved.slice(0, 3).map((srv) => (
                  <div
                    key={srv.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 transition-all group"
                  >
                    <div className="flex items-center space-x-2.5 truncate">
                      <Server className="w-4 h-4 text-blue-400 shrink-0" />
                      <div className="truncate">
                        <div className="text-xs font-semibold text-white truncate">{srv.name || srv.host}</div>
                        <div className="text-[10px] text-gray-400 font-mono truncate">{srv.username}@{srv.host}:{srv.port || 22}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => switchToOtherServer(srv.id)}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shrink-0 flex items-center space-x-1 shadow-md shadow-blue-600/30 transition-transform active:scale-95"
                    >
                      <span>Connect</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reconnection Error if previous attempt failed */}
          {reconnectError && (
            <div className="w-full bg-rose-500/10 border border-rose-500/20 rounded-2xl p-3 text-left text-xs text-rose-300 space-y-1 animate-in fade-in">
              <div className="font-semibold text-[11px] text-rose-400 flex items-center space-x-1">
                <X className="w-3 h-3" />
                <span>Reconnection Attempt #{reconnectAttempts} Failed</span>
              </div>
              <p className="text-[11px] font-mono opacity-90 truncate">
                {reconnectError}
              </p>
            </div>
          )}

          {/* Auto-reconnect Countdown Bar */}
          {!reconnectError && !isReconnecting && (
            <div className="w-full bg-white/[0.02] border border-white/[0.06] rounded-2xl p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-400">
                <span className="flex items-center space-x-1.5">
                  <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span>
                    {isAutoPaused ? 'Auto-reconnect paused' : `Auto-reconnecting in ${countdown}s...`}
                  </span>
                </span>
                <button
                  onClick={() => setIsAutoPaused(!isAutoPaused)}
                  className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-white/5 transition-colors"
                >
                  {isAutoPaused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                  <span>{isAutoPaused ? 'Resume' : 'Pause'}</span>
                </button>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-1000 ease-linear rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, (countdown / 8) * 100))}%` }}
                />
              </div>
            </div>
          )}

          {/* Reachability Probe Result */}
          {probeStatus !== 'idle' && (
            <div className={`w-full py-1.5 px-3 rounded-xl text-xs font-mono flex items-center justify-center space-x-2 ${
              probeStatus === 'reachable' 
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30' 
                : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
            }`}>
              {probeStatus === 'reachable' ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Host {serverHost}:{serverPort} is reachable!</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                  <span>Host {serverHost}:{serverPort} remains offline</span>
                </>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="w-full space-y-2 pt-1">
            {/* Primary Reconnect Button */}
            <button
              onClick={handleManualReconnect}
              disabled={isReconnecting}
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-semibold text-xs shadow-lg shadow-blue-500/25 flex items-center justify-center space-x-2 transition-all disabled:opacity-60 disabled:pointer-events-none"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
              <span>
                {isReconnecting ? 'Reconnecting to Server...' : `Reconnect to ${serverName}`}
              </span>
            </button>

            {/* Secondary Buttons Row: Close Server / Probe / Return to Servers */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleCloseServer}
                className="py-2 px-2.5 rounded-xl bg-white/5 hover:bg-rose-500/20 active:scale-[0.98] text-gray-300 hover:text-rose-300 text-xs font-medium border border-white/10 hover:border-rose-500/30 transition-all flex items-center justify-center space-x-1.5"
                title="Disconnect and close this stopped server"
              >
                <Power className="w-3.5 h-3.5 text-rose-400" />
                <span className="truncate">Close Server</span>
              </button>

              <button
                onClick={handleTestProbe}
                disabled={isTestingProbe}
                className="py-2 px-2.5 rounded-xl bg-white/5 hover:bg-white/10 active:scale-[0.98] text-gray-300 hover:text-white text-xs font-medium border border-white/10 transition-all flex items-center justify-center space-x-1.5"
                title="Test if host port is reachable before full SSH auth"
              >
                <Globe className={`w-3.5 h-3.5 ${isTestingProbe ? 'animate-spin text-blue-400' : 'text-gray-400'}`} />
                <span className="truncate">{isTestingProbe ? 'Probing...' : 'Ping Host'}</span>
              </button>

              <button
                onClick={handleReturnToLogin}
                className="py-2 px-2.5 rounded-xl bg-white/5 hover:bg-blue-500/20 active:scale-[0.98] text-gray-300 hover:text-blue-300 text-xs font-medium border border-white/10 hover:border-blue-500/30 transition-all flex items-center justify-center space-x-1.5"
                title="Return directly to the Saved Servers screen"
              >
                <LogOut className="w-3.5 h-3.5 text-blue-400" />
                <span className="truncate">Return to Servers</span>
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
