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
import { useSettingsStore, useConnectionStore, useWindowStore, useEditorStore } from '../lib/store';
import { sftpMkdir, sftpWriteTextFile, sftpReadTextFile, sshExec } from '../lib/tauri-bridge';

interface DesktopContextMenu {
  x: number;
  y: number;
}

export interface WallpaperItem {
  id: string;
  name: string;
  subtitle: string;
  category: 'macOS Official' | 'Nature 4K' | 'Abstract 4K' | 'Cosmic';
  url: string;
  thumbnail: string;
}

export const WALLPAPERS: WallpaperItem[] = [
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
    url: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=600&q=80',
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
  {
    id: 'big-sur',
    name: 'macOS Big Sur Peak',
    subtitle: '4K Pacific Coastal Alps',
    category: 'Nature 4K',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'catalina-night',
    name: 'macOS Catalina Night',
    subtitle: '4K Starry Lake Reflection',
    category: 'Cosmic',
    url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'nebula',
    name: 'Apple Silicon Dark Nebula',
    subtitle: '4K Deep Space & Stellar Violet',
    category: 'Cosmic',
    url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'cupertino-slate',
    name: 'Cupertino Titanium Slate',
    subtitle: '4K Minimalist Architecture',
    category: 'Abstract 4K',
    url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=600&q=80',
  }
];

export default function Desktop() {
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [desktopMenu, setDesktopMenu] = useState<DesktopContextMenu | null>(null);
  const [showWallpaperModal, setShowWallpaperModal] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [wallpaperCategory, setWallpaperCategory] = useState<string>('All');
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [selectedDesktopId, setSelectedDesktopId] = useState<string | null>(null);

  const { openApp } = useWindowManager();
  const { wallpaper, theme, updateSettings, pinnedDesktopItems, unpinFromDesktop } = useSettingsStore();
  const { navigateFinder, openFileInEditor } = useEditorStore();
  const { minimizeAllWindows } = useWindowStore();
  const activeConnectionId = useConnectionStore(s => s.activeConnectionId);
  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });
  const username = activeServer?.username || 'root';
  const userHome = username === 'root' ? '/root' : `/home/${username}`;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') {
        setShowSpotlight(s => !s);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close context menu and unselect icon on left click anywhere
  useEffect(() => {
    const handleClick = () => {
      setDesktopMenu(null);
      setSelectedDesktopId(null);
    };
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
    const desktopPath = `${userHome}/Desktop/${folderName}`;
    try {
      await sftpMkdir(activeConnectionId, desktopPath);
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
      navigateFinder(`${userHome}/Desktop`);
      openApp('files', 'Finder');
    } catch (err: any) {
      alert(`Could not create file: ${err?.message || err}`);
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

  const desktopIcons = [
    { 
      id: 'root', 
      label: 'Macintosh HD', 
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
      id: 'terminal', 
      label: 'Terminal', 
      icon: Terminal, 
      tileBg: 'from-[#334155] to-[#0f172a]', 
      action: () => openApp('terminal', 'Terminal') 
    },
    { 
      id: 'editor', 
      label: 'Code Editor', 
      icon: FileCode, 
      tileBg: 'from-[#a855f7] to-[#7e22ce]', 
      action: () => openApp('editor', 'Code Editor') 
    },
    { 
      id: 'monitor', 
      label: 'Activity Monitor', 
      icon: Activity, 
      tileBg: 'from-[#06b6d4] to-[#0e7490]', 
      action: () => openApp('monitor', 'Activity Monitor') 
    },
    { 
      id: 'trash', 
      label: 'Trash', 
      icon: Trash2, 
      tileBg: 'from-[#64748b] to-[#334155]', 
      action: () => { navigateFinder(`${userHome}/.local/share/Trash`); openApp('files', 'Finder'); } 
    },
  ];

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
    >
      {/* Subtle vignette shadow overlay for macOS depth */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/35 pointer-events-none" />

      {/* Top Taskbar */}
      <Taskbar onOpenWallpapers={() => setShowWallpaperModal(true)} />

      {/* Hidden File Input for Custom Wallpaper Upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleCustomFileUpload}
        accept="image/*"
        className="hidden"
      />

      {/* Desktop Canvas Icons (Standard System Icons + Pinned Folders & Files) */}
      <div className="absolute top-12 left-6 grid grid-cols-1 gap-3 z-0 pointer-events-auto">
        {desktopIcons.map(item => {
          const Icon = item.icon;
          const isSelected = selectedDesktopId === item.id;
          return (
            <div
              key={item.id}
              onClick={(e) => { e.stopPropagation(); setSelectedDesktopId(item.id); }}
              onDoubleClick={(e) => { e.stopPropagation(); item.action(); }}
              className={`flex flex-col items-center w-24 p-2 rounded-2xl cursor-pointer transition-all group select-none text-center ${
                isSelected
                  ? 'bg-blue-600/35 backdrop-blur-md border border-blue-400/60 shadow-lg'
                  : 'hover:bg-black/30 hover:backdrop-blur-md border border-transparent hover:border-white/20'
              }`}
            >
              <div 
                className={`w-12 h-12 rounded-[14px] bg-gradient-to-br ${item.tileBg} flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.5)] border border-white/25 group-hover:scale-105 transition-transform`}
              >
                <Icon className="w-6 h-6 text-white drop-shadow-md" />
              </div>
              <span className={`text-[11px] font-medium mt-1.5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] break-words max-w-full leading-tight ${
                isSelected ? 'text-blue-200' : 'text-white'
              }`}>
                {item.label}
              </span>
            </div>
          );
        })}

        {/* User Pinned Items from Finder */}
        {pinnedDesktopItems.map(item => {
          const isSelected = selectedDesktopId === item.id;
          return (
            <div
              key={item.id}
              onClick={(e) => { e.stopPropagation(); setSelectedDesktopId(item.id); }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (item.type === 'dir') {
                  navigateFinder(item.path);
                  openApp('files', 'Finder');
                } else {
                  openFileInEditor(item.path);
                  openApp('editor', 'Code Editor');
                }
              }}
              className={`flex flex-col items-center w-24 p-2 rounded-2xl cursor-pointer transition-all group select-none text-center ${
                isSelected
                  ? 'bg-blue-600/35 backdrop-blur-md border border-blue-400/60 shadow-lg'
                  : 'hover:bg-black/30 hover:backdrop-blur-md border border-transparent hover:border-white/20'
              }`}
              title={`${item.name} (${item.path})`}
            >
              <div 
                className={`w-12 h-12 rounded-[14px] bg-gradient-to-br ${
                  item.type === 'dir' ? 'from-amber-400 to-amber-600' : 'from-indigo-500 to-purple-600'
                } flex items-center justify-center shadow-[0_8px_20px_rgba(0,0,0,0.5)] border border-white/25 group-hover:scale-105 transition-transform`}
              >
                {item.type === 'dir' ? (
                  <Folder className="w-6 h-6 text-white drop-shadow-md" />
                ) : (
                  <FileCode className="w-6 h-6 text-white drop-shadow-md" />
                )}
              </div>
              <span className={`text-[11px] font-medium mt-1.5 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] break-words max-w-full leading-tight line-clamp-2 ${
                isSelected ? 'text-blue-200' : 'text-white'
              }`}>
                {item.name}
              </span>
            </div>
          );
        })}
      </div>

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

      {/* Desktop Right-Click Context Menu */}
      {desktopMenu && (
        <div 
          className="fixed z-50 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.6)] py-1.5 w-60 text-xs text-gray-200 select-none animate-in fade-in duration-100"
          style={{ top: Math.min(desktopMenu.y, window.innerHeight - 280), left: Math.min(desktopMenu.x, window.innerWidth - 250) }}
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

          <div 
            onClick={() => { openApp('terminal', 'Terminal'); setDesktopMenu(null); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-lg mx-1 flex items-center space-x-2.5 cursor-pointer"
          >
            <Terminal className="w-4 h-4 text-emerald-400" />
            <span>Open Terminal Here</span>
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
    </div>
  );
}

