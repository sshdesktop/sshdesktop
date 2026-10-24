import React, { useEffect } from 'react';
import { 
  X, LayoutGrid, Terminal, Folder, FileCode, Monitor, Container, 
  Globe, Server, Database, Package, Shield, Settings, Activity,
  Maximize2, Compass, Send, HardDrive, Flame, ScrollText, Variable, Clock, StickyNote, KeyRound, Users
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
};

const APP_GRADIENTS: Record<string, string> = {
  terminal: 'from-slate-900 to-black',
  files: 'from-blue-900/60 to-indigo-950/80',
  editor: 'from-indigo-900/60 to-purple-950/80',
  monitor: 'from-emerald-900/60 to-teal-950/80',
  docker: 'from-cyan-900/60 to-blue-950/80',
  services: 'from-amber-900/60 to-orange-950/80',
  database: 'from-violet-900/60 to-purple-950/80',
  packages: 'from-rose-900/60 to-pink-950/80',
  security: 'from-red-900/60 to-rose-950/80',
  settings: 'from-gray-900/60 to-slate-950/80',
  browser: 'from-sky-900/60 to-blue-950/80',
  disks: 'from-teal-900/60 to-slate-950/80',
};

interface MissionControlProps {
  isOpen: boolean;
  onClose: () => void;
  windows: WindowState[];
  onSelectWindow: (winId: string) => void;
  onCloseWindow: (winId: string) => void;
}

export default function MissionControl({
  isOpen,
  onClose,
  windows,
  onSelectWindow,
  onCloseWindow
}: MissionControlProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' || 
        e.key === 'F3' || 
        (e.ctrlKey && (e.key === 'F3' || e.code === 'F3'))
      ) {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-[99998] bg-black/80 backdrop-blur-2xl flex flex-col p-8 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Mission Control Top Bar */}
      <div 
        className="flex items-center justify-between pb-6 max-w-7xl w-full mx-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/25">
            <LayoutGrid className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-xl font-bold text-white tracking-tight">Mission Control</h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono font-semibold border border-blue-400/30">
                {windows.length} {windows.length === 1 ? 'Window' : 'Windows'} Active
              </span>
            </div>
            <p className="text-xs text-gray-400">Click any window to focus · Press Esc or Ctrl+F3 to close</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white transition-all text-xs font-medium cursor-pointer"
        >
          <X className="w-4 h-4" />
          <span>Close (Esc)</span>
        </button>
      </div>

      {/* Grid of Active Windows */}
      <div 
        className="flex-1 overflow-y-auto max-w-7xl w-full mx-auto flex items-center justify-center p-4"
        onClick={onClose}
      >
        {windows.length === 0 ? (
          <div className="text-center space-y-3 p-8 rounded-3xl bg-white/[0.03] border border-white/10 max-w-md">
            <div className="w-12 h-12 rounded-2xl bg-white/5 mx-auto flex items-center justify-center text-gray-400">
              <LayoutGrid className="w-6 h-6 opacity-40" />
            </div>
            <div className="text-sm font-semibold text-gray-300">No Open Application Windows</div>
            <p className="text-xs text-gray-500 leading-relaxed">
              Launch applications from the bottom Dock, then press <strong>Ctrl + F3</strong> or <strong>Ctrl + Tab</strong> anytime to switch windows.
            </p>
          </div>
        ) : (
          <div className={`grid gap-6 w-full ${
            windows.length === 1 
              ? 'grid-cols-1 max-w-lg' 
              : windows.length === 2 
              ? 'grid-cols-2 max-w-3xl' 
              : windows.length <= 4 
              ? 'grid-cols-2 max-w-4xl' 
              : 'grid-cols-3 max-w-6xl'
          }`}>
            {windows.map(win => {
              const Icon = APP_ICONS[win.appId] || Terminal;
              const grad = APP_GRADIENTS[win.appId] || 'from-slate-900 to-black';

              return (
                <div
                  key={win.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectWindow(win.id);
                  }}
                  className="group relative bg-[#1c1d2e] border border-white/15 hover:border-blue-500 rounded-3xl overflow-hidden shadow-2xl transition-all duration-200 hover:scale-[1.03] hover:shadow-[0_20px_50px_rgba(37,99,235,0.35)] cursor-pointer flex flex-col h-60"
                >
                  {/* Window Preview Header */}
                  <div className="px-4 py-2.5 bg-[#141524] border-b border-white/10 flex items-center justify-between shrink-0">
                    <div className="flex items-center space-x-2 truncate">
                      <Icon className="w-4 h-4 text-blue-400 shrink-0" />
                      <span className="text-xs font-semibold text-white truncate font-sans">{win.title}</span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseWindow(win.id);
                      }}
                      className="p-1 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-70 group-hover:opacity-100"
                      title="Close Window"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Window Body Preview */}
                  <div className={`flex-1 bg-gradient-to-br ${grad} p-6 flex flex-col items-center justify-center relative overflow-hidden`}>
                    <div className="w-16 h-16 rounded-3xl bg-white/[0.08] border border-white/15 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                      <Icon className="w-8 h-8 text-white/90" />
                    </div>

                    <div className="mt-3 text-center">
                      <span className="text-xs font-mono text-gray-300 font-medium">{win.title}</span>
                      {win.minimized && (
                        <div className="text-[10px] text-amber-400 font-sans mt-0.5 font-semibold">
                          (Minimized)
                        </div>
                      )}
                    </div>

                    {/* Hover Switch Action Pill */}
                    <div className="absolute inset-0 bg-blue-600/15 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-[1px]">
                      <div className="px-4 py-2 rounded-2xl bg-blue-600 text-white font-semibold text-xs shadow-lg flex items-center space-x-1.5 transform translate-y-2 group-hover:translate-y-0 transition-transform">
                        <Maximize2 className="w-3.5 h-3.5" />
                        <span>Bring to Front</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
