import React, { useState } from 'react';
import { 
  X, Zap, AlertTriangle, ShieldAlert, CheckCircle2, 
  Trash2, Terminal, Info, AlertCircle 
} from 'lucide-react';
import { networkKillPort } from '../../../lib/tauri-bridge';

interface KillPortModalProps {
  initialPort?: number;
  initialProtocol?: string;
  initialProcess?: string;
  initialPid?: number;
  connId: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export default function KillPortModal({
  initialPort,
  initialProtocol = 'TCP',
  initialProcess = '',
  initialPid = 0,
  connId,
  onClose,
  onSuccess,
}: KillPortModalProps) {
  const [port, setPort] = useState<string>(initialPort ? String(initialPort) : '');
  const [protocol, setProtocol] = useState<'TCP' | 'UDP'>(
    initialProtocol.toUpperCase().includes('UDP') ? 'UDP' : 'TCP'
  );
  const [signal, setSignal] = useState<'KILL' | 'TERM'>('KILL');
  const [pid, setPid] = useState<string>(initialPid && initialPid > 0 ? String(initialPid) : '');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const portNum = parseInt(port, 10);
  const isPrivilegedPort = !isNaN(portNum) && portNum > 0 && portNum < 1024;
  const isSshPort = portNum === 22;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isNaN(portNum) || portNum <= 0 || portNum > 65535) {
      setError('Please enter a valid port number between 1 and 65535.');
      return;
    }

    if (isSshPort) {
      if (!confirm('CAUTION: You are attempting to kill port 22 (SSH). Terminating sshd may disconnect your current session! Are you sure?')) {
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const pidNum = pid.trim() ? parseInt(pid.trim(), 10) : undefined;
      const res = await networkKillPort(
        connId,
        portNum,
        protocol.toLowerCase(),
        pidNum && !isNaN(pidNum) && pidNum > 0 ? pidNum : undefined,
        signal
      );

      onSuccess(res || `Port :${portNum} (${protocol}) killed successfully.`);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
      <div className="bg-[#181825]/95 border border-white/20 rounded-3xl max-w-md w-full shadow-2xl p-6 space-y-4 text-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Kill Port / Terminate Socket</h3>
              <p className="text-xs text-gray-400 font-mono">
                Force terminate processes binding port
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-xs text-rose-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {isPrivilegedPort && (
          <div className={`p-3 rounded-2xl text-xs flex items-start space-x-2 border ${
            isSshPort 
              ? 'bg-rose-500/20 border-rose-500/40 text-rose-300' 
              : 'bg-amber-500/15 border-amber-500/30 text-amber-200'
          }`}>
            <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${isSshPort ? 'text-rose-400' : 'text-amber-400'}`} />
            <div>
              <b className="block">{isSshPort ? 'Critical Service Port (SSH 22)' : 'Privileged System Port (<1024)'}</b>
              {isSshPort 
                ? 'Terminating port 22 may disconnect your active SSH session.' 
                : 'This port is typically bound by system daemons. Elevated sudo permissions will be used.'}
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Target Port & Protocol */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-1">
              <label className="font-medium text-gray-300 block">Port Number</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-mono">:</span>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  required
                  autoFocus
                  value={port}
                  onChange={e => setPort(e.target.value)}
                  placeholder="e.g. 8080, 3000, 5000"
                  className="w-full pl-6 pr-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-rose-500 focus:outline-none text-white font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="font-medium text-gray-300 block">Protocol</label>
              <div className="flex bg-black/40 p-0.5 rounded-xl border border-white/10">
                <button
                  type="button"
                  onClick={() => setProtocol('TCP')}
                  className={`flex-1 py-1.5 rounded-lg font-mono font-bold transition-all ${
                    protocol === 'TCP' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  TCP
                </button>
                <button
                  type="button"
                  onClick={() => setProtocol('UDP')}
                  className={`flex-1 py-1.5 rounded-lg font-mono font-bold transition-all ${
                    protocol === 'UDP' ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  UDP
                </button>
              </div>
            </div>
          </div>

          {/* Process info if known */}
          {initialProcess && (
            <div className="p-3 bg-white/[0.03] border border-white/10 rounded-2xl flex items-center justify-between font-mono text-xs">
              <div>
                <span className="text-[10px] text-gray-500 uppercase block font-sans">Detected Process</span>
                <span className="text-emerald-400 font-bold">{initialProcess}</span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-gray-500 uppercase block font-sans">Process ID (PID)</span>
                <span className="text-white font-bold">{initialPid || 'Unknown'}</span>
              </div>
            </div>
          )}

          {/* Optional PID */}
          <div className="space-y-1">
            <label className="text-[11px] text-gray-400 block">
              Process PID (Optional - leaves empty to auto-detect and kill socket):
            </label>
            <input
              type="number"
              value={pid}
              onChange={e => setPid(e.target.value)}
              placeholder="e.g. 14205 (optional)"
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-rose-500 focus:outline-none text-white font-mono placeholder-gray-600"
            />
          </div>

          {/* Signal Selection */}
          <div className="space-y-1.5">
            <label className="font-medium text-gray-300 block">Termination Signal</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSignal('KILL')}
                className={`py-2 px-3 rounded-xl border text-left transition-all ${
                  signal === 'KILL'
                    ? 'bg-rose-500/20 border-rose-500 text-rose-300 shadow-sm'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                }`}
              >
                <div className="font-bold flex items-center space-x-1.5">
                  <Zap className="w-3.5 h-3.5 text-rose-400" />
                  <span>SIGKILL (-9)</span>
                </div>
                <div className="text-[10px] text-gray-400 font-sans mt-0.5">
                  Immediate force terminate
                </div>
              </button>

              <button
                type="button"
                onClick={() => setSignal('TERM')}
                className={`py-2 px-3 rounded-xl border text-left transition-all ${
                  signal === 'TERM'
                    ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-sm'
                    : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                }`}
              >
                <div className="font-bold flex items-center space-x-1.5">
                  <Terminal className="w-3.5 h-3.5 text-amber-400" />
                  <span>SIGTERM (-15)</span>
                </div>
                <div className="text-[10px] text-gray-400 font-sans mt-0.5">
                  Graceful shutdown request
                </div>
              </button>
            </div>
          </div>

          {/* Technical Info Banner */}
          <div className="p-3 bg-white/[0.02] border border-white/5 rounded-2xl flex items-start space-x-2 text-[11px] text-gray-400 font-sans">
            <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
            <span>
              SSH Desktop executes elevated <code className="font-mono text-white">kill</code> and <code className="font-mono text-white">fuser -k</code> across the socket to guarantee the port is released.
            </span>
          </div>

          {/* Footer Controls */}
          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !port.trim()}
              className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{loading ? 'Killing Port...' : `Kill Port :${port || '...'}`}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
