import React from 'react';
import { motion } from 'framer-motion';
import {
  Terminal, Folder, FileCode, Monitor, Activity, Settings,
  Container, Server, ScrollText, Globe, Package, Users,
  Clock, Database, Shield, HardDrive, Flame, StickyNote,
  Rocket, Trash2
} from 'lucide-react';
import { useWindowManager } from '../lib/hooks/useWindowManager';

interface DockAppConfig {
  id: string;
  icon: React.ElementType;
  label: string;
  tileBg: string;
  iconColor: string;
}

const DOCK_APPS: DockAppConfig[] = [
  { id: 'files', icon: Folder, label: 'Finder', tileBg: 'from-[#38bdf8] via-[#0284c7] to-[#0369a1]', iconColor: '#ffffff' },
  { id: 'terminal', icon: Terminal, label: 'Terminal', tileBg: 'from-[#334155] via-[#1e293b] to-[#0f172a]', iconColor: '#4ade80' },
  { id: 'editor', icon: FileCode, label: 'Code Editor', tileBg: 'from-[#6366f1] via-[#4f46e5] to-[#3730a3]', iconColor: '#ffffff' },
  { id: 'monitor', icon: Monitor, label: 'Activity Monitor', tileBg: 'from-[#06b6d4] via-[#0891b2] to-[#0e7490]', iconColor: '#ffffff' },
  { id: 'processes', icon: Activity, label: 'Process Manager', tileBg: 'from-[#ec4899] via-[#db2777] to-[#9d174d]', iconColor: '#ffffff' },
  { id: 'services', icon: Server, label: 'Services', tileBg: 'from-[#a855f7] via-[#9333ea] to-[#6b21a8]', iconColor: '#ffffff' },
  { id: 'docker', icon: Container, label: 'Docker Containers', tileBg: 'from-[#0284c7] via-[#0369a1] to-[#075985]', iconColor: '#38bdf8' },
  { id: 'logs', icon: ScrollText, label: 'Console Logs', tileBg: 'from-[#f97316] via-[#ea580c] to-[#c2410c]', iconColor: '#ffffff' },
  { id: 'network', icon: Globe, label: 'Network', tileBg: 'from-[#14b8a6] via-[#0d9488] to-[#0f766e]', iconColor: '#ffffff' },
  { id: 'packages', icon: Package, label: 'Packages', tileBg: 'from-[#f43f5e] via-[#e11d48] to-[#be123c]', iconColor: '#ffffff' },
  { id: 'users', icon: Users, label: 'Users & Groups', tileBg: 'from-[#3b82f6] via-[#2563eb] to-[#1d4ed8]', iconColor: '#ffffff' },
  { id: 'cron', icon: Clock, label: 'Cron Scheduler', tileBg: 'from-[#f59e0b] via-[#d97706] to-[#b45309]', iconColor: '#ffffff' },
  { id: 'database', icon: Database, label: 'Database', tileBg: 'from-[#06b6d4] via-[#0284c7] to-[#1d4ed8]', iconColor: '#ffffff' },
  { id: 'security', icon: Shield, label: 'Security Auditor', tileBg: 'from-[#10b981] via-[#059669] to-[#047857]', iconColor: '#ffffff' },
];

export default function Dock({ onToggleLauncher }: { onToggleLauncher: () => void }) {
  const { openApp, windows } = useWindowManager();

  return (
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-50">
      <motion.div
        initial={{ y: 80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 22, stiffness: 280 }}
        className="bg-white/10 dark:bg-black/35 backdrop-blur-3xl rounded-[24px] px-2.5 py-2 flex items-end space-x-1.5 border border-white/20 shadow-[0_25px_50px_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.3)] ring-1 ring-black/10"
      >
        {/* Launcher Button (macOS authentic Launchpad Rocket) */}
        <DockSquircleItem
          icon={Rocket}
          label="Launchpad"
          tileBg="from-[#94a3b8] via-[#64748b] to-[#334155]"
          iconColor="#ffffff"
          onClick={onToggleLauncher}
        />
        
        {/* Separator */}
        <div className="w-px h-8 bg-white/15 mx-1 self-center" />
        
        {/* App Icons */}
        {DOCK_APPS.map((app) => (
          <DockSquircleItem
            key={app.id}
            icon={app.icon}
            label={app.label}
            tileBg={app.tileBg}
            iconColor={app.iconColor}
            isActive={windows.some(w => w.appId === app.id && !w.minimized)}
            hasMinimized={windows.some(w => w.appId === app.id && w.minimized)}
            onClick={() => openApp(app.id, app.label)}
          />
        ))}

        {/* Separator */}
        <div className="w-px h-8 bg-white/15 mx-1 self-center" />

        {/* System Settings */}
        <DockSquircleItem
          icon={Settings}
          label="System Settings"
          tileBg="from-[#94a3b8] via-[#64748b] to-[#475569]"
          iconColor="#ffffff"
          isActive={windows.some(w => w.appId === 'settings' && !w.minimized)}
          onClick={() => openApp('settings', 'System Settings')}
        />

        {/* Trash */}
        <DockSquircleItem
          icon={Trash2}
          label="Trash"
          tileBg="from-[#64748b]/40 via-[#475569]/40 to-[#334155]/40"
          iconColor="#cbd5e1"
          onClick={() => openApp('files', 'Finder')}
        />
      </motion.div>
    </div>
  );
}

function DockSquircleItem({ 
  icon: Icon, 
  label, 
  tileBg,
  iconColor = '#ffffff',
  isActive, 
  hasMinimized,
  onClick 
}: { 
  icon: React.ElementType;
  label: string;
  tileBg: string;
  iconColor?: string;
  isActive?: boolean;
  hasMinimized?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.28, y: -10 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 450, damping: 18 }}
      onClick={onClick}
      className="relative p-1 rounded-2xl group flex flex-col items-center justify-center cursor-pointer select-none"
      title={label}
    >
      {/* Authentic macOS Squircle Tile */}
      <div 
        className={`w-11 h-11 rounded-[14px] bg-gradient-to-b ${tileBg} flex items-center justify-center shadow-lg border border-white/20 relative overflow-hidden transition-all group-hover:shadow-2xl`}
      >
        {/* Subtle glass reflection sheen on top half */}
        <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
        
        <Icon className="w-5 h-5 drop-shadow-md relative z-10" style={{ color: iconColor }} />
      </div>
      
      {/* Running indicator dot */}
      {isActive && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -bottom-1.5 w-1 h-1 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
        />
      )}
      
      {/* Minimized indicator */}
      {hasMinimized && !isActive && (
        <span className="absolute -bottom-1.5 w-1 h-1 rounded-full bg-white/40" />
      )}
      
      {/* Tooltip */}
      <span className="absolute -top-10 bg-[#1e1e2e]/95 backdrop-blur-xl text-xs font-medium px-2.5 py-1 rounded-lg opacity-0 group-hover:opacity-100 whitespace-nowrap border border-white/15 pointer-events-none transition-opacity shadow-2xl text-white font-sans">
        {label}
      </span>
    </motion.button>
  );
}
