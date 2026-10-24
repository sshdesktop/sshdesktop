import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SavedConnection, WindowState, Notification, UserPrivilegeInfo } from './types';
export type { WindowState } from './types';
import { 
  sshConnect, sshDisconnect, settingsGet, settingsSave, 
  storeSaveConnection, storeDeleteConnection, storeListConnections,
  sshGetUserPrivilege
} from './tauri-bridge';

interface ConnectionState {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  userPrivilege: UserPrivilegeInfo | null;
  connectedServers: Map<string, { id: string; name: string; host: string; status: string }>;
  isDisconnected: boolean;
  disconnectReason: string | null;
  isReconnecting: boolean;
  reconnectAttempts: number;
  reconnectError: string | null;
  disconnectedServerId: string | null;
  setUserPrivilege: (priv: UserPrivilegeInfo | null) => void;
  fetchUserPrivilege: (connId?: string) => Promise<UserPrivilegeInfo>;
  addConnection: (conn: SavedConnection) => void;
  updateConnection: (id: string, updates: Partial<SavedConnection>) => void;
  removeConnection: (id: string) => void;
  setActive: (id: string | null) => void;
  setDisconnected: (isDisconnected: boolean, reason?: string | null, serverId?: string | null) => void;
  triggerDisconnectAlert: (reason?: string, serverId?: string | null) => void;
  resetReconnectAttempts: () => void;
  connect: (id: string, overrideConfig?: Partial<SavedConnection>) => Promise<void>;
  reconnect: (targetServerId?: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  closeServer: (id: string) => Promise<void>;
  switchToOtherServer: (targetId: string) => Promise<void>;
  returnToServersList: () => void;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      connections: [],
      activeConnectionId: null,
      userPrivilege: null,
      connectedServers: new Map(),
      isDisconnected: false,
      disconnectReason: null,
      isReconnecting: false,
      reconnectAttempts: 0,
      reconnectError: null,
      disconnectedServerId: null,
      setUserPrivilege: (priv) => set({ userPrivilege: priv }),
      fetchUserPrivilege: async (connId) => {
        const id = connId || get().activeConnectionId || 'default';
        try {
          const priv = await sshGetUserPrivilege(id);
          set({ userPrivilege: priv });
          return priv;
        } catch (err) {
          console.warn('Failed to fetch user privilege:', err);
          const fallback: UserPrivilegeInfo = {
            username: 'root',
            uid: 0,
            gid: 0,
            home_dir: '/root',
            is_root: true,
            has_sudo: true,
            sudo_type: 'root',
            groups: ['root'],
          };
          return fallback;
        }
      },
      addConnection: (conn) => {
        const fullConn: SavedConnection = {
          ...conn,
          authMethod: conn.authMethod || (conn as any).auth_method || ((conn as any).privateKeyPath || (conn as any).private_key_path ? 'key' : 'password'),
          privateKeyPath: (conn as any).privateKeyPath || (conn as any).private_key_path,
          created_at: conn.created_at || Date.now(),
        };
        set((state) => ({ connections: [...state.connections.filter(c => c.id !== conn.id), fullConn] }));
        storeSaveConnection({
          id: fullConn.id,
          created_at: fullConn.created_at || Date.now(),
          last_connected_at: fullConn.last_connected_at || fullConn.lastConnected || Date.now(),
          name: fullConn.name,
          host: fullConn.host,
          port: Number(fullConn.port) || 22,
          username: fullConn.username,
          password: fullConn.password,
          private_key_path: (fullConn as any).privateKeyPath || (fullConn as any).private_key_path,
          auth_method: (fullConn as any).authMethod || (fullConn as any).auth_method,
          color: fullConn.color,
          group: fullConn.group,
          tags: fullConn.tags || [],
        }).catch((err) => {
          console.error('[SSH Desktop Store] Failed to save connection:', err);
        });
      },
      updateConnection: (id, updates) => {
        const existing = get().connections.find(c => c.id === id);
        if (!existing) return;
        const updated: SavedConnection = { 
          ...existing, 
          ...updates,
          authMethod: updates.authMethod || (updates as any).auth_method || existing.authMethod || 'password',
          privateKeyPath: (updates as any).privateKeyPath !== undefined ? (updates as any).privateKeyPath : (existing as any).privateKeyPath,
        };
        set((state) => ({ connections: state.connections.map(c => c.id === id ? updated : c) }));
        storeSaveConnection({
          id: updated.id,
          created_at: updated.created_at || Date.now(),
          last_connected_at: updated.last_connected_at || Date.now(),
          name: updated.name,
          host: updated.host,
          port: Number(updated.port) || 22,
          username: updated.username,
          password: updated.password,
          private_key_path: (updated as any).privateKeyPath || (updated as any).private_key_path,
          auth_method: (updated as any).authMethod || (updated as any).auth_method,
          color: updated.color,
          group: updated.group,
          tags: updated.tags || [],
        }).catch((err) => {
          console.error('[SSH Desktop Store] Failed to update connection:', err);
        });
      },
      removeConnection: (id) => {
        storeDeleteConnection(id).catch(() => {});
        set((state) => ({
          connections: state.connections.filter((c) => c.id !== id),
          activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
          disconnectedServerId: state.disconnectedServerId === id ? null : state.disconnectedServerId
        }));
      },
      setActive: (id) => set({ activeConnectionId: id }),
      setDisconnected: (isDisconnected, reason, serverId) => {
        const targetId = serverId || get().activeConnectionId || get().disconnectedServerId;
        set({
          isDisconnected,
          disconnectReason: reason || (isDisconnected ? 'Connection to remote server was lost or stopped.' : null),
          disconnectedServerId: isDisconnected ? (targetId || null) : null,
          isReconnecting: false,
          reconnectAttempts: isDisconnected ? 0 : get().reconnectAttempts,
          reconnectError: null,
        });
      },
      triggerDisconnectAlert: (reason, serverId) => {
        const targetId = serverId || get().activeConnectionId || get().disconnectedServerId;
        const newMap = new Map(get().connectedServers);
        if (targetId) {
          newMap.delete(targetId);
        }
        set({
          isDisconnected: true,
          disconnectReason: reason || 'Connection to remote server was disconnected or stopped.',
          disconnectedServerId: targetId || null,
          connectedServers: newMap,
          isReconnecting: false,
          reconnectAttempts: 0,
          reconnectError: null,
        });
      },
      resetReconnectAttempts: () => {
        set({ reconnectAttempts: 0, reconnectError: null });
      },
      connect: async (id, overrideConfig) => {
        const conn = get().connections.find(c => c.id === id);
        const target: any = { ...conn, ...overrideConfig };
        if (!target.host) {
          throw new Error('Server IP or hostname is required');
        }

        const effectiveAuth = target.authMethod || target.auth_method || (target.privateKeyPath || target.private_key_path ? 'key' : 'password');
        const effectiveKey = target.privateKeyPath || target.private_key_path;

        if (effectiveAuth === 'key') {
          if (!effectiveKey || String(effectiveKey).trim().length === 0) {
            throw new Error(`Missing SSH Private Key: Profile "${target.name || target.host}" is set to SSH Key authentication, but no private key file was found. Please re-upload or select your key file.`);
          }
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

        // Persist to disk as well
        storeSaveConnection({
          id,
          created_at: target.created_at || Date.now(),
          last_connected_at: Date.now(),
          name: target.name || `${target.username}@${target.host}`,
          host: target.host,
          port: Number(target.port) || 22,
          username: target.username,
          password: target.password,
          private_key_path: target.privateKeyPath || target.private_key_path,
          auth_method: target.authMethod || target.auth_method,
          color: target.color,
          group: target.group,
          tags: target.tags || [],
        }).catch(() => {});

        // Only mark connected when backend verification succeeds
        const newMap = new Map(get().connectedServers);
        newMap.set(id, { id, name: target.name || target.host, host: target.host, status: 'connected' });
        set({
          connectedServers: newMap,
          activeConnectionId: id,
          isDisconnected: false,
          disconnectReason: null,
          disconnectedServerId: null,
          isReconnecting: false,
          reconnectAttempts: 0,
          reconnectError: null,
        });

        // Eagerly resolve and cache remote user privileges (root, sudoers, standard user)
        get().fetchUserPrivilege(id).catch(() => {});
      },
      reconnect: async (targetServerId) => {
        const targetId = targetServerId || get().disconnectedServerId || get().activeConnectionId;
        if (!targetId) return;
        set((s) => ({ isReconnecting: true, reconnectError: null, reconnectAttempts: s.reconnectAttempts + 1 }));
        try {
          await get().connect(targetId);
          set({
            isDisconnected: false,
            disconnectReason: null,
            disconnectedServerId: null,
            activeConnectionId: targetId,
          });
        } catch (err: any) {
          set({ isReconnecting: false, reconnectError: err?.message || String(err) });
          throw err;
        }
      },
      disconnect: async (id) => {
        try {
          await sshDisconnect(id);
        } catch {}
        const newMap = new Map(get().connectedServers);
        newMap.delete(id);
        set({
          connectedServers: newMap,
          activeConnectionId: get().activeConnectionId === id ? null : get().activeConnectionId,
          userPrivilege: get().activeConnectionId === id ? null : get().userPrivilege,
          isDisconnected: false,
          disconnectReason: null,
          disconnectedServerId: null,
          isReconnecting: false,
          reconnectAttempts: 0,
          reconnectError: null,
        });
      },
      closeServer: async (id) => {
        try {
          await sshDisconnect(id);
        } catch {}
        const newMap = new Map(get().connectedServers);
        newMap.delete(id);

        const remainingConnected = Array.from(newMap.keys());
        const nextActiveId = remainingConnected.length > 0 ? remainingConnected[0] : null;

        set({
          connectedServers: newMap,
          activeConnectionId: nextActiveId,
          isDisconnected: false,
          disconnectReason: null,
          disconnectedServerId: null,
          isReconnecting: false,
          reconnectAttempts: 0,
          reconnectError: null,
        });
      },
      switchToOtherServer: async (targetId) => {
        const failedId = get().disconnectedServerId || get().activeConnectionId;
        if (failedId && failedId !== targetId) {
          try {
            await sshDisconnect(failedId);
          } catch {}
        }
        const newMap = new Map(get().connectedServers);
        if (failedId && failedId !== targetId) {
          newMap.delete(failedId);
        }
        set({
          isDisconnected: false,
          disconnectReason: null,
          disconnectedServerId: null,
          activeConnectionId: targetId,
          connectedServers: newMap,
          isReconnecting: false,
          reconnectAttempts: 0,
          reconnectError: null,
        });
        const targetConn = get().connections.find(c => c.id === targetId);
        if (targetConn && !newMap.has(targetId)) {
          try {
            await get().connect(targetId, targetConn);
          } catch (err) {
            console.warn('Switch connect notice:', err);
          }
        }
      },
      returnToServersList: () => {
        const failedId = get().disconnectedServerId || get().activeConnectionId;
        if (failedId) {
          try {
            sshDisconnect(failedId).catch(() => {});
          } catch {}
        }
        const newMap = new Map(get().connectedServers);
        if (failedId) {
          newMap.delete(failedId);
        }
        set({
          isDisconnected: false,
          disconnectReason: null,
          disconnectedServerId: null,
          activeConnectionId: null,
          connectedServers: newMap,
          isReconnecting: false,
          reconnectAttempts: 0,
          reconnectError: null,
        });
      },
    }),
    {
      name: 'connection-storage',
      partialize: (state) => ({ connections: state.connections, activeConnectionId: state.activeConnectionId }),
      onRehydrateStorage: () => (state) => {
        storeListConnections().then((saved) => {
          if (saved && Array.isArray(saved) && saved.length > 0 && state) {
            const diskItems: SavedConnection[] = saved.map((s: any) => ({
              ...s,
              authMethod: s.auth_method || s.authMethod || (s.private_key_path ? 'key' : 'password'),
              privateKeyPath: s.private_key_path || s.privateKeyPath,
              created_at: s.created_at || Date.now(),
            }));
            const map = new Map<string, SavedConnection>();
            state.connections.forEach(c => map.set(c.id, c));
            diskItems.forEach(c => map.set(c.id, c));
            const merged = Array.from(map.values());
            useConnectionStore.setState({ connections: merged });
          }
        }).catch(() => {});
      }
    }
  )
);

interface WindowStoreState {
  windows: WindowState[];
  nextZIndex: number;
  launchingAppId: string | null;
  closeInterceptors: Record<string, () => boolean | Promise<boolean>>;
  registerCloseInterceptor: (id: string, fn: () => boolean | Promise<boolean>) => void;
  unregisterCloseInterceptor: (id: string) => void;
  setLaunchingApp: (id: string | null) => void;
  openWindow: (win: Omit<WindowState, 'id' | 'zIndex'>) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  restoreWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  snapWindow: (id: string, snap: 'none' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'maximize') => void;
  toggleFullscreen: (id: string) => void;
  updatePosition: (id: string, x: number, y: number) => void;
  updateSize: (id: string, width: number, height: number) => void;
  bringToFront: (id: string) => void;
  minimizeAllWindows: () => void;
  restoreAllWindows: () => void;
  restoreToNormal: (id: string, x: number, y: number) => void;
}

export const useWindowStore = create<WindowStoreState>((set, get) => ({
  windows: [],
  nextZIndex: 10,
  launchingAppId: null,
  closeInterceptors: {},
  registerCloseInterceptor: (id, fn) => set((state) => ({
    closeInterceptors: { ...state.closeInterceptors, [id]: fn }
  })),
  unregisterCloseInterceptor: (id) => set((state) => {
    const next = { ...state.closeInterceptors };
    delete next[id];
    return { closeInterceptors: next };
  }),
  setLaunchingApp: (id) => set({ launchingAppId: id }),
  openWindow: (win) => set((state) => {
    const id = `win-${Date.now()}`;
    const activeServer = useConnectionStore.getState().activeConnectionId;
    const isAutoFS = useSettingsStore.getState().autoFullScreen;
    return {
      windows: [
        ...state.windows.map(w => ({ ...w, focused: false })),
        {
          ...win,
          id,
          serverId: win.serverId || (activeServer ?? undefined),
          maximized: isAutoFS ? true : (win.maximized ?? false),
          snapState: 'none',
          fullscreen: false,
          zIndex: state.nextZIndex,
          focused: true
        }
      ],
      nextZIndex: state.nextZIndex + 1
    };
  }),
  closeWindow: async (id) => {
    const interceptor = get().closeInterceptors?.[id];
    if (interceptor) {
      try {
        const canClose = await interceptor();
        if (!canClose) return;
      } catch {
        return;
      }
    }
    set((state) => ({ windows: state.windows.filter(w => w.id !== id) }));
  },
  focusWindow: (id) => set((state) => ({
    windows: state.windows.map(w => ({
      ...w,
      focused: w.id === id,
      minimized: w.id === id ? false : w.minimized,
      zIndex: w.id === id ? state.nextZIndex : w.zIndex
    })),
    nextZIndex: state.nextZIndex + 1
  })),
  minimizeWindow: (id) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? { ...w, minimized: true, focused: false } : w)
  })),
  restoreWindow: (id) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? { ...w, minimized: false, focused: true, zIndex: state.nextZIndex } : { ...w, focused: false }),
    nextZIndex: state.nextZIndex + 1
  })),
  minimizeAllWindows: () => set((state) => ({
    windows: state.windows.map(w => ({ ...w, minimized: true, focused: false }))
  })),
  restoreAllWindows: () => set((state) => ({
    windows: state.windows.map(w => ({ ...w, minimized: false }))
  })),
  maximizeWindow: (id) => set((state) => ({
    windows: state.windows.map(w => {
      if (w.id !== id) return w;
      const isCurrentlyMax = !!w.maximized || w.snapState === 'maximize' || !!w.fullscreen;
      return { 
        ...w, 
        maximized: !isCurrentlyMax,
        snapState: !isCurrentlyMax ? 'maximize' : 'none',
        fullscreen: false,
        minimized: false,
        focused: true
      };
    })
  })),
  snapWindow: (id, snap) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? {
      ...w,
      snapState: snap,
      maximized: snap === 'maximize',
      fullscreen: false,
      minimized: false,
      focused: true
    } : w)
  })),
  toggleFullscreen: (id) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? {
      ...w,
      fullscreen: !w.fullscreen,
      snapState: 'none',
      minimized: false,
      focused: true
    } : w)
  })),
  restoreToNormal: (id, x, y) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? {
      ...w,
      fullscreen: false,
      maximized: false,
      snapState: 'none',
      minimized: false,
      focused: true,
      x,
      y,
    } : w)
  })),
  updatePosition: (id, x, y) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? { ...w, x, y, snapState: 'none' } : w)
  })),
  updateSize: (id, width, height) => set((state) => ({
    windows: state.windows.map(w => w.id === id ? { ...w, width, height, snapState: 'none' } : w)
  })),
  bringToFront: (id) => set((state) => ({
    windows: state.windows.map(w => ({
      ...w,
      zIndex: w.id === id ? state.nextZIndex : w.zIndex,
      minimized: w.id === id ? false : w.minimized,
      focused: w.id === id
    })),
    nextZIndex: state.nextZIndex + 1
  }))
}));

export interface PinnedItem {
  id: string;
  name: string;
  path: string;
  type: 'dir' | 'file';
}

export interface DockerTerminalRequest {
  containerId: string;
  containerName: string;
  initialCmd?: string;
}

export interface TerminalCommandRequest {
  cmd: string;
  title?: string;
  newTab?: boolean;
}

interface EditorStoreState {
  pendingFilePath: string | null;
  openFileInEditor: (path: string) => void;
  clearPendingFile: () => void;
  finderTargetPath: string | null;
  navigateFinder: (path: string) => void;
  clearFinderTarget: () => void;
  pendingTerminalCommand: TerminalCommandRequest | null;
  runTerminalCommand: (cmd: string | TerminalCommandRequest, options?: { title?: string; newTab?: boolean }) => void;
  clearTerminalCommand: () => void;
  pendingTerminalDir: string | null;
  openTerminalInDir: (dir: string) => void;
  clearPendingTerminalDir: () => void;
  pendingDockerTerminal: DockerTerminalRequest | null;
  openDockerTerminalInApp: (containerId: string, containerName: string, initialCmd?: string) => void;
  clearPendingDockerTerminal: () => void;
}

export const useEditorStore = create<EditorStoreState>((set) => ({
  pendingFilePath: null,
  openFileInEditor: (path) => set({ pendingFilePath: path }),
  clearPendingFile: () => set({ pendingFilePath: null }),
  finderTargetPath: null,
  navigateFinder: (path) => set({ finderTargetPath: path }),
  clearFinderTarget: () => set({ finderTargetPath: null }),
  pendingTerminalCommand: null,
  runTerminalCommand: (cmd, options) => {
    const req: TerminalCommandRequest = typeof cmd === 'string'
      ? { cmd, title: options?.title, newTab: options?.newTab }
      : cmd;
    set({ pendingTerminalCommand: req });
  },
  clearTerminalCommand: () => set({ pendingTerminalCommand: null }),
  pendingTerminalDir: null,
  openTerminalInDir: (dir) => set({ pendingTerminalDir: dir }),
  clearPendingTerminalDir: () => set({ pendingTerminalDir: null }),
  pendingDockerTerminal: null,
  openDockerTerminalInApp: (containerId, containerName, initialCmd) => set({
    pendingDockerTerminal: { containerId, containerName, initialCmd }
  }),
  clearPendingDockerTerminal: () => set({ pendingDockerTerminal: null }),
}));

interface SettingsState {
  theme: 'dark' | 'light' | 'auto';
  accentColor: string;
  terminalFontSize: number;
  dockPosition: 'bottom' | 'left';
  showHiddenFiles: boolean;
  pollingInterval: number;
  wallpaper: string;
  desktopIconSize: 'small' | 'medium' | 'large';
  autoFullScreen: boolean;
  autoHideDock: boolean;
  favorites: string[];
  pinnedDesktopItems: PinnedItem[];
  pinToDesktop: (item: PinnedItem) => void;
  unpinFromDesktop: (id: string) => void;
  addFavorite: (path: string) => void;
  removeFavorite: (path: string) => void;
  updateSettings: (newSettings: Partial<Omit<SettingsState, 'updateSettings' | 'addFavorite' | 'removeFavorite' | 'pinToDesktop' | 'unpinFromDesktop'>>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      accentColor: '#89B4FA',
      terminalFontSize: 14,
      dockPosition: 'bottom',
      showHiddenFiles: false,
      pollingInterval: 15,
      wallpaper: 'sonoma',
      desktopIconSize: 'medium',
      autoFullScreen: false,
      autoHideDock: false,
      favorites: ['/', '/home', '/etc', '/var/log', '/tmp'],
      pinnedDesktopItems: [],
      pinToDesktop: (item) => set((state) => ({
        pinnedDesktopItems: [...state.pinnedDesktopItems.filter(p => p.id !== item.id), item]
      })),
      unpinFromDesktop: (id) => set((state) => ({
        pinnedDesktopItems: state.pinnedDesktopItems.filter(p => p.id !== id)
      })),
      addFavorite: (path) => set((state) => {
        const nextFavs = Array.from(new Set([...state.favorites, path]));
        settingsSave({
          theme: state.theme,
          accent_color: state.accentColor,
          terminal_font_size: state.terminalFontSize,
          terminal_color_scheme: 'catppuccin-mocha',
          editor_font_size: 14,
          dock_position: state.dockPosition,
          polling_interval_ms: (state.pollingInterval || 15) * 1000,
          show_hidden_files: state.showHiddenFiles,
          wallpaper: state.wallpaper,
          favorites: nextFavs,
        }).catch(() => {});
        return { favorites: nextFavs };
      }),
      removeFavorite: (path) => set((state) => {
        const nextFavs = state.favorites.filter(p => p !== path);
        settingsSave({
          theme: state.theme,
          accent_color: state.accentColor,
          terminal_font_size: state.terminalFontSize,
          terminal_color_scheme: 'catppuccin-mocha',
          editor_font_size: 14,
          dock_position: state.dockPosition,
          polling_interval_ms: (state.pollingInterval || 15) * 1000,
          show_hidden_files: state.showHiddenFiles,
          wallpaper: state.wallpaper,
          favorites: nextFavs,
        }).catch(() => {});
        return { favorites: nextFavs };
      }),
      updateSettings: (newSettings) => set((state) => {
        const next = { ...state, ...newSettings };
        settingsSave({
          theme: next.theme,
          accent_color: next.accentColor,
          terminal_font_size: next.terminalFontSize,
          terminal_color_scheme: 'catppuccin-mocha',
          editor_font_size: 14,
          dock_position: next.dockPosition,
          polling_interval_ms: (next.pollingInterval || 15) * 1000,
          show_hidden_files: next.showHiddenFiles,
          wallpaper: next.wallpaper,
          favorites: next.favorites,
        }).catch(() => {});
        return next;
      })
    }),
    {
      name: 'settings-storage',
      onRehydrateStorage: () => (state) => {
        // Hydrate from .sshdesktop/settings.json if available
        settingsGet().then((saved) => {
          if (saved && state) {
            state.updateSettings({
              theme: (saved.theme as any) || state.theme,
              accentColor: saved.accent_color || state.accentColor,
              terminalFontSize: saved.terminal_font_size || state.terminalFontSize,
              dockPosition: (saved.dock_position as any) || state.dockPosition,
              showHiddenFiles: saved.show_hidden_files !== undefined ? saved.show_hidden_files : state.showHiddenFiles,
              pollingInterval: saved.polling_interval_ms ? Math.round(saved.polling_interval_ms / 1000) : state.pollingInterval,
              wallpaper: saved.wallpaper || state.wallpaper,
              favorites: saved.favorites || state.favorites,
            });
          }
        }).catch(() => {});
      }
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

export interface ServerTelemetry {
  cpu: number;
  ramPct: number;
  ramUsed: string;
  ramTotal: string;
  diskPct: number;
  diskUsed: string;
  diskTotal: string;
  loadAvg: string;
  uptime: string;
  kernel: string;
  pingMs: number;
  lastUpdated: number;
}

interface TelemetryStoreState extends ServerTelemetry {
  updateTelemetry: (data: Partial<ServerTelemetry>) => void;
}

export const useTelemetryStore = create<TelemetryStoreState>((set) => ({
  cpu: 0,
  ramPct: 0,
  ramUsed: '—',
  ramTotal: '—',
  diskPct: 0,
  diskUsed: '—',
  diskTotal: '—',
  loadAvg: '—',
  uptime: '—',
  kernel: 'Linux',
  pingMs: 0,
  lastUpdated: 0,
  updateTelemetry: (data) => set((state) => ({ ...state, ...data, lastUpdated: Date.now() })),
}));

export interface FileClipboardItem {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface FileClipboardState {
  items: FileClipboardItem[];
  isCut: boolean;
  sourceDir: string;
}

interface FileClipboardStoreState {
  clipboard: FileClipboardState | null;
  setClipboard: (cb: FileClipboardState | null) => void;
  clearClipboard: () => void;
}

export const useFileClipboardStore = create<FileClipboardStoreState>((set) => ({
  clipboard: null,
  setClipboard: (cb) => set({ clipboard: cb }),
  clearClipboard: () => set({ clipboard: null }),
}));

