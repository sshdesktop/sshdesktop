import React, { useState } from 'react';
import { FileCode, Download, Copy, Check, Music, Video, FileText, X } from 'lucide-react';
import { RemoteFile } from '../types';

interface QuickLookModalProps {
  quickLookFile: RemoteFile | null;
  quickLookContent: string;
  mediaPreviewUrl: string | null;
  mediaType: 'image' | 'video' | 'audio' | 'pdf' | 'text' | null;
  onClose: () => void;
  onDownload: (file: RemoteFile) => void;
  onEdit: (fileName: string) => void;
  showToast: (msg: string) => void;
}

export const QuickLookModal: React.FC<QuickLookModalProps> = ({
  quickLookFile,
  quickLookContent,
  mediaPreviewUrl,
  mediaType,
  onClose,
  onDownload,
  onEdit,
  showToast,
}) => {
  const [quickLookCopied, setQuickLookCopied] = useState(false);

  if (!quickLookFile) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="bg-[#1e1e2e]/95 border border-white/20 rounded-3xl w-full max-w-3xl h-[560px] flex flex-col shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Quick Look Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#14141e]/90 border-b border-white/10 shrink-0">
          <div className="flex items-center space-x-2">
            <button 
              onClick={onClose}
              className="w-3 h-3 rounded-full bg-[#FF5F56] hover:brightness-110 flex items-center justify-center text-[8px] text-black font-bold"
              title="Close (Esc / Ctrl+Space)"
            >
              ✕
            </button>
            <div className="w-3 h-3 rounded-full bg-[#FFBD2E] opacity-75" />
            <div className="w-3 h-3 rounded-full bg-[#27C93F] opacity-75" />
            <span className="text-xs font-semibold text-white pl-3 truncate max-w-[260px]">{quickLookFile.name}</span>
            <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-blue-400 font-mono">
              {quickLookFile.name.split('.').pop()?.toUpperCase() || (quickLookFile.type === 'dir' ? 'FOLDER' : 'FILE')}
            </span>
            <span className="text-[11px] text-gray-400">
              ({quickLookFile.type === 'dir' && (quickLookFile.size === '—' || !quickLookFile.size) ? 'Folder' : quickLookFile.size})
            </span>
          </div>

          <div className="flex items-center space-x-2">
            {quickLookFile.type === 'file' && (
              <>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(quickLookContent);
                    setQuickLookCopied(true);
                    setTimeout(() => setQuickLookCopied(false), 2000);
                    showToast(`Copied content of ${quickLookFile.name}`);
                  }}
                  className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-gray-200 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition-colors"
                  title="Copy file content to clipboard"
                >
                  {quickLookCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{quickLookCopied ? 'Copied!' : 'Copy'}</span>
                </button>
                <button
                  onClick={() => onDownload(quickLookFile)}
                  className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 rounded-xl text-xs font-medium flex items-center space-x-1 transition-colors"
                  title="Download to computer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
                <button
                  onClick={() => {
                    onEdit(quickLookFile.name);
                    onClose();
                  }}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium shadow-md transition-colors flex items-center space-x-1"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Open in Editor</span>
                </button>
              </>
            )}
            <button 
              onClick={onClose}
              className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Media Preview Viewport */}
        <div className="flex-1 overflow-auto bg-[#0d0d15] relative">
          {mediaType === 'image' && mediaPreviewUrl ? (
            <div className="h-full flex flex-col items-center justify-center p-4 bg-[#08080e]/90 overflow-hidden">
              <img 
                src={mediaPreviewUrl} 
                alt={quickLookFile.name} 
                className="max-h-[440px] max-w-full object-contain rounded-xl shadow-2xl border border-white/10" 
              />
            </div>
          ) : mediaType === 'video' && mediaPreviewUrl ? (
            <div className="h-full flex flex-col items-center justify-center p-4 bg-black">
              <video src={mediaPreviewUrl} controls autoPlay className="max-h-[440px] max-w-full rounded-xl shadow-2xl" />
            </div>
          ) : mediaType === 'audio' && mediaPreviewUrl ? (
            <div className="h-full flex flex-col items-center justify-center p-8 space-y-4 bg-gradient-to-b from-[#181825] to-[#11111b]">
              <div className="w-24 h-24 rounded-3xl bg-pink-500/20 border border-pink-500/30 flex items-center justify-center shadow-2xl animate-pulse">
                <Music className="w-12 h-12 text-pink-400" />
              </div>
              <div className="text-center">
                <h4 className="font-semibold text-white text-sm">{quickLookFile.name}</h4>
                <p className="text-xs text-gray-400 font-sans mt-1">Audio • {quickLookFile.size}</p>
              </div>
              <audio src={mediaPreviewUrl} controls autoPlay className="w-full max-w-md" />
            </div>
          ) : mediaType === 'pdf' && mediaPreviewUrl ? (
            <div className="h-full w-full">
              <iframe 
                src={mediaPreviewUrl} 
                title={quickLookFile.name} 
                className="w-full h-full border-0" 
              />
            </div>
          ) : (
            <div className="p-4 font-mono text-xs text-gray-300 select-text leading-relaxed">
              <pre className="whitespace-pre-wrap font-mono">{quickLookContent || '(Empty file or binary format)'}</pre>
            </div>
          )}
        </div>

        {/* Quick Look Footer */}
        <div className="px-4 py-2 bg-[#14141e]/90 border-t border-white/10 flex items-center justify-between text-xs text-gray-400 shrink-0">
          <div className="flex items-center space-x-3 font-mono">
            <span>{mediaType === 'text' ? `${quickLookContent.split('\n').length} lines` : mediaType ? mediaType.toUpperCase() : 'Preview'}</span>
            <span>•</span>
            <span>{quickLookFile.permissions}</span>
            <span>•</span>
            <span>{quickLookFile.owner}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
