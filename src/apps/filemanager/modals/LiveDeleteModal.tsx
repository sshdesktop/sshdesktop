import React, { useState, useEffect, useRef } from 'react';
import { Trash2, AlertTriangle, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { sshExecStream, sftpDelete } from '../../../lib/tauri-bridge';

interface LiveDeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeConnId: string;
  currentPath: string;
  items: string[];
  onSuccess: () => void;
}

export const LiveDeleteModal: React.FC<LiveDeleteModalProps> = ({
  isOpen,
  onClose,
  activeConnId,
  currentPath,
  items,
  onSuccess,
}) => {
  const [status, setStatus] = useState<'confirm' | 'deleting' | 'completed' | 'error'>('confirm');
  const [logLines, setLogLines] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deletedCount, setDeletedCount] = useState(0);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const streamIdRef = useRef<string>('');

  useEffect(() => {
    if (!isOpen) {
      setStatus('confirm');
      setLogLines([]);
      setErrorMessage(null);
      setDeletedCount(0);
      return;
    }
    setStatus('confirm');
    setLogLines([]);
    setErrorMessage(null);
    setDeletedCount(0);
  }, [isOpen]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  const startLiveDeletion = async () => {
    if (items.length === 0) return;
    setStatus('deleting');
    setErrorMessage(null);
    setLogLines([`Initiating live deletion for ${items.length} item(s)...`]);
    setDeletedCount(0);

    const streamId = `del-stream-${Date.now()}`;
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
              setDeletedCount((prev) => prev + rawLines.length);
            }
          }
          if (chunk.is_done) {
            if (chunk.exit_code === 0) {
              setStatus('completed');
              setLogLines((prev) => [...prev, `[SUCCESS] Successfully removed all ${items.length} item(s).`]);
              setTimeout(() => {
                onSuccess();
              }, 800);
            } else {
              setStatus('error');
              setErrorMessage(`Delete process finished with exit code ${chunk.exit_code}`);
            }
          }
        }
      });

      const cleanDir = currentPath === '/' ? '/' : currentPath.replace(/\/+$/, '');
      const escapedItems = items.map((it) => `'${it.replace(/'/g, "'\\''")}'`).join(' ');
      const cmd = `cd '${cleanDir.replace(/'/g, "'\\''")}' && rm -rfv ${escapedItems}`;

      await sshExecStream(activeConnId, cmd, streamId);
    } catch (err: any) {
      console.warn('Stream delete error, falling back to sftpDelete:', err);
      try {
        for (const name of items) {
          const targetPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;
          setLogLines((prev) => [...prev, `Deleting: ${targetPath}`]);
          await sftpDelete(activeConnId, targetPath);
          setDeletedCount((prev) => prev + 1);
        }
        setStatus('completed');
        setLogLines((prev) => [...prev, `[SUCCESS] Deleted ${items.length} item(s).`]);
        setTimeout(() => {
          onSuccess();
        }, 800);
      } catch (fallbackErr: any) {
        setStatus('error');
        setErrorMessage(String(fallbackErr?.message || fallbackErr));
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#181825] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Permanently Delete</h3>
              <p className="text-xs text-gray-400">
                {items.length} {items.length === 1 ? 'item' : 'items'} in {currentPath}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={status === 'deleting'}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 flex-1 overflow-y-auto">
          {status === 'confirm' && (
            <div className="space-y-4">
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3.5 flex items-start space-x-3 text-xs text-rose-300">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-rose-200">Are you sure?</div>
                  <div className="text-[11px] opacity-90 mt-0.5">
                    This will permanently delete the following {items.length} item(s) from the server. This action cannot be undone.
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-400 block mb-1.5">Items to Delete:</label>
                <div className="max-h-36 overflow-y-auto bg-[#11111b] rounded-xl border border-white/5 p-2 space-y-1">
                  {items.map((name) => (
                    <div key={name} className="flex items-center space-x-2 text-xs text-gray-300 px-1.5 py-0.5 font-mono">
                      <Trash2 className="w-3.5 h-3.5 text-rose-400/70 shrink-0" />
                      <span className="truncate">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {(status === 'deleting' || status === 'completed' || status === 'error') && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {status === 'deleting' && <Loader2 className="w-4 h-4 text-rose-400 animate-spin" />}
                  {status === 'completed' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                  {status === 'error' && <AlertCircle className="w-4 h-4 text-rose-400" />}
                  <span className="text-xs font-medium text-gray-200">
                    {status === 'deleting'
                      ? 'Deleting files & directories live...'
                      : status === 'completed'
                      ? 'All items deleted successfully'
                      : 'Deletion encountered errors'}
                  </span>
                </div>
                {deletedCount > 0 && (
                  <span className="text-[11px] font-mono text-gray-400">
                    {deletedCount} removed
                  </span>
                )}
              </div>

              {/* Live terminal/log output */}
              <div className="bg-[#11111b] border border-white/10 rounded-xl p-3 font-mono text-xs text-gray-300 max-h-56 overflow-y-auto flex flex-col space-y-1">
                {logLines.length === 0 ? (
                  <div className="text-gray-500 italic py-2">Removing selected files...</div>
                ) : (
                  logLines.map((line, idx) => (
                    <div
                      key={idx}
                      className={`break-all ${
                        line.startsWith('[SUCCESS]')
                          ? 'text-emerald-400 font-bold'
                          : line.includes('error') || line.includes('cannot remove')
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
                    <div className="font-semibold">Deletion Error</div>
                    <div className="text-[11px] opacity-90 mt-0.5">{errorMessage}</div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-white/10 flex items-center justify-end space-x-2.5 bg-white/[0.02]">
          {status === 'confirm' && (
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
                onClick={startLiveDeletion}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-xl transition-colors shadow-lg shadow-rose-600/30 flex items-center space-x-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Permanently</span>
              </button>
            </>
          )}

          {status === 'deleting' && (
            <div className="text-xs text-gray-400 italic flex items-center space-x-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
              <span>Deleting in progress...</span>
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
