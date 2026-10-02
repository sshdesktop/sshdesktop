import React, { useState } from 'react';
import { useSettingsStore } from '../../lib/store';
import { Palette, Terminal, FileCode, Sliders, Info, ShieldCheck, Check } from 'lucide-react';
import { WALLPAPERS } from '../../shell/Desktop';

const ACCENT_COLORS = [
  { name: 'Sapphire Blue', value: '#89B4FA' },
  { name: 'Mauve Purple', value: '#CBA6F7' },
  { name: 'Emerald Green', value: '#A6E3A1' },
  { name: 'Flamingo Pink', value: '#F38BA8' },
  { name: 'Peach Orange', value: '#FAB387' },
  { name: 'Teal Cyan', value: '#94E2D5' }
];

export default function AppSettings() {
  const { theme, updateSettings, terminalFontSize, accentColor, wallpaper } = useSettingsStore();
  const [activeTab, setActiveTab] = useState<'appearance' | 'terminal' | 'editor' | 'ssh' | 'about'>('appearance');

  return (
    <div className="flex h-full bg-[#181825] text-[#cdd6f4]">
      {/* Settings Navigation Sidebar */}
      <div className="w-52 bg-[#1e1e2e] border-r border-white/[0.08] p-3 flex flex-col space-y-1 shrink-0 select-none">
        <div className="text-[11px] font-bold text-gray-500 uppercase px-2 mb-2">Preferences</div>

        <button
          onClick={() => setActiveTab('appearance')}
          className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            activeTab === 'appearance' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Palette className="w-4 h-4" />
          <span>Appearance</span>
        </button>

        <button
          onClick={() => setActiveTab('terminal')}
          className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            activeTab === 'terminal' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span>Terminal</span>
        </button>

        <button
          onClick={() => setActiveTab('editor')}
          className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            activeTab === 'editor' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <FileCode className="w-4 h-4" />
          <span>Code Editor</span>
        </button>

        <button
          onClick={() => setActiveTab('ssh')}
          className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            activeTab === 'ssh' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>SSH Defaults</span>
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setActiveTab('about')}
          className={`flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
            activeTab === 'about' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <Info className="w-4 h-4" />
          <span>About CloudDesk</span>
        </button>
      </div>

      {/* Main Settings Panel */}
      <div className="flex-1 p-6 overflow-y-auto space-y-6">
        {activeTab === 'appearance' && (
          <div className="space-y-6 max-w-xl">
            <div>
              <h3 className="text-base font-bold text-white mb-1">Color Palette & Theme</h3>
              <p className="text-xs text-gray-400">Choose the theme scheme for desktop windows and controls.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-2">Base Theme</label>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'dark', label: 'Catppuccin Mocha', desc: 'Dark theme (default)' },
                    { id: 'light', label: 'Catppuccin Latte', desc: 'Light clean theme' },
                    { id: 'auto', label: 'System Automatic', desc: 'Match OS setting' },
                  ].map(t => (
                    <div
                      key={t.id}
                      onClick={() => updateSettings({ theme: t.id as any })}
                      className={`p-3 rounded-xl border cursor-pointer transition-all ${
                        theme === t.id
                          ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-white'
                          : 'border-white/10 hover:border-white/20 text-gray-400'
                      }`}
                    >
                      <div className="font-bold text-xs text-white">{t.label}</div>
                      <div className="text-[10px] text-gray-500 mt-1">{t.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-2">Accent Highlight Color</label>
                <div className="flex items-center space-x-3">
                  {ACCENT_COLORS.map(c => (
                    <button
                      key={c.name}
                      onClick={() => updateSettings({ accentColor: c.value })}
                      style={{ backgroundColor: c.value }}
                      className="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110 shadow-lg"
                      title={c.name}
                    >
                      {accentColor === c.value && <Check className="w-4 h-4 text-black stroke-[3]" />}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-2">Desktop Wallpaper</label>
                <div className="grid grid-cols-2 gap-3">
                  {WALLPAPERS.map(w => {
                    const isSelected = (wallpaper || 'sonoma') === w.id;
                    return (
                      <div
                        key={w.id}
                        onClick={() => updateSettings({ wallpaper: w.id })}
                        className={`group relative overflow-hidden rounded-xl border p-2.5 cursor-pointer transition-all ${
                          isSelected
                            ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30 bg-white/5'
                            : 'border-white/10 hover:border-white/30 hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className={`h-16 w-full rounded-lg ${w.bg} flex items-center justify-center shadow-inner mb-2`}>
                          {isSelected && (
                            <span className="p-1 rounded-full bg-black/50 text-white backdrop-blur-md">
                              <Check className="w-4 h-4 stroke-[3]" />
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-semibold text-white truncate">{w.name}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'terminal' && (
          <div className="space-y-6 max-w-xl">
            <div>
              <h3 className="text-base font-bold text-white mb-1">Terminal Emulator</h3>
              <p className="text-xs text-gray-400">Customize xterm font styling and shell behaviors.</p>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-gray-300 mb-1.5 font-medium">Font Size: {terminalFontSize || 14}px</label>
                <input
                  type="range"
                  min="11"
                  max="22"
                  value={terminalFontSize || 14}
                  onChange={e => updateSettings({ terminalFontSize: parseInt(e.target.value) })}
                  className="w-64 accent-blue-500 cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-gray-300 mb-1.5 font-medium">Default Shell</label>
                <select className="bg-[#1e1e2e] border border-white/10 rounded-lg px-3 py-2 text-white w-64 focus:outline-none">
                  <option value="/bin/bash">/bin/bash</option>
                  <option value="/bin/zsh">/bin/zsh</option>
                  <option value="/bin/sh">/bin/sh</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'editor' && (
          <div className="space-y-6 max-w-xl">
            <div>
              <h3 className="text-base font-bold text-white mb-1">Monaco Code Editor</h3>
              <p className="text-xs text-gray-400">Editor tab sizes and syntax viewing options.</p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-gray-300 mb-1 font-medium">Tab Size</label>
                <select className="bg-[#1e1e2e] border border-white/10 rounded-lg px-3 py-2 text-white w-40 focus:outline-none">
                  <option value="4">4 spaces</option>
                  <option value="2">2 spaces</option>
                </select>
              </div>

              <div className="flex items-center space-x-2 pt-2">
                <input type="checkbox" id="minimap" defaultChecked className="rounded bg-[#1e1e2e] text-blue-500" />
                <label htmlFor="minimap" className="text-gray-300">Show code minimap sidebar</label>
              </div>

              <div className="flex items-center space-x-2">
                <input type="checkbox" id="wordwrap" defaultChecked className="rounded bg-[#1e1e2e] text-blue-500" />
                <label htmlFor="wordwrap" className="text-gray-300">Wrap long lines</label>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ssh' && (
          <div className="space-y-6 max-w-xl">
            <div>
              <h3 className="text-base font-bold text-white mb-1">SSH Connection Parameters</h3>
              <p className="text-xs text-gray-400">Default network timeouts and encryption algorithms.</p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-gray-300 mb-1 font-medium">Keepalive Interval</label>
                <input
                  type="text"
                  defaultValue="30 seconds"
                  className="bg-[#1e1e2e] border border-white/10 rounded-lg px-3 py-2 text-white w-48 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-gray-300 mb-1 font-medium">Connection Timeout</label>
                <input
                  type="text"
                  defaultValue="15 seconds"
                  className="bg-[#1e1e2e] border border-white/10 rounded-lg px-3 py-2 text-white w-48 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'about' && (
          <div className="space-y-4 max-w-xl">
            <div className="flex items-center space-x-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center font-bold text-white text-xl shadow-lg">
                ☁
              </div>
              <div>
                <h3 className="font-bold text-lg text-white">CloudDesk</h3>
                <div className="text-xs text-gray-400">Version 1.0.0 (Release)</div>
              </div>
            </div>

            <div className="bg-[#1e1e2e] p-4 rounded-xl border border-white/[0.08] space-y-2 text-xs text-gray-300">
              <p>
                Agentless, lightweight, cross-platform remote Linux desktop client. Connects directly over standard SSH (port 22) with zero software installed on the server.
              </p>
              <div className="pt-2 border-t border-white/[0.05] grid grid-cols-2 gap-2 text-gray-400 font-mono text-[11px]">
                <div>Backend: Rust / russh</div>
                <div>Runtime: Tauri 2.0</div>
                <div>Frontend: React 19 + TypeScript</div>
                <div>Styling: TailwindCSS 4</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
