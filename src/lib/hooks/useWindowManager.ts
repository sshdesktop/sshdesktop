import { useWindowStore } from '../store';

export function useWindowManager() {
  const store = useWindowStore();

  const openApp = (appId: string, title: string, icon?: string) => {
    // Check if an instance of this app is already open
    const existing = store.windows.find(w => w.appId === appId);
    if (existing) {
      if (existing.minimized) {
        // 1. Minimized window -> restore and bring to front
        store.restoreWindow(existing.id);
      } else if (existing.focused) {
        // 2. Already focused window -> second click minimizes it
        store.minimizeWindow(existing.id);
      } else {
        // 3. Unfocused window in background -> bring to front and focus
        store.bringToFront(existing.id);
        store.focusWindow(existing.id);
      }
    } else {
      // Calculate a staggered position for new windows
      const offset = (store.windows.length % 8) * 30;
      store.openWindow({
        appId,
        title,
        icon,
        x: 80 + offset,
        y: 40 + offset,
        width: appId === 'terminal' ? 900 : appId === 'monitor' ? 1000 : 850,
        height: appId === 'terminal' ? 550 : appId === 'monitor' ? 650 : 600,
        minimized: false,
        maximized: false,
        focused: true,
      });
    }
  };

  return {
    windows: store.windows,
    openApp,
    close: store.closeWindow,
    focus: store.focusWindow,
    minimize: store.minimizeWindow,
    restore: store.restoreWindow,
    maximize: store.maximizeWindow,
  };
}
