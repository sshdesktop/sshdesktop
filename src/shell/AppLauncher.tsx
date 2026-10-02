import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal, Folder, FileCode, Monitor, Activity, Settings,
  Container, Server, ScrollText, Globe, Package, Users,
  Clock, Database, Shield, HardDrive, Flame, StickyNote, Search, X
} from 'lucide-react';
import { useWindowManager } from '../lib/hooks/useWindowManager';

const ALL_APPS = [
  { id: 'terminal', icon: Terminal, label: 'Terminal', category: 'Core', gradient: 'from-[#334155] to-[#0f172a]' },
  { id: 'files', icon: Folder, label: 'Finder', category: 'Core', gradient: 'from-[#0ea5e9] to-[#0284c7]' },
  { id: 'editor', icon: FileCode, label: 'Code Editor', category: 'Core', gradient: 'from-[#a855f7] to-[#7e22ce]' },
  { id: 'monitor', icon: Monitor, label: 'Activity Monitor', category: 'System', gradient: 'from-[#06b6d4] to-[#0e7490]' },
  { id: 'processes', icon: Activity, label: 'Process Manager', category: 'System', gradient: 'from-[#f43f5e] to-[#be123c]' },
  { id: 'services', icon: Server, label: 'Services', category: 'System', gradient: 'from-[#8b5cf6] to-[#6d28d9]' },
  { id: 'docker', icon: Container, label: 'Docker Manager', category: 'DevOps', gradient: 'from-[#3b82f6] to-[#1d4ed8]' },
  { id: 'logs', icon: ScrollText, label: 'System Logs', category: 'System', gradient: 'from-[#f97316] to-[#c2410c]' },
  { id: 'network', icon: Globe, label: 'Network & Ports', category: 'Network', gradient: 'from-[#14b8a6] to-[#0f766e]' },
  { id: 'packages', icon: Package, label: 'Package Manager', category: 'System', gradient: 'from-[#ec4899] to-[#be185d]' },
  { id: 'users', icon: Users, label: 'Users & Groups', category: 'Security', gradient: 'from-[#6366f1] to-[#4338ca]' },
  { id: 'cron', icon: Clock, label: 'Cron Scheduler', category: 'System', gradient: 'from-[#e11d48] to-[#9f1239]' },
  { id: 'database', icon: Database, label: 'SQL Client', category: 'Data', gradient: 'from-[#0284c7] to-[#0369a1]' },
  { id: 'firewall', icon: Flame, label: 'Firewall (UFW)', category: 'Security', gradient: 'from-[#ea580c] to-[#9a3412]' },
  { id: 'disks', icon: HardDrive, label: 'Disk Utilities', category: 'System', gradient: 'from-[#10b981] to-[#047857]' },
  { id: 'security', icon: Shield, label: 'Security Auditor', category: 'Security', gradient: 'from-[#eab308] to-[#a16207]' },
  { id: 'notes', icon: StickyNote, label: 'Quick Notes', category: 'Utility', gradient: 'from-[#d946ef] to-[#a21caf]' },
  { id: 'settings', icon: Settings, label: 'System Settings', category: 'System', gradient: 'from-[#64748b] to-[#334155]' }
];

export default function AppLauncher({ onClose }: { onClose: () => void }) {
  const { openApp } = useWindowManager();
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const categories = ['All', 'Core', 'System', 'DevOps', 'Network', 'Security', 'Data', 'Utility'];

  const filtered = ALL_APPS.filter(app => {
    const matchesQuery = app.label.toLowerCase().includes(query.toLowerCase()) ||
      app.category.toLowerCase().includes(query.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || app.category === selectedCategory;
    return matchesQuery && matchesCategory;
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[99999] bg-black/75 backdrop-blur-3xl flex flex-col items-center pt-14 pb-12 px-6 overflow-y-auto select-none"
      onClick={onClose}
    >
      {/* Top Search Bar & Category Pills */}
      <div className="w-full max-w-xl flex flex-col items-center space-y-4 mb-10" onClick={e => e.stopPropagation()}>
        <div className="relative w-full">
          <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            autoFocus
            type="text"
            placeholder="Search Launchpad (e.g. Terminal, Files, Docker)..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-12 pr-10 py-3.5 rounded-2xl bg-white/10 border border-white/20 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm backdrop-blur-2xl shadow-[0_15px_40px_rgba(0,0,0,0.5)] transition-all"
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

        {/* Category Pills */}
        <div className="flex items-center space-x-1.5 overflow-x-auto max-w-full pb-1 scrollbar-none">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                selectedCategory === cat
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Applications Grid with authentic macOS 3D squircle tiles */}
      <div
        className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-8 max-w-5xl w-full"
        onClick={e => e.stopPropagation()}
      >
        {filtered.map(app => {
          const Icon = app.icon;
          return (
            <motion.div
              key={app.id}
              whileHover={{ scale: 1.08, y: -6 }}
              whileTap={{ scale: 0.95 }}
              className="flex flex-col items-center space-y-2.5 cursor-pointer group"
              onClick={() => {
                openApp(app.id, app.label);
                onClose();
              }}
            >
              <div
                className={`relative w-20 h-20 rounded-[22px] bg-gradient-to-br ${app.gradient} border border-white/25 flex items-center justify-center shadow-[0_12px_28px_rgba(0,0,0,0.6)] group-hover:shadow-[0_16px_36px_rgba(59,130,246,0.35)] transition-all overflow-hidden`}
              >
                {/* Specular sheen reflection overlay */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/25 via-transparent to-transparent pointer-events-none" />
                <Icon className="w-10 h-10 text-white drop-shadow-md transition-transform group-hover:scale-110" />
              </div>
              <span className="text-xs font-medium text-gray-200 text-center line-clamp-1 group-hover:text-white drop-shadow-md">
                {app.label}
              </span>
            </motion.div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-gray-400 text-sm mt-16 font-medium">No applications found matching "{query}"</div>
      )}
    </motion.div>
  );
}
