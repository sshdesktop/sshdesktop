import React, { useState } from 'react';
import { X, FolderPlus, Layers, AlertCircle, HardDrive } from 'lucide-react';
import { BlockDeviceInfo, diskCreatePartition, diskFormatFilesystem } from '../../../lib/tauri-bridge';

interface CreatePartitionModalProps {
  disk: BlockDeviceInfo;
  connId: string;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export default function CreatePartitionModal({
  disk,
  connId,
  onClose,
  onSuccess,
}: CreatePartitionModalProps) {
  const [partType, setPartType] = useState('primary');
  const [start, setStart] = useState('Auto');
  const [end, setEnd] = useState('+10GiB');
  const [fstype, setFstype] = useState('ext4');
  const [label, setLabel] = useState('');
  const [autoFormat, setAutoFormat] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sizePresets = [
    { label: '+5 GB', value: '+5GiB' },
    { label: '+10 GB', value: '+10GiB' },
    { label: '+20 GB', value: '+20GiB' },
    { label: '+50 GB', value: '+50GiB' },
    { label: 'Entire Disk (100%)', value: '100%' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const devPath = disk.path || `/dev/${disk.name}`;
      const startArg = (!start || start.toLowerCase() === 'auto') ? '1MiB' : start.trim();
      const endArg = end.trim() || '100%';

      const res = await diskCreatePartition(
        connId,
        devPath,
        partType,
        startArg,
        endArg,
        autoFormat && fstype ? fstype : undefined,
        label.trim() || undefined
      );

      onSuccess(res || `Successfully created partition on ${devPath}`);
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
            <div className="w-10 h-10 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <FolderPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Create New Partition</h3>
              <p className="text-xs text-gray-400 font-mono">
                Target: {disk.path || `/dev/${disk.name}`} ({disk.size})
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

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Partition Type */}
          <div className="space-y-1.5">
            <label className="font-medium text-gray-300">Partition Type</label>
            <select
              value={partType}
              onChange={(e) => setPartType(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
            >
              <option value="primary">Primary Partition</option>
              <option value="logical">Logical Partition (MBR Extended)</option>
            </select>
          </div>

          {/* Size / Boundary */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <label className="font-medium text-gray-300">Partition Size / End Boundary</label>
              <span className="text-[11px] text-gray-400 font-mono">Start: {start}</span>
            </div>
            <input
              type="text"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              placeholder="e.g. 20GiB, +50GB, 100%"
              required
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono placeholder-gray-600"
            />
            {/* Quick chips */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {sizePresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setEnd(preset.value)}
                  className={`px-2 py-0.5 rounded-lg text-[10px] font-mono border transition-colors ${
                    end === preset.value
                      ? 'bg-blue-600 text-white border-blue-400/50'
                      : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/5'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Label / Name */}
          <div className="space-y-1.5">
            <label className="font-medium text-gray-300">Partition Name / Label (Optional)</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. DataVolume"
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono placeholder-gray-600"
            />
          </div>

          {/* Auto Format Checkbox */}
          <div className="pt-1 space-y-2 border-t border-white/10">
            <label className="flex items-center space-x-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={autoFormat}
                onChange={(e) => setAutoFormat(e.target.checked)}
                className="w-4 h-4 rounded bg-black/40 border-white/20 text-blue-600 focus:ring-0 cursor-pointer"
              />
              <span className="text-gray-300">Format filesystem automatically after creation</span>
            </label>

            {autoFormat && (
              <div className="space-y-1 pl-6">
                <select
                  value={fstype}
                  onChange={(e) => setFstype(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
                >
                  <option value="ext4">ext4 (Linux Default)</option>
                  <option value="xfs">xfs (High Performance)</option>
                  <option value="btrfs">btrfs (CoW & Snapshots)</option>
                  <option value="vfat">vfat / FAT32 (EFI / Windows)</option>
                  <option value="ntfs">ntfs</option>
                  <option value="swap">swap</option>
                </select>
              </div>
            )}
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
              disabled={loading}
              className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
            >
              {loading ? <span>Creating...</span> : <span>Create Partition</span>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
