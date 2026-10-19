import React, { useState, useEffect, useRef } from 'react';
import { Folder, FileCode, Edit3, RefreshCw } from 'lucide-react';
import { DesktopItem } from './types';
import { useSettingsStore } from '../../lib/store';

export type DesktopActionType = 'folder' | 'file' | 'rename';

interface DesktopActionModalProps {
  isOpen: boolean;
  type: DesktopActionType | null;
  initialValue?: string;
  item?: DesktopItem | null;
  onClose: () => void;
  onConfirm: (value: string) => Promise<void> | void;
  isSubmitting?: boolean;
}

export default function DesktopActionModal({
  isOpen,
  type,
  initialValue = '',
  item,
  onClose,
  onConfirm,
  isSubmitting = false,
}: DesktopActionModalProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const theme = useSettingsStore(s => s.theme);
  const isLight = theme === 'light';

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue || (type === 'folder' ? 'New Folder' : type === 'file' ? 'notes.txt' : ''));
      setError(null);
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
    }
  }, [isOpen, initialValue, type]);

  if (!isOpen || !type) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError('Name cannot be empty');
      return;
    }
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    }
  };

  const getTitle = () => {
    if (type === 'folder') return 'New Folder on Desktop';
    if (type === 'file') return 'New File on Desktop';
    return `Rename "${item?.label || 'Item'}"`;
  };

  const getIcon = () => {
    if (type === 'folder') return <Folder className="w-5 h-5 text-amber-400" />;
    if (type === 'file') return <FileCode className="w-5 h-5 text-blue-400" />;
    return <Edit3 className="w-5 h-5 text-indigo-400" />;
  };

  const getButtonText = () => {
    if (type === 'folder') return 'Create Folder';
    if (type === 'file') return 'Create File';
    return 'Rename';
  };

  return (
    <div 
      className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <form 
        onSubmit={handleSubmit}
        className={`w-full max-w-sm rounded-2xl shadow-[0_25px_70px_rgba(0,0,0,0.85)] p-5 border flex flex-col space-y-4 ${
          isLight 
            ? 'bg-white border-black/15 text-slate-800' 
            : 'bg-[#1e1e2e]/98 border-white/20 text-gray-200'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
            isLight ? 'bg-slate-100 border-slate-200' : 'bg-white/5 border-white/10'
          }`}>
            {getIcon()}
          </div>
          <div>
            <h3 className={`font-semibold text-sm tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {getTitle()}
            </h3>
            <p className={`text-xs mt-0.5 ${isLight ? 'text-slate-500' : 'text-gray-400'}`}>
              Enter a name to save on the remote server
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-2.5 text-rose-400 text-xs">
            {error}
          </div>
        )}

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          disabled={isSubmitting}
          className={`w-full rounded-xl px-3.5 py-2 text-xs border focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${
            isLight 
              ? 'bg-slate-100 border-slate-300 text-slate-900 focus:bg-white' 
              : 'bg-black/40 border-white/15 text-white focus:border-blue-500'
          }`}
          placeholder="Name..."
        />

        <div className={`flex items-center justify-end space-x-2 pt-2 border-t ${
          isLight ? 'border-slate-200' : 'border-white/10'
        }`}>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className={`px-4 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
              isLight ? 'text-slate-600 hover:bg-slate-100' : 'text-gray-300 hover:bg-white/10'
            }`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
          >
            {isSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
            <span>{getButtonText()}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
