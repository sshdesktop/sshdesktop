import React, { useState, useEffect } from 'react';
import Taskbar from './Taskbar';
import Dock from './Dock';
import WindowManager from './WindowManager';
import AppLauncher from './AppLauncher';
import NotificationCenter from './NotificationCenter';
import SpotlightSearch from './SpotlightSearch';
import { 
  Folder, HardDrive, Terminal, FileCode, Activity, Trash2, 
  Palette, Sun, Moon, Minimize2, Plus, Monitor, ShieldCheck
} from 'lucide-react';
import { useWindowManager } from '../lib/hooks/useWindowManager';
import { useSettingsStore, useConnectionStore, useWindowStore } from '../lib/store';
import { sftpMkdir, sftpWriteTextFile, sftpReadTextFile, sshExec } from '../lib/tauri-bridge';

interface DesktopContextMenu {
  x: number;
  y: number;
}

export const WALLPAPERS = [
  { id: 'sonoma', name: 'macOS Sonoma Horizon', bg: 'bg-gradient-to-tr from-[#130924] via-[#2d1254] to-[#581c87]' },
  { id: 'ventura', name: 'macOS Ventura Amber', bg: 'bg-gradient-to-tr from-[#1c1917] via-[#451a03] to-[#78350f]' },
  { id: 'monterey', name: 'macOS Monterey Marine', bg: 'bg-gradient-to-tr from-[#020617] via-[#042f2e] to-[#0369a1]' },
  { id: 'catppuccin', name: 'Catppuccin Midnight', bg: 'bg-gradient-to-br from-[#1E1E2E] via-[#181825] to-[#11111B]' },
  { id: 'solar', name: 'Solar Minimal Dark', bg: 'bg-gradient-to-b from-[#18181b] to-[#09090b]' },
];

export default function Desktop() {
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [desktopMenu, setDesktopMenu] = useState<DesktopContextMenu | null>(null);
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);

  const { openApp } = useWindowManager();
  const { wallpaper, theme, updateSettings } = useSettingsStore();
  const { minimizeAllWindows } = useWindowStore();
  const activeConnectionId = useConnectionStore(s => s.activeConnectionId);
  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });
  const username = activeServer?.username || 'root';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') {
        setShowSpotlight(s => !s);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close context menu on left click anywhere
  useEffect(() => {
    const handleClick = () => setDesktopMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // Sync CloudDesk user data to remote Linux server (~/.clouddesk/config.json)
  useEffect(() => {
    if (!activeConnectionId) return;
    const syncRemoteUserFolder = async () => {
      try {
        const homeDir = username === 'root' ? '/root' : `/home/${username}`;
        const configDir = `${homeDir}/.clouddesk`;
        await sftpMkdir(activeConnectionId, configDir);
        // Save desktop user state
        const configContent = JSON.stringify({
          user: username,
          theme,
          wallpaper,
          updated_at: new Date().toISOString(),
          client: 'CloudDesk 2.0 Native macOS Shell'
        }, null, 2);
        await sftpWriteTextFile(activeConnectionId, `${configDir}/config.json`, configContent);
      } catch (err) {
        console.warn('Remote .clouddesk sync notice:', err);
      }
    };
    syncRemoteUserFolder();
  }, [activeConnectionId, username, theme, wallpaper]);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setDesktopMenu({ x: e.clientX, y: e.clientY });
  };

  const handleCreateDesktopFolder = async () => {
    const folderName = prompt('Enter new folder name on Desktop:', 'New Folder');
    if (!folderName || !activeConnectionId) return;
    const desktopPath = username === 'root' ? `/root/Desktop/${folderName}` : `/home/${username}/Desktop/${folderName}`;
    try {
      await sftpMkdir(activeConnectionId, desktopPath);
      openApp('files', 'Finder');
    } catch (err: any) {
      alert(`Could not create folder: ${err?.message || err}`);
    }
  };

  const handleCreateDesktopFile = async () => {
    const fileName = prompt('Enter new file name on Desktop:', 'notes.txt');
    if (!fileName || !activeConnectionId) return;
    const desktopPath = username === 'root' ? `/root/Desktop/${fileName}` : `/home/${username}/Desktop/${fileName}`;
    try {
      await sftpWriteTextFile(activeConnectionId, desktopPath, '');
      openApp('files', 'Finder');
    } catch (err: any) {
      alert(`Could not create file: ${err?.message || err}`);
    }
  };

  const activeWallpaperConfig = WALLPAPERS.find(w => w.id === wallpaper) || WALLPAPERS[0];

  const desktopIcons = [
    { id: 'root', label: 'Macintosh HD (/)', icon: HardDrive, color: '#94e2d5', action: () => openApp('files', 'Finder') },
    { id: 'home', label: `${username}'s Home`, icon: Folder, color: '#89b4fa', action: () => openApp('files', 'Finder') },
    { id: 'terminal', label: 'Terminal Shell', icon: Terminal, color: '#a6e3a1', action: () => openApp('terminal', 'Terminal') },
    { id: 'editor', label: 'Code Editor', icon: FileCode, color: '#cba6f7', action: () => openApp('editor', 'Code Editor') },
    { id: 'monitor', label: 'Activity Monitor', icon: Activity, color: '#f38ba8', action: () => openApp('monitor', 'System Monitor') },
    { id: 'trash', label: 'Trash (/tmp)', icon: Trash2, color: '#6c7086', action: () => openApp('files', 'Finder') },
  ];

  return (
    <div 
      className={`relative w-full h-full ${activeWallpaperConfig.bg} overflow-hidden select-none transition-colors duration-700`}
      onContextMenu={handleContextMenu}
    >
      {/* Background ambient blur orb for depth */}
      <div className="absolute top-1/4 left-1/3 w-[500px] h-[500px] bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Top Taskbar */}
      <Taskbar onOpenWallpapers={() => setShowWallpaperModal(true)} />

      {/* Desktop Canvas Icons (macOS right-aligned or left-aligned desktop items) */}
      <div className="absolute top-12 left-6 grid grid-cols-1 gap-4 z-0 pointer-events-auto">
        {desktopIcons.map(item => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              onDoubleClick={item.action}
              className="flex flex-col items-center w-24 p-2 rounded-xl hover:bg-white/10 border border-transparent hover:border-white/15 cursor-pointer transition-all group select-none text-center"
            >
              <div 
                className="w-12 h-12 rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform"
                style={{ backgroundColor: `${item.color}20` }}
              >
                <Icon className="w-6 h-6" style={{ color: item.color }} />
              </div>
              <span className="text-white text-[11px] font-medium mt-1.5 drop-shadow-md break-words max-w-full leading-tight">
                {item.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Window Manager Layer */}
      <div className="absolute inset-0 top-8 bottom-16 pt-2 pb-14 pointer-events-none">
        <div className="w-full h-full pointer-events-auto">
          <WindowManager />
        </div>
      </div>

      {/* Bottom Dock */}
      <Dock onToggleLauncher={() => setLauncherOpen(!launcherOpen)} />

      {/* Launchpad Overlay */}
      {launcherOpen && <AppLauncher onClose={() => setLauncherOpen(false)} />}
      
      <NotificationCenter />
      {showSpotlight && <SpotlightSearch onClose={() => setShowSpotlight(false)} />}

      {/* Desktop Right-Click Context Menu */}
      {desktopMenu && (
        <div 
          className="fixed z-50 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-xl shadow-2xl py-1.5 w-56 text-xs text-gray-200 select-none"
          style={{ top: Math.min(desktopMenu.y, window.innerHeight - 260), left: Math.min(desktopMenu.x, window.innerWidth - 240) }}
          onClick={(e) => e.stopPropagation()}
        >
          <div 
            onClick={() => { handleCreateDesktopFolder(); setDesktopMenu(null); }}
            className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer font-medium"
          >
            <Folder className="w-3.5 h-3.5 text-blue-400" />
            <span>New Remote Folder</span>
          </div>
          <div 
            onClick={() => { handleCreateDesktopFile(); setDesktopMenu(null); }}
            className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>New Remote File</span>
          </div>

          <div className="my-1 border-t border-white/10" />

          <div 
            onClick={() => { setShowWallpaperModal(true); setDesktopMenu(null); }}
            className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
          >
            <Palette className="w-3.5 h-3.5 text-purple-400" />
            <span>Change Desktop Wallpaper...</span>
          </div>

          <div 
            onClick={() => { 
              updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' });
              setDesktopMenu(null);
            }}
            className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-blue-400" />}
            <span>Toggle {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </div>

          <div 
            onClick={() => { minimizeAllWindows(); setDesktopMenu(null); }}
            className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
          >
            <Minimize2 className="w-3.5 h-3.5 text-gray-400" />
            <span>Show Desktop (Minimize All)</span>
          </div>

          <div className="my-1 border-t border-white/10" />

          <div 
            onClick={() => { openApp('terminal', 'Terminal'); setDesktopMenu(null); }}
            className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Open Terminal Here</span>
          </div>
        </div>
      )}

      {/* Wallpaper Picker Modal */}
      {showWallpaperModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Palette className="w-5 h-5 text-purple-400" />
                <h3 className="font-bold text-base text-white">Choose Desktop Wallpaper</h3>
              </div>
              <button onClick={() => setShowWallpaperModal(false)} className="text-gray-400 hover:text-white">
                ✕
              </button>
            </div>
            <p className="text-xs text-gray-400">Select a macOS-inspired dynamic backdrop for your remote Linux session.</p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              {WALLPAPERS.map(w => (
                <div
                  key={w.id}
                  onClick={() => updateSettings({ wallpaper: w.id })}
                  className={`p-3 rounded-xl border cursor-pointer transition-all space-y-2 ${
                    wallpaper === w.id
                      ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30 shadow-lg'
                      : 'border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className={`w-full h-20 rounded-lg ${w.bg} border border-white/10 shadow-inner`} />
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">{w.name}</span>
                    {wallpaper === w.id && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)] text-black font-bold">
                        Active
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowWallpaperModal(false)}
                className="px-4 py-2 bg-[var(--accent)] hover:bg-blue-600 text-white rounded-xl text-xs font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
