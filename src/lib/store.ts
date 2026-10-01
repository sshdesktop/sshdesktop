import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SavedConnection, WindowState, Notification } from './types';
import { sshConnect, sshDisconnect } from './tauri-bridge';

interface ConnectionState {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  connectedServers: Map<string, { id: string; name: string; host: string; status: string }>;
  addConnection: (conn: SavedConnection) => void;
  removeConnection: (id: string) => void;
  setActive: (id: string | null) => void;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      connections: [],
      activeConnectionId: null,
      connectedServers: new Map(),
      addConnection: (conn) => set((state) => ({ connections: [...state.connections.filter(c => c.id !== conn.id), conn] })),
      removeConnection: (id) => set((state) => ({ connections: state.connections.filter((c) => c.id !== id) })),
      setActive: (id) => set({ activeConnectionId: id }),
      connect: async (id) => {
        const conn = get().connections.find(c => c.id === id);
        if (conn) {
          try {
            await sshConnect({
              name: conn.name,
              host: conn.host,
              port: conn.port || 22,
              username: conn.username,
              password: (conn as any).password,
              private_key_path: (conn as any).privateKeyPath,
              color: conn.color,
              group: conn.group,
              tags: conn.tags || [],
            });
          } catch (err) {
            console.warn('[CloudDesk] sshConnect warning:', err);
          }
          const newMap = new Map(get().connectedServers);
          newMap.set(id, { id, name: conn.name, host: conn.host, status: 'connected' });
          set({ connectedServers: newMap, activeConnectionId: id });
        }
      },
      disconnect: async (id) => {
        try {
          await sshDisconnect(id);
        } catch {}
        const newMap = new Map(get().connectedServers);
        newMap.delete(id);
        set({ connectedServers: newMap, activeConnectionId: get().activeConnectionId === id ? null : get().activeConnectionId });
      },
    }),
    {
      name: 'connection-storage',
      partialize: (state) => ({ connections: state.connections }),
    }
  )
);

interface WindowStoreState {
  windows: WindowState[];
  nextZIndex: number;
  openWindow: (win: Omit<WindowState, 'id' | 'zIndex'>) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  updatePosition: (id: string, x: number, y: number) => void;
  updateSize: (id: string, width: number, height: number) => void;
  bringToFront: (id: string) => void;
}

export const useWindowStore = create<WindowStoreState>((set) => ({
  windows: [],
  nextZIndex: 10,
  openWindow: (win) => set((state) => {
    const id = `win-${Date.now()}`;
    return {
      windows: [...state.windows, { ...win, id, zIndex: state.nextZIndex }],
      nextZIndex: state.nextZIndex + 1
    };
  }),
  closeWindow: (id) => set((state) => ({ windows: state.windows.filter(w => w.id !== id) })),
  focusWindow: (id) => set((state) => ({
    windows: state.windows.map(w => ({
      ...w,
      focused: w.id === id,
      zIndex: w.id === id ? state.nextZIndex : w.zIndex
    })),
    nextZIndex: state.nextZIndex + 1
  })),
  minimizeWindow: (id) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? { ...w, minimized: true, focused: false } : w)
  })),
  maximizeWindow: (id) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? { ...w, maximized: !w.maximized } : w)
  })),
  updatePosition: (id, x, y) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? { ...w, x, y } : w)
  })),
  updateSize: (id, width, height) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? { ...w, width, height } : w)
  })),
  bringToFront: (id) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? { ...w, zIndex: state.nextZIndex } : w),
    nextZIndex: state.nextZIndex + 1
  })),
}));

interface SettingsState {
  theme: 'dark' | 'light' | 'auto';
  accentColor: string;
  terminalFontSize: number;
  dockPosition: 'bottom' | 'left';
  showHiddenFiles: boolean;
  pollingInterval: number;
  updateSettings: (settings: Partial<SettingsState>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      accentColor: '#89B4FA',
      terminalFontSize: 14,
      dockPosition: 'bottom',
      showHiddenFiles: false,
      pollingInterval: 2000,
      updateSettings: (s) => set((state) => ({ ...state, ...s })),
    }),
    { name: 'settings-storage' }
  )
);

interface NotificationState {
  notifications: Notification[];
  addNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markRead: (id: string) => void;
  clearAll: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  addNotification: (n) => set((state) => ({
    notifications: [{ ...n, id: `notif-${Date.now()}`, timestamp: Date.now(), read: false }, ...state.notifications]
  })),
  markRead: (id) => set((state) => ({
    notifications: state.notifications.map(n => n.id === id ? { ...n, read: true } : n)
  })),
  clearAll: () => set({ notifications: [] })
}));
