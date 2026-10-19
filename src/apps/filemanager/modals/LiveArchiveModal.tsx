import React, { useState, useEffect, useRef } from 'react';
import { Archive, PackageOpen, X, CheckCircle2, AlertCircle, Loader2, Terminal, FileText, ArrowRight } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { sshExecStream, sftpCreateZipPure, sftpExtractArchivePure } from '../../../lib/tauri-bridge';

interface LiveArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeConnId: string;
  mode: 'compress' | 'extract';
  archiveType?: 'tar.gz' | 'zip';
  currentPath: string;
  items?: string[]; // for compress
  targetArchive?: string; // for extract
  onSuccess: (outputName: string) => void;
}

export const LiveArchiveModal: React.FC<LiveArchiveModalProps> = ({
  isOpen,
  onClose,
  activeConnId,
  mode,
  archiveType = 'zip',
  currentPath,
  items = [],
  targetArchive,
  onSuccess,
}) => {
  const [archiveFormat, setArchiveFormat] = useState<'tar.gz' | 'zip'>(archiveType);
  const [archiveNameInput, setArchiveNameInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'error'>('idle');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processedCount, setProcessedCount] = useState(0);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const streamIdRef = useRef<string>('');

  useEffect(() => {
    if (!isOpen) {
      setStatus('idle');
      setLogLines([]);
      setErrorMessage(null);
      setProcessedCount(0);
      return;
    }

    if (mode === 'compress') {
      const defaultStem = items.length === 1 ? items[0].replace(/\.[^/.]+$/, '') : 'archive';
      const ext = archiveFormat === 'tar.gz' ? '.tar.gz' : '.zip';
      setArchiveNameInput(`${defaultStem}${ext}`);
      setStatus('idle');
    } else {
      // Auto-start extract
      startExtraction();
    }
  }, [isOpen, mode]);

  useEffect(() => {
    if (mode === 'compress' && archiveNameInput) {
      const stem = archiveNameInput.replace(/(\.tar\.gz|\.zip|\.tgz|\.tar)$/i, '');
      const ext = archiveFormat === 'tar.gz' ? '.tar.gz' : '.zip';
      setArchiveNameInput(`${stem}${ext}`);
    }
  }, [archiveFormat]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  const startCompression = async () => {
    if (!archiveNameInput.trim() || items.length === 0) return;
    setStatus('running');
    setErrorMessage(null);
    setLogLines([`Starting compression (${archiveFormat}) for ${items.length} item(s)...`]);
    setProcessedCount(0);

    const streamId = `arch-comp-${Date.now()}`;
    streamIdRef.current = streamId;

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<any>('exec-output', (event) => {
        const chunk = event.payload;
        if (chunk && chunk.stream_id === streamId) {
          if (chunk.data) {
            const rawLines = chunk.data.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
            if (rawLines.length > 0) {
              setLogLines((prev) => [...prev, ...rawLines]);
              setProcessedCount((prev) => prev + rawLines.length);
            }
          }
          if (chunk.is_done) {
            if (chunk.exit_code === 0) {
              setStatus('completed');
              setLogLines((prev) => [...prev, `[SUCCESS] Created archive: ${archiveNameInput}`]);
              setTimeout(() => {
                onSuccess(archiveNameInput);
              }, 600);
            } else {
              setStatus('error');
              setErrorMessage(`Process exited with error code ${chunk.exit_code}`);
            }
          }
        }
      });

      const cleanDir = currentPath === '/' ? '/' : currentPath.replace(/\/+$/, '');
      const escapedItems = items.map((it) => `'${it.replace(/'/g, "'\\''")}'`).join(' ');
      const escapedOutput = `'${archiveNameInput.replace(/'/g, "'\\''")}'`;

      let cmd = '';
      if (archiveFormat === 'tar.gz') {
        cmd = `cd '${cleanDir.replace(/'/g, "'\\''")}' && tar -czvf ${escapedOutput} ${escapedItems}`;
      } else {
        cmd = `cd '${cleanDir.replace(/'/g, "'\\''")}' && (command -v zip >/dev/null 2>&1 && zip -rv ${escapedOutput} ${escapedItems} || python3 -m zipfile -c ${escapedOutput} ${escapedItems})`;
      }

      await sshExecStream(activeConnId, cmd, streamId);
    } catch (err: any) {
      console.warn('Stream compression error, falling back to pure API:', err);
      try {
        await sftpCreateZipPure(activeConnId, currentPath, items, archiveNameInput);
        setStatus('completed');
        setLogLines((prev) => [...prev, `[SUCCESS] Created archive: ${archiveNameInput}`]);
        setTimeout(() => {
          onSuccess(archiveNameInput);
        }, 600);
      } catch (fallbackErr: any) {
        setStatus('error');
        setErrorMessage(String(fallbackErr?.message || fallbackErr));
      }
    }
  };

  const startExtraction = async () => {
    if (!targetArchive) return;
    setStatus('running');
    setErrorMessage(null);
    setLogLines([`Extracting archive: ${targetArchive}...`]);
    setProcessedCount(0);

    const streamId = `arch-ext-${Date.now()}`;
    streamIdRef.current = streamId;

    let unlisten: (() => void) | null = null;
    try {
      unlisten = await listen<any>('exec-output', (event) => {
        const chunk = event.payload;
        if (chunk && chunk.stream_id === streamId) {
          if (chunk.data) {
            const rawLines = chunk.data.split(/\r?\n/).filter((l: string) => l.trim().length > 0);
            if (rawLines.length > 0) {
              setLogLines((prev) => [...prev, ...rawLines]);
              setProcessedCount((prev) => prev + rawLines.length);
            }
          }
          if (chunk.is_done) {
            if (chunk.exit_code === 0) {
              setStatus('completed');
              setLogLines((prev) => [...prev, `[SUCCESS] Extracted archive completely.`]);
              setTimeout(() => {
                onSuccess(targetArchive);
              }, 600);
            } else {
              setStatus('error');
              setErrorMessage(`Extraction failed with exit code ${chunk.exit_code}`);
            }
          }
        }
      });

      const cleanDest = currentPath === '/' ? '/' : currentPath.replace(/\/+$/, '');
      const fullArchive = currentPath === '/' ? `/${targetArchive}` : `${currentPath}/${targetArchive}`;
      const escapedArch = `'${fullArchive.replace(/'/g, "'\\''")}'`;
      const escapedDest = `'${cleanDest.replace(/'/g, "'\\''")}'`;

      const lower = targetArchive.toLowerCase();
      let cmd = '';
      if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
        cmd = `mkdir -p ${escapedDest} && tar -xzvf ${escapedArch} -C ${escapedDest}`;
      } else if (lower.endsWith('.tar.bz2')) {
        cmd = `mkdir -p ${escapedDest} && tar -xjvf ${escapedArch} -C ${escapedDest}`;
      } else if (lower.endsWith('.tar.xz')) {
        cmd = `mkdir -p ${escapedDest} && tar -xJvf ${escapedArch} -C ${escapedDest}`;
      } else if (lower.endsWith('.tar')) {
        cmd = `mkdir -p ${escapedDest} && tar -xvf ${escapedArch} -C ${escapedDest}`;
      } else if (lower.endsWith('.zip')) {
        cmd = `mkdir -p ${escapedDest} && (command -v unzip >/dev/null 2>&1 && unzip -o ${escapedArch} -d ${escapedDest} || python3 -m zipfile -e ${escapedArch} ${escapedDest})`;
      } else {
        cmd = `mkdir -p ${escapedDest} && tar -xvf ${escapedArch} -C ${escapedDest}`;
      }

      await sshExecStream(activeConnId, cmd, streamId);
    } catch (err: any) {
      console.warn('Stream extraction error, falling back to pure API:', err);
      try {
        await sftpExtractArchivePure(activeConnId, currentPath, targetArchive);
        setStatus('completed');
        setLogLines((prev) => [...prev, `[SUCCESS] Extracted ${targetArchive}`]);
        setTimeout(() => {
          onSuccess(targetArchive);
        }, 600);
      } catch (fallbackErr: any) {
        setStatus('error');
        setErrorMessage(String(fallbackErr?.message || fallbackErr));
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#181825] border border-white/10 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
              mode === 'compress' ? 'bg-blue-500/20 text-blue-400' : 'bg-emerald-500/20 text-emerald-400'
            }`}>
              {mode === 'compress' ? <Archive className="w-5 h-5" /> : <PackageOpen className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {mode === 'compress' ? 'Compress Files' : 'Extract Archive'}
              </h3>
              <p className="text-xs text-gray-400">
                {mode === 'compress'
                  ? `Archiving ${items.length} item(s) in ${currentPath}`
                  : `Extracting ${targetArchive} to ${currentPath}`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={status === 'running'}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          {mode === 'compress' && status === 'idle' && (
            <div className="space-y-4">
              {/* Format selection */}
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-2">Archive Format</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setArchiveFormat('zip')}
                    className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                      archiveFormat === 'zip'
                        ? 'border-blue-500 bg-blue-500/15 text-white font-medium'
                        : 'border-white/10 bg-white/[0.02] text-gray-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold">ZIP (.zip)</div>
                      <div className="text-[11px] text-gray-400">Standard compression</div>
                    </div>
                    {archiveFormat === 'zip' && <CheckCircle2 className="w-4 h-4 text-blue-400" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => setArchiveFormat('tar.gz')}
                    className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all ${
                      archiveFormat === 'tar.gz'
                        ? 'border-blue-500 bg-blue-500/15 text-white font-medium'
                        : 'border-white/10 bg-white/[0.02] text-gray-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <div>
                      <div className="text-xs font-bold">TAR.GZ (.tar.gz)</div>
                      <div className="text-[11px] text-gray-400">Linux native gzip</div>
                    </div>
                    {archiveFormat === 'tar.gz' && <CheckCircle2 className="w-4 h-4 text-blue-400" />}
                  </button>
                </div>
              </div>

              {/* Archive Name Input */}
              <div>
                <label className="text-xs font-medium text-gray-300 block mb-1.5">Archive Filename</label>
                <input
                  type="text"
                  value={archiveNameInput}
                  onChange={(e) => setArchiveNameInput(e.target.value)}
                  placeholder={`archive.${archiveFormat}`}
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              {/* Items List Preview */}
              <div>
                <label className="text-xs font-medium text-gray-400 block mb-1.5">Selected Items ({items.length})</label>
                <div className="max-h-28 overflow-y-auto bg-[#11111b] rounded-xl border border-white/5 p-2 space-y-1">
                  {items.map((name) => (
                    <div key={name} className="flex items-center space-x-2 text-xs text-gray-300 px-1.5 py-0.5">
                      <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                      <span className="truncate">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Running / Log display */}
          {(status === 'running' || status === 'completed' || status === 'error' || mode === 'extract') && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {status === 'running' && <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />}
                  {status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {status === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
                  <span className="text-xs font-medium text-gray-200">
                    {status === 'running'
                      ? mode === 'compress' ? 'Compressing files live...' : 'Extracting archive live...'
                      : status === 'completed' ? 'Operation Completed Successfully' : 'Operation Failed'}
                  </span>
                </div>
                {processedCount > 0 && (
                  <span className="text-[11px] font-mono text-gray-400">
                    {processedCount} files processed
                  </span>
                )}
              </div>

              {/* Live terminal/log viewer */}
              <div className="bg-[#11111b] border border-white/10 rounded-xl p-3 font-mono text-xs text-gray-300 max-h-56 overflow-y-auto flex flex-col space-y-1">
                {logLines.length === 0 ? (
                  <div className="text-gray-500 italic py-2">Waiting for archive output...</div>
                ) : (
                  logLines.map((line, idx) => (
                    <div
                      key={idx}
                      className={`break-all ${
                        line.startsWith('[SUCCESS]')
                          ? 'text-emerald-400 font-bold'
                          : line.includes('error') || line.includes('Error')
                          ? 'text-rose-400'
                          : 'text-gray-300'
                      }`}
                    >
                      {line}
                    </div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>

              {/* Error Banner */}
              {errorMessage && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-start space-x-2.5 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                  <div>
                    <div className="font-semibold">Archive Error</div>
                    <div className="text-[11px] opacity-90 mt-0.5">{errorMessage}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-white/10 flex items-center justify-end space-x-2.5 bg-white/[0.02]">
          {status === 'idle' && mode === 'compress' && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs text-gray-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={startCompression}
                disabled={!archiveNameInput.trim()}
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-colors shadow-lg shadow-blue-600/30 flex items-center space-x-1.5 disabled:opacity-50"
              >
                <span>Compress</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {status === 'running' && (
            <div className="text-xs text-gray-400 italic flex items-center space-x-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              <span>Please wait while archive is processing...</span>
            </div>
          )}

          {(status === 'completed' || status === 'error') && (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-white bg-white/10 hover:bg-white/15 rounded-xl transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
