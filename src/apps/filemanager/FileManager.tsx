import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Folder, HardDrive, ChevronRight, Upload, AlertTriangle, RefreshCw, Grid, Plus, X, ArrowLeft
} from 'lucide-react';
import { useConnectionStore, useEditorStore, useSettingsStore, useFileClipboardStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';
import { 
  sftpListDir, sftpReadFileBase64, sftpReadTextFile, sftpWriteFile, sftpWriteTextFile,
  sftpRename, sftpMkdir, sftpDownloadFile, sshExec, sendDesktopNotification, sftpFolderSize 
} from '../../lib/tauri-bridge';

import { 
  RemoteFile, ClipboardState, ContextMenuState, FinderTab, UndoAction, 
  TransferState, isMediaFile, formatRawBytes, getFileKind, 
  getNextAvailableCopyName 
} from './types';

import { FinderSidebar } from './components/FinderSidebar';
import { FinderToolbar } from './components/FinderToolbar';
import { FinderContextMenu } from './components/FinderContextMenu';
import { IconsView } from './components/IconsView';
import { ListView } from './components/ListView';
import { ColumnsView } from './components/ColumnsView';
import { GalleryView } from './components/GalleryView';

import { LiveTransferModal } from './modals/LiveTransferModal';
import { LiveArchiveModal } from './modals/LiveArchiveModal';
import { LiveDeleteModal } from './modals/LiveDeleteModal';
import { PackageInstallModal } from './modals/PackageInstallModal';
import { QuickLookModal } from './modals/QuickLookModal';
import { GetInfoModal } from './modals/GetInfoModal';
import { ChmodModal, ChownModal } from './modals/PermissionsModal';
import { 
  NewFolderModal, NewFileModal, RenameModal, ScriptOutputModal, PermissionAlertModal 
} from './modals/ItemActionModals';

export const FileManager: React.FC = () => {
  const { activeConnectionId, connections } = useConnectionStore();
  const activeConnId = activeConnectionId || 'default';
  const activeConn = connections.find(c => c.id === activeConnectionId);
  const currentUsername = activeConn?.username || 'root';
  const userHome = currentUsername === 'root' ? '/root' : `/home/${currentUsername}`;

  // Multi-tab Finder State
  const [tabs, setTabs] = useState<FinderTab[]>([
    {
      id: 'tab-1',
      title: 'File System',
      path: '/',
      history: ['/'],
      historyIndex: 0,
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');
  const currentTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const currentPath = currentTab ? currentTab.path : '/';
  const history = currentTab ? currentTab.history : ['/'];
  const historyIndex = currentTab ? currentTab.historyIndex : 0;

  // View Mode: 'icons' | 'list' | 'columns' | 'gallery'
  const [view, setView] = useState<'icons' | 'list' | 'columns' | 'gallery'>('icons');
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [folderSizes, setFolderSizes] = useState<Record<string, string>>({});
  const [calculatingFolders, setCalculatingFolders] = useState<Set<string>>(new Set());
  const typeaheadBufferRef = useRef<string>('');
  const typeaheadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [typeaheadDisplay, setTypeaheadDisplay] = useState<string>('');
  const { clipboard: sharedClipboard, setClipboard: sharedSetClipboard, clearClipboard: sharedClearClipboard } = useFileClipboardStore();
  const clipboard: ClipboardState | null = sharedClipboard && sharedClipboard.items.length > 0 ? {
    files: sharedClipboard.items.map(i => i.name),
    isCut: sharedClipboard.isCut,
    sourceDir: sharedClipboard.sourceDir,
  } : null;
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('/');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [search, setSearch] = useState('');
  const [undoStack, setUndoStack] = useState<UndoAction[]>([]);

  // List View Sorting State
  const [sortField, setSortField] = useState<'name' | 'modified' | 'size' | 'kind'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Sidebar Resizability State
  const [sidebarWidth, setSidebarWidth] = useState<number>(220);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const userManuallyToggledSidebarRef = useRef(false);

  // Responsive Container Tracking & Status Bar Refs
  const rootContainerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const bottomBreadcrumbsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!rootContainerRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    ro.observe(rootContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // Auto-collapse sidebar if window is opened/resized very small (< 520px) and user hasn't manually toggled it
  useEffect(() => {
    if (!userManuallyToggledSidebarRef.current && containerWidth > 0) {
      if (containerWidth < 520 && isSidebarOpen) {
        setIsSidebarOpen(false);
      } else if (containerWidth >= 640 && !isSidebarOpen) {
        setIsSidebarOpen(true);
      }
    }
  }, [containerWidth, isSidebarOpen]);

  const handleToggleSidebar = useCallback(() => {
    userManuallyToggledSidebarRef.current = true;
    setIsSidebarOpen(prev => !prev);
  }, []);

  // Auto-scroll bottom breadcrumbs to the right so active directory is always visible
  useEffect(() => {
    if (bottomBreadcrumbsRef.current) {
      bottomBreadcrumbsRef.current.scrollLeft = bottomBreadcrumbsRef.current.scrollWidth;
    }
  }, [currentPath]);

  // Dragging State
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [draggedItems, setDraggedItems] = useState<string[]>([]);
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
  const [openingFolder, setOpeningFolder] = useState<string | null>(null);

  // In-Memory Directory Cache
  const dirCache = useRef<Map<string, { files: RemoteFile[]; timestamp: number }>>(new Map());

  // Quick Look State
  const [quickLookFile, setQuickLookFile] = useState<RemoteFile | null>(null);
  const [quickLookContent, setQuickLookContent] = useState<string>('');
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'audio' | 'pdf' | 'text' | null>(null);

  // Inspector Preview State for Columns & Gallery
  const [inspectorPreview, setInspectorPreview] = useState<{
    file: RemoteFile;
    type: 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'dir';
    url?: string;
    text?: string;
    loading: boolean;
  } | null>(null);

  // Rubber-Band Selection State
  const [finderSelectionBox, setFinderSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null);
  const [isFinderSelecting, setIsFinderSelecting] = useState(false);
  const finderFileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const finderContainerRef = useRef<HTMLDivElement | null>(null);

  // Toolbar & Header Controls
  const [iconSize, setIconSize] = useState<number>(64);
  const [showIconSizeSlider, setShowIconSizeSlider] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);

  // Search State (Always Global Search)
  const [globalResults, setGlobalResults] = useState<RemoteFile[]>([]);
  const [isSearchingGlobal, setIsSearchingGlobal] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);

  // Path & Permission Errors
  const [pathError, setPathError] = useState<string | null>(null);
  const [permissionAlert, setPermissionAlert] = useState<string | null>(null);

  // Modals State
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<string>('');
  const [showChmodModal, setShowChmodModal] = useState(false);
  const [chmodTarget, setChmodTarget] = useState<RemoteFile | null>(null);
  const [showChownModal, setShowChownModal] = useState(false);
  const [chownTarget, setChownTarget] = useState<RemoteFile | null>(null);
  const [showGetInfo, setShowGetInfo] = useState(false);
  const [getInfoTarget, setGetInfoTarget] = useState<RemoteFile | null>(null);
  const [showLiveDeleteModal, setShowLiveDeleteModal] = useState(false);
  const [deleteItemsTarget, setDeleteItemsTarget] = useState<string[]>([]);
  const [packageInstallerFile, setPackageInstallerFile] = useState<RemoteFile | null>(null);
  const [scriptModal, setScriptModal] = useState<{
    file: RemoteFile;
    output: string;
    status: 'running' | 'success' | 'failed';
  } | null>(null);

  const [liveArchiveModal, setLiveArchiveModal] = useState<{
    isOpen: boolean;
    mode: 'compress' | 'extract';
    archiveType?: 'tar.gz' | 'zip';
    items?: string[];
    targetArchive?: string;
  }>({
    isOpen: false,
    mode: 'compress',
  });

  // Live File Transfers (Move, Copy/Paste, Upload, Download)
  const [transferState, setTransferState] = useState<TransferState | null>(null);
  const transferCancelledRef = useRef<boolean>(false);

  // External Stores
  const { openApp } = useWindowManager();
  const { openFileInEditor, finderTargetPath, clearFinderTarget, openTerminalInDir } = useEditorStore();
  const { favorites, addFavorite, removeFavorite, pinToDesktop, showHiddenFiles, updateSettings } = useSettingsStore();

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2800);
  }, []);

  // Directory Loader
  const loadDirectory = useCallback(async (path: string, force: boolean = false) => {
    const clean = path.replace(/\/+/g, '/') || '/';
    if (!force && dirCache.current.has(clean)) {
      const cached = dirCache.current.get(clean)!;
      setFiles(cached.files);
      setOpeningFolder(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPathError(null);
    try {
      const entries = await sftpListDir(activeConnId, clean);
      if (entries && Array.isArray(entries)) {
        const mapped: RemoteFile[] = entries.map((item: any) => ({
          name: item.name,
          type: item.is_dir ? 'dir' : 'file',
          size: item.is_dir ? '—' : formatRawBytes(item.size),
          rawSize: item.is_dir ? -1 : (item.size || 0),
          permissions: item.permissions || (item.is_dir ? 'drwxr-xr-x' : '-rw-r--r--'),
          owner: item.owner || 'root',
          modified: item.modified ? new Date(item.modified * 1000).toLocaleDateString() : 'Recent',
          extension: item.name.includes('.') ? item.name.split('.').pop()?.toLowerCase() : undefined,
        }));
        setFiles(mapped);
        dirCache.current.set(clean, { files: mapped, timestamp: Date.now() });
      } else {
        setFiles([]);
      }
    } catch (err: any) {
      console.warn('SFTP directory list failed:', err);
      const specialPaths = [`${userHome}/Desktop`, `${userHome}/Documents`, `${userHome}/Downloads`];
      if (specialPaths.includes(clean)) {
        try {
          await sftpMkdir(activeConnId, clean);
          const retryEntries = await sftpListDir(activeConnId, clean);
          if (retryEntries && Array.isArray(retryEntries)) {
            const mapped: RemoteFile[] = retryEntries.map((item: any) => ({
              name: item.name,
              type: item.is_dir ? 'dir' : 'file',
              size: item.is_dir ? '—' : formatRawBytes(item.size),
              rawSize: item.is_dir ? -1 : (item.size || 0),
              permissions: item.permissions || (item.is_dir ? 'drwxr-xr-x' : '-rw-r--r--'),
              owner: item.owner || 'root',
              modified: item.modified ? new Date(item.modified * 1000).toLocaleDateString() : 'Recent',
              extension: item.name.includes('.') ? item.name.split('.').pop()?.toLowerCase() : undefined,
            }));
            setFiles(mapped);
            dirCache.current.set(clean, { files: mapped, timestamp: Date.now() });
            showToast(`Auto-created folder: ${clean.split('/').pop()}`);
            window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
            return;
          }
        } catch (createErr) {
          console.warn('Auto-create failed:', createErr);
        }
      }

      const errMsg = String(err?.message || err);
      if (errMsg.toLowerCase().includes('permission denied')) {
        setPermissionAlert(`Permission Denied: You do not have permission to access "${clean}".`);
      } else {
        setPathError(`Path not found: "${clean}". The specified directory does not exist or cannot be accessed.`);
        showToast(`Path not found: ${clean}`);
      }
      setFiles([]);
    } finally {
      setIsLoading(false);
      setOpeningFolder(null);
    }
  }, [activeConnId, showToast, userHome]);

  useEffect(() => {
    loadDirectory(currentPath);
    setPathInput(currentPath);
  }, [currentPath, loadDirectory]);

  // Handle external finder target navigation (from Desktop icons) -> Auto-open new tab
  useEffect(() => {
    if (finderTargetPath) {
      handleNewTab(finderTargetPath);
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

  // Sidebar resizer drag listener
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

  // Global Recursive Search (Always Active When Typing Search)
  const executeGlobalSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setGlobalResults([]);
      return;
    }
    setIsSearchingGlobal(true);
    try {
      const cleanQ = query.trim().replace(/['"\\]/g, '');
      const cmd = `find '${currentPath}' -maxdepth 4 -iname '*${cleanQ}*' 2>/dev/null | head -n 120`;
      const res = await sshExec(activeConnId, cmd);
      if (res.stdout) {
        const lines = res.stdout.split('\n').map(l => l.trim()).filter(Boolean);
        const mapped: RemoteFile[] = lines.map(line => {
          const parts = line.split('/');
          const name = parts[parts.length - 1] || line;
          const isDir = !name.includes('.');
          return {
            name,
            type: isDir ? 'dir' : 'file',
            size: line,
            rawSize: 0,
            permissions: isDir ? 'drwxr-xr-x' : '-rw-r--r--',
            owner: currentUsername,
            modified: line,
            extension: name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined,
          };
        });
        setGlobalResults(mapped);
      } else {
        setGlobalResults([]);
      }
    } catch (err) {
      console.warn('Global search failed:', err);
      setGlobalResults([]);
    } finally {
      setIsSearchingGlobal(false);
    }
  }, [activeConnId, currentPath, currentUsername]);

  useEffect(() => {
    if (search.trim().length >= 2) {
      const timer = setTimeout(() => {
        executeGlobalSearch(search);
      }, 350);
      return () => clearTimeout(timer);
    } else {
      setGlobalResults([]);
    }
  }, [search, executeGlobalSearch]);

  // Navigation Handlers
  const navigateTo = (path: string) => {
    const clean = path.replace(/\/+/g, '/') || '/';
    if (currentPath === clean) {
      dirCache.current.delete(clean);
      loadDirectory(clean, true);
      return;
    }
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

  // Tab Operations
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

  // Filtered & Sorted Files
  const filteredFiles = files.filter(f => {
    if (!showHiddenFiles && f.name.startsWith('.')) return false;
    return f.name.toLowerCase().includes(search.toLowerCase());
  });

  const sortedFiles = [...filteredFiles].map(f => {
    if (f.type === 'dir') {
      const calcSize = folderSizes[f.name];
      if (calcSize) {
        return { ...f, size: calcSize };
      }
      return { ...f, size: f.size || '—' };
    }
    return f;
  }).sort((a, b) => {
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

  const activeDisplayFiles = search.trim().length >= 2 ? globalResults : sortedFiles;
  const selectedFileObj = activeDisplayFiles.find(f => selectedFiles.has(f.name)) || activeDisplayFiles[0];

  const availableLetters = React.useMemo(() => {
    const set = new Set<string>();
    for (const f of activeDisplayFiles) {
      const firstChar = f.name.charAt(0).toUpperCase();
      if (/[A-Z]/.test(firstChar)) {
        set.add(firstChar);
      } else {
        set.add('#');
      }
    }
    return set;
  }, [activeDisplayFiles]);

  const calculateFolderSize = useCallback(async (folderName: string) => {
    const fullPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
    setCalculatingFolders(prev => new Set(prev).add(folderName));
    setFolderSizes(prev => ({ ...prev, [folderName]: 'Calculating...' }));
    try {
      const sizeStr = await sftpFolderSize(activeConnId, fullPath);
      if (sizeStr && sizeStr !== '—') {
        setFolderSizes(prev => ({ ...prev, [folderName]: sizeStr }));
        showToast(`Folder size: ${folderName} = ${sizeStr}`);
      } else {
        setFolderSizes(prev => ({ ...prev, [folderName]: '0 B' }));
      }
    } catch (err) {
      console.warn('Failed to calculate folder size:', err);
      setFolderSizes(prev => ({ ...prev, [folderName]: '—' }));
    } finally {
      setCalculatingFolders(prev => {
        const next = new Set(prev);
        next.delete(folderName);
        return next;
      });
    }
  }, [currentPath, activeConnId]);

  const handleLetterJump = useCallback((letter: string) => {
    const l = letter.toLowerCase();
    const displayList = search.trim().length >= 2 ? globalResults : sortedFiles;
    if (displayList.length === 0) return;

    const matches = displayList.filter(f => {
      if (l === '#') {
        return !/^[a-zA-Z]/.test(f.name);
      }
      return f.name.toLowerCase().startsWith(l);
    });

    if (matches.length === 0) {
      showToast(`No items starting with "${letter.toUpperCase()}"`);
      return;
    }

    const currentSelected = selectedFiles.size === 1 ? Array.from(selectedFiles)[0] : null;
    const currIdx = matches.findIndex(f => f.name === currentSelected);
    const nextMatch = matches[(currIdx + 1) % matches.length];

    setSelectedFiles(new Set([nextMatch.name]));
    const idxInList = displayList.findIndex(f => f.name === nextMatch.name);
    setLastSelectedIndex(idxInList);

    const el = finderFileRefs.current.get(nextMatch.name);
    if (el) {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }

    setTypeaheadDisplay(letter.toUpperCase());
    if (typeaheadTimeoutRef.current) clearTimeout(typeaheadTimeoutRef.current);
    typeaheadTimeoutRef.current = setTimeout(() => {
      setTypeaheadDisplay('');
    }, 900);
  }, [search, globalResults, sortedFiles, selectedFiles]);

  const handleSort = (field: 'name' | 'modified' | 'size' | 'kind') => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Selection
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
      setSearch('');
      setOpeningFolder(f.name);
      navigateTo(currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`);
    } else if (
      f.name.toLowerCase().endsWith('.deb') ||
      f.name.toLowerCase().endsWith('.rpm') ||
      f.name.toLowerCase().endsWith('.sh') ||
      f.name.toLowerCase().endsWith('.bash')
    ) {
      setPackageInstallerFile(f);
    } else if (isMediaFile(f)) {
      handleQuickLookToggle(f, true);
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

  // Quick Look Toggle (<kbd>Ctrl</kbd> + <kbd>Space</kbd>)
  const handleQuickLookToggle = async (targetFile?: RemoteFile, forceOpen: boolean = false) => {
    const file = targetFile || (selectedFiles.size > 0 ? files.find(f => selectedFiles.has(f.name)) : null);
    if (!file) return;

    if (!forceOpen && quickLookFile?.name === file.name) {
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
      const ext = file.extension?.toLowerCase() || '';
      const fullPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
      const videoExts = ['mp4', 'webm', 'ogg', 'mov'];
      const audioExts = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'];

      try {
        if (imageExts.includes(ext)) {
          const b64 = await sftpReadFileBase64(activeConnId, fullPath);
          const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'ico' ? 'image/x-icon' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          setMediaPreviewUrl(`data:${mime};base64,${b64}`);
          setMediaType('image');
        } else if (videoExts.includes(ext)) {
          const b64 = await sftpReadFileBase64(activeConnId, fullPath);
          setMediaPreviewUrl(`data:video/${ext === 'mov' ? 'mp4' : ext};base64,${b64}`);
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
      }
    } else {
      setQuickLookContent(`Directory with remote server items`);
      setMediaType('text');
    }
  };

  // Live Inspector Preview Effect for Miller Columns View & Gallery View
  useEffect(() => {
    if ((view !== 'columns' && view !== 'gallery') || !selectedFileObj) {
      setInspectorPreview(null);
      return;
    }
    const target = selectedFileObj;
    if (target.type === 'dir') {
      setInspectorPreview({
        file: target,
        type: 'dir',
        loading: false,
      });
      return;
    }

    let isCancelled = false;
    setInspectorPreview({
      file: target,
      type: 'text',
      loading: true,
    });

    const fullPath = currentPath === '/' ? `/${target.name}` : `${currentPath}/${target.name}`;
    const ext = target.extension?.toLowerCase() || '';
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov'];
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg'];

    (async () => {
      try {
        if (imageExts.includes(ext)) {
          const b64 = await sftpReadFileBase64(activeConnId, fullPath);
          if (isCancelled) return;
          const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'ico' ? 'image/x-icon' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
          setInspectorPreview({
            file: target,
            type: 'image',
            url: `data:${mime};base64,${b64}`,
            loading: false,
          });
        } else if (videoExts.includes(ext)) {
          const b64 = await sftpReadFileBase64(activeConnId, fullPath);
          if (isCancelled) return;
          setInspectorPreview({
            file: target,
            type: 'video',
            url: `data:video/${ext === 'mov' ? 'mp4' : ext};base64,${b64}`,
            loading: false,
          });
        } else if (audioExts.includes(ext)) {
          const b64 = await sftpReadFileBase64(activeConnId, fullPath);
          if (isCancelled) return;
          setInspectorPreview({
            file: target,
            type: 'audio',
            url: `data:audio/${ext === 'mp3' ? 'mpeg' : ext};base64,${b64}`,
            loading: false,
          });
        } else if (ext === 'pdf') {
          const b64 = await sftpReadFileBase64(activeConnId, fullPath);
          if (isCancelled) return;
          setInspectorPreview({
            file: target,
            type: 'pdf',
            url: `data:application/pdf;base64,${b64}`,
            loading: false,
          });
        } else {
          const txt = await sftpReadTextFile(activeConnId, fullPath);
          if (isCancelled) return;
          setInspectorPreview({
            file: target,
            type: 'text',
            text: txt ? (txt.length > 2500 ? txt.slice(0, 2500) + '\n... (preview truncated)' : txt) : '(Empty file)',
            loading: false,
          });
        }
      } catch (err: any) {
        if (!isCancelled) {
          setInspectorPreview({
            file: target,
            type: 'text',
            text: `(Preview unavailable: ${err?.message || err})`,
            loading: false,
          });
        }
      }
    })();

    return () => {
      isCancelled = true;
    };
  }, [view, selectedFileObj, activeConnId, currentPath]);

  // Rubber-band marquee selection handlers
  const handleFinderMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.file-card') || target.closest('button') || target.closest('input') || target.closest('.no-select-box')) {
      return;
    }
    const container = finderContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

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

  useEffect(() => {
    if (!isFinderSelecting) return;
    const handleGlobalMouseUp = () => {
      setIsFinderSelecting(false);
      setFinderSelectionBox(null);
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [isFinderSelecting]);

  // =========================================================================
  // LIVE PROGRESS TRANSFERS (Move, Copy/Paste, Upload, Download)
  // =========================================================================

  // 1. Live Move Items (Drag & Drop or Cut-Paste)
  const handleMoveItems = async (sourceNames: string[], targetFolderName: string) => {
    if (!sourceNames || sourceNames.length === 0 || !targetFolderName) return;
    const valid = sourceNames.filter(n => n !== targetFolderName);
    if (valid.length === 0) return;

    const destDir = currentPath === '/' ? `/${targetFolderName}` : `${currentPath}/${targetFolderName}`;
    transferCancelledRef.current = false;

    setTransferState({
      isOpen: true,
      type: 'move',
      title: `Moving ${valid.length} item${valid.length > 1 ? 's' : ''}`,
      items: valid,
      currentItemName: valid[0],
      sourcePath: currentPath,
      destPath: destDir,
      currentCount: 0,
      totalCount: valid.length,
      progressPercent: 0,
      status: 'running',
    });

    try {
      for (let i = 0; i < valid.length; i++) {
        if (transferCancelledRef.current) {
          setTransferState(prev => prev ? { ...prev, status: 'cancelled' } : null);
          showToast('Move cancelled');
          break;
        }

        const sourceName = valid[i];
        setTransferState(prev => prev ? {
          ...prev,
          currentItemName: sourceName,
          currentCount: i,
          progressPercent: Math.round((i / valid.length) * 100),
        } : null);

        const src = currentPath === '/' ? `/${sourceName}` : `${currentPath}/${sourceName}`;
        const dest = `${destDir}/${sourceName}`;
        await sftpRename(activeConnId, src, dest);
        setUndoStack(prev => [...prev, { type: 'move', originalPath: src, targetPath: dest }]);

        setTransferState(prev => prev ? {
          ...prev,
          currentCount: i + 1,
          progressPercent: Math.round(((i + 1) / valid.length) * 100),
        } : null);
      }

      setTransferState(prev => prev && prev.status !== 'cancelled' ? {
        ...prev,
        status: 'completed',
        progressPercent: 100,
      } : prev);

      dirCache.current.delete(currentPath);
      dirCache.current.delete(destDir);
      await loadDirectory(currentPath, true);
      showToast(`Moved ${valid.length} item${valid.length > 1 ? 's' : ''} into "${targetFolderName}"`);
      window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
    } catch (err: any) {
      setTransferState(prev => prev ? {
        ...prev,
        status: 'error',
        errorMessage: String(err?.message || err),
      } : null);
    } finally {
      setDraggedItem(null);
      setDraggedItems([]);
      setDropTargetDir(null);
    }
  };

  const handleMoveToSidebarDir = async (sourceNameOrNames: string | string[], destDirPath: string) => {
    const list = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
    if (list.length === 0 || !destDirPath || destDirPath === currentPath) return;

    transferCancelledRef.current = false;
    setTransferState({
      isOpen: true,
      type: 'move',
      title: `Moving ${list.length} item${list.length > 1 ? 's' : ''}`,
      items: list,
      currentItemName: list[0],
      sourcePath: currentPath,
      destPath: destDirPath,
      currentCount: 0,
      totalCount: list.length,
      progressPercent: 0,
      status: 'running',
    });

    try {
      for (let i = 0; i < list.length; i++) {
        if (transferCancelledRef.current) {
          setTransferState(prev => prev ? { ...prev, status: 'cancelled' } : null);
          showToast('Move cancelled');
          break;
        }

        const sourceName = list[i];
        setTransferState(prev => prev ? {
          ...prev,
          currentItemName: sourceName,
          currentCount: i,
          progressPercent: Math.round((i / list.length) * 100),
        } : null);

        const src = currentPath === '/' ? `/${sourceName}` : `${currentPath}/${sourceName}`;
        const dest = destDirPath === '/' ? `/${sourceName}` : `${destDirPath}/${sourceName}`;
        await sftpRename(activeConnId, src, dest);
        setUndoStack(prev => [...prev, { type: 'move', originalPath: src, targetPath: dest }]);

        setTransferState(prev => prev ? {
          ...prev,
          currentCount: i + 1,
          progressPercent: Math.round(((i + 1) / list.length) * 100),
        } : null);
      }

      setTransferState(prev => prev && prev.status !== 'cancelled' ? {
        ...prev,
        status: 'completed',
        progressPercent: 100,
      } : prev);

      dirCache.current.delete(currentPath);
      dirCache.current.delete(destDirPath);
      await loadDirectory(currentPath, true);
      showToast(`Moved ${list.length} item${list.length > 1 ? 's' : ''} to ${destDirPath}`);
      window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
    } catch (err: any) {
      setTransferState(prev => prev ? {
        ...prev,
        status: 'error',
        errorMessage: String(err?.message || err),
      } : null);
    } finally {
      setDraggedItem(null);
      setDraggedItems([]);
      setDropTargetDir(null);
    }
  };

  // 2. Live Paste / Duplicate (Copy or Cut Items)
  const handleCopy = () => {
    if (selectedFiles.size === 0) return;
    const fileList = Array.from(selectedFiles);
    sharedSetClipboard({
      items: fileList.map(name => ({
        name,
        path: currentPath === '/' ? `/${name}` : `${currentPath}/${name}`,
        is_dir: files.find(f => f.name === name)?.type === 'dir'
      })),
      isCut: false,
      sourceDir: currentPath,
    });
    showToast(`Copied ${selectedFiles.size} item${selectedFiles.size > 1 ? 's' : ''} to clipboard`);
  };

  const handleCut = () => {
    if (selectedFiles.size === 0) return;
    const fileList = Array.from(selectedFiles);
    sharedSetClipboard({
      items: fileList.map(name => ({
        name,
        path: currentPath === '/' ? `/${name}` : `${currentPath}/${name}`,
        is_dir: files.find(f => f.name === name)?.type === 'dir'
      })),
      isCut: true,
      sourceDir: currentPath,
    });
    showToast(`Cut ${selectedFiles.size} item${selectedFiles.size > 1 ? 's' : ''} to clipboard`);
  };

  const handlePaste = async () => {
    const effectiveClipboard = (sharedClipboard && sharedClipboard.items.length > 0)
      ? {
          files: sharedClipboard.items.map(i => i.name),
          isCut: sharedClipboard.isCut,
          sourceDir: sharedClipboard.sourceDir,
        }
      : null;

    if (!effectiveClipboard || effectiveClipboard.files.length === 0) return;
    const isSameDir = effectiveClipboard.sourceDir === currentPath;
    if (isSameDir && effectiveClipboard.isCut) {
      showToast('Items already in this folder');
      return;
    }

    transferCancelledRef.current = false;
    const transferType = effectiveClipboard.isCut ? 'move' : 'copy';
    const actionLabel = effectiveClipboard.isCut ? 'Moving' : 'Copying';

    setTransferState({
      isOpen: true,
      type: transferType,
      title: `${actionLabel} ${effectiveClipboard.files.length} item${effectiveClipboard.files.length > 1 ? 's' : ''}`,
      items: effectiveClipboard.files,
      currentItemName: effectiveClipboard.files[0],
      sourcePath: effectiveClipboard.sourceDir,
      destPath: currentPath,
      currentCount: 0,
      totalCount: effectiveClipboard.files.length,
      progressPercent: 0,
      status: 'running',
    });

    try {
      const currentNames = files.map(f => f.name);
      for (let i = 0; i < effectiveClipboard.files.length; i++) {
        if (transferCancelledRef.current) {
          setTransferState(prev => prev ? { ...prev, status: 'cancelled' } : null);
          showToast('Paste cancelled');
          break;
        }

        const name = effectiveClipboard.files[i];
        setTransferState(prev => prev ? {
          ...prev,
          currentItemName: name,
          currentCount: i,
          progressPercent: Math.round((i / effectiveClipboard.files.length) * 100),
        } : null);

        const src = effectiveClipboard.sourceDir === '/' ? `/${name}` : `${effectiveClipboard.sourceDir}/${name}`;
        let destName = name;
        if (isSameDir || currentNames.includes(destName)) {
          destName = getNextAvailableCopyName(name, currentNames);
          currentNames.push(destName);
        }
        const dest = currentPath === '/' ? `/${destName}` : `${currentPath}/${destName}`;
        const cmd = effectiveClipboard.isCut ? `mv '${src}' '${dest}'` : `cp -r '${src}' '${dest}'`;
        await sshExec(activeConnId, cmd);

        setTransferState(prev => prev ? {
          ...prev,
          currentCount: i + 1,
          progressPercent: Math.round(((i + 1) / effectiveClipboard.files.length) * 100),
        } : null);
      }

      setTransferState(prev => prev && prev.status !== 'cancelled' ? {
        ...prev,
        status: 'completed',
        progressPercent: 100,
      } : prev);

      const count = effectiveClipboard.files.length;
      if (effectiveClipboard.isCut) {
        sharedClearClipboard();
      }
      dirCache.current.delete(currentPath);
      dirCache.current.delete(effectiveClipboard.sourceDir);
      await loadDirectory(currentPath, true);
      showToast(`Pasted ${count} item${count > 1 ? 's' : ''}`);
      window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
    } catch (err: any) {
      setTransferState(prev => prev ? {
        ...prev,
        status: 'error',
        errorMessage: String(err?.message || err),
      } : null);
    }
  };

  const handleDuplicate = async () => {
    if (selectedFiles.size === 0) return;
    const items = Array.from(selectedFiles);
    transferCancelledRef.current = false;

    setTransferState({
      isOpen: true,
      type: 'copy',
      title: `Duplicating ${items.length} item${items.length > 1 ? 's' : ''}`,
      items,
      currentItemName: items[0],
      sourcePath: currentPath,
      destPath: currentPath,
      currentCount: 0,
      totalCount: items.length,
      progressPercent: 0,
      status: 'running',
    });

    try {
      const currentNames = files.map(f => f.name);
      for (let i = 0; i < items.length; i++) {
        if (transferCancelledRef.current) {
          setTransferState(prev => prev ? { ...prev, status: 'cancelled' } : null);
          showToast('Duplicate cancelled');
          break;
        }

        const name = items[i];
        setTransferState(prev => prev ? {
          ...prev,
          currentItemName: name,
          currentCount: i,
          progressPercent: Math.round((i / items.length) * 100),
        } : null);

        const src = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
        const copyName = getNextAvailableCopyName(name, currentNames);
        currentNames.push(copyName);
        const dest = currentPath === '/' ? `/${copyName}` : `${currentPath}/${copyName}`;
        await sshExec(activeConnId, `cp -r '${src}' '${dest}'`);

        setTransferState(prev => prev ? {
          ...prev,
          currentCount: i + 1,
          progressPercent: Math.round(((i + 1) / items.length) * 100),
        } : null);
      }

      setTransferState(prev => prev && prev.status !== 'cancelled' ? {
        ...prev,
        status: 'completed',
        progressPercent: 100,
      } : prev);

      dirCache.current.delete(currentPath);
      await loadDirectory(currentPath, true);
      showToast(`Duplicated ${items.length} item${items.length > 1 ? 's' : ''}`);
      window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
    } catch (err: any) {
      setTransferState(prev => prev ? {
        ...prev,
        status: 'error',
        errorMessage: String(err?.message || err),
      } : null);
    }
  };

  // 3. Live File Uploads (Drag-and-Drop or File Selector)
  const processUploadFiles = async (fileList: FileList | File[]) => {
    if (!fileList || fileList.length === 0) return;
    const fileArray = Array.from(fileList);
    const totalBytes = fileArray.reduce((acc, f) => acc + f.size, 0);

    transferCancelledRef.current = false;
    setTransferState({
      isOpen: true,
      type: 'upload',
      title: `Uploading ${fileArray.length} file${fileArray.length > 1 ? 's' : ''}`,
      items: fileArray.map(f => f.name),
      currentItemName: fileArray[0].name,
      sourcePath: 'My Computer',
      destPath: currentPath,
      currentCount: 0,
      totalCount: fileArray.length,
      bytesTransferred: 0,
      totalBytes,
      progressPercent: 0,
      status: 'running',
    });

    let uploadedBytes = 0;

    try {
      for (let i = 0; i < fileArray.length; i++) {
        if (transferCancelledRef.current) {
          setTransferState(prev => prev ? { ...prev, status: 'cancelled' } : null);
          showToast('Upload cancelled');
          break;
        }

        const file = fileArray[i];
        setTransferState(prev => prev ? {
          ...prev,
          currentItemName: file.name,
          currentCount: i,
          progressPercent: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : Math.round((i / fileArray.length) * 100),
        } : null);

        const dest = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        const buf = await file.arrayBuffer();
        await sftpWriteFile(activeConnId, dest, Array.from(new Uint8Array(buf)));
        uploadedBytes += file.size;

        setTransferState(prev => prev ? {
          ...prev,
          currentCount: i + 1,
          bytesTransferred: uploadedBytes,
          progressPercent: totalBytes > 0 ? Math.round((uploadedBytes / totalBytes) * 100) : Math.round(((i + 1) / fileArray.length) * 100),
        } : null);
      }

      setTransferState(prev => prev && prev.status !== 'cancelled' ? {
        ...prev,
        status: 'completed',
        progressPercent: 100,
        bytesTransferred: totalBytes,
      } : prev);

      showToast(`Uploaded ${fileArray.length} file(s) to ${currentPath}`);
      await sendDesktopNotification('Upload Complete', `Uploaded ${fileArray.length} file(s) to ${currentPath}`);
      dirCache.current.delete(currentPath);
      await loadDirectory(currentPath, true);
      window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
    } catch (err: any) {
      setTransferState(prev => prev ? {
        ...prev,
        status: 'error',
        errorMessage: String(err?.message || err),
      } : null);
    } finally {
      if (localFileInputRef.current) {
        localFileInputRef.current.value = '';
      }
    }
  };

  const handleLocalFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      await processUploadFiles(e.target.files);
    }
  };

  // 4. Live Download Files
  const handleDownloadFile = async (targetFile?: RemoteFile) => {
    const itemsToDownload = targetFile 
      ? [targetFile] 
      : (selectedFiles.size > 0 
          ? files.filter(f => selectedFiles.has(f.name)) 
          : []);

    if (itemsToDownload.length === 0) {
      showToast('Select a file or folder to download');
      return;
    }

    transferCancelledRef.current = false;
    setTransferState({
      isOpen: true,
      type: 'download',
      title: `Downloading ${itemsToDownload.length} item${itemsToDownload.length > 1 ? 's' : ''}`,
      items: itemsToDownload.map(f => f.name),
      currentItemName: itemsToDownload[0].name,
      sourcePath: currentPath,
      destPath: 'Downloads Folder',
      currentCount: 0,
      totalCount: itemsToDownload.length,
      progressPercent: 0,
      status: 'running',
    });

    try {
      for (let i = 0; i < itemsToDownload.length; i++) {
        if (transferCancelledRef.current) {
          setTransferState(prev => prev ? { ...prev, status: 'cancelled' } : null);
          showToast('Download cancelled');
          break;
        }

        const file = itemsToDownload[i];
        setTransferState(prev => prev ? {
          ...prev,
          currentItemName: file.name,
          currentCount: i,
          progressPercent: Math.round((i / itemsToDownload.length) * 100),
        } : null);

        const filePath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        await sftpDownloadFile(activeConnId, filePath);

        setTransferState(prev => prev ? {
          ...prev,
          currentCount: i + 1,
          progressPercent: Math.round(((i + 1) / itemsToDownload.length) * 100),
        } : null);
      }

      setTransferState(prev => prev && prev.status !== 'cancelled' ? {
        ...prev,
        status: 'completed',
        progressPercent: 100,
      } : prev);

      showToast(`Downloaded ${itemsToDownload.length} item(s) to Downloads`);
      await sendDesktopNotification('Download Complete', `Downloaded ${itemsToDownload.length} item(s) to Downloads folder`);
    } catch (err: any) {
      setTransferState(prev => prev ? {
        ...prev,
        status: 'error',
        errorMessage: String(err?.message || err),
      } : null);
    }
  };

  // Other Actions
  const handleDeleteSelected = (targetItems?: string[]) => {
    const items = targetItems || (selectedFiles.size > 0 
      ? Array.from(selectedFiles) 
      : (contextMenu?.file ? [contextMenu.file.name] : []));
    if (items.length === 0) return;
    setDeleteItemsTarget(items);
    setShowLiveDeleteModal(true);
  };

  const handleSelectAll = () => {
    setSelectedFiles(new Set(sortedFiles.map(f => f.name)));
  };

  const handleOpenTerminalHere = () => {
    openTerminalInDir(currentPath);
    openApp('terminal', 'Terminal', undefined, true);
  };

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

  const handleCreateTar = (type: 'tar.gz' | 'zip') => {
    const items = selectedFiles.size > 0 
      ? Array.from(selectedFiles) 
      : (contextMenu?.file ? [contextMenu.file.name] : []);
    if (items.length === 0) return;
    setLiveArchiveModal({
      isOpen: true,
      mode: 'compress',
      archiveType: type,
      items,
    });
  };

  const handleExtractArchive = (file: RemoteFile) => {
    setLiveArchiveModal({
      isOpen: true,
      mode: 'extract',
      targetArchive: file.name,
    });
  };


  // Synchronized Navigation Actions Ref to avoid stale closures in window event listener
  const navActionsRef = useRef({ goBack, goForward, goUp, historyIndex, currentPath, handleToggleSidebar });
  useEffect(() => {
    navActionsRef.current = { goBack, goForward, goUp, historyIndex, currentPath, handleToggleSidebar };
  });

  // Keyboard Shortcuts Listener (<kbd>Ctrl</kbd> + <kbd>Space</kbd> for Quick Look)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isInputFocused = 
        ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName) ||
        ['INPUT', 'TEXTAREA'].includes(activeEl?.tagName || '') ||
        (e.target as HTMLElement)?.isContentEditable ||
        activeEl?.isContentEditable;

      if (isInputFocused) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          activeEl?.blur();
        }
        return;
      }

      const isMacMeta = e.metaKey || e.ctrlKey;

      const isAnyModalOpen = 
        showNewFolder || 
        showNewFile || 
        showRenameModal || 
        showChmodModal || 
        showChownModal || 
        showGetInfo || 
        liveArchiveModal.isOpen || 
        showLiveDeleteModal || 
        packageInstallerFile || 
        scriptModal || 
        permissionAlert ||
        quickLookFile;

      // 1. Backspace Key Navigation: Go Back in History (or Go Up if at Root of History)
      if (e.key === 'Backspace' && !isMacMeta && !e.altKey && !e.shiftKey) {
        if (isAnyModalOpen) return;
        e.preventDefault();
        const { goBack: doBack, goUp: doUp, historyIndex: hIdx, currentPath: cPath } = navActionsRef.current;
        if (hIdx > 0) {
          doBack();
        } else if (cPath !== '/') {
          doUp();
        }
        return;
      }

      // 2. Alt+Left or Cmd+[ Navigation: Go Back
      if (!isAnyModalOpen && ((e.altKey && e.key === 'ArrowLeft') || (isMacMeta && e.key === '['))) {
        e.preventDefault();
        navActionsRef.current.goBack();
        return;
      }

      // 3. Alt+Right or Cmd+] Navigation: Go Forward
      if (!isAnyModalOpen && ((e.altKey && e.key === 'ArrowRight') || (isMacMeta && e.key === ']'))) {
        e.preventDefault();
        navActionsRef.current.goForward();
        return;
      }

      // 4. Alt+Up or Cmd+Up Navigation: Go Up to Enclosing Folder
      if (!isAnyModalOpen && ((e.altKey && e.key === 'ArrowUp') || (isMacMeta && e.key === 'ArrowUp'))) {
        e.preventDefault();
        navActionsRef.current.goUp();
        return;
      }

      // 5. Ctrl+B / Cmd+B to Toggle Sidebar
      if (!isAnyModalOpen && isMacMeta && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        navActionsRef.current.handleToggleSidebar();
        return;
      }

      if (isMacMeta && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopy();
      } else if (isMacMeta && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePaste();
      } else if (isMacMeta && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        handleCut();
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
      } else if (isMacMeta && e.key.toLowerCase() === 't') {
        e.preventDefault();
        handleNewTab();
      } else if (isMacMeta && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setShowNewFolder(true);
      } else if (e.code === 'Space' && (e.ctrlKey || isMacMeta)) {
        // Ctrl + Space Quick Look Trigger
        e.preventDefault();
        handleQuickLookToggle();
      } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        const displayList = search.trim().length >= 2 ? globalResults : sortedFiles;
        if (displayList.length === 0) return;

        let currentIndex = -1;
        if (selectedFiles.size > 0) {
          const firstSelected = Array.from(selectedFiles)[0];
          currentIndex = displayList.findIndex(f => f.name === firstSelected);
        }

        let nextIndex = 0;
        if (view === 'icons') {
          const containerWidth = finderContainerRef.current?.clientWidth || 800;
          const colWidth = Math.max(76, iconSize + 36) + 16;
          const cols = Math.max(1, Math.floor(containerWidth / colWidth));

          if (e.key === 'ArrowRight') nextIndex = currentIndex >= 0 ? Math.min(displayList.length - 1, currentIndex + 1) : 0;
          else if (e.key === 'ArrowLeft') nextIndex = currentIndex >= 0 ? Math.max(0, currentIndex - 1) : 0;
          else if (e.key === 'ArrowDown') nextIndex = currentIndex >= 0 ? Math.min(displayList.length - 1, currentIndex + cols) : 0;
          else if (e.key === 'ArrowUp') nextIndex = currentIndex >= 0 ? Math.max(0, currentIndex - cols) : 0;
        } else {
          if (e.key === 'ArrowDown' || (view === 'gallery' && e.key === 'ArrowRight')) {
            nextIndex = currentIndex >= 0 ? Math.min(displayList.length - 1, currentIndex + 1) : 0;
          } else if (e.key === 'ArrowUp' || (view === 'gallery' && e.key === 'ArrowLeft')) {
            nextIndex = currentIndex >= 0 ? Math.max(0, currentIndex - 1) : 0;
          } else if (e.key === 'ArrowRight') {
            nextIndex = currentIndex >= 0 ? Math.min(displayList.length - 1, currentIndex + 1) : 0;
          } else if (e.key === 'ArrowLeft') {
            nextIndex = currentIndex >= 0 ? Math.max(0, currentIndex - 1) : 0;
          }
        }

        const targetFile = displayList[nextIndex];
        if (targetFile) {
          setSelectedFiles(new Set([targetFile.name]));
          setLastSelectedIndex(nextIndex);
          const el = finderFileRefs.current.get(targetFile.name);
          if (el) {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          }
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const displayList = search.trim().length >= 2 ? globalResults : sortedFiles;
        if (selectedFiles.size === 1) {
          const first = Array.from(selectedFiles)[0];
          const file = displayList.find(f => f.name === first);
          if (file) {
            handleFileDoubleClick(file);
          }
        }
      } else if (e.key === 'F2') {
        e.preventDefault();
        if (selectedFiles.size === 1) {
          const first = Array.from(selectedFiles)[0];
          setRenameTarget(first);
          setShowRenameModal(true);
        }
      } else if (e.key === 'Delete' || (isMacMeta && e.key === 'Backspace')) {
        e.preventDefault();
        handleDeleteSelected();
      } else if (!isMacMeta && !e.altKey && e.key.length === 1 && e.key !== ' ') {
        // Type-to-Select / Type-Ahead key press handler
        if (
          showNewFolder || 
          showNewFile || 
          showRenameModal || 
          showChmodModal || 
          showChownModal || 
          showGetInfo || 
          liveArchiveModal.isOpen || 
          showLiveDeleteModal || 
          packageInstallerFile || 
          scriptModal || 
          permissionAlert ||
          quickLookFile
        ) {
          return;
        }

        const displayList = search.trim().length >= 2 ? globalResults : sortedFiles;
        if (displayList.length === 0) return;

        if (typeaheadTimeoutRef.current) {
          clearTimeout(typeaheadTimeoutRef.current);
        }

        const char = e.key.toLowerCase();
        let buffer = typeaheadBufferRef.current.toLowerCase();

        // Check if user is repeatedly pressing the same key (e.g. 'd', 'd', 'd' to cycle through items starting with 'd')
        const isRepeatedSameChar = buffer.length > 0 && buffer.split('').every(c => c === char);

        if (isRepeatedSameChar) {
          const matches = displayList.filter(f => f.name.toLowerCase().startsWith(char));
          if (matches.length > 0) {
            const currentSelected = selectedFiles.size === 1 ? Array.from(selectedFiles)[0] : null;
            const currIdx = matches.findIndex(f => f.name === currentSelected);
            const nextMatch = matches[(currIdx + 1) % matches.length];

            setSelectedFiles(new Set([nextMatch.name]));
            const idxInList = displayList.findIndex(f => f.name === nextMatch.name);
            setLastSelectedIndex(idxInList);

            const el = finderFileRefs.current.get(nextMatch.name);
            if (el) {
              el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            }

            setTypeaheadDisplay(char.toUpperCase());
            typeaheadTimeoutRef.current = setTimeout(() => {
              typeaheadBufferRef.current = '';
              setTypeaheadDisplay('');
            }, 900);
            return;
          }
        }

        buffer += char;
        typeaheadBufferRef.current = buffer;

        let match = displayList.find(f => f.name.toLowerCase().startsWith(buffer));
        if (!match && buffer.length > 1) {
          buffer = char;
          typeaheadBufferRef.current = char;
          match = displayList.find(f => f.name.toLowerCase().startsWith(char));
        }

        if (match) {
          setSelectedFiles(new Set([match.name]));
          const matchIdx = displayList.findIndex(f => f.name === match.name);
          setLastSelectedIndex(matchIdx);

          const el = finderFileRefs.current.get(match.name);
          if (el) {
            el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          }
          setTypeaheadDisplay(buffer.toUpperCase());
        }

        typeaheadTimeoutRef.current = setTimeout(() => {
          typeaheadBufferRef.current = '';
          setTypeaheadDisplay('');
        }, 900);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    selectedFiles, clipboard, currentPath, undoStack, quickLookFile, files, sortedFiles, 
    globalResults, search, handleGetInfo, showNewFolder, showNewFile, showRenameModal, 
    showChmodModal, showChownModal, showGetInfo, liveArchiveModal.isOpen, 
    showLiveDeleteModal, packageInstallerFile, scriptModal, permissionAlert
  ]);

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  return (
    <div 
      ref={rootContainerRef}
      className="flex h-full bg-[#181825] text-[#cdd6f4] select-none overflow-hidden relative"
      onDragOver={(e) => {
        e.preventDefault();
        if (!draggedItem && draggedItems.length === 0 && e.dataTransfer.types.includes('Files')) {
          setIsDraggingOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsDraggingOver(false);
        }
      }}
      onDrop={async (e) => {
        setIsDraggingOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0 && !draggedItem) {
          e.preventDefault();
          e.stopPropagation();
          await processUploadFiles(e.dataTransfer.files);
        }
      }}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      {/* Hidden File Input for uploading local PC files */}
      <input
        ref={localFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleLocalFileUpload}
      />

      {/* Finder Sidebar (Collapsible in small windows to give full space to path & files) */}
      {isSidebarOpen && (
        <>
          <FinderSidebar
            sidebarWidth={Math.min(sidebarWidth, Math.max(140, containerWidth - 200))}
            currentPath={currentPath}
            userHome={userHome}
            dropTargetDir={dropTargetDir}
            setDropTargetDir={setDropTargetDir}
            draggedItem={draggedItem}
            draggedItems={draggedItems}
            favorites={favorites}
            addFavorite={addFavorite}
            removeFavorite={removeFavorite}
            navigateTo={navigateTo}
            handleSpecialFolderNavigate={navigateTo}
            handleMoveToSidebarDir={handleMoveToSidebarDir}
            setIsResizingSidebar={setIsResizingSidebar}
          />

          {/* Sidebar Resizer Handle */}
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
      )}

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#181825]">
        {/* Finder Tab Bar */}
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

        {/* Finder Toolbar */}
        <FinderToolbar
          currentPath={currentPath}
          isEditingPath={isEditingPath}
          setIsEditingPath={setIsEditingPath}
          pathInput={pathInput}
          setPathInput={setPathInput}
          handlePathSubmit={handlePathSubmit}
          goBack={goBack}
          goForward={goForward}
          goUp={goUp}
          historyIndex={historyIndex}
          historyLength={history.length}
          view={view}
          setView={setView}
          iconSize={iconSize}
          setIconSize={setIconSize}
          showIconSizeSlider={showIconSizeSlider}
          setShowIconSizeSlider={setShowIconSizeSlider}
          showHiddenFiles={showHiddenFiles}
          onToggleHiddenFiles={() => updateSettings({ showHiddenFiles: !showHiddenFiles })}
          isLoading={isLoading}
          onReload={() => {
            dirCache.current.delete(currentPath);
            loadDirectory(currentPath, true);
          }}
          showActionMenu={showActionMenu}
          setShowActionMenu={setShowActionMenu}
          search={search}
          setSearch={setSearch}
          isSearchingGlobal={isSearchingGlobal}
          searchInputRef={searchInputRef}
          selectedFiles={selectedFiles}
          selectedFileObj={selectedFileObj}
          clipboard={clipboard}
          onNewFolder={() => setShowNewFolder(true)}
          onNewFile={() => setShowNewFile(true)}
          onDuplicate={handleDuplicate}
          onCopy={handleCopy}
          onCut={handleCut}
          onPaste={handlePaste}
          onRename={() => {
            if (selectedFiles.size === 1) {
              setRenameTarget(Array.from(selectedFiles)[0]);
              setShowRenameModal(true);
            }
          }}
          onGetInfo={handleGetInfo}
          onCompress={handleCreateTar}
          onExtract={handleExtractArchive}
          onInstallPackage={(f) => setPackageInstallerFile(f)}
          onDelete={handleDeleteSelected}
          onOpenTerminalHere={handleOpenTerminalHere}
          onDownloadFile={handleDownloadFile}
          navigateTo={navigateTo}
          containerWidth={containerWidth}
          isSidebarOpen={isSidebarOpen}
          onToggleSidebar={handleToggleSidebar}
        />

        {/* Views Canvas */}
        <div className="flex-1 overflow-hidden relative">
          {/* Top Loading Progress Line */}
          {isLoading && (
            <div className="absolute top-0 left-0 right-0 h-0.5 z-40 overflow-hidden bg-white/5 pointer-events-none">
              <div className="h-full bg-gradient-to-r from-blue-400 via-sky-300 to-indigo-500 animate-top-progress shadow-[0_0_8px_rgba(56,189,248,0.9)]" />
            </div>
          )}

          {/* Drag Overlay Banner */}
          {isDraggingOver && (
            <div className="absolute inset-0 bg-blue-600/20 backdrop-blur-md border-2 border-dashed border-blue-400 rounded-3xl z-30 flex flex-col items-center justify-center pointer-events-none">
              <Upload className="w-12 h-12 text-blue-300 animate-bounce mb-2" />
              <span className="text-sm font-bold text-white">Drop files to upload into {currentPath}</span>
            </div>
          )}

          {pathError ? (
            <div className="h-full flex flex-col items-center justify-center p-8 space-y-4 text-center">
              <div className="w-16 h-16 rounded-3xl bg-rose-500/10 border border-rose-500/25 flex items-center justify-center text-rose-400 shadow-xl">
                <AlertTriangle className="w-8 h-8" />
              </div>
              <div className="max-w-md space-y-1">
                <h4 className="text-base font-semibold text-white">Path Not Found</h4>
                <p className="text-xs text-rose-300 font-mono break-all">{pathError}</p>
                <p className="text-[11px] text-gray-400 mt-2">The path you requested does not exist or cannot be accessed on this server.</p>
              </div>
              <div className="flex items-center space-x-3 pt-2">
                <button
                  onClick={() => {
                    setPathError(null);
                    goBack();
                  }}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors flex items-center space-x-2"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Go Back</span>
                </button>
                <button
                  onClick={() => {
                    setPathError(null);
                    navigateTo(userHome || '/');
                  }}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors shadow-lg shadow-blue-600/30 flex items-center space-x-2"
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Go to Home</span>
                </button>
              </div>
            </div>
          ) : isLoading && files.length === 0 ? (
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
            <IconsView
              files={activeDisplayFiles}
              selectedFiles={selectedFiles}
              iconSize={iconSize}
              isLoading={isLoading}
              openingFolder={openingFolder}
              currentPath={currentPath}
              dropTargetDir={dropTargetDir}
              draggedItem={draggedItem}
              draggedItems={draggedItems}
              isFinderSelecting={isFinderSelecting}
              finderSelectionBox={finderSelectionBox}
              finderContainerRef={finderContainerRef}
              finderFileRefs={finderFileRefs}
              handleFinderMouseDown={handleFinderMouseDown}
              handleFinderMouseMove={handleFinderMouseMove}
              handleFinderMouseUp={handleFinderMouseUp}
              setIsFinderSelecting={setIsFinderSelecting}
              setFinderSelectionBox={setFinderSelectionBox}
              setSelectedFiles={setSelectedFiles}
              setDraggedItems={setDraggedItems}
              setDraggedItem={setDraggedItem}
              setDropTargetDir={setDropTargetDir}
              handleSelectFile={handleSelectFile}
              handleFileDoubleClick={handleFileDoubleClick}
              handleContextMenu={handleContextMenu}
              handleMoveItems={handleMoveItems}
            />
          ) : view === 'list' ? (
            <ListView
              files={activeDisplayFiles}
              selectedFiles={selectedFiles}
              sortField={sortField}
              sortOrder={sortOrder}
              isLoading={isLoading}
              openingFolder={openingFolder}
              dropTargetDir={dropTargetDir}
              draggedItem={draggedItem}
              draggedItems={draggedItems}
              finderFileRefs={finderFileRefs}
              handleSort={handleSort}
              setSelectedFiles={setSelectedFiles}
              setDraggedItems={setDraggedItems}
              setDraggedItem={setDraggedItem}
              setDropTargetDir={setDropTargetDir}
              handleSelectFile={handleSelectFile}
              handleFileDoubleClick={handleFileDoubleClick}
              handleContextMenu={handleContextMenu}
              handleMoveItems={handleMoveItems}
            />
          ) : view === 'columns' ? (
            <ColumnsView
              files={activeDisplayFiles}
              selectedFiles={selectedFiles}
              openingFolder={openingFolder}
              draggedItem={draggedItem}
              draggedItems={draggedItems}
              dropTargetDir={dropTargetDir}
              isLoading={isLoading}
              selectedFileObj={selectedFileObj}
              inspectorPreview={inspectorPreview}
              finderFileRefs={finderFileRefs}
              setDraggedItems={setDraggedItems}
              setDraggedItem={setDraggedItem}
              setDropTargetDir={setDropTargetDir}
              setSelectedFiles={setSelectedFiles}
              handleSelectFile={handleSelectFile}
              handleFileDoubleClick={handleFileDoubleClick}
              handleContextMenu={handleContextMenu}
              handleMoveItems={handleMoveItems}
              handleQuickLookToggle={handleQuickLookToggle}
              openFileTarget={openFileTarget}
              onCalculateFolderSize={calculateFolderSize}
            />
          ) : (
            <GalleryView
              files={activeDisplayFiles}
              selectedFiles={selectedFiles}
              openingFolder={openingFolder}
              draggedItem={draggedItem}
              draggedItems={draggedItems}
              dropTargetDir={dropTargetDir}
              isLoading={isLoading}
              selectedFileObj={selectedFileObj}
              inspectorPreview={inspectorPreview}
              finderFileRefs={finderFileRefs}
              setDraggedItems={setDraggedItems}
              setDraggedItem={setDraggedItem}
              setDropTargetDir={setDropTargetDir}
              setSelectedFiles={setSelectedFiles}
              handleSelectFile={handleSelectFile}
              handleFileDoubleClick={handleFileDoubleClick}
              handleContextMenu={handleContextMenu}
              handleMoveItems={handleMoveItems}
              handleQuickLookToggle={handleQuickLookToggle}
              openFileTarget={openFileTarget}
            />
          )}
        </div>

        {/* Status Bar & Path Breadcrumbs */}
        <div className="h-7 bg-[#11111a] border-t border-white/[0.08] px-2.5 sm:px-3 flex items-center justify-between text-xs text-gray-400 shrink-0 select-none">
          <div 
            ref={bottomBreadcrumbsRef}
            className="flex items-center space-x-1 overflow-x-auto text-[11px] font-medium text-gray-300 scrollbar-none min-w-0 flex-1 mr-2"
          >
            <span 
              onClick={() => navigateTo('/')}
              className={`cursor-pointer flex items-center space-x-1 px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                currentPath === '/' 
                  ? 'bg-blue-600/35 text-white font-semibold border border-blue-400/40 shadow-sm' 
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
                    className={`cursor-pointer px-1.5 py-0.5 rounded transition-colors flex items-center space-x-1 ${
                      isLast 
                        ? 'bg-blue-600/35 text-white font-semibold border border-blue-400/40 shadow-sm shrink-0 max-w-[150px] truncate' 
                        : 'hover:text-white hover:bg-white/10 max-w-[100px] truncate shrink'
                    }`}
                    title={full}
                  >
                    {isLast && <Folder className="w-2.5 h-2.5 text-blue-400 shrink-0" />}
                    <span className="truncate">{part}</span>
                  </span>
                </React.Fragment>
              );
            })}
          </div>

          {/* Alphabet Quick-Jump Strip (Shown only when window is spacious >= 850px) */}
          {containerWidth >= 850 && (
            <div className="flex items-center space-x-0.5 px-2 py-0.5 bg-black/30 rounded-lg border border-white/5 mx-2 overflow-x-auto scrollbar-none">
              {['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','#'].map(char => {
                const hasFiles = availableLetters.has(char);
                return (
                  <button
                    key={char}
                    onClick={(e) => { e.stopPropagation(); handleLetterJump(char); }}
                    disabled={!hasFiles}
                    className={`w-3.5 h-4 text-[9px] font-bold rounded flex items-center justify-center transition-all ${
                      hasFiles
                        ? 'text-gray-300 hover:text-white hover:bg-blue-600 hover:scale-110 active:scale-95 cursor-pointer'
                        : 'text-gray-600 opacity-20 cursor-default'
                    }`}
                    title={hasFiles ? `Click to jump to '${char}'` : `No items starting with '${char}'`}
                  >
                    {char}
                  </button>
                );
              })}
            </div>
          )}

          <div className="text-[11px] text-gray-400 flex items-center space-x-2 shrink-0 pl-2">
            <span className="shrink-0">
              {selectedFiles.size > 0 
                ? `${selectedFiles.size} of ${activeDisplayFiles.length} selected`
                : `${activeDisplayFiles.length} item${activeDisplayFiles.length !== 1 ? 's' : ''}`}
            </span>

            {containerWidth >= 520 && (
              <>
                <span className="text-gray-600">·</span>
                <span className="flex items-center space-x-1 text-emerald-400 font-medium shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[10px]">SFTP Ready</span>
                </span>
              </>
            )}

            {view === 'icons' && containerWidth >= 640 && (
              <div className="flex items-center space-x-1.5 pl-2 border-l border-white/10 shrink-0">
                <Grid className="w-2.5 h-2.5 text-gray-500" />
                <input
                  type="range"
                  min={48}
                  max={112}
                  value={iconSize}
                  onChange={(e) => setIconSize(Number(e.target.value))}
                  className="w-16 accent-blue-500 h-1 bg-white/10 rounded-lg cursor-pointer"
                  title={`Icon size: ${iconSize}px`}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action Toast Banner */}
      {toastMessage && (
        <div className="absolute top-16 right-6 z-50 bg-[#1e1e2e]/95 backdrop-blur-md border border-white/15 px-4 py-2.5 rounded-2xl shadow-2xl flex items-center space-x-2 text-xs text-white animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span className="font-medium tracking-wide">{toastMessage}</span>
        </div>
      )}

      {/* Floating Typeahead Indicator Badge */}
      {typeaheadDisplay && (
        <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-50 bg-[#1e1e2e]/98 border border-blue-500/50 text-white px-4 py-2 rounded-2xl shadow-2xl flex items-center space-x-2.5 text-xs backdrop-blur-md animate-in fade-in zoom-in-95 duration-100 ring-2 ring-blue-500/20">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-ping" />
          <span className="text-gray-400 font-medium">Jumping to:</span>
          <span className="font-mono font-bold text-blue-400 text-sm tracking-wider">{typeaheadDisplay}</span>
        </div>
      )}

      {/* Context Menu */}
      <FinderContextMenu
        contextMenu={contextMenu}
        currentPath={currentPath}
        selectedFiles={selectedFiles}
        clipboard={clipboard}
        showHiddenFiles={showHiddenFiles}
        onClose={() => setContextMenu(null)}
        onOpenTarget={openFileTarget}
        onNavigateTo={navigateTo}
        onDownloadFile={handleDownloadFile}
        onUploadFile={() => localFileInputRef.current?.click()}
        onQuickLook={handleQuickLookToggle}
        onInstallPackage={(f) => setPackageInstallerFile(f)}
        onDuplicate={handleDuplicate}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        onRename={() => {
          if (selectedFiles.size === 1) {
            setRenameTarget(Array.from(selectedFiles)[0]);
            setShowRenameModal(true);
          }
        }}
        onGetInfo={handleGetInfo}
        onCalculateFolderSize={calculateFolderSize}
        onExtract={handleExtractArchive}
        onCompress={handleCreateTar}
        onDelete={handleDeleteSelected}
        onOpenTerminalHere={handleOpenTerminalHere}
        onNewFolder={() => setShowNewFolder(true)}
        onNewFile={() => setShowNewFile(true)}
        onToggleHiddenFiles={() => updateSettings({ showHiddenFiles: !showHiddenFiles })}
        onReload={() => {
          dirCache.current.delete(currentPath);
          loadDirectory(currentPath, true);
        }}
      />

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      {/* 1. Live Transfers Modal (Move, Copy/Paste, Upload, Download) */}
      <LiveTransferModal
        transfer={transferState}
        onCancel={() => {
          transferCancelledRef.current = true;
          setTransferState(prev => prev ? { ...prev, status: 'cancelled' } : null);
        }}
        onClose={() => setTransferState(null)}
      />

      {/* 2. Live Archive Modal (Compress, Extract) */}
      <LiveArchiveModal
        isOpen={liveArchiveModal.isOpen}
        onClose={() => setLiveArchiveModal(prev => ({ ...prev, isOpen: false }))}
        activeConnId={activeConnId}
        mode={liveArchiveModal.mode}
        archiveType={liveArchiveModal.archiveType}
        currentPath={currentPath}
        items={liveArchiveModal.items}
        targetArchive={liveArchiveModal.targetArchive}
        onSuccess={async (outputName) => {
          dirCache.current.delete(currentPath);
          await loadDirectory(currentPath, true);
          if (outputName) {
            setSelectedFiles(new Set([outputName]));
          }
          setLiveArchiveModal(prev => ({ ...prev, isOpen: false }));
          window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
        }}
      />

      {/* 3. Live Delete Modal */}
      <LiveDeleteModal
        isOpen={showLiveDeleteModal}
        onClose={() => setShowLiveDeleteModal(false)}
        activeConnId={activeConnId}
        currentPath={currentPath}
        items={deleteItemsTarget}
        onSuccess={async () => {
          dirCache.current.delete(currentPath);
          await loadDirectory(currentPath, true);
          setSelectedFiles(new Set());
          setShowLiveDeleteModal(false);
          window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
        }}
      />

      {/* 4. Package & Shell Script Installer Modal */}
      <PackageInstallModal
        isOpen={!!packageInstallerFile}
        onClose={() => setPackageInstallerFile(null)}
        activeConnId={activeConnId}
        file={packageInstallerFile}
        currentPath={currentPath}
        onSuccess={async () => {
          dirCache.current.delete(currentPath);
          await loadDirectory(currentPath, true);
          window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
        }}
      />

      {/* 5. Quick Look Modal (<kbd>Ctrl</kbd> + <kbd>Space</kbd>) */}
      <QuickLookModal
        quickLookFile={quickLookFile}
        quickLookContent={quickLookContent}
        mediaPreviewUrl={mediaPreviewUrl}
        mediaType={mediaType}
        onClose={() => setQuickLookFile(null)}
        onDownload={handleDownloadFile}
        onEdit={openFileTarget}
        showToast={showToast}
      />

      {/* 6. Get Info Inspector Modal (⌘I) */}
      <GetInfoModal
        getInfoTarget={getInfoTarget}
        currentPath={currentPath}
        activeConnId={activeConnId}
        onClose={() => setShowGetInfo(false)}
        onEdit={openFileTarget}
        onDownload={handleDownloadFile}
        onTerminal={handleOpenTerminalHere}
        onReload={() => {
          dirCache.current.delete(currentPath);
          loadDirectory(currentPath, true);
        }}
        showToast={showToast}
      />

      {/* 7. Permissions (chmod & chown) Modals */}
      <ChmodModal
        isOpen={showChmodModal}
        target={chmodTarget}
        currentPath={currentPath}
        activeConnId={activeConnId}
        onClose={() => {
          setShowChmodModal(false);
          setChmodTarget(null);
        }}
        onSuccess={async () => {
          dirCache.current.delete(currentPath);
          await loadDirectory(currentPath, true);
        }}
      />

      <ChownModal
        isOpen={showChownModal}
        target={chownTarget}
        selectedFiles={Array.from(selectedFiles)}
        currentPath={currentPath}
        activeConnId={activeConnId}
        onClose={() => {
          setShowChownModal(false);
          setChownTarget(null);
        }}
        onSuccess={async () => {
          dirCache.current.delete(currentPath);
          await loadDirectory(currentPath, true);
        }}
      />

      {/* 8. Item Creation & Rename Modals */}
      <NewFolderModal
        isOpen={showNewFolder}
        currentPath={currentPath}
        activeConnId={activeConnId}
        onClose={() => setShowNewFolder(false)}
        onSuccess={async (folderName) => {
          dirCache.current.delete(currentPath);
          await loadDirectory(currentPath, true);
          setSelectedFiles(new Set([folderName]));
          showToast(`Created folder "${folderName}"`);
          window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
        }}
      />

      <NewFileModal
        isOpen={showNewFile}
        currentPath={currentPath}
        activeConnId={activeConnId}
        onClose={() => setShowNewFile(false)}
        onSuccess={async (fileName) => {
          dirCache.current.delete(currentPath);
          await loadDirectory(currentPath, true);
          setSelectedFiles(new Set([fileName]));
          showToast(`Created file "${fileName}"`);
          window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
        }}
      />

      <RenameModal
        isOpen={showRenameModal}
        target={renameTarget}
        currentPath={currentPath}
        activeConnId={activeConnId}
        onClose={() => setShowRenameModal(false)}
        onSuccess={async (newName) => {
          dirCache.current.delete(currentPath);
          await loadDirectory(currentPath, true);
          setSelectedFiles(new Set([newName]));
          showToast(`Renamed to "${newName}"`);
          window.dispatchEvent(new CustomEvent('sshdesktop:files-changed'));
window.dispatchEvent(new CustomEvent('clouddesk:files-changed'));
        }}
      />

      {/* 9. Script Output Modal & Permission Alert */}
      <ScriptOutputModal
        modal={scriptModal}
        onClose={() => setScriptModal(null)}
      />

      <PermissionAlertModal
        message={permissionAlert}
        onClose={() => setPermissionAlert(null)}
      />
    </div>
  );
};

export default FileManager;
