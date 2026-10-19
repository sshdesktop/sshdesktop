import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Plus, X, Globe, Server, Shield, Layers, Code2, 
  Settings2, SplitSquareVertical, Save, Check, AlertCircle, Sparkles, FolderPlus 
} from 'lucide-react';
import { useApiStore } from './apiStore';
import { useConnectionStore } from '../../lib/store';
import { apiSendRequest, ApiRequestPayload, ApiHeader, ApiQueryParam } from '../../lib/tauri-bridge';
import RequestUrlBar from './components/RequestUrlBar';
import RequestConfigTabs from './components/RequestConfigTabs';
import ResponseViewer from './components/ResponseViewer';
import ApiSidebar from './components/ApiSidebar';
import CodeSnippetModal from './components/CodeSnippetModal';
import { HttpMethod } from './types';

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: 'text-emerald-400',
  POST: 'text-amber-400',
  PUT: 'text-blue-400',
  PATCH: 'text-purple-400',
  DELETE: 'text-rose-400',
  HEAD: 'text-slate-400',
  OPTIONS: 'text-teal-400',
};

export default function ApiApp() {
  const { 
    tabs, 
    activeTabId, 
    sidebarOpen, 
    setSidebarOpen, 
    addTab, 
    closeTab, 
    setActiveTabId, 
    updateActiveTab, 
    updateTabById,
    addToHistory, 
    collections, 
    saveToCollection, 
    createCollection, 
    resolveVariables 
  } = useApiStore();

  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  // Modals state
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveRequestName, setSaveRequestName] = useState('');
  const [targetCollectionId, setTargetCollectionId] = useState('');
  const [showCreateCollectionModal, setShowCreateCollectionModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDesc, setNewCollectionDesc] = useState('');
  const [showCodeModal, setShowCodeModal] = useState(false);

  // In-flight abort controller reference
  const isCancelledRef = useRef(false);

  // Send request execution
  const handleSendRequest = useCallback(async () => {
    if (!activeTab || activeTab.isLoading) return;

    isCancelledRef.current = false;
    updateActiveTab({ isLoading: true, error: null, response: null });

    try {
      // 1. Resolve environment variables: {{baseUrl}}, {{token}}, etc.
      const resolvedUrl = resolveVariables(activeTab.url);
      const resolvedRawBody = resolveVariables(activeTab.rawBody);

      // 2. Prepare headers with Auth auto-injection
      const finalHeaders: ApiHeader[] = activeTab.headers
        .filter(h => h.enabled && h.key.trim())
        .map(h => ({
          key: resolveVariables(h.key.trim()),
          value: resolveVariables(h.value),
          enabled: true,
        }));

      // Inject Auth
      if (activeTab.auth.type === 'bearer' && activeTab.auth.bearerToken?.trim()) {
        const token = resolveVariables(activeTab.auth.bearerToken.trim());
        finalHeaders.push({
          key: 'Authorization',
          value: `Bearer ${token}`,
          enabled: true,
        });
      } else if (activeTab.auth.type === 'basic' && activeTab.auth.basicUser) {
        const user = resolveVariables(activeTab.auth.basicUser);
        const pass = resolveVariables(activeTab.auth.basicPass || '');
        const credentials = btoa(`${user}:${pass}`);
        finalHeaders.push({
          key: 'Authorization',
          value: `Basic ${credentials}`,
          enabled: true,
        });
      } else if (activeTab.auth.type === 'apikey' && activeTab.auth.apiKeyName && activeTab.auth.apiKeyValue) {
        const keyName = resolveVariables(activeTab.auth.apiKeyName);
        const keyVal = resolveVariables(activeTab.auth.apiKeyValue);
        if (activeTab.auth.apiKeyLocation === 'header' || !activeTab.auth.apiKeyLocation) {
          finalHeaders.push({
            key: keyName,
            value: keyVal,
            enabled: true,
          });
        }
      }

      // 3. Prepare Query Params with Auth injection if location is query
      const finalQueryParams: ApiQueryParam[] = activeTab.queryParams
        .filter(q => q.enabled && q.key.trim())
        .map(q => ({
          key: resolveVariables(q.key.trim()),
          value: resolveVariables(q.value),
          enabled: true,
        }));

      if (activeTab.auth.type === 'apikey' && activeTab.auth.apiKeyLocation === 'query' && activeTab.auth.apiKeyName && activeTab.auth.apiKeyValue) {
        finalQueryParams.push({
          key: resolveVariables(activeTab.auth.apiKeyName),
          value: resolveVariables(activeTab.auth.apiKeyValue),
          enabled: true,
        });
      }

      // 4. Construct payload for native Rust HTTP engine (NO curl command!)
      const payload: ApiRequestPayload = {
        id: activeTab.id,
        conn_id: activeConnectionId || undefined,
        use_ssh_tunnel: activeTab.useSshTunnel,
        method: activeTab.method,
        url: resolvedUrl,
        headers: finalHeaders,
        query_params: finalQueryParams,
        body_type: activeTab.bodyType,
        raw_body: activeTab.bodyType !== 'none' ? resolvedRawBody : undefined,
        form_data: activeTab.formData?.map(f => ({
          key: resolveVariables(f.key),
          value: resolveVariables(f.value),
          item_type: f.item_type,
          enabled: f.enabled,
        })),
        timeout_seconds: activeTab.timeoutSeconds || 30,
        follow_redirects: activeTab.followRedirects,
        verify_ssl: activeTab.verifySsl,
      };

      const resp = await apiSendRequest(payload);

      if (isCancelledRef.current) return;

      if (resp.status === 0 && resp.body.startsWith('Error:')) {
        updateActiveTab({
          isLoading: false,
          error: resp.body,
          response: null,
        });
      } else {
        updateActiveTab({
          isLoading: false,
          response: resp,
          error: null,
          isDirty: false,
        });
        addToHistory(activeTab, resp);
      }
    } catch (err: any) {
      if (isCancelledRef.current) return;
      updateActiveTab({
        isLoading: false,
        error: String(err?.message || err),
        response: null,
      });
    }
  }, [activeTab, activeConnectionId, resolveVariables, updateActiveTab, addToHistory]);

  const handleCancelRequest = () => {
    isCancelledRef.current = true;
    updateActiveTab({ isLoading: false });
  };

  // Keyboard shortcut listener (⌘ Enter to send)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSendRequest();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        addTab();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (activeTab) closeTab(activeTab.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSendRequest, addTab, closeTab, activeTab]);

  return (
    <div className="flex flex-col h-full bg-[#181825] text-gray-200 select-none overflow-hidden font-sans">
      {/* 1. TOP TABS BAR */}
      <div className="h-10 bg-[#11111b] border-b border-white/[0.08] flex items-center justify-between px-2 shrink-0 overflow-x-auto no-scrollbar">
        {/* Left: Tab Items */}
        <div className="flex items-center space-x-1 shrink-0 overflow-x-auto no-scrollbar">
          {/* Sidebar Toggle */}
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`p-1.5 rounded-lg text-xs transition-colors mr-1 ${
              sidebarOpen ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'text-gray-400 hover:text-white hover:bg-white/10'
            }`}
            title="Toggle Sidebar"
          >
            <Layers className="w-3.5 h-3.5" />
          </button>

          {tabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            const methodColor = METHOD_COLORS[tab.method] || 'text-gray-400';

            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl cursor-pointer text-xs transition-all max-w-[200px] border ${
                  isActive
                    ? 'bg-[#181825] border-white/15 text-white shadow-sm font-medium'
                    : 'bg-transparent border-transparent text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`}
              >
                <span className={`font-mono text-[10px] font-bold shrink-0 ${methodColor}`}>
                  {tab.method}
                </span>

                <span className="truncate text-xs">
                  {tab.name || 'Untitled Request'}
                </span>

                {tab.isDirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="p-0.5 rounded-md hover:bg-white/10 text-gray-500 hover:text-white shrink-0 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* Add Tab Button */}
          <button
            type="button"
            onClick={() => addTab()}
            className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
            title="New Request Tab (⌘T / Ctrl+T)"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Active Server SSH Tunnel Indicator */}
        <div className="flex items-center space-x-2 text-xs font-mono text-gray-400 shrink-0 pl-2">
          {activeServer ? (
            <div className="flex items-center space-x-1.5 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-xl text-blue-300">
              <Server className="w-3.5 h-3.5 text-blue-400" />
              <span className="truncate max-w-[180px]">{activeServer.username}@{activeServer.host}</span>
            </div>
          ) : (
            <div className="flex items-center space-x-1.5 text-gray-500 text-[11px]">
              <Globe className="w-3.5 h-3.5" />
              <span>Direct Mode</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. MAIN WORKSPACE */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar */}
        {sidebarOpen && (
          <ApiSidebar 
            onOpenCreateCollectionModal={() => setShowCreateCollectionModal(true)} 
          />
        )}

        {/* Center Request/Response Workspace */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* URL & Method Bar */}
          <RequestUrlBar
            activeTab={activeTab}
            onSend={handleSendRequest}
            onCancel={handleCancelRequest}
            onOpenSaveModal={() => {
              setSaveRequestName(activeTab.name || '');
              setTargetCollectionId(collections[0]?.id || '');
              setShowSaveModal(true);
            }}
            onOpenCodeModal={() => setShowCodeModal(true)}
          />

          {/* Split: Request Options (Top) & Response Inspector (Bottom) */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {/* Top Half: Request Configuration (Headers, Params, Auth, Body) */}
            <div className="h-[48%] min-h-[160px] border-b border-white/[0.08] overflow-hidden flex flex-col">
              <RequestConfigTabs activeTab={activeTab} />
            </div>

            {/* Bottom Half: Response Inspector (Status, Timing, Body, Headers) */}
            <div className="flex-1 min-h-[180px] overflow-hidden flex flex-col">
              <ResponseViewer
                response={activeTab.response}
                isLoading={activeTab.isLoading}
                error={activeTab.error}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 3. SAVE TO COLLECTION MODAL */}
      {showSaveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
          <div className="w-full max-w-md bg-[#1e1e2e] border border-white/15 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-gray-200">Save Request</span>
              <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Request Name</label>
                <input
                  type="text"
                  value={saveRequestName}
                  onChange={(e) => setSaveRequestName(e.target.value)}
                  placeholder="e.g. Get User Profile"
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Collection</label>
                <select
                  value={targetCollectionId}
                  onChange={(e) => setTargetCollectionId(e.target.value)}
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-200 focus:outline-none"
                >
                  {collections.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSaveModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (targetCollectionId) {
                    saveToCollection(targetCollectionId, saveRequestName);
                    updateActiveTab({ name: saveRequestName, isDirty: false });
                    setShowSaveModal(false);
                  }
                }}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. CREATE COLLECTION MODAL */}
      {showCreateCollectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md p-4">
          <div className="w-full max-w-md bg-[#1e1e2e] border border-white/15 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-sm text-gray-200">Create New Collection</span>
              <button onClick={() => setShowCreateCollectionModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Collection Name</label>
                <input
                  type="text"
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="e.g. Payments Microservice"
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-300">Description (Optional)</label>
                <input
                  type="text"
                  value={newCollectionDesc}
                  onChange={(e) => setNewCollectionDesc(e.target.value)}
                  placeholder="e.g. Endpoints routed through remote internal port 8080"
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-200 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowCreateCollectionModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newCollectionName.trim()) {
                    createCollection(newCollectionName, newCollectionDesc);
                    setNewCollectionName('');
                    setNewCollectionDesc('');
                    setShowCreateCollectionModal(false);
                  }
                }}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. CODE SNIPPET MODAL */}
      <CodeSnippetModal
        isOpen={showCodeModal}
        onClose={() => setShowCodeModal(false)}
        request={activeTab}
      />
    </div>
  );
}
