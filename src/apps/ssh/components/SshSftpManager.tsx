import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Folder, FolderPlus, File, FileText, FileCode, Upload, Download, 
  RefreshCw, Trash2, Edit3, Lock, Eye, Copy, Check, ChevronRight, 
  ArrowLeft, ArrowRight, ArrowUp, Search, X, AlertCircle, HardDrive, 
  CheckCircle2, Plus, Terminal, Filter, LayoutGrid, List, FileArchive,
  Image, Music, Video, Code, Save, ExternalLink
} from 'lucide-react';
import { useConnectionStore } from '../../../lib/store';
import { 
  sftpListDir, sftpReadTextFile, sftpWriteFile, sftpWriteTextFile, 
  sftpMkdir, sftpDelete, sftpRename, sftpChmod, sftpDownloadToDownloads,
  sshExec
} from '../../../lib/tauri-bridge';

interface FileEntry {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  is_symlink?: boolean;
  permissions?: string;
  owner?: string;
  group?: string;
  modified?: number | string;
}

export default function SshSftpManager() {
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);
  const username = activeServer?.username || 'root';
  const defaultHome = username === 'root' ? '/root' : `/home/${username}`;

  // Navigation & Path State
  const [currentPath, setCurrentPath] = useState(defaultHome);
  const [pathInput, setPathInput] = useState(defaultHome);
  const [isEditingPath, setIsEditingPath] = useState(false);
  const [history, setHistory] = useState<string[]>([defaultHome]);
  const [historyIdx, setHistoryIdx] = useState(0);

  // File Listing State
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);

  // Modals & Dialogs
  const [showNewFolderModal, setShowNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const [showNewFileModal, setShowNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');

  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileEntry | null>(null);
  const [newRenameName, setNewRenameName] = useState('');

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FileEntry | null>(null);

  const [showChmodModal, setShowChmodModal] = useState(false);
  const [chmodTarget, setChmodTarget] = useState<FileEntry | null>(null);
  const [chmodMode, setChmodMode] = useState('0755');

  // Preview / Editor Modal
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editorTarget, setEditorTarget] = useState<FileEntry | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [isEditorSaving, setIsEditorSaving] = useState(false);
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [editorSaveSuccess, setEditorSaveSuccess] = useState(false);

  // Status & Feedback
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; name: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string) => {
    setStatusMessage(msg);
    setTimeout(() => setStatusMessage(null), 3000);
  };

  // Load directory items
  const loadDirectory = async (path: string, pushHistory = false) => {
    if (!activeConnectionId) return;
    setIsLoading(true);
    setError(null);
    setSelectedFile(null);

    const cleanPath = path.replace(/\/+/g, '/') || '/';

    try {
      const list = await sftpListDir(activeConnectionId, cleanPath);
      const parsed: FileEntry[] = (list || []).map((item: any) => ({
        name: item.name,
        path: cleanPath === '/' ? `/${item.name}` : `${cleanPath}/${item.name}`,
        size: Number(item.size || 0),
        is_dir: !!item.is_dir,
        is_symlink: !!item.is_symlink,
        permissions: item.permissions || (item.is_dir ? 'drwxr-xr-x' : '-rw-r--r--'),
        owner: item.owner || username,
        group: item.group || username,
        modified: item.modified || '',
      }));

      // Sort directories first, then alphabetical
      parsed.sort((a, b) => {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });

      setFiles(parsed);
      setCurrentPath(cleanPath);
      setPathInput(cleanPath);

      if (pushHistory) {
        const newHist = history.slice(0, historyIdx + 1);
        newHist.push(cleanPath);
        setHistory(newHist);
        setHistoryIdx(newHist.length - 1);
      }
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (activeConnectionId) {
      loadDirectory(currentPath);
    }
  }, [activeConnectionId]);

  // Navigation handlers
  const handleNavigate = (path: string) => {
    loadDirectory(path, true);
  };

  const handleBack = () => {
    if (historyIdx > 0) {
      const target = history[historyIdx - 1];
      setHistoryIdx(historyIdx - 1);
      loadDirectory(target, false);
    }
  };

  const handleForward = () => {
    if (historyIdx < history.length - 1) {
      const target = history[historyIdx + 1];
      setHistoryIdx(historyIdx + 1);
      loadDirectory(target, false);
    }
  };

  const handleGoUp = () => {
    if (currentPath === '/' || !currentPath) return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.length === 0 ? '/' : '/' + parts.join('/');
    handleNavigate(parent);
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsEditingPath(false);
    handleNavigate(pathInput.trim() || '/');
  };

  // Filtered files
  const filteredFiles = useMemo(() => {
    return files.filter(f => {
      if (!showHidden && f.name.startsWith('.') && f.name !== '..') return false;
      if (searchQuery.trim() && !f.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }, [files, showHidden, searchQuery]);

  // Format File Size
  const formatSize = (bytes: number) => {
    if (bytes === 0 || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i] || 'B'}`;
  };

  // Get File Icon
  const getFileIcon = (file: FileEntry, customClass = 'w-4 h-4') => {
    if (file.is_dir) return <Folder className={`${customClass} text-amber-400 shrink-0`} />;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z'].includes(ext || '')) {
      return <FileArchive className={`${customClass} text-purple-400 shrink-0`} />;
    }
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext || '')) {
      return <Image className={`${customClass} text-pink-400 shrink-0`} />;
    }
    if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext || '')) {
      return <Music className={`${customClass} text-emerald-400 shrink-0`} />;
    }
    if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext || '')) {
      return <Video className={`${customClass} text-rose-400 shrink-0`} />;
    }
    if (['js', 'ts', 'tsx', 'jsx', 'json', 'py', 'rs', 'go', 'c', 'cpp', 'sh', 'css', 'html'].includes(ext || '')) {
      return <FileCode className={`${customClass} text-cyan-400 shrink-0`} />;
    }
    if (['conf', 'cfg', 'yaml', 'yml', 'ini', 'toml', 'env'].includes(ext || '')) {
      return <Code className={`${customClass} text-yellow-400 shrink-0`} />;
    }
    return <FileText className={`${customClass} text-gray-400 shrink-0`} />;
  };

  // Upload handler
  const handleUploadFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !activeConnectionId) return;
    setIsUploading(true);

    try {
      const arr = Array.from(fileList);
      for (let i = 0; i < arr.length; i++) {
        const file = arr[i];
        setUploadProgress({ current: i + 1, total: arr.length, name: file.name });
        const buf = await file.arrayBuffer();
        const targetPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
        await sftpWriteFile(activeConnectionId, targetPath, Array.from(new Uint8Array(buf)));
      }
      showToast(`Uploaded ${arr.length} file(s) successfully`);
      loadDirectory(currentPath);
    } catch (err: any) {
      setError(`Upload failed: ${err?.message || err}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Download handler
  const handleDownload = async (file: FileEntry) => {
    if (!activeConnectionId) return;
    showToast(`Downloading ${file.name}...`);
    try {
      await sftpDownloadToDownloads(activeConnectionId, file.path);
      showToast(`Downloaded ${file.name} to Downloads folder`);
    } catch (err: any) {
      setError(`Download failed: ${err?.message || err}`);
    }
  };

  // Create New Folder
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim() || !activeConnectionId) return;
    const target = currentPath === '/' ? `/${newFolderName.trim()}` : `${currentPath}/${newFolderName.trim()}`;
    try {
      await sftpMkdir(activeConnectionId, target);
      showToast(`Created directory ${newFolderName.trim()}`);
      setShowNewFolderModal(false);
      setNewFolderName('');
      loadDirectory(currentPath);
    } catch (err: any) {
      setError(`Mkdir failed: ${err?.message || err}`);
    }
  };

  // Create New File
  const handleCreateFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim() || !activeConnectionId) return;
    const target = currentPath === '/' ? `/${newFileName.trim()}` : `${currentPath}/${newFileName.trim()}`;
    try {
      await sftpWriteTextFile(activeConnectionId, target, newFileContent);
      showToast(`Created file ${newFileName.trim()}`);
      setShowNewFileModal(false);
      setNewFileName('');
      setNewFileContent('');
      loadDirectory(currentPath);
    } catch (err: any) {
      setError(`Create file failed: ${err?.message || err}`);
    }
  };

  // Rename File / Folder
  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !newRenameName.trim() || !activeConnectionId) return;
    const targetDir = currentPath === '/' ? '' : currentPath;
    const newPath = `${targetDir}/${newRenameName.trim()}`;
    try {
      await sftpRename(activeConnectionId, renameTarget.path, newPath);
      showToast(`Renamed to ${newRenameName.trim()}`);
      setShowRenameModal(false);
      setRenameTarget(null);
      setNewRenameName('');
      loadDirectory(currentPath);
    } catch (err: any) {
      setError(`Rename failed: ${err?.message || err}`);
    }
  };

  // Delete File / Folder
  const handleDelete = async () => {
    if (!deleteTarget || !activeConnectionId) return;
    try {
      await sftpDelete(activeConnectionId, deleteTarget.path);
      showToast(`Deleted ${deleteTarget.name}`);
      setShowDeleteModal(false);
      setDeleteTarget(null);
      loadDirectory(currentPath);
    } catch (err: any) {
      setError(`Delete failed: ${err?.message || err}`);
    }
  };

  // Chmod
  const handleChmod = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chmodTarget || !activeConnectionId) return;
    try {
      const modeNum = parseInt(chmodMode, 8);
      await sftpChmod(activeConnectionId, chmodTarget.path, modeNum);
      showToast(`Updated permissions for ${chmodTarget.name} to ${chmodMode}`);
      setShowChmodModal(false);
      setChmodTarget(null);
      loadDirectory(currentPath);
    } catch (err: any) {
      setError(`Chmod failed: ${err?.message || err}`);
    }
  };

  // Open Preview / Editor
  const handleOpenFileEditor = async (file: FileEntry) => {
    if (file.is_dir || !activeConnectionId) return;
    setEditorTarget(file);
    setShowEditorModal(true);
    setIsEditorLoading(true);
    setEditorSaveSuccess(false);

    try {
      const text = await sftpReadTextFile(activeConnectionId, file.path);
      setEditorContent(text);
    } catch (err: any) {
      setEditorContent(`// Failed to read file: ${err?.message || err}`);
    } finally {
      setIsEditorLoading(false);
    }
  };

  // Save in Editor
  const handleSaveEditor = async () => {
    if (!editorTarget || !activeConnectionId) return;
    setIsEditorSaving(true);
    setEditorSaveSuccess(false);
    try {
      await sftpWriteTextFile(activeConnectionId, editorTarget.path, editorContent);
      setEditorSaveSuccess(true);
      showToast(`Saved changes to ${editorTarget.name}`);
      setTimeout(() => setEditorSaveSuccess(false), 2500);
      loadDirectory(currentPath);
    } catch (err: any) {
      setError(`Save file failed: ${err?.message || err}`);
    } finally {
      setIsEditorSaving(false);
    }
  };

  // Breadcrumbs segments
  const breadcrumbSegments = useMemo(() => {
    const parts = currentPath.split('/').filter(Boolean);
    const segs = [{ name: 'root', path: '/' }];
    let acc = '';
    for (const part of parts) {
      acc += '/' + part;
      segs.push({ name: part, path: acc });
    }
    return segs;
  }, [currentPath]);

  return (
    <div className="flex-1 flex flex-col h-full bg-[#181825] text-gray-200 select-none overflow-hidden font-sans">
      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-[#11111b] border-b border-white/[0.08] shrink-0">
        {/* Navigation & History */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={handleBack}
            disabled={historyIdx <= 0}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleForward}
            disabled={historyIdx >= history.length - 1}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title="Forward"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleGoUp}
            disabled={currentPath === '/'}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title="Go to parent directory (..)"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => loadDirectory(currentPath)}
            disabled={isLoading}
            className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer transition-colors"
            title="Refresh Directory"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          {/* Quick jumps */}
          <div className="flex items-center space-x-1 ml-2 pl-2 border-l border-white/10 text-xs">
            <button
              onClick={() => handleNavigate(defaultHome)}
              className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white cursor-pointer"
            >
              ~ Home
            </button>
            <button
              onClick={() => handleNavigate('/')}
              className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white cursor-pointer"
            >
              / Root
            </button>
            <button
              onClick={() => handleNavigate('/var/log')}
              className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white cursor-pointer"
            >
              /var/log
            </button>
            <button
              onClick={() => handleNavigate('/etc')}
              className="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white cursor-pointer"
            >
              /etc
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          {/* Upload Button */}
          <input
            type="file"
            multiple
            ref={fileInputRef}
            onChange={(e) => handleUploadFiles(e.target.files)}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer shadow-sm transition-all"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{isUploading ? 'Uploading...' : 'Upload'}</span>
          </button>

          {/* New Folder */}
          <button
            onClick={() => setShowNewFolderModal(true)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 hover:text-white border border-white/10 text-xs font-medium cursor-pointer transition-colors"
          >
            <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
            <span>New Folder</span>
          </button>

          {/* New File */}
          <button
            onClick={() => setShowNewFileModal(true)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 hover:text-white border border-white/10 text-xs font-medium cursor-pointer transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-cyan-400" />
            <span>New File</span>
          </button>

          {/* Hidden toggle */}
          <button
            onClick={() => setShowHidden(!showHidden)}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer border ${
              showHidden ? 'bg-indigo-600/30 text-indigo-300 border-indigo-500/40' : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
            }`}
            title="Toggle hidden files"
          >
            .{showHidden ? ' Hidden: ON' : ' Hidden: OFF'}
          </button>

          {/* View mode toggle */}
          <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10">
            <button
              onClick={() => setViewMode('list')}
              className={`p-1 rounded-lg cursor-pointer ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
              title="List View"
            >
              <List className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1 rounded-lg cursor-pointer ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
              title="Grid View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Breadcrumb Path & Search Bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 bg-[#181825] border-b border-white/[0.06] shrink-0">
        {/* Breadcrumb / Path Editor */}
        <div className="flex-1 flex items-center min-w-0">
          {isEditingPath ? (
            <form onSubmit={handlePathSubmit} className="flex-1 flex items-center">
              <input
                type="text"
                autoFocus
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onBlur={() => setIsEditingPath(false)}
                className="w-full px-2.5 py-1 rounded-lg bg-black/50 border border-blue-500 text-white font-mono text-xs focus:outline-none"
              />
            </form>
          ) : (
            <div 
              onClick={() => {
                setPathInput(currentPath);
                setIsEditingPath(true);
              }}
              className="flex items-center space-x-1 overflow-x-auto py-0.5 text-xs font-mono text-gray-300 cursor-text hover:text-white transition-colors"
              title="Click to edit path directly"
            >
              {breadcrumbSegments.map((seg, idx) => (
                <React.Fragment key={seg.path}>
                  {idx > 0 && <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />}
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNavigate(seg.path);
                    }}
                    className="hover:bg-white/10 px-1.5 py-0.5 rounded cursor-pointer transition-colors text-blue-300 font-medium"
                  >
                    {seg.name}
                  </span>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Search in Current Directory */}
        <div className="relative w-64 shrink-0">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Filter current folder..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-7 py-1 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-2 text-gray-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Alerts / Error Bar */}
      {error && (
        <div className="flex items-center justify-between px-4 py-2 bg-rose-500/15 border-b border-rose-500/30 text-rose-300 text-xs shrink-0">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Toast Bar */}
      {statusMessage && (
        <div className="flex items-center space-x-2 px-4 py-1.5 bg-emerald-500/20 border-b border-emerald-500/30 text-emerald-300 text-xs shrink-0 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Uploading Banner */}
      {uploadProgress && (
        <div className="px-4 py-2 bg-blue-600/20 border-b border-blue-500/30 text-blue-300 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
            <span>Uploading ({uploadProgress.current}/{uploadProgress.total}): {uploadProgress.name}</span>
          </div>
        </div>
      )}

      {/* File Explorer Content Area */}
      <div 
        className="flex-1 overflow-y-auto p-3"
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleUploadFiles(e.dataTransfer.files);
          }
        }}
      >
        {filteredFiles.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 text-center text-gray-500">
            <Folder className="w-12 h-12 text-gray-700 mb-2 stroke-[1.2]" />
            <p className="text-sm font-medium text-gray-400">Folder is empty</p>
            <p className="text-xs text-gray-600 mt-1">Drag and drop files here to upload</p>
          </div>
        ) : viewMode === 'list' ? (
          /* LIST VIEW TABLE */
          <div className="w-full border border-white/[0.08] rounded-2xl overflow-hidden bg-[#181825]">
            <table className="w-full text-left text-xs font-sans">
              <thead className="bg-[#11111b] text-gray-400 font-semibold border-b border-white/[0.08] select-none">
                <tr>
                  <th className="py-2.5 px-3">Name</th>
                  <th className="py-2.5 px-3 w-28">Size</th>
                  <th className="py-2.5 px-3 w-28 font-mono">Permissions</th>
                  <th className="py-2.5 px-3 w-24">Owner</th>
                  <th className="py-2.5 px-3 w-36 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredFiles.map((file) => {
                  const isSelected = selectedFile?.path === file.path;
                  return (
                    <tr
                      key={file.path}
                      onClick={() => setSelectedFile(file)}
                      onDoubleClick={() => {
                        if (file.is_dir) handleNavigate(file.path);
                        else handleOpenFileEditor(file);
                      }}
                      className={`group hover:bg-white/[0.05] cursor-pointer transition-colors ${
                        isSelected ? 'bg-blue-600/15 text-white' : 'text-gray-300'
                      }`}
                    >
                      <td className="py-2 px-3 flex items-center space-x-2.5 min-w-0">
                        {getFileIcon(file)}
                        <span className={`truncate font-medium ${file.is_dir ? 'text-white' : 'text-gray-200'}`}>
                          {file.name}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-gray-400 font-mono text-[11px]">
                        {file.is_dir ? '—' : formatSize(file.size)}
                      </td>
                      <td className="py-2 px-3 text-gray-400 font-mono text-[11px]">
                        {file.permissions || (file.is_dir ? 'drwxr-xr-x' : '-rw-r--r--')}
                      </td>
                      <td className="py-2 px-3 text-gray-400 font-mono text-[11px]">
                        {file.owner}:{file.group}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!file.is_dir && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenFileEditor(file);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-cyan-300 cursor-pointer"
                              title="Edit / View File"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {!file.is_dir && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDownload(file);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-blue-300 cursor-pointer"
                              title="Download to PC"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setChmodTarget(file);
                              setChmodMode('0755');
                              setShowChmodModal(true);
                            }}
                            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-amber-300 cursor-pointer"
                            title="Change Permissions (chmod)"
                          >
                            <Lock className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenameTarget(file);
                              setNewRenameName(file.name);
                              setShowRenameModal(true);
                            }}
                            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
                            title="Rename"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(file);
                              setShowDeleteModal(true);
                            }}
                            className="p-1 rounded hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          /* GRID VIEW */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filteredFiles.map((file) => {
              const isSelected = selectedFile?.path === file.path;
              return (
                <div
                  key={file.path}
                  onClick={() => setSelectedFile(file)}
                  onDoubleClick={() => {
                    if (file.is_dir) handleNavigate(file.path);
                    else handleOpenFileEditor(file);
                  }}
                  className={`flex flex-col items-center p-3 rounded-2xl border transition-all cursor-pointer group text-center relative ${
                    isSelected
                      ? 'bg-blue-600/20 border-blue-500 shadow-md text-white'
                      : 'bg-[#181825] border-white/[0.08] hover:border-white/[0.18] text-gray-300'
                  }`}
                >
                  <div className="p-3 rounded-xl bg-white/5 mb-2 group-hover:scale-105 transition-transform">
                    {getFileIcon(file, 'w-7 h-7')}
                  </div>
                  <span className="text-xs font-medium truncate w-full px-1">{file.name}</span>
                  <span className="text-[10px] text-gray-500 font-mono mt-0.5">
                    {file.is_dir ? 'Folder' : formatSize(file.size)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#11111b] border-t border-white/[0.08] text-[11px] text-gray-400 shrink-0 font-mono">
        <div className="flex items-center space-x-3">
          <span>{filteredFiles.length} item(s)</span>
          {selectedFile && (
            <span className="text-blue-300">
              Selected: {selectedFile.name} ({selectedFile.is_dir ? 'Directory' : formatSize(selectedFile.size)})
            </span>
          )}
        </div>
        <div className="flex items-center space-x-2">
          <span>{username}@{activeServer?.host || 'localhost'}</span>
        </div>
      </div>

      {/* MODAL: New Folder */}
      {showNewFolderModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181825] border border-white/20 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
              <FolderPlus className="w-4 h-4 text-amber-400" />
              <span>Create New Folder</span>
            </h3>
            <form onSubmit={handleCreateFolder} className="space-y-3">
              <input
                type="text"
                autoFocus
                required
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewFolderModal(false)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-300 hover:text-white text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: New File */}
      {showNewFileModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181825] border border-white/20 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
              <FileCode className="w-4 h-4 text-cyan-400" />
              <span>Create New Text File</span>
            </h3>
            <form onSubmit={handleCreateFile} className="space-y-3">
              <input
                type="text"
                autoFocus
                required
                placeholder="File name (e.g. script.sh, config.json)"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <textarea
                placeholder="Initial file content (optional)..."
                value={newFileContent}
                onChange={(e) => setNewFileContent(e.target.value)}
                rows={5}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
              />
              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewFileModal(false)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-300 hover:text-white text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
                >
                  Create File
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Rename */}
      {showRenameModal && renameTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181825] border border-white/20 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
              <Edit3 className="w-4 h-4 text-blue-400" />
              <span>Rename {renameTarget.is_dir ? 'Folder' : 'File'}</span>
            </h3>
            <form onSubmit={handleRename} className="space-y-3">
              <input
                type="text"
                autoFocus
                required
                value={newRenameName}
                onChange={(e) => setNewRenameName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRenameModal(false)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-300 hover:text-white text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
                >
                  Rename
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Delete */}
      {showDeleteModal && deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181825] border border-rose-500/30 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center space-x-2 text-rose-400">
              <Trash2 className="w-4 h-4" />
              <span>Confirm Delete</span>
            </h3>
            <p className="text-xs text-gray-300">
              Are you sure you want to permanently delete <strong className="text-white font-mono">{deleteTarget.name}</strong>?
            </p>
            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-300 hover:text-white text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Chmod */}
      {showChmodModal && chmodTarget && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#181825] border border-white/20 rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center space-x-2">
              <Lock className="w-4 h-4 text-amber-400" />
              <span>Change Permissions (chmod)</span>
            </h3>
            <form onSubmit={handleChmod} className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Target: {chmodTarget.name}</label>
                <input
                  type="text"
                  autoFocus
                  required
                  placeholder="e.g. 0755, 0644, 0700"
                  value={chmodMode}
                  onChange={(e) => setChmodMode(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs font-mono focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowChmodModal(false)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 text-gray-300 hover:text-white text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium cursor-pointer"
                >
                  Apply
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Full File Preview & Editor */}
      {showEditorModal && editorTarget && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Editor Header */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-[#11111b] border-b border-white/[0.08] shrink-0">
              <div className="flex items-center space-x-2">
                <FileCode className="w-5 h-5 text-blue-400" />
                <span className="font-semibold text-white text-sm font-mono">{editorTarget.name}</span>
                <span className="text-xs text-gray-500 font-mono truncate max-w-md">({editorTarget.path})</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleSaveEditor}
                  disabled={isEditorSaving || isEditorLoading}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer shadow-sm transition-all"
                >
                  {editorSaveSuccess ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{isEditorSaving ? 'Saving...' : editorSaveSuccess ? 'Saved!' : 'Save'}</span>
                </button>
                <button
                  onClick={() => setShowEditorModal(false)}
                  className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Editor Textarea */}
            <div className="flex-1 p-3 overflow-hidden bg-[#11111b]/80">
              {isEditorLoading ? (
                <div className="flex items-center justify-center h-full text-gray-400 space-x-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-blue-400" />
                  <span>Loading file content...</span>
                </div>
              ) : (
                <textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  className="w-full h-full p-4 rounded-2xl bg-black/40 border border-white/10 font-mono text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none leading-relaxed"
                />
              )}
            </div>

            {/* Editor Footer */}
            <div className="flex items-center justify-between px-5 py-2 bg-[#11111b] border-t border-white/[0.08] text-[11px] text-gray-400 font-mono shrink-0">
              <span>Lines: {editorContent.split('\n').length} | Characters: {editorContent.length}</span>
              <span>UTF-8 Text Editor</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
