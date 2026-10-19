import React, { useState, useEffect } from 'react';
import {
  FolderTree,
  Play,
  RefreshCw,
  Plus,
  Trash2,
  Code2,
  Table,
  Sliders,
  Sparkles,
  Search,
  CheckCircle2,
  AlertCircle,
  Copy,
  ChevronRight,
  Shield,
  FileCode2,
  Columns
} from 'lucide-react';
import {
  DbConnectionProfile,
  TableItem,
  IndexItem,
  QueryTab,
  DataGridState
} from '../types';
import {
  mongodbListCollections,
  dbExecuteQuery
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

interface MongoStudioProps {
  profile: DbConnectionProfile;
  onDisconnect?: () => void;
}

export const MongoStudio: React.FC<MongoStudioProps> = ({ profile, onDisconnect }) => {
  const [activeTab, setActiveTab] = useState<'editor' | 'datagrid' | 'indexes'>('editor');

  // Database Selector
  const [databases, setDatabases] = useState<string[]>([]);
  const [currentDb, setCurrentDb] = useState<string>(profile.database || 'admin');

  // Schema tree
  const [collections, setCollections] = useState<TableItem[]>([]);
  const [selectedColl, setSelectedColl] = useState<string | null>(null);
  const [isLoadingCols, setIsLoadingCols] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDocEditor, setShowDocEditor] = useState(false);
  const [showDocCreate, setShowDocCreate] = useState(false);
  const [docToEdit, setDocToEdit] = useState<any | null>(null);

  // Layout & Split Mode
  const [splitMode, setSplitMode] = useState<'horizontal' | 'vertical' | 'editor-only' | 'results-only'>('horizontal');

  // Query Tabs State (Supports Multi-Command & Multi-Output)
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    {
      id: 'tab-1',
      title: 'Mongo Script 1',
      query: '// MongoDB Shell Script\ndb.getCollectionNames();',
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

  // Documents Data Grid
  const [docs, setDocs] = useState<any[]>([]);
  const [docColumns, setDocColumns] = useState<string[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);

  // Indexes
  const [indexes, setIndexes] = useState<IndexItem[]>([]);

  const activeQueryTab = queryTabs.find(t => t.id === activeTabId) || queryTabs[0];

  // ─── 1. Load Databases & Collections ──────────────────────────────
  const loadDatabases = async () => {
    try {
      const res = await dbExecuteQuery(profile.id, JSON.stringify({ listDatabases: 1 }));
      const foundDbs: string[] = [];
      if (res && Array.isArray(res.rows)) {
        for (const r of res.rows) {
          if (!r) continue;
          if (typeof r === 'string') {
            foundDbs.push(r);
          } else if (Array.isArray(r.databases)) {
            for (const item of r.databases) {
              const name = typeof item === 'string' ? item : (item?.name || item?.databaseName);
              if (name && typeof name === 'string') foundDbs.push(name);
            }
          } else if (typeof r === 'object') {
            const name = r.name || r.databaseName;
            if (name && typeof name === 'string') {
              foundDbs.push(name);
            }
          }
        }
      }
      const unique = Array.from(new Set(foundDbs.filter(Boolean)));
      if (unique.length > 0) {
        setDatabases(unique);
      } else {
        const fallback = [profile.database || 'admin', 'test', 'local'].filter(Boolean);
        setDatabases(Array.from(new Set(fallback)));
      }
    } catch {
      const fallback = [profile.database || 'admin', 'test', 'local'].filter(Boolean);
      setDatabases(Array.from(new Set(fallback)));
    }
  };

  const loadCollections = async (dbOverride?: string) => {
    const targetDb = dbOverride || currentDb || profile.database || 'admin';
    setIsLoadingCols(true);
    setGlobalError(null);
    try {
      const list = await mongodbListCollections(profile.id, targetDb);
      const safeList = Array.isArray(list) ? list : [];
      const items: TableItem[] = safeList.map(c => ({
        name: typeof c === 'string' ? c : ((c as any)?.name || String(c)),
        type: 'table',
        schema: targetDb,
      }));
      setCollections(items);

      if (items.length > 0) {
        const nextSelected = (!selectedColl || !items.some(i => i.name === selectedColl))
          ? items[0].name
          : selectedColl;
        setSelectedColl(nextSelected);
        loadDocuments(nextSelected, targetDb);
      } else {
        setSelectedColl(null);
        setDocs([]);
        setDocColumns([]);
      }
    } catch (err: any) {
      setGlobalError(`Failed to load collections: ${err?.message || err}`);
      setCollections([]);
    } finally {
      setIsLoadingCols(false);
    }
  };

  const handleSelectDatabase = async (newDb: string) => {
    setCurrentDb(newDb);
    setSelectedColl(null);
    try {
      await dbExecuteQuery(profile.id, `use ${newDb};`);
    } catch {
      // Ignore
    }
    loadCollections(newDb);
  };

  useEffect(() => {
    loadDatabases();
    loadCollections(currentDb);
  }, [profile.id]);

  // ─── 2. Load Documents for Data Grid ──────────────────────────────
  const loadDocuments = async (collName: string, dbOverride?: string) => {
    if (!collName) return;
    const targetDb = dbOverride || currentDb;
    setSelectedColl(collName);
    setIsLoadingDocs(true);
    try {
      const escapedColl = collName.replace(/"/g, '\\"');
      const q = `use ${targetDb};\ndb.getCollection("${escapedColl}").find({}).limit(50);`;
      const res = await dbExecuteQuery(profile.id, q);
      const rawRows = (res && Array.isArray(res.rows)) ? res.rows : [];
      setDocs(rawRows);

      // Extract unique keys across documents for columns
      const keySet = new Set<string>();
      rawRows.forEach((r: any) => {
        if (typeof r === 'object' && r !== null) {
          Object.keys(r).forEach(k => keySet.add(k));
        }
      });
      const extractedCols = Array.from(keySet);
      setDocColumns(extractedCols.length > 0 ? extractedCols : ['_id', 'value']);

      loadIndexes(collName, targetDb);
    } catch (err: any) {
      setGlobalError(`Failed to find documents: ${err?.message || err}`);
      setDocs([]);
      setDocColumns([]);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const loadIndexes = async (collName: string, dbOverride?: string) => {
    if (!collName) return;
    const targetDb = dbOverride || currentDb;
    try {
      const q = `use ${targetDb};\ndb.getCollection("${collName.replace(/"/g, '\\"')}").getIndexes();`;
      const res = await dbExecuteQuery(profile.id, q);
      const rawList = (res && Array.isArray(res.rows)) ? res.rows : [];
      const items: IndexItem[] = rawList.map((idx: any) => ({
        name: idx?.name || 'index',
        tableName: collName,
        columnName: idx?.key ? Object.keys(idx.key).join(', ') : (idx?.name || '_id'),
        isUnique: Boolean(idx?.unique || idx?.name === '_id_'),
        type: idx?.unique ? 'UNIQUE' : 'INDEX',
      }));
      setIndexes(items.length > 0 ? items : [{
        name: '_id_',
        tableName: collName,
        columnName: '_id',
        isUnique: true,
        type: 'PRIMARY',
      }]);
    } catch {
      setIndexes([{
        name: '_id_',
        tableName: collName,
        columnName: '_id',
        isUnique: true,
        type: 'PRIMARY',
      }]);
    }
  };

  // ─── 3. Query Tabs Management ─────────────────────────────────────
  const handleAddTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `Script ${queryTabs.length + 1}`,
      query: `// Query collection\ndb.getCollection("${(selectedColl || 'users').replace(/"/g, '\\"')}").find({}).limit(25);`,
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
      title: 'Script 1',
      query: '// MongoDB Shell Script\ndb.getCollectionNames();',
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

      // Extract columns if rows are JSON documents
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
              successInfo: `Executed in ${durationMs}ms (${rows.length || res.affected_rows} documents).`,
              isExecuting: false,
            };
          }
          return t;
        });
      });

      // Detect 'use <dbname>' or MongoDB Use response
      let switchedDb: string | null = null;
      const useMatch = q.match(/^\s*use\s+['"`]?([a-zA-Z0-9_\-\.]+)['"`]?;?\s*$/i);
      if (useMatch && useMatch[1]) {
        switchedDb = useMatch[1];
      } else if (res.command_type === 'MongoDB Use' && rows.length > 0 && (rows[0] as any)?.database) {
        switchedDb = (rows[0] as any).database;
      } else if (res.all_results) {
        for (const item of res.all_results) {
          const match = item.statement.match(/^\s*use\s+['"`]?([a-zA-Z0-9_\-\.]+)['"`]?;?\s*$/i);
          if (match && match[1]) {
            switchedDb = match[1];
          }
        }
      }

      if (switchedDb) {
        setCurrentDb(switchedDb);
        loadDatabases();
        loadCollections(switchedDb);
      } else if (/\b(createCollection|drop|dropDatabase|delete|insert|update|remove)\b/i.test(q)) {
        loadDatabases();
        loadCollections();
        if (selectedColl) {
          loadDocuments(selectedColl);
        }
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

  // ─── 5. Collection & Document Actions ─────────────────────────────
  const handleDeleteDoc = async (doc: any) => {
    if (!selectedColl) return;
    const docId = doc._id || doc.id;
    if (!docId) {
      alert('Cannot delete document: document does not contain an _id field.');
      return;
    }
    const idVal = typeof docId === 'string' ? `"${docId}"` : JSON.stringify(docId);
    const escapedColl = selectedColl.replace(/"/g, '\\"');
    try {
      await dbExecuteQuery(profile.id, `db.getCollection("${escapedColl}").deleteOne({ _id: ${idVal} });`);
      loadDocuments(selectedColl);
    } catch (e: any) {
      alert(`Delete Error: ${e?.message || e}`);
    }
  };

  const handleTruncateColl = async (collName: string) => {
    const escapedColl = collName.replace(/"/g, '\\"');
    try {
      await dbExecuteQuery(profile.id, `db.getCollection("${escapedColl}").deleteMany({});`);
      loadDocuments(collName);
    } catch (e: any) {
      alert(`Truncate Error: ${e?.message || e}`);
    }
  };

  const handleDropColl = async (collName: string) => {
    const escapedColl = collName.replace(/"/g, '\\"');
    try {
      await dbExecuteQuery(profile.id, `db.getCollection("${escapedColl}").drop();`);
      loadCollections();
      if (selectedColl === collName) setSelectedColl(null);
    } catch (e: any) {
      alert(`Drop Error: ${e?.message || e}`);
    }
  };

  const handleGenerateScript = (type: 'SELECT' | 'INSERT', collName: string) => {
    const escapedColl = collName.replace(/"/g, '\\"');
    let script = '';
    if (type === 'SELECT') {
      script = `db.getCollection("${escapedColl}").find({}).limit(50);`;
    } else {
      script = `db.getCollection("${escapedColl}").insertOne({\n  name: "Sample Document",\n  createdAt: new Date()\n});`;
    }

    const newId = `tab-${Date.now()}`;
    const newTab: QueryTab = {
      id: newId,
      title: `${type === 'SELECT' ? 'Find' : 'Insert'} ${collName}`,
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
          <div className="w-7 h-7 rounded-lg bg-green-500/20 text-green-400 flex items-center justify-center font-bold text-sm shadow-inner border border-green-500/30">
            🍃
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white tracking-wide">{profile.name}</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-green-500/10 text-green-400 border border-green-500/20">
              MongoDB Wire Engine
            </span>
            <span className="text-xs text-gray-500">•</span>
            <span className="text-xs text-gray-400 font-mono">
              Database: <span className="text-green-300 font-semibold">{currentDb}</span>
            </span>
          </div>
        </div>

        {/* View Switcher */}
        <div className="flex items-center bg-white/5 rounded-xl p-0.5 border border-white/10">
          <button
            onClick={() => setActiveTab('editor')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'editor' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>JS / Mongo Studio</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('datagrid');
              if (selectedColl) loadDocuments(selectedColl);
            }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'datagrid' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>Documents Grid</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('indexes');
              if (selectedColl) loadIndexes(selectedColl);
            }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'indexes' ? 'bg-green-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Indexes</span>
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
            engine="mongodb"
            databases={databases}
            currentDb={currentDb}
            tables={collections}
            views={[]}
            routines={[]}
            triggers={[]}
            selectedTable={selectedColl}
            isLoading={isLoadingCols}
            onSelectDatabase={handleSelectDatabase}
            onSelectTable={(coll) => {
              loadDocuments(coll);
              setActiveTab('datagrid');
            }}
            onOpenDefinition={(name) => {
              const newId = `tab-${Date.now()}`;
              const newTab: QueryTab = {
                id: newId,
                title: `Find: ${name}`,
                query: `// Query collection ${name}\ndb.${name}.find({}).limit(50);`,
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
            onRefresh={() => {
              loadDatabases();
              loadCollections(currentDb);
            }}
            onTruncateTable={handleTruncateColl}
            onDropTable={handleDropColl}
            onCopyName={(name) => navigator.clipboard.writeText(name)}
            onGenerateSql={handleGenerateScript}
          />
        </div>

        {/* Right Main Body */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#181825]">
          {/* VIEW 1: Script Studio */}
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
                    engine="mongodb"
                    tables={collections.map(c => c.name)}
                    columns={docColumns}
                    language="javascript"
                    splitMode={splitMode}
                    onSplitModeChange={setSplitMode}
                    onCloseTab={() => handleCloseTab(activeTabId)}
                  />
                </div>

                {/* Multi-Statement Results Viewer */}
                <div className={`overflow-hidden ${splitMode === 'vertical' ? 'w-1/2' : 'h-1/2'}`}>
                  <MultiResultViewer
                    tableName={selectedColl}
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
                    onAddRow={() => selectedColl && setShowDocCreate(true)}
                    onEditRow={(row) => {
                      setDocToEdit(row);
                      setShowDocEditor(true);
                    }}
                    onDeleteRow={handleDeleteDoc}
                  />
                </div>
              </div>
            </div>
          )}

          {/* VIEW 2: Documents Grid */}
          {activeTab === 'datagrid' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <MultiResultViewer
                tableName={selectedColl}
                columns={docColumns}
                rows={docs}
                execTime={isLoadingDocs ? 'Loading documents...' : 'Cached'}
                error={null}
                successInfo={selectedColl ? `Showing documents in collection "${selectedColl}"` : undefined}
                onAddRow={() => selectedColl && setShowDocCreate(true)}
                onEditRow={(row) => {
                  setDocToEdit(row);
                  setShowDocEditor(true);
                }}
                onDeleteRow={handleDeleteDoc}
              />
            </div>
          )}

          {/* VIEW 3: Indexes */}
          {activeTab === 'indexes' && (
            <div className="flex-1 p-6 space-y-6 overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-white">Collection Indexes: "{selectedColl}"</h3>
                  <p className="text-xs text-gray-400">{indexes.length} Indexes defined</p>
                </div>
              </div>

              {/* Indexes Table */}
              <div className="rounded-xl border border-white/10 overflow-hidden bg-white/5">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-black/30 border-b border-white/10 text-gray-400 font-semibold">
                    <tr>
                      <th className="px-3 py-2">Index Name</th>
                      <th className="px-3 py-2">Key Fields</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Unique</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {indexes.map((idx, i) => (
                      <tr key={i} className="hover:bg-white/5">
                        <td className="px-3 py-2 font-bold text-white font-mono">{idx.name}</td>
                        <td className="px-3 py-2 text-green-400 font-mono">{idx.columnName}</td>
                        <td className="px-3 py-2 text-gray-400">{idx.type}</td>
                        <td className="px-3 py-2">
                          {idx.isUnique ? (
                            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-[10px]">
                              UNIQUE
                            </span>
                          ) : (
                            <span className="text-gray-500">NO</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateTableModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          engine="mongodb"
          connectionId={profile.id}
          database={currentDb}
          onCreated={(newColl) => {
            loadCollections();
            loadDocuments(newColl);
          }}
        />
      )}

      {showDocCreate && selectedColl && (
        <RowCreateModal
          isOpen={showDocCreate}
          onClose={() => setShowDocCreate(false)}
          engine="mongodb"
          tableName={selectedColl}
          connectionId={profile.id}
          database={currentDb}
          onSuccess={() => {
            setShowDocCreate(false);
            loadDocuments(selectedColl);
          }}
        />
      )}

      {showDocEditor && selectedColl && (
        <RowEditorModal
          isOpen={showDocEditor}
          onClose={() => setShowDocEditor(false)}
          engine="mongodb"
          connectionId={profile.id}
          tableName={selectedColl}
          database={currentDb}
          initialRow={docToEdit}
          onSaved={() => loadDocuments(selectedColl)}
        />
      )}
    </div>
  );
};

export default MongoStudio;
