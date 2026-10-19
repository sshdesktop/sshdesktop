import React, { useState, useRef } from 'react';
import { Palette, Plus, Check, Image as ImageIcon, Sparkles, X, Globe, Upload } from 'lucide-react';
import { WALLPAPERS, WallpaperItem } from './types';
import { useSettingsStore, useConnectionStore } from '../../lib/store';
import { sftpMkdir, sftpWriteTextFile, sftpWriteFile } from '../../lib/tauri-bridge';

interface WallpaperModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WallpaperModal({ isOpen, onClose }: WallpaperModalProps) {
  const { wallpaper, updateSettings, theme } = useSettingsStore();
  const { activeConnectionId, connections } = useConnectionStore();
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const activeServer = connections.find(c => c.id === activeConnectionId);
  const username = activeServer?.username || 'root';
  const userHome = username === 'root' ? '/root' : `/home/${username}`;

  const categories = ['All', 'macOS Official', 'Nature 4K', 'Cyberpunk & Sci-Fi 4K', 'Minimal & Dark 4K', 'Anime & Artistic 4K'];

  const filteredWallpapers = selectedCategory === 'All'
    ? WALLPAPERS
    : WALLPAPERS.filter(w => w.category === selectedCategory);

  const isCustom = wallpaper?.startsWith('data:') || wallpaper?.startsWith('http') || wallpaper?.startsWith('blob:');

  const handleSelectWallpaper = async (wpId: string) => {
    updateSettings({ wallpaper: wpId });
    // Persist to server ~/.clouddesk/settings.json
    if (activeConnectionId) {
      try {
        const configDir = `${userHome}/.clouddesk`;
        await sftpMkdir(activeConnectionId, configDir).catch(() => {});
        const patch = { wallpaper: wpId, updated_at: new Date().toISOString() };
        await sftpWriteTextFile(activeConnectionId, `${configDir}/settings_wallpaper.json`, JSON.stringify(patch, null, 2)).catch(() => {});
      } catch {}
    }
  };

  const handleApplyCustomUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = customUrlInput.trim();
    if (!url) return;
    updateSettings({ wallpaper: url });
    setCustomUrlInput('');
    if (activeConnectionId) {
      try {
        const configDir = `${userHome}/.clouddesk`;
        await sftpMkdir(activeConnectionId, configDir).catch(() => {});
        const patch = { wallpaper: url, updated_at: new Date().toISOString() };
        await sftpWriteTextFile(activeConnectionId, `${configDir}/settings_wallpaper.json`, JSON.stringify(patch, null, 2)).catch(() => {});
      } catch {}
    }
  };

  const handleCustomFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setIsUploading(true);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result;
      if (typeof dataUrl === 'string') {
        updateSettings({ wallpaper: dataUrl });

        // Save wallpaper image data directly to ~/.clouddesk/wallpapers/
        if (activeConnectionId) {
          try {
            const configDir = `${userHome}/.clouddesk`;
            const wpDir = `${configDir}/wallpapers`;
            await sftpMkdir(activeConnectionId, configDir).catch(() => {});
            await sftpMkdir(activeConnectionId, wpDir).catch(() => {});
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            await sftpWriteTextFile(activeConnectionId, `${wpDir}/current_wallpaper.txt`, dataUrl).catch(() => {});
            await sftpWriteTextFile(activeConnectionId, `${configDir}/settings_wallpaper.json`, JSON.stringify({
              wallpaper: dataUrl,
              filename: safeName,
              updated_at: new Date().toISOString()
            }, null, 2)).catch(() => {});
          } catch (err) {
            console.warn('Failed to save wallpaper to server:', err);
          }
        }
      }
      setIsUploading(false);
    };
    reader.onerror = () => setIsUploading(false);
    reader.readAsDataURL(file);
  };

  const isLight = theme === 'light';

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200 select-none">
      <div className={`border rounded-3xl w-full max-w-3xl p-6 space-y-5 shadow-[0_30px_90px_rgba(0,0,0,0.8)] flex flex-col max-h-[90vh] ${
        isLight ? 'bg-white/95 border-black/15 text-slate-800' : 'bg-[#181825]/95 border-white/20 text-white'
      }`}>
        {/* Header */}
        <div className={`flex items-center justify-between border-b pb-4 ${isLight ? 'border-slate-200' : 'border-white/10'}`}>
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-500 to-indigo-500 flex items-center justify-center shadow-lg text-white">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h3 className={`font-bold text-base tracking-wide ${isLight ? 'text-slate-900' : 'text-white'}`}>
                macOS 4K Ultra-HD Wallpapers
              </h3>
              <p className={`text-xs ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
                Authentic Apple 4K imagery and custom photo upload synced to server ~/.clouddesk
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
              isLight ? 'bg-slate-100 hover:bg-slate-200 text-slate-600' : 'bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Custom Upload & URL Actions Bar */}
        <div className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl border ${
          isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/5 border-white/10'
        }`}>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-2 shadow-lg transition-all cursor-pointer disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            <span>{isUploading ? 'Uploading to Server...' : 'Upload Wallpaper to Server'}</span>
          </button>

          <form onSubmit={handleApplyCustomUrl} className="flex items-center space-x-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <Globe className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Paste direct 4K image URL..."
                value={customUrlInput}
                onChange={(e) => setCustomUrlInput(e.target.value)}
                className={`w-full rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:border-blue-400 border ${
                  isLight 
                    ? 'bg-white border-slate-300 text-slate-800 placeholder-slate-400' 
                    : 'bg-black/40 border-white/15 text-white placeholder-gray-500'
                }`}
              />
            </div>
            <button
              type="submit"
              className={`px-3.5 py-1.5 text-xs font-medium rounded-xl transition-colors shrink-0 cursor-pointer ${
                isLight ? 'bg-slate-200 hover:bg-slate-300 text-slate-800' : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              Apply URL
            </button>
          </form>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleCustomFileUpload}
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            className="hidden"
          />
        </div>

        {/* Category Filter Pills */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold'
                  : isLight
                  ? 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                  : 'bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Wallpapers Gallery Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 overflow-y-auto pr-1 flex-1 min-h-[300px]">
          {filteredWallpapers.map((item) => {
            const isSelected = wallpaper === item.id;
            return (
              <div
                key={item.id}
                onClick={() => handleSelectWallpaper(item.id)}
                className={`group relative rounded-2xl overflow-hidden aspect-video border transition-all cursor-pointer flex flex-col justify-end p-2.5 ${
                  isSelected
                    ? 'ring-4 ring-blue-500 border-transparent shadow-xl scale-[1.02]'
                    : isLight
                    ? 'border-slate-200 hover:border-blue-400 hover:shadow-lg'
                    : 'border-white/10 hover:border-white/30 hover:shadow-xl'
                }`}
              >
                <img
                  src={item.thumbnail}
                  alt={item.name}
                  className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent pointer-events-none" />

                <div className="relative z-10">
                  <div className="flex items-center justify-between">
                    <span className="text-white text-xs font-bold drop-shadow-md truncate">
                      {item.name}
                    </span>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shrink-0 shadow-md">
                        <Check className="w-3 h-3" />
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-300/80 drop-shadow truncate">
                    {item.subtitle}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Active Wallpaper Preview & Status */}
        <div className={`flex items-center justify-between pt-2 border-t text-xs ${
          isLight ? 'border-slate-200 text-slate-500' : 'border-white/10 text-gray-400'
        }`}>
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Active Wallpaper: <strong className={isLight ? 'text-slate-800' : 'text-white'}>{isCustom ? 'Custom Upload / URL' : WALLPAPERS.find(w => w.id === wallpaper)?.name || wallpaper}</strong></span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
