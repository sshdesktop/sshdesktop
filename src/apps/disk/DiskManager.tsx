import React, { useState, useEffect } from 'react';
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

const SAMPLE_MOUNTS: MountPoint[] = [
  { fs: '/dev/nvme0n1p2', type: 'ext4', size: '240 GB', used: '42.8 GB', avail: '185.2 GB', percent: 19, mount: '/' },
  { fs: '/dev/nvme0n1p1', type: 'vfat', size: '512 MB', used: '6.1 MB', avail: '505.9 MB', percent: 2, mount: '/boot/efi' },
  { fs: '/dev/sdb1', type: 'ext4', size: '1.8 TB', used: '1.2 TB', avail: '512 GB', percent: 71, mount: '/data' },
  { fs: 'tmpfs', type: 'tmpfs', size: '1.6 GB', used: '1.2 MB', avail: '1.6 GB', percent: 1, mount: '/run' },
  { fs: 'overlay', type: 'overlay', size: '240 GB', used: '42.8 GB', avail: '185.2 GB', percent: 19, mount: '/var/lib/docker/overlay2' }
];

const SAMPLE_DEVICES: BlockDevice[] = [
  { name: 'nvme0n1', size: '256 GB', type: 'disk', fstype: '—', mount: '—' },
  { name: '├─ nvme0n1p1', size: '512 MB', type: 'part', fstype: 'vfat', mount: '/boot/efi' },
  { name: '└─ nvme0n1p2', size: '255.5 GB', type: 'part', fstype: 'ext4', mount: '/' },
  { name: 'sdb', size: '2.0 TB', type: 'disk', fstype: '—', mount: '—' },
  { name: '└─ sdb1', size: '2.0 TB', type: 'part', fstype: 'ext4', mount: '/data' }
];

export default function DiskManager() {
  const [mounts, setMounts] = useState<MountPoint[]>(SAMPLE_MOUNTS);
  const [devices, setDevices] = useState<BlockDevice[]>(SAMPLE_DEVICES);
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  useEffect(() => {
    async function loadData() {
      try {
        const u = await diskUsage(activeConnId);
        if (u && u.length > 0) {
          setMounts(u.map((item: any) => ({
            fs: item.filesystem || item.mount_point,
            type: 'ext4',
            size: `${(item.total / (1024*1024*1024)).toFixed(1)} GB`,
            used: `${(item.used / (1024*1024*1024)).toFixed(1)} GB`,
            avail: `${(item.available / (1024*1024*1024)).toFixed(1)} GB`,
            percent: Math.round(item.percent),
            mount: item.mount_point,
          })));
        }

        const d = await diskList(activeConnId);
        if (d && d.length > 0) {
          setDevices(d.map((dev: any) => ({
            name: dev.name,
            size: dev.size,
            type: dev.type_name || 'disk',
            fstype: dev.fstype || '—',
            mount: dev.mountpoint || '—',
          })));
        }
      } catch {}
    }
    loadData();
  }, [activeConnId]);

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Overview Cards */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Root Storage (/)</span>
            <HardDrive className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-xl font-bold mt-1">42.8 / 240 GB</div>
          <div className="w-full bg-white/10 h-1.5 rounded-full mt-2 overflow-hidden">
            <div className="bg-emerald-400 h-full rounded-full" style={{ width: '19%' }} />
          </div>
          <div className="text-[11px] text-gray-400 mt-1">185.2 GB available (19% used)</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Data Volume (/data)</span>
            <HardDrive className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold mt-1">1.2 / 1.8 TB</div>
          <div className="w-full bg-white/10 h-1.5 rounded-full mt-2 overflow-hidden">
            <div className="bg-amber-400 h-full rounded-full" style={{ width: '71%' }} />
          </div>
          <div className="text-[11px] text-gray-400 mt-1">512 GB available (71% used)</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="flex items-center justify-between text-gray-400 text-xs">
            <span>Disk I/O Activity</span>
            <Activity className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-xl font-bold mt-1">1.4 MB/s Read</div>
          <div className="text-[11px] text-gray-400 mt-1">Write: 4.8 MB/s · IOPS: 420</div>
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
              {mounts.map(m => (
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
                            m.percent > 85 ? 'bg-rose-500' : m.percent > 65 ? 'bg-amber-400' : 'bg-emerald-400'
                          }`}
                          style={{ width: `${m.percent}%` }}
                        />
                      </div>
                      <span className="text-[11px] font-mono text-gray-400 w-8">{m.percent}%</span>
                    </div>
                  </td>
                </tr>
              ))}
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
                <th className="py-2.5 px-3">Name</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Size</th>
                <th className="py-2.5 px-3">FSType</th>
                <th className="py-2.5 px-3">Mountpoint</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {devices.map((dev, i) => (
                <tr key={i} className="hover:bg-white/[0.02]">
                  <td className="py-2.5 px-3 text-white font-bold">{dev.name}</td>
                  <td className="py-2.5 px-3 text-gray-400 uppercase text-[10px]">{dev.type}</td>
                  <td className="py-2.5 px-3 text-gray-300">{dev.size}</td>
                  <td className="py-2.5 px-3 text-blue-400">{dev.fstype}</td>
                  <td className="py-2.5 px-3 text-emerald-400">{dev.mount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
