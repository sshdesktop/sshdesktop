import React, { useState, useEffect } from 'react';
import { Tag, X, Loader2 } from 'lucide-react';
import { ImageItem } from '../types';

interface DockerTagModalProps {
  image: ImageItem | null;
  isTagging: boolean;
  onClose: () => void;
  onTag: (image: ImageItem, newRepo: string, newTag: string) => Promise<void>;
}

export const DockerTagModal: React.FC<DockerTagModalProps> = ({
  image,
  isTagging,
  onClose,
  onTag,
}) => {
  const [newRepo, setNewRepo] = useState('');
  const [newTag, setNewTag] = useState('');

  useEffect(() => {
    if (image) {
      setNewRepo(image.repository === '<none>' ? '' : image.repository);
      setNewTag(image.tag === '<none>' ? 'latest' : image.tag);
    }
  }, [image]);

  if (!image) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRepo.trim()) return;
    await onTag(image, newRepo.trim(), newTag.trim() || 'latest');
  };

  const imageDisplayName = image.repository === '<none>' ? image.id : `${image.repository}:${image.tag}`;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
              <Tag className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Tag Docker Image</h3>
              <p className="text-[11px] text-gray-400 font-mono truncate max-w-[260px]">
                {imageDisplayName}
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3 rounded-2xl bg-black/30 border border-white/10 space-y-1">
            <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Source Image</div>
            <div className="text-xs font-mono text-cyan-300 font-medium truncate">
              {imageDisplayName}
            </div>
            <div className="text-[10px] text-gray-500 font-mono">ID: {image.id} | Size: {image.size}</div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Target Repository *</label>
            <input
              type="text"
              required
              value={newRepo}
              onChange={(e) => setNewRepo(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
              placeholder="e.g. myregistry.azurecr.io/myapp or username/repo"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-gray-400 mb-1">Target Tag</label>
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
              placeholder="latest or v1.0.0"
            />
          </div>

          <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-[11px] font-mono text-cyan-200">
            Command: docker tag {imageDisplayName} {newRepo || '<repo>'}:{newTag || 'latest'}
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
              disabled={isTagging || !newRepo.trim()}
              className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5 cursor-pointer"
            >
              {isTagging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Tag className="w-3.5 h-3.5" />}
              <span>{isTagging ? 'Tagging...' : 'Apply Tag'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
