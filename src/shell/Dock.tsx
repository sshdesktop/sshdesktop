import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal, Folder, FileCode, Monitor, Activity, Settings,
  Container, Server, ScrollText, Globe, Package, Users,
  Clock, Database, Shield, HardDrive, Flame, Variable,
  Rocket, KeyRound, Compass, Send, ShieldCheck, Workflow
} from 'lucide-react';
import { useWindowManager } from '../lib/hooks/useWindowManager';
import { useSettingsStore, useWindowStore } from '../lib/store';

interface DockAppConfig {
  id: string;
  icon: React.ElementType;
  label: string;
  tileBg: string;
  iconColor: string;
}

const DOCK_APPS: DockAppConfig[] = [
  { id: 'terminal', icon: Terminal, label: 'Terminal', tileBg: 'from-[#334155] via-[#1e293b] to-[#0f172a]', iconColor: '#4ade80' },
  { id: 'automation', icon: Workflow, label: 'Fleet Automation', tileBg: 'from-[#4f46e5] via-[#3b82f6] to-[#06b6d4]', iconColor: '#ffffff' },
  { id: 'files', icon: Folder, label: 'File Manager', tileBg: 'from-[#38bdf8] via-[#0284c7] to-[#0369a1]', iconColor: '#ffffff' },
  { id: 'ssl', icon: ShieldCheck, label: 'SSL & Certbot', tileBg: 'from-[#059669] via-[#047857] to-[#064e3b]', iconColor: '#34d399' },
  { id: 'editor', icon: FileCode, label: 'Code Editor', tileBg: 'from-[#6366f1] via-[#4f46e5] to-[#3730a3]', iconColor: '#ffffff' },
  { id: 'monitor', icon: Monitor, label: 'Activity Monitor', tileBg: 'from-[#06b6d4] via-[#0891b2] to-[#0e7490]', iconColor: '#ffffff' },
  { id: 'processes', icon: Activity, label: 'Process Manager', tileBg: 'from-[#ec4899] via-[#db2777] to-[#9d174d]', iconColor: '#ffffff' },
  { id: 'services', icon: Server, label: 'Services', tileBg: 'from-[#a855f7] via-[#9333ea] to-[#6b21a8]', iconColor: '#ffffff' },
  { id: 'docker', icon: Container, label: 'Docker Containers', tileBg: 'from-[#0284c7] via-[#0369a1] to-[#075985]', iconColor: '#38bdf8' },
  { id: 'database', icon: Database, label: 'Database Studio', tileBg: 'from-[#06b6d4] via-[#0284c7] to-[#1d4ed8]', iconColor: '#ffffff' },
  { id: 'ssh', icon: KeyRound, label: 'SSH Studio', tileBg: 'from-[#0ea5e9] via-[#2563eb] to-[#1e1b4b]', iconColor: '#38bdf8' },
  { id: 'api', icon: Send, label: 'API Studio (SSH Tunnel)', tileBg: 'from-[#6366f1] via-[#8b5cf6] to-[#d946ef]', iconColor: '#ffffff' },
  { id: 'browser', icon: Compass, label: 'Private Web Browser', tileBg: 'from-[#06b6d4] via-[#0284c7] to-[#1d4ed8]', iconColor: '#38bdf8' },
  { id: 'env', icon: Variable, label: 'Environment Variables', tileBg: 'from-[#ec4899] via-[#8b5cf6] to-[#6366f1]', iconColor: '#ffffff' },
  { id: 'logs', icon: ScrollText, label: 'Console Logs', tileBg: 'from-[#f97316] via-[#ea580c] to-[#c2410c]', iconColor: '#ffffff' },
  { id: 'network', icon: Globe, label: 'Network', tileBg: 'from-[#14b8a6] via-[#0d9488] to-[#0f766e]', iconColor: '#ffffff' },
  { id: 'firewall', icon: Flame, label: 'Firewall', tileBg: 'from-[#f97316] via-[#ea580c] to-[#dc2626]', iconColor: '#ffffff' },
  { id: 'disks', icon: HardDrive, label: 'Disk Manager', tileBg: 'from-[#64748b] via-[#475569] to-[#334155]', iconColor: '#38bdf8' },
  { id: 'packages', icon: Package, label: 'Packages', tileBg: 'from-[#f43f5e] via-[#e11d48] to-[#be123c]', iconColor: '#ffffff' },
  { id: 'users', icon: Users, label: 'Users & Groups', tileBg: 'from-[#3b82f6] via-[#2563eb] to-[#1d4ed8]', iconColor: '#ffffff' },
  { id: 'cron', icon: Clock, label: 'Cron Scheduler', tileBg: 'from-[#f59e0b] via-[#d97706] to-[#b45309]', iconColor: '#ffffff' },
  { id: 'security', icon: Shield, label: 'Security Auditor', tileBg: 'from-[#10b981] via-[#059669] to-[#047857]', iconColor: '#ffffff' },
];

export default function Dock({ 
  onToggleLauncher 
}: { 
  onToggleLauncher: () => void; 
}) {
  const { openApp, windows, launchingAppId } = useWindowManager();
  const { minimizeWindow, restoreWindow, focusWindow, bringToFront } = useWindowStore();
  const { autoHideDock, theme } = useSettingsStore();
  const [isHovered, setIsHovered] = useState(false);

  const isLight = theme === 'light';

  // Global mousemove detection for Auto-Hide Dock
  // Automatically reveals the dock when the cursor moves to the bottom edge, even over full screen windows
  useEffect(() => {
    if (!autoHideDock) {
      setIsHovered(false);
      return;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (e.clientY >= window.innerHeight - 10) {
        setIsHovered(true);
      } else if (isHovered && e.clientY < window.innerHeight - 85) {
        setIsHovered(false);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [autoHideDock, isHovered]);

  // Click on dock icon: if focused -> minimize! If minimized/background -> restore & focus! If unopened -> open!
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

  return (
    <>
      {/* Auto-Hide Hover Trigger Area at bottom edge of screen */}
      {autoHideDock && (
        <div 
          onMouseEnter={() => setIsHovered(true)}
          className="fixed bottom-0 left-0 right-0 h-3 z-[999997] pointer-events-auto"
        />
      )}

      {/* Dock Container - Exactly Centered with single translate property */}
      <div 
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          if (autoHideDock) setIsHovered(false);
        }}
        className="fixed bottom-2 z-[999998] pointer-events-auto transition-transform duration-300 ease-out"
        style={{
          left: '50%',
          transform: `translateX(-50%) translateY(${isDockVisible ? '0' : 'calc(100% + 24px)'})`,
        }}
      >
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', damping: 22, stiffness: 280 }}
          className={`dock-bar backdrop-blur-3xl rounded-[20px] px-2 py-1.5 flex items-end space-x-1 border shadow-2xl transition-all max-w-[calc(100vw-24px)] flex-nowrap overflow-x-auto no-scrollbar ${
            isLight
              ? 'bg-white/75 border-black/10 text-slate-800 shadow-[0_20px_50px_rgba(0,0,0,0.15)] ring-1 ring-black/5'
              : 'bg-black/40 border-white/20 text-white shadow-[0_25px_50px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.3)] ring-1 ring-black/10'
          }`}
        >
          {/* 1st: START / Launchpad Button */}
          <DockSquircleItem
            icon={Rocket}
            label="Start / Launchpad"
            tileBg="from-[#2563eb] via-[#3b82f6] to-[#6366f1]"
            iconColor="#ffffff"
            onClick={onToggleLauncher}
            isLight={isLight}
          />
          
          {/* Separator between 1st (Start) and 2nd (Software) */}
          <div className={`w-px h-6 mx-0.5 self-center ${isLight ? 'bg-black/10' : 'bg-white/15'}`} />
          
          {/* 2nd: Software Applications */}
          {DOCK_APPS.map((app) => (
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

          {/* Separator */}
          <div className={`w-px h-6 mx-0.5 self-center ${isLight ? 'bg-black/10' : 'bg-white/15'}`} />

          {/* System Settings */}
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
      whileHover={{ scale: 1.25, y: -8 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 450, damping: 18 }}
      onClick={onClick}
      className={`relative p-0.5 rounded-xl group flex flex-col items-center justify-center cursor-pointer select-none shrink-0 ${
        isLaunching ? 'animate-dock-bounce' : ''
      }`}
      title={label}
    >
      {/* Authentic macOS Squircle Tile - Sleek Compact Proportions */}
      <div 
        className={`w-10 h-10 rounded-[12px] bg-gradient-to-b ${tileBg} flex items-center justify-center shadow-md border border-white/20 relative overflow-hidden transition-all group-hover:shadow-2xl`}
      >
        {/* Subtle glass reflection sheen on top half */}
        <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
        
        <Icon className="w-4.5 h-4.5 drop-shadow-md relative z-10" style={{ color: iconColor }} />
      </div>
      
      {/* Active focused indicator dot */}
      {isActive && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className={`absolute -bottom-1.5 w-1 h-1 rounded-full ${
            isLight ? 'bg-blue-600 shadow-[0_0_6px_rgba(37,99,235,0.8)]' : 'bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]'
          }`}
        />
      )}
      
      {/* Open but unfocused indicator */}
      {isOpen && !isActive && !hasMinimized && (
        <span className={`absolute -bottom-1.5 w-1 h-1 rounded-full ${isLight ? 'bg-slate-400' : 'bg-white/50'}`} />
      )}

      {/* Minimized indicator */}
      {hasMinimized && !isActive && (
        <span className={`absolute -bottom-1.5 w-1 h-1 rounded-full ${isLight ? 'bg-amber-500' : 'bg-amber-300'}`} />
      )}
      
      {/* Tooltip */}
      <span className={`absolute -top-9 backdrop-blur-xl text-xs font-medium px-2.5 py-1 rounded-lg opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none transition-opacity shadow-2xl font-sans ${
        isLight 
          ? 'bg-white text-slate-900 border border-black/10 shadow-lg' 
          : 'bg-[#1e1e2e]/95 text-white border border-white/15'
      }`}>
        {label}
      </span>
    </motion.button>
  );
}
