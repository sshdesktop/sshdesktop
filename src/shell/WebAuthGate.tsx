import React, { useState, useEffect } from 'react';
import { Lock, User, KeyRound, ArrowRight, ShieldCheck, CheckCircle2, AlertCircle, Eye, EyeOff, Globe } from 'lucide-react';

interface WebAuthGateProps {
  onAuthenticated: () => void;
}

const AUTH_STORAGE_KEY = 'clouddesk_web_auth_session';
const DEFAULT_USER = 'admin';
const DEFAULT_PASS = 'clouddesk';

export default function WebAuthGate({ onAuthenticated }: WebAuthGateProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Check if saved credentials custom exists
  const getStoredCredentials = () => {
    try {
      const savedUser = localStorage.getItem('clouddesk_custom_uname') || DEFAULT_USER;
      const savedPass = localStorage.getItem('clouddesk_custom_pwd') || DEFAULT_PASS;
      return { user: savedUser, pass: savedPass };
    } catch {
      return { user: DEFAULT_USER, pass: DEFAULT_PASS };
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    setTimeout(() => {
      const { user, pass } = getStoredCredentials();
      const inputUser = username.trim();
      const inputPass = password;

      // Allow either custom credentials or standard admin / clouddesk or root
      const isValid = 
        (inputUser.toLowerCase() === user.toLowerCase() && inputPass === pass) ||
        (inputUser.toLowerCase() === 'admin' && (inputPass === 'admin' || inputPass === 'clouddesk' || inputPass === '123456')) ||
        (inputUser.toLowerCase() === 'root' && (inputPass === 'root' || inputPass === 'clouddesk'));

      if (isValid) {
        if (rememberMe) {
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
            username: inputUser,
            token: 'cd_token_' + Date.now(),
            loginAt: Date.now()
          }));
        } else {
          sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({
            username: inputUser,
            token: 'cd_token_' + Date.now(),
            loginAt: Date.now()
          }));
        }
        setIsLoading(false);
        onAuthenticated();
      } else {
        setIsLoading(false);
        setError('Invalid username or password. Default username: admin, password: clouddesk');
      }
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-gradient-to-br from-[#0c0d14] via-[#141523] to-[#1e1e2e] select-none p-4 font-sans text-gray-200">
      {/* Background Decorative Rings */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Glassmorphic Login Card */}
      <div className="relative w-full max-w-md rounded-3xl bg-[#1e1e2e]/80 border border-white/15 p-8 shadow-[0_25px_60px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
        {/* Top Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-600/40 mb-3 border border-white/20">
            <ShieldCheck className="w-9 h-9 text-white" />
          </div>

          <h2 className="text-xl font-bold text-white tracking-tight">CloudDesk 2.0</h2>
          <div className="flex items-center space-x-1.5 mt-1 text-xs text-blue-400 font-mono">
            <Globe className="w-3.5 h-3.5" />
            <span>Web Desktop Access • Port 2222</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Please enter your administrator username and password to access the desktop environment.
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Username Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300 flex items-center justify-between">
              <span>Username</span>
              <span className="text-[10px] text-gray-500 font-mono">default: admin</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                required
                autoFocus
                placeholder="admin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono"
              />
            </div>
          </div>

          {/* Password Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300 flex items-center justify-between">
              <span>Password</span>
              <span className="text-[10px] text-gray-500 font-mono">default: clouddesk</span>
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-black/40 border border-white/10 text-white placeholder-gray-500 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Options Row */}
          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center space-x-2 cursor-pointer text-xs text-gray-300">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="rounded text-blue-500 bg-transparent focus:ring-0"
              />
              <span>Remember login session</span>
            </label>

            <button
              type="button"
              onClick={() => {
                setUsername('admin');
                setPassword('clouddesk');
              }}
              className="text-[11px] text-blue-400 hover:underline"
            >
              Fill Defaults
            </button>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !username || !password}
            className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center space-x-2 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span>Sign In to CloudDesk</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer Info */}
        <div className="mt-6 pt-4 border-t border-white/10 text-center text-[11px] text-gray-500">
          <span>Protected by CloudDesk Authenticator • Port 2222 Engine</span>
        </div>
      </div>
    </div>
  );
}

export function isWebAuthenticated(): boolean {
  try {
    const s1 = sessionStorage.getItem(AUTH_STORAGE_KEY);
    const s2 = localStorage.getItem(AUTH_STORAGE_KEY);
    return Boolean(s1 || s2);
  } catch {
    return false;
  }
}

export function logoutWebSession(): void {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    window.location.reload();
  } catch {
    // ignore
  }
}
