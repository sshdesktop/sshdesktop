import React, { useState, useEffect } from 'react';
import {
  Layers,
  Play,
  RefreshCw,
  Plus,
  Trash2,
  Table,
  Sliders,
  Search,
  CheckCircle2,
  AlertCircle,
  Key,
  Shield,
  Sparkles,
  Code2
} from 'lucide-react';
import {
  DbConnectionProfile,
  TableItem,
  QueryTab,
  DataGridState
} from '../types';
import { dbExecuteQuery } from '../../../lib/tauri-bridge';
import { CreateTableModal } from '../modals/CreateTableModal';
import { RowEditorModal } from '../modals/RowEditorModal';
import { RowCreateModal } from '../modals/RowCreateModal';
import {
  QueryTabBar,
  SqlEditorPanel,
  MultiResultViewer,
  SchemaTreeView
} from '../components';

interface CosmosStudioProps {
  profile: DbConnectionProfile;
  onDisconnect?: () => void;
}

export const CosmosStudio: React.FC<CosmosStudioProps> = ({ profile, onDisconnect }) => {
  const [activeTab, setActiveTab] = useState<'editor' | 'datagrid'>('editor');

  // Containers
  const [containers, setContainers] = useState<TableItem[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [itemColumns, setItemColumns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showItemEditor, setShowItemEditor] = useState(false);
  const [showItemCreate, setShowItemCreate] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<any | null>(null);

  // Layout & Split Mode
  const [splitMode, setSplitMode] = useState<'horizontal' | 'vertical' | 'editor-only' | 'results-only'>('horizontal');

  // SQL API Query Tabs
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    {
      id: 'tab-1',
      title: 'Query 1',
      query: 'SELECT * FROM c OFFSET 0 LIMIT 25;',
      results: [],
      columns: [],
      rawOutput: '',
      execTime: '—',
      error: null,
      successInfo: null,
    }
  ]);
  const [activeTabId, setActiveTabId] = useState('tab-1');
  const [isExecuting, setIsExecuting] = useState(false);

  const activeQueryTab = queryTabs.find(t => t.id === activeTabId) || queryTabs[0];

  // ─── 1. Load Cosmos Containers ────────────────────────────────────
  const loadCosmosContainers = async () => {
    setIsLoading(true);
    setGlobalError(null);
    try {
      const q = JSON.stringify({ operation: 'list_containers', database: profile.database });
      const res = await dbExecuteQuery(profile.id, q);
      const cList: TableItem[] = (res.rows || []).map((r: any) => ({
        name: typeof r === 'string' ? r : (r.id || r.name || 'container'),
        type: 'collection',
        partitionKey: r.partition_key || '/id',
      }));

      setContainers(cList);
      if (cList.length > 0 && !selectedContainer) {
        setSelectedContainer(cList[0].name);
        loadContainerItems(cList[0].name);
      }
    } catch (e: any) {
      setGlobalError(`Failed to load Cosmos containers: ${e?.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCosmosContainers();
  }, [profile.id]);

  // ─── 2. Load Container Items for Grid ─────────────────────────────
  const loadContainerItems = async (cName: string) => {
    setSelectedContainer(cName);
    setIsLoading(true);
    try {
      const q = JSON.stringify({
        operation: 'query_items',
        container: cName,
        query: 'SELECT * FROM c OFFSET 0 LIMIT 50',
      });
      const res = await dbExecuteQuery(profile.id, q);
      const rawRows = res.rows || [];
      setItems(rawRows);

      const keySet = new Set<string>();
      rawRows.forEach((r: any) => {
        if (typeof r === 'object' && r !== null) {
          Object.keys(r).forEach(k => keySet.add(k));
        }
      });
      const cols = Array.from(keySet);
      setItemColumns(cols.length > 0 ? cols : ['id', 'data']);
    } catch (e: any) {
      setGlobalError(`Query items failed: ${e?.message || e}`);
      setItems([]);
      setItemColumns([]);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── 3. Query Tabs Management ─────────────────────────────────────
  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `Query ${queryTabs.length + 1}`,
      query: `SELECT * FROM c WHERE c.id != "" OFFSET 0 LIMIT 25;`,
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
      title: 'Query 1',
      query: 'SELECT * FROM c OFFSET 0 LIMIT 25;',
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

  // ─── 4. Execute Query ─────────────────────────────────────────────
  const handleExecuteQuery = async (overrideQuery?: string) => {
    if (!selectedContainer) return;
    const q = (typeof overrideQuery === 'string' && overrideQuery.trim().length > 0)
      ? overrideQuery.trim()
      : activeQueryTab.query.trim();

    if (!q) return;

    setIsExecuting(true);
    setQueryTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, isExecuting: true, error: null } : t));

    const startTime = performance.now();
    try {
      const payload = JSON.stringify({
        operation: 'query_items',
        container: selectedContainer,
        query: q,
      });
      const res = await dbExecuteQuery(profile.id, payload);
      const durationMs = (performance.now() - startTime).toFixed(1);

      const rows = res.rows || [];
      const colSet = new Set<string>();
      rows.forEach((r: any) => {
        if (typeof r === 'object' && r !== null) {
          Object.keys(r).forEach(k => colSet.add(k));
        }
      });
      const cols = colSet.size > 0 ? Array.from(colSet) : (res.columns?.map(c => c.name) || []);

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
              successInfo: `Executed in ${durationMs}ms (${rows.length || res.affected_rows} items).`,
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
      setIsExecuting(false);
    }
  };

  // ─── 5. Item Actions ──────────────────────────────────────────────
  const handleDeleteItem = async (item: any) => {
    if (!selectedContainer) return;
    const id = item.id || Object.keys(item)[0];
    try {
      const q = JSON.stringify({
        operation: 'delete_item',
        container: selectedContainer,
        id: item.id,
        partition_key: item[item.partition_key || 'id'],
      });
      await dbExecuteQuery(profile.id, q);
      loadContainerItems(selectedContainer);
    } catch (e: any) {
      alert(`Delete Error: ${e?.message || e}`);
    }
  };

  const handleDropContainer = async (cName: string) => {
    try {
      const q = JSON.stringify({ operation: 'delete_container', container: cName });
      await dbExecuteQuery(profile.id, q);
      loadCosmosContainers();
      if (selectedContainer === cName) setSelectedContainer(null);
    } catch (e: any) {
      alert(`Drop Container Error: ${e?.message || e}`);
    }
  };

  const handleGenerateQuery = (type: 'SELECT' | 'INSERT', cName: string) => {
    let script = '';
    if (type === 'SELECT') {
      script = `SELECT * FROM c OFFSET 0 LIMIT 50;`;
    } else {
      script = `// Insert item payload\n{\n  "id": "${Date.now()}",\n  "name": "Sample Record"\n}`;
    }

    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `${type === 'SELECT' ? 'Query' : 'Create'} ${cName}`,
      query: script,
      results: [],
      columns: [],
      rawOutput: '',
      execTime: '—',
      error: null,
      successInfo: null,
    };
    setQueryTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
    setActiveTab('editor');
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#1e1e2e] text-[#cdd6f4] select-none overflow-hidden font-sans">
      {/* Top Navbar */}
      <div className="h-11 border-b border-white/10 px-4 flex items-center justify-between bg-black/20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-sm shadow-inner border border-blue-500/30">
            🪐
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white tracking-wide">{profile.name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20">
              Azure Cosmos DB
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <Shield className="w-2.5 h-2.5" /> HTTPS/TLS
            </span>
            <span className="text-xs text-gray-500">•</span>
            <span className="text-xs text-gray-400 font-mono">DB: {profile.database}</span>
          </div>
        </div>

        {/* View Switcher */}
        <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>SQL API Studio</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('datagrid');
              if (selectedContainer) loadContainerItems(selectedContainer);
            }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'datagrid' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>Items Grid</span>
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

      {/* Global Error Banner */}
      {globalError && (
        <div className="bg-red-500/10 border-b border-red-500/20 px-4 py-2 flex items-center justify-between text-xs text-red-300">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{globalError}</span>
          </div>
          <button onClick={() => setGlobalError(null)} className="text-gray-400 hover:text-white text-sm">×</button>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar */}
        <div className="w-64 border-r border-white/10 flex flex-col bg-black/10 shrink-0">
          <SchemaTreeView
            engine="cosmos"
            databases={[profile.database || 'default']}
            currentDb={profile.database || 'default'}
            tables={containers}
            views={[]}
            routines={[]}
            triggers={[]}
            selectedTable={selectedContainer}
            isLoading={isLoading}
            onSelectTable={(c) => {
              loadContainerItems(c);
              setActiveTab('datagrid');
            }}
            onOpenDefinition={(name) => {
              const newId = `tab-${Date.now()}`;
              const newTab: QueryTab = {
                id: newId,
                title: `Query: ${name}`,
                query: `SELECT * FROM c WHERE c.container = "${name}"`,
                results: [],
                columns: [],
                rawOutput: '',
                execTime: '—',
                error: null,
                successInfo: null,
              };
              setQueryTabs(prev => [...prev, newTab]);
              setActiveTabId(newId);
              setActiveTab('editor');
            }}
            onCreateTable={() => setShowCreateModal(true)}
            onRefresh={loadCosmosContainers}
            onDropTable={handleDropContainer}
            onCopyName={(name) => navigator.clipboard.writeText(name)}
            onGenerateSql={handleGenerateQuery}
          />
        </div>

        {/* Right Main Body */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#181825]">
          {/* VIEW 1: Query Studio */}
          {activeTab === 'editor' && (
            <div className="flex-1 flex flex-col overflow-hidden">
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
                    onExecute={handleExecuteQuery}
                    isExecuting={isExecuting}
                    engine="cosmos"
                    tables={containers.map(c => c.name)}
                    columns={itemColumns}
                    language="sql"
                    splitMode={splitMode}
                    onSplitModeChange={setSplitMode}
                    onCloseTab={() => handleCloseTab(activeTabId)}
                  />
                </div>

                {/* Multi-Statement Results Viewer */}
                <div className={`overflow-hidden ${splitMode === 'vertical' ? 'w-1/2' : 'h-1/2'}`}>
                  <MultiResultViewer
                    tableName={selectedContainer}
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
                    onAddRow={() => selectedContainer && setShowItemCreate(true)}
                    onEditRow={(row) => {
                      setItemToEdit(row);
                      setShowItemEditor(true);
                    }}
                    onDeleteRow={handleDeleteItem}
                  />
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: Items Grid */}
          {activeTab === 'datagrid' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <MultiResultViewer
                tableName={selectedContainer}
                columns={itemColumns}
                rows={items}
                execTime={isLoading ? 'Loading items...' : 'Cached'}
                error={null}
                successInfo={selectedContainer ? `Showing items for container "${selectedContainer}"` : undefined}
                onAddRow={() => selectedContainer && setShowItemCreate(true)}
                onEditRow={(row) => {
                  setItemToEdit(row);
                  setShowItemEditor(true);
                }}
                onDeleteRow={handleDeleteItem}
              />
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateTableModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          engine="cosmos"
          connectionId={profile.id}
          database={profile.database}
          onCreated={(newC) => {
            loadCosmosContainers();
            loadContainerItems(newC);
          }}
        />
      )}

      {showItemCreate && selectedContainer && (
        <RowCreateModal
          isOpen={showItemCreate}
          onClose={() => setShowItemCreate(false)}
          engine="cosmos"
          tableName={selectedContainer}
          connectionId={profile.id}
          onSuccess={() => {
            setShowItemCreate(false);
            loadContainerItems(selectedContainer);
          }}
        />
      )}

      {showItemEditor && selectedContainer && (
        <RowEditorModal
          isOpen={showItemEditor}
          onClose={() => setShowItemEditor(false)}
          engine="cosmos"
          connectionId={profile.id}
          tableName={selectedContainer}
          initialRow={itemToEdit}
          onSaved={() => loadContainerItems(selectedContainer)}
        />
      )}
    </div>
  );
};

export default CosmosStudio;
