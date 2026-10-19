import React, { useState } from 'react';
import { X, Sliders, AlertTriangle, Shield, Lock, AlertCircle } from 'lucide-react';
import { BlockDeviceInfo, diskUnmount } from '../../../lib/tauri-bridge';

interface UnmountModalProps {
  partition: BlockDeviceInfo;
  connId: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export default function UnmountModal({
  partition,
  connId,
  onClose,
  onSuccess,
}: UnmountModalProps) {
  const [force, setForce] = useState(false);
  const [lazy, setLazy] = useState(false);
  const [removeFromFstab, setRemoveFromFstab] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSystem = !!partition.is_system || partition.mountpoint === '/' || partition.mountpoint === '/boot';

  const handleUnmount = async () => {
    if (isSystem) {
      setError('Cannot unmount critical system partition.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const target = partition.mountpoint || partition.path || `/dev/${partition.name}`;
      const res = await diskUnmount(connId, target, force, lazy, removeFromFstab);
      onSuccess(res || `Successfully unmounted ${target}`);
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
              isSystem ? 'bg-rose-500/20 border border-rose-500/40 text-rose-400' : 'bg-amber-500/20 border border-amber-500/40 text-amber-400'
            }`}>
              {isSystem ? <Shield className="w-5 h-5 text-rose-400" /> : <AlertTriangle className="w-5 h-5 text-amber-400" />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Unmount Volume</h3>
              <p className="text-xs text-gray-400 font-mono">
                {partition.path || `/dev/${partition.name}`} → {partition.mountpoint}
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
          /* SYSTEM PARTITION BLOCKED SCREEN */
          <div className="space-y-4">
            <div className="p-4 bg-rose-500/15 border border-rose-500/40 rounded-2xl space-y-2 text-xs">
              <div className="flex items-center space-x-2 text-rose-300 font-bold">
                <Lock className="w-4 h-4 text-rose-400 shrink-0" />
                <span>CRITICAL SYSTEM PROTECTION ACTIVE</span>
              </div>
              <p className="text-rose-200/90 leading-relaxed">
                This partition is mounted as <strong className="font-mono text-white underline">{partition.mountpoint}</strong> (root filesystem or system bootloader).
              </p>
              <p className="text-rose-200/80">
                Unmounting this volume is prohibited by CloudDesk safety guardrails because it would immediately crash running services or make your server unbootable.
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          /* STANDARD UNMOUNT FORM */
          <div className="space-y-4 text-xs">
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-200/90 space-y-1">
              <div className="font-semibold text-white">Confirm Unmount</div>
              <p>Are you sure you want to unmount <strong className="font-mono text-amber-300">{partition.mountpoint}</strong>? Any open files or running processes utilizing this mount may be interrupted.</p>
            </div>

            {/* Unmount Options */}
            <div className="space-y-2.5 pt-1">
              <label className="flex items-center space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={force}
                  onChange={(e) => setForce(e.target.checked)}
                  className="w-4 h-4 rounded bg-black/40 border-white/20 text-rose-600 focus:ring-0 cursor-pointer"
                />
                <div>
                  <div className="text-white font-medium">Force Unmount (-f)</div>
                  <div className="text-[10px] text-gray-400">Forces unmount even if the filesystem is currently busy</div>
                </div>
              </label>

              <label className="flex items-center space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lazy}
                  onChange={(e) => setLazy(e.target.checked)}
                  className="w-4 h-4 rounded bg-black/40 border-white/20 text-blue-600 focus:ring-0 cursor-pointer"
                />
                <div>
                  <div className="text-white font-medium">Lazy Unmount (-l)</div>
                  <div className="text-[10px] text-gray-400">Detaches filesystem now and cleans up references when no longer busy</div>
                </div>
              </label>

              <label className="flex items-center space-x-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={removeFromFstab}
                  onChange={(e) => setRemoveFromFstab(e.target.checked)}
                  className="w-4 h-4 rounded bg-black/40 border-white/20 text-blue-600 focus:ring-0 cursor-pointer"
                />
                <div>
                  <div className="text-white font-medium">Remove from /etc/fstab</div>
                  <div className="text-[10px] text-gray-400">Prevents automatic re-mounting upon server reboot</div>
                </div>
              </label>
            </div>

            {/* Buttons */}
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
                type="button"
                onClick={handleUnmount}
                disabled={loading}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-semibold shadow-md active:scale-95 transition-all"
              >
                {loading ? 'Unmounting...' : 'Unmount Now'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
