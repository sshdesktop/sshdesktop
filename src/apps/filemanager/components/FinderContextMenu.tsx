import React from 'react';
import { 
  Folder, FileText, FileCode, Download, Upload, Terminal, Eye, Copy, 
  Scissors, Info, Archive, PackageOpen, Trash2, ClipboardPaste, RefreshCw, Plus, HardDrive 
} from 'lucide-react';
import { RemoteFile, ContextMenuState } from '../types';

interface FinderContextMenuProps {
  contextMenu: ContextMenuState | null;
  currentPath: string;
  selectedFiles: Set<string>;
  clipboard: any;
  showHiddenFiles: boolean;
  onClose: () => void;
  onOpenTarget: (fileName: string) => void;
  onNavigateTo: (path: string) => void;
  onDownloadFile: (file?: RemoteFile) => void;
  onUploadFile: () => void;
  onQuickLook: (file?: RemoteFile) => void;
  onInstallPackage: (file: RemoteFile) => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onRename: () => void;
  onGetInfo: () => void;
  onCalculateFolderSize?: (folderName: string) => void;
  onExtract: (file: RemoteFile) => void;
  onCompress: (type: 'zip' | 'tar.gz') => void;
  onDelete: () => void;
  onOpenTerminalHere: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onToggleHiddenFiles: () => void;
  onReload: () => void;
}

export const FinderContextMenu: React.FC<FinderContextMenuProps> = ({
  contextMenu,
  currentPath,
  selectedFiles,
  clipboard,
  showHiddenFiles,
  onClose,
  onOpenTarget,
  onNavigateTo,
  onDownloadFile,
  onUploadFile,
  onQuickLook,
  onInstallPackage,
  onDuplicate,
  onCopy,
  onCut,
  onPaste,
  onRename,
  onGetInfo,
  onCalculateFolderSize,
  onExtract,
  onCompress,
  onDelete,
  onOpenTerminalHere,
  onNewFolder,
  onNewFile,
  onToggleHiddenFiles,
  onReload,
}) => {
  if (!contextMenu) return null;

  return (
    <div 
      className="fixed z-50 bg-[#1e1e2e]/98 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl py-1.5 min-w-[210px] text-xs font-sans animate-in fade-in zoom-in-95 duration-100"
      style={{ 
        left: `${Math.min(contextMenu.x, window.innerWidth - 230)}px`, 
        top: `${Math.min(contextMenu.y, window.innerHeight - 380)}px` 
      }}
      onClick={e => e.stopPropagation()}
    >
      {contextMenu.file ? (
        <>
          {contextMenu.file.type === 'file' ? (
            <>
              <div 
                onClick={() => { onOpenTarget(contextMenu.file!.name); onClose(); }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium"
              >
                <FileCode className="w-3.5 h-3.5" />
                <span>Open in Code Editor</span>
              </div>

              {/* Single Download Button */}
              <div 
                onClick={() => { onDownloadFile(contextMenu.file); onClose(); }}
                className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-emerald-400"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download to Computer</span>
              </div>

              {/* Package Installer / Shell Script */}
              {(contextMenu.file.name.endsWith('.deb') || 
                contextMenu.file.name.endsWith('.rpm') || 
                contextMenu.file.name.endsWith('.sh') || 
                contextMenu.file.name.endsWith('.bash')) && (
                <div 
                  onClick={() => { onInstallPackage(contextMenu.file!); onClose(); }}
                  className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-emerald-300"
                >
                  <PackageOpen className="w-3.5 h-3.5" />
                  <span>
                    {contextMenu.file.name.endsWith('.deb') || contextMenu.file.name.endsWith('.rpm')
                      ? 'Install Software Package'
                      : 'Run Script / Installer'}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <div 
                onClick={() => { 
                  const targetPath = currentPath === '/' ? `/${contextMenu.file!.name}` : `${currentPath}/${contextMenu.file!.name}`;
                  onNavigateTo(targetPath); 
                  onClose(); 
                }}
                className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium"
              >
                <Folder className="w-3.5 h-3.5" />
                <span>Open Folder</span>
              </div>
              {onCalculateFolderSize && (
                <div 
                  onClick={() => { 
                    onCalculateFolderSize(contextMenu.file!.name); 
                    onClose(); 
                  }}
                  className="px-3.5 py-1.5 hover:bg-indigo-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-indigo-400"
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>Calculate Folder Size</span>
                </div>
              )}
            </>
          )}

          <div 
            onClick={() => { onQuickLook(contextMenu.file); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Quick Look (Ctrl + Space)</span>
          </div>

          <div 
            onClick={() => { onUploadFile(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-cyan-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-cyan-400"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload to this Directory</span>
          </div>

          <div 
            onClick={() => { onDuplicate(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Duplicate (Ctrl+D)</span>
          </div>

          <div 
            onClick={() => { onCopy(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Copy (Ctrl+C)</span>
          </div>

          <div 
            onClick={() => { onCut(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Cut (Ctrl+X)</span>
          </div>

          <div 
            onClick={() => { onRename(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Rename...</span>
          </div>

          <div 
            onClick={() => { onGetInfo(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <Info className="w-3.5 h-3.5 text-blue-400" />
              <span>Get Info</span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">⌘I</span>
          </div>

          {/* Extract archive option */}
          {(contextMenu.file.name.endsWith('.tar.gz') || 
            contextMenu.file.name.endsWith('.tgz') || 
            contextMenu.file.name.endsWith('.tar.bz2') || 
            contextMenu.file.name.endsWith('.tar') || 
            contextMenu.file.name.endsWith('.zip') || 
            contextMenu.file.name.endsWith('.gz')) && (
            <div 
              onClick={() => { onExtract(contextMenu.file!); onClose(); }}
              className="px-3.5 py-1.5 hover:bg-emerald-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-emerald-300"
            >
              <PackageOpen className="w-3.5 h-3.5" />
              <span>Extract Archive Here</span>
            </div>
          )}

          {/* Compress options */}
          <div 
            onClick={() => { onCompress('zip'); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Compress (.zip)</span>
          </div>

          <div 
            onClick={() => { onCompress('tar.gz'); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Archive className="w-3.5 h-3.5" />
            <span>Compress (.tar.gz)</span>
          </div>

          <div 
            onClick={() => { onOpenTerminalHere(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Open Terminal Here</span>
          </div>

          <div className="my-1 border-t border-white/10" />

          <div 
            onClick={() => { onDelete(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-red-600/20 text-red-400 flex items-center space-x-2 cursor-pointer font-medium"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete Permanently</span>
          </div>
        </>
      ) : (
        /* Canvas Context Menu */
        <>
          <div 
            onClick={() => { onNewFolder(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Folder className="w-3.5 h-3.5 text-blue-400" />
            <span>New Folder</span>
          </div>

          <div 
            onClick={() => { onNewFile(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5 text-emerald-400" />
            <span>New File</span>
          </div>

          <div 
            onClick={() => { onUploadFile(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-cyan-600 hover:text-white flex items-center space-x-2 cursor-pointer font-medium text-cyan-400"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload from Computer</span>
          </div>

          {selectedFiles.size > 0 && (
            <div 
              onClick={() => { onCompress('zip'); onClose(); }}
              className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Compress Selected ({selectedFiles.size})</span>
            </div>
          )}

          {clipboard && (
            <div 
              onClick={() => { onPaste(); onClose(); }}
              className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              <span>Paste</span>
            </div>
          )}

          <div 
            onClick={() => { onToggleHiddenFiles(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-gray-400" />
            <span>{showHiddenFiles ? 'Hide Hidden Items' : 'Show Hidden Items'}</span>
          </div>

          <div 
            onClick={() => { onReload(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-blue-400" />
            <span>Reload Directory</span>
          </div>

          <div 
            onClick={() => { onOpenTerminalHere(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center space-x-2 cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-emerald-400" />
            <span>Open Terminal Here</span>
          </div>

          <div 
            onClick={() => { onGetInfo(); onClose(); }}
            className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white flex items-center justify-between cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <Info className="w-3.5 h-3.5 text-blue-400" />
              <span>Get Folder Info</span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono">⌘I</span>
          </div>
        </>
      )}
    </div>
  );
};
