import React, { useState, useEffect, useCallback } from 'react';
import { Package, Search, Download, Trash2, ArrowUpCircle, CheckCircle, RefreshCw, AlertCircle } from 'lucide-react';
import { packageList, packageUpgradable, packageInstall, packageRemove, packageUpdate } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface PackageItem {
  name: string;
  version: string;
  arch: string;
  size: string;
  description: string;
  upgradable?: boolean;
  newVersion?: string;
}

export default function PackageManager() {
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [tab, setTab] = useState<'installed' | 'upgrades' | 'search'>('installed');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const loadPackages = useCallback(async () => {
    setLoading(true);
    setStatusMessage(null);
    try {
      const [allPkgs, upPkgs] = await Promise.all([
        packageList(activeConnId),
        packageUpgradable(activeConnId)
      ]);

      const upMap = new Map<string, string>();
      if (upPkgs && Array.isArray(upPkgs)) {
        upPkgs.forEach((p: any) => upMap.set(p.name, p.version));
      }

      if (allPkgs && Array.isArray(allPkgs)) {
        setPackages(allPkgs.map((p: any) => ({
          name: p.name,
          version: p.version,
          arch: p.arch || 'amd64',
          size: p.size ? `${(p.size / 1024).toFixed(0)} KB` : '—',
          description: p.description || '',
          upgradable: upMap.has(p.name),
          newVersion: upMap.get(p.name)
        })));
      }
    } catch (err) {
      console.warn('Failed to load packages:', err);
    } finally {
      setLoading(false);
    }
  }, [activeConnId]);

  useEffect(() => {
    loadPackages();
  }, [loadPackages]);

  const upgrades = packages.filter(p => p.upgradable);

  const upgradeAll = async () => {
    setIsUpdating(true);
    setStatusMessage('Running live system package upgrade (apt/dnf)...');
    try {
      const res = await packageUpdate(activeConnId);
      setStatusMessage(res || 'System packages updated successfully');
      await loadPackages();
    } catch (err) {
      setStatusMessage(`Error upgrading packages: ${err}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const removePackage = async (name: string) => {
    if (!confirm(`Are you sure you want to uninstall '${name}' from the server?`)) return;
    try {
      setStatusMessage(`Uninstalling ${name}...`);
      await packageRemove(activeConnId, name);
      setPackages(prev => prev.filter(p => p.name !== name));
      setStatusMessage(`Package ${name} uninstalled`);
    } catch (err) {
      setStatusMessage(`Failed to remove ${name}: ${err}`);
    }
  };

  const filtered = packages.filter(p => {
    if (tab === 'upgrades') return p.upgradable;
    return p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-y-auto">
      {/* Top Banner Stats */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs">Installed Packages</div>
          <div className="text-xl font-bold mt-1">{loading ? '...' : packages.length}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Live Linux OS Packages</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs flex items-center justify-between">
            <span>Updates Available</span>
            <ArrowUpCircle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold mt-1 text-amber-400">{loading ? '...' : upgrades.length}</div>
          <div className="text-[11px] text-amber-300 mt-0.5">Security & features</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs">Package System</div>
          <div className="text-base font-bold font-mono text-emerald-400 mt-1">APT / DNF / PACMAN</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Native Remote Manager</div>
        </div>
      </div>

      {statusMessage && (
        <div className="bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs px-3 py-2 rounded-lg flex items-center justify-between">
          <span>{statusMessage}</span>
          <button onClick={() => setStatusMessage(null)} className="text-gray-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Tabs and Actions */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex space-x-1 bg-[#1e1e2e] p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => setTab('installed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'installed' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            All Installed ({packages.length})
          </button>
          <button
            onClick={() => setTab('upgrades')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
              tab === 'upgrades' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            <span>Updates</span>
            {upgrades.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-amber-500 text-black text-[10px] font-bold flex items-center justify-center">
                {upgrades.length}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center space-x-2">
          {tab === 'upgrades' && upgrades.length > 0 && (
            <button
              onClick={upgradeAll}
              disabled={isUpdating}
              className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>{isUpdating ? 'Upgrading System...' : 'Upgrade All Packages'}</span>
            </button>
          )}

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search package..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#1e1e2e] border border-white/10 rounded-lg pl-8 pr-3 py-1 text-xs text-gray-200 focus:outline-none w-52"
            />
          </div>

          <button
            onClick={loadPackages}
            disabled={loading}
            className="p-1.5 bg-[#1e1e2e] hover:bg-white/10 border border-white/10 rounded-lg text-gray-300 hover:text-white transition-colors"
            title="Refresh Packages"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* Package List Table */}
      <div className="flex-1 bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden flex flex-col">
        <table className="w-full text-left text-xs">
          <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
            <tr>
              <th className="py-2.5 px-3">Package Name</th>
              <th className="py-2.5 px-3">Installed Version</th>
              <th className="py-2.5 px-3">Arch</th>
              <th className="py-2.5 px-3">Size</th>
              <th className="py-2.5 px-3">Description</th>
              <th className="py-2.5 px-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-gray-500">
                  {loading ? 'Fetching packages from server...' : 'No packages found'}
                </td>
              </tr>
            ) : (
              filtered.map(pkg => (
                <tr key={pkg.name} className="hover:bg-white/[0.02] transition-colors">
                  <td className="py-2.5 px-3 font-mono font-bold text-white flex items-center space-x-2">
                    <Package className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span>{pkg.name}</span>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-gray-300">
                    {pkg.version}
                    {pkg.upgradable && (
                      <span className="block text-[10px] text-amber-400">➜ {pkg.newVersion}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-gray-500">{pkg.arch}</td>
                  <td className="py-2.5 px-3 text-gray-400">{pkg.size}</td>
                  <td className="py-2.5 px-3 text-gray-400 truncate max-w-sm">{pkg.description || '—'}</td>
                  <td className="py-2.5 px-3 text-right">
                    <button
                      onClick={() => removePackage(pkg.name)}
                      className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400"
                      title="Uninstall"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
