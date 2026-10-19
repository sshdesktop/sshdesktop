import React, { useState, useEffect } from 'react';
import {
  Table,
  Play,
  RefreshCw,
  Plus,
  Trash2,
  Code2,
  Zap,
  Sliders,
  Network,
  Download,
  AlertCircle,
  CheckCircle2,
  Layers,
  Search,
  Key,
  Shield,
  Columns
} from 'lucide-react';
import {
  DbConnectionProfile,
  TableItem,
  ColumnDefinition,
  RoutineItem,
  TriggerItem,
  IndexItem,
  ForeignKeyRelation,
  QueryTab,
  DataGridState
} from '../types';
import {
  dbListTables,
  dbGetTableColumns,
  dbExecuteQuery,
  dbExecuteOperation,
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

interface MysqlStudioProps {
  profile: DbConnectionProfile;
  onDisconnect?: () => void;
}

export const MysqlStudio: React.FC<MysqlStudioProps> = ({ profile, onDisconnect }) => {
  const [activeTab, setActiveTab] = useState<'editor' | 'datagrid' | 'structure' | 'er'>('editor');
  
  // Database Selector
  const [databases, setDatabases] = useState<string[]>([]);
  const [currentDb, setCurrentDb] = useState<string>(profile.database);

  // Left Sidebar Tree
  const [tables, setTables] = useState<TableItem[]>([]);
  const [views, setViews] = useState<TableItem[]>([]);
  const [routines, setRoutines] = useState<RoutineItem[]>([]);
  const [triggers, setTriggers] = useState<TriggerItem[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Modals
  const [showCreateTable, setShowCreateTable] = useState(false);
  const [showAlterTable, setShowAlterTable] = useState(false);
  const [showRowEditor, setShowRowEditor] = useState(false);
  const [showRowCreate, setShowRowCreate] = useState(false);
  const [rowToEdit, setRowToEdit] = useState<any | null>(null);

  // Layout & Split Mode
  const [splitMode, setSplitMode] = useState<'horizontal' | 'vertical' | 'editor-only' | 'results-only'>('horizontal');

  // Query Tabs State (Multi-Query & Multi-Output)
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    {
      id: 'tab-1',
      title: 'Query 1',
      query: 'SELECT * FROM information_schema.tables WHERE table_schema = DATABASE() LIMIT 25;',
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

  // Data Grid State
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

  // Structure & Indexes
  const [structureCols, setStructureCols] = useState<ColumnDefinition[]>([]);
  const [indexes, setIndexes] = useState<IndexItem[]>([]);
  const [foreignKeys, setForeignKeys] = useState<ForeignKeyRelation[]>([]);

  const activeQueryTab = queryTabs.find(t => t.id === activeTabId) || queryTabs[0];

  // ─── 1. Load Databases & MySQL Schema ──────────────────────────────
  const loadDatabases = async () => {
    try {
      const res = await dbExecuteQuery(profile.id, 'SHOW DATABASES;');
      if (res.rows && res.rows.length > 0) {
        setDatabases(res.rows.map((r: any) => r.Database || r.database || Object.values(r)[0]));
      }
    } catch (e) {
      console.warn('MySQL load databases notice:', e);
    }
  };

  const loadMysqlSchema = async () => {
    setIsLoadingSchema(true);
    setGlobalError(null);
    try {
      const targetDb = currentDb || profile.database;
      const objs = await dbListTables(profile.id, targetDb);
      
      const tbls: TableItem[] = [];
      const vws: TableItem[] = [];

      objs.forEach(o => {
        const item: TableItem = {
          name: o.name,
          type: o.object_type === 'view' ? 'view' : 'table',
          schema: targetDb,
        };
        if (o.object_type === 'view') vws.push(item);
        else tbls.push(item);
      });

      // Fallback query if dbListTables was empty
      if (tbls.length === 0 && vws.length === 0) {
        const fallbackRes = await dbExecuteQuery(
          profile.id,
          `SHOW FULL TABLES IN \`${targetDb}\`;`
        );
        if (fallbackRes.rows && fallbackRes.rows.length > 0) {
          fallbackRes.rows.forEach((r: any) => {
            const vals = Object.values(r);
            const name = String(vals[0]);
            const type = String(vals[1] || '').includes('VIEW') ? 'view' : 'table';
            const item: TableItem = { name, type, schema: targetDb };
            if (type === 'view') vws.push(item);
            else tbls.push(item);
          });
        }
      }

      setTables(tbls);
      setViews(vws);

      // Fetch Procedures & Functions from information_schema.routines
      try {
        const procSql = `
          SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type
          FROM information_schema.ROUTINES
          WHERE ROUTINE_SCHEMA = '${targetDb}';
        `;
        const procRes = await dbExecuteQuery(profile.id, procSql);
        if (procRes.rows) {
          setRoutines(procRes.rows.map((r: any) => ({
            name: r.name || r.ROUTINE_NAME,
            type: (r.type || r.ROUTINE_TYPE || '').toLowerCase() === 'procedure' ? 'procedure' : 'function',
          })));
        }
      } catch (e) {
        console.warn('MySQL routines notice:', e);
      }

      // Fetch Triggers from information_schema.triggers
      try {
        const trgSql = `
          SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS table_name
          FROM information_schema.TRIGGERS
          WHERE TRIGGER_SCHEMA = '${targetDb}';
        `;
        const trgRes = await dbExecuteQuery(profile.id, trgSql);
        if (trgRes.rows) {
          setTriggers(trgRes.rows.map((r: any) => ({
            name: r.name || r.TRIGGER_NAME,
            tableName: r.table_name || r.EVENT_OBJECT_TABLE,
          })));
        }
      } catch (e) {
        console.warn('MySQL triggers notice:', e);
      }

      if (tbls.length > 0 && !selectedTable) {
        setSelectedTable(tbls[0].name);
      }
    } catch (err: any) {
      setGlobalError(`Schema Discovery Error: ${err?.message || err}`);
    } finally {
      setIsLoadingSchema(false);
    }
  };

  useEffect(() => {
    loadDatabases();
    loadMysqlSchema();
  }, [profile.id]);

  // ─── 2. Switch Database ───────────────────────────────────────────
  const handleSelectDatabase = async (dbName: string) => {
    setCurrentDb(dbName);
    try {
      await dbExecuteQuery(profile.id, `USE \`${dbName}\`;`);
    } catch {
      // Ignore
    }
    loadMysqlSchema();
  };

  // ─── 3. Load Table Data Grid ──────────────────────────────────────
  const loadTableDataGrid = async (tbl: string) => {
    setSelectedTable(tbl);
    setDataGrid(prev => ({ ...prev, table: tbl, loading: true, error: null }));
    try {
      const q = `SELECT * FROM \`${tbl}\` LIMIT 100;`;
      const res = await dbExecuteQuery(profile.id, q);
      setDataGrid({
        table: tbl,
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
      loadTableStructure(tbl);
    } catch (err: any) {
      setDataGrid(prev => ({ ...prev, loading: false, error: String(err?.message || err) }));
    }
  };

  // ─── 4. Load Structure & Indexes ──────────────────────────────────
  const loadTableStructure = async (tbl: string) => {
    try {
      const cols = await dbGetTableColumns(profile.id, tbl, currentDb || profile.database);
      setStructureCols(cols.map((c: any) => ({
        name: c.name,
        type: c.data_type || c.type || 'varchar',
        nullable: Boolean(c.nullable),
        isPrimaryKey: Boolean(c.is_primary_key || c.primary_key),
        autoIncrement: Boolean(c.extra?.includes('auto_increment') || c.auto_increment),
        defaultValue: c.default_value || undefined,
        extra: c.extra || undefined,
      })));

      // Query Indexes
      const idxSql = `SHOW INDEX FROM \`${tbl}\`;`;
      const idxRes = await dbExecuteQuery(profile.id, idxSql);
      if (idxRes.rows) {
        setIndexes(idxRes.rows.map((r: any) => ({
          name: r.Key_name || r.key_name,
          tableName: tbl,
          columnName: r.Column_name || r.column_name,
          isUnique: (r.Non_unique === 0 || r.non_unique === 0),
          type: r.Index_type || 'BTREE',
        })));
      }
    } catch (e) {
      console.warn('MySQL structure load notice:', e);
    }
  };

  // ─── 5. Tab Management ────────────────────────────────────────────
  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `Query ${queryTabs.length + 1}`,
      query: 'SELECT * FROM information_schema.tables WHERE table_schema = DATABASE() LIMIT 25;',
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
      query: 'SELECT * FROM information_schema.tables WHERE table_schema = DATABASE() LIMIT 25;',
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

  // ─── 6. Execute Query (Selection or Full Buffer) ───────────────────
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
              successInfo: `Executed successfully in ${durationMs}ms (${res.rows?.length || res.affected_rows} rows).`,
              isExecuting: false,
            };
          }
          return t;
        });
      });

      // Auto-reload schema if query was a DDL mutation
      if (/\b(CREATE|ALTER|DROP|RENAME|TRUNCATE)\b/i.test(q)) {
        loadMysqlSchema();
      }
      if (/\b(INSERT|UPDATE|DELETE)\b/i.test(q) && selectedTable) {
        loadTableDataGrid(selectedTable);
      }
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

  // ─── 7. Table Actions: Delete Row, Truncate, Drop, Rename ─────────
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
      await dbExecuteQuery(profile.id, `DELETE FROM \`${selectedTable}\` WHERE \`${pkCol.name}\` = ${whereVal};`);
      loadTableDataGrid(selectedTable);
    } catch (e: any) {
      alert(`Delete Error: ${e?.message || e}`);
    }
  };

  const handleTruncateTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `TRUNCATE TABLE \`${tbl}\`;`);
      loadTableDataGrid(tbl);
    } catch (e: any) {
      alert(`Truncate Error: ${e?.message || e}`);
    }
  };

  const handleDropTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `DROP TABLE IF EXISTS \`${tbl}\`;`);
      loadMysqlSchema();
      if (selectedTable === tbl) setSelectedTable(null);
    } catch (e: any) {
      alert(`Drop Table Error: ${e?.message || e}`);
    }
  };

  const handleDropObject = async (name: string, type: 'table' | 'view' | 'procedure' | 'function' | 'trigger') => {
    try {
      const sql = type === 'procedure'
        ? `DROP PROCEDURE IF EXISTS \`${name}\`;`
        : type === 'function'
        ? `DROP FUNCTION IF EXISTS \`${name}\`;`
        : type === 'trigger'
        ? `DROP TRIGGER IF EXISTS \`${name}\`;`
        : type === 'view'
        ? `DROP VIEW IF EXISTS \`${name}\`;`
        : `DROP TABLE IF EXISTS \`${name}\`;`;
      await dbExecuteQuery(profile.id, sql);
      loadMysqlSchema();
      if (selectedTable === name) setSelectedTable(null);
    } catch (e: any) {
      alert(`Drop ${type} Error: ${e?.message || e}`);
    }
  };

  const handleOpenDefinition = async (name: string, type: 'table' | 'view' | 'procedure' | 'function' | 'trigger') => {
    try {
      let ddl = await dbGetObjectDefinition(profile.id, type, name, currentDb);
      if (!ddl || ddl.trim().length === 0) {
        if (type === 'procedure') {
          ddl = `DELIMITER $$\nCREATE PROCEDURE \`${name}\`()\nBEGIN\n  -- Routine body\n  SELECT 1;\nEND$$\nDELIMITER ;`;
        } else if (type === 'function') {
          ddl = `DELIMITER $$\nCREATE FUNCTION \`${name}\`()\nRETURNS INT\nDETERMINISTIC\nBEGIN\n  RETURN 1;\nEND$$\nDELIMITER ;`;
        } else if (type === 'trigger') {
          ddl = `CREATE TRIGGER \`${name}\`\nAFTER INSERT ON \`${selectedTable || 'table_name'}\`\nFOR EACH ROW\nBEGIN\n  -- Trigger body\nEND;`;
        } else if (type === 'view') {
          ddl = `CREATE OR REPLACE VIEW \`${name}\` AS\nSELECT * FROM \`${selectedTable || 'table_name'}\`;`;
        } else {
          ddl = `-- Definition for ${type} ${name}\nSHOW CREATE ${type.toUpperCase()} \`${name}\`;`;
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

  const handleExecuteRoutine = async (name: string, type: 'procedure' | 'function') => {
    const q = type === 'procedure' ? `CALL \`${name}\`();` : `SELECT \`${name}\`();`;
    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `Call: ${name}`,
      query: q,
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
    handleExecuteQuery(q);
  };

  const handleRenameTable = async (oldName: string, newName: string) => {
    try {
      await dbExecuteQuery(profile.id, `RENAME TABLE \`${oldName}\` TO \`${newName}\`;`);
      loadMysqlSchema();
      if (selectedTable === oldName) setSelectedTable(newName);
    } catch (e: any) {
      alert(`Rename Table Error: ${e?.message || e}`);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e2e] text-[#cdd6f4] select-none overflow-hidden">
      
      {/* Top Studio Bar */}
      <div className="h-11 border-b border-white/10 px-4 flex items-center justify-between bg-[#181825]/90 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold text-xs border border-emerald-500/30">
            MY
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-white tracking-wide">{profile.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono border border-emerald-500/20">
                MySQL / MariaDB
              </span>
              {profile.useSsl && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono border border-blue-500/20 flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  SSL
                </span>
              )}
            </div>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>SQL Editor</span>
          </button>
          <button
            onClick={() => {
              if (selectedTable) loadTableDataGrid(selectedTable);
              setActiveTab('datagrid');
            }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'datagrid' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>Data Grid</span>
          </button>
          <button
            onClick={() => {
              if (selectedTable) loadTableStructure(selectedTable);
              setActiveTab('structure');
            }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'structure' ? 'bg-emerald-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Structure</span>
          </button>
        </div>

        {onDisconnect && (
          <button
            onClick={onDisconnect}
            className="text-xs text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 px-2.5 py-1 rounded-lg border border-transparent hover:border-rose-500/20 transition-colors"
          >
            Disconnect
          </button>
        )}
      </div>

      {/* Main Studio Body: Sidebar + Content Canvas */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Sidebar: SchemaTreeView */}
        <div className="w-64 border-r border-white/10 shrink-0 flex flex-col bg-[#161622]">
          <SchemaTreeView
            engine="mysql"
            activeDatabase={currentDb}
            databases={databases}
            onSelectDatabase={handleSelectDatabase}
            tables={tables}
            views={views}
            procedures={routines.filter(r => r.type === 'procedure')}
            functions={routines.filter(r => r.type === 'function')}
            triggers={triggers}
            selectedTable={selectedTable}
            onSelectTable={(tbl) => setSelectedTable(tbl)}
            onOpenTableData={(tbl) => {
              loadTableDataGrid(tbl);
              setActiveTab('datagrid');
            }}
            onAlterTable={(tbl) => {
              setSelectedTable(tbl);
              loadTableStructure(tbl);
              setShowAlterTable(true);
            }}
            onRenameTable={handleRenameTable}
            onTruncateTable={handleTruncateTable}
            onDropTable={handleDropTable}
            onDropObject={handleDropObject}
            onOpenDefinition={handleOpenDefinition}
            onExecuteRoutine={handleExecuteRoutine}
            onCreateTable={() => setShowCreateTable(true)}
            onGenerateSql={(sql: string) => {
              setQueryTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, query: sql } : t));
              setActiveTab('editor');
            }}
            onRefresh={loadMysqlSchema}
            isLoading={isLoadingSchema}
          />
        </div>

        {/* Center Canvas */}
        <div className="flex-1 flex flex-col overflow-hidden bg-black/5">
          
          {/* VIEW 1: SQL Editor with QueryTabBar + SqlEditorPanel + MultiResultViewer */}
          {activeTab === 'editor' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              
              {/* Tab Bar with Close, Close Right, Close Others, Close All */}
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

              {/* Editor + Results Split Canvas */}
              <div className={`flex-1 flex overflow-hidden ${splitMode === 'vertical' ? 'flex-row' : 'flex-col'}`}>
                
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
                    engine="mysql"
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

          {/* VIEW 2: Dedicated Data Grid */}
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

          {/* VIEW 3: Table Structure & Indexes */}
          {activeTab === 'structure' && (
            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">Table Structure: `{selectedTable}`</h3>
                  <p className="text-xs text-gray-400">{structureCols.length} Columns • {indexes.length} Indexes</p>
                </div>
                <button
                  onClick={() => setShowAlterTable(true)}
                  disabled={!selectedTable}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-md transition-colors"
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
                        <td className="px-3 py-2 text-emerald-400 font-mono">{col.type}</td>
                        <td className="px-3 py-2 text-gray-400">{col.nullable ? 'YES' : 'NO'}</td>
                        <td className="px-3 py-2">
                          {col.isPrimaryKey && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px]">PRI</span>}
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
                          <th className="px-3 py-2">Column</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Constraint</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {indexes.map((idx, i) => (
                          <tr key={i} className="hover:bg-white/5">
                            <td className="px-3 py-2 text-white font-mono">{idx.name}</td>
                            <td className="px-3 py-2 text-emerald-400 font-mono">{idx.columnName}</td>
                            <td className="px-3 py-2 text-gray-400">{idx.type}</td>
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
          engine="mysql"
          connectionId={profile.id}
          database={currentDb}
          onCreated={(newTbl) => {
            loadMysqlSchema();
            loadTableDataGrid(newTbl);
          }}
        />
      )}

      {showAlterTable && selectedTable && (
        <AlterTableModal
          isOpen={showAlterTable}
          onClose={() => setShowAlterTable(false)}
          engine="mysql"
          connectionId={profile.id}
          tableName={selectedTable}
          database={currentDb}
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
          engine="mysql"
          tableName={selectedTable}
          columns={structureCols}
          connectionId={profile.id}
          database={currentDb}
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
          engine="mysql"
          connectionId={profile.id}
          tableName={selectedTable}
          database={currentDb}
          columns={structureCols}
          initialRow={rowToEdit}
          onSaved={() => loadTableDataGrid(selectedTable)}
        />
      )}

    </div>
  );
};

export default MysqlStudio;
