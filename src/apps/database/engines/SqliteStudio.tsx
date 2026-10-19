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
  HardDrive,
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
import { AlterTableModal } from '../modals/AlterTableModal';
import { RowEditorModal } from '../modals/RowEditorModal';
import { RowCreateModal } from '../modals/RowCreateModal';
import {
  QueryTabBar,
  SqlEditorPanel,
  MultiResultViewer,
  SchemaTreeView
} from '../components';

interface SqliteStudioProps {
  profile: DbConnectionProfile;
  onDisconnect?: () => void;
}

export const SqliteStudio: React.FC<SqliteStudioProps> = ({ profile, onDisconnect }) => {
  const [activeTab, setActiveTab] = useState<'editor' | 'datagrid' | 'structure'>('editor');

  // Database list
  const [databases, setDatabases] = useState<string[]>(['main']);
  const [currentDb, setCurrentDb] = useState<string>('main');

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
  const [showAlterTable, setShowAlterTable] = useState(false);
  const [showRowEditor, setShowRowEditor] = useState(false);
  const [showRowCreate, setShowRowCreate] = useState(false);
  const [rowToEdit, setRowToEdit] = useState<any | null>(null);

  // Layout & Split Mode
  const [splitMode, setSplitMode] = useState<'horizontal' | 'vertical' | 'editor-only' | 'results-only'>('horizontal');

  // Query Tabs State (Multi-Output)
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    {
      id: 'tab-1',
      title: 'Query 1',
      query: "SELECT name, type FROM sqlite_master WHERE type in ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name;",
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

  // ─── 1. Load SQLite Schema ─────────────────────────────────────────
  const loadSqliteDatabases = async () => {
    try {
      const res = await dbExecuteQuery(profile.id, 'PRAGMA database_list;');
      if (res.rows && res.rows.length > 0) {
        setDatabases(res.rows.map((r: any) => r.name || 'main'));
      }
    } catch {
      setDatabases(['main']);
    }
  };

  const loadSqliteSchema = async () => {
    setIsLoading(true);
    setGlobalError(null);
    try {
      const q = "SELECT name, type FROM sqlite_master WHERE type in ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name";
      const res = await dbExecuteQuery(profile.id, q);
      const tblList: TableItem[] = [];
      const vwList: TableItem[] = [];

      (res.rows || []).forEach((r: any) => {
        const name = r.name || r.NAME;
        const type = r.type === 'view' ? 'view' : 'table';
        const item: TableItem = { name, type };
        if (type === 'view') vwList.push(item);
        else tblList.push(item);
      });

      setTables(tblList);
      setViews(vwList);

      // Load triggers
      try {
        const trgRes = await dbExecuteQuery(profile.id, "SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' ORDER BY name;");
        if (trgRes.rows) {
          setTriggers(trgRes.rows.map((r: any) => ({
            name: r.name,
            tableName: r.tbl_name,
          })));
        }
      } catch (e) {
        console.warn('SQLite triggers notice:', e);
      }

      if (tblList.length > 0 && !selectedTable) {
        setSelectedTable(tblList[0].name);
      }
    } catch (e: any) {
      setGlobalError(`Failed to load SQLite schema: ${e?.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSqliteDatabases();
    loadSqliteSchema();
  }, [profile.id]);

  // ─── 2. Data Grid & Structure ─────────────────────────────────────
  const loadTableDataGrid = async (tableName: string) => {
    setSelectedTable(tableName);
    setDataGrid(prev => ({ ...prev, table: tableName, loading: true, error: null }));
    try {
      const q = `SELECT * FROM "${tableName}" LIMIT 100;`;
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
      const cols = await dbGetTableColumns(profile.id, tableName, currentDb);
      setStructureCols(cols.map((c: any) => ({
        name: c.name,
        type: c.data_type || c.type || 'TEXT',
        nullable: Boolean(c.nullable),
        isPrimaryKey: Boolean(c.is_primary_key || c.primary_key),
        autoIncrement: Boolean(c.extra?.includes('auto_increment') || c.auto_increment),
        defaultValue: c.default_value || undefined,
        extra: c.auto_increment ? 'AUTOINCREMENT' : undefined,
      })));

      // Load indexes for SQLite
      try {
        const idxRes = await dbExecuteQuery(profile.id, `PRAGMA index_list("${tableName}");`);
        if (idxRes.rows) {
          setIndexes(idxRes.rows.map((r: any) => ({
            name: r.name,
            tableName,
            columnName: '',
            isUnique: Boolean(r.unique),
            type: r.origin || 'INDEX',
          })));
        }
      } catch (e) {
        console.warn('SQLite indexes notice:', e);
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
      title: `Query ${queryTabs.length + 1}`,
      query: "SELECT name, type FROM sqlite_master WHERE type in ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name;",
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
      query: "SELECT name, type FROM sqlite_master WHERE type in ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name;",
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

  // ─── 5. Table Actions ─────────────────────────────────────────────
  const handleDeleteRow = async (row: any) => {
    if (!selectedTable) return;
    const pkCol = structureCols.find(c => c.isPrimaryKey) || structureCols[0];
    if (!pkCol) {
      alert('Cannot delete row: no primary key column defined.');
      return;
    }
    const val = row[pkCol.name];
    const whereVal = typeof val === 'number' ? val : `'${String(val).replace(/'/g, "''")}'`;
    try {
      await dbExecuteQuery(profile.id, `DELETE FROM "${selectedTable}" WHERE "${pkCol.name}" = ${whereVal};`);
      loadTableDataGrid(selectedTable);
    } catch (e: any) {
      alert(`Delete Error: ${e?.message || e}`);
    }
  };

  const handleTruncateTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `DELETE FROM "${tbl}";`);
      loadTableDataGrid(tbl);
    } catch (e: any) {
      alert(`Truncate Error: ${e?.message || e}`);
    }
  };

  const handleDropTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `DROP TABLE IF EXISTS "${tbl}";`);
      loadSqliteSchema();
      if (selectedTable === tbl) setSelectedTable(null);
    } catch (e: any) {
      alert(`Drop Error: ${e?.message || e}`);
    }
  };

  const handleRenameTable = async (tbl: string) => {
    const newName = prompt(`Enter new name for table "${tbl}":`, tbl);
    if (!newName || newName === tbl) return;
    try {
      await dbExecuteQuery(profile.id, `ALTER TABLE "${tbl}" RENAME TO "${newName}";`);
      loadSqliteSchema();
      if (selectedTable === tbl) setSelectedTable(newName);
    } catch (e: any) {
      alert(`Rename Error: ${e?.message || e}`);
    }
  };

  const handleGenerateSql = (type: 'SELECT' | 'INSERT', tbl: string) => {
    const cols = structureCols.map(c => `"${c.name}"`).join(', ') || '*';
    let sql = '';
    if (type === 'SELECT') {
      sql = `SELECT ${cols} FROM "${tbl}" LIMIT 100;`;
    } else {
      const placeholders = structureCols.map(() => '?').join(', ');
      sql = `INSERT INTO "${tbl}" (${cols})\nVALUES (${placeholders});`;
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
      let ddl = await dbGetObjectDefinition(profile.id, type, name, currentDb);
      if (!ddl || ddl.trim().length === 0) {
        if (type === 'view') {
          ddl = `CREATE VIEW "${name}" AS\nSELECT * FROM "${selectedTable || 'table_name'}";`;
        } else if (type === 'trigger') {
          ddl = `CREATE TRIGGER "${name}"\nAFTER INSERT ON "${selectedTable || 'table_name'}"\nBEGIN\n  -- Trigger logic\nEND;`;
        } else {
          ddl = `SELECT sql FROM sqlite_master WHERE name = '${name}';`;
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
          <div className="w-7 h-7 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold text-sm shadow-inner border border-sky-500/30">
            🪶
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white tracking-wide">{profile.name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
              SQLite 3 Engine
            </span>
            <span className="text-xs text-gray-500">•</span>
            <span className="text-xs text-gray-400 font-mono truncate max-w-xs">{profile.database || 'in-memory'}</span>
          </div>
        </div>

        {/* View Switcher */}
        <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-sky-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>SQL Studio</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('datagrid');
              if (selectedTable) loadTableDataGrid(selectedTable);
            }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'datagrid' ? 'bg-sky-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
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
              activeTab === 'structure' ? 'bg-sky-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
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
        {/* Left Sidebar: Reusable SchemaTreeView */}
        <div className="w-64 border-r border-white/10 flex flex-col bg-black/10 shrink-0">
          <SchemaTreeView
            engine="sqlite"
            databases={databases}
            currentDb={currentDb}
            tables={tables}
            views={views}
            routines={routines}
            triggers={triggers}
            selectedTable={selectedTable}
            isLoading={isLoading}
            onSelectDatabase={setCurrentDb}
            onSelectTable={(tbl) => {
              loadTableDataGrid(tbl);
              setActiveTab('datagrid');
            }}
            onCreateTable={() => setShowCreateTable(true)}
            onRefresh={loadSqliteSchema}
            onAlterTable={(tbl) => {
              setSelectedTable(tbl);
              loadTableStructure(tbl);
              setShowAlterTable(true);
            }}
            onRenameTable={handleRenameTable}
            onTruncateTable={handleTruncateTable}
            onDropTable={handleDropTable}
            onOpenDefinition={handleOpenDefinition}
            onCopyName={(name) => navigator.clipboard.writeText(name)}
            onGenerateSql={handleGenerateSql}
          />
        </div>

        {/* Right Main Body */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#181825]">
          {/* VIEW 1: SQL Studio */}
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
                    engine="sqlite"
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

          {/* VIEW 3: Table Structure */}
          {activeTab === 'structure' && (
            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">Table Structure: "{selectedTable}"</h3>
                  <p className="text-xs text-gray-400">{structureCols.length} Columns • {indexes.length} Indexes</p>
                </div>
                <button
                  onClick={() => setShowAlterTable(true)}
                  disabled={!selectedTable}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white flex items-center gap-1.5 shadow-md transition-colors"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Alter Table</span>
                </button>
              </div>

              {/* Columns Table */}
              <div className="rounded-xl border border-white/10 overflow-hidden bg-white/5">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-black/30 border-b border-white/10 text-gray-400 font-semibold">
                    <tr>
                      <th className="px-3 py-2">Column Name</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Nullable</th>
                      <th className="px-3 py-2">Key</th>
                      <th className="px-3 py-2">Default</th>
                      <th className="px-3 py-2">Extra</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {structureCols.map(col => (
                      <tr key={col.name} className="hover:bg-white/5">
                        <td className="px-3 py-2 font-bold text-white font-mono">{col.name}</td>
                        <td className="px-3 py-2 text-sky-400 font-mono">{col.type}</td>
                        <td className="px-3 py-2 text-gray-400">{col.nullable ? 'YES' : 'NO'}</td>
                        <td className="px-3 py-2">
                          {col.isPrimaryKey && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px]">PK</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{col.defaultValue || '—'}</td>
                        <td className="px-3 py-2 text-gray-400">{col.extra || '—'}</td>
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
                          <th className="px-3 py-2">Origin</th>
                          <th className="px-3 py-2">Constraint</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {indexes.map((idx, i) => (
                          <tr key={i} className="hover:bg-white/5">
                            <td className="px-3 py-2 text-white font-mono">{idx.name}</td>
                            <td className="px-3 py-2 text-sky-400 font-mono">{idx.type}</td>
                            <td className="px-3 py-2 text-gray-400">{idx.isUnique ? 'UNIQUE' : 'INDEX'}</td>
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
          engine="sqlite"
          connectionId={profile.id}
          database={profile.database}
          onCreated={(newTbl) => {
            loadSqliteSchema();
            loadTableDataGrid(newTbl);
          }}
        />
      )}

      {showAlterTable && selectedTable && (
        <AlterTableModal
          isOpen={showAlterTable}
          onClose={() => setShowAlterTable(false)}
          engine="sqlite"
          connectionId={profile.id}
          tableName={selectedTable}
          database={profile.database}
          existingColumns={structureCols}
          onAltered={() => {
            loadTableStructure(selectedTable);
            loadTableDataGrid(selectedTable);
          }}
        />
      )}

      {showRowCreate && selectedTable && (
        <RowCreateModal
          isOpen={showRowCreate}
          onClose={() => setShowRowCreate(false)}
          engine="sqlite"
          tableName={selectedTable}
          columns={structureCols}
          connectionId={profile.id}
          database={profile.database}
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
          engine="sqlite"
          connectionId={profile.id}
          tableName={selectedTable}
          database={profile.database}
          columns={structureCols}
          initialRow={rowToEdit}
          onSaved={() => loadTableDataGrid(selectedTable)}
        />
      )}
    </div>
  );
};

export default SqliteStudio;
