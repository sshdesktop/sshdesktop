import { create } from 'zustand';
import { ApiTabState, ApiCollection, HistoryItem, ApiEnvironment, SavedRequest, HttpMethod } from './types';
import { sftpReadTextFile, sftpWriteTextFile, sftpMkdir } from '../../lib/tauri-bridge';

const STORAGE_KEY_COLLECTIONS = 'sshdesktop_api_collections_v1';
const LEGACY_STORAGE_KEY_COLLECTIONS = 'clouddesk_api_collections_v1';
const STORAGE_KEY_HISTORY = 'sshdesktop_api_history_v1';
const LEGACY_STORAGE_KEY_HISTORY = 'clouddesk_api_history_v1';
const STORAGE_KEY_ENVS = 'sshdesktop_api_environments_v1';
const LEGACY_STORAGE_KEY_ENVS = 'clouddesk_api_environments_v1';

const DEFAULT_INITIAL_REQUEST: ApiTabState = {
  id: 'tab-1',
  name: 'New Request',
  method: 'GET',
  url: '',
  useSshTunnel: true,
  headers: [],
  queryParams: [],
  auth: { type: 'none' },
  bodyType: 'none',
  rawBody: '',
  formData: [],
  timeoutSeconds: 30,
  followRedirects: true,
  verifySsl: false,
  isLoading: false,
  response: null,
  error: null,
  isDirty: false,
  activeSubTab: 'params',
};

const DEFAULT_COLLECTIONS: ApiCollection[] = [];
const DEFAULT_ENVIRONMENTS: ApiEnvironment[] = [];

interface ApiStore {
  tabs: ApiTabState[];
  activeTabId: string;
  collections: ApiCollection[];
  history: HistoryItem[];
  environments: ApiEnvironment[];
  selectedEnvId: string | null;
  sidebarOpen: boolean;
  sidebarTab: 'collections' | 'history' | 'env';
  isSyncingServer: boolean;
  lastServerSync: string | null;

  // Tab Actions
  addTab: (req?: Partial<ApiTabState>) => void;
  closeTab: (tabId: string) => void;
  setActiveTabId: (tabId: string) => void;
  updateActiveTab: (updates: Partial<ApiTabState>) => void;
  updateTabById: (tabId: string, updates: Partial<ApiTabState>) => void;
  duplicateTab: (tabId: string) => void;

  // Collection Actions
  saveToCollection: (collectionId: string, name: string) => void;
  createCollection: (name: string, description?: string) => void;
  deleteCollection: (id: string) => void;
  deleteSavedRequest: (collectionId: string, reqId: string) => void;
  loadSavedRequest: (req: SavedRequest) => void;

  // History Actions
  addToHistory: (tabState: ApiTabState, response: any) => void;
  clearHistory: () => void;
  deleteHistoryItem: (id: string) => void;
  loadHistoryItem: (item: HistoryItem) => void;

  // Environment Actions
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: 'collections' | 'history' | 'env') => void;
  setSelectedEnvId: (envId: string | null) => void;
  updateEnvironment: (env: ApiEnvironment) => void;
  createEnvironment: (name: string) => void;
  deleteEnvironment: (id: string) => void;
  resolveVariables: (input: string) => string;

  // Remote Server Persistence (~/.sshdesktop/api_studio.json)
  hydrateFromServer: (connId: string, userHome: string) => Promise<boolean>;
  syncToServer: (connId: string, userHome: string) => Promise<boolean>;
}

export const useApiStore = create<ApiStore>((set, get) => {
  // Load saved state from localStorage, filtering out legacy sample/dummy data
  let initialCollections: ApiCollection[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLLECTIONS) || localStorage.getItem(LEGACY_STORAGE_KEY_COLLECTIONS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Strip dummy sample collections
        initialCollections = parsed.filter((c: any) => c.id !== 'col-sample-1' && c.id !== 'col-sample-2');
      }
    }
  } catch {}

  let initialHistory: HistoryItem[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY) || localStorage.getItem(LEGACY_STORAGE_KEY_HISTORY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) initialHistory = parsed;
    }
  } catch {}

  let initialEnvs: ApiEnvironment[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ENVS) || localStorage.getItem(LEGACY_STORAGE_KEY_ENVS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Strip dummy sample environments
        initialEnvs = parsed.filter((e: any) => e.id !== 'env-local' && e.id !== 'env-prod');
      }
    }
  } catch {}

  return {
    tabs: [DEFAULT_INITIAL_REQUEST],
    activeTabId: DEFAULT_INITIAL_REQUEST.id,
    collections: initialCollections,
    history: initialHistory,
    environments: initialEnvs,
    selectedEnvId: initialEnvs[0]?.id || null,
    sidebarOpen: true,
    sidebarTab: 'collections',
    isSyncingServer: false,
    lastServerSync: null,

    addTab: (req) => {
      const newId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newTab: ApiTabState = {
        ...DEFAULT_INITIAL_REQUEST,
        id: newId,
        name: req?.name || 'New Request',
        headers: JSON.parse(JSON.stringify(req?.headers || [])),
        queryParams: JSON.parse(JSON.stringify(req?.queryParams || [])),
        formData: JSON.parse(JSON.stringify(req?.formData || [])),
        auth: JSON.parse(JSON.stringify(req?.auth || { type: 'none' })),
        activeSubTab: req?.activeSubTab || 'params',
        ...req,
      };
      set(state => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newId,
      }));
    },

    closeTab: (tabId) => {
      const state = get();
      if (state.tabs.length <= 1) {
        // Reset single tab instead of leaving zero tabs
        const freshId = `tab-${Date.now()}`;
        set({
          tabs: [{ ...DEFAULT_INITIAL_REQUEST, id: freshId, name: 'New Request' }],
          activeTabId: freshId,
        });
        return;
      }
      const newTabs = state.tabs.filter(t => t.id !== tabId);
      const newActive = state.activeTabId === tabId ? newTabs[newTabs.length - 1].id : state.activeTabId;
      set({ tabs: newTabs, activeTabId: newActive });
    },

    setActiveTabId: (activeTabId) => set({ activeTabId }),

    updateActiveTab: (updates) => {
      const { activeTabId, tabs } = get();
      set({
        tabs: tabs.map(t => (t.id === activeTabId ? { ...t, ...updates, isDirty: true } : t)),
      });
    },

    updateTabById: (tabId, updates) => {
      set(state => ({
        tabs: state.tabs.map(t => (t.id === tabId ? { ...t, ...updates } : t)),
      }));
    },

    duplicateTab: (tabId) => {
      const { tabs } = get();
      const target = tabs.find(t => t.id === tabId);
      if (!target) return;
      const newId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const dup: ApiTabState = {
        ...target,
        id: newId,
        name: `${target.name} (Copy)`,
        headers: JSON.parse(JSON.stringify(target.headers || [])),
        queryParams: JSON.parse(JSON.stringify(target.queryParams || [])),
        formData: JSON.parse(JSON.stringify(target.formData || [])),
        auth: JSON.parse(JSON.stringify(target.auth || { type: 'none' })),
        isDirty: true,
      };
      set({
        tabs: [...tabs, dup],
        activeTabId: newId,
      });
    },

    saveToCollection: (collectionId, name) => {
      const { activeTabId, tabs, collections } = get();
      const active = tabs.find(t => t.id === activeTabId);
      if (!active) return;

      const saved: SavedRequest = {
        id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        collectionId,
        name: name.trim() || active.name || 'Saved Request',
        method: active.method,
        url: active.url,
        useSshTunnel: active.useSshTunnel,
        headers: JSON.parse(JSON.stringify(active.headers || [])),
        queryParams: JSON.parse(JSON.stringify(active.queryParams || [])),
        auth: JSON.parse(JSON.stringify(active.auth || { type: 'none' })),
        bodyType: active.bodyType,
        rawBody: active.rawBody,
        formData: JSON.parse(JSON.stringify(active.formData || [])),
        updatedAt: new Date().toISOString(),
      };

      const updated = collections.map(col => {
        if (col.id === collectionId) {
          return {
            ...col,
            requests: [...col.requests, saved],
          };
        }
        return col;
      });

      set({ collections: updated });
      try {
        localStorage.setItem(STORAGE_KEY_COLLECTIONS, JSON.stringify(updated));
      } catch {}

      // Mark active tab clean
      set({
        tabs: tabs.map(t => (t.id === activeTabId ? { ...t, isDirty: false, name: saved.name } : t)),
      });
    },

    createCollection: (name, description) => {
      const newCol: ApiCollection = {
        id: `col-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim() || 'New Collection',
        description: description?.trim() || '',
        requests: [],
      };
      const updated = [...get().collections, newCol];
      set({ collections: updated });
      try {
        localStorage.setItem(STORAGE_KEY_COLLECTIONS, JSON.stringify(updated));
      } catch {}
    },

    deleteCollection: (id) => {
      const updated = get().collections.filter(c => c.id !== id);
      set({ collections: updated });
      try {
        localStorage.setItem(STORAGE_KEY_COLLECTIONS, JSON.stringify(updated));
      } catch {}
    },

    deleteSavedRequest: (collectionId, reqId) => {
      const updated = get().collections.map(col => {
        if (col.id === collectionId) {
          return {
            ...col,
            requests: col.requests.filter(r => r.id !== reqId),
          };
        }
        return col;
      });
      set({ collections: updated });
      try {
        localStorage.setItem(STORAGE_KEY_COLLECTIONS, JSON.stringify(updated));
      } catch {}
    },

    loadSavedRequest: (req) => {
      const newId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newTab: ApiTabState = {
        id: newId,
        name: req.name,
        method: req.method,
        url: req.url,
        useSshTunnel: req.useSshTunnel,
        headers: JSON.parse(JSON.stringify(req.headers || [])),
        queryParams: JSON.parse(JSON.stringify(req.queryParams || [])),
        auth: JSON.parse(JSON.stringify(req.auth || { type: 'none' })),
        bodyType: req.bodyType,
        rawBody: req.rawBody,
        formData: JSON.parse(JSON.stringify(req.formData || [])),
        timeoutSeconds: 30,
        followRedirects: true,
        verifySsl: false,
        isLoading: false,
        response: null,
        error: null,
        isDirty: false,
        activeSubTab: 'params',
      };
      set(state => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newId,
      }));
    },

    addToHistory: (tabState, response) => {
      const item: HistoryItem = {
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        method: tabState.method,
        url: tabState.url,
        status: response?.status || 0,
        durationMs: response?.duration_ms || 0,
        sizeBytes: response?.size_bytes || 0,
        useSshTunnel: tabState.useSshTunnel,
        requestSnapshot: {
          ...tabState,
          headers: JSON.parse(JSON.stringify(tabState.headers || [])),
          queryParams: JSON.parse(JSON.stringify(tabState.queryParams || [])),
          formData: JSON.parse(JSON.stringify(tabState.formData || [])),
          auth: JSON.parse(JSON.stringify(tabState.auth || { type: 'none' })),
          response: null,
          isDirty: false,
        },
      };

      const updated = [item, ...get().history.slice(0, 99)]; // Keep latest 100
      set({ history: updated });
      try {
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
      } catch {}
    },

    clearHistory: () => {
      set({ history: [] });
      try {
        localStorage.removeItem(STORAGE_KEY_HISTORY);
      } catch {}
    },

    deleteHistoryItem: (id) => {
      const updated = get().history.filter(h => h.id !== id);
      set({ history: updated });
      try {
        localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(updated));
      } catch {}
    },

    loadHistoryItem: (item) => {
      const newId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const snap = item.requestSnapshot;
      const newTab: ApiTabState = {
        id: newId,
        name: `${item.method} ${item.url.replace(/^https?:\/\//, '').slice(0, 20)}` || 'History Item',
        method: snap?.method || item.method,
        url: snap?.url || item.url,
        useSshTunnel: snap?.useSshTunnel ?? item.useSshTunnel,
        headers: JSON.parse(JSON.stringify(snap?.headers || [])),
        queryParams: JSON.parse(JSON.stringify(snap?.queryParams || [])),
        formData: JSON.parse(JSON.stringify(snap?.formData || [])),
        auth: JSON.parse(JSON.stringify(snap?.auth || { type: 'none' })),
        bodyType: snap?.bodyType || 'none',
        rawBody: snap?.rawBody || '',
        timeoutSeconds: snap?.timeoutSeconds || 30,
        followRedirects: snap?.followRedirects ?? true,
        verifySsl: snap?.verifySsl ?? false,
        response: null,
        error: null,
        isLoading: false,
        isDirty: false,
        activeSubTab: snap?.activeSubTab || 'params',
      };
      set(state => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newId,
      }));
    },

    setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    setSidebarTab: (sidebarTab) => set({ sidebarTab }),
    setSelectedEnvId: (selectedEnvId) => set({ selectedEnvId }),

    updateEnvironment: (env) => {
      const updated = get().environments.map(e => (e.id === env.id ? env : e));
      set({ environments: updated });
      try {
        localStorage.setItem(STORAGE_KEY_ENVS, JSON.stringify(updated));
      } catch {}
    },

    createEnvironment: (name) => {
      const newEnv: ApiEnvironment = {
        id: `env-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: name.trim() || 'New Environment',
        variables: [],
      };
      const updated = [...get().environments, newEnv];
      set({ environments: updated, selectedEnvId: newEnv.id });
      try {
        localStorage.setItem(STORAGE_KEY_ENVS, JSON.stringify(updated));
      } catch {}
    },

    deleteEnvironment: (id) => {
      const updated = get().environments.filter(e => e.id !== id);
      set({
        environments: updated,
        selectedEnvId: get().selectedEnvId === id ? (updated[0]?.id || null) : get().selectedEnvId,
      });
      try {
        localStorage.setItem(STORAGE_KEY_ENVS, JSON.stringify(updated));
      } catch {}
    },

    resolveVariables: (input) => {
      if (!input || !input.includes('{{')) return input;
      const { environments, selectedEnvId } = get();
      const currentEnv = environments.find(e => e.id === selectedEnvId);
      if (!currentEnv) return input;

      let resolved = input;
      for (const v of currentEnv.variables) {
        if (v.enabled && v.key.trim()) {
          const pattern = new RegExp(`{{\\s*${v.key.trim()}\\s*}}`, 'g');
          resolved = resolved.replace(pattern, v.value);
        }
      }
      return resolved;
    },

    hydrateFromServer: async (connId: string, userHome: string) => {
      if (!connId || !userHome) return false;
      try {
        // Ensure ~/.sshdesktop folder exists on remote server
        await sftpMkdir(connId, `${userHome}/.sshdesktop`).catch(() => {});

        // Try reading ~/.sshdesktop/api_studio.json (with fallback to ~/.clouddesk/api_studio.json)
        let content = await sftpReadTextFile(connId, `${userHome}/.sshdesktop/api_studio.json`).catch(() => '');
        if (!content) {
          content = await sftpReadTextFile(connId, `${userHome}/.clouddesk/api_studio.json`).catch(() => '');
        }

        if (content && content.trim().startsWith('{')) {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed.collections)) {
            const cleanCols = parsed.collections.filter((c: any) => c.id !== 'col-sample-1' && c.id !== 'col-sample-2');
            set({ collections: cleanCols });
            try { localStorage.setItem(STORAGE_KEY_COLLECTIONS, JSON.stringify(cleanCols)); } catch {}
          }
          if (Array.isArray(parsed.environments)) {
            const cleanEnvs = parsed.environments.filter((e: any) => e.id !== 'env-local' && e.id !== 'env-prod');
            set({ environments: cleanEnvs });
            if (cleanEnvs.length > 0 && !get().selectedEnvId) {
              set({ selectedEnvId: cleanEnvs[0].id });
            }
            try { localStorage.setItem(STORAGE_KEY_ENVS, JSON.stringify(cleanEnvs)); } catch {}
          }
          if (Array.isArray(parsed.history)) {
            set({ history: parsed.history });
            try { localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(parsed.history)); } catch {}
          }

          set({ lastServerSync: new Date().toLocaleTimeString() });
          return true;
        }
      } catch (err) {
        console.warn('[API Studio] Failed to hydrate from server:', err);
      }
      return false;
    },

    syncToServer: async (connId: string, userHome: string) => {
      if (!connId || !userHome) return false;
      set({ isSyncingServer: true });
      try {
        await sftpMkdir(connId, `${userHome}/.sshdesktop`).catch(() => {});
        const payload = {
          collections: get().collections,
          environments: get().environments,
          history: get().history.slice(0, 50),
          savedAt: new Date().toISOString(),
          savedBy: 'SSH Desktop API Studio',
        };
        await sftpWriteTextFile(
          connId,
          `${userHome}/.sshdesktop/api_studio.json`,
          JSON.stringify(payload, null, 2)
        );
        set({ isSyncingServer: false, lastServerSync: new Date().toLocaleTimeString() });
        return true;
      } catch (err) {
        console.warn('[API Studio] Failed to sync to server:', err);
        set({ isSyncingServer: false });
        return false;
      }
    },
  };
});
