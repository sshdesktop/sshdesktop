import React, { useState, useEffect } from 'react';
import { 
  Folder, File, ChevronRight, Download, Upload, ArrowUp, 
  RefreshCw, CornerDownLeft, X, Eye, FileText, HardDrive
} from 'lucide-react';
import { useConnectionStore } from '../../../lib/store';
import { sftpListDir, sftpDownloadToDownloads } from '../../../lib/tauri-bridge';

interface SshQuickSftpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onInsertPathToTerminal?: (path: string) => void;
  connId: string;
}

export default function SshQuickSftpDrawer({
  isOpen,
  onClose,
  onInsertPathToTerminal,
  connId,
}: SshQuickSftpDrawerProps) {
  const { connections } = useConnectionStore();
  const server = connections.find(c => c.id === connId);
  const username = server?.username || 'root';
  const defaultHome = username === 'root' ? '/root' : `/home/${username}`;

  const [currentPath, setCurrentPath] = useState(defaultHome);
  const [items, setItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDirectory = async (path: string) => {
    if (!connId) return;
    setIsLoading(true);
    setError(null);
    try {
      const list = await sftpListDir(connId, path);
      // Sort folders first, then files
      const sorted = (list || []).sort((a: any, b: any) => {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;
        return a.name.localeCompare(b.name);
      });
      setItems(sorted);
      setCurrentPath(path);
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && connId) {
      loadDirectory(currentPath);
    }
  }, [isOpen, connId]);

  const handleGoUp = () => {
    if (currentPath === '/' || currentPath === '') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parent = parts.length === 0 ? '/' : '/' + parts.join('/');
    loadDirectory(parent);
  };

  const handleItemClick = (item: any) => {
    if (item.is_dir) {
      const target = currentPath === '/' ? `/${item.name}` : `${currentPath}/${item.name}`;
      loadDirectory(target);
    } else {
      if (onInsertPathToTerminal) {
        const fullPath = currentPath === '/' ? `/${item.name}` : `${currentPath}/${item.name}`;
        onInsertPathToTerminal(fullPath);
      }
    }
  };

  const formatSize = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  if (!isOpen) return null;

  return (
    <div className="w-80 h-full bg-[#181825] border-l border-white/[0.08] flex flex-col select-none text-xs text-gray-200 z-20 font-sans shadow-2xl animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.08] bg-[#11111b]">
        <div className="flex items-center space-x-1.5 font-semibold text-white">
          <Folder className="w-4 h-4 text-blue-400" />
          <span>Quick SFTP Drawer</span>
        </div>
        <div className="flex items-center space-x-1">
          <button
            onClick={() => loadDirectory(currentPath)}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
            title="Refresh Directory"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white"
            title="Close SFTP Drawer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Path Toolbar */}
      <div className="flex items-center space-x-1 px-3 py-2 bg-[#181825] border-b border-white/[0.06]">
        <button
          onClick={handleGoUp}
          disabled={currentPath === '/'}
          className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          title="Go to parent directory"
        >
          <ArrowUp className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1 bg-black/40 px-2 py-1 rounded-lg border border-white/10 font-mono text-[11px] text-gray-300 truncate">
          {currentPath}
        </div>
      </div>

      {/* Items List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {error && (
          <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px]">
            {error}
          </div>
        )}

        {items.length === 0 && !isLoading && !error && (
          <div className="text-center py-12 text-gray-500 text-xs">
            Directory is empty
          </div>
        )}

        {items.map((item, idx) => {
          const isDir = !!item.is_dir;
          const fullPath = currentPath === '/' ? `/${item.name}` : `${currentPath}/${item.name}`;

          return (
            <div
              key={idx}
              onClick={() => handleItemClick(item)}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-xl hover:bg-white/5 cursor-pointer group transition-colors"
            >
              <div className="flex items-center space-x-2 min-w-0 flex-1">
                {isDir ? (
                  <Folder className="w-4 h-4 text-blue-400 shrink-0" />
                ) : (
                  <File className="w-4 h-4 text-gray-400 shrink-0" />
                )}
                <span className={`truncate text-xs ${isDir ? 'text-white font-medium' : 'text-gray-300'}`}>
                  {item.name}
                </span>
              </div>

              <div className="flex items-center space-x-1 shrink-0">
                {!isDir && (
                  <span className="text-[10px] text-gray-500 font-mono mr-1">
                    {formatSize(item.size)}
                  </span>
                )}

                {/* Insert path into terminal */}
                {onInsertPathToTerminal && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onInsertPathToTerminal(fullPath);
                    }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 text-gray-400 hover:text-emerald-300 transition-opacity"
                    title="Insert path into active terminal"
                  >
                    <CornerDownLeft className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer info */}
      <div className="p-2.5 bg-[#11111b] border-t border-white/[0.08] text-[10px] text-gray-500 flex items-center justify-between">
        <span>{items.length} items</span>
        <span>Click item to insert path</span>
      </div>
    </div>
  );
}
