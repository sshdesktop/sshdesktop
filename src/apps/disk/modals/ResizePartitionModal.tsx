import React, { useState } from 'react';
import { 
  X, Sliders, AlertCircle, HardDrive, ArrowUpRight, ArrowDownRight, 
  Maximize2, Minimize2, CheckCircle2, AlertTriangle, ShieldCheck, Info
} from 'lucide-react';
import { BlockDeviceInfo, diskResizePartition } from '../../../lib/tauri-bridge';

interface ResizePartitionModalProps {
  partition: BlockDeviceInfo;
  diskDev: string;
  connId: string;
  initialMode?: 'increase' | 'decrease' | 'custom';
  onClose: () => void;
  onSuccess: (msg: string) => void;
}

export default function ResizePartitionModal({
  partition,
  diskDev,
  connId,
  initialMode = 'increase',
  onClose,
  onSuccess,
}: ResizePartitionModalProps) {
  const [mode, setMode] = useState<'increase' | 'decrease' | 'custom'>(initialMode);
  const [increaseAmount, setIncreaseAmount] = useState<number>(5); // in GB
  const [decreaseAmount, setDecreaseAmount] = useState<number>(2); // in GB
  const [customEnd, setCustomEnd] = useState<string>('100%');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Extract partition number from name (e.g. "sda2" -> 2, "nvme0n1p2" -> 2)
  const partNumMatch = partition.name.match(/(\d+)$/);
  const partNumber = partNumMatch ? parseInt(partNumMatch[1], 10) : 1;

  // Parse current partition size (rough estimate in GB for calculation)
  const parseCurrentSizeGB = (): number => {
    if (partition.size_bytes) {
      return partition.size_bytes / (1024 * 1024 * 1024);
    }
    const match = partition.size.match(/^([\d.]+)\s*([KMGTPE]?i?B?)/i);
    if (!match) return 10;
    const val = parseFloat(match[1]);
    const unit = (match[2] || '').toUpperCase();
    if (unit.startsWith('T')) return val * 1024;
    if (unit.startsWith('G')) return val;
    if (unit.startsWith('M')) return val / 1024;
    if (unit.startsWith('K')) return val / (1024 * 1024);
    return val;
  };

  const currentGB = parseCurrentSizeGB();
  const isXfs = (partition.fstype || '').toLowerCase() === 'xfs';

  // Target size calculations
  const targetIncreaseGB = Math.max(currentGB + 0.5, currentGB + increaseAmount);
  const targetDecreaseGB = Math.max(0.5, currentGB - decreaseAmount);

  const increasePresets = [
    { label: '+1 GB', value: 1 },
    { label: '+2 GB', value: 2 },
    { label: '+5 GB', value: 5 },
    { label: '+10 GB', value: 10 },
    { label: '+20 GB', value: 20 },
    { label: '+50 GB', value: 50 },
  ];

  const decreasePresets = [
    { label: '-500 MB', value: 0.5 },
    { label: '-1 GB', value: 1 },
    { label: '-2 GB', value: 2 },
    { label: '-5 GB', value: 5 },
    { label: '-10 GB', value: 10 },
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    let finalEndArg = '';
    if (mode === 'increase') {
      if (increaseAmount === 999999) {
        finalEndArg = '100%';
      } else {
        finalEndArg = `+${increaseAmount}GiB`;
      }
    } else if (mode === 'decrease') {
      if (isXfs) {
        setError('XFS filesystems cannot be shrunk (Linux kernel limitation). XFS partitions can only be increased/expanded.');
        setLoading(false);
        return;
      }
      finalEndArg = `${targetDecreaseGB.toFixed(1)}GiB`;
    } else {
      if (!customEnd.trim()) {
        setError('Please enter a target size or boundary (e.g. 50GiB, 100%).');
        setLoading(false);
        return;
      }
      finalEndArg = customEnd.trim();
    }

    try {
      const partDev = partition.path || `/dev/${partition.name}`;
      const res = await diskResizePartition(
        connId,
        diskDev,
        partNumber,
        finalEndArg,
        partDev,
        partition.fstype
      );
      onSuccess(res || `Successfully resized partition #${partNumber} on ${diskDev}`);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-150 select-none">
      <div className="bg-[#181825]/95 border border-white/20 rounded-3xl max-w-lg w-full shadow-2xl p-6 space-y-5 text-gray-200">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center border ${
              mode === 'increase'
                ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400'
                : mode === 'decrease'
                ? 'bg-amber-600/20 border-amber-500/40 text-amber-400'
                : 'bg-blue-600/20 border-blue-500/40 text-blue-400'
            }`}>
              {mode === 'increase' ? (
                <ArrowUpRight className="w-5 h-5" />
              ) : mode === 'decrease' ? (
                <ArrowDownRight className="w-5 h-5" />
              ) : (
                <Sliders className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">
                {mode === 'increase' ? 'Increase Partition Size (Expand)' : mode === 'decrease' ? 'Decrease Partition Size (Shrink)' : 'Resize Partition'}
              </h3>
              <p className="text-xs text-gray-400 font-mono">
                {partition.path || `/dev/${partition.name}`} · Current: <b className="text-white">{partition.size}</b>
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

        {/* Mode Selector Segmented Tabs */}
        <div className="flex p-1 bg-[#101018] border border-white/10 rounded-2xl text-xs font-medium">
          <button
            type="button"
            onClick={() => setMode('increase')}
            className={`flex-1 py-1.5 rounded-xl flex items-center justify-center space-x-1.5 transition-all ${
              mode === 'increase'
                ? 'bg-emerald-600 text-white shadow-md font-semibold'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Increase (+ Grow)</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('decrease')}
            className={`flex-1 py-1.5 rounded-xl flex items-center justify-center space-x-1.5 transition-all ${
              mode === 'decrease'
                ? 'bg-amber-600 text-white shadow-md font-semibold'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span>Decrease (- Shrink)</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('custom')}
            className={`flex-1 py-1.5 rounded-xl flex items-center justify-center space-x-1.5 transition-all ${
              mode === 'custom'
                ? 'bg-blue-600 text-white shadow-md font-semibold'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Custom</span>
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-xs text-rose-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span className="break-all">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Current vs Target Preview Card */}
          <div className="p-3 bg-[#12131e] border border-white/10 rounded-2xl flex items-center justify-between font-mono">
            <div>
              <span className="text-[10px] text-gray-500 uppercase block font-sans">Current Size</span>
              <span className="text-white font-bold text-sm">{partition.size}</span>
              <span className="text-[10px] text-gray-400 block font-sans">FS: {partition.fstype || 'raw'}</span>
            </div>
            <div className="text-gray-500 font-sans text-xs">➔</div>
            <div className="text-right">
              <span className="text-[10px] text-gray-500 uppercase block font-sans">Target Size Preview</span>
              <span className={`font-bold text-sm ${
                mode === 'increase' ? 'text-emerald-400' : mode === 'decrease' ? 'text-amber-400' : 'text-blue-400'
              }`}>
                {mode === 'increase'
                  ? increaseAmount === 999999 ? '100% (Entire Disk)' : `~${targetIncreaseGB.toFixed(1)} GB (+${increaseAmount} GB)`
                  : mode === 'decrease'
                  ? `~${targetDecreaseGB.toFixed(1)} GB (-${decreaseAmount} GB)`
                  : customEnd}
              </span>
              <span className="text-[10px] text-gray-400 block font-sans">
                {mode === 'increase' ? 'Expands filesystem automatically' : mode === 'decrease' ? 'Shrinks safely' : 'Sector boundary'}
              </span>
            </div>
          </div>

          {/* 1. INCREASE MODE */}
          {mode === 'increase' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="font-medium text-gray-300">Choose How Much to Increase (Expand)</label>
                <div className="grid grid-cols-3 gap-2">
                  {increasePresets.map(preset => (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setIncreaseAmount(preset.value)}
                      className={`py-2 px-3 rounded-xl border text-center font-mono font-bold transition-all ${
                        increaseAmount === preset.value
                          ? 'bg-emerald-600/25 border-emerald-500 text-emerald-300 shadow-sm'
                          : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Expand to 100% of Disk Button */}
              <button
                type="button"
                onClick={() => setIncreaseAmount(999999)}
                className={`w-full py-2 px-3 rounded-xl border text-center font-semibold transition-all ${
                  increaseAmount === 999999
                    ? 'bg-emerald-600 border-emerald-500 text-white shadow-md'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20'
                }`}
              >
                Expand to Full Available Capacity (100% Remaining Disk)
              </button>

              <div className="space-y-1">
                <label className="text-[11px] text-gray-400">Or Enter Specific Increase Amount (GB):</label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={increaseAmount === 999999 ? '' : increaseAmount}
                  placeholder="e.g. 15"
                  onChange={e => setIncreaseAmount(parseFloat(e.target.value) || 1)}
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-emerald-500 focus:outline-none text-white font-mono"
                />
              </div>

              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-start space-x-2 text-[11px] text-emerald-300 font-sans">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <b>Automatic Online Expansion:</b> CloudDesk will expand the partition table boundary and automatically run <code className="font-mono text-white">resize2fs</code> (for ext4) or <code className="font-mono text-white">xfs_growfs</code> (for XFS) on the fly.
                </span>
              </div>
            </div>
          )}

          {/* 2. DECREASE MODE */}
          {mode === 'decrease' && (
            <div className="space-y-3">
              {isXfs ? (
                <div className="p-3 bg-amber-500/15 border border-amber-500/30 rounded-2xl flex items-start space-x-2 text-xs text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <b className="block">XFS Shrink Not Supported by Linux</b>
                    The XFS filesystem does not support shrinking in the Linux kernel by architectural design. To reduce size on XFS, you would need to backup data, reformat, and restore. Only <b>Increase</b> is supported for XFS.
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="font-medium text-gray-300">Choose How Much to Decrease (Shrink)</label>
                    <div className="grid grid-cols-3 gap-2">
                      {decreasePresets.map(preset => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setDecreaseAmount(preset.value)}
                          className={`py-2 px-3 rounded-xl border text-center font-mono font-bold transition-all ${
                            decreaseAmount === preset.value
                              ? 'bg-amber-600/25 border-amber-500 text-amber-300 shadow-sm'
                              : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-gray-400">Or Enter Specific Decrease Amount (GB):</label>
                    <input
                      type="number"
                      min="0.5"
                      max={Math.max(1, currentGB - 1)}
                      step="0.5"
                      value={decreaseAmount}
                      onChange={e => setDecreaseAmount(parseFloat(e.target.value) || 0.5)}
                      className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-amber-500 focus:outline-none text-white font-mono"
                    />
                  </div>

                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start space-x-2 text-[11px] text-amber-300 font-sans">
                    <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <span>
                      <b>Safe Filesystem Shrink Order:</b> For ext4 filesystems, CloudDesk checks filesystem consistency with <code className="font-mono text-white">e2fsck</code> and resizes the filesystem before adjusting partition limits to guarantee zero data loss.
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 3. CUSTOM MODE */}
          {mode === 'custom' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="font-medium text-gray-300">Target Size / End Sector Boundary</label>
                <input
                  type="text"
                  value={customEnd}
                  onChange={e => setCustomEnd(e.target.value)}
                  placeholder="e.g. 50GiB, +20GB, 100%"
                  required
                  className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono placeholder-gray-600"
                />
                <p className="text-[11px] text-gray-400">
                  Enter an absolute boundary (e.g. <code className="font-mono text-blue-300">50GiB</code>), a relative delta (e.g. <code className="font-mono text-blue-300">+20GB</code>), or <code className="font-mono text-blue-300">100%</code>.
                </p>
              </div>
            </div>
          )}

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
              disabled={loading || (mode === 'decrease' && isXfs)}
              className={`px-5 py-2 rounded-xl font-semibold shadow-md active:scale-95 transition-all disabled:opacity-50 ${
                mode === 'increase'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : mode === 'decrease'
                  ? 'bg-amber-600 hover:bg-amber-500 text-white'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {loading ? 'Resizing...' : mode === 'increase' ? 'Increase Partition Size' : mode === 'decrease' ? 'Decrease Partition Size' : 'Apply Resize'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
