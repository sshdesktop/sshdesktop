import React from 'react';
import { 
  Terminal, Folder, FileCode, Monitor, Container, Globe, Server, Database, 
  Package, Shield, Settings, Activity, Compass, Send, HardDrive, Flame, 
  ScrollText, Variable, Clock, StickyNote, KeyRound, Users, ShieldCheck
} from 'lucide-react';
import { WindowState } from '../../lib/types';

const APP_ICONS: Record<string, React.ElementType> = {
  terminal: Terminal,
  files: Folder,
  editor: FileCode,
  monitor: Monitor,
  docker: Container,
  network: Globe,
  services: Server,
  database: Database,
  packages: Package,
  security: Shield,
  settings: Settings,
  processes: Activity,
  browser: Compass,
  api: Send,
  disks: HardDrive,
  firewall: Flame,
  logs: ScrollText,
  env: Variable,
  cron: Clock,
  notes: StickyNote,
  ssh: KeyRound,
  users: Users,
  ssl: ShieldCheck,
};

interface AppSwitcherProps {
  isOpen: boolean;
  windows: WindowState[];
  selectedIndex: number;
}

export default function AppSwitcher({ isOpen, windows, selectedIndex }: AppSwitcherProps) {
  if (!isOpen || windows.length === 0) return null;

  return (
    <div className="fixed inset-0 z-[9999999] pointer-events-none flex items-center justify-center animate-in fade-in duration-100 select-none">
      <div className="bg-[#181a2c]/95 backdrop-blur-3xl border border-white/20 rounded-3xl p-5 shadow-[0_25px_80px_rgba(0,0,0,0.85)] flex items-center space-x-3 pointer-events-auto max-w-[90vw] overflow-x-auto scrollbar-none">
        {windows.map((win, idx) => {
          const isSelected = idx === selectedIndex % windows.length;
          const Icon = APP_ICONS[win.appId] || Terminal;

          return (
            <div
              key={win.id}
              className={`flex flex-col items-center justify-center w-28 h-28 rounded-2xl p-3 transition-all duration-150 shrink-0 ${
                isSelected
                  ? 'bg-blue-600/40 border-2 border-blue-400 shadow-[0_0_25px_rgba(59,130,246,0.6)] scale-105'
                  : 'bg-white/[0.04] border border-white/10 hover:bg-white/[0.08] opacity-75'
              }`}
            >
              <div className="relative mb-2">
                <Icon className={`w-9 h-9 ${isSelected ? 'text-blue-300' : 'text-gray-300'}`} />
                {win.minimized && (
                  <span 
                    className="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 border border-black/40" 
                    title="Minimized" 
                  />
                )}
              </div>
              <span className={`text-[11px] text-center truncate w-full ${
                isSelected ? 'text-white font-bold' : 'text-gray-400 font-medium'
              }`}>
                {win.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
