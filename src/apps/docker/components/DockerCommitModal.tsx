import React, { useState, useMemo } from 'react';
import { GitCommit, X, Loader2, Sparkles } from 'lucide-react';
import { ContainerItem } from '../types';
import { DockerCommandSnippet } from './DockerCodeViewer';

interface DockerCommitModalProps {
  container: ContainerItem | null;
  isCommitting: boolean;
  onClose: () => void;
  onCommit: (
    container: ContainerItem,
    repo: string,
    tag: string,
    message: string,
    author: string,
    pause: boolean
  ) => Promise<void>;
}

export const DockerCommitModal: React.FC<DockerCommitModalProps> = ({
  container,
  isCommitting,
  onClose,
  onCommit,
}) => {
  const [repo, setRepo] = useState('');
  const [tag, setTag] = useState('latest');
  const [message, setMessage] = useState('');
  const [author, setAuthor] = useState('');
  const [pause, setPause] = useState(true);

  if (!container) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo.trim()) return;
    await onCommit(container, repo.trim(), tag.trim() || 'latest', message.trim(), author.trim(), pause);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
              <GitCommit className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Commit Container to Image</h3>
              <p className="text-[11px] text-gray-400 font-mono truncate max-w-[260px]">
                Container: {container.name} ({container.id.substring(0, 12)})
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-3.5 max-h-[80vh] overflow-y-auto">
          <div className="p-3 rounded-2xl bg-black/30 border border-white/10 space-y-1">
            <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Source Container</div>
            <div className="text-xs font-mono text-indigo-300 font-medium">
              {container.name}
            </div>
            <div className="text-[10px] text-gray-500 font-mono">
              Base Image: {container.image} | Status: {container.status}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="block text-[11px] font-medium text-gray-400 mb-1">New Image Repository *</label>
              <input
                type="text"
                required
                value={repo}
                onChange={(e) => setRepo(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                placeholder="e.g. my-custom-image"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-gray-400 mb-1">Tag</label>
              <input
                type="text"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-center"
                placeholder="latest"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Commit Message</label>
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              placeholder="e.g. Installed dependencies and updated nginx config"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Author</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono"
              placeholder="e.g. John Doe <john@example.com>"
            />
          </div>

          <div className="flex items-center space-x-2 pt-1">
            <input
              type="checkbox"
              id="commitPauseCheck"
              checked={pause}
              onChange={(e) => setPause(e.target.checked)}
              className="rounded border-white/20 bg-white/10 text-indigo-500 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="commitPauseCheck" className="text-xs text-gray-300 cursor-pointer">
              Pause container during commit (recommended for data consistency)
            </label>
          </div>

          {/* Live CLI Snippet */}
          <div className="space-y-1 pt-1">
            <div className="flex items-center space-x-1.5 text-[11px] text-indigo-400 font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Equivalent Docker CLI Command:</span>
            </div>
            <DockerCommandSnippet 
              command={`docker commit ${message ? `-m "${message}" ` : ''}${author ? `-a "${author}" ` : ''}${pause ? '' : '--pause=false '}${container.id.substring(0, 12)} ${repo.trim() || 'my-image'}:${tag.trim() || 'latest'}`}
              label="Commit Command"
            />
          </div>

          <div className="pt-2 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isCommitting || !repo.trim()}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5 cursor-pointer"
            >
              {isCommitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCommit className="w-3.5 h-3.5" />}
              <span>{isCommitting ? 'Committing...' : 'Commit Container'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
