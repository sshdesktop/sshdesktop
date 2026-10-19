import React, { useRef } from 'react';
import { Folder, FileCode, Archive, Image as ImageIcon, Music, Video, Sparkles, Layers3 } from 'lucide-react';
import { DesktopItem, ICON_CONFIGS } from './types';
import { useSettingsStore } from '../../lib/store';

interface DesktopIconGridProps {
  items: DesktopItem[];
  iconPositions: Record<string, { x: number; y: number }>;
  onStartDragIcon: (id: string, e: React.MouseEvent) => void;
  draggingIconId: string | null;
  draggingCurrentPos: { x: number; y: number } | null;
  selectedIds: Set<string>;
  onSelectIcon: (id: string, e: React.MouseEvent) => void;
  onOpenItemMenu: (e: React.MouseEvent, item: DesktopItem) => void;
  useStacks: boolean;
  expandedStack: string | null;
  onToggleStack: (stackName: string) => void;
}

export default function DesktopIconGrid({
  items,
  iconPositions,
  onStartDragIcon,
  draggingIconId,
  draggingCurrentPos,
  selectedIds,
  onSelectIcon,
  onOpenItemMenu,
  useStacks,
  expandedStack,
  onToggleStack,
}: DesktopIconGridProps) {
  const { desktopIconSize, theme } = useSettingsStore();
  const cfg = ICON_CONFIGS[desktopIconSize || 'medium'];
  const isLight = theme === 'light';

  // Group items by Kind if Stacks is active
  const stacksMap: Record<string, DesktopItem[]> = {};
  if (useStacks) {
    items.forEach(item => {
      const ext = item.label.split('.').pop()?.toLowerCase() || '';
      let category = 'Documents';
      if (item.kind === 'folder') category = 'Folders';
      else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) category = 'Images';
      else if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) category = 'Movies';
      else if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) category = 'Audio';
      else if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar', 'tgz'].includes(ext)) category = 'Archives';
      else if (['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'json', 'yaml', 'toml', 'sh', 'sql', 'html', 'css'].includes(ext)) category = 'Code';

      if (!stacksMap[category]) stacksMap[category] = [];
      stacksMap[category].push(item);
    });
  }

  // Helper to get custom icon based on file extension
  const getRenderIcon = (item: DesktopItem) => {
    if (item.kind === 'folder') return Folder;
    const ext = item.label.split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return ImageIcon;
    if (['mp4', 'mov', 'webm'].includes(ext)) return Video;
    if (['mp3', 'wav', 'ogg'].includes(ext)) return Music;
    if (['zip', 'tar', 'gz', 'tgz'].includes(ext)) return Archive;
    return item.icon || FileCode;
  };

  if (useStacks) {
    return (
      <div className="absolute inset-0 pointer-events-none p-6 pt-12 overflow-hidden select-none">
        <div className="flex flex-col flex-wrap gap-4 max-h-[80vh] items-start">
          {Object.entries(stacksMap).map(([stackName, stackItems], idx) => {
            const isExpanded = expandedStack === stackName;
            return (
              <div key={stackName} className="pointer-events-auto flex flex-col items-center">
                <div
                  onClick={() => onToggleStack(stackName)}
                  className="flex flex-col items-center p-2 rounded-2xl hover:bg-white/10 dark:hover:bg-white/10 transition-all cursor-pointer group"
                >
                  <div className="relative w-14 h-14 flex items-center justify-center">
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 opacity-30 transform translate-x-1 -translate-y-1 rounded-2xl" />
                    <div className="absolute inset-0 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 opacity-60 transform -translate-x-0.5 -translate-y-0.5 rounded-2xl" />
                    <div className="relative w-full h-full rounded-2xl bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg border border-white/20">
                      <Layers3 className="w-7 h-7 text-white" />
                    </div>
                    <span className="absolute -bottom-1 -right-1 bg-black/80 text-white text-[10px] font-bold px-1.5 py-0.2 rounded-full border border-white/20">
                      {stackItems.length}
                    </span>
                  </div>
                  <span className={`text-xs font-semibold mt-1.5 drop-shadow-md px-1.5 py-0.5 rounded ${
                    isLight ? 'text-slate-900 bg-white/70' : 'text-white'
                  }`}>
                    {stackName}
                  </span>
                </div>

                {isExpanded && (
                  <div className="mt-2 pl-4 flex flex-col space-y-2 border-l border-white/20">
                    {stackItems.map(item => (
                      <div
                        key={item.id}
                        onDoubleClick={item.action}
                        onContextMenu={(e) => onOpenItemMenu(e, item)}
                        className="flex items-center space-x-2 p-1.5 rounded-xl hover:bg-white/15 cursor-pointer text-xs"
                      >
                        <Folder className="w-4 h-4 text-amber-400" />
                        <span className="text-white drop-shadow truncate max-w-[140px]">{item.label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
      {items.map((item, idx) => {
        const isDraggingThis = draggingIconId === item.id;
        const pos = isDraggingThis && draggingCurrentPos
          ? draggingCurrentPos
          : iconPositions[item.id] || {
              x: 24 + Math.floor(idx / Math.max(2, Math.floor((window.innerHeight - 160) / cfg.rowSpacing))) * cfg.colSpacing,
              y: 48 + (idx % Math.max(2, Math.floor((window.innerHeight - 160) / cfg.rowSpacing))) * cfg.rowSpacing,
            };

        const isSelected = selectedIds.has(item.id);
        const IconComponent = getRenderIcon(item);

        return (
          <div
            key={item.id}
            style={{
              position: 'absolute',
              left: `${pos.x}px`,
              top: `${pos.y}px`,
              width: `${cfg.w}px`,
              zIndex: isDraggingThis ? 9999 : isSelected ? 30 : 20,
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onSelectIcon(item.id, e);
              if (e.button === 0) {
                onStartDragIcon(item.id, e);
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              item.action();
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenItemMenu(e, item);
            }}
            className={`desktop-icon pointer-events-auto flex flex-col items-center justify-center p-1.5 rounded-2xl cursor-grab active:cursor-grabbing transition-shadow group select-none text-center ${
              isDraggingThis 
                ? 'scale-105 shadow-2xl opacity-90 ring-2 ring-blue-400/80 bg-blue-600/30' 
                : isSelected
                ? 'bg-blue-600/35 ring-2 ring-blue-400/80 rounded-2xl shadow-xl'
                : 'hover:bg-white/10 dark:hover:bg-white/10'
            }`}
          >
            {/* macOS Authentic Icon Tile */}
            <div 
              className={`rounded-2xl bg-gradient-to-b ${item.tileBg} flex items-center justify-center shadow-lg border border-white/20 relative overflow-hidden group-hover:scale-105 transition-transform`}
              style={{ width: `${cfg.iconSize * 1.8}px`, height: `${cfg.iconSize * 1.8}px` }}
            >
              <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent pointer-events-none" />
              <IconComponent 
                className="drop-shadow-md text-white relative z-10" 
                style={{ width: `${cfg.iconSize}px`, height: `${cfg.iconSize}px` }}
              />
            </div>

            {/* Icon Label */}
            <span 
              className={`mt-1.5 ${cfg.labelText} font-medium leading-tight line-clamp-2 px-1.5 py-0.5 rounded max-w-[95%] break-words select-none ${
                isSelected 
                  ? 'bg-blue-600 text-white font-bold shadow-md' 
                  : isLight
                  ? 'text-slate-900 bg-white/70 backdrop-blur-xs font-semibold shadow-xs'
                  : 'text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]'
              }`}
            >
              {item.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
