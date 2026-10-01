import React, { useState, useEffect, useCallback } from 'react';
import { HardDrive, Server, Layers, PieChart, Activity, Folder, RefreshCw } from 'lucide-react';
import { diskList, diskUsage } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface MountPoint {
  fs: string;
  type: string;
  size: string;
  used: string;
  avail: string;
  percent: number;
  mount: string;
}

interface BlockDevice {
  name: string;
  size: string;
  type: string;
  fstype: string;
  mount: string;
}

export default function DiskManager() {
  const [mounts, setMounts] = useState<MountPoint[]>([]);
  const [devices, setDevices] = useState<BlockDevice[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const u = await diskUsage(activeConnId);
      if (u && Array.isArray(u)) {
        setMounts(u.map((item: any) => ({
          fs: item.filesystem || item.mount_point,
          type: 'ext4',
          size: `${(item.total / (1024 * 1024 * 1024)).toFixed(1)} GB`,
          used: `${(item.used / (1024 * 1024 * 1024)).toFixed(1)} GB`,
          avail: `${(item.available / (1024 * 1024 * 1024)).toFixed(1)} GB`,
          percent: Math.round(item.percent),
          mount: item.mount_point,
        })));
      } else {
        setMounts([]);
      }

      const d = await diskList(activeConnId);
      if (d && Array.isArray(d)) {
        setDevices(d.map((dev: any) => ({
          name: dev.name,
          size: dev.size,
          type: dev.type_name || 'disk',
          fstype: dev.fstype || '—',
          mount: dev.mountpoint || '—',
        })));
      } else {
        setDevices([]);
      }
    } catch (err) {
      console.warn('Disk load failed:', err);
      setMounts([]);
      setDevices([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const rootMount = mounts.find(m => m.mount === '/') || mounts[0];

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Overview Cards */}
      <div className="grid grid-cols-2 gap-3 shrink-0">
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Primary Storage ({rootMount ? rootMount.mount : '/'})</span>
            <HardDrive className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold mt-1">
            {rootMount ? `${rootMount.used} / ${rootMount.size}` : isLoading ? 'Loading...' : '—'}
          </div>
          <div className="w-full bg-white/10 h-1.5 rounded-full mt-2 overflow-hidden">
            <div
              className="bg-emerald-400 h-full rounded-full transition-all"
              style={{ width: `${rootMount ? Math.min(rootMount.percent, 100) : 0}%` }}
            />
          </div>
          <div className="text-[11px] text-gray-400 mt-1">
            {rootMount ? `${rootMount.avail} available (${rootMount.percent}% used)` : 'Live Linux Host Storage'}
          </div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Block Storage Devices</span>
            <Layers className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-xl font-bold mt-1">{isLoading ? '...' : devices.length} detected</div>
          <div className="text-[11px] text-gray-400 mt-2 flex items-center justify-between">
            <span>Queried live via lsblk</span>
            <button
              onClick={loadData}
              disabled={isLoading}
              className="hover:text-white flex items-center space-x-1"
            >
              <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Filesystem Mounts Table */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Mounted Filesystems (df -h)</h3>
        <div className="bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
              <tr>
                <th className="py-2.5 px-3">Mount Point</th>
                <th className="py-2.5 px-3">Device</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Total Size</th>
                <th className="py-2.5 px-3">Used</th>
                <th className="py-2.5 px-3">Available</th>
                <th className="py-2.5 px-3 w-40">Utilization</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {mounts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-gray-500">
                    {isLoading ? 'Scanning mounted filesystems via df...' : 'No filesystems detected'}
                  </td>
                </tr>
              ) : (
                mounts.map(m => (
                  <tr key={m.mount} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3 font-mono font-bold text-white">{m.mount}</td>
                    <td className="py-2.5 px-3 font-mono text-gray-400 text-[11px]">{m.fs}</td>
                    <td className="py-2.5 px-3 text-gray-400">{m.type}</td>
                    <td className="py-2.5 px-3 font-mono">{m.size}</td>
                    <td className="py-2.5 px-3 font-mono text-gray-300">{m.used}</td>
                    <td className="py-2.5 px-3 font-mono text-emerald-400">{m.avail}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center space-x-2">
                        <div className="flex-1 bg-white/10 h-1.5 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              m.percent > 85 ? 'bg-rose-400' : m.percent > 70 ? 'bg-amber-400' : 'bg-emerald-400'
                            }`}
                            style={{ width: `${Math.min(m.percent, 100)}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-mono text-gray-400 w-8 text-right">{m.percent}%</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Block Devices Tree (lsblk) */}
      <div className="space-y-2">
        <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Physical Disks & Partitions (lsblk)</h3>
        <div className="bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden">
          <table className="w-full text-left text-xs font-mono">
            <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
              <tr>
                <th className="py-2.5 px-3">Device Name</th>
                <th className="py-2.5 px-3">Size</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Filesystem</th>
                <th className="py-2.5 px-3">Mountpoint</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {devices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-gray-500 font-sans">
                    {isLoading ? 'Querying lsblk...' : 'No block devices detected'}
                  </td>
                </tr>
              ) : (
                devices.map(dev => (
                  <tr key={dev.name} className="hover:bg-white/[0.02]">
                    <td className="py-2.5 px-3 font-bold text-white flex items-center space-x-2">
                      <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span>{dev.name}</span>
                    </td>
                    <td className="py-2.5 px-3 text-gray-300">{dev.size}</td>
                    <td className="py-2.5 px-3 uppercase text-[10px] text-gray-400">{dev.type}</td>
                    <td className="py-2.5 px-3 text-purple-400">{dev.fstype}</td>
                    <td className="py-2.5 px-3 text-gray-400">{dev.mount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
