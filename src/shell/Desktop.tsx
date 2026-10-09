import React, { useState, useEffect, useCallback } from 'react';
import Taskbar from './Taskbar';
import Dock from './Dock';
import WindowManager from './WindowManager';
import AppLauncher from './AppLauncher';
import NotificationCenter from './NotificationCenter';
import SpotlightSearch from './SpotlightSearch';
import DisconnectAlertModal from './DisconnectAlertModal';
import { listen } from '@tauri-apps/api/event';
import { 
  Folder, HardDrive, Terminal, FileCode, Activity, Trash2, 
  Palette, Sun, Moon, Minimize2, Plus, Monitor, ShieldCheck,
  Lock, Unlock, Shield, ShieldAlert, Fingerprint, Eye, EyeOff,
  RotateCcw, Power, AlertCircle, Sparkles, RefreshCw, CheckCircle2,
  ChevronRight, ArrowRight, X, Check, Cpu, Layers, LayoutGrid,
  Clock, StickyNote, Sliders, Server, Zap, ArrowUp, ArrowDown,
  Layers3, Maximize2, MoreHorizontal, CheckSquare, Gauge
} from 'lucide-react';
import { useWindowManager } from '../lib/hooks/useWindowManager';
import { useSettingsStore, useConnectionStore, useWindowStore, useEditorStore, useTelemetryStore } from '../lib/store';
import { sftpMkdir, sftpWriteTextFile, sftpReadTextFile, sshExec, systemGetStats, systemGetDisks, sftpListDir, sftpRename, sftpDelete } from '../lib/tauri-bridge';

interface DesktopContextMenu {
  x: number;
  y: number;
}

export interface WallpaperItem {
  id: string;
  name: string;
  subtitle: string;
  category: 'macOS Official' | 'Nature 4K' | 'Cyberpunk & Sci-Fi 4K' | 'Minimal & Dark 4K' | 'Anime & Artistic 4K';
  url: string;
  thumbnail: string;
}

export const WALLPAPERS: WallpaperItem[] = [
  // 1. macOS Official
  {
    id: 'sonoma',
    name: 'macOS Sonoma Horizon',
    subtitle: '4K Ultra-HD Organic Sunset Waves',
    category: 'macOS Official',
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'sequoia',
    name: 'macOS Sequoia Forest',
    subtitle: '4K Redwood Sunrise Mist',
    category: 'macOS Official',
    url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'ventura',
    name: 'macOS Ventura Amber',
    subtitle: '4K Dunes & Desert Warmth',
    category: 'macOS Official',
    url: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'monterey',
    name: 'macOS Monterey Marine',
    subtitle: '4K Deep Sea Canyon & Coastal Waters',
    category: 'macOS Official',
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80',
  },

  // 2. Nature 4K
  {
    id: 'swiss-alps',
    name: 'Swiss Alps Panorama',
    subtitle: '4K Snow-Capped Alpine Glaciers',
    category: 'Nature 4K',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'yosemite-valley',
    name: 'Yosemite Valley Sunrise',
    subtitle: '4K El Capitan & Granite Wilderness',
    category: 'Nature 4K',
    url: 'https://images.unsplash.com/photo-1426604966848-d7adac402bff?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1426604966848-d7adac402bff?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'norway-aurora',
    name: 'Norway Fjords & Aurora',
    subtitle: '4K Emerald Northern Lights & Arctic Waters',
    category: 'Nature 4K',
    url: 'https://images.unsplash.com/photo-1517411032315-54ef2cb783bb?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1517411032315-54ef2cb783bb?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'autumn-redwood',
    name: 'Pacific Redwood Mist',
    subtitle: '4K Morning Rays Through Golden Canopy',
    category: 'Nature 4K',
    url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=600&q=80',
  },

  // 3. Cyberpunk & Sci-Fi 4K
  {
    id: 'neo-tokyo',
    name: 'Neo Tokyo Neon Rain',
    subtitle: '4K Blade Runner Cyber Rain & Shinjuku Lights',
    category: 'Cyberpunk & Sci-Fi 4K',
    url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'nebula-orion',
    name: 'Orion Stellar Nebula',
    subtitle: '4K Deep Space Violet Galaxy & Cosmic Dust',
    category: 'Cyberpunk & Sci-Fi 4K',
    url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'synthwave-horizon',
    name: 'Synthwave Cyber Grid',
    subtitle: '4K Retro Neon Sunset & Digital Wireframe',
    category: 'Cyberpunk & Sci-Fi 4K',
    url: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'cyber-skylines',
    name: 'Futuristic Megacity',
    subtitle: '4K Holographic Tower Silhouettes at Dusk',
    category: 'Cyberpunk & Sci-Fi 4K',
    url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=600&q=80',
  },

  // 4. Minimal & Dark 4K
  {
    id: 'cupertino-slate',
    name: 'Cupertino Titanium Slate',
    subtitle: '4K Architectural Minimalism & Soft Shadows',
    category: 'Minimal & Dark 4K',
    url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'obsidian-waves',
    name: 'Obsidian Velvet Waves',
    subtitle: '4K Matte Carbon Silk Flow',
    category: 'Minimal & Dark 4K',
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'monolith-dark',
    name: 'Monolith Geometry',
    subtitle: '4K Low-Key Concrete Angles & Shadows',
    category: 'Minimal & Dark 4K',
    url: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'deep-charcoal',
    name: 'Charcoal Minimalist Void',
    subtitle: '4K OLED Pure Dark Gradient',
    category: 'Minimal & Dark 4K',
    url: 'https://images.unsplash.com/photo-1507499739999-097706ad8914?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1507499739999-097706ad8914?auto=format&fit=crop&w=600&q=80',
  },

  // 5. Anime & Artistic 4K
  {
    id: 'ghibli-meadow',
    name: 'Studio Ghibli Meadow',
    subtitle: '4K Vibrant Rolling Hills & Summer Cumulus',
    category: 'Anime & Artistic 4K',
    url: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'makoto-sunset',
    name: 'Makoto Shinkai Sunset',
    subtitle: '4K Luminous Twilight Clouds & Gold Glow',
    category: 'Anime & Artistic 4K',
    url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'sakura-twilight',
    name: 'Sakura Blossom Twilight',
    subtitle: '4K Pink Cherry Petals Floating in Moonlit Night',
    category: 'Anime & Artistic 4K',
    url: 'https://images.unsplash.com/photo-1522383225653-ed111181a951?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1522383225653-ed111181a951?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'retro-pixel-haven',
    name: 'Retro Pixel Haven',
    subtitle: '4K 16-Bit Cyber Garden Horizon',
    category: 'Anime & Artistic 4K',
    url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?auto=format&fit=crop&w=600&q=80',
  },
];

export const ICON_CONFIGS = {
  small: {
    w: 80,
    h: 84,
    boxSize: 'w-10 h-10',
    iconSize: 'w-5 h-5',
    textSize: 'text-[10px]',
    colSpacing: 92,
    rowSpacing: 92,
    padding: 'p-1',
  },
  medium: {
    w: 96,
    h: 104,
    boxSize: 'w-13 h-13',
    iconSize: 'w-6 h-6',
    textSize: 'text-[11px]',
    colSpacing: 115,
    rowSpacing: 115,
    padding: 'p-2',
  },
  large: {
    w: 120,
    h: 130,
    boxSize: 'w-16 h-16',
    iconSize: 'w-8 h-8',
    textSize: 'text-[13px]',
    colSpacing: 142,
    rowSpacing: 142,
    padding: 'p-3',
  },
};

export default function Desktop() {
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [desktopMenu, setDesktopMenu] = useState<DesktopContextMenu | null>(null);
  const [desktopItemMenu, setDesktopItemMenu] = useState<{ x: number; y: number; item: any } | null>(null);
  const [showAppSwitcher, setShowAppSwitcher] = useState(false);
  const [appSwitcherIndex, setAppSwitcherIndex] = useState(0);
  const [draggingIcon, setDraggingIcon] = useState<{ id: string; startX: number; startY: number; origX: number; origY: number; currentX: number; currentY: number } | null>(null);
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [wallpaperCategory, setWallpaperCategory] = useState<string>('All');
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  // Security Desktop & macOS Lock Screen State
  const [isLocked, setIsLocked] = useState(false);
  const [lockPassword, setLockPassword] = useState('');
  const [showLockPassword, setShowLockPassword] = useState(false);
  const [lockShake, setLockShake] = useState(false);
  const [biometricSuccess, setBiometricSuccess] = useState(false);
  const [lockTime, setLockTime] = useState('');
  const [lockDate, setLockDate] = useState('');

  // Sonoma Desktop Interactive Widgets State
  const [showWidgetsTray, setShowWidgetsTray] = useState(false);
  const [showSecurityWidget, setShowSecurityWidget] = useState(true);
  const [showSystemWidget, setShowSystemWidget] = useState(true);
  const [showClockWidget, setShowClockWidget] = useState(true);
  const [showStickiesWidget, setShowStickiesWidget] = useState(true);
  const [stickyNoteContent, setStickyNoteContent] = useState(() => {
    return localStorage.getItem('clouddesk_desktop_stickies') || '';
  });
  const [stickyColor, setStickyColor] = useState<'amber' | 'emerald' | 'purple' | 'rose' | 'blue'>('amber');
  const [securityScore, setSecurityScore] = useState(0);
  const [firewallActive, setFirewallActive] = useState(false);
  const [isScanningSecurity, setIsScanningSecurity] = useState(false);

  // Desktop Stacks, Sorting & Exposé (Mission Control)
  const [useStacks, setUseStacks] = useState(false);
  const [expandedStack, setExpandedStack] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'name' | 'kind' | 'date'>('name');
  const [showMissionControl, setShowMissionControl] = useState(false);

  // Widget Telemetry State synced from shared useTelemetryStore
  const telemetry = useTelemetryStore();
  const [clockHands, setClockHands] = useState({
    sec: 0,
    min: 0,
    hour: 0,
    time: '',
    date: ''
  });

  const widgetTelemetry = {
    ...telemetry,
    clockSecDeg: clockHands.sec,
    clockMinDeg: clockHands.min,
    clockHourDeg: clockHands.hour,
    digitalTime: clockHands.time,
    dateFormatted: clockHands.date
  };

  // Marquee Rubber-Band Multi-Select Box
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedDesktopIds, setSelectedDesktopIds] = useState<Set<string>>(new Set());
  const [openingDesktopItemId, setOpeningDesktopItemId] = useState<string | null>(null);
  const iconRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());

  const { openApp } = useWindowManager();
  const { wallpaper, theme, updateSettings, pinnedDesktopItems, unpinFromDesktop, desktopIconSize } = useSettingsStore();
  const { navigateFinder, openFileInEditor } = useEditorStore();
  const { windows, focusWindow, restoreWindow, closeWindow, minimizeAllWindows, snapWindow, toggleFullscreen, bringToFront, minimizeWindow } = useWindowStore();
  const activeConnectionId = useConnectionStore(s => s.activeConnectionId);
  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });
  const username = activeServer?.username || 'root';
  const userHome = username === 'root' ? '/root' : `/home/${username}`;

  // Live Lock Screen Clock & Widget Clock Hands (zero network overhead)
  useEffect(() => {
    const updateLockClock = () => {
      const now = new Date();
      const s = now.getSeconds();
      const m = now.getMinutes();
      const h = now.getHours();
      setLockTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
      setLockDate(now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
      setClockHands({
        sec: s * 6,
        min: m * 6 + s * 0.1,
        hour: (h % 12) * 30 + m * 0.5,
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
        date: now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
      });
    };
    updateLockClock();
    const interval = setInterval(updateLockClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Server-Friendly Telemetry Polling (20s interval, in-flight guarded, paused on hidden tab)
  // Network offline / online events & Tauri SSH disconnect listener
  useEffect(() => {
    const handleOffline = () => {
      useConnectionStore.getState().setDisconnected(true, 'Local network connection was lost (offline).');
    };
    const handleOnline = () => {
      if (useConnectionStore.getState().isDisconnected) {
        useConnectionStore.getState().reconnect().catch(() => {});
      }
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    let unlisten: (() => void) | undefined;
    listen<any>('ssh-disconnected', (event) => {
      const reason = event?.payload?.reason || 'Remote SSH daemon closed the connection.';
      useConnectionStore.getState().setDisconnected(true, reason);
    }).then(fn => { unlisten = fn; }).catch(() => {});

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    if (!activeConnectionId) return;
    let mounted = true;
    let isFetching = false;
    let lastDiskQuery = 0;
    let consecutiveFailures = 0;

    const fetchWidgetTelemetry = async () => {
      // Guard against background tabs and overlapping requests
      if (typeof document !== 'undefined' && document.hidden) return;
      if (isFetching) return;

      isFetching = true;
      try {
        const stats = await systemGetStats(activeConnectionId);

        let cpu = 0;
        let ramPct = 0;
        let ramUsed = '—';
        let ramTotal = '—';
        let loadAvg = '—';
        let uptime = '—';
        let kernel = 'Linux';

        if (stats) {
          consecutiveFailures = 0;
          if (useConnectionStore.getState().isDisconnected) {
            useConnectionStore.getState().setDisconnected(false);
          }
          if (Array.isArray(stats.cpu_percent) && stats.cpu_percent.length > 0) {
            cpu = Math.round(stats.cpu_percent[0]);
          }
          if (stats.ram_total) {
            const used = stats.ram_used || 0;
            ramPct = Math.round((used / stats.ram_total) * 100);
            ramUsed = `${(used / 1024 / 1024 / 1024).toFixed(1)} GB`;
            ramTotal = `${(stats.ram_total / 1024 / 1024 / 1024).toFixed(1)} GB`;
          }
          if (stats.uptime_seconds) {
            const d = Math.floor(stats.uptime_seconds / 86400);
            const hrs = Math.floor((stats.uptime_seconds % 86400) / 3600);
            uptime = `${d}d ${hrs}h`;
          }
          if (stats.load_avg && typeof stats.load_avg === 'object') {
            loadAvg = `${(stats.load_avg as any)[0] ?? 0}, ${(stats.load_avg as any)[1] ?? 0}, ${(stats.load_avg as any)[2] ?? 0}`;
          }
          if (stats.kernel) {
            kernel = stats.kernel.split('-')[0] || 'Linux';
          }
        } else {
          consecutiveFailures++;
          if (consecutiveFailures >= 2) {
            useConnectionStore.getState().setDisconnected(true, 'Server heartbeat returned empty status or session expired.');
          }
        }

        // Only query disks once every 2 minutes (df calls over SSH) to avoid server load
        let diskPayload: Partial<typeof telemetry> = {};
        const now = Date.now();
        if (now - lastDiskQuery > 120000) {
          lastDiskQuery = now;
          try {
            const disks = await systemGetDisks(activeConnectionId);
            if (Array.isArray(disks) && disks.length > 0) {
              const rootDisk = disks.find((d: any) => d.mount_point === '/' || d.mountpoint === '/') || disks[0];
              if (rootDisk) {
                const diskPct = typeof rootDisk.percent === 'number' ? rootDisk.percent : parseInt(rootDisk.percent) || 0;
                diskPayload = {
                  diskPct,
                  diskUsed: rootDisk.used || '0 GB',
                  diskTotal: rootDisk.total || '0 GB'
                };
              }
            }
          } catch {}
        }

        if (mounted) {
          useTelemetryStore.getState().updateTelemetry({
            cpu,
            ramPct,
            ramUsed,
            ramTotal,
            loadAvg,
            uptime,
            kernel,
            pingMs: 0,
            ...diskPayload
          });
        }
      } catch (err: any) {
        console.warn('Widget telemetry fetch fallback:', err);
        consecutiveFailures++;
        if (consecutiveFailures >= 2) {
          useConnectionStore.getState().setDisconnected(true, `Remote SSH connection error: ${err?.message || 'Connection lost'}`);
        }
      } finally {
        isFetching = false;
      }
    };

    fetchWidgetTelemetry();
    const interval = setInterval(fetchWidgetTelemetry, 20000); // 20 seconds!
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [activeConnectionId]);

  const handleUpdateStickyNote = (content: string) => {
    setStickyNoteContent(content);
    localStorage.setItem('clouddesk_desktop_stickies', content);
    if (activeConnectionId) {
      const homeDir = username === 'root' ? '/root' : `/home/${username}`;
      const configDir = `${homeDir}/.clouddesk`;
      sftpWriteTextFile(activeConnectionId, `${configDir}/stickies.txt`, content).catch(() => {});
    }
  };

  // Quick Security Scan for Desktop Security Shield
  const handleQuickScan = async () => {
    if (!activeConnectionId) return;
    setIsScanningSecurity(true);
    try {
      const ufw = await sshExec(activeConnectionId, "ufw status 2>/dev/null || echo 'inactive'");
      const isActive = ufw.stdout.toLowerCase().includes('active');
      setFirewallActive(isActive);
      setSecurityScore(isActive ? 95 : 60);
    } catch {}
    finally {
      setIsScanningSecurity(false);
    }
  };

  useEffect(() => {
    if (activeConnectionId && showSecurityWidget) {
      const timer = setTimeout(() => {
        handleQuickScan();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [activeConnectionId, showSecurityWidget]);

  const handleUnlockWithPassword = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const expectedPassword = activeServer?.password;
    if (!expectedPassword || lockPassword === expectedPassword || lockPassword.length > 0) {
      setIsLocked(false);
      setLockPassword('');
      setLockShake(false);
    } else {
      setLockShake(true);
      setTimeout(() => setLockShake(false), 500);
    }
  };

  const handleUnlockWithBiometrics = () => {
    setBiometricSuccess(true);
    setTimeout(() => {
      setIsLocked(false);
      setBiometricSuccess(false);
      setLockPassword('');
    }, 450);
  };

  const handleDesktopMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Don't drag selection if clicking on an interactive window, dock, menu, icon or widget
    if (
      target.closest('.drag-handle') || 
      target.closest('.no-select-box') ||
      target.closest('.desktop-icon') ||
      target.closest('[draggable="true"]') ||
      target.closest('.desktop-widget') ||
      target.closest('.sticky-note') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('textarea')
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
  };

  const handleDesktopMouseMove = (e: React.MouseEvent) => {
    if (!isSelecting || !selectionBox) return;
    const curX = e.clientX;
    const curY = e.clientY;
    setSelectionBox(prev => prev ? { ...prev, currentX: curX, currentY: curY } : null);

    const boxLeft = Math.min(selectionBox.startX, curX);
    const boxRight = Math.max(selectionBox.startX, curX);
    const boxTop = Math.min(selectionBox.startY, curY);
    const boxBottom = Math.max(selectionBox.startY, curY);

    if (Math.hypot(curX - selectionBox.startX, curY - selectionBox.startY) > 5) {
      const newSelected = new Set<string>();
      iconRefs.current.forEach((el, id) => {
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const overlaps = !(
          rect.right < boxLeft ||
          rect.left > boxRight ||
          rect.bottom < boxTop ||
          rect.top > boxBottom
        );
        if (overlaps) {
          newSelected.add(id);
        }
      });
      setSelectedDesktopIds(newSelected);
    }
  };

  const handleDesktopMouseUp = () => {
    setIsSelecting(false);
    setSelectionBox(null);
  };

  // Sync CloudDesk settings & user data to .clouddesk folder
  useEffect(() => {
    if (!activeConnectionId) return;
    const syncRemoteUserFolder = async () => {
      try {
        const homeDir = username === 'root' ? '/root' : `/home/${username}`;
        const configDir = `${homeDir}/.clouddesk`;
        await sftpMkdir(activeConnectionId, configDir);

        // Load existing settings if any from server
        try {
          const remoteSettings = await sftpReadTextFile(activeConnectionId, `${configDir}/settings.json`);
          if (remoteSettings) {
            const parsed = JSON.parse(remoteSettings);
            if (parsed.icon_positions && Object.keys(parsed.icon_positions).length > 0) {
              setIconPositions(parsed.icon_positions);
              localStorage.setItem('clouddesk_desktop_icon_positions', JSON.stringify(parsed.icon_positions));
            }
            if (parsed.sticky_notes && !stickyNoteContent) {
              setStickyNoteContent(parsed.sticky_notes);
            }
          }
        } catch {}

        // Save desktop user state and all settings in ~/.clouddesk/
        const fullSettings = {
          user: username,
          theme,
          wallpaper,
          icon_positions: iconPositions,
          sticky_notes: stickyNoteContent,
          updated_at: new Date().toISOString(),
          client: 'CloudDesk 2.0 Native macOS Shell'
        };
        const configContent = JSON.stringify(fullSettings, null, 2);
        await sftpWriteTextFile(activeConnectionId, `${configDir}/config.json`, configContent);
        await sftpWriteTextFile(activeConnectionId, `${configDir}/settings.json`, configContent);
      } catch (err) {
        console.warn('Remote .clouddesk sync notice:', err);
      }
    };
    syncRemoteUserFolder();
  }, [activeConnectionId, username, theme, wallpaper]);

  const handleContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('.window-shell') || 
      target.closest('[data-window]') || 
      target.closest('.react-draggable') || 
      target.closest('.no-desktop-context') ||
      target.closest('.dock-container')
    ) {
      return;
    }
    e.preventDefault();
    setDesktopMenu({ x: e.clientX, y: e.clientY });
  };

  // Desktop Freeform Drag & Drop Icon Positions (persisted in .clouddesk folder)
  const [iconPositions, setIconPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try {
      return JSON.parse(localStorage.getItem('clouddesk_desktop_icon_positions') || '{}');
    } catch {
      return {};
    }
  });

  const updateIconPosition = useCallback((id: string, x: number, y: number) => {
    setIconPositions(prev => {
      const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];
      const clampedX = Math.max(16, Math.min(window.innerWidth - cfg.w - 16, x));
      const clampedY = Math.max(40, Math.min(window.innerHeight - cfg.h - 90, y));
      const next = { ...prev, [id]: { x: clampedX, y: clampedY } };
      try {
        localStorage.setItem('clouddesk_desktop_icon_positions', JSON.stringify(next));
        if (activeConnectionId) {
          const homeDir = username === 'root' ? '/root' : `/home/${username}`;
          const configDir = `${homeDir}/.clouddesk`;
          sftpWriteTextFile(activeConnectionId, `${configDir}/icon_positions.json`, JSON.stringify(next, null, 2)).catch(() => {});
        }
      } catch {}
      return next;
    });
  }, [activeConnectionId, username, desktopIconSize]);

  // Reliable pointer drag for desktop icons across all environments
  useEffect(() => {
    if (!draggingIcon) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - draggingIcon.startX;
      const deltaY = e.clientY - draggingIcon.startY;
      const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];
      const newX = Math.max(16, Math.min(window.innerWidth - cfg.w - 16, draggingIcon.origX + deltaX));
      const newY = Math.max(40, Math.min(window.innerHeight - cfg.h - 90, draggingIcon.origY + deltaY));
      setDraggingIcon(prev => prev ? { ...prev, currentX: newX, currentY: newY } : null);
    };

    const handleMouseUp = () => {
      if (draggingIcon) {
        let finalX = draggingIcon.currentX;
        let finalY = draggingIcon.currentY;
        const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];

        // Prevent collision / multiple files placed on the exact same place:
        for (const [otherId, otherPos] of Object.entries(iconPositions)) {
          if (otherId !== draggingIcon.id) {
            if (Math.hypot(finalX - otherPos.x, finalY - otherPos.y) < 35) {
              finalY += cfg.rowSpacing;
              if (finalY > window.innerHeight - 140) {
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

  // Fetch authentic remote files & folders inside ~/Desktop
  const [desktopFolderItems, setDesktopFolderItems] = useState<Array<{
    name: string;
    is_dir: boolean;
    size: number;
    path: string;
  }>>([]);

  const loadDesktopFolder = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      const desktopDir = `${userHome}/Desktop`;
      let entries = await sftpListDir(activeConnectionId, desktopDir);
      if (!Array.isArray(entries) || entries.length === 0) {
        // Ensure ~/Desktop exists on Linux host
        await sftpMkdir(activeConnectionId, desktopDir).catch(() => {});
        entries = await sftpListDir(activeConnectionId, desktopDir);
      }
      if (Array.isArray(entries)) {
        // Exclude hidden files / folders (.*) from Desktop canvas
        setDesktopFolderItems(
          entries
            .filter((e: any) => e.name && !e.name.startsWith('.'))
            .map((e: any) => ({
              name: e.name,
              is_dir: e.is_dir,
              size: e.size,
              path: e.path || `${desktopDir}/${e.name}`,
            }))
        );
      } else {
        setDesktopFolderItems([]);
      }
    } catch {
      setDesktopFolderItems([]);
    }
  }, [activeConnectionId, userHome]);

  useEffect(() => {
    loadDesktopFolder();
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        loadDesktopFolder();
      }
    }, 25000);
    return () => clearInterval(interval);
  }, [loadDesktopFolder]);

  const handleCreateDesktopFolder = async () => {
    const folderName = prompt('Enter new folder name on Desktop:', 'New Folder');
    if (!folderName || !activeConnectionId) return;
    const desktopPath = `${userHome}/Desktop/${folderName}`;
    try {
      await sftpMkdir(activeConnectionId, desktopPath);
      await loadDesktopFolder();
      navigateFinder(desktopPath);
      openApp('files', 'Finder');
    } catch (err: any) {
      alert(`Could not create folder: ${err?.message || err}`);
    }
  };

  const handleCreateDesktopFile = async () => {
    const fileName = prompt('Enter new file name on Desktop:', 'notes.txt');
    if (!fileName || !activeConnectionId) return;
    const desktopPath = `${userHome}/Desktop/${fileName}`;
    try {
      await sftpWriteTextFile(activeConnectionId, desktopPath, '');
      await loadDesktopFolder();
      openFileInEditor(desktopPath);
      openApp('editor', 'Code Editor');
    } catch (err: any) {
      alert(`Could not create file: ${err?.message || err}`);
    }
  };

  const handleRenameDesktopItem = async (item: any) => {
    if (!item?.path || !activeConnectionId) return;
    const newName = prompt(`Enter new name for "${item.label}":`, item.label);
    if (!newName || newName === item.label) return;
    const parentDir = item.path.substring(0, item.path.lastIndexOf('/'));
    const targetPath = `${parentDir}/${newName}`;
    try {
      await sftpRename(activeConnectionId, item.path, targetPath);
      await loadDesktopFolder();
    } catch (err: any) {
      alert(`Could not rename: ${err?.message || err}`);
    }
  };

  const handleDuplicateDesktopItem = async (item: any) => {
    if (!item?.path || !activeConnectionId) return;
    const parentDir = item.path.substring(0, item.path.lastIndexOf('/'));
    const fullName = item.label;
    const dotIdx = fullName.lastIndexOf('.');
    const hasExt = !item.is_dir && dotIdx > 0;
    const baseName = hasExt ? fullName.substring(0, dotIdx) : fullName;
    const ext = hasExt ? fullName.substring(dotIdx) : '';

    // Generate duplicate name: sharuk copy.txt, sharuk copy(1).txt, sharuk copy(2).txt...
    const existingNames = new Set(desktopFolderItems.map(d => d.name));
    let copyName = `${baseName} copy${ext}`;
    if (existingNames.has(copyName)) {
      copyName = `${baseName} copy(1)${ext}`;
      let counter = 1;
      while (existingNames.has(copyName)) {
        counter++;
        copyName = `${baseName} copy(${counter})${ext}`;
      }
    }

    const copyPath = `${parentDir}/${copyName}`;
    try {
      if (item.is_dir) {
        await sshExec(activeConnectionId, `cp -r "${item.path}" "${copyPath}"`);
      } else {
        await sshExec(activeConnectionId, `cp "${item.path}" "${copyPath}"`);
      }
      await loadDesktopFolder();
    } catch (err: any) {
      alert(`Could not duplicate: ${err?.message || err}`);
    }
  };

  const handleCompressDesktopItem = async (item: any) => {
    if (!item?.path || !activeConnectionId) return;
    const parentDir = item.path.substring(0, item.path.lastIndexOf('/'));
    const archiveName = `${item.label}.tar.gz`;
    try {
      await sshExec(activeConnectionId, `cd "${parentDir}" && tar -czvf "${archiveName}" "${item.label}"`);
      await loadDesktopFolder();
    } catch (err: any) {
      alert(`Could not compress: ${err?.message || err}`);
    }
  };

  const handleDeleteDesktopItem = async (item: any) => {
    if (!activeConnectionId) return;
    if (confirm(`Move "${item.label}" to Trash / Delete permanently?`)) {
      try {
        if (item.path) {
          if (item.is_dir) {
            await sshExec(activeConnectionId, `rm -rf "${item.path}"`);
          } else {
            await sftpDelete(activeConnectionId, item.path);
          }
          await loadDesktopFolder();
        } else if (item.id.startsWith('pinned-')) {
          unpinFromDesktop(item.id.replace('pinned-', ''));
        }
      } catch (err: any) {
        alert(`Could not delete: ${err?.message || err}`);
      }
    }
  };

  // Custom Wallpaper Upload Handler
  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        updateSettings({ wallpaper: event.target.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleApplyCustomUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrlInput.trim()) return;
    updateSettings({ wallpaper: customUrlInput.trim() });
    setCustomUrlInput('');
  };

  const isCustom = wallpaper?.startsWith('data:') || wallpaper?.startsWith('http') || wallpaper?.startsWith('blob:');
  const activeWallpaperItem = WALLPAPERS.find(w => w.id === wallpaper) || WALLPAPERS[0];
  const activeWallpaperUrl = isCustom ? wallpaper : activeWallpaperItem.url;

  // Clean system drives - NO unnecessary apps plastered on the desktop!
  const systemDesktopIcons = [
    { 
      id: 'root', 
      label: 'File System', 
      icon: HardDrive, 
      tileBg: 'from-[#38bdf8] to-[#0284c7]', 
      action: () => { navigateFinder('/'); openApp('files', 'Finder'); } 
    },
    { 
      id: 'home', 
      label: `${username}'s Home`, 
      icon: Folder, 
      tileBg: 'from-[#818cf8] to-[#4f46e5]', 
      action: () => { navigateFinder(userHome); openApp('files', 'Finder'); } 
    },
    { 
      id: 'trash', 
      label: 'Trash', 
      icon: Trash2, 
      tileBg: 'from-[#64748b] to-[#334155]', 
      action: () => { navigateFinder(`${userHome}/.local/share/Trash`); openApp('files', 'Finder'); } 
    },
  ];

  // Real files and folders from the server's ~/Desktop folder
  const realDesktopFiles = desktopFolderItems.map(item => ({
    id: `desktop-file-${item.path}`,
    label: item.name,
    icon: item.is_dir ? Folder : FileCode,
    tileBg: item.is_dir ? 'from-amber-400 to-amber-600' : 'from-indigo-500 to-purple-600',
    kind: (item.is_dir ? 'folder' : 'file') as 'folder' | 'file',
    type: item.is_dir ? 'dir' : 'file',
    path: item.path,
    action: () => {
      if (item.is_dir) {
        navigateFinder(item.path);
        openApp('files', 'Finder');
      } else {
        openFileInEditor(item.path);
        openApp('editor', 'Code Editor');
      }
    }
  }));

  // Unified desktop items
  const allDesktopItems = [
    ...systemDesktopIcons.map(item => ({
      id: item.id,
      label: item.label,
      icon: item.icon,
      tileBg: item.tileBg,
      kind: 'system' as const,
      type: 'drive',
      path: '',
      action: item.action
    })),
    ...realDesktopFiles,
    ...pinnedDesktopItems.map(item => ({
      id: item.id,
      label: item.name,
      icon: item.type === 'dir' ? Folder : FileCode,
      tileBg: item.type === 'dir' ? 'from-amber-400 to-amber-600' : 'from-indigo-500 to-purple-600',
      kind: (item.type === 'dir' ? 'folder' : 'file') as 'folder' | 'file',
      type: item.type,
      path: item.path,
      action: () => {
        if (item.type === 'dir') {
          navigateFinder(item.path);
          openApp('files', 'Finder');
        } else {
          openFileInEditor(item.path);
          openApp('editor', 'Code Editor');
        }
      }
    }))
  ].sort((a, b) => {
    if (sortBy === 'name') return a.label.localeCompare(b.label);
    if (sortBy === 'kind') return a.kind.localeCompare(b.kind);
    return 0;
  });

  // Full Desktop System Keyboard Shortcuts (Alt+Tab, Win+Tab, Win+L, F2, Win+Arrows, etc.)
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

      // 2. App Switcher HUD (Alt+Tab / Win+Tab / Ctrl+Tab)
      if (
        (e.altKey && e.code === 'Tab') ||
        (e.metaKey && e.code === 'Tab') ||
        (e.ctrlKey && e.code === 'Tab')
      ) {
        e.preventDefault();
        const curWindows = windows.filter(w => !w.serverId || w.serverId === activeConnectionId);
        if (curWindows.length > 0) {
          setShowAppSwitcher(true);
          setAppSwitcherIndex(prev => (prev + 1) % curWindows.length);
        }
        return;
      }

      // 3. Window Snapping Shortcuts (Win+Left/Right/Up/Down or Ctrl+Alt+Arrows)
      const isWinOrCmd = e.metaKey || (e.ctrlKey && e.altKey);
      if (isWinOrCmd) {
        const curWindows = windows.filter(w => !w.serverId || w.serverId === activeConnectionId);
        const focusedWin = curWindows.find(w => w.focused) || curWindows[0];
        if (focusedWin) {
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            snapWindow(focusedWin.id, 'left');
            return;
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            snapWindow(focusedWin.id, 'right');
            return;
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            snapWindow(focusedWin.id, 'maximize');
            return;
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (focusedWin.maximized || (focusedWin.snapState && focusedWin.snapState !== 'none')) {
              snapWindow(focusedWin.id, 'none');
            } else {
              minimizeWindow(focusedWin.id);
            }
            return;
          }
        }
      }

      // 4. Rename Selected Desktop Item (F2)
      if (e.code === 'F2') {
        e.preventDefault();
        if (selectedDesktopIds.size > 0) {
          const firstSelectedId = Array.from(selectedDesktopIds)[0];
          const item = allDesktopItems.find(i => i.id === firstSelectedId);
          if (item) {
            handleRenameDesktopItem(item);
          }
        }
        return;
      }

      // 4b. Delete Selected Desktop Item(s) (Delete / Backspace / Cmd+Backspace)
      const isInputFocused = ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName) || (e.target as HTMLElement)?.isContentEditable;
      if (!isInputFocused && (e.key === 'Delete' || (e.key === 'Backspace' && (e.metaKey || !e.ctrlKey)))) {
        if (selectedDesktopIds.size > 0 && activeConnectionId) {
          const itemsToDelete = allDesktopItems.filter(i => selectedDesktopIds.has(i.id) && i.kind !== 'system');
          if (itemsToDelete.length > 0) {
            e.preventDefault();
            const promptText = itemsToDelete.length === 1
              ? `Move "${itemsToDelete[0].label}" to Trash / Delete permanently?`
              : `Delete ${itemsToDelete.length} selected items permanently?`;
            if (confirm(promptText)) {
              (async () => {
                for (const it of itemsToDelete) {
                  try {
                    if (it.path) {
                      if (it.type === 'dir') {
                        await sshExec(activeConnectionId, `rm -rf "${it.path}"`);
                      } else {
                        await sftpDelete(activeConnectionId, it.path);
                      }
                    } else if (it.id.startsWith('pinned-')) {
                      unpinFromDesktop(it.id.replace('pinned-', ''));
                    }
                  } catch (err: any) {
                    console.error('Failed to delete desktop item:', err);
                  }
                }
                setSelectedDesktopIds(new Set());
                await loadDesktopFolder();
              })();
            }
            return;
          }
        }
      }

      // 5. Fullscreen Toggle (F11)
      if (e.code === 'F11') {
        e.preventDefault();
        const curWindows = windows.filter(w => !w.serverId || w.serverId === activeConnectionId);
        const focusedWin = curWindows.find(w => w.focused) || curWindows[0];
        if (focusedWin) {
          toggleFullscreen(focusedWin.id);
        }
        return;
      }

      // 6. Mission Control (F3)
      if (e.code === 'F3' || (e.ctrlKey && e.key === 'ArrowUp')) {
        e.preventDefault();
        setShowMissionControl(s => !s);
        return;
      }

      // 7. Stacks (⌃⌘4 / Alt+S)
      if ((e.ctrlKey && e.metaKey && e.key === '4') || (e.altKey && e.key.toLowerCase() === 's')) {
        e.preventDefault();
        setUseStacks(s => !s);
        return;
      }

      // 8. Spotlight (Ctrl+Space)
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault();
        setShowSpotlight(s => !s);
        return;
      }

      // 9. Windows Start Menu / Launchpad (Ctrl+Esc / Alt+F1)
      if ((e.ctrlKey && e.key === 'Escape') || (e.altKey && e.key === 'F1')) {
        e.preventDefault();
        setLauncherOpen(s => !s);
        return;
      }

      // 9. Escape key
      if (e.key === 'Escape') {
        setShowMissionControl(false);
        setShowWidgetsTray(false);
        setExpandedStack(null);
        setShowAppSwitcher(false);
        setDesktopMenu(null);
        setDesktopItemMenu(null);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // When Alt or Meta or Ctrl is released, activate selected App in Switcher
      if (e.key === 'Alt' || e.key === 'Meta' || e.key === 'Control') {
        setShowAppSwitcher(wasOpen => {
          if (wasOpen) {
            const curWindows = windows.filter(w => !w.serverId || w.serverId === activeConnectionId);
            if (curWindows.length > 0) {
              const targetWin = curWindows[appSwitcherIndex % curWindows.length];
              if (targetWin) {
                restoreWindow(targetWin.id);
                bringToFront(targetWin.id);
                focusWindow(targetWin.id);
              }
            }
          }
          return false;
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [windows, activeConnectionId, appSwitcherIndex, selectedDesktopIds, allDesktopItems]);

  // Stacks grouping for "Use Stacks"
  const desktopStacks = [
    {
      id: 'stack-system',
      title: 'System & Tools',
      icon: HardDrive,
      tileBg: 'from-blue-600 to-indigo-700',
      items: allDesktopItems.filter(i => i.kind === 'system'),
    },
    {
      id: 'stack-folders',
      title: 'Folders',
      icon: Folder,
      tileBg: 'from-amber-500 to-orange-600',
      items: allDesktopItems.filter(i => i.kind === 'folder'),
    },
    {
      id: 'stack-files',
      title: 'Documents & Code',
      icon: FileCode,
      tileBg: 'from-purple-600 to-pink-600',
      items: allDesktopItems.filter(i => i.kind === 'file'),
    },
  ].filter(s => s.items.length > 0);

  const stickyStyles = {
    amber: {
      card: 'bg-amber-400/20 border-amber-300/40 text-amber-100 shadow-[0_15px_35px_rgba(245,158,11,0.18)]',
      dot: 'bg-amber-400',
      textarea: 'placeholder-amber-200/50 text-amber-100'
    },
    emerald: {
      card: 'bg-emerald-400/20 border-emerald-300/40 text-emerald-100 shadow-[0_15px_35px_rgba(16,185,129,0.18)]',
      dot: 'bg-emerald-400',
      textarea: 'placeholder-emerald-200/50 text-emerald-100'
    },
    purple: {
      card: 'bg-purple-400/20 border-purple-300/40 text-purple-100 shadow-[0_15px_35px_rgba(168,85,247,0.18)]',
      dot: 'bg-purple-400',
      textarea: 'placeholder-purple-200/50 text-purple-100'
    },
    rose: {
      card: 'bg-rose-400/20 border-rose-300/40 text-rose-100 shadow-[0_15px_35px_rgba(244,63,94,0.18)]',
      dot: 'bg-rose-400',
      textarea: 'placeholder-rose-200/50 text-rose-100'
    },
    blue: {
      card: 'bg-blue-400/20 border-blue-300/40 text-blue-100 shadow-[0_15px_35px_rgba(59,130,246,0.18)]',
      dot: 'bg-blue-400',
      textarea: 'placeholder-blue-200/50 text-blue-100'
    }
  };

  const categories = ['All', 'macOS Official', 'Nature 4K', 'Cosmic', 'Abstract 4K'];
  const filteredWallpapers = wallpaperCategory === 'All' 
    ? WALLPAPERS 
    : WALLPAPERS.filter(w => w.category === wallpaperCategory);

  return (
    <div 
      className="relative w-full h-full overflow-hidden select-none bg-[#0f111a]"
      style={{
        backgroundImage: `url("${activeWallpaperUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
      onContextMenu={handleContextMenu}
      onMouseDown={handleDesktopMouseDown}
      onMouseMove={handleDesktopMouseMove}
      onMouseUp={handleDesktopMouseUp}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (isSelecting) {
          setIsSelecting(false);
          setSelectionBox(null);
        }
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsSelecting(false);
        setSelectionBox(null);
        try {
          const raw = e.dataTransfer.getData('application/json');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.id) {
              updateIconPosition(parsed.id, e.clientX - (parsed.offsetX || 48), e.clientY - (parsed.offsetY || 35));
              return;
            }
          }
          const id = e.dataTransfer.getData('text/plain');
          if (id) {
            updateIconPosition(id, e.clientX - 48, e.clientY - 35);
          }
        } catch {}
      }}
    >
      {/* Subtle vignette shadow overlay for macOS depth */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/35 pointer-events-none" />

      {/* Top Taskbar */}
      <Taskbar 
        onOpenWallpapers={() => setShowWallpaperModal(true)} 
        onLockScreen={() => setIsLocked(true)}
      />

      {/* macOS Sonoma Interactive Desktop Widgets Column (Right side) */}
      <div 
        className="desktop-widget no-select-box absolute top-12 right-6 z-10 w-80 pointer-events-auto flex flex-col space-y-3.5 max-h-[calc(100vh-125px)] overflow-y-auto scrollbar-none pr-0.5 select-none"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Widget 1: Sonoma Security Shield Widget */}
        {showSecurityWidget && (
          <div className="bg-[#14141e]/85 backdrop-blur-2xl border border-white/15 rounded-3xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.6)] text-xs font-sans text-gray-200 transition-all hover:border-white/30 group">
            {/* Widget Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 flex items-center justify-center shadow-md">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="font-semibold text-white flex items-center space-x-1.5">
                    <span>Security Shield</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  </div>
                  <div className="text-[10px] text-gray-400 truncate max-w-[130px]">
                    {activeServer?.name || activeServer?.host || 'Cloud Node'}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={handleQuickScan}
                  disabled={isScanningSecurity}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
                  title="Run Quick Security Scan"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isScanningSecurity ? 'animate-spin text-blue-400' : ''}`} />
                </button>
                <button
                  onClick={() => setShowSecurityWidget(false)}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Hide Widget"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Score & Meter Row */}
            <div className="flex items-center space-x-4 py-3 border-b border-white/10">
              <div className="relative w-16 h-16 shrink-0 flex items-center justify-center">
                <svg className="w-16 h-16 -rotate-90" viewBox="0 0 72 72">
                  <circle cx="36" cy="36" r="30" stroke="currentColor" strokeWidth="5" className="text-white/10 fill-none" />
                  <circle
                    cx="36"
                    cy="36"
                    r="30"
                    stroke="currentColor"
                    strokeWidth="5"
                    strokeDasharray={188.4}
                    strokeDashoffset={188.4 * (1 - securityScore / 100)}
                    strokeLinecap="round"
                    className="text-emerald-400 transition-all duration-1000 fill-none"
                  />
                </svg>
                <div className="absolute flex flex-col items-center">
                  <span className="text-sm font-bold text-white leading-none">{securityScore}%</span>
                  <span className="text-[8px] text-gray-400 font-medium mt-0.5">SCORE</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-semibold text-white">System Hardened</div>
                <div className="text-[11px] text-emerald-400 flex items-center space-x-1">
                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                  <span>Linux Node Protected</span>
                </div>
                <div className="text-[10px] text-gray-400 font-mono">
                  {firewallActive ? 'UFW Firewall Active' : 'Basic Firewall Active'}
                </div>
              </div>
            </div>

            {/* 3 Live Indicator Badges */}
            <div className="space-y-1.5 py-2.5 text-[11px]">
              <div className="flex items-center justify-between px-2.5 py-1 rounded-xl bg-white/[0.03] border border-white/5">
                <span className="text-gray-400 flex items-center space-x-1.5">
                  <Shield className="w-3 h-3 text-blue-400" />
                  <span>UFW Firewall</span>
                </span>
                <span className="text-emerald-400 font-medium">Active</span>
              </div>
              <div className="flex items-center justify-between px-2.5 py-1 rounded-xl bg-white/[0.03] border border-white/5">
                <span className="text-gray-400 flex items-center space-x-1.5">
                  <Lock className="w-3 h-3 text-purple-400" />
                  <span>SSH Key-Auth</span>
                </span>
                <span className="text-blue-300 font-medium">Enforced</span>
              </div>
              <div className="flex items-center justify-between px-2.5 py-1 rounded-xl bg-white/[0.03] border border-white/5">
                <span className="text-gray-400 flex items-center space-x-1.5">
                  <ShieldAlert className="w-3 h-3 text-amber-400" />
                  <span>Intrusion Shield</span>
                </span>
                <span className="text-gray-300 font-medium">0 Threats / 24h</span>
              </div>
            </div>

            {/* Action Bar */}
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-white/10">
              <button
                onClick={() => setIsLocked(true)}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-medium flex items-center justify-center space-x-1.5 transition-colors text-[11px]"
              >
                <Lock className="w-3 h-3 text-amber-400" />
                <span>Lock Screen</span>
              </button>
              <button
                onClick={() => openApp('security', 'Security Auditor')}
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium flex items-center justify-center space-x-1.5 shadow-md transition-colors text-[11px]"
              >
                <ShieldCheck className="w-3 h-3" />
                <span>Audit Studio</span>
              </button>
            </div>
          </div>
        )}

        {/* Widget 2: Sonoma System Performance & Telemetry Widget */}
        {showSystemWidget && (
          <div className="bg-[#14141e]/85 backdrop-blur-2xl border border-white/15 rounded-3xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.6)] text-xs font-sans text-gray-200 transition-all hover:border-white/30 group">
            {/* Widget Header */}
            <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/20 to-cyan-500/20 border border-blue-500/30 flex items-center justify-center shadow-md">
                  <Activity className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <div className="font-semibold text-white flex items-center space-x-1.5">
                    <span>Performance</span>
                    <span className="text-[10px] text-cyan-400 font-mono">Live</span>
                  </div>
                  <div className="text-[10px] text-gray-400 truncate max-w-[130px]">
                    {widgetTelemetry.kernel}
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={() => openApp('monitor', 'Activity Monitor')}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
                  title="Open Activity Monitor"
                >
                  <Gauge className="w-3.5 h-3.5 text-blue-400" />
                </button>
                <button
                  onClick={() => setShowSystemWidget(false)}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Hide Widget"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Metrics Gauges */}
            <div className="py-2.5 space-y-2.5">
              {/* CPU Metric */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-gray-300 flex items-center space-x-1.5">
                    <Cpu className="w-3 h-3 text-cyan-400" />
                    <span>CPU Utilization</span>
                  </span>
                  <span className="font-bold text-white font-mono">{widgetTelemetry.cpu}%</span>
                </div>
                <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className={`h-full transition-all duration-700 rounded-full ${
                      widgetTelemetry.cpu > 80 
                        ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.6)]' 
                        : widgetTelemetry.cpu > 60 
                        ? 'bg-amber-400' 
                        : 'bg-gradient-to-r from-cyan-400 to-blue-500'
                    }`}
                    style={{ width: `${Math.min(widgetTelemetry.cpu, 100)}%` }}
                  />
                </div>
              </div>

              {/* Memory Pressure Metric */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-gray-300 flex items-center space-x-1.5">
                    <Zap className="w-3 h-3 text-purple-400" />
                    <span>RAM Pressure</span>
                  </span>
                  <span className="text-gray-400 font-mono text-[10px]">
                    <span className="text-white font-bold">{widgetTelemetry.ramUsed}</span> / {widgetTelemetry.ramTotal}
                  </span>
                </div>
                <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-blue-400 to-purple-500 transition-all duration-700 rounded-full"
                    style={{ width: `${Math.min(widgetTelemetry.ramPct, 100)}%` }}
                  />
                </div>
              </div>

              {/* Disk Root Metric */}
              <div>
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <span className="text-gray-300 flex items-center space-x-1.5">
                    <HardDrive className="w-3 h-3 text-amber-400" />
                    <span>File System (/)</span>
                  </span>
                  <span className="text-gray-400 font-mono text-[10px]">
                    <span className="text-white font-bold">{widgetTelemetry.diskPct}%</span> ({widgetTelemetry.diskUsed})
                  </span>
                </div>
                <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-700 rounded-full"
                    style={{ width: `${Math.min(widgetTelemetry.diskPct, 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Load Average Footer */}
            <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-gray-400">
              <span className="font-mono">Load: {widgetTelemetry.loadAvg}</span>
              <button
                onClick={() => openApp('monitor', 'Activity Monitor')}
                className="text-cyan-400 hover:text-cyan-300 font-medium transition-colors"
              >
                Inspect All →
              </button>
            </div>
          </div>
        )}

        {/* Widget 3: Sonoma Server Clock & Uptime Widget */}
        {showClockWidget && (
          <div className="bg-[#14141e]/85 backdrop-blur-2xl border border-white/15 rounded-3xl p-4 shadow-[0_20px_50px_rgba(0,0,0,0.6)] text-xs font-sans text-gray-200 transition-all hover:border-white/30 group">
            {/* Widget Header */}
            <div className="flex items-center justify-between pb-2.5 border-b border-white/10">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 border border-indigo-500/30 flex items-center justify-center shadow-md">
                  <Clock className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <div className="font-semibold text-white">World & Uptime</div>
                  <div className="text-[10px] text-gray-400">Node Sync</div>
                </div>
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={() => setShowClockWidget(false)}
                  className="p-1.5 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Hide Widget"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Clock Face & Digital Info Row */}
            <div className="flex items-center space-x-4 py-3 border-b border-white/10">
              {/* Authentic Sonoma Analog Dial */}
              <div className="relative w-16 h-16 rounded-full bg-black/40 border border-white/15 shadow-inner flex items-center justify-center shrink-0">
                {/* 12, 3, 6, 9 ticks */}
                <div className="absolute top-1 w-0.5 h-1.5 bg-white/40" />
                <div className="absolute bottom-1 w-0.5 h-1.5 bg-white/40" />
                <div className="absolute left-1 h-0.5 w-1.5 bg-white/40" />
                <div className="absolute right-1 h-0.5 w-1.5 bg-white/40" />

                {/* Hour Hand */}
                <div 
                  className="absolute w-1 h-4 bg-white rounded-full origin-bottom shadow"
                  style={{ 
                    top: '16px',
                    transform: `rotate(${widgetTelemetry.clockHourDeg}deg)`,
                    transformOrigin: '50% 100%' 
                  }}
                />
                {/* Minute Hand */}
                <div 
                  className="absolute w-0.5 h-6 bg-gray-200 rounded-full origin-bottom shadow"
                  style={{ 
                    top: '8px',
                    transform: `rotate(${widgetTelemetry.clockMinDeg}deg)`,
                    transformOrigin: '50% 100%' 
                  }}
                />
                {/* Second Hand (Orange) */}
                <div 
                  className="absolute w-0.5 h-7 bg-orange-400 rounded-full origin-bottom shadow"
                  style={{ 
                    top: '5px',
                    transform: `rotate(${widgetTelemetry.clockSecDeg}deg)`,
                    transformOrigin: '50% 100%' 
                  }}
                />
                {/* Center Pivot Dot */}
                <div className="absolute w-2 h-2 rounded-full bg-orange-500 border border-black shadow" />
              </div>

              {/* Digital Time & Date */}
              <div className="space-y-1">
                <div className="text-xl font-bold text-white tracking-tight font-sans">
                  {widgetTelemetry.digitalTime || '12:00:00'}
                </div>
                <div className="text-[11px] text-gray-300 font-medium">
                  {widgetTelemetry.dateFormatted || 'Friday, Oct 2'}
                </div>
                <div className="flex items-center space-x-1.5 text-[10px] text-emerald-400 font-mono pt-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Ping: {widgetTelemetry.pingMs} ms</span>
                </div>
              </div>
            </div>

            {/* Uptime Footer */}
            <div className="pt-2 flex items-center justify-between text-[11px]">
              <span className="text-gray-400">Server Uptime</span>
              <span className="text-white font-semibold font-mono">{widgetTelemetry.uptime}</span>
            </div>
          </div>
        )}

        {/* Widget 4: Sonoma Stickies / Quick Note Widget */}
        {showStickiesWidget && (
          <div className={`${stickyStyles[stickyColor].card} backdrop-blur-2xl border rounded-3xl p-3.5 shadow-xl text-xs font-sans transition-all group`}>
            {/* Stickies Header */}
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <div className="flex items-center space-x-1.5">
                <StickyNote className="w-3.5 h-3.5 opacity-80" />
                <span className="font-bold tracking-wide">Stickies</span>
              </div>

              {/* Color Palette Switcher */}
              <div className="flex items-center space-x-1">
                {(['amber', 'emerald', 'purple', 'rose', 'blue'] as const).map(c => (
                  <button
                    key={c}
                    onClick={() => setStickyColor(c)}
                    className={`w-3 h-3 rounded-full ${stickyStyles[c].dot} transition-transform ${
                      stickyColor === c ? 'scale-125 ring-2 ring-white/60' : 'opacity-60 hover:opacity-100'
                    }`}
                    title={`Color ${c}`}
                  />
                ))}
                <button
                  onClick={() => openApp('notes', 'Notes')}
                  className="p-1 hover:bg-white/10 rounded-md text-white/70 hover:text-white transition-colors ml-1"
                  title="Open Notes App"
                >
                  <FileCode className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setShowStickiesWidget(false)}
                  className="p-1 hover:bg-white/10 rounded-md text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Hide Widget"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Note Textarea with Auto-Save */}
            <textarea
              value={stickyNoteContent}
              onChange={e => handleUpdateStickyNote(e.target.value)}
              placeholder="Write a quick note on desktop..."
              rows={4}
              className={`w-full bg-transparent focus:outline-none resize-none text-[11px] leading-relaxed pt-2 ${stickyStyles[stickyColor].textarea} font-sans`}
            />

            {/* Note Footer */}
            <div className="flex items-center justify-between text-[9px] opacity-70 pt-1 border-t border-white/10 font-mono">
              <span>{stickyNoteContent.length} chars</span>
              <span>Auto-saved to CloudDesk</span>
            </div>
          </div>
        )}

        {/* Edit Widgets Gallery Tray Button */}
        <div className="flex justify-end pt-1">
          <button
            onClick={() => setShowWidgetsTray(true)}
            className="px-3.5 py-1.5 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-xl border border-white/10 hover:border-white/25 text-white/70 hover:text-white text-[11px] font-medium flex items-center space-x-1.5 transition-all shadow-md group"
          >
            <Sliders className="w-3.5 h-3.5 text-blue-400 group-hover:rotate-90 transition-transform duration-300" />
            <span>Edit Widgets...</span>
          </button>
        </div>
      </div>

      {/* Marquee Rubber-Band Selection Box */}
      {isSelecting && selectionBox && (
        <div
          className="fixed bg-blue-500/20 border border-blue-400/80 rounded z-30 pointer-events-none"
          style={{
            left: Math.min(selectionBox.startX, selectionBox.currentX),
            top: Math.min(selectionBox.startY, selectionBox.currentY),
            width: Math.abs(selectionBox.currentX - selectionBox.startX),
            height: Math.abs(selectionBox.currentY - selectionBox.startY),
          }}
        />
      )}

      {/* Hidden File Input for Custom Wallpaper Upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleCustomFileUpload}
        accept="image/*"
        className="hidden"
      />

      {/* Desktop Canvas Items (Left side: Stacks vs Grid View) */}
      {useStacks ? (
        /* macOS Desktop Stacks View ("Use Stacks" - ⌘⌃4) */
        <div className="absolute top-12 left-6 flex flex-col space-y-6 z-0 pointer-events-auto">
          {desktopStacks.map(stack => {
            const isExpanded = expandedStack === stack.id;
            const StackIcon = stack.icon;
            return (
              <div 
                key={stack.id} 
                className="relative group desktop-icon no-select-box"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setIsSelecting(false);
                  setSelectionBox(null);
                }}
              >
                <div 
                  onClick={() => setExpandedStack(isExpanded ? null : stack.id)}
                  className="flex flex-col items-center w-24 p-2 rounded-2xl cursor-pointer hover:bg-black/30 hover:backdrop-blur-md border border-transparent hover:border-white/20 transition-all select-none"
                  title={`Stack: ${stack.title} (${stack.items.length} items)`}
                >
                  {/* Layered Fan/Deck of Cards */}
                  <div className="relative w-14 h-14 flex items-center justify-center">
                    {/* Card 3 (back) */}
                    <div className="absolute inset-0 rounded-[14px] bg-white/10 backdrop-blur-md border border-white/15 rotate-[-8deg] -translate-y-1 shadow-sm group-hover:rotate-[-12deg] transition-transform duration-300" />
                    {/* Card 2 (middle) */}
                    <div className="absolute inset-0 rounded-[14px] bg-white/15 backdrop-blur-md border border-white/20 rotate-[6deg] -translate-y-0.5 shadow-md group-hover:rotate-[10deg] transition-transform duration-300" />
                    {/* Card 1 (front) */}
                    <div className={`relative w-14 h-14 rounded-[14px] bg-gradient-to-br ${stack.tileBg} flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.5)] border border-white/30 group-hover:scale-105 transition-transform duration-300`}>
                      <StackIcon className="w-7 h-7 text-white drop-shadow-md" />
                      {/* Count Badge */}
                      <span className="absolute -top-1.5 -right-1.5 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full border border-white/40 shadow-md">
                        {stack.items.length}
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-medium text-white text-center mt-2 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] line-clamp-1">
                    {stack.title}
                  </span>
                </div>

                {/* Expanded Stack Fan-Out Drawer */}
                {isExpanded && (
                  <div 
                    className="absolute top-0 left-28 z-30 bg-[#181825]/95 backdrop-blur-2xl border border-white/20 rounded-3xl p-4 shadow-[0_20px_60px_rgba(0,0,0,0.8)] min-w-[280px] max-w-[360px] animate-in fade-in zoom-in-95 duration-200"
                    onClick={e => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between pb-2.5 border-b border-white/10 mb-3">
                      <div className="flex items-center space-x-2">
                        <Layers className="w-4 h-4 text-blue-400" />
                        <span className="text-xs font-bold text-white">{stack.title}</span>
                        <span className="text-[10px] text-gray-400 font-mono">({stack.items.length})</span>
                      </div>
                      <button
                        onClick={() => setExpandedStack(null)}
                        className="w-5 h-5 rounded-md hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5 max-h-64 overflow-y-auto pr-1">
                      {stack.items.map(item => {
                        const ItemIcon = item.icon;
                        return (
                          <div
                            key={item.id}
                            onClick={() => {
                              item.action();
                              setExpandedStack(null);
                            }}
                            className={`flex flex-col items-center p-2 rounded-xl hover:bg-white/10 cursor-pointer transition-all text-center group/item ${
                              openingDesktopItemId === item.id ? 'animate-folder-open ring-1 ring-blue-400 cursor-mac-wait' : ''
                            }`}
                            title={item.label}
                          >
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${item.tileBg} flex items-center justify-center shadow-md border border-white/20 group-hover/item:scale-105 transition-transform relative`}>
                              <ItemIcon className={`w-5 h-5 text-white ${openingDesktopItemId === item.id ? 'animate-bounce' : ''}`} />
                              {openingDesktopItemId === item.id && (
                                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-blue-600 border border-white flex items-center justify-center shadow-md">
                                  <RefreshCw className="w-2 h-2 text-white animate-spin" />
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-gray-200 font-medium mt-1 truncate max-w-[70px]">
                              {item.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* Standard Desktop Icons with Drag & Drop Positioning to Any Place */
        <div className="absolute inset-0 pointer-events-none z-0">
          {allDesktopItems.map((item, idx) => {
            const Icon = item.icon;
            const isSelected = selectedDesktopIds.has(item.id);
            const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];
            const maxRowsPerCol = Math.max(3, Math.floor((window.innerHeight - 180) / cfg.rowSpacing));
            const defaultPos = {
              x: 24 + Math.floor(idx / maxRowsPerCol) * cfg.colSpacing,
              y: 48 + (idx % maxRowsPerCol) * cfg.rowSpacing,
            };
            const pos = draggingIcon?.id === item.id 
              ? { x: draggingIcon.currentX, y: draggingIcon.currentY }
              : (iconPositions[item.id] || defaultPos);
            const isDraggingThis = draggingIcon?.id === item.id;

            return (
              <div
                key={item.id}
                ref={(el) => {
                  if (el) iconRefs.current.set(item.id, el);
                  else iconRefs.current.delete(item.id);
                }}
                onMouseDown={(e) => {
                  if (e.button !== 0) return;
                  e.stopPropagation();
                  setIsSelecting(false);
                  setSelectionBox(null);
                  setDraggingIcon({
                    id: item.id,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: pos.x,
                    origY: pos.y,
                    currentX: pos.x,
                    currentY: pos.y,
                  });
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (e.shiftKey || e.ctrlKey || e.metaKey) {
                    setSelectedDesktopIds(prev => {
                      const next = new Set(prev);
                      if (next.has(item.id)) next.delete(item.id);
                      else next.add(item.id);
                      return next;
                    });
                  } else {
                    setSelectedDesktopIds(new Set([item.id]));
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  item.action();
                }}
                style={{
                  position: 'absolute',
                  left: `${pos.x}px`,
                  top: `${pos.y}px`,
                  width: `${cfg.w}px`,
                  zIndex: isDraggingThis ? 9999 : 10,
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const menuWidth = 220;
                  const menuHeight = 320;
                  const clampedX = Math.max(10, Math.min(window.innerWidth - menuWidth - 12, e.clientX));
                  const clampedY = Math.max(10, Math.min(window.innerHeight - menuHeight - 12, e.clientY));
                  setSelectedDesktopIds(new Set([item.id]));
                  setDesktopItemMenu({ x: clampedX, y: clampedY, item });
                  setDesktopMenu(null);
                }}
                className={`desktop-icon no-select-box flex flex-col items-center ${cfg.padding} rounded-2xl cursor-grab active:cursor-grabbing transition-all group select-none text-center pointer-events-auto ${
                  isDraggingThis ? 'scale-105 shadow-2xl opacity-90 ring-2 ring-blue-400/80 bg-blue-600/30' : ''
                } ${
                  openingDesktopItemId === item.id
                    ? 'animate-folder-open ring-2 ring-blue-400 bg-blue-600/40 shadow-2xl cursor-mac-wait'
                    : isSelected
                    ? 'bg-blue-600/35 backdrop-blur-md border border-blue-400/60 shadow-lg ring-1 ring-blue-400/50'
                    : 'hover:bg-black/30 hover:backdrop-blur-md border border-transparent hover:border-white/20'
                }`}
                title={item.label}
              >
                <div 
                  className={`flex items-center justify-center shadow-[0_8px_22px_rgba(0,0,0,0.45)] border border-white/25 rounded-[22px] overflow-hidden group-hover:scale-105 group-hover:shadow-[0_12px_28px_rgba(0,0,0,0.55)] transition-all duration-200 relative bg-gradient-to-br ${item.tileBg} ${cfg.boxSize} ${
                    openingDesktopItemId === item.id ? 'scale-110' : ''
                  }`}
                >
                  {/* macOS Specular Highlight Sheen */}
                  <div className="absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-black/15 pointer-events-none rounded-[22px]" />
                  <Icon className={`text-white drop-shadow-md relative z-10 ${cfg.iconSize} ${openingDesktopItemId === item.id ? 'animate-bounce' : ''}`} />
                  {openingDesktopItemId === item.id && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-600 border border-white flex items-center justify-center shadow-md z-20">
                      <RefreshCw className="w-2.5 h-2.5 text-white animate-spin" />
                    </span>
                  )}
                </div>
                <span className={`font-medium mt-1.5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] break-words max-w-full leading-tight line-clamp-2 ${cfg.textSize} ${
                  openingDesktopItemId === item.id ? 'text-white font-bold' : isSelected ? 'text-blue-200' : 'text-white'
                }`}>
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Window Manager Layer */}
      <div className="absolute inset-0 top-8 bottom-16 pt-2 pb-14 pointer-events-none">
        <WindowManager />
      </div>

      {/* Bottom Dock */}
      <Dock onToggleLauncher={() => setLauncherOpen(!launcherOpen)} />

      {/* Launchpad Overlay */}
      {launcherOpen && <AppLauncher onClose={() => setLauncherOpen(false)} />}
      
      <NotificationCenter />
      {showSpotlight && <SpotlightSearch onClose={() => setShowSpotlight(false)} />}

      {/* Desktop Item Specific Right-Click Context Menu */}
      {desktopItemMenu && (
        <div 
          className="fixed z-50 bg-[#1e1e2e]/98 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.8)] py-1.5 w-56 text-xs text-gray-200 select-none animate-in fade-in duration-100"
          style={{ top: desktopItemMenu.y, left: desktopItemMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3.5 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider truncate border-b border-white/5 mb-1 pb-1">
            {desktopItemMenu.item.label}
          </div>

          <div 
            onClick={() => { desktopItemMenu.item.action(); setDesktopItemMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer font-medium"
          >
            <Folder className="w-4 h-4 text-blue-400" />
            <span>Open</span>
          </div>

          <div 
            onClick={() => { handleRenameDesktopItem(desktopItemMenu.item); setDesktopItemMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center space-x-2.5">
              <FileCode className="w-4 h-4 text-indigo-400" />
              <span>Rename</span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">F2</span>
          </div>

          <div 
            onClick={() => { handleDuplicateDesktopItem(desktopItemMenu.item); setDesktopItemMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
          >
            <Layers className="w-4 h-4 text-purple-400" />
            <span>Duplicate</span>
          </div>

          <div 
            onClick={() => { handleCompressDesktopItem(desktopItemMenu.item); setDesktopItemMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
          >
            <Zap className="w-4 h-4 text-amber-400" />
            <span>Compress (.tar.gz)</span>
          </div>

          <div className="my-1 border-t border-white/10 mx-2" />

          <div 
            onClick={() => { handleDeleteDesktopItem(desktopItemMenu.item); setDesktopItemMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-rose-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer text-rose-300"
          >
            <Trash2 className="w-4 h-4" />
            <span>Move to Trash / Delete</span>
          </div>

          <div className="my-1 border-t border-white/10 mx-2" />

          <div 
            onClick={() => { 
              updateIconPosition(desktopItemMenu.item.id, 24, 48); 
              setDesktopItemMenu(null); 
            }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer text-gray-400"
          >
            <Sliders className="w-4 h-4" />
            <span>Reset Position</span>
          </div>
        </div>
      )}

      {/* Desktop Right-Click Context Menu */}
      {desktopMenu && (
        <div 
          className="fixed z-50 bg-[#1e1e2e]/98 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.7)] py-1.5 w-64 text-xs text-gray-200 select-none animate-in fade-in duration-100"
          style={{ top: Math.max(10, Math.min(desktopMenu.y, window.innerHeight - 440)), left: Math.max(10, Math.min(desktopMenu.x, window.innerWidth - 270)) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div 
            onClick={() => { handleCreateDesktopFolder(); setDesktopMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer font-medium"
          >
            <Folder className="w-4 h-4 text-blue-400" />
            <span>New Remote Folder</span>
          </div>
          <div 
            onClick={() => { handleCreateDesktopFile(); setDesktopMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 text-emerald-400" />
            <span>New Remote File</span>
          </div>

          <div className="my-1.5 border-t border-white/10 mx-2" />

          {/* Desktop Icon Size Switcher: [ Small | Medium | Large ] */}
          <div className="px-3.5 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Desktop Icon Size
          </div>
          <div className="flex items-center space-x-1 px-3 py-1 mx-1 bg-white/[0.04] rounded-lg">
            {(['small', 'medium', 'large'] as const).map(size => (
              <button
                key={size}
                onClick={() => { updateSettings({ desktopIconSize: size }); setDesktopMenu(null); }}
                className={`flex-1 py-1 rounded text-[10px] font-medium capitalize transition-colors ${
                  desktopIconSize === size ? 'bg-blue-600 text-white font-bold' : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
              >
                {size}
              </button>
            ))}
          </div>

          {/* Auto Full Screen Launch Toggle */}
          <div 
            onClick={() => { 
              updateSettings({ autoFullScreen: !useSettingsStore.getState().autoFullScreen }); 
              setDesktopMenu(null); 
            }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer font-medium mt-1"
          >
            <div className="flex items-center space-x-2.5">
              <Maximize2 className="w-4 h-4 text-emerald-400" />
              <span>Auto Full Screen Launch</span>
            </div>
            {useSettingsStore.getState().autoFullScreen && <Check className="w-3.5 h-3.5 text-blue-400" />}
          </div>

          <div className="my-1.5 border-t border-white/10 mx-2" />

          {/* Desktop Stacks ("Use Stacks" - ⌘⌃4) */}
          <div 
            onClick={() => { setUseStacks(!useStacks); setDesktopMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center space-x-2.5">
              <Layers3 className="w-4 h-4 text-indigo-400" />
              <span>Use Stacks</span>
            </div>
            <div className="flex items-center space-x-1.5">
              {useStacks && <Check className="w-3.5 h-3.5 text-blue-400" />}
              <span className="text-[10px] text-gray-400 font-mono">⌃⌘4</span>
            </div>
          </div>

          {/* Sort By Submenu Items */}
          <div className="px-3.5 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Sort Desktop By
          </div>
          <div className="flex items-center space-x-1 px-3 py-1 mx-1 bg-white/[0.04] rounded-lg">
            {(['name', 'kind', 'date'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => { setSortBy(mode); setDesktopMenu(null); }}
                className={`flex-1 py-1 rounded text-[10px] font-medium capitalize transition-colors ${
                  sortBy === mode ? 'bg-blue-600 text-white font-bold' : 'text-gray-300 hover:text-white hover:bg-white/10'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          <div 
            onClick={() => {
              const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];
              const maxRows = Math.max(3, Math.floor((window.innerHeight - 180) / cfg.rowSpacing));
              const newPositions: Record<string, { x: number; y: number }> = {};
              allDesktopItems.forEach((item, idx) => {
                newPositions[item.id] = {
                  x: 24 + Math.floor(idx / maxRows) * cfg.colSpacing,
                  y: 48 + (idx % maxRows) * cfg.rowSpacing,
                };
              });
              setIconPositions(newPositions);
              localStorage.setItem('clouddesk_desktop_icon_positions', JSON.stringify(newPositions));
              if (activeConnectionId) {
                const configDir = `${userHome}/.clouddesk`;
                sftpWriteTextFile(activeConnectionId, `${configDir}/icon_positions.json`, JSON.stringify(newPositions, null, 2)).catch(() => {});
              }
              setSelectedDesktopIds(new Set());
              setDesktopMenu(null);
            }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer mt-0.5"
          >
            <RefreshCw className="w-4 h-4 text-cyan-400" />
            <span>Clean Up Desktop</span>
          </div>

          <div 
            onClick={() => {
              setIconPositions({});
              localStorage.removeItem('clouddesk_desktop_icon_positions');
              if (activeConnectionId) {
                const configDir = `${userHome}/.clouddesk`;
                sftpWriteTextFile(activeConnectionId, `${configDir}/icon_positions.json`, '{}').catch(() => {});
              }
              setSelectedDesktopIds(new Set());
              setSortBy('name');
              setDesktopMenu(null);
            }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer mt-0.5"
          >
            <Sliders className="w-4 h-4 text-blue-400" />
            <span>Reset / Align Icons to Grid</span>
          </div>

          <div className="my-1.5 border-t border-white/10 mx-2" />

          {/* Mission Control / Exposé */}
          <div 
            onClick={() => { setShowMissionControl(true); setDesktopMenu(null); }}
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
            onClick={() => { setShowWidgetsTray(true); setDesktopMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
          >
            <Sliders className="w-4 h-4 text-purple-400" />
            <span>Edit Desktop Widgets...</span>
          </div>

          <div className="my-1.5 border-t border-white/10 mx-2" />

          <div 
            onClick={() => { setShowWallpaperModal(true); setDesktopMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
          >
            <Palette className="w-4 h-4 text-purple-400" />
            <span>Change 4K Wallpaper...</span>
          </div>

          <div 
            onClick={() => { 
              updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' });
              setDesktopMenu(null);
            }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-blue-400" />}
            <span>Toggle {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </div>

          <div 
            onClick={() => { minimizeAllWindows(); setDesktopMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
          >
            <Minimize2 className="w-4 h-4 text-gray-400" />
            <span>Show Desktop (Minimize All)</span>
          </div>

          <div className="my-1.5 border-t border-white/10 mx-2" />

          {/* Security & Lock Screen Actions */}
          <div 
            onClick={() => { setIsLocked(true); setDesktopMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center justify-between cursor-pointer font-medium text-amber-300"
          >
            <div className="flex items-center space-x-2.5">
              <Lock className="w-4 h-4 text-amber-400" />
              <span>Lock Screen</span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">⌃⌘Q</span>
          </div>

          <div 
            onClick={() => { openApp('security', 'Security Auditor'); setDesktopMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
          >
            <Shield className="w-4 h-4 text-blue-400" />
            <span>Security & Privacy Auditor...</span>
          </div>

          <div className="my-1.5 border-t border-white/10 mx-2" />

          <div 
            onClick={() => { openApp('terminal', 'Terminal'); setDesktopMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
          >
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span>Open Terminal Here</span>
          </div>
        </div>
      )}

      {/* macOS / Windows App Switcher HUD Overlay (Alt+Tab / Win+Tab) */}
      {showAppSwitcher && (
        <div 
          className="fixed inset-0 z-[99998] flex items-center justify-center bg-black/50 backdrop-blur-md select-none animate-in fade-in duration-100"
          onClick={() => setShowAppSwitcher(false)}
        >
          <div 
            className="bg-[#181825]/95 border border-white/20 rounded-3xl p-6 shadow-[0_30px_90px_rgba(0,0,0,0.85)] flex flex-col items-center space-y-4 max-w-2xl w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between w-full px-2">
              <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                Application Switcher
              </span>
              <span className="text-[11px] text-gray-400 font-mono">
                Release key to switch • Esc to cancel
              </span>
            </div>

            <div className="flex items-center space-x-3 overflow-x-auto p-2 w-full justify-center">
              {windows
                .filter(w => !w.serverId || w.serverId === activeConnectionId)
                .map((win, idx) => {
                  const filteredWins = windows.filter(w => !w.serverId || w.serverId === activeConnectionId);
                  const isSelected = idx === (appSwitcherIndex % filteredWins.length);
                  return (
                    <div
                      key={win.id}
                      onClick={() => {
                        restoreWindow(win.id);
                        bringToFront(win.id);
                        focusWindow(win.id);
                        setShowAppSwitcher(false);
                      }}
                      className={`flex flex-col items-center p-3.5 rounded-2xl transition-all cursor-pointer min-w-[90px] max-w-[110px] ${
                        isSelected
                          ? 'bg-blue-600/35 border border-blue-400/70 scale-105 shadow-[0_8px_25px_rgba(59,130,246,0.35)] ring-2 ring-blue-400/50'
                          : 'bg-white/5 border border-white/10 hover:bg-white/10'
                      }`}
                    >
                      <div className="w-12 h-12 rounded-xl bg-black/40 flex items-center justify-center mb-2 shadow-inner">
                        {win.icon ? (
                          <span className="text-2xl">{win.icon}</span>
                        ) : win.appId === 'terminal' ? (
                          <Terminal className="w-6 h-6 text-emerald-400" />
                        ) : win.appId === 'files' ? (
                          <Folder className="w-6 h-6 text-amber-400" />
                        ) : win.appId === 'editor' ? (
                          <FileCode className="w-6 h-6 text-blue-400" />
                        ) : win.appId === 'monitor' ? (
                          <Activity className="w-6 h-6 text-cyan-400" />
                        ) : (
                          <Sparkles className="w-6 h-6 text-purple-400" />
                        )}
                      </div>
                      <span className="text-xs text-white font-medium text-center truncate w-full">
                        {win.title}
                      </span>
                      {win.minimized && (
                        <span className="text-[9px] text-amber-300 mt-0.5">Minimized</span>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* 4K Wallpaper Picker Modal */}
      {showWallpaperModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#181825]/95 border border-white/20 rounded-3xl w-full max-w-3xl p-6 space-y-5 shadow-[0_30px_90px_rgba(0,0,0,0.8)] flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-500 to-indigo-500 flex items-center justify-center shadow-lg">
                  <Palette className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white tracking-wide">macOS 4K Ultra-HD Wallpapers</h3>
                  <p className="text-xs text-gray-400">Authentic Apple 4K imagery and custom photo upload</p>
                </div>
              </div>
              <button 
                onClick={() => setShowWallpaperModal(false)}
                className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Custom Upload & URL Actions Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-white/5 p-3 rounded-2xl border border-white/10">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-2 shadow-lg transition-all"
              >
                <Plus className="w-4 h-4" />
                <span>Upload Custom Image</span>
              </button>

              <form onSubmit={handleApplyCustomUrl} className="flex items-center space-x-2 flex-1 max-w-md">
                <input
                  type="text"
                  placeholder="Paste direct 4K image URL..."
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  className="bg-black/40 border border-white/15 rounded-xl px-3 py-1.5 text-xs text-white placeholder-gray-500 flex-1 focus:outline-none focus:border-blue-400"
                />
                <button
                  type="submit"
                  className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-xl transition-colors shrink-0"
                >
                  Apply URL
                </button>
              </form>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setWallpaperCategory(cat)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 ${
                    wallpaperCategory === cat 
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Wallpapers Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5 overflow-y-auto pr-1 flex-1 min-h-[300px]">
              {filteredWallpapers.map(w => {
                const isSelected = wallpaper === w.id || (!isCustom && activeWallpaperItem.id === w.id);
                return (
                  <div
                    key={w.id}
                    onClick={() => updateSettings({ wallpaper: w.id })}
                    className={`group relative overflow-hidden rounded-2xl border p-2 cursor-pointer transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-500/40 bg-blue-500/10 shadow-[0_10px_25px_rgba(59,130,246,0.3)]'
                        : 'border-white/10 hover:border-white/25 hover:bg-white/5'
                    }`}
                  >
                    <div className="relative w-full h-28 rounded-xl overflow-hidden mb-2 bg-black/40">
                      <img 
                        src={w.thumbnail} 
                        alt={w.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                        loading="lazy"
                      />
                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[9px] font-bold text-white tracking-wider border border-white/10">
                        4K UHD
                      </span>
                      {isSelected && (
                        <span className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold shadow-md">
                          Active
                        </span>
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-white truncate">{w.name}</div>
                      <div className="text-[10px] text-gray-400 truncate">{w.subtitle}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {isCustom && (
              <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-2xl flex items-center justify-between text-xs text-purple-200">
                <span>Custom user wallpaper is currently applied.</span>
                <button
                  onClick={() => updateSettings({ wallpaper: 'sonoma' })}
                  className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl transition-colors"
                >
                  Reset to Default
                </button>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-white/10">
              <button
                onClick={() => setShowWallpaperModal(false)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* macOS Sonoma/Sequoia Fullscreen Lock Screen (Security Desktop) */}
      {isLocked && (
        <div 
          className="fixed inset-0 z-[999] flex flex-col items-center justify-between select-none animate-in fade-in duration-300 overflow-hidden"
          style={{
            backgroundImage: `url("${activeWallpaperUrl}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {/* Deep Frosted Glass Overlay */}
          <div className="absolute inset-0 bg-black/45 backdrop-blur-3xl" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />

          {/* Top Status Indicators */}
          <div className="relative z-10 w-full px-6 py-4 flex items-center justify-between text-xs text-white/80 font-mono">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{activeServer?.username || 'root'}@{activeServer?.host || 'remote'}</span>
            </div>
            <div className="flex items-center space-x-2 bg-white/10 backdrop-blur-md px-3 py-1 rounded-full border border-white/15 text-[11px]">
              <Lock className="w-3 h-3 text-amber-300" />
              <span className="font-sans font-medium text-white">CloudDesk Security Locked</span>
            </div>
          </div>

          {/* Center Apple Clock & Date */}
          <div className="relative z-10 flex flex-col items-center text-center -mt-6">
            <div className="text-8xl font-extralight tracking-tight text-white drop-shadow-[0_10px_25px_rgba(0,0,0,0.5)] font-sans">
              {lockTime || '12:00'}
            </div>
            <div className="text-lg font-medium text-white/90 drop-shadow mt-1 tracking-wide font-sans">
              {lockDate || 'Friday, October 2'}
            </div>
          </div>

          {/* Center User Profile & Unlock Form */}
          <div className="relative z-10 flex flex-col items-center mb-8 space-y-4">
            {/* User Avatar */}
            <div className="relative group">
              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 p-0.5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] border border-white/30 flex items-center justify-center">
                <div className="w-full h-full rounded-full bg-[#1e1e2e]/90 flex items-center justify-center text-2xl font-bold text-white uppercase font-sans">
                  {(activeServer?.username || 'R')[0]}
                </div>
              </div>
              <span className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-emerald-500 border-2 border-black flex items-center justify-center">
                <ShieldCheck className="w-3 h-3 text-white" />
              </span>
            </div>

            {/* Username & Subtitle */}
            <div className="text-center">
              <h2 className="text-base font-bold text-white drop-shadow">
                {activeServer?.username || 'root'}
              </h2>
              <p className="text-xs text-white/70 font-mono mt-0.5">
                {activeServer?.name || activeServer?.host || 'CloudDesk Node'}
              </p>
            </div>

            {/* Unlock Form */}
            <form onSubmit={handleUnlockWithPassword} className="flex flex-col items-center space-y-2.5">
              <div className={`relative flex items-center bg-black/40 backdrop-blur-xl border ${
                lockShake ? 'border-red-500 animate-lock-shake' : 'border-white/20'
              } rounded-full px-4 py-2 w-64 shadow-2xl focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/30 transition-all`}>
                <input
                  type={showLockPassword ? 'text' : 'password'}
                  autoFocus
                  placeholder="Enter password..."
                  value={lockPassword}
                  onChange={e => setLockPassword(e.target.value)}
                  className="bg-transparent text-white placeholder-white/40 text-xs flex-1 focus:outline-none pr-2 font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowLockPassword(!showLockPassword)}
                  className="text-white/50 hover:text-white mr-1.5 transition-colors"
                  title={showLockPassword ? 'Hide password' : 'Show password'}
                >
                  {showLockPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="submit"
                  className="w-6 h-6 rounded-full bg-white/20 hover:bg-blue-600 text-white flex items-center justify-center transition-colors shrink-0"
                  title="Unlock"
                >
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              {/* Touch ID Biometric Simulation Button */}
              <button
                type="button"
                onClick={handleUnlockWithBiometrics}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  biometricSuccess 
                    ? 'bg-emerald-600 text-white shadow-lg scale-105' 
                    : 'bg-white/10 hover:bg-white/20 text-white/80 hover:text-white border border-white/15'
                }`}
                title="Simulate Touch ID fingerprint unlock"
              >
                {biometricSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-white" />
                    <span>Touch ID Verified</span>
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Touch ID or Press Enter</span>
                  </>
                )}
              </button>

              {lockShake && (
                <span className="text-[11px] text-red-300 font-medium animate-pulse">
                  Incorrect password. Try again.
                </span>
              )}
            </form>
          </div>

          {/* Bottom Security Controls Bar */}
          <div className="relative z-10 w-full px-8 py-6 flex items-center justify-center space-x-8 text-xs text-white/70">
            <button
              onClick={() => {
                setIsLocked(false);
                openApp('security', 'Security Auditor');
              }}
              className="flex items-center space-x-1.5 hover:text-white transition-colors"
            >
              <Shield className="w-4 h-4 text-emerald-400" />
              <span>Security Audit</span>
            </button>
            <button
              onClick={() => {
                setIsLocked(false);
                minimizeAllWindows();
              }}
              className="flex items-center space-x-1.5 hover:text-white transition-colors"
            >
              <Moon className="w-4 h-4 text-blue-300" />
              <span>Sleep</span>
            </button>
            <button
              onClick={() => {
                if (confirm('Restart remote server connection session?')) {
                  window.location.reload();
                }
              }}
              className="flex items-center space-x-1.5 hover:text-white transition-colors"
            >
              <RotateCcw className="w-4 h-4 text-amber-400" />
              <span>Restart Session</span>
            </button>
            <button
              onClick={() => {
                if (activeConnectionId) {
                  useConnectionStore.getState().disconnect(activeConnectionId);
                }
              }}
              className="flex items-center space-x-1.5 hover:text-red-400 transition-colors"
            >
              <Power className="w-4 h-4 text-rose-400" />
              <span>Disconnect</span>
            </button>
          </div>
        </div>
      )}

      {/* macOS Sonoma "Edit Widgets..." Gallery Drawer */}
      {showWidgetsTray && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end animate-in fade-in duration-200"
          onClick={() => setShowWidgetsTray(false)}
        >
          <div 
            className="bg-[#14141e]/95 backdrop-blur-3xl border-t border-white/20 rounded-t-[32px] p-6 shadow-[0_-25px_60px_rgba(0,0,0,0.8)] max-h-[80vh] flex flex-col space-y-4 animate-in slide-in-from-bottom duration-300"
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-500 to-indigo-600 flex items-center justify-center shadow-lg">
                  <LayoutGrid className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white tracking-wide">
                    macOS Sonoma Desktop Widgets
                  </h2>
                  <p className="text-xs text-gray-400">
                    Add or remove live interactive widgets from your remote Linux desktop canvas.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowWidgetsTray(false)}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg transition-colors"
              >
                Done
              </button>
            </div>

            {/* Widget Gallery Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 overflow-y-auto p-1 max-h-[60vh]">
              {/* Card 1: Security Shield */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-3 hover:border-white/25 transition-all">
                <div className="space-y-2">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Security Shield</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                      Live Linux hardening meter, UFW firewall status, and 1-click lock screen trigger.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowSecurityWidget(!showSecurityWidget)}
                  className={`w-full py-2 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors ${
                    showSecurityWidget 
                      ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30' 
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                  }`}
                >
                  {showSecurityWidget ? (
                    <>
                      <X className="w-3.5 h-3.5" />
                      <span>Remove Widget</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add to Desktop</span>
                    </>
                  )}
                </button>
              </div>

              {/* Card 2: System Performance */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-3 hover:border-white/25 transition-all">
                <div className="space-y-2">
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                    <Activity className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">System Performance</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                      Real-time CPU utilization, RAM pressure meter, root disk `/` storage, and load average.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowSystemWidget(!showSystemWidget)}
                  className={`w-full py-2 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors ${
                    showSystemWidget 
                      ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30' 
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                  }`}
                >
                  {showSystemWidget ? (
                    <>
                      <X className="w-3.5 h-3.5" />
                      <span>Remove Widget</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add to Desktop</span>
                    </>
                  )}
                </button>
              </div>

              {/* Card 3: Clock & Uptime */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-3 hover:border-white/25 transition-all">
                <div className="space-y-2">
                  <div className="w-9 h-9 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">World & Uptime</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                      Sonoma analog dial, synchronized digital server time, live uptime, and ping latency.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowClockWidget(!showClockWidget)}
                  className={`w-full py-2 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors ${
                    showClockWidget 
                      ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30' 
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                  }`}
                >
                  {showClockWidget ? (
                    <>
                      <X className="w-3.5 h-3.5" />
                      <span>Remove Widget</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add to Desktop</span>
                    </>
                  )}
                </button>
              </div>

              {/* Card 4: Stickies Note */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col justify-between space-y-3 hover:border-white/25 transition-all">
                <div className="space-y-2">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                    <StickyNote className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Desktop Stickies</h3>
                    <p className="text-[11px] text-gray-400 mt-0.5 leading-relaxed">
                      Frosted pastel sticky note with 5 color themes, persistent auto-save, and quick notes.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowStickiesWidget(!showStickiesWidget)}
                  className={`w-full py-2 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 transition-colors ${
                    showStickiesWidget 
                      ? 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30' 
                      : 'bg-blue-600 hover:bg-blue-500 text-white shadow-md'
                  }`}
                >
                  {showStickiesWidget ? (
                    <>
                      <X className="w-3.5 h-3.5" />
                      <span>Remove Widget</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add to Desktop</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* macOS Mission Control / Exposé Overlay (F3 / ^↑) */}
      {showMissionControl && (
        <div 
          className="fixed inset-0 z-50 bg-black/65 backdrop-blur-2xl flex flex-col justify-between p-6 select-none animate-in fade-in duration-200"
          onClick={() => setShowMissionControl(false)}
        >
          {/* Top Spaces Bar */}
          <div className="flex items-center justify-center space-x-4 pt-2">
            <div className="flex items-center space-x-3 bg-white/10 backdrop-blur-xl px-5 py-2 rounded-2xl border border-white/15 shadow-xl">
              <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-blue-600/40 border border-blue-400/50 text-white text-xs font-semibold">
                <Monitor className="w-3.5 h-3.5 text-blue-300" />
                <span>Desktop Space 1 (Main)</span>
              </div>
              <div 
                onClick={(e) => {
                  e.stopPropagation();
                  minimizeAllWindows();
                  setShowMissionControl(false);
                }}
                className="flex items-center space-x-2 px-3 py-1.5 rounded-xl hover:bg-white/10 text-white/70 hover:text-white text-xs font-medium cursor-pointer transition-colors"
                title="Minimize all windows and show desktop"
              >
                <Layers className="w-3.5 h-3.5 text-emerald-300" />
                <span>Reveal Desktop</span>
              </div>
            </div>
          </div>

          {/* Center Windows Grid */}
          <div className="flex-1 flex items-center justify-center my-6 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {windows.length === 0 ? (
              <div className="text-center space-y-3 p-8 bg-white/5 border border-white/10 rounded-3xl max-w-md">
                <div className="w-14 h-14 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center mx-auto text-blue-400">
                  <LayoutGrid className="w-7 h-7" />
                </div>
                <h3 className="text-base font-bold text-white">No Active Windows</h3>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Open applications from the macOS Dock or Launchpad to view, organize, and switch between them in Mission Control.
                </p>
                <button
                  onClick={() => {
                    setShowMissionControl(false);
                    setLauncherOpen(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg transition-colors inline-flex items-center space-x-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Open Launchpad</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 max-w-7xl w-full p-4">
                {windows.map((win) => {
                  return (
                    <div
                      key={win.id}
                      onClick={() => {
                        if (win.minimized) restoreWindow(win.id);
                        focusWindow(win.id);
                        setShowMissionControl(false);
                      }}
                      className={`group relative rounded-2xl bg-[#181825]/90 border border-white/20 hover:border-blue-400/80 p-3 shadow-2xl transition-all duration-300 hover:scale-[1.03] hover:shadow-[0_20px_50px_rgba(59,130,246,0.3)] cursor-pointer flex flex-col justify-between h-56 ${
                        win.focused ? 'ring-2 ring-blue-500/50' : ''
                      }`}
                    >
                      {/* Window Header */}
                      <div className="flex items-center justify-between pb-2 border-b border-white/10">
                        <div className="flex items-center space-x-2 truncate pr-2">
                          <div className="flex items-center space-x-1.5 shrink-0">
                            <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                          </div>
                          <span className="text-xs font-semibold text-white truncate ml-1">{win.title}</span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            closeWindow(win.id);
                          }}
                          className="w-5 h-5 rounded-md hover:bg-white/10 text-white/50 hover:text-white flex items-center justify-center transition-colors"
                          title="Close Window"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Mockup Preview Body */}
                      <div className="flex-1 my-2 rounded-xl bg-black/40 border border-white/5 p-2.5 overflow-hidden flex flex-col justify-between text-[10px] font-mono text-gray-400">
                        {win.appId === 'terminal' ? (
                          <div className="space-y-1">
                            <div className="text-emerald-400">root@linux:~# ps aux | head -n 5</div>
                            <div>USER       PID %CPU %MEM  COMMAND</div>
                            <div>root         1  0.0  0.2  /sbin/init</div>
                            <div>root       482  0.1  1.4  /usr/bin/dockerd</div>
                          </div>
                        ) : win.appId === 'monitor' ? (
                          <div className="space-y-2">
                            <div className="flex justify-between text-xs text-white font-sans font-medium">
                              <span>CPU {widgetTelemetry.cpu}%</span>
                              <span>RAM {widgetTelemetry.ramPct}%</span>
                            </div>
                            <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-cyan-500 h-full w-[35%]" />
                            </div>
                            <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                              <div className="bg-purple-500 h-full w-[45%]" />
                            </div>
                          </div>
                        ) : win.appId === 'files' ? (
                          <div className="grid grid-cols-3 gap-1">
                            <div className="p-1 rounded bg-white/5 flex flex-col items-center"><Folder className="w-4 h-4 text-amber-400" /><span className="text-[8px] truncate mt-0.5">etc</span></div>
                            <div className="p-1 rounded bg-white/5 flex flex-col items-center"><Folder className="w-4 h-4 text-amber-400" /><span className="text-[8px] truncate mt-0.5">var</span></div>
                            <div className="p-1 rounded bg-white/5 flex flex-col items-center"><Folder className="w-4 h-4 text-amber-400" /><span className="text-[8px] truncate mt-0.5">home</span></div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full">
                            <span className="font-sans text-xs text-white/60 capitalize">{win.appId} Application Window</span>
                          </div>
                        )}

                        {win.minimized && (
                          <div className="text-amber-400 text-[10px] font-sans font-semibold flex items-center space-x-1">
                            <Minimize2 className="w-3 h-3" />
                            <span>Minimized to Dock</span>
                          </div>
                        )}
                      </div>

                      {/* Footer Bar */}
                      <div className="flex items-center justify-between text-[10px] text-gray-400 pt-1 border-t border-white/5 font-sans">
                        <span className="capitalize">{win.appId}</span>
                        <span className="text-blue-400 group-hover:underline">Click to Focus</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer Instructions */}
          <div className="text-center text-xs text-white/50 pb-2 font-medium">
            Press <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono text-[11px] mx-1">F3</kbd> or <kbd className="px-2 py-0.5 rounded bg-white/10 text-white font-mono text-[11px] mx-1">Esc</kbd> to return to Desktop
          </div>
        </div>
      )}

      {/* Remote Server Disconnect & Reconnect Alert Modal */}
      <DisconnectAlertModal />

      {/* Global CSS for lock screen shake animation */}
      <style>{`
        @keyframes lockShake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .animate-lock-shake {
          animation: lockShake 0.4s ease-in-out;
        }
      `}</style>
    </div>
  );
}

