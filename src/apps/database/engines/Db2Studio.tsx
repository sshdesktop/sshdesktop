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
import { AlterTableModal } from '../modals/AlterTableModal';
import { RowEditorModal } from '../modals/RowEditorModal';
import { RowCreateModal } from '../modals/RowCreateModal';
import {
  QueryTabBar,
  SqlEditorPanel,
  MultiResultViewer,
  SchemaTreeView
} from '../components';

interface Db2StudioProps {
  profile: DbConnectionProfile;
  onDisconnect?: () => void;
}

export const Db2Studio: React.FC<Db2StudioProps> = ({ profile, onDisconnect }) => {
  const [activeTab, setActiveTab] = useState<'editor' | 'datagrid' | 'structure'>('editor');

  // Schemas
  const [schemas, setSchemas] = useState<string[]>([]);
  const [currentSchema, setCurrentSchema] = useState<string>(
    (profile.schema || profile.username || 'DB2ADMIN').toUpperCase()
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
      title: 'DB2 Query 1',
      query: "SELECT tabname, tabschema FROM syscat.tables WHERE tabschema NOT LIKE 'SYS%' FETCH FIRST 25 ROWS ONLY;",
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

  // ─── 1. Load Schemas & DB2 Objects ────────────────────────────────
  const loadDb2Schemas = async () => {
    try {
      const res = await dbExecuteQuery(profile.id, "SELECT schemaname FROM syscat.schemata WHERE schemaname NOT LIKE 'SYS%' ORDER BY schemaname;");
      if (res.rows && res.rows.length > 0) {
        setSchemas(res.rows.map((r: any) => r.schemaname || r.SCHEMANAME));
      }
    } catch {
      setSchemas([currentSchema]);
    }
  };

  const loadDb2Schema = async () => {
    setIsLoading(true);
    setGlobalError(null);
    try {
      const targetSchema = currentSchema.toUpperCase();
      const q = `SELECT tabname, type FROM syscat.tables WHERE tabschema = '${targetSchema}' ORDER BY tabname;`;
      const res = await dbExecuteQuery(profile.id, q);
      const tblList: TableItem[] = [];
      const vwList: TableItem[] = [];

      (res.rows || []).forEach((r: any) => {
        const name = r.tabname || r.TABNAME;
        const type = String(r.type || r.TYPE || '').includes('V') ? 'view' : 'table';
        const item: TableItem = { name, type, schema: targetSchema };
        if (type === 'view') vwList.push(item);
        else tblList.push(item);
      });

      setTables(tblList);
      setViews(vwList);

      // Routines (Procedures / Functions)
      try {
        const routRes = await dbExecuteQuery(
          profile.id,
          `SELECT routinename as name, routinetype as type FROM syscat.routines WHERE routineschema = '${targetSchema}' ORDER BY routinename;`
        );
        if (routRes.rows) {
          setRoutines(routRes.rows.map((r: any) => ({
            name: r.name || r.ROUTINENAME,
            type: String(r.type || r.ROUTINETYPE).includes('P') ? 'procedure' : 'function',
          })));
        }
      } catch (e) {
        console.warn('DB2 routines notice:', e);
      }

      // Triggers
      try {
        const trgRes = await dbExecuteQuery(
          profile.id,
          `SELECT trigname as name, tabname as table_name FROM syscat.triggers WHERE trigschema = '${targetSchema}' ORDER BY trigname;`
        );
        if (trgRes.rows) {
          setTriggers(trgRes.rows.map((r: any) => ({
            name: r.name || r.TRIGNAME,
            tableName: r.table_name || r.TABNAME,
          })));
        }
      } catch (e) {
        console.warn('DB2 triggers notice:', e);
      }

      if (tblList.length > 0 && !selectedTable) {
        setSelectedTable(tblList[0].name);
      }
    } catch (e: any) {
      setGlobalError(`Failed to load DB2 schema: ${e?.message || e}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDb2Schemas();
    loadDb2Schema();
  }, [profile.id, currentSchema]);

  // ─── 2. Data Grid & Structure ─────────────────────────────────────
  const loadTableDataGrid = async (tableName: string) => {
    setSelectedTable(tableName);
    setDataGrid(prev => ({ ...prev, table: tableName, loading: true, error: null }));
    try {
      const q = `SELECT * FROM "${currentSchema}"."${tableName}" FETCH FIRST 100 ROWS ONLY;`;
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
      const cols = await dbGetTableColumns(profile.id, tableName, currentSchema);
      setStructureCols(cols.map((c: any) => ({
        name: c.name,
        type: c.data_type || c.type || 'VARCHAR',
        nullable: Boolean(c.nullable),
        isPrimaryKey: Boolean(c.is_primary_key || c.primary_key),
        autoIncrement: Boolean(c.extra?.includes('auto_increment') || c.auto_increment),
        defaultValue: c.default_value || undefined,
      })));

      try {
        const idxSql = `
          SELECT indname as index_name, colnames as column_name, uniquerule
          FROM syscat.indexes
          WHERE tabname = '${tableName}' AND tabschema = '${currentSchema}';
        `;
        const idxRes = await dbExecuteQuery(profile.id, idxSql);
        if (idxRes.rows) {
          setIndexes(idxRes.rows.map((r: any) => ({
            name: r.index_name || r.INDNAME,
            tableName,
            columnName: r.column_name || r.COLNAMES,
            isUnique: (r.uniquerule || r.UNIQUERULE) === 'U' || (r.uniquerule || r.UNIQUERULE) === 'P',
            type: 'INDEX',
          })));
        }
      } catch (e) {
        console.warn('DB2 indexes notice:', e);
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
      title: `DB2 Query ${queryTabs.length + 1}`,
      query: "SELECT tabname, tabschema FROM syscat.tables WHERE tabschema NOT LIKE 'SYS%' FETCH FIRST 25 ROWS ONLY;",
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
      title: 'DB2 Query 1',
      query: "SELECT tabname, tabschema FROM syscat.tables WHERE tabschema NOT LIKE 'SYS%' FETCH FIRST 25 ROWS ONLY;",
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
      await dbExecuteQuery(profile.id, `DELETE FROM "${currentSchema}"."${selectedTable}" WHERE "${pkCol.name}" = ${whereVal};`);
      loadTableDataGrid(selectedTable);
    } catch (e: any) {
      alert(`Delete Error: ${e?.message || e}`);
    }
  };

  const handleTruncateTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `TRUNCATE TABLE "${currentSchema}"."${tbl}" IMMEDIATE;`);
      loadTableDataGrid(tbl);
    } catch (e: any) {
      alert(`Truncate Error: ${e?.message || e}`);
    }
  };

  const handleDropTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `DROP TABLE "${currentSchema}"."${tbl}";`);
      loadDb2Schema();
      if (selectedTable === tbl) setSelectedTable(null);
    } catch (e: any) {
      alert(`Drop Error: ${e?.message || e}`);
    }
  };

  const handleRenameTable = async (tbl: string) => {
    const newName = prompt(`Enter new name for table "${tbl}":`, tbl);
    if (!newName || newName === tbl) return;
    try {
      await dbExecuteQuery(profile.id, `RENAME TABLE "${currentSchema}"."${tbl}" TO "${newName}";`);
      loadDb2Schema();
      if (selectedTable === tbl) setSelectedTable(newName);
    } catch (e: any) {
      alert(`Rename Error: ${e?.message || e}`);
    }
  };

  const handleGenerateSql = (type: 'SELECT' | 'INSERT', tbl: string) => {
    const cols = structureCols.map(c => `"${c.name}"`).join(', ') || '*';
    let sql = '';
    if (type === 'SELECT') {
      sql = `SELECT ${cols} FROM "${currentSchema}"."${tbl}" FETCH FIRST 100 ROWS ONLY;`;
    } else {
      const placeholders = structureCols.map(c => `?`).join(', ');
      sql = `INSERT INTO "${currentSchema}"."${tbl}" (${cols})\nVALUES (${placeholders});`;
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
      let ddl = await dbGetObjectDefinition(profile.id, type, name, currentSchema);
      if (!ddl || ddl.trim().length === 0) {
        if (type === 'view') {
          ddl = `CREATE OR REPLACE VIEW "${currentSchema}"."${name}" AS\nSELECT * FROM "${currentSchema}"."${selectedTable || 'table_name'}";`;
        } else if (type === 'procedure') {
          ddl = `CREATE OR REPLACE PROCEDURE "${currentSchema}"."${name}"()\nLANGUAGE SQL\nBEGIN\n  -- Procedure body\nEND;`;
        } else if (type === 'function') {
          ddl = `CREATE OR REPLACE FUNCTION "${currentSchema}"."${name}"()\nRETURNS INTEGER\nLANGUAGE SQL\nBEGIN\n  RETURN 1;\nEND;`;
        } else if (type === 'trigger') {
          ddl = `CREATE OR REPLACE TRIGGER "${currentSchema}"."${name}"\nAFTER INSERT ON "${currentSchema}"."${selectedTable || 'table_name'}"\nFOR EACH ROW\nBEGIN\n  -- Trigger body\nEND;`;
        } else {
          ddl = `SELECT text FROM syscat.views WHERE viewschema = '${currentSchema}' AND viewname = '${name}';`;
        }
      }

      const newId = `tab-${Date.now()}`;
      const newTab: QueryTab = {
        id: newId,
        title: `${type === 'procedure' ? 'Proc' : type === 'function' ? 'Func' : type === 'trigger' ? 'Trig' : 'View'}: ${name}`,
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
          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold text-sm shadow-inner border border-indigo-500/30">
            🏢
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white tracking-wide">{profile.name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              IBM Db2 Engine
            </span>
            <span className="text-xs text-gray-500">•</span>
            <span className="text-xs text-gray-400 font-mono">
              Schema: <span className="text-indigo-300 font-semibold">{currentSchema}</span>
            </span>
          </div>
        </div>

        {/* View Switcher */}
        <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>DB2 Studio</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('datagrid');
              if (selectedTable) loadTableDataGrid(selectedTable);
            }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'datagrid' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
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
              activeTab === 'structure' ? 'bg-indigo-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
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
            engine="db2"
            databases={schemas}
            currentDb={currentSchema}
            tables={tables}
            views={views}
            routines={routines}
            triggers={triggers}
            selectedTable={selectedTable}
            isLoading={isLoading}
            onSelectDatabase={setCurrentSchema}
            onSelectTable={(tbl) => {
              loadTableDataGrid(tbl);
              setActiveTab('datagrid');
            }}
            onOpenDefinition={handleOpenDefinition}
            onCreateTable={() => setShowCreateTable(true)}
            onRefresh={loadDb2Schema}
            onAlterTable={(tbl) => {
              setSelectedTable(tbl);
              loadTableStructure(tbl);
              setShowAlterTable(true);
            }}
            onRenameTable={handleRenameTable}
            onTruncateTable={handleTruncateTable}
            onDropTable={handleDropTable}
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
                    engine="db2"
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
                <button
                  onClick={() => setShowAlterTable(true)}
                  disabled={!selectedTable}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1.5 shadow-md transition-colors"
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {structureCols.map(col => (
                      <tr key={col.name} className="hover:bg-white/5">
                        <td className="px-3 py-2 font-bold text-white font-mono">{col.name}</td>
                        <td className="px-3 py-2 text-indigo-400 font-mono">{col.type}</td>
                        <td className="px-3 py-2 text-gray-400">{col.nullable ? 'YES' : 'NO'}</td>
                        <td className="px-3 py-2">
                          {col.isPrimaryKey && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px]">PK</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-500">{col.defaultValue || '—'}</td>
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
                          <th className="px-3 py-2">Column</th>
                          <th className="px-3 py-2">Constraint</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {indexes.map((idx, i) => (
                          <tr key={i} className="hover:bg-white/5">
                            <td className="px-3 py-2 text-white font-mono">{idx.name}</td>
                            <td className="px-3 py-2 text-indigo-400 font-mono">{idx.columnName}</td>
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
          engine="db2"
          connectionId={profile.id}
          database={currentSchema}
          onCreated={(newTbl) => {
            loadDb2Schema();
            loadTableDataGrid(newTbl);
          }}
        />
      )}

      {showAlterTable && selectedTable && (
        <AlterTableModal
          isOpen={showAlterTable}
          onClose={() => setShowAlterTable(false)}
          engine="db2"
          connectionId={profile.id}
          tableName={selectedTable}
          database={currentSchema}
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
          engine="db2"
          tableName={selectedTable}
          columns={structureCols}
          connectionId={profile.id}
          database={currentSchema}
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
          engine="db2"
          connectionId={profile.id}
          tableName={selectedTable}
          database={currentSchema}
          columns={structureCols}
          initialRow={rowToEdit}
          onSaved={() => loadTableDataGrid(selectedTable)}
        />
      )}
    </div>
  );
};

export default Db2Studio;
