import React, { useState, useEffect } from 'react';
import { Folder, Archive, FileText, HardDrive, FileCode, Download, Terminal, X, Copy, RefreshCw } from 'lucide-react';
import { RemoteFile, getFileKind } from '../types';
import { sftpChmod, sftpFolderSize, sftpListDir } from '../../../lib/tauri-bridge';

interface GetInfoModalProps {
  getInfoTarget: RemoteFile | null;
  currentPath: string;
  activeConnId: string;
  onClose: () => void;
  onEdit: (fileName: string) => void;
  onDownload: (file: RemoteFile) => void;
  onTerminal: () => void;
  onReload: () => void;
  showToast: (msg: string) => void;
}

export const GetInfoModal: React.FC<GetInfoModalProps> = ({
  getInfoTarget,
  currentPath,
  activeConnId,
  onClose,
  onEdit,
  onDownload,
  onTerminal,
  onReload,
  showToast,
}) => {
  const [folderSize, setFolderSize] = useState<string | null>(null);
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const targetPath = !getInfoTarget ? '' : currentPath === '/' ? `/${getInfoTarget.name}` : `${currentPath}/${getInfoTarget.name}`;

  useEffect(() => {
    if (getInfoTarget?.type === 'dir') {
      setIsCalculating(true);
      setFolderSize(null);
      setItemCount(null);

      Promise.allSettled([
        sftpFolderSize(activeConnId, targetPath),
        sftpListDir(activeConnId, targetPath),
      ]).then(([sizeRes, listRes]) => {
        if (sizeRes.status === 'fulfilled' && sizeRes.value && sizeRes.value !== '—') {
          setFolderSize(sizeRes.value);
        } else {
          setFolderSize('0 B');
        }

        if (listRes.status === 'fulfilled' && Array.isArray(listRes.value)) {
          setItemCount(listRes.value.length);
        }
      }).catch(err => {
        console.warn('Folder info calculation error:', err);
        setFolderSize('—');
      }).finally(() => {
        setIsCalculating(false);
      });
    }
  }, [getInfoTarget, targetPath, activeConnId]);

  if (!getInfoTarget) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className="bg-[#1e1e2e]/98 border border-white/20 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col text-xs font-sans max-h-[88vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* macOS Window Chrome Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#14141e]/90 border-b border-white/10 shrink-0">
          <div className="flex items-center space-x-2">
            <button 
              onClick={onClose}
              className="w-3 h-3 rounded-full bg-[#FF5F56] hover:brightness-110 flex items-center justify-center text-[8px] text-black font-bold"
              title="Close"
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
            onClick={onClose}
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
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-sm text-white break-words select-text">
                {getInfoTarget.name}
              </h3>
              <p className="text-[11px] text-gray-400 font-medium">
                {getFileKind(getInfoTarget)}
              </p>
              <p className="text-[11px] text-blue-400 font-mono mt-0.5 flex items-center space-x-1.5">
                {getInfoTarget.type === 'dir' ? (
                  isCalculating ? (
                    <span className="flex items-center space-x-1 text-blue-300">
                      <RefreshCw className="w-3 h-3 animate-spin inline-block mr-1" />
                      <span>Calculating folder size...</span>
                    </span>
                  ) : (
                    <span>
                      {folderSize || '0 B'}{itemCount !== null ? ` (${itemCount} ${itemCount === 1 ? 'item' : 'items'})` : ''}
                    </span>
                  )
                ) : (
                  <span>
                    {getInfoTarget.size} {getInfoTarget.rawSize ? `(${getInfoTarget.rawSize.toLocaleString()} bytes)` : ''}
                  </span>
                )}
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
                <span className="text-gray-200">
                  {getInfoTarget.type === 'dir' ? (
                    isCalculating ? (
                      <span className="flex items-center space-x-1 text-blue-400">
                        <RefreshCw className="w-2.5 h-2.5 animate-spin inline-block mr-1" />
                        <span>Calculating...</span>
                      </span>
                    ) : (
                      `${folderSize || '0 B'}${itemCount !== null ? ` (${itemCount} ${itemCount === 1 ? 'item' : 'items'})` : ''}`
                    )
                  ) : (
                    getInfoTarget.size
                  )}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-sans">Where:</span>
                <div className="flex items-center space-x-1.5 truncate max-w-[200px]">
                  <span className="text-blue-400 truncate" title={targetPath}>
                    {targetPath}
                  </span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(targetPath);
                      showToast('Copied full path');
                    }}
                    className="text-gray-500 hover:text-white shrink-0"
                    title="Copy full path"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-500 font-sans">Modified:</span>
                <span className="text-gray-200">{getInfoTarget.modified}</span>
              </div>
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

            {/* Quick 1-Click Permissions Presets */}
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
                      try {
                        await sftpChmod(activeConnId, targetPath, parseInt(p.mode, 8));
                        onReload();
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
                    onEdit(getInfoTarget.name);
                    onClose();
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium shadow-md transition-colors flex items-center space-x-1"
                >
                  <FileCode className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
                <button
                  onClick={() => onDownload(getInfoTarget)}
                  className="px-3 py-1.5 bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-300 rounded-xl text-xs font-medium transition-colors flex items-center space-x-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>
              </>
            )}
            <button
              onClick={() => {
                onTerminal();
                onClose();
              }}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-gray-200 rounded-xl text-xs font-medium transition-colors flex items-center space-x-1"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>Terminal</span>
            </button>
          </div>

          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white rounded-xl text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
