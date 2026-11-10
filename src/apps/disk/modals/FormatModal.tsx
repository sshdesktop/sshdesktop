import React, { useState } from 'react';
import { X, Disc, AlertTriangle, Shield, Lock, AlertCircle, Check } from 'lucide-react';
import { BlockDeviceInfo, diskFormatFilesystem } from '../../../lib/tauri-bridge';

interface FormatModalProps {
  partition: BlockDeviceInfo;
  connId: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export default function FormatModal({
  partition,
  connId,
  onClose,
  onSuccess,
}: FormatModalProps) {
  const [fstype, setFstype] = useState(partition.fstype || 'ext4');
  const [label, setLabel] = useState(partition.label || '');
  const [quick, setQuick] = useState(true);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSystem = !!partition.is_system || partition.mountpoint === '/' || partition.mountpoint === '/boot';

  const handleFormat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSystem) {
      setError('Cannot format critical system partition.');
      return;
    }
    if (!confirmed) {
      setError('Please acknowledge the data loss warning checkbox to proceed.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const devPath = partition.path || `/dev/${partition.name}`;
      const res = await diskFormatFilesystem(connId, devPath, fstype, label.trim() || undefined, quick);
      onSuccess(res || `Successfully formatted ${devPath} as ${fstype.toUpperCase()}`);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-[#181825]/95 border border-white/20 rounded-3xl max-w-md w-full shadow-2xl p-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${
              isSystem ? 'bg-rose-500/20 border border-rose-500/40 text-rose-400' : 'bg-indigo-500/20 border border-indigo-500/40 text-indigo-400'
            }`}>
              {isSystem ? <Shield className="w-5 h-5 text-rose-400" /> : <Disc className="w-5 h-5 text-indigo-400" />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Format Filesystem</h3>
              <p className="text-xs text-gray-400 font-mono">
                {partition.path || `/dev/${partition.name}`} ({partition.size})
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

        {isSystem ? (
          /* SYSTEM BLOCKED VIEW */
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-rose-500/15 border border-rose-500/40 rounded-2xl space-y-2">
              <div className="flex items-center space-x-2 text-rose-300 font-bold">
                <Lock className="w-4 h-4 text-rose-400 shrink-0" />
                <span>SYSTEM PARTITION PROTECTED</span>
              </div>
              <p className="text-rose-200/90 leading-relaxed">
                This partition is mounted on <strong className="font-mono text-white underline">{partition.mountpoint}</strong> (root filesystem / OS boot).
              </p>
              <p className="text-rose-200/80">
                Formatting this volume would instantly wipe the Linux operating system kernel and server data. Formatting is blocked to prevent accidental system destruction.
              </p>
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
        ) : (
          /* FORMAT FORM */
          <form onSubmit={handleFormat} className="space-y-4 text-xs">
            {/* Danger Warning Box */}
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-rose-200 flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-rose-300">Data Loss Warning:</span>
                <p className="mt-0.5 text-[11px] text-rose-200/80">
                  Formatting will permanently erase all contents on <strong className="font-mono text-white">{partition.path || partition.name}</strong>. Existing files cannot be recovered.
                </p>
              </div>
            </div>

            {/* Filesystem Selector */}
            <div className="space-y-1.5">
              <label className="font-medium text-gray-300">Target Filesystem</label>
              <select
                value={fstype}
                onChange={(e) => setFstype(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
              >
                <option value="ext4">ext4 — Linux Standard Journaled (Recommended)</option>
                <option value="xfs">xfs — High Performance Enterprise Filesystem</option>
                <option value="btrfs">btrfs — Modern Copy-on-Write with Snapshots</option>
                <option value="vfat">vfat / FAT32 — Universal Cross-Platform & EFI</option>
                <option value="ntfs">ntfs — Windows NT Filesystem Compatibility</option>
                <option value="swap">swap — Linux Virtual Memory Swap Space</option>
              </select>
            </div>

            {/* Volume Label */}
            <div className="space-y-1.5">
              <label className="font-medium text-gray-300">Volume Label (Optional)</label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. DATA_STORAGE"
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono placeholder-gray-600"
              />
            </div>

            {/* Quick Format */}
            <label className="flex items-center space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={quick}
                onChange={(e) => setQuick(e.target.checked)}
                className="w-4 h-4 rounded bg-black/40 border-white/20 text-blue-600 focus:ring-0 cursor-pointer"
              />
              <span className="text-gray-300">Quick Format (skip zeroing blocks)</span>
            </label>

            {/* Confirmation Checkbox */}
            <div className="pt-2 border-t border-white/10">
              <label className="flex items-start space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="w-4 h-4 mt-0.5 rounded bg-black/40 border-rose-500/50 text-rose-600 focus:ring-0 cursor-pointer"
                />
                <span className="text-gray-300 leading-tight">
                  I understand that formatting will <strong className="text-rose-400">permanently erase all data</strong> on <code className="font-mono text-white">{partition.path || partition.name}</code>.
                </span>
              </label>
            </div>

            {/* Action buttons */}
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
                disabled={!confirmed || loading}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
              >
                {loading ? 'Formatting...' : 'Format Partition'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
