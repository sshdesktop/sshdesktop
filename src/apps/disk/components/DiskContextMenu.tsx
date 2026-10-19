import React, { useEffect, useRef } from 'react';
import {
  FolderPlus, HardDrive, Wrench, Shield, Lock, Trash2, Sliders,
  CheckCircle2, RefreshCw, Copy, Tag, Flag, Terminal, ArrowUpRight,
  ArrowDownRight, Maximize2, Minimize2, ExternalLink, Layers, Disc
} from 'lucide-react';
import { BlockDeviceInfo } from '../../../lib/tauri-bridge';

export interface ContextMenuTarget {
  type: 'disk' | 'partition';
  item: BlockDeviceInfo;
}

interface DiskContextMenuProps {
  x: number;
  y: number;
  target: ContextMenuTarget;
  onClose: () => void;
  onMount: (part: BlockDeviceInfo) => void;
  onUnmount: (part: BlockDeviceInfo) => void;
  onRemount: (part: BlockDeviceInfo) => void;
  onCreatePartition: (disk: BlockDeviceInfo) => void;
  onDeletePartition: (part: BlockDeviceInfo) => void;
  onFormat: (part: BlockDeviceInfo) => void;
  onInitPartitionTable: (disk: BlockDeviceInfo) => void;
  onResize: (part: BlockDeviceInfo, mode?: 'increase' | 'decrease' | 'custom') => void;
  onSetLabel: (part: BlockDeviceInfo) => void;
  onSetFlags: (part: BlockDeviceInfo) => void;
  onCheckFs: (part: BlockDeviceInfo) => void;
  onSmartHealth: (device: BlockDeviceInfo) => void;
}

export default function DiskContextMenu({
  x,
  y,
  target,
  onClose,
  onMount,
  onUnmount,
  onRemount,
  onCreatePartition,
  onDeletePartition,
  onFormat,
  onInitPartitionTable,
  onResize,
  onSetLabel,
  onSetFlags,
  onCheckFs,
  onSmartHealth,
}: DiskContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust coordinates if menu overflows window edges
  const posX = Math.min(x, window.innerWidth - 240);
  const posY = Math.min(y, window.innerHeight - 380);

  const { type, item } = target;
  const isMounted = !!item.mountpoint && item.mountpoint !== '—';
  const isSystem = !!item.is_system;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    onClose();
  };

  return (
    <div
      ref={menuRef}
      style={{ left: posX, top: posY }}
      className="fixed z-50 w-56 bg-[#181825]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl py-1.5 text-xs text-gray-200 select-none animate-in fade-in zoom-in-95 duration-100"
    >
      {/* Target Title Badge */}
      <div className="px-3 py-1.5 border-b border-white/10 flex items-center justify-between font-mono text-[11px] text-gray-400">
        <div className="flex items-center space-x-1.5 truncate">
          {type === 'disk' ? <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" /> : <Layers className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
          <span className="font-bold text-white truncate">{item.name}</span>
        </div>
        <span className="text-[10px] uppercase bg-white/5 px-1.5 py-0.5 rounded font-sans text-gray-300">
          {type}
        </span>
      </div>

      <div className="py-1">
        {type === 'disk' ? (
          <>
            <button
              onClick={() => { onCreatePartition(item); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5 text-blue-400" />
              <span>Create Partition</span>
            </button>

            <button
              onClick={() => { onInitPartitionTable(item); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-amber-300"
            >
              <Disc className="w-3.5 h-3.5 text-amber-400" />
              <span>Initialize GPT / MBR Table</span>
            </button>

            <button
              onClick={() => { onSmartHealth(item); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors"
            >
              <Wrench className="w-3.5 h-3.5 text-emerald-400" />
              <span>S.M.A.R.T. Health Scan</span>
            </button>

            <div className="my-1 border-t border-white/10" />

            <button
              onClick={() => copyToClipboard(item.path || `/dev/${item.name}`)}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-400"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Device Path</span>
            </button>
          </>
        ) : (
          <>
            {/* Partition Actions */}
            {!isMounted ? (
              <button
                onClick={() => { onMount(item); onClose(); }}
                className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-emerald-300 font-medium"
              >
                <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                <span>Mount Partition...</span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => { onUnmount(item); onClose(); }}
                  className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-amber-300 text-left transition-colors"
                  title="Unmount this partition"
                >
                  <Sliders className="w-3.5 h-3.5 text-amber-400" />
                  <span>Unmount Partition</span>
                </button>

                <button
                  onClick={() => { onRemount(item); onClose(); }}
                  className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-blue-300"
                >
                  <Sliders className="w-3.5 h-3.5 text-blue-400" />
                  <span>Remount Options...</span>
                </button>
              </>
            )}

            <div className="my-1 border-t border-white/10" />

            {/* Format File System */}
            <button
              onClick={() => { onFormat(item); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 text-left transition-colors hover:bg-white/10 text-indigo-300"
              title="Format partition filesystem"
            >
              <Disc className="w-3.5 h-3.5 text-indigo-400" />
              <span>Format Filesystem...</span>
            </button>

            {/* Increase Partition */}
            <button
              onClick={() => { onResize(item, 'increase'); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 text-left transition-colors hover:bg-white/10 text-emerald-300 font-medium"
              title="Increase partition size"
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
              <span>Increase Size (Expand)...</span>
            </button>

            {/* Decrease Partition */}
            <button
              onClick={() => { onResize(item, 'decrease'); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 text-left transition-colors hover:bg-white/10 text-amber-300"
              title="Decrease partition size"
            >
              <ArrowDownRight className="w-3.5 h-3.5 text-amber-400" />
              <span>Decrease Size (Shrink)...</span>
            </button>

            {/* Custom Resize Partition */}
            <button
              onClick={() => { onResize(item, 'custom'); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 text-left transition-colors hover:bg-white/10 text-gray-200"
              title="Custom resize"
            >
              <Sliders className="w-3.5 h-3.5 text-gray-400" />
              <span>Custom Resize...</span>
            </button>

            {/* Set Label */}
            <button
              onClick={() => { onSetLabel(item); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-200"
            >
              <Tag className="w-3.5 h-3.5 text-teal-400" />
              <span>Change Label...</span>
            </button>

            {/* Set Flags */}
            <button
              onClick={() => { onSetFlags(item); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-200"
            >
              <Flag className="w-3.5 h-3.5 text-yellow-400" />
              <span>Set Partition Flags...</span>
            </button>

            {/* Check Filesystem / fsck */}
            <button
              onClick={() => { onCheckFs(item); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-emerald-300"
            >
              <Wrench className="w-3.5 h-3.5 text-emerald-400" />
              <span>Check & Repair (fsck)...</span>
            </button>

            <div className="my-1 border-t border-white/10" />

            {/* Copy commands */}
            <button
              onClick={() => copyToClipboard(item.path || `/dev/${item.name}`)}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-400"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Copy Device Path</span>
            </button>

            {item.uuid && (
              <button
                onClick={() => copyToClipboard(item.uuid || '')}
                className="w-full px-3 py-1.5 flex items-center space-x-2.5 hover:bg-white/10 text-left transition-colors text-gray-400"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy UUID</span>
              </button>
            )}

            <div className="my-1 border-t border-white/10" />

            {/* Delete Partition */}
            <button
              onClick={() => { onDeletePartition(item); onClose(); }}
              className="w-full px-3 py-1.5 flex items-center space-x-2.5 text-left transition-colors hover:bg-rose-500/20 text-rose-400"
              title="Delete this partition"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Delete Partition</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
