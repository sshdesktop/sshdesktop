import React, { useEffect } from 'react';
import { useConnectionStore, useWindowStore, useSettingsStore } from './lib/store';
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

  const isLight = theme === 'light' || (theme === 'auto' && !window.matchMedia('(prefers-color-scheme: dark)').matches);

  if (!isAuthenticated) {
    return <WebAuthGate onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className={`w-screen h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)] ${isLight ? 'theme-light' : 'theme-dark'} ${launchingAppId ? 'is-app-launching' : ''}`}>
      {activeConnectionId ? <Desktop /> : <ConnectionScreen />}
      <DisconnectAlertModal />
    </div>
  );
}
