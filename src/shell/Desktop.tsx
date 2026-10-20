import React, { useState, useEffect, useCallback, useRef } from 'react';
import Taskbar from './Taskbar';
import Dock from './Dock';
import WindowManager from './WindowManager';
import AppLauncher from './AppLauncher';

// Modular desktop subcomponents
import { 
  WallpaperItem, WALLPAPERS, DesktopItem, DesktopContextMenuState, 
  DesktopItemMenuState, ICON_CONFIGS 
} from './desktop/types';
export { WALLPAPERS, type WallpaperItem } from './desktop/types';
import WallpaperModal from './desktop/WallpaperModal';
import DesktopWidgets from './desktop/DesktopWidgets';
import DesktopLockScreen from './desktop/DesktopLockScreen';
import DesktopContextMenu from './desktop/DesktopContextMenu';
import DesktopDeleteModal from './desktop/DesktopDeleteModal';
import DesktopIconGrid from './desktop/DesktopIconGrid';
import DesktopActionModal, { DesktopActionType } from './desktop/DesktopActionModal';

import { useWindowManager } from '../lib/hooks/useWindowManager';
import { 
  useSettingsStore, useConnectionStore, useWindowStore, 
  useEditorStore, useFileClipboardStore, useTelemetryStore 
} from '../lib/store';
import { 
  sftpMkdir, sftpWriteTextFile, sftpReadTextFile, sshExec, 
  sftpListDir, sftpRename, sftpDelete, systemGetDisks, systemGetStats 
} from '../lib/tauri-bridge';
import { Folder, FileCode, HardDrive } from 'lucide-react';
import { getNextAvailableCopyName } from '../apps/filemanager/types';

export default function Desktop() {
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);
  const username = activeServer?.username || 'root';
  const userHome = username === 'root' ? '/root' : `/home/${username}`;

  const { wallpaper, theme, updateSettings, desktopIconSize } = useSettingsStore();
  const { openApp } = useWindowManager();
  const { navigateFinder, openFileInEditor, openTerminalInDir } = useEditorStore();
  const { windows, focusWindow, restoreWindow, closeWindow, minimizeAllWindows, snapWindow, bringToFront } = useWindowStore();
  const { clipboard, setClipboard, clearClipboard } = useFileClipboardStore();
  const updateTelemetry = useTelemetryStore(s => s.updateTelemetry);

  // Modals & Overlays state
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [showWidgetsTray, setShowWidgetsTray] = useState(false);
  const [showStickiesWidget, setShowStickiesWidget] = useState(true);
  const [showAppLauncher, setShowAppLauncher] = useState(false);
  const [showMissionControl, setShowMissionControl] = useState(false);
  const [showAppSwitcher, setShowAppSwitcher] = useState(false);
  const [appSwitcherIndex, setAppSwitcherIndex] = useState(0);

  // Lock Screen State
  const [isLocked, setIsLocked] = useState(false);

  // Context Menu State
  const [desktopMenu, setDesktopMenu] = useState<DesktopContextMenuState | null>(null);
  const [desktopItemMenu, setDesktopItemMenu] = useState<DesktopItemMenuState | null>(null);

  // Delete Confirmation Modal State
  const [itemToDelete, setItemToDelete] = useState<DesktopItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Action Modal State (New Folder, New File, Rename)
  const [actionModal, setActionModal] = useState<{
    isOpen: boolean;
    type: DesktopActionType | null;
    initialValue?: string;
    item?: DesktopItem | null;
  }>({
    isOpen: false,
    type: null,
  });
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);

  // Stacks & Sorting
  const [useStacks, setUseStacks] = useState(false);
  const [expandedStack, setExpandedStack] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'kind' | 'date'>('name');

  // Multi-selection & Marquee Drag Box
  const [selectedDesktopIds, setSelectedDesktopIds] = useState<Set<string>>(new Set());
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  // Stickies State
  const [stickyNoteContent, setStickyNoteContent] = useState(() => {
    return localStorage.getItem('clouddesk_desktop_stickies') || '';
  });
  const [stickyColor, setStickyColor] = useState<'amber' | 'emerald' | 'purple' | 'rose' | 'blue'>('amber');

  // Dragging Desktop Icons
  const [draggingIcon, setDraggingIcon] = useState<{
    id: string;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    currentX: number;
    currentY: number;
  } | null>(null);

  // Icon Positions on Desktop (persisted locally and in ~/.clouddesk/icon_positions.json)
  const [iconPositions, setIconPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('clouddesk_desktop_icon_positions') || '{}');
    } catch {
      return {};
    }
  });

  // Remote Desktop Files & Folders strictly inside ~/Desktop
  const [desktopFolderItems, setDesktopFolderItems] = useState<Array<{
    name: string;
    is_dir: boolean;
    size: number;
    path: string;
  }>>([]);

  // Active Wallpaper Image URL
  const isCustomWallpaper = wallpaper?.startsWith('data:') || wallpaper?.startsWith('http') || wallpaper?.startsWith('blob:');
  const activeWallpaperItem = WALLPAPERS.find(w => w.id === wallpaper) || WALLPAPERS[0];
  const activeWallpaperUrl = isCustomWallpaper ? wallpaper : activeWallpaperItem.url;

  // Initialize server directories on login: ~/.clouddesk, ~/Desktop, ~/Downloads, ~/Documents
  useEffect(() => {
    if (!activeConnectionId) return;
    const initServerDirectories = async () => {
      try {
        const cmd = `mkdir -p "${userHome}/.clouddesk" "${userHome}/Desktop" "${userHome}/Downloads" "${userHome}/Documents" "${userHome}/.clouddesk/wallpapers"`;
        await sshExec(activeConnectionId, cmd).catch(() => {});

        // Hydrate settings if ~/.clouddesk/settings.json exists
        try {
          const configJson = await sftpReadTextFile(activeConnectionId, `${userHome}/.clouddesk/settings.json`);
          if (configJson) {
            const parsed = JSON.parse(configJson);
            if (parsed.wallpaper && !isCustomWallpaper && parsed.wallpaper !== wallpaper) {
              updateSettings({ wallpaper: parsed.wallpaper });
            }
            if (parsed.dock_position || parsed.dockPosition) {
              updateSettings({ dockPosition: parsed.dock_position || parsed.dockPosition });
            }
            if (parsed.auto_hide_dock !== undefined || parsed.autoHideDock !== undefined) {
              updateSettings({ autoHideDock: parsed.auto_hide_dock ?? parsed.autoHideDock });
            }
            if (parsed.terminal_font_size || parsed.terminalFontSize) {
              updateSettings({ terminalFontSize: parsed.terminal_font_size || parsed.terminalFontSize });
            }
            if (parsed.theme && parsed.theme !== theme) {
              updateSettings({ theme: parsed.theme });
            }
            if (parsed.desktop_icon_size || parsed.desktopIconSize) {
              updateSettings({ desktopIconSize: parsed.desktop_icon_size || parsed.desktopIconSize });
            }
            if (parsed.icon_positions && Object.keys(parsed.icon_positions).length > 0) {
              setIconPositions(prev => ({ ...parsed.icon_positions, ...prev }));
            }
            if (parsed.sticky_notes && !stickyNoteContent) {
              setStickyNoteContent(parsed.sticky_notes);
            }
          }
        } catch {}

        // Hydrate stickies from ~/.clouddesk/stickies.txt
        try {
          const stickiesTxt = await sftpReadTextFile(activeConnectionId, `${userHome}/.clouddesk/stickies.txt`);
          if (stickiesTxt && stickiesTxt.trim().length > 0) {
            setStickyNoteContent(stickiesTxt);
            localStorage.setItem('clouddesk_desktop_stickies', stickiesTxt);
          }
        } catch {}

        // Save active settings to server ~/.clouddesk/settings.json
        const currentPayload = {
          user: username,
          theme,
          wallpaper,
          dockPosition: useSettingsStore.getState().dockPosition,
          autoHideDock: useSettingsStore.getState().autoHideDock,
          terminalFontSize: useSettingsStore.getState().terminalFontSize,
          desktopIconSize: useSettingsStore.getState().desktopIconSize,
          showHiddenFiles: useSettingsStore.getState().showHiddenFiles,
          sticky_notes: stickyNoteContent,
          updated_at: new Date().toISOString(),
          client: 'CloudDesk Native macOS Shell'
        };
        await sftpWriteTextFile(activeConnectionId, `${userHome}/.clouddesk/settings.json`, JSON.stringify(currentPayload, null, 2)).catch(() => {});
      } catch (err) {
        console.warn('Server initialization notice:', err);
      }
    };
    initServerDirectories();
  }, [activeConnectionId, username]);

  // Load Remote Files strictly from ~/Desktop (Never list home root ~ so dotfiles & cache don't appear!)
  const loadDesktopFolder = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const desktopDir = `${userHome}/Desktop`;
      let entries = await sftpListDir(activeConnectionId, desktopDir).catch(async () => {
        // If Desktop doesn't exist yet, create it and retry
        await sftpMkdir(activeConnectionId, desktopDir).catch(() => {});
        return await sftpListDir(activeConnectionId, desktopDir).catch(() => []);
      });

      if (Array.isArray(entries)) {
        // Exclude hidden files / dotfiles (.*) like .cache, .bashrc from Desktop
        const validItems = entries
          .filter((e: any) => e.name && !e.name.startsWith('.'))
          .map((e: any) => ({
            name: e.name,
            is_dir: e.is_dir,
            size: e.size || 0,
            path: e.path || `${desktopDir}/${e.name}`,
          }));
        setDesktopFolderItems(validItems);

        // Remove deleted files from icon positions
        const validIds = new Set(validItems.map(i => `desktop-file-${i.path}`));
        setIconPositions(prev => {
          let changed = false;
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            if (k.startsWith('desktop-file-') && !validIds.has(k)) {
              delete next[k];
              changed = true;
            }
          }
          if (changed) {
            try {
              localStorage.setItem('clouddesk_desktop_icon_positions', JSON.stringify(next));
              sftpWriteTextFile(activeConnectionId, `${userHome}/.clouddesk/icon_positions.json`, JSON.stringify(next, null, 2)).catch(() => {});
            } catch {}
            return next;
          }
          return prev;
        });
      }
    } catch {
      setDesktopFolderItems([]);
    }
  }, [activeConnectionId, userHome]);

  useEffect(() => {
    loadDesktopFolder();
    const handleFilesChanged = () => {
      loadDesktopFolder();
    };
    window.addEventListener('clouddesk:files-changed', handleFilesChanged);
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        loadDesktopFolder();
      }
    }, 15000);
    return () => {
      window.removeEventListener('clouddesk:files-changed', handleFilesChanged);
      clearInterval(interval);
    };
  }, [loadDesktopFolder]);

  // Telemetry Polling (CPU, RAM, Disk in GB)
  useEffect(() => {
    if (!activeConnectionId) return;
    let isMounted = true;
    const fetchTelemetry = async () => {
      try {
        const stats = await systemGetStats(activeConnectionId).catch(() => null);
        const disks = await systemGetDisks(activeConnectionId).catch(() => null);
        if (!isMounted) return;

        let rootDiskUsed = '—';
        let rootDiskTotal = '—';
        let rootDiskPct = 0;

        if (Array.isArray(disks) && disks.length > 0) {
          const rootDisk = disks.find((d: any) => d.mount_point === '/' || d.mountpoint === '/') || disks[0];
          if (rootDisk) {
            rootDiskPct = typeof rootDisk.percent === 'number' ? rootDisk.percent : parseInt(rootDisk.percent) || 0;
            rootDiskUsed = rootDisk.used || '0 GB';
            rootDiskTotal = rootDisk.total || '0 GB';
          }
        }

        if (stats) {
          const cpuAvg = Array.isArray(stats.cpu_percent) && stats.cpu_percent.length > 0
            ? Math.round(stats.cpu_percent.reduce((a: number, b: number) => a + b, 0) / stats.cpu_percent.length)
            : 0;
          const ramUsedMb = Math.round(stats.ram_used / (1024 * 1024));
          const ramTotalMb = Math.round(stats.ram_total / (1024 * 1024));
          const ramPct = ramTotalMb > 0 ? Math.round((ramUsedMb / ramTotalMb) * 100) : 0;

          updateTelemetry({
            cpu: cpuAvg,
            ramPct,
            ramUsed: `${(ramUsedMb / 1024).toFixed(1)} GB`,
            ramTotal: `${(ramTotalMb / 1024).toFixed(1)} GB`,
            diskPct: rootDiskPct,
            diskUsed: rootDiskUsed,
            diskTotal: rootDiskTotal,
            loadAvg: Array.isArray(stats.load_avg) ? stats.load_avg.map((l: number) => l.toFixed(2)).join(', ') : '0.00',
            uptime: `${Math.floor(stats.uptime_seconds / 86400)}d ${Math.floor((stats.uptime_seconds % 86400) / 3600)}h`,
            kernel: stats.kernel || 'Linux',
          });
        }
      } catch {}
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 8000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeConnectionId, updateTelemetry]);

  // Update position of icon and persist
  const updateIconPosition = useCallback((id: string, x: number, y: number) => {
    setIconPositions(prev => {
      const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];
      const clampedX = Math.max(16, Math.min(window.innerWidth - cfg.w - 16, x));
      const clampedY = Math.max(40, Math.min(window.innerHeight - cfg.h - 110, y));
      const next = { ...prev, [id]: { x: clampedX, y: clampedY } };
      try {
        localStorage.setItem('clouddesk_desktop_icon_positions', JSON.stringify(next));
        if (activeConnectionId) {
          sftpWriteTextFile(activeConnectionId, `${userHome}/.clouddesk/icon_positions.json`, JSON.stringify(next, null, 2)).catch(() => {});
        }
      } catch {}
      return next;
    });
  }, [activeConnectionId, userHome, desktopIconSize]);

  // Freeform pointer drag for desktop icons
  useEffect(() => {
    if (!draggingIcon) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - draggingIcon.startX;
      const deltaY = e.clientY - draggingIcon.startY;
      const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];
      const newX = Math.max(16, Math.min(window.innerWidth - cfg.w - 16, draggingIcon.origX + deltaX));
      const newY = Math.max(40, Math.min(window.innerHeight - cfg.h - 110, draggingIcon.origY + deltaY));
      setDraggingIcon(prev => prev ? { ...prev, currentX: newX, currentY: newY } : null);
    };

    const handleMouseUp = () => {
      if (draggingIcon) {
        let finalX = draggingIcon.currentX;
        let finalY = draggingIcon.currentY;
        const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];

        // Prevent collision
        for (const [otherId, otherPos] of Object.entries(iconPositions)) {
          if (otherId !== draggingIcon.id) {
            if (Math.hypot(finalX - otherPos.x, finalY - otherPos.y) < 35) {
              finalY += cfg.rowSpacing;
              if (finalY > window.innerHeight - 150) {
                finalY = 48;
                finalX += cfg.colSpacing;
              }
            }
          }
        }

        updateIconPosition(draggingIcon.id, finalX, finalY);
        setDraggingIcon(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingIcon, desktopIconSize, iconPositions, updateIconPosition]);

  // Convert remote desktop files to DesktopItem models
  const allDesktopItems: DesktopItem[] = desktopFolderItems.map(item => {
    const ext = item.name.split('.').pop()?.toLowerCase() || '';
    const isMedia = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'ogg', 'mp3', 'wav', 'pdf'].includes(ext);

    return {
      id: `desktop-file-${item.path}`,
      label: item.name,
      icon: item.is_dir ? Folder : FileCode,
      tileBg: item.is_dir ? 'from-amber-400 to-amber-600' : 'from-indigo-500 to-purple-600',
      kind: (item.is_dir ? 'folder' : 'file') as 'folder' | 'file',
      type: item.is_dir ? 'dir' : 'file',
      path: item.path,
      size: item.size,
      action: () => {
        if (item.is_dir) {
          navigateFinder(item.path);
          openApp('files', 'File Manager');
        } else if (isMedia) {
          navigateFinder(`${userHome}/Desktop`);
          openApp('files', 'File Manager');
        } else {
          openFileInEditor(item.path);
          openApp('editor', 'Code Editor');
        }
      }
    };
  }).sort((a, b) => {
    if (sortBy === 'name') return a.label.localeCompare(b.label);
    if (sortBy === 'kind') return a.kind.localeCompare(b.kind);
    return 0;
  });

  // Marquee Selection Box
  const handleDesktopMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (
      target.closest('.window-shell') || 
      target.closest('.dock-bar') || 
      target.closest('.taskbar-bar') || 
      target.closest('.desktop-widget') || 
      target.closest('.desktop-icon') ||
      target.closest('.desktop-context-menu') ||
      target.closest('button')
    ) {
      return;
    }
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      setSelectedDesktopIds(new Set());
    }
    setSelectionBox({
      startX: e.clientX,
      startY: e.clientY,
      currentX: e.clientX,
      currentY: e.clientY,
    });
    setIsSelecting(true);
    setDesktopMenu(null);
    setDesktopItemMenu(null);
  };

  const handleDesktopMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting || !selectionBox) return;
    const curX = e.clientX;
    const curY = e.clientY;
    setSelectionBox(prev => prev ? { ...prev, currentX: curX, currentY: curY } : null);

    const minX = Math.min(selectionBox.startX, curX);
    const maxX = Math.max(selectionBox.startX, curX);
    const minY = Math.min(selectionBox.startY, curY);
    const maxY = Math.max(selectionBox.startY, curY);

    const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];
    const maxRows = Math.max(2, Math.floor((window.innerHeight - 160) / cfg.rowSpacing));
    const newSelected = new Set(selectedDesktopIds);
    allDesktopItems.forEach((item, idx) => {
      const pos = iconPositions[item.id] || {
        x: 24 + Math.floor(idx / maxRows) * cfg.colSpacing,
        y: 48 + (idx % maxRows) * cfg.rowSpacing,
      };
      if (pos.x >= minX - 40 && pos.x <= maxX && pos.y >= minY - 40 && pos.y <= maxY) {
        newSelected.add(item.id);
      }
    });
    setSelectedDesktopIds(newSelected);
  };

  const handleDesktopMouseUp = () => {
    setIsSelecting(false);
    setSelectionBox(null);
  };

  // Open Action Modal (New Folder, New File, Rename)
  const handleOpenActionModal = (type: DesktopActionType, item?: DesktopItem) => {
    setActionModal({
      isOpen: true,
      type,
      initialValue: item ? item.label : type === 'folder' ? 'New Folder' : 'notes.txt',
      item: item || null,
    });
  };

  const handleConfirmActionModal = async (name: string) => {
    if (!activeConnectionId || !actionModal.type) return;
    setIsActionSubmitting(true);
    try {
      if (actionModal.type === 'folder') {
        const desktopPath = `${userHome}/Desktop/${name.trim()}`;
        await sftpMkdir(activeConnectionId, desktopPath);
      } else if (actionModal.type === 'file') {
        const desktopPath = `${userHome}/Desktop/${name.trim()}`;
        await sftpWriteTextFile(activeConnectionId, desktopPath, '');
        openFileInEditor(desktopPath);
        openApp('editor', 'Code Editor');
      } else if (actionModal.type === 'rename' && actionModal.item?.path) {
        const parentDir = actionModal.item.path.substring(0, actionModal.item.path.lastIndexOf('/'));
        const targetPath = `${parentDir}/${name.trim()}`;
        await sftpRename(activeConnectionId, actionModal.item.path, targetPath);
      }
      await loadDesktopFolder();
      window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
    } catch (err: any) {
      alert(`Operation failed: ${err?.message || err}`);
    } finally {
      setIsActionSubmitting(false);
      setActionModal({ isOpen: false, type: null });
    }
  };

  const handleDuplicateDesktopItem = async (item: DesktopItem) => {
    if (!item.path || !activeConnectionId) return;
    const parentDir = item.path.substring(0, item.path.lastIndexOf('/'));
    const existingNames = desktopFolderItems.map(i => i.name);
    const copyName = getNextAvailableCopyName(item.label, existingNames);
    const copyPath = `${parentDir}/${copyName}`;
    try {
      if (item.kind === 'folder') {
        await sshExec(activeConnectionId, `cp -r "${item.path}" "${copyPath}"`);
      } else {
        await sshExec(activeConnectionId, `cp "${item.path}" "${copyPath}"`);
      }
      await loadDesktopFolder();
      window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
    } catch (err: any) {
      alert(`Could not duplicate: ${err?.message || err}`);
    }
  };

  const handleCompressDesktopItem = async (item: DesktopItem, format: 'tar.gz' | 'zip' = 'zip') => {
    if (!item.path || !activeConnectionId) return;
    const parentDir = item.path.substring(0, item.path.lastIndexOf('/'));
    const archiveName = format === 'zip' ? `${item.label}.zip` : `${item.label}.tar.gz`;
    try {
      const cmd = format === 'zip'
        ? `cd "${parentDir}" && zip -r "${archiveName}" "${item.label}"`
        : `cd "${parentDir}" && tar -czvf "${archiveName}" "${item.label}"`;
      await sshExec(activeConnectionId, cmd);
      await loadDesktopFolder();
      window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
    } catch (err: any) {
      alert(`Could not compress: ${err?.message || err}`);
    }
  };

  const handleExtractDesktopItem = async (item: DesktopItem) => {
    if (!item.path || !activeConnectionId) return;
    const parentDir = item.path.substring(0, item.path.lastIndexOf('/'));
    try {
      const lower = item.label.toLowerCase();
      let cmd = '';
      if (lower.endsWith('.zip')) {
        cmd = `cd "${parentDir}" && unzip -o "${item.label}"`;
      } else {
        cmd = `cd "${parentDir}" && tar -xzvf "${item.label}"`;
      }
      await sshExec(activeConnectionId, cmd);
      await loadDesktopFolder();
      window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
    } catch (err: any) {
      alert(`Could not extract archive: ${err?.message || err}`);
    }
  };

  const handleConfirmDelete = async () => {
    if (!itemToDelete || !activeConnectionId) return;
    setIsDeleting(true);
    try {
      if (itemToDelete.path) {
        if (itemToDelete.kind === 'folder') {
          await sshExec(activeConnectionId, `rm -rf "${itemToDelete.path}"`);
        } else {
          await sftpDelete(activeConnectionId, itemToDelete.path);
        }
        setIconPositions(prev => {
          const next = { ...prev };
          delete next[itemToDelete.id];
          try {
            localStorage.setItem('clouddesk_desktop_icon_positions', JSON.stringify(next));
          } catch {}
          return next;
        });
        await loadDesktopFolder();
        window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
      }
    } catch (err: any) {
      alert(`Could not delete item: ${err?.message || err}`);
    } finally {
      setIsDeleting(false);
      setItemToDelete(null);
    }
  };

  // Unified Paste (from clipboard to Desktop or specific folder)
  const handlePasteItems = async (targetFolder?: string) => {
    if (!activeConnectionId || !clipboard || clipboard.items.length === 0) return;
    const dest = targetFolder || `${userHome}/Desktop`;
    const isDesktop = !targetFolder || targetFolder === `${userHome}/Desktop`;
    const currentNames = isDesktop ? desktopFolderItems.map(i => i.name) : [];
    try {
      for (const item of clipboard.items) {
        let targetName = item.name;
        if (!clipboard.isCut && (currentNames.includes(targetName) || item.path.startsWith(dest))) {
          targetName = getNextAvailableCopyName(targetName, currentNames);
          currentNames.push(targetName);
        }
        const destPath = `${dest}/${targetName}`;
        if (clipboard.isCut) {
          await sshExec(activeConnectionId, `mv "${item.path}" "${destPath}"`);
        } else {
          await sshExec(activeConnectionId, `cp -r "${item.path}" "${destPath}"`);
        }
      }
      if (clipboard.isCut) {
        clearClipboard();
      }
      await loadDesktopFolder();
      window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
    } catch (err: any) {
      alert(`Paste failed: ${err?.message || err}`);
    }
  };

  // Arrange / Align icons to clean grid
  const handleCleanUpDesktop = () => {
    const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];
    const maxRows = Math.max(2, Math.floor((window.innerHeight - 160) / cfg.rowSpacing));
    const newPositions: Record<string, { x: number; y: number }> = {};
    allDesktopItems.forEach((item, idx) => {
      newPositions[item.id] = {
        x: 24 + Math.floor(idx / maxRows) * cfg.colSpacing,
        y: 48 + (idx % maxRows) * cfg.rowSpacing,
      };
    });
    setIconPositions(newPositions);
    try {
      localStorage.setItem('clouddesk_desktop_icon_positions', JSON.stringify(newPositions));
      if (activeConnectionId) {
        sftpWriteTextFile(activeConnectionId, `${userHome}/.clouddesk/icon_positions.json`, JSON.stringify(newPositions, null, 2)).catch(() => {});
      }
    } catch {}
  };

  // Keyboard Shortcuts (Alt+Tab, Win+L, F2, Delete, Cmd+C, Cmd+V, etc.)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Lock Screen (Win+L / Ctrl+Alt+L / ⌃⌘Q)
      if (
        (e.ctrlKey && e.metaKey && e.key.toLowerCase() === 'q') ||
        (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'l') ||
        (e.metaKey && e.key.toLowerCase() === 'l')
      ) {
        e.preventDefault();
        setIsLocked(true);
        return;
      }

      // 2. App Switcher HUD (Alt+Tab / Win+Tab)
      if (
        (e.altKey && e.code === 'Tab') ||
        (e.metaKey && e.code === 'Tab')
      ) {
        e.preventDefault();
        const curWindows = windows.filter(w => !w.serverId || w.serverId === activeConnectionId);
        if (curWindows.length > 0) {
          setShowAppSwitcher(true);
          setAppSwitcherIndex(prev => (prev + 1) % curWindows.length);
        }
        return;
      }

      // 3. Delete Selected Desktop Items
      if (e.key === 'Delete' || (e.metaKey && e.key === 'Backspace')) {
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
        if (selectedDesktopIds.size === 1) {
          const selId = Array.from(selectedDesktopIds)[0];
          const target = allDesktopItems.find(i => i.id === selId);
          if (target) {
            setItemToDelete(target);
          }
        }
      }

      // 4. Paste on Desktop (⌘V / Ctrl+V)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;
        handlePasteItems();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' || e.key === 'Meta') {
        if (showAppSwitcher) {
          setShowAppSwitcher(false);
          const curWindows = windows.filter(w => !w.serverId || w.serverId === activeConnectionId);
          if (curWindows.length > 0) {
            const chosen = curWindows[appSwitcherIndex % curWindows.length];
            if (chosen) {
              restoreWindow(chosen.id);
              bringToFront(chosen.id);
              focusWindow(chosen.id);
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [windows, activeConnectionId, showAppSwitcher, appSwitcherIndex, selectedDesktopIds, allDesktopItems]);

  return (
    <div 
      className="relative w-screen h-screen overflow-hidden select-none"
      onContextMenu={(e) => {
        const target = e.target as HTMLElement;
        if (
          target.closest('.window-shell') || 
          target.closest('.dock-bar') || 
          target.closest('.taskbar-bar') || 
          target.closest('.desktop-icon') || 
          target.closest('.desktop-widget')
        ) {
          return;
        }
        e.preventDefault();
        setDesktopItemMenu(null);
        setDesktopMenu({ x: e.clientX, y: e.clientY });
      }}
      onMouseDown={handleDesktopMouseDown}
      onMouseMove={handleDesktopMouseMove}
      onMouseUp={handleDesktopMouseUp}
    >
      {/* 4K Wallpaper Layer */}
      <div 
        className="absolute inset-0 bg-cover bg-center transition-all duration-700 ease-out"
        style={{ backgroundImage: `url(${activeWallpaperUrl})` }}
      />
      <div className={`absolute inset-0 pointer-events-none transition-colors duration-500 ${
        theme === 'light' ? 'bg-white/10 backdrop-brightness-105' : 'bg-black/20'
      }`} />

      {/* Marquee Drag-Selection Rectangle */}
      {isSelecting && selectionBox && (
        <div 
          className="fixed pointer-events-none z-30 bg-blue-500/20 border border-blue-400 rounded-sm"
          style={{
            left: `${Math.min(selectionBox.startX, selectionBox.currentX)}px`,
            top: `${Math.min(selectionBox.startY, selectionBox.currentY)}px`,
            width: `${Math.abs(selectionBox.currentX - selectionBox.startX)}px`,
            height: `${Math.abs(selectionBox.currentY - selectionBox.startY)}px`,
          }}
        />
      )}

      {/* Top macOS Taskbar */}
      <Taskbar 
        onOpenWallpapers={() => setShowWallpaperModal(true)}
        onLockScreen={() => setIsLocked(true)}
        onToggleLauncher={() => setShowAppLauncher(!showAppLauncher)}
      />

      {/* Sonoma Desktop Widgets (Clock, Performance Monitor with human GB, Stickies) */}
      <DesktopWidgets
        showWidgetsTray={showWidgetsTray}
        onCloseWidgetsTray={() => setShowWidgetsTray(false)}
        showStickiesWidget={showStickiesWidget}
        setShowStickiesWidget={setShowStickiesWidget}
        stickyNoteContent={stickyNoteContent}
        onUpdateStickyNote={(content) => {
          setStickyNoteContent(content);
          localStorage.setItem('clouddesk_desktop_stickies', content);
          if (activeConnectionId) {
            sftpWriteTextFile(activeConnectionId, `${userHome}/.clouddesk/stickies.txt`, content).catch(() => {});
          }
        }}
        stickyColor={stickyColor}
        setStickyColor={setStickyColor}
      />

      {/* Desktop Icons Grid & Drag Layer */}
      <DesktopIconGrid
        items={allDesktopItems}
        iconPositions={iconPositions}
        onStartDragIcon={(id, e) => {
          const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];
          const maxRows = Math.max(2, Math.floor((window.innerHeight - 160) / cfg.rowSpacing));
          const idx = allDesktopItems.findIndex(i => i.id === id);
          const currentPos = iconPositions[id] || {
            x: 24 + Math.floor(idx / maxRows) * cfg.colSpacing,
            y: 48 + (idx % maxRows) * cfg.rowSpacing,
          };
          setDraggingIcon({
            id,
            startX: e.clientX,
            startY: e.clientY,
            origX: currentPos.x,
            origY: currentPos.y,
            currentX: currentPos.x,
            currentY: currentPos.y,
          });
        }}
        draggingIconId={draggingIcon?.id || null}
        draggingCurrentPos={draggingIcon ? { x: draggingIcon.currentX, y: draggingIcon.currentY } : null}
        selectedIds={selectedDesktopIds}
        onSelectIcon={(id, e) => {
          if (e.shiftKey || e.ctrlKey || e.metaKey) {
            setSelectedDesktopIds(prev => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            });
          } else {
            setSelectedDesktopIds(new Set([id]));
          }
        }}
        onOpenItemMenu={(e, item) => {
          setDesktopMenu(null);
          setSelectedDesktopIds(new Set([item.id]));
          setDesktopItemMenu({ x: e.clientX, y: e.clientY, item });
        }}
        useStacks={useStacks}
        expandedStack={expandedStack}
        onToggleStack={(st) => setExpandedStack(prev => prev === st ? null : st)}
      />

      {/* Window Manager (Active Applications) */}
      <WindowManager />

      {/* macOS Bottom Dock / Start Bar */}
      <Dock 
        onToggleLauncher={() => setShowAppLauncher(!showAppLauncher)} 
      />

      {/* Right-Click Context Menu (Desktop & File/Folder Items) */}
      <DesktopContextMenu
        desktopMenu={desktopMenu}
        desktopItemMenu={desktopItemMenu}
        onClose={() => { setDesktopMenu(null); setDesktopItemMenu(null); }}
        onCreateFolder={() => handleOpenActionModal('folder')}
        onCreateFile={() => handleOpenActionModal('file')}
        onPaste={handlePasteItems}
        onRenameItem={(item) => handleOpenActionModal('rename', item)}
        onDuplicateItem={handleDuplicateDesktopItem}
        onCompressItem={handleCompressDesktopItem}
        onExtractItem={handleExtractDesktopItem}
        onDeleteItem={(item) => setItemToDelete(item)}
        onCleanUpDesktop={handleCleanUpDesktop}
        onResetGrid={() => {
          setIconPositions({});
          localStorage.removeItem('clouddesk_desktop_icon_positions');
          if (activeConnectionId) {
            sftpWriteTextFile(activeConnectionId, `${userHome}/.clouddesk/icon_positions.json`, '{}').catch(() => {});
          }
        }}
        useStacks={useStacks}
        onToggleStacks={() => setUseStacks(!useStacks)}
        sortBy={sortBy}
        onSetSortBy={(s) => setSortBy(s)}
        onOpenMissionControl={() => setShowMissionControl(true)}
        onOpenWidgetsTray={() => setShowWidgetsTray(true)}
        onOpenWallpaperModal={() => setShowWallpaperModal(true)}
        onMinimizeAllWindows={() => minimizeAllWindows()}
        onLockScreen={() => setIsLocked(true)}
        onOpenTerminalHere={() => {
          openTerminalInDir(`${userHome}/Desktop`);
          openApp('terminal', 'Terminal');
        }}
        onResetItemPosition={(item) => updateIconPosition(item.id, 24, 48)}
      />

      {/* Desktop Action Modal (New Folder, New File, Rename) */}
      <DesktopActionModal
        isOpen={actionModal.isOpen}
        type={actionModal.type}
        initialValue={actionModal.initialValue}
        item={actionModal.item}
        onClose={() => setActionModal({ isOpen: false, type: null })}
        onConfirm={handleConfirmActionModal}
        isSubmitting={isActionSubmitting}
      />

      {/* Delete Confirmation Modal */}
      <DesktopDeleteModal
        item={itemToDelete}
        isOpen={!!itemToDelete}
        onClose={() => setItemToDelete(null)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
      />

      {/* 4K Wallpaper Modal */}
      <WallpaperModal
        isOpen={showWallpaperModal}
        onClose={() => setShowWallpaperModal(false)}
      />

      {/* macOS Lock Screen */}
      <DesktopLockScreen
        isLocked={isLocked}
        onUnlock={() => setIsLocked(false)}
        wallpaperUrl={activeWallpaperUrl}
      />

      {/* App Launcher / Launchpad */}
      {showAppLauncher && <AppLauncher onClose={() => setShowAppLauncher(false)} />}
    </div>
  );
}
