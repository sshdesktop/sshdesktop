import React, { useState, useEffect, useRef } from 'react';
import { 
  FileCode, Save, RotateCw, Check, X, ExternalLink, AlertTriangle, 
  Copy, Undo2, Play, Sparkles, Terminal, CheckCircle2, ShieldCheck,
  WrapText, ArrowRight, ShieldAlert, Maximize2, Minimize2
} from 'lucide-react';
import { sshExec, serviceAction } from '../../../lib/tauri-bridge';
import { useWindowManager } from '../../../lib/hooks/useWindowManager';
import { useEditorStore } from '../../../lib/store';

function toBase64Utf8(str: string): string {
  try {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  } catch {
    return btoa(unescape(encodeURIComponent(str)));
  }
}

interface EditServiceModalProps {
  serviceName: string;
  activeConnId: string;
  onClose: () => void;
  onRestartService?: (serviceName: string) => Promise<void>;
  onReloadServices?: () => void;
}

export default function EditServiceModal({
  serviceName,
  activeConnId,
  onClose,
  onRestartService,
  onReloadServices
}: EditServiceModalProps) {
  const [filePath, setFilePath] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const [originalCode, setOriginalCode] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isRestarting, setIsRestarting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [permissionAlert, setPermissionAlert] = useState<{ title: string; message: string; path?: string } | null>(null);
  const [wordWrap, setWordWrap] = useState<boolean>(false);
  const [restartAfterSave, setRestartAfterSave] = useState<boolean>(true);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  const { openApp } = useWindowManager();
  const { openFileInEditor } = useEditorStore();

  const isDirty = code !== originalCode;

  // Load service unit file content and detect exact file path
  useEffect(() => {
    let isMounted = true;
    const fetchUnitFile = async () => {
      setIsLoading(true);
      setStatusMessage(null);
      try {
        const queryScript = `
          PATH_VAL=$(systemctl show -p FragmentPath --value "${serviceName}" 2>/dev/null)
          if [ -z "$PATH_VAL" ] || [ ! -f "$PATH_VAL" ]; then
            CAT_PATH=$(systemctl cat "${serviceName}" 2>/dev/null | head -n 1 | sed 's/^# //')
            if [ -n "$CAT_PATH" ] && [ -f "$CAT_PATH" ]; then
              PATH_VAL="$CAT_PATH"
            fi
          fi
          if [ -z "$PATH_VAL" ]; then
            if [ -f "/etc/systemd/system/${serviceName}.service" ]; then
              PATH_VAL="/etc/systemd/system/${serviceName}.service"
            elif [ -f "/lib/systemd/system/${serviceName}.service" ]; then
              PATH_VAL="/lib/systemd/system/${serviceName}.service"
            elif [ -f "/usr/lib/systemd/system/${serviceName}.service" ]; then
              PATH_VAL="/usr/lib/systemd/system/${serviceName}.service"
            else
              PATH_VAL="/etc/systemd/system/${serviceName}.service"
            fi
          fi
          echo "CLOUDDESK_UNIT_PATH:$PATH_VAL"
          if [ -f "$PATH_VAL" ]; then
            cat "$PATH_VAL"
          else
            systemctl cat "${serviceName}" 2>/dev/null || true
          fi
        `;

        const res = await sshExec(activeConnId, queryScript);
        if (!isMounted) return;

        const out = res.stdout || '';
        const match = out.match(/^CLOUDDESK_UNIT_PATH:([^\r\n]+)\r?\n([\s\S]*)$/);
        if (match) {
          const detectedPath = match[1].trim();
          const content = match[2];
          setFilePath(detectedPath);
          setCode(content);
          setOriginalCode(content);
        } else {
          setFilePath(`/etc/systemd/system/${serviceName}.service`);
          setCode(out);
          setOriginalCode(out);
        }
      } catch (err: any) {
        if (!isMounted) return;
        setStatusMessage({
          text: `Failed to load unit file: ${err?.message || err}`,
          isError: true
        });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchUnitFile();
    return () => { isMounted = false; };
  }, [serviceName, activeConnId]);

  // Sync scroll between textarea and line numbers
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  // Support Tab key indentation in textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const val = ta.value;

      const updated = val.substring(0, start) + '    ' + val.substring(end);
      setCode(updated);

      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 4;
        }
      });
    } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  const handleInsertSnippet = (snippet: string) => {
    if (!textareaRef.current) {
      setCode(prev => prev + '\n' + snippet);
      return;
    }
    const ta = textareaRef.current;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;

    const updated = val.substring(0, start) + snippet + val.substring(end);
    setCode(updated);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + snippet.length;
    });
  };

  const handleSave = async () => {
    if (!filePath) return;
    setIsSaving(true);
    setStatusMessage(null);
    setSaveSuccess(false);
    setPermissionAlert(null);

    try {
      // Encode UTF-8 content to base64 safely
      const b64 = toBase64Utf8(code);
      // Start command with "sudo " so backend routes directly to run_cmd_priv (handles root, sudo -n, and sudo -S)
      const saveCmd = `sudo sh -c 'printf "%s" "${b64}" | base64 -d > "${filePath}" && systemctl daemon-reload'`;
      
      const res = await sshExec(activeConnId, saveCmd);
      if (res.exit_code !== 0) {
        const rawErr = res.stdout || res.stderr || `Command exited with code ${res.exit_code}`;
        throw new Error(rawErr);
      }

      setOriginalCode(code);
      setSaveSuccess(true);
      setStatusMessage({
        text: `Unit file saved & daemon-reloaded successfully (${filePath})`,
        isError: false
      });

      if (restartAfterSave) {
        setIsRestarting(true);
        try {
          if (onRestartService) {
            await onRestartService(serviceName);
          } else {
            await serviceAction(activeConnId, serviceName, 'restart');
          }
          setStatusMessage({
            text: `Saved, daemon-reloaded, and restarted '${serviceName}' successfully!`,
            isError: false
          });
        } catch (rstErr: any) {
          setStatusMessage({
            text: `Saved & reloaded daemon, but restart failed: ${rstErr?.message || rstErr}`,
            isError: true
          });
        } finally {
          setIsRestarting(false);
        }
      }

      if (onReloadServices) {
        onReloadServices();
      }

      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      const isPerm = /permission denied|not in sudoers|is not allowed to execute|password is required|authentication failure|sudoers|terminal is required|polkit|access denied/i.test(errMsg);

      setStatusMessage({
        text: isPerm
          ? `Permission Denied: Administrator (sudo) privileges required to edit '${filePath}'.`
          : `Failed to save unit file: ${errMsg}`,
        isError: true
      });

      if (isPerm) {
        setPermissionAlert({
          title: 'Permission Denied',
          message: `Administrator (sudo) privileges are required to save changes to this systemd unit file.\n\nPlease ensure your user account has sudo privileges or connect with a root user session.\n\nServer response:\n${errMsg}`,
          path: filePath
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenInCodeEditor = () => {
    if (filePath) {
      openFileInEditor(filePath);
      openApp('editor', 'Code Editor');
      onClose();
    }
  };

  const lines = code.split('\n');

  return (
    <div 
      className="absolute inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-2 sm:p-3 md:p-4 font-sans select-none overflow-hidden animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div 
        className={`bg-[#181a28] border border-white/20 rounded-2xl w-full flex flex-col shadow-2xl overflow-hidden text-[#cdd6f4] relative transition-all duration-150 ${
          isMaximized 
            ? 'h-full max-h-full max-w-full rounded-none' 
            : 'max-w-4xl h-full max-h-[calc(100%-0.5rem)] sm:max-h-[calc(100%-1rem)]'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* macOS Title Bar */}
        <div className="bg-[#121420] border-b border-white/[0.08] px-4 py-2.5 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <FileCode className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-mono font-bold text-sm text-white">{serviceName}</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 font-mono">
                  systemd unit
                </span>
                {isDirty && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" title="Unsaved changes" />
                )}
              </div>
              <div className="font-mono text-[11px] text-gray-400 truncate max-w-md" title={filePath}>
                {filePath || 'Detecting unit file path...'}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Maximize / Restore Toggle */}
            <button
              onClick={() => setIsMaximized(!isMaximized)}
              className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 hover:text-white flex items-center transition-colors"
              title={isMaximized ? "Restore Modal Size" : "Maximize Modal Size"}
            >
              {isMaximized ? (
                <Minimize2 className="w-3.5 h-3.5 text-blue-400" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 text-blue-400" />
              )}
            </button>

            {/* Open in CloudDesk Code Editor */}
            <button
              onClick={handleOpenInCodeEditor}
              disabled={!filePath || isLoading}
              className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-gray-300 hover:text-white flex items-center space-x-1.5 transition-colors"
              title="Open in Code Editor Application"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden sm:inline">Open in Code Editor</span>
            </button>

            {/* Close Button */}
            <button 
              onClick={onClose} 
              className="p-1.5 hover:bg-white/10 rounded-xl text-gray-400 hover:text-white transition-colors"
              title="Close (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Snippets & Utility Bar */}
        <div className="bg-[#141624] border-b border-white/[0.06] px-4 py-2 flex items-center justify-between text-xs overflow-x-auto shrink-0 gap-2">
          <div className="flex items-center space-x-1.5 shrink-0">
            <span className="text-[11px] text-gray-400 font-medium flex items-center space-x-1 mr-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Snippets:</span>
            </span>
            <button
              onClick={() => handleInsertSnippet('Restart=always\nRestartSec=5s')}
              className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-mono text-gray-300 hover:text-white border border-white/5 transition-colors"
              title="Add automatic service recovery"
            >
              + Restart=always
            </button>
            <button
              onClick={() => handleInsertSnippet('LimitNOFILE=65535')}
              className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-mono text-gray-300 hover:text-white border border-white/5 transition-colors"
              title="Set high open file descriptors limit"
            >
              + LimitNOFILE=65535
            </button>
            <button
              onClick={() => handleInsertSnippet('Environment="NODE_ENV=production"')}
              className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-mono text-gray-300 hover:text-white border border-white/5 transition-colors"
              title="Set environment variable"
            >
              + Environment=
            </button>
            <button
              onClick={() => handleInsertSnippet('StandardOutput=journal\nStandardError=journal')}
              className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] font-mono text-gray-300 hover:text-white border border-white/5 transition-colors"
              title="Redirect stdout/stderr to journalctl"
            >
              + Journal Logging
            </button>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={() => setWordWrap(!wordWrap)}
              className={`px-2 py-0.5 rounded-lg text-[11px] flex items-center space-x-1 border transition-colors ${
                wordWrap 
                  ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' 
                  : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
              }`}
              title="Toggle Word Wrap"
            >
              <WrapText className="w-3 h-3" />
              <span>Wrap</span>
            </button>

            {isDirty && (
              <button
                onClick={() => setCode(originalCode)}
                className="px-2 py-0.5 rounded-lg bg-white/5 hover:bg-white/10 text-[11px] text-gray-400 hover:text-amber-300 flex items-center space-x-1 border border-white/10 transition-colors"
                title="Discard unwritten changes"
              >
                <Undo2 className="w-3 h-3" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Status / Alert Banner */}
        {statusMessage && (
          <div className={`px-4 py-2 text-xs flex items-center justify-between shrink-0 border-b ${
            statusMessage.isError 
              ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' 
              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
          }`}>
            <div className="flex items-center space-x-2 font-mono">
              {statusMessage.isError ? (
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
            <button onClick={() => setStatusMessage(null)} className="text-gray-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Code Editor Body with Line Numbers */}
        <div className="flex-1 min-h-0 min-w-0 bg-[#0d0f18] flex relative overflow-hidden font-mono text-xs select-text">
          {isLoading ? (
            <div className="w-full h-full flex flex-col items-center justify-center space-y-3 text-gray-400">
              <RotateCw className="w-6 h-6 animate-spin text-blue-400" />
              <span className="font-sans text-xs">Loading unit file from {filePath || 'server'}...</span>
            </div>
          ) : (
            <>
              {/* Line Numbers Gutter */}
              <div 
                ref={lineNumbersRef}
                className="w-12 bg-[#10121d] text-gray-600 select-none py-3 text-right pr-3 font-mono text-[11px] border-r border-white/[0.06] overflow-hidden shrink-0"
              >
                {lines.map((_, i) => (
                  <div key={i} className="h-5 leading-5">{i + 1}</div>
                ))}
              </div>

              {/* Editable Text Area */}
              <textarea
                ref={textareaRef}
                value={code}
                onChange={e => setCode(e.target.value)}
                onScroll={handleScroll}
                onKeyDown={handleKeyDown}
                spellCheck={false}
                className={`flex-1 min-h-0 min-w-0 bg-transparent p-3 text-[#cdd6f4] font-mono text-[11px] leading-5 resize-none focus:outline-none overflow-y-auto scrollbar-thin ${
                  wordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre overflow-x-auto'
                }`}
                placeholder="[Unit]&#10;Description=My Custom Service&#10;&#10;[Service]&#10;ExecStart=/usr/bin/my-app&#10;Restart=always&#10;&#10;[Install]&#10;WantedBy=multi-user.target"
              />
            </>
          )}
        </div>

        {/* Bottom Action Footer */}
        <div className="bg-[#121420] border-t border-white/[0.08] px-4 py-2.5 flex items-center justify-between text-xs shrink-0">
          <div className="flex items-center space-x-3 text-gray-400">
            <span>{lines.length} lines</span>
            <span>·</span>
            <span>{code.length} chars</span>
            <span>·</span>
            <label className="flex items-center space-x-1.5 cursor-pointer text-gray-300 hover:text-white select-none">
              <input
                type="checkbox"
                checked={restartAfterSave}
                onChange={e => setRestartAfterSave(e.target.checked)}
                className="rounded bg-white/10 border-white/20 text-blue-600 focus:ring-0"
              />
              <span>Restart service after save</span>
            </label>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white font-medium transition-colors"
            >
              Cancel
            </button>

            <button
              onClick={handleSave}
              disabled={isSaving || isLoading || !filePath}
              className={`px-4 py-1.5 rounded-xl font-medium flex items-center space-x-1.5 shadow-lg transition-all active:scale-95 ${
                saveSuccess
                  ? 'bg-emerald-600 text-white'
                  : isDirty
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-white/15 hover:bg-white/20 text-white'
              }`}
            >
              {isSaving || isRestarting ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{isRestarting ? 'Restarting...' : 'Saving & Reloading...'}</span>
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="w-3.5 h-3.5 text-white" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Unit & Reload Daemon</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Permission Denied Alert Dialog */}
        {permissionAlert && (
          <div 
            className="absolute inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-[#1a1c2b] border border-rose-500/30 rounded-2xl max-w-md w-full shadow-2xl p-5 text-gray-200 flex flex-col space-y-4">
              <div className="flex items-start space-x-3">
                <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-bold text-white mb-1">
                    {permissionAlert.title}
                  </h3>
                  <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">
                    {permissionAlert.message}
                  </p>
                  {permissionAlert.path && (
                    <div className="mt-2 text-[11px] font-mono bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/10 text-rose-300 break-all select-text">
                      {permissionAlert.path}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex justify-end pt-2 border-t border-white/10">
                <button
                  onClick={() => setPermissionAlert(null)}
                  className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg transition-colors cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
