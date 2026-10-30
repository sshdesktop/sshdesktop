import React from 'react';
import { 
  ArrowLeft, ArrowRight, ArrowUp, Grid, List, Columns, Image as ImageIcon, 
  Search, RefreshCw, MoreHorizontal, Eye, EyeOff, Sliders, Info, Copy, 
  Scissors, ClipboardPaste, Plus, FileText, Folder, PackageOpen, Archive, Trash2, Terminal,
  PanelLeft, HardDrive
} from 'lucide-react';
import { RemoteFile, FinderTab } from '../types';

interface FinderToolbarProps {
  currentPath: string;
  isEditingPath: boolean;
  setIsEditingPath: (val: boolean) => void;
  pathInput: string;
  setPathInput: (val: string) => void;
  handlePathSubmit: (e: React.FormEvent) => void;
  goBack: () => void;
  goForward: () => void;
  goUp: () => void;
  historyIndex: number;
  historyLength: number;
  view: 'icons' | 'list' | 'columns' | 'gallery';
  setView: (v: 'icons' | 'list' | 'columns' | 'gallery') => void;
  iconSize: number;
  setIconSize: (size: number) => void;
  showIconSizeSlider: boolean;
  setShowIconSizeSlider: (val: boolean | ((prev: boolean) => boolean)) => void;
  showHiddenFiles: boolean;
  onToggleHiddenFiles: () => void;
  isLoading: boolean;
  onReload: () => void;
  showActionMenu: boolean;
  setShowActionMenu: (val: boolean | ((prev: boolean) => boolean)) => void;
  search: string;
  setSearch: (val: string) => void;
  isSearchingGlobal: boolean;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  selectedFiles: Set<string>;
  selectedFileObj?: RemoteFile;
  clipboard: any;
  onNewFolder: () => void;
  onNewFile: () => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onRename: () => void;
  onGetInfo: () => void;
  onCompress: (type: 'zip' | 'tar.gz') => void;
  onExtract: (file: RemoteFile) => void;
  onInstallPackage: (file: RemoteFile) => void;
  onDelete: () => void;
  onOpenTerminalHere: () => void;
  onDownloadFile: (file?: RemoteFile) => void;
  navigateTo: (path: string) => void;
  containerWidth?: number;
  isSidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export const FinderToolbar: React.FC<FinderToolbarProps> = ({
  currentPath,
  isEditingPath,
  setIsEditingPath,
  pathInput,
  setPathInput,
  handlePathSubmit,
  goBack,
  goForward,
  goUp,
  historyIndex,
  historyLength,
  view,
  setView,
  iconSize,
  setIconSize,
  showIconSizeSlider,
  setShowIconSizeSlider,
  showHiddenFiles,
  onToggleHiddenFiles,
  isLoading,
  onReload,
  showActionMenu,
  setShowActionMenu,
  search,
  setSearch,
  isSearchingGlobal,
  searchInputRef,
  selectedFiles,
  selectedFileObj,
  clipboard,
  onNewFolder,
  onNewFile,
  onDuplicate,
  onCopy,
  onCut,
  onPaste,
  onRename,
  onGetInfo,
  onCompress,
  onExtract,
  onInstallPackage,
  onDelete,
  onOpenTerminalHere,
  onDownloadFile,
  navigateTo,
  containerWidth = 800,
  isSidebarOpen = true,
  onToggleSidebar,
}) => {
  const isCompact = containerWidth < 720;
  const isVeryCompact = containerWidth < 520;

  const breadcrumbsRef = React.useRef<HTMLDivElement | null>(null);

  // Auto-scroll breadcrumbs container to the right whenever path changes so current folder is always in view
  React.useEffect(() => {
    if (breadcrumbsRef.current) {
      breadcrumbsRef.current.scrollLeft = breadcrumbsRef.current.scrollWidth;
    }
  }, [currentPath]);

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <div className="h-12 border-b border-white/[0.08] flex items-center justify-between px-2.5 sm:px-3 bg-[#14141e]/90 backdrop-blur-md select-none shrink-0 relative z-30 gap-1.5 sm:gap-2">
      {/* Left: Sidebar Toggle, Navigation Buttons & Path Bar */}
      <div className="flex items-center space-x-1.5 min-w-0 flex-1 mr-1">
        {/* Sidebar Toggle Button */}
        {onToggleSidebar && (
          <button
            onClick={onToggleSidebar}
            className={`p-1.5 rounded-xl border transition-colors shrink-0 ${
              isSidebarOpen 
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-400 hover:bg-blue-600/30' 
                : 'bg-white/[0.03] border-white/5 text-gray-400 hover:text-white hover:bg-white/[0.08]'
            }`}
            title={isSidebarOpen ? "Hide Sidebar (Ctrl+B / ⌘B)" : "Show Sidebar (Ctrl+B / ⌘B)"}
          >
            <PanelLeft className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Nav Arrows */}
        <div className="flex items-center space-x-0.5 shrink-0 bg-white/[0.03] p-0.5 rounded-xl border border-white/5">
          <button
            onClick={goBack}
            disabled={historyIndex <= 0}
            className="p-1 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
            title="Back (Backspace / ⌘[)"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex >= historyLength - 1}
            className="p-1 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
            title="Forward (⌘])"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={goUp}
            disabled={currentPath === '/'}
            className="p-1 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
            title="Enclosing Folder (⌘↑)"
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Path Breadcrumbs / Input - Guaranteed visibility in small windows */}
        <div className="flex-1 min-w-[110px] max-w-xl">
          {isEditingPath ? (
            <form onSubmit={handlePathSubmit} className="w-full">
              <input
                type="text"
                autoFocus
                value={pathInput}
                onChange={e => setPathInput(e.target.value)}
                onBlur={() => {
                  setIsEditingPath(false);
                  setPathInput(currentPath);
                }}
                onFocus={e => e.target.select()}
                placeholder="/path/to/folder"
                className="w-full bg-[#0f0f18] border border-blue-500 rounded-xl px-2.5 py-1 text-xs font-mono text-white focus:outline-none shadow-inner"
              />
            </form>
          ) : (
            <div
              ref={breadcrumbsRef}
              onClick={() => setIsEditingPath(true)}
              className="flex items-center space-x-1 px-2 py-1 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] transition-colors cursor-text text-xs text-gray-300 overflow-x-auto scrollbar-none border border-white/5"
              title="Click to edit path directly"
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigateTo('/'); }}
                className="hover:text-white font-medium text-blue-400 shrink-0 flex items-center space-x-1"
                title="Root directory (/)"
              >
                <HardDrive className="w-3 h-3 text-blue-400 shrink-0" />
                {(!isVeryCompact || pathParts.length === 0) && <span>/</span>}
              </button>

              {isVeryCompact && pathParts.length > 2 && (
                <>
                  <span className="text-gray-500 shrink-0 text-[10px]">›</span>
                  <span className="text-gray-500 shrink-0 text-[11px] px-0.5 font-mono">…</span>
                </>
              )}

              {(isVeryCompact && pathParts.length > 2
                ? pathParts.slice(-2)
                : pathParts
              ).map((part, idx) => {
                const actualIndex = isVeryCompact && pathParts.length > 2 
                  ? pathParts.length - 2 + idx 
                  : idx;
                const stepPath = '/' + pathParts.slice(0, actualIndex + 1).join('/');
                const isLast = actualIndex === pathParts.length - 1;

                return (
                  <React.Fragment key={stepPath}>
                    <span className="text-gray-500 shrink-0 text-[10px]">›</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigateTo(stepPath); }}
                      className={`font-sans hover:text-white flex items-center space-x-1 transition-colors ${
                        isLast 
                          ? 'text-white font-semibold shrink-0 max-w-[150px] truncate bg-white/[0.06] px-1.5 py-0.5 rounded' 
                          : 'text-gray-400 hover:bg-white/[0.04] px-1 py-0.5 rounded max-w-[90px] truncate shrink'
                      }`}
                      title={stepPath}
                    >
                      {isLast && <Folder className="w-2.5 h-2.5 text-blue-400 shrink-0 inline-block mr-0.5" />}
                      <span className="truncate">{part}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Controls: View Toggle, Reload, Actions, Search */}
      <div className="flex items-center space-x-1 shrink-0">
        {/* View Mode Switcher */}
        <div className="flex items-center bg-white/[0.04] p-0.5 rounded-xl border border-white/10 shadow-inner shrink-0">
          <button
            onClick={() => setView('icons')}
            className={`p-1.5 rounded-lg transition-all ${view === 'icons' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
            title="Icons View (⌘1)"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-1.5 rounded-lg transition-all ${view === 'list' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
            title="List View (⌘2)"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          {!isVeryCompact && (
            <>
              <button
                onClick={() => setView('columns')}
                className={`p-1.5 rounded-lg transition-all ${view === 'columns' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
                title="Columns View (⌘3)"
              >
                <Columns className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setView('gallery')}
                className={`p-1.5 rounded-lg transition-all ${view === 'gallery' ? 'bg-blue-600 text-white shadow-md' : 'text-gray-400 hover:text-white'}`}
                title="Gallery View (⌘4)"
              >
                <ImageIcon className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Icon Size Slider Toggle for Icons View (Hidden in compact mode to preserve space) */}
        {!isCompact && view === 'icons' && (
          <div className="relative shrink-0">
            <button
              onClick={() => setShowIconSizeSlider(prev => !prev)}
              className={`mac-btn-icon ${showIconSizeSlider ? 'bg-white/15 text-white' : 'text-gray-400'}`}
              title="Adjust Icon Size"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
            {showIconSizeSlider && (
              <div 
                className="absolute top-10 right-0 bg-[#1e1e2e]/98 backdrop-blur-2xl border border-white/20 p-3 rounded-2xl shadow-2xl z-50 flex items-center space-x-3 w-48 animate-in fade-in zoom-in-95 duration-100"
                onClick={e => e.stopPropagation()}
              >
                <span className="text-[10px] text-gray-400">Small</span>
                <input
                  type="range"
                  min="40"
                  max="120"
                  value={iconSize}
                  onChange={e => setIconSize(Number(e.target.value))}
                  className="w-full accent-blue-500 cursor-pointer h-1.5 bg-white/10 rounded-lg"
                />
                <span className="text-[10px] text-gray-400">Large</span>
              </div>
            )}
          </div>
        )}

        {/* Reload Directory Button */}
        <button
          onClick={onReload}
          className={`mac-btn-icon shrink-0 ${isLoading ? 'animate-spin text-blue-400' : 'text-gray-400'}`}
          title="Reload Directory (⌘R)"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        {/* Toggle Hidden Items Button (Hidden in compact mode, accessible via Action Menu or ⌘.) */}
        {!isCompact && (
          <button
            onClick={onToggleHiddenFiles}
            className={`mac-btn-icon shrink-0 ${showHiddenFiles ? 'text-blue-400 bg-white/10' : 'text-gray-400'}`}
            title={showHiddenFiles ? "Hide Hidden Items (⌘.)" : "Show Hidden Items (⌘.)"}
          >
            {showHiddenFiles ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        )}

        {/* Action Menu (⋯) */}
        <div className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowActionMenu(prev => !prev);
            }}
            className={`mac-btn-icon ${showActionMenu ? 'bg-white/15 text-white' : 'text-gray-400'}`}
            title="Action Options"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>

          {showActionMenu && (
            <div 
              className="absolute right-0 top-10 bg-[#1e1e2e]/98 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl py-1.5 min-w-[210px] z-50 text-xs font-sans animate-in fade-in zoom-in-95 duration-100"
              onClick={e => e.stopPropagation()}
            >
              {/* Also offer Toggle Hidden Items in Action menu for compact mode */}
              {isCompact && (
                <>
                  <div 
                    onClick={() => { onToggleHiddenFiles(); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between text-gray-300"
                  >
                    <div className="flex items-center space-x-2">
                      {showHiddenFiles ? <EyeOff className="w-3.5 h-3.5 text-blue-400" /> : <Eye className="w-3.5 h-3.5 text-gray-400" />}
                      <span>{showHiddenFiles ? 'Hide Hidden Items' : 'Show Hidden Items'}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono">⌘.</span>
                  </div>
                  <div className="my-1 border-t border-white/10" />
                </>
              )}

              {selectedFiles.size > 0 ? (
                <>
                  <div className="px-3.5 py-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    Selected ({selectedFiles.size})
                  </div>
                  {selectedFiles.size === 1 && selectedFileObj && (
                    <div 
                      onClick={() => { onGetInfo(); setShowActionMenu(false); }}
                      className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-2">
                        <Info className="w-3.5 h-3.5 text-blue-400" />
                        <span>Get Info</span>
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono">⌘I</span>
                    </div>
                  )}
                  {selectedFileObj && selectedFileObj.type === 'file' && (
                    <div 
                      onClick={() => { onDownloadFile(selectedFileObj); setShowActionMenu(false); }}
                      className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white cursor-pointer flex items-center space-x-2 text-emerald-400 font-medium"
                    >
                      <Folder className="w-3.5 h-3.5" />
                      <span>Download to Computer</span>
                    </div>
                  )}
                  {selectedFileObj && (selectedFileObj.name.endsWith('.deb') || selectedFileObj.name.endsWith('.rpm') || selectedFileObj.name.endsWith('.sh') || selectedFileObj.name.endsWith('.bash')) && (
                    <div 
                      onClick={() => { onInstallPackage(selectedFileObj); setShowActionMenu(false); }}
                      className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white cursor-pointer flex items-center space-x-2 text-emerald-300 font-medium"
                    >
                      <PackageOpen className="w-3.5 h-3.5" />
                      <span>Install / Run Package</span>
                    </div>
                  )}
                  {selectedFileObj && (selectedFileObj.name.endsWith('.tar.gz') || selectedFileObj.name.endsWith('.zip') || selectedFileObj.name.endsWith('.tgz')) && (
                    <div 
                      onClick={() => { onExtract(selectedFileObj); setShowActionMenu(false); }}
                      className="px-3.5 py-1.5 hover:bg-amber-600 hover:text-white cursor-pointer flex items-center space-x-2 text-amber-300 font-medium"
                    >
                      <Archive className="w-3.5 h-3.5" />
                      <span>Extract Archive Here</span>
                    </div>
                  )}
                  <div className="my-1 border-t border-white/10" />
                  <div 
                    onClick={() => { onDuplicate(); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-2">
                      <Copy className="w-3.5 h-3.5 text-blue-400" />
                      <span>Duplicate</span>
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono">⌘D</span>
                  </div>
                  <div 
                    onClick={() => { onCopy(); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-2">
                      <Copy className="w-3.5 h-3.5 text-blue-400" />
                      <span>Copy</span>
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono">⌘C</span>
                  </div>
                  <div 
                    onClick={() => { onCut(); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between"
                  >
                    <div className="flex items-center space-x-2">
                      <Scissors className="w-3.5 h-3.5 text-purple-400" />
                      <span>Cut</span>
                    </div>
                    <span className="text-[10px] text-gray-400 font-mono">⌘X</span>
                  </div>
                  {selectedFiles.size === 1 && (
                    <div 
                      onClick={() => { onRename(); setShowActionMenu(false); }}
                      className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-2">
                        <FileText className="w-3.5 h-3.5 text-blue-400" />
                        <span>Rename...</span>
                      </div>
                      <span className="text-[10px] text-gray-400 font-mono">F2</span>
                    </div>
                  )}
                  <div 
                    onClick={() => { onCompress('tar.gz'); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <Archive className="w-3.5 h-3.5 text-amber-400" />
                    <span>Compress to .tar.gz</span>
                  </div>
                  <div 
                    onClick={() => { onCompress('zip'); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <Archive className="w-3.5 h-3.5 text-yellow-400" />
                    <span>Compress to .zip</span>
                  </div>
                  <div className="my-1 border-t border-white/10" />
                  <div 
                    onClick={() => { onDelete(); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-red-600 hover:text-white cursor-pointer flex items-center space-x-2 text-red-400 font-medium"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Permanently</span>
                  </div>
                </>
              ) : (
                <>
                  <div 
                    onClick={() => { onNewFolder(); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <Folder className="w-3.5 h-3.5 text-blue-400" />
                    <span>New Folder</span>
                  </div>
                  <div 
                    onClick={() => { onNewFile(); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-400" />
                    <span>New File</span>
                  </div>
                  {clipboard && (
                    <div 
                      onClick={() => { onPaste(); setShowActionMenu(false); }}
                      className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5 text-purple-400" />
                      <span>Paste</span>
                    </div>
                  )}
                  <div className="my-1 border-t border-white/10" />
                  <div 
                    onClick={() => { onOpenTerminalHere(); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Open Terminal Here</span>
                  </div>
                  <div 
                    onClick={() => { onGetInfo(); setShowActionMenu(false); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between text-gray-300"
                  >
                    <div className="flex items-center space-x-2">
                      <Info className="w-3.5 h-3.5 text-blue-400" />
                      <span>Get Folder Info</span>
                    </div>
                    <span className="text-[10px] text-gray-400">⌘I</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Global Search Pill - Sleek & Expandable in compact mode */}
        <div className={`flex items-center bg-[#0f0f18] border border-white/10 rounded-xl overflow-hidden shadow-inner relative shrink-0 transition-all ${
          isVeryCompact 
            ? search ? 'w-24 ring-1 ring-blue-500/50' : 'w-7 focus-within:w-28 focus-within:ring-1 focus-within:ring-blue-500/50' 
            : isCompact ? 'w-24 focus-within:w-32' : 'w-24 sm:w-36 focus-within:w-48'
        }`}>
          <Search className="w-3.5 h-3.5 absolute left-2 text-gray-400 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={isVeryCompact ? "" : "Search..."}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent pl-7 pr-2 py-1 text-xs text-gray-200 focus:outline-none w-full font-sans"
            title="Global Search (Ctrl+S)"
          />
          {isSearchingGlobal && (
            <RefreshCw className="w-3 h-3 text-blue-400 animate-spin absolute right-2 pointer-events-none" />
          )}
        </div>
      </div>
    </div>
  );
};
