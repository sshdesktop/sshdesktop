import React, { useState } from 'react';
import { User, X, Lock, AlertTriangle, Eye, EyeOff, LogIn, LogOut, Loader2, Trash2 } from 'lucide-react';
import { DockerAuthInfo, SavedDockerCredential } from '../types';

interface DockerAuthModalProps {
  isOpen: boolean;
  dockerAuth: DockerAuthInfo | null;
  savedCredentialsList: SavedDockerCredential[];
  onClose: () => void;
  onLogin: (registry: string, username: string, password: string, save: boolean) => Promise<void>;
  onLogout: (registry: string) => Promise<void>;
  onDeleteCredential: (id: string) => void;
}

export const DockerAuthModal: React.FC<DockerAuthModalProps> = ({
  isOpen,
  dockerAuth,
  savedCredentialsList,
  onClose,
  onLogin,
  onLogout,
  onDeleteCredential,
}) => {
  const [registry, setRegistry] = useState('docker.io');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saveCreds, setSaveCreds] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      await onLogin(registry.trim() || 'docker.io', username.trim(), password, saveCreds);
      setPassword('');
      onClose();
    } catch (err: any) {
      setLoginError(err?.message || String(err));
    } finally {
      setIsLoggingIn(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
              <User className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Docker Registry Account</h3>
              <p className="text-[11px] text-gray-400">Authenticate against Docker Hub or private registries</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Active Logged-in Status Card */}
          {dockerAuth?.loggedIn ? (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <div>
                  <div className="text-xs font-bold text-emerald-300">Active Account: {dockerAuth.username}</div>
                  <div className="text-[10px] text-emerald-400/80 font-mono mt-0.5">Registry: {dockerAuth.registry}</div>
                </div>
              </div>
              <button
                onClick={() => onLogout(dockerAuth.registry)}
                className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-xs font-semibold transition-all active:scale-95 flex items-center space-x-1 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log Out</span>
              </button>
            </div>
          ) : (
            <div className="p-3 bg-white/5 border border-white/10 rounded-2xl flex items-center space-x-2.5 text-xs text-gray-300">
              <Lock className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Not currently logged into any Docker registry on this server.</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5 pt-2 border-t border-white/10">
            <div className="text-xs font-semibold text-white">Log in to Registry</div>

            {loginError && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="whitespace-pre-wrap">{loginError}</span>
              </div>
            )}

            {/* Popular Cloud & Git Registries */}
            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1.5">Select Popular Registry</label>
              <div className="grid grid-cols-4 gap-1.5 mb-2.5">
                {[
                  { label: 'Docker Hub', reg: 'docker.io', user: '', hint: 'Docker Hub official cloud registry' },
                  { label: 'AWS ECR', reg: '<account-id>.dkr.ecr.<region>.amazonaws.com', user: 'AWS', hint: 'AWS Elastic Container Registry' },
                  { label: 'Azure ACR', reg: '<name>.azurecr.io', user: '', hint: 'Azure Container Registry' },
                  { label: 'Google GCP', reg: 'gcr.io', user: '_json_key', hint: 'Google Cloud Registry' },
                  { label: 'Google Artifact', reg: 'us-docker.pkg.dev', user: '_json_key', hint: 'Google Cloud Artifact Registry' },
                  { label: 'GitHub GHCR', reg: 'ghcr.io', user: '', hint: 'GitHub Container Registry' },
                  { label: 'GitLab', reg: 'registry.gitlab.com', user: '', hint: 'GitLab Container Registry' },
                  { label: 'Quay.io', reg: 'quay.io', user: '', hint: 'Red Hat Quay Container Registry' },
                ].map(p => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setRegistry(p.reg);
                      if (p.user) setUsername(p.user);
                    }}
                    className={`px-2 py-1.5 rounded-lg text-[10px] font-semibold border transition-all truncate text-center cursor-pointer ${
                      registry === p.reg
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10 hover:text-white'
                    }`}
                    title={p.hint}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {registry.includes('ecr.') && (
                <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 mb-2 leading-relaxed">
                  🟧 <strong>AWS ECR:</strong> Username is fixed to <code className="bg-black/30 px-1 rounded">AWS</code>.
                </div>
              )}
              {registry.includes('azurecr.io') && (
                <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-300 mb-2 leading-relaxed">
                  🔷 <strong>Azure ACR:</strong> Replace <code className="bg-black/30 px-1 rounded">&lt;name&gt;</code> with your registry name.
                </div>
              )}
              {(registry.includes('gcr.io') || registry.includes('pkg.dev')) && (
                <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-300 mb-2 leading-relaxed">
                  🔴 <strong>Google Cloud (GCP):</strong> Set username to <code className="bg-black/30 px-1 rounded">_json_key</code> and paste key into Password.
                </div>
              )}
              {registry === 'ghcr.io' && (
                <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-300 mb-2 leading-relaxed">
                  🐙 <strong>GitHub (ghcr.io):</strong> Username is your GitHub handle. Password is a Personal Access Token with package permissions.
                </div>
              )}
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">Registry Endpoint</label>
              <input
                type="text"
                value={registry}
                onChange={(e) => setRegistry(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                placeholder="e.g. docker.io"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                placeholder="Docker ID or username"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">Password / Access Token</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 pr-10 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                  placeholder="••••••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-gray-400 hover:text-white cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <input
                type="checkbox"
                id="saveDockerCreds"
                checked={saveCreds}
                onChange={(e) => setSaveCreds(e.target.checked)}
                className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 cursor-pointer"
              />
              <label htmlFor="saveDockerCreds" className="text-xs text-gray-300 cursor-pointer">
                Save credential profile in SSH Desktop
              </label>
            </div>

            <div className="pt-3 flex items-center justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isLoggingIn}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                {isLoggingIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                <span>{isLoggingIn ? 'Logging In...' : 'Log In'}</span>
              </button>
            </div>
          </form>

          {/* Saved Profiles */}
          {savedCredentialsList.length > 0 && (
            <div className="pt-3 border-t border-white/10">
              <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Saved Accounts</div>
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {savedCredentialsList.map((cred) => (
                  <div key={cred.id} className="p-2.5 bg-black/20 border border-white/5 rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-white">{cred.username}</div>
                      <div className="text-[10px] text-gray-400 font-mono">{cred.registry}</div>
                    </div>
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => {
                          setUsername(cred.username);
                          setRegistry(cred.registry);
                        }}
                        className="px-2 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-[11px] cursor-pointer"
                      >
                        Use
                      </button>
                      <button
                        onClick={() => onDeleteCredential(cred.id)}
                        className="p-1 rounded text-gray-400 hover:text-rose-400 hover:bg-white/5 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
