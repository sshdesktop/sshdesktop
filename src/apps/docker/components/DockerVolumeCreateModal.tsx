import React, { useState } from 'react';
import { HardDrive, X, Plus, Loader2 } from 'lucide-react';

interface DockerVolumeCreateModalProps {
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (name: string, driver: string, opts: string, labels: string) => Promise<void>;
}

export const DockerVolumeCreateModal: React.FC<DockerVolumeCreateModalProps> = ({
  isOpen,
  isSubmitting,
  onClose,
  onCreate,
}) => {
  const [volName, setVolName] = useState('');
  const [volDriver, setVolDriver] = useState('local');
  const [volOpts, setVolOpts] = useState('');
  const [volLabels, setVolLabels] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!volName.trim()) return;
    await onCreate(volName.trim(), volDriver.trim() || 'local', volOpts.trim(), volLabels.trim());
    setVolName('');
    setVolOpts('');
    setVolLabels('');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
              <HardDrive className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Create Docker Volume</h3>
              <p className="text-[11px] text-gray-400">Initialize a persistent storage volume</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Volume Name *</label>
            <input
              type="text"
              required
              value={volName}
              onChange={(e) => setVolName(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="e.g. pg_data_production"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Driver</label>
            <input
              type="text"
              value={volDriver}
              onChange={(e) => setVolDriver(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="local"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Driver Options (comma separated key=value)</label>
            <input
              type="text"
              value={volOpts}
              onChange={(e) => setVolOpts(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="type=tmpfs,device=tmpfs,o=size=100m"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Labels (comma separated key=value)</label>
            <input
              type="text"
              value={volLabels}
              onChange={(e) => setVolLabels(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              placeholder="env=prod,team=backend"
            />
          </div>

          <div className="pt-3 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5 cursor-pointer"
            >
              {isSubmitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{isSubmitting ? 'Creating...' : 'Create Volume'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
