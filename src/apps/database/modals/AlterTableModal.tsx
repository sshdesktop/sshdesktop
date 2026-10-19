import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Edit2,
  Check,
  AlertCircle,
  Sliders,
  Table
} from 'lucide-react';
import { DbEngine, ColumnDefinition } from '../types';
import { dbExecuteOperation, dbExecuteQuery } from '../../../lib/tauri-bridge';

interface AlterTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  engine: DbEngine;
  connectionId: string;
  tableName: string;
  database: string;
  schema?: string;
  existingColumns: ColumnDefinition[];
  onAltered: () => void;
}

export const AlterTableModal: React.FC<AlterTableModalProps> = ({
  isOpen,
  onClose,
  engine,
  connectionId,
  tableName,
  database,
  schema,
  existingColumns,
  onAltered,
}) => {
  const [activeTab, setActiveTab] = useState<'add_col' | 'drop_col' | 'rename' | 'index'>('add_col');
  
  // Add Column State
  const [newColName, setNewColName] = useState('');
  const [newColType, setNewColType] = useState('VARCHAR(255)');
  const [newColNullable, setNewColNullable] = useState(true);
  const [newColAutoInc, setNewColAutoInc] = useState(false);
  const [newColDefault, setNewColDefault] = useState('');

  // Drop Column State
  const [targetDropCol, setTargetDropCol] = useState(existingColumns[0]?.name || '');

  // Rename Table State
  const [newTableName, setNewTableName] = useState(tableName);

  // Add Index State
  const [indexName, setIndexName] = useState(`idx_${tableName}_col`);
  const [indexedCols, setIndexedCols] = useState<string[]>(existingColumns[0] ? [existingColumns[0].name] : []);
  const [isUniqueIndex, setIsUniqueIndex] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live SQL preview & Custom Query Edit Mode
  const [isCustomSql, setIsCustomSql] = useState(false);
  const [customSql, setCustomSql] = useState('');

  // Generate ALTER SQL dynamically
  const buildGeneratedSql = (): string => {
    const isMysql = ['mysql', 'mariadb'].includes(engine);
    const isMssql = engine === 'mssql';
    const quote = isMysql ? '`' : isMssql ? '[' : '"';
    const quoteEnd = isMysql ? '`' : isMssql ? ']' : '"';
    const tblIdentifier = `${quote}${tableName}${quoteEnd}`;

    if (activeTab === 'add_col') {
      const colName = newColName.trim() || 'new_column';
      let autoClause = '';
      if (newColAutoInc) {
        if (isMysql) autoClause = ' AUTO_INCREMENT';
        else if (isMssql) autoClause = ' IDENTITY(1,1)';
      }
      const nullClause = newColNullable ? ' NULL' : ' NOT NULL';
      const defClause = newColDefault.trim() ? ` DEFAULT ${newColDefault.trim()}` : '';
      return `ALTER TABLE ${tblIdentifier} ADD ${quote}${colName}${quoteEnd} ${newColType}${autoClause}${nullClause}${defClause};`;
    }

    if (activeTab === 'drop_col') {
      return `ALTER TABLE ${tblIdentifier} DROP COLUMN ${quote}${targetDropCol || 'column_name'}${quoteEnd};`;
    }

    if (activeTab === 'rename') {
      const newTbl = newTableName.trim() || 'renamed_table';
      if (isMysql) {
        return `RENAME TABLE ${tblIdentifier} TO ${quote}${newTbl}${quoteEnd};`;
      }
      if (isMssql) {
        return `EXEC sp_rename '${tableName}', '${newTbl}';`;
      }
      return `ALTER TABLE ${tblIdentifier} RENAME TO ${quote}${newTbl}${quoteEnd};`;
    }

    if (activeTab === 'index') {
      const idx = indexName.trim() || `idx_${tableName}`;
      const cols = indexedCols.map(c => `${quote}${c}${quoteEnd}`).join(', ');
      const unique = isUniqueIndex ? 'UNIQUE ' : '';
      return `CREATE ${unique}INDEX ${quote}${idx}${quoteEnd} ON ${tblIdentifier} (${cols || 'id'});`;
    }

    return '';
  };

  useEffect(() => {
    if (!isCustomSql) {
      setCustomSql(buildGeneratedSql());
    }
  }, [activeTab, newColName, newColType, newColNullable, newColAutoInc, newColDefault, targetDropCol, newTableName, indexName, indexedCols, isUniqueIndex, isCustomSql]);

  if (!isOpen) return null;

  const handleExecute = async () => {
    setError(null);
    setIsSubmitting(true);
    try {
      if (isCustomSql && customSql.trim()) {
        await dbExecuteQuery(connectionId, customSql.trim());
        onAltered();
        onClose();
        return;
      }

      if (activeTab === 'add_col') await handleAddColumn();
      else if (activeTab === 'drop_col') await handleDropColumn();
      else if (activeTab === 'rename') await handleRenameTable();
      else if (activeTab === 'index') await handleCreateIndex();
    } catch (err: any) {
      setError(`Alteration Error: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddColumn = async () => {
    if (!newColName.trim()) {
      setError('Column name is required.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await dbExecuteOperation(connectionId, {
        operation: 'add_column',
        database: database || undefined,
        schema: schema || undefined,
        table: tableName,
        column: {
          name: newColName.trim(),
          data_type: newColType,
          nullable: newColNullable,
          primary_key: false,
          auto_increment: newColAutoInc,
          default_value: newColDefault.trim() || undefined,
        },
      });
      onAltered();
      onClose();
    } catch (err: any) {
      setError(`Add Column Error: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDropColumn = async () => {
    if (!targetDropCol) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await dbExecuteOperation(connectionId, {
        operation: 'drop_column',
        database: database || undefined,
        schema: schema || undefined,
        table: tableName,
        column_name: targetDropCol,
      });
      onAltered();
      onClose();
    } catch (err: any) {
      setError(`Drop Column Error: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRenameTable = async () => {
    if (!newTableName.trim() || newTableName === tableName) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await dbExecuteOperation(connectionId, {
        operation: 'rename_object',
        database: database || undefined,
        schema: schema || undefined,
        object_type: 'table',
        old_name: tableName,
        new_name: newTableName.trim(),
      });
      onAltered();
      onClose();
    } catch (err: any) {
      setError(`Rename Error: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateIndex = async () => {
    if (!indexName.trim() || indexedCols.length === 0) {
      setError('Index name and at least one column are required.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await dbExecuteOperation(connectionId, {
        operation: 'create_index',
        database: database || undefined,
        schema: schema || undefined,
        table: tableName,
        index_name: indexName.trim(),
        columns: indexedCols,
        is_unique: isUniqueIndex,
      });
      onAltered();
      onClose();
    } catch (err: any) {
      setError(`Create Index Error: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#1e1e2e]/95 border border-white/10 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in duration-150">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shadow-inner border border-blue-500/30">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">
                Alter Table: <span className="font-mono text-blue-400">{tableName}</span>
              </h2>
              <p className="text-xs text-gray-400">
                Modify schema structure, add or drop columns, create indexes
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="px-6 pt-3 pb-2 border-b border-white/5 bg-black/10 flex gap-2">
          <button
            type="button"
            onClick={() => { setActiveTab('add_col'); setError(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'add_col' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Add Column
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('drop_col'); setError(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'drop_col' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Drop Column
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('rename'); setError(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'rename' ? 'bg-amber-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Rename Table
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab('index'); setError(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'index' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            Add Index
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'add_col' && (
            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Column Name *</label>
                <input
                  type="text"
                  value={newColName}
                  onChange={(e) => setNewColName(e.target.value)}
                  placeholder="e.g. status, created_at, avatar_url"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Data Type</label>
                  <input
                    type="text"
                    value={newColType}
                    onChange={(e) => setNewColType(e.target.value)}
                    placeholder="VARCHAR(255), INT, etc."
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Default Value</label>
                  <input
                    type="text"
                    value={newColDefault}
                    onChange={(e) => setNewColDefault(e.target.value)}
                    placeholder="NULL or 'active' or 0"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-6 pt-1">
                <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newColNullable}
                    onChange={(e) => setNewColNullable(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-0"
                  />
                  <span>Allow NULL</span>
                </label>
                <label className="flex items-center gap-2 text-xs text-blue-400 cursor-pointer font-medium">
                  <input
                    type="checkbox"
                    checked={newColAutoInc}
                    onChange={(e) => setNewColAutoInc(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-0"
                  />
                  <span>Auto Increment</span>
                </label>
              </div>
            </div>
          )}

          {activeTab === 'drop_col' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-400">
                Select a column to permanently drop from table <span className="text-white font-mono">{tableName}</span>:
              </p>
              <select
                value={targetDropCol}
                onChange={(e) => setTargetDropCol(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {existingColumns.map(c => (
                  <option key={c.name} value={c.name} className="bg-[#1e1e2e]">
                    {c.name} ({c.type}) {c.isPrimaryKey ? '— [PK]' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeTab === 'rename' && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-gray-300">New Table Name *</label>
              <input
                type="text"
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
            </div>
          )}

          {activeTab === 'index' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Index Name *</label>
                <input
                  type="text"
                  value={indexName}
                  onChange={(e) => setIndexName(e.target.value)}
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Select Columns</label>
                <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 max-h-36 overflow-y-auto space-y-1.5">
                  {existingColumns.map(c => (
                    <label key={c.name} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={indexedCols.includes(c.name)}
                        onChange={(e) => {
                          if (e.target.checked) setIndexedCols(prev => [...prev, c.name]);
                          else setIndexedCols(prev => prev.filter(col => col !== c.name));
                        }}
                        className="rounded text-purple-600 focus:ring-0"
                      />
                      <span className="font-mono">{c.name}</span>
                      <span className="text-[10px] text-gray-500">({c.type})</span>
                    </label>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-purple-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={isUniqueIndex}
                  onChange={(e) => setIsUniqueIndex(e.target.checked)}
                  className="rounded text-purple-600 focus:ring-0"
                />
                <span>Unique Constraint</span>
              </label>
            </div>
          )}

          {/* Live Generated SQL Preview & Manual Edit Box */}
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-gray-300 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-blue-400" />
                <span>Generated Alter Statement</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer text-blue-400 hover:text-blue-300 transition-colors">
                <input
                  type="checkbox"
                  checked={isCustomSql}
                  onChange={(e) => setIsCustomSql(e.target.checked)}
                  className="rounded text-blue-500 focus:ring-0"
                />
                <span className="text-[11px] font-medium">Edit Raw Statement</span>
              </label>
            </div>

            {isCustomSql ? (
              <textarea
                rows={3}
                value={customSql}
                onChange={(e) => setCustomSql(e.target.value)}
                className="w-full bg-black/50 border border-blue-500/40 rounded-xl p-3 text-xs text-blue-300 font-mono focus:outline-none focus:border-blue-400 resize-y leading-relaxed"
                placeholder="Enter custom ALTER TABLE statement..."
              />
            ) : (
              <pre className="p-3 bg-black/40 border border-white/10 rounded-xl text-[11px] font-mono text-emerald-300 whitespace-pre-wrap max-h-24 overflow-y-auto leading-relaxed shadow-inner">
                {customSql || '-- Generated statement will appear here'}
              </pre>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 bg-black/20 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleExecute}
            className="px-5 py-2 rounded-xl text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>Execute Alteration</span>
          </button>
        </div>

      </div>
    </div>
  );
};
