import React, { useState, useRef, useEffect } from 'react';
import { 
  Plus, 
  X, 
  Code2, 
  ChevronLeft, 
  ChevronRight, 
  Copy, 
  Trash2, 
  ArrowRightToLine, 
  Layers, 
  Edit3,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { QueryTab } from '../types';
import { PortalContextMenu } from '../../../components/PortalContextMenu';

interface QueryTabBarProps {
  tabs: QueryTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onAddTab: () => void;
  onCloseTab: (id: string) => void;
  onCloseRight: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
  onDuplicateTab?: (id: string) => void;
  onRenameTab?: (id: string, newTitle: string) => void;
}

export const QueryTabBar: React.FC<QueryTabBarProps> = ({
  tabs,
  activeTabId,
  onSelectTab,
  onAddTab,
  onCloseTab,
  onCloseRight,
  onCloseOthers,
  onCloseAll,
  onDuplicateTab,
  onRenameTab,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    tabId: string;
    x: number;
    y: number;
  } | null>(null);

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Close context menu on global click
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      tabId,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleStartRename = (tab: QueryTab) => {
    setRenamingTabId(tab.id);
    setRenameValue(tab.title);
    setContextMenu(null);
  };

  const handleCommitRename = (tabId: string) => {
    if (renameValue.trim() && onRenameTab) {
      onRenameTab(tabId, renameValue.trim());
    }
    setRenamingTabId(null);
  };

  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -200, behavior: 'smooth' });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 200, behavior: 'smooth' });
    }
  };

  // Handle wheel horizontal scroll
  const handleWheel = (e: React.WheelEvent) => {
    if (scrollContainerRef.current && e.deltaY !== 0) {
      scrollContainerRef.current.scrollLeft += e.deltaY;
    }
  };

  return (
    <div className="relative h-10 border-b border-white/10 bg-[#161622]/95 backdrop-blur-md flex items-center justify-between shrink-0 select-none">
      
      {/* Scroll Left Button */}
      <button
        onClick={scrollLeft}
        className="h-full px-1.5 text-gray-500 hover:text-white hover:bg-white/5 transition-colors border-r border-white/5"
        title="Scroll Tabs Left"
      >
        <ChevronLeft className="w-3.5 h-3.5" />
      </button>

      {/* Tabs Horizontal Scroll Area */}
      <div
        ref={scrollContainerRef}
        onWheel={handleWheel}
        className="flex-1 flex items-center overflow-x-auto no-scrollbar scroll-smooth h-full"
      >
        {tabs.map((tab, idx) => {
          const isActive = tab.id === activeTabId;
          const isRenaming = renamingTabId === tab.id;

          return (
            <div
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              onDoubleClick={() => handleStartRename(tab)}
              className={`group relative h-full flex items-center gap-2 px-3.5 border-r border-white/10 cursor-pointer transition-all min-w-[130px] max-w-[220px] shrink-0 text-xs ${
                isActive
                  ? 'bg-[#1e1e2e] text-white font-medium shadow-inner'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.03]'
              }`}
            >
              {/* Active Tab Accent Bar */}
              {isActive && (
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-blue-500 to-indigo-500" />
              )}

              {/* Status / Icon */}
              {tab.isExecuting ? (
                <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
              ) : tab.error ? (
                <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              ) : (
                <Code2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-400'}`} />
              )}

              {/* Title / Inline Rename Input */}
              {isRenaming ? (
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => handleCommitRename(tab.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCommitRename(tab.id);
                    if (e.key === 'Escape') setRenamingTabId(null);
                  }}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  className="bg-black/60 border border-blue-500/50 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none w-full"
                />
              ) : (
                <span className="truncate flex-1 font-mono text-[11px]" title={tab.title}>
                  {tab.title}
                </span>
              )}

              {/* Result Pill Badge */}
              {tab.results && tab.results.length > 0 && !tab.error && (
                <span className="text-[10px] px-1 rounded bg-emerald-500/10 text-emerald-400 font-mono shrink-0">
                  {tab.results.length}
                </span>
              )}

              {/* Close Tab Button */}
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className={`p-0.5 rounded-md hover:bg-white/10 hover:text-white transition-opacity ${
                    isActive ? 'opacity-80 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title="Close Tab (Ctrl+W)"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Scroll Right Button */}
      <button
        onClick={scrollRight}
        className="h-full px-1.5 text-gray-500 hover:text-white hover:bg-white/5 transition-colors border-l border-white/5"
        title="Scroll Tabs Right"
      >
        <ChevronRight className="w-3.5 h-3.5" />
      </button>

      {/* New Tab (+) Button */}
      <button
        onClick={onAddTab}
        className="h-full px-3 text-gray-400 hover:text-white hover:bg-white/5 transition-colors border-l border-white/10 flex items-center gap-1.5 text-xs shrink-0"
        title="New Query Tab"
      >
        <Plus className="w-3.5 h-3.5" />
        <span className="hidden sm:inline text-[11px]">New Tab</span>
      </button>

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <PortalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          className="min-w-[190px] bg-[#1e1e2e]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 text-xs text-gray-200"
        >
          {onRenameTab && (
            <button
              onClick={() => {
                const target = tabs.find((t) => t.id === contextMenu.tabId);
                if (target) handleStartRename(target);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5 text-gray-400" />
              <span>Rename Tab</span>
            </button>
          )}

          {onDuplicateTab && (
            <button
              onClick={() => {
                onDuplicateTab(contextMenu.tabId);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors"
            >
              <Copy className="w-3.5 h-3.5 text-gray-400" />
              <span>Duplicate Tab</span>
            </button>
          )}

          <div className="my-1 border-t border-white/5" />

          <button
            onClick={() => {
              onCloseTab(contextMenu.tabId);
              setContextMenu(null);
            }}
            disabled={tabs.length <= 1}
            className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center justify-between transition-colors disabled:opacity-40"
          >
            <div className="flex items-center gap-2.5">
              <X className="w-3.5 h-3.5 text-gray-400" />
              <span>Close Tab</span>
            </div>
            <span className="text-[10px] text-gray-500 font-mono">Ctrl+W</span>
          </button>

          <button
            onClick={() => {
              onCloseRight(contextMenu.tabId);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors"
          >
            <ArrowRightToLine className="w-3.5 h-3.5 text-gray-400" />
            <span>Close Tabs to the Right</span>
          </button>

          <button
            onClick={() => {
              onCloseOthers(contextMenu.tabId);
              setContextMenu(null);
            }}
            disabled={tabs.length <= 1}
            className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors disabled:opacity-40"
          >
            <Layers className="w-3.5 h-3.5 text-gray-400" />
            <span>Close Other Tabs</span>
          </button>

          <button
            onClick={() => {
              onCloseAll();
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-red-500/10 text-red-400 flex items-center gap-2.5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            <span>Close All Tabs</span>
          </button>
        </PortalContextMenu>
      )}

    </div>
  );
};

export default QueryTabBar;
