import React, { useState, useEffect, useCallback } from 'react';
import { 
  Folder, File, ArrowUp, ArrowLeft, ArrowRight, LayoutGrid, List, 
  Plus, Upload, Download, Trash2, Edit2, FileText, Code, Check, 
  ChevronRight, HardDrive, Home, FolderGit2, RefreshCw
} from 'lucide-react';
import { sftpListDir, sftpMkdir, sftpDelete } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface RemoteFile {
  name: string;
  type: 'dir' | 'file';
  size: string;
  permissions: string;
  owner: string;
  modified: string;
  extension?: string;
}

const FILE_SYSTEM: Record<string, RemoteFile[]> = {
  '/': [
    { name: 'bin', type: 'dir', size: '—', permissions: 'lrwxrwxrwx', owner: 'root', modified: 'Oct 01' },
    { name: 'etc', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'root', modified: 'Oct 01' },
    { name: 'home', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'root', modified: 'Oct 01' },
    { name: 'var', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'root', modified: 'Oct 01' },
    { name: 'usr', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'root', modified: 'Oct 01' },
    { name: 'root', type: 'dir', size: '—', permissions: 'drwx------', owner: 'root', modified: 'Oct 01' },
  ],
  '/home/deploy': [
    { name: 'projects', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'deploy', modified: 'Oct 01 16:30' },
    { name: 'backups', type: 'dir', size: '—', permissions: 'drwx------', owner: 'deploy', modified: 'Sep 28 02:00' },
    { name: 'docker-compose.yml', type: 'file', size: '1.4 KB', permissions: '-rw-r--r--', owner: 'deploy', modified: 'Oct 01 14:10', extension: 'yml' },
    { name: 'app.py', type: 'file', size: '4.8 KB', permissions: '-rwxr-xr-x', owner: 'deploy', modified: 'Sep 30 18:45', extension: 'py' },
    { name: 'README.md', type: 'file', size: '2.1 KB', permissions: '-rw-r--r--', owner: 'deploy', modified: 'Sep 29 11:20', extension: 'md' },
    { name: '.env.production', type: 'file', size: '480 B', permissions: '-rw-------', owner: 'deploy', modified: 'Sep 15 09:00', extension: 'env' },
    { name: 'database_dump.sql.gz', type: 'file', size: '48.2 MB', permissions: '-rw-r--r--', owner: 'deploy', modified: 'Sep 28 02:05', extension: 'gz' }
  ],
  '/home/deploy/projects': [
    { name: 'clouddesk-api', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'deploy', modified: 'Oct 01 12:00' },
    { name: 'clouddesk-web', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'deploy', modified: 'Sep 30 17:15' },
    { name: 'package.json', type: 'file', size: '1.2 KB', permissions: '-rw-r--r--', owner: 'deploy', modified: 'Sep 25 10:00', extension: 'json' }
  ],
  '/home/deploy/backups': [
    { name: 'daily-2026-09-30.tar.gz', type: 'file', size: '184 MB', permissions: '-rw-------', owner: 'deploy', modified: 'Sep 30 02:00', extension: 'gz' },
    { name: 'daily-2026-09-29.tar.gz', type: 'file', size: '182 MB', permissions: '-rw-------', owner: 'deploy', modified: 'Sep 29 02:00', extension: 'gz' }
  ],
  '/var/log': [
    { name: 'nginx', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'root', modified: 'Sep 01 00:00' },
    { name: 'syslog', type: 'file', size: '4.2 MB', permissions: '-rw-r-----', owner: 'syslog', modified: 'Oct 01 19:40', extension: 'log' },
    { name: 'auth.log', type: 'file', size: '1.1 MB', permissions: '-rw-r-----', owner: 'syslog', modified: 'Oct 01 19:42', extension: 'log' },
    { name: 'dpkg.log', type: 'file', size: '320 KB', permissions: '-rw-r--r--', owner: 'root', modified: 'Oct 01 17:10', extension: 'log' }
  ],
  '/etc': [
    { name: 'nginx', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'root', modified: 'Sep 01 10:00' },
    { name: 'ssh', type: 'dir', size: '—', permissions: 'drwxr-xr-x', owner: 'root', modified: 'Sep 01 10:00' },
    { name: 'hosts', type: 'file', size: '240 B', permissions: '-rw-r--r--', owner: 'root', modified: 'Sep 01 10:00', extension: 'conf' },
    { name: 'fstab', type: 'file', size: '680 B', permissions: '-rw-r--r--', owner: 'root', modified: 'Sep 01 10:00', extension: 'conf' }
  ]
};

export default function FileManager() {
  const [currentPath, setCurrentPath] = useState('/home/deploy');
  const [history, setHistory] = useState<string[]>(['/home/deploy']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [files, setFiles] = useState<RemoteFile[]>(FILE_SYSTEM['/home/deploy'] || []);
  const [isLoading, setIsLoading] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const loadDirectory = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const entries = await sftpListDir(activeConnId, path);
      if (entries && entries.length > 0) {
        setFiles(entries.map((item: any) => ({
          name: item.name,
          type: item.is_dir ? 'dir' : 'file',
          size: item.is_dir ? '—' : `${(item.size / 1024).toFixed(1)} KB`,
          permissions: item.permissions || (item.is_dir ? 'drwxr-xr-x' : '-rw-r--r--'),
          owner: item.owner || 'root',
          modified: item.modified ? new Date(item.modified * 1000).toLocaleDateString() : 'Recent',
          extension: item.name.includes('.') ? item.name.split('.').pop() : undefined
        })));
      } else if (FILE_SYSTEM[path]) {
        setFiles(FILE_SYSTEM[path]);
      }
    } catch {
      if (FILE_SYSTEM[path]) {
        setFiles(FILE_SYSTEM[path]);
      }
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
    } catch {}
    await loadDirectory(currentPath);
    setShowNewFolder(false);
    setNewFolderName('');
  };

  const handleDelete = async (name: string) => {
    const targetPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    try {
      await sftpDelete(activeConnId, targetPath);
    } catch {}
    await loadDirectory(currentPath);
    if (selectedFile === name) setSelectedFile(null);
  };

  const breadcrumbs = currentPath.split('/').filter(Boolean);

  return (
    <div className="flex flex-col h-full bg-[#181825] text-[#cdd6f4]">
      {/* Navigation Toolbar */}
      <div className="h-11 bg-[#1e1e2e] border-b border-white/[0.08] flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center space-x-2 flex-1">
          <div className="flex items-center space-x-1">
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
          <button
            onClick={() => setShowNewFolder(true)}
            className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-white"
            title="New Folder"
          >
            <Plus className="w-4 h-4" />
          </button>

          <button
            onClick={() => alert('Drag and drop files to upload via SFTP!')}
            className="p-1.5 hover:bg-white/10 rounded-lg text-gray-300 hover:text-white"
            title="Upload Files"
          >
            <Upload className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          <button
            onClick={() => setView('grid')}
            className={`p-1.5 rounded-lg ${view === 'grid' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:bg-white/10'}`}
            title="Grid View"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button
            onClick={() => setView('list')}
            className={`p-1.5 rounded-lg ${view === 'list' ? 'bg-[var(--accent)] text-white' : 'text-gray-400 hover:bg-white/10'}`}
            title="List View"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Area: Sidebar + Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Places Sidebar */}
        <div className="w-44 bg-[#1e1e2e]/60 border-r border-white/[0.08] p-2 space-y-1 text-xs shrink-0 select-none">
          <div className="text-[10px] font-bold text-gray-500 uppercase px-2 py-1">Quick Places</div>
          <button
            onClick={() => navigateTo('/home/deploy')}
            className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center space-x-2 ${
              currentPath === '/home/deploy' ? 'bg-[var(--accent)] text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            <span>Home</span>
          </button>
          <button
            onClick={() => navigateTo('/home/deploy/projects')}
            className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center space-x-2 ${
              currentPath === '/home/deploy/projects' ? 'bg-[var(--accent)] text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            <span>Projects</span>
          </button>
          <button
            onClick={() => navigateTo('/var/log')}
            className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center space-x-2 ${
              currentPath === '/var/log' ? 'bg-[var(--accent)] text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>System Logs</span>
          </button>
          <button
            onClick={() => navigateTo('/etc')}
            className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center space-x-2 ${
              currentPath === '/etc' ? 'bg-[var(--accent)] text-white font-medium' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>/etc Config</span>
          </button>
        </div>

        {/* Right Directory Browser Canvas */}
        <div className="flex-1 p-4 overflow-y-auto">
          {view === 'grid' ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {files.map(f => (
                <div
                  key={f.name}
                  onClick={() => setSelectedFile(f.name)}
                  onDoubleClick={() => {
                    if (f.type === 'dir') {
                      navigateTo(currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`);
                    }
                  }}
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
                  {files.map(f => (
                    <tr
                      key={f.name}
                      onClick={() => setSelectedFile(f.name)}
                      onDoubleClick={() => {
                        if (f.type === 'dir') {
                          navigateTo(currentPath === '/' ? `/${f.name}` : `${currentPath}/${f.name}`);
                        }
                      }}
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
      </div>

      {/* Status Bar */}
      <div className="h-6 bg-[#11111b] border-t border-white/[0.08] px-4 flex items-center justify-between text-xs text-gray-400 shrink-0 select-none">
        <span>{files.length} items ({currentPath})</span>
        <span className="text-[11px] font-mono">SFTP v3 · 256-bit AES</span>
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
