import React, { useState, useEffect, useCallback } from 'react';
import { 
  Folder, FileText, ArrowLeft, ArrowRight, ArrowUp, 
  Grid, List, Search, Plus, Trash2, ChevronRight, RefreshCw, UploadCloud
} from 'lucide-react';
import { sftpListDir, sftpMkdir, sftpDelete } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';
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

export default function FileManager() {
  const [currentPath, setCurrentPath] = useState('/');
  const [history, setHistory] = useState<string[]>(['/']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [files, setFiles] = useState<RemoteFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [search, setSearch] = useState('');

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { openApp } = useWindowManager();

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
    setSelectedFile(null);
    const nextHist = history.slice(0, historyIndex + 1);
    setHistory([...nextHist, path]);
    setHistoryIndex(nextHist.length);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const prev = history[historyIndex - 1];
      setCurrentPath(prev);
      setHistoryIndex(historyIndex - 1);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setCurrentPath(next);
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

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName) return;
    const newPath = currentPath === '/' ? `/${newFolderName}` : `${currentPath}/${newFolderName}`;
    try {
      await sftpMkdir(activeConnId, newPath);
      setShowNewFolder(false);
      setNewFolderName('');
      await loadDirectory(currentPath);
    } catch (err) {
      alert(`Failed to create directory: ${err}`);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Are you sure you want to delete '${name}'?`)) return;
    const targetPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    try {
      await sftpDelete(activeConnId, targetPath);
      await loadDirectory(currentPath);
    } catch (err) {
      alert(`Failed to delete: ${err}`);
    }
  };

  const handleFileDoubleClick = (f: RemoteFile) => {
    if (f.type === 'dir') {
      navigateTo(currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`);
    } else {
      openApp('editor', `Edit: ${f.name}`);
    }
  };

  const breadcrumbs = currentPath.split('/').filter(Boolean);
  const filteredFiles = files.filter(f => f.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4]">
      {/* Top Navigation & Toolbar */}
      <div className="flex items-center justify-between bg-[#1e1e2e] border-b border-white/[0.08] px-4 py-2 shrink-0 select-none">
        <div className="flex items-center space-x-2 flex-1">
          {/* Back/Forward/Up controls */}
          <div className="flex items-center space-x-1 pr-2 border-r border-white/10">
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
          <div className="flex items-center bg-[#11111b] border border-white/10 rounded-lg px-2.5 py-1 text-xs font-mono flex-1 max-w-xl overflow-x-auto space-x-1">
            <span
              onClick={() => navigateTo('/')}
              className="text-gray-400 hover:text-white cursor-pointer px-1 py-0.5 rounded hover:bg-white/5"
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

        {/* Action Buttons */}
        <div className="flex items-center space-x-1.5 pl-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search directory..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#11111b] border border-white/10 rounded-lg pl-7 pr-2 py-1 text-xs text-gray-200 focus:outline-none w-36"
            />
          </div>

          <button
            onClick={() => loadDirectory(currentPath)}
            disabled={isLoading}
            className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-white"
            title="Refresh Directory"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          <button
            onClick={() => setShowNewFolder(true)}
            className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-white"
            title="New Folder"
          >
            <Plus className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" />

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

      {/* Main File Browser Canvas */}
      <div className="flex-1 overflow-y-auto p-4 select-none">
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
            {filteredFiles.map(f => (
              <div
                key={f.name}
                onClick={() => setSelectedFile(f.name)}
                onDoubleClick={() => handleFileDoubleClick(f)}
                className={`flex flex-col items-center p-3 rounded-xl cursor-pointer select-none transition-all group ${
                  selectedFile === f.name ? 'bg-[var(--accent)]/20 border border-[var(--accent)]/50' : 'hover:bg-white/5'
                }`}
              >
                {f.type === 'dir' ? (
                  <Folder className="w-12 h-12 text-blue-400 fill-blue-500/20 mb-2 transition-transform group-hover:scale-105" />
                ) : (
                  <FileText className="w-12 h-12 text-gray-400 mb-2 transition-transform group-hover:scale-105" />
                )}
                <span className="text-xs text-center text-gray-200 break-all line-clamp-2 max-w-full">
                  {f.name}
                </span>
                <span className="text-[10px] text-gray-500 mt-1">{f.size}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-[#1e1e2e] rounded-xl border border-white/[0.08] overflow-hidden">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08]">
                <tr>
                  <th className="py-2.5 px-3">Name</th>
                  <th className="py-2.5 px-3">Size</th>
                  <th className="py-2.5 px-3">Permissions</th>
                  <th className="py-2.5 px-3">Owner</th>
                  <th className="py-2.5 px-3">Modified</th>
                  <th className="py-2.5 px-3 text-right">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05]">
                {filteredFiles.map(f => (
                  <tr
                    key={f.name}
                    onClick={() => setSelectedFile(f.name)}
                    onDoubleClick={() => handleFileDoubleClick(f)}
                    className={`hover:bg-white/[0.03] cursor-pointer ${
                      selectedFile === f.name ? 'bg-[var(--accent)]/15' : ''
                    }`}
                  >
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
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(f.name);
                        }}
                        className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-red-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="h-6 bg-[#11111b] border-t border-white/[0.08] px-4 flex items-center justify-between text-xs text-gray-400 shrink-0 select-none">
        <span>{files.length} items ({currentPath})</span>
        <span className="text-[11px] font-mono">Live SFTP · Linux Remote Filesystem</span>
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
                placeholder="Directory name"
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
    </div>
  );
}
