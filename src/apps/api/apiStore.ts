import { create } from 'zustand';
import { ApiTabState, ApiCollection, HistoryItem, ApiEnvironment, SavedRequest, HttpMethod } from './types';

const STORAGE_KEY_COLLECTIONS = 'sshdesktop_api_collections_v1';
const LEGACY_STORAGE_KEY_COLLECTIONS = 'clouddesk_api_collections_v1';
const STORAGE_KEY_HISTORY = 'sshdesktop_api_history_v1';
const LEGACY_STORAGE_KEY_HISTORY = 'clouddesk_api_history_v1';
const STORAGE_KEY_ENVS = 'sshdesktop_api_environments_v1';
const LEGACY_STORAGE_KEY_ENVS = 'clouddesk_api_environments_v1';

const DEFAULT_INITIAL_REQUEST: ApiTabState = {
  id: 'tab-default',
  name: 'Local API Test',
  method: 'GET',
  url: 'http://localhost:8080/api/health',
  useSshTunnel: true,
  headers: [
    { key: 'Accept', value: 'application/json', enabled: true },
    { key: 'User-Agent', value: 'SSHDesktop-API-Studio/1.0', enabled: true },
  ],
  queryParams: [],
  auth: { type: 'none' },
  bodyType: 'none',
  rawBody: '{\n  "message": "Hello from SSH Desktop API Studio"\n}',
  formData: [],
  timeoutSeconds: 30,
  followRedirects: true,
  verifySsl: false,
  isLoading: false,
  response: null,
  error: null,
  isDirty: false,
};

const DEFAULT_COLLECTIONS: ApiCollection[] = [
  {
    id: 'col-sample-1',
    name: 'Localhost Microservices',
    description: 'Internal private services reached via SSH port forwarding tunnel',
    requests: [
      {
        id: 'req-health',
        name: 'Service Health Check',
        method: 'GET',
        url: 'http://localhost:8080/health',
        useSshTunnel: true,
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        queryParams: [],
        auth: { type: 'none' },
        bodyType: 'none',
        rawBody: '',
        formData: [],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'req-users-list',
        name: 'List Users (Port 3000)',
        method: 'GET',
        url: 'http://127.0.0.1:3000/api/v1/users',
        useSshTunnel: true,
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        queryParams: [{ key: 'limit', value: '25', enabled: true }, { key: 'page', value: '1', enabled: true }],
        auth: { type: 'bearer', bearerToken: 'your-auth-token-here' },
        bodyType: 'none',
        rawBody: '',
        formData: [],
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'req-create-item',
        name: 'Create Resource (POST JSON)',
        method: 'POST',
        url: 'http://localhost:5000/api/items',
        useSshTunnel: true,
        headers: [
          { key: 'Content-Type', value: 'application/json', enabled: true },
          { key: 'Accept', value: 'application/json', enabled: true }
        ],
        queryParams: [],
        auth: { type: 'none' },
        bodyType: 'json',
        rawBody: '{\n  "title": "SSH Desktop Integration",\n  "status": "active",\n  "port": 5000\n}',
        formData: [],
        updatedAt: new Date().toISOString(),
      }
    ]
  },
  {
    id: 'col-sample-2',
    name: 'Public APIs',
    description: 'Direct internet endpoints or gateway testing',
    requests: [
      {
        id: 'req-httpbin-get',
        name: 'HTTPBin Inspect Headers',
        method: 'GET',
        url: 'https://httpbin.org/get',
        useSshTunnel: false,
        headers: [{ key: 'X-Client', value: 'SSH Desktop', enabled: true }],
        queryParams: [{ key: 'client', value: 'tauri', enabled: true }],
        auth: { type: 'none' },
        bodyType: 'none',
        rawBody: '',
        formData: [],
        updatedAt: new Date().toISOString(),
      }
    ]
  }
];

const DEFAULT_ENVIRONMENTS: ApiEnvironment[] = [
  {
    id: 'env-local',
    name: 'Local Server (SSH Tunnel)',
    variables: [
      { key: 'baseUrl', value: 'http://localhost:8080', enabled: true },
      { key: 'apiPrefix', value: '/api/v1', enabled: true },
      { key: 'token', value: 'dev-secret-token-123', enabled: true }
    ]
  },
  {
    id: 'env-prod',
    name: 'Production Gateway',
    variables: [
      { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
      { key: 'apiPrefix', value: '/v1', enabled: true },
      { key: 'token', value: 'prod-bearer-token', enabled: true }
    ]
  }
];

interface ApiStore {
  tabs: ApiTabState[];
  activeTabId: string;
  collections: ApiCollection[];
  history: HistoryItem[];
  environments: ApiEnvironment[];
  selectedEnvId: string | null;
  sidebarOpen: boolean;
  sidebarTab: 'collections' | 'history' | 'env';

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
  loadHistoryItem: (item: HistoryItem) => void;

  // Environment Actions
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: 'collections' | 'history' | 'env') => void;
  setSelectedEnvId: (envId: string | null) => void;
  updateEnvironment: (env: ApiEnvironment) => void;
  resolveVariables: (input: string) => string;
}

export const useApiStore = create<ApiStore>((set, get) => {
  // Load saved state
  let initialCollections = DEFAULT_COLLECTIONS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_COLLECTIONS) || localStorage.getItem(LEGACY_STORAGE_KEY_COLLECTIONS);
    if (raw) initialCollections = JSON.parse(raw);
  } catch {}

  let initialHistory: HistoryItem[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY) || localStorage.getItem(LEGACY_STORAGE_KEY_HISTORY);
    if (raw) initialHistory = JSON.parse(raw);
  } catch {}

  let initialEnvs = DEFAULT_ENVIRONMENTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ENVS) || localStorage.getItem(LEGACY_STORAGE_KEY_ENVS);
    if (raw) initialEnvs = JSON.parse(raw);
  } catch {}

  return {
    tabs: [DEFAULT_INITIAL_REQUEST],
    activeTabId: DEFAULT_INITIAL_REQUEST.id,
    collections: initialCollections,
    history: initialHistory,
    environments: initialEnvs,
    selectedEnvId: 'env-local',
    sidebarOpen: true,
    sidebarTab: 'collections',

    addTab: (req) => {
      const newId = `tab-${Date.now()}`;
      const newTab: ApiTabState = {
        ...DEFAULT_INITIAL_REQUEST,
        id: newId,
        name: req?.name || 'Untitled Request',
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
        // Reset the single tab instead of leaving zero tabs
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
      const newId = `tab-${Date.now()}`;
      const dup: ApiTabState = {
        ...target,
        id: newId,
        name: `${target.name} (Copy)`,
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
        id: `req-${Date.now()}`,
        collectionId,
        name: name || active.name || 'Saved Request',
        method: active.method,
        url: active.url,
        useSshTunnel: active.useSshTunnel,
        headers: active.headers,
        queryParams: active.queryParams,
        auth: active.auth,
        bodyType: active.bodyType,
        rawBody: active.rawBody,
        formData: active.formData,
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
    },

    createCollection: (name, description) => {
      const newCol: ApiCollection = {
        id: `col-${Date.now()}`,
        name: name.trim() || 'New Collection',
        description,
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
      const newId = `tab-${Date.now()}`;
      const newTab: ApiTabState = {
        id: newId,
        name: req.name,
        method: req.method,
        url: req.url,
        useSshTunnel: req.useSshTunnel,
        headers: req.headers,
        queryParams: req.queryParams,
        auth: req.auth,
        bodyType: req.bodyType,
        rawBody: req.rawBody,
        formData: req.formData,
        timeoutSeconds: 30,
        followRedirects: true,
        verifySsl: false,
        isLoading: false,
        response: null,
        error: null,
        isDirty: false,
      };
      set(state => ({
        tabs: [...state.tabs, newTab],
        activeTabId: newId,
      }));
    },

    addToHistory: (tabState, response) => {
      const item: HistoryItem = {
        id: `hist-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        method: tabState.method,
        url: tabState.url,
        status: response?.status || 0,
        durationMs: response?.duration_ms || 0,
        sizeBytes: response?.size_bytes || 0,
        useSshTunnel: tabState.useSshTunnel,
        requestSnapshot: { ...tabState, response: null },
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

    loadHistoryItem: (item) => {
      const newId = `tab-${Date.now()}`;
      const newTab: ApiTabState = {
        ...item.requestSnapshot,
        id: newId,
        name: `${item.method} ${item.url.replace(/^https?:\/\//, '').slice(0, 20)}`,
        response: null,
        error: null,
        isLoading: false,
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
  };
});
