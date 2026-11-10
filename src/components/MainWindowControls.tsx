import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Square, X, LogOut, Power, AlertCircle, ExternalLink, CheckCircle2 } from 'lucide-react';
import { isTauri, authLogout, clearStoredSession, sshDisconnect, markConnectionClosed, appExitClean } from '../lib/tauri-bridge';
import { useSettingsStore, useConnectionStore, useWindowStore } from '../lib/store';

// Function to cleanly logout all login sessions across Web and Desktop modes
export async function performAllSessionsLogout(): Promise<void> {
  useConnectionStore.getState().setShuttingDown(true);
  const { connectedServers, activeConnectionId, disconnectedServerId, returnToServersList } = useConnectionStore.getState();

  // 1. Gather all active server sessions
  const serverIds = Array.from(connectedServers.keys());
  if (activeConnectionId && !serverIds.includes(activeConnectionId)) {
    serverIds.push(activeConnectionId);
  }
  if (disconnectedServerId && !serverIds.includes(disconnectedServerId)) {
    serverIds.push(disconnectedServerId);
  }

  // 2. Disconnect each SSH connection cleanly
  await Promise.all(
    serverIds.map(async (id) => {
      try {
        markConnectionClosed(id);
        await sshDisconnect(id);
      } catch (err) {
        console.warn(`[Logout] Error disconnecting server ${id}:`, err);
      }
    })
  );

  // 3. Close all open desktop windows
  useWindowStore.getState().closeAllWindows?.();

  // 4. Reset connection store state
  returnToServersList();

  // 5. In Web Mode (and clearing local session cache), perform complete Web Auth Logout
  try {
    await authLogout();
  } catch (err) {
    console.warn('[Logout] Web auth logout error:', err);
  }
  clearStoredSession();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('sshdesktop-session-expired', {
      detail: { reason: 'Logged out by closing main window.' }
    }));
  }
}

interface MainWindowControlsProps {
  className?: string;
  variant?: 'light' | 'dark' | 'auto';
}

export const MainWindowControls: React.FC<MainWindowControlsProps> = ({
  className = '',
  variant = 'auto',
}) => {
  const { theme } = useSettingsStore();
  const { activeConnectionId, connections } = useConnectionStore();
  const { minimizeAllWindows } = useWindowStore();

  const isLightMode = variant === 'light' || (variant === 'auto' && theme === 'light');

  const [isMaximized, setIsMaximized] = useState(false);
  const [showWebCloseModal, setShowWebCloseModal] = useState(false);
  const [showToast, setShowToast] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const unlistenResizeRef = useRef<(() => void) | null>(null);
  const unlistenCloseRef = useRef<(() => void) | null>(null);

  // Initialize maximized state and listeners
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let mounted = true;

    if (isTauri()) {
      import('@tauri-apps/api/window')
        .then(async ({ getCurrentWindow }) => {
          if (!mounted) return;
          try {
            const appWin = getCurrentWindow();
            const initialMax = await appWin.isMaximized();
            if (mounted) setIsMaximized(initialMax);

            const unlisten = await appWin.onResized(async () => {
              try {
                const currentMax = await appWin.isMaximized();
                if (mounted) setIsMaximized(currentMax);
              } catch {}
            });

            if (mounted) {
              unlistenResizeRef.current = unlisten;
            } else {
              unlisten();
            }

            // Register native window close listener to log out sessions and cleanly exit
            try {
              const unlistenClose = await appWin.onCloseRequested(async (event) => {
                event.preventDefault();
                useConnectionStore.getState().setShuttingDown(true);
                try {
                  await performAllSessionsLogout();
                } catch {}
                await appExitClean();
              });
              if (mounted) {
                unlistenCloseRef.current = unlistenClose;
              } else {
                unlistenClose();
              }
            } catch {}
          } catch (err) {
            console.warn('[MainWindowControls] Tauri window init failed:', err);
          }
        })
        .catch(() => {});
    } else {
      // Browser / Web Mode: Track Fullscreen State
      const syncFullscreen = () => {
        const isFull = Boolean(
          document.fullscreenElement ||
          (document as any).webkitFullscreenElement ||
          (document as any).mozFullScreenElement ||
          (document as any).msFullscreenElement
        );
        setIsMaximized(isFull);
      };

      syncFullscreen();
      document.addEventListener('fullscreenchange', syncFullscreen);
      document.addEventListener('webkitfullscreenchange', syncFullscreen);
      document.addEventListener('mozfullscreenchange', syncFullscreen);
      document.addEventListener('MSFullscreenChange', syncFullscreen);

      return () => {
        document.removeEventListener('fullscreenchange', syncFullscreen);
        document.removeEventListener('webkitfullscreenchange', syncFullscreen);
        document.removeEventListener('mozfullscreenchange', syncFullscreen);
        document.removeEventListener('MSFullscreenChange', syncFullscreen);
      };
    }

    return () => {
      mounted = false;
      if (unlistenResizeRef.current) {
        try {
          unlistenResizeRef.current();
        } catch {}
        unlistenResizeRef.current = null;
      }
      if (unlistenCloseRef.current) {
        try {
          unlistenCloseRef.current();
        } catch {}
        unlistenCloseRef.current = null;
      }
    };
  }, []);

  // Toast feedback auto-dismiss
  useEffect(() => {
    if (!showToast) return;
    const timer = setTimeout(() => setShowToast(null), 2500);
    return () => clearTimeout(timer);
  }, [showToast]);

  // Handle Minimize
  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().minimize();
      } catch (err) {
        console.warn('[MainWindowControls] Tauri minimize error:', err);
      }
    } else {
      // Web Mode: If in fullscreen, exit it
      if (
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement
      ) {
        try {
          if (document.exitFullscreen) await document.exitFullscreen();
          else if ((document as any).webkitExitFullscreen) await (document as any).webkitExitFullscreen();
        } catch {}
      }

      // Minimize all active workspace windows to expose desktop wallpaper
      try {
        minimizeAllWindows();
        setShowToast('Desktop Minimized');
      } catch (err) {
        console.warn('[MainWindowControls] Web minimize error:', err);
      }
    }
  };

  // Handle Maximize / Restore
  const handleToggleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isTauri()) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWin = getCurrentWindow();
        await appWin.toggleMaximize();
        const max = await appWin.isMaximized();
        setIsMaximized(max);
      } catch (err) {
        console.warn('[MainWindowControls] Tauri toggleMaximize error:', err);
      }
    } else {
      // Web Mode: Toggle Fullscreen
      try {
        const doc = document as any;
        const isFull = Boolean(
          doc.fullscreenElement ||
          doc.webkitFullscreenElement ||
          doc.mozFullScreenElement ||
          doc.msFullscreenElement
        );

        if (!isFull) {
          const el = document.documentElement as any;
          if (el.requestFullscreen) {
            await el.requestFullscreen();
          } else if (el.webkitRequestFullscreen) {
            await el.webkitRequestFullscreen();
          } else if (el.mozRequestFullScreen) {
            await el.mozRequestFullScreen();
          } else if (el.msRequestFullscreen) {
            await el.msRequestFullscreen();
          }
          setIsMaximized(true);
        } else {
          if (doc.exitFullscreen) {
            await doc.exitFullscreen();
          } else if (doc.webkitExitFullscreen) {
            await doc.webkitExitFullscreen();
          } else if (doc.mozCancelFullScreen) {
            await doc.mozCancelFullScreen();
          } else if (doc.msExitFullscreen) {
            await doc.msExitFullscreen();
          }
          setIsMaximized(false);
        }
      } catch (err) {
        console.warn('[MainWindowControls] Web fullscreen error:', err);
      }
    }
  };

  // Handle Close: Disconnect and logout all sessions before closing
  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isClosing) return;
    setIsClosing(true);

    try {
      // 1. All login sessions logout (disconnect SSH connections, close windows, clear web auth)
      await performAllSessionsLogout();
    } catch (err) {
      console.warn('[MainWindowControls] Error during session logout on close:', err);
    }

    // 2. Then cleanly terminate application across all platforms
    if (isTauri()) {
      await appExitClean();
    } else {
      // Web Mode: Try closing browser tab directly first
      try {
        window.close();
      } catch {}

      // If browser security blocks window.close(), display clean logout confirmation modal
      setShowWebCloseModal(true);
      setIsClosing(false);
    }
  };

  const currentServer = connections.find(c => c.id === activeConnectionId);

  // Common button styling classes
  const baseBtnClass = `
    inline-flex items-center justify-center h-7 w-8 rounded-md transition-all duration-150
    select-none window-no-drag active:scale-95 cursor-pointer
  `;

  const standardBtnClass = isLightMode
    ? `${baseBtnClass} text-slate-600 hover:text-slate-900 hover:bg-black/10`
    : `${baseBtnClass} text-gray-300 hover:text-white hover:bg-white/10`;

  const closeBtnClass = isLightMode
    ? `${baseBtnClass} text-slate-600 hover:text-white hover:bg-rose-600`
    : `${baseBtnClass} text-gray-300 hover:text-white hover:bg-rose-600`;

  return (
    <>
      <div 
        className={`flex items-center space-x-0.5 window-no-drag select-none ${className}`}
        role="group"
        aria-label="Main Window Controls"
      >
        {/* Minimize Button */}
        <button
          type="button"
          onClick={handleMinimize}
          className={standardBtnClass}
          title={isTauri() ? "Minimize Window" : "Minimize All Windows (Glance Desktop)"}
          aria-label="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        {/* Maximize / Restore Button */}
        <button
          type="button"
          onClick={handleToggleMaximize}
          className={standardBtnClass}
          title={
            isTauri()
              ? isMaximized ? "Restore Window" : "Maximize Window"
              : isMaximized ? "Exit Fullscreen" : "Enter Fullscreen"
          }
          aria-label={isMaximized ? "Restore" : "Maximize"}
        >
          {isMaximized ? (
            <svg 
              className="w-3 h-3" 
              viewBox="0 0 16 16" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="1.5"
            >
              <rect x="3" y="5" width="8" height="8" rx="1" />
              <path d="M5 3h7a1 1 0 011 1v7" />
            </svg>
          ) : (
            <Square className="w-3 h-3" />
          )}
        </button>

        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          disabled={isClosing}
          className={`${closeBtnClass} ${isClosing ? 'opacity-60 cursor-wait' : ''}`}
          title="Logout All Sessions & Close Window"
          aria-label="Close"
        >
          {isClosing ? (
            <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <X className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Web Toast Notification */}
      {showToast && typeof document !== 'undefined' && createPortal(
        <div className="fixed bottom-6 right-6 z-[999999] bg-[#181825]/95 border border-white/20 text-white text-xs px-4 py-2.5 rounded-xl shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-150 flex items-center space-x-2 pointer-events-none select-none">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span>{showToast}</span>
        </div>,
        document.body
      )}

      {/* Web Exit Confirmation Modal */}
      {showWebCloseModal && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-md z-[999999] flex items-center justify-center p-4 window-no-drag select-none animate-in fade-in duration-150"
          onClick={() => setShowWebCloseModal(false)}
        >
          <div 
            className="bg-[#181825]/98 border border-white/20 rounded-3xl w-full max-w-sm p-5 shadow-[0_25px_80px_rgba(0,0,0,0.8)] space-y-4 text-white"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Logged Out & Closed</h3>
                  <p className="text-[11px] text-gray-400">Web Browser Session</p>
                </div>
              </div>
              <button 
                onClick={() => setShowWebCloseModal(false)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white flex items-center justify-center transition-colors"
                title="Cancel"
              >
                ✕
              </button>
            </div>

            {/* Description */}
            <div className="space-y-2 text-xs text-gray-300 leading-relaxed">
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-2.5 flex items-center space-x-2 text-xs text-emerald-300 font-medium">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>All login sessions logged out successfully.</span>
              </div>
              <p>
                All SSH connections have been terminated and your web session has been completely signed out.
              </p>
              <p className="text-[11px] text-gray-400">
                You can safely close this browser tab (press <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px] text-gray-200">Ctrl+W</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-white/10 font-mono text-[10px] text-gray-200">⌘W</kbd>).
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col space-y-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => {
                  try {
                    window.close();
                  } catch {}
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors flex items-center justify-center space-x-2 cursor-pointer shadow-lg shadow-blue-500/20 active:scale-[0.98]"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Close Browser Tab Now</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  window.location.reload();
                }}
                className="w-full py-2 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-gray-200 hover:text-white text-xs transition-colors cursor-pointer flex items-center justify-center space-x-2 active:scale-[0.98]"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign In Again</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default MainWindowControls;
