import React, { useState, useEffect, useRef } from 'react';
import { Package, Terminal, X, CheckCircle2, AlertCircle, Loader2, Play, ShieldAlert, Info, FileCode } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { sshExec, sshExecStream } from '../../../lib/tauri-bridge';
import { useConnectionStore } from '../../../lib/store';

interface PackageInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeConnId: string;
  file: { name: string; size: string; permissions?: string } | null;
  currentPath: string;
  onSuccess?: () => void;
}

export const PackageInstallModal: React.FC<PackageInstallModalProps> = ({
  isOpen,
  onClose,
  activeConnId,
  file,
  currentPath,
  onSuccess,
}) => {
  const [packageType, setPackageType] = useState<'deb' | 'rpm' | 'sh' | 'other'>('deb');
  const [packageInfo, setPackageInfo] = useState<Record<string, string>>({});
  const [isLoadingInfo, setIsLoadingInfo] = useState(false);
  const [scriptArgs, setScriptArgs] = useState('');
  const [runAsSudo, setRunAsSudo] = useState(true);

  const [installStatus, setInstallStatus] = useState<'idle' | 'installing' | 'completed' | 'error'>('idle');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const streamIdRef = useRef<string>('');

  useEffect(() => {
    if (!isOpen || !file) {
      setInstallStatus('idle');
      setLogLines([]);
      setErrorMessage(null);
      setPackageInfo({});
      setScriptArgs('');
      return;
    }

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.deb')) setPackageType('deb');
    else if (lower.endsWith('.rpm')) setPackageType('rpm');
    else if (lower.endsWith('.sh') || lower.endsWith('.bash')) setPackageType('sh');
    else setPackageType('other');

    fetchPackageInfo(file.name);
  }, [isOpen, file]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  const fullFilePath = file
    ? (currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`)
    : '';

  const fetchPackageInfo = async (fileName: string) => {
    setIsLoadingInfo(true);
    setPackageInfo({});
    const path = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
    const escaped = `'${path.replace(/'/g, "'\\''")}'`;

    try {
      const lower = fileName.toLowerCase();
      if (lower.endsWith('.deb')) {
        const res = await sshExec(activeConnId, `dpkg-deb -I ${escaped} 2>/dev/null || dpkg -I ${escaped} 2>/dev/null`);
        if (res.exit_code === 0 && res.stdout) {
          const info: Record<string, string> = {};
          res.stdout.split('\n').forEach((line) => {
            const match = line.match(/^\s*([A-Za-z\-]+):\s*(.+)$/);
            if (match) {
              info[match[1]] = match[2];
            }
          });
          setPackageInfo(info);
        }
      } else if (lower.endsWith('.rpm')) {
        const res = await sshExec(activeConnId, `rpm -qip ${escaped} 2>/dev/null`);
        if (res.exit_code === 0 && res.stdout) {
          const info: Record<string, string> = {};
          res.stdout.split('\n').forEach((line) => {
            const match = line.match(/^([A-Za-z\-]+)\s*:\s*(.+)$/);
            if (match) {
              info[match[1].trim()] = match[2].trim();
            }
          });
          setPackageInfo(info);
        }
      } else if (lower.endsWith('.sh')) {
        const res = await sshExec(activeConnId, `head -n 25 ${escaped} 2>/dev/null`);
        if (res.exit_code === 0 && res.stdout) {
          setPackageInfo({ Preview: res.stdout.trim() });
        }
      }
    } catch (err) {
      console.warn('Failed to inspect package info:', err);
    } finally {
      setIsLoadingInfo(false);
    }
  };

  const startInstallation = async () => {
    if (!file) return;
    setInstallStatus('installing');
    setErrorMessage(null);
    setLogLines([`Starting installation for: ${file.name}...`]);

    const streamId = `pkg-install-${Date.now()}`;
    streamIdRef.current = streamId;

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<any>('exec-output', (event) => {
        const chunk = event.payload;
        if (chunk && chunk.stream_id === streamId) {
          if (chunk.data) {
            const rawLines = chunk.data.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
            if (rawLines.length > 0) {
              setLogLines((prev) => [...prev, ...rawLines]);
            }
          }
          if (chunk.is_done) {
            if (chunk.exit_code === 0) {
              setInstallStatus('completed');
              setLogLines((prev) => [...prev, `[SUCCESS] Package installation completed successfully!`]);
              onSuccess?.();
            } else {
              setInstallStatus('error');
              setErrorMessage(`Installation command exited with code ${chunk.exit_code}`);
            }
          }
        }
      });

      const activeConn = useConnectionStore.getState().connections.find(c => c.id === activeConnId);
      const isRoot = activeConn?.username === 'root';
      const password = activeConn?.password;

      const escapedPath = `'${fullFilePath.replace(/'/g, "'\\''")}'`;
      const argsStr = scriptArgs.trim();

      const getSudoPrefix = (cmd: string) => {
        if (isRoot) return cmd;
        if (password) {
          const escapedPwd = password.replace(/'/g, "'\\''");
          return `echo '${escapedPwd}' | sudo -S -E ${cmd}`;
        }
        return `sudo -E ${cmd}`;
      };

      let installCmd = '';

      if (packageType === 'deb') {
        if (isRoot) {
          installCmd = `DEBIAN_FRONTEND=noninteractive dpkg -i ${escapedPath} || (apt-get update && apt-get install -f -y)`;
        } else {
          installCmd = `${getSudoPrefix(`DEBIAN_FRONTEND=noninteractive dpkg -i ${escapedPath}`)} || (${getSudoPrefix('apt-get update')} && ${getSudoPrefix('apt-get install -f -y')})`;
        }
      } else if (packageType === 'rpm') {
        if (isRoot) {
          installCmd = `rpm -Uvh --replacepkgs ${escapedPath} || dnf install -y ${escapedPath} || yum localinstall -y ${escapedPath}`;
        } else {
          installCmd = `${getSudoPrefix(`rpm -Uvh --replacepkgs ${escapedPath}`)} || ${getSudoPrefix(`dnf install -y ${escapedPath}`)} || ${getSudoPrefix(`yum localinstall -y ${escapedPath}`)}`;
        }
      } else if (packageType === 'sh') {
        if (!runAsSudo || isRoot) {
          installCmd = `chmod +x ${escapedPath} && bash ${escapedPath} ${argsStr}`;
        } else {
          installCmd = `chmod +x ${escapedPath} && ${getSudoPrefix(`bash ${escapedPath} ${argsStr}`)}`;
        }
      } else {
        if (!runAsSudo || isRoot) {
          installCmd = `chmod +x ${escapedPath} && ${escapedPath}`;
        } else {
          installCmd = `chmod +x ${escapedPath} && ${getSudoPrefix(escapedPath)}`;
        }
      }

      await sshExecStream(activeConnId, installCmd, streamId);
    } catch (err: any) {
      console.error('Package install error:', err);
      setInstallStatus('error');
      setErrorMessage(String(err?.message || err));
    }
  };

  if (!isOpen || !file) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#181825] border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              packageType === 'deb'
                ? 'bg-rose-500/20 text-rose-400'
                : packageType === 'rpm'
                ? 'bg-blue-500/20 text-blue-400'
                : 'bg-emerald-500/20 text-emerald-400'
            }`}>
              {packageType === 'sh' ? <Terminal className="w-5 h-5" /> : <Package className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {packageType === 'deb'
                  ? 'Debian Package Installer (.deb)'
                  : packageType === 'rpm'
                  ? 'RPM Package Installer (.rpm)'
                  : 'Shell Script Installer (.sh)'}
              </h3>
              <p className="text-xs text-gray-400 font-mono truncate max-w-sm">{file.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={installStatus === 'installing'}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          {/* File summary bar */}
          <div className="bg-[#11111b] border border-white/5 rounded-xl p-3 flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2">
              <span className="text-gray-400">Path:</span>
              <span className="font-mono text-gray-200 truncate max-w-xs">{fullFilePath}</span>
            </div>
            <div className="flex items-center space-x-3 text-gray-400">
              <span>Size: <strong className="text-gray-200">{file.size}</strong></span>
            </div>
          </div>

          {/* Package Details or Options */}
          {installStatus === 'idle' && (
            <div className="space-y-3">
              {isLoadingInfo ? (
                <div className="flex items-center justify-center py-6 space-x-2 text-xs text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Inspecting package contents...</span>
                </div>
              ) : Object.keys(packageInfo).length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-gray-300 flex items-center space-x-1.5">
                    <Info className="w-3.5 h-3.5 text-blue-400" />
                    <span>Package Information</span>
                  </div>
                  <div className="bg-[#11111b] border border-white/5 rounded-xl p-3 text-xs space-y-1.5 max-h-40 overflow-y-auto font-mono">
                    {packageType === 'sh' && packageInfo.Preview ? (
                      <pre className="text-gray-300 text-[11px] whitespace-pre-wrap">{packageInfo.Preview}</pre>
                    ) : (
                      Object.entries(packageInfo).map(([key, value]) => (
                        <div key={key} className="flex">
                          <span className="text-gray-400 w-28 shrink-0">{key}:</span>
                          <span className="text-gray-200 break-all">{value}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {/* Shell script execution options */}
              {packageType === 'sh' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="text-xs font-medium text-gray-300 block mb-1">Script Arguments (optional)</label>
                    <input
                      type="text"
                      value={scriptArgs}
                      onChange={(e) => setScriptArgs(e.target.value)}
                      placeholder="e.g. --prefix=/usr/local --verbose"
                      className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>

                  <label className="flex items-center space-x-2.5 cursor-pointer text-xs text-gray-300 select-none">
                    <input
                      type="checkbox"
                      checked={runAsSudo}
                      onChange={(e) => setRunAsSudo(e.target.checked)}
                      className="rounded bg-white/10 border-white/20 text-blue-500 focus:ring-0"
                    />
                    <div className="flex items-center space-x-1.5">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                      <span>Run with root privileges (sudo)</span>
                    </div>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Installation Terminal Output */}
          {(installStatus === 'installing' || installStatus === 'completed' || installStatus === 'error') && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {installStatus === 'installing' && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                  {installStatus === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {installStatus === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
                  <span className="text-xs font-medium text-gray-200">
                    {installStatus === 'installing'
                      ? 'Installing software live...'
                      : installStatus === 'completed'
                      ? 'Installation Finished'
                      : 'Installation Failed'}
                  </span>
                </div>
              </div>

              {/* Log window */}
              <div className="bg-[#11111b] border border-white/10 rounded-xl p-3 font-mono text-xs text-gray-300 max-h-60 overflow-y-auto flex flex-col space-y-1">
                {logLines.length === 0 ? (
                  <div className="text-gray-500 italic py-2">Waiting for installation output...</div>
                ) : (
                  logLines.map((line, idx) => (
                    <div
                      key={idx}
                      className={`break-all ${
                        line.startsWith('[SUCCESS]')
                          ? 'text-emerald-400 font-bold'
                          : line.includes('error') || line.includes('Error') || line.includes('dpkg: error')
                          ? 'text-rose-400'
                          : 'text-gray-300'
                      }`}
                    >
                      {line}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>

              {/* Error banner */}
              {errorMessage && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-start space-x-2.5 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                  <div>
                    <div className="font-semibold">Installer Error</div>
                    <div className="text-[11px] opacity-90 mt-0.5">{errorMessage}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/10 flex items-center justify-end space-x-2.5 bg-white/[0.02]">
          {installStatus === 'idle' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs text-gray-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startInstallation}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors shadow-lg shadow-blue-600/30 flex items-center space-x-1.5"
              >
                <Play className="w-3.5 h-3.5" />
                <span>{packageType === 'sh' ? 'Execute Script' : 'Install Software'}</span>
              </button>
            </>
          )}

          {installStatus === 'installing' && (
            <div className="text-xs text-gray-400 italic flex items-center space-x-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span>Installing package on server...</span>
            </div>
          )}

          {(installStatus === 'completed' || installStatus === 'error') && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-white bg-white/10 hover:bg-white/15 rounded-xl transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
