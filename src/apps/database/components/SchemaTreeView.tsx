import React, { useState, useEffect } from 'react';
import { 
  Database, 
  Table, 
  Eye, 
  Cpu, 
  Zap, 
  Layers, 
  ChevronRight, 
  ChevronDown, 
  Search, 
  RefreshCw, 
  Plus, 
  Sliders, 
  Trash2, 
  Edit3, 
  Copy, 
  Code, 
  FileText, 
  Check, 
  AlertTriangle,
  FolderTree,
  ChevronDown as DropdownIcon
} from 'lucide-react';
import { TableItem, RoutineItem, TriggerItem, DbEngine } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { PortalContextMenu } from '../../../components/PortalContextMenu';

interface SchemaTreeViewProps {
  engine?: DbEngine;
  activeDatabase?: string;
  currentDb?: string;
  databases?: string[];
  onSelectDatabase?: (dbName: string) => void;
  tables: TableItem[];
  views?: TableItem[];
  routines?: RoutineItem[];
  procedures?: RoutineItem[];
  functions?: RoutineItem[];
  triggers?: TriggerItem[];
  selectedTable: string | null;
  onSelectTable: (tableName: string) => void;
  onOpenTableData?: (tableName: string) => void;
  onOpenDefinition?: (name: string, objectType: 'table' | 'view' | 'procedure' | 'function' | 'trigger') => void;
  onExecuteRoutine?: (name: string, type: 'procedure' | 'function') => void;
  onAlterTable?: (tableName: string) => void;
  onRenameTable?: ((oldName: string, newName: string) => void) | ((tbl: string) => void);
  onTruncateTable?: (tableName: string) => void;
  onDropTable?: (tableName: string) => void;
  onDropObject?: (name: string, objectType: 'table' | 'view' | 'procedure' | 'function' | 'trigger') => void;
  onCreateTable?: () => void;
  onCopyName?: (name: string) => void;
  onGenerateSql?: ((type: 'SELECT' | 'INSERT', tbl: string) => void) | ((sql: string) => void);
  onRefresh?: () => void;
  isLoading?: boolean;
}

export const SchemaTreeView: React.FC<SchemaTreeViewProps> = ({
  engine = 'postgresql',
  activeDatabase,
  currentDb,
  databases = [],
  onSelectDatabase,
  tables,
  views = [],
  routines = [],
  procedures = [],
  functions = [],
  triggers = [],
  selectedTable,
  onSelectTable,
  onOpenTableData,
  onOpenDefinition,
  onExecuteRoutine,
  onAlterTable,
  onRenameTable,
  onTruncateTable,
  onDropTable,
  onDropObject,
  onCreateTable,
  onCopyName,
  onGenerateSql,
  onRefresh,
  isLoading = false,
}) => {
  const [filterText, setFilterText] = useState('');
  const activeDb = currentDb || activeDatabase || 'default';
  
  // Section Collapse State
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    tables: true,
    views: true,
    procedures: true,
    functions: true,
    triggers: true,
  });

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    tableName: string;
    objectType: 'table' | 'view' | 'procedure' | 'function' | 'trigger';
    x: number;
    y: number;
  } | null>(null);

  // Destructive Actions Confirm Modals
  const [dropTarget, setDropTarget] = useState<{
    name: string;
    objectType: 'table' | 'view' | 'procedure' | 'function' | 'trigger';
  } | null>(null);
  const [truncateTarget, setTruncateTarget] = useState<string | null>(null);

  // Rename Inline Prompt State
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const [newTableName, setNewTableName] = useState('');

  // Close context menu on outside click
  useEffect(() => {
    const handleGlobalClick = () => setContextMenu(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    tableName: string,
    objectType: 'table' | 'view' | 'procedure' | 'function' | 'trigger' = 'table'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectTable(tableName);
    setContextMenu({
      tableName,
      objectType,
      x: e.clientX,
      y: e.clientY,
    });
  };

  // Keyboard navigation on tree items
  const handleKeyDown = (e: React.KeyboardEvent, tableName: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (onOpenTableData) onOpenTableData(tableName);
      else onSelectTable(tableName);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      setDropTarget({ name: tableName, objectType: 'table' });
    }
  };

  // Filter items
  const filterItem = (name: string) => {
    if (!filterText.trim()) return true;
    return name.toLowerCase().includes(filterText.toLowerCase());
  };

  const safeDatabases = (databases || []).map((d) => {
    if (typeof d === 'string') return d;
    if (d && typeof d === 'object') return (d as any).name || (d as any).databaseName || String(d);
    return String(d || '');
  }).filter(Boolean);

  const safeTables = (tables || []).map(t => typeof t === 'string' ? { name: t, type: 'table' as const } : t).filter(t => t && t.name);
  const safeViews = (views || []).map(v => typeof v === 'string' ? { name: v, type: 'view' as const } : v).filter(v => v && v.name);
  const rawRoutines = Array.isArray(routines) ? routines : [];
  const rawProcs = Array.isArray(procedures) && procedures.length > 0 ? procedures : rawRoutines.filter(r => r.type === 'procedure');
  const rawFuncs = Array.isArray(functions) && functions.length > 0 ? functions : rawRoutines.filter(r => r.type === 'function');
  const safeProcs = rawProcs.map(p => typeof p === 'string' ? { name: p, type: 'procedure' as const } : p).filter(p => p && p.name);
  const safeFuncs = rawFuncs.map(f => typeof f === 'string' ? { name: f, type: 'function' as const } : f).filter(f => f && f.name);
  const safeTriggers = (triggers || []).map(tr => typeof tr === 'string' ? { name: tr, table: '', timing: '', event: '' } : tr).filter(tr => tr && tr.name);

  const filteredTables = safeTables.filter((t) => filterItem(t.name));
  const filteredViews = safeViews.filter((v) => filterItem(v.name));
  const filteredProcs = safeProcs.filter((p) => filterItem(p.name));
  const filteredFuncs = safeFuncs.filter((f) => filterItem(f.name));
  const filteredTriggers = safeTriggers.filter((tr) => filterItem(tr.name));

  // SQL Generator Helpers
  const generateSelectSql = (tbl: string) => {
    const quote = ['mysql', 'mariadb'].includes(engine) ? '`' : '"';
    return `SELECT * FROM ${quote}${tbl}${quote} LIMIT 100;`;
  };

  const generateInsertSql = (tbl: string) => {
    const quote = ['mysql', 'mariadb'].includes(engine) ? '`' : '"';
    return `INSERT INTO ${quote}${tbl}${quote} DEFAULT VALUES;`;
  };

  const generateDropSql = (tbl: string) => {
    const quote = ['mysql', 'mariadb'].includes(engine) ? '`' : '"';
    return `DROP TABLE IF EXISTS ${quote}${tbl}${quote};`;
  };

  return (
    <div className="flex flex-col h-full w-full select-none text-xs bg-[#161622] border-r border-white/10">
      
      {/* 1. Database Selector / Header */}
      <div className="p-3 border-b border-white/10 bg-black/20 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-blue-400" />
            Database / Catalog
          </span>
          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-1 hover:text-white hover:bg-white/10 rounded transition-colors text-gray-400 disabled:opacity-40"
              title="Refresh Schema Tree"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
          )}
        </div>

        {/* Database Dropdown Selector */}
        {safeDatabases.length > 0 && onSelectDatabase ? (
          <div className="relative">
            <select
              value={activeDb}
              onChange={(e) => onSelectDatabase(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-2.5 py-1.5 text-xs text-white font-mono focus:border-blue-500/50 focus:outline-none appearance-none cursor-pointer pr-8 truncate"
            >
              {safeDatabases.map((db, idx) => (
                <option key={`${db}-${idx}`} value={db} className="bg-[#1e1e2e] text-white">
                  {db}
                </option>
              ))}
            </select>
            <DropdownIcon className="w-3.5 h-3.5 text-gray-400 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>
        ) : (
          <div className="px-2.5 py-1.5 bg-black/30 border border-white/10 rounded-xl text-xs font-mono text-emerald-400 truncate flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="truncate">{activeDb}</span>
          </div>
        )}

        {/* Search Filter */}
        <div className="relative">
          <Search className="w-3 h-3 text-gray-500 absolute left-2.5 top-2" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter tables, views..."
            className="w-full bg-black/30 border border-white/10 rounded-lg pl-7 pr-2.5 py-1 text-[11px] text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 font-mono"
          />
        </div>
      </div>

      {/* 2. Tree Content with Straight Indentation Guide Lines */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3 font-mono">
        
        {/* SECTION: TABLES */}
        <div>
          <button
            onClick={() => toggleSection('tables')}
            className="w-full flex items-center justify-between px-2 py-1 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors group"
          >
            <div className="flex items-center gap-1.5">
              {openSections.tables ? (
                <ChevronDown className="w-3 h-3 text-gray-500" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-500" />
              )}
              <Table className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-semibold text-gray-300">
                {engine === 'mongodb' ? 'Collections' : 'Tables'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-gray-400 font-mono">
                {safeTables.length}
              </span>
              {onCreateTable && (
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateTable();
                  }}
                  className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Create New Table"
                >
                  <Plus className="w-3 h-3" />
                </span>
              )}
            </div>
          </button>

          {/* Guide Line & Child Items */}
          {openSections.tables && (
            <div className="border-l border-white/10 ml-3.5 pl-2 mt-1 space-y-0.5">
              {filteredTables.length > 0 ? (
                filteredTables.map((t) => {
                  const isSelected = selectedTable === t.name;
                  return (
                    <div
                      key={t.name}
                      tabIndex={0}
                      onClick={() => onSelectTable(t.name)}
                      onDoubleClick={() => onOpenTableData ? onOpenTableData(t.name) : onSelectTable(t.name)}
                      onContextMenu={(e) => handleContextMenu(e, t.name, 'table')}
                      onKeyDown={(e) => handleKeyDown(e, t.name)}
                      className={`px-2 py-1 rounded-md cursor-pointer flex items-center justify-between group transition-colors outline-none ${
                        isSelected
                          ? 'bg-blue-600/20 text-blue-300 font-medium border border-blue-500/30'
                          : 'text-gray-300 hover:text-white hover:bg-white/5'
                      }`}
                      title={`${t.name} (Press Enter to open, Delete to drop)`}
                    >
                      <span className="truncate text-xs">{t.name}</span>
                      {t.rowCount !== undefined && t.rowCount !== null && (
                        <span className="text-[10px] text-gray-500 group-hover:text-gray-400">
                          {t.rowCount}
                        </span>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="px-2 py-1 text-[11px] text-gray-500 italic">
                  No tables ({safeTables.length})
                </div>
              )}
            </div>
          )}
        </div>

        {/* SECTION: VIEWS */}
        <div>
          <button
            onClick={() => toggleSection('views')}
            className="w-full flex items-center justify-between px-2 py-1 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            <div className="flex items-center gap-1.5">
              {openSections.views ? (
                <ChevronDown className="w-3 h-3 text-gray-500" />
              ) : (
                <ChevronRight className="w-3 h-3 text-gray-500" />
              )}
              <Eye className="w-3.5 h-3.5 text-purple-400" />
              <span className="font-semibold text-gray-300">Views</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-gray-400 font-mono">
              {safeViews.length}
            </span>
          </button>

          {openSections.views && (
            <div className="border-l border-white/10 ml-3.5 pl-2 mt-1 space-y-0.5">
              {filteredViews.length > 0 ? (
                filteredViews.map((v) => {
                  const isSelected = selectedTable === v.name;
                  return (
                    <div
                      key={v.name}
                      tabIndex={0}
                      onClick={() => onSelectTable(v.name)}
                      onDoubleClick={() => onOpenTableData ? onOpenTableData(v.name) : onSelectTable(v.name)}
                      onContextMenu={(e) => handleContextMenu(e, v.name, 'view')}
                      onKeyDown={(e) => handleKeyDown(e, v.name)}
                      className={`px-2 py-1 rounded-md cursor-pointer flex items-center justify-between group transition-colors outline-none ${
                        isSelected
                          ? 'bg-purple-600/20 text-purple-300 font-medium border border-purple-500/30'
                          : 'text-gray-300 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <span className="truncate text-xs">{v.name}</span>
                    </div>
                  );
                })
              ) : (
                <div className="px-2 py-1 text-[11px] text-gray-500 italic">
                  No views (0)
                </div>
              )}
            </div>
          )}
        </div>

        {/* SECTION: PROCEDURES (Not relevant for MongoDB) */}
        {engine !== 'mongodb' && (
          <div>
            <button
              onClick={() => toggleSection('procedures')}
              className="w-full flex items-center justify-between px-2 py-1 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-1.5">
                {openSections.procedures ? (
                  <ChevronDown className="w-3 h-3 text-gray-500" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-gray-500" />
                )}
                <Cpu className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold text-gray-300">Procedures</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-gray-400 font-mono">
                {safeProcs.length}
              </span>
            </button>

            {openSections.procedures && (
              <div className="border-l border-white/10 ml-3.5 pl-2 mt-1 space-y-0.5">
                {filteredProcs.length > 0 ? (
                  filteredProcs.map((p) => {
                    const isSelected = selectedTable === p.name;
                    return (
                      <div
                        key={p.name}
                        onClick={() => onSelectTable(p.name)}
                        onDoubleClick={() => onOpenDefinition ? onOpenDefinition(p.name, 'procedure') : onSelectTable(p.name)}
                        onContextMenu={(e) => handleContextMenu(e, p.name, 'procedure')}
                        className={`px-2 py-1 rounded-md cursor-pointer flex items-center justify-between group transition-colors outline-none ${
                          isSelected
                            ? 'bg-amber-600/20 text-amber-300 font-medium border border-amber-500/30'
                            : 'text-gray-300 hover:text-white hover:bg-white/5'
                        }`}
                        title="Double-click to modify in editor. Right-click for options."
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Cpu className="w-3 h-3 text-amber-400 shrink-0" />
                          <span className="truncate text-xs">{p.name}</span>
                        </div>
                        <span className="text-[9px] text-gray-500 group-hover:text-amber-400 opacity-0 group-hover:opacity-100 font-mono">
                          proc
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-2 py-1 text-[11px] text-gray-500 italic">
                    No procedures (0)
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* SECTION: FUNCTIONS (Not relevant for MongoDB) */}
        {engine !== 'mongodb' && (
          <div>
            <button
              onClick={() => toggleSection('functions')}
              className="w-full flex items-center justify-between px-2 py-1 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-1.5">
                {openSections.functions ? (
                  <ChevronDown className="w-3 h-3 text-gray-500" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-gray-500" />
                )}
                <Code className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-semibold text-gray-300">Functions</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-gray-400 font-mono">
                {safeFuncs.length}
              </span>
            </button>

            {openSections.functions && (
              <div className="border-l border-white/10 ml-3.5 pl-2 mt-1 space-y-0.5">
                {filteredFuncs.length > 0 ? (
                  filteredFuncs.map((f) => {
                    const isSelected = selectedTable === f.name;
                    return (
                      <div
                        key={f.name}
                        onClick={() => onSelectTable(f.name)}
                        onDoubleClick={() => onOpenDefinition ? onOpenDefinition(f.name, 'function') : onSelectTable(f.name)}
                        onContextMenu={(e) => handleContextMenu(e, f.name, 'function')}
                        className={`px-2 py-1 rounded-md cursor-pointer flex items-center justify-between group transition-colors outline-none ${
                          isSelected
                            ? 'bg-cyan-600/20 text-cyan-300 font-medium border border-cyan-500/30'
                            : 'text-gray-300 hover:text-white hover:bg-white/5'
                        }`}
                        title="Double-click to modify in editor. Right-click for options."
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Code className="w-3 h-3 text-cyan-400 shrink-0" />
                          <span className="truncate text-xs">{f.name}</span>
                        </div>
                        <span className="text-[9px] text-gray-500 group-hover:text-cyan-400 opacity-0 group-hover:opacity-100 font-mono">
                          fn
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-2 py-1 text-[11px] text-gray-500 italic">
                    No functions (0)
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* SECTION: TRIGGERS (Not relevant for MongoDB) */}
        {engine !== 'mongodb' && (
          <div>
            <button
              onClick={() => toggleSection('triggers')}
              className="w-full flex items-center justify-between px-2 py-1 text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <div className="flex items-center gap-1.5">
                {openSections.triggers ? (
                  <ChevronDown className="w-3 h-3 text-gray-500" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-gray-500" />
                )}
                <Zap className="w-3.5 h-3.5 text-rose-400" />
                <span className="font-semibold text-gray-300">Triggers</span>
              </div>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-gray-400 font-mono">
                {safeTriggers.length}
              </span>
            </button>

            {openSections.triggers && (
              <div className="border-l border-white/10 ml-3.5 pl-2 mt-1 space-y-0.5">
                {filteredTriggers.length > 0 ? (
                  filteredTriggers.map((tr) => {
                    const isSelected = selectedTable === tr.name;
                    return (
                      <div
                        key={tr.name}
                        onClick={() => onSelectTable(tr.name)}
                        onDoubleClick={() => onOpenDefinition ? onOpenDefinition(tr.name, 'trigger') : onSelectTable(tr.name)}
                        onContextMenu={(e) => handleContextMenu(e, tr.name, 'trigger')}
                        className={`px-2 py-1 rounded-md cursor-pointer flex items-center justify-between group transition-colors outline-none ${
                          isSelected
                            ? 'bg-rose-600/20 text-rose-300 font-medium border border-rose-500/30'
                            : 'text-gray-300 hover:text-white hover:bg-white/5'
                        }`}
                        title="Double-click to modify in editor. Right-click for options."
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Zap className="w-3 h-3 text-rose-400 shrink-0" />
                          <span className="truncate text-xs">{tr.name}</span>
                        </div>
                        <span className="text-[9px] text-gray-500 group-hover:text-rose-400 opacity-0 group-hover:opacity-100 font-mono">
                          trg
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="px-2 py-1 text-[11px] text-gray-500 italic">
                    No triggers (0)
                  </div>
                )}
              </div>
            )}
          </div>
        )}

      </div>

      {/* 3. Tree Context Menu (Right Click) */}
      {contextMenu && (
        <PortalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          className="min-w-[210px] bg-[#1e1e2e]/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl py-1.5 text-xs text-gray-200 select-none"
        >
          {/* Header Badge */}
          <div className="px-3 py-1 font-mono text-[10px] text-gray-400 border-b border-white/5 flex items-center justify-between gap-2">
            <span className="truncate max-w-[130px]">{contextMenu.tableName}</span>
            <span className={`px-1.5 py-0.2 rounded text-[9px] uppercase font-bold shrink-0 ${
              contextMenu.objectType === 'table' ? 'bg-blue-500/20 text-blue-400' :
              contextMenu.objectType === 'view' ? 'bg-purple-500/20 text-purple-400' :
              contextMenu.objectType === 'procedure' ? 'bg-amber-500/20 text-amber-400' :
              contextMenu.objectType === 'function' ? 'bg-cyan-500/20 text-cyan-400' :
              'bg-rose-500/20 text-rose-400'
            }`}>
              {contextMenu.objectType}
            </span>
          </div>

          {/* Table / View: Open Data Grid */}
          {(contextMenu.objectType === 'table' || contextMenu.objectType === 'view') && (
            <button
              onClick={() => {
                if (onOpenTableData) onOpenTableData(contextMenu.tableName);
                else onSelectTable(contextMenu.tableName);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors"
            >
              <Table className="w-3.5 h-3.5 text-blue-400" />
              <span>{engine === 'mongodb' ? 'Open Documents Grid' : 'Open Data Grid'}</span>
            </button>
          )}

          {/* Modify / Edit in Editor (Procedures, Functions, Triggers, Views, Collections) */}
          {onOpenDefinition && (
            <button
              onClick={() => {
                onOpenDefinition(contextMenu.tableName, contextMenu.objectType);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors text-amber-300"
            >
              <Edit3 className="w-3.5 h-3.5 text-amber-400" />
              <span>{engine === 'mongodb' ? 'Query Collection (find)' : 'Modify / Alter in Editor'}</span>
            </button>
          )}

          {/* Execute Routine (Procedure: CALL / Function: SELECT) */}
          {(contextMenu.objectType === 'procedure' || contextMenu.objectType === 'function') && (
            <button
              onClick={() => {
                if (onExecuteRoutine) {
                  onExecuteRoutine(contextMenu.tableName, contextMenu.objectType as 'procedure' | 'function');
                } else if (onGenerateSql) {
                  const callSql = contextMenu.objectType === 'procedure'
                    ? `CALL ${contextMenu.tableName}();`
                    : `SELECT ${contextMenu.tableName}();`;
                  if (typeof onGenerateSql === 'function') {
                    if (onGenerateSql.length >= 2) (onGenerateSql as any)('SELECT', contextMenu.tableName);
                    else (onGenerateSql as any)(callSql);
                  }
                }
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors text-emerald-400"
            >
              <Code className="w-3.5 h-3.5 text-emerald-400" />
              <span>{contextMenu.objectType === 'procedure' ? 'Execute (CALL)' : 'Execute (SELECT)'}</span>
            </button>
          )}

          {/* Alter / Design Table (Table only) */}
          {onAlterTable && contextMenu.objectType === 'table' && (
            <button
              onClick={() => {
                onAlterTable(contextMenu.tableName);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors"
            >
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>Alter / Design Table</span>
            </button>
          )}

          {/* Rename Table (Table only) */}
          {onRenameTable && contextMenu.objectType === 'table' && (
            <button
              onClick={() => {
                setRenameTarget(contextMenu.tableName);
                setNewTableName(contextMenu.tableName);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5 text-amber-400" />
              <span>Rename Table</span>
            </button>
          )}

          {/* Copy Name (All objects) */}
          <button
            onClick={() => {
              if (onCopyName) onCopyName(contextMenu.tableName);
              else navigator.clipboard.writeText(contextMenu.tableName);
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-gray-400" />
            <span>Copy Name</span>
          </button>

          {/* Generate SQL (Table & View) */}
          {onGenerateSql && (contextMenu.objectType === 'table' || contextMenu.objectType === 'view') && (
            <>
              <div className="my-1 border-t border-white/5" />
              <button
                onClick={() => {
                  if (typeof onGenerateSql === 'function') {
                    if (onGenerateSql.length >= 2) (onGenerateSql as any)('SELECT', contextMenu.tableName);
                    else (onGenerateSql as any)(generateSelectSql(contextMenu.tableName));
                  }
                  setContextMenu(null);
                }}
                className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors"
              >
                <Code className="w-3.5 h-3.5 text-emerald-400" />
                <span>Generate SELECT</span>
              </button>
              {contextMenu.objectType === 'table' && (
                <button
                  onClick={() => {
                    if (typeof onGenerateSql === 'function') {
                      if (onGenerateSql.length >= 2) (onGenerateSql as any)('INSERT', contextMenu.tableName);
                      else (onGenerateSql as any)(generateInsertSql(contextMenu.tableName));
                    }
                    setContextMenu(null);
                  }}
                  className="w-full px-3 py-1.5 text-left hover:bg-white/10 flex items-center gap-2.5 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Generate INSERT</span>
                </button>
              )}
            </>
          )}

          {/* Destructive Actions */}
          <div className="my-1 border-t border-white/5" />

          {onTruncateTable && contextMenu.objectType === 'table' && (
            <button
              onClick={() => {
                setTruncateTarget(contextMenu.tableName);
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-amber-500/10 text-amber-400 flex items-center gap-2.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Empty / Truncate Table</span>
            </button>
          )}

          {(onDropTable || onDropObject) && (
            <button
              onClick={() => {
                setDropTarget({ name: contextMenu.tableName, objectType: contextMenu.objectType });
                setContextMenu(null);
              }}
              className="w-full px-3 py-1.5 text-left hover:bg-red-500/10 text-red-400 flex items-center gap-2.5 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span>Drop {contextMenu.objectType.charAt(0).toUpperCase() + contextMenu.objectType.slice(1)}</span>
            </button>
          )}
        </PortalContextMenu>
      )}

      {/* 4. Drop Confirm Modal */}
      {dropTarget && (
        <ConfirmModal
          isOpen={!!dropTarget}
          title={engine === 'mongodb' ? 'Drop Collection Confirmation' : `Drop ${dropTarget.objectType.charAt(0).toUpperCase() + dropTarget.objectType.slice(1)} Confirmation`}
          message={
            engine === 'mongodb'
              ? `Are you sure you want to completely DROP collection "${dropTarget.name}"? All documents inside will be permanently deleted.`
              : `Are you sure you want to completely DROP ${dropTarget.objectType} "${dropTarget.name}"? This action cannot be undone.`
          }
          details={
            engine === 'mongodb'
              ? `db.${dropTarget.name}.drop();`
              : ['mysql', 'mariadb'].includes(engine)
              ? `DROP ${dropTarget.objectType.toUpperCase()} IF EXISTS \`${dropTarget.name}\`;`
              : `DROP ${dropTarget.objectType.toUpperCase()} IF EXISTS "${dropTarget.name}";`
          }
          confirmText={engine === 'mongodb' ? 'Drop Collection' : `Drop ${dropTarget.objectType}`}
          confirmStyle="danger"
          onConfirm={() => {
            if (dropTarget.objectType === 'table' && onDropTable) {
              onDropTable(dropTarget.name);
            } else if (onDropObject) {
              onDropObject(dropTarget.name, dropTarget.objectType);
            } else if (onDropTable) {
              onDropTable(dropTarget.name);
            }
            setDropTarget(null);
          }}
          onClose={() => setDropTarget(null)}
        />
      )}

      {/* 5. Truncate Table Confirm Modal */}
      {truncateTarget && onTruncateTable && (
        <ConfirmModal
          isOpen={!!truncateTarget}
          title={engine === 'mongodb' ? 'Empty Collection Confirmation' : 'Truncate Table Confirmation'}
          message={
            engine === 'mongodb'
              ? `Are you sure you want to EMPTY collection "${truncateTarget}"? All documents in this collection will be deleted immediately.`
              : `Are you sure you want to TRUNCATE table "${truncateTarget}"? All rows in this table will be deleted immediately.`
          }
          confirmText={engine === 'mongodb' ? 'Empty Collection' : 'Truncate Table'}
          confirmStyle="warning"
          onConfirm={() => {
            onTruncateTable(truncateTarget);
            setTruncateTarget(null);
          }}
          onClose={() => setTruncateTarget(null)}
        />
      )}

      {/* 6. Rename Table Modal Dialog */}
      {renameTarget && onRenameTable && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1e1e2e] border border-white/10 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-white">Rename Table</h3>
            <p className="text-xs text-gray-400">
              Enter a new name for table <span className="text-blue-400 font-mono">{renameTarget}</span>:
            </p>
            <input
              type="text"
              value={newTableName}
              onChange={(e) => setNewTableName(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:border-blue-500/50 focus:outline-none"
              autoFocus
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setRenameTarget(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newTableName.trim() && newTableName !== renameTarget) {
                    if (onRenameTable.length >= 2) (onRenameTable as any)(renameTarget, newTableName.trim());
                    else (onRenameTable as any)(newTableName.trim());
                  }
                  setRenameTarget(null);
                }}
                disabled={!newTableName.trim() || newTableName === renameTarget}
                className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 transition-colors"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default SchemaTreeView;
