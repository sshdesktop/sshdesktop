import React, { useState, useEffect, useCallback } from 'react';
import { 
  Package, Search, Download, Trash2, ArrowUpCircle, CheckCircle, 
  RefreshCw, Plus, X, AlertCircle, ShieldCheck, Terminal
} from 'lucide-react';
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
  const [tab, setTab] = useState<'installed' | 'upgrades'>('installed');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Install Package Modal
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [installPkgName, setInstallPkgName] = useState('');

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

  // Upgrade ALL packages
  const handleUpgradeAll = async () => {
    setIsUpdatingAll(true);
    setStatusMessage('Running full system package upgrade (apt/dnf)...');
    try {
      const res = await packageUpdate(activeConnId);
      setStatusMessage(res || 'All system packages upgraded successfully');
      await loadPackages();
    } catch (err: any) {
      setStatusMessage(`Error upgrading packages: ${err?.message || err}`);
    } finally {
      setIsUpdatingAll(false);
    }
  };

  // Upgrade SPECIFIC package
  const handleUpgradeSingle = async (name: string) => {
    setActionInProgress(name);
    setStatusMessage(`Upgrading package ${name}...`);
    try {
      const res = await packageInstall(activeConnId, name);
      setStatusMessage(res || `Package ${name} upgraded to latest version`);
      await loadPackages();
    } catch (err: any) {
      setStatusMessage(`Error updating ${name}: ${err?.message || err}`);
    } finally {
      setActionInProgress(null);
    }
  };

  // Install NEW package
  const handleInstallNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!installPkgName.trim()) return;
    const pkg = installPkgName.trim();
    setActionInProgress(pkg);
    setShowInstallModal(false);
    setStatusMessage(`Installing package '${pkg}' from repository...`);
    try {
      const res = await packageInstall(activeConnId, pkg);
      setStatusMessage(res || `Package '${pkg}' installed successfully`);
      setInstallPkgName('');
      await loadPackages();
    } catch (err: any) {
      setStatusMessage(`Failed to install ${pkg}: ${err?.message || err}`);
    } finally {
      setActionInProgress(null);
    }
  };

  // Remove/Uninstall package
  const handleRemovePackage = async (name: string) => {
    if (!confirm(`Are you sure you want to uninstall package '${name}' from server?`)) return;
    setActionInProgress(name);
    try {
      setStatusMessage(`Uninstalling ${name}...`);
      await packageRemove(activeConnId, name);
      setPackages(prev => prev.filter(p => p.name !== name));
      setStatusMessage(`Package '${name}' uninstalled successfully`);
    } catch (err: any) {
      setStatusMessage(`Failed to remove ${name}: ${err?.message || err}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const filtered = packages.filter(p => {
    if (tab === 'upgrades') return p.upgradable;
    return p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] p-4 space-y-4 overflow-hidden select-none">
      {/* Top Banner Stats */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs">Installed Packages</div>
          <div className="text-xl font-bold mt-1 text-white">{loading ? '...' : packages.length}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Live Remote Linux OS Packages</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08]">
          <div className="text-gray-400 text-xs flex items-center justify-between">
            <span>Updates Available</span>
            <ArrowUpCircle className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-xl font-bold mt-1 text-amber-400">{loading ? '...' : upgrades.length}</div>
          <div className="text-[11px] text-amber-300 mt-0.5">Security & Version Updates</div>
        </div>

        <div className="bg-[#1e1e2e] p-3 rounded-xl border border-white/[0.08] flex items-center justify-between">
          <div>
            <div className="text-gray-400 text-xs">Package Manager</div>
            <div className="text-sm font-bold font-mono text-emerald-400 mt-1">APT / DNF / PACMAN</div>
            <div className="text-[11px] text-gray-500 mt-0.5">Native OS Repositories</div>
          </div>
          <button
            onClick={() => setShowInstallModal(true)}
            className="flex items-center space-x-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-2 rounded-xl transition-all shadow-md font-medium"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Install Package</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="bg-blue-500/10 border border-blue-500/30 text-blue-300 text-xs px-3 py-2 rounded-xl flex items-center justify-between shrink-0">
          <span className="flex items-center space-x-2">
            <CheckCircle className="w-4 h-4 text-blue-400 shrink-0" />
            <span>{statusMessage}</span>
          </span>
          <button onClick={() => setStatusMessage(null)} className="text-gray-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Tabs and Actions */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex space-x-1 bg-[#1e1e2e] p-1 rounded-xl border border-white/[0.08]">
          <button
            onClick={() => setTab('installed')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === 'installed' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            All Installed ({packages.length})
          </button>
          <button
            onClick={() => setTab('upgrades')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
              tab === 'upgrades' ? 'bg-[var(--accent)] text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <span>Updates Available</span>
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
              onClick={handleUpgradeAll}
              disabled={isUpdatingAll}
              className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg transition-colors font-medium shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isUpdatingAll ? 'animate-spin' : ''}`} />
              <span>{isUpdatingAll ? 'Upgrading All...' : 'Upgrade All Packages'}</span>
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
      <div className="flex-1 min-h-0 bg-[#1e1e2e] rounded-xl border border-white/[0.08] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="py-2.5 px-3">Package Name</th>
                <th className="py-2.5 px-3">Installed Version</th>
                <th className="py-2.5 px-3">Arch</th>
                <th className="py-2.5 px-3">Size</th>
                <th className="py-2.5 px-3">Description</th>
                <th className="py-2.5 px-3 text-right">Actions</th>
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
                    <td className="py-2.5 px-3 text-right space-x-2">
                      {pkg.upgradable && (
                        <button
                          onClick={() => handleUpgradeSingle(pkg.name)}
                          disabled={actionInProgress === pkg.name}
                          className="px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] font-semibold transition-colors"
                          title="Update this package specifically"
                        >
                          {actionInProgress === pkg.name ? 'Updating...' : 'Update'}
                        </button>
                      )}
                      <button
                        onClick={() => handleRemovePackage(pkg.name)}
                        disabled={actionInProgress === pkg.name}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400 transition-colors"
                        title="Uninstall Package"
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

      {/* Install Package Modal */}
      {showInstallModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form 
            onSubmit={handleInstallNew}
            className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-white font-bold text-sm">
                <Package className="w-4 h-4 text-blue-400" />
                <span>Install Linux Package</span>
              </div>
              <button 
                type="button" 
                onClick={() => setShowInstallModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="text-xs text-gray-400 block mb-1">Package Name</label>
              <input
                type="text"
                autoFocus
                value={installPkgName}
                onChange={e => setInstallPkgName(e.target.value)}
                placeholder="e.g. nginx, git, htop, curl, nodejs, build-essential"
                className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
              />
              <span className="text-[10px] text-gray-500 mt-1 block">
                Will execute native package installer (apt install -y / dnf install -y)
              </span>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowInstallModal(false)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!installPkgName.trim()}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors"
              >
                Install Now
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
