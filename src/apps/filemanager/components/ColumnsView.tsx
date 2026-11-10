import React from 'react';
import { ChevronRight, Folder, FileText, RefreshCw, Music } from 'lucide-react';
import { RemoteFile, isMediaFile } from '../types';
import { FileIcon } from './FileIcon';

interface ColumnsViewProps {
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
  onCalculateFolderSize?: (folderName: string) => void;
}

export const ColumnsView: React.FC<ColumnsViewProps> = ({
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
  onCalculateFolderSize,
}) => {
  return (
    <div className={`h-full flex divide-x divide-white/[0.08] overflow-x-auto ${isLoading ? 'cursor-mac-wait is-loading-folder' : ''}`}>
      {/* Directory Items Column */}
      <div className="w-72 overflow-y-auto p-2 shrink-0 space-y-1">
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
              className={`flex items-center justify-between px-3 py-1.5 rounded-xl cursor-pointer text-xs transition-colors ${
                isOpeningThis
                  ? 'animate-folder-open bg-blue-500/30 text-white font-bold ring-1 ring-blue-400 cursor-mac-wait'
                  : dropTargetDir === f.name
                  ? 'bg-blue-600/40 text-white font-bold ring-2 ring-blue-400'
                  : isSelected 
                  ? 'bg-blue-600 text-white font-medium shadow-sm' 
                  : 'text-gray-300 hover:bg-white/5'
              }`}
            >
              <div className="flex items-center space-x-2 truncate">
                <FileIcon file={f} className="w-4 h-4 shrink-0" />
                <span className="truncate">{f.name}</span>
                {isOpeningThis && (
                  <RefreshCw className="w-3 h-3 text-blue-400 animate-spin ml-1 shrink-0" />
                )}
              </div>
              {f.type === 'dir' && <ChevronRight className="w-3.5 h-3.5 opacity-60" />}
            </div>
          );
        })}
      </div>

      {/* File Inspector Preview Column */}
      <div className="flex-1 p-6 overflow-y-auto flex flex-col items-center justify-center text-center space-y-4">
        {selectedFileObj ? (
          <div className="space-y-4 max-w-sm w-full">
            {inspectorPreview?.loading ? (
              <div className="w-48 h-40 mx-auto rounded-2xl bg-white/5 border border-white/10 flex flex-col items-center justify-center space-y-2 text-gray-400 shadow-xl">
                <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
                <span className="text-[11px]">Loading preview...</span>
              </div>
            ) : inspectorPreview?.type === 'image' && inspectorPreview.url ? (
              <div className="w-full max-h-52 flex items-center justify-center p-1 bg-black/40 rounded-2xl border border-white/10 overflow-hidden shadow-xl">
                <img src={inspectorPreview.url} alt={selectedFileObj.name} className="max-h-48 max-w-full object-contain rounded-xl" />
              </div>
            ) : inspectorPreview?.type === 'video' && inspectorPreview.url ? (
              <div className="w-full max-h-52 flex items-center justify-center p-1 bg-black/40 rounded-2xl border border-white/10 overflow-hidden shadow-xl">
                <video src={inspectorPreview.url} controls className="max-h-48 max-w-full rounded-xl" />
              </div>
            ) : inspectorPreview?.type === 'audio' && inspectorPreview.url ? (
              <div className="w-full p-4 bg-pink-500/10 rounded-2xl border border-pink-500/20 flex flex-col items-center space-y-3 shadow-xl">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-lg">
                  <Music className="w-7 h-7 text-white" />
                </div>
                <audio src={inspectorPreview.url} controls className="w-full h-8" />
              </div>
            ) : inspectorPreview?.type === 'pdf' && inspectorPreview.url ? (
              <div className="w-full h-52 bg-white rounded-2xl border border-white/10 overflow-hidden shadow-xl">
                <iframe src={inspectorPreview.url} title={selectedFileObj.name} className="w-full h-full border-none" />
              </div>
            ) : inspectorPreview?.type === 'text' && inspectorPreview.text ? (
              <div className="w-full max-h-48 bg-[#0c0c14] border border-white/10 rounded-2xl p-3 overflow-y-auto text-left font-mono text-[11px] text-gray-300 whitespace-pre-wrap select-text shadow-xl">
                {inspectorPreview.text}
              </div>
            ) : (
              <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-white/10 flex items-center justify-center shadow-xl">
                {selectedFileObj.type === 'dir' ? (
                  <Folder className="w-12 h-12 text-blue-400" />
                ) : (
                  <FileText className="w-12 h-12 text-gray-300" />
                )}
              </div>
            )}

            <div>
              <h4 className="font-bold text-base text-white break-words">{selectedFileObj.name}</h4>
              <p className="text-xs text-gray-400 capitalize">{selectedFileObj.type === 'dir' ? 'Folder' : `${selectedFileObj.extension || 'File'} Document`}</p>
            </div>

            <div className="bg-[#11111a] border border-white/10 rounded-2xl p-4 text-xs space-y-2 text-left font-mono">
              <div className="flex justify-between items-center">
                <span className="text-gray-500">Size:</span>
                <div className="flex items-center space-x-1.5">
                  <span className="text-gray-200">{selectedFileObj.size}</span>
                  {selectedFileObj.type === 'dir' && onCalculateFolderSize && selectedFileObj.size === '—' && (
                    <button
                      onClick={() => onCalculateFolderSize(selectedFileObj.name)}
                      className="text-[10px] text-blue-400 hover:text-blue-300 underline font-sans ml-1"
                      title="Calculate recursive folder size"
                    >
                      Calculate
                    </button>
                  )}
                </div>
              </div>
              <div className="flex justify-between"><span className="text-gray-500">Permissions:</span><span className="text-gray-200">{selectedFileObj.permissions}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Owner:</span><span className="text-purple-400">{selectedFileObj.owner}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Modified:</span><span className="text-gray-200">{selectedFileObj.modified}</span></div>
            </div>

            <div className="flex items-center justify-center space-x-2 pt-2">
              <button
                onClick={() => handleQuickLookToggle(selectedFileObj, true)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition-colors"
              >
                Quick Look
              </button>
              {selectedFileObj.type === 'file' && !isMediaFile(selectedFileObj) && (
                <button
                  onClick={() => openFileTarget(selectedFileObj.name)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg transition-colors"
                >
                  Open in Editor
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="text-gray-500 text-xs">Select an item to inspect details</div>
        )}
      </div>
    </div>
  );
};
