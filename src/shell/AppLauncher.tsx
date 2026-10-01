import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Terminal, Folder, FileCode, Monitor, Activity, Settings,
  Container, Server, ScrollText, Globe, Package, Users,
  Clock, Database, Shield, HardDrive, Flame, StickyNote, Search, X
} from 'lucide-react';
import { useWindowManager } from '../lib/hooks/useWindowManager';

const ALL_APPS = [
  { id: 'terminal', icon: Terminal, label: 'Terminal', category: 'Core', color: '#89B4FA' },
  { id: 'files', icon: Folder, label: 'Finder (Files)', category: 'Core', color: '#89DCEB' },
  { id: 'editor', icon: FileCode, label: 'Code Editor', category: 'Core', color: '#A6E3A1' },
  { id: 'monitor', icon: Monitor, label: 'Activity Monitor', category: 'System', color: '#F9E2AF' },
  { id: 'processes', icon: Activity, label: 'Process Manager', category: 'System', color: '#F38BA8' },
  { id: 'services', icon: Server, label: 'System Services', category: 'System', color: '#CBA6F7' },
  { id: 'docker', icon: Container, label: 'Docker Manager', category: 'DevOps', color: '#74C7EC' },
  { id: 'logs', icon: ScrollText, label: 'System Logs', category: 'System', color: '#FAB387' },
  { id: 'network', icon: Globe, label: 'Network & Ports', category: 'Network', color: '#94E2D5' },
  { id: 'packages', icon: Package, label: 'Package Manager', category: 'System', color: '#F5C2E7' },
  { id: 'users', icon: Users, label: 'Users & Groups', category: 'Security', color: '#B4BEFE' },
  { id: 'cron', icon: Clock, label: 'Scheduled Tasks', category: 'System', color: '#EBA0AC' },
  { id: 'database', icon: Database, label: 'SQL Database', category: 'Data', color: '#89DCEB' },
  { id: 'firewall', icon: Flame, label: 'Firewall (UFW)', category: 'Security', color: '#F38BA8' },
  { id: 'disks', icon: HardDrive, label: 'Disk Utilities', category: 'Storage', color: '#A6E3A1' },
  { id: 'security', icon: Shield, label: 'Security Auditor', category: 'Security', color: '#F9E2AF' },
  { id: 'notes', icon: StickyNote, label: 'Quick Notes', category: 'Utility', color: '#CBA6F7' },
  { id: 'settings', icon: Settings, label: 'System Settings', category: 'System', color: '#9399B2' }
];

export default function AppLauncher({ onClose }: { onClose: () => void }) {
  const { openApp } = useWindowManager();
  const [query, setQuery] = useState('');

  const filtered = ALL_APPS.filter(app =>
    app.label.toLowerCase().includes(query.toLowerCase()) ||
    app.category.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <motion.div
      initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
      animate={{ opacity: 1, backdropFilter: 'blur(24px)' }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[100] bg-black/60 flex flex-col items-center p-12 overflow-y-auto select-none"
      onClick={onClose}
    >
      {/* Search Header */}
      <div className="relative mb-10 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          autoFocus
          type="text"
          placeholder="Search applications..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="w-full pl-12 pr-10 py-3.5 rounded-2xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)] text-base backdrop-blur-md shadow-2xl"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Applications Grid */}
      <div
        className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-6 max-w-4xl w-full"
        onClick={e => e.stopPropagation()}
      >
        {filtered.map(app => {
          const Icon = app.icon;
          return (
            <motion.div
              key={app.id}
              whileHover={{ scale: 1.08, y: -6 }}
              whileTap={{ scale: 0.95 }}
              className="flex flex-col items-center space-y-2 cursor-pointer group"
              onClick={() => {
                openApp(app.id, app.label);
                onClose();
              }}
            >
              <div
                className="w-20 h-20 rounded-2xl bg-[#1e1e2e]/80 border border-white/10 flex items-center justify-center group-hover:border-white/30 transition-all shadow-xl backdrop-blur-md"
              >
                <Icon className="w-10 h-10 transition-transform group-hover:scale-110" style={{ color: app.color }} />
              </div>
              <span className="text-xs font-medium text-gray-200 text-center line-clamp-1 group-hover:text-white">
                {app.label}
              </span>
            </motion.div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-gray-400 text-sm mt-12">No applications found matching "{query}"</div>
      )}
    </motion.div>
  );
}
