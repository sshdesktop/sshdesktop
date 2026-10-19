import React from 'react';
import { Folder, HardDrive, Star, BookmarkPlus, X, Compass, Image as ImageIcon, FileText } from 'lucide-react';
interface FinderSidebarProps {
  sidebarWidth: number;
  currentPath: string;
  userHome: string;
  dropTargetDir: string | null;
  setDropTargetDir: (path: string | null) => void;
  draggedItem: string | null;
  draggedItems: string[];
  favorites: string[];
  addFavorite: (path: string) => void;
  removeFavorite: (path: string) => void;
  navigateTo: (path: string) => void;
  handleSpecialFolderNavigate: (path: string) => void;
  handleMoveToSidebarDir: (items: string[], targetDir: string) => void;
  setIsResizingSidebar: (resizing: boolean) => void;
}

export const FinderSidebar: React.FC<FinderSidebarProps> = ({
  sidebarWidth,
  currentPath,
  userHome,
  dropTargetDir,
  setDropTargetDir,
  draggedItem,
  draggedItems,
  favorites,
  addFavorite,
  removeFavorite,
  navigateTo,
  handleSpecialFolderNavigate,
  handleMoveToSidebarDir,
  setIsResizingSidebar,
}) => {
  const quickPlaces = [
    { label: 'Desktop', path: `${userHome}/Desktop`, icon: Compass },
    { label: 'Documents', path: `${userHome}/Documents`, icon: FileText },
    { label: 'Downloads', path: `${userHome}/Downloads`, icon: Folder },
    { label: 'Home', path: userHome, icon: Folder },
  ];

  return (
    <>
      <div 
        style={{ width: `${sidebarWidth}px` }} 
        className="bg-[#14141e]/90 backdrop-blur-2xl border-r border-white/[0.08] flex flex-col shrink-0 py-3 px-2 text-xs select-none overflow-hidden"
      >
        {/* Favorites Section */}
        <div className="text-[10px] font-bold text-gray-500 uppercase px-3 mb-1.5 tracking-wider">
          Favorites
        </div>
        <div className="space-y-0.5 mb-3">
          {quickPlaces.map(p => {
            const Icon = p.icon;
            const isCurrent = currentPath === p.path;
            const isDropTarget = dropTargetDir === p.path;
            return (
              <button
                key={p.path}
                onClick={() => handleSpecialFolderNavigate(p.path)}
                onDragOver={(e) => {
                  if (draggedItem && currentPath !== p.path) {
                    e.preventDefault();
                    e.stopPropagation();
                    setDropTargetDir(p.path);
                  }
                }}
                onDragLeave={() => {
                  if (dropTargetDir === p.path) setDropTargetDir(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const source = draggedItem || e.dataTransfer.getData('text/plain');
                  if (source) {
                    const items = draggedItems.length > 0 && draggedItems.includes(source) ? draggedItems : [source];
                    handleMoveToSidebarDir(items, p.path);
                  }
                }}
                className={`w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-left transition-all ${
                  isDropTarget 
                    ? 'ring-2 ring-blue-400 bg-blue-500/30 text-white font-bold' 
                    : isCurrent 
                    ? 'bg-blue-600/35 text-white font-semibold shadow-md border-l-2 border-blue-400' 
                    : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isCurrent || isDropTarget ? 'text-white' : 'text-blue-400'}`} />
                <span className="truncate flex-1">{p.label}</span>
                {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />}
              </button>
            );
          })}
        </div>

        {/* Locations Section */}
        <div className="text-[10px] font-bold text-gray-500 uppercase px-3 mb-1.5 tracking-wider">
          Locations
        </div>
        <div className="space-y-0.5 mb-3">
          <button
            onClick={() => navigateTo('/')}
            onDragOver={(e) => {
              if (draggedItem && currentPath !== '/') {
                e.preventDefault();
                e.stopPropagation();
                setDropTargetDir('/');
              }
            }}
            onDragLeave={() => {
              if (dropTargetDir === '/') setDropTargetDir(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const source = draggedItem || e.dataTransfer.getData('text/plain');
              if (source) {
                const items = draggedItems.length > 0 && draggedItems.includes(source) ? draggedItems : [source];
                handleMoveToSidebarDir(items, '/');
              }
            }}
            className={`w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-left transition-all ${
              dropTargetDir === '/'
                ? 'ring-2 ring-blue-400 bg-blue-500/30 text-white font-bold'
                : currentPath === '/' ? 'bg-blue-600/35 text-white font-semibold shadow-md border-l-2 border-blue-400' : 'text-gray-300 hover:text-white hover:bg-white/5'
            }`}
          >
            <HardDrive className={`w-3.5 h-3.5 ${currentPath === '/' || dropTargetDir === '/' ? 'text-white' : 'text-blue-400'}`} />
            <span className="truncate flex-1">File System</span>
            {currentPath === '/' && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />}
          </button>
        </div>


        {/* Custom User Favorites */}
        <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase px-3 mb-1.5 tracking-wider">
          <span>Bookmarks</span>
          <button 
            onClick={() => addFavorite(currentPath)} 
            className="hover:text-white"
            title="Bookmark Current Location"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-0.5 flex-1 overflow-y-auto pr-1">
          {favorites.map(fav => (
            <div
              key={fav}
              className={`group flex items-center justify-between px-3 py-1.5 rounded-xl text-left transition-colors cursor-pointer ${
                currentPath === fav ? 'bg-blue-600/30 text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
              onClick={() => navigateTo(fav)}
            >
              <div className="flex items-center space-x-2 truncate">
                <Star className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="truncate">{fav}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeFavorite(fav); }}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-400 p-0.5"
                title="Remove Bookmark"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Draggable Sidebar Divider */}
      <div 
        onMouseDown={(e) => {
          e.preventDefault();
          setIsResizingSidebar(true);
        }}
        className="w-1 cursor-col-resize hover:bg-blue-500/60 active:bg-blue-500 transition-colors z-20 shrink-0 bg-white/[0.05] relative group"
        title="Drag to resize sidebar"
      >
        <div className="absolute inset-y-0 -left-1 -right-1" />
      </div>
    </>
  );
};
