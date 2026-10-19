import React from 'react';
import { Folder, FileText, RefreshCw, Music } from 'lucide-react';
import { RemoteFile, isMediaFile } from '../types';
import { FileIcon } from './FileIcon';

interface GalleryViewProps {
  files: RemoteFile[];
  selectedFiles: Set<string>;
  openingFolder: string | null;
  draggedItem: string | null;
  draggedItems: string[];
  dropTargetDir: string | null;
  isLoading: boolean;
  selectedFileObj: RemoteFile | null;
  inspectorPreview?: { type: string; url?: string; text?: string; loading?: boolean } | null;
  finderFileRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  setDraggedItems: (items: string[]) => void;
  setDraggedItem: (item: string | null) => void;
  setDropTargetDir: (dir: string | null) => void;
  setSelectedFiles: (files: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  handleSelectFile: (file: RemoteFile, index: number, e: React.MouseEvent) => void;
  handleFileDoubleClick: (file: RemoteFile) => void;
  handleContextMenu: (e: React.MouseEvent, file?: RemoteFile) => void;
  handleMoveItems: (items: string[], targetDir: string) => void;
  handleQuickLookToggle: (file: RemoteFile, open: boolean) => void;
  openFileTarget: (filename: string) => void;
}

export const GalleryView: React.FC<GalleryViewProps> = ({
  files,
  selectedFiles,
  openingFolder,
  draggedItem,
  draggedItems,
  dropTargetDir,
  isLoading,
  selectedFileObj,
  inspectorPreview,
  finderFileRefs,
  setDraggedItems,
  setDraggedItem,
  setDropTargetDir,
  setSelectedFiles,
  handleSelectFile,
  handleFileDoubleClick,
  handleContextMenu,
  handleMoveItems,
  handleQuickLookToggle,
  openFileTarget,
}) => {
  return (
    <div className={`h-full flex flex-col ${isLoading ? 'cursor-mac-wait is-loading-folder' : ''}`}>
      {/* Hero Preview Pane */}
      <div className="flex-1 p-6 flex flex-col items-center justify-center bg-[#11111a]/50 border-b border-white/[0.08] overflow-hidden">
        {selectedFileObj ? (
          <div className="text-center space-y-3 max-w-2xl w-full flex flex-col items-center">
            {inspectorPreview?.loading ? (
              <div className="h-48 w-full flex flex-col items-center justify-center space-y-2 text-gray-400">
                <RefreshCw className="w-8 h-8 animate-spin text-blue-400" />
                <span className="text-xs">Loading preview...</span>
              </div>
            ) : inspectorPreview?.type === 'image' && inspectorPreview.url ? (
              <div className="max-h-[300px] flex items-center justify-center p-2 bg-black/40 rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
                <img src={inspectorPreview.url} alt={selectedFileObj.name} className="max-h-[280px] max-w-full object-contain rounded-xl" />
              </div>
            ) : inspectorPreview?.type === 'video' && inspectorPreview.url ? (
              <div className="max-h-[300px] flex items-center justify-center p-2 bg-black/40 rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
                <video src={inspectorPreview.url} controls className="max-h-[280px] max-w-full rounded-xl" />
              </div>
            ) : inspectorPreview?.type === 'audio' && inspectorPreview.url ? (
              <div className="p-6 bg-pink-500/10 rounded-3xl border border-pink-500/20 flex flex-col items-center space-y-4 shadow-2xl">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-xl">
                  <Music className="w-10 h-10 text-white" />
                </div>
                <audio src={inspectorPreview.url} controls className="w-72 h-9" />
              </div>
            ) : inspectorPreview?.type === 'pdf' && inspectorPreview.url ? (
              <div className="w-full max-w-xl h-[300px] bg-white rounded-2xl border border-white/10 shadow-2xl overflow-hidden">
                <iframe src={inspectorPreview.url} title={selectedFileObj.name} className="w-full h-full border-none" />
              </div>
            ) : inspectorPreview?.type === 'text' && inspectorPreview.text ? (
              <div className="w-full max-w-xl max-h-[260px] bg-[#0c0c14] border border-white/10 rounded-2xl p-4 overflow-y-auto text-left font-mono text-xs text-gray-300 whitespace-pre-wrap select-text shadow-2xl">
                {inspectorPreview.text}
              </div>
            ) : (
              <div className="w-24 h-24 mx-auto rounded-3xl bg-blue-500/15 border border-white/10 flex items-center justify-center shadow-2xl">
                {selectedFileObj.type === 'dir' ? (
                  <Folder className="w-12 h-12 text-blue-400" />
                ) : (
                  <FileText className="w-12 h-12 text-gray-300" />
                )}
              </div>
            )}

            <h3 className="font-bold text-lg text-white break-words">{selectedFileObj.name}</h3>
            <div className="text-xs text-gray-400 font-mono">
              {selectedFileObj.type === 'dir' && selectedFileObj.size === '—' ? 'Folder' : selectedFileObj.size} · {selectedFileObj.permissions} · Modified {selectedFileObj.modified}
            </div>
            <div className="flex justify-center space-x-2 pt-2">
              <button
                onClick={() => handleQuickLookToggle(selectedFileObj, true)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow transition-colors"
              >
                Quick Look (Ctrl + Space)
              </button>
              {selectedFileObj.type === 'file' && !isMediaFile(selectedFileObj) && (
                <button
                  onClick={() => openFileTarget(selectedFileObj.name)}
                  className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition-colors"
                >
                  Open in Editor
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-gray-500 text-xs">No item selected</div>
        )}
      </div>

      {/* Horizontal Filmstrip Carousel */}
      <div className="h-28 bg-[#14141e] p-3 overflow-x-auto flex space-x-3 shrink-0 scrollbar-thin">
        {files.map((f, idx) => {
          const isSelected = selectedFiles.has(f.name);
          const isOpeningThis = openingFolder === f.name;
          return (
            <div
              key={f.name}
              ref={(el) => {
                if (el) finderFileRefs.current.set(f.name, el);
                else finderFileRefs.current.delete(f.name);
              }}
              draggable={true}
              onDragStart={(e) => {
                const items = selectedFiles.has(f.name) ? Array.from(selectedFiles) : [f.name];
                if (!selectedFiles.has(f.name)) {
                  setSelectedFiles(new Set([f.name]));
                }
                setDraggedItems(items);
                setDraggedItem(f.name);
                e.dataTransfer.setData('text/plain', f.name);
              }}
              onDragEnd={() => {
                setDraggedItem(null);
                setDraggedItems([]);
                setDropTargetDir(null);
              }}
              onDragOver={(e) => {
                if (f.type === 'dir' && draggedItem && !draggedItems.includes(f.name) && draggedItem !== f.name) {
                  e.preventDefault();
                  e.stopPropagation();
                  setDropTargetDir(f.name);
                }
              }}
              onDragLeave={() => {
                if (dropTargetDir === f.name) setDropTargetDir(null);
              }}
              onDrop={(e) => {
                if (f.type === 'dir') {
                  e.preventDefault();
                  e.stopPropagation();
                  const itemsToMove = draggedItems.length > 0 ? draggedItems : (draggedItem ? [draggedItem] : [e.dataTransfer.getData('text/plain')].filter(Boolean));
                  if (itemsToMove.length > 0) {
                    handleMoveItems(itemsToMove, f.name);
                  }
                  setDropTargetDir(null);
                }
              }}
              onClick={(e) => handleSelectFile(f, idx, e)}
              onDoubleClick={() => handleFileDoubleClick(f)}
              onContextMenu={(e) => handleContextMenu(e, f)}
              className={`flex flex-col items-center justify-center w-24 p-2 rounded-2xl cursor-pointer shrink-0 transition-all ${
                isOpeningThis
                  ? 'animate-folder-open bg-blue-500/30 border border-blue-400 ring-2 ring-blue-400 cursor-mac-wait'
                  : dropTargetDir === f.name
                  ? 'bg-blue-600/40 border border-blue-400 ring-2 ring-blue-400'
                  : isSelected 
                  ? 'bg-blue-600/30 border border-blue-500 ring-2 ring-blue-500/30 shadow-lg' 
                  : 'hover:bg-white/5 border border-transparent'
              }`}
            >
              <FileIcon file={f} className={`w-8 h-8 mb-1 ${isOpeningThis ? 'animate-bounce' : ''}`} />
              <span className="text-[11px] text-gray-200 truncate max-w-full font-medium">{f.name}</span>
              {isOpeningThis && (
                <RefreshCw className="w-3 h-3 text-blue-400 animate-spin mt-0.5" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
