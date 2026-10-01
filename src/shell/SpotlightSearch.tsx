import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Terminal, Folder, FileCode, Monitor, Server, Container, Settings, ShieldCheck, Database, ArrowRight } from 'lucide-react';
import { useWindowManager } from '../lib/hooks/useWindowManager';

const SEARCHABLE_ITEMS = [
  { id: 'terminal', title: 'Terminal', desc: 'Open bash terminal session', icon: Terminal, category: 'Applications' },
  { id: 'files', title: 'Finder (Files)', desc: 'Browse remote SFTP filesystem', icon: Folder, category: 'Applications' },
  { id: 'editor', title: 'Code Editor', desc: 'Edit remote files with Monaco', icon: FileCode, category: 'Applications' },
  { id: 'monitor', title: 'Activity Monitor', desc: 'View live CPU/RAM/Network charts', icon: Monitor, category: 'Applications' },
  { id: 'services', title: 'System Services', desc: 'Manage systemd daemons and units', icon: Server, category: 'Applications' },
  { id: 'docker', title: 'Docker Containers', desc: 'Manage Docker apps & images', icon: Container, category: 'Applications' },
  { id: 'database', title: 'SQL Database Client', desc: 'Run SQL queries over SSH tunnel', icon: Database, category: 'Applications' },
  { id: 'security', title: 'Security Auditor', desc: 'Check firewall, ports & SSL certs', icon: ShieldCheck, category: 'Applications' },
  { id: 'settings', title: 'System Settings', desc: 'Configure themes, fonts and defaults', icon: Settings, category: 'Settings' }
];

export default function SpotlightSearch({ onClose }: { onClose: () => void }) {
  const { openApp } = useWindowManager();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const results = SEARCHABLE_ITEMS.filter(item =>
    item.title.toLowerCase().includes(query.toLowerCase()) ||
    item.desc.toLowerCase().includes(query.toLowerCase())
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[selectedIndex] || results[0];
      if (target) {
        openApp(target.id, target.title);
        onClose();
      }
    }
  };

  return (
    <div
      className="absolute inset-0 z-[200] flex items-start justify-center pt-28 bg-black/40 backdrop-blur-md select-none"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.96 }}
        transition={{ type: 'spring', damping: 25, stiffness: 400 }}
        className="w-[620px] bg-[#1e1e2e]/95 backdrop-blur-3xl rounded-2xl shadow-[0_24px_70px_rgba(0,0,0,0.6)] border border-white/[0.12] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-white/[0.08]">
          <Search className="w-5 h-5 text-gray-400 mr-3 shrink-0" />
          <input
            autoFocus
            type="text"
            placeholder="Spotlight Search apps, files, actions..."
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-none text-base text-white focus:outline-none placeholder-gray-500 font-medium"
          />
          <span className="text-[10px] text-gray-500 font-mono bg-white/5 px-2 py-1 rounded border border-white/10">ESC</span>
        </div>

        {/* Results List */}
        <div className="p-2 max-h-80 overflow-y-auto space-y-1">
          {results.length === 0 ? (
            <div className="p-8 text-center text-xs text-gray-400">
              No matching apps or commands found for "{query}"
            </div>
          ) : (
            results.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    openApp(item.id, item.title);
                    onClose();
                  }}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors ${
                    isSelected ? 'bg-[var(--accent)] text-black font-semibold' : 'hover:bg-white/5 text-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className={`p-2 rounded-lg ${isSelected ? 'bg-black/10' : 'bg-white/5 text-[var(--accent)]'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs">{item.title}</div>
                      <div className={`text-[11px] ${isSelected ? 'text-black/70 font-normal' : 'text-gray-400'}`}>
                        {item.desc}
                      </div>
                    </div>
                  </div>

                  <ArrowRight className={`w-4 h-4 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                </div>
              );
            })
          )}
        </div>

        <div className="h-7 bg-[#11111b] border-t border-white/[0.08] px-4 flex items-center justify-between text-[10px] font-mono text-gray-500">
          <span>Navigate with ↑ ↓ · Press Enter to open</span>
          <span>CloudDesk Spotlight</span>
        </div>
      </motion.div>
    </div>
  );
}
