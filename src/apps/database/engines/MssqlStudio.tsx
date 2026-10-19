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

interface MssqlStudioProps {
  profile: DbConnectionProfile;
  onDisconnect?: () => void;
}

export const MssqlStudio: React.FC<MssqlStudioProps> = ({ profile, onDisconnect }) => {
  const [activeTab, setActiveTab] = useState<'editor' | 'datagrid' | 'structure'>('editor');

  // Database Selector
  const [databases, setDatabases] = useState<string[]>([]);
  const [currentDb, setCurrentDb] = useState<string>(profile.database || 'master');

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
      query: 'SELECT TOP 25 * FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME;',
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

  // Structure & Indexes
  const [structureCols, setStructureCols] = useState<ColumnDefinition[]>([]);
  const [indexes, setIndexes] = useState<IndexItem[]>([]);

  const activeQueryTab = queryTabs.find(t => t.id === activeTabId) || queryTabs[0];

  // ─── 1. Load Databases & MSSQL Schema ──────────────────────────────
  const loadDatabases = async () => {
    try {
      const res = await dbExecuteQuery(profile.id, 'SELECT name FROM sys.databases WHERE state_desc = \'ONLINE\' ORDER BY name;');
      if (res.rows && res.rows.length > 0) {
        setDatabases(res.rows.map((r: any) => r.name || Object.values(r)[0]));
      }
    } catch (e) {
      console.warn('MSSQL load databases notice:', e);
    }
  };

  const loadMssqlSchema = async () => {
    setIsLoadingSchema(true);
    setGlobalError(null);
    try {
      const targetDb = currentDb || profile.database || 'master';
      const objs = await dbListTables(profile.id, targetDb);
      const tbls: TableItem[] = [];
      const vws: TableItem[] = [];

      objs.forEach(o => {
        const item: TableItem = {
          name: o.name,
          type: o.object_type === 'view' ? 'view' : 'table',
          schema: o.schema || 'dbo',
        };
        if (o.object_type === 'view') vws.push(item);
        else tbls.push(item);
      });

      // Fallback query if dbListTables was empty
      if (tbls.length === 0 && vws.length === 0) {
        const fallbackRes = await dbExecuteQuery(
          profile.id,
          `SELECT TABLE_NAME, TABLE_TYPE, TABLE_SCHEMA FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME;`
        );
        if (fallbackRes.rows && fallbackRes.rows.length > 0) {
          fallbackRes.rows.forEach((r: any) => {
            const name = r.TABLE_NAME || Object.values(r)[0];
            const typeStr = String(r.TABLE_TYPE || '');
            const type = typeStr.includes('VIEW') ? 'view' : 'table';
            const schema = r.TABLE_SCHEMA || 'dbo';
            const item: TableItem = { name: String(name), type, schema };
            if (type === 'view') vws.push(item);
            else tbls.push(item);
          });
        }
      }

      setTables(tbls);
      setViews(vws);

      // Routines from INFORMATION_SCHEMA.ROUTINES
      try {
        const procRes = await dbExecuteQuery(
          profile.id,
          "SELECT ROUTINE_NAME as name, ROUTINE_TYPE as type FROM INFORMATION_SCHEMA.ROUTINES ORDER BY ROUTINE_NAME;"
        );
        if (procRes.rows) {
          setRoutines(procRes.rows.map((r: any) => ({
            name: r.name || r.ROUTINE_NAME,
            type: (r.type || r.ROUTINE_TYPE || '').toLowerCase().includes('func') ? 'function' : 'procedure',
          })));
        }
      } catch (e) {
        console.warn('MSSQL routines notice:', e);
      }

      // Triggers from sys.triggers
      try {
        const trgRes = await dbExecuteQuery(
          profile.id,
          "SELECT t.name, OBJECT_NAME(t.parent_id) as table_name FROM sys.triggers t WHERE t.is_ms_shipped = 0 ORDER BY t.name;"
        );
        if (trgRes.rows) {
          setTriggers(trgRes.rows.map((r: any) => ({
            name: r.name,
            tableName: r.table_name || '',
          })));
        }
      } catch (e) {
        console.warn('MSSQL triggers notice:', e);
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
    loadMssqlSchema();
  }, [profile.id]);

  // ─── 2. Switch Database ───────────────────────────────────────────
  const handleSelectDatabase = async (dbName: string) => {
    setCurrentDb(dbName);
    try {
      await dbExecuteQuery(profile.id, `USE [${dbName}];`);
    } catch {
      // Ignore
    }
    loadMssqlSchema();
  };

  // ─── 3. Load Table Data Grid ──────────────────────────────────────
  const loadTableDataGrid = async (tbl: string) => {
    setSelectedTable(tbl);
    setDataGrid(prev => ({ ...prev, table: tbl, loading: true, error: null }));
    try {
      const q = `SELECT TOP 100 * FROM [${tbl}];`;
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
        extra: c.auto_increment ? 'IDENTITY' : undefined,
      })));

      // Query Indexes
      const idxSql = `
        SELECT 
          i.name as index_name,
          c.name as column_name,
          i.is_unique,
          i.type_desc
        FROM sys.indexes i
        INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
        INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
        WHERE i.object_id = OBJECT_ID('${tbl}') AND i.is_hypothetical = 0
        ORDER BY i.name, ic.key_ordinal;
      `;
      const idxRes = await dbExecuteQuery(profile.id, idxSql);
      if (idxRes.rows) {
        setIndexes(idxRes.rows.map((r: any) => ({
          name: r.index_name || r.name,
          tableName: tbl,
          columnName: r.column_name,
          isUnique: Boolean(r.is_unique),
          type: r.type_desc || 'NONCLUSTERED',
        })));
      }
    } catch (e) {
      console.warn('MSSQL structure load notice:', e);
    }
  };

  // ─── 5. Tab Management ────────────────────────────────────────────
  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `Query ${queryTabs.length + 1}`,
      query: 'SELECT TOP 25 * FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME;',
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
      query: 'SELECT TOP 25 * FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME;',
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
      await dbExecuteQuery(profile.id, `DELETE FROM [${selectedTable}] WHERE [${pkCol.name}] = ${whereVal};`);
      loadTableDataGrid(selectedTable);
    } catch (e: any) {
      alert(`Delete Error: ${e?.message || e}`);
    }
  };

  const handleTruncateTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `TRUNCATE TABLE [${tbl}];`);
      loadTableDataGrid(tbl);
    } catch (e: any) {
      alert(`Truncate Error: ${e?.message || e}`);
    }
  };

  const handleDropTable = async (tbl: string) => {
    try {
      await dbExecuteQuery(profile.id, `DROP TABLE IF EXISTS [${tbl}];`);
      loadMssqlSchema();
      if (selectedTable === tbl) setSelectedTable(null);
    } catch (e: any) {
      alert(`Drop Error: ${e?.message || e}`);
    }
  };

  const handleRenameTable = async (tbl: string) => {
    const newName = prompt(`Enter new name for table [${tbl}]:`, tbl);
    if (!newName || newName === tbl) return;
    try {
      await dbExecuteQuery(profile.id, `EXEC sp_rename '${tbl}', '${newName}';`);
      loadMssqlSchema();
      if (selectedTable === tbl) setSelectedTable(newName);
    } catch (e: any) {
      alert(`Rename Error: ${e?.message || e}`);
    }
  };

  const handleGenerateSql = (type: 'SELECT' | 'INSERT', tbl: string) => {
    const cols = structureCols.map(c => `[${c.name}]`).join(', ') || '*';
    let sql = '';
    if (type === 'SELECT') {
      sql = `SELECT TOP 100 ${cols} FROM [${tbl}];`;
    } else {
      const placeholders = structureCols.map(c => `@${c.name}`).join(', ');
      sql = `INSERT INTO [${tbl}] (${cols})\nVALUES (${placeholders});`;
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
        if (type === 'procedure') {
          ddl = `CREATE OR ALTER PROCEDURE [dbo].[${name}]\nAS\nBEGIN\n  SET NOCOUNT ON;\n  -- Routine body\nEND;`;
        } else if (type === 'function') {
          ddl = `CREATE OR ALTER FUNCTION [dbo].[${name}]()\nRETURNS INT\nAS\nBEGIN\n  RETURN 1;\nEND;`;
        } else if (type === 'trigger') {
          ddl = `CREATE OR ALTER TRIGGER [${name}]\nON [dbo].[${selectedTable || 'table_name'}]\nAFTER INSERT\nAS\nBEGIN\n  -- Trigger body\nEND;`;
        } else if (type === 'view') {
          ddl = `CREATE OR ALTER VIEW [dbo].[${name}]\nAS\nSELECT * FROM [dbo].[${selectedTable || 'table_name'}];`;
        } else {
          ddl = `sp_helptext '${name}';`;
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
      {/* Top Header */}
      <div className="h-11 border-b border-white/10 px-4 flex items-center justify-between bg-black/20 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center font-bold text-sm shadow-inner border border-red-500/30">
            🗄️
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white tracking-wide">{profile.name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-red-500/10 text-red-400 border border-red-500/20">
              Microsoft SQL Server
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
              <Shield className="w-2.5 h-2.5" /> TDS Handshake OK
            </span>
            <span className="text-xs text-gray-500">•</span>
            <span className="text-xs text-gray-400 font-mono">
              Database: <span className="text-red-300 font-semibold">{currentDb}</span>
            </span>
          </div>
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
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
              activeTab === 'datagrid' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
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
              activeTab === 'structure' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Structure</span>
          </button>
        </div>

        {/* Connection Action */}
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

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar: Reusable SchemaTreeView */}
        <div className="w-64 border-r border-white/10 flex flex-col bg-black/10 shrink-0">
          <SchemaTreeView
            engine="mssql"
            databases={databases}
            currentDb={currentDb}
            tables={tables}
            views={views}
            routines={routines}
            triggers={triggers}
            selectedTable={selectedTable}
            isLoading={isLoadingSchema}
            onSelectDatabase={handleSelectDatabase}
            onSelectTable={(tbl) => {
              loadTableDataGrid(tbl);
              setActiveTab('datagrid');
            }}
            onCreateTable={() => setShowCreateTable(true)}
            onRefresh={loadMssqlSchema}
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

        {/* Right Main Area */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#181825]">
          {/* VIEW 1: SQL Studio */}
          {activeTab === 'editor' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Tab Bar */}
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

              {/* Editor + Results Split */}
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
                    engine="mssql"
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
                  <h3 className="text-base font-semibold text-white">Table Structure: [{selectedTable}]</h3>
                  <p className="text-xs text-gray-400">{structureCols.length} Columns • {indexes.length} Indexes</p>
                </div>
                <button
                  onClick={() => setShowAlterTable(true)}
                  disabled={!selectedTable}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-red-600 hover:bg-red-500 text-white flex items-center gap-1.5 shadow-md transition-colors"
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
                        <td className="px-3 py-2 text-red-400 font-mono">{col.type}</td>
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
                          <th className="px-3 py-2">Column</th>
                          <th className="px-3 py-2">Type</th>
                          <th className="px-3 py-2">Constraint</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {indexes.map((idx, i) => (
                          <tr key={i} className="hover:bg-white/5">
                            <td className="px-3 py-2 text-white font-mono">{idx.name}</td>
                            <td className="px-3 py-2 text-red-400 font-mono">{idx.columnName}</td>
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
          engine="mssql"
          connectionId={profile.id}
          database={currentDb}
          schema={profile.schema || 'dbo'}
          onCreated={(newTbl) => {
            loadMssqlSchema();
            loadTableDataGrid(newTbl);
          }}
        />
      )}

      {showAlterTable && selectedTable && (
        <AlterTableModal
          isOpen={showAlterTable}
          onClose={() => setShowAlterTable(false)}
          engine="mssql"
          connectionId={profile.id}
          tableName={selectedTable}
          database={currentDb}
          schema={profile.schema || 'dbo'}
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
          engine="mssql"
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
          engine="mssql"
          connectionId={profile.id}
          tableName={selectedTable}
          database={currentDb}
          schema={profile.schema || 'dbo'}
          columns={structureCols}
          initialRow={rowToEdit}
          onSaved={() => loadTableDataGrid(selectedTable)}
        />
      )}
    </div>
  );
};

export default MssqlStudio;
