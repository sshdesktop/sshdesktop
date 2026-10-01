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
  connect: (id: string, overrideConfig?: Partial<SavedConnection>) => Promise<void>;
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
      connect: async (id, overrideConfig) => {
        const conn = get().connections.find(c => c.id === id);
        const target: any = { ...conn, ...overrideConfig };
        if (!target.host) {
          throw new Error('Server IP or hostname is required');
        }

        // Strictly await backend verification; will throw if credentials or host are invalid
        await sshConnect({
          id,
          name: target.name || `${target.username}@${target.host}`,
          host: target.host,
          port: Number(target.port) || 22,
          username: target.username,
          password: target.password,
          private_key_path: target.privateKeyPath || target.private_key_path,
          color: target.color,
          group: target.group,
          tags: target.tags || [],
        });

        // Only mark connected when backend verification succeeds
        const newMap = new Map(get().connectedServers);
        newMap.set(id, { id, name: target.name || target.host, host: target.host, status: 'connected' });
        set({ connectedServers: newMap, activeConnectionId: id });
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
    windows: state.windows.map(w => ({
      ...w,
      zIndex: w.id === id ? state.nextZIndex : w.zIndex,
      focused: w.id === id
    })),
    nextZIndex: state.nextZIndex + 1
  }))
}));

interface SettingsState {
  theme: 'dark' | 'light' | 'auto';
  accentColor: string;
  terminalFontSize: number;
  dockPosition: 'bottom' | 'left';
  showHiddenFiles: boolean;
  pollingInterval: number;
  updateSettings: (newSettings: Partial<Omit<SettingsState, 'updateSettings'>>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      accentColor: '#89B4FA',
      terminalFontSize: 14,
      dockPosition: 'bottom',
      showHiddenFiles: true,
      pollingInterval: 3,
      updateSettings: (newSettings) => set((state) => ({ ...state, ...newSettings }))
    }),
    {
      name: 'settings-storage'
    }
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
    notifications: [
      { ...n, id: `notif-${Date.now()}`, timestamp: Date.now(), read: false },
      ...state.notifications
    ]
  })),
  markRead: (id) => set((state) => ({
    notifications: state.notifications.map(n => n.id === id ? { ...n, read: true } : n)
  })),
  clearAll: () => set({ notifications: [] })
}));
