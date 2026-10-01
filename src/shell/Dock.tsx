import React from 'react';
import { motion } from 'framer-motion';
import {
  Terminal, Folder, FileCode, Monitor, Activity, Settings,
  Container, Server, ScrollText, Globe, Package, Users,
  Clock, Database, Shield, HardDrive, Flame, StickyNote,
  LayoutGrid, Network
} from 'lucide-react';
import { useWindowManager } from '../lib/hooks/useWindowManager';

const DOCK_APPS = [
  { id: 'terminal', icon: Terminal, label: 'Terminal', color: '#89B4FA' },
  { id: 'files', icon: Folder, label: 'Files', color: '#89DCEB' },
  { id: 'editor', icon: FileCode, label: 'Editor', color: '#A6E3A1' },
  { id: 'monitor', icon: Monitor, label: 'Monitor', color: '#F9E2AF' },
  { id: 'processes', icon: Activity, label: 'Processes', color: '#F38BA8' },
  { id: 'services', icon: Server, label: 'Services', color: '#CBA6F7' },
  { id: 'docker', icon: Container, label: 'Docker', color: '#74C7EC' },
  { id: 'logs', icon: ScrollText, label: 'Logs', color: '#FAB387' },
  { id: 'network', icon: Globe, label: 'Network', color: '#94E2D5' },
  { id: 'packages', icon: Package, label: 'Packages', color: '#F5C2E7' },
  { id: 'users', icon: Users, label: 'Users', color: '#B4BEFE' },
  { id: 'cron', icon: Clock, label: 'Cron', color: '#EBA0AC' },
  { id: 'database', icon: Database, label: 'Database', color: '#89DCEB' },
  { id: 'firewall', icon: Flame, label: 'Firewall', color: '#F38BA8' },
  { id: 'disks', icon: HardDrive, label: 'Disks', color: '#A6E3A1' },
  { id: 'security', icon: Shield, label: 'Security', color: '#F9E2AF' },
  { id: 'notes', icon: StickyNote, label: 'Notes', color: '#CBA6F7' },
];

export default function Dock({ onToggleLauncher }: { onToggleLauncher: () => void }) {
  const { openApp, windows } = useWindowManager();

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50">
      <motion.div
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        className="bg-[var(--surface)]/50 backdrop-blur-2xl rounded-2xl px-2 py-1.5 flex items-end space-x-0.5 border border-white/[0.08] shadow-[0_8px_32px_rgba(0,0,0,0.4)]"
      >
        {/* Launcher Button */}
        <DockItem
          icon={LayoutGrid}
          label="Launcher"
          color="#CDD6F4"
          onClick={onToggleLauncher}
        />
        
        {/* Separator */}
        <div className="w-px h-8 bg-white/10 mx-1 self-center" />
        
        {/* App Icons */}
        {DOCK_APPS.map((app) => (
          <DockItem
            key={app.id}
            icon={app.icon}
            label={app.label}
            color={app.color}
            isActive={windows.some(w => w.appId === app.id && !w.minimized)}
            hasMinimized={windows.some(w => w.appId === app.id && w.minimized)}
            onClick={() => openApp(app.id, app.label)}
          />
        ))}

        {/* Separator */}
        <div className="w-px h-8 bg-white/10 mx-1 self-center" />

        {/* Settings */}
        <DockItem
          icon={Settings}
          label="Settings"
          color="#9399B2"
          isActive={windows.some(w => w.appId === 'settings' && !w.minimized)}
          onClick={() => openApp('settings', 'Settings')}
        />
      </motion.div>
    </div>
  );
}

function DockItem({ 
  icon: Icon, 
  label, 
  color = '#CDD6F4',
  isActive, 
  hasMinimized,
  onClick 
}: { 
  icon: React.ElementType;
  label: string;
  color?: string;
  isActive?: boolean;
  hasMinimized?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.35, y: -12 }}
      whileTap={{ scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 15 }}
      onClick={onClick}
      className="relative p-2.5 rounded-xl hover:bg-white/[0.08] transition-colors group flex flex-col items-center justify-center"
      title={label}
    >
      <Icon className="w-6 h-6" style={{ color }} />
      
      {/* Running indicator dot */}
      {isActive && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          className="absolute -bottom-0 w-1 h-1 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      
      {/* Minimized indicator */}
      {hasMinimized && !isActive && (
        <span className="absolute -bottom-0 w-1 h-1 rounded-full bg-white/40" />
      )}
      
      {/* Tooltip */}
      <span className="absolute -top-9 bg-[var(--surface)]/90 backdrop-blur-xl text-xs px-2.5 py-1 rounded-md opacity-0 group-hover:opacity-100 whitespace-nowrap border border-white/10 pointer-events-none transition-opacity shadow-lg text-[var(--text)]">
        {label}
      </span>
    </motion.button>
  );
}
