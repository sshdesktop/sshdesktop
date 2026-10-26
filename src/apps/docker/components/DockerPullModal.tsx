import React from 'react';
import { Download, X, RefreshCw, ArrowDownToLine, Sparkles } from 'lucide-react';
import { DockerCommandSnippet } from './DockerCodeViewer';

interface DockerPullModalProps {
  isOpen: boolean;
  pullImageInput: string;
  isPulling: boolean;
  pullLogs: string;
  popularImages: { name: string; desc: string }[];
  onInputChange: (val: string) => void;
  onPull: (imageName?: string) => void;
  onClose: () => void;
}

export const DockerPullModal: React.FC<DockerPullModalProps> = ({
  isOpen,
  pullImageInput,
  isPulling,
  pullLogs,
  popularImages,
  onInputChange,
  onPull,
  onClose,
}) => {
  if (!isOpen) return null;

  const pullCommand = `docker pull ${pullImageInput.trim() || 'nginx:latest'}`;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-purple-600/30 border border-purple-400/30 flex items-center justify-center">
              <Download className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Pull Docker Image</h3>
              <p className="text-[11px] text-gray-400">Download from Docker Hub or private container registries</p>
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
          <div className="flex space-x-2">
            <input
              type="text"
              placeholder="e.g. nginx:latest, redis:alpine, ubuntu:22.04"
              value={pullImageInput}
              onChange={e => onInputChange(e.target.value)}
              className="flex-1 bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
            />
            <button
              onClick={() => onPull()}
              disabled={isPulling || !pullImageInput.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
            >
              {isPulling && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{isPulling ? 'Pulling...' : 'Pull'}</span>
            </button>
          </div>

          {/* Live Colorful CLI Snippet */}
          <div className="space-y-1">
            <div className="flex items-center space-x-1.5 text-[11px] text-purple-400 font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Equivalent Docker CLI:</span>
            </div>
            <DockerCommandSnippet command={pullCommand} label="Pull Command" />
          </div>

          {/* Popular Curated Images */}
          <div>
            <span className="text-[11px] text-gray-400 block mb-2 font-medium">Popular Docker Images:</span>
            <div className="grid grid-cols-2 gap-2">
              {popularImages.map(item => (
                <button
                  key={item.name}
                  onClick={() => {
                    onInputChange(item.name);
                    onPull(item.name);
                  }}
                  disabled={isPulling}
                  className="p-2 bg-[#13131c] hover:bg-white/5 rounded-xl border border-white/5 text-left transition-all group flex flex-col justify-between cursor-pointer"
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="font-mono text-xs font-bold text-white group-hover:text-blue-400 transition-colors">
                      {item.name}
                    </span>
                    <ArrowDownToLine className="w-3.5 h-3.5 text-gray-500 group-hover:text-blue-400" />
                  </div>
                  <span className="text-[10px] text-gray-500 mt-1 line-clamp-1">{item.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Pull Logs Preview with Colorful Tokens */}
          {pullLogs && (
            <div className="bg-[#0c0d14] border border-white/10 rounded-2xl p-3.5 max-h-48 overflow-y-auto font-mono text-[11px] space-y-1 shadow-inner leading-relaxed">
              {pullLogs.split('\n').filter(Boolean).map((line, idx) => {
                let badge = null;
                let textColor = 'text-gray-300';

                if (line.includes('Pull complete') || line.includes('Already exists')) {
                  badge = <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[9px] font-bold mr-1.5">DONE</span>;
                  textColor = 'text-emerald-300';
                } else if (line.includes('Downloading') || line.includes('Extracting')) {
                  badge = <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-bold mr-1.5">PROGRESS</span>;
                  textColor = 'text-amber-200';
                } else if (line.includes('Pulling fs layer')) {
                  badge = <span className="px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[9px] font-bold mr-1.5">LAYER</span>;
                  textColor = 'text-sky-300';
                } else if (line.startsWith('Digest:')) {
                  badge = <span className="px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[9px] font-bold mr-1.5">SHA</span>;
                  textColor = 'text-purple-300';
                } else if (line.startsWith('Status:')) {
                  badge = <span className="px-1.5 py-0.2 rounded bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 text-[9px] font-bold mr-1.5">SUCCESS</span>;
                  textColor = 'text-emerald-300 font-bold';
                }

                return (
                  <div key={idx} className="flex items-start">
                    {badge}
                    <span className={`break-all ${textColor}`}>{line}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
