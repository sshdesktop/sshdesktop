import React, { useState } from 'react';
import { Key, Users, X, RefreshCw, AlertTriangle } from 'lucide-react';
import { RemoteFile } from '../types';
import { sftpChmod, sftpChown } from '../../../lib/tauri-bridge';

interface ChmodModalProps {
  isOpen: boolean;
  target: RemoteFile | null;
  currentPath: string;
  activeConnId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const ChmodModal: React.FC<ChmodModalProps> = ({
  isOpen,
  target,
  currentPath,
  activeConnId,
  onClose,
  onSuccess,
}) => {
  const [octalMode, setOctalMode] = useState('755');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !target) return null;

  const targetPath = currentPath === '/' ? `/${target.name}` : `${currentPath}/${target.name}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const modeNum = parseInt(octalMode, 8);
    if (isNaN(modeNum)) {
      setError('Invalid octal mode (e.g. 755, 644)');
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      await sftpChmod(activeConnId, targetPath, modeNum);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
      <form onSubmit={handleSubmit} className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
        <h3 className="font-bold text-base text-white flex items-center space-x-2">
          <Key className="w-5 h-5 text-amber-400" />
          <span>Modify Permissions (chmod)</span>
        </h3>
        <p className="text-xs text-gray-400 font-mono truncate">{target.name}</p>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-start space-x-2 text-rose-300 text-xs">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="bg-[#11111b] p-3 rounded-2xl border border-white/10 space-y-2">
          <label className="text-[11px] text-gray-400 block font-medium">Octal Mode (e.g. 755, 644, 777)</label>
          <input
            type="text"
            autoFocus
            required
            disabled={isSubmitting}
            maxLength={4}
            value={octalMode}
            onChange={e => setOctalMode(e.target.value)}
            className="w-full bg-[#1e1e2e] border border-white/20 rounded-xl px-3 py-1.5 text-base font-mono text-center text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
        </div>

        <div className="flex justify-end space-x-2 pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md flex items-center space-x-1.5 disabled:opacity-50"
          >
            {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>Apply chmod</span>
          </button>
        </div>
      </form>
    </div>
  );
};

interface ChownModalProps {
  isOpen: boolean;
  target: RemoteFile | null;
  selectedFiles: string[];
  currentPath: string;
  activeConnId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export const ChownModal: React.FC<ChownModalProps> = ({
  isOpen,
  target,
  selectedFiles,
  currentPath,
  activeConnId,
  onClose,
  onSuccess,
}) => {
  const [owner, setOwner] = useState('');
  const [group, setGroup] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const items = target ? [target.name] : selectedFiles;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (items.length === 0 || !owner.trim()) return;
    setIsSubmitting(true);
    setError(null);
    try {
      for (const name of items) {
        const targetPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        await sftpChown(activeConnId, targetPath, owner.trim(), group.trim());
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
      <form onSubmit={handleSubmit} className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
        <h3 className="font-bold text-base text-white flex items-center space-x-2">
          <Users className="w-5 h-5 text-purple-400" />
          <span>Change Ownership (chown)</span>
        </h3>
        <p className="text-xs text-gray-400">
          Modifying {items.length} item{items.length > 1 ? 's' : ''} in {currentPath}
        </p>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-start space-x-2 text-rose-300 text-xs">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-gray-400 block mb-1 font-medium">New Owner (User)</label>
            <input
              type="text"
              autoFocus
              required
              disabled={isSubmitting}
              placeholder="e.g. root, deploy, www-data"
              value={owner}
              onChange={e => setOwner(e.target.value)}
              className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50"
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 block mb-1 font-medium">New Group (Optional)</label>
            <input
              type="text"
              disabled={isSubmitting}
              placeholder="e.g. root, deploy, www-data, docker"
              value={group}
              onChange={e => setGroup(e.target.value)}
              className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50"
            />
          </div>
        </div>

        <div className="flex justify-end space-x-2 pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md flex items-center space-x-1.5 disabled:opacity-50"
          >
            {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>Apply chown</span>
          </button>
        </div>
      </form>
    </div>
  );
};
