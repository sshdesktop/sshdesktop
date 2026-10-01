import React, { useState, useEffect } from 'react';
import { Database, Play, Download, Table, Layers, CheckCircle2, ChevronRight, ChevronDown, RefreshCw, AlertCircle } from 'lucide-react';
import { sshExec } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

interface TableSchema {
  name: string;
  rowCount: number;
  columns: { name: string; type: string }[];
}

export default function DatabaseClient() {
  const [dbEngine, setDbEngine] = useState<'postgresql' | 'mysql' | 'sqlite'>('postgresql');
  const [selectedDb, setSelectedDb] = useState('postgres');
  const [sqlQuery, setSqlQuery] = useState('SELECT 1 as id, current_user, version();');
  const [results, setResults] = useState<any[]>([]);
  const [rawOutput, setRawOutput] = useState<string>('');
  const [execTime, setExecTime] = useState<string>('—');
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  const executeQuery = async () => {
    setExecuting(true);
    setError(null);
    const start = performance.now();
    try {
      let cmd = '';
      if (dbEngine === 'postgresql') {
        cmd = `sudo -u postgres psql -d ${selectedDb} -c "${sqlQuery.replace(/"/g, '\\"')}"`;
      } else if (dbEngine === 'mysql') {
        cmd = `mysql -e "${sqlQuery.replace(/"/g, '\\"')}"`;
      } else {
        cmd = `sqlite3 :memory: "${sqlQuery.replace(/"/g, '\\"')}"`;
      }

      const res = await sshExec(activeConnId, cmd);
      const elapsed = (performance.now() - start).toFixed(1);
      setExecTime(`${elapsed} ms`);

      if (res.exit_code !== 0 && res.stderr) {
        setError(res.stderr || res.stdout);
        setRawOutput(res.stderr || res.stdout);
        setResults([]);
      } else {
        const out = res.stdout.trim();
        setRawOutput(out);

        // Simple parser for psql/mysql tabular text output
        const lines = out.split('\n').filter(l => l.trim().length > 0);
        if (lines.length >= 2) {
          // If pipe or tabular
          const header = lines[0].split('|').map(s => s.trim()).filter(Boolean);
          if (header.length > 0 && lines[1].includes('-')) {
            const parsedRows = lines.slice(2).map(line => {
              if (line.includes('(') && line.includes('row')) return null;
              const values = line.split('|').map(s => s.trim());
              const rowObj: Record<string, string> = {};
              header.forEach((h, i) => {
                rowObj[h] = values[i] || '';
              });
              return rowObj;
            }).filter(Boolean);

            if (parsedRows.length > 0) {
              setResults(parsedRows as any[]);
            }
          }
        }
      }
    } catch (err: any) {
      setError(String(err));
    } finally {
      setExecuting(false);
    }
  };

  const columns = results.length > 0 ? Object.keys(results[0]) : [];

  return (
    <div className="flex h-full bg-[#181825] text-[#cdd6f4]">
      {/* Schema Browser Sidebar */}
      <div className="w-56 bg-[#1e1e2e] border-r border-white/[0.08] flex flex-col shrink-0 select-none">
        <div className="p-3 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <span className="font-bold text-xs text-white">Database Terminal</span>
          </div>
          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">Native</span>
        </div>

        <div className="p-2 border-b border-white/[0.08] space-y-2">
          <div>
            <label className="text-[10px] text-gray-400 block mb-1">Database Engine</label>
            <select
              value={dbEngine}
              onChange={e => {
                const val = e.target.value as any;
                setDbEngine(val);
                if (val === 'postgresql') setSqlQuery('SELECT 1 as id, current_user, version();');
                if (val === 'mysql') setSqlQuery('SELECT 1 as id, USER(), VERSION();');
                if (val === 'sqlite') setSqlQuery('SELECT sqlite_version();');
              }}
              className="w-full bg-[#11111b] border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none"
            >
              <option value="postgresql">PostgreSQL (psql)</option>
              <option value="mysql">MySQL / MariaDB</option>
              <option value="sqlite">SQLite3</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] text-gray-400 block mb-1">Target Database</label>
            <input
              type="text"
              value={selectedDb}
              onChange={e => setSelectedDb(e.target.value)}
              placeholder="e.g. postgres"
              className="w-full bg-[#11111b] border border-white/10 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
          <div className="text-gray-400 text-[11px] font-semibold">Quick Query Presets</div>
          <div className="space-y-1 text-xs font-mono">
            <button
              onClick={() => {
                setSqlQuery(dbEngine === 'postgresql' ? '\\dt;' : 'SHOW TABLES;');
              }}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-white/5 text-gray-300 hover:text-white truncate"
            >
              List All Tables
            </button>
            <button
              onClick={() => {
                setSqlQuery(dbEngine === 'postgresql' ? '\\l;' : 'SHOW DATABASES;');
              }}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-white/5 text-gray-300 hover:text-white truncate"
            >
              List Databases
            </button>
            <button
              onClick={() => {
                setSqlQuery(dbEngine === 'postgresql' ? 'SELECT * FROM pg_stat_activity;' : 'SHOW PROCESSLIST;');
              }}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-white/5 text-gray-300 hover:text-white truncate"
            >
              Active Connections
            </button>
          </div>
        </div>
      </div>

      {/* Query & Results Main Canvas */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* SQL Editor Top Pane */}
        <div className="h-44 bg-[#11111b] border-b border-white/[0.08] flex flex-col p-3 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400 font-mono">SQL Query (executed live on server via SSH)</span>
            <div className="flex items-center space-x-2">
              <span className="text-xs text-gray-500 font-mono">Exec time: {execTime}</span>
              <button
                onClick={executeQuery}
                disabled={executing}
                className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs px-3 py-1 rounded-md font-medium transition-colors"
              >
                {executing ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                <span>{executing ? 'Executing...' : 'Run Query'}</span>
              </button>
            </div>
          </div>

          <textarea
            value={sqlQuery}
            onChange={e => setSqlQuery(e.target.value)}
            className="flex-1 bg-[#181825] border border-white/10 rounded-lg p-2.5 font-mono text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
          />
        </div>

        {/* Results Bottom Pane */}
        <div className="flex-1 flex flex-col bg-[#181825] overflow-hidden">
          <div className="h-8 bg-[#1e1e2e] border-b border-white/[0.08] px-4 flex items-center justify-between text-xs text-gray-400 shrink-0">
            <span>Query Results: {results.length > 0 ? `${results.length} rows` : rawOutput ? 'Output available' : 'Ready'}</span>
            {results.length > 0 && (
              <button
                onClick={() => {
                  const csv = [columns.join(','), ...results.map(r => columns.map(c => JSON.stringify(r[c] || '')).join(','))].join('\n');
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `query_result_${Date.now()}.csv`;
                  a.click();
                }}
                className="hover:text-white flex items-center space-x-1 text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto p-2">
            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs font-mono rounded-lg mb-2">
                <div className="font-bold flex items-center space-x-1 mb-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Execution Error</span>
                </div>
                <pre className="whitespace-pre-wrap">{error}</pre>
              </div>
            )}

            {results.length > 0 ? (
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#11111b] text-gray-400 border-b border-white/[0.08] sticky top-0">
                  <tr>
                    {columns.map(col => (
                      <th key={col} className="py-2 px-3">{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05]">
                  {results.map((row, idx) => (
                    <tr key={idx} className="hover:bg-white/[0.02]">
                      {columns.map(col => (
                        <td key={col} className="py-2 px-3 text-gray-200 truncate max-w-xs">{row[col]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : rawOutput ? (
              <pre className="p-3 bg-[#11111b] text-xs font-mono text-gray-300 rounded-lg whitespace-pre-wrap">
                {rawOutput}
              </pre>
            ) : (
              <div className="text-gray-500 text-xs text-center py-12">
                Run a SQL query above to see live server database records
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
