import React, { useState } from 'react';
import { X, ArrowUpRight, Sliders, CheckCircle2, AlertCircle, HardDrive, Bookmark } from 'lucide-react';
import { BlockDeviceInfo, diskMount, diskRemount } from '../../../lib/tauri-bridge';

interface MountModalProps {
  partition: BlockDeviceInfo;
  connId: string;
  isRemount?: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export default function MountModal({
  partition,
  connId,
  isRemount = false,
  onClose,
  onSuccess,
}: MountModalProps) {
  const [mountPoint, setMountPoint] = useState(partition.mountpoint && partition.mountpoint !== '—' ? partition.mountpoint : `/mnt/${partition.name}`);
  const [fstype, setFstype] = useState(partition.fstype || 'auto');
  const [options, setOptions] = useState(isRemount ? 'rw' : 'defaults,noatime');
  const [persistFstab, setPersistFstab] = useState(!isRemount);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountPresets = [
    `/mnt/${partition.name}`,
    `/mnt/data`,
    `/mnt/storage`,
    `/media/${partition.name}`,
    `/srv/data`
  ];

  const optionPresets = [
    { label: 'Standard (defaults,noatime)', value: 'defaults,noatime' },
    { label: 'Read-Only (ro)', value: 'ro' },
    { label: 'Read-Write (rw)', value: 'rw' },
    { label: 'Secure (nosuid,nodev,noexec)', value: 'defaults,nosuid,nodev,noexec' },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mountPoint.trim()) {
      setError('Please specify a valid mount point directory.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const devPath = partition.path || `/dev/${partition.name}`;
      if (isRemount) {
        const res = await diskRemount(connId, mountPoint.trim(), options.trim());
        onSuccess(res || `Successfully remounted ${mountPoint}`);
      } else {
        const res = await diskMount(
          connId,
          devPath,
          mountPoint.trim(),
          fstype === 'auto' ? undefined : fstype,
          options.trim(),
          persistFstab
        );
        onSuccess(res || `Successfully mounted ${devPath} to ${mountPoint}`);
      }
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
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                {isRemount ? 'Remount Volume' : 'Mount Partition'}
              </h3>
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

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Mount Point Input */}
          <div className="space-y-1.5">
            <label className="font-medium text-gray-300">Mount Point Directory</label>
            <input
              type="text"
              value={mountPoint}
              onChange={(e) => setMountPoint(e.target.value)}
              placeholder="/mnt/storage"
              required
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono placeholder-gray-600"
            />
            {/* Quick Chips */}
            {!isRemount && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {mountPresets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setMountPoint(preset)}
                    className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-white font-mono border border-white/5 transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Filesystem Type */}
          {!isRemount && (
            <div className="space-y-1.5">
              <label className="font-medium text-gray-300">Filesystem Type</label>
              <select
                value={fstype}
                onChange={(e) => setFstype(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-[#12121a] border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
              >
                <option value="auto">auto (Detect automatically)</option>
                <option value="ext4">ext4</option>
                <option value="ext3">ext3</option>
                <option value="xfs">xfs</option>
                <option value="btrfs">btrfs</option>
                <option value="vfat">vfat / fat32</option>
                <option value="ntfs">ntfs</option>
              </select>
            </div>
          )}

          {/* Mount Options */}
          <div className="space-y-1.5">
            <label className="font-medium text-gray-300">Mount Options</label>
            <input
              type="text"
              value={options}
              onChange={(e) => setOptions(e.target.value)}
              placeholder="defaults,noatime"
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono"
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {optionPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => setOptions(preset.value)}
                  className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-gray-400 hover:text-white border border-white/5 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Persist in /etc/fstab checkbox */}
          {!isRemount && (
            <label className="flex items-center space-x-2.5 pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={persistFstab}
                onChange={(e) => setPersistFstab(e.target.checked)}
                className="w-4 h-4 rounded bg-black/40 border-white/20 text-blue-600 focus:ring-0 cursor-pointer"
              />
              <span className="text-gray-300">Add to <code className="font-mono text-blue-400">/etc/fstab</code> (mount automatically on server reboot)</span>
            </label>
          )}

          {/* Submit buttons */}
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
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
            >
              {loading ? (
                <span>Executing...</span>
              ) : (
                <span>{isRemount ? 'Apply Remount' : 'Mount Volume'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
