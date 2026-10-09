import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Folder, FileText, ArrowLeft, ArrowRight, ArrowUp, 
  Grid, List, Columns, Image as ImageIcon, Search, Plus, Trash2, 
  ChevronRight, RefreshCw, Copy, Scissors, ClipboardPaste, FileCode, 
  CheckSquare, Square, Upload, Terminal, Edit3, Key, Archive, PackageOpen, 
  Star, BookmarkPlus, Compass, HardDrive, ShieldAlert, X, Users, Eye, EyeOff,
  Tag, MoreHorizontal, Download, Layers, Pin, Info, Check, Sliders, ChevronDown, ChevronUp, Lock, Unlock,
  Music, Video, Play, FileSpreadsheet, AlertTriangle
} from 'lucide-react';
import { 
  sftpListDir, sftpMkdir, sftpDelete, sftpRename, sftpChmod, sftpChown, 
  sftpWriteTextFile, sftpReadTextFile, sftpDownloadFile, sshExec,
  sftpReadFileBase64, sftpFolderSize, sftpDownloadToDownloads
} from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore, useSettingsStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';

export function getNextAvailableCopyName(originalName: string, existingNames: string[]): string {
  const existingSet = new Set(existingNames);
  const isHidden = originalName.startsWith('.');
  const cleanName = isHidden ? originalName.slice(1) : originalName;
  const dotIdx = cleanName.lastIndexOf('.');
  
  let stem = '';
  let ext = '';
  if (dotIdx > 0) {
    stem = (isHidden ? '.' : '') + cleanName.slice(0, dotIdx);
    ext = cleanName.slice(dotIdx);
  } else {
    stem = originalName;
    ext = '';
  }

  // Remove existing " copy" or " copy(N)" suffix from stem to find base root name
  const match = stem.match(/^(.*?)(?: copy(?:\((\d+)\))?)?$/);
  const base = match ? match[1] : stem;

  // Candidate 1: `${base} copy${ext}`
  const firstCopy = `${base} copy${ext}`;
  if (!existingSet.has(firstCopy)) {
    return firstCopy;
  }

  // Candidates 2+: `${base} copy(1)${ext}`, `copy(2)`, etc.
  let i = 1;
  while (true) {
    const candidate = `${base} copy(${i})${ext}`;
    if (!existingSet.has(candidate)) {
      return candidate;
    }
    i++;
  }
}

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
      title: 'File System',
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

  // List View Sorting State
  const [sortField, setSortField] = useState<'name' | 'modified' | 'size' | 'kind'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Sidebar Resizability State
  const [sidebarWidth, setSidebarWidth] = useState<number>(220);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);

  // Multi-item Dragging
  const [draggedItems, setDraggedItems] = useState<string[]>([]);

  // In-Memory Directory Cache
  const dirCache = useRef<Map<string, { files: RemoteFile[]; timestamp: number }>>(new Map());

  // Quick Look State (Spacebar Preview with real binary media support)
  const [quickLookFile, setQuickLookFile] = useState<RemoteFile | null>(null);
  const [quickLookContent, setQuickLookContent] = useState<string>('');
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'audio' | 'pdf' | 'text' | null>(null);
  const [isLoadingQuickLook, setIsLoadingQuickLook] = useState(false);

  // Shell script execution modal state
  const [scriptModal, setScriptModal] = useState<{
    file: RemoteFile;
    output: string;
    status: 'running' | 'success' | 'failed';
  } | null>(null);

  // Permission Denied Alert Modal State
  const [permissionAlert, setPermissionAlert] = useState<string | null>(null);

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

  // macOS Get Info Inspector State (⌘I)
  const [showGetInfo, setShowGetInfo] = useState(false);
  const [getInfoTarget, setGetInfoTarget] = useState<RemoteFile | null>(null);

  // Icon View Scale (Icon Size Grid Slider)
  const [iconSize, setIconSize] = useState<number>(64);

  // Action Toast Notification Banner
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  // Quick Look Copied Feedback
  const [quickLookCopied, setQuickLookCopied] = useState(false);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  }, []);

  const formatRawBytes = useCallback((bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }, []);

  const getFileKind = useCallback((file: RemoteFile) => {
    if (file.type === 'dir') return 'Folder';
    const ext = file.name.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'TypeScript Source';
      case 'js':
      case 'jsx':
        return 'JavaScript Script';
      case 'json':
        return 'JSON Document';
      case 'py':
        return 'Python Script';
      case 'sh':
      case 'bash':
        return 'Shell Script';
      case 'md':
        return 'Markdown Document';
      case 'html':
        return 'HTML Document';
      case 'css':
        return 'Cascading Style Sheet';
      case 'log':
        return 'Log File';
      case 'tar':
      case 'gz':
      case 'tgz':
      case 'zip':
        return 'Compressed Archive';
      case 'png':
      case 'jpg':
      case 'jpeg':
      case 'svg':
      case 'webp':
      case 'ico':
        return 'Image Document';
      case 'conf':
      case 'yaml':
      case 'yml':
      case 'toml':
        return 'Configuration File';
      default:
        return file.extension ? `${file.extension.toUpperCase()} File` : 'Document';
    }
  }, []);

  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
  const [openingFolder, setOpeningFolder] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Marquee Rubber-Band Multi-Select Box for Finder
  const [finderSelectionBox, setFinderSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [isFinderSelecting, setIsFinderSelecting] = useState(false);
  const finderFileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const finderContainerRef = useRef<HTMLDivElement | null>(null);

  const { openApp } = useWindowManager();
  const { openFileInEditor, finderTargetPath, clearFinderTarget, runTerminalCommand, openTerminalInDir } = useEditorStore();
  const { favorites, addFavorite, removeFavorite, pinToDesktop, showHiddenFiles, updateSettings } = useSettingsStore();

  // Sidebar drag resizer
  useEffect(() => {
    if (!isResizingSidebar) return;
    const handleMouseMove = (e: MouseEvent) => {
      const clamped = Math.max(160, Math.min(420, e.clientX));
      setSidebarWidth(clamped);
    };
    const handleMouseUp = () => {
      setIsResizingSidebar(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingSidebar]);

  const renderFileIcon = useCallback((file: RemoteFile, sizeClass: string = "w-4 h-4") => {
    if (file.type === 'dir') {
      return <Folder className={`${sizeClass} text-blue-400 shrink-0 fill-blue-400/20`} />;
    }
    const ext = file.extension?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) {
      return <ImageIcon className={`${sizeClass} text-purple-400 shrink-0`} />;
    }
    if (['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(ext)) {
      return <Video className={`${sizeClass} text-indigo-400 shrink-0`} />;
    }
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) {
      return <Music className={`${sizeClass} text-pink-400 shrink-0`} />;
    }
    if (ext === 'pdf') {
      return <FileText className={`${sizeClass} text-rose-500 shrink-0 font-bold`} />;
    }
    if (['sh', 'bash', 'zsh', 'fish'].includes(ext) || file.permissions.includes('x')) {
      return <Terminal className={`${sizeClass} text-emerald-400 shrink-0`} />;
    }
    if (['tar', 'gz', 'tgz', 'zip', 'bz2', 'xz', '7z', 'rar'].includes(ext)) {
      return <Archive className={`${sizeClass} text-amber-400 shrink-0`} />;
    }
    if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'html', 'css', 'vue'].includes(ext)) {
      return <FileCode className={`${sizeClass} text-blue-400 shrink-0`} />;
    }
    if (['json', 'yaml', 'yml', 'toml', 'xml', 'env', 'ini', 'conf'].includes(ext)) {
      return <Sliders className={`${sizeClass} text-cyan-400 shrink-0`} />;
    }
    return <FileText className={`${sizeClass} text-gray-400 shrink-0`} />;
  }, []);

  const handleGetInfo = useCallback((file?: RemoteFile) => {
    const target = file || (selectedFiles.size > 0 ? files.find(f => selectedFiles.has(f.name)) : null) || {
      name: currentPath === '/' ? 'File System' : currentPath.split('/').filter(Boolean).pop() || 'Folder',
      type: 'dir',
      size: `${files.length} items`,
      rawSize: 0,
      permissions: 'drwxr-xr-x',
      owner: currentUsername,
      modified: 'Current Session',
    };
    setGetInfoTarget(target);
    setShowGetInfo(true);
  }, [selectedFiles, files, currentPath, currentUsername]);

  const handleDownloadFile = async (targetFile?: RemoteFile) => {
    const fileToDownload = targetFile || (selectedFiles.size === 1 ? files.find(f => selectedFiles.has(f.name)) : undefined);
    if (!fileToDownload || fileToDownload.type !== 'file') {
      alert('Please select a single file to download.');
      return;
    }
    const filePath = currentPath === '/' ? `/${fileToDownload.name}` : `${currentPath}/${fileToDownload.name}`;
    try {
      showToast(`Downloading ${fileToDownload.name}...`);
      await sftpDownloadFile(activeConnId, filePath);
      showToast(`Downloaded ${fileToDownload.name} to Downloads folder`);
    } catch (err: any) {
      alert(`Download failed: ${err?.message || err}`);
    }
  };

  // Drag and drop multi-file/folder mover
  const handleMoveItems = async (sourceNames: string[], targetFolderName: string) => {
    if (!sourceNames || sourceNames.length === 0 || !targetFolderName) return;
    const valid = sourceNames.filter(n => n !== targetFolderName);
    if (valid.length === 0) return;
    setIsLoading(true);
    try {
      for (const sourceName of valid) {
        const src = currentPath === '/' ? `/${sourceName}` : `${currentPath}/${sourceName}`;
        const destDir = currentPath === '/' ? `/${targetFolderName}` : `${currentPath}/${targetFolderName}`;
        const dest = `${destDir}/${sourceName}`;
        await sftpRename(activeConnId, src, dest);
        setUndoStack(prev => [...prev, { type: 'move', originalPath: src, targetPath: dest }]);
      }
      showToast(`Moved ${valid.length} item${valid.length > 1 ? 's' : ''} into "${targetFolderName}"`);
      await loadDirectory(currentPath, true);
    } catch (err: any) {
      alert(`Move failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
      setDraggedItem(null);
      setDraggedItems([]);
      setDropTargetDir(null);
    }
  };

  const handleMoveItem = async (sourceName: string, targetFolderName: string) => {
    const items = draggedItems.length > 0 && draggedItems.includes(sourceName) ? draggedItems : [sourceName];
    await handleMoveItems(items, targetFolderName);
  };

  const handleMoveToSidebarDir = async (sourceNameOrNames: string | string[], destDirPath: string) => {
    const list = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
    if (list.length === 0 || !destDirPath || destDirPath === currentPath) return;
    setIsLoading(true);
    try {
      for (const sourceName of list) {
        const src = currentPath === '/' ? `/${sourceName}` : `${currentPath}/${sourceName}`;
        const dest = destDirPath === '/' ? `/${sourceName}` : `${destDirPath}/${sourceName}`;
        await sftpRename(activeConnId, src, dest);
        setUndoStack(prev => [...prev, { type: 'move', originalPath: src, targetPath: dest }]);
      }
      showToast(`Moved ${list.length} item${list.length > 1 ? 's' : ''} to ${destDirPath}`);
      await loadDirectory(currentPath, true);
    } catch (err: any) {
      alert(`Move failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
      setDraggedItem(null);
      setDraggedItems([]);
      setDropTargetDir(null);
    }
  };

  const handleFinderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.file-card') || target.closest('button') || target.closest('input') || target.closest('.no-select-box')) {
      return;
    }
    const container = finderContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    // Verify click is inside the container bounds
    if (
      e.clientX < rect.left || 
      e.clientX > rect.right || 
      e.clientY < rect.top || 
      e.clientY > rect.bottom
    ) {
      return;
    }

    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      setSelectedFiles(new Set());
    }

    const relX = e.clientX - rect.left + container.scrollLeft;
    const relY = e.clientY - rect.top + container.scrollTop;

    setFinderSelectionBox({
      startX: relX,
      startY: relY,
      currentX: relX,
      currentY: relY,
    });
    setIsFinderSelecting(true);
    setContextMenu(null);
  };

  const handleFinderMouseMove = (e: React.MouseEvent) => {
    if (!isFinderSelecting || !finderSelectionBox) return;
    const container = finderContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    // Strictly clamp current mouse coordinates to inside finderContainerRef
    const clampedClientX = Math.max(rect.left, Math.min(e.clientX, rect.right));
    const clampedClientY = Math.max(rect.top, Math.min(e.clientY, rect.bottom));

    const curX = clampedClientX - rect.left + container.scrollLeft;
    const curY = clampedClientY - rect.top + container.scrollTop;

    setFinderSelectionBox(prev => prev ? { ...prev, currentX: curX, currentY: curY } : null);

    const boxLeft = Math.min(finderSelectionBox.startX, curX);
    const boxRight = Math.max(finderSelectionBox.startX, curX);
    const boxTop = Math.min(finderSelectionBox.startY, curY);
    const boxBottom = Math.max(finderSelectionBox.startY, curY);

    if (Math.hypot(curX - finderSelectionBox.startX, curY - finderSelectionBox.startY) > 5) {
      const newSelected = new Set<string>();
      finderFileRefs.current.forEach((el, name) => {
        if (!el) return;
        const elOffsetLeft = el.offsetLeft;
        const elOffsetTop = el.offsetTop;
        const elWidth = el.offsetWidth;
        const elHeight = el.offsetHeight;

        const overlaps = !(
          elOffsetLeft + elWidth < boxLeft ||
          elOffsetLeft > boxRight ||
          elOffsetTop + elHeight < boxTop ||
          elOffsetTop > boxBottom
        );
        if (overlaps) {
          newSelected.add(name);
        }
      });
      setSelectedFiles(newSelected);
    }
  };

  const handleFinderMouseUp = () => {
    setIsFinderSelecting(false);
    setFinderSelectionBox(null);
  };

  // Global mouseup cleanup so selection never gets stuck or leaks outside window
  useEffect(() => {
    if (!isFinderSelecting) return;
    const handleGlobalMouseUp = () => {
      setIsFinderSelecting(false);
      setFinderSelectionBox(null);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isFinderSelecting]);

  const loadDirectory = useCallback(async (path: string, force: boolean = false) => {
    const clean = path.replace(/\/+/g, '/') || '/';
    // If not forcing refresh and directory is in cache, display immediately
    if (!force && dirCache.current.has(clean)) {
      const cached = dirCache.current.get(clean)!;
      setFiles(cached.files);
      setOpeningFolder(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const entries = await sftpListDir(activeConnId, clean);
      if (entries && Array.isArray(entries)) {
        const mapped: RemoteFile[] = entries.map((item: any) => ({
          name: item.name,
          type: item.is_dir ? 'dir' : 'file',
          size: item.is_dir ? (item.size > 0 ? formatRawBytes(item.size) : '4.0 KB') : formatRawBytes(item.size),
          rawSize: item.size || 0,
          permissions: item.permissions || (item.is_dir ? 'drwxr-xr-x' : '-rw-r--r--'),
          owner: item.owner || 'root',
          modified: item.modified ? new Date(item.modified * 1000).toLocaleDateString() : 'Recent',
          extension: item.name.includes('.') ? item.name.split('.').pop()?.toLowerCase() : undefined,
          tag: fileTags[item.name],
        }));
        setFiles(mapped);
        dirCache.current.set(clean, { files: mapped, timestamp: Date.now() });
      } else {
        setFiles([]);
      }
    } catch (err: any) {
      console.warn('SFTP directory list failed:', err);
      const errMsg = String(err?.message || err);
      if (errMsg.toLowerCase().includes('permission denied')) {
        setPermissionAlert(`Permission Denied: You do not have permission to access "${clean}".`);
      } else {
        showToast(`Failed to open: ${errMsg}`);
      }
      setFiles([]);
    } finally {
      setIsLoading(false);
      setOpeningFolder(null);
    }
  }, [activeConnId, fileTags, formatRawBytes, showToast]);

  useEffect(() => {
    loadDirectory(currentPath);
    setPathInput(currentPath);
  }, [currentPath, loadDirectory]);

  // Deep-link navigation when requested from Desktop icons (File System, Home, Trash)
  useEffect(() => {
    if (finderTargetPath) {
      navigateTo(finderTargetPath);
      clearFinderTarget();
    }
  }, [finderTargetPath, clearFinderTarget]);

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
    const folderTitle = clean === '/' ? 'File System' : clean.split('/').filter(Boolean).pop() || 'Folder';
    setOpeningFolder(folderTitle);
    setIsLoading(true);
    
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
      const folderTitle = prev === '/' ? 'File System' : prev.split('/').filter(Boolean).pop() || 'Folder';
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
      const folderTitle = next === '/' ? 'File System' : next.split('/').filter(Boolean).pop() || 'Folder';
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
    const folderTitle = targetPath === '/' ? 'File System' : targetPath.split('/').filter(Boolean).pop() || 'Folder';
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

  // Filtered files including showHiddenFiles, search filter, and tag filter
  const filteredFiles = files.filter(f => {
    if (!showHiddenFiles && f.name.startsWith('.')) return false;
    const matchesSearch = f.name.toLowerCase().includes(search.toLowerCase());
    const matchesTag = !activeTagFilter || fileTags[f.name] === activeTagFilter;
    return matchesSearch && matchesTag;
  });

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1;
    if (a.type !== 'dir' && b.type === 'dir') return 1;

    let comp = 0;
    if (sortField === 'name') {
      comp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    } else if (sortField === 'size') {
      comp = a.rawSize - b.rawSize;
    } else if (sortField === 'kind') {
      comp = getFileKind(a).localeCompare(getFileKind(b));
    } else if (sortField === 'modified') {
      comp = a.modified.localeCompare(b.modified);
    }
    return sortOrder === 'asc' ? comp : -comp;
  });

  const handleSort = (field: 'name' | 'modified' | 'size' | 'kind') => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
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
      const range = sortedFiles.slice(start, end + 1).map(item => item.name);
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
      setOpeningFolder(f.name);
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
      setMediaPreviewUrl(null);
      setMediaType(null);
      return;
    }

    setQuickLookFile(file);
    setQuickLookContent('');
    setMediaPreviewUrl(null);
    setMediaType(null);

    if (file.type === 'file') {
      setIsLoadingQuickLook(true);
      const ext = file.extension?.toLowerCase() || '';
      const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
      const videoExts = ['mp4', 'webm', 'ogg'];
      const audioExts = ['mp3', 'wav', 'flac', 'aac', 'm4a'];

      try {
        if (imageExts.includes(ext)) {
          const b64 = await sftpReadFileBase64(activeConnId, fullPath);
          const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'ico' ? 'image/x-icon' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          setMediaPreviewUrl(`data:${mime};base64,${b64}`);
          setMediaType('image');
        } else if (videoExts.includes(ext)) {
          const b64 = await sftpReadFileBase64(activeConnId, fullPath);
          setMediaPreviewUrl(`data:video/${ext};base64,${b64}`);
          setMediaType('video');
        } else if (audioExts.includes(ext)) {
          const b64 = await sftpReadFileBase64(activeConnId, fullPath);
          setMediaPreviewUrl(`data:audio/${ext === 'mp3' ? 'mpeg' : ext};base64,${b64}`);
          setMediaType('audio');
        } else if (ext === 'pdf') {
          const b64 = await sftpReadFileBase64(activeConnId, fullPath);
          setMediaPreviewUrl(`data:application/pdf;base64,${b64}`);
          setMediaType('pdf');
        } else {
          const content = await sftpReadTextFile(activeConnId, fullPath);
          setQuickLookContent(content || '(Empty file)');
          setMediaType('text');
        }
      } catch (err: any) {
        setQuickLookContent(`(Could not preview file: ${err?.message || err})`);
        setMediaType('text');
      } finally {
        setIsLoadingQuickLook(false);
      }
    } else {
      setQuickLookContent(`Directory with remote server items`);
      setMediaType('text');
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
    showToast(`Copied ${selectedFiles.size} item${selectedFiles.size > 1 ? 's' : ''} to clipboard`);
  };

  const handleCut = () => {
    if (selectedFiles.size === 0) return;
    setClipboard({
      files: Array.from(selectedFiles),
      isCut: true,
      sourceDir: currentPath,
    });
    showToast(`Cut ${selectedFiles.size} item${selectedFiles.size > 1 ? 's' : ''} to clipboard`);
  };

  const handlePaste = async () => {
    if (!clipboard || clipboard.files.length === 0) return;
    setIsLoading(true);
    try {
      const isSameDir = clipboard.sourceDir === currentPath;
      if (isSameDir && clipboard.isCut) {
        showToast('Items already in this folder');
        setIsLoading(false);
        return;
      }

      const currentNames = files.map(f => f.name);
      for (const name of clipboard.files) {
        const src = clipboard.sourceDir === '/' ? `/${name}` : `${clipboard.sourceDir}/${name}`;
        let destName = name;
        if (isSameDir) {
          destName = getNextAvailableCopyName(name, currentNames);
          currentNames.push(destName);
        }
        const dest = currentPath === '/' ? `/${destName}` : `${currentPath}/${destName}`;
        const cmd = clipboard.isCut ? `mv '${src}' '${dest}'` : `cp -r '${src}' '${dest}'`;
        await sshExec(activeConnId, cmd);
      }
      const count = clipboard.files.length;
      if (clipboard.isCut) setClipboard(null);
      await loadDirectory(currentPath, true);
      showToast(`Pasted ${count} item${count > 1 ? 's' : ''}`);
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
      const currentNames = files.map(f => f.name);
      for (const name of selectedFiles) {
        const src = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        const copyName = getNextAvailableCopyName(name, currentNames);
        currentNames.push(copyName);
        const dest = currentPath === '/' ? `/${copyName}` : `${currentPath}/${copyName}`;
        await sshExec(activeConnId, `cp -r '${src}' '${dest}'`);
      }
      const count = selectedFiles.size;
      await loadDirectory(currentPath, true);
      showToast(`Duplicated ${count} item${count > 1 ? 's' : ''}`);
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
      await loadDirectory(currentPath, true);
      showToast(`Moved ${items.length} item${items.length > 1 ? 's' : ''} to Trash`);
    } catch (err: any) {
      alert(`Delete failed: ${err?.message || err}`);
    }
  };

  const handleSelectAll = () => {
    setSelectedFiles(new Set(sortedFiles.map(f => f.name)));
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
      await loadDirectory(currentPath, true);
      showToast(`Action undone`);
    } catch (err: any) {
      console.warn('Undo error:', err);
    }
  };

  const handleOpenTerminalHere = () => {
    openTerminalInDir(currentPath);
    openApp('terminal', 'Terminal', undefined, true);
  };

  const handleRunShellScript = async (file: RemoteFile) => {
    const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    setScriptModal({
      file,
      output: `Executing: bash "${fullPath}" ...\n`,
      status: 'running',
    });
    try {
      const res = await sshExec(activeConnId, `bash "${fullPath}"`);
      const combined = (res.stdout ? res.stdout : '') + (res.stderr ? `\n[STDERR]\n${res.stderr}` : '');
      setScriptModal({
        file,
        output: combined || '(Script finished with no output)',
        status: res.exit_code === 0 ? 'success' : 'failed',
      });
    } catch (err: any) {
      setScriptModal({
        file,
        output: `Execution error: ${err?.message || err}`,
        status: 'failed',
      });
    }
  };

  const handlePinToDesktop = (file: RemoteFile) => {
    const itemPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    pinToDesktop({
      id: `pinned-${Date.now()}-${file.name}`,
      name: file.name,
      path: itemPath,
      type: file.type,
    });
    showToast(`Pinned "${file.name}" to Desktop`);
  };

  const handleCreateTar = async (type: 'tar.gz' | 'zip') => {
    const items = selectedFiles.size > 0 
      ? Array.from(selectedFiles) 
      : (contextMenu?.file ? [contextMenu.file.name] : []);
    if (items.length === 0) return;
    const defaultArchiveName = items.length === 1 ? `${items[0]}.${type}` : `archive.${type}`;
    const archiveName = prompt(`Enter archive name (.${type}):`, defaultArchiveName);
    if (!archiveName) return;

    setIsLoading(true);
    try {
      const itemsList = items.map(i => `'${i}'`).join(' ');
      const cmd = type === 'tar.gz'
        ? `cd '${currentPath}' && tar -czvf '${archiveName}' ${itemsList}`
        : `cd '${currentPath}' && zip -r '${archiveName}' ${itemsList}`;
      await sshExec(activeConnId, cmd);
      await loadDirectory(currentPath, true);
      showToast(`Created archive: ${archiveName}`);
    } catch (err: any) {
      alert(`Archive creation failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExtractArchive = async (file: RemoteFile) => {
    setIsLoading(true);
    try {
      const fn = file.name;
      let cmd = '';
      let toolName = 'tar';
      if (fn.endsWith('.tar.gz') || fn.endsWith('.tgz')) {
        cmd = `cd '${currentPath}' && tar -xzvf '${fn}'`;
      } else if (fn.endsWith('.tar.bz2') || fn.endsWith('.tbz2')) {
        cmd = `cd '${currentPath}' && tar -xjvf '${fn}'`;
      } else if (fn.endsWith('.tar')) {
        cmd = `cd '${currentPath}' && tar -xvf '${fn}'`;
      } else if (fn.endsWith('.zip')) {
        toolName = 'unzip';
        cmd = `cd '${currentPath}' && unzip -o '${fn}'`;
      } else if (fn.endsWith('.gz')) {
        toolName = 'gzip';
        cmd = `cd '${currentPath}' && gunzip -k '${fn}'`;
      } else {
        cmd = `cd '${currentPath}' && tar -xvf '${fn}'`;
      }

      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 127 || res.stderr.toLowerCase().includes('command not found') || res.stderr.toLowerCase().includes('not found')) {
        alert(`Cannot extract archive: '${toolName}' utility is not installed on this server.\n\nPlease install it using your package manager (e.g., sudo apt install ${toolName} or sudo dnf install ${toolName}) to extract this file.`);
        return;
      }
      if (res.exit_code !== 0) {
        alert(`Archive extraction error:\n${res.stderr || res.stdout}`);
        return;
      }
      await loadDirectory(currentPath, true);
      showToast(`Extracted ${file.name}`);
    } catch (err: any) {
      alert(`Extract failed: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
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
      } else if (isMacMeta && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        handleGetInfo();
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
  }, [selectedFiles, clipboard, currentPath, undoStack, quickLookFile, files, handleGetInfo]);

  // Color tag assigner
  const handleAssignTag = (fileName: string, tagId: string) => {
    setFileTags(prev => ({
      ...prev,
      [fileName]: tagId
    }));
    const tagName = MACOS_TAGS.find(t => t.id === tagId)?.name || tagId;
    showToast(`Tagged "${fileName}" as ${tagName}`);
    setContextMenu(null);
  };

  const selectedFileObj = sortedFiles.find(f => selectedFiles.has(f.name)) || sortedFiles[0];

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  const quickPlaces = [
    { label: 'Desktop', path: `${userHome}/Desktop`, icon: Compass },
    { label: 'Documents', path: `${userHome}/Documents`, icon: FileText },
    { label: 'Downloads', path: `${userHome}/Downloads`, icon: Download },
    { label: 'User Home', path: userHome, icon: Folder },
    { label: 'File System', path: '/', icon: HardDrive },
    { label: 'Applications', path: '/usr/local/bin', icon: Layers },
    { label: 'Logs', path: '/var/log', icon: FileCode },
  ];

  return (
    <div 
      className="flex h-full bg-[#181825] text-[#cdd6f4] select-none overflow-hidden relative"
      onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
      onDragLeave={() => setIsDraggingOver(false)}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      {/* macOS Translucent Finder Sidebar */}
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
                onClick={() => navigateTo(p.path)}
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
            <div className="mac-segmented-container shrink-0">
              <button
                onClick={() => setView('icons')}
                className={`mac-segmented-item ${view === 'icons' ? 'active' : ''}`}
                title="Icons View (⊞)"
              >
                <Grid className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setView('list')}
                className={`mac-segmented-item ${view === 'list' ? 'active' : ''}`}
                title="List View (☰)"
              >
                <List className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setView('columns')}
                className={`mac-segmented-item ${view === 'columns' ? 'active' : ''}`}
                title="Miller Columns View (☵)"
              >
                <Columns className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setView('gallery')}
                className={`mac-segmented-item ${view === 'gallery' ? 'active' : ''}`}
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
                    className={`cursor-pointer px-1.5 py-0.5 rounded transition-all shrink-0 ${
                      currentPath === '/' 
                        ? 'bg-blue-600/35 text-white font-bold border border-blue-400/50 shadow-sm animate-location-pulse' 
                        : 'text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    /
                  </span>
                  {breadcrumbs.map((part, index) => {
                    const full = '/' + breadcrumbs.slice(0, index + 1).join('/');
                    const isLast = index === breadcrumbs.length - 1;
                    return (
                      <React.Fragment key={full}>
                        <ChevronRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />
                        <span
                          onClick={(e) => { e.stopPropagation(); navigateTo(full); }}
                          className={`cursor-pointer px-2 py-0.5 rounded-lg whitespace-nowrap transition-all flex items-center space-x-1 ${
                            isLast
                              ? 'bg-blue-600/35 text-white font-bold border border-blue-400/60 shadow-md animate-location-pulse'
                              : 'text-gray-300 hover:text-white hover:bg-white/10'
                          }`}
                        >
                          {isLast && <Folder className="w-3 h-3 text-blue-400 shrink-0" />}
                          <span>{part}</span>
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
          <div className="flex items-center space-x-1.5 pl-2 shrink-0 flex-wrap">
            {/* Reload Directory Button */}
            <button
              onClick={() => loadDirectory(currentPath, true)}
              className={`mac-btn-icon ${isLoading ? 'animate-spin text-blue-400' : ''}`}
              title="Reload Directory (⌘R)"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            {/* Toggle Hidden Items Button */}
            <button
              onClick={() => updateSettings({ showHiddenFiles: !showHiddenFiles })}
              className={`mac-btn-icon ${showHiddenFiles ? 'text-blue-400 bg-white/10' : 'text-gray-400'}`}
              title={showHiddenFiles ? "Hide Hidden Items (⌘.)" : "Show Hidden Items (⌘.)"}
            >
              {showHiddenFiles ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            </button>

            {/* Get Info Button */}
            <button
              onClick={() => handleGetInfo()}
              className="mac-btn-icon"
              title="Get Info (⌘I)"
            >
              <Info className="w-3.5 h-3.5" />
            </button>

            {/* Quick Look Button */}
            <button
              onClick={() => handleQuickLookToggle()}
              className="mac-btn-icon"
              title="Quick Look (Spacebar)"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>

            {/* Download File Button */}
            <button
              onClick={() => handleDownloadFile()}
              disabled={selectedFiles.size !== 1 || files.find(f => selectedFiles.has(f.name))?.type !== 'file'}
              className="mac-btn mac-btn-secondary mac-btn-sheen flex items-center space-x-1.5"
              title="Download Selected File to Computer"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>Download</span>
            </button>

            {/* New Folder */}
            <button
              onClick={() => setShowNewFolder(true)}
              className="mac-btn mac-btn-primary mac-btn-sheen flex items-center space-x-1.5"
              title="New Folder (Ctrl+N)"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Folder</span>
            </button>

            {/* Action Menu (⋯) */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowActionMenu(prev => !prev);
                }}
                className={`mac-btn-icon ${showActionMenu ? 'bg-white/15 text-white' : ''}`}
                title="Action Options"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>

              {showActionMenu && (
                <div 
                  className="absolute right-0 top-8 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl py-1.5 z-50 text-xs w-56 font-sans select-none max-h-[80vh] overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  {selectedFiles.size > 0 ? (
                    <>
                      {/* Selected Item Options */}
                      <div className="px-3.5 py-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                        {selectedFiles.size} Item{selectedFiles.size > 1 ? 's' : ''} Selected
                      </div>
                      <div 
                        onClick={() => { handleGetInfo(); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center justify-between text-blue-400 font-medium"
                      >
                        <div className="flex items-center space-x-2">
                          <Info className="w-3.5 h-3.5" />
                          <span>Get Info</span>
                        </div>
                        <span className="text-[10px] text-gray-400">⌘I</span>
                      </div>
                      <div 
                        onClick={() => { handleQuickLookToggle(); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Quick Look</span>
                      </div>
                      {selectedFileObj?.type === 'file' && (
                        <div 
                          onClick={() => { openFileTarget(selectedFileObj.name); setShowActionMenu(false); }}
                          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                        >
                          <FileCode className="w-3.5 h-3.5" />
                          <span>Open in Editor</span>
                        </div>
                      )}
                      {selectedFileObj?.type === 'file' && (
                        <div 
                          onClick={() => { handleDownloadFile(selectedFileObj); setShowActionMenu(false); }}
                          className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white cursor-pointer flex items-center space-x-2 text-emerald-400 font-medium"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download to My Computer</span>
                        </div>
                      )}
                      {selectedFileObj && (selectedFileObj.name.endsWith('.sh') || selectedFileObj.name.endsWith('.bash') || selectedFileObj.permissions.includes('x')) && (
                        <div 
                          onClick={() => { handleRunShellScript(selectedFileObj); setShowActionMenu(false); }}
                          className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white cursor-pointer flex items-center space-x-2 text-emerald-400 font-medium"
                        >
                          <Terminal className="w-3.5 h-3.5" />
                          <span>Run Shell Script</span>
                        </div>
                      )}
                      {selectedFileObj && ['zip', 'tar', 'gz', 'tgz', 'bz2'].includes(selectedFileObj.extension || '') && (
                        <div 
                          onClick={() => { handleExtractArchive(selectedFileObj); setShowActionMenu(false); }}
                          className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white cursor-pointer flex items-center space-x-2 text-emerald-400 font-medium"
                        >
                          <PackageOpen className="w-3.5 h-3.5" />
                          <span>Extract Archive</span>
                        </div>
                      )}
                      <div className="my-1 border-t border-white/10" />
                      <div 
                        onClick={() => { handleDuplicate(); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Duplicate (⌘D)</span>
                      </div>
                      <div 
                        onClick={() => { handleCopy(); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy (⌘C)</span>
                      </div>
                      <div 
                        onClick={() => { handleCut(); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                      >
                        <Scissors className="w-3.5 h-3.5" />
                        <span>Cut (⌘X)</span>
                      </div>
                      {selectedFiles.size === 1 && (
                        <div 
                          onClick={() => { 
                            const f = files.find(x => selectedFiles.has(x.name));
                            if (f) {
                              setRenameTarget(f.name);
                              setRenameNewName(f.name);
                              setShowRenameModal(true);
                            }
                            setShowActionMenu(false);
                          }}
                          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Rename...</span>
                        </div>
                      )}
                      <div className="my-1 border-t border-white/10" />
                      <div 
                        onClick={() => { handleDeleteSelected(); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-red-600 hover:text-white cursor-pointer flex items-center space-x-2 text-red-400 font-medium"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Move to Trash</span>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Default Folder Options when Nothing is Selected */}
                      <div className="px-3.5 py-1 text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                        Folder Actions
                      </div>
                      <div 
                        onClick={() => { setShowNewFolder(true); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                      >
                        <Folder className="w-3.5 h-3.5 text-blue-400" />
                        <span>New Folder</span>
                      </div>
                      <div 
                        onClick={() => { setShowNewFile(true); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                      >
                        <FileText className="w-3.5 h-3.5 text-gray-300" />
                        <span>New Empty File</span>
                      </div>
                      <div 
                        onClick={() => { handleOpenTerminalHere(); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2 text-emerald-400"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        <span>Open Terminal Here</span>
                      </div>
                      <div className="my-1 border-t border-white/10" />
                      {clipboard && (
                        <div 
                          onClick={() => { handlePaste(); setShowActionMenu(false); }}
                          className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2 text-blue-400 font-medium"
                        >
                          <ClipboardPaste className="w-3.5 h-3.5" />
                          <span>Paste ({clipboard.files.length} items)</span>
                        </div>
                      )}
                      <div 
                        onClick={() => { updateSettings({ showHiddenFiles: !showHiddenFiles }); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                      >
                        {showHiddenFiles ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5 text-blue-400" />}
                        <span>{showHiddenFiles ? 'Hide Hidden Items' : 'Show Hidden Items'}</span>
                      </div>
                      <div 
                        onClick={() => { loadDirectory(currentPath, true); setShowActionMenu(false); }}
                        className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white cursor-pointer flex items-center space-x-2"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                        <span>Reload Directory</span>
                      </div>
                      <div 
                        onClick={() => { handleGetInfo(); setShowActionMenu(false); }}
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
          {/* Top Loading Progress Line Effect */}
          {isLoading && (
            <div className="absolute top-0 left-0 right-0 h-0.5 z-40 overflow-hidden bg-white/5 pointer-events-none">
              <div className="h-full bg-gradient-to-r from-blue-400 via-sky-300 to-indigo-500 animate-top-progress shadow-[0_0_8px_rgba(56,189,248,0.9)]" />
            </div>
          )}

          {/* Drop Upload Banner */}
          {isDraggingOver && (
            <div className="absolute inset-0 bg-blue-600/20 backdrop-blur-md border-2 border-dashed border-blue-400 rounded-3xl z-30 flex flex-col items-center justify-center pointer-events-none">
              <Upload className="w-12 h-12 text-blue-300 animate-bounce mb-2" />
              <span className="text-sm font-bold text-white">Drop files to upload into {currentPath}</span>
            </div>
          )}

          {isLoading && files.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-xs text-gray-400 space-y-2.5">
              <div className="w-10 h-10 rounded-2xl bg-blue-500/10 border border-blue-400/20 flex items-center justify-center shadow-lg">
                <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
              </div>
              <span className="font-medium text-white">Opening {currentPath.split('/').filter(Boolean).pop() || 'Location'}...</span>
              <span className="text-[10px] text-gray-500 font-mono">{currentPath}</span>
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-500 py-16 space-y-2">
              <Folder className="w-12 h-12 opacity-25" />
              <span className="text-xs">This directory is empty</span>
            </div>
          ) : view === 'icons' ? (
            /* 1. ICONS VIEW */
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

              {/* Rubber Band Selection Box (contained strictly inside Finder canvas) */}
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
                {sortedFiles.map((f, idx) => {
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
                      <span className="text-[10px] text-gray-500 mt-1 pointer-events-none">{f.size}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : view === 'list' ? (
            /* 2. LIST VIEW */
            <div className={`h-full overflow-y-auto ${isLoading ? 'cursor-mac-wait is-loading-folder' : ''}`}>
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/[0.08] select-none sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-8">
                      <button 
                        onClick={() => {
                          if (selectedFiles.size === sortedFiles.length) setSelectedFiles(new Set());
                          else setSelectedFiles(new Set(sortedFiles.map(f => f.name)));
                        }}
                        className="text-gray-400 hover:text-white"
                      >
                        {selectedFiles.size > 0 && selectedFiles.size === sortedFiles.length ? (
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
                  {sortedFiles.map((f, idx) => {
                    const isSelected = selectedFiles.has(f.name);
                    const isOpeningThis = openingFolder === f.name;
                    const tagInfo = MACOS_TAGS.find(t => t.id === f.tag);
                    return (
                      <tr
                        key={f.name}
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
                          {renderFileIcon(f, "w-4 h-4")}
                          <span className={isSelected ? 'text-white font-semibold' : 'text-gray-200'}>{f.name}</span>
                          {isOpeningThis && (
                            <RefreshCw className="w-3 h-3 text-blue-400 animate-spin ml-1" />
                          )}
                          {tagInfo && (
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tagInfo.color }} />
                          )}
                        </td>
                        <td className="py-2 px-3 text-gray-400">{f.modified}</td>
                        <td className="py-2 px-3 text-gray-300 font-mono">{f.size}</td>
                        <td className="py-2 px-3 text-gray-400 capitalize">{getFileKind(f)}</td>
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
            <div className={`h-full flex divide-x divide-white/[0.08] overflow-x-auto ${isLoading ? 'cursor-mac-wait is-loading-folder' : ''}`}>
              {/* Directory Items Column */}
              <div className="w-72 overflow-y-auto p-2 shrink-0 space-y-1">
                {sortedFiles.map((f, idx) => {
                  const isSelected = selectedFiles.has(f.name);
                  const isOpeningThis = openingFolder === f.name;
                  return (
                    <div
                      key={f.name}
                      onClick={(e) => handleSelectFile(f, idx, e)}
                      onDoubleClick={() => handleFileDoubleClick(f)}
                      className={`flex items-center justify-between px-3 py-1.5 rounded-xl cursor-pointer text-xs transition-colors ${
                        isOpeningThis
                          ? 'animate-folder-open bg-blue-500/30 text-white font-bold ring-1 ring-blue-400 cursor-mac-wait'
                          : isSelected 
                          ? 'bg-blue-600 text-white font-medium shadow-sm' 
                          : 'text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      <div className="flex items-center space-x-2 truncate">
                        {f.type === 'dir' ? (
                          <Folder className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-blue-400'} ${isOpeningThis ? 'animate-bounce' : ''}`} />
                        ) : (
                          <FileText className={`w-4 h-4 ${isSelected ? 'text-white' : 'text-gray-400'}`} />
                        )}
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
            <div className={`h-full flex flex-col ${isLoading ? 'cursor-mac-wait is-loading-folder' : ''}`}>
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
                {sortedFiles.map((f, idx) => {
                  const isSelected = selectedFiles.has(f.name);
                  const isOpeningThis = openingFolder === f.name;
                  return (
                    <div
                      key={f.name}
                      onClick={(e) => handleSelectFile(f, idx, e)}
                      onDoubleClick={() => handleFileDoubleClick(f)}
                      className={`flex flex-col items-center justify-center w-24 p-2 rounded-2xl cursor-pointer shrink-0 transition-all ${
                        isOpeningThis
                          ? 'animate-folder-open bg-blue-500/30 border border-blue-400 ring-2 ring-blue-400 cursor-mac-wait'
                          : isSelected 
                          ? 'bg-blue-600/30 border border-blue-500 ring-2 ring-blue-500/30 shadow-lg' 
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      {f.type === 'dir' ? (
                        <Folder className={`w-8 h-8 text-blue-400 mb-1 ${isOpeningThis ? 'animate-bounce' : ''}`} />
                      ) : (
                        <FileText className="w-8 h-8 text-gray-400 mb-1" />
                      )}
                      <span className="text-[11px] text-gray-200 truncate max-w-full font-medium">{f.name}</span>
                      {isOpeningThis && (
                        <RefreshCw className="w-3 h-3 text-blue-400 animate-spin mt-0.5" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* macOS Bottom Path Bar & Status Bar */}
        <div className="h-7 bg-[#11111a] border-t border-white/[0.08] px-3 flex items-center justify-between text-xs text-gray-400 shrink-0 select-none">
          {/* Path Breadcrumbs */}
          <div className="flex items-center space-x-1 overflow-x-auto text-[11px] font-medium text-gray-300 scrollbar-none">
            <span 
              onClick={() => navigateTo('/')}
              className={`cursor-pointer flex items-center space-x-1 px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                currentPath === '/' 
                  ? 'bg-blue-600/35 text-white font-semibold border border-blue-400/40 shadow-sm animate-location-pulse' 
                  : 'hover:text-white hover:bg-white/10'
              }`}
              title="File System (/)"
            >
              <HardDrive className="w-3 h-3 text-blue-400" />
              <span>File System</span>
            </span>
            {breadcrumbs.map((part, index) => {
              const full = '/' + breadcrumbs.slice(0, index + 1).join('/');
              const isLast = index === breadcrumbs.length - 1;
              return (
                <React.Fragment key={full}>
                  <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />
                  <span 
                    onClick={() => navigateTo(full)}
                    className={`cursor-pointer px-1.5 py-0.5 rounded transition-colors truncate max-w-[140px] flex items-center space-x-1 ${
                      isLast 
                        ? 'bg-blue-600/35 text-white font-semibold border border-blue-400/40 shadow-sm animate-location-pulse' 
                        : 'hover:text-white hover:bg-white/10'
                    }`}
                    title={full}
                  >
                    {isLast && <Folder className="w-2.5 h-2.5 text-blue-400 shrink-0" />}
                    <span>{part}</span>
                  </span>
                </React.Fragment>
              );
            })}
          </div>

          {/* Status info & controls */}
          <div className="text-[11px] text-gray-400 flex items-center space-x-3 shrink-0 pl-2">
            <span>
              {selectedFiles.size > 0 
                ? `${selectedFiles.size} of ${sortedFiles.length} selected${
                    sortedFiles
                      .filter(f => selectedFiles.has(f.name))
                      .reduce((acc, f) => acc + (f.rawSize || 0), 0) > 0
                        ? ` (${formatRawBytes(
                            sortedFiles
                              .filter(f => selectedFiles.has(f.name))
                              .reduce((acc, f) => acc + (f.rawSize || 0), 0)
                          )})`
                        : ''
                  }`
                : `${sortedFiles.length} item${sortedFiles.length !== 1 ? 's' : ''}`}
            </span>
            <span className="text-gray-600">·</span>
            <span className="flex items-center space-x-1 text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[10px]">SFTP Ready</span>
            </span>

            {/* Icon Size Slider (Visible in Icons View) */}
            {view === 'icons' && (
              <div className="flex items-center space-x-1.5 pl-2 border-l border-white/10">
                <Grid className="w-2.5 h-2.5 text-gray-500" />
                <input
                  type="range"
                  min={48}
                  max={112}
                  value={iconSize}
                  onChange={(e) => setIconSize(Number(e.target.value))}
                  className="w-16 h-1 bg-white/20 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  title={`Icon Size: ${iconSize}px`}
                />
                <Grid className="w-3.5 h-3.5 text-gray-300" />
              </div>
            )}

            {/* Quick Get Info Trigger */}
            <button
              onClick={() => handleGetInfo()}
              className="p-1 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"
              title="Get Info (⌘I)"
            >
              <Info className="w-3 h-3 text-blue-400" />
            </button>
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
            className="bg-[#1e1e2e]/95 border border-white/20 rounded-3xl w-full max-w-3xl h-[560px] flex flex-col shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Quick Look macOS Window Chrome Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10 bg-[#14141e]/90">
              {/* Traffic Lights */}
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => setQuickLookFile(null)}
                  className="w-3 h-3 rounded-full bg-[#FF5F56] hover:brightness-110 flex items-center justify-center text-[8px] text-black font-bold"
                  title="Close (Esc / Spacebar)"
                >
                  ✕
                </button>
                <div className="w-3 h-3 rounded-full bg-[#FFBD2E] opacity-75" />
                <div className="w-3 h-3 rounded-full bg-[#27C93F] opacity-75" />
                <span className="text-xs font-semibold text-white pl-3 truncate max-w-[260px]">{quickLookFile.name}</span>
                <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded-full text-blue-400 font-mono">
                  {quickLookFile.name.split('.').pop()?.toUpperCase() || (quickLookFile.type === 'dir' ? 'FOLDER' : 'FILE')}
                </span>
                <span className="text-[11px] text-gray-400">({quickLookFile.size})</span>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2">
                {quickLookFile.type === 'file' && (
                  <>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(quickLookContent);
                        setQuickLookCopied(true);
                        setTimeout(() => setQuickLookCopied(false), 2000);
                        showToast(`Copied content of ${quickLookFile.name}`);
                      }}
                      className="px-2.5 py-1 bg-white/10 hover:bg-white/20 text-gray-200 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition-colors"
                      title="Copy file content to clipboard"
                    >
                      {quickLookCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
                      <span>{quickLookCopied ? 'Copied!' : 'Copy'}</span>
                    </button>
                    <button
                      onClick={() => handleDownloadFile(quickLookFile)}
                      className="px-2.5 py-1 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 rounded-xl text-xs font-medium flex items-center space-x-1 transition-colors"
                      title="Download to computer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                    <button
                      onClick={() => {
                        openFileTarget(quickLookFile.name);
                        setQuickLookFile(null);
                      }}
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium shadow-md transition-colors flex items-center space-x-1"
                    >
                      <FileCode className="w-3.5 h-3.5" />
                      <span>Open in Editor</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Quick Look Body */}
            <div className="flex-1 overflow-y-auto font-mono text-xs text-gray-300 bg-[#0c0c14]">
              {isLoadingQuickLook ? (
                <div className="h-full flex items-center justify-center space-x-2 text-gray-400">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Loading preview...</span>
                </div>
              ) : mediaType === 'image' && mediaPreviewUrl ? (
                <div className="h-full flex flex-col items-center justify-center p-4 bg-[#08080e]/90 overflow-hidden">
                  <img 
                    src={mediaPreviewUrl} 
                    alt={quickLookFile.name} 
                    className="max-h-[440px] max-w-full object-contain rounded-xl shadow-2xl border border-white/10" 
                  />
                </div>
              ) : mediaType === 'video' && mediaPreviewUrl ? (
                <div className="h-full flex flex-col items-center justify-center p-4 bg-[#08080e]/90">
                  <video 
                    src={mediaPreviewUrl} 
                    controls 
                    autoPlay 
                    className="max-h-[440px] max-w-full rounded-xl shadow-2xl border border-white/10" 
                  />
                </div>
              ) : mediaType === 'audio' && mediaPreviewUrl ? (
                <div className="h-full flex flex-col items-center justify-center p-8 space-y-6">
                  <div className="w-24 h-24 rounded-3xl bg-pink-500/20 border border-white/10 flex items-center justify-center shadow-2xl">
                    <Music className="w-12 h-12 text-pink-400" />
                  </div>
                  <div className="text-center">
                    <h4 className="font-semibold text-white text-sm">{quickLookFile.name}</h4>
                    <p className="text-xs text-gray-400 font-sans mt-1">Audio · {quickLookFile.size}</p>
                  </div>
                  <audio src={mediaPreviewUrl} controls autoPlay className="w-full max-w-md" />
                </div>
              ) : mediaType === 'pdf' && mediaPreviewUrl ? (
                <div className="h-full w-full">
                  <iframe 
                    src={mediaPreviewUrl} 
                    title={quickLookFile.name} 
                    className="w-full h-full border-0" 
                  />
                </div>
              ) : (
                <div className="flex min-h-full">
                  {/* Line Number Gutter */}
                  <div className="select-none text-gray-600 text-right pr-3 pl-3 py-3 border-r border-white/5 bg-[#08080e] shrink-0 font-mono text-[11px] leading-relaxed">
                    {quickLookContent.split('\n').map((_, idx) => (
                      <div key={idx}>{idx + 1}</div>
                    ))}
                  </div>
                  {/* Code text */}
                  <pre className="flex-1 p-3 overflow-x-auto whitespace-pre leading-relaxed font-mono text-[12px] text-gray-200 select-text">
                    {quickLookContent}
                  </pre>
                </div>
              )}
            </div>

            {/* Quick Look macOS Footer */}
            <div className="px-4 py-2 bg-[#14141e]/90 border-t border-white/10 flex items-center justify-between text-[11px] text-gray-500">
              <span className="font-sans">Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-300 font-mono text-[10px]">Spacebar</kbd> or <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-gray-300 font-mono text-[10px]">Esc</kbd> to dismiss</span>
              <div className="flex items-center space-x-3 font-mono">
                <span>{mediaType === 'text' ? `${quickLookContent.split('\n').length} lines` : mediaType ? mediaType.toUpperCase() : 'Preview'}</span>
                <span>·</span>
                <span>{quickLookFile.permissions}</span>
                <span>·</span>
                <span>{quickLookFile.owner}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Right-Click Context Menu with macOS Tags & Actions */}
      {contextMenu && (
        <div 
          className="fixed z-50 bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl py-1.5 w-60 text-xs select-none max-h-[calc(100vh-32px)] overflow-y-auto scrollbar-thin"
          style={{ 
            top: Math.max(10, Math.min(contextMenu.y, window.innerHeight - 560)), 
            left: Math.max(10, Math.min(contextMenu.x, window.innerWidth - 260)) 
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.file ? (
            <>
              {/* Get Info in Context Menu */}
              <div 
                onClick={() => { handleGetInfo(contextMenu.file); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center justify-between cursor-pointer font-medium text-blue-400"
              >
                <div className="flex items-center space-x-2">
                  <Info className="w-3.5 h-3.5" />
                  <span>Get Info</span>
                </div>
                <span className="text-[10px] text-gray-400">⌘I</span>
              </div>
              <div className="my-1 border-t border-white/10" />
              {contextMenu.file.type === 'file' ? (
                <>
                  <div 
                    onClick={() => { openFileTarget(contextMenu.file!.name); setContextMenu(null); }}
                    className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium"
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>Open in Code Editor</span>
                  </div>
                  <div 
                    onClick={() => { handleDownloadFile(contextMenu.file); setContextMenu(null); }}
                    className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-emerald-400"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download to My Computer</span>
                  </div>
                  {(contextMenu.file.name.endsWith('.sh') || contextMenu.file.name.endsWith('.bash')) && (
                    <div 
                      onClick={() => { handleRunShellScript(contextMenu.file!); setContextMenu(null); }}
                      className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-emerald-300"
                    >
                      <Terminal className="w-3.5 h-3.5" />
                      <span>Run Shell Script</span>
                    </div>
                  )}
                </>
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

              {/* Pin to Desktop */}
              <div 
                onClick={() => { handlePinToDesktop(contextMenu.file!); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-amber-300"
              >
                <Pin className="w-3.5 h-3.5" />
                <span>Pin to Desktop</span>
              </div>

              {/* Extract Archive if applicable */}
              {(contextMenu.file!.name.endsWith('.tar.gz') || 
                contextMenu.file!.name.endsWith('.tgz') || 
                contextMenu.file!.name.endsWith('.tar.bz2') || 
                contextMenu.file!.name.endsWith('.tar') || 
                contextMenu.file!.name.endsWith('.zip') || 
                contextMenu.file!.name.endsWith('.gz')) && (
                <div 
                  onClick={() => { handleExtractArchive(contextMenu.file!); setContextMenu(null); }}
                  className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-emerald-300"
                >
                  <PackageOpen className="w-3.5 h-3.5" />
                  <span>Extract Archive Here</span>
                </div>
              )}

              {/* Compress options */}
              <div 
                onClick={() => { handleCreateTar('tar.gz'); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Compress (.tar.gz)</span>
              </div>

              <div 
                onClick={() => { handleCreateTar('zip'); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>Compress (.zip)</span>
              </div>

              <div 
                onClick={() => { handleOpenTerminalHere(); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>Open Terminal Here</span>
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
                onClick={() => { handleGetInfo(); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center justify-between cursor-pointer font-medium text-blue-400"
              >
                <div className="flex items-center space-x-2">
                  <Info className="w-3.5 h-3.5" />
                  <span>Get Info</span>
                </div>
                <span className="text-[10px] text-gray-400">⌘I</span>
              </div>
              <div className="my-1 border-t border-white/10" />
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
              {selectedFiles.size > 0 && (
                <div 
                  onClick={() => { handleCreateTar('tar.gz'); setContextMenu(null); }}
                  className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Compress Selected ({selectedFiles.size})</span>
                </div>
              )}
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
                onClick={() => { updateSettings({ showHiddenFiles: !showHiddenFiles }); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                {showHiddenFiles ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5 text-blue-400" />}
                <span>{showHiddenFiles ? 'Hide Hidden Items' : 'Show Hidden Items'}</span>
              </div>
              <div 
                onClick={() => { loadDirectory(currentPath, true); setContextMenu(null); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
                <span>Reload Directory</span>
              </div>
              <div 
                onClick={() => { handleOpenTerminalHere(); setContextMenu(null); }}
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

      {/* macOS Get Info Inspector Panel Modal (⌘I) */}
      {showGetInfo && getInfoTarget && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => { setShowGetInfo(false); setGetInfoTarget(null); }}
        >
          <div 
            className="bg-[#1e1e2e]/98 border border-white/20 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col text-xs font-sans max-h-[88vh]"
            onClick={e => e.stopPropagation()}
          >
            {/* macOS Window Chrome Header */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#14141e]/90 border-b border-white/10 shrink-0">
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => { setShowGetInfo(false); setGetInfoTarget(null); }}
                  className="w-3 h-3 rounded-full bg-[#FF5F56] hover:brightness-110 flex items-center justify-center text-[8px] text-black font-bold"
                  title="Close (⌘W / Esc)"
                >
                  ✕
                </button>
                <div className="w-3 h-3 rounded-full bg-[#FFBD2E] opacity-75" />
                <div className="w-3 h-3 rounded-full bg-[#27C93F] opacity-75" />
              </div>
              <span className="font-semibold text-white truncate max-w-[200px] text-xs">
                {getInfoTarget.name} Info
              </span>
              <button 
                onClick={() => { setShowGetInfo(false); setGetInfoTarget(null); }}
                className="text-gray-400 hover:text-white p-0.5 rounded-lg hover:bg-white/10 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Inspector Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5 scrollbar-thin">
              {/* Hero Icon & Title */}
              <div className="flex items-center space-x-3.5 pb-2 border-b border-white/10">
                <div className="relative shrink-0">
                  {getInfoTarget.type === 'dir' ? (
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-lg">
                      <Folder className="w-9 h-9 text-white fill-white/20" />
                    </div>
                  ) : ['tar', 'gz', 'tgz', 'zip'].includes(getInfoTarget.extension || '') ? (
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg">
                      <Archive className="w-9 h-9 text-white" />
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-700 to-slate-900 border border-white/10 flex items-center justify-center shadow-lg">
                      <FileText className="w-9 h-9 text-gray-300" />
                    </div>
                  )}
                  {fileTags[getInfoTarget.name] && (
                    <span 
                      className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full border-2 border-[#1e1e2e] shadow"
                      style={{ 
                        backgroundColor: MACOS_TAGS.find(t => t.id === fileTags[getInfoTarget.name])?.color || '#3b82f6' 
                      }}
                    />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-sm text-white break-words select-text">
                    {getInfoTarget.name}
                  </h3>
                  <p className="text-[11px] text-gray-400 font-medium">
                    {getFileKind(getInfoTarget)}
                  </p>
                  <p className="text-[11px] text-blue-400 font-mono mt-0.5">
                    {getInfoTarget.size} {getInfoTarget.rawSize ? `(${getInfoTarget.rawSize.toLocaleString()} bytes)` : ''}
                  </p>
                </div>
              </div>

              {/* General Metadata Section */}
              <div className="bg-[#14141e]/80 border border-white/10 rounded-2xl p-3 space-y-2 text-xs">
                <div className="flex items-center justify-between text-gray-400 font-semibold text-[10px] uppercase tracking-wider">
                  <span>General Information</span>
                  <HardDrive className="w-3 h-3 text-gray-500" />
                </div>
                <div className="space-y-1.5 font-mono text-[11px] pt-1">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 font-sans">Kind:</span>
                    <span className="text-gray-200">{getFileKind(getInfoTarget)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 font-sans">Size:</span>
                    <span className="text-gray-200">{getInfoTarget.size}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 font-sans">Where:</span>
                    <div className="flex items-center space-x-1.5 truncate max-w-[200px]">
                      <span className="text-blue-400 truncate" title={`${currentPath === '/' ? '' : currentPath}/${getInfoTarget.name}`}>
                        {currentPath === '/' ? `/${getInfoTarget.name}` : `${currentPath}/${getInfoTarget.name}`}
                      </span>
                      <button 
                        onClick={() => {
                          const full = currentPath === '/' ? `/${getInfoTarget.name}` : `${currentPath}/${getInfoTarget.name}`;
                          navigator.clipboard.writeText(full);
                          showToast('Copied full path to clipboard');
                        }}
                        className="text-gray-500 hover:text-white shrink-0 p-0.5"
                        title="Copy Path"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500 font-sans">Modified:</span>
                    <span className="text-gray-300">{getInfoTarget.modified}</span>
                  </div>
                </div>
              </div>

              {/* macOS Tags Palette */}
              <div className="bg-[#14141e]/80 border border-white/10 rounded-2xl p-3 space-y-2">
                <div className="flex items-center justify-between text-gray-400 font-semibold text-[10px] uppercase tracking-wider">
                  <span>Tags</span>
                  <Tag className="w-3 h-3 text-gray-500" />
                </div>
                <div className="flex items-center space-x-2 pt-1">
                  {MACOS_TAGS.map(t => {
                    const isTagged = fileTags[getInfoTarget.name] === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          setFileTags(prev => {
                            const next = { ...prev };
                            if (next[getInfoTarget.name] === t.id) {
                              delete next[getInfoTarget.name];
                              showToast(`Removed ${t.name} tag`);
                            } else {
                              next[getInfoTarget.name] = t.id;
                              showToast(`Tagged as ${t.name}`);
                            }
                            return next;
                          });
                        }}
                        className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                          isTagged ? 'ring-2 ring-white scale-110 shadow-md' : 'opacity-70 hover:opacity-100 hover:scale-105'
                        }`}
                        style={{ backgroundColor: t.color }}
                        title={t.name}
                      >
                        {isTagged && <Check className="w-3 h-3 text-white drop-shadow" />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sharing & Permissions Section */}
              <div className="bg-[#14141e]/80 border border-white/10 rounded-2xl p-3 space-y-2.5">
                <div className="flex items-center justify-between text-gray-400 font-semibold text-[10px] uppercase tracking-wider">
                  <span>Sharing & Permissions</span>
                  <span className="font-mono text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/20">
                    {getInfoTarget.permissions}
                  </span>
                </div>

                <div className="border border-white/5 rounded-xl divide-y divide-white/5 overflow-hidden text-[11px] font-sans">
                  <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.02]">
                    <div className="flex items-center space-x-2">
                      <span className="text-gray-400">Owner ({getInfoTarget.owner || 'root'})</span>
                    </div>
                    <span className="text-emerald-400 font-medium">Read & Write</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-gray-400">Staff / Group</span>
                    <span className="text-gray-300">Read only</span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-1.5 bg-white/[0.02]">
                    <span className="text-gray-400">Everyone</span>
                    <span className="text-gray-300">Read only</span>
                  </div>
                </div>

                {/* 1-Click Permissions Presets */}
                <div className="space-y-1.5 pt-1">
                  <span className="text-[10px] text-gray-500 font-medium block">Quick Apply Permissions Mode:</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { mode: '755', label: '755 Standard' },
                      { mode: '644', label: '644 Read/Write' },
                      { mode: '700', label: '700 Private' },
                      { mode: '777', label: '777 Full' },
                    ].map(p => (
                      <button
                        key={p.mode}
                        onClick={async () => {
                          const targetPath = currentPath === '/' ? `/${getInfoTarget.name}` : `${currentPath}/${getInfoTarget.name}`;
                          try {
                            await sftpChmod(activeConnId, targetPath, parseInt(p.mode, 8));
                            setGetInfoTarget(prev => prev ? { ...prev, permissions: `0${p.mode}` } : null);
                            await loadDirectory(currentPath);
                            showToast(`Permissions updated to ${p.mode}`);
                          } catch (err: any) {
                            alert(`Failed to set mode: ${err?.message || err}`);
                          }
                        }}
                        className="px-2 py-1 rounded-lg bg-white/5 hover:bg-blue-600 hover:text-white text-[10px] font-mono text-gray-300 text-center transition-colors border border-white/5"
                        title={`Apply chmod ${p.mode}`}
                      >
                        {p.mode}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Inspector Action Footer */}
            <div className="px-4 py-2.5 bg-[#14141e]/90 border-t border-white/10 flex items-center justify-between shrink-0">
              <div className="flex items-center space-x-2">
                {getInfoTarget.type === 'file' && (
                  <>
                    <button
                      onClick={() => {
                        openFileTarget(getInfoTarget.name);
                        setShowGetInfo(false);
                      }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium shadow-md transition-colors flex items-center space-x-1"
                    >
                      <FileCode className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>
                    <button
                      onClick={() => handleDownloadFile(getInfoTarget)}
                      className="px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 rounded-xl text-xs font-medium transition-colors flex items-center space-x-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    handleOpenTerminalHere();
                    setShowGetInfo(false);
                  }}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-gray-200 rounded-xl text-xs font-medium transition-colors flex items-center space-x-1"
                >
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Terminal</span>
                </button>
              </div>

              <button
                onClick={() => { setShowGetInfo(false); setGetInfoTarget(null); }}
                className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white rounded-xl text-xs font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permission Denied Alert Modal */}
      {permissionAlert && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="bg-[#1e1e2e]/98 border border-red-500/40 rounded-3xl w-full max-w-md shadow-2xl p-6 space-y-4 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-red-500/15 border border-red-500/30 flex items-center justify-center shadow-lg text-red-400">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Access Restricted</h3>
              <p className="text-xs text-gray-300 mt-2 leading-relaxed">{permissionAlert}</p>
              <p className="text-[11px] text-gray-500 mt-1">This directory requires elevated root privileges to inspect or read contents.</p>
            </div>
            <div className="flex justify-center space-x-3 pt-2">
              <button
                onClick={() => {
                  setPermissionAlert(null);
                  goBack();
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md transition-colors"
              >
                Go Back
              </button>
              <button
                onClick={() => setPermissionAlert(null)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white rounded-xl text-xs font-medium transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Shell Script Execution Output Modal */}
      {scriptModal && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="bg-[#1e1e2e]/98 border border-white/20 rounded-3xl w-full max-w-2xl h-[480px] shadow-2xl flex flex-col overflow-hidden">
            {/* Window Chrome Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#14141e]/90 border-b border-white/10 shrink-0">
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => setScriptModal(null)}
                  className="w-3 h-3 rounded-full bg-[#FF5F56] hover:brightness-110 flex items-center justify-center text-[8px] text-black font-bold"
                  title="Close"
                >
                  ✕
                </button>
                <div className="w-3 h-3 rounded-full bg-[#FFBD2E] opacity-75" />
                <div className="w-3 h-3 rounded-full bg-[#27C93F] opacity-75" />
                <span className="font-semibold text-white pl-2 text-xs font-mono">{scriptModal.file.name}</span>
              </div>
              <div className="flex items-center space-x-2">
                {scriptModal.status === 'running' ? (
                  <span className="flex items-center space-x-1.5 text-xs text-blue-400 bg-blue-500/10 px-2.5 py-0.5 rounded-full border border-blue-500/20">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Running...</span>
                  </span>
                ) : scriptModal.status === 'success' ? (
                  <span className="flex items-center space-x-1 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                    <Check className="w-3 h-3" />
                    <span>Success (Exit 0)</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-1 text-xs text-red-400 bg-red-500/10 px-2.5 py-0.5 rounded-full border border-red-500/20">
                    <AlertTriangle className="w-3 h-3" />
                    <span>Failed / Exited with Error</span>
                  </span>
                )}
              </div>
            </div>

            {/* Terminal Output Body */}
            <div className="flex-1 bg-[#0d0d15] p-4 overflow-y-auto font-mono text-xs text-gray-200 select-text leading-relaxed">
              <pre className="whitespace-pre-wrap font-mono">{scriptModal.output}</pre>
            </div>

            {/* Modal Footer */}
            <div className="px-4 py-2.5 bg-[#14141e]/90 border-t border-white/10 flex items-center justify-between shrink-0">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(scriptModal.output);
                  showToast('Copied script output to clipboard');
                }}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-gray-200 rounded-xl text-xs font-medium transition-colors flex items-center space-x-1.5"
              >
                <Copy className="w-3.5 h-3.5 text-gray-400" />
                <span>Copy Output</span>
              </button>
              <button
                onClick={() => setScriptModal(null)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Toast Banner */}
      {toastMessage && (
        <div className="fixed top-12 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="bg-[#1e1e2e]/95 backdrop-blur-2xl border border-white/20 shadow-2xl px-4 py-2 rounded-full text-xs text-white flex items-center space-x-2 font-medium">
            <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
}
