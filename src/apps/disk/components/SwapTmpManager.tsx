import React, { useState, useEffect, useCallback } from 'react';
import {
  Layers, HardDrive, RefreshCw, ArrowUpRight, ArrowDownRight,
  Sliders, Check, AlertCircle, Zap, Shield, Power, CheckCircle2,
  Database, Info, Save
} from 'lucide-react';
import {
  SwapInfo, TmpInfo, diskGetSwapInfo, diskManageSwap, diskGetTmpInfo, diskManageTmp
} from '../../../lib/tauri-bridge';

interface SwapTmpManagerProps {
  connId: string;
  onNotify: (msg: string, type?: 'success' | 'error') => void;
}

export default function SwapTmpManager({ connId, onNotify }: SwapTmpManagerProps) {
  const [swapInfo, setSwapInfo] = useState<SwapInfo | null>(null);
  const [tmpInfo, setTmpInfo] = useState<TmpInfo | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Swap Form States
  const [swapInputMB, setSwapInputMB] = useState<number>(4096);
  const [swapLoading, setSwapLoading] = useState<boolean>(false);
  const [swapError, setSwapError] = useState<string | null>(null);

  // Tmp Form States
  const [tmpInputSize, setTmpInputSize] = useState<string>('4G');
  const [tmpPersist, setTmpPersist] = useState<boolean>(true);
  const [tmpLoading, setTmpLoading] = useState<boolean>(false);
  const [tmpError, setTmpError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        diskGetSwapInfo(connId),
        diskGetTmpInfo(connId),
      ]);
      setSwapInfo(s);
      setTmpInfo(t);

      // Prepopulate input if current swap is active
      if (s && s.total_bytes > 0) {
        const mb = Math.round(s.total_bytes / (1024 * 1024));
        setSwapInputMB(mb);
      }
      if (t && t.size_formatted) {
        setTmpInputSize(t.size_formatted.replace(/\s+/g, ''));
      }
    } catch (err: any) {
      console.warn('Failed to load swap/tmp info:', err);
    } finally {
      setLoading(false);
    }
  }, [connId]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Handle Swap Size Adjustment
  const handleApplySwap = async (targetMB: number) => {
    setSwapLoading(true);
    setSwapError(null);
    try {
      const res = await diskManageSwap(connId, 'set_size', targetMB);
      onNotify(res || `Successfully configured swap to ${targetMB} MB`, 'success');
      await fetchStats();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setSwapError(msg);
      onNotify(`Swap error: ${msg}`, 'error');
    } finally {
      setSwapLoading(false);
    }
  };

  // Handle Swap Toggle On / Off
  const handleToggleSwap = async (enable: boolean) => {
    setSwapLoading(true);
    setSwapError(null);
    try {
      const res = await diskManageSwap(connId, enable ? 'enable' : 'disable');
      onNotify(res || (enable ? 'Swap enabled' : 'Swap disabled'), 'success');
      await fetchStats();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setSwapError(msg);
      onNotify(`Swap error: ${msg}`, 'error');
    } finally {
      setSwapLoading(false);
    }
  };

  // Handle /tmp Size Adjustment
  const handleApplyTmp = async (sizeArg: string) => {
    setTmpLoading(true);
    setTmpError(null);
    try {
      const res = await diskManageTmp(connId, sizeArg, tmpPersist);
      onNotify(res || `Successfully updated /tmp space to ${sizeArg}`, 'success');
      await fetchStats();
    } catch (err: any) {
      const msg = err?.message || String(err);
      setTmpError(msg);
      onNotify(`/tmp error: ${msg}`, 'error');
    } finally {
      setTmpLoading(false);
    }
  };

  // Swap Usage Percentage
  const swapPercent = swapInfo && swapInfo.total_bytes > 0
    ? Math.min(100, Math.round((swapInfo.used_bytes / swapInfo.total_bytes) * 100))
    : 0;

  const swapPresets = [
    { label: '1 GB', mb: 1024 },
    { label: '2 GB', mb: 2048 },
    { label: '4 GB', mb: 4096 },
    { label: '8 GB', mb: 8192 },
    { label: '16 GB', mb: 16384 },
    { label: '32 GB', mb: 32768 },
  ];

  const tmpPresets = [
    { label: '1 GB', size: '1G' },
    { label: '2 GB', size: '2G' },
    { label: '4 GB', size: '4G' },
    { label: '8 GB', size: '8G' },
    { label: '16 GB', size: '16G' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-white flex items-center space-x-2">
            <Zap className="w-5 h-5 text-amber-400" />
            <span>Swap & Temporary Storage (/tmp) Management</span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Increase or decrease virtual swap memory and high-performance RAM /tmp storage on demand.
          </p>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs font-medium border border-white/10 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          <span>Refresh Stats</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ======================================================== */}
        {/* 1. SWAP SPACE CARD                                       */}
        {/* ======================================================== */}
        <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-3xl p-6 shadow-xl flex flex-col justify-between space-y-5">
          <div>
            {/* Title & Status */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Swap Space (Virtual Memory)</h3>
                  <p className="text-[11px] text-gray-400 font-mono">
                    Target: {swapInfo?.active_file || '/swapfile'}
                  </p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold font-sans flex items-center space-x-1 border ${
                swapInfo?.is_enabled
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-500/20 border-rose-500/40 text-rose-300'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${swapInfo?.is_enabled ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                <span>{swapInfo?.is_enabled ? 'Active / Enabled' : 'Disabled'}</span>
              </span>
            </div>

            {swapError && (
              <div className="mt-3 p-3 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-xs text-rose-300 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="break-all">{swapError}</span>
              </div>
            )}

            {/* Current Stats Overview */}
            <div className="mt-4 grid grid-cols-3 gap-3 p-3.5 bg-[#12121a]/80 border border-white/5 rounded-2xl font-mono text-center">
              <div>
                <span className="text-[10px] text-gray-500 block uppercase font-sans">Total Swap</span>
                <span className="text-white font-bold text-sm">{swapInfo?.total_formatted || '0 B'}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block uppercase font-sans">Used</span>
                <span className="text-amber-400 font-bold text-sm">{swapInfo?.used_formatted || '0 B'}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block uppercase font-sans">Free Available</span>
                <span className="text-emerald-400 font-bold text-sm">{swapInfo?.free_formatted || '0 B'}</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-[11px] font-mono text-gray-400">
                <span>Usage</span>
                <span>{swapPercent}%</span>
              </div>
              <div className="w-full h-2.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    swapPercent > 85 ? 'bg-rose-500' : swapPercent > 60 ? 'bg-amber-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${swapPercent}%` }}
                />
              </div>
            </div>

            {/* Quick Increments / Decrements */}
            <div className="mt-5 space-y-2">
              <label className="font-semibold text-xs text-gray-300 block">
                Quick Size Presets (Allocate / Reconfigure)
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {swapPresets.map((preset) => (
                  <button
                    key={preset.mb}
                    type="button"
                    onClick={() => {
                      setSwapInputMB(preset.mb);
                      handleApplySwap(preset.mb);
                    }}
                    disabled={swapLoading}
                    className={`py-1.5 px-2 rounded-xl text-xs font-mono border transition-all text-center ${
                      swapInputMB === preset.mb
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold'
                        : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/5'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Interactive Increase / Decrease Controls */}
            <div className="mt-4 p-4 bg-[#141420] border border-white/10 rounded-2xl space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-300">
                <span className="font-medium">Direct Size Adjustment</span>
                <span className="font-mono text-gray-400">{(swapInputMB / 1024).toFixed(1)} GB ({swapInputMB} MB)</span>
              </div>

              <div className="flex items-center space-x-2">
                {/* Step down */}
                <button
                  type="button"
                  onClick={() => {
                    const next = Math.max(512, swapInputMB - 1024);
                    setSwapInputMB(next);
                  }}
                  disabled={swapLoading || swapInputMB <= 512}
                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 text-xs font-bold transition-all disabled:opacity-40"
                  title="Decrease by 1 GB"
                >
                  -1 GB
                </button>

                <input
                  type="number"
                  value={swapInputMB}
                  onChange={(e) => setSwapInputMB(parseInt(e.target.value, 10) || 0)}
                  min={0}
                  step={512}
                  className="flex-1 px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-amber-500 focus:outline-none text-white font-mono text-xs text-center"
                />

                {/* Step up */}
                <button
                  type="button"
                  onClick={() => {
                    const next = swapInputMB + 1024;
                    setSwapInputMB(next);
                  }}
                  disabled={swapLoading}
                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 text-xs font-bold transition-all"
                  title="Increase by 1 GB"
                >
                  +1 GB
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleToggleSwap(!swapInfo?.is_enabled)}
                  disabled={swapLoading}
                  className={`px-3 py-2 rounded-xl border text-xs font-semibold flex items-center space-x-1.5 transition-all ${
                    swapInfo?.is_enabled
                      ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30'
                      : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  }`}
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{swapInfo?.is_enabled ? 'Turn Swap Off' : 'Turn Swap On'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleApplySwap(swapInputMB)}
                  disabled={swapLoading || swapInputMB <= 0}
                  className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-semibold text-xs shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
                >
                  {swapLoading ? (
                    <span>Applying...</span>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Apply Swap Size</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-gray-500 flex items-start space-x-1.5 pt-2">
            <Info className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
            <span>
              Configures <code>/swapfile</code> with <code>fallocate/dd</code>, prepares it with <code>mkswap</code>, activates via <code>swapon</code>, and automatically saves to <code>/etc/fstab</code> for permanence.
            </span>
          </div>
        </div>

        {/* ======================================================== */}
        {/* 2. TMP STORAGE CARD                                      */}
        {/* ======================================================== */}
        <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-3xl p-6 shadow-xl flex flex-col justify-between space-y-5">
          <div>
            {/* Title & Status */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Temporary Storage (/tmp)</h3>
                  <p className="text-[11px] text-gray-400 font-mono">
                    FS: <span className="text-blue-300 font-bold uppercase">{tmpInfo?.filesystem || 'tmpfs'}</span> • Target: /tmp
                  </p>
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold font-sans flex items-center space-x-1 border ${
                tmpInfo?.is_tmpfs
                  ? 'bg-blue-500/20 border-blue-500/40 text-blue-300'
                  : 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
              }`}>
                <span>{tmpInfo?.is_tmpfs ? 'RAM tmpfs' : 'Root Storage'}</span>
              </span>
            </div>

            {tmpError && (
              <div className="mt-3 p-3 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-xs text-rose-300 flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="break-all">{tmpError}</span>
              </div>
            )}

            {/* Current Stats Overview */}
            <div className="mt-4 grid grid-cols-3 gap-3 p-3.5 bg-[#12121a]/80 border border-white/5 rounded-2xl font-mono text-center">
              <div>
                <span className="text-[10px] text-gray-500 block uppercase font-sans">Total Size</span>
                <span className="text-white font-bold text-sm">{tmpInfo?.size_formatted || '0 B'}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block uppercase font-sans">Used</span>
                <span className="text-blue-400 font-bold text-sm">{tmpInfo?.used_formatted || '0 B'}</span>
              </div>
              <div>
                <span className="text-[10px] text-gray-500 block uppercase font-sans">Available</span>
                <span className="text-emerald-400 font-bold text-sm">{tmpInfo?.avail_formatted || '0 B'}</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-[11px] font-mono text-gray-400">
                <span>Usage</span>
                <span>{Math.round(tmpInfo?.percent || 0)}%</span>
              </div>
              <div className="w-full h-2.5 bg-black/40 rounded-full overflow-hidden border border-white/5">
                <div
                  className={`h-full transition-all duration-300 rounded-full ${
                    (tmpInfo?.percent || 0) > 85 ? 'bg-rose-500' : (tmpInfo?.percent || 0) > 60 ? 'bg-amber-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.round(tmpInfo?.percent || 0))}%` }}
                />
              </div>
            </div>

            {/* Quick Size Presets */}
            <div className="mt-5 space-y-2">
              <label className="font-semibold text-xs text-gray-300 block">
                Quick Size Presets (Live Remount)
              </label>
              <div className="grid grid-cols-5 gap-1.5">
                {tmpPresets.map((preset) => (
                  <button
                    key={preset.size}
                    type="button"
                    onClick={() => {
                      setTmpInputSize(preset.size);
                      handleApplyTmp(preset.size);
                    }}
                    disabled={tmpLoading}
                    className={`py-1.5 px-2 rounded-xl text-xs font-mono border transition-all text-center ${
                      tmpInputSize === preset.size
                        ? 'bg-blue-600/25 border-blue-500/60 text-blue-300 font-bold'
                        : 'bg-white/5 hover:bg-white/10 text-gray-300 border-white/5'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Interactive Increase / Decrease Controls */}
            <div className="mt-4 p-4 bg-[#141420] border border-white/10 rounded-2xl space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-300">
                <span className="font-medium">Target /tmp Size</span>
                <span className="font-mono text-gray-400">e.g. 2G, 4G, 8G, 16G</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => {
                    const match = tmpInputSize.match(/^(\d+)/);
                    if (match) {
                      const cur = parseInt(match[1], 10);
                      const next = Math.max(1, cur - 1);
                      setTmpInputSize(`${next}G`);
                    }
                  }}
                  disabled={tmpLoading}
                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 text-xs font-bold transition-all"
                  title="Decrease by 1 GB"
                >
                  -1 GB
                </button>

                <input
                  type="text"
                  value={tmpInputSize}
                  onChange={(e) => setTmpInputSize(e.target.value)}
                  placeholder="e.g. 4G, 8192M"
                  className="flex-1 px-3 py-2 rounded-xl bg-black/40 border border-white/10 focus:border-blue-500 focus:outline-none text-white font-mono text-xs text-center uppercase"
                />

                <button
                  type="button"
                  onClick={() => {
                    const match = tmpInputSize.match(/^(\d+)/);
                    if (match) {
                      const cur = parseInt(match[1], 10);
                      const next = cur + 1;
                      setTmpInputSize(`${next}G`);
                    } else {
                      setTmpInputSize('4G');
                    }
                  }}
                  disabled={tmpLoading}
                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 text-xs font-bold transition-all"
                  title="Increase by 1 GB"
                >
                  +1 GB
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1">
                <label className="flex items-center space-x-2 cursor-pointer text-xs text-gray-300">
                  <input
                    type="checkbox"
                    checked={tmpPersist}
                    onChange={(e) => setTmpPersist(e.target.checked)}
                    className="w-4 h-4 rounded bg-black/40 border-white/20 text-blue-600 focus:ring-0 cursor-pointer"
                  />
                  <span>Persist in /etc/fstab</span>
                </label>

                <button
                  type="button"
                  onClick={() => handleApplyTmp(tmpInputSize)}
                  disabled={tmpLoading || !tmpInputSize.trim()}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
                >
                  {tmpLoading ? (
                    <span>Applying...</span>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Apply /tmp Size</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-gray-500 flex items-start space-x-1.5 pt-2">
            <Info className="w-3.5 h-3.5 shrink-0 text-blue-400 mt-0.5" />
            <span>
              Executes a live <code>mount -o remount,size=$SIZE /tmp</code> with full sticky bit (mode 1777). No server restart required.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
