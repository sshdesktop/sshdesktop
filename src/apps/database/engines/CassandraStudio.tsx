import React, { useState, useEffect } from 'react';
import {
  Table,
  Play,
  RefreshCw,
  Plus,
  Trash2,
  Code2,
  Sliders,
  AlertCircle,
  CheckCircle2,
  Key,
  Shield,
  Layers,
  Columns
} from 'lucide-react';
import {
  DbConnectionProfile,
  TableItem,
  ColumnDefinition,
  RoutineItem,
  TriggerItem,
  IndexItem,
  QueryTab,
  DataGridState
} from '../types';
import {
  dbListTables,
  dbGetTableColumns,
  dbExecuteQuery,
  dbGetObjectDefinition
} from '../../../lib/tauri-bridge';
import { CreateTableModal } from '../modals/CreateTableModal';
import { RowEditorModal } from '../modals/RowEditorModal';
import { RowCreateModal } from '../modals/RowCreateModal';
import {
  QueryTabBar,
  SqlEditorPanel,
  MultiResultViewer,
  SchemaTreeView
} from '../components';

interface CassandraStudioProps {
  profile: DbConnectionProfile;
  onDisconnect?: () => void;
}

export const CassandraStudio: React.FC<CassandraStudioProps> = ({ profile, onDisconnect }) => {
  const [activeTab, setActiveTab] = useState<'editor' | 'datagrid' | 'structure'>('editor');

  // Keyspaces
  const [keyspaces, setKeyspaces] = useState<string[]>([]);
  const [currentKeyspace, setCurrentKeyspace] = useState<string>(
    profile.keyspace || profile.database || 'system'
  );

  // Schema tree
  const [tables, setTables] = useState<TableItem[]>([]);
  const [views, setViews] = useState<TableItem[]>([]);
  const [routines, setRoutines] = useState<RoutineItem[]>([]);
  const [triggers, setTriggers] = useState<TriggerItem[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Modals
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [showRowEditor, setShowRowEditor] = useState(false);
  const [showRowCreate, setShowRowCreate] = useState(false);
  const [rowToEdit, setRowToEdit] = useState<any | null>(null);

  // Layout & Split Mode
  const [splitMode, setSplitMode] = useState<'horizontal' | 'vertical' | 'editor-only' | 'results-only'>('horizontal');

  // CQL Editor & Multi-Output Tabs
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    {
      id: 'tab-1',
      title: 'CQL Query 1',
      query: `SELECT * FROM system_schema.tables WHERE keyspace_name = '${currentKeyspace}' LIMIT 50;`,
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

  // Data Grid
  const [dataGrid, setDataGrid] = useState<DataGridState>({
    table: null,
    rows: [],
    columns: [],
    totalCount: 0,
    pageSize: 50,
    currentPage: 1,
    loading: false,
    error: null,
    selectedRowIndex: null,
    selectedColumnIndex: null,
    sortColumn: null,
    sortDirection: null,
  });

  const [structureCols, setStructureCols] = useState<ColumnDefinition[]>([]);
  const [indexes, setIndexes] = useState<IndexItem[]>([]);

  const activeQueryTab = queryTabs.find(t => t.id === activeTabId) || queryTabs[0];

  // ─── 1. Load Keyspaces & Cassandra Schema ─────────────────────────
  const loadKeyspaces = async () => {
    try {
      const res = await dbExecuteQuery(profile.id, 'SELECT keyspace_name FROM system_schema.keyspaces;');
      if (res.rows && res.rows.length > 0) {
        setKeyspaces(res.rows.map((r: any) => r.keyspace_name || Object.values(r)[0]));
      }
    } catch {
      setKeyspaces([currentKeyspace]);
    }
  };

  const loadCassandraSchema = async () => {
    setIsLoading(true);
    setGlobalError(null);
    try {
      const ks = currentKeyspace;
      const cql = `SELECT table_name FROM system_schema.tables WHERE keyspace_name = '${ks}';`;
      const res = await dbExecuteQuery(profile.id, cql);
      const tblList: TableItem[] = (res.rows || []).map((r: any) => ({
        name: r.table_name || r.TABLE_NAME || 'table',
        type: 'table',
        schema: ks,
      }));

      // Materialized views
      let vwList: TableItem[] = [];
      try {
        const vRes = await dbExecuteQuery(profile.id, `SELECT view_name FROM system_schema.views WHERE keyspace_name = '${ks}';`);
        vwList = (vRes.rows || []).map((r: any) => ({
          name: r.view_name || r.VIEW_NAME || 'view',
          type: 'view',
          schema: ks,
        }));
      } catch (e) {
        console.warn('Cassandra views notice:', e);
      }

      // Triggers
      try {
        const trgRes = await dbExecuteQuery(profile.id, `SELECT trigger_name, table_name FROM system_schema.triggers WHERE keyspace_name = '${ks}';`);
        if (trgRes.rows) {
          setTriggers(trgRes.rows.map((r: any) => ({
            name: r.trigger_name,
            tableName: r.table_name,
          })));
        }
      } catch (e) {
        console.warn('Cassandra triggers notice:', e);
      }

      setTables(tblList);
      setViews(vwList);

      if (tblList.length > 0 && !selectedTable) {
        setSelectedTable(tblList[0].name);
      }
    } catch (e: any) {
      setGlobalError(`Failed to load Cassandra schema: ${e?.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadKeyspaces();
    loadCassandraSchema();
  }, [profile.id, currentKeyspace]);

  // ─── 2. Data Grid & Structure ─────────────────────────────────────
  const loadTableDataGrid = async (tableName: string) => {
    setSelectedTable(tableName);
    setDataGrid(prev => ({ ...prev, table: tableName, loading: true, error: null }));
    try {
      const ks = currentKeyspace;
      const q = `SELECT * FROM "${ks}"."${tableName}" LIMIT 100;`;
      const res = await dbExecuteQuery(profile.id, q);

      setDataGrid({
        table: tableName,
        rows: res.rows || [],
        columns: (res.columns || []).map((c: any) => typeof c === 'string' ? c : c.name),
        totalCount: res.rows?.length || 0,
        pageSize: 50,
        currentPage: 1,
        loading: false,
        error: null,
        selectedRowIndex: null,
        selectedColumnIndex: null,
        sortColumn: null,
        sortDirection: null,
      });

      loadTableStructure(tableName);
    } catch (err: any) {
      setDataGrid(prev => ({
        ...prev,
        loading: false,
        error: String(err?.message || err),
        rows: [],
        columns: [],
      }));
    }
  };

  const loadTableStructure = async (tableName: string) => {
    try {
      const ks = currentKeyspace;
      const colQ = `SELECT column_name, type, kind FROM system_schema.columns WHERE keyspace_name = '${ks}' AND table_name = '${tableName}';`;
      const res = await dbExecuteQuery(profile.id, colQ);
      if (res.rows) {
        setStructureCols(res.rows.map((r: any) => ({
          name: r.column_name,
          type: r.type,
          nullable: r.kind !== 'partition_key' && r.kind !== 'clustering',
          isPrimaryKey: r.kind === 'partition_key' || r.kind === 'clustering',
          extra: r.kind,
        })));
      }

      // Indexes
      try {
        const idxQ = `SELECT index_name, target FROM system_schema.indexes WHERE keyspace_name = '${ks}' AND table_name = '${tableName}';`;
        const idxRes = await dbExecuteQuery(profile.id, idxQ);
        if (idxRes.rows) {
          setIndexes(idxRes.rows.map((r: any) => ({
            name: r.index_name,
            tableName,
            columnName: r.target,
            isUnique: false,
            type: 'INDEX',
          })));
        }
      } catch (e) {
        console.warn('Cassandra indexes notice:', e);
      }
    } catch (err) {
      console.warn('Failed to load table structure:', err);
    }
  };

  // ─── 3. Query Tabs Management ─────────────────────────────────────
  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `CQL ${queryTabs.length + 1}`,
      query: `SELECT * FROM "${currentKeyspace}"."${selectedTable || 'system'}" LIMIT 50;`,
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
      title: 'CQL 1',
      query: `SELECT * FROM system_schema.tables WHERE keyspace_name = '${currentKeyspace}' LIMIT 50;`,
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

      setQueryTabs(prev => {
        return prev.map(t => {
          if (t.id === activeTabId) {
            return {
              ...t,
              results: res.rows || [],
              columns: (res.columns || []).map((c: any) => typeof c === 'string' ? c : c.name),
              allResults: res.all_results || undefined,
              activeResultIndex: 0,
              rawOutput: JSON.stringify(res.rows, null, 2),
              execTime: `${durationMs}ms`,
              error: null,
              successInfo: `Executed in ${durationMs}ms (${res.rows?.length || res.affected_rows} rows).`,
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

  // ─── 5. Table Actions ─────────────────────────────────────
  const handleDeleteRow = async (row: any) => {
    if (!selectedTable) return;
    const pkCol = structureCols.find(c => c.isPrimaryKey) || structureCols[0];
    if (!pkCol) {
      alert('Cannot delete row: no partition key defined.');
      return;
    }
    const val = row[pkCol.name];
    const whereVal = typeof val === 'number' ? val : `'${String(val).replace(/'/g, "''")}'`;
    try {
      await dbExecuteQuery(profile.id, `DELETE FROM "${currentKeyspace}"."${selectedTable}" WHERE "${pkCol.name}" = ${whereVal};`);
      loadTableDataGrid(selectedTable);
    } catch (e: any) {
      alert(`Delete Error: ${e?.message || e}`);
    }
  };

  const handleTruncateTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `TRUNCATE "${currentKeyspace}"."${tbl}";`);
      loadTableDataGrid(tbl);
    } catch (e: any) {
      alert(`Truncate Error: ${e?.message || e}`);
    }
  };

  const handleDropTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `DROP TABLE IF EXISTS "${currentKeyspace}"."${tbl}";`);
      loadCassandraSchema();
      if (selectedTable === tbl) setSelectedTable(null);
    } catch (e: any) {
      alert(`Drop Error: ${e?.message || e}`);
    }
  };

  const handleGenerateSql = (type: 'SELECT' | 'INSERT', tbl: string) => {
    const cols = structureCols.map(c => `"${c.name}"`).join(', ') || '*';
    let sql = '';
    if (type === 'SELECT') {
      sql = `SELECT ${cols} FROM "${currentKeyspace}"."${tbl}" LIMIT 100;`;
    } else {
      const placeholders = structureCols.map(c => `?`).join(', ');
      sql = `INSERT INTO "${currentKeyspace}"."${tbl}" (${cols})\nVALUES (${placeholders});`;
    }

    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `${type} ${tbl}`,
      query: sql,
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

  const handleOpenDefinition = async (name: string, type: 'table' | 'view' | 'procedure' | 'function' | 'trigger') => {
    try {
      let ddl = await dbGetObjectDefinition(profile.id, type, name, currentKeyspace);
      if (!ddl || ddl.trim().length === 0) {
        if (type === 'view') {
          ddl = `CREATE MATERIALIZED VIEW "${currentKeyspace}"."${name}" AS\nSELECT * FROM "${currentKeyspace}"."${selectedTable || 'table_name'}"\nWHERE id IS NOT NULL\nPRIMARY KEY (id);`;
        } else if (type === 'trigger') {
          ddl = `CREATE TRIGGER "${name}" ON "${currentKeyspace}"."${selectedTable || 'table_name'}" USING 'org.apache.cassandra.triggers.AuditTrigger';`;
        } else {
          ddl = `DESCRIBE TABLE "${currentKeyspace}"."${name}";`;
        }
      }

      const newId = `tab-${Date.now()}`;
      const newTab: QueryTab = {
        id: newId,
        title: `${type === 'view' ? 'View' : type === 'trigger' ? 'Trig' : 'Obj'}: ${name}`,
        query: ddl,
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
    } catch (err: any) {
      alert(`Failed to load definition for ${type} ${name}: ${err?.message || err}`);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#1e1e2e] text-[#cdd6f4] select-none overflow-hidden font-sans">
      {/* Top Navbar */}
      <div className="h-11 border-b border-white/10 px-4 flex items-center justify-between bg-black/20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-teal-500/20 text-teal-400 flex items-center justify-center font-bold text-sm shadow-inner border border-teal-500/30">
            👁️
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white tracking-wide">{profile.name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-teal-500/10 text-teal-400 border border-teal-500/20">
              Apache Cassandra CQL
            </span>
            <span className="text-xs text-gray-500">•</span>
            <span className="text-xs text-gray-400 font-mono">
              Keyspace: <span className="text-teal-300 font-semibold">{currentKeyspace}</span>
            </span>
          </div>
        </div>

        {/* View Switcher */}
        <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-teal-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>CQL Studio</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('datagrid');
              if (selectedTable) loadTableDataGrid(selectedTable);
            }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'datagrid' ? 'bg-teal-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>Data Grid</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('structure');
              if (selectedTable) loadTableStructure(selectedTable);
            }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'structure' ? 'bg-teal-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Structure</span>
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
            engine="cassandra"
            databases={keyspaces}
            currentDb={currentKeyspace}
            tables={tables}
            views={views}
            routines={routines}
            triggers={triggers}
            selectedTable={selectedTable}
            isLoading={isLoading}
            onSelectDatabase={setCurrentKeyspace}
            onSelectTable={(tbl) => {
              loadTableDataGrid(tbl);
              setActiveTab('datagrid');
            }}
            onOpenDefinition={handleOpenDefinition}
            onCreateTable={() => setShowCreateTable(true)}
            onRefresh={loadCassandraSchema}
            onTruncateTable={handleTruncateTable}
            onDropTable={handleDropTable}
            onCopyName={(name) => navigator.clipboard.writeText(name)}
            onGenerateSql={handleGenerateSql}
          />
        </div>

        {/* Right Main Body */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#181825]">
          {/* VIEW 1: CQL Studio */}
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
                    engine="cassandra"
                    tables={tables.map(t => t.name)}
                    columns={structureCols.map(c => c.name)}
                    language="sql"
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
                    onAddRow={() => selectedTable && setShowRowCreate(true)}
                    onEditRow={(row) => {
                      setRowToEdit(row);
                      setShowRowEditor(true);
                    }}
                    onDeleteRow={handleDeleteRow}
                  />
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: Data Grid */}
          {activeTab === 'datagrid' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <MultiResultViewer
                tableName={dataGrid.table}
                columns={dataGrid.columns}
                rows={dataGrid.rows}
                execTime={dataGrid.loading ? 'Loading...' : 'Cached'}
                error={dataGrid.error}
                successInfo={dataGrid.table ? `Displaying data for table "${dataGrid.table}"` : undefined}
                onAddRow={() => dataGrid.table && setShowRowCreate(true)}
                onEditRow={(row) => {
                  setRowToEdit(row);
                  setShowRowEditor(true);
                }}
                onDeleteRow={handleDeleteRow}
              />
            </div>
          )}

          {/* VIEW 3: Structure */}
          {activeTab === 'structure' && (
            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">Table Structure: "{selectedTable}"</h3>
                  <p className="text-xs text-gray-400">{structureCols.length} Columns • {indexes.length} Indexes</p>
                </div>
              </div>

              {/* Columns Table */}
              <div className="rounded-xl border border-white/10 overflow-hidden bg-white/5">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-black/30 border-b border-white/10 text-gray-400 font-semibold">
                    <tr>
                      <th className="px-3 py-2">Column Name</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Key Kind</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {structureCols.map(col => (
                      <tr key={col.name} className="hover:bg-white/5">
                        <td className="px-3 py-2 font-bold text-white font-mono">{col.name}</td>
                        <td className="px-3 py-2 text-teal-400 font-mono">{col.type}</td>
                        <td className="px-3 py-2">
                          {col.isPrimaryKey ? (
                            <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px]">
                              {col.extra || 'PRIMARY KEY'}
                            </span>
                          ) : (
                            <span className="text-gray-500">regular</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Indexes Table */}
              {indexes.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Indexes</h4>
                  <div className="rounded-xl border border-white/10 overflow-hidden bg-white/5">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-black/30 border-b border-white/10 text-gray-400 font-semibold">
                        <tr>
                          <th className="px-3 py-2">Index Name</th>
                          <th className="px-3 py-2">Target</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {indexes.map((idx, i) => (
                          <tr key={i} className="hover:bg-white/5">
                            <td className="px-3 py-2 text-white font-mono">{idx.name}</td>
                            <td className="px-3 py-2 text-teal-400 font-mono">{idx.columnName}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateTable && (
        <CreateTableModal
          isOpen={showCreateTable}
          onClose={() => setShowCreateTable(false)}
          engine="cassandra"
          connectionId={profile.id}
          database={currentKeyspace}
          onCreated={(newTbl) => {
            loadCassandraSchema();
            loadTableDataGrid(newTbl);
          }}
        />
      )}

      {showRowCreate && selectedTable && (
        <RowCreateModal
          isOpen={showRowCreate}
          onClose={() => setShowRowCreate(false)}
          engine="cassandra"
          tableName={selectedTable}
          columns={structureCols}
          connectionId={profile.id}
          database={currentKeyspace}
          onSuccess={() => {
            setShowRowCreate(false);
            loadTableDataGrid(selectedTable);
          }}
        />
      )}

      {showRowEditor && selectedTable && (
        <RowEditorModal
          isOpen={showRowEditor}
          onClose={() => setShowRowEditor(false)}
          engine="cassandra"
          connectionId={profile.id}
          tableName={selectedTable}
          database={currentKeyspace}
          columns={structureCols}
          initialRow={rowToEdit}
          onSaved={() => loadTableDataGrid(selectedTable)}
        />
      )}
    </div>
  );
};

export default CassandraStudio;
