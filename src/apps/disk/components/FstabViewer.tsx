import React, { useState, useEffect } from 'react';
import { FileText, RefreshCw, Plus, Trash2, ArrowUpRight, Sliders, HardDrive, Shield } from 'lucide-react';
import { FstabEntry, diskGetFstab, diskUnmount } from '../../../lib/tauri-bridge';

interface FstabViewerProps {
  connId: string;
  onMountClick: () => void;
  onRemountClick: (entry: FstabEntry) => void;
}

export default function FstabViewer({
  connId,
  onMountClick,
  onRemountClick,
}: FstabViewerProps) {
  const [entries, setEntries] = useState<FstabEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFstab = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await diskGetFstab(connId);
      setEntries(data);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFstab();
  }, [connId]);

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-white flex items-center space-x-2">
            <FileText className="w-4 h-4 text-blue-400" />
            <span>Persistent Mount Table (/etc/fstab)</span>
          </h3>
          <p className="text-xs text-gray-400">
            Filesystems configured to automatically mount on Linux server startup
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={loadFstab}
            disabled={loading}
            className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition-colors"
            title="Reload fstab"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onMountClick}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md active:scale-95 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Mount Entry</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-xs text-rose-300">
          Notice: {error}
        </div>
      )}

      <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl overflow-hidden shadow-xl">
        <table className="w-full text-left text-xs font-mono">
          <thead className="bg-black/30 text-gray-400 border-b border-white/10 font-sans">
            <tr>
              <th className="py-3 px-4">Filesystem Device / UUID</th>
              <th className="py-3 px-4">Mount Point</th>
              <th className="py-3 px-4">Type</th>
              <th className="py-3 px-4">Options</th>
              <th className="py-3 px-4">Dump / Pass</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-500 font-sans text-xs">
                  {loading ? 'Reading /etc/fstab...' : 'No persistent fstab entries found.'}
                </td>
              </tr>
            ) : (
              entries.map((entry, idx) => {
                const isRoot = entry.file === '/' || entry.file === '/boot';
                return (
                  <tr key={idx} className="hover:bg-white/[0.03] transition-colors">
                    <td className="py-3 px-4 font-bold text-white flex items-center space-x-2 truncate max-w-[220px]">
                      <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="truncate" title={entry.spec}>{entry.spec}</span>
                    </td>
                    <td className="py-3 px-4 text-blue-300 font-semibold">
                      <div className="flex items-center space-x-1.5">
                        <span>{entry.file}</span>
                        {isRoot && (
                          <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[9px] font-sans font-bold uppercase">
                            Root
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 uppercase text-[10px] text-purple-300">{entry.vfstype}</td>
                    <td className="py-3 px-4 text-gray-300 text-[11px] truncate max-w-[160px]" title={entry.mntops}>
                      {entry.mntops}
                    </td>
                    <td className="py-3 px-4 text-gray-500 text-[10px]">
                      {entry.freq} {entry.passno}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => onRemountClick(entry)}
                          className="px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-[11px] font-sans transition-colors"
                          title="Remount volume"
                        >
                          Remount
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
