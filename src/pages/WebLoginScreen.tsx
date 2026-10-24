import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, Lock, User, KeyRound, AlertTriangle, CheckCircle2, 
  ArrowRight, RefreshCw, HardDrive, Server, Eye, EyeOff
} from 'lucide-react';
import { authGetStatus, authLogin, authChangeCredentials, AuthStatusResponse } from '../lib/tauri-bridge';
import SshDesktopLogo from '../components/SshDesktopLogo';

interface WebLoginScreenProps {
  children: React.ReactNode;
}

export default function WebLoginScreen({ children }: WebLoginScreenProps) {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Login Form State
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Mandatory First-Time Password Change Modal State
  const [showChangeModal, setShowChangeModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('admin');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changeSuccess, setChangeSuccess] = useState(false);
  const [isChanging, setIsChanging] = useState(false);

  // Check Web Auth Status on Mount
  useEffect(() => {
    let mounted = true;
    const checkStatus = async () => {
      try {
        const status = await authGetStatus();
        if (!mounted) return;
        setAuthStatus(status);
        if (status.is_authenticated && !status.must_change_password) {
          setIsAuthenticated(true);
        } else if (status.is_authenticated && status.must_change_password) {
          setShowChangeModal(true);
        }
      } catch (err) {
        console.warn('Web auth status check:', err);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    checkStatus();
    return () => { mounted = false; };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsSubmitting(true);
    try {
      const res = await authLogin(username.trim(), password);
      if (res.success) {
        if (res.must_change_password) {
          setCurrentPassword(password);
          setNewUsername(username.trim());
          setShowChangeModal(true);
        } else {
          setIsAuthenticated(true);
        }
      } else {
        setLoginError(res.message || 'Invalid username or password.');
      }
    } catch (err: any) {
      setLoginError(err?.message || String(err) || 'Authentication failed.');
    } finally {
      setIsSubmitting(false);
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
      setChangeError('New password cannot be the default "admin". Please pick a strong password.');
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
        setChangeSuccess(true);
        setTimeout(() => {
          setShowChangeModal(false);
          setIsAuthenticated(true);
        }, 1200);
      } else {
        setChangeError(res.message || 'Failed to update credentials.');
      }
    } catch (err: any) {
      setChangeError(err?.message || String(err) || 'Failed to update credentials.');
    } finally {
      setIsChanging(false);
    }
  };

  // If already authenticated and not requiring change, render application
  if (isAuthenticated && !showChangeModal) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-[#0d0e15] flex flex-col items-center justify-center space-y-4 select-none">
        <SshDesktopLogo className="w-12 h-12 text-blue-500 animate-pulse" />
        <span className="text-xs font-mono text-gray-400">Loading SSH Desktop Security Gateway...</span>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999999] bg-[#0c0d16] bg-gradient-to-br from-[#0c0d16] via-[#141529] to-[#0a0a14] flex items-center justify-center p-6 select-none font-sans overflow-y-auto">
      {/* Background Glow Accents */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none" />

      {/* Main Glassmorphic Card */}
      <div className="relative w-full max-w-md bg-[#181a2e]/90 backdrop-blur-3xl border border-white/15 rounded-3xl p-8 shadow-[0_30px_90px_rgba(0,0,0,0.85)] space-y-6 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 mx-auto flex items-center justify-center text-white shadow-xl shadow-blue-500/25">
            <SshDesktopLogo className="w-8 h-8 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">SSH Desktop Server</h1>
            <p className="text-xs text-gray-400 mt-0.5">Web Administration Gateway & Linux Cloud Desktop</p>
          </div>
        </div>

        {/* Server Storage Location Badge */}
        {authStatus?.storage_path && (
          <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/10 text-[11px] text-gray-300 font-mono">
            <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span className="truncate" title={`Secure credentials stored in: ${authStatus.storage_path}`}>
              {authStatus.storage_path}
            </span>
            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-400/30 shrink-0">
              chmod 600
            </span>
          </div>
        )}

        {/* Default Credentials Notice */}
        <div className="flex items-start space-x-2.5 p-3 rounded-xl bg-blue-500/10 border border-blue-400/20 text-xs text-blue-200">
          <KeyRound className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-semibold text-blue-300">Default Access Credentials</div>
            <div className="text-[11px] text-blue-200/80 leading-relaxed">
              Default login: Username <code className="bg-black/30 px-1 py-0.5 rounded text-white font-mono">admin</code> & Password <code className="bg-black/30 px-1 py-0.5 rounded text-white font-mono">admin</code>. You will be prompted to change credentials immediately.
            </div>
          </div>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          {loginError && (
            <div className="flex items-center space-x-2 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs animate-in fade-in">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{loginError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300 flex items-center space-x-1.5">
              <User className="w-3.5 h-3.5 text-blue-400" />
              <span>Administrator Username</span>
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-white/15 text-white text-xs focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all font-mono"
              placeholder="e.g. admin"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300 flex items-center space-x-1.5">
              <Lock className="w-3.5 h-3.5 text-blue-400" />
              <span>Administrator Password</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-black/40 border border-white/15 text-white text-xs focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 transition-all font-mono"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-blue-500/25 flex items-center justify-center space-x-2 transition-all cursor-pointer disabled:opacity-50"
          >
            {isSubmitting ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>Sign In to SSH Desktop</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer Security Badges */}
        <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-gray-400">
          <div className="flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Salted SHA-256 Auth</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <Server className="w-4 h-4 text-blue-400" />
            <span>Linux Daemon Ready</span>
          </div>
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
                <h2 className="text-lg font-bold text-white tracking-tight">Security Notice: First-Time Login</h2>
                <p className="text-xs text-gray-300 leading-relaxed">
                  Your server is running with the default credentials (<strong className="text-amber-300">admin / admin</strong>). For your server's protection, you must change your administrator username and password before entering SSH Desktop.
                </p>
              </div>
            </div>

            {changeError && (
              <div className="flex items-center space-x-2 p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
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
                Location: {authStatus?.storage_path || '/etc/sshdesktop/auth.json'} (secured with chmod 600)
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
