import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  WifiOff, RefreshCw, AlertTriangle, ArrowRight, ShieldAlert, 
  LogOut, CheckCircle2, Server, Zap, Globe, Pause, Play, Check, X
} from 'lucide-react';
import { useConnectionStore } from '../lib/store';
import { sshTestConnection } from '../lib/tauri-bridge';

export default function DisconnectAlertModal() {
  const { 
    isDisconnected, 
    disconnectReason, 
    isReconnecting, 
    reconnectAttempts, 
    reconnectError, 
    reconnect, 
    disconnect, 
    activeConnectionId, 
    connections 
  } = useConnectionStore();

  const [countdown, setCountdown] = useState<number>(8);
  const [isAutoPaused, setIsAutoPaused] = useState<boolean>(false);
  const [isTestingProbe, setIsTestingProbe] = useState<boolean>(false);
  const [probeStatus, setProbeStatus] = useState<'idle' | 'reachable' | 'unreachable'>('idle');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeServer = connections.find(c => c.id === activeConnectionId);
  const serverName = activeServer?.name || activeServer?.host || 'Linux Server';
  const serverHost = activeServer?.host || 'unknown-host';
  const serverPort = activeServer?.port || 22;
  const serverUser = activeServer?.username || 'root';

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
          // Trigger reconnect automatically
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
      await reconnect();
    } catch {
      // Reconnect failed, reset countdown to 10s for next auto-retry
      setCountdown(10);
    }
  }, [reconnect]);

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

  const handleReturnToLogin = () => {
    if (activeConnectionId) {
      disconnect(activeConnectionId);
    }
  };

  if (!isDisconnected) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xl animate-in fade-in duration-200 select-none">
      {/* macOS Sonoma Floating Alert Sheet */}
      <div className="w-full max-w-md bg-[#1e1e2e]/95 backdrop-blur-3xl border border-white/[0.15] rounded-3xl shadow-[0_30px_90px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
        
        {/* Titlebar with Traffic Lights */}
        <div className="px-5 pt-4 pb-2 flex items-center justify-between border-b border-white/[0.06]">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-red-500/80 border border-red-600/40" />
            <div className="w-3 h-3 rounded-full bg-amber-500/80 border border-amber-600/40" />
            <div className="w-3 h-3 rounded-full bg-green-500/80 border border-green-600/40" />
          </div>
          <span className="text-[11px] font-medium text-gray-400 font-sans tracking-wide">
            CloudDesk Connection Alert
          </span>
          <div className="w-10" />
        </div>

        {/* Modal Body */}
        <div className="p-6 flex flex-col items-center text-center space-y-4">
          
          {/* Animated Warning Icon with Radar Ring */}
          <div className="relative flex items-center justify-center my-1">
            <div className="absolute w-20 h-20 rounded-full bg-rose-500/20 animate-ping opacity-60" />
            <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-500/20 to-amber-500/20 border border-rose-500/30 flex items-center justify-center text-rose-400 shadow-lg shadow-rose-500/10">
              <WifiOff className="w-8 h-8" />
            </div>
          </div>

          {/* Heading & Host Subtitle */}
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Server Disconnected
            </h2>
            <div className="mt-1 flex items-center justify-center space-x-1.5 text-xs text-gray-400">
              <Server className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-semibold text-gray-200">{serverName}</span>
              <span>•</span>
              <span className="font-mono text-gray-300">{serverUser}@{serverHost}:{serverPort}</span>
            </div>
          </div>

          {/* Disconnect Reason Box */}
          <div className="w-full bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3 text-left space-y-1">
            <div className="text-[10px] uppercase font-bold tracking-wider text-rose-400/90 flex items-center space-x-1">
              <AlertTriangle className="w-3 h-3" />
              <span>Connection Interrupted</span>
            </div>
            <p className="text-xs text-gray-300 font-sans leading-relaxed">
              {disconnectReason || 'The remote SSH host connection timed out or the network session was closed.'}
            </p>
          </div>

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
              className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-medium text-xs shadow-lg shadow-blue-500/25 flex items-center justify-center space-x-2 transition-all disabled:opacity-60 disabled:pointer-events-none"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
              <span>
                {isReconnecting ? 'Reconnecting to Server...' : 'Reconnect Now'}
              </span>
              {!isReconnecting && (
                <kbd className="hidden sm:inline-block ml-1.5 px-1.5 py-0.5 text-[10px] font-mono bg-white/20 rounded">
                  Enter
                </kbd>
              )}
            </button>

            {/* Secondary Buttons Row */}
            <div className="flex items-center space-x-2">
              <button
                onClick={handleTestProbe}
                disabled={isTestingProbe}
                className="flex-1 py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 active:scale-[0.98] text-gray-300 hover:text-white text-xs font-medium border border-white/10 transition-all flex items-center justify-center space-x-1.5"
                title="Test if host port is reachable before full SSH auth"
              >
                <Globe className={`w-3.5 h-3.5 ${isTestingProbe ? 'animate-spin text-blue-400' : 'text-gray-400'}`} />
                <span>{isTestingProbe ? 'Probing...' : 'Test Host Ping'}</span>
              </button>

              <button
                onClick={handleReturnToLogin}
                className="flex-1 py-2 px-3 rounded-xl bg-white/5 hover:bg-rose-500/20 active:scale-[0.98] text-gray-300 hover:text-rose-300 text-xs font-medium border border-white/10 hover:border-rose-500/30 transition-all flex items-center justify-center space-x-1.5"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Return to Servers</span>
              </button>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
