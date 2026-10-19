import React, { useState, useEffect } from 'react';
import {
  Zap,
  Play,
  RefreshCw,
  Plus,
  Trash2,
  Search,
  Key,
  Shield,
  Clock,
  Terminal,
  Database,
  Code2,
  Table,
  Sliders,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { DbConnectionProfile, QueryTab } from '../types';
import {
  redisScanKeys,
  redisGetValue,
  redisSetValue,
  redisDeleteKey,
  dbExecuteQuery
} from '../../../lib/tauri-bridge';
import {
  QueryTabBar,
  SqlEditorPanel,
  MultiResultViewer,
  ConfirmModal
} from '../components';
import { RowCreateModal } from '../modals/RowCreateModal';

interface RedisStudioProps {
  profile: DbConnectionProfile;
  onDisconnect?: () => void;
}

export const RedisStudio: React.FC<RedisStudioProps> = ({ profile, onDisconnect }) => {
  const [activeView, setActiveView] = useState<'keys' | 'cli'>('keys');

  // Database selector (#0 to #15)
  const [currentDbNum, setCurrentDbNum] = useState<number>(Number(profile.database) || 0);
  const redisDatabases = Array.from({ length: 16 }, (_, i) => `db${i}`);

  // Keys Explorer State
  const [keys, setKeys] = useState<{ key: string; key_type: string; ttl: number }[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState<any>(null);
  const [keyTtl, setKeyTtl] = useState<number>(-1);
  const [searchPattern, setSearchPattern] = useState('*');
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [deleteConfirmKey, setDeleteConfirmKey] = useState<string | null>(null);

  // Modals
  const [showAddKey, setShowAddKey] = useState(false);

  // Split layout mode
  const [splitMode, setSplitMode] = useState<'horizontal' | 'vertical' | 'editor-only' | 'results-only'>('horizontal');

  // Multi-Tab CLI Console State
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    {
      id: 'tab-1',
      title: 'Console 1',
      query: 'INFO server',
      results: [],
      columns: [],
      rawOutput: '',
      execTime: '—',
      error: null,
      successInfo: null,
    }
  ]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [isExecutingCli, setIsExecutingCli] = useState(false);

  const activeQueryTab = queryTabs.find(t => t.id === activeTabId) || queryTabs[0];

  // ─── 1. Load Keys ─────────────────────────────────────────────────
  const loadKeys = async (pat = searchPattern) => {
    setIsLoadingKeys(true);
    try {
      const items = await redisScanKeys(profile.id, pat || '*', 150);
      setKeys(items);
      if (items.length > 0 && !selectedKey) {
        handleSelectKey(items[0].key);
      }
    } catch (e) {
      console.warn('Redis scan keys notice:', e);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  useEffect(() => {
    loadKeys();
  }, [profile.id, currentDbNum]);

  // ─── 2. Switch DB ─────────────────────────────────────────────────
  const handleSelectDb = async (dbStr: string) => {
    const num = parseInt(dbStr.replace('db', ''), 10) || 0;
    setCurrentDbNum(num);
    try {
      await dbExecuteQuery(profile.id, `SELECT ${num}`);
      setSelectedKey(null);
      setKeyValue(null);
      loadKeys();
    } catch (e) {
      console.warn('Switch Redis DB error:', e);
    }
  };

  // ─── 3. Key Inspector Actions ─────────────────────────────────────
  const handleSelectKey = async (k: string) => {
    setSelectedKey(k);
    try {
      const res = await redisGetValue(profile.id, k);
      setKeyValue(res.value);
      setKeyTtl(res.ttl);
    } catch (e) {
      console.warn('Redis get value notice:', e);
    }
  };

  const handleSaveValue = async () => {
    if (!selectedKey) return;
    try {
      await redisSetValue(
        profile.id,
        selectedKey,
        typeof keyValue === 'string' ? keyValue : JSON.stringify(keyValue),
        keyTtl > 0 ? keyTtl : undefined
      );
      loadKeys();
      alert('Key value saved successfully.');
    } catch (e: any) {
      alert(`Save error: ${e?.message || e}`);
    }
  };

  const handleDeleteKey = async (k: string) => {
    try {
      await redisDeleteKey(profile.id, k);
      setDeleteConfirmKey(null);
      if (selectedKey === k) {
        setSelectedKey(null);
        setKeyValue(null);
      }
      loadKeys();
    } catch (e: any) {
      alert(`Delete error: ${e?.message || e}`);
    }
  };

  // ─── 4. Query Tab Management ──────────────────────────────────────
  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `Console ${queryTabs.length + 1}`,
      query: 'PING',
      results: [],
      columns: [],
      rawOutput: '',
      execTime: '—',
      error: null,
      successInfo: null,
    };
    setQueryTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const handleCloseTab = (id: string) => {
    if (queryTabs.length <= 1) return;
    const idx = queryTabs.findIndex(t => t.id === id);
    const next = queryTabs.filter(t => t.id !== id);
    setQueryTabs(next);
    if (activeTabId === id) {
      setActiveTabId(next[Math.max(0, idx - 1)]?.id || next[0].id);
    }
  };

  const handleCloseRight = (id: string) => {
    const idx = queryTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const next = queryTabs.slice(0, idx + 1);
    setQueryTabs(next);
    if (!next.some(t => t.id === activeTabId)) {
      setActiveTabId(id);
    }
  };

  const handleCloseOthers = (id: string) => {
    const target = queryTabs.find(t => t.id === id);
    if (!target) return;
    setQueryTabs([target]);
    setActiveTabId(target.id);
  };

  const handleCloseAll = () => {
    const newTab: QueryTab = {
      id: `tab-${Date.now()}`,
      title: 'Console 1',
      query: 'INFO server',
      results: [],
      columns: [],
      rawOutput: '',
      execTime: '—',
      error: null,
      successInfo: null,
    };
    setQueryTabs([newTab]);
    setActiveTabId(newTab.id);
  };

  const handleDuplicateTab = (id: string) => {
    const target = queryTabs.find(t => t.id === id);
    if (!target) return;
    const newId = `tab-${Date.now()}`;
    setQueryTabs(prev => [...prev, { ...target, id: newId, title: `${target.title} (Copy)` }]);
    setActiveTabId(newId);
  };

  const handleRenameTab = (id: string, newTitle: string) => {
    setQueryTabs(prev => prev.map(t => t.id === id ? { ...t, title: newTitle } : t));
  };

  // ─── 5. Execute Redis CLI / Commands ──────────────────────────────
  const handleExecuteCli = async (overrideQuery?: string) => {
    const q = (typeof overrideQuery === 'string' && overrideQuery.trim().length > 0)
      ? overrideQuery.trim()
      : activeQueryTab.query.trim();

    if (!q) return;

    setIsExecutingCli(true);
    setQueryTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, isExecuting: true, error: null } : t));

    const startTime = performance.now();
    try {
      const res = await dbExecuteQuery(profile.id, q);
      const durationMs = (performance.now() - startTime).toFixed(1);

      const rows = res.rows || [];
      const cols = res.columns?.map(c => c.name) || ['Result'];

      setQueryTabs(prev => {
        return prev.map(t => {
          if (t.id === activeTabId) {
            return {
              ...t,
              results: rows,
              columns: cols,
              allResults: res.all_results || undefined,
              activeResultIndex: 0,
              rawOutput: JSON.stringify(rows, null, 2),
              execTime: `${durationMs}ms`,
              error: null,
              successInfo: `Executed in ${durationMs}ms (${rows.length || 1} records).`,
              isExecuting: false,
            };
          }
          return t;
        });
      });
    } catch (err: any) {
      const durationMs = (performance.now() - startTime).toFixed(1);
      setQueryTabs(prev => prev.map(t => {
        if (t.id === activeTabId) {
          return {
            ...t,
            error: String(err?.message || err),
            execTime: `${durationMs}ms`,
            isExecuting: false,
          };
        }
        return t;
      }));
    } finally {
      setIsExecutingCli(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#1e1e2e] text-[#cdd6f4] select-none overflow-hidden font-sans">
      {/* Top Navbar */}
      <div className="h-11 border-b border-white/10 px-4 flex items-center justify-between bg-black/20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center font-bold text-sm shadow-inner border border-red-500/30">
            ⚡
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white tracking-wide">{profile.name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-500/10 text-red-400 border border-red-500/20">
              Redis KV Engine
            </span>
            {profile.useSsl && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <Shield className="w-2.5 h-2.5" /> TLS
              </span>
            )}
            <span className="text-xs text-gray-500">•</span>
            {/* Database Selector */}
            <select
              value={`db${currentDbNum}`}
              onChange={(e) => handleSelectDb(e.target.value)}
              className="px-2 py-0.5 bg-black/40 border border-white/10 rounded text-[10px] text-red-300 font-mono focus:outline-none"
            >
              {redisDatabases.map(db => (
                <option key={db} value={db} className="bg-[#181825] text-white">
                  DB #{db.replace('db', '')}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* View Switcher */}
        <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10">
          <button
            onClick={() => setActiveView('keys')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeView === 'keys' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>Keys Explorer</span>
          </button>
          <button
            onClick={() => setActiveView('cli')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeView === 'cli' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>CLI Studio</span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          {onDisconnect && (
            <button
              onClick={onDisconnect}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-300 border border-white/10 transition-colors"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Body */}
      {activeView === 'keys' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar: Keys Explorer */}
          <div className="w-72 border-r border-white/10 bg-black/10 flex flex-col shrink-0">
            <div className="p-2 border-b border-white/5 flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={searchPattern}
                  onChange={(e) => {
                    setSearchPattern(e.target.value);
                    loadKeys(e.target.value);
                  }}
                  placeholder="Pattern: * or user:*"
                  className="w-full pl-8 pr-2 py-1 bg-white/5 border border-white/10 rounded-lg text-xs text-white font-mono placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
              <button
                onClick={() => setShowAddKey(true)}
                className="p-1.5 rounded-lg bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 transition-colors"
                title="Add Key"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => loadKeys()}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                title="Refresh Keys"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingKeys ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 text-xs font-mono">
              <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1 font-sans flex items-center justify-between">
                <span>Keys</span>
                <span className="text-gray-500">({keys.length})</span>
              </div>
              {keys.map(k => (
                <div
                  key={k.key}
                  onClick={() => handleSelectKey(k.key)}
                  className={`px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer transition-colors ${
                    selectedKey === k.key
                      ? 'bg-red-600/20 text-red-300 border border-red-500/30 font-semibold'
                      : 'text-gray-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <Key className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="truncate">{k.key}</span>
                  </div>
                  <span className="text-[10px] text-gray-500 uppercase">{k.key_type}</span>
                </div>
              ))}
              {keys.length === 0 && (
                <div className="text-center py-8 text-gray-500 text-xs">
                  {isLoadingKeys ? 'Scanning keys...' : 'No keys found'}
                </div>
              )}
            </div>
          </div>

          {/* Right Center: Key Inspector */}
          <div className="flex-1 p-6 flex flex-col overflow-hidden space-y-4 bg-[#181825]">
            {selectedKey ? (
              <>
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-white font-mono">{selectedKey}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-white/10 text-gray-300">
                      TTL: {keyTtl === -1 ? 'Persistent (No Expiry)' : `${keyTtl}s`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveValue}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white shadow-md transition-colors"
                    >
                      Save Changes
                    </button>
                    <button
                      onClick={() => setDeleteConfirmKey(selectedKey)}
                      className="p-1.5 rounded-xl text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                      title="Delete Key"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex flex-col">
                  <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Value Content
                  </label>
                  <textarea
                    value={typeof keyValue === 'string' ? keyValue : JSON.stringify(keyValue, null, 2)}
                    onChange={(e) => setKeyValue(e.target.value)}
                    className="flex-1 p-4 bg-black/30 border border-white/10 rounded-xl font-mono text-xs text-red-300 focus:outline-none focus:ring-1 focus:ring-red-500 resize-none"
                    spellCheck={false}
                  />
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-gray-500 text-sm">
                <Key className="w-12 h-12 mb-3 text-gray-600 opacity-50" />
                <span>Select a key from the explorer to inspect and edit its value.</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* VIEW 2: Multi-Tab CLI Console */
        <div className="flex-1 flex flex-col overflow-hidden bg-[#181825]">
          <QueryTabBar
            tabs={queryTabs}
            activeTabId={activeTabId}
            onSelectTab={setActiveTabId}
            onAddTab={handleAddTab}
            onCloseTab={handleCloseTab}
            onCloseRight={handleCloseRight}
            onCloseOthers={handleCloseOthers}
            onCloseAll={handleCloseAll}
            onDuplicateTab={handleDuplicateTab}
            onRenameTab={handleRenameTab}
          />

          <div className={`flex-1 flex overflow-hidden ${
            splitMode === 'vertical' ? 'flex-row' : 'flex-col'
          }`}>
            {/* Editor Panel */}
            <div className={`overflow-hidden ${
              splitMode === 'vertical' ? 'w-1/2 border-r border-white/10' : 'h-1/2 border-b border-white/10'
            }`}>
              <SqlEditorPanel
                value={activeQueryTab.query}
                onChange={(val) => {
                  setQueryTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, query: val } : t));
                }}
                onExecute={handleExecuteCli}
                isExecuting={isExecutingCli}
                engine="redis"
                tables={keys.map(k => k.key)}
                columns={['key', 'value', 'ttl']}
                language="sql"
                splitMode={splitMode}
                onSplitModeChange={setSplitMode}
                onCloseTab={() => handleCloseTab(activeTabId)}
              />
            </div>

            {/* Results Viewer */}
            <div className={`overflow-hidden ${splitMode === 'vertical' ? 'w-1/2' : 'h-1/2'}`}>
              <MultiResultViewer
                tableName="Redis Output"
                columns={activeQueryTab.columns}
                rows={activeQueryTab.results}
                allResults={activeQueryTab.allResults}
                activeResultIndex={activeQueryTab.activeResultIndex || 0}
                onSelectResultIndex={(idx) => {
                  setQueryTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, activeResultIndex: idx } : t));
                }}
                execTime={activeQueryTab.execTime}
                error={activeQueryTab.error}
                successInfo={activeQueryTab.successInfo}
              />
            </div>
          </div>
        </div>
      )}

      {/* Delete Key Confirmation Modal */}
      {deleteConfirmKey && (
        <ConfirmModal
          isOpen={Boolean(deleteConfirmKey)}
          title="Delete Redis Key"
          message={`Are you sure you want to permanently delete the key "${deleteConfirmKey}"? This operation cannot be undone.`}
          confirmLabel="Delete Key"
          danger={true}
          onConfirm={() => handleDeleteKey(deleteConfirmKey)}
          onCancel={() => setDeleteConfirmKey(null)}
        />
      )}

      {/* Add Key Modal */}
      {showAddKey && (
        <RowCreateModal
          isOpen={showAddKey}
          onClose={() => setShowAddKey(false)}
          engine="redis"
          tableName="keys"
          connectionId={profile.id}
          database={String(currentDbNum)}
          onSuccess={() => {
            setShowAddKey(false);
            loadKeys();
          }}
        />
      )}
    </div>
  );
};

export default RedisStudio;
