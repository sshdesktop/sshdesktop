import React from 'react';
import { Trash2, AlertTriangle } from 'lucide-react';
import { DesktopItem } from './types';

interface DesktopDeleteModalProps {
  item: DesktopItem | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting?: boolean;
}

export default function DesktopDeleteModal({
  item,
  isOpen,
  onClose,
  onConfirm,
  isDeleting = false,
}: DesktopDeleteModalProps) {
  if (!isOpen || !item) return null;

  return (
    <div 
      className="fixed inset-0 z-[99999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 select-none"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-md bg-[#1e1e2e]/98 dark:bg-[#181825]/98 light:bg-white border border-white/20 rounded-2xl shadow-[0_25px_70px_rgba(0,0,0,0.85)] p-5 text-gray-200 light:text-slate-800 flex flex-col space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start space-x-3.5">
          <div className="w-10 h-10 rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0 text-rose-400">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm text-white light:text-slate-900 tracking-tight">
              Delete "{item.label}" permanently?
            </h3>
            <p className="text-xs text-gray-400 light:text-slate-500 mt-1 leading-relaxed">
              Are you sure you want to permanently delete this {item.kind === 'folder' ? 'folder and all of its contents' : 'file'} from the server? This action cannot be undone.
            </p>
          </div>
        </div>

        {item.path && (
          <div className="bg-black/30 light:bg-slate-100 rounded-xl px-3 py-2 text-[11px] font-mono text-gray-300 light:text-slate-700 truncate border border-white/10 light:border-slate-300">
            {item.path}
          </div>
        )}

        <div className="flex items-center justify-end space-x-2.5 pt-2 border-t border-white/10 light:border-slate-200">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 light:text-slate-600 hover:bg-white/10 light:hover:bg-slate-200 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
          >
            {isDeleting ? (
              <span>Deleting...</span>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Permanently</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
