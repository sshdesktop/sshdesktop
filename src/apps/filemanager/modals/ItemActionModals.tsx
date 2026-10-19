import React, { useState } from 'react';
import { Folder, FileText, Edit3, Terminal, AlertTriangle, RefreshCw, X, CheckCircle, ShieldAlert } from 'lucide-react';
import { sftpMkdir, sftpWriteTextFile, sftpRename } from '../../../lib/tauri-bridge';
import { RemoteFile } from '../types';

interface NewFolderModalProps {
  isOpen: boolean;
  currentPath: string;
  activeConnId: string;
  onClose: () => void;
  onSuccess: (folderName: string) => void;
}

export const NewFolderModal: React.FC<NewFolderModalProps> = ({
  isOpen,
  currentPath,
  activeConnId,
  onClose,
  onSuccess,
}) => {
  const [folderName, setFolderName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = folderName.trim();
    if (!name) return;
    setIsSubmitting(true);
    setError(null);
    const target = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    try {
      await sftpMkdir(activeConnId, target);
      setFolderName('');
      onSuccess(name);
      onClose();
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
      <form onSubmit={handleSubmit} className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
        <h3 className="font-bold text-base text-white flex items-center space-x-2">
          <Folder className="w-5 h-5 text-blue-400" />
          <span>New Folder</span>
        </h3>
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-start space-x-2 text-rose-300 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}
        <input
          type="text"
          autoFocus
          required
          disabled={isSubmitting}
          placeholder="Folder Name"
          value={folderName}
          onChange={e => setFolderName(e.target.value)}
          className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <div className="flex justify-end space-x-2 pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => { setError(null); onClose(); }}
            className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md flex items-center space-x-1.5 disabled:opacity-50"
          >
            {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>Create Folder</span>
          </button>
        </div>
      </form>
    </div>
  );
};

interface NewFileModalProps {
  isOpen: boolean;
  currentPath: string;
  activeConnId: string;
  onClose: () => void;
  onSuccess: (fileName: string) => void;
}

export const NewFileModal: React.FC<NewFileModalProps> = ({
  isOpen,
  currentPath,
  activeConnId,
  onClose,
  onSuccess,
}) => {
  const [fileName, setFileName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = fileName.trim();
    if (!name) return;
    setIsSubmitting(true);
    setError(null);
    const target = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
    try {
      await sftpWriteTextFile(activeConnId, target, '');
      setFileName('');
      onSuccess(name);
      onClose();
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
      <form onSubmit={handleSubmit} className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
        <h3 className="font-bold text-base text-white flex items-center space-x-2">
          <FileText className="w-5 h-5 text-emerald-400" />
          <span>New File</span>
        </h3>
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-start space-x-2 text-rose-300 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}
        <input
          type="text"
          autoFocus
          required
          disabled={isSubmitting}
          placeholder="e.g. script.sh, index.html"
          value={fileName}
          onChange={e => setFileName(e.target.value)}
          className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 font-mono disabled:opacity-50"
        />
        <div className="flex justify-end space-x-2 pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => { setError(null); onClose(); }}
            className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md flex items-center space-x-1.5 disabled:opacity-50"
          >
            {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>Create File</span>
          </button>
        </div>
      </form>
    </div>
  );
};

interface RenameModalProps {
  isOpen: boolean;
  target: string;
  currentPath: string;
  activeConnId: string;
  onClose: () => void;
  onSuccess: (newName: string) => void;
}

export const RenameModal: React.FC<RenameModalProps> = ({
  isOpen,
  target,
  currentPath,
  activeConnId,
  onClose,
  onSuccess,
}) => {
  const [newName, setNewName] = useState(target);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    setNewName(target);
    setError(null);
  }, [target, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || trimmed === target) {
      onClose();
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const oldPath = currentPath === '/' ? `/${target}` : `${currentPath}/${target}`;
    const newPath = currentPath === '/' ? `/${trimmed}` : `${currentPath}/${trimmed}`;
    try {
      await sftpRename(activeConnId, oldPath, newPath);
      onSuccess(trimmed);
      onClose();
    } catch (err: any) {
      setError(String(err?.message || err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
      <form onSubmit={handleSubmit} className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-sm p-6 space-y-4 shadow-2xl">
        <h3 className="font-bold text-base text-white flex items-center space-x-2">
          <Edit3 className="w-5 h-5 text-purple-400" />
          <span>Rename Item</span>
        </h3>
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-start space-x-2 text-rose-300 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
            <span>{error}</span>
          </div>
        )}
        <input
          type="text"
          autoFocus
          required
          disabled={isSubmitting}
          value={newName}
          onChange={e => setNewName(e.target.value)}
          className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <div className="flex justify-end space-x-2 pt-2">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => { setError(null); onClose(); }}
            className="px-4 py-2 rounded-xl text-xs text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-medium shadow-md flex items-center space-x-1.5 disabled:opacity-50"
          >
            {isSubmitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : null}
            <span>Rename</span>
          </button>
        </div>
      </form>
    </div>
  );
};

interface ScriptOutputModalProps {
  modal: {
    file: RemoteFile;
    output: string;
    status: 'running' | 'success' | 'failed';
  } | null;
  onClose: () => void;
}

export const ScriptOutputModal: React.FC<ScriptOutputModalProps> = ({ modal, onClose }) => {
  if (!modal) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
      <div className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden">
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-black/20">
          <div className="flex items-center space-x-2">
            <Terminal className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-white text-sm">Output: {modal.file.name}</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 flex-1 overflow-y-auto font-mono text-xs bg-[#11111b] text-gray-200 whitespace-pre-wrap select-text">
          {modal.output}
        </div>
        <div className="p-3 border-t border-white/10 flex justify-between items-center bg-black/20">
          <div className="flex items-center space-x-2">
            {modal.status === 'running' && (
              <span className="flex items-center text-xs text-blue-400"><RefreshCw className="w-3 h-3 animate-spin mr-1" /> Running...</span>
            )}
            {modal.status === 'success' && (
              <span className="flex items-center text-xs text-emerald-400"><CheckCircle className="w-3 h-3 mr-1" /> Finished successfully</span>
            )}
            {modal.status === 'failed' && (
              <span className="flex items-center text-xs text-rose-400"><AlertTriangle className="w-3 h-3 mr-1" /> Execution failed</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

interface PermissionAlertModalProps {
  message: string | null;
  onClose: () => void;
}

export const PermissionAlertModal: React.FC<PermissionAlertModalProps> = ({ message, onClose }) => {
  if (!message) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
      <div className="bg-[#1e1e2e] border border-white/10 rounded-3xl w-full max-w-md p-6 space-y-4 shadow-2xl">
        <div className="flex items-center space-x-3 text-amber-400">
          <ShieldAlert className="w-6 h-6" />
          <h3 className="font-bold text-base text-white">Access Notice</h3>
        </div>
        <p className="text-xs text-gray-300 leading-relaxed">{message}</p>
        <div className="flex justify-end pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold"
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>
  );
};
