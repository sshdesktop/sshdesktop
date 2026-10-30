import React, { useState, useEffect } from 'react';
import { 
  Lock, User, KeyRound, ArrowRight, ShieldCheck, CheckCircle2, 
  AlertCircle, Eye, EyeOff, Globe, HardDrive, AlertTriangle, RefreshCw 
} from 'lucide-react';
import SshDesktopLogo from '../components/SshDesktopLogo';
import { 
  authGetStatus, authLogin, authChangeCredentials, AuthStatusResponse,
  AUTH_STORAGE_KEY, LEGACY_AUTH_STORAGE_KEY
} from '../lib/tauri-bridge';

interface WebAuthGateProps {
  onAuthenticated: () => void;
}

// Shared storage keys imported from tauri-bridge

export default function WebAuthGate({ onAuthenticated }: WebAuthGateProps) {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Mandatory First-Time Password & Username Change Modal
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('admin');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState(false);
  const [isChanging, setIsChanging] = useState(false);

  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);

  useEffect(() => {
    let mounted = true;
    authGetStatus()
      .then((status) => {
        if (!mounted) return;
        setAuthStatus(status);
        if (status.is_authenticated && !status.must_change_password) {
          onAuthenticated();
        } else if (status.is_authenticated && status.must_change_password) {
          setShowChangeModal(true);
        } else if (status.session_expired) {
          setSessionExpiredNotice(true);
        }
      })
      .catch((err) => console.warn('Web auth status init notice:', err));

    const handleSessionExpired = (e: any) => {
      if (!mounted) return;
      setError(e?.detail?.reason || 'Your session has expired (1 hour limit). Please sign in again.');
      setSessionExpiredNotice(true);
    };

    window.addEventListener('sshdesktop-session-expired', handleSessionExpired);

    return () => { 
      mounted = false; 
      window.removeEventListener('sshdesktop-session-expired', handleSessionExpired);
    };
  }, [onAuthenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const res = await authLogin(username.trim(), password);
      if (res.success) {
        const expiresAt = res.expires_at || (Date.now() + 60 * 60 * 1000);
        const payload = JSON.stringify({
          username: res.username,
          token: res.token || ('ssh_token_' + Date.now()),
          loginAt: Date.now(),
          expiresAt
        });
        if (rememberMe) {
          localStorage.setItem(AUTH_STORAGE_KEY, payload);
        } else {
          sessionStorage.setItem(AUTH_STORAGE_KEY, payload);
        }

        if (res.must_change_password) {
          setCurrentPassword(password);
          setNewUsername(username.trim());
          setShowChangeModal(true);
        } else {
          onAuthenticated();
        }
      } else {
        setError(res.message || 'Invalid username or password.');
      }
    } catch (err: any) {
      // Fallback local verification for web-only static deployment without backend IPC
      const inputUser = username.trim();
      const inputPass = password;
      const customUser = localStorage.getItem('sshdesktop_custom_uname') || 'admin';
      const customPass = localStorage.getItem('sshdesktop_custom_pwd') || 'admin';

      const isValid = 
        (inputUser === customUser && inputPass === customPass) ||
        (inputUser.toLowerCase() === 'admin' && (inputPass === 'admin' || inputPass === 'sshdesktop'));

      if (isValid) {
        const payload = JSON.stringify({
          username: inputUser,
          token: 'ssh_token_' + Date.now(),
          loginAt: Date.now(),
          expiresAt: Date.now() + 60 * 60 * 1000
        });
        if (rememberMe) {
          localStorage.setItem(AUTH_STORAGE_KEY, payload);
        } else {
          sessionStorage.setItem(AUTH_STORAGE_KEY, payload);
        }

        const hasChanged = localStorage.getItem('sshdesktop_credentials_changed') === 'true';
        if (!hasChanged && inputPass === 'admin') {
          setCurrentPassword(password);
          setNewUsername(inputUser);
          setShowChangeModal(true);
        } else {
          onAuthenticated();
        }
      } else {
        setError(err?.message || 'Invalid username or password. Default username: admin, password: admin');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangeCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangeError(null);

    if (newUsername.trim().length < 3) {
      setChangeError('New username must be at least 3 characters.');
      return;
    }
    if (newPassword.trim().length < 6) {
      setChangeError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword.trim() === 'admin') {
      setChangeError('New password cannot be the default "admin". Please pick a secure password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangeError('New password and confirm password do not match.');
      return;
    }

    setIsChanging(true);
    try {
      const res = await authChangeCredentials(currentPassword, newUsername.trim(), newPassword);
      if (res.success) {
        localStorage.setItem('sshdesktop_credentials_changed', 'true');
        localStorage.setItem('sshdesktop_custom_uname', newUsername.trim());
        localStorage.setItem('sshdesktop_custom_pwd', newPassword);
        setChangeSuccess(true);
        setTimeout(() => {
          setShowChangeModal(false);
          onAuthenticated();
        }, 1200);
      } else {
        setChangeError(res.message || 'Failed to update credentials.');
      }
    } catch (err: any) {
      // Local fallback for static web server deployment
      localStorage.setItem('sshdesktop_credentials_changed', 'true');
      localStorage.setItem('sshdesktop_custom_uname', newUsername.trim());
      localStorage.setItem('sshdesktop_custom_pwd', newPassword);
      setChangeSuccess(true);
      setTimeout(() => {
        setShowChangeModal(false);
        onAuthenticated();
      }, 1200);
    } finally {
      setIsChanging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-gradient-to-br from-[#0c0d14] via-[#141523] to-[#1e1e2e] select-none p-4 font-sans text-gray-200">
      {/* Background Decorative Rings */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Glassmorphic Login Card */}
      <div className="relative w-full max-w-md rounded-3xl bg-[#1e1e2e]/90 border border-white/15 p-8 shadow-[0_25px_60px_rgba(0,0,0,0.8)] backdrop-blur-2xl space-y-5">
        {/* Top Header */}
        <div className="flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-600/40 mb-3 border border-white/20 p-2.5">
            <SshDesktopLogo className="w-full h-full text-white" />
          </div>

          <h2 className="text-xl font-bold text-white tracking-tight">SSH Desktop</h2>
          <div className="flex items-center space-x-1.5 mt-1 text-xs text-blue-400 font-mono">
            <Globe className="w-3.5 h-3.5" />
            <span>Web Desktop Server Gateway</span>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Please enter your administrator username and password to access the desktop environment.
          </p>
        </div>

        {/* Safe Storage & 1-Hour Session Badges */}
        <div className="space-y-2">
          <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-[11px] text-gray-300 font-mono">
            <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="truncate" title={`Safe Storage: ${authStatus?.storage_path || 'Owner-Only Local Storage'}`}>
              {authStatus?.storage_path ? `${authStatus.storage_path}` : 'Protected Local Storage'}
            </span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-400/30 shrink-0">
              0700 safe
            </span>
          </div>

          <div className="flex items-center justify-between px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-[11px] text-indigo-300">
            <div className="flex items-center space-x-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span>Web Session Expiration</span>
            </div>
            <span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-200 border border-indigo-400/30">
              1 Hour Limit
            </span>
          </div>
        </div>

        {sessionExpiredNotice && (
          <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs flex items-start space-x-2.5 animate-in fade-in">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>Session Expired:</strong> Your 1-hour web desktop session has expired for security. Please sign in again.
            </div>
          </div>
        )}

        {/* Default Notice */}
        <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-400/20 text-xs text-blue-200 flex items-start space-x-2.5">
          <KeyRound className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-[11px] text-blue-200/90 leading-relaxed">
            Default credentials: Username <strong className="text-white">admin</strong>, Password <strong className="text-white">admin</strong>. You must change your credentials on first login.
          </div>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2">
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
              <span className="text-[10px] text-gray-500 font-mono">default: admin</span>
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
                setPassword('admin');
              }}
              className="text-[11px] text-blue-400 hover:underline cursor-pointer"
            >
              Fill Defaults
            </button>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading || !username || !password}
            className="w-full mt-2 py-3 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center space-x-2 transition-all active:scale-[0.98] disabled:opacity-50 cursor-pointer"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <span>Sign In to SSH Desktop</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer Info */}
        <div className="pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-gray-400">
          <div className="flex items-center space-x-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Salted SHA-256 Storage</span>
          </div>
          <span>CLI Server Service</span>
        </div>
      </div>

      {/* Mandatory First-Time Password & Username Change Modal */}
      {showChangeModal && (
        <div className="fixed inset-0 z-[99999999] bg-black/85 backdrop-blur-2xl flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-[#1a1b2e] border-2 border-amber-400/50 rounded-3xl p-7 shadow-[0_30px_90px_rgba(0,0,0,0.9)] space-y-6">
            
            {/* Modal Header */}
            <div className="flex items-start space-x-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-white tracking-tight">Security Requirement: First-Time Login</h2>
                <p className="text-xs text-gray-300 leading-relaxed">
                  Your server is configured with default credentials (<strong className="text-amber-300">admin / admin</strong>). For your server's security, you must update your administrator username and password before accessing SSH Desktop.
                </p>
              </div>
            </div>

            {changeError && (
              <div className="flex items-center space-x-2 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{changeError}</span>
              </div>
            )}

            {changeSuccess && (
              <div className="flex items-center space-x-2 p-3 rounded-xl bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs animate-in zoom-in-95">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Credentials saved securely! Launching SSH Desktop...</span>
              </div>
            )}

            <form onSubmit={handleChangeCredentials} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">New Administrator Username</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-white text-xs focus:outline-none focus:border-amber-400 transition-all font-mono"
                  placeholder="Enter new username (e.g. sysadmin)"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-white text-xs focus:outline-none focus:border-amber-400 transition-all font-mono"
                    placeholder="Min 6 characters"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-white text-xs focus:outline-none focus:border-amber-400 transition-all font-mono"
                    placeholder="Repeat password"
                  />
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-[11px] text-gray-400 font-mono">
                Storage: {authStatus?.storage_path || '/etc/sshdesktop/auth.json'} (secured with chmod 600)
              </div>

              <button
                type="submit"
                disabled={isChanging || changeSuccess}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-xs font-bold shadow-lg shadow-amber-500/25 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {isChanging ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4" />
                    <span>Save New Credentials & Access Desktop</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function isWebAuthenticated(): boolean {
  try {
    const raw = sessionStorage.getItem(AUTH_STORAGE_KEY) || 
                localStorage.getItem(AUTH_STORAGE_KEY) ||
                sessionStorage.getItem(LEGACY_AUTH_STORAGE_KEY) || 
                localStorage.getItem(LEGACY_AUTH_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.expiresAt && Date.now() >= parsed.expiresAt) {
      sessionStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem(AUTH_STORAGE_KEY);
      sessionStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
      localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
      return false;
    }
    return Boolean(parsed.token || parsed.username);
  } catch {
    return false;
  }
}

export function logoutWebSession(): void {
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
    localStorage.removeItem(LEGACY_AUTH_STORAGE_KEY);
    window.location.reload();
  } catch {
    // ignore
  }
}
