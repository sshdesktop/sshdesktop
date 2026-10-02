import React, { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { Save, FileCode, Check, RefreshCw, X, Plus, FolderOpen, AlertCircle } from 'lucide-react';
import { sftpReadTextFile, sftpWriteTextFile } from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';

interface FileTab {
  id: string;
  name: string;
  remotePath: string;
  language: string;
  content: string;
  isModified: boolean;
}

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'py': return 'python';
    case 'js': return 'javascript';
    case 'ts': case 'tsx': return 'typescript';
    case 'json': return 'json';
    case 'yml': case 'yaml': return 'yaml';
    case 'sh': case 'bash': return 'shell';
    case 'rs': return 'rust';
    case 'sql': return 'sql';
    case 'html': return 'html';
    case 'css': return 'css';
    case 'conf': case 'cfg': case 'ini': return 'ini';
    case 'md': return 'markdown';
    default: return 'plaintext';
  }
}

export default function CodeEditor() {
  const [files, setFiles] = useState<FileTab[]>([
    {
      id: '1',
      name: 'nginx.conf',
      remotePath: '/etc/nginx/nginx.conf',
      language: 'plaintext',
      content: '# Click "Open Remote File" to load any file directly from your Linux server\n',
      isModified: false,
    }
  ]);
  const [activeFileId, setActiveFileId] = useState<string>('1');
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [openModal, setOpenModal] = useState<boolean>(false);
  const [remotePathInput, setRemotePathInput] = useState<string>('/etc/hosts');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { pendingFilePath, clearPendingFile } = useEditorStore();

  useEffect(() => {
    if (pendingFilePath) {
      const openTarget = async () => {
        setLoading(true);
        setError(null);
        try {
          const content = await sftpReadTextFile(activeConnId, pendingFilePath);
          const fileName = pendingFilePath.split('/').filter(Boolean).pop() || 'file';
          const newTab: FileTab = {
            id: String(Date.now()),
            name: fileName,
            remotePath: pendingFilePath,
            language: detectLanguage(fileName),
            content,
            isModified: false,
          };
          setFiles(prev => {
            const withoutSame = prev.filter(f => f.remotePath !== pendingFilePath);
            return [...withoutSame, newTab];
          });
          setActiveFileId(newTab.id);
        } catch (err: any) {
          setError(`Failed to open remote file ${pendingFilePath}: ${err?.message || err}`);
        } finally {
          setLoading(false);
          clearPendingFile();
        }
      };
      openTarget();
    }
  }, [pendingFilePath, activeConnId, clearPendingFile]);

  const activeFile = files.find(f => f.id === activeFileId) || files[0];

  const handleEditorChange = (value: string | undefined) => {
    if (value === undefined) return;
    setFiles(prev =>
      prev.map(f =>
        f.id === activeFileId ? { ...f, content: value, isModified: true } : f
      )
    );
  };

  const handleSave = async () => {
    if (!activeFile) return;
    setLoading(true);
    setError(null);
    try {
      await sftpWriteTextFile(activeConnId, activeFile.remotePath, activeFile.content);
      setFiles(prev =>
        prev.map(f => (f.id === activeFileId ? { ...f, isModified: false } : f))
      );
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2000);
    } catch (err: any) {
      setError(`Failed to save via SFTP: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenRemoteFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!remotePathInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const content = await sftpReadTextFile(activeConnId, remotePathInput.trim());
      const fileName = remotePathInput.split('/').filter(Boolean).pop() || 'file.txt';
      const newTab: FileTab = {
        id: String(Date.now()),
        name: fileName,
        remotePath: remotePathInput.trim(),
        language: detectLanguage(fileName),
        content,
        isModified: false,
      };
      setFiles(prev => [...prev, newTab]);
      setActiveFileId(newTab.id);
      setOpenModal(false);
    } catch (err: any) {
      setError(`Failed to read remote file: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (files.length === 1) return;
    const remaining = files.filter(f => f.id !== id);
    setFiles(remaining);
    if (activeFileId === id) {
      setActiveFileId(remaining[0].id);
    }
  };

  const newFile = () => {
    const id = String(Date.now());
    const nextFile: FileTab = {
      id,
      name: `untitled-${files.length + 1}.txt`,
      remotePath: `/tmp/untitled-${files.length + 1}.txt`,
      language: 'plaintext',
      content: '// New document on Linux server\n',
      isModified: false,
    };
    setFiles([...files, nextFile]);
    setActiveFileId(id);
  };

  return (
    <div className="flex flex-col h-full bg-[#1e1e2e] text-[#cdd6f4]">
      {/* Tab bar & Toolbar */}
      <div className="flex items-center justify-between bg-[#181825] border-b border-white/[0.08] px-2 pt-1.5 shrink-0">
        <div className="flex items-center space-x-1 overflow-x-auto">
          {files.map(file => (
            <div
              key={file.id}
              onClick={() => setActiveFileId(file.id)}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-t-lg text-xs font-mono transition-colors cursor-pointer group ${
                activeFileId === file.id
                  ? 'bg-[#1e1e2e] text-[var(--accent)] font-medium border-t-2 border-t-[var(--accent)]'
                  : 'text-gray-400 hover:bg-white/[0.05] hover:text-gray-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5 text-blue-400" />
              <span>{file.name}</span>
              {file.isModified && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
              {files.length > 1 && (
                <button
                  onClick={(e) => closeTab(file.id, e)}
                  className="opacity-0 group-hover:opacity-100 hover:bg-white/20 p-0.5 rounded transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}

          <button
            onClick={newFile}
            className="p-1.5 hover:bg-white/[0.08] rounded-md text-gray-400 hover:text-white"
            title="New File"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Toolbar actions */}
        <div className="flex items-center space-x-2 pb-1.5">
          <button
            onClick={() => setOpenModal(true)}
            className="flex items-center space-x-1 bg-[#313244] hover:bg-white/10 text-gray-200 text-xs px-2.5 py-1 rounded transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
            <span>Open Path</span>
          </button>

          <select
            value={activeFile?.language || 'plaintext'}
            onChange={(e) => {
              const lang = e.target.value;
              setFiles(prev =>
                prev.map(f => (f.id === activeFileId ? { ...f, language: lang } : f))
              );
            }}
            className="bg-[#313244] border border-white/10 text-xs rounded px-2 py-1 text-gray-300 focus:outline-none"
          >
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="yaml">YAML</option>
            <option value="json">JSON</option>
            <option value="sql">SQL</option>
            <option value="shell">Bash/Shell</option>
            <option value="rust">Rust</option>
            <option value="html">HTML</option>
            <option value="css">CSS</option>
            <option value="ini">Config/INI</option>
            <option value="markdown">Markdown</option>
            <option value="plaintext">Plain Text</option>
          </select>

          <button
            onClick={handleSave}
            disabled={loading}
            className={`flex items-center space-x-1 text-xs px-2.5 py-1 rounded font-medium transition-colors ${
              savedSuccess
                ? 'bg-emerald-600 text-white'
                : 'bg-[var(--accent)] hover:bg-blue-600 text-white'
            }`}
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : savedSuccess ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            <span>{loading ? 'Saving...' : savedSuccess ? 'Saved to Server!' : 'Save (SFTP)'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-500/10 border-b border-rose-500/20 px-3 py-1.5 text-xs text-rose-300 flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-gray-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Editor Main Canvas */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={activeFile?.language || 'plaintext'}
          value={activeFile?.content || ''}
          theme="vs-dark"
          onChange={handleEditorChange}
          options={{
            fontSize: 14,
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            minimap: { enabled: true },
            wordWrap: 'on',
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            cursorBlinking: 'smooth',
          }}
        />
      </div>

      {/* Status bar */}
      <div className="h-6 bg-[#181825] border-t border-white/[0.08] px-4 flex items-center justify-between text-xs font-mono text-gray-400 shrink-0">
        <div className="flex items-center space-x-3">
          <span className="text-gray-300 truncate max-w-sm">Remote: {activeFile?.remotePath}</span>
          <span>SFTP Live</span>
          <span>UTF-8</span>
        </div>
        <div className="flex items-center space-x-3">
          <span>{activeFile?.language}</span>
          <span>{activeFile?.isModified ? '● Modified' : 'Saved'}</span>
        </div>
      </div>

      {/* Open Remote File Modal */}
      {openModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form onSubmit={handleOpenRemoteFile} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-white">Open File from Linux Server (SFTP)</h3>
            <div>
              <label className="text-gray-400 block mb-1 text-xs">Full Absolute Remote Path</label>
              <input
                type="text"
                required
                value={remotePathInput}
                onChange={e => setRemotePathInput(e.target.value)}
                placeholder="/etc/nginx/nginx.conf or /var/log/syslog"
                className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setOpenModal(false)}
                className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 rounded-lg text-xs bg-[var(--accent)] hover:bg-blue-600 text-white font-medium flex items-center space-x-1"
              >
                {loading && <RefreshCw className="w-3 h-3 animate-spin" />}
                <span>Fetch File</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
