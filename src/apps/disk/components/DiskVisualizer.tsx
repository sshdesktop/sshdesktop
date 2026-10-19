import React from 'react';
import { HardDrive, Shield, Lock, Plus, Database, Sparkles } from 'lucide-react';
import { BlockDeviceInfo } from '../../../lib/tauri-bridge';

interface DiskVisualizerProps {
  disk: BlockDeviceInfo;
  selectedPartition: BlockDeviceInfo | null;
  onSelectPartition: (part: BlockDeviceInfo) => void;
  onCreatePartitionClick: () => void;
  onContextMenu: (e: React.MouseEvent, target: { type: 'disk' | 'partition'; item: BlockDeviceInfo }) => void;
}

export function getFsColor(fstype?: string): { gradient: string; text: string; border: string; bg: string } {
  const fs = (fstype || '').toLowerCase();
  if (fs.includes('ext')) {
    return { gradient: 'from-emerald-600 to-teal-700', text: 'text-emerald-300', border: 'border-emerald-500/40', bg: 'bg-emerald-500/20' };
  }
  if (fs === 'xfs') {
    return { gradient: 'from-blue-600 to-cyan-700', text: 'text-blue-300', border: 'border-blue-500/40', bg: 'bg-blue-500/20' };
  }
  if (fs === 'btrfs') {
    return { gradient: 'from-teal-600 to-emerald-800', text: 'text-teal-300', border: 'border-teal-500/40', bg: 'bg-teal-500/20' };
  }
  if (fs.includes('fat') || fs === 'vfat' || fs === 'efi') {
    return { gradient: 'from-purple-600 to-indigo-700', text: 'text-purple-300', border: 'border-purple-500/40', bg: 'bg-purple-500/20' };
  }
  if (fs === 'ntfs') {
    return { gradient: 'from-indigo-600 to-blue-800', text: 'text-indigo-300', border: 'border-indigo-500/40', bg: 'bg-indigo-500/20' };
  }
  if (fs === 'swap') {
    return { gradient: 'from-amber-600 to-orange-700', text: 'text-amber-300', border: 'border-amber-500/40', bg: 'bg-amber-500/20' };
  }
  return { gradient: 'from-slate-600 to-gray-700', text: 'text-gray-300', border: 'border-gray-500/40', bg: 'bg-gray-500/20' };
}

export default function DiskVisualizer({
  disk,
  selectedPartition,
  onSelectPartition,
  onCreatePartitionClick,
  onContextMenu,
}: DiskVisualizerProps) {
  const partitions = disk.children && disk.children.length > 0 ? disk.children : [];

  // Calculate proportional widths
  const totalDiskBytes = disk.size_bytes || 1;
  const hasBytes = partitions.some(p => (p.size_bytes || 0) > 0);

  // Compute width percentages
  const partitionItems = partitions.map((part) => {
    let pct = 100 / Math.max(1, partitions.length);
    if (hasBytes && (part.size_bytes || 0) > 0) {
      pct = Math.max(6, Math.min(100, ((part.size_bytes || 0) / totalDiskBytes) * 100));
    }
    return { part, pct };
  });

  return (
    <div className="bg-[#181825]/90 border border-white/10 rounded-3xl p-5 shadow-xl space-y-4">
      {/* Header Info */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md border border-white/20">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-base font-bold text-white font-mono">{disk.path || `/dev/${disk.name}`}</span>
              <span className="px-2 py-0.5 rounded-full bg-white/10 text-gray-300 text-[10px] font-mono uppercase font-semibold">
                {disk.pttype ? `${disk.pttype.toUpperCase()} Table` : 'Partition Table'}
              </span>
              {disk.is_system && (
                <span className="px-2 py-0.5 rounded-full bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[10px] font-semibold flex items-center space-x-1">
                  <Shield className="w-3 h-3 text-rose-400" />
                  <span>OS System Disk</span>
                </span>
              )}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              {disk.model ? `${disk.model} • ` : ''}Capacity: <span className="text-white font-mono font-medium">{disk.size}</span> • {partitions.length} {partitions.length === 1 ? 'Partition' : 'Partitions'}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={onCreatePartitionClick}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md active:scale-95 transition-all"
            title="Create new partition on this disk"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Partition</span>
          </button>
        </div>
      </div>

      {/* Graphical Proportional Partition Map Bar */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-gray-400 flex justify-between">
          <span>Graphical Partition Layout</span>
          <span className="text-gray-500 text-[10px]">Right-click any partition or disk for options</span>
        </div>

        <div
          onContextMenu={(e) => {
            e.preventDefault();
            onContextMenu(e, { type: 'disk', item: disk });
          }}
          className="w-full h-16 bg-black/40 rounded-2xl border border-white/10 p-1 flex gap-1 overflow-hidden shadow-inner cursor-pointer"
        >
          {partitions.length === 0 ? (
            <div
              onClick={onCreatePartitionClick}
              className="flex-1 rounded-xl border border-dashed border-white/20 hover:border-blue-400/60 bg-white/[0.02] hover:bg-white/[0.05] flex items-center justify-center space-x-2 text-gray-400 hover:text-white transition-all text-xs"
            >
              <Plus className="w-4 h-4 text-blue-400" />
              <span>Unallocated Space ({disk.size}) — Click to Create Partition</span>
            </div>
          ) : (
            partitionItems.map(({ part, pct }) => {
              const isSelected = selectedPartition?.name === part.name;
              const fsTheme = getFsColor(part.fstype);

              return (
                <div
                  key={part.name}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPartition(part);
                  }}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onSelectPartition(part);
                    onContextMenu(e, { type: 'partition', item: part });
                  }}
                  style={{ flex: `${pct} 1 0%` }}
                  className={`h-full rounded-xl bg-gradient-to-br ${fsTheme.gradient} p-2 flex flex-col justify-between transition-all select-none relative overflow-hidden group cursor-pointer ${
                    isSelected ? 'ring-2 ring-white shadow-lg brightness-110' : 'hover:brightness-105 opacity-95'
                  }`}
                  title={`${part.name} (${part.fstype || 'Raw'}) • ${part.size}${part.mountpoint ? ` mounted on ${part.mountpoint}` : ''}`}
                >
                  {/* Top row in partition block */}
                  <div className="flex items-center justify-between text-white text-[11px] font-mono font-bold leading-tight truncate">
                    <span className="truncate">{part.name}</span>
                    <div className="flex items-center space-x-1 shrink-0 ml-1">
                      {part.is_system && (
                        <span title="System Protected" className="p-0.5 rounded bg-black/30 text-rose-300">
                          <Lock className="w-2.5 h-2.5" />
                        </span>
                      )}
                      {part.mountpoint && (
                        <span className="px-1 py-0.2 rounded bg-black/40 text-[9px] text-white/90 truncate max-w-[60px]" title={`Mounted: ${part.mountpoint}`}>
                          {part.mountpoint}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bottom row in partition block */}
                  <div className="flex items-center justify-between text-[10px] text-white/80 font-mono truncate">
                    <span className="truncate uppercase font-sans font-semibold">{part.fstype || 'RAW'}</span>
                    <span className="font-semibold shrink-0 ml-1">{part.size}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Legend & Summary Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-white/5 text-[11px]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-gray-400">ext4/ext3</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-gray-400">XFS</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-500" />
            <span className="text-gray-400">Btrfs</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
            <span className="text-gray-400">FAT/EFI</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
            <span className="text-gray-400">NTFS</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
            <span className="text-gray-400">Swap</span>
          </div>
        </div>

        <div className="text-gray-400 text-[10px] font-mono">
          {selectedPartition ? (
            <span className="text-blue-300">
              Selected: <strong className="text-white">{selectedPartition.name}</strong> ({selectedPartition.size}) {selectedPartition.mountpoint ? `→ ${selectedPartition.mountpoint}` : '(Unmounted)'}
            </span>
          ) : (
            <span>Click partition to select</span>
          )}
        </div>
      </div>
    </div>
  );
}
