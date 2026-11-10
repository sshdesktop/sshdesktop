import React, { useState } from 'react';
import { 
  Table, 
  Download, 
  Copy, 
  Trash2, 
  Edit3, 
  Plus, 
  Search, 
  ChevronUp, 
  ChevronDown, 
  FileText, 
  Check, 
  AlertCircle,
  Database,
  ArrowUpDown,
  MoreVertical,
  CheckCircle2,
  Clock,
  Layers
} from 'lucide-react';
import { BatchStatementResult } from '../types';
import { ConfirmModal } from './ConfirmModal';

interface MultiResultViewerProps {
  tableName?: string | null;
  columns: string[];
  rows: any[];
  allResults?: BatchStatementResult[];
  activeResultIndex?: number;
  onSelectResultIndex?: (idx: number) => void;
  execTime?: string;
  error?: string | null;
  successInfo?: string | null;
  onAddRow?: () => void;
  onEditRow?: (row: any) => void;
  onDeleteRow?: (row: any) => void;
  primaryKeyCol?: string;
}

export const MultiResultViewer: React.FC<MultiResultViewerProps> = ({
  tableName,
  columns = [],
  rows = [],
  allResults = [],
  activeResultIndex = 0,
  onSelectResultIndex,
  execTime = '—',
  error,
  successInfo,
  onAddRow,
  onEditRow,
  onDeleteRow,
  primaryKeyCol,
}) => {
  // Filter & Search
  const [searchTerm, setSearchTerm] = useState('');
  
  // Sorting
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Selected Row for Context Menu / Deletion
  const [selectedRow, setSelectedRow] = useState<any | null>(null);
  const [rowToDelete, setRowToDelete] = useState<any | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Copy Feedback Toast
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);

  // Determine current active result set
  const currentBatch = allResults && allResults.length > 0 && allResults[activeResultIndex]
    ? allResults[activeResultIndex]
    : null;

  const rawRows: any[] = currentBatch ? (currentBatch.rows || []) : (rows || []);
  const safeRows = Array.isArray(rawRows) ? rawRows : [];

  let initialCols: string[] = currentBatch
    ? (currentBatch.columns || []).map((c: any) => typeof c === 'string' ? c : (c?.name || ''))
    : (columns || []).map((c: any) => typeof c === 'string' ? c : (c?.name || ''));

  initialCols = initialCols.filter(Boolean);

  // If columns are empty but rows exist (e.g. MongoDB documents), extract keys!
  if (initialCols.length === 0 && safeRows.length > 0) {
    const keySet = new Set<string>();
    safeRows.slice(0, 50).forEach((r: any) => {
      if (r && typeof r === 'object') {
        Object.keys(r).forEach((k) => keySet.add(k));
      }
    });
    initialCols = Array.from(keySet);
    if (initialCols.length === 0) {
      initialCols = ['Value'];
    }
  }

  const displayColumns: string[] = initialCols;
  const displayRows: any[] = safeRows;

  // Filter rows safely without crashing on nulls/primitives
  const filteredRows = displayRows.filter((r) => {
    if (!searchTerm) return true;
    if (r === null || r === undefined) return false;
    if (typeof r !== 'object') {
      return String(r).toLowerCase().includes(searchTerm.toLowerCase());
    }
    return Object.values(r).some((val) =>
      val !== null && val !== undefined && String(val).toLowerCase().includes(searchTerm.toLowerCase())
    );
  });

  // Sort rows safely
  const sortedRows = [...filteredRows].sort((a, b) => {
    if (!sortCol) return 0;
    const valA = (a && typeof a === 'object') ? a[sortCol] : a;
    const valB = (b && typeof b === 'object') ? b[sortCol] : b;
    if (valA === valB) return 0;
    if (valA === null || valA === undefined) return 1;
    if (valB === null || valB === undefined) return -1;
    const comp = valA > valB ? 1 : -1;
    return sortDir === 'asc' ? comp : -comp;
  });

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  // Copy helpers
  const handleCopyRowAsJson = (row: any) => {
    if (row === null || row === undefined) return;
    navigator.clipboard.writeText(typeof row === 'object' ? JSON.stringify(row, null, 2) : String(row));
    setCopiedLabel('Copied as JSON');
    setTimeout(() => setCopiedLabel(null), 2000);
  };

  const handleCopyRowAsSql = (row: any) => {
    if (!row || typeof row !== 'object') return;
    const tbl = tableName || 'table_name';
    const cols = Object.keys(row).join(', ');
    const vals = Object.values(row)
      .map((v) => (v === null ? 'NULL' : typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`))
      .join(', ');
    const sql = `INSERT INTO ${tbl} (${cols}) VALUES (${vals});`;
    navigator.clipboard.writeText(sql);
    setCopiedLabel('Copied SQL INSERT');
    setTimeout(() => setCopiedLabel(null), 2000);
  };

  const handleCopyRowAsCsv = (row: any) => {
    if (!row) return;
    const csv = (typeof row === 'object' ? Object.values(row) : [row])
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',');
    navigator.clipboard.writeText(csv);
    setCopiedLabel('Copied CSV');
    setTimeout(() => setCopiedLabel(null), 2000);
  };

  const handleExportCsv = () => {
    if (sortedRows.length === 0) return;
    const header = displayColumns.join(',');
    const body = sortedRows
      .map((r) => displayColumns.map((c) => `"${String(r && typeof r === 'object' ? r[c] ?? '' : r ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tableName || 'query_results'}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[#161622]">
      
      {/* 1. Multi-Result Tabs Bar (if multiple statements were executed) */}
      {allResults && allResults.length > 1 && (
        <div className="h-8 border-b border-white/10 bg-black/30 flex items-center px-2 gap-1 overflow-x-auto shrink-0 select-none">
          {allResults.map((res, idx) => {
            const isTabActive = idx === activeResultIndex;
            return (
              <button
                key={idx}
                onClick={() => onSelectResultIndex && onSelectResultIndex(idx)}
                className={`px-3 py-1 rounded-md text-xs font-mono flex items-center gap-1.5 transition-all shrink-0 ${
                  isTabActive
                    ? 'bg-blue-600 text-white font-semibold shadow-sm'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Layers className="w-3 h-3" />
                <span>Result #{idx + 1}</span>
                <span className="text-[10px] px-1 rounded bg-black/30 opacity-80">
                  {res.rows ? `${res.rows.length}r` : `${res.affected_rows} aff`}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 2. Grid Toolbar (Filter, Add Row, Export, Status) */}
      <div className="h-9 px-3 border-b border-white/10 bg-black/20 flex items-center justify-between text-xs shrink-0 select-none">
        
        {/* Left: Search filter & Row Action */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-500 absolute left-2.5 top-2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter results..."
              className="bg-black/30 border border-white/10 rounded-lg pl-8 pr-2.5 py-1 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 w-36 sm:w-48 font-mono"
            />
          </div>

          {onAddRow && (
            <button
              onClick={onAddRow}
              className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/30 flex items-center gap-1 transition-colors"
              title="Add New Row (RowCreateModal)"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Row</span>
            </button>
          )}

          {copiedLabel && (
            <span className="text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1 font-mono">
              <Check className="w-3 h-3" />
              {copiedLabel}
            </span>
          )}
        </div>

        {/* Right: Record Count, Execution Time & Export */}
        <div className="flex items-center gap-3 text-gray-400">
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className="text-gray-300 font-medium">
              {sortedRows.length} {sortedRows.length === 1 ? 'row' : 'rows'}
            </span>
            <span className="text-gray-600">•</span>
            <span className="flex items-center gap-1 text-gray-400" title="Execution Time">
              <Clock className="w-3 h-3 text-gray-500" />
              {currentBatch ? `${currentBatch.execution_time_ms.toFixed(1)}ms` : execTime}
            </span>
          </div>

          <button
            onClick={handleExportCsv}
            disabled={sortedRows.length === 0}
            className="p-1.5 hover:text-white hover:bg-white/5 rounded-lg border border-transparent hover:border-white/10 transition-colors disabled:opacity-40"
            title="Export as CSV"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>

      </div>

      {/* 3. Messages / Error Notification Banner */}
      {error && (
        <div className="p-3 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs flex items-center gap-2 shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="font-mono">{error}</span>
        </div>
      )}

      {/* 4. Data Grid Body */}
      <div className="flex-1 overflow-auto relative">
        {displayColumns.length > 0 && sortedRows.length > 0 ? (
          <table className="w-full text-left border-collapse text-xs font-mono">
            
            {/* Table Header */}
            <thead className="sticky top-0 bg-[#252538] border-b border-white/10 text-gray-300 z-10">
              <tr>
                <th className="px-2 py-2 w-10 text-center text-gray-500 font-normal">#</th>
                {displayColumns.map((col) => {
                  const isSorted = sortCol === col;
                  return (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      className="px-3 py-2 font-medium cursor-pointer hover:bg-white/5 transition-colors select-none"
                    >
                      <div className="flex items-center gap-1.5 justify-between">
                        <span className="truncate">{col}</span>
                        {isSorted ? (
                          sortDir === 'asc' ? (
                            <ChevronUp className="w-3 h-3 text-blue-400 shrink-0" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-blue-400 shrink-0" />
                          )
                        ) : (
                          <ArrowUpDown className="w-2.5 h-2.5 text-gray-600 opacity-0 group-hover:opacity-100 shrink-0" />
                        )}
                      </div>
                    </th>
                  );
                })}
                <th className="px-2 py-2 w-16 text-center text-gray-500 font-normal">Actions</th>
              </tr>
            </thead>

            {/* Table Body */}
            <tbody className="divide-y divide-white/5">
              {sortedRows.map((row, rIdx) => {
                const isRowSelected = selectedRow === row;
                return (
                  <tr
                    key={rIdx}
                    onClick={() => setSelectedRow(row)}
                    onDoubleClick={() => onEditRow && onEditRow(row)}
                    className={`transition-colors cursor-pointer group ${
                      isRowSelected ? 'bg-blue-600/10' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    {/* Row Index */}
                    <td className="px-2 py-1.5 text-center text-gray-500 text-[10px] select-none">
                      {rIdx + 1}
                    </td>

                    {/* Columns */}
                    {displayColumns.map((col) => {
                      const val = (row && typeof row === 'object') ? row[col] : (col === 'Value' ? row : undefined);
                      return (
                        <td key={col} className="px-3 py-1.5 truncate max-w-xs text-gray-300">
                          {val === null || val === undefined ? (
                            <span className="text-amber-500 italic text-[11px]">NULL</span>
                          ) : typeof val === 'boolean' ? (
                            <span className={val ? 'text-emerald-400' : 'text-rose-400'}>
                              {String(val)}
                            </span>
                          ) : typeof val === 'object' ? (
                            <span className="text-cyan-400 text-[11px]">{JSON.stringify(val)}</span>
                          ) : (
                            String(val)
                          )}
                        </td>
                      );
                    })}

                    {/* Row Quick Action Buttons */}
                    <td className="px-2 py-1 text-center select-none">
                      <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        
                        {/* Edit Row */}
                        {onEditRow && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditRow(row);
                            }}
                            className="p-1 hover:text-white hover:bg-white/10 rounded transition-colors"
                            title="Edit Row"
                          >
                            <Edit3 className="w-3 h-3 text-blue-400" />
                          </button>
                        )}

                        {/* Copy Row as JSON */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyRowAsJson(row);
                          }}
                          className="p-1 hover:text-white hover:bg-white/10 rounded transition-colors"
                          title="Copy as JSON"
                        >
                          <Copy className="w-3 h-3 text-gray-400" />
                        </button>

                        {/* Copy Row as SQL */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCopyRowAsSql(row);
                          }}
                          className="p-1 hover:text-white hover:bg-white/10 rounded transition-colors"
                          title="Copy as SQL INSERT"
                        >
                          <FileText className="w-3 h-3 text-emerald-400" />
                        </button>

                        {/* Delete Row */}
                        {onDeleteRow && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setRowToDelete(row);
                              setShowDeleteConfirm(true);
                            }}
                            className="p-1 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            title="Delete Row"
                          >
                            <Trash2 className="w-3 h-3 text-red-400" />
                          </button>
                        )}

                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>

          </table>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-xs text-gray-500 space-y-2 p-8">
            <Table className="w-8 h-8 text-gray-600 stroke-1" />
            <span>{error ? 'Query execution returned an error.' : 'No rows returned for this query.'}</span>
            {successInfo && (
              <span className="text-emerald-400 text-[11px] font-mono">{successInfo}</span>
            )}
          </div>
        )}
      </div>

      {/* Delete Row Confirm Modal */}
      {showDeleteConfirm && rowToDelete && (
        <ConfirmModal
          isOpen={showDeleteConfirm}
          title="Delete Row Confirmation"
          message="Are you sure you want to delete this row permanently from the database?"
          details={JSON.stringify(rowToDelete, null, 2)}
          confirmText="Delete Row"
          confirmStyle="danger"
          onConfirm={() => {
            if (onDeleteRow) onDeleteRow(rowToDelete);
            setShowDeleteConfirm(false);
            setRowToDelete(null);
          }}
          onClose={() => {
            setShowDeleteConfirm(false);
            setRowToDelete(null);
          }}
        />
      )}

    </div>
  );
};

export default MultiResultViewer;
