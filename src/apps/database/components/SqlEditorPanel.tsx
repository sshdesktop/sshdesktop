import React, { useState, useEffect, useRef } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { 
  Play, 
  ZoomIn, 
  ZoomOut, 
  WrapText, 
  MapPin, 
  Columns, 
  Rows, 
  Maximize2, 
  Sparkles, 
  RotateCcw,
  MousePointerClick,
  Code2
} from 'lucide-react';
import { DbEngine } from '../types';

interface SqlEditorPanelProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: (queryToRun: string) => void;
  isExecuting?: boolean;
  engine?: DbEngine;
  tables?: string[];
  columns?: string[];
  language?: string; // 'sql' | 'json' | 'cql'
  splitMode?: 'horizontal' | 'vertical' | 'editor-only' | 'results-only';
  onSplitModeChange?: (mode: 'horizontal' | 'vertical' | 'editor-only' | 'results-only') => void;
  onCloseTab?: () => void;
}

export const SqlEditorPanel: React.FC<SqlEditorPanelProps> = ({
  value,
  onChange,
  onExecute,
  isExecuting = false,
  engine = 'postgresql',
  tables = [],
  columns = [],
  language = 'sql',
  splitMode = 'horizontal',
  onSplitModeChange,
  onCloseTab,
}) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const valueRef = useRef<string>(value);
  const onExecuteRef = useRef<(q: string) => void>(onExecute);
  const onChangeRef = useRef<(val: string) => void>(onChange);
  const triggerExecuteRef = useRef<() => void>(() => {});

  // Editor Display Settings
  const [fontSize, setFontSize] = useState<number>(13);
  const [wordWrap, setWordWrap] = useState<boolean>(true);
  const [showMinimap, setShowMinimap] = useState<boolean>(false);
  const [hasSelection, setHasSelection] = useState<boolean>(false);
  const [selectedText, setSelectedText] = useState<string>('');

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onExecuteRef.current = onExecute;
  }, [onExecute]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Synchronize editor buffer when active tab or external value changes
  useEffect(() => {
    if (editorRef.current) {
      const currentVal = editorRef.current.getValue();
      if (value !== undefined && value !== null && currentVal !== value) {
        editorRef.current.setValue(value);
      }
    }
  }, [value]);

  // Handle Editor Mount
  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Listen for text selection changes
    editor.onDidChangeCursorSelection((e) => {
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        const text = editor.getModel()?.getValueInRange(selection) || '';
        if (text.trim().length > 0) {
          setHasSelection(true);
          setSelectedText(text);
          return;
        }
      }
      setHasSelection(false);
      setSelectedText('');
    });

    // Keybinding: Ctrl+Enter (Cmd+Enter) -> Run Selected or All live editor code
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      triggerExecuteRef.current();
    });

    // Keybinding: Alt+Z -> Toggle Word Wrap
    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () => {
      setWordWrap((prev) => !prev);
    });

    // Keybinding: Ctrl + = / Ctrl + + -> Zoom In
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => {
      setFontSize((prev) => Math.min(prev + 1, 28));
    });

    // Keybinding: Ctrl + - -> Zoom Out
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => {
      setFontSize((prev) => Math.max(prev - 1, 10));
    });

    // Keybinding: Ctrl + 0 -> Reset Zoom
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0, () => {
      setFontSize(13);
    });

    // Keybinding: Ctrl + W -> Close Tab
    if (onCloseTab) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW, () => {
        onCloseTab();
      });
    }

    // Register SQL Autocomplete / IntelliSense
    registerIntelliSense(monaco);
  };

  // Register SQL completion provider
  const registerIntelliSense = (monaco: any) => {
    try {
      const sqlKeywords = [
        'SELECT', 'FROM', 'WHERE', 'INSERT INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE FROM',
        'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE', 'JOIN', 'LEFT JOIN',
        'RIGHT JOIN', 'INNER JOIN', 'FULL OUTER JOIN', 'ON', 'GROUP BY', 'ORDER BY',
        'HAVING', 'LIMIT', 'OFFSET', 'UNION ALL', 'UNION', 'DISTINCT', 'AS',
        'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE', 'IS NULL',
        'IS NOT NULL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT', 'SUM',
        'AVG', 'MIN', 'MAX', 'COALESCE', 'NOW()', 'CURRENT_TIMESTAMP', 'PRIMARY KEY',
        'FOREIGN KEY', 'REFERENCES', 'AUTO_INCREMENT', 'SERIAL', 'IDENTITY',
        'INDEX', 'UNIQUE', 'CHECK', 'DEFAULT', 'VIEW', 'TRIGGER', 'PROCEDURE', 'FUNCTION',
        'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'TOP', 'FETCH FIRST', 'ROWS ONLY',
        'EXPLAIN', 'ANALYZE', 'VACUUM', 'RETURNING'
      ];

      monaco.languages.registerCompletionItemProvider(language, {
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          const suggestions: any[] = [];

          // 1. SQL Keywords
          sqlKeywords.forEach((kw) => {
            suggestions.push({
              label: kw,
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: kw,
              range,
              detail: 'SQL Keyword',
            });
          });

          // 2. Database Tables
          tables.forEach((tbl) => {
            suggestions.push({
              label: tbl,
              kind: monaco.languages.CompletionItemKind.Class,
              insertText: tbl,
              range,
              detail: 'Database Table',
            });
          });

          // 3. Columns
          columns.forEach((col) => {
            suggestions.push({
              label: col,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: col,
              range,
              detail: 'Table Column',
            });
          });

          return { suggestions };
        },
      });
    } catch {
      // Ignored if already registered
    }
  };

  const triggerExecute = () => {
    if (isExecuting) return;

    let queryToRun = '';
    let isSelection = false;

    if (editorRef.current) {
      const selection = editorRef.current.getSelection();
      if (selection && !selection.isEmpty()) {
        const selected = editorRef.current.getModel()?.getValueInRange(selection);
        if (selected && selected.trim().length > 0) {
          queryToRun = selected.trim();
          isSelection = true;
        }
      }

      const liveFullText = editorRef.current.getValue();
      // Ensure parent tab state has the modified code immediately
      if (onChangeRef.current && liveFullText !== valueRef.current) {
        valueRef.current = liveFullText;
        onChangeRef.current(liveFullText);
      }

      if (!isSelection) {
        queryToRun = liveFullText;
      }
    } else {
      queryToRun = valueRef.current || '';
    }

    if (onExecuteRef.current) {
      onExecuteRef.current(queryToRun);
    }
  };

  useEffect(() => {
    triggerExecuteRef.current = triggerExecute;
  });

  const handleFormatCode = () => {
    if (!editorRef.current) return;
    try {
      if (language === 'json') {
        const currentCode = editorRef.current.getValue();
        const parsed = JSON.parse(currentCode);
        const formatted = JSON.stringify(parsed, null, 2);
        editorRef.current.setValue(formatted);
        valueRef.current = formatted;
        onChange(formatted);
      } else {
        editorRef.current.getAction('editor.action.formatDocument')?.run();
      }
    } catch {
      // Ignore formatting error on malformed input
    }
  };

  // Keyboard shortcut listener on panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        triggerExecuteRef.current();
      }
      if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setWordWrap((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setFontSize((prev) => Math.min(prev + 1, 28));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        setFontSize((prev) => Math.max(prev - 1, 10));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setFontSize(13);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[#1e1e2e]">
      
      {/* Editor Control Toolbar */}
      <div className="h-9 px-3 border-b border-white/10 bg-black/20 flex items-center justify-between text-xs shrink-0 select-none overflow-x-auto no-scrollbar gap-2">
        
        {/* Left: Execution Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={triggerExecute}
            disabled={isExecuting}
            className={`px-3 py-1 rounded-lg text-xs font-semibold text-white transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50 ${
              hasSelection
                ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30 ring-1 ring-amber-400'
                : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/30'
            }`}
            title="Execute Query (Ctrl + Enter)"
          >
            {isExecuting ? (
              <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : hasSelection ? (
              <MousePointerClick className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" />
            )}
            <span>
              {hasSelection ? 'Run Selection' : 'Execute'}
            </span>
            <kbd className="hidden md:inline-block text-[10px] px-1 py-0.2 bg-black/20 rounded font-mono font-normal opacity-80">
              Ctrl+Enter
            </kbd>
          </button>

          {hasSelection && (
            <span className="text-[11px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 font-mono hidden sm:inline">
              Selected text mode
            </span>
          )}
        </div>

        {/* Right: Monaco Tools (Zoom, WordWrap, Minimap, Split, Format) */}
        <div className="flex items-center gap-1 text-gray-400 shrink-0">
          
          {/* Zoom Controls */}
          <div className="flex items-center bg-white/5 rounded-lg border border-white/10 px-1 py-0.5">
            <button
              onClick={() => setFontSize((p) => Math.max(p - 1, 10))}
              className="p-1 hover:text-white hover:bg-white/10 rounded transition-colors"
              title="Zoom Out (Ctrl + -)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span
              onClick={() => setFontSize(13)}
              className="text-[10px] font-mono px-1.5 cursor-pointer hover:text-white"
              title="Click to reset font size (Ctrl + 0)"
            >
              {fontSize}px
            </span>
            <button
              onClick={() => setFontSize((p) => Math.min(p + 1, 28))}
              className="p-1 hover:text-white hover:bg-white/10 rounded transition-colors"
              title="Zoom In (Ctrl + +)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-4 w-[1px] bg-white/10 mx-1" />

          {/* Word Wrap Toggle */}
          <button
            onClick={() => setWordWrap((prev) => !prev)}
            className={`p-1.5 rounded-lg transition-colors border ${
              wordWrap
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                : 'hover:text-white hover:bg-white/5 border-transparent'
            }`}
            title="Toggle Word Wrap (Alt + Z)"
          >
            <WrapText className="w-3.5 h-3.5" />
          </button>

          {/* Minimap Toggle */}
          <button
            onClick={() => setShowMinimap((prev) => !prev)}
            className={`p-1.5 rounded-lg transition-colors border ${
              showMinimap
                ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                : 'hover:text-white hover:bg-white/5 border-transparent'
            }`}
            title="Toggle Minimap"
          >
            <MapPin className="w-3.5 h-3.5" />
          </button>

          {/* Code Beautify / Format */}
          <button
            onClick={handleFormatCode}
            className="p-1.5 rounded-lg hover:text-white hover:bg-white/5 border border-transparent transition-colors"
            title="Format Query (Prettier / SQL Beautifier)"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
          </button>

          {/* Split Mode Selector (if enabled) */}
          {onSplitModeChange && (
            <>
              <div className="h-4 w-[1px] bg-white/10 mx-1" />
              <button
                onClick={() => onSplitModeChange(splitMode === 'horizontal' ? 'vertical' : 'horizontal')}
                className={`p-1.5 rounded-lg transition-colors border ${
                  splitMode === 'vertical'
                    ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
                    : 'hover:text-white hover:bg-white/5 border-transparent'
                }`}
                title={splitMode === 'horizontal' ? 'Switch to Vertical Split' : 'Switch to Horizontal Split'}
              >
                {splitMode === 'horizontal' ? (
                  <Rows className="w-3.5 h-3.5" />
                ) : (
                  <Columns className="w-3.5 h-3.5" />
                )}
              </button>
            </>
          )}

        </div>

      </div>

      {/* Monaco Editor Container */}
      <div className="flex-1 min-h-0 relative">
        <Editor
          height="100%"
          language={language}
          theme="vs-dark"
          value={value}
          onChange={(val) => {
            const nextVal = val || '';
            valueRef.current = nextVal;
            onChange(nextVal);
          }}
          onMount={handleEditorMount}
          options={{
            fontSize,
            wordWrap: wordWrap ? 'on' : 'off',
            minimap: { enabled: showMinimap },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 2,
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: false, strings: true },
            padding: { top: 8, bottom: 8 },
            fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          }}
        />
      </div>

    </div>
  );
};

export default SqlEditorPanel;
