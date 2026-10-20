import React, { useEffect } from 'react';
import { useConnectionStore, useWindowStore, useSettingsStore, useNotificationStore } from './lib/store';
import { storeSaveConnection, settingsGet } from './lib/tauri-bridge';
import ConnectionScreen from './pages/ConnectionScreen';
import Desktop from './shell/Desktop';
import DisconnectAlertModal from './shell/DisconnectAlertModal';
import WebAuthGate, { isWebAuthenticated } from './shell/WebAuthGate';

export default function App() {
  const isTauriNative = typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
  const [isAuthenticated, setIsAuthenticated] = React.useState<boolean>(() => {
    return isTauriNative || isWebAuthenticated();
  });
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const theme = useSettingsStore((state) => state.theme);
  const launchingAppId = useWindowStore((state) => state.launchingAppId);

  // Sync connections to backend disk storage & auto-restore backend session on boot
  useEffect(() => {
    // Auto-create & load settings from C:\Users\<User>\.clouddesk\settings.json
    settingsGet().then((saved: any) => {
      if (saved && typeof saved === 'object') {
        const toUpdate: any = {};
        if (saved.theme) toUpdate.theme = saved.theme;
        if (saved.wallpaper) toUpdate.wallpaper = saved.wallpaper;
        if (saved.dock_position) toUpdate.dockPosition = saved.dock_position;
        if (saved.terminal_font_size) toUpdate.terminalFontSize = saved.terminal_font_size;
        if (saved.editor_font_size) toUpdate.editorFontSize = saved.editor_font_size;
        if (Object.keys(toUpdate).length > 0) {
          useSettingsStore.getState().updateSettings(toUpdate);
        }
      }
    }).catch(() => {});
    const { connections, activeConnectionId, connect } = useConnectionStore.getState();
    if (connections.length > 0) {
      for (const c of connections) {
        storeSaveConnection({
          id: c.id,
          created_at: c.created_at || Date.now(),
          last_connected_at: c.last_connected_at || c.lastConnected || Date.now(),
          name: c.name,
          host: c.host,
          port: Number(c.port) || 22,
          username: c.username,
          password: c.password,
          private_key_path: (c as any).privateKeyPath || (c as any).private_key_path,
          auth_method: (c as any).authMethod || (c as any).auth_method,
          color: c.color,
          group: c.group,
          tags: c.tags || [],
        }).catch(() => {});
      }
    }

    if (activeConnectionId && connections.length > 0) {
      const active = connections.find(c => c.id === activeConnectionId) || connections[0];
      if (active) {
        connect(active.id, active).catch((err: any) => {
          const errMsg = err?.message || String(err);
          console.warn('Startup connection notice:', errMsg);
          // When remote server is stopped or connection times out, trigger alert with exact server ID
          useConnectionStore.getState().triggerDisconnectAlert(
            `Connection to "${active.name || active.host}" timed out or server is stopped. (${errMsg}). Please check if the server is running.`,
            active.id
          );
        });
      }
    }

    // Global listener for SSH disconnect events dispatched by bridge
    const handleDisconnectEvent = (e: any) => {
      const reason = e?.detail?.reason || 'SSH connection was lost or server was stopped.';
      const connId = e?.detail?.connId;
      useConnectionStore.getState().triggerDisconnectAlert(reason, connId);
    };
    window.addEventListener('clouddesk-ssh-disconnected', handleDisconnectEvent);
    return () => window.removeEventListener('clouddesk-ssh-disconnected', handleDisconnectEvent);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const isDark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      root.classList.add('dark');
      root.classList.remove('light');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
      root.setAttribute('data-theme', 'light');
    }

    if (theme === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        if (e.matches) {
          root.classList.add('dark');
          root.classList.remove('light');
          root.setAttribute('data-theme', 'dark');
        } else {
          root.classList.remove('dark');
          root.classList.add('light');
          root.setAttribute('data-theme', 'light');
        }
      };
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme]);

  // Global Protection: Disable browser reload, save page as, inspect, and handle right-click safely across all applications
  useEffect(() => {
    // 1. Right-click context menu interceptor (capture phase)
    const handleGlobalContextMenu = (e: MouseEvent) => {
      // Prevent native browser menu ("Reload", "Save as...", "Inspect") from ever appearing
      e.preventDefault();
    };

    // 2. Keyboard shortcuts interceptor (capture phase)
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrMeta = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Intercept browser reload: Ctrl+R, Ctrl+Shift+R, F5, Ctrl+F5
      if ((isCtrlOrMeta && key === 'r') || e.key === 'F5') {
        const target = e.target as HTMLElement | null;
        const isInsideTerminal = Boolean(target?.closest('.xterm') || target?.closest('.terminal-app'));

        // If inside a terminal: in Linux shell (bash/zsh), Ctrl+R triggers reverse command history search!
        // We MUST prevent browser reload (e.preventDefault()), but allow the terminal to process the Ctrl+R key code!
        if (isInsideTerminal && isCtrlOrMeta && key === 'r') {
          e.preventDefault();
          return;
        }

        // Always prevent host browser/webview reload
        e.preventDefault();
        e.stopPropagation();

        // Check if the currently focused window is the Browser app
        const windows = useWindowStore.getState().windows;
        const focusedWin = windows.find(w => w.focused);
        const isInsideBrowserApp = focusedWin?.appId === 'browser' || Boolean(target?.closest('.browser-app'));

        if (isInsideBrowserApp) {
          // Forward reload to active BrowserApp tab
          window.dispatchEvent(new CustomEvent('sshdesktop:browser-reload'));
        } else {
          // Inform the user that full application reload is safely prevented
          useNotificationStore.getState().addNotification({
            title: 'Reload Blocked',
            message: 'Session reload was prevented to protect your active SSH connections and open windows. Use System ▾ > Restart Session if you wish to reset.',
            type: 'info'
          });
        }
        return;
      }

      // Intercept browser "Save Page As" (Ctrl+S / Cmd+S)
      if (isCtrlOrMeta && key === 's') {
        const target = e.target as HTMLElement | null;
        const isEditable = Boolean(
          target?.tagName === 'INPUT' ||
          target?.tagName === 'TEXTAREA' ||
          target?.isContentEditable ||
          target?.closest('.monaco-editor') ||
          target?.closest('.code-editor') ||
          target?.closest('.note-editor')
        );

        // If not inside an editor that has its own save handler, block browser "Save Page As HTML..."
        if (!isEditable) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      // Intercept browser "Print" (Ctrl+P / Cmd+P)
      if (isCtrlOrMeta && key === 'p') {
        const target = e.target as HTMLElement | null;
        if (!target?.closest('.spotlight-search')) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }

      // Intercept browser "View Page Source" (Ctrl+U / Cmd+U)
      if (isCtrlOrMeta && key === 'u') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    };

    window.addEventListener('contextmenu', handleGlobalContextMenu, { capture: true });
    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });

    return () => {
      window.removeEventListener('contextmenu', handleGlobalContextMenu, { capture: true });
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
    };
  }, []);

  const isLight = theme === 'light' || (theme === 'auto' && !window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (!isAuthenticated) {
    return <WebAuthGate onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className={`w-screen h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)] flex flex-col ${isLight ? 'theme-light' : 'theme-dark'} ${launchingAppId ? 'is-app-launching' : ''}`}>
      {!isTauriNative && (
        <div className="bg-amber-950/90 border-b border-amber-500/40 text-amber-200 text-xs px-4 py-1.5 flex items-center justify-between shrink-0 z-[999999] select-none backdrop-blur-md">
          <div className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
            <span>
              <strong>Web Browser Preview (http://localhost:1420):</strong> Real SSH sockets & raw PTY require the native desktop runtime. Please launch <strong>SSH Desktop (.exe)</strong> or run <code className="bg-black/30 px-1 py-0.5 rounded">npm run tauri:dev</code>.
            </span>
          </div>
          <span className="text-amber-400 font-mono text-[10px] hidden sm:inline-block">Desktop App (.exe) is active</span>
        </div>
      )}
      <div className="flex-1 w-full h-full overflow-hidden relative">
        {activeConnectionId ? <Desktop /> : <ConnectionScreen />}
        <DisconnectAlertModal />
      </div>
    </div>
  );
}
