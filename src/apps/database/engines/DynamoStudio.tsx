import React, { useState, useEffect } from 'react';
import {
  Package,
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
  Layers,
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

interface DynamoStudioProps {
  profile: DbConnectionProfile;
  onDisconnect?: () => void;
}

export const DynamoStudio: React.FC<DynamoStudioProps> = ({ profile, onDisconnect }) => {
  const [activeTab, setActiveTab] = useState<'editor' | 'datagrid'>('editor');

  // Tables
  const [tables, setTables] = useState<TableItem[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [itemColumns, setItemColumns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Modals
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [showItemEditor, setShowItemEditor] = useState(false);
  const [showItemCreate, setShowItemCreate] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<any | null>(null);

  // Layout & Split Mode
  const [splitMode, setSplitMode] = useState<'horizontal' | 'vertical' | 'editor-only' | 'results-only'>('horizontal');

  // Query Tabs State (Supports JSON Operations & PartiQL)
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    {
      id: 'tab-1',
      title: 'Query 1',
      query: '{\n  "operation": "scan",\n  "table": "users",\n  "limit": 25\n}',
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

  // ─── 1. Load DynamoDB Tables ──────────────────────────────────────
  const loadDynamoTables = async () => {
    setIsLoading(true);
    setGlobalError(null);
    try {
      const q = JSON.stringify({ operation: 'list_tables' });
      const res = await dbExecuteQuery(profile.id, q);
      const tblList: TableItem[] = (res.rows || []).map((r: any) => ({
        name: typeof r === 'string' ? r : (r.table_name || r.name || 'table'),
        type: 'table',
        partitionKey: r.partition_key || 'id',
      }));

      setTables(tblList);
      if (tblList.length > 0 && !selectedTable) {
        setSelectedTable(tblList[0].name);
        loadTableItems(tblList[0].name);
      }
    } catch (e: any) {
      setGlobalError(`Failed to load DynamoDB tables: ${e?.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDynamoTables();
  }, [profile.id]);

  // ─── 2. Load Table Items for Grid ─────────────────────────────────
  const loadTableItems = async (tblName: string) => {
    setSelectedTable(tblName);
    setIsLoading(true);
    try {
      const q = JSON.stringify({
        operation: 'scan',
        table: tblName,
        limit: 50,
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
      setGlobalError(`Scan failed: ${e?.message || e}`);
      setItems([]);
      setItemColumns([]);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── 3. Query Tab Management ──────────────────────────────────────
  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `Query ${queryTabs.length + 1}`,
      query: `{\n  "operation": "scan",\n  "table": "${selectedTable || 'users'}",\n  "limit": 25\n}`,
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
      query: '{\n  "operation": "scan",\n  "table": "users",\n  "limit": 25\n}',
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
    const q = (typeof overrideQuery === 'string' && overrideQuery.trim().length > 0)
      ? overrideQuery.trim()
      : activeQueryTab.query.trim();

    if (!q) return;

    setIsExecuting(true);
    setQueryTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, isExecuting: true, error: null } : t));

    const startTime = performance.now();
    try {
      const res = await dbExecuteQuery(profile.id, q);
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
    if (!selectedTable) return;
    const pk = item.id || item.pk || Object.keys(item)[0];
    const val = item[pk];
    try {
      const q = JSON.stringify({
        operation: 'delete_item',
        table: selectedTable,
        key: { [pk]: val },
      });
      await dbExecuteQuery(profile.id, q);
      loadTableItems(selectedTable);
    } catch (e: any) {
      alert(`Delete Error: ${e?.message || e}`);
    }
  };

  const handleDropTable = async (tbl: string) => {
    try {
      const q = JSON.stringify({ operation: 'delete_table', table: tbl });
      await dbExecuteQuery(profile.id, q);
      loadDynamoTables();
      if (selectedTable === tbl) setSelectedTable(null);
    } catch (e: any) {
      alert(`Drop Table Error: ${e?.message || e}`);
    }
  };

  const handleGenerateQuery = (type: 'SELECT' | 'INSERT', tbl: string) => {
    let script = '';
    if (type === 'SELECT') {
      script = `{\n  "operation": "scan",\n  "table": "${tbl}",\n  "limit": 50\n}`;
    } else {
      script = `{\n  "operation": "put_item",\n  "table": "${tbl}",\n  "item": {\n    "id": "${Date.now()}",\n    "name": "Sample Item"\n  }\n}`;
    }

    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `${type === 'SELECT' ? 'Scan' : 'Put'} ${tbl}`,
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
          <div className="w-7 h-7 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold text-sm shadow-inner border border-amber-500/30">
            📦
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white tracking-wide">{profile.name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20">
              Amazon DynamoDB
            </span>
            <span className="text-xs text-gray-500">•</span>
            <span className="text-xs text-gray-400 font-mono">Region: {profile.region || 'us-east-1'}</span>
          </div>
        </div>

        {/* View Switcher */}
        <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-amber-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Dynamo Console</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('datagrid');
              if (selectedTable) loadTableItems(selectedTable);
            }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'datagrid' ? 'bg-amber-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
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
            engine="dynamodb"
            databases={[profile.region || 'us-east-1']}
            currentDb={profile.region || 'us-east-1'}
            tables={tables}
            views={[]}
            routines={[]}
            triggers={[]}
            selectedTable={selectedTable}
            isLoading={isLoading}
            onSelectTable={(tbl) => {
              loadTableItems(tbl);
              setActiveTab('datagrid');
            }}
            onOpenDefinition={(name) => {
              const newId = `tab-${Date.now()}`;
              const newTab: QueryTab = {
                id: newId,
                title: `Scan: ${name}`,
                query: JSON.stringify({ operation: 'scan', table: name, limit: 50 }, null, 2),
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
            onCreateTable={() => setShowCreateTable(true)}
            onRefresh={loadDynamoTables}
            onDropTable={handleDropTable}
            onCopyName={(name) => navigator.clipboard.writeText(name)}
            onGenerateSql={handleGenerateQuery}
          />
        </div>

        {/* Right Main Body */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#181825]">
          {/* VIEW 1: Query Console */}
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
                    engine="dynamodb"
                    tables={tables.map(t => t.name)}
                    columns={itemColumns}
                    language="json"
                    splitMode={splitMode}
                    onSplitModeChange={setSplitMode}
                    onCloseTab={() => handleCloseTab(activeTabId)}
                  />
                </div>

                {/* Multi-Statement Results Viewer */}
                <div className={`overflow-hidden ${splitMode === 'vertical' ? 'w-1/2' : 'h-1/2'}`}>
                  <MultiResultViewer
                    tableName={selectedTable}
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
                    onAddRow={() => selectedTable && setShowItemCreate(true)}
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
                tableName={selectedTable}
                columns={itemColumns}
                rows={items}
                execTime={isLoading ? 'Loading items...' : 'Cached'}
                error={null}
                successInfo={selectedTable ? `Showing items for table "${selectedTable}"` : undefined}
                onAddRow={() => selectedTable && setShowItemCreate(true)}
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
      {showCreateTable && (
        <CreateTableModal
          isOpen={showCreateTable}
          onClose={() => setShowCreateTable(false)}
          engine="dynamodb"
          connectionId={profile.id}
          database={profile.region || 'us-east-1'}
          onCreated={(newTbl) => {
            loadDynamoTables();
            loadTableItems(newTbl);
          }}
        />
      )}

      {showItemCreate && selectedTable && (
        <RowCreateModal
          isOpen={showItemCreate}
          onClose={() => setShowItemCreate(false)}
          engine="dynamodb"
          tableName={selectedTable}
          connectionId={profile.id}
          onSuccess={() => {
            setShowItemCreate(false);
            loadTableItems(selectedTable);
          }}
        />
      )}

      {showItemEditor && selectedTable && (
        <RowEditorModal
          isOpen={showItemEditor}
          onClose={() => setShowItemEditor(false)}
          engine="dynamodb"
          connectionId={profile.id}
          tableName={selectedTable}
          initialRow={itemToEdit}
          onSaved={() => loadTableItems(selectedTable)}
        />
      )}
    </div>
  );
};

export default DynamoStudio;
