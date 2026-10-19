import React, { useEffect, useRef } from 'react';
import { 
  Folder, FileCode, Plus, Sliders, RefreshCw, Layers3, Check,
  LayoutGrid, Palette, Sun, Moon, Minimize2, Lock, Terminal,
  Copy, Scissors, ClipboardPaste, Trash2, Layers, Archive,
  Eye, Info, FileArchive, CheckSquare
} from 'lucide-react';
import { DesktopItem, DesktopContextMenuState, DesktopItemMenuState, ICON_CONFIGS } from './types';
import { useSettingsStore, useFileClipboardStore } from '../../lib/store';

interface DesktopContextMenuProps {
  desktopMenu: DesktopContextMenuState | null;
  desktopItemMenu: DesktopItemMenuState | null;
  onClose: () => void;
  onCreateFolder: () => void;
  onCreateFile: () => void;
  onPaste: (targetDir?: string) => void;
  onRenameItem: (item: DesktopItem) => void;
  onDuplicateItem: (item: DesktopItem) => void;
  onCompressItem: (item: DesktopItem, format?: 'tar.gz' | 'zip') => void;
  onExtractItem: (item: DesktopItem) => void;
  onDeleteItem: (item: DesktopItem) => void;
  onCleanUpDesktop: () => void;
  onResetGrid: () => void;
  useStacks: boolean;
  onToggleStacks: () => void;
  sortBy: 'name' | 'kind' | 'date';
  onSetSortBy: (sort: 'name' | 'kind' | 'date') => void;
  onOpenMissionControl: () => void;
  onOpenWidgetsTray: () => void;
  onOpenWallpaperModal: () => void;
  onMinimizeAllWindows: () => void;
  onLockScreen: () => void;
  onOpenTerminalHere: () => void;
  onResetItemPosition: (item: DesktopItem) => void;
}

export default function DesktopContextMenu({
  desktopMenu,
  desktopItemMenu,
  onClose,
  onCreateFolder,
  onCreateFile,
  onPaste,
  onRenameItem,
  onDuplicateItem,
  onCompressItem,
  onExtractItem,
  onDeleteItem,
  onCleanUpDesktop,
  onResetGrid,
  useStacks,
  onToggleStacks,
  sortBy,
  onSetSortBy,
  onOpenMissionControl,
  onOpenWidgetsTray,
  onOpenWallpaperModal,
  onMinimizeAllWindows,
  onLockScreen,
  onOpenTerminalHere,
  onResetItemPosition,
}: DesktopContextMenuProps) {
  const { theme, updateSettings, desktopIconSize, autoHideDock } = useSettingsStore();
  const { clipboard, setClipboard } = useFileClipboardStore();
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close context menu on outside click or escape
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const isLight = theme === 'light';

  // Check if item is an archive
  const isArchive = (label: string) => {
    const lower = label.toLowerCase();
    return lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz') || lower.endsWith('.tar.bz2');
  };

  const handleCopy = (item: DesktopItem) => {
    if (!item.path) return;
    setClipboard({
      items: [{ name: item.label, path: item.path, is_dir: item.kind === 'folder' }],
      isCut: false,
      sourceDir: item.path.substring(0, item.path.lastIndexOf('/')) || '/',
    });
    onClose();
  };

  const handleCut = (item: DesktopItem) => {
    if (!item.path) return;
    setClipboard({
      items: [{ name: item.label, path: item.path, is_dir: item.kind === 'folder' }],
      isCut: true,
      sourceDir: item.path.substring(0, item.path.lastIndexOf('/')) || '/',
    });
    onClose();
  };

  // 1. Desktop Canvas Context Menu
  if (desktopMenu) {
    const menuWidth = 260;
    const menuHeight = 520;
    const clampedX = Math.max(12, Math.min(desktopMenu.x, window.innerWidth - menuWidth - 12));
    const clampedY = Math.max(36, Math.min(desktopMenu.y, window.innerHeight - menuHeight - 16));

    return (
      <div
        ref={menuRef}
        className={`desktop-context-menu fixed z-[999999] backdrop-blur-2xl border rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.7)] py-1.5 w-64 text-xs select-none animate-in fade-in duration-100 ${
          isLight ? 'bg-white/95 border-black/15 text-slate-800' : 'bg-[#1e1e2e]/98 border-white/15 text-gray-200'
        }`}
        style={{ top: clampedY, left: clampedX }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* New Folder */}
        <div
          onClick={() => { onCreateFolder(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer font-medium"
        >
          <Folder className="w-4 h-4 text-amber-400" />
          <span>New Folder</span>
        </div>

        {/* New Text File */}
        <div
          onClick={() => { onCreateFile(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
        >
          <FileCode className="w-4 h-4 text-blue-400" />
          <span>New File</span>
        </div>

        {/* Paste from Clipboard */}
        {clipboard && clipboard.items.length > 0 && (
          <div
            onClick={() => { onPaste(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer font-medium text-emerald-400"
          >
            <ClipboardPaste className="w-4 h-4" />
            <span>Paste</span>
          </div>
        )}

        <div className={`my-1.5 border-t mx-2 ${isLight ? 'border-slate-200' : 'border-white/10'}`} />

        {/* Icon Sizing Controls */}
        <div className={`px-3.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
          Desktop Icon Size
        </div>
        <div className={`flex items-center space-x-1 px-3 py-1 mx-1 rounded-lg ${isLight ? 'bg-slate-100' : 'bg-white/[0.04]'}`}>
          {(['small', 'medium', 'large'] as const).map(size => (
            <button
              key={size}
              onClick={() => { updateSettings({ desktopIconSize: size }); onClose(); }}
              className={`flex-1 py-1 rounded text-[10px] font-medium capitalize transition-colors cursor-pointer ${
                desktopIconSize === size 
                  ? 'bg-blue-600 text-white font-bold' 
                  : isLight 
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200' 
                  : 'text-gray-300 hover:text-white hover:bg-white/10'
              }`}
            >
              {size}
            </button>
          ))}
        </div>

        {/* Auto-Hide Dock Toggle */}
        <div
          onClick={() => { updateSettings({ autoHideDock: !autoHideDock }); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer mt-1"
        >
          <div className="flex items-center space-x-2.5">
            <Minimize2 className="w-4 h-4 text-cyan-400" />
            <span>Auto-Hide Start Bar (Dock)</span>
          </div>
          {autoHideDock && <Check className="w-3.5 h-3.5 text-blue-400" />}
        </div>

        {/* Use Stacks */}
        <div
          onClick={() => { onToggleStacks(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center space-x-2.5">
            <Layers3 className="w-4 h-4 text-indigo-400" />
            <span>Use Stacks</span>
          </div>
          {useStacks && <Check className="w-3.5 h-3.5 text-blue-400" />}
        </div>

        {/* Sort By Submenu Items */}
        <div className={`px-3.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
          Sort Desktop By
        </div>
        <div className={`flex items-center space-x-1 px-3 py-1 mx-1 rounded-lg ${isLight ? 'bg-slate-100' : 'bg-white/[0.04]'}`}>
          {(['name', 'kind', 'date'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => { onSetSortBy(mode); onClose(); }}
              className={`flex-1 py-1 rounded text-[10px] font-medium capitalize transition-colors cursor-pointer ${
                sortBy === mode 
                  ? 'bg-blue-600 text-white font-bold' 
                  : isLight 
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-200' 
                  : 'text-gray-300 hover:text-white hover:bg-white/10'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Clean Up Desktop */}
        <div
          onClick={() => { onCleanUpDesktop(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer mt-0.5"
        >
          <RefreshCw className="w-4 h-4 text-cyan-400" />
          <span>Clean Up Desktop</span>
        </div>

        {/* Reset / Align Icons to Grid */}
        <div
          onClick={() => { onResetGrid(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer mt-0.5"
        >
          <Sliders className="w-4 h-4 text-blue-400" />
          <span>Reset / Align Icons to Grid</span>
        </div>

        <div className={`my-1.5 border-t mx-2 ${isLight ? 'border-slate-200' : 'border-white/10'}`} />

        {/* Mission Control / Exposé */}
        <div
          onClick={() => { onOpenMissionControl(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer font-medium"
        >
          <div className="flex items-center space-x-2.5">
            <LayoutGrid className="w-4 h-4 text-teal-400" />
            <span>Mission Control</span>
          </div>
          <span className="text-[10px] text-gray-400 font-mono">F3</span>
        </div>

        {/* Edit Widgets Drawer */}
        <div
          onClick={() => { onOpenWidgetsTray(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
        >
          <Sliders className="w-4 h-4 text-purple-400" />
          <span>Edit Desktop Widgets...</span>
        </div>

        {/* Change Wallpaper */}
        <div
          onClick={() => { onOpenWallpaperModal(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
        >
          <Palette className="w-4 h-4 text-purple-400" />
          <span>Change 4K Wallpaper...</span>
        </div>

        {/* Toggle Light / Dark Mode */}
        <div
          onClick={() => { 
            updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' });
            onClose();
          }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-blue-400" />}
          <span>Toggle {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
        </div>

        {/* Show Desktop */}
        <div
          onClick={() => { onMinimizeAllWindows(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
        >
          <Minimize2 className="w-4 h-4 text-gray-400" />
          <span>Show Desktop (Minimize All)</span>
        </div>

        <div className={`my-1.5 border-t mx-2 ${isLight ? 'border-slate-200' : 'border-white/10'}`} />

        {/* Lock Screen */}
        <div
          onClick={() => { onLockScreen(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer font-medium text-amber-400"
        >
          <div className="flex items-center space-x-2.5">
            <Lock className="w-4 h-4" />
            <span>Lock Screen</span>
          </div>
          <span className="text-[10px] text-gray-400 font-mono">⌃⌘Q / ⊞L</span>
        </div>

        {/* Open Terminal Here */}
        <div
          onClick={() => { onOpenTerminalHere(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
        >
          <Terminal className="w-4 h-4 text-emerald-400" />
          <span>Open Terminal on Desktop</span>
        </div>
      </div>
    );
  }

  // 2. Desktop Item (File / Folder) Context Menu
  if (desktopItemMenu) {
    const item = desktopItemMenu.item;
    const menuWidth = 250;
    const menuHeight = 360;
    // Strict boundary clamping so options NEVER get hidden or cut off outside viewport!
    const clampedX = Math.max(12, Math.min(desktopItemMenu.x, window.innerWidth - menuWidth - 12));
    const clampedY = Math.max(36, Math.min(desktopItemMenu.y, window.innerHeight - menuHeight - 16));
    const archiveFile = isArchive(item.label);

    return (
      <div
        ref={menuRef}
        className={`desktop-context-menu fixed z-[999999] backdrop-blur-2xl border rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.8)] py-1.5 w-60 text-xs select-none animate-in fade-in duration-100 ${
          isLight ? 'bg-white/95 border-black/15 text-slate-800' : 'bg-[#1e1e2e]/98 border-white/15 text-gray-200'
        }`}
        style={{ top: clampedY, left: clampedX }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Item Label Header */}
        <div className={`px-3.5 py-1 text-[10px] font-semibold uppercase tracking-wider truncate border-b mb-1 pb-1 ${
          isLight ? 'text-slate-500 border-slate-200' : 'text-gray-400 border-white/10'
        }`}>
          {item.label}
        </div>

        {/* Open */}
        <div
          onClick={() => { item.action(); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer font-medium"
        >
          {item.kind === 'folder' ? <Folder className="w-4 h-4 text-blue-400" /> : <FileCode className="w-4 h-4 text-blue-400" />}
          <span>Open</span>
        </div>

        {/* Copy */}
        <div
          onClick={() => handleCopy(item)}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center space-x-2.5">
            <Copy className="w-4 h-4 text-cyan-400" />
            <span>Copy</span>
          </div>
          <span className="text-[10px] text-gray-400 font-mono">⌘C</span>
        </div>

        {/* Cut */}
        <div
          onClick={() => handleCut(item)}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center space-x-2.5">
            <Scissors className="w-4 h-4 text-pink-400" />
            <span>Cut</span>
          </div>
          <span className="text-[10px] text-gray-400 font-mono">⌘X</span>
        </div>

        {/* Paste inside folder (if item is folder) */}
        {item.kind === 'folder' && clipboard && clipboard.items.length > 0 && (
          <div
            onClick={() => { onPaste(item.path); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer font-medium text-emerald-400"
          >
            <ClipboardPaste className="w-4 h-4" />
            <span>Paste into "{item.label}"</span>
          </div>
        )}

        <div className={`my-1 border-t mx-2 ${isLight ? 'border-slate-200' : 'border-white/10'}`} />

        {/* Rename */}
        <div
          onClick={() => { onRenameItem(item); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center space-x-2.5">
            <FileCode className="w-4 h-4 text-indigo-400" />
            <span>Rename / Alter</span>
          </div>
          <span className="text-[10px] text-gray-400 font-mono">F2</span>
        </div>

        {/* Duplicate */}
        <div
          onClick={() => { onDuplicateItem(item); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
        >
          <Layers className="w-4 h-4 text-purple-400" />
          <span>Duplicate</span>
        </div>

        {/* Compress */}
        <div
          onClick={() => { onCompressItem(item, 'zip'); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
        >
          <Archive className="w-4 h-4 text-amber-400" />
          <span>Compress (.zip)</span>
        </div>

        {/* Extract (if archive) */}
        {archiveFile && (
          <div
            onClick={() => { onExtractItem(item); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer font-medium text-amber-400"
          >
            <FileArchive className="w-4 h-4" />
            <span>Extract Archive Here</span>
          </div>
        )}

        <div className={`my-1 border-t mx-2 ${isLight ? 'border-slate-200' : 'border-white/10'}`} />

        {/* Reset Position */}
        <div
          onClick={() => { onResetItemPosition(item); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer text-gray-400"
        >
          <Sliders className="w-4 h-4" />
          <span>Reset Position</span>
        </div>

        {/* Delete with Confirmation Modal */}
        <div
          onClick={() => { onDeleteItem(item); onClose(); }}
          className="px-3.5 py-1.5 hover:bg-rose-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer text-rose-400"
        >
          <Trash2 className="w-4 h-4" />
          <span>Move to Trash / Delete</span>
        </div>
      </div>
    );
  }

  return null;
}
