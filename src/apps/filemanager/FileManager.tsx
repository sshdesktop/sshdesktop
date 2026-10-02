import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Folder, FileText, ArrowLeft, ArrowRight, ArrowUp, 
  Grid, List, Columns, Image as ImageIcon, Search, Plus, Trash2, 
  ChevronRight, RefreshCw, Copy, Scissors, ClipboardPaste, FileCode, 
  CheckSquare, Square, Upload, Terminal, Edit3, Key, Archive, PackageOpen, 
  Star, BookmarkPlus, Compass, HardDrive, ShieldAlert, X, Users, Eye, 
  Tag, MoreHorizontal, Download, Layers
} from 'lucide-react';
import { 
  sftpListDir, sftpMkdir, sftpDelete, sftpRename, sftpChmod, sftpChown, 
  sftpWriteTextFile, sftpReadTextFile, sshExec 
} from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore, useSettingsStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';

interface RemoteFile {
  name: string;
  type: 'dir' | 'file';
  size: string;
  rawSize: number;
  permissions: string;
  owner: string;
  modified: string;
  extension?: string;
  tag?: string;
}

interface ClipboardState {
  files: string[];
  isCut: boolean;
  sourceDir: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  file?: RemoteFile;
  isCanvas?: boolean;
}

interface FinderTab {
  id: string;
  title: string;
  path: string;
  history: string[];
  historyIndex: number;
}

interface UndoAction {
  type: 'delete' | 'rename' | 'move';
  originalPath: string;
  targetPath?: string;
  content?: string;
}

const MACOS_TAGS = [
  { id: 'red', name: 'Red', color: '#ff453a' },
  { id: 'orange', name: 'Orange', color: '#ff9f0a' },
  { id: 'yellow', name: 'Yellow', color: '#ffd60a' },
  { id: 'green', name: 'Green', color: '#30d158' },
  { id: 'blue', name: 'Blue', color: '#0a84ff' },
  { id: 'purple', name: 'Purple', color: '#bf5af2' },
  { id: 'gray', name: 'Gray', color: '#8e8e93' },
];

export default function FileManager() {
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });
  const currentUsername = activeServer?.username || 'root';
  const userHome = currentUsername === 'root' ? '/root' : `/home/${currentUsername}`;

  // Tabs State (macOS Finder Tabs)
  const [tabs, setTabs] = useState<FinderTab[]>([
    {
      id: 'tab-1',
      title: 'Macintosh HD',
      path: '/',
      history: ['/'],
      historyIndex: 0
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const currentPath = activeTab.path;
  const history = activeTab.history;
  const historyIndex = activeTab.historyIndex;

  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState(currentPath);
  const [view, setView] = useState<'icons' | 'list' | 'columns' | 'gallery'>('icons');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [search, setSearch] = useState('');
  const [fileTags, setFileTags] = useState<Record<string, string>>({});
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);

  // Quick Look State (Spacebar Preview)
  const [quickLookFile, setQuickLookFile] = useState<RemoteFile | null>(null);
  const [quickLookContent, setQuickLookContent] = useState<string>('');
  const [isLoadingQuickLook, setIsLoadingQuickLook] = useState(false);

  // Modals
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string>('');
  const [renameNewName, setRenameNewName] = useState<string>('');
  const [showChmodModal, setShowChmodModal] = useState(false);
  const [chmodTarget, setChmodTarget] = useState<RemoteFile | null>(null);
  const [octalMode, setOctalMode] = useState<string>('755');
  const [showChownModal, setShowChownModal] = useState(false);
  const [chownTarget, setChownTarget] = useState<RemoteFile | null>(null);
  const [chownOwner, setChownOwner] = useState('root');
  const [chownGroup, setChownGroup] = useState('root');
  const [showActionMenu, setShowActionMenu] = useState(false);

  // Drag and drop moving between folders
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const { openApp } = useWindowManager();
  const { openFileInEditor } = useEditorStore();
  const { favorites, addFavorite, removeFavorite } = useSettingsStore();

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const clean = path.replace(/\/+/g, '/') || '/';
      const entries = await sftpListDir(activeConnId, clean);
      if (entries && Array.isArray(entries)) {
        setFiles(entries.map((item: any) => ({
          name: item.name,
          type: item.is_dir ? 'dir' : 'file',
          size: item.is_dir ? '—' : `${(item.size / 1024).toFixed(1)} KB`,
          rawSize: item.size || 0,
          permissions: item.permissions || (item.is_dir ? 'drwxr-xr-x' : '-rw-r--r--'),
          owner: item.owner || 'root',
          modified: item.modified ? new Date(item.modified * 1000).toLocaleDateString() : 'Recent',
          extension: item.name.includes('.') ? item.name.split('.').pop()?.toLowerCase() : undefined,
          tag: fileTags[item.name],
        })));
      } else {
        setFiles([]);
      }
    } catch (err) {
      console.warn('SFTP directory list failed:', err);
      setFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnId, fileTags]);

  useEffect(() => {
    loadDirectory(currentPath);
    setPathInput(currentPath);
  }, [currentPath, loadDirectory]);

  // Close context menu on outside click
  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      setShowActionMenu(false);
    };
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const navigateTo = (path: string) => {
    const clean = path.replace(/\/+/g, '/') || '/';
    const folderTitle = clean === '/' ? 'Macintosh HD' : clean.split('/').filter(Boolean).pop() || 'Folder';
    
    setTabs(prev => prev.map(t => {
      if (t.id === activeTabId) {
        const nextHist = t.history.slice(0, t.historyIndex + 1);
        return {
          ...t,
          path: clean,
          title: folderTitle,
          history: [...nextHist, clean],
          historyIndex: nextHist.length
        };
      }
      return t;
    }));

    setPathInput(clean);
    setIsEditingPath(false);
    setSelectedFiles(new Set());
    setLastSelectedIndex(null);
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pathInput.trim()) return;
    navigateTo(pathInput.trim());
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      const folderTitle = prev === '/' ? 'Macintosh HD' : prev.split('/').filter(Boolean).pop() || 'Folder';
      setTabs(prevTabs => prevTabs.map(t => {
        if (t.id === activeTabId) {
          return {
            ...t,
            path: prev,
            title: folderTitle,
            historyIndex: t.historyIndex - 1
          };
        }
        return t;
      }));
      setPathInput(prev);
      setSelectedFiles(new Set());
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      const folderTitle = next === '/' ? 'Macintosh HD' : next.split('/').filter(Boolean).pop() || 'Folder';
      setTabs(prevTabs => prevTabs.map(t => {
        if (t.id === activeTabId) {
          return {
            ...t,
            path: next,
            title: folderTitle,
            historyIndex: t.historyIndex + 1
          };
        }
        return t;
      }));
      setPathInput(next);
      setSelectedFiles(new Set());
    }
  };

  const goUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      const parent = '/' + parts.join('/');
      navigateTo(parent || '/');
    }
  };

  // Tab Operations (macOS Finder Tabs)
  const handleNewTab = (customPath?: string) => {
    const targetPath = customPath || currentPath || '/';
    const folderTitle = targetPath === '/' ? 'Macintosh HD' : targetPath.split('/').filter(Boolean).pop() || 'Folder';
    const newId = `tab-${Date.now()}`;
    setTabs(prev => [
      ...prev,
      {
        id: newId,
        title: folderTitle,
        path: targetPath,
        history: [targetPath],
        historyIndex: 0
      }
    ]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining[remaining.length - 1].id);
    }
  };

  // File selection
  const handleSelectFile = (f: RemoteFile, index: number, e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedFiles(prev => {
        const next = new Set(prev);
        if (next.has(f.name)) next.delete(f.name);
        else next.add(f.name);
        return next;
      });
      setLastSelectedIndex(index);
    } else if (e.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const range = filteredFiles.slice(start, end + 1).map(item => item.name);
      setSelectedFiles(new Set(range));
    } else {
      setSelectedFiles(new Set([f.name]));
      setLastSelectedIndex(index);
    }
  };

  const openFileTarget = (fileName: string) => {
    const fullPath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
    openFileInEditor(fullPath);
    openApp('editor', `Edit: ${fileName}`);
  };

  const handleFileDoubleClick = (f: RemoteFile) => {
    if (f.type === 'dir') {
      navigateTo(currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`);
    } else {
      openFileTarget(f.name);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file?: RemoteFile) => {
    e.preventDefault();
    e.stopPropagation();
    if (file && !selectedFiles.has(file.name)) {
      setSelectedFiles(new Set([file.name]));
    }
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      file,
      isCanvas: !file,
    });
  };

  // Quick Look Toggle (Spacebar or Ctrl+P)
  const handleQuickLookToggle = async (targetFile?: RemoteFile) => {
    const file = targetFile || (selectedFiles.size > 0 ? files.find(f => selectedFiles.has(f.name)) : null);
    if (!file) return;

    if (quickLookFile?.name === file.name) {
      setQuickLookFile(null);
      setQuickLookContent('');
      return;
    }

    setQuickLookFile(file);
    if (file.type === 'file') {
      setIsLoadingQuickLook(true);
      try {
        const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        const content = await sftpReadTextFile(activeConnId, fullPath);
        setQuickLookContent(content || '(Empty file)');
      } catch {
        setQuickLookContent('(Binary or protected system file)');
      } finally {
        setIsLoadingQuickLook(false);
      }
    } else {
      setQuickLookContent(`Directory with remote server items`);
    }
  };

  // Copy / Cut / Paste / Duplicate
  const handleCopy = () => {
    if (selectedFiles.size === 0) return;
    setClipboard({
      files: Array.from(selectedFiles),
      isCut: false,
      sourceDir: currentPath,
    });
  };

  const handleCut = () => {
    if (selectedFiles.size === 0) return;
    setClipboard({
      files: Array.from(selectedFiles),
      isCut: true,
      sourceDir: currentPath,
    });
  };

  const handlePaste = async () => {
    if (!clipboard || clipboard.files.length === 0) return;
    setIsLoading(true);
    try {
      for (const name of clipboard.files) {
        const src = clipboard.sourceDir === '/' ? `/${name}` : `${clipboard.sourceDir}/${name}`;
        const dest = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        const cmd = clipboard.isCut ? `mv '${src}' '${dest}'` : `cp -r '${src}' '${dest}'`;
        await sshExec(activeConnId, cmd);
      }
      if (clipboard.isCut) setClipboard(null);
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Paste failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuplicate = async () => {
    if (selectedFiles.size === 0) return;
    setIsLoading(true);
    try {
      for (const name of selectedFiles) {
        const src = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        const dotIdx = name.lastIndexOf('.');
        const copyName = dotIdx > 0 
          ? `${name.slice(0, dotIdx)} copy${name.slice(dotIdx)}` 
          : `${name} copy`;
        const dest = currentPath === '/' ? `/${copyName}` : `${currentPath}/${copyName}`;
        await sshExec(activeConnId, `cp -r '${src}' '${dest}'`);
      }
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Duplicate failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedFiles.size === 0) return;
    const items = Array.from(selectedFiles);
    const confirmMsg = items.length === 1 
      ? `Move '${items[0]}' to Trash?`
      : `Move ${items.length} selected items to Trash?`;
    if (!confirm(confirmMsg)) return;

    try {
      for (const name of items) {
        const targetPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        await sftpDelete(activeConnId, targetPath);
      }
      setSelectedFiles(new Set());
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Delete failed: ${err?.message || err}`);
    }
  };

  const handleSelectAll = () => {
    setSelectedFiles(new Set(filteredFiles.map(f => f.name)));
  };

  const handleUndo = async () => {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    try {
      if (last.type === 'delete' && last.content && last.originalPath) {
        await sftpWriteTextFile(activeConnId, last.originalPath, last.content);
      } else if (last.type === 'rename' && last.originalPath && last.targetPath) {
        await sftpRename(activeConnId, last.targetPath, last.originalPath);
      } else if (last.type === 'move' && last.originalPath && last.targetPath) {
        await sftpRename(activeConnId, last.targetPath, last.originalPath);
      }
      await loadDirectory(currentPath);
    } catch (err: any) {
      console.warn('Undo error:', err);
    }
  };

  // Keyboard Shortcuts Listener (macOS standard Cmd/Ctrl)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      const isMacMeta = e.metaKey || e.ctrlKey;

      if (isMacMeta && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy();
      } else if (isMacMeta && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste();
      } else if (isMacMeta && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleCut();
      } else if (isMacMeta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (isMacMeta && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handleSelectAll();
      } else if (isMacMeta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        handleDuplicate();
      } else if (isMacMeta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (isMacMeta && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handleQuickLookToggle();
      } else if (isMacMeta && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleNewTab();
      } else if (isMacMeta && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowNewFolder(true);
      } else if (e.code === 'Space') {
        e.preventDefault();
        handleQuickLookToggle();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedFiles.size === 1) {
          const first = Array.from(selectedFiles)[0];
          setRenameTarget(first);
          setRenameNewName(first);
          setShowRenameModal(true);
        }
      } else if (e.key === 'Delete' || (isMacMeta && e.key === 'Backspace')) {
        e.preventDefault();
        handleDeleteSelected();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFiles, clipboard, currentPath, undoStack, quickLookFile]);

  // Color tag assigner
  const handleAssignTag = (fileName: string, tagId: string) => {
    setFileTags(prev => ({
      ...prev,
      [fileName]: tagId
    }));
    setContextMenu(null);
  };

  // Filtered files including tag filter and search filter
  const filteredFiles = files.filter(f => {
    const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase());
    const matchesTag = !activeTagFilter || fileTags[f.name] === activeTagFilter;
    return matchesSearch && matchesTag;
  });

  const selectedFileObj = filteredFiles.find(f => selectedFiles.has(f.name)) || filteredFiles[0];

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  const quickPlaces = [
    { label: 'Desktop', path: `${userHome}/Desktop`, icon: Compass },
    { label: 'Documents', path: `${userHome}/Documents`, icon: FileText },
    { label: 'Downloads', path: `${userHome}/Downloads`, icon: Download },
    { label: 'User Home', path: userHome, icon: Folder },
    { label: 'Macintosh HD', path: '/', icon: HardDrive },
    { label: 'Applications', path: '/usr/local/bin', icon: Layers },
    { label: 'Logs', path: '/var/log', icon: FileCode },
  ];

  return (
    <div 
      className="flex h-full bg-[#181825] text-[#cdd6f4] select-none overflow-hidden"
      onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
      onDragLeave={() => setIsDraggingOver(false)}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      {/* macOS Translucent Finder Sidebar */}
      <div className="w-52 bg-[#14141e]/90 backdrop-blur-2xl border-r border-white/[0.08] flex flex-col shrink-0 py-3 px-2 text-xs">
        {/* Favorites Section */}
        <div className="text-[10px] font-bold text-gray-500 uppercase px-3 mb-1.5 tracking-wider">
          Favorites
        </div>
        <div className="space-y-0.5 mb-3">
          {quickPlaces.map(p => {
            const Icon = p.icon;
            const isCurrent = currentPath === p.path;
            return (
              <button
                key={p.path}
                onClick={() => navigateTo(p.path)}
                className={`w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-left transition-colors ${
                  isCurrent ? 'bg-blue-600 text-white font-medium shadow-sm' : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isCurrent ? 'text-white' : 'text-blue-400'}`} />
                <span className="truncate">{p.label}</span>
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
            className={`w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-left transition-colors ${
              currentPath === '/' ? 'bg-blue-600 text-white font-medium shadow-sm' : 'text-gray-300 hover:text-white hover:bg-white/5'
            }`}
          >
            <HardDrive className={`w-3.5 h-3.5 ${currentPath === '/' ? 'text-white' : 'text-blue-400'}`} />
            <span className="truncate">Macintosh HD</span>
          </button>
        </div>

        {/* Tags Section (macOS 7 Color Dots) */}
        <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase px-3 mb-1.5 tracking-wider">
          <span>Tags</span>
          {activeTagFilter && (
            <button 
              onClick={() => setActiveTagFilter(null)}
              className="text-[9px] text-blue-400 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <div className="space-y-0.5 mb-3">
          {MACOS_TAGS.map(tag => {
            const isSelected = activeTagFilter === tag.id;
            return (
              <button
                key={tag.id}
                onClick={() => setActiveTagFilter(isSelected ? null : tag.id)}
                className={`w-full flex items-center space-x-2 px-3 py-1.5 rounded-xl text-left transition-colors ${
                  isSelected ? 'bg-white/10 text-white font-semibold' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                <span className="truncate">{tag.name}</span>
              </button>
            );
          })}
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

      {/* Main Finder Workspace */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#181825]">
        {/* macOS Finder Tab Bar */}
        <div className="flex items-center bg-[#11111a] border-b border-white/[0.08] px-2 pt-1.5 space-x-1 shrink-0 overflow-x-auto">
          {tabs.map(tab => (
            <div
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-t-xl text-xs transition-colors cursor-pointer group ${
                activeTabId === tab.id
                  ? 'bg-[#181825] text-white font-medium shadow-sm border-t-2 border-t-blue-500'
                  : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-200'
              }`}
            >
              <Folder className="w-3.5 h-3.5 text-blue-400" />
              <span className="truncate max-w-[120px]">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => handleCloseTab(tab.id, e)}
                  className="opacity-0 group-hover:opacity-100 hover:bg-white/20 p-0.5 rounded transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}

          <button
            onClick={() => handleNewTab()}
            className="p-1.5 hover:bg-white/[0.08] rounded-lg text-gray-400 hover:text-white transition-colors"
            title="New Finder Tab (Ctrl+T)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* macOS Finder Segmented Toolbar */}
        <div className="flex items-center justify-between bg-[#14141e] border-b border-white/[0.08] px-4 py-2 shrink-0">
          <div className="flex items-center space-x-3 flex-1 min-w-0">
            {/* Segmented Back / Forward / Up */}
            <div className="flex items-center bg-white/[0.06] rounded-xl p-0.5 border border-white/10 shrink-0">
              <button
                onClick={goBack}
                disabled={historyIndex === 0}
                className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-25 text-gray-300 transition-colors"
                title="Back"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={goForward}
                disabled={historyIndex >= history.length - 1}
                className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-25 text-gray-300 transition-colors"
                title="Forward"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={goUp}
                disabled={currentPath === '/'}
                className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-25 text-gray-300 transition-colors border-l border-white/10"
                title="Enclosing Folder (Up)"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Segmented View Mode Switcher [ ⊞ | ☰ | ☵ | 🖼 ] */}
            <div className="flex items-center bg-white/[0.06] rounded-xl p-0.5 border border-white/10 shrink-0">
              <button
                onClick={() => setView('icons')}
                className={`p-1.5 rounded-lg transition-colors ${view === 'icons' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                title="Icons View (⊞)"
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setView('list')}
                className={`p-1.5 rounded-lg transition-colors ${view === 'list' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                title="List View (☰)"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setView('columns')}
                className={`p-1.5 rounded-lg transition-colors ${view === 'columns' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                title="Miller Columns View (☵)"
              >
                <Columns className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setView('gallery')}
                className={`p-1.5 rounded-lg transition-colors ${view === 'gallery' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                title="Gallery / QuickLook View (🖼)"
              >
                <ImageIcon className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Editable Path Pill */}
            <div className="flex-1 max-w-md">
              {isEditingPath ? (
                <form onSubmit={handlePathSubmit} className="flex-1">
                  <input
                    type="text"
                    autoFocus
                    value={pathInput}
                    onChange={e => setPathInput(e.target.value)}
                    onBlur={() => {
                      setIsEditingPath(false);
                      setPathInput(currentPath);
                    }}
                    placeholder="/path/to/folder"
                    className="w-full bg-[#0f0f18] border border-blue-500 rounded-xl px-3 py-1 text-xs font-mono text-white focus:outline-none shadow-inner"
                  />
                </form>
              ) : (
                <div 
                  onClick={() => setIsEditingPath(true)}
                  className="flex items-center bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 rounded-xl px-3 py-1 text-xs font-mono flex-1 overflow-x-auto space-x-1.5 scrollbar-none cursor-text group transition-colors"
                  title="Click to edit path directly"
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); navigateTo('/'); }}
                    className="text-gray-400 hover:text-white cursor-pointer px-1 rounded hover:bg-white/10 shrink-0"
                  >
                    /
                  </span>
                  {breadcrumbs.map((part, index) => {
                    const full = '/' + breadcrumbs.slice(0, index + 1).join('/');
                    return (
                      <React.Fragment key={full}>
                        <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />
                        <span
                          onClick={(e) => { e.stopPropagation(); navigateTo(full); }}
                          className="text-gray-300 hover:text-white cursor-pointer px-1 rounded hover:bg-white/10 whitespace-nowrap"
                        >
                          {part}
                        </span>
                      </React.Fragment>
                    );
                  })}
                  <Edit3 className="w-3 h-3 text-gray-500 opacity-0 group-hover:opacity-100 ml-auto shrink-0" />
                </div>
              )}
            </div>
          </div>

          {/* Action Toolbar Tools */}
          <div className="flex items-center space-x-2 pl-3 shrink-0">
            {/* Quick Look Button */}
            <button
              onClick={() => handleQuickLookToggle()}
              className="p-1.5 hover:bg-white/10 rounded-xl text-gray-300 hover:text-blue-400 flex items-center space-x-1 text-xs transition-colors"
              title="Quick Look (Spacebar)"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>

            {/* New Folder */}
            <button
              onClick={() => setShowNewFolder(true)}
              className="p-1.5 hover:bg-white/10 rounded-xl text-gray-300 hover:text-blue-400 flex items-center space-x-1 text-xs transition-colors"
              title="New Folder (Ctrl+N)"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Folder</span>
            </button>

            {/* Action Menu (⋯) */}
            <div className="relative">
              <button
                onClick={() => setShowActionMenu(!showActionMenu)}
                className="p-1.5 hover:bg-white/10 rounded-xl text-gray-300 hover:text-white transition-colors"
                title="Action Options"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>

              {showActionMenu && (
                <div 
                  className="absolute right-0 top-8 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl py-1.5 z-50 text-xs w-48 font-sans"
                  onClick={() => setShowActionMenu(false)}
                >
                  <div 
                    onClick={() => setShowNewFile(true)}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>New Empty File</span>
                  </div>
                  <div 
                    onClick={handleDuplicate}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Duplicate (Ctrl+D)</span>
                  </div>
                  <div 
                    onClick={handleCopy}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy (Ctrl+C)</span>
                  </div>
                  <div 
                    onClick={handlePaste}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span>Paste (Ctrl+V)</span>
                  </div>
                  <div className="my-1 border-t border-white/10 mx-2" />
                  <div 
                    onClick={() => openApp('terminal', 'Terminal')}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                  >
                    <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Open in Terminal</span>
                  </div>
                </div>
              )}
            </div>

            {/* Search Pill */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search (Ctrl+S)"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#0f0f18] border border-white/10 rounded-xl pl-8 pr-3 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 w-32 focus:w-44 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Main Content Area Based on 4 View Modes */}
        <div className="flex-1 overflow-hidden relative">
          {/* Drop Upload Banner */}
          {isDraggingOver && (
            <div className="absolute inset-0 bg-blue-600/20 backdrop-blur-md border-2 border-dashed border-blue-400 rounded-3xl z-30 flex flex-col items-center justify-center pointer-events-none">
              <Upload className="w-12 h-12 text-blue-300 animate-bounce mb-2" />
              <span className="text-sm font-bold text-white">Drop files to upload into {currentPath}</span>
            </div>
          )}

          {isLoading && files.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-400 space-x-2">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
              <span>Fetching remote files over SFTP...</span>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 py-16 space-y-2">
              <Folder className="w-12 h-12 opacity-25" />
              <span className="text-xs">This directory is empty</span>
            </div>
          ) : view === 'icons' ? (
            /* 1. ICONS VIEW */
            <div className="h-full overflow-y-auto p-4">
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-4">
                {filteredFiles.map((f, idx) => {
                  const isSelected = selectedFiles.has(f.name);
                  const isArchive = ['tar', 'gz', 'tgz', 'zip'].includes(f.extension || '');
                  const tagInfo = MACOS_TAGS.find(t => t.id === f.tag);
                  return (
                    <div
                      key={f.name}
                      onClick={(e) => handleSelectFile(f, idx, e)}
                      onDoubleClick={() => handleFileDoubleClick(f)}
                      onContextMenu={(e) => handleContextMenu(e, f)}
                      className={`flex flex-col items-center p-3 rounded-2xl cursor-pointer select-none transition-all group relative ${
                        isSelected
                          ? 'bg-blue-600/25 border border-blue-500/50 shadow-lg ring-1 ring-blue-500/30'
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      <div className="relative mb-2">
                        {f.type === 'dir' ? (
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-md">
                            <Folder className="w-8 h-8 text-white fill-white/20" />
                          </div>
                        ) : isArchive ? (
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-md">
                            <Archive className="w-8 h-8 text-white" />
                          </div>
                        ) : (
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 border border-white/10 flex items-center justify-center shadow-md">
                            <FileText className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                        {tagInfo && (
                          <span 
                            className="absolute -top-1 -right-1 w-3 h-3 rounded-full border border-black shadow"
                            style={{ backgroundColor: tagInfo.color }}
                          />
                        )}
                      </div>
                      <span className="text-xs text-center text-gray-200 break-all line-clamp-2 max-w-full font-medium leading-tight drop-shadow-sm">
                        {f.name}
                      </span>
                      <span className="text-[10px] text-gray-500 mt-1">{f.size}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : view === 'list' ? (
            /* 2. LIST VIEW */
            <div className="h-full overflow-y-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-8">
                      <button 
                        onClick={() => {
                          if (selectedFiles.size === filteredFiles.length) setSelectedFiles(new Set());
                          else setSelectedFiles(new Set(filteredFiles.map(f => f.name)));
                        }}
                        className="text-gray-400 hover:text-white"
                      >
                        {selectedFiles.size > 0 && selectedFiles.size === filteredFiles.length ? (
                          <CheckSquare className="w-3.5 h-3.5 text-blue-500" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </th>
                    <th className="py-2.5 px-3">Name</th>
                    <th className="py-2.5 px-3">Date Modified</th>
                    <th className="py-2.5 px-3">Size</th>
                    <th className="py-2.5 px-3">Kind</th>
                    <th className="py-2.5 px-3">Permissions</th>
                    <th className="py-2.5 px-3">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {filteredFiles.map((f, idx) => {
                    const isSelected = selectedFiles.has(f.name);
                    const tagInfo = MACOS_TAGS.find(t => t.id === f.tag);
                    return (
                      <tr
                        key={f.name}
                        onClick={(e) => handleSelectFile(f, idx, e)}
                        onDoubleClick={() => handleFileDoubleClick(f)}
                        onContextMenu={(e) => handleContextMenu(e, f)}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-blue-600/20 font-medium' : 'hover:bg-white/[0.03]'
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
                          {f.type === 'dir' ? (
                            <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                          )}
                          <span>{f.name}</span>
                          {tagInfo && (
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagInfo.color }} />
                          )}
                        </td>
                        <td className="py-2 px-3 text-gray-400">{f.modified}</td>
                        <td className="py-2 px-3 text-gray-400">{f.size}</td>
                        <td className="py-2 px-3 text-gray-400 capitalize">{f.type === 'dir' ? 'Folder' : f.extension || 'Document'}</td>
                        <td className="py-2 px-3 text-gray-500 font-mono">{f.permissions}</td>
                        <td className="py-2 px-3 text-purple-400">{f.owner}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : view === 'columns' ? (
            /* 3. MILLER COLUMNS VIEW (macOS Classic) */
            <div className="h-full flex divide-x divide-white/[0.08] overflow-x-auto">
              {/* Directory Items Column */}
              <div className="w-72 overflow-y-auto p-2 shrink-0 space-y-1">
                {filteredFiles.map((f, idx) => {
                  const isSelected = selectedFiles.has(f.name);
                  return (
                    <div
                      key={f.name}
                      onClick={(e) => handleSelectFile(f, idx, e)}
                      onDoubleClick={() => handleFileDoubleClick(f)}
                      className={`flex items-center justify-between px-3 py-1.5 rounded-xl cursor-pointer text-xs transition-colors ${
                        isSelected ? 'bg-blue-600 text-white font-medium shadow-sm' : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        {f.type === 'dir' ? (
                          <Folder className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-blue-400'}`} />
                        ) : (
                          <FileText className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-gray-400'}`} />
                        )}
                        <span className="truncate">{f.name}</span>
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
                    <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-white/10 flex items-center justify-center shadow-xl">
                      {selectedFileObj.type === 'dir' ? (
                        <Folder className="w-12 h-12 text-blue-400" />
                      ) : (
                        <FileText className="w-12 h-12 text-gray-300" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-base text-white break-words">{selectedFileObj.name}</h4>
                      <p className="text-xs text-gray-400 capitalize">{selectedFileObj.type === 'dir' ? 'Folder' : `${selectedFileObj.extension || 'File'} Document`}</p>
                    </div>

                    <div className="bg-[#11111a] border border-white/10 rounded-2xl p-4 text-xs space-y-2 text-left font-mono">
                      <div className="flex justify-between"><span className="text-gray-500">Size:</span><span className="text-gray-200">{selectedFileObj.size}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Permissions:</span><span className="text-gray-200">{selectedFileObj.permissions}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Owner:</span><span className="text-purple-400">{selectedFileObj.owner}</span></div>
                      <div className="flex justify-between"><span className="text-gray-500">Modified:</span><span className="text-gray-200">{selectedFileObj.modified}</span></div>
                    </div>

                    <div className="flex items-center justify-center space-x-2 pt-2">
                      {selectedFileObj.type === 'file' && (
                        <button
                          onClick={() => openFileTarget(selectedFileObj.name)}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg transition-colors"
                        >
                          Open in Editor
                        </button>
                      )}
                      <button
                        onClick={() => handleQuickLookToggle(selectedFileObj)}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition-colors"
                      >
                        Quick Look
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500 text-xs">Select an item to inspect details</div>
                )}
              </div>
            </div>
          ) : (
            /* 4. GALLERY VIEW (macOS CoverFlow) */
            <div className="h-full flex flex-col">
              {/* Hero Preview Pane */}
              <div className="flex-1 p-6 flex flex-col items-center justify-center bg-[#11111a]/50 border-b border-white/[0.08] overflow-hidden">
                {selectedFileObj ? (
                  <div className="text-center space-y-3 max-w-lg">
                    <div className="w-20 h-20 mx-auto rounded-3xl bg-blue-500/15 border border-white/10 flex items-center justify-center shadow-2xl">
                      {selectedFileObj.type === 'dir' ? (
                        <Folder className="w-10 h-10 text-blue-400" />
                      ) : (
                        <FileText className="w-10 h-10 text-gray-300" />
                      )}
                    </div>
                    <h3 className="font-bold text-lg text-white break-words">{selectedFileObj.name}</h3>
                    <div className="text-xs text-gray-400 font-mono">
                      {selectedFileObj.size} · {selectedFileObj.permissions} · Modified {selectedFileObj.modified}
                    </div>
                    <div className="flex justify-center space-x-2 pt-2">
                      <button
                        onClick={() => handleQuickLookToggle(selectedFileObj)}
                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow transition-colors"
                      >
                        Quick Look (Spacebar)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="text-gray-500 text-xs">No item selected</div>
                )}
              </div>

              {/* Horizontal Filmstrip Carousel */}
              <div className="h-28 bg-[#14141e] p-3 overflow-x-auto flex space-x-3 shrink-0 scrollbar-thin">
                {filteredFiles.map((f, idx) => {
                  const isSelected = selectedFiles.has(f.name);
                  return (
                    <div
                      key={f.name}
                      onClick={(e) => handleSelectFile(f, idx, e)}
                      onDoubleClick={() => handleFileDoubleClick(f)}
                      className={`flex flex-col items-center justify-center w-24 p-2 rounded-2xl cursor-pointer shrink-0 transition-all ${
                        isSelected ? 'bg-blue-600/30 border border-blue-500 ring-2 ring-blue-500/30 shadow-lg' : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      {f.type === 'dir' ? (
                        <Folder className="w-8 h-8 text-blue-400 mb-1" />
                      ) : (
                        <FileText className="w-8 h-8 text-gray-400 mb-1" />
                      )}
                      <span className="text-[11px] text-gray-200 truncate max-w-full font-medium">{f.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* macOS Bottom Path Bar & Status Bar */}
        <div className="h-7 bg-[#11111a] border-t border-white/[0.08] px-4 flex items-center justify-between text-xs text-gray-400 shrink-0 select-none">
          {/* Path Breadcrumbs */}
          <div className="flex items-center space-x-1.5 overflow-x-auto text-[11px] font-medium text-gray-300">
            <span 
              onClick={() => navigateTo('/')}
              className="hover:text-white cursor-pointer flex items-center space-x-1"
            >
              <HardDrive className="w-3 h-3 text-blue-400" />
              <span>Macintosh HD</span>
            </span>
            {breadcrumbs.map((part, index) => {
              const full = '/' + breadcrumbs.slice(0, index + 1).join('/');
              return (
                <React.Fragment key={full}>
                  <ChevronRight className="w-3 h-3 text-gray-600" />
                  <span 
                    onClick={() => navigateTo(full)}
                    className="hover:text-white cursor-pointer truncate max-w-[120px]"
                  >
                    {part}
                  </span>
                </React.Fragment>
              );
            })}
          </div>

          {/* Status info */}
          <div className="text-[11px] text-gray-500 flex items-center space-x-2">
            <span>{filteredFiles.length} items</span>
            <span>·</span>
            <span>Live SFTP Connected</span>
          </div>
        </div>
      </div>

      {/* macOS Quick Look Preview Modal (Spacebar) */}
      {quickLookFile && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150"
          onClick={() => setQuickLookFile(null)}
        >
          <div 
            className="bg-[#1e1e2e]/95 border border-white/20 rounded-3xl w-full max-w-2xl h-[520px] flex flex-col shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Quick Look Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#14141e]/80">
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => setQuickLookFile(null)}
                  className="w-3 h-3 rounded-full bg-[#FF5F56] hover:brightness-110 flex items-center justify-center text-[8px] text-black font-bold"
                >
                  ✕
                </button>
                <span className="text-xs font-semibold text-white pl-2">{quickLookFile.name}</span>
                <span className="text-[11px] text-gray-500">({quickLookFile.size})</span>
              </div>
              {quickLookFile.type === 'file' && (
                <button
                  onClick={() => {
                    openFileTarget(quickLookFile.name);
                    setQuickLookFile(null);
                  }}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium shadow-md transition-colors"
                >
                  Open in Code Editor
                </button>
              )}
            </div>

            {/* Quick Look Body */}
            <div className="flex-1 p-4 overflow-y-auto font-mono text-xs text-gray-300 bg-[#0f0f18]/60">
              {isLoadingQuickLook ? (
                <div className="h-full flex items-center justify-center space-x-2 text-gray-400">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Loading preview...</span>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-mono leading-relaxed select-text">
                  {quickLookContent}
                </pre>
              )}
            </div>

            {/* Quick Look Footer */}
            <div className="px-4 py-2 bg-[#14141e]/80 border-t border-white/10 flex justify-between text-[11px] text-gray-500">
              <span>Press Spacebar to dismiss</span>
              <span>{quickLookFile.permissions} · {quickLookFile.owner}</span>
            </div>
          </div>
        </div>
      )}

      {/* Right-Click Context Menu with macOS Tags & Actions */}
      {contextMenu && (
        <div 
          className="fixed z-50 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl py-1.5 w-56 text-xs select-none"
          style={{ top: Math.min(contextMenu.y, window.innerHeight - 320), left: Math.min(contextMenu.x, window.innerWidth - 240) }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.file ? (
            <>
              {contextMenu.file.type === 'file' ? (
                <div 
                  onClick={() => { openFileTarget(contextMenu.file!.name); setContextMenu(null); }}
                  className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Open in Code Editor</span>
                </div>
              ) : (
                <div 
                  onClick={() => { navigateTo(currentPath === '/' ? `/${contextMenu.file!.name}` : `${currentPath}/${contextMenu.file!.name}`); setContextMenu(null); }}
                  className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium"
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span>Open Folder</span>
                </div>
              )}

              <div 
                onClick={() => { handleQuickLookToggle(contextMenu.file); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Quick Look (Spacebar)</span>
              </div>

              {/* Tags Palette */}
              <div className="px-3.5 py-1.5 flex items-center space-x-1.5 border-t border-b border-white/10 my-1">
                <Tag className="w-3.5 h-3.5 text-gray-400 mr-1" />
                {MACOS_TAGS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => handleAssignTag(contextMenu.file!.name, t.id)}
                    className="w-3.5 h-3.5 rounded-full hover:scale-125 transition-transform"
                    style={{ backgroundColor: t.color }}
                    title={t.name}
                  />
                ))}
              </div>

              <div 
                onClick={() => { handleDuplicate(); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Duplicate (Ctrl+D)</span>
              </div>

              <div 
                onClick={() => { handleCopy(); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy (Ctrl+C)</span>
              </div>

              <div 
                onClick={() => { handleCut(); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>Cut (Ctrl+X)</span>
              </div>

              <div 
                onClick={() => {
                  setRenameTarget(contextMenu.file!.name);
                  setRenameNewName(contextMenu.file!.name);
                  setShowRenameModal(true);
                  setContextMenu(null);
                }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Rename... (Enter)</span>
              </div>

              <div 
                onClick={() => {
                  setChmodTarget(contextMenu.file!);
                  setShowChmodModal(true);
                  setContextMenu(null);
                }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Permissions (chmod)...</span>
              </div>

              <div 
                onClick={() => {
                  setChownTarget(contextMenu.file!);
                  setChownOwner(contextMenu.file!.owner || 'root');
                  setShowChownModal(true);
                  setContextMenu(null);
                }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Change Ownership (chown)...</span>
              </div>

              <div className="my-1 border-t border-white/10" />

              <div 
                onClick={() => { handleDeleteSelected(); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-red-600/20 text-red-400 flex items-center space-x-2 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Move to Trash</span>
              </div>
            </>
          ) : (
            <>
              <div 
                onClick={() => { setShowNewFolder(true); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Folder (Ctrl+N)</span>
              </div>
              <div 
                onClick={() => { setShowNewFile(true); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>New Text File</span>
              </div>
              {clipboard && (
                <div 
                  onClick={() => { handlePaste(); setContextMenu(null); }}
                  className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>Paste (Ctrl+V)</span>
                </div>
              )}
              <div 
                onClick={() => { openApp('terminal', 'Terminal'); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>Open Terminal Here</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form 
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newFolderName.trim()) return;
              const target = currentPath === '/' ? `/${newFolderName.trim()}` : `${currentPath}/${newFolderName.trim()}`;
              try {
                await sftpMkdir(activeConnId, target);
                setShowNewFolder(false);
                setNewFolderName('');
                await loadDirectory(currentPath);
              } catch (err: any) {
                alert(`Create folder failed: ${err?.message || err}`);
              }
            }} 
            className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl"
          >
            <h3 className="font-bold text-base text-white flex items-center space-x-2">
              <Folder className="w-5 h-5 text-blue-400" />
              <span>New Folder</span>
            </h3>
            <input
              type="text"
              autoFocus
              required
              placeholder="Folder Name"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewFolder(false)}
                className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New File Modal */}
      {showNewFile && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form 
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newFileName.trim()) return;
              const target = currentPath === '/' ? `/${newFileName.trim()}` : `${currentPath}/${newFileName.trim()}`;
              try {
                await sftpWriteTextFile(activeConnId, target, '');
                setShowNewFile(false);
                setNewFileName('');
                await loadDirectory(currentPath);
              } catch (err: any) {
                alert(`Create file failed: ${err?.message || err}`);
              }
            }} 
            className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl"
          >
            <h3 className="font-bold text-base text-white flex items-center space-x-2">
              <FileText className="w-5 h-5 text-emerald-400" />
              <span>New File</span>
            </h3>
            <input
              type="text"
              autoFocus
              required
              placeholder="e.g. script.sh, index.html"
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono"
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewFile(false)}
                className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md"
              >
                Create File
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form 
            onSubmit={async (e) => {
              e.preventDefault();
              if (!renameNewName.trim() || renameNewName === renameTarget) {
                setShowRenameModal(false);
                return;
              }
              const oldPath = currentPath === '/' ? `/${renameTarget}` : `${currentPath}/${renameTarget}`;
              const newPath = currentPath === '/' ? `/${renameNewName.trim()}` : `${currentPath}/${renameNewName.trim()}`;
              try {
                await sftpRename(activeConnId, oldPath, newPath);
                setShowRenameModal(false);
                await loadDirectory(currentPath);
              } catch (err: any) {
                alert(`Rename failed: ${err?.message || err}`);
              }
            }} 
            className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl"
          >
            <h3 className="font-bold text-base text-white flex items-center space-x-2">
              <Edit3 className="w-5 h-5 text-purple-400" />
              <span>Rename Item</span>
            </h3>
            <input
              type="text"
              autoFocus
              required
              value={renameNewName}
              onChange={e => setRenameNewName(e.target.value)}
              className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowRenameModal(false)}
                className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md"
              >
                Rename
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Permissions (chmod) Modal */}
      {showChmodModal && chmodTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form 
            onSubmit={async (e) => {
              e.preventDefault();
              const modeNum = parseInt(octalMode, 8);
              if (isNaN(modeNum)) return;
              const targetPath = currentPath === '/' ? `/${chmodTarget.name}` : `${currentPath}/${chmodTarget.name}`;
              try {
                await sftpChmod(activeConnId, targetPath, modeNum);
                setShowChmodModal(false);
                setChmodTarget(null);
                await loadDirectory(currentPath);
              } catch (err: any) {
                alert(`chmod failed: ${err?.message || err}`);
              }
            }} 
            className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl"
          >
            <h3 className="font-bold text-base text-white flex items-center space-x-2">
              <Key className="w-5 h-5 text-amber-400" />
              <span>Modify Permissions (chmod)</span>
            </h3>
            <p className="text-xs text-gray-400 font-mono truncate">{chmodTarget.name}</p>
            <div className="bg-[#11111b] p-3 rounded-2xl border border-white/10 space-y-2">
              <label className="text-[11px] text-gray-400 block font-medium">Octal Mode (e.g. 755, 644, 777)</label>
              <input
                type="text"
                autoFocus
                required
                maxLength={4}
                value={octalMode}
                onChange={e => setOctalMode(e.target.value)}
                className="w-full bg-[#1e1e2e] border border-white/20 rounded-xl px-3 py-1.5 text-base font-mono text-center text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowChmodModal(false); setChmodTarget(null); }}
                className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md"
              >
                Apply chmod
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Permissions (chown) Modal */}
      {showChownModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form 
            onSubmit={async (e) => {
              e.preventDefault();
              const items = chownTarget ? [chownTarget.name] : Array.from(selectedFiles);
              if (items.length === 0) return;
              try {
                for (const name of items) {
                  const targetPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
                  await sftpChown(activeConnId, targetPath, chownOwner.trim(), chownGroup.trim());
                }
                setShowChownModal(false);
                setChownTarget(null);
                await loadDirectory(currentPath);
              } catch (err: any) {
                alert(`chown failed: ${err?.message || err}`);
              }
            }} 
            className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl"
          >
            <h3 className="font-bold text-base text-white flex items-center space-x-2">
              <Users className="w-5 h-5 text-purple-400" />
              <span>Change Ownership (chown)</span>
            </h3>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-gray-400 block mb-1 font-medium">New Owner (User)</label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. root, deploy, www-data"
                  value={chownOwner}
                  onChange={e => setChownOwner(e.target.value)}
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-400 block mb-1 font-medium">New Group</label>
                <input
                  type="text"
                  placeholder="e.g. root, deploy, www-data, docker"
                  value={chownGroup}
                  onChange={e => setChownGroup(e.target.value)}
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowChownModal(false); setChownTarget(null); }}
                className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md"
              >
                Apply chown
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
