import React from 'react';
import { Play, X, AlertCircle, RefreshCw } from 'lucide-react';

interface DockerRunModalProps {
  isOpen: boolean;
  image: string;
  name: string;
  ports: string;
  restart: string;
  volumes: string;
  env: string;
  error: string | null;
  isSubmitting: boolean;
  onImageChange: (val: string) => void;
  onNameChange: (val: string) => void;
  onPortsChange: (val: string) => void;
  onRestartChange: (val: string) => void;
  onVolumesChange: (val: string) => void;
  onEnvChange: (val: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const DockerRunModal: React.FC<DockerRunModalProps> = ({
  isOpen,
  image,
  name,
  ports,
  restart,
  volumes,
  env,
  error,
  isSubmitting,
  onImageChange,
  onNameChange,
  onPortsChange,
  onRestartChange,
  onVolumesChange,
  onEnvChange,
  onClose,
  onSubmit,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center">
              <Play className="w-4 h-4 text-blue-400 fill-current" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Launch New Container</h3>
              <p className="text-[11px] text-gray-400">Configure ports, environment variables, and volumes</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={onSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              Docker Image <span className="text-rose-400">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. nginx:alpine, redis:latest, postgres:16"
              value={image}
              onChange={e => onImageChange(e.target.value)}
              required
              className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">Container Name (Optional)</label>
            <input
              type="text"
              placeholder="e.g. web-server-1"
              value={name}
              onChange={e => onNameChange(e.target.value)}
              className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Port Bindings (-p)</label>
              <input
                type="text"
                placeholder="8080:80, 443:443"
                value={ports}
                onChange={e => onPortsChange(e.target.value)}
                className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
              />
              <span className="text-[10px] text-gray-500 mt-1 block">Format: hostPort:containerPort</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Restart Policy</label>
              <select
                value={restart}
                onChange={e => onRestartChange(e.target.value)}
                className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
              >
                <option value="unless-stopped">Unless Stopped</option>
                <option value="always">Always</option>
                <option value="on-failure">On Failure</option>
                <option value="no">Never (no)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">Volumes / Mounts (-v)</label>
            <input
              type="text"
              placeholder="/var/www/html:/usr/share/nginx/html, /host/data:/data"
              value={volumes}
              onChange={e => onVolumesChange(e.target.value)}
              className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
            />
            <span className="text-[10px] text-gray-500 mt-1 block">Comma separated list of hostPath:containerPath</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">Environment Variables (-e)</label>
            <input
              type="text"
              placeholder="NODE_ENV=production, PORT=3000, DB_HOST=localhost"
              value={env}
              onChange={e => onEnvChange(e.target.value)}
              className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
            />
          </div>

          {error && (
            <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 font-mono text-[11px] leading-relaxed break-words">{error}</div>
            </div>
          )}

          {/* Submit Buttons */}
          <div className="pt-3 border-t border-white/10 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all shadow-lg shadow-blue-600/30 flex items-center space-x-2 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
              <span>{isSubmitting ? 'Launching...' : 'Run Container'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
