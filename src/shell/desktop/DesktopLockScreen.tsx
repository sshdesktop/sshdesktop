import React, { useState, useEffect } from 'react';
import { Lock, Unlock, Fingerprint, ArrowRight, Eye, EyeOff, Shield } from 'lucide-react';
import { useConnectionStore, useSettingsStore } from '../../lib/store';

interface DesktopLockScreenProps {
  isLocked: boolean;
  onUnlock: () => void;
  wallpaperUrl: string;
}

export default function DesktopLockScreen({
  isLocked,
  onUnlock,
  wallpaperUrl,
}: DesktopLockScreenProps) {
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);
  const username = activeServer?.username || 'root';
  const serverHost = activeServer?.host || 'server';

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [timeStr, setTimeStr] = useState('');
  const [dateStr, setDateStr] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
      setDateStr(now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!isLocked) return null;

  const handleUnlockAttempt = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    // Allow unlock with password or blank (session lock)
    if (activeServer?.password && password && password !== activeServer.password) {
      setHasError(true);
      setTimeout(() => setHasError(false), 800);
      return;
    }
    setPassword('');
    onUnlock();
  };

  return (
    <div className="fixed inset-0 z-[999999] select-none flex flex-col items-center justify-between p-12 overflow-hidden animate-in fade-in duration-300">
      {/* Blurred Wallpaper Backdrop */}
      <div 
        className="absolute inset-0 bg-cover bg-center scale-105 filter blur-2xl brightness-50"
        style={{ backgroundImage: `url(${wallpaperUrl})` }}
      />
      <div className="absolute inset-0 bg-black/40 backdrop-blur-3xl" />

      {/* Top Lock Status & Clock */}
      <div className="relative z-10 flex flex-col items-center space-y-2 mt-8 text-center">
        <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-xl border border-white/20 flex items-center justify-center text-amber-300 shadow-xl mb-2">
          <Lock className="w-5 h-5" />
        </div>
        <div className="text-6xl md:text-8xl font-black text-white tracking-tight drop-shadow-2xl font-mono">
          {timeStr || '--:--'}
        </div>
        <div className="text-base md:text-lg font-medium text-gray-200 drop-shadow">
          {dateStr}
        </div>
      </div>

      {/* Center User Profile & Unlock Form */}
      <div className="relative z-10 flex flex-col items-center space-y-5 w-full max-w-sm mb-12">
        {/* User Avatar */}
        <div className="relative group">
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 p-0.5 shadow-2xl ring-4 ring-white/20">
            <div className="w-full h-full rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center text-white text-2xl font-bold uppercase">
              {username.charAt(0)}
            </div>
          </div>
        </div>

        <div className="text-center">
          <h2 className="text-lg font-bold text-white drop-shadow tracking-wide">
            {username}
          </h2>
          <p className="text-xs text-gray-300/80 font-mono">
            {serverHost} • CloudDesk Secure Session
          </p>
        </div>

        {/* Password Form */}
        <form 
          onSubmit={handleUnlockAttempt}
          className={`w-full flex items-center space-x-2 bg-white/10 dark:bg-black/50 backdrop-blur-2xl border rounded-2xl p-1.5 shadow-2xl transition-all ${
            hasError 
              ? 'border-rose-500 animate-shake shadow-rose-500/30' 
              : 'border-white/20 focus-within:border-blue-400'
          }`}
        >
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password to unlock..."
            autoFocus
            className="w-full bg-transparent px-3 py-1.5 text-xs text-white placeholder-gray-400 focus:outline-none font-sans"
          />

          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="p-1.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>

          <button
            type="submit"
            className="w-8 h-8 rounded-xl bg-blue-600 hover:bg-blue-500 text-white flex items-center justify-center transition-all shadow-md shrink-0 cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

      </div>

      {/* Footer Info */}
      <div className="relative z-10 text-[11px] text-gray-400 flex items-center space-x-2">
        <Shield className="w-3.5 h-3.5 text-blue-400" />
        <span>End-to-End Encrypted CloudDesk Session</span>
      </div>
    </div>
  );
}
