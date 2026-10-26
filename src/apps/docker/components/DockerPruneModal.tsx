import React from 'react';
import { Trash2, AlertCircle, RefreshCw, X } from 'lucide-react';
import { DockerCommandSnippet } from './DockerCodeViewer';

interface DockerPruneModalProps {
  isOpen: boolean;
  systemDfText: string;
  isPruning: boolean;
  onClose: () => void;
  onPrune: (type: 'all' | 'containers' | 'images' | 'volumes') => void;
}

export const DockerPruneModal: React.FC<DockerPruneModalProps> = ({
  isOpen,
  systemDfText,
  isPruning,
  onClose,
  onPrune,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-rose-600/30 border border-rose-400/30 flex items-center justify-center">
              <Trash2 className="w-4 h-4 text-rose-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Docker Prune Assistant</h3>
              <p className="text-[11px] text-gray-400">Reclaim wasted disk storage on your Linux host</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-1">
            <DockerCommandSnippet command="docker system df" label="Disk Usage CLI" />
          </div>

          <div className="bg-[#0c0d14] p-3.5 rounded-2xl border border-white/10 font-mono text-[11px] max-h-48 overflow-y-auto shadow-inner leading-relaxed select-text">
            {systemDfText ? (
              systemDfText.split('\n').map((line, idx) => {
                if (idx === 0) {
                  return <div key={idx} className="text-gray-500 font-bold uppercase tracking-wider pb-1">{line}</div>;
                }
                return (
                  <div key={idx} className="text-gray-200 hover:bg-white/[0.03] px-1 py-0.2 rounded flex items-center justify-between">
                    <span>{line}</span>
                  </div>
                );
              })
            ) : (
              <span className="text-gray-500 italic">Calculating disk usage...</span>
            )}
          </div>

          <div className="space-y-1">
            <DockerCommandSnippet command="docker system prune -f" label="Prune CLI" />
          </div>

          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-200 flex items-start space-x-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block mb-0.5">Warning</span>
              Pruning will permanently delete stopped containers, dangling images, and unreferenced build cache.
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end space-x-3">
            <button
              onClick={onClose}
              disabled={isPruning}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white bg-white/5 cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => onPrune('all')}
              disabled={isPruning}
              className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 active:scale-95 transition-all shadow-lg shadow-rose-600/30 flex items-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              {isPruning && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{isPruning ? 'Pruning...' : 'Prune All Unused'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
