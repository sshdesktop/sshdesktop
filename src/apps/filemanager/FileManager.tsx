import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Folder, FileText, ArrowLeft, ArrowRight, ArrowUp, 
  Grid, List, Search, Plus, Trash2, ChevronRight, RefreshCw, 
  Copy, Scissors, ClipboardPaste, FileCode, CheckSquare, Square,
  Upload, Terminal, Edit3, Key, Archive, PackageOpen, Star, BookmarkPlus,
  Compass, HardDrive, ShieldAlert, X, Users
} from 'lucide-react';
import { sftpListDir, sftpMkdir, sftpDelete, sftpRename, sftpChmod, sftpChown, sftpWriteTextFile, sshExec } from '../../lib/tauri-bridge';
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

export default function FileManager() {
  const [currentPath, setCurrentPath] = useState('/');
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('/');
  const [history, setHistory] = useState<string[]>(['/']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  // Chown Modal State
  const [showChownModal, setShowChownModal] = useState(false);
  const [chownTarget, setChownTarget] = useState<RemoteFile | null>(null);
  const [chownOwner, setChownOwner] = useState('root');
  const [chownGroup, setChownGroup] = useState('root');
  const [chownRecursive, setChownRecursive] = useState(true);

  // Drag and drop moving between folders
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
  const longPressTimerRef = useRef<any>(null);
  const [search, setSearch] = useState('');

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });
  const currentUsername = activeServer?.username || 'root';
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
          extension: item.name.includes('.') ? item.name.split('.').pop()?.toLowerCase() : undefined
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
  }, [activeConnId]);

  useEffect(() => {
    loadDirectory(currentPath);
    setPathInput(currentPath);
  }, [currentPath, loadDirectory]);

  // Close context menu on outside click
  useEffect(() => {
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  const navigateTo = (path: string) => {
    const clean = path.replace(/\/+/g, '/') || '/';
    setCurrentPath(clean);
    setPathInput(clean);
    setIsEditingPath(false);
    setSelectedFiles(new Set());
    setLastSelectedIndex(null);
    const nextHist = history.slice(0, historyIndex + 1);
    setHistory([...nextHist, clean]);
    setHistoryIndex(nextHist.length);
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pathInput.trim()) return;
    navigateTo(pathInput.trim());
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setCurrentPath(prev);
      setPathInput(prev);
      setSelectedFiles(new Set());
      setHistoryIndex(historyIndex - 1);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setCurrentPath(next);
      setPathInput(next);
      setSelectedFiles(new Set());
      setHistoryIndex(historyIndex + 1);
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

  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));

  // Multi-selection handler
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

  // Context Menu opener
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
      isCanvas: !file
    });
  };

  // Create Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const newPath = currentPath === '/' ? `/${newFolderName.trim()}` : `${currentPath}/${newFolderName.trim()}`;
    try {
      await sftpMkdir(activeConnId, newPath);
      setShowNewFolder(false);
      setNewFolderName('');
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Failed to create directory: ${err?.message || err}`);
    }
  };

  // Create File
  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim()) return;
    const newPath = currentPath === '/' ? `/${newFileName.trim()}` : `${currentPath}/${newFileName.trim()}`;
    try {
      await sftpWriteTextFile(activeConnId, newPath, '');
      setShowNewFile(false);
      setNewFileName('');
      await loadDirectory(currentPath);
      openFileTarget(newFileName.trim());
    } catch (err: any) {
      alert(`Failed to create file: ${err?.message || err}`);
    }
  };

  // Rename
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameNewName.trim() || !renameTarget) return;
    const oldPath = currentPath === '/' ? `/${renameTarget}` : `${currentPath}/${renameTarget}`;
    const newPath = currentPath === '/' ? `/${renameNewName.trim()}` : `${currentPath}/${renameNewName.trim()}`;
    try {
      await sftpRename(activeConnId, oldPath, newPath);
      setShowRenameModal(false);
      setRenameTarget('');
      setRenameNewName('');
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Rename failed: ${err?.message || err}`);
    }
  };

  // Chmod
  const handleChmod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chmodTarget) return;
    const targetPath = currentPath === '/' ? `/${chmodTarget.name}` : `${currentPath}/${chmodTarget.name}`;
    const mode = parseInt(octalMode, 8);
    try {
      await sftpChmod(activeConnId, targetPath, mode);
      setShowChmodModal(false);
      setChmodTarget(null);
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Chmod failed: ${err?.message || err}`);
    }
  };

  // Chown (Change Ownership)
  const handleChown = async (e: React.FormEvent) => {
    e.preventDefault();
    const targets = chownTarget 
      ? [chownTarget.name] 
      : Array.from(selectedFiles);
    if (targets.length === 0) return;
    setIsLoading(true);
    try {
      for (const name of targets) {
        const targetPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        await sftpChown(activeConnId, targetPath, chownOwner.trim(), chownGroup.trim());
      }
      setShowChownModal(false);
      setChownTarget(null);
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Chown failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Move files/folders into a folder via Drag & Drop
  const handleMoveItemsToFolder = async (targetFolderName: string) => {
    const targetDirPath = currentPath === '/' ? `/${targetFolderName}` : `${currentPath}/${targetFolderName}`;
    const itemsToMove = (draggedItem && selectedFiles.has(draggedItem) && selectedFiles.size > 1)
      ? Array.from(selectedFiles)
      : draggedItem ? [draggedItem] : [];

    if (itemsToMove.length === 0) return;
    if (itemsToMove.includes(targetFolderName)) return;

    setIsLoading(true);
    try {
      for (const name of itemsToMove) {
        const oldPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        const newPath = `${targetDirPath}/${name}`;
        await sftpRename(activeConnId, oldPath, newPath);
      }
      setSelectedFiles(new Set());
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Move failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
      setDraggedItem(null);
      setDropTargetDir(null);
    }
  };

  // Long press selection helper
  const handlePointerDown = (f: RemoteFile) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      setSelectedFiles(prev => {
        const next = new Set(prev);
        if (next.has(f.name)) next.delete(f.name);
        else next.add(f.name);
        return next;
      });
    }, 400);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // Delete Selection
  const handleDeleteSelected = async () => {
    if (selectedFiles.size === 0) return;
    const items = Array.from(selectedFiles);
    const confirmMsg = items.length === 1 
      ? `Are you sure you want to permanently delete '${items[0]}' from the server?`
      : `Are you sure you want to permanently delete ${items.length} selected items?`;
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

  // Copy / Cut / Paste
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

  // Archive Extract
  const handleExtractArchive = async (fileName: string) => {
    const fullPath = currentPath === '/' ? `/${fileName}` : `${currentPath}/${fileName}`;
    setIsLoading(true);
    try {
      let cmd = '';
      if (fileName.endsWith('.tar.gz') || fileName.endsWith('.tgz')) {
        cmd = `tar -xzf '${fullPath}' -C '${currentPath}'`;
      } else if (fileName.endsWith('.tar')) {
        cmd = `tar -xf '${fullPath}' -C '${currentPath}'`;
      } else if (fileName.endsWith('.zip')) {
        cmd = `unzip -o '${fullPath}' -d '${currentPath}'`;
      } else {
        alert('Supported archive types: .tar.gz, .tgz, .tar, .zip');
        setIsLoading(false);
        return;
      }
      await sshExec(activeConnId, cmd);
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Extraction failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Archive Compress
  const handleCompressSelected = async () => {
    if (selectedFiles.size === 0) return;
    const names = Array.from(selectedFiles);
    const archiveName = `${names[0]}.tar.gz`;
    const fullArchivePath = currentPath === '/' ? `/${archiveName}` : `${currentPath}/${archiveName}`;
    const quotedItems = names.map(n => `'${n}'`).join(' ');
    setIsLoading(true);
    try {
      const cmd = `cd '${currentPath}' && tar -czf '${fullArchivePath}' ${quotedItems}`;
      await sshExec(activeConnId, cmd);
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Compression failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Drag and Drop from local desktop
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (!e.dataTransfer.files || e.dataTransfer.files.length === 0) return;

    const dropped = Array.from(e.dataTransfer.files);
    setIsLoading(true);
    try {
      for (const file of dropped) {
        const targetPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        const text = await file.text();
        await sftpWriteTextFile(activeConnId, targetPath, text);
      }
      await loadDirectory(currentPath);
    } catch (err: any) {
      alert(`Drop upload failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  const quickPlaces = [
    { label: 'Root (/)' , path: '/', icon: HardDrive },
    { label: 'User Home', path: currentUsername === 'root' ? '/root' : `/home/${currentUsername}`, icon: Folder },
    { label: 'Desktop', path: currentUsername === 'root' ? '/root/Desktop' : `/home/${currentUsername}/Desktop`, icon: Compass },
    { label: 'Config (/etc)', path: '/etc', icon: Folder },
    { label: 'Logs (/var/log)', path: '/var/log', icon: Folder },
    { label: 'Temporary (/tmp)', path: '/tmp', icon: Folder },
  ];

  return (
    <div 
      className="flex h-full bg-[#181825] text-[#cdd6f4] select-none"
      onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      {/* Left Sidebar: Places & Favorites (macOS Finder style) */}
      <div className="w-56 bg-[#1e1e2e]/90 border-r border-white/[0.08] flex flex-col shrink-0 select-none py-3 px-2 text-xs">
        <div className="text-[10px] font-bold text-gray-500 uppercase px-3 mb-2 tracking-wider">
          Places
        </div>
        <div className="space-y-0.5 mb-4">
          {quickPlaces.map(p => {
            const Icon = p.icon;
            const isCurrent = currentPath === p.path;
            return (
              <button
                key={p.path}
                onClick={() => navigateTo(p.path)}
                className={`w-full flex items-center space-x-2 px-3 py-1.5 rounded-lg text-left transition-colors ${
                  isCurrent ? 'bg-[var(--accent)] text-white font-medium shadow-sm' : 'text-gray-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isCurrent ? 'text-white' : 'text-blue-400'}`} />
                <span className="truncate">{p.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-[10px] font-bold text-gray-500 uppercase px-3 mb-2 tracking-wider">
          <span>Favorites</span>
          <button 
            onClick={() => addFavorite(currentPath)} 
            className="hover:text-white"
            title="Bookmark Current Location"
          >
            <BookmarkPlus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-0.5 flex-1 overflow-y-auto">
          {favorites.map(fav => (
            <div
              key={fav}
              className={`group flex items-center justify-between px-3 py-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                currentPath === fav ? 'bg-[var(--accent)]/20 text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
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
                title="Remove Favorite"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main File Manager Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Navigation & Editable Address Bar */}
        <div className="flex items-center justify-between bg-[#1e1e2e] border-b border-white/[0.08] px-4 py-2 shrink-0">
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            {/* Back / Forward / Up controls */}
            <div className="flex items-center space-x-1 pr-2 border-r border-white/10 shrink-0">
              <button
                onClick={goBack}
                disabled={historyIndex === 0}
                className="p-1 rounded hover:bg-white/10 disabled:opacity-30 text-gray-300"
                title="Back"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <button
                onClick={goForward}
                disabled={historyIndex >= history.length - 1}
                className="p-1 rounded hover:bg-white/10 disabled:opacity-30 text-gray-300"
                title="Forward"
              >
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={goUp}
                disabled={currentPath === '/'}
                className="p-1 rounded hover:bg-white/10 disabled:opacity-30 text-gray-300"
                title="Parent Directory"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            </div>

            {/* Click-to-Edit Address Bar */}
            <div className="flex-1 max-w-xl">
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
                    placeholder="/path/to/directory"
                    className="w-full bg-[#11111b] border border-[var(--accent)] rounded-lg px-2.5 py-1 text-xs font-mono text-white focus:outline-none shadow-inner"
                  />
                </form>
              ) : (
                <div 
                  onClick={() => setIsEditingPath(true)}
                  className="flex items-center bg-[#11111b] hover:border-white/20 border border-white/10 rounded-lg px-2.5 py-1 text-xs font-mono flex-1 overflow-x-auto space-x-1 scrollbar-none cursor-text group"
                  title="Click to edit path directly"
                >
                  <span
                    onClick={(e) => { e.stopPropagation(); navigateTo('/'); }}
                    className="text-gray-400 hover:text-white cursor-pointer px-1 py-0.5 rounded hover:bg-white/5 shrink-0"
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
                          className="text-gray-300 hover:text-white cursor-pointer px-1 py-0.5 rounded hover:bg-white/5 whitespace-nowrap"
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

          {/* Toolbar Action Buttons */}
          <div className="flex items-center space-x-1.5 pl-3 shrink-0">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#11111b] border border-white/10 rounded-lg pl-7 pr-2 py-1 text-xs text-gray-200 focus:outline-none w-28 focus:w-40 transition-all"
              />
            </div>

            <div className="w-px h-5 bg-white/10 mx-1" />

            {/* Create File / Folder */}
            <button
              onClick={() => setShowNewFile(true)}
              className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-emerald-400 flex items-center space-x-1 text-xs"
              title="Create New File"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>File</span>
            </button>
            <button
              onClick={() => setShowNewFolder(true)}
              className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-blue-400 flex items-center space-x-1 text-xs"
              title="Create New Folder"
            >
              <Folder className="w-3.5 h-3.5" />
              <span>Folder</span>
            </button>

            <div className="w-px h-5 bg-white/10 mx-1" />

            {/* Clipboard Actions */}
            <button
              onClick={handleCopy}
              disabled={selectedFiles.size === 0}
              className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-white disabled:opacity-30"
              title="Copy Selection (Ctrl+C)"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleCut}
              disabled={selectedFiles.size === 0}
              className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-white disabled:opacity-30"
              title="Cut Selection (Ctrl+X)"
            >
              <Scissors className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handlePaste}
              disabled={!clipboard}
              className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-white disabled:opacity-30 relative"
              title={`Paste ${clipboard ? `(${clipboard.files.length} items)` : ''}`}
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              {clipboard && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-blue-500" />
              )}
            </button>
            <button
              onClick={handleDeleteSelected}
              disabled={selectedFiles.size === 0}
              className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-rose-400 disabled:opacity-30"
              title="Delete Selected Items"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            <div className="w-px h-5 bg-white/10 mx-1" />

            {/* Refresh */}
            <button
              onClick={() => loadDirectory(currentPath)}
              disabled={isLoading}
              className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-white"
              title="Refresh Directory"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            </button>

            {/* View Toggle */}
            <div className="flex items-center bg-[#11111b] p-0.5 rounded-lg border border-white/10">
              <button
                onClick={() => setView('grid')}
                className={`p-1 rounded ${view === 'grid' ? 'bg-[var(--accent)] text-white' : 'text-gray-400'}`}
                title="Grid View"
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setView('list')}
                className={`p-1 rounded ${view === 'list' ? 'bg-[var(--accent)] text-white' : 'text-gray-400'}`}
                title="List View"
              >
                <List className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Main File Browser Canvas with Drag & Drop Overlay */}
        <div className="flex-1 overflow-y-auto p-4 relative min-h-0">
          {isDraggingOver && (
            <div className="absolute inset-0 bg-blue-500/20 backdrop-blur-sm border-2 border-dashed border-blue-400 rounded-xl z-20 flex flex-col items-center justify-center pointer-events-none">
              <Upload className="w-12 h-12 text-blue-300 animate-bounce mb-2" />
              <span className="text-sm font-bold text-white">Drop files to upload to {currentPath}</span>
            </div>
          )}

          {isLoading && files.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-gray-400 space-x-2">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
              <span>Listing live files over SFTP...</span>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 py-16 space-y-2">
              <Folder className="w-12 h-12 opacity-30" />
              <span className="text-xs">This directory is empty</span>
            </div>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {filteredFiles.map((f, idx) => {
                const isSelected = selectedFiles.has(f.name);
                const isArchive = ['tar', 'gz', 'tgz', 'zip'].includes(f.extension || '');
                const isDropTarget = dropTargetDir === f.name && f.type === 'dir';
                return (
                  <div
                    key={f.name}
                    draggable={true}
                    onDragStart={(e) => {
                      setDraggedItem(f.name);
                      const fullPath = currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`;
                      e.dataTransfer.setData('text/plain', fullPath);
                      e.dataTransfer.setData('application/clouddesk-file', fullPath);
                      e.dataTransfer.setData('application/clouddesk-name', f.name);
                    }}
                    onDragEnd={() => { setDraggedItem(null); setDropTargetDir(null); }}
                    onDragOver={(e) => {
                      if (f.type === 'dir' && draggedItem && draggedItem !== f.name) {
                        e.preventDefault();
                        e.stopPropagation();
                        setDropTargetDir(f.name);
                      }
                    }}
                    onDragLeave={() => {
                      if (dropTargetDir === f.name) setDropTargetDir(null);
                    }}
                    onDrop={(e) => {
                      if (f.type === 'dir' && draggedItem && draggedItem !== f.name) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleMoveItemsToFolder(f.name);
                      }
                    }}
                    onMouseDown={() => handlePointerDown(f)}
                    onMouseUp={cancelLongPress}
                    onMouseMove={cancelLongPress}
                    onTouchStart={() => handlePointerDown(f)}
                    onTouchEnd={cancelLongPress}
                    onClick={(e) => handleSelectFile(f, idx, e)}
                    onDoubleClick={() => handleFileDoubleClick(f)}
                    onContextMenu={(e) => handleContextMenu(e, f)}
                    className={`flex flex-col items-center p-3 rounded-xl cursor-pointer select-none transition-all group relative ${
                      isDropTarget
                        ? 'bg-blue-500/30 ring-2 ring-[var(--accent)] scale-105 shadow-xl'
                        : isSelected
                        ? 'bg-[var(--accent)]/20 border border-[var(--accent)]/50 shadow-md'
                        : 'hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    {f.type === 'dir' ? (
                      <Folder className="w-12 h-12 text-blue-400 fill-blue-500/20 mb-2 transition-transform group-hover:scale-105" />
                    ) : isArchive ? (
                      <Archive className="w-12 h-12 text-amber-400 mb-2 transition-transform group-hover:scale-105" />
                    ) : (
                      <FileText className="w-12 h-12 text-gray-400 mb-2 transition-transform group-hover:scale-105" />
                    )}
                    <span className="text-xs text-center text-gray-200 break-all line-clamp-2 max-w-full font-medium">
                      {f.name}
                    </span>
                    <span className="text-[10px] text-gray-500 mt-1">{f.size}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10">
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
                          <CheckSquare className="w-3.5 h-3.5 text-[var(--accent)]" />
                        ) : (
                          <Square className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </th>
                    <th className="py-2.5 px-3">Name</th>
                    <th className="py-2.5 px-3">Size</th>
                    <th className="py-2.5 px-3">Permissions</th>
                    <th className="py-2.5 px-3">Owner</th>
                    <th className="py-2.5 px-3">Modified</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {filteredFiles.map((f, idx) => {
                    const isSelected = selectedFiles.has(f.name);
                    const isArchive = ['tar', 'gz', 'tgz', 'zip'].includes(f.extension || '');
                    const isDropTarget = dropTargetDir === f.name && f.type === 'dir';
                    return (
                      <tr
                        key={f.name}
                        draggable={true}
                        onDragStart={(e) => {
                          setDraggedItem(f.name);
                          const fullPath = currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`;
                          e.dataTransfer.setData('text/plain', fullPath);
                          e.dataTransfer.setData('application/clouddesk-file', fullPath);
                          e.dataTransfer.setData('application/clouddesk-name', f.name);
                        }}
                        onDragEnd={() => { setDraggedItem(null); setDropTargetDir(null); }}
                        onDragOver={(e) => {
                          if (f.type === 'dir' && draggedItem && draggedItem !== f.name) {
                            e.preventDefault();
                            e.stopPropagation();
                            setDropTargetDir(f.name);
                          }
                        }}
                        onDragLeave={() => {
                          if (dropTargetDir === f.name) setDropTargetDir(null);
                        }}
                        onDrop={(e) => {
                          if (f.type === 'dir' && draggedItem && draggedItem !== f.name) {
                            e.preventDefault();
                            e.stopPropagation();
                            handleMoveItemsToFolder(f.name);
                          }
                        }}
                        onMouseDown={() => handlePointerDown(f)}
                        onMouseUp={cancelLongPress}
                        onMouseMove={cancelLongPress}
                        onTouchStart={() => handlePointerDown(f)}
                        onTouchEnd={cancelLongPress}
                        onClick={(e) => handleSelectFile(f, idx, e)}
                        onDoubleClick={() => handleFileDoubleClick(f)}
                        onContextMenu={(e) => handleContextMenu(e, f)}
                        className={`cursor-pointer transition-colors ${
                          isDropTarget
                            ? 'bg-blue-500/30 ring-2 ring-[var(--accent)] font-semibold'
                            : isSelected
                            ? 'bg-[var(--accent)]/15 font-medium'
                            : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <td className="py-2 px-3">
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleSelectFile(f, idx, e); }}
                            className="text-gray-500 hover:text-white"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-3.5 h-3.5 text-[var(--accent)]" />
                            ) : (
                              <Square className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </td>
                        <td className="py-2 px-3 font-medium text-white flex items-center space-x-2">
                          {f.type === 'dir' ? (
                            <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                          ) : isArchive ? (
                            <Archive className="w-4 h-4 text-amber-400 shrink-0" />
                          ) : (
                            <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                          )}
                          <span>{f.name}</span>
                        </td>
                        <td className="py-2 px-3 text-gray-400">{f.size}</td>
                        <td className="py-2 px-3 text-gray-500 font-mono">{f.permissions}</td>
                        <td className="py-2 px-3 text-purple-400">{f.owner}</td>
                        <td className="py-2 px-3 text-gray-500">{f.modified}</td>
                        <td className="py-2 px-3 text-right space-x-1">
                          {f.type === 'file' && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openFileTarget(f.name);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-emerald-400"
                              title="Open in Code Editor"
                            >
                              <FileCode className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setChmodTarget(f);
                              setShowChmodModal(true);
                            }}
                            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-amber-400"
                            title="Permissions (chmod)"
                          >
                            <Key className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setChownTarget(f);
                              setShowChownModal(true);
                            }}
                            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-purple-400"
                            title="Ownership (chown)"
                          >
                            <Users className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Floating Selection Bar */}
        {selectedFiles.size > 0 && (
          <div className="bg-[#1e1e2e] border-t border-white/10 px-4 py-2 flex items-center justify-between text-xs shrink-0">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-white">{selectedFiles.size} items selected</span>
              <button 
                onClick={() => setSelectedFiles(new Set())}
                className="text-gray-400 hover:text-white underline text-[11px]"
              >
                Clear
              </button>
            </div>
            <div className="flex items-center space-x-2">
              {selectedFiles.size === 1 && (
                <button
                  onClick={() => {
                    const name = Array.from(selectedFiles)[0];
                    const f = files.find(item => item.name === name);
                    if (f && f.type === 'file') openFileTarget(name);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 flex items-center space-x-1"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Open in Editor</span>
                </button>
              )}
              {selectedFiles.size > 0 && (
                <button
                  onClick={handleCompressSelected}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 flex items-center space-x-1"
                  title="Compress into .tar.gz"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Compress</span>
                </button>
              )}
              <button
                onClick={() => {
                  setChownTarget(null);
                  setShowChownModal(true);
                }}
                className="px-2.5 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 flex items-center space-x-1"
                title="Change Ownership (chown)"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Chown</span>
              </button>
              <button
                onClick={handleCopy}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200 flex items-center space-x-1"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </button>
              <button
                onClick={handleCut}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-200 flex items-center space-x-1"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>Cut</span>
              </button>
              <button
                onClick={handleDeleteSelected}
                className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 flex items-center space-x-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        )}

        {/* Status Bar */}
        <div className="h-6 bg-[#11111b] border-t border-white/[0.08] px-4 flex items-center justify-between text-xs text-gray-400 shrink-0 select-none">
          <span>{files.length} items ({currentPath})</span>
          <span className="text-[11px] font-mono">Live SFTP · Permissions & Archive Control</span>
        </div>
      </div>

      {/* Rich Right-Click Context Menu */}
      {contextMenu && (
        <div 
          className="fixed z-50 bg-[#1e1e2e]/95 backdrop-blur-xl border border-white/15 rounded-xl shadow-2xl py-1.5 w-52 text-xs select-none"
          style={{ top: Math.min(contextMenu.y, window.innerHeight - 280), left: Math.min(contextMenu.x, window.innerWidth - 220) }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.file ? (
            <>
              {contextMenu.file.type === 'file' ? (
                <div 
                  onClick={() => { openFileTarget(contextMenu.file!.name); setContextMenu(null); }}
                  className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer font-medium"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Open in Code Editor</span>
                </div>
              ) : (
                <div 
                  onClick={() => { navigateTo(currentPath === '/' ? `/${contextMenu.file!.name}` : `${currentPath}/${contextMenu.file!.name}`); setContextMenu(null); }}
                  className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer font-medium"
                >
                  <Folder className="w-3.5 h-3.5" />
                  <span>Open Folder</span>
                </div>
              )}

              {['tar', 'gz', 'tgz', 'zip'].includes(contextMenu.file.extension || '') && (
                <div 
                  onClick={() => { handleExtractArchive(contextMenu.file!.name); setContextMenu(null); }}
                  className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer text-amber-400 hover:text-black"
                >
                  <PackageOpen className="w-3.5 h-3.5" />
                  <span>Extract Archive Here</span>
                </div>
              )}

              <div 
                onClick={() => {
                  const full = currentPath === '/' ? `/${contextMenu.file!.name}` : `${currentPath}/${contextMenu.file!.name}`;
                  navigator.clipboard.writeText(full);
                  setContextMenu(null);
                }}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Path</span>
              </div>

              <div 
                onClick={() => { handleCopy(); setContextMenu(null); }}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </div>

              <div 
                onClick={() => { handleCut(); setContextMenu(null); }}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
              >
                <Scissors className="w-3.5 h-3.5" />
                <span>Cut</span>
              </div>

              <div 
                onClick={() => {
                  setRenameTarget(contextMenu.file!.name);
                  setRenameNewName(contextMenu.file!.name);
                  setShowRenameModal(true);
                  setContextMenu(null);
                }}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Rename...</span>
              </div>

              <div 
                onClick={() => {
                  setChmodTarget(contextMenu.file!);
                  setShowChmodModal(true);
                  setContextMenu(null);
                }}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
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
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Change Ownership (chown)...</span>
              </div>

              <div className="my-1 border-t border-white/10" />

              <div 
                onClick={() => { handleDeleteSelected(); setContextMenu(null); }}
                className="px-3 py-1.5 hover:bg-rose-500/20 text-rose-400 flex items-center space-x-2 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </div>
            </>
          ) : (
            <>
              <div 
                onClick={() => { setShowNewFile(true); setContextMenu(null); }}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New File</span>
              </div>
              <div 
                onClick={() => { setShowNewFolder(true); setContextMenu(null); }}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>New Directory</span>
              </div>
              {clipboard && (
                <div 
                  onClick={() => { handlePaste(); setContextMenu(null); }}
                  className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>Paste ({clipboard.files.length} items)</span>
                </div>
              )}
              <div 
                onClick={() => { openApp('terminal', 'Terminal'); setContextMenu(null); }}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Open Terminal Here</span>
              </div>
              <div 
                onClick={() => { addFavorite(currentPath); setContextMenu(null); }}
                className="px-3 py-1.5 hover:bg-[var(--accent)] hover:text-black flex items-center space-x-2 cursor-pointer"
              >
                <Star className="w-3.5 h-3.5" />
                <span>Bookmark Location</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Permissions (chmod) Modal */}
      {showChmodModal && chmodTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form onSubmit={handleChmod} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-sm text-white flex items-center space-x-2">
              <Key className="w-4 h-4 text-amber-400" />
              <span>Modify Permissions (chmod)</span>
            </h3>
            <p className="text-xs text-gray-400 font-mono truncate">{chmodTarget.name}</p>

            <div className="bg-[#11111b] p-3 rounded-xl border border-white/10 space-y-2">
              <label className="text-[11px] text-gray-400 block font-medium">Octal Mode (e.g. 755, 644, 777)</label>
              <input
                type="text"
                autoFocus
                required
                maxLength={4}
                value={octalMode}
                onChange={e => setOctalMode(e.target.value)}
                className="w-full bg-[#1e1e2e] border border-white/20 rounded-lg px-3 py-1.5 text-base font-mono text-center text-white focus:outline-none focus:border-[var(--accent)]"
              />
              <div className="text-[10px] text-gray-500 text-center">
                755: rwxr-xr-x · 644: rw-r--r-- · 777: rwxrwxrwx
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowChmodModal(false); setChmodTarget(null); }}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg text-xs bg-[var(--accent)] hover:bg-blue-600 text-white font-medium"
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
          <form onSubmit={handleChown} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-sm text-white flex items-center space-x-2">
              <Users className="w-4 h-4 text-purple-400" />
              <span>Change Ownership (chown)</span>
            </h3>
            <p className="text-xs text-gray-400 font-mono truncate">
              {chownTarget ? chownTarget.name : `${selectedFiles.size} selected items`}
            </p>

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
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[var(--accent)] font-mono"
                />
              </div>

              <div>
                <label className="text-[11px] text-gray-400 block mb-1 font-medium">New Group</label>
                <input
                  type="text"
                  placeholder="e.g. root, deploy, www-data, docker"
                  value={chownGroup}
                  onChange={e => setChownGroup(e.target.value)}
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[var(--accent)] font-mono"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="chownRecursive"
                  checked={chownRecursive}
                  onChange={e => setChownRecursive(e.target.checked)}
                  className="rounded border-white/20 bg-[#11111b] text-blue-500"
                />
                <label htmlFor="chownRecursive" className="text-xs text-gray-300 cursor-pointer">
                  Apply recursively (-R) to subdirectories & files
                </label>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => { setShowChownModal(false); setChownTarget(null); }}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg text-xs bg-purple-600 hover:bg-purple-700 text-white font-medium"
              >
                Apply chown
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rename Modal */}
      {showRenameModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form onSubmit={handleRename} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-sm text-white">Rename File or Folder</h3>
            <input
              type="text"
              autoFocus
              required
              value={renameNewName}
              onChange={e => setRenameNewName(e.target.value)}
              className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
            />
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowRenameModal(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg text-xs bg-[var(--accent)] hover:bg-blue-600 text-white font-medium"
              >
                Save Name
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New Folder Modal */}
      {showNewFolder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form onSubmit={handleCreateFolder} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <h3 className="font-bold text-sm text-white">Create New Remote Directory</h3>
            <input
              type="text"
              autoFocus
              required
              placeholder="Folder name"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
            />
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowNewFolder(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg text-xs bg-[var(--accent)] hover:bg-blue-600 text-white font-medium"
              >
                Create Folder
              </button>
            </div>
          </form>
        </div>
      )}

      {/* New File Modal */}
      {showNewFile && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form onSubmit={handleCreateFile} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <h3 className="font-bold text-sm text-white">Create New Remote File</h3>
            <input
              type="text"
              autoFocus
              required
              placeholder="e.g. index.js, app.py, config.yml"
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none font-mono"
            />
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowNewFile(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1.5 rounded-lg text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
              >
                Create & Edit
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
