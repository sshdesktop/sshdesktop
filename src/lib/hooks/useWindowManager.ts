import { useWindowStore, useConnectionStore } from '../store';

export function useWindowManager() {
  const store = useWindowStore();
  const activeConnId = useConnectionStore((s) => s.activeConnectionId);

  // Filter windows so each server gets its own isolated application workspace
  const currentServerWindows = store.windows.filter(
    (w) => !w.serverId || w.serverId === activeConnId
  );

  const openApp = (appId: string, title: string, icon?: string, forceFocus: boolean = false) => {
    // Check if an instance of this app is already open for THIS server
    const existing = store.windows.find(
      (w) => w.appId === appId && (!w.serverId || w.serverId === activeConnId)
    );

    if (existing) {
      // App already opened: do NOT reload, do NOT show launching spinner!
      // Simply restore if minimized, bring to front, and focus immediately.
      if (existing.minimized) {
        store.restoreWindow(existing.id);
      }
      store.bringToFront(existing.id);
      store.focusWindow(existing.id);
      return;
    }

    // First time opening app: open window immediately (0ms instant response)
    const offset = (currentServerWindows.length % 8) * 30;
    store.openWindow({
      appId,
      title,
      icon,
      serverId: activeConnId ?? undefined,
      x: 80 + offset,
      y: 40 + offset,
      width: appId === 'api' ? 1120 : appId === 'ssh' || appId === 'browser' ? 1060 : appId === 'terminal' ? 900 : appId === 'monitor' ? 1000 : appId === 'env' ? 950 : 850,
      height: appId === 'api' ? 720 : appId === 'ssh' || appId === 'browser' ? 680 : appId === 'terminal' ? 550 : appId === 'monitor' ? 650 : appId === 'env' ? 640 : 600,
      minimized: false,
      maximized: false,
      focused: true,
    });
  };

  return {
    windows: currentServerWindows,
    allWindows: store.windows,
    launchingAppId: store.launchingAppId,
    openApp,
    close: store.closeWindow,
    focus: store.focusWindow,
    minimize: store.minimizeWindow,
    restore: store.restoreWindow,
    maximize: store.maximizeWindow,
    snap: store.snapWindow,
    toggleFullscreen: store.toggleFullscreen,
  };
}
