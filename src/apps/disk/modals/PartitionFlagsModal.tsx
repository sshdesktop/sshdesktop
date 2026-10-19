import React, { useState } from 'react';
import { X, Flag, Tag, AlertCircle, Check } from 'lucide-react';
import { BlockDeviceInfo, diskSetLabel, diskSetPartitionFlag } from '../../../lib/tauri-bridge';

interface PartitionFlagsModalProps {
  partition: BlockDeviceInfo;
  diskDev: string;
  connId: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export default function PartitionFlagsModal({
  partition,
  diskDev,
  connId,
  onClose,
  onSuccess,
}: PartitionFlagsModalProps) {
  const [label, setLabel] = useState(partition.label || '');
  const [flag, setFlag] = useState('boot');
  const [flagState, setFlagState] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const partNumMatch = partition.name.match(/(\d+)$/);
  const partNumber = partNumMatch ? parseInt(partNumMatch[1], 10) : 1;

  const handleSaveLabel = async () => {
    if (!partition.fstype) {
      setError('Cannot set filesystem label on raw partition without filesystem.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const partDev = partition.path || `/dev/${partition.name}`;
      const res = await diskSetLabel(connId, partDev, partition.fstype, label.trim());
      onSuccess(res || `Updated label to ${label}`);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFlag = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await diskSetPartitionFlag(connId, diskDev, partNumber, flag, flagState);
      onSuccess(res || `Updated flag ${flag} to ${flagState ? 'ON' : 'OFF'}`);
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
            <div className="w-10 h-10 rounded-2xl bg-yellow-500/20 border border-yellow-500/30 flex items-center justify-center text-yellow-400">
              <Flag className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Partition Label & Flags</h3>
              <p className="text-xs text-gray-400 font-mono">
                {partition.path || `/dev/${partition.name}`} (#{partNumber})
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

        <div className="space-y-5 text-xs">
          {/* Section 1: Label */}
          <div className="space-y-2 p-3 bg-white/[0.02] border border-white/5 rounded-2xl">
            <div className="flex items-center space-x-2 text-white font-semibold">
              <Tag className="w-3.5 h-3.5 text-teal-400" />
              <span>Filesystem Volume Label</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Volume Label"
                className="flex-1 px-3 py-1.5 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono placeholder-gray-600"
              />
              <button
                type="button"
                onClick={handleSaveLabel}
                disabled={loading}
                className="px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-medium transition-colors"
              >
                Save
              </button>
            </div>
          </div>

          {/* Section 2: Partition Flags */}
          <div className="space-y-2.5 p-3 bg-white/[0.02] border border-white/5 rounded-2xl">
            <div className="flex items-center space-x-2 text-white font-semibold">
              <Flag className="w-3.5 h-3.5 text-yellow-400" />
              <span>Partition Table Flag</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={flag}
                onChange={(e) => setFlag(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
              >
                <option value="boot">boot (Bootable / Active)</option>
                <option value="esp">esp (EFI System Partition)</option>
                <option value="lvm">lvm (LVM Physical Volume)</option>
                <option value="raid">raid (Software RAID)</option>
                <option value="swap">swap (Swap Partition)</option>
                <option value="hidden">hidden (Hide Partition)</option>
              </select>

              <select
                value={flagState ? 'on' : 'off'}
                onChange={(e) => setFlagState(e.target.value === 'on')}
                className="px-3 py-1.5 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
              >
                <option value="on">Enable (ON)</option>
                <option value="off">Disable (OFF)</option>
              </select>
            </div>

            <button
              type="button"
              onClick={handleApplyFlag}
              disabled={loading}
              className="w-full py-1.5 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl font-medium transition-colors"
            >
              Set Flag
            </button>
          </div>

          <div className="flex justify-end pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 font-medium transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
