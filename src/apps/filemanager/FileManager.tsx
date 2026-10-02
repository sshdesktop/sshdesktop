import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Folder, FileText, ArrowLeft, ArrowRight, ArrowUp, 
  Grid, List, Search, Plus, Trash2, ChevronRight, RefreshCw, 
  Copy, Scissors, ClipboardPaste, FileCode, CheckSquare, Square,
  Upload, DownloadCloud
} from 'lucide-react';
import { sftpListDir, sftpMkdir, sftpDelete, sftpWriteTextFile, sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';

interface RemoteFile {
  name: string;
  type: 'dir' | 'file';
  size: string;
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

export default function FileManager() {
  const [currentPath, setCurrentPath] = useState('/');
  const [history, setHistory] = useState<string[]>(['/']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Modals
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [search, setSearch] = useState('');

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { openApp } = useWindowManager();
  const { openFileInEditor } = useEditorStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const entries = await sftpListDir(activeConnId, path);
      if (entries && Array.isArray(entries)) {
        setFiles(entries.map((item: any) => ({
          name: item.name,
          type: item.is_dir ? 'dir' : 'file',
          size: item.is_dir ? '—' : `${(item.size / 1024).toFixed(1)} KB`,
          permissions: item.permissions || (item.is_dir ? 'drwxr-xr-x' : '-rw-r--r--'),
          owner: item.owner || 'root',
          modified: item.modified ? new Date(item.modified * 1000).toLocaleDateString() : 'Recent',
          extension: item.name.includes('.') ? item.name.split('.').pop() : undefined
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
  }, [currentPath, loadDirectory]);

  const navigateTo = (path: string) => {
    setCurrentPath(path);
    setSelectedFiles(new Set());
    setLastSelectedIndex(null);
    const nextHist = history.slice(0, historyIndex + 1);
    setHistory([...nextHist, path]);
    setHistoryIndex(nextHist.length);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setCurrentPath(prev);
      setSelectedFiles(new Set());
      setHistoryIndex(historyIndex - 1);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setCurrentPath(next);
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
      // Toggle single item
      setSelectedFiles(prev => {
        const next = new Set(prev);
        if (next.has(f.name)) next.delete(f.name);
        else next.add(f.name);
        return next;
      });
      setLastSelectedIndex(index);
    } else if (e.shiftKey && lastSelectedIndex !== null) {
      // Range selection
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      const range = filteredFiles.slice(start, end + 1).map(item => item.name);
      setSelectedFiles(new Set(range));
    } else {
      // Standard single select
      setSelectedFiles(new Set([f.name]));
      setLastSelectedIndex(index);
    }
  };

  const handleSelectAll = () => {
    if (selectedFiles.size === filteredFiles.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(filteredFiles.map(f => f.name)));
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

  return (
    <div 
      className="flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none"
      onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={handleDrop}
    >
      {/* Top Navigation & Toolbar */}
      <div className="flex items-center justify-between bg-[#1e1e2e] border-b border-white/[0.08] px-4 py-2 shrink-0">
        <div className="flex items-center space-x-2 flex-1 min-w-0">
          {/* Back/Forward/Up controls */}
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

          {/* Breadcrumb Path Bar */}
          <div className="flex items-center bg-[#11111b] border border-white/10 rounded-lg px-2.5 py-1 text-xs font-mono flex-1 overflow-x-auto space-x-1 scrollbar-none">
            <span
              onClick={() => navigateTo('/')}
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
                    onClick={() => navigateTo(full)}
                    className="text-gray-300 hover:text-white cursor-pointer px-1 py-0.5 rounded hover:bg-white/5 whitespace-nowrap"
                  >
                    {part}
                  </span>
                </React.Fragment>
              );
            })}
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
              className="bg-[#11111b] border border-white/10 rounded-lg pl-7 pr-2 py-1 text-xs text-gray-200 focus:outline-none w-28 focus:w-44 transition-all"
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
              return (
                <div
                  key={f.name}
                  onClick={(e) => handleSelectFile(f, idx, e)}
                  onDoubleClick={() => handleFileDoubleClick(f)}
                  className={`flex flex-col items-center p-3 rounded-xl cursor-pointer select-none transition-all group relative ${
                    isSelected ? 'bg-[var(--accent)]/20 border border-[var(--accent)]/50 shadow-md' : 'hover:bg-white/5 border border-transparent'
                  }`}
                >
                  {f.type === 'dir' ? (
                    <Folder className="w-12 h-12 text-blue-400 fill-blue-500/20 mb-2 transition-transform group-hover:scale-105" />
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
                    <button onClick={handleSelectAll} className="text-gray-400 hover:text-white">
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
                  return (
                    <tr
                      key={f.name}
                      onClick={(e) => handleSelectFile(f, idx, e)}
                      onDoubleClick={() => handleFileDoubleClick(f)}
                      className={`hover:bg-white/[0.03] cursor-pointer ${
                        isSelected ? 'bg-[var(--accent)]/15 font-medium' : ''
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
                        ) : (
                          <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                        )}
                        <span>{f.name}</span>
                      </td>
                      <td className="py-2 px-3 text-gray-400">{f.size}</td>
                      <td className="py-2 px-3 text-gray-500">{f.permissions}</td>
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
                            title="Open in Editor"
                          >
                            <FileCode className="w-3.5 h-3.5" />
                          </button>
                        )}
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
        <span className="text-[11px] font-mono">Live SFTP · Drag & Drop enabled</span>
      </div>

      {/* New Folder Modal */}
      {showNewFolder && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form onSubmit={handleCreateFolder} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-2xl">
            <h3 className="font-bold text-sm text-white">Create New Remote Directory</h3>
            <div>
              <input
                type="text"
                autoFocus
                required
                placeholder="Folder name"
                value={newFolderName}
                onChange={e => setNewFolderName(e.target.value)}
                className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none"
              />
            </div>
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
            <div>
              <input
                type="text"
                autoFocus
                required
                placeholder="e.g. index.js, app.py, config.yml"
                value={newFileName}
                onChange={e => setNewFileName(e.target.value)}
                className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none font-mono"
              />
            </div>
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
