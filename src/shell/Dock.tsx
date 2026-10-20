import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal, Folder, FileCode, Monitor, Activity, Settings,
  Container, Server, ScrollText, Globe, Package, Users,
  Clock, Database, Shield, HardDrive, Flame, Variable,
  Rocket, KeyRound, Compass, Send, StickyNote
} from 'lucide-react';
import { useWindowManager } from '../lib/hooks/useWindowManager';
import { useSettingsStore, useWindowStore } from '../lib/store';

export interface DockAppConfig {
  id: string;
  icon: React.ElementType;
  label: string;
  tileBg: string;
  iconColor: string;
}

// 1. Core Workstation Software
const CORE_APPS: DockAppConfig[] = [
  { id: 'terminal', icon: Terminal, label: 'Terminal', tileBg: 'from-[#334155] via-[#1e293b] to-[#0f172a]', iconColor: '#4ade80' },
  { id: 'files', icon: Folder, label: 'File Manager', tileBg: 'from-[#38bdf8] via-[#0284c7] to-[#0369a1]', iconColor: '#ffffff' },
  { id: 'editor', icon: FileCode, label: 'Code Editor', tileBg: 'from-[#6366f1] via-[#4f46e5] to-[#3730a3]', iconColor: '#ffffff' },
  { id: 'ssh', icon: KeyRound, label: 'SSH Studio', tileBg: 'from-[#0ea5e9] via-[#2563eb] to-[#1e1b4b]', iconColor: '#38bdf8' },
  { id: 'browser', icon: Compass, label: 'Private Web Browser', tileBg: 'from-[#06b6d4] via-[#0284c7] to-[#1d4ed8]', iconColor: '#38bdf8' },
  { id: 'api', icon: Send, label: 'API Studio (SSH Tunnel)', tileBg: 'from-[#6366f1] via-[#8b5cf6] to-[#d946ef]', iconColor: '#ffffff' },
];

// 2. Monitoring & DevOps Software
const OPS_APPS: DockAppConfig[] = [
  { id: 'monitor', icon: Monitor, label: 'Activity Monitor', tileBg: 'from-[#06b6d4] via-[#0891b2] to-[#0e7490]', iconColor: '#ffffff' },
  { id: 'processes', icon: Activity, label: 'Process Manager', tileBg: 'from-[#ec4899] via-[#db2777] to-[#9d174d]', iconColor: '#ffffff' },
  { id: 'services', icon: Server, label: 'Services (Systemd)', tileBg: 'from-[#a855f7] via-[#9333ea] to-[#6b21a8]', iconColor: '#ffffff' },
  { id: 'docker', icon: Container, label: 'Docker Containers', tileBg: 'from-[#0284c7] via-[#0369a1] to-[#075985]', iconColor: '#38bdf8' },
  { id: 'logs', icon: ScrollText, label: 'Console Logs', tileBg: 'from-[#f97316] via-[#ea580c] to-[#c2410c]', iconColor: '#ffffff' },
  { id: 'env', icon: Variable, label: 'Environment Variables', tileBg: 'from-[#ec4899] via-[#8b5cf6] to-[#6366f1]', iconColor: '#ffffff' },
];

// 3. Infrastructure & Administration Software
const ADMIN_APPS: DockAppConfig[] = [
  { id: 'database', icon: Database, label: 'Database Studio', tileBg: 'from-[#06b6d4] via-[#0284c7] to-[#1d4ed8]', iconColor: '#ffffff' },
  { id: 'disks', icon: HardDrive, label: 'Disk Manager', tileBg: 'from-[#64748b] via-[#475569] to-[#334155]', iconColor: '#38bdf8' },
  { id: 'network', icon: Globe, label: 'Network & Ports', tileBg: 'from-[#14b8a6] via-[#0d9488] to-[#0f766e]', iconColor: '#ffffff' },
  { id: 'firewall', icon: Flame, label: 'Firewall (UFW)', tileBg: 'from-[#f97316] via-[#ea580c] to-[#dc2626]', iconColor: '#ffffff' },
  { id: 'packages', icon: Package, label: 'Package Manager', tileBg: 'from-[#f43f5e] via-[#e11d48] to-[#be123c]', iconColor: '#ffffff' },
  { id: 'users', icon: Users, label: 'Users & Groups', tileBg: 'from-[#3b82f6] via-[#2563eb] to-[#1d4ed8]', iconColor: '#ffffff' },
  { id: 'cron', icon: Clock, label: 'Cron Scheduler', tileBg: 'from-[#f59e0b] via-[#d97706] to-[#b45309]', iconColor: '#ffffff' },
  { id: 'security', icon: Shield, label: 'Security Auditor', tileBg: 'from-[#10b981] via-[#059669] to-[#047857]', iconColor: '#ffffff' },
];

const KNOWN_ICONS: Record<string, React.ElementType> = {
  terminal: Terminal,
  files: Folder,
  editor: FileCode,
  ssh: KeyRound,
  browser: Compass,
  api: Send,
  monitor: Monitor,
  processes: Activity,
  services: Server,
  docker: Container,
  logs: ScrollText,
  env: Variable,
  database: Database,
  disks: HardDrive,
  network: Globe,
  firewall: Flame,
  packages: Package,
  users: Users,
  cron: Clock,
  security: Shield,
  notes: StickyNote,
  settings: Settings,
};

export default function Dock({ 
  onToggleLauncher 
}: { 
  onToggleLauncher: () => void; 
}) {
  const { openApp, windows, launchingAppId } = useWindowManager();
  const { minimizeWindow, restoreWindow, focusWindow, bringToFront } = useWindowStore();
  const { autoHideDock, theme, dockPosition, dockAlignment } = useSettingsStore();
  const [isHovered, setIsHovered] = useState(false);

  const isLight = theme === 'light';
  const isLeftDock = dockPosition === 'left';
  const isLeftAligned = dockAlignment === 'left' && !isLeftDock;

  // Global mousemove detection for Auto-Hide Dock
  useEffect(() => {
    if (!autoHideDock) {
      setIsHovered(false);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (isLeftDock) {
        if (e.clientX <= 10) {
          setIsHovered(true);
        } else if (isHovered && e.clientX > 85) {
          setIsHovered(false);
        }
      } else {
        if (e.clientY >= window.innerHeight - 10) {
          setIsHovered(true);
        } else if (isHovered && e.clientY < window.innerHeight - 85) {
          setIsHovered(false);
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [autoHideDock, isHovered, isLeftDock]);

  // Handle click on dock item: toggle focus/minimize or launch
  const handleDockItemClick = (appId: string, appLabel: string) => {
    const existing = windows.find(w => w.appId === appId);
    if (existing) {
      if (existing.minimized) {
        restoreWindow(existing.id);
        bringToFront(existing.id);
        focusWindow(existing.id);
      } else if (existing.focused) {
        minimizeWindow(existing.id);
      } else {
        bringToFront(existing.id);
        focusWindow(existing.id);
      }
    } else {
      openApp(appId, appLabel);
    }
  };

  const isDockVisible = !autoHideDock || isHovered;

  // Identify all pinned IDs
  const pinnedAppIds = new Set<string>([
    ...CORE_APPS.map(a => a.id),
    ...OPS_APPS.map(a => a.id),
    ...ADMIN_APPS.map(a => a.id),
    'settings'
  ]);

  // Identify running apps that are NOT pinned
  const dynamicRunningApps = windows.reduce((acc, win) => {
    if (!pinnedAppIds.has(win.appId) && !acc.some(a => a.id === win.appId)) {
      acc.push({
        id: win.appId,
        label: win.title || win.appId,
        icon: KNOWN_ICONS[win.appId] || Terminal,
        tileBg: 'from-[#6366f1] via-[#8b5cf6] to-[#a855f7]',
        iconColor: '#ffffff'
      });
    }
    return acc;
  }, [] as DockAppConfig[]);

  // Render a dock divider
  const renderDivider = (key: string) => (
    <div 
      key={key}
      className={`shrink-0 rounded-full ${
        isLeftDock ? 'w-6 h-px my-1' : 'w-px h-6 mx-1'
      } ${isLight ? 'bg-black/15' : 'bg-white/15'}`} 
    />
  );

  return (
    <>
      {/* Auto-Hide Hover Trigger Area */}
      {autoHideDock && (
        <div 
          onMouseEnter={() => setIsHovered(true)}
          className={`fixed z-[999997] pointer-events-auto ${
            isLeftDock ? 'top-0 bottom-0 left-0 w-3' : 'bottom-0 left-0 right-0 h-3'
          }`}
        />
      )}

      {/* Dock Container - Pixel-Perfect Professional Alignment */}
      <div 
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          if (autoHideDock) setIsHovered(false);
        }}
        className={`fixed z-[999998] pointer-events-auto transition-all duration-300 ease-out ${
          isLeftDock
            ? 'left-2 top-1/2 -translate-y-1/2'
            : isLeftAligned
            ? 'bottom-2 left-4'
            : 'bottom-2 left-1/2 -translate-x-1/2'
        }`}
        style={{
          transform: isLeftDock
            ? `translateY(-50%) translateX(${isDockVisible ? '0' : 'calc(-100% - 24px)'})`
            : isLeftAligned
            ? `translateY(${isDockVisible ? '0' : 'calc(100% + 24px)'})`
            : `translateX(-50%) translateY(${isDockVisible ? '0' : 'calc(100% + 24px)'})`,
        }}
      >
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          className={`dock-bar backdrop-blur-3xl rounded-[22px] px-2.5 py-1.5 flex items-center border shadow-2xl transition-all max-w-[calc(100vw-32px)] overflow-x-auto no-scrollbar ${
            isLeftDock ? 'flex-col space-y-1 space-x-0 py-2.5 px-1.5' : 'space-x-1'
          } ${
            isLight
              ? 'bg-white/85 border-black/10 text-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.15)] ring-1 ring-black/5'
              : 'bg-black/55 border-white/20 text-white shadow-[0_25px_50px_rgba(0,0,0,0.7),inset_0_1px_1px_rgba(255,255,255,0.35)] ring-1 ring-black/10'
          }`}
        >
          {/* Section 0: Start / Launchpad */}
          <DockSquircleItem
            icon={Rocket}
            label="Start / Launchpad"
            tileBg="from-[#94a3b8] via-[#64748b] to-[#334155]"
            iconColor="#ffffff"
            onClick={onToggleLauncher}
            isLight={isLight}
          />
          
          {renderDivider('div-core')}

          {/* Section 1: Core Workstation Software */}
          {CORE_APPS.map((app) => (
            <DockSquircleItem
              key={app.id}
              icon={app.icon}
              label={app.label}
              tileBg={app.tileBg}
              iconColor={app.iconColor}
              isActive={windows.some(w => w.appId === app.id && !w.minimized && w.focused)}
              hasMinimized={windows.some(w => w.appId === app.id && w.minimized)}
              isOpen={windows.some(w => w.appId === app.id)}
              isLaunching={launchingAppId === app.id}
              onClick={() => handleDockItemClick(app.id, app.label)}
              isLight={isLight}
            />
          ))}

          {renderDivider('div-ops')}

          {/* Section 2: Monitoring & DevOps Software */}
          {OPS_APPS.map((app) => (
            <DockSquircleItem
              key={app.id}
              icon={app.icon}
              label={app.label}
              tileBg={app.tileBg}
              iconColor={app.iconColor}
              isActive={windows.some(w => w.appId === app.id && !w.minimized && w.focused)}
              hasMinimized={windows.some(w => w.appId === app.id && w.minimized)}
              isOpen={windows.some(w => w.appId === app.id)}
              isLaunching={launchingAppId === app.id}
              onClick={() => handleDockItemClick(app.id, app.label)}
              isLight={isLight}
            />
          ))}

          {renderDivider('div-admin')}

          {/* Section 3: Infrastructure & Administration Software */}
          {ADMIN_APPS.map((app) => (
            <DockSquircleItem
              key={app.id}
              icon={app.icon}
              label={app.label}
              tileBg={app.tileBg}
              iconColor={app.iconColor}
              isActive={windows.some(w => w.appId === app.id && !w.minimized && w.focused)}
              hasMinimized={windows.some(w => w.appId === app.id && w.minimized)}
              isOpen={windows.some(w => w.appId === app.id)}
              isLaunching={launchingAppId === app.id}
              onClick={() => handleDockItemClick(app.id, app.label)}
              isLight={isLight}
            />
          ))}

          {/* Section 4: Dynamic Running Apps (if unpinned apps are open) */}
          {dynamicRunningApps.length > 0 && (
            <>
              {renderDivider('div-dynamic')}
              {dynamicRunningApps.map((app) => (
                <DockSquircleItem
                  key={app.id}
                  icon={app.icon}
                  label={app.label}
                  tileBg={app.tileBg}
                  iconColor={app.iconColor}
                  isActive={windows.some(w => w.appId === app.id && !w.minimized && w.focused)}
                  hasMinimized={windows.some(w => w.appId === app.id && w.minimized)}
                  isOpen={true}
                  isLaunching={launchingAppId === app.id}
                  onClick={() => handleDockItemClick(app.id, app.label)}
                  isLight={isLight}
                />
              ))}
            </>
          )}

          {renderDivider('div-settings')}

          {/* Section 5: System Settings */}
          <DockSquircleItem
            icon={Settings}
            label="System Settings"
            tileBg="from-[#94a3b8] via-[#64748b] to-[#475569]"
            iconColor="#ffffff"
            isActive={windows.some(w => w.appId === 'settings' && !w.minimized && w.focused)}
            hasMinimized={windows.some(w => w.appId === 'settings' && w.minimized)}
            isOpen={windows.some(w => w.appId === 'settings')}
            isLaunching={launchingAppId === 'settings'}
            onClick={() => handleDockItemClick('settings', 'System Settings')}
            isLight={isLight}
          />
        </motion.div>
      </div>
    </>
  );
}

function DockSquircleItem({ 
  icon: Icon, 
  label, 
  tileBg,
  iconColor = '#ffffff',
  isActive, 
  hasMinimized,
  isOpen,
  isLaunching,
  onClick,
  isLight
}: { 
  icon: React.ElementType;
  label: string;
  tileBg: string;
  iconColor?: string;
  isActive?: boolean;
  hasMinimized?: boolean;
  isOpen?: boolean;
  isLaunching?: boolean;
  onClick: () => void;
  isLight?: boolean;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.18, y: -5 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 450, damping: 20 }}
      onClick={onClick}
      className={`relative rounded-xl group flex flex-col items-center justify-center cursor-pointer select-none shrink-0 transition-transform ${
        isLaunching ? 'animate-dock-bounce' : ''
      }`}
      style={{ width: 44, height: 52 }}
      title={label}
    >
      {/* Authentic macOS / Professional Squircle Tile */}
      <div 
        className={`w-10 h-10 rounded-[12px] bg-gradient-to-b ${tileBg} flex items-center justify-center shadow-md border border-white/20 relative overflow-hidden transition-all group-hover:shadow-xl group-hover:border-white/40 shrink-0`}
      >
        {/* Subtle glass reflection sheen on top half */}
        <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
        
        <Icon className="w-5 h-5 drop-shadow-md relative z-10" style={{ color: iconColor }} />
      </div>
      
      {/* Reserved Indicator Slot (Height 6px, perfectly centered) - Guarantees ZERO vertical jitter */}
      <div className="h-2 w-full flex items-center justify-center shrink-0 mt-0.5">
        {isActive ? (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className={`w-1.5 h-1.5 rounded-full ${
              isLight ? 'bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.9)]' : 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,1)]'
            }`}
          />
        ) : hasMinimized ? (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.8)]" />
        ) : isOpen ? (
          <span className={`w-1.5 h-1.5 rounded-full ${isLight ? 'bg-slate-500' : 'bg-white/70'}`} />
        ) : (
          <span className="w-1.5 h-1.5 invisible" />
        )}
      </div>
      
      {/* High-Contrast Floating Tooltip */}
      <span className={`absolute -top-10 backdrop-blur-xl text-xs font-semibold px-2.5 py-1 rounded-xl opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-all duration-150 shadow-2xl font-sans z-50 transform -translate-y-1 group-hover:translate-y-0 ${
        isLight 
          ? 'bg-white/95 text-slate-900 border border-black/10 shadow-lg' 
          : 'bg-[#1e1e2e]/98 text-white border border-white/20 shadow-2xl'
      }`}>
        {label}
      </span>
    </motion.button>
  );
}
