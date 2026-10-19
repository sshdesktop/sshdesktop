import React, { useState, useEffect } from 'react';
import {
  X,
  Check,
  AlertCircle,
  FileCode,
  Sparkles,
  Database,
  Code2
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { DbEngine, ColumnDefinition } from '../types';
import { dbExecuteQuery, mongodbInsertDocument } from '../../../lib/tauri-bridge';

interface RowEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  engine: DbEngine;
  connectionId: string;
  tableName: string;
  database?: string;
  schema?: string;
  columns?: ColumnDefinition[];
  initialRow?: Record<string, any> | null;
  onSaved: () => void;
}

export const RowEditorModal: React.FC<RowEditorModalProps> = ({
  isOpen,
  onClose,
  engine,
  connectionId,
  tableName,
  database = '',
  schema,
  columns = [],
  initialRow,
  onSaved,
}) => {
  const isEditing = Boolean(initialRow);
  const isDocDb = engine === 'mongodb' || engine === 'dynamodb' || engine === 'cosmos';

  // State for SQL field form
  const [formData, setFormData] = useState<Record<string, any>>({});
  
  // State for Document JSON
  const [docJson, setDocJson] = useState<string>('{}');

  // Live SQL preview & Custom Query Edit Mode
  const [isCustomSql, setIsCustomSql] = useState(false);
  const [customSql, setCustomSql] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate UPDATE SQL dynamically
  const buildGeneratedSql = (): string => {
    if (isDocDb) return docJson;
    const pkCol = columns.find(c => c.isPrimaryKey) || columns[0];
    if (!pkCol) return '';
    const isMysql = ['mysql', 'mariadb'].includes(engine);
    const isMssql = engine === 'mssql';
    const quote = isMysql ? '`' : isMssql ? '[' : '"';
    const quoteEnd = isMysql ? '`' : isMssql ? ']' : '"';
    const tblId = `${quote}${tableName}${quoteEnd}`;

    const setClauses: string[] = [];
    Object.entries(formData).forEach(([k, v]) => {
      if (k !== pkCol.name) {
        if (v === null || v === '' || v === undefined) {
          setClauses.push(`${quote}${k}${quoteEnd} = NULL`);
        } else if (typeof v === 'number' || typeof v === 'boolean') {
          setClauses.push(`${quote}${k}${quoteEnd} = ${v}`);
        } else {
          setClauses.push(`${quote}${k}${quoteEnd} = '${String(v).replace(/'/g, "''")}'`);
        }
      }
    });

    const pkVal = (initialRow || formData)?.[pkCol.name];
    const whereClause = typeof pkVal === 'number'
      ? `${quote}${pkCol.name}${quoteEnd} = ${pkVal}`
      : `${quote}${pkCol.name}${quoteEnd} = '${String(pkVal).replace(/'/g, "''")}'`;
    return `UPDATE ${tblId} SET ${setClauses.join(', ')} WHERE ${whereClause};`;
  };

  useEffect(() => {
    if (!isCustomSql) {
      setCustomSql(buildGeneratedSql());
    }
  }, [formData, initialRow, columns, isDocDb, isCustomSql]);

  useEffect(() => {
    if (initialRow) {
      setFormData({ ...initialRow });
      try {
        setDocJson(JSON.stringify(initialRow, null, 2));
      } catch {
        setDocJson(String(initialRow));
      }
    } else {
      // Initialize empty form
      const emptyForm: Record<string, any> = {};
      columns.forEach(c => {
        if (!c.autoIncrement) {
          emptyForm[c.name] = '';
        }
      });
      setFormData(emptyForm);

      if (isDocDb) {
        setDocJson('{\n  \n}');
      }
    }
    setError(null);
  }, [initialRow, columns, isDocDb, isOpen]);

  if (!isOpen) return null;

  // Prettier formatter for JSON documents
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(docJson);
      setDocJson(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (e: any) {
      setError(`Invalid JSON: ${e.message}`);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setIsSubmitting(true);

    try {
      if (isCustomSql && customSql.trim()) {
        await dbExecuteQuery(connectionId, customSql.trim());
        onSaved();
        onClose();
        return;
      }

      if (isDocDb) {
        let parsed: any;
        try {
          parsed = JSON.parse(docJson);
        } catch (e: any) {
          setError(`Invalid JSON document: ${e.message}`);
          setIsSubmitting(false);
          return;
        }

        if (engine === 'mongodb') {
          if (isEditing && initialRow?._id) {
            const idVal = typeof initialRow._id === 'object' ? JSON.stringify(initialRow._id) : `"${initialRow._id}"`;
            const updateCmd = `db.${tableName}.replaceOne({ _id: ${idVal} }, ${JSON.stringify(parsed)})`;
            await dbExecuteQuery(connectionId, updateCmd);
          } else {
            await mongodbInsertDocument(connectionId, tableName, parsed);
          }
        } else if (engine === 'dynamodb') {
          const ddbCmd = JSON.stringify({
            operation: 'put_item',
            table: tableName,
            item: parsed
          });
          await dbExecuteQuery(connectionId, ddbCmd);
        } else if (engine === 'cosmos') {
          const cosmosCmd = JSON.stringify({
            operation: 'upsert_item',
            container: tableName,
            item: parsed
          });
          await dbExecuteQuery(connectionId, cosmosCmd);
        }

        onSaved();
        onClose();
        return;
      }

      // SQL Engines Mutation
      const isMysql = ['mysql', 'mariadb'].includes(engine);
      const isMssql = engine === 'mssql';
      const quote = isMysql ? '`' : isMssql ? '[' : '"';
      const quoteEnd = isMysql ? '`' : isMssql ? ']' : '"';
      const tblId = `${quote}${tableName}${quoteEnd}`;

      if (isEditing) {
        // Update row
        const pkCol = columns.find(c => c.isPrimaryKey) || columns[0];
        if (!pkCol) throw new Error('Cannot update row without a primary key.');
        
        const setClauses: string[] = [];
        Object.entries(formData).forEach(([k, v]) => {
          if (k !== pkCol.name) {
            if (v === null || v === '' || v === undefined) {
              setClauses.push(`${quote}${k}${quoteEnd} = NULL`);
            } else if (typeof v === 'number' || typeof v === 'boolean') {
              setClauses.push(`${quote}${k}${quoteEnd} = ${v}`);
            } else {
              setClauses.push(`${quote}${k}${quoteEnd} = '${String(v).replace(/'/g, "''")}'`);
            }
          }
        });

        const pkVal = (initialRow || formData)?.[pkCol.name];
        const whereClause = typeof pkVal === 'number' ? `${quote}${pkCol.name}${quoteEnd} = ${pkVal}` : `${quote}${pkCol.name}${quoteEnd} = '${String(pkVal).replace(/'/g, "''")}'`;
        const updateSql = `UPDATE ${tblId} SET ${setClauses.join(', ')} WHERE ${whereClause};`;
        await dbExecuteQuery(connectionId, updateSql);
      } else {
        // Insert row
        const colsToInsert: string[] = [];
        const valsToInsert: string[] = [];

        Object.entries(formData).forEach(([k, v]) => {
          const colDef = columns.find(c => c.name === k);
          if (colDef?.autoIncrement && (v === '' || v === undefined || v === null)) {
            // Skip auto-increment column on insert
            return;
          }
          colsToInsert.push(`${quote}${k}${quoteEnd}`);
          if (v === null || v === '' || v === undefined) {
            valsToInsert.push('NULL');
          } else if (typeof v === 'number' || typeof v === 'boolean') {
            valsToInsert.push(String(v));
          } else {
            valsToInsert.push(`'${String(v).replace(/'/g, "''")}'`);
          }
        });

        if (colsToInsert.length === 0) {
          throw new Error('Please fill in at least one field.');
        }

        const insertSql = `INSERT INTO ${tblId} (${colsToInsert.join(', ')}) VALUES (${valsToInsert.join(', ')});`;
        await dbExecuteQuery(connectionId, insertSql);
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setError(`Mutation failed: ${err?.message || err}`);
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
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center shadow-inner border border-purple-500/30">
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">
                {isEditing ? 'Edit Record' : 'Add New Record'}
              </h2>
              <p className="text-xs text-gray-400">
                Table: <span className="font-mono text-purple-400">{tableName}</span>
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

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {isDocDb ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  BSON / JSON Document
                </span>
                <button
                  type="button"
                  onClick={handleFormatJson}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30 flex items-center gap-1.5 transition-colors"
                  title="VS Code Prettier Format JSON"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                  <span>Format (Prettier)</span>
                </button>
              </div>

              <div className="h-72 rounded-xl overflow-hidden border border-white/10">
                <Editor
                  height="100%"
                  language="json"
                  theme="vs-dark"
                  value={docJson}
                  onChange={(val) => setDocJson(val || '')}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    wordWrap: 'on',
                    formatOnPaste: true,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {columns.map(col => {
                const isAuto = col.autoIncrement && !isEditing;
                return (
                  <div key={col.name} className="grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-4 text-right">
                      <div className="text-xs font-medium text-gray-300 flex items-center justify-end gap-1.5 font-mono">
                        {col.isPrimaryKey && <span className="text-[10px] text-amber-400 font-bold">[PK]</span>}
                        <span>{col.name}</span>
                      </div>
                      <div className="text-[10px] text-gray-500 font-mono">
                        {col.type} {col.autoIncrement ? '• Auto-inc' : ''}
                      </div>
                    </div>

                    <div className="col-span-8">
                      {isAuto ? (
                        <div className="px-3 py-2 bg-white/5 border border-dashed border-white/10 rounded-xl text-xs text-gray-500 italic">
                          (Generated Automatically)
                        </div>
                      ) : (
                        <input
                          type="text"
                          value={formData[col.name] !== undefined && formData[col.name] !== null ? String(formData[col.name]) : ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, [col.name]: e.target.value }))}
                          placeholder={col.nullable ? 'NULL' : 'Required value'}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Live Generated SQL Preview & Manual Edit Box */}
          {!isDocDb && (
            <div className="pt-2 border-t border-white/10 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <label className="font-semibold text-gray-300 flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-purple-400" />
                  <span>Generated Mutation Statement</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer text-purple-400 hover:text-purple-300 transition-colors">
                  <input
                    type="checkbox"
                    checked={isCustomSql}
                    onChange={(e) => setIsCustomSql(e.target.checked)}
                    className="rounded text-purple-500 focus:ring-0"
                  />
                  <span className="text-[11px] font-medium">Edit Raw Statement</span>
                </label>
              </div>

              {isCustomSql ? (
                <textarea
                  rows={3}
                  value={customSql}
                  onChange={(e) => setCustomSql(e.target.value)}
                  className="w-full bg-black/50 border border-purple-500/40 rounded-xl p-3 text-xs text-purple-300 font-mono focus:outline-none focus:border-purple-400 resize-y leading-relaxed"
                  placeholder="Enter custom SQL UPDATE statement..."
                />
              ) : (
                <pre className="p-3 bg-black/40 border border-white/10 rounded-xl text-[11px] font-mono text-emerald-300 whitespace-pre-wrap max-h-24 overflow-y-auto leading-relaxed shadow-inner">
                  {customSql || '-- Generated statement will appear here'}
                </pre>
              )}
            </div>
          )}
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
            className="px-5 py-2 rounded-xl text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
          >
            {isSubmitting ? (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            <span>{isEditing ? 'Save Changes' : 'Insert Row'}</span>
          </button>
        </div>

      </div>
    </div>
  );
};
