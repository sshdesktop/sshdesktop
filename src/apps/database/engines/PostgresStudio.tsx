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
  Columns,
  Eye,
  Cpu
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

interface PostgresStudioProps {
  profile: DbConnectionProfile;
  onDisconnect?: () => void;
}

export const PostgresStudio: React.FC<PostgresStudioProps> = ({ profile, onDisconnect }) => {
  // Navigation & Views
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
  const [showRowCreate, setShowRowCreate] = useState(false);
  const [showRowEditor, setShowRowEditor] = useState(false);
  const [rowToEdit, setRowToEdit] = useState<any | null>(null);

  // Layout & Split Mode
  const [splitMode, setSplitMode] = useState<'horizontal' | 'vertical' | 'editor-only' | 'results-only'>('horizontal');

  // Query Tabs State (Multi-Query & Multi-Output)
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    {
      id: 'tab-1',
      title: 'Query 1',
      query: 'SELECT * FROM information_schema.tables WHERE table_schema = \'public\' LIMIT 25;',
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

  // Data Grid State (for Dedicated Data Grid view)
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

  // ─── 1. Load Databases & Robust Schema for PostgreSQL ─────────────
  const loadDatabases = async () => {
    try {
      const res = await dbExecuteQuery(profile.id, 'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;');
      if (res.rows && res.rows.length > 0) {
        setDatabases(res.rows.map((r: any) => r.datname || r.DATNAME));
      }
    } catch (e) {
      console.warn('Postgres load databases notice:', e);
    }
  };

  const loadPostgresSchema = async () => {
    setIsLoadingSchema(true);
    setGlobalError(null);
    try {
      const schemaName = profile.schema || 'public';
      const objs = await dbListTables(profile.id, schemaName);
      
      const tbls: TableItem[] = [];
      const vws: TableItem[] = [];

      objs.forEach(o => {
        const item: TableItem = {
          name: o.name,
          type: o.object_type === 'view' ? 'view' : 'table',
          schema: o.schema || schemaName,
        };
        if (o.object_type === 'view') vws.push(item);
        else tbls.push(item);
      });

      // Fallback query if information_schema was empty
      if (tbls.length === 0 && vws.length === 0) {
        const fallbackRes = await dbExecuteQuery(
          profile.id,
          `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = '${schemaName}' OR table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_name;`
        );
        if (fallbackRes.rows && fallbackRes.rows.length > 0) {
          fallbackRes.rows.forEach((r: any) => {
            const name = r.table_name || r.TABLE_NAME;
            const type = (r.table_type || r.TABLE_TYPE || '').includes('VIEW') ? 'view' : 'table';
            const item: TableItem = { name, type, schema: schemaName };
            if (type === 'view') vws.push(item);
            else tbls.push(item);
          });
        }
      }

      setTables(tbls);
      setViews(vws);

      // Fetch Stored Procedures & Functions from pg_proc
      try {
        const procSql = `
          SELECT p.proname AS name,
                 CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END AS type
          FROM pg_proc p
          JOIN pg_namespace n ON p.pronamespace = n.oid
          WHERE n.nspname = '${schemaName}' OR (n.nspname NOT IN ('pg_catalog', 'information_schema') AND NOT p.proisagg)
          ORDER BY p.proname;
        `;
        const procRes = await dbExecuteQuery(profile.id, procSql);
        if (procRes.rows) {
          setRoutines(procRes.rows.map((r: any) => ({
            name: r.name || r.proname,
            type: r.type === 'procedure' ? 'procedure' : 'function',
          })));
        }
      } catch (e) {
        console.warn('Postgres routines notice:', e);
      }

      // Fetch Triggers from pg_trigger
      try {
        const trgSql = `
          SELECT tgname AS name, relname AS table_name
          FROM pg_trigger t
          JOIN pg_class c ON t.tgrelid = c.oid
          JOIN pg_namespace n ON c.relnamespace = n.oid
          WHERE NOT t.tgisinternal AND (n.nspname = '${schemaName}' OR n.nspname NOT IN ('pg_catalog', 'information_schema'))
          ORDER BY tgname;
        `;
        const trgRes = await dbExecuteQuery(profile.id, trgSql);
        if (trgRes.rows) {
          setTriggers(trgRes.rows.map((r: any) => ({
            name: r.name || r.tgname,
            tableName: r.table_name || r.relname,
          })));
        }
      } catch (e) {
        console.warn('Postgres triggers notice:', e);
      }

      // Fetch Foreign Keys
      try {
        const fkSql = `
          SELECT tc.table_name AS "tableName", kcu.column_name AS "columnName",
                 ccu.table_name AS "foreignTableName", ccu.column_name AS "foreignColumnName",
                 tc.constraint_name AS "constraintName"
          FROM information_schema.table_constraints AS tc
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = '${schemaName}';
        `;
        const fkRes = await dbExecuteQuery(profile.id, fkSql);
        if (fkRes.rows) {
          setForeignKeys(fkRes.rows.map((r: any) => ({
            tableName: r.tableName || r.table_name,
            columnName: r.columnName || r.column_name,
            foreignTableName: r.foreignTableName || r.foreign_table_name,
            foreignColumnName: r.foreignColumnName || r.foreign_column_name,
            constraintName: r.constraintName || r.constraint_name,
          })));
        }
      } catch (e) {
        console.warn('Postgres FK notice:', e);
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
    loadPostgresSchema();
  }, [profile.id]);

  // ─── 2. Switch Database ───────────────────────────────────────────
  const handleSelectDatabase = async (dbName: string) => {
    setCurrentDb(dbName);
    try {
      await dbExecuteQuery(profile.id, `\\c "${dbName}"`);
    } catch {
      // Ignore if \c not supported over pool
    }
    loadPostgresSchema();
  };

  // ─── 3. Load Table Data Grid ──────────────────────────────────────
  const loadTableDataGrid = async (tbl: string) => {
    setSelectedTable(tbl);
    setDataGrid(prev => ({ ...prev, table: tbl, loading: true, error: null }));
    try {
      const q = `SELECT * FROM "${tbl}" LIMIT 100;`;
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
      const cols = await dbGetTableColumns(profile.id, tbl, profile.schema || 'public');
      setStructureCols(cols.map((c: any) => ({
        name: c.name,
        type: c.data_type || c.type || 'text',
        nullable: Boolean(c.nullable),
        isPrimaryKey: Boolean(c.is_primary_key || c.primary_key),
        autoIncrement: Boolean(c.extra?.includes('auto_increment') || c.auto_increment),
        defaultValue: c.default_value || undefined,
        extra: c.extra || undefined,
      })));

      // Query Indexes
      const idxSql = `
        SELECT indexname AS name, indexdef AS def
        FROM pg_indexes
        WHERE tablename = '${tbl}' AND (schemaname = '${profile.schema || 'public'}' OR schemaname NOT IN ('pg_catalog', 'information_schema'));
      `;
      const idxRes = await dbExecuteQuery(profile.id, idxSql);
      if (idxRes.rows) {
        setIndexes(idxRes.rows.map((r: any) => ({
          name: r.name || r.indexname,
          tableName: tbl,
          columnName: r.def || '',
          isUnique: (r.def || '').toUpperCase().includes('UNIQUE'),
          type: 'BTREE',
        })));
      }
    } catch (e) {
      console.warn('Structure load notice:', e);
    }
  };

  // ─── 5. Tab Management ────────────────────────────────────────────
  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `Query ${queryTabs.length + 1}`,
      query: 'SELECT * FROM information_schema.tables WHERE table_schema = \'public\' LIMIT 25;',
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
      query: 'SELECT * FROM information_schema.tables WHERE table_schema = \'public\' LIMIT 25;',
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

      setQueryTabs(prev => prev.map(t => {
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
      }));

      // Auto-reload schema if query was a DDL mutation
      if (/\b(CREATE|ALTER|DROP|RENAME|TRUNCATE)\b/i.test(q)) {
        loadPostgresSchema();
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
      alert('Cannot delete row: no primary key identified.');
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
      await dbExecuteQuery(profile.id, `TRUNCATE TABLE "${tbl}" CASCADE;`);
      loadTableDataGrid(tbl);
    } catch (e: any) {
      alert(`Truncate Error: ${e?.message || e}`);
    }
  };

  const handleDropTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `DROP TABLE IF EXISTS "${tbl}" CASCADE;`);
      loadPostgresSchema();
      if (selectedTable === tbl) setSelectedTable(null);
    } catch (e: any) {
      alert(`Drop Table Error: ${e?.message || e}`);
    }
  };

  const handleDropObject = async (name: string, type: 'table' | 'view' | 'procedure' | 'function' | 'trigger') => {
    try {
      const sql = type === 'procedure'
        ? `DROP PROCEDURE IF EXISTS "${name}" CASCADE;`
        : type === 'function'
        ? `DROP FUNCTION IF EXISTS "${name}" CASCADE;`
        : type === 'trigger'
        ? `DROP TRIGGER IF EXISTS "${name}" ON "${selectedTable || 'table_name'}" CASCADE;`
        : type === 'view'
        ? `DROP VIEW IF EXISTS "${name}" CASCADE;`
        : `DROP TABLE IF EXISTS "${name}" CASCADE;`;
      await dbExecuteQuery(profile.id, sql);
      loadPostgresSchema();
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
          ddl = `CREATE OR REPLACE PROCEDURE "${name}"()\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  -- Routine body\nEND;\n$$;`;
        } else if (type === 'function') {
          ddl = `CREATE OR REPLACE FUNCTION "${name}"()\nRETURNS integer\nLANGUAGE plpgsql\nAS $$\nBEGIN\n  RETURN 1;\nEND;\n$$;`;
        } else if (type === 'trigger') {
          ddl = `CREATE OR REPLACE TRIGGER "${name}"\nAFTER INSERT ON "${selectedTable || 'table_name'}"\nFOR EACH ROW\nEXECUTE FUNCTION trigger_function();`;
        } else if (type === 'view') {
          ddl = `CREATE OR REPLACE VIEW "${name}" AS\nSELECT * FROM "${selectedTable || 'table_name'}";`;
        } else {
          ddl = `-- Definition for ${type} ${name}\nSELECT pg_get_viewdef('"${name}"'::regclass, true);`;
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
    const q = type === 'procedure' ? `CALL "${name}"();` : `SELECT "${name}"();`;
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
      await dbExecuteQuery(profile.id, `ALTER TABLE "${oldName}" RENAME TO "${newName}";`);
      loadPostgresSchema();
      if (selectedTable === oldName) setSelectedTable(newName);
    } catch (e: any) {
      alert(`Rename Table Error: ${e?.message || e}`);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e2e] text-[#cdd6f4] select-none overflow-hidden">
      
      {/* Top Studio Bar */}
      <div className="h-11 border-b border-white/10 px-4 flex items-center justify-between bg-[#181825]/90 backdrop-blur-md shrink-0 overflow-x-auto no-scrollbar gap-2">
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold text-xs border border-blue-500/30">
            PG
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs text-white tracking-wide">{profile.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-mono border border-blue-500/20">
                PostgreSQL
              </span>
              {profile.useSsl && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono border border-emerald-500/20 flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  SSL
                </span>
              )}
            </div>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1 bg-black/40 p-1 rounded-xl border border-white/10 shrink-0">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
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
              activeTab === 'datagrid' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
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
              activeTab === 'structure' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Structure</span>
          </button>
          <button
            onClick={() => setActiveTab('er')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'er' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>ER Diagram</span>
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
        
        {/* Left Sidebar: Unified SchemaTreeView */}
        <div className="w-64 border-r border-white/10 shrink-0 flex flex-col bg-[#161622]">
          <SchemaTreeView
            engine="postgresql"
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
            onRefresh={loadPostgresSchema}
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
                
                {/* Editor Panel (Zoom, Wrap, Minimap, IntelliSense, Selection Execution) */}
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
                    engine="postgresql"
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
                  <h3 className="text-base font-semibold text-white">Table Structure: {selectedTable}</h3>
                  <p className="text-xs text-gray-400">{structureCols.length} Columns • {indexes.length} Indexes</p>
                </div>
                <button
                  onClick={() => setShowAlterTable(true)}
                  disabled={!selectedTable}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 shadow-md transition-colors"
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
                        <td className="px-3 py-2 font-bold text-white">{col.name}</td>
                        <td className="px-3 py-2 text-blue-400">{col.type}</td>
                        <td className="px-3 py-2 text-gray-400">{col.nullable ? 'YES' : 'NO'}</td>
                        <td className="px-3 py-2">
                          {col.isPrimaryKey && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[10px]">PK</span>}
                          {col.autoIncrement && <span className="ml-1 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px]">SERIAL</span>}
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
                          <th className="px-3 py-2">Columns</th>
                          <th className="px-3 py-2">Unique</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {indexes.map(idx => (
                          <tr key={idx.name} className="hover:bg-white/5">
                            <td className="px-3 py-2 text-white">{idx.name}</td>
                            <td className="px-3 py-2 text-purple-400">{idx.columnName || '—'}</td>
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

          {/* VIEW 4: ER Diagram */}
          {activeTab === 'er' && (
            <div className="flex-1 flex flex-col overflow-auto p-6 bg-black/20">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">PostgreSQL Entity Relationship (ER) Diagram</h3>
                  <p className="text-xs text-gray-400">{tables.length} Tables • {foreignKeys.length} Relationships</p>
                </div>
              </div>

              <div className="flex-1 flex flex-wrap gap-6 items-start">
                {tables.map(tbl => (
                  <div key={tbl.name} className="w-64 rounded-xl border border-white/10 bg-[#1e1e2e] shadow-xl overflow-hidden font-mono text-xs">
                    <div className="px-3 py-2 bg-blue-600/20 border-b border-blue-500/30 flex items-center justify-between text-white font-bold">
                      <div className="flex items-center gap-1.5 truncate">
                        <Table className="w-3.5 h-3.5 text-blue-400" />
                        <span className="truncate">{tbl.name}</span>
                      </div>
                    </div>
                    <div className="p-2 space-y-1 max-h-48 overflow-y-auto">
                      {(tbl.columns && tbl.columns.length > 0) ? (
                        tbl.columns.map(c => (
                          <div key={c.name} className="flex items-center justify-between text-[11px] py-0.5 text-gray-300">
                            <span className="truncate">{c.name}</span>
                            <span className="text-[10px] text-gray-500">{c.type}</span>
                          </div>
                        ))
                      ) : (
                        <div
                          onClick={() => loadTableStructure(tbl.name)}
                          className="text-[10px] text-blue-400 hover:underline cursor-pointer italic text-center py-2"
                        >
                          Click to load columns
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* Modals */}
      {showCreateTable && (
        <CreateTableModal
          isOpen={showCreateTable}
          onClose={() => setShowCreateTable(false)}
          engine="postgresql"
          connectionId={profile.id}
          database={currentDb}
          schema={profile.schema || 'public'}
          onCreated={(newTbl) => {
            loadPostgresSchema();
            loadTableDataGrid(newTbl);
          }}
        />
      )}

      {showAlterTable && selectedTable && (
        <AlterTableModal
          isOpen={showAlterTable}
          onClose={() => setShowAlterTable(false)}
          engine="postgresql"
          connectionId={profile.id}
          tableName={selectedTable}
          database={currentDb}
          schema={profile.schema || 'public'}
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
          engine="postgresql"
          connectionId={profile.id}
          tableName={selectedTable}
          database={currentDb}
          columns={structureCols}
          onSuccess={() => loadTableDataGrid(selectedTable)}
        />
      )}

      {showRowEditor && selectedTable && (
        <RowEditorModal
          isOpen={showRowEditor}
          onClose={() => setShowRowEditor(false)}
          engine="postgresql"
          connectionId={profile.id}
          tableName={selectedTable}
          database={currentDb}
          schema={profile.schema || 'public'}
          columns={structureCols}
          initialRow={rowToEdit}
          onSaved={() => loadTableDataGrid(selectedTable)}
        />
      )}

    </div>
  );
};

export default PostgresStudio;
