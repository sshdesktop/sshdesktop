import React, { useState } from 'react';
import { X, Wrench, RefreshCw, AlertCircle, CheckCircle2, Terminal } from 'lucide-react';
import { BlockDeviceInfo, diskCheckFilesystem } from '../../../lib/tauri-bridge';

interface CheckFsModalProps {
  partition: BlockDeviceInfo;
  connId: string;
  onClose: () => void;
}

export default function CheckFsModal({
  partition,
  connId,
  onClose,
}: CheckFsModalProps) {
  const [repair, setRepair] = useState(false);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleRunCheck = async () => {
    setRunning(true);
    setError(null);
    setOutput(null);
    try {
      const devPath = partition.path || `/dev/${partition.name}`;
      const res = await diskCheckFilesystem(connId, devPath, partition.fstype, repair);
      setOutput(res || 'Check completed with no errors reported.');
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-[#181825]/95 border border-white/20 rounded-3xl max-w-lg w-full shadow-2xl p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Filesystem Integrity Check (fsck)</h3>
              <p className="text-xs text-gray-400 font-mono">
                {partition.path || `/dev/${partition.name}`} ({partition.fstype || 'ext4'})
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

        <div className="space-y-4 text-xs">
          {/* Controls */}
          <div className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/5 rounded-2xl">
            <label className="flex items-center space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={repair}
                onChange={(e) => setRepair(e.target.checked)}
                className="w-4 h-4 rounded bg-black/40 border-white/20 text-emerald-600 focus:ring-0 cursor-pointer"
              />
              <div>
                <div className="text-white font-medium">Automatic Repair Mode (-y)</div>
                <div className="text-[10px] text-gray-400">Fix detected superblock/inode inconsistencies automatically</div>
              </div>
            </label>

            <button
              onClick={handleRunCheck}
              disabled={running}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${running ? 'animate-spin' : ''}`} />
              <span>{running ? 'Checking...' : 'Run fsck'}</span>
            </button>
          </div>

          {/* Terminal Output */}
          <div className="bg-black/60 border border-white/10 rounded-2xl p-3.5 h-56 overflow-y-auto font-mono text-[11px] text-gray-300 space-y-1">
            <div className="text-gray-500 text-[10px] flex items-center space-x-1 pb-1 border-b border-white/5">
              <Terminal className="w-3 h-3" />
              <span>Terminal Execution Log</span>
            </div>
            {running && (
              <div className="flex items-center space-x-2 text-blue-400 animate-pulse pt-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Running filesystem scan on {partition.path || partition.name}...</span>
              </div>
            )}
            {output ? (
              <pre className="whitespace-pre-wrap font-mono text-emerald-300 pt-1 leading-relaxed">
                {output}
              </pre>
            ) : !running && (
              <div className="text-gray-600 pt-8 text-center">
                Click "Run fsck" above to start filesystem integrity analysis.
              </div>
            )}
          </div>

          <div className="flex justify-end pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
