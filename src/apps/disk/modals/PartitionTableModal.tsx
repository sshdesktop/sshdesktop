import React, { useState } from 'react';
import { X, Disc, AlertTriangle, Shield, Lock, AlertCircle, Check } from 'lucide-react';
import { BlockDeviceInfo, diskCreateLabel } from '../../../lib/tauri-bridge';

interface PartitionTableModalProps {
  disk: BlockDeviceInfo;
  connId: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export default function PartitionTableModal({
  disk,
  connId,
  onClose,
  onSuccess,
}: PartitionTableModalProps) {
  const [labelType, setLabelType] = useState<'gpt' | 'msdos'>('gpt');
  const [confirmText, setConfirmText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSystem = !!disk.is_system;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSystem) {
      setError('Cannot wipe partition table on OS system disk.');
      return;
    }
    if (confirmText.trim().toUpperCase() !== 'WIPE') {
      setError('Please type WIPE to confirm you want to erase this drive.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const devPath = disk.path || `/dev/${disk.name}`;
      const res = await diskCreateLabel(connId, devPath, labelType);
      onSuccess(res || `Successfully created ${labelType.toUpperCase()} partition table on ${devPath}`);
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
              {isSystem ? <Shield className="w-5 h-5 text-rose-400" /> : <Disc className="w-5 h-5 text-amber-400" />}
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Initialize Partition Table</h3>
              <p className="text-xs text-gray-400 font-mono">
                {disk.path || `/dev/${disk.name}`} ({disk.size})
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
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-rose-500/15 border border-rose-500/40 rounded-2xl space-y-2">
              <div className="flex items-center space-x-2 text-rose-300 font-bold">
                <Lock className="w-4 h-4 text-rose-400 shrink-0" />
                <span>OS SYSTEM DISK PROTECTED</span>
              </div>
              <p className="text-rose-200/90 leading-relaxed">
                This physical disk contains the operating system root (/) or bootloader partitions.
              </p>
              <p className="text-rose-200/80">
                Initializing the partition table will immediately wipe all partitions and render the server completely unbootable. This action is blocked by CloudDesk system protections.
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
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* Warning */}
            <div className="p-3 bg-rose-500/15 border border-rose-500/30 rounded-2xl text-rose-200 flex items-start space-x-2.5">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-rose-300">Severe Warning:</span>
                <p className="mt-0.5 text-[11px] text-rose-200/80">
                  Creating a new partition table will <strong className="text-white">ERASE ALL EXISTING PARTITIONS</strong> and wipe data on <strong className="font-mono text-white">{disk.path || disk.name}</strong>.
                </p>
              </div>
            </div>

            {/* Radio Selection */}
            <div className="space-y-2">
              <label className="font-medium text-gray-300">Partition Table Scheme</label>
              <div className="space-y-2">
                <label className={`flex items-start space-x-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                  labelType === 'gpt' ? 'bg-blue-600/15 border-blue-500/50' : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.05]'
                }`}>
                  <input
                    type="radio"
                    name="tableType"
                    checked={labelType === 'gpt'}
                    onChange={() => setLabelType('gpt')}
                    className="w-4 h-4 mt-0.5 text-blue-600 cursor-pointer"
                  />
                  <div>
                    <div className="text-white font-bold flex items-center space-x-1.5">
                      <span>GPT (GUID Partition Table)</span>
                      <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 text-[10px]">Recommended</span>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Modern standard. Supports disks larger than 2TB, UEFI boot, and unlimited partitions.
                    </p>
                  </div>
                </label>

                <label className={`flex items-start space-x-3 p-3 rounded-2xl border cursor-pointer transition-all ${
                  labelType === 'msdos' ? 'bg-blue-600/15 border-blue-500/50' : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.05]'
                }`}>
                  <input
                    type="radio"
                    name="tableType"
                    checked={labelType === 'msdos'}
                    onChange={() => setLabelType('msdos')}
                    className="w-4 h-4 mt-0.5 text-blue-600 cursor-pointer"
                  />
                  <div>
                    <div className="text-white font-bold">MBR (Master Boot Record / MS-DOS)</div>
                    <p className="text-[11px] text-gray-400 mt-0.5">
                      Legacy standard. Limited to 2TB disk size and up to 4 primary partitions.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Type WIPE confirmation */}
            <div className="space-y-1.5 pt-2 border-t border-white/10">
              <label className="text-gray-300">
                To confirm drive initialization, please type <strong className="text-rose-400 font-mono">WIPE</strong> below:
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type WIPE to confirm"
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-rose-500/40 focus:border-rose-500 focus:outline-none text-white font-mono uppercase placeholder-gray-600"
              />
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
                disabled={confirmText.trim().toUpperCase() !== 'WIPE' || loading}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
              >
                {loading ? 'Initializing...' : `Initialize as ${labelType.toUpperCase()}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
