import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  Table,
  Key,
  Check,
  AlertCircle,
  Database,
  ArrowRight,
  Code
} from 'lucide-react';
import { DbEngine, ColumnDefinition } from '../types';
import { dbExecuteOperation, dbExecuteQuery } from '../../../lib/tauri-bridge';

interface CreateTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  engine: DbEngine;
  connectionId: string;
  database: string;
  schema?: string;
  onCreated: (tableName: string) => void;
}

interface ColumnDraft {
  id: string;
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  autoIncrement: boolean;
  defaultValue: string;
  isPartitionKey?: boolean;
  isClusteringKey?: boolean;
}

const COMMON_SQL_TYPES: Record<DbEngine, string[]> = {
  postgresql: ['VARCHAR(255)', 'TEXT', 'INTEGER', 'BIGINT', 'SERIAL', 'BIGSERIAL', 'BOOLEAN', 'TIMESTAMP', 'TIMESTAMPTZ', 'DATE', 'NUMERIC(10,2)', 'JSONB', 'UUID'],
  mysql: ['VARCHAR(255)', 'TEXT', 'INT', 'BIGINT', 'TINYINT(1)', 'DATETIME', 'TIMESTAMP', 'DATE', 'DECIMAL(10,2)', 'JSON', 'BLOB'],
  mariadb: ['VARCHAR(255)', 'TEXT', 'INT', 'BIGINT', 'TINYINT(1)', 'DATETIME', 'TIMESTAMP', 'DATE', 'DECIMAL(10,2)', 'JSON'],
  sqlite: ['TEXT', 'INTEGER', 'REAL', 'BLOB', 'NUMERIC'],
  mssql: ['VARCHAR(255)', 'NVARCHAR(255)', 'TEXT', 'INT', 'BIGINT', 'BIT', 'DATETIME2', 'DATE', 'DECIMAL(18,2)', 'UNIQUEIDENTIFIER'],
  oracle: ['VARCHAR2(255)', 'NUMBER', 'CLOB', 'BLOB', 'DATE', 'TIMESTAMP', 'RAW(16)'],
  db2: ['VARCHAR(255)', 'INTEGER', 'BIGINT', 'SMALLINT', 'DECIMAL(10,2)', 'TIMESTAMP', 'DATE', 'CLOB'],
  cassandra: ['text', 'varchar', 'int', 'bigint', 'boolean', 'timestamp', 'uuid', 'timeuuid', 'float', 'double', 'map<text, text>', 'set<text>'],
  mongodb: [],
  redis: [],
  dynamodb: ['String (S)', 'Number (N)', 'Binary (B)'],
  cosmos: ['String', 'Number', 'Boolean', 'Object', 'Array'],
};

export const CreateTableModal: React.FC<CreateTableModalProps> = ({
  isOpen,
  onClose,
  engine,
  connectionId,
  database,
  schema,
  onCreated,
}) => {
  const [tableName, setTableName] = useState('');
  const [columns, setColumns] = useState<ColumnDraft[]>([
    {
      id: 'col-1',
      name: engine === 'cassandra' || engine === 'dynamodb' ? 'id' : 'id',
      type: engine === 'postgresql' ? 'BIGSERIAL' : engine === 'cassandra' ? 'uuid' : engine === 'dynamodb' ? 'String (S)' : 'INT',
      nullable: false,
      isPrimaryKey: true,
      autoIncrement: engine !== 'cassandra' && engine !== 'dynamodb',
      defaultValue: '',
      isPartitionKey: true,
    },
    {
      id: 'col-2',
      name: 'name',
      type: engine === 'cassandra' ? 'text' : engine === 'dynamodb' ? 'String (S)' : 'VARCHAR(255)',
      nullable: true,
      isPrimaryKey: false,
      autoIncrement: false,
      defaultValue: '',
    },
  ]);

  // MongoDB Collection options
  const [mongoCapped, setMongoCapped] = useState(false);
  const [mongoSize, setMongoSize] = useState(1048576);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live SQL preview & Custom Query Edit Mode
  const [isCustomSql, setIsCustomSql] = useState(false);
  const [customSql, setCustomSql] = useState('');

  // Generate DDL SQL dynamically
  const buildGeneratedSql = (): string => {
    const tbl = tableName.trim() || 'new_table';

    if (engine === 'mongodb') {
      return mongoCapped
        ? `db.createCollection("${tbl}", { capped: true, size: ${mongoSize} })`
        : `db.createCollection("${tbl}")`;
    }

    if (engine === 'cassandra') {
      const pks = columns.filter(c => c.isPartitionKey || c.isPrimaryKey).map(c => `"${c.name}"`).join(', ');
      const colDefs = columns.map(c => `"${c.name}" ${c.type}`).join(',\n  ');
      return `CREATE TABLE IF NOT EXISTS "${database}"."${tbl}" (\n  ${colDefs},\n  PRIMARY KEY (${pks || '"id"'})\n);`;
    }

    if (engine === 'dynamodb') {
      const pkCol = columns.find(c => c.isPrimaryKey) || columns[0];
      return JSON.stringify({
        operation: 'create_table',
        table: tbl,
        partition_key: pkCol.name,
        key_type: pkCol.type.includes('N') ? 'N' : 'S'
      }, null, 2);
    }

    // Relational SQL
    const isMysql = ['mysql', 'mariadb'].includes(engine);
    const isMssql = engine === 'mssql';
    const quote = isMysql ? '`' : isMssql ? '[' : '"';
    const quoteEnd = isMysql ? '`' : isMssql ? ']' : '"';

    const colLines = columns.map(c => {
      let line = `  ${quote}${c.name}${quoteEnd} ${c.type}`;
      if (c.autoIncrement) {
        if (isMysql) line += ' AUTO_INCREMENT';
        else if (isMssql) line += ' IDENTITY(1,1)';
        else if (engine === 'sqlite') line += ' PRIMARY KEY AUTOINCREMENT';
        else if (['oracle', 'db2'].includes(engine)) line += ' GENERATED ALWAYS AS IDENTITY';
      }
      if (!c.nullable && !c.autoIncrement) {
        line += ' NOT NULL';
      }
      if (c.defaultValue) {
        line += ` DEFAULT ${c.defaultValue}`;
      }
      return line;
    });

    const pkCols = columns.filter(c => c.isPrimaryKey && !c.autoIncrement).map(c => `${quote}${c.name}${quoteEnd}`);
    if (pkCols.length > 0 && engine !== 'sqlite') {
      colLines.push(`  PRIMARY KEY (${pkCols.join(', ')})`);
    }

    const fullTableName = schema && !isMysql
      ? `${quote}${schema}${quoteEnd}.${quote}${tbl}${quoteEnd}`
      : `${quote}${tbl}${quoteEnd}`;

    return `CREATE TABLE ${fullTableName} (\n${colLines.join(',\n')}\n);`;
  };

  // Keep customSql synced when not in manual edit mode
  useEffect(() => {
    if (!isCustomSql) {
      setCustomSql(buildGeneratedSql());
    }
  }, [tableName, columns, mongoCapped, mongoSize, isCustomSql, engine, database, schema]);

  if (!isOpen) return null;

  const handleAddColumn = () => {
    const types = COMMON_SQL_TYPES[engine] || ['VARCHAR(255)'];
    setColumns(prev => [
      ...prev,
      {
        id: `col-${Date.now()}`,
        name: `column_${prev.length + 1}`,
        type: types[0] || 'VARCHAR(255)',
        nullable: true,
        isPrimaryKey: false,
        autoIncrement: false,
        defaultValue: '',
      },
    ]);
  };

  const handleRemoveColumn = (id: string) => {
    if (columns.length <= 1) return;
    setColumns(prev => prev.filter(c => c.id !== id));
  };

  const handleUpdateColumn = (id: string, updates: Partial<ColumnDraft>) => {
    setColumns(prev =>
      prev.map(c => (c.id === id ? { ...c, ...updates } : c))
    );
  };

  const handleSubmit = async () => {
    if (!tableName.trim()) {
      setError('Table / Collection name is required.');
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      // If user customized the SQL manually, execute custom SQL directly!
      if (isCustomSql && customSql.trim()) {
        await dbExecuteQuery(connectionId, customSql.trim());
        onCreated(tableName.trim());
        onClose();
        return;
      }

      if (engine === 'mongodb') {
        const createCmd = mongoCapped
          ? `db.createCollection("${tableName.trim()}", { capped: true, size: ${mongoSize} })`
          : `db.createCollection("${tableName.trim()}")`;
        await dbExecuteQuery(connectionId, createCmd);
        onCreated(tableName.trim());
        onClose();
        return;
      }

      if (engine === 'cassandra') {
        const pks = columns.filter(c => c.isPartitionKey || c.isPrimaryKey).map(c => `"${c.name}"`).join(', ');
        const colDefs = columns.map(c => `"${c.name}" ${c.type}`).join(', ');
        const cql = `CREATE TABLE IF NOT EXISTS "${database}"."${tableName.trim()}" (${colDefs}, PRIMARY KEY (${pks || '"id"'}));`;
        await dbExecuteQuery(connectionId, cql);
        onCreated(tableName.trim());
        onClose();
        return;
      }

      if (engine === 'dynamodb') {
        // Amazon DynamoDB create table command via JSON syntax
        const pkCol = columns.find(c => c.isPrimaryKey) || columns[0];
        const ddbCreate = JSON.stringify({
          operation: 'create_table',
          table: tableName.trim(),
          partition_key: pkCol.name,
          key_type: pkCol.type.includes('N') ? 'N' : 'S'
        });
        await dbExecuteQuery(connectionId, ddbCreate);
        onCreated(tableName.trim());
        onClose();
        return;
      }

      // SQL Engines (Postgres, MySQL, MariaDB, SQLite, MSSQL, Oracle, DB2)
      await dbExecuteOperation(connectionId, {
        operation: 'create_table',
        database: database || undefined,
        schema: schema || undefined,
        table: tableName.trim(),
        columns: columns.map(c => ({
          name: c.name.trim(),
          data_type: c.type,
          nullable: c.nullable,
          primary_key: c.isPrimaryKey,
          auto_increment: c.autoIncrement,
          default_value: c.defaultValue.trim() || undefined,
        })),
      });

      onCreated(tableName.trim());
      onClose();
    } catch (err: any) {
      setError(`Failed to create table: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#1e1e2e]/95 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-150">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shadow-inner border border-emerald-500/30">
              <Table className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">
                {engine === 'mongodb' ? 'Create MongoDB Collection' : 'Create New Table'}
              </h2>
              <p className="text-xs text-gray-400">
                {engine.toUpperCase()} • Database: <span className="font-mono text-gray-300">{database}</span>
                {schema && ` • Schema: ${schema}`}
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

        {/* Form Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              {engine === 'mongodb' ? 'Collection Name *' : 'Table Name *'}
            </label>
            <input
              type="text"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              placeholder="e.g. users, orders, audit_logs"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {engine === 'mongodb' ? (
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-300">Capped Collection (Fixed Size FIFO)</span>
                <input
                  type="checkbox"
                  checked={mongoCapped}
                  onChange={(e) => setMongoCapped(e.target.checked)}
                  className="rounded text-emerald-600 focus:ring-0"
                />
              </div>
              {mongoCapped && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Max Byte Size</label>
                  <input
                    type="number"
                    value={mongoSize}
                    onChange={(e) => setMongoSize(parseInt(e.target.value) || 1048576)}
                    className="w-full px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white font-mono"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  Columns Specification
                </span>
                <button
                  type="button"
                  onClick={handleAddColumn}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Column</span>
                </button>
              </div>

              <div className="space-y-2">
                {columns.map((col, idx) => (
                  <div
                    key={col.id}
                    className="p-3 rounded-xl bg-white/5 border border-white/10 grid grid-cols-12 gap-2.5 items-center text-xs"
                  >
                    <div className="col-span-3">
                      <input
                        type="text"
                        value={col.name}
                        onChange={(e) => handleUpdateColumn(col.id, { name: e.target.value })}
                        placeholder="Column Name"
                        className="w-full px-2.5 py-1.5 bg-black/30 border border-white/10 rounded-lg text-white font-mono placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>

                    <div className="col-span-3">
                      <input
                        type="text"
                        list={`types-${engine}`}
                        value={col.type}
                        onChange={(e) => handleUpdateColumn(col.id, { type: e.target.value })}
                        placeholder="Data Type"
                        className="w-full px-2.5 py-1.5 bg-black/30 border border-white/10 rounded-lg text-white font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      <datalist id={`types-${engine}`}>
                        {(COMMON_SQL_TYPES[engine] || []).map(t => (
                          <option key={t} value={t} />
                        ))}
                      </datalist>
                    </div>

                    {/* Primary Key Checkbox */}
                    <div className="col-span-1 flex items-center justify-center">
                      <label className="flex items-center gap-1 cursor-pointer" title="Primary Key">
                        <input
                          type="checkbox"
                          checked={col.isPrimaryKey}
                          onChange={(e) => handleUpdateColumn(col.id, { isPrimaryKey: e.target.checked })}
                          className="rounded text-amber-500 focus:ring-0"
                        />
                        <span className="text-[10px] text-amber-400 font-bold">PK</span>
                      </label>
                    </div>

                    {/* Auto Increment Checkbox */}
                    <div className="col-span-2 flex items-center justify-center">
                      <label className="flex items-center gap-1 cursor-pointer" title="Auto Increment">
                        <input
                          type="checkbox"
                          checked={col.autoIncrement}
                          onChange={(e) => handleUpdateColumn(col.id, { autoIncrement: e.target.checked })}
                          className="rounded text-blue-500 focus:ring-0"
                        />
                        <span className="text-[10px] text-blue-400 font-medium">Auto Inc</span>
                      </label>
                    </div>

                    {/* Nullable Checkbox */}
                    <div className="col-span-2 flex items-center justify-center">
                      <label className="flex items-center gap-1 cursor-pointer" title="Allow NULL">
                        <input
                          type="checkbox"
                          checked={col.nullable}
                          onChange={(e) => handleUpdateColumn(col.id, { nullable: e.target.checked })}
                          className="rounded text-gray-400 focus:ring-0"
                        />
                        <span className="text-[10px] text-gray-400">NULL</span>
                      </label>
                    </div>

                    <div className="col-span-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleRemoveColumn(col.id)}
                        disabled={columns.length <= 1}
                        className="p-1 rounded text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-30"
                        title="Remove Column"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Live Generated SQL Preview & Manual Edit Box */}
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-gray-300 flex items-center gap-1.5">
                <Code className="w-3.5 h-3.5 text-blue-400" />
                <span>{engine === 'mongodb' || engine === 'dynamodb' ? 'Generated Command' : 'Generated DDL Statement'}</span>
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
                rows={4}
                value={customSql}
                onChange={(e) => setCustomSql(e.target.value)}
                className="w-full bg-black/50 border border-blue-500/40 rounded-xl p-3 text-xs text-blue-300 font-mono focus:outline-none focus:border-blue-400 resize-y leading-relaxed"
                placeholder="Enter custom CREATE TABLE statement..."
              />
            ) : (
              <pre className="p-3 bg-black/40 border border-white/10 rounded-xl text-[11px] font-mono text-emerald-300 whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed shadow-inner">
                {customSql || '-- Specify table name and columns to preview statement'}
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
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="px-5 py-2 rounded-xl text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Creating Table...</span>
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Create Table</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
