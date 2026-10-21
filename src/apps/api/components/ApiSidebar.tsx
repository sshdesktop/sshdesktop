import React, { useState } from 'react';
import { 
  Folder, Plus, Trash2, History, Settings2, Search, 
  ChevronRight, ChevronDown, Clock, Play, FileCode, Check, X, Shield 
} from 'lucide-react';
import { useApiStore } from '../apiStore';
import { HttpMethod } from '../types';

const METHOD_BADGES: Record<HttpMethod, string> = {
  GET: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  POST: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  PUT: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  PATCH: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  DELETE: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  HEAD: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
  OPTIONS: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
};

interface ApiSidebarProps {
  onOpenCreateCollectionModal: () => void;
}

export default function ApiSidebar({ onOpenCreateCollectionModal }: ApiSidebarProps) {
  const { 
    collections, 
    history, 
    environments, 
    selectedEnvId, 
    sidebarTab, 
    setSidebarTab, 
    setSelectedEnvId, 
    deleteCollection, 
    deleteSavedRequest, 
    loadSavedRequest, 
    loadHistoryItem, 
    clearHistory,
    deleteHistoryItem,
    updateEnvironment,
    createEnvironment,
    deleteEnvironment
  } = useApiStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCollections, setExpandedCollections] = useState<Record<string, boolean>>({});
  const [showAddEnvModal, setShowAddEnvModal] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');

  const toggleCollection = (id: string) => {
    setExpandedCollections(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleTabSwitch = (tab: 'collections' | 'history' | 'env') => {
    setSidebarTab(tab);
    setSearchQuery('');
  };

  const currentEnv = environments.find(e => e.id === selectedEnvId) || environments[0];

  return (
    <div className="w-full bg-[#14141e] border-r border-white/[0.08] flex flex-col h-full select-none shrink-0 overflow-hidden">
      {/* Sidebar Header with Switcher Tabs */}
      <div className="p-3 border-b border-white/[0.08] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-200 tracking-wide uppercase">
            API Studio
          </span>
          {sidebarTab === 'collections' && (
            <button
              type="button"
              onClick={onOpenCreateCollectionModal}
              className="p-1 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg transition-colors cursor-pointer"
              title="Create New Collection"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
          {sidebarTab === 'history' && history.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Are you sure you want to delete all request history?')) {
                  clearHistory();
                }
              }}
              className="text-[11px] text-gray-500 hover:text-rose-400 transition-colors cursor-pointer font-medium"
              title="Clear All History"
            >
              Clear All
            </button>
          )}
          {sidebarTab === 'env' && (
            <button
              type="button"
              onClick={() => setShowAddEnvModal(true)}
              className="p-1 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg transition-colors cursor-pointer"
              title="Add New Environment"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Segmented Control */}
        <div className="grid grid-cols-3 bg-[#11111b] p-0.5 rounded-xl border border-white/10 text-[11px] font-medium text-gray-400">
          <button
            type="button"
            onClick={() => handleTabSwitch('collections')}
            className={`py-1 rounded-lg text-center transition-all cursor-pointer ${
              sidebarTab === 'collections' ? 'bg-blue-600 text-white font-semibold shadow-sm' : 'hover:text-white'
            }`}
          >
            Collections
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('history')}
            className={`py-1 rounded-lg text-center transition-all cursor-pointer ${
              sidebarTab === 'history' ? 'bg-blue-600 text-white font-semibold shadow-sm' : 'hover:text-white'
            }`}
          >
            History
          </button>
          <button
            type="button"
            onClick={() => handleTabSwitch('env')}
            className={`py-1 rounded-lg text-center transition-all cursor-pointer ${
              sidebarTab === 'env' ? 'bg-blue-600 text-white font-semibold shadow-sm' : 'hover:text-white'
            }`}
          >
            Envs
          </button>
        </div>

        {/* Search Filter */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2" />
          <input
            type="text"
            placeholder={sidebarTab === 'history' ? "Search history..." : "Filter requests..."}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#11111b] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-2 text-gray-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main List Area */}
      <div className="flex-1 overflow-y-auto p-2 scrollbar-thin space-y-1">
        {/* 1. COLLECTIONS TAB */}
        {sidebarTab === 'collections' && (
          <div className="space-y-1">
            {collections.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-500 space-y-2">
                <Folder className="w-7 h-7 text-gray-600 mx-auto opacity-70" />
                <div className="font-medium text-gray-400">No collections yet</div>
                <div className="text-[11px] text-gray-500">
                  Click the <span className="text-blue-400 font-bold">+</span> button above to create a collection and organize your requests.
                </div>
              </div>
            ) : (
              collections.map((col) => {
                const isExpanded = !!expandedCollections[col.id];
                const filteredReqs = col.requests.filter(r => 
                  r.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                  r.url.toLowerCase().includes(searchQuery.toLowerCase())
                );

                return (
                  <div key={col.id} className="rounded-xl overflow-hidden bg-white/[0.02]">
                    <div 
                      onClick={() => toggleCollection(col.id)}
                      className="px-2.5 py-1.5 flex items-center justify-between text-xs text-gray-300 hover:bg-white/5 cursor-pointer rounded-lg transition-colors group"
                    >
                      <div className="flex items-center space-x-1.5 min-w-0">
                        {isExpanded ? (
                          <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                        )}
                        <Folder className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        <span className="font-semibold truncate">{col.name}</span>
                        <span className="text-[10px] text-gray-500">({col.requests.length})</span>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Are you sure you want to delete collection "${col.name}" and all its requests?`)) {
                            deleteCollection(col.id);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 transition-opacity cursor-pointer"
                        title="Delete Collection"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Collection Requests */}
                    {isExpanded && (
                      <div className="pl-6 pr-1 py-1 space-y-0.5">
                        {filteredReqs.length === 0 ? (
                          <div className="text-[11px] text-gray-500 py-1 pl-2 italic">
                            Empty collection
                          </div>
                        ) : (
                          filteredReqs.map((req) => (
                            <div
                              key={req.id}
                              onClick={() => loadSavedRequest(req)}
                              className="px-2 py-1.5 flex items-center justify-between hover:bg-white/10 rounded-lg cursor-pointer text-xs group transition-colors"
                            >
                              <div className="flex items-center space-x-2 min-w-0">
                                <span className={`text-[10px] font-mono font-bold px-1 py-0.5 rounded border ${METHOD_BADGES[req.method]}`}>
                                  {req.method}
                                </span>
                                <span className="text-gray-300 truncate group-hover:text-white">
                                  {req.name}
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (window.confirm(`Are you sure you want to delete request "${req.name}"?`)) {
                                    deleteSavedRequest(col.id, req.id);
                                  }
                                }}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-rose-400 transition-opacity cursor-pointer"
                                title="Delete saved request"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* 2. HISTORY TAB */}
        {sidebarTab === 'history' && (
          <div className="space-y-1">
            {history.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-500 space-y-1">
                <Clock className="w-6 h-6 text-gray-600 mx-auto" />
                <div>No history yet</div>
                <div className="text-[11px]">Executed API calls will appear here</div>
              </div>
            ) : (
              history
                .filter(h => h.url.toLowerCase().includes(searchQuery.toLowerCase()))
                .map((item) => (
                  <div
                    key={item.id}
                    onClick={() => loadHistoryItem(item)}
                    className="p-2 bg-white/[0.02] hover:bg-white/5 border border-white/5 rounded-xl cursor-pointer text-xs space-y-1 transition-colors group relative"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className={`text-[10px] font-mono font-bold px-1 rounded border ${METHOD_BADGES[item.method]}`}>
                          {item.method}
                        </span>
                        <span className={`text-[10px] font-mono font-semibold px-1 rounded ${
                          item.status >= 200 && item.status < 300
                            ? 'text-emerald-400 bg-emerald-500/10'
                            : 'text-rose-400 bg-rose-500/10'
                        }`}>
                          {item.status || 'ERR'}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <span className="text-[10px] text-gray-500 font-mono">{item.timestamp}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('Are you sure you want to delete this history item?')) {
                              deleteHistoryItem(item.id);
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-500 hover:text-rose-400 transition-opacity cursor-pointer"
                          title="Delete history item"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="text-[11px] font-mono text-gray-300 truncate group-hover:text-blue-300">
                      {item.url || 'untitled'}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-gray-500 font-mono">
                      <span>{item.durationMs}ms</span>
                      {item.useSshTunnel && <span className="text-purple-400">Tunnel</span>}
                    </div>
                  </div>
                ))
            )}
          </div>
        )}

        {/* 3. ENVIRONMENTS TAB */}
        {sidebarTab === 'env' && (
          <div className="space-y-4 p-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold text-gray-400 uppercase">Active Environment</label>
                {currentEnv && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Are you sure you want to delete environment "${currentEnv.name}"?`)) {
                        deleteEnvironment(currentEnv.id);
                      }
                    }}
                    className="text-gray-500 hover:text-rose-400 text-xs transition-colors p-1"
                    title="Delete environment"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              {environments.length === 0 ? (
                <div className="p-4 text-center text-xs text-gray-500 bg-[#11111b] border border-white/10 rounded-xl space-y-1">
                  <div>No environments configured</div>
                  <button
                    type="button"
                    onClick={() => setShowAddEnvModal(true)}
                    className="text-blue-400 text-[11px] hover:underline"
                  >
                    + Create an Environment
                  </button>
                </div>
              ) : (
                <select
                  value={selectedEnvId || ''}
                  onChange={(e) => setSelectedEnvId(e.target.value || null)}
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none"
                >
                  {environments.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              )}
            </div>

            {currentEnv && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-gray-400">
                  <span>Environment Variables</span>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = [...currentEnv.variables, { key: 'newVar', value: 'value', enabled: true }];
                      updateEnvironment({ ...currentEnv, variables: updated });
                    }}
                    className="text-blue-400 hover:text-blue-300 text-xs flex items-center space-x-1"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Var</span>
                  </button>
                </div>
                <div className="space-y-1.5">
                  {currentEnv.variables.length === 0 ? (
                    <div className="text-[11px] text-gray-500 py-2 italic text-center">
                      No variables defined in this environment.
                    </div>
                  ) : (
                    currentEnv.variables.map((v, idx) => (
                      <div key={idx} className="p-2 bg-[#11111b] border border-white/5 rounded-xl space-y-1">
                        <div className="flex items-center justify-between">
                          <input
                            type="text"
                            value={v.key}
                            onChange={(e) => {
                              const updatedVars = [...currentEnv.variables];
                              updatedVars[idx] = { ...v, key: e.target.value };
                              updateEnvironment({ ...currentEnv, variables: updatedVars });
                            }}
                            className="bg-transparent font-mono text-xs text-purple-400 font-bold focus:outline-none border-b border-transparent focus:border-purple-400/50"
                            placeholder="VAR_NAME"
                          />
                          <div className="flex items-center space-x-1">
                            <input
                              type="checkbox"
                              checked={v.enabled}
                              onChange={(e) => {
                                const updatedVars = [...currentEnv.variables];
                                updatedVars[idx] = { ...v, enabled: e.target.checked };
                                updateEnvironment({ ...currentEnv, variables: updatedVars });
                              }}
                              className="rounded border-white/20 text-blue-600 focus:ring-0"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Are you sure you want to delete variable "${v.key}"?`)) {
                                  const updatedVars = currentEnv.variables.filter((_, i) => i !== idx);
                                  updateEnvironment({ ...currentEnv, variables: updatedVars });
                                }
                              }}
                              className="text-gray-500 hover:text-rose-400 p-1"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <input
                          type="text"
                          value={v.value}
                          onChange={(e) => {
                            const updatedVars = [...currentEnv.variables];
                            updatedVars[idx] = { ...v, value: e.target.value };
                            updateEnvironment({ ...currentEnv, variables: updatedVars });
                          }}
                          className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none"
                          placeholder="value"
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Environment Modal */}
      {showAddEnvModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#1e1e2e] border border-white/15 rounded-2xl shadow-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs text-gray-200 uppercase tracking-wider">New Environment</span>
              <button onClick={() => setShowAddEnvModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              value={newEnvName}
              onChange={(e) => setNewEnvName(e.target.value)}
              placeholder="e.g. Staging, Development"
              className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-blue-500"
              autoFocus
            />
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setShowAddEnvModal(false)}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (newEnvName.trim()) {
                    createEnvironment(newEnvName.trim());
                    setNewEnvName('');
                    setShowAddEnvModal(false);
                  }
                }}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
