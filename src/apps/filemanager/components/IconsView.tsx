import React from 'react';
import { 
  Folder, Image as ImageIcon, Video, Music, FileText, Terminal, 
  Archive, FileCode, Sliders, RefreshCw 
} from 'lucide-react';
import { RemoteFile, MACOS_TAGS } from '../types';

interface IconsViewProps {
  files: RemoteFile[];
  selectedFiles: Set<string>;
  iconSize: number;
  isLoading: boolean;
  openingFolder: string | null;
  currentPath: string;
  dropTargetDir: string | null;
  draggedItem: string | null;
  draggedItems: string[];
  isFinderSelecting: boolean;
  finderSelectionBox: { startX: number; startY: number; currentX: number; currentY: number } | null;
  finderContainerRef: React.RefObject<HTMLDivElement | null>;
  finderFileRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  handleFinderMouseDown: (e: React.MouseEvent) => void;
  handleFinderMouseMove: (e: React.MouseEvent) => void;
  handleFinderMouseUp: () => void;
  setIsFinderSelecting: (val: boolean) => void;
  setFinderSelectionBox: (box: any) => void;
  setSelectedFiles: (files: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setDraggedItems: (items: string[]) => void;
  setDraggedItem: (item: string | null) => void;
  setDropTargetDir: (dir: string | null) => void;
  handleSelectFile: (file: RemoteFile, index: number, e: React.MouseEvent) => void;
  handleFileDoubleClick: (file: RemoteFile) => void;
  handleContextMenu: (e: React.MouseEvent, file?: RemoteFile) => void;
  handleMoveItems: (items: string[], targetDir: string) => void;
}

export const IconsView: React.FC<IconsViewProps> = ({
  files,
  selectedFiles,
  iconSize,
  isLoading,
  openingFolder,
  currentPath,
  dropTargetDir,
  draggedItem,
  draggedItems,
  isFinderSelecting,
  finderSelectionBox,
  finderContainerRef,
  finderFileRefs,
  handleFinderMouseDown,
  handleFinderMouseMove,
  handleFinderMouseUp,
  setIsFinderSelecting,
  setFinderSelectionBox,
  setSelectedFiles,
  setDraggedItems,
  setDraggedItem,
  setDropTargetDir,
  handleSelectFile,
  handleFileDoubleClick,
  handleContextMenu,
  handleMoveItems,
}) => {
  return (
    <div 
      ref={finderContainerRef}
      onMouseDown={handleFinderMouseDown}
      onMouseMove={handleFinderMouseMove}
      onMouseUp={handleFinderMouseUp}
      onMouseLeave={() => {
        if (isFinderSelecting) {
          setIsFinderSelecting(false);
          setFinderSelectionBox(null);
        }
      }}
      className={`h-full overflow-y-auto p-4 relative select-none ${isLoading ? 'cursor-mac-wait is-loading-folder' : ''}`}
    >
      {/* Folder Opening Loading Shimmer / Translucent Backdrop */}
      {isLoading && files.length > 0 && (
        <div className="absolute inset-0 bg-[#181825]/45 backdrop-blur-[2px] z-20 flex flex-col items-center justify-center pointer-events-none transition-all duration-200">
          <div className="bg-[#1e1e2e]/95 border border-white/20 shadow-2xl px-5 py-3 rounded-2xl flex items-center space-x-3 text-xs text-white animate-in fade-in zoom-in-95 duration-150">
            <RefreshCw className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
            <div className="flex flex-col">
              <span className="font-semibold text-white tracking-wide">
                {openingFolder ? `Opening "${openingFolder}"...` : `Opening ${currentPath.split('/').filter(Boolean).pop() || 'Folder'}...`}
              </span>
              <span className="text-[10px] text-gray-400 font-mono truncate max-w-[220px]">
                {currentPath}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Rubber Band Selection Box */}
      {isFinderSelecting && finderSelectionBox && (
        <div
          className="absolute bg-blue-500/20 border border-blue-400/80 rounded z-30 pointer-events-none"
          style={{
            left: Math.min(finderSelectionBox.startX, finderSelectionBox.currentX),
            top: Math.min(finderSelectionBox.startY, finderSelectionBox.currentY),
            width: Math.abs(finderSelectionBox.currentX - finderSelectionBox.startX),
            height: Math.abs(finderSelectionBox.currentY - finderSelectionBox.startY),
          }}
        />
      )}

      <div 
        className="grid gap-4"
        style={{ 
          gridTemplateColumns: `repeat(auto-fill, minmax(${Math.max(76, iconSize + 36)}px, 1fr))` 
        }}
      >
        {files.map((f, idx) => {
          const isSelected = selectedFiles.has(f.name);
          const isArchive = ['tar', 'gz', 'tgz', 'zip', 'bz2', 'xz', '7z', 'rar'].includes(f.extension || '');
          const tagInfo = MACOS_TAGS.find(t => t.id === f.tag);
          const iconPx = Math.round(iconSize * 0.55);
          const isOpeningThis = openingFolder === f.name;
          const ext = f.extension?.toLowerCase() || '';

          return (
            <div
              key={f.name}
              ref={(el) => {
                if (el) finderFileRefs.current.set(f.name, el);
                else finderFileRefs.current.delete(f.name);
              }}
              draggable={true}
              onMouseDown={(e) => {
                e.stopPropagation();
                setIsFinderSelecting(false);
                setFinderSelectionBox(null);
              }}
              onDragStart={(e) => {
                e.stopPropagation();
                setIsFinderSelecting(false);
                setFinderSelectionBox(null);
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
                setIsFinderSelecting(false);
                setFinderSelectionBox(null);
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
              className={`file-card flex flex-col items-center p-2.5 rounded-2xl cursor-pointer select-none transition-all group relative ${
                isOpeningThis
                  ? 'animate-folder-open ring-2 ring-blue-400 bg-blue-500/25 cursor-mac-wait scale-105 shadow-xl'
                  : dropTargetDir === f.name
                  ? 'ring-2 ring-blue-400 bg-blue-500/30 scale-105 shadow-xl'
                  : isSelected
                  ? 'bg-blue-600/35 border-2 border-blue-400/80 shadow-lg ring-2 ring-blue-500/40'
                  : 'hover:bg-white/5 border border-transparent'
              }`}
            >
              <div 
                className="relative mb-2 pointer-events-none transition-all flex items-center justify-center"
                style={{ width: iconSize, height: iconSize }}
              >
                {f.type === 'dir' ? (
                  <div 
                    className="rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-md transition-all"
                    style={{ width: iconSize, height: iconSize }}
                  >
                    <Folder 
                      className="text-white fill-white/20" 
                      style={{ width: iconPx, height: iconPx }} 
                    />
                  </div>
                ) : ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext) ? (
                  <div 
                    className="rounded-2xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-md transition-all"
                    style={{ width: iconSize, height: iconSize }}
                  >
                    <ImageIcon 
                      className="text-white" 
                      style={{ width: iconPx, height: iconPx }} 
                    />
                  </div>
                ) : ['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(ext) ? (
                  <div 
                    className="rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md transition-all"
                    style={{ width: iconSize, height: iconSize }}
                  >
                    <Video 
                      className="text-white" 
                      style={{ width: iconPx, height: iconPx }} 
                    />
                  </div>
                ) : ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext) ? (
                  <div 
                    className="rounded-2xl bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shadow-md transition-all"
                    style={{ width: iconSize, height: iconSize }}
                  >
                    <Music 
                      className="text-white" 
                      style={{ width: iconPx, height: iconPx }} 
                    />
                  </div>
                ) : ext === 'pdf' ? (
                  <div 
                    className="rounded-2xl bg-gradient-to-br from-red-500 to-rose-700 flex items-center justify-center shadow-md transition-all"
                    style={{ width: iconSize, height: iconSize }}
                  >
                    <FileText 
                      className="text-white font-bold" 
                      style={{ width: iconPx, height: iconPx }} 
                    />
                  </div>
                ) : ['sh', 'bash', 'zsh', 'fish'].includes(ext) || f.permissions.includes('x') ? (
                  <div 
                    className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-md transition-all"
                    style={{ width: iconSize, height: iconSize }}
                  >
                    <Terminal 
                      className="text-white" 
                      style={{ width: iconPx, height: iconPx }} 
                    />
                  </div>
                ) : isArchive ? (
                  <div 
                    className="rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-md transition-all"
                    style={{ width: iconSize, height: iconSize }}
                  >
                    <Archive 
                      className="text-white" 
                      style={{ width: iconPx, height: iconPx }} 
                    />
                  </div>
                ) : ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'html', 'css', 'vue'].includes(ext) ? (
                  <div 
                    className="rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-md transition-all"
                    style={{ width: iconSize, height: iconSize }}
                  >
                    <FileCode 
                      className="text-white" 
                      style={{ width: iconPx, height: iconPx }} 
                    />
                  </div>
                ) : ['json', 'yaml', 'yml', 'toml', 'xml', 'env', 'ini', 'conf'].includes(ext) ? (
                  <div 
                    className="rounded-2xl bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center shadow-md transition-all"
                    style={{ width: iconSize, height: iconSize }}
                  >
                    <Sliders 
                      className="text-white" 
                      style={{ width: iconPx, height: iconPx }} 
                    />
                  </div>
                ) : (
                  <div 
                    className="rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 border border-white/10 flex items-center justify-center shadow-md transition-all"
                    style={{ width: iconSize, height: iconSize }}
                  >
                    <FileText 
                      className="text-gray-300" 
                      style={{ width: iconPx, height: iconPx }} 
                    />
                  </div>
                )}
                {tagInfo && (
                  <span 
                    className="absolute -top-1 -right-1 w-3 h-3 rounded-full border border-black shadow"
                    style={{ backgroundColor: tagInfo.color }}
                  />
                )}
                {isOpeningThis && (
                  <span 
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-blue-600 border border-white flex items-center justify-center shadow-md animate-pulse"
                    title="Opening..."
                  >
                    <RefreshCw className="w-2.5 h-2.5 text-white animate-spin" />
                  </span>
                )}
              </div>
              <span className="text-xs text-center text-gray-200 break-all line-clamp-2 max-w-full font-medium leading-tight drop-shadow-sm pointer-events-none">
                {f.name}
              </span>
              <span className="text-[10px] text-gray-500 mt-1 pointer-events-none flex items-center justify-center space-x-1">
                {f.size === 'Calculating...' ? (
                  <span className="text-blue-400 flex items-center space-x-1">
                    <RefreshCw className="w-2.5 h-2.5 animate-spin inline-block mr-1" />
                    <span>Calculating...</span>
                  </span>
                ) : (
                  f.size
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
