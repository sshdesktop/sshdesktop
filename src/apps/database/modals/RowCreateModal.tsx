import React, { useState, useEffect } from 'react';
import { 
  X, 
  Plus, 
  Save, 
  Sparkles, 
  Code, 
  AlertCircle, 
  Check, 
  FileText, 
  Hash, 
  Key, 
  Layers, 
  Clock 
} from 'lucide-react';
import { DbEngine, ColumnDefinition } from '../types';
import { dbExecuteQuery } from '../../../lib/tauri-bridge';

export interface RowCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  engine: DbEngine;
  tableName: string;
  columns?: ColumnDefinition[];
  connectionId: string;
  database?: string;
  onSuccess: () => void;
}

export type RowCreateModelProps = RowCreateModalProps;

export const RowCreateModal: React.FC<RowCreateModalProps> = ({
  isOpen,
  onClose,
  engine,
  tableName,
  columns = [],
  connectionId,
  database,
  onSuccess,
}) => {
  const isDocumentStore = ['mongodb', 'dynamodb', 'cosmos'].includes(engine);
  const isRedis = engine === 'redis';

  // SQL & Column-based Form State
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [autoGenFields, setAutoGenFields] = useState<Record<string, boolean>>({});

  // NoSQL / JSON State
  const [jsonText, setJsonText] = useState<string>('{\n  \n}');
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Redis State
  const [redisKey, setRedisKey] = useState('');
  const [redisValue, setRedisValue] = useState('');
  const [redisTtl, setRedisTtl] = useState<string>('');

  // Execution State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewSql, setPreviewSql] = useState<string>('');
  const [isCustomSql, setIsCustomSql] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setErrorMessage(null);
    setJsonError(null);

    if (isDocumentStore) {
      if (engine === 'dynamodb') {
        setJsonText(JSON.stringify({
          pk: `item-${Date.now()}`,
          sk: 'metadata',
          attributes: {
            title: 'Sample Item',
            created_at: new Date().toISOString()
          }
        }, null, 2));
      } else if (engine === 'cosmos') {
        setJsonText(JSON.stringify({
          id: `doc-${Date.now()}`,
          name: 'New Document',
          category: 'General',
          is_active: true
        }, null, 2));
      } else {
        // MongoDB
        setJsonText(JSON.stringify({
          name: 'New Document',
          created_at: new Date().toISOString()
        }, null, 2));
      }
    } else if (isRedis) {
      setRedisKey(`key:${Date.now()}`);
      setRedisValue('Hello Redis');
      setRedisTtl('');
    } else {
      // SQL Columns
      const initial: Record<string, any> = {};
      const autoGen: Record<string, boolean> = {};

      columns.forEach(col => {
        const isAuto = col.autoIncrement || 
          col.extra?.toLowerCase().includes('auto_increment') || 
          col.type.toLowerCase().includes('serial') || 
          col.type.toLowerCase().includes('identity');

        if (isAuto) {
          autoGen[col.name] = true;
          initial[col.name] = '';
        } else {
          autoGen[col.name] = false;
          initial[col.name] = col.defaultValue !== null && col.defaultValue !== undefined ? col.defaultValue : '';
        }
      });

      setFormData(initial);
      setAutoGenFields(autoGen);
    }
  }, [isOpen, engine, tableName, columns]);

  // Update live SQL Preview
  useEffect(() => {
    if (isCustomSql || isDocumentStore || isRedis || !tableName) return;

    const colsToInsert: string[] = [];
    const valsToInsert: string[] = [];

    columns.forEach(col => {
      if (autoGenFields[col.name]) return; // Skip auto-increment columns

      const val = formData[col.name];
      if (val !== undefined && val !== '') {
        const colIdentifier = ['mysql', 'mariadb'].includes(engine) 
          ? `\`${col.name}\`` 
          : engine === 'mssql' 
            ? `[${col.name}]` 
            : `"${col.name}"`;
        colsToInsert.push(colIdentifier);

        if (val === null || val === 'NULL') {
          valsToInsert.push('NULL');
        } else if (typeof val === 'number' || (!isNaN(Number(val)) && ['int', 'integer', 'bigint', 'smallint', 'tinyint', 'float', 'double', 'decimal', 'numeric', 'real'].some(t => col.type.toLowerCase().includes(t)))) {
          valsToInsert.push(String(val));
        } else if (typeof val === 'boolean' || val === 'true' || val === 'false') {
          if (engine === 'mssql') {
            valsToInsert.push(val === true || val === 'true' ? '1' : '0');
          } else {
            valsToInsert.push(val === true || val === 'true' ? 'TRUE' : 'FALSE');
          }
        } else {
          valsToInsert.push(`'${String(val).replace(/'/g, "''")}'`);
        }
      }
    });

    const tblIdentifier = ['mysql', 'mariadb'].includes(engine) 
      ? `\`${tableName}\`` 
      : engine === 'mssql' 
        ? `[${tableName}]` 
        : `"${tableName}"`;

    if (colsToInsert.length === 0) {
      if (['mysql', 'mariadb'].includes(engine)) {
        setPreviewSql(`INSERT INTO ${tblIdentifier} () VALUES ();`);
      } else {
        setPreviewSql(`-- No manual column values specified; defaults/identity will be used.\nINSERT INTO ${tblIdentifier} DEFAULT VALUES;`);
      }
    } else {
      setPreviewSql(`INSERT INTO ${tblIdentifier} (${colsToInsert.join(', ')})\nVALUES (${valsToInsert.join(', ')});`);
    }
  }, [formData, autoGenFields, tableName, engine, columns, isDocumentStore, isRedis]);

  if (!isOpen) return null;

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setJsonError(null);
    } catch (e: any) {
      setJsonError(`JSON Syntax Error: ${e.message}`);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (isDocumentStore) {
        let parsed: any;
        try {
          parsed = JSON.parse(jsonText);
        } catch (err: any) {
          throw new Error(`Invalid JSON syntax: ${err.message}`);
        }

        if (engine === 'mongodb') {
          const query = `db.getCollection('${tableName}').insertOne(${JSON.stringify(parsed)});`;
          await dbExecuteQuery(connectionId, query);
        } else if (engine === 'dynamodb') {
          const query = JSON.stringify({
            Action: 'PutItem',
            TableName: tableName,
            Item: parsed
          });
          await dbExecuteQuery(connectionId, query);
        } else if (engine === 'cosmos') {
          const query = `INSERT INTO c VALUE ${JSON.stringify(parsed)};`;
          await dbExecuteQuery(connectionId, query);
        }
      } else if (isRedis) {
        if (!redisKey.trim()) throw new Error('Redis key cannot be empty');
        let cmd = `SET "${redisKey.trim()}" "${redisValue.replace(/"/g, '\\"')}"`;
        if (redisTtl && !isNaN(Number(redisTtl)) && Number(redisTtl) > 0) {
          cmd += ` EX ${Number(redisTtl)}`;
        }
        await dbExecuteQuery(connectionId, cmd);
      } else {
        // Execute SQL INSERT
        await dbExecuteQuery(connectionId, previewSql);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMessage(`Failed to create row: ${err?.message || err}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#1e1e2e]/95 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-150">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xl shadow-inner border border-emerald-500/30">
              <Plus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">
                Insert New Row
              </h2>
              <p className="text-xs text-gray-400">
                Target: <span className="text-emerald-400 font-mono font-medium">{tableName}</span> ({engine.toUpperCase()})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {errorMessage && (
            <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1. Document Stores (MongoDB, DynamoDB, Cosmos DB) */}
          {isDocumentStore && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-300 flex items-center gap-2">
                  <Code className="w-3.5 h-3.5 text-emerald-400" />
                  Document Payload (JSON)
                </label>
                <button
                  type="button"
                  onClick={handleFormatJson}
                  className="px-2.5 py-1 text-xs bg-white/5 hover:bg-white/10 text-emerald-400 border border-emerald-500/30 rounded-lg flex items-center gap-1.5 transition-colors shadow-sm"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Prettier Format
                </button>
              </div>

              {jsonError && (
                <div className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
                  {jsonError}
                </div>
              )}

              <div className="relative rounded-xl border border-white/10 bg-black/40 overflow-hidden font-mono text-xs">
                <textarea
                  rows={14}
                  value={jsonText}
                  onChange={e => setJsonText(e.target.value)}
                  className="w-full bg-transparent p-4 text-emerald-300 focus:outline-none resize-none leading-relaxed selection:bg-emerald-500/30"
                  spellCheck={false}
                  placeholder="Enter JSON document..."
                />
              </div>
            </div>
          )}

          {/* 2. Key-Value Store (Redis) */}
          {isRedis && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                  Key Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={redisKey}
                  onChange={e => setRedisKey(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:border-emerald-500/50 focus:outline-none"
                  placeholder="e.g. user:1001:profile"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                  Value Payload <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={5}
                  value={redisValue}
                  onChange={e => setRedisValue(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3.5 text-xs text-white font-mono focus:border-emerald-500/50 focus:outline-none resize-none"
                  placeholder="Enter string value or JSON payload..."
                  required
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                  Time-To-Live (TTL in seconds, optional)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={redisTtl}
                    onChange={e => setRedisTtl(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl pl-3.5 pr-10 py-2.5 text-xs text-white font-mono focus:border-emerald-500/50 focus:outline-none"
                    placeholder="Leave empty for persistent key (no expiration)"
                    min={1}
                  />
                  <Clock className="w-4 h-4 text-gray-500 absolute right-3.5 top-3" />
                </div>
              </div>
            </div>
          )}

          {/* 3. Relational & Tabular SQL Engines */}
          {!isDocumentStore && !isRedis && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {columns.length === 0 ? (
                  <div className="col-span-full p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>No column schema loaded for table "{tableName}". Default values will be used for insertion.</span>
                  </div>
                ) : (
                  columns.map(col => {
                    const isAuto = autoGenFields[col.name] ?? false;
                    const isPk = col.isPrimaryKey;

                    return (
                      <div 
                        key={col.name}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isAuto 
                            ? 'bg-blue-500/5 border-blue-500/20' 
                            : isPk 
                              ? 'bg-amber-500/5 border-amber-500/20' 
                              : 'bg-black/30 border-white/10'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isPk && <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                            <span className="text-xs font-medium text-white truncate font-mono" title={col.name}>
                              {col.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 font-mono">
                              {col.type}
                            </span>
                            {!col.nullable && (
                              <span className="text-[10px] text-red-400 px-1 font-bold" title="Required">
                                *
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Auto-increment toggle */}
                        {(col.autoIncrement || col.extra?.includes('auto_increment') || col.type.toLowerCase().includes('serial') || col.type.toLowerCase().includes('identity') || isPk) && (
                          <div className="mb-2 flex items-center justify-between bg-black/40 px-2 py-1 rounded-md text-[11px]">
                            <span className="text-blue-400 flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              Auto-Increment
                            </span>
                            <label className="flex items-center gap-1 cursor-pointer text-gray-400 hover:text-white">
                              <input
                                type="checkbox"
                                checked={isAuto}
                                onChange={e => {
                                  const checked = e.target.checked;
                                  setAutoGenFields(prev => ({ ...prev, [col.name]: checked }));
                                }}
                                className="w-3 h-3 rounded accent-blue-500"
                              />
                              <span>Auto-generate</span>
                            </label>
                          </div>
                        )}

                      {/* Input Field */}
                      {isAuto ? (
                        <div className="px-3 py-2 bg-black/20 border border-dashed border-blue-500/30 rounded-lg text-blue-400 text-xs italic font-mono">
                          (Generated automatically by server)
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={formData[col.name] ?? ''}
                          onChange={e => {
                            const val = e.target.value;
                            setFormData(prev => ({ ...prev, [col.name]: val }));
                          }}
                          placeholder={col.defaultValue ? `Default: ${col.defaultValue}` : col.nullable ? 'NULL' : 'Value...'}
                          className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:border-emerald-500/50 focus:outline-none"
                        />
                      )}
                    </div>
                  );
                }))}
              </div>

              {/* Live SQL Preview Box */}
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold text-gray-400 flex items-center gap-1.5">
                    <Code className="w-3 h-3 text-emerald-400" />
                    Generated Statement Preview
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-emerald-400 hover:text-emerald-300 transition-colors">
                    <input
                      type="checkbox"
                      checked={isCustomSql}
                      onChange={(e) => setIsCustomSql(e.target.checked)}
                      className="rounded text-emerald-500 focus:ring-0"
                    />
                    <span className="text-[10px] font-mono">Edit Raw SQL</span>
                  </label>
                </div>
                {isCustomSql ? (
                  <textarea
                    rows={3}
                    value={previewSql}
                    onChange={(e) => setPreviewSql(e.target.value)}
                    className="w-full bg-black/60 border border-emerald-500/40 rounded-xl p-3 text-xs text-emerald-300 font-mono focus:outline-none focus:border-emerald-400 resize-y leading-relaxed"
                    placeholder="Enter custom INSERT SQL statement..."
                  />
                ) : (
                  <pre className="p-3 bg-black/50 border border-white/10 rounded-xl text-emerald-400/90 font-mono text-[11px] overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner">
                    {previewSql}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-4 border-t border-white/10 flex items-center justify-between">
            <span className="text-xs text-gray-500">
              Changes take effect immediately upon insert.
            </span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/30 flex items-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    <span>Inserting...</span>
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    <span>Insert Row</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

      </div>
    </div>
  );
};

// Also export as RowCreateModel for interoperability
export const RowCreateModel = RowCreateModal;
export default RowCreateModal;
