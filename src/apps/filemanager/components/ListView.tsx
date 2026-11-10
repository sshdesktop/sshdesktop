import React from 'react';
import { CheckSquare, Square, ChevronUp, ChevronDown, RefreshCw } from 'lucide-react';
import { RemoteFile, MACOS_TAGS, getFileKind } from '../types';
import { FileIcon } from './FileIcon';

interface ListViewProps {
  files: RemoteFile[];
  selectedFiles: Set<string>;
  sortField: 'name' | 'modified' | 'size' | 'kind';
  sortOrder: 'asc' | 'desc';
  isLoading: boolean;
  openingFolder: string | null;
  dropTargetDir: string | null;
  draggedItem: string | null;
  draggedItems: string[];
  finderFileRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  handleSort: (field: 'name' | 'modified' | 'size' | 'kind') => void;
  setSelectedFiles: (val: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setDraggedItems: (items: string[]) => void;
  setDraggedItem: (item: string | null) => void;
  setDropTargetDir: (dir: string | null) => void;
  handleSelectFile: (file: RemoteFile, index: number, e: React.MouseEvent) => void;
  handleFileDoubleClick: (file: RemoteFile) => void;
  handleContextMenu: (e: React.MouseEvent, file?: RemoteFile) => void;
  handleMoveItems: (items: string[], targetDir: string) => void;
}

export const ListView: React.FC<ListViewProps> = ({
  files,
  selectedFiles,
  sortField,
  sortOrder,
  isLoading,
  openingFolder,
  dropTargetDir,
  draggedItem,
  draggedItems,
  finderFileRefs,
  handleSort,
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
    <div className={`h-full overflow-y-auto ${isLoading ? 'cursor-mac-wait is-loading-folder' : ''}`}>
      <table className="w-full text-left text-xs font-mono">
        <thead className="bg-[#11111a] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10">
          <tr>
            <th className="py-2.5 px-3 w-8">
              <button 
                onClick={() => {
                  if (selectedFiles.size === files.length) setSelectedFiles(new Set());
                  else setSelectedFiles(new Set(files.map(f => f.name)));
                }}
                className="text-gray-400 hover:text-white"
              >
                {selectedFiles.size > 0 && selectedFiles.size === files.length ? (
                  <CheckSquare className="w-3.5 h-3.5 text-blue-500" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
              </button>
            </th>
            <th 
              className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
              onClick={() => handleSort('name')}
            >
              <div className="flex items-center space-x-1">
                <span>Name</span>
                {sortField === 'name' && (
                  sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-400" /> : <ChevronDown className="w-3 h-3 text-blue-400" />
                )}
              </div>
            </th>
            <th 
              className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
              onClick={() => handleSort('modified')}
            >
              <div className="flex items-center space-x-1">
                <span>Date Modified</span>
                {sortField === 'modified' && (
                  sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-400" /> : <ChevronDown className="w-3 h-3 text-blue-400" />
                )}
              </div>
            </th>
            <th 
              className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
              onClick={() => handleSort('size')}
            >
              <div className="flex items-center space-x-1">
                <span>Size</span>
                {sortField === 'size' && (
                  sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-400" /> : <ChevronDown className="w-3 h-3 text-blue-400" />
                )}
              </div>
            </th>
            <th 
              className="py-2.5 px-3 cursor-pointer hover:text-white transition-colors"
              onClick={() => handleSort('kind')}
            >
              <div className="flex items-center space-x-1">
                <span>Kind</span>
                {sortField === 'kind' && (
                  sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-400" /> : <ChevronDown className="w-3 h-3 text-blue-400" />
                )}
              </div>
            </th>
            <th className="py-2.5 px-3">Permissions</th>
            <th className="py-2.5 px-3">Owner</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05]">
          {files.map((f, idx) => {
            const isSelected = selectedFiles.has(f.name);
            const isOpeningThis = openingFolder === f.name;
            const tagInfo = MACOS_TAGS.find(t => t.id === f.tag);

            return (
              <tr
                key={f.name}
                ref={(el) => {
                  if (el) finderFileRefs.current.set(f.name, el as any);
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
                className={`transition-colors select-none ${
                  isOpeningThis
                    ? 'animate-folder-open bg-blue-500/30 text-white font-bold ring-1 ring-blue-400 cursor-mac-wait'
                    : dropTargetDir === f.name
                    ? 'bg-blue-600/40 text-white font-bold ring-2 ring-blue-400'
                    : isSelected 
                    ? 'bg-blue-600/35 border-y border-blue-500/40 text-white font-medium shadow-sm' 
                    : 'hover:bg-white/[0.04] text-gray-300 cursor-pointer'
                }`}
              >
                <td className="py-2 px-3">
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleSelectFile(f, idx, e); }}
                    className="text-gray-500 hover:text-white"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-3.5 h-3.5 text-blue-500" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                  </button>
                </td>
                <td className="py-2 px-3 font-medium text-white flex items-center space-x-2">
                  <FileIcon file={f} className="w-4 h-4" />
                  <span className={isSelected ? 'text-white font-semibold' : 'text-gray-200'}>{f.name}</span>
                  {isOpeningThis && (
                    <RefreshCw className="w-3 h-3 text-blue-400 animate-spin ml-1" />
                  )}
                  {tagInfo && (
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagInfo.color }} />
                  )}
                </td>
                <td className="py-2 px-3 text-gray-400">{f.modified}</td>
                <td className="py-2 px-3 text-gray-300 font-mono">
                  {f.size === 'Calculating...' ? (
                    <span className="text-blue-400 flex items-center space-x-1 text-xs">
                      <RefreshCw className="w-3 h-3 animate-spin inline-block mr-1" />
                      <span>Calculating...</span>
                    </span>
                  ) : (
                    f.size
                  )}
                </td>
                <td className="py-2 px-3 text-gray-400 capitalize">{getFileKind(f)}</td>
                <td className="py-2 px-3 text-gray-500 font-mono">{f.permissions}</td>
                <td className="py-2 px-3 text-purple-400">{f.owner}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
