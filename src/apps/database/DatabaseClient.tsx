import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import {
  Database,
  Play,
  Download,
  Table,
  Layers,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  Search,
  Code2,
  Plus,
  Trash2,
  FileSpreadsheet,
  Zap,
  Eye,
  EyeOff,
  LogOut,
  Settings2,
  Activity,
  Check,
  X,
  Columns2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Edit3,
  Key,
  FolderTree,
  FileCode,
  Network,
  Save,
  Sliders,
  MoreVertical,
  ArrowUp,
  ArrowDown,
  Link,
  SlidersHorizontal,
  FolderPlus,
  FileText,
  Copy,
  Scissors,
  Share2,
  FileDown,
  Terminal,
  HelpCircle,
  Hash,
  Square
} from 'lucide-react';
import {
  sshExec,
  dbConnect,
  dbDisconnect,
  dbTestConnection,
  dbExecuteQuery,
  dbListTables,
  dbGetTableColumns,
  redisScanKeys,
  redisGetValue,
  redisSetValue,
  redisDeleteKey,
  mongodbListCollections,
  mongodbFindDocuments,
  mongodbInsertDocument,
  DatabaseConnectionConfig,
  isTauri
} from '../../lib/tauri-bridge';
import { useConnectionStore, useSettingsStore } from '../../lib/store';

// ─── Supported Database Engines ──────────────────────────────────────
export type DbEngine = 'mysql' | 'postgresql' | 'mariadb' | 'sqlite' | 'mssql' | 'mongodb' | 'redis';

export interface DbConnectionProfile {
  id: string;
  name: string;
  engine: DbEngine;
  host: string;
  port: number;
  username: string;
  password?: string;
  database: string;
  useSudoSocket?: boolean;
  cliBinary?: string; // Optional custom CLI tool path or name
  lastConnected?: string;
  color?: string;
}

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey?: boolean;
  referencedTable?: string;
  referencedColumn?: string;
  autoIncrement?: boolean;
  defaultValue?: string;
}

export interface ForeignKeyRelation {
  constraintName?: string;
  tableName: string;
  columnName: string;
  foreignTableName: string;
  foreignColumnName: string;
}

export interface TableItem {
  name: string;
  type: 'table' | 'view';
  schema?: string;
  columns?: ColumnDefinition[];
  rowCount?: number;
  isExpanded?: boolean;
}

export interface IndexItem {
  name: string;
  tableName: string;
  columnName: string;
  isUnique: boolean;
  type?: string;
}

export interface RoutineItem {
  name: string;
  type: 'procedure' | 'function' | 'trigger';
  returnType?: string;
  definition?: string;
}

export interface QueryTab {
  id: string;
  title: string;
  query: string;
  results: any[];
  columns: string[];
  sortColumn?: string | null;
  sortDirection?: 'asc' | 'desc' | null;
  rawOutput: string;
  execTime: string;
  error: string | null;
  successInfo: string | null;
}

export interface DataGridState {
  table: string | null;
  rows: any[];
  columns: string[];
  loading: boolean;
  error: string | null;
  totalCount: number;
  pageSize: number;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc' | null;
  selectedRowIndex: number | null;
}

export interface ContextMenuState {
  x: number;
  y: number;
  type: 'data-grid-row' | 'structure-column' | 'sidebar-table' | 'sidebar-column';
  data: any;
}

const DEFAULT_PORTS: Record<DbEngine, number> = {
  mysql: 3306,
  postgresql: 5432,
  mariadb: 3306,
  sqlite: 0,
  mssql: 1433,
  mongodb: 27017,
  redis: 6379,
};

const DEFAULT_USERS: Record<DbEngine, string> = {
  mysql: 'root',
  postgresql: 'postgres',
  mariadb: 'root',
  sqlite: '',
  mssql: 'sa',
  mongodb: 'admin',
  redis: 'default',
};

const DEFAULT_DBS: Record<DbEngine, string> = {
  mysql: 'mysql',
  postgresql: 'postgres',
  mariadb: 'mysql',
  sqlite: '/var/lib/sqlite/app.db',
  mssql: 'master',
  mongodb: 'admin',
  redis: '0',
};

const ENGINE_META: Record<DbEngine, { label: string; icon: string; defaultCli: string; fallbacks: string[]; installCmd: string }> = {
  mysql: {
    label: 'MySQL',
    icon: '🐬',
    defaultCli: 'mysql',
    fallbacks: ['mariadb', 'mycli', '/usr/bin/mysql', '/usr/local/bin/mysql'],
    installCmd: 'sudo apt-get update && sudo apt-get install -y default-mysql-client'
  },
  postgresql: {
    label: 'PostgreSQL',
    icon: '🐘',
    defaultCli: 'psql',
    fallbacks: ['pgcli', '/usr/bin/psql', '/usr/local/bin/psql'],
    installCmd: 'sudo apt-get update && sudo apt-get install -y postgresql-client'
  },
  mariadb: {
    label: 'MariaDB',
    icon: '🦭',
    defaultCli: 'mariadb',
    fallbacks: ['mysql', 'mycli', '/usr/bin/mariadb', '/usr/bin/mysql'],
    installCmd: 'sudo apt-get update && sudo apt-get install -y mariadb-client'
  },
  sqlite: {
    label: 'SQLite',
    icon: '🪶',
    defaultCli: 'sqlite3',
    fallbacks: ['/usr/bin/sqlite3', '/usr/local/bin/sqlite3'],
    installCmd: 'sudo apt-get update && sudo apt-get install -y sqlite3'
  },
  mssql: {
    label: 'SQL Server (MSSQL)',
    icon: '🔷',
    defaultCli: 'sqlcmd',
    fallbacks: ['mssql-cli', 'sqsh', '/opt/mssql-tools/bin/sqlcmd', '/opt/mssql-tools18/bin/sqlcmd'],
    installCmd: 'sudo apt-get install -y mssql-tools18 sqsh'
  },
  mongodb: {
    label: 'MongoDB',
    icon: '🍃',
    defaultCli: 'mongosh',
    fallbacks: ['mongo', '/usr/bin/mongosh', '/usr/bin/mongo'],
    installCmd: 'sudo apt-get install -y mongodb-mongosh'
  },
  redis: {
    label: 'Redis',
    icon: '⚡',
    defaultCli: 'redis-cli',
    fallbacks: ['iredis', '/usr/bin/redis-cli'],
    installCmd: 'sudo apt-get update && sudo apt-get install -y redis-tools'
  },
};

// ─── Theme Palettes & Styles ─────────────────────────────────────────
interface ThemeStyle {
  name: string;
  monacoTheme: string;
  bgMain: string;
  bgSurface: string;
  bgSidebar: string;
  bgHeader: string;
  bgInput: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  gridHover: string;
  gridSelected: string;
  isLight?: boolean;
}

const THEMES: Record<string, ThemeStyle> = {
  'vs-dark': {
    name: 'Visual Studio Dark',
    monacoTheme: 'vs-dark',
    bgMain: '#1e1e1e',
    bgSurface: '#252526',
    bgSidebar: '#252526',
    bgHeader: '#323233',
    bgInput: '#3c3c3c',
    border: 'rgba(255, 255, 255, 0.1)',
    text: '#cccccc',
    textMuted: '#858585',
    accent: '#007acc',
    gridHover: 'rgba(0, 122, 204, 0.12)',
    gridSelected: 'rgba(0, 122, 204, 0.25)',
  },
  'vs-light': {
    name: 'Visual Studio Light',
    monacoTheme: 'vs',
    bgMain: '#ffffff',
    bgSurface: '#f3f3f3',
    bgSidebar: '#f8f8f8',
    bgHeader: '#e8e8e8',
    bgInput: '#ffffff',
    border: 'rgba(0, 0, 0, 0.12)',
    text: '#1e1e1e',
    textMuted: '#6e6e6e',
    accent: '#007acc',
    gridHover: 'rgba(0, 122, 204, 0.08)',
    gridSelected: 'rgba(0, 122, 204, 0.2)',
    isLight: true,
  },
  'monokai': {
    name: 'Monokai',
    monacoTheme: 'monokai-theme',
    bgMain: '#272822',
    bgSurface: '#1e1f1c',
    bgSidebar: '#1e1f1c',
    bgHeader: '#3e3d32',
    bgInput: '#383830',
    border: 'rgba(255, 255, 255, 0.12)',
    text: '#f8f8f2',
    textMuted: '#75715e',
    accent: '#a6e22e',
    gridHover: 'rgba(166, 226, 46, 0.1)',
    gridSelected: 'rgba(166, 226, 46, 0.25)',
  },
  'darcula': {
    name: 'Darcula',
    monacoTheme: 'darcula-theme',
    bgMain: '#2b2b2b',
    bgSurface: '#313335',
    bgSidebar: '#3c3f41',
    bgHeader: '#323232',
    bgInput: '#45494a',
    border: 'rgba(255, 255, 255, 0.1)',
    text: '#a9b7c6',
    textMuted: '#808080',
    accent: '#cc7832',
    gridHover: 'rgba(204, 120, 50, 0.12)',
    gridSelected: 'rgba(204, 120, 50, 0.25)',
  },
  'one-dark-pro': {
    name: 'One Dark Pro',
    monacoTheme: 'one-dark-pro-theme',
    bgMain: '#282c34',
    bgSurface: '#21252b',
    bgSidebar: '#21252b',
    bgHeader: '#2c313a',
    bgInput: '#1b1d23',
    border: 'rgba(255, 255, 255, 0.08)',
    text: '#abb2bf',
    textMuted: '#5c6370',
    accent: '#61afef',
    gridHover: 'rgba(97, 175, 239, 0.12)',
    gridSelected: 'rgba(97, 175, 239, 0.25)',
  },
  'github-dark': {
    name: 'GitHub Dark',
    monacoTheme: 'github-dark-theme',
    bgMain: '#0d1117',
    bgSurface: '#161b22',
    bgSidebar: '#161b22',
    bgHeader: '#21262d',
    bgInput: '#0d1117',
    border: 'rgba(240, 246, 252, 0.1)',
    text: '#c9d1d9',
    textMuted: '#8b949e',
    accent: '#58a6ff',
    gridHover: 'rgba(88, 166, 255, 0.12)',
    gridSelected: 'rgba(88, 166, 255, 0.25)',
  },
  'catppuccin-mocha': {
    name: 'Catppuccin Mocha',
    monacoTheme: 'catppuccin-mocha-theme',
    bgMain: '#1e1e2e',
    bgSurface: '#181825',
    bgSidebar: '#11111b',
    bgHeader: '#313244',
    bgInput: '#181825',
    border: 'rgba(205, 214, 244, 0.1)',
    text: '#cdd6f4',
    textMuted: '#6c7086',
    accent: '#89b4fa',
    gridHover: 'rgba(137, 180, 250, 0.12)',
    gridSelected: 'rgba(137, 180, 250, 0.25)',
  },
};

const DEFAULT_SAVED_PROFILES: DbConnectionProfile[] = [
  {
    id: 'prof-mysql-1',
    name: 'Local MySQL Server',
    engine: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    username: 'root',
    password: '',
    database: 'mysql',
    color: '#f59e0b',
  },
  {
    id: 'prof-pg-1',
    name: 'Local PostgreSQL',
    engine: 'postgresql',
    host: '127.0.0.1',
    port: 5432,
    username: 'postgres',
    password: '',
    database: 'postgres',
    useSudoSocket: true,
    color: '#3b82f6',
  },
  {
    id: 'prof-sqlite-1',
    name: 'Local SQLite DB',
    engine: 'sqlite',
    host: 'localhost',
    port: 0,
    username: '',
    password: '',
    database: '/var/lib/sqlite/app.db',
    color: '#06b6d4',
  },
  {
    id: 'prof-mssql-1',
    name: 'SQL Server (MSSQL)',
    engine: 'mssql',
    host: '127.0.0.1',
    port: 1433,
    username: 'sa',
    password: '',
    database: 'master',
    color: '#0284c7',
  },
  {
    id: 'prof-mongo-1',
    name: 'Local MongoDB',
    engine: 'mongodb',
    host: '127.0.0.1',
    port: 27017,
    username: 'admin',
    password: '',
    database: 'admin',
    color: '#10b981',
  },
  {
    id: 'prof-redis-1',
    name: 'Local Redis Instance',
    engine: 'redis',
    host: '127.0.0.1',
    port: 6379,
    username: 'default',
    password: '',
    database: '0',
    color: '#ef4444',
  }
];

// ─── UTF-8 Base64 Helper for Stdin Pipes ─────────────────────────────
function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function DatabaseClient() {
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';

  // ─── Theme Management (Default: Visual Studio Dark) ────────────────
  const [selectedThemeKey, setSelectedThemeKey] = useState<string>(() => {
    return localStorage.getItem('clouddesk_db_theme') || 'vs-dark';
  });
  const currentTheme = THEMES[selectedThemeKey] || THEMES['vs-dark'];

  const handleThemeChange = (newKey: string) => {
    setSelectedThemeKey(newKey);
    localStorage.setItem('clouddesk_db_theme', newKey);
  };

  // ─── Connection Profiles Store ──────────────────────────────────────
  const [savedProfiles, setSavedProfiles] = useState<DbConnectionProfile[]>(() => {
    try {
      const stored = localStorage.getItem('clouddesk_db_profiles');
      if (stored) return JSON.parse(stored);
    } catch {}
    return DEFAULT_SAVED_PROFILES;
  });

  useEffect(() => {
    try {
      localStorage.setItem('clouddesk_db_profiles', JSON.stringify(savedProfiles));
    } catch {}
  }, [savedProfiles]);

  // Current Connection Filter Tab on Launcher Screen
  const [selectedEngineFilter, setSelectedEngineFilter] = useState<DbEngine | 'all'>('mysql');

  // Currently Active Connected Profile
  const [activeProfile, setActiveProfile] = useState<DbConnectionProfile | null>(null);
  const [isConnectionModalOpen, setIsConnectionModalOpen] = useState(false);

  // Form State for Adding / Modifying Connection
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [formEngine, setFormEngine] = useState<DbEngine>('mysql');
  const [formName, setFormName] = useState('Production MySQL');
  const [formHost, setFormHost] = useState('127.0.0.1');
  const [formPort, setFormPort] = useState(3306);
  const [formUsername, setFormUsername] = useState('root');
  const [formPassword, setFormPassword] = useState('');
  const [formDatabase, setFormDatabase] = useState('mysql');
  const [formUseSudoSocket, setFormUseSudoSocket] = useState(false);
  const [formCliBinary, setFormCliBinary] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; version?: string } | null>(null);

  // ─── Studio Workspace State ─────────────────────────────────────────
  const [mainView, setMainView] = useState<'editor' | 'data-grid' | 'structure' | 'er-diagram' | 'activity'>('editor');
  const [structureSubTab, setStructureSubTab] = useState<'columns' | 'indexes'>('columns');

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const s = localStorage.getItem('clouddesk_db_sidebar_width');
    return s ? Math.max(180, Math.min(500, parseInt(s, 10))) : 270;
  });
  const isResizingSidebar = useRef(false);

  // Database Contexts & Schemas
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([]);
  const [tablesList, setTablesList] = useState<TableItem[]>([]);
  const [viewsList, setViewsList] = useState<TableItem[]>([]);
  const [indexesList, setIndexesList] = useState<IndexItem[]>([]);
  const [routinesList, setRoutinesList] = useState<RoutineItem[]>([]);
  const [foreignKeysList, setForeignKeysList] = useState<ForeignKeyRelation[]>([]);
  const [fetchingSchema, setFetchingSchema] = useState(false);
  const [searchTableFilter, setSearchTableFilter] = useState('');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableStructureColumns, setTableStructureColumns] = useState<ColumnDefinition[]>([]);
  const [loadingStructure, setLoadingStructure] = useState(false);
  const [loadingTableCols, setLoadingTableCols] = useState<Record<string, boolean>>({});

  // ─── Separate & Independent Data Grid State ─────────────────────────
  const [dataGrid, setDataGrid] = useState<DataGridState>({
    table: null,
    rows: [],
    columns: [],
    loading: false,
    error: null,
    totalCount: 0,
    pageSize: 100,
    sortColumn: null,
    sortDirection: null,
    selectedRowIndex: null,
  });
  const [dataGridFilter, setDataGridFilter] = useState('');

  // ─── Multi-Tab SQL Query Editor State ──────────────────────────────
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([
    {
      id: 'tab-1',
      title: 'Query 1',
      query: 'SELECT 1 as id, USER() as user, VERSION() as version, NOW() as current_time;',
      results: [],
      columns: [],
      sortColumn: null,
      sortDirection: null,
      rawOutput: '',
      execTime: '—',
      error: null,
      successInfo: null,
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');
  const [executing, setExecuting] = useState(false);
  const [fontSize, setFontSize] = useState<number>(13);
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');
  const [minimapEnabled, setMinimapEnabled] = useState<boolean>(true); // Default ON per user request
  const [isSplitQueryEditor, setIsSplitQueryEditor] = useState<boolean>(false);
  const [secondaryQuery, setSecondaryQuery] = useState<string>('-- Secondary Query Pane\nSELECT * FROM information_schema.tables LIMIT 20;');
  const [secondaryExecuting, setSecondaryExecuting] = useState<boolean>(false);

  // Console / Output Resizable Pane
  const [outputHeight, setOutputHeight] = useState<number>(240);
  const [isOutputMinimized, setIsOutputMinimized] = useState<boolean>(false);
  const isDraggingSplitter = useRef(false);

  // Monaco Editor Reference to capture selected lines
  const monacoEditorRef = useRef<any>(null);

  // ─── Modals State with In-Modal Error Display ──────────────────────
  const [showAddRowModal, setShowAddRowModal] = useState(false);
  const [showEditRowModal, setShowEditRowModal] = useState(false);
  const [rowFormData, setRowFormData] = useState<Record<string, any>>({});
  const [rowModalError, setRowModalError] = useState<string | null>(null);
  const [isMutatingRow, setIsMutatingRow] = useState(false);

  // Column Designer Modal
  const [showColumnModal, setShowColumnModal] = useState<'add' | 'edit' | null>(null);
  const [colFormOriginalName, setColFormOriginalName] = useState('');
  const [colFormName, setColFormName] = useState('');
  const [colFormType, setColFormType] = useState('VARCHAR(255)');
  const [colFormNullable, setColFormNullable] = useState(true);
  const [colFormPK, setColFormPK] = useState(false);
  const [colFormDefault, setColFormDefault] = useState('');
  const [colModalError, setColModalError] = useState<string | null>(null);

  // Create Table Modal
  const [showCreateTableModal, setShowCreateTableModal] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableCols, setNewTableCols] = useState<Array<{ name: string; type: string; nullable: boolean; isPK: boolean; autoInc: boolean; defaultValue: string }>>([
    { name: 'id', type: 'INT', nullable: false, isPK: true, autoInc: true, defaultValue: '' },
    { name: 'name', type: 'VARCHAR(255)', nullable: false, isPK: false, autoInc: false, defaultValue: '' },
    { name: 'created_at', type: 'TIMESTAMP', nullable: false, isPK: false, autoInc: false, defaultValue: 'CURRENT_TIMESTAMP' },
  ]);
  const [createTableModalError, setCreateTableModalError] = useState<string | null>(null);

  // Create Stored Procedure & Function Modals
  const [showRoutineModal, setShowRoutineModal] = useState<'procedure' | 'function' | null>(null);
  const [routineFormName, setRoutineFormName] = useState('');
  const [routineFormParams, setRoutineFormParams] = useState('IN id INT');
  const [routineFormReturnType, setRoutineFormReturnType] = useState('INT');
  const [routineFormBody, setRoutineFormBody] = useState('BEGIN\n    -- SQL Statements here\n    SELECT 1;\nEND');
  const [routineModalError, setRoutineModalError] = useState<string | null>(null);

  // Create Index Modal
  const [showIndexModal, setShowIndexModal] = useState(false);
  const [indexFormName, setIndexFormName] = useState('');
  const [indexFormColumns, setIndexFormColumns] = useState<string[]>([]);
  const [indexFormUnique, setIndexFormUnique] = useState(false);
  const [indexModalError, setIndexModalError] = useState<string | null>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Reverse Engineering ER Diagram Controls
  const [erZoom, setErZoom] = useState<number>(1);
  const [selectedErRelation, setSelectedErRelation] = useState<ForeignKeyRelation | null>(null);

  // Server Processes State
  const [processes, setProcesses] = useState<any[]>([]);
  const [loadingProcesses, setLoadingProcesses] = useState(false);

  // Global Error Alert
  const [globalError, setGlobalError] = useState<string | null>(null);

  const activeTab = useMemo(() => {
    return queryTabs.find(t => t.id === activeTabId) || queryTabs[0];
  }, [queryTabs, activeTabId]);

  // ─── Register Monaco Themes in beforeMount (0ms Latency, Offline) ──
  const handleEditorBeforeMount = (monaco: any) => {
    monaco.editor.defineTheme('monokai-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: 'F92672', fontStyle: 'bold' },
        { token: 'string', foreground: 'E6DB74' },
        { token: 'number', foreground: 'AE81FF' },
        { token: 'comment', foreground: '75715E', fontStyle: 'italic' },
        { token: 'type', foreground: '66D9EF' },
      ],
      colors: {
        'editor.background': '#272822',
        'editor.foreground': '#F8F8F2',
        'editorCursor.foreground': '#F8F8F0',
        'editor.lineHighlightBackground': '#3E3D32',
        'editorLineNumber.foreground': '#75715E',
        'editor.selectionBackground': '#49483E',
      }
    });

    monaco.editor.defineTheme('darcula-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: 'CC7832', fontStyle: 'bold' },
        { token: 'string', foreground: '6A8759' },
        { token: 'number', foreground: '6897BB' },
        { token: 'comment', foreground: '808080', fontStyle: 'italic' },
        { token: 'type', foreground: 'A9B7C6' },
      ],
      colors: {
        'editor.background': '#2B2B2B',
        'editor.foreground': '#A9B7C6',
        'editorCursor.foreground': '#BBBBBB',
        'editor.lineHighlightBackground': '#323232',
        'editorLineNumber.foreground': '#606366',
        'editor.selectionBackground': '#214283',
      }
    });

    monaco.editor.defineTheme('one-dark-pro-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: 'C678DD', fontStyle: 'bold' },
        { token: 'string', foreground: '98C379' },
        { token: 'number', foreground: 'D19A66' },
        { token: 'comment', foreground: '5C6370', fontStyle: 'italic' },
        { token: 'type', foreground: 'E5C07B' },
      ],
      colors: {
        'editor.background': '#282C34',
        'editor.foreground': '#ABB2BF',
        'editorCursor.foreground': '#528BFF',
        'editor.lineHighlightBackground': '#2C313C',
        'editorLineNumber.foreground': '#4B5263',
        'editor.selectionBackground': '#3E4451',
      }
    });

    monaco.editor.defineTheme('github-dark-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: 'FF7B72', fontStyle: 'bold' },
        { token: 'string', foreground: 'A5D6FF' },
        { token: 'number', foreground: '79C0FF' },
        { token: 'comment', foreground: '8B949E', fontStyle: 'italic' },
        { token: 'type', foreground: 'FFA657' },
      ],
      colors: {
        'editor.background': '#0D1117',
        'editor.foreground': '#C9D1D9',
        'editorCursor.foreground': '#58A6FF',
        'editor.lineHighlightBackground': '#161B22',
        'editorLineNumber.foreground': '#6E7681',
        'editor.selectionBackground': '#264F78',
      }
    });

    monaco.editor.defineTheme('catppuccin-mocha-theme', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: 'CBA6F7', fontStyle: 'bold' },
        { token: 'string', foreground: 'A6E3A1' },
        { token: 'number', foreground: 'FAB387' },
        { token: 'comment', foreground: '6C7086', fontStyle: 'italic' },
        { token: 'type', foreground: 'F9E2AF' },
      ],
      colors: {
        'editor.background': '#1E1E2E',
        'editor.foreground': '#CDD6F4',
        'editorCursor.foreground': '#F5E0DC',
        'editor.lineHighlightBackground': '#313244',
        'editorLineNumber.foreground': '#45475A',
        'editor.selectionBackground': '#45475A',
      }
    });
  };

  // ─── Query Command Builder (Stdin Piped via Base64) ────────────────
  // Prevents SQLite dash/option errors, multiline breakages, and bash quote escaping issues.
  const buildCommand = useCallback((profile: DbConnectionProfile, query: string, format: 'tabular' | 'raw' | 'unaligned' = 'tabular') => {
    const b64 = toBase64(query);
    const pwd = profile.password ? profile.password.replace(/'/g, "'\\''") : '';
    const host = profile.host.trim() || '127.0.0.1';
    const port = profile.port;
    const user = profile.username.trim();
    const db = profile.database.trim();
    const cli = profile.cliBinary?.trim() || ENGINE_META[profile.engine].defaultCli;

    if (profile.engine === 'mysql' || profile.engine === 'mariadb') {
      const envPrefix = pwd ? `MYSQL_PWD='${pwd}' ` : '';
      const flags = format === 'unaligned' ? '-s -N' : '-t';
      return `echo "${b64}" | base64 -d | ${envPrefix}${cli} -h '${host}' -P ${port} -u '${user}' -D '${db}' ${flags}`;
    }

    if (profile.engine === 'postgresql') {
      if (profile.useSudoSocket && (host === '127.0.0.1' || host === 'localhost') && !pwd) {
        const flags = format === 'unaligned' ? '-t -A' : '';
        return `echo "${b64}" | base64 -d | sudo -u postgres ${cli} -d ${db} ${flags}`;
      }
      const envPrefix = pwd ? `PGPASSWORD='${pwd}' ` : '';
      const flags = format === 'unaligned' ? '-t -A' : '';
      return `echo "${b64}" | base64 -d | ${envPrefix}${cli} -h '${host}' -p ${port} -U '${user}' -d '${db}' ${flags}`;
    }

    if (profile.engine === 'sqlite') {
      // Options MUST come before database filename. Piped via stdin with PRAGMA foreign_keys = ON!
      const flags = format === 'unaligned' ? '-list' : '-header -column';
      return `echo "${b64}" | base64 -d | ${cli} ${flags} -cmd "PRAGMA foreign_keys = ON;" '${db}'`;
    }

    if (profile.engine === 'mssql') {
      const flags = format === 'unaligned' ? '-h-1 -s"|" -W' : '-s"|" -W';
      return `echo "${b64}" | base64 -d | ${cli} -S '${host},${port}' -U '${user}' -P '${pwd}' -d '${db}' -C ${flags}`;
    }

    if (profile.engine === 'redis') {
      const authFlag = pwd ? `-a '${pwd}' ` : '';
      return `${cli} -h '${host}' -p ${port} ${authFlag}-n ${db} ${query}`;
    }

    if (profile.engine === 'mongodb') {
      const authFlag = user && pwd ? `-u '${user}' -p '${pwd}' --authenticationDatabase admin ` : '';
      const qEscaped = query.replace(/"/g, '\\"').replace(/\$/g, '\\$');
      return `${cli} --host '${host}' --port ${port} ${authFlag}'${db}' --eval "${qEscaped}"`;
    }

    return query;
  }, []);

  // Helper to build typed connection config for native Rust drivers
  const buildDbConfig = useCallback((profile: DbConnectionProfile): DatabaseConnectionConfig => ({
    id: profile.id,
    name: profile.name,
    engine: profile.engine,
    host: profile.host.trim() || '127.0.0.1',
    port: Number(profile.port),
    username: profile.username.trim(),
    password: profile.password || undefined,
    database: profile.database.trim(),
    use_ssh: Boolean(activeConnId),
    ssh_connection_id: activeConnId || undefined,
    read_only: false,
  }), [activeConnId]);

  // ─── Test Connection with Diagnostic Messages ─────────────────────
  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);

    const tempProfile: DbConnectionProfile = {
      id: 'test',
      name: formName,
      engine: formEngine,
      host: formHost,
      port: formPort,
      username: formUsername,
      password: formPassword,
      database: formDatabase,
      useSudoSocket: formUseSudoSocket,
      cliBinary: formCliBinary,
    };

    if (isTauri()) {
      try {
        const caps = await dbTestConnection(buildDbConfig(tempProfile));
        setTestResult({
          success: true,
          message: `Connected via native ${tempProfile.engine.toUpperCase()} driver over SSH tunnel!`,
          version: caps.server_version || 'Ready'
        });
        setTestingConnection(false);
        return;
      } catch (nativeErr: any) {
        console.warn('[Native DB Test] Error:', nativeErr);
        const errMsg = String(nativeErr?.message || nativeErr);
        if (errMsg && !errMsg.includes('not implemented') && !errMsg.includes('not found')) {
          setTestResult({
            success: false,
            message: errMsg,
          });
          setTestingConnection(false);
          return;
        }
      }
    }

    let pingQuery = 'SELECT VERSION();';
    if (formEngine === 'postgresql') pingQuery = 'SELECT version();';
    else if (formEngine === 'sqlite') pingQuery = 'SELECT sqlite_version();';
    else if (formEngine === 'mssql') pingQuery = 'SELECT @@VERSION;';
    else if (formEngine === 'redis') pingQuery = 'PING';
    else if (formEngine === 'mongodb') pingQuery = 'db.version()';

    const cmd = buildCommand(tempProfile, pingQuery, 'unaligned');

    try {
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0 && (res.stdout.trim() || res.stdout.includes('PONG'))) {
        const out = res.stdout.trim().split('\n')[0];
        setTestResult({
          success: true,
          message: 'Connection verified! Remote database server responded.',
          version: out.length > 80 ? out.slice(0, 80) + '...' : out
        });
      } else {
        const msg = res.stderr.trim() || res.stdout.trim() || 'Connection failed';
        if (msg.includes('command not found') || msg.includes('not found')) {
          setTestResult({
            success: false,
            message: `CLI tool '${tempProfile.cliBinary || ENGINE_META[formEngine].defaultCli}' is missing on remote host. Run: ${ENGINE_META[formEngine].installCmd}`
          });
        } else if (msg.includes('Access denied') || msg.includes('password') || msg.includes('Authentication failed') || msg.includes('Login failed')) {
          setTestResult({
            success: false,
            message: 'Access Denied: Authentication failed. Verify username, password, and host permissions.'
          });
        } else {
          setTestResult({ success: false, message: msg });
        }
      }
    } catch (err: any) {
      setTestResult({ success: false, message: String(err?.message || err) });
    } finally {
      setTestingConnection(false);
    }
  };

  // ─── Connect Profile ──────────────────────────────────────────────
  const handleConnectProfile = async (profile: DbConnectionProfile) => {
    if (activeProfile && isTauri()) {
      try {
        await dbDisconnect(activeProfile.id);
      } catch {}
    }

    setActiveProfile(profile);
    setIsConnectionModalOpen(false);
    setGlobalError(null);

    if (isTauri()) {
      try {
        const caps = await dbConnect(buildDbConfig(profile));
        console.log('[Native DB] Connected:', caps);
      } catch (err: any) {
        console.warn('[Native DB] Connect error:', err);
        setGlobalError(`Native Driver Notice: ${String(err?.message || err)}`);
      }
    }

    // Initial query for tab 1
    let initialQuery = 'SELECT 1 as id, USER() as user, VERSION() as version, NOW() as current_time;';
    if (profile.engine === 'postgresql') {
      initialQuery = 'SELECT 1 as id, current_user as user, version() as version, now() as timestamp;';
    } else if (profile.engine === 'sqlite') {
      initialQuery = 'SELECT sqlite_version() as version, datetime(\'now\') as timestamp;';
    } else if (profile.engine === 'mssql') {
      initialQuery = 'SELECT @@SERVERNAME as server, SUSER_SNAME() as [user], @@VERSION as [version], GETDATE() as [time];';
    } else if (profile.engine === 'redis') {
      initialQuery = 'INFO server';
    } else if (profile.engine === 'mongodb') {
      initialQuery = 'db.stats()';
    }

    setQueryTabs([
      {
        id: 'tab-1',
        title: 'Query 1',
        query: initialQuery,
        results: [],
        columns: [],
        sortColumn: null,
        sortDirection: null,
        rawOutput: '',
        execTime: '—',
        error: null,
        successInfo: null,
      }
    ]);
    setActiveTabId('tab-1');

    setSavedProfiles(prev =>
      prev.map(p => p.id === profile.id ? { ...p, lastConnected: new Date().toISOString() } : p)
    );

    setTimeout(() => {
      fetchDatabasesList(profile);
      fetchSchemaTree(profile);
    }, 50);
  };

  const handleSaveProfileForm = (connectImmediately = true) => {
    const id = editingProfileId || `prof-${formEngine}-${Date.now()}`;
    const newProfile: DbConnectionProfile = {
      id,
      name: formName.trim() || `${ENGINE_META[formEngine].label} on ${formHost}`,
      engine: formEngine,
      host: formHost.trim(),
      port: formPort,
      username: formUsername.trim(),
      password: formPassword,
      database: formDatabase.trim(),
      useSudoSocket: formUseSudoSocket,
      cliBinary: formCliBinary.trim() || undefined,
      lastConnected: new Date().toISOString(),
    };

    setSavedProfiles(prev => {
      const exists = prev.some(p => p.id === id);
      if (exists) {
        return prev.map(p => p.id === id ? newProfile : p);
      }
      return [newProfile, ...prev];
    });

    setEditingProfileId(null);
    if (connectImmediately) {
      handleConnectProfile(newProfile);
    }
  };

  const openEditProfile = (profile: DbConnectionProfile, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProfileId(profile.id);
    setFormEngine(profile.engine);
    setFormName(profile.name);
    setFormHost(profile.host);
    setFormPort(profile.port);
    setFormUsername(profile.username);
    setFormPassword(profile.password || '');
    setFormDatabase(profile.database);
    setFormUseSudoSocket(profile.useSudoSocket || false);
    setFormCliBinary(profile.cliBinary || '');
    setTestResult(null);
  };

  const handleDeleteProfile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Delete this saved connection profile?')) {
      setSavedProfiles(prev => prev.filter(p => p.id !== id));
      if (editingProfileId === id) setEditingProfileId(null);
    }
  };

  // ─── Fetch Databases List ─────────────────────────────────────────
  const fetchDatabasesList = async (profile: DbConnectionProfile) => {
    try {
      if (isTauri()) {
        let listQuery = '';
        if (profile.engine === 'mysql' || profile.engine === 'mariadb') {
          listQuery = 'SHOW DATABASES;';
        } else if (profile.engine === 'postgresql') {
          listQuery = 'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;';
        } else if (profile.engine === 'mssql') {
          listQuery = "SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb');";
        } else if (profile.engine === 'redis') {
          setAvailableDatabases(['0', '1', '2', '3', '4', '5', '6', '7']);
          return;
        }

        if (listQuery) {
          try {
            const res = await dbExecuteQuery(profile.id, listQuery);
            if (res.rows && res.rows.length > 0) {
              const dbs = res.rows.map(r => String(Object.values(r)[0] ?? '')).filter(Boolean);
              if (dbs.length > 0) {
                setAvailableDatabases(dbs);
                return;
              }
            }
          } catch (e) {
            console.warn('[Native DB] fetchDatabasesList native attempt:', e);
          }
        }
      }

      let listCmd = '';
      if (profile.engine === 'mysql' || profile.engine === 'mariadb') {
        listCmd = buildCommand(profile, 'SHOW DATABASES;', 'unaligned');
      } else if (profile.engine === 'postgresql') {
        listCmd = buildCommand(profile, 'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;', 'unaligned');
      } else if (profile.engine === 'mssql') {
        listCmd = buildCommand(profile, "SELECT name FROM sys.databases WHERE name NOT IN ('master','tempdb','model','msdb');", 'unaligned');
      } else if (profile.engine === 'redis') {
        setAvailableDatabases(['0', '1', '2', '3', '4', '5', '6', '7']);
        return;
      }

      if (listCmd) {
        const res = await sshExec(activeConnId, listCmd);
        if (res.exit_code === 0 && res.stdout.trim()) {
          const dbs = res.stdout.trim().split('\n').map(d => d.trim()).filter(Boolean);
          if (dbs.length > 0) setAvailableDatabases(dbs);
        }
      }
    } catch {}
  };

  const switchDatabaseContext = (dbName: string) => {
    if (!activeProfile) return;
    const updated = { ...activeProfile, database: dbName };
    setActiveProfile(updated);
    fetchSchemaTree(updated);
  };

  const fetchForeignKeysNative = async (profile: DbConnectionProfile) => {
    let fkQuery = '';
    if (profile.engine === 'mysql' || profile.engine === 'mariadb') {
      fkQuery = `SELECT TABLE_NAME as tableName, COLUMN_NAME as columnName, REFERENCED_TABLE_NAME as foreignTableName, REFERENCED_COLUMN_NAME as foreignColumnName, CONSTRAINT_NAME as constraintName FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='${profile.database}' AND REFERENCED_TABLE_NAME IS NOT NULL;`;
    } else if (profile.engine === 'postgresql') {
      fkQuery = `SELECT tc.table_name as "tableName", kcu.column_name as "columnName", ccu.table_name AS "foreignTableName", ccu.column_name AS "foreignColumnName", tc.constraint_name as "constraintName" FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';`;
    } else if (profile.engine === 'mssql') {
      fkQuery = `SELECT tp.name AS tableName, cp.name AS columnName, tr.name AS foreignTableName, cr.name AS foreignColumnName, fk.name AS constraintName FROM sys.foreign_keys fk INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id INNER JOIN sys.columns cp ON fkc.parent_column_id = cp.column_id AND fkc.parent_object_id = cp.object_id INNER JOIN sys.columns cr ON fkc.referenced_column_id = cr.column_id AND fkc.referenced_object_id = cr.object_id;`;
    }
    if (fkQuery) {
      try {
        const res = await dbExecuteQuery(profile.id, fkQuery);
        if (res.rows && res.rows.length > 0) {
          const relations: ForeignKeyRelation[] = res.rows.map((r: any) => ({
            tableName: r.tableName || r.table_name || '',
            columnName: r.columnName || r.column_name || '',
            foreignTableName: r.foreignTableName || r.foreign_table_name || '',
            foreignColumnName: r.foreignColumnName || r.foreign_column_name || '',
            constraintName: r.constraintName || r.constraint_name || undefined
          })).filter((r: any) => r.tableName && r.foreignTableName);
          setForeignKeysList(relations);
        }
      } catch (e) {
        console.warn('[Native DB] Foreign key query notice:', e);
      }
    }
  };

  const fetchRoutinesNative = async (profile: DbConnectionProfile) => {
    let procQuery = '';
    if (profile.engine === 'mysql' || profile.engine === 'mariadb') {
      procQuery = `SELECT ROUTINE_NAME as routine_name, ROUTINE_TYPE as routine_type FROM information_schema.routines WHERE routine_schema='${profile.database}';`;
    } else if (profile.engine === 'postgresql') {
      procQuery = `SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema='public';`;
    } else if (profile.engine === 'mssql') {
      procQuery = `SELECT ROUTINE_NAME as routine_name, ROUTINE_TYPE as routine_type FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA='dbo';`;
    }
    if (procQuery) {
      try {
        const res = await dbExecuteQuery(profile.id, procQuery);
        if (res.rows && res.rows.length > 0) {
          const procs = res.rows.map((r: any) => ({
            name: r.routine_name || r.ROUTINE_NAME || '',
            type: (String(r.routine_type || r.ROUTINE_TYPE || '').toLowerCase().includes('func') ? 'function' : 'procedure') as 'function' | 'procedure'
          }));
          setRoutinesList(procs);
        }
      } catch (e) {
        console.warn('[Native DB] Routines query notice:', e);
      }
    }
  };

  // ─── Fetch Complete Schema Tree (Tables, Columns, FKs, Views) ─────
  const fetchSchemaTree = async (profileToUse?: DbConnectionProfile) => {
    const profile = profileToUse || activeProfile;
    if (!profile) return;
    setFetchingSchema(true);
    setGlobalError(null);

    // ─── Native Driver Schema Fetching ───
    if (isTauri()) {
      try {
        if (profile.engine === 'redis') {
          const keys = await redisScanKeys(profile.id, '*', 200);
          const keyItems = keys.map(k => ({
            name: k.key,
            type: 'table' as const,
            rowCount: k.size ?? 1
          }));
          setTablesList(keyItems);
          setViewsList([]);
          setFetchingSchema(false);
          return;
        } else if (profile.engine === 'mongodb') {
          const colls = await mongodbListCollections(profile.id);
          const collItems = colls.map(c => ({
            name: c,
            type: 'table' as const,
          }));
          setTablesList(collItems);
          setViewsList([]);
          setFetchingSchema(false);
          return;
        } else {
          const objs = await dbListTables(profile.id, profile.database);
          if (objs && objs.length > 0) {
            const tbls: TableItem[] = [];
            const vws: TableItem[] = [];
            objs.forEach(o => {
              const item: TableItem = {
                name: o.name,
                type: o.object_type === 'view' ? 'view' : 'table',
                schema: o.schema || undefined,
                rowCount: o.row_count || undefined,
              };
              if (o.object_type === 'view') vws.push(item);
              else tbls.push(item);
            });
            setTablesList(tbls);
            setViewsList(vws);
            await fetchForeignKeysNative(profile);
            await fetchRoutinesNative(profile);
            setFetchingSchema(false);
            return;
          }
        }
      } catch (nativeErr: any) {
        console.warn('[Native DB] fetchSchemaTree native attempt notice:', nativeErr);
      }
    }

    try {
      let cmd = '';
      if (profile.engine === 'mysql' || profile.engine === 'mariadb') {
        cmd = buildCommand(
          profile,
          `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema='${profile.database}' ORDER BY table_name;`,
          'unaligned'
        );
      } else if (profile.engine === 'postgresql') {
        cmd = buildCommand(
          profile,
          "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;",
          'unaligned'
        );
      } else if (profile.engine === 'sqlite') {
        cmd = buildCommand(
          profile,
          "SELECT name, type FROM sqlite_master WHERE type in ('table','view') ORDER BY name;",
          'unaligned'
        );
      } else if (profile.engine === 'mssql') {
        cmd = buildCommand(
          profile,
          "SELECT TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME;",
          'unaligned'
        );
      } else if (profile.engine === 'mongodb') {
        cmd = buildCommand(profile, 'db.getCollectionNames()', 'raw');
      } else if (profile.engine === 'redis') {
        cmd = buildCommand(profile, 'KEYS "*" | head -n 100', 'raw');
      }

      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code !== 0) {
        const errMsg = res.stderr || res.stdout;
        if (/permission|access denied|eacces/i.test(errMsg)) {
          setGlobalError(`Permission Denied: Insufficient privileges on database '${profile.database}'.`);
        } else {
          setGlobalError(errMsg);
        }
      } else if (res.stdout.trim()) {
        const lines = res.stdout.trim().split('\n');
        if (profile.engine === 'redis') {
          const keys = lines.map(k => ({ name: k.trim(), type: 'table' as const, rowCount: 1 }));
          setTablesList(keys);
          setViewsList([]);
        } else if (profile.engine === 'mongodb') {
          try {
            const parsed = JSON.parse(res.stdout);
            const cols = Array.isArray(parsed) ? parsed : lines;
            setTablesList(cols.map(c => ({ name: String(c), type: 'table' as const })));
          } catch {
            setTablesList(lines.map(c => ({ name: c.trim(), type: 'table' as const })));
          }
          setViewsList([]);
        } else {
          const parsed = lines.map(line => {
            const parts = line.split('|').map(s => s.trim());
            return {
              name: parts[0] || line.trim(),
              type: (parts[1]?.toLowerCase().includes('view') ? 'view' : 'table') as 'table' | 'view',
              rowCount: undefined
            };
          }).filter(t => t.name && !t.name.startsWith('pg_'));

          const tables = parsed.filter(t => t.type === 'table');
          const views = parsed.filter(t => t.type === 'view');
          setTablesList(tables);
          setViewsList(views);
        }
      }

      // ─── Fetch Real Foreign Keys for ER Diagram ──────────────────
      let fkQuery = '';
      if (profile.engine === 'mysql' || profile.engine === 'mariadb') {
        fkQuery = buildCommand(
          profile,
          `SELECT TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, CONSTRAINT_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA='${profile.database}' AND REFERENCED_TABLE_NAME IS NOT NULL;`,
          'unaligned'
        );
      } else if (profile.engine === 'postgresql') {
        fkQuery = buildCommand(
          profile,
          `SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name, tc.constraint_name FROM information_schema.table_constraints AS tc JOIN information_schema.key_column_usage AS kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage AS ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';`,
          'unaligned'
        );
      } else if (profile.engine === 'mssql') {
        fkQuery = buildCommand(
          profile,
          `SELECT tp.name AS tableName, cp.name AS columnName, tr.name AS foreignTableName, cr.name AS foreignColumnName, fk.name AS constraintName FROM sys.foreign_keys fk INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id INNER JOIN sys.columns cp ON fkc.parent_column_id = cp.column_id AND fkc.parent_object_id = cp.object_id INNER JOIN sys.columns cr ON fkc.referenced_column_id = cr.column_id AND fkc.referenced_object_id = cr.object_id;`,
          'unaligned'
        );
      }

      if (fkQuery) {
        const fkRes = await sshExec(activeConnId, fkQuery);
        if (fkRes.exit_code === 0 && fkRes.stdout.trim()) {
          const fkLines = fkRes.stdout.trim().split('\n');
          const relations: ForeignKeyRelation[] = fkLines.map(l => {
            const p = l.split('|').map(s => s.trim());
            return {
              tableName: p[0],
              columnName: p[1],
              foreignTableName: p[2],
              foreignColumnName: p[3],
              constraintName: p[4]
            };
          }).filter(r => r.tableName && r.foreignTableName);
          setForeignKeysList(relations);
        }
      }

      // Fetch Stored Procedures & Functions
      if (profile.engine === 'mysql' || profile.engine === 'mariadb') {
        const procCmd = buildCommand(profile, `SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema='${profile.database}';`, 'unaligned');
        const procRes = await sshExec(activeConnId, procCmd);
        if (procRes.exit_code === 0 && procRes.stdout.trim()) {
          const procs = procRes.stdout.trim().split('\n').map(l => {
            const p = l.split('|').map(s => s.trim());
            return { name: p[0], type: (p[1]?.toLowerCase().includes('func') ? 'function' : 'procedure') as 'function' | 'procedure' };
          });
          setRoutinesList(procs);
        }
      } else if (profile.engine === 'postgresql') {
        const procCmd = buildCommand(profile, "SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema='public';", 'unaligned');
        const procRes = await sshExec(activeConnId, procCmd);
        if (procRes.exit_code === 0 && procRes.stdout.trim()) {
          const procs = procRes.stdout.trim().split('\n').map(l => {
            const p = l.split('|').map(s => s.trim());
            return { name: p[0], type: (p[1]?.toLowerCase().includes('func') ? 'function' : 'procedure') as 'function' | 'procedure' };
          });
          setRoutinesList(procs);
        }
      } else if (profile.engine === 'mssql') {
        const procCmd = buildCommand(profile, "SELECT ROUTINE_NAME, ROUTINE_TYPE FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA='dbo';", 'unaligned');
        const procRes = await sshExec(activeConnId, procCmd);
        if (procRes.exit_code === 0 && procRes.stdout.trim()) {
          const procs = procRes.stdout.trim().split('\n').map(l => {
            const p = l.split('|').map(s => s.trim());
            return { name: p[0], type: (p[1]?.toLowerCase().includes('func') ? 'function' : 'procedure') as 'function' | 'procedure' };
          });
          setRoutinesList(procs);
        }
      }
    } catch (err: any) {
      setGlobalError(String(err?.message || err));
    } finally {
      setFetchingSchema(false);
    }
  };

  // ─── Fetch Table Columns / Structure (Real Columns) ───────────────
  const fetchTableStructure = async (tableName: string): Promise<ColumnDefinition[]> => {
    if (!activeProfile) return [];
    setLoadingStructure(true);
    setLoadingTableCols(prev => ({ ...prev, [tableName]: true }));
    setGlobalError(null);

    if (isTauri() && activeProfile.engine !== 'redis' && activeProfile.engine !== 'mongodb') {
      try {
        const rawCols = await dbGetTableColumns(activeProfile.id, tableName);
        if (rawCols && rawCols.length > 0) {
          const cols: ColumnDefinition[] = rawCols.map(c => ({
            name: c.name,
            type: c.data_type,
            nullable: c.nullable,
            isPrimaryKey: c.is_primary_key,
            isForeignKey: c.is_foreign_key,
            referencedTable: c.referenced_table || undefined,
            referencedColumn: c.referenced_column || undefined,
            autoIncrement: c.extra?.includes('auto_increment') || false,
            defaultValue: c.default_value || undefined,
          }));

          setTableStructureColumns(cols);
          setTablesList(prev =>
            prev.map(t => t.name === tableName ? { ...t, columns: cols } : t)
          );
          fetchTableIndexes(tableName);
          setLoadingStructure(false);
          setLoadingTableCols(prev => ({ ...prev, [tableName]: false }));
          return cols;
        }
      } catch (err: any) {
        console.warn('[Native DB] getTableColumns fallback:', err);
      }
    }

    try {
      let structCmd = '';
      if (activeProfile.engine === 'mysql' || activeProfile.engine === 'mariadb') {
        structCmd = buildCommand(
          activeProfile,
          `SELECT column_name, column_type, is_nullable, column_key, extra, column_default FROM information_schema.columns WHERE table_schema='${activeProfile.database}' AND table_name='${tableName}' ORDER BY ordinal_position;`,
          'unaligned'
        );
      } else if (activeProfile.engine === 'postgresql') {
        structCmd = buildCommand(
          activeProfile,
          `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name='${tableName}';`,
          'unaligned'
        );
      } else if (activeProfile.engine === 'sqlite') {
        structCmd = buildCommand(activeProfile, `PRAGMA table_info('${tableName}');`, 'unaligned');
      } else if (activeProfile.engine === 'mssql') {
        structCmd = buildCommand(
          activeProfile,
          `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='${tableName}';`,
          'unaligned'
        );
      }

      if (structCmd) {
        const res = await sshExec(activeConnId, structCmd);
        if (res.exit_code === 0 && res.stdout.trim()) {
          const lines = res.stdout.trim().split('\n');
          const cols: ColumnDefinition[] = lines.map(line => {
            const parts = line.split('|').map(s => s.trim());
            if (activeProfile.engine === 'sqlite') {
              return {
                name: parts[1] || 'col',
                type: parts[2] || 'TEXT',
                nullable: parts[3] !== '1',
                isPrimaryKey: parts[5] === '1',
                defaultValue: parts[4] || undefined,
              };
            }
            const isPK = parts[3]?.includes('PRI') || false;
            const isFK = foreignKeysList.some(fk => fk.tableName === tableName && fk.columnName === parts[0]);
            const fkRef = foreignKeysList.find(fk => fk.tableName === tableName && fk.columnName === parts[0]);

            return {
              name: parts[0] || 'col',
              type: parts[1] || 'VARCHAR',
              nullable: parts[2] === 'YES',
              isPrimaryKey: isPK,
              isForeignKey: isFK,
              referencedTable: fkRef?.foreignTableName,
              referencedColumn: fkRef?.foreignColumnName,
              autoIncrement: parts[4]?.includes('auto_increment') || false,
              defaultValue: parts[5] || undefined,
            };
          });

          setTableStructureColumns(cols);

          // Update cache on table item
          setTablesList(prev =>
            prev.map(t => t.name === tableName ? { ...t, columns: cols } : t)
          );
          fetchTableIndexes(tableName);
          return cols;
        }
      }
    } catch (err: any) {
      setGlobalError(String(err?.message || err));
    } finally {
      setLoadingStructure(false);
      setLoadingTableCols(prev => ({ ...prev, [tableName]: false }));
    }
    return [];
  };

  // ─── Fetch Table Indexes ──────────────────────────────────────────
  const fetchTableIndexes = async (tableName: string) => {
    if (!activeProfile) return;
    try {
      let idxCmd = '';
      if (activeProfile.engine === 'mysql' || activeProfile.engine === 'mariadb') {
        idxCmd = buildCommand(activeProfile, `SHOW INDEX FROM ${tableName};`, 'unaligned');
      } else if (activeProfile.engine === 'postgresql') {
        idxCmd = buildCommand(activeProfile, `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = '${tableName}';`, 'unaligned');
      } else if (activeProfile.engine === 'sqlite') {
        idxCmd = buildCommand(activeProfile, `PRAGMA index_list('${tableName}');`, 'unaligned');
      } else if (activeProfile.engine === 'mssql') {
        idxCmd = buildCommand(activeProfile, `SELECT name, is_unique, type_desc FROM sys.indexes WHERE object_id = OBJECT_ID('${tableName}');`, 'unaligned');
      }

      if (idxCmd) {
        const res = await sshExec(activeConnId, idxCmd);
        if (res.exit_code === 0 && res.stdout.trim()) {
          const lines = res.stdout.trim().split('\n');
          const items: IndexItem[] = lines.map(line => {
            const parts = line.split('|').map(s => s.trim());
            return {
              name: parts[2] || parts[0] || 'idx',
              tableName,
              columnName: parts[4] || parts[1] || '',
              isUnique: parts[1] === '0' || parts[2]?.includes('UNIQUE') || false,
              type: parts[10] || 'BTREE'
            };
          }).filter(i => i.name && !i.name.includes('table_name'));
          setIndexesList(items);
        }
      }
    } catch {}
  };

  // ─── Fetch Table Data (Populates Data Grid ONLY, Never Overwrites Query Tab!) ─
  const fetchTableDataGrid = async (tableName: string, limitOverride?: number) => {
    if (!activeProfile) return;
    const limit = limitOverride || dataGrid.pageSize;

    setDataGrid(prev => ({
      ...prev,
      table: tableName,
      loading: true,
      error: null,
      sortColumn: null,
      sortDirection: null,
      selectedRowIndex: null,
    }));

    if (isTauri()) {
      try {
        if (activeProfile.engine === 'redis') {
          const valItem = await redisGetValue(activeProfile.id, tableName);
          const row = {
            key: valItem.key,
            type: valItem.key_type,
            ttl: valItem.ttl,
            value: typeof valItem.value === 'object' ? JSON.stringify(valItem.value) : String(valItem.value ?? '')
          };
          setDataGrid(prev => ({
            ...prev,
            table: tableName,
            rows: [row],
            columns: ['key', 'type', 'ttl', 'value'],
            totalCount: 1,
            loading: false,
            error: null
          }));
          return;
        } else if (activeProfile.engine === 'mongodb') {
          const res = await mongodbFindDocuments(activeProfile.id, tableName, undefined, 0, limit);
          const rows = res.rows.map(r => (typeof r === 'object' && r !== null) ? r : { document: r });
          const cols = rows.length > 0 ? Object.keys(rows[0]) : ['document'];
          setDataGrid(prev => ({
            ...prev,
            table: tableName,
            rows,
            columns: cols,
            totalCount: rows.length,
            loading: false,
            error: null
          }));
          return;
        } else {
          let query = `SELECT * FROM ${tableName} LIMIT ${limit};`;
          if (activeProfile.engine === 'mssql') {
            query = `SELECT TOP ${limit} * FROM ${tableName};`;
          }
          const res = await dbExecuteQuery(activeProfile.id, query);
          const cols = res.columns.map(c => c.name);
          setDataGrid(prev => ({
            ...prev,
            table: tableName,
            rows: res.rows,
            columns: cols,
            totalCount: res.rows.length,
            loading: false,
            error: null
          }));
          return;
        }
      } catch (err: any) {
        console.warn('[Native DB] DataGrid fetch notice:', err);
        setDataGrid(prev => ({
          ...prev,
          loading: false,
          error: String(err?.message || err),
          rows: [],
          columns: []
        }));
        return;
      }
    }

    try {
      let query = `SELECT * FROM ${tableName} LIMIT ${limit};`;
      if (activeProfile.engine === 'mssql') {
        query = `SELECT TOP ${limit} * FROM ${tableName};`;
      } else if (activeProfile.engine === 'mongodb') {
        query = `db.${tableName}.find().limit(${limit})`;
      } else if (activeProfile.engine === 'redis') {
        query = `GET ${tableName}`;
      }

      const cmd = buildCommand(activeProfile, query, 'tabular');
      const res = await sshExec(activeConnId, cmd);

      if (res.exit_code !== 0) {
        setDataGrid(prev => ({
          ...prev,
          loading: false,
          error: res.stderr || res.stdout || 'Failed to query table data',
          rows: [],
          columns: []
        }));
      } else {
        const out = res.stdout.trim();
        const lines = out.split('\n').filter(l => l.trim().length > 0);
        let parsedRows: any[] = [];
        let parsedCols: string[] = [];

        if (lines.length >= 2) {
          const header = lines[0].split('|').map(s => s.trim()).filter(Boolean);
          if (header.length > 0 && lines[1].includes('-')) {
            parsedCols = header;
            parsedRows = lines.slice(2).map(line => {
              if (line.includes('(') && line.includes('row')) return null;
              const values = line.split('|').map(s => s.trim());
              const rowObj: Record<string, string> = {};
              header.forEach((h, i) => {
                rowObj[h] = values[i] !== undefined ? values[i] : '';
              });
              return rowObj;
            }).filter(Boolean);
          }
        }

        setDataGrid(prev => ({
          ...prev,
          table: tableName,
          rows: parsedRows,
          columns: parsedCols,
          totalCount: parsedRows.length,
          loading: false,
          error: null
        }));
      }
    } catch (err: any) {
      setDataGrid(prev => ({
        ...prev,
        loading: false,
        error: String(err?.message || err)
      }));
    }
  };

  // ─── Table Click in Left Menu ─────────────────────────────────────
  const handleSelectTable = (tblName: string) => {
    setSelectedTable(tblName);
    setMainView('data-grid');
    fetchTableDataGrid(tblName);
    fetchTableStructure(tblName);
  };

  // Toggle table columns expansion in left sidebar tree
  const toggleTableExpansion = async (tblName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const table = tablesList.find(t => t.name === tblName);
    const willExpand = !table?.isExpanded;

    setTablesList(prev =>
      prev.map(t => t.name === tblName ? { ...t, isExpanded: willExpand } : t)
    );

    if (willExpand && (!table?.columns || table.columns.length === 0)) {
      await fetchTableStructure(tblName);
    }
  };

  // ─── Execute Active Query (Selected Lines or Full Query) ──────────
  const executeActiveQuery = async (overrideQuery?: string) => {
    if (!activeProfile) {
      setIsConnectionModalOpen(true);
      return;
    }

    // Determine query: If user selected text in Monaco, execute ONLY selected lines!
    let targetQuery = overrideQuery;
    if (!targetQuery) {
      if (monacoEditorRef.current) {
        const selection = monacoEditorRef.current.getSelection();
        const selectedText = monacoEditorRef.current.getModel()?.getValueInRange(selection);
        if (selectedText && selectedText.trim().length > 0) {
          targetQuery = selectedText.trim();
        }
      }
      if (!targetQuery) {
        targetQuery = activeTab.query.trim();
      }
    }

    if (!targetQuery) return;

    setExecuting(true);
    setGlobalError(null);
    const start = performance.now();

    if (isTauri()) {
      try {
        const queryRes = await dbExecuteQuery(activeProfile.id, targetQuery);
        const elapsed = queryRes.execution_time_ms.toFixed(1);
        const dur = `${elapsed} ms`;
        const cols = queryRes.columns.map(c => c.name);
        const rows = queryRes.rows;

        const info = rows.length > 0
          ? `Executed in ${dur}. Returned ${rows.length} rows.`
          : `Statement executed successfully in ${dur}. Affected rows: ${queryRes.affected_rows || 0}.`;

        setQueryTabs(prev =>
          prev.map(t =>
            t.id === activeTab.id
              ? {
                  ...t,
                  execTime: dur,
                  error: null,
                  successInfo: info,
                  rawOutput: JSON.stringify(rows.slice(0, 10), null, 2),
                  results: rows,
                  columns: cols,
                  sortColumn: null,
                  sortDirection: null,
                }
              : t
          )
        );
        setExecuting(false);
        return;
      } catch (err: any) {
        const errMsg = String(err?.message || err);
        const dur = `${(performance.now() - start).toFixed(1)} ms`;
        setQueryTabs(prev =>
          prev.map(t =>
            t.id === activeTab.id
              ? {
                  ...t,
                  execTime: dur,
                  error: errMsg,
                  successInfo: null,
                  rawOutput: errMsg,
                  results: [],
                  columns: []
                }
              : t
          )
        );
        setExecuting(false);
        return;
      }
    }

    try {
      const cmd = buildCommand(activeProfile, targetQuery, 'tabular');
      const res = await sshExec(activeConnId, cmd);
      const elapsed = (performance.now() - start).toFixed(1);
      const dur = `${elapsed} ms`;

      if (res.exit_code !== 0) {
        const errMsg = res.stderr.trim() || res.stdout.trim();
        setQueryTabs(prev =>
          prev.map(t =>
            t.id === activeTab.id
              ? {
                  ...t,
                  execTime: dur,
                  error: errMsg,
                  successInfo: null,
                  rawOutput: errMsg,
                  results: [],
                  columns: []
                }
              : t
          )
        );
      } else {
        const out = res.stdout.trim();
        const lines = out.split('\n').filter(l => l.trim().length > 0);
        let parsedRows: any[] = [];
        let parsedCols: string[] = [];

        if (lines.length >= 2) {
          const header = lines[0].split('|').map(s => s.trim()).filter(Boolean);
          if (header.length > 0 && lines[1].includes('-')) {
            parsedCols = header;
            parsedRows = lines.slice(2).map(line => {
              if (line.includes('(') && line.includes('row')) return null;
              const values = line.split('|').map(s => s.trim());
              const rowObj: Record<string, string> = {};
              header.forEach((h, i) => {
                rowObj[h] = values[i] !== undefined ? values[i] : '';
              });
              return rowObj;
            }).filter(Boolean);
          }
        }

        const info = parsedRows.length > 0
          ? `Executed in ${dur}. Returned ${parsedRows.length} rows.`
          : `Statement executed successfully in ${dur}.`;

        setQueryTabs(prev =>
          prev.map(t =>
            t.id === activeTab.id
              ? {
                  ...t,
                  execTime: dur,
                  error: null,
                  successInfo: info,
                  rawOutput: out,
                  results: parsedRows,
                  columns: parsedCols,
                  sortColumn: null,
                  sortDirection: null,
                }
              : t
          )
        );
      }
    } catch (err: any) {
      setQueryTabs(prev =>
        prev.map(t =>
          t.id === activeTab.id ? { ...t, error: String(err?.message || err), successInfo: null } : t
        )
      );
    } finally {
      setExecuting(false);
    }
  };

  // Keep a ref to latest executeActiveQuery to eliminate React closure staleness on Ctrl+Enter
  const executeActiveQueryRef = useRef(executeActiveQuery);
  executeActiveQueryRef.current = executeActiveQuery;

  // ─── Global Keyboard Shortcuts (Ctrl+Enter, Cmd+Enter) ─────────────
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        executeActiveQueryRef.current();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // ─── DataGrid Arrow Key Navigation & Selection ─────────────────────
  useEffect(() => {
    const handleDataGridKeyDown = (e: KeyboardEvent) => {
      if (mainView !== 'data-grid' || dataGrid.rows.length === 0) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setDataGrid(prev => {
          const nextIdx = prev.selectedRowIndex === null ? 0 : Math.max(0, prev.selectedRowIndex - 1);
          return { ...prev, selectedRowIndex: nextIdx };
        });
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setDataGrid(prev => {
          const maxIdx = filteredGridRows.length - 1;
          const nextIdx = prev.selectedRowIndex === null ? 0 : Math.min(maxIdx, prev.selectedRowIndex + 1);
          return { ...prev, selectedRowIndex: nextIdx };
        });
      } else if (e.key === 'Escape') {
        setDataGrid(prev => ({ ...prev, selectedRowIndex: null }));
      } else if (e.key === 'Enter' && dataGrid.selectedRowIndex !== null) {
        e.preventDefault();
        const row = filteredGridRows[dataGrid.selectedRowIndex];
        if (row) {
          setRowFormData(row);
          setRowModalError(null);
          setShowEditRowModal(true);
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && dataGrid.selectedRowIndex !== null) {
        e.preventDefault();
        handleDeleteRow(dataGrid.selectedRowIndex);
      }
    };

    window.addEventListener('keydown', handleDataGridKeyDown);
    return () => window.removeEventListener('keydown', handleDataGridKeyDown);
  }, [mainView, dataGrid.rows, dataGrid.selectedRowIndex]);

  // Close context menu on outside click
  useEffect(() => {
    const closeCtx = () => setContextMenu(null);
    window.addEventListener('click', closeCtx);
    return () => window.removeEventListener('click', closeCtx);
  }, []);

  // ─── Query Tabs Manager ───────────────────────────────────────────
  const addNewQueryTab = () => {
    const newId = `tab-${Date.now()}`;
    const nextNum = queryTabs.length + 1;
    const initialQuery = `SELECT * FROM ${tablesList[0]?.name || 'users'} LIMIT 50;`;

    const newTab: QueryTab = {
      id: newId,
      title: `Query ${nextNum}`,
      query: initialQuery,
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

  const closeQueryTab = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (queryTabs.length <= 1) return;
    const remaining = queryTabs.filter(t => t.id !== id);
    setQueryTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining[remaining.length - 1].id);
    }
  };

  // ─── Data Grid Sorting with Primary Key Safety ────────────────────
  const handleSortDataGrid = (col: string) => {
    setDataGrid(prev => {
      let nextDir: 'asc' | 'desc' | null = 'asc';
      if (prev.sortColumn === col) {
        if (prev.sortDirection === 'asc') nextDir = 'desc';
        else if (prev.sortDirection === 'desc') nextDir = null;
      }

      if (!nextDir) {
        return {
          ...prev,
          sortColumn: null,
          sortDirection: null,
        };
      }

      const sortedRows = [...prev.rows].sort((a, b) => {
        const valA = a[col] ?? '';
        const valB = b[col] ?? '';
        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB)) {
          return nextDir === 'asc' ? numA - numB : numB - numA;
        }
        return nextDir === 'asc' ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
      });

      return {
        ...prev,
        rows: sortedRows,
        sortColumn: col,
        sortDirection: nextDir,
        selectedRowIndex: null
      };
    });
  };

  // ─── Move Column Up / Down in Structure (Physical & Logical) ──────
  const handleMoveColumn = async (colIdx: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? colIdx - 1 : colIdx + 1;
    if (targetIdx < 0 || targetIdx >= tableStructureColumns.length || !selectedTable || !activeProfile) return;

    const movingCol = tableStructureColumns[colIdx];
    const prevCol = direction === 'up' && targetIdx > 0 ? tableStructureColumns[targetIdx - 1] : tableStructureColumns[targetIdx];

    // Local swap immediately
    setTableStructureColumns(prev => {
      const next = [...prev];
      const temp = next[colIdx];
      next[colIdx] = next[targetIdx];
      next[targetIdx] = temp;
      return next;
    });

    // If MySQL or MariaDB, execute ALTER TABLE MODIFY COLUMN to physically reorder!
    if (activeProfile.engine === 'mysql' || activeProfile.engine === 'mariadb') {
      try {
        const nullClause = movingCol.nullable ? 'NULL' : 'NOT NULL';
        const positionClause = direction === 'up' && targetIdx === 0 ? 'FIRST' : `AFTER ${prevCol.name}`;
        const reorderSql = `ALTER TABLE ${selectedTable} MODIFY COLUMN ${movingCol.name} ${movingCol.type} ${nullClause} ${positionClause};`;
        const cmd = buildCommand(activeProfile, reorderSql, 'unaligned');
        await sshExec(activeConnId, cmd);
      } catch {}
    }
  };

  // ─── Safe Row Insert / Update with In-Modal Error ──────────────────
  const handleSaveRow = async () => {
    if (!activeProfile || !dataGrid.table) return;
    setIsMutatingRow(true);
    setRowModalError(null);

    try {
      let mutationSql = '';
      if (showAddRowModal) {
        const entries = Object.entries(rowFormData).filter(([_, v]) => v !== undefined && v !== '');
        const colNames = entries.map(([k]) => k).join(', ');
        const colVals = entries.map(([_, v]) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
        mutationSql = `INSERT INTO ${dataGrid.table} (${colNames}) VALUES (${colVals});`;
      } else if (showEditRowModal && dataGrid.selectedRowIndex !== null) {
        const row = dataGrid.rows[dataGrid.selectedRowIndex];
        const pkCol = tableStructureColumns.find(c => c.isPrimaryKey)?.name || Object.keys(row)[0];
        const pkVal = row[pkCol];
        const setClauses = Object.entries(rowFormData)
          .map(([k, v]) => `${k} = '${String(v).replace(/'/g, "''")}'`)
          .join(', ');
        mutationSql = `UPDATE ${dataGrid.table} SET ${setClauses} WHERE ${pkCol} = '${pkVal}';`;
      }

      if (isTauri()) {
        try {
          await dbExecuteQuery(activeProfile.id, mutationSql);
          setShowAddRowModal(false);
          setShowEditRowModal(false);
          setRowFormData({});
          fetchTableDataGrid(dataGrid.table);
          setIsMutatingRow(false);
          return;
        } catch (e: any) {
          setRowModalError(String(e?.message || e));
          setIsMutatingRow(false);
          return;
        }
      }

      const cmd = buildCommand(activeProfile, mutationSql, 'unaligned');
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code !== 0) {
        setRowModalError(res.stderr || res.stdout || 'Execution error during row save.');
      } else {
        setShowAddRowModal(false);
        setShowEditRowModal(false);
        setRowFormData({});
        fetchTableDataGrid(dataGrid.table);
      }
    } catch (err: any) {
      setRowModalError(String(err?.message || err));
    } finally {
      setIsMutatingRow(false);
    }
  };

  const handleDeleteRow = async (rowIndex: number) => {
    if (!activeProfile || !dataGrid.table) return;
    const row = dataGrid.rows[rowIndex];
    const pkCol = tableStructureColumns.find(c => c.isPrimaryKey)?.name || Object.keys(row)[0];
    const pkVal = row[pkCol];

    if (!confirm(`Permanently delete row (WHERE ${pkCol} = '${pkVal}')?`)) return;

    try {
      const deleteSql = `DELETE FROM ${dataGrid.table} WHERE ${pkCol} = '${pkVal}';`;
      if (isTauri()) {
        try {
          await dbExecuteQuery(activeProfile.id, deleteSql);
          fetchTableDataGrid(dataGrid.table);
          return;
        } catch (e: any) {
          setGlobalError(`Delete failed: ${String(e?.message || e)}`);
          return;
        }
      }
      const cmd = buildCommand(activeProfile, deleteSql, 'unaligned');
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code !== 0) {
        setGlobalError(`Delete failed: ${res.stderr || res.stdout}`);
      } else {
        fetchTableDataGrid(dataGrid.table);
      }
    } catch (err: any) {
      setGlobalError(String(err?.message || err));
    }
  };

  // ─── Column Designer: Add / Edit Column with In-Modal Error ───────
  const handleSaveColumnDefinition = async () => {
    if (!activeProfile || !selectedTable || !colFormName.trim()) return;
    setColModalError(null);

    try {
      let colSql = '';
      if (showColumnModal === 'add') {
        const nullClause = colFormNullable ? 'NULL' : 'NOT NULL';
        const pkClause = colFormPK ? 'PRIMARY KEY' : '';
        const defaultClause = colFormDefault.trim() ? `DEFAULT '${colFormDefault.trim()}'` : '';
        colSql = `ALTER TABLE ${selectedTable} ADD COLUMN ${colFormName.trim()} ${colFormType.trim()} ${nullClause} ${defaultClause} ${pkClause};`;
      } else if (showColumnModal === 'edit') {
        const nullClause = colFormNullable ? 'NULL' : 'NOT NULL';
        const defaultClause = colFormDefault.trim() ? `DEFAULT '${colFormDefault.trim()}'` : '';
        if (activeProfile.engine === 'mysql' || activeProfile.engine === 'mariadb') {
          colSql = `ALTER TABLE ${selectedTable} CHANGE COLUMN ${colFormOriginalName} ${colFormName.trim()} ${colFormType.trim()} ${nullClause} ${defaultClause};`;
        } else if (activeProfile.engine === 'postgresql') {
          colSql = `ALTER TABLE ${selectedTable} ALTER COLUMN ${colFormOriginalName} TYPE ${colFormType.trim()};`;
        } else if (activeProfile.engine === 'mssql') {
          colSql = `ALTER TABLE ${selectedTable} ALTER COLUMN ${colFormName.trim()} ${colFormType.trim()} ${nullClause};`;
        } else {
          colSql = `ALTER TABLE ${selectedTable} RENAME COLUMN ${colFormOriginalName} TO ${colFormName.trim()};`;
        }
      }

      if (isTauri()) {
        try {
          await dbExecuteQuery(activeProfile.id, colSql);
          setShowColumnModal(null);
          fetchTableStructure(selectedTable);
          return;
        } catch (e: any) {
          setColModalError(String(e?.message || e));
          return;
        }
      }

      const cmd = buildCommand(activeProfile, colSql, 'unaligned');
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code !== 0) {
        setColModalError(res.stderr || res.stdout || 'Failed to alter column.');
      } else {
        setShowColumnModal(null);
        fetchTableStructure(selectedTable);
      }
    } catch (err: any) {
      setColModalError(String(err?.message || err));
    }
  };

  const handleDropColumn = async (colName: string) => {
    if (!activeProfile || !selectedTable) return;
    if (!confirm(`Drop column '${colName}' from table '${selectedTable}'?`)) return;

    try {
      const dropSql = `ALTER TABLE ${selectedTable} DROP COLUMN ${colName};`;
      if (isTauri()) {
        try {
          await dbExecuteQuery(activeProfile.id, dropSql);
          fetchTableStructure(selectedTable);
          return;
        } catch (e: any) {
          setGlobalError(`Drop column error: ${String(e?.message || e)}`);
          return;
        }
      }
      const cmd = buildCommand(activeProfile, dropSql, 'unaligned');
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code !== 0) {
        setGlobalError(`Drop column error: ${res.stderr || res.stdout}`);
      } else {
        fetchTableStructure(selectedTable);
      }
    } catch (err: any) {
      setGlobalError(String(err?.message || err));
    }
  };

  // ─── Visual Create Table Modal with In-Modal Error ────────────────
  const handleCreateTable = async () => {
    if (!activeProfile || !newTableName.trim()) return;
    setCreateTableModalError(null);

    try {
      const colDefs = newTableCols.map(c => {
        const nullClause = c.nullable ? 'NULL' : 'NOT NULL';
        const pkClause = c.isPK ? 'PRIMARY KEY' : '';
        const autoClause = c.autoInc ? (activeProfile.engine === 'postgresql' ? '' : activeProfile.engine === 'mssql' ? 'IDENTITY(1,1)' : 'AUTO_INCREMENT') : '';
        const defClause = c.defaultValue.trim() ? `DEFAULT '${c.defaultValue.trim()}'` : '';
        return `${c.name} ${c.type} ${nullClause} ${autoClause} ${defClause} ${pkClause}`.trim();
      }).join(',\n  ');

      const createSql = `CREATE TABLE ${newTableName.trim()} (\n  ${colDefs}\n);`;
      if (isTauri()) {
        try {
          await dbExecuteQuery(activeProfile.id, createSql);
          setShowCreateTableModal(false);
          setNewTableName('');
          fetchSchemaTree();
          return;
        } catch (e: any) {
          setCreateTableModalError(String(e?.message || e));
          return;
        }
      }
      const cmd = buildCommand(activeProfile, createSql, 'unaligned');
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code !== 0) {
        setCreateTableModalError(res.stderr || res.stdout || 'Error creating table.');
      } else {
        setShowCreateTableModal(false);
        setNewTableName('');
        fetchSchemaTree();
      }
    } catch (err: any) {
      setCreateTableModalError(String(err?.message || err));
    }
  };

  // ─── Stored Procedures & Functions Actions ────────────────────────
  const handleSaveRoutine = async () => {
    if (!activeProfile || !routineFormName.trim()) return;
    setRoutineModalError(null);

    try {
      let routineSql = '';
      if (showRoutineModal === 'procedure') {
        routineSql = `CREATE PROCEDURE ${routineFormName.trim()}(${routineFormParams})\nBEGIN\n${routineFormBody}\nEND;`;
      } else {
        routineSql = `CREATE FUNCTION ${routineFormName.trim()}(${routineFormParams}) RETURNS ${routineFormReturnType}\nDETERMINISTIC\nBEGIN\n${routineFormBody}\nEND;`;
      }

      if (isTauri()) {
        try {
          await dbExecuteQuery(activeProfile.id, routineSql);
          setShowRoutineModal(null);
          setRoutineFormName('');
          fetchSchemaTree();
          return;
        } catch (e: any) {
          setRoutineModalError(String(e?.message || e));
          return;
        }
      }

      const cmd = buildCommand(activeProfile, routineSql, 'unaligned');
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code !== 0) {
        setRoutineModalError(res.stderr || res.stdout || 'Failed to create routine.');
      } else {
        setShowRoutineModal(null);
        setRoutineFormName('');
        fetchSchemaTree();
      }
    } catch (err: any) {
      setRoutineModalError(String(err?.message || err));
    }
  };

  const handleDeleteRoutine = async (name: string, type: 'procedure' | 'function') => {
    if (!activeProfile || !confirm(`Permanently drop ${type} '${name}'?`)) return;
    try {
      const dropSql = `DROP ${type.toUpperCase()} IF EXISTS ${name};`;
      if (isTauri()) {
        try {
          await dbExecuteQuery(activeProfile.id, dropSql);
          fetchSchemaTree();
          return;
        } catch (e: any) {
          setGlobalError(`Drop ${type} error: ${String(e?.message || e)}`);
          return;
        }
      }
      const cmd = buildCommand(activeProfile, dropSql, 'unaligned');
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0) {
        fetchSchemaTree();
      } else {
        setGlobalError(`Drop ${type} error: ${res.stderr || res.stdout}`);
      }
    } catch (err: any) {
      setGlobalError(String(err?.message || err));
    }
  };

  // ─── Index Creation & Deletion ────────────────────────────────────
  const handleSaveIndex = async () => {
    if (!activeProfile || !selectedTable || !indexFormName.trim() || indexFormColumns.length === 0) return;
    setIndexModalError(null);

    try {
      const uniqueWord = indexFormUnique ? 'UNIQUE ' : '';
      const colsList = indexFormColumns.join(', ');
      let idxSql = `CREATE ${uniqueWord}INDEX ${indexFormName.trim()} ON ${selectedTable} (${colsList});`;
      if (isTauri()) {
        try {
          await dbExecuteQuery(activeProfile.id, idxSql);
          setShowIndexModal(false);
          setIndexFormName('');
          setIndexFormColumns([]);
          fetchTableIndexes(selectedTable);
          return;
        } catch (e: any) {
          setIndexModalError(String(e?.message || e));
          return;
        }
      }
      const cmd = buildCommand(activeProfile, idxSql, 'unaligned');
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code !== 0) {
        setIndexModalError(res.stderr || res.stdout || 'Failed to create index.');
      } else {
        setShowIndexModal(false);
        setIndexFormName('');
        setIndexFormColumns([]);
        fetchTableIndexes(selectedTable);
      }
    } catch (err: any) {
      setIndexModalError(String(err?.message || err));
    }
  };

  const handleDropIndex = async (indexName: string) => {
    if (!activeProfile || !selectedTable || !confirm(`Drop index '${indexName}'?`)) return;
    try {
      let dropSql = `DROP INDEX ${indexName} ON ${selectedTable};`;
      if (activeProfile.engine === 'postgresql' || activeProfile.engine === 'sqlite') {
        dropSql = `DROP INDEX ${indexName};`;
      }
      if (isTauri()) {
        try {
          await dbExecuteQuery(activeProfile.id, dropSql);
          fetchTableIndexes(selectedTable);
          return;
        } catch (e: any) {
          setGlobalError(String(e?.message || e));
          return;
        }
      }
      const cmd = buildCommand(activeProfile, dropSql, 'unaligned');
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0) {
        fetchTableIndexes(selectedTable);
      } else {
        setGlobalError(res.stderr || res.stdout);
      }
    } catch (err: any) {
      setGlobalError(String(err?.message || err));
    }
  };

  // ─── Resizable Left Sidebar Dragging ──────────────────────────────
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingSidebar.current = true;
    const startX = e.clientX;
    const startW = sidebarWidth;

    const onMouseMove = (moveEvt: MouseEvent) => {
      if (!isResizingSidebar.current) return;
      const newW = Math.max(180, Math.min(500, startW + (moveEvt.clientX - startX)));
      setSidebarWidth(newW);
      localStorage.setItem('clouddesk_db_sidebar_width', String(newW));
    };

    const onMouseUp = () => {
      isResizingSidebar.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // ─── Console Splitter Resizing ────────────────────────────────────
  const startSplitterDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitter.current = true;
    const startY = e.clientY;
    const startH = outputHeight;

    const onMouseMove = (moveEvt: MouseEvent) => {
      if (!isDraggingSplitter.current) return;
      const delta = startY - moveEvt.clientY;
      const newH = Math.max(80, Math.min(650, startH + delta));
      setOutputHeight(newH);
      setIsOutputMinimized(false);
    };

    const onMouseUp = () => {
      isDraggingSplitter.current = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // ─── Fetch Active Database Query Threads / Processes ──────────────
  const fetchProcesses = async () => {
    if (!activeProfile) return;
    setLoadingProcesses(true);
    try {
      if (isTauri()) {
        try {
          let procQuery = 'SHOW FULL PROCESSLIST;';
          if (activeProfile.engine === 'postgresql') {
            procQuery = "SELECT pid, usename, client_addr, state, query FROM pg_stat_activity WHERE state != 'idle' LIMIT 50;";
          } else if (activeProfile.engine === 'mssql') {
            procQuery = 'SELECT session_id, status, command, cpu_time, total_elapsed_time, text FROM sys.dm_exec_requests CROSS APPLY sys.dm_exec_sql_text(sql_handle);';
          }
          if (activeProfile.engine !== 'redis' && activeProfile.engine !== 'mongodb') {
            const res = await dbExecuteQuery(activeProfile.id, procQuery);
            if (res.rows) {
              setProcesses(res.rows);
              setLoadingProcesses(false);
              return;
            }
          }
        } catch (e) {
          console.warn('[Native DB] fetchProcesses native attempt:', e);
        }
      }

      let procCmd = 'SHOW FULL PROCESSLIST;';
      if (activeProfile.engine === 'postgresql') {
        procCmd = "SELECT pid, usename, client_addr, state, query, duration FROM pg_stat_activity WHERE state != 'idle' LIMIT 50;";
      } else if (activeProfile.engine === 'mssql') {
        procCmd = 'SELECT session_id, status, command, cpu_time, total_elapsed_time, text FROM sys.dm_exec_requests CROSS APPLY sys.dm_exec_sql_text(sql_handle);';
      } else if (activeProfile.engine === 'redis') {
        procCmd = 'CLIENT LIST';
      }
      const cmd = buildCommand(activeProfile, procCmd, 'tabular');
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0 && res.stdout.trim()) {
        const lines = res.stdout.trim().split('\n');
        if (lines.length >= 2) {
          const header = lines[0].split('|').map(s => s.trim()).filter(Boolean);
          const parsed = lines.slice(2).map(l => {
            const vals = l.split('|').map(s => s.trim());
            const obj: any = {};
            header.forEach((h, i) => obj[h] = vals[i] || '');
            return obj;
          });
          setProcesses(parsed);
        }
      }
    } catch {}
    setLoadingProcesses(false);
  };

  const handleKillProcess = async (id: string) => {
    if (!activeProfile || !confirm(`Terminate query/session ${id}?`)) return;
    let killSql = `KILL ${id};`;
    if (activeProfile.engine === 'postgresql') {
      killSql = `SELECT pg_terminate_backend(${id});`;
    }
    if (isTauri()) {
      try {
        await dbExecuteQuery(activeProfile.id, killSql);
        fetchProcesses();
        return;
      } catch (e: any) {
        setGlobalError(`Kill session error: ${String(e?.message || e)}`);
      }
    }
    const cmd = buildCommand(activeProfile, killSql, 'unaligned');
    await sshExec(activeConnId, cmd);
    fetchProcesses();
  };

  // ─── CSV Export Handler ───────────────────────────────────────────
  const exportCSV = (rows: any[], columns: string[], fileName: string) => {
    if (rows.length === 0) return;
    const cols = columns.length > 0 ? columns : Object.keys(rows[0]);
    const csvContent = [
      cols.map(c => `"${c.replace(/"/g, '""')}"`).join(','),
      ...rows.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))
    ].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}_export_${Date.now()}.csv`;
    a.click();
  };

  // Filtered tables for left sidebar
  const filteredTables = useMemo(() => {
    if (!searchTableFilter.trim()) return tablesList;
    return tablesList.filter(t => t.name.toLowerCase().includes(searchTableFilter.toLowerCase()));
  }, [tablesList, searchTableFilter]);

  // Filtered rows for Data Grid view
  const filteredGridRows = useMemo(() => {
    if (!dataGridFilter.trim()) return dataGrid.rows;
    const term = dataGridFilter.toLowerCase();
    return dataGrid.rows.filter(row =>
      Object.values(row).some(v => String(v).toLowerCase().includes(term))
    );
  }, [dataGrid.rows, dataGridFilter]);

  // Console output sorted rows
  const sortedConsoleRows = useMemo(() => {
    if (!activeTab.sortColumn || !activeTab.sortDirection) return activeTab.results;
    const col = activeTab.sortColumn;
    const dir = activeTab.sortDirection;
    return [...activeTab.results].sort((a, b) => {
      const valA = a[col] ?? '';
      const valB = b[col] ?? '';
      const numA = Number(valA);
      const numB = Number(valB);
      if (!isNaN(numA) && !isNaN(numB)) {
        return dir === 'asc' ? numA - numB : numB - numA;
      }
      return dir === 'asc' ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
    });
  }, [activeTab.results, activeTab.sortColumn, activeTab.sortDirection]);

  // ─── SCREEN 1: Connection Profiles Launcher ────────────────────────
  if (!activeProfile && !isConnectionModalOpen) {
    const displayedProfiles = selectedEngineFilter === 'all'
      ? savedProfiles
      : savedProfiles.filter(p => p.engine === selectedEngineFilter);

    return (
      <div
        style={{ backgroundColor: currentTheme.bgMain, color: currentTheme.text }}
        className="flex h-full font-sans antialiased overflow-hidden select-none"
      >
        {/* Left Side: Engine Categories & Profiles */}
        <div
          style={{ backgroundColor: currentTheme.bgSidebar, borderColor: currentTheme.border }}
          className="w-80 border-r flex flex-col p-4 shrink-0"
        >
          <div className="flex items-center space-x-3 pb-3 border-b border-white/[0.08]">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight">Database Studio</h2>
              <p className="text-[10px] text-gray-400">Universal Database IDE</p>
            </div>
          </div>

          {/* Engine Category Badges */}
          <div className="py-3 border-b border-white/[0.08]">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">
              Select Engine
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.keys(ENGINE_META) as DbEngine[]).map(eng => {
                const count = savedProfiles.filter(p => p.engine === eng).length;
                const isSelected = selectedEngineFilter === eng;
                return (
                  <button
                    key={eng}
                    onClick={() => {
                      setSelectedEngineFilter(eng);
                      setFormEngine(eng);
                      setFormPort(DEFAULT_PORTS[eng]);
                      setFormUsername(DEFAULT_USERS[eng]);
                      setFormDatabase(DEFAULT_DBS[eng]);
                      setFormCliBinary('');
                      setFormName(`Production ${ENGINE_META[eng].label}`);
                    }}
                    className={`px-2 py-1.5 rounded-lg border flex flex-col items-center justify-center transition-all ${
                      isSelected
                        ? 'bg-blue-600/20 border-blue-500 text-white shadow-md'
                        : 'bg-white/[0.02] border-white/[0.06] text-gray-400 hover:text-white hover:bg-white/[0.05]'
                    }`}
                  >
                    <span className="text-base">{ENGINE_META[eng].icon}</span>
                    <span className="text-[10px] font-medium">{ENGINE_META[eng].label}</span>
                    <span className="text-[9px] text-gray-500 font-mono">({count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Saved Profiles for Selected Category */}
          <div className="flex-1 overflow-y-auto py-3 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-gray-400 px-1 mb-1">
              <span>Saved Profiles ({displayedProfiles.length})</span>
              <button
                onClick={() => {
                  setEditingProfileId(null);
                  setFormName(`New ${ENGINE_META[selectedEngineFilter === 'all' ? 'mysql' : selectedEngineFilter].label} Connection`);
                  setFormEngine(selectedEngineFilter === 'all' ? 'mysql' : selectedEngineFilter);
                  setFormPort(DEFAULT_PORTS[selectedEngineFilter === 'all' ? 'mysql' : selectedEngineFilter]);
                  setFormUsername(DEFAULT_USERS[selectedEngineFilter === 'all' ? 'mysql' : selectedEngineFilter]);
                  setFormDatabase(DEFAULT_DBS[selectedEngineFilter === 'all' ? 'mysql' : selectedEngineFilter]);
                  setFormCliBinary('');
                }}
                className="text-blue-400 hover:underline flex items-center gap-1 text-[10px]"
              >
                <Plus className="w-3 h-3" /> New
              </button>
            </div>

            {displayedProfiles.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-500 border border-dashed border-white/10 rounded-xl">
                No saved profiles for this database. Use the form to connect or add one.
              </div>
            ) : (
              displayedProfiles.map(p => {
                return (
                  <div
                    key={p.id}
                    className="p-3 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:border-blue-500/40 transition-all flex flex-col justify-between group"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <span className="text-lg">{ENGINE_META[p.engine].icon}</span>
                        <div>
                          <div className="text-xs font-bold text-white group-hover:text-blue-400 transition-colors">
                            {p.name}
                          </div>
                          <div className="text-[10px] text-gray-400 font-mono">
                            {p.engine === 'sqlite' ? p.database : `${p.username}@${p.host}:${p.port}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => openEditProfile(p, e)}
                          className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
                          title="Edit profile"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteProfile(p.id, e)}
                          className="p-1 rounded text-gray-400 hover:text-rose-400 hover:bg-white/10"
                          title="Delete profile"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => handleConnectProfile(p)}
                      className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md shadow-blue-500/20 transition-all"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Connect</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Side: Connection Parameters Form */}
        <div
          style={{ backgroundColor: currentTheme.bgMain }}
          className="flex-1 p-6 flex flex-col justify-center max-w-2xl mx-auto overflow-y-auto"
        >
          <div
            style={{ backgroundColor: currentTheme.bgSurface, borderColor: currentTheme.border }}
            className="border rounded-2xl p-6 shadow-2xl backdrop-blur-xl"
          >
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.08] mb-5">
              <div>
                <h3 className="text-base font-bold text-white">
                  {editingProfileId ? 'Modify Connection Profile' : 'New Database Connection'}
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Configure connection parameters for {ENGINE_META[formEngine].label}
                </p>
              </div>
              <div className="text-2xl">{ENGINE_META[formEngine].icon}</div>
            </div>

            <div className="grid grid-cols-2 gap-3.5 mb-4">
              <div className="col-span-2">
                <label className="text-[11px] font-medium text-gray-400 block mb-1">Profile Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. Primary MySQL Production"
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-gray-400 block mb-1">Host / Server Address</label>
                <input
                  type="text"
                  value={formHost}
                  onChange={e => setFormHost(e.target.value)}
                  placeholder="127.0.0.1 or db.internal"
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-gray-400 block mb-1">Port</label>
                <input
                  type="number"
                  value={formPort}
                  onChange={e => setFormPort(Number(e.target.value))}
                  disabled={formEngine === 'sqlite'}
                  placeholder={String(DEFAULT_PORTS[formEngine])}
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500 disabled:opacity-40"
                />
              </div>

              <div className="col-span-2">
                <label className="text-[11px] font-medium text-gray-400 block mb-1">
                  {formEngine === 'sqlite' ? 'SQLite File Path' : formEngine === 'redis' ? 'DB Index (0-15)' : 'Database / Schema'}
                </label>
                <input
                  type="text"
                  value={formDatabase}
                  onChange={e => setFormDatabase(e.target.value)}
                  placeholder={DEFAULT_DBS[formEngine]}
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              {formEngine !== 'sqlite' && (
                <div>
                  <label className="text-[11px] font-medium text-gray-400 block mb-1">Username</label>
                  <input
                    type="text"
                    value={formUsername}
                    onChange={e => setFormUsername(e.target.value)}
                    placeholder="e.g. root, postgres, sa"
                    style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              )}

              {formEngine !== 'sqlite' && (
                <div>
                  <label className="text-[11px] font-medium text-gray-400 block mb-1">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={formPassword}
                      onChange={e => setFormPassword(e.target.value)}
                      placeholder="Database password..."
                      style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                      className="w-full border rounded-lg pl-3 pr-8 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-2 text-gray-400 hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )}

              {/* Optional Custom CLI Tool Path / Name */}
              <div className="col-span-2">
                <label className="text-[11px] font-medium text-gray-400 block mb-1">
                  Custom CLI Binary / Path (Optional, defaults to '{ENGINE_META[formEngine].defaultCli}')
                </label>
                <input
                  type="text"
                  value={formCliBinary}
                  onChange={e => setFormCliBinary(e.target.value)}
                  placeholder={`e.g. ${ENGINE_META[formEngine].defaultCli} or /usr/local/bin/${ENGINE_META[formEngine].defaultCli}`}
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            {/* Test Connection Banner */}
            {testResult && (
              <div className={`p-3 rounded-xl mb-4 text-xs border flex items-start gap-2.5 ${
                testResult.success
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}>
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold">{testResult.message}</div>
                  {testResult.version && <div className="text-[10px] font-mono opacity-80 mt-0.5">{testResult.version}</div>}
                </div>
              </div>
            )}

            {/* Actions Bar */}
            <div className="flex items-center justify-between pt-3 border-t border-white/[0.08]">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingConnection}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-300 flex items-center gap-1.5 font-medium transition-colors"
              >
                {testingConnection ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
                <span>{testingConnection ? 'Testing...' : 'Test Connection'}</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => handleSaveProfileForm(false)}
                  className="px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-colors"
                >
                  Save Profile
                </button>
                <button
                  type="button"
                  onClick={() => handleSaveProfileForm(true)}
                  className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/25 flex items-center gap-1.5 transition-all"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Connect Now</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── SCREEN 2: Active Database Studio View ─────────────────────────
  return (
    <div
      style={{ backgroundColor: currentTheme.bgMain, color: currentTheme.text }}
      className="flex h-full font-sans antialiased overflow-hidden select-none relative"
    >
      {/* Global Error Banner */}
      {globalError && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-rose-600/95 text-white px-4 py-2 text-xs flex items-center justify-between shadow-xl backdrop-blur-md">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="font-mono">{globalError}</span>
          </div>
          <button onClick={() => setGlobalError(null)} className="p-1 hover:bg-white/20 rounded">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ─── Left Sidebar: Schemas & Database Tree (Resizable) ────────── */}
      <div
        style={{ width: `${sidebarWidth}px`, backgroundColor: currentTheme.bgSidebar, borderColor: currentTheme.border }}
        className="border-r flex flex-col shrink-0 relative transition-all duration-75"
      >
        {/* Sidebar Header: Connection Switcher */}
        <div className="p-3 border-b border-white/[0.08]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 truncate">
              <span className="text-lg">{activeProfile ? ENGINE_META[activeProfile.engine].icon : '🗄️'}</span>
              <div className="truncate">
                <div className="text-xs font-bold text-white truncate">{activeProfile?.name}</div>
                <div className="text-[10px] text-gray-400 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{activeProfile?.database}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-1">
              <button
                onClick={() => fetchSchemaTree()}
                title="Refresh Schema"
                className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${fetchingSchema ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setActiveProfile(null)}
                title="Disconnect & Switch Server"
                className="p-1 rounded text-gray-400 hover:text-rose-400 hover:bg-white/10"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {availableDatabases.length > 1 && (
            <div className="relative mt-2">
              <select
                value={activeProfile?.database || ''}
                onChange={e => switchDatabaseContext(e.target.value)}
                style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                className="w-full border rounded-md px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500 appearance-none pr-6"
              >
                {availableDatabases.map(db => (
                  <option key={db} value={db}>{db}</option>
                ))}
              </select>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-2 pointer-events-none" />
            </div>
          )}
        </div>

        {/* Search Tables Filter */}
        <div className="p-2 border-b border-white/[0.08]">
          <div className="relative">
            <Search className="w-3 h-3 text-gray-400 absolute left-2 top-2" />
            <input
              type="text"
              placeholder="Search schema..."
              value={searchTableFilter}
              onChange={e => setSearchTableFilter(e.target.value)}
              style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
              className="w-full border rounded-md pl-6 pr-2 py-1 text-xs text-white placeholder-gray-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Schema Tree View */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3 font-mono text-xs">
          {/* Tables Section */}
          <div>
            <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">
              <span className="flex items-center gap-1.5">
                <Table className="w-3 h-3 text-blue-400" />
                <span>Tables ({filteredTables.length})</span>
              </span>
              <button
                onClick={() => {
                  setCreateTableModalError(null);
                  setShowCreateTableModal(true);
                }}
                className="text-blue-400 hover:underline text-[10px]"
                title="Create New Table"
              >
                + Create
              </button>
            </div>

            <div className="space-y-0.5">
              {filteredTables.map(tbl => {
                const isSelected = dataGrid.table === tbl.name || selectedTable === tbl.name;
                const isLoadingCols = loadingTableCols[tbl.name];
                return (
                  <div key={tbl.name} className="flex flex-col">
                    <div
                      onClick={() => handleSelectTable(tbl.name)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({
                          x: e.clientX,
                          y: e.clientY,
                          type: 'sidebar-table',
                          data: tbl
                        });
                      }}
                      className={`w-full text-left px-2 py-1.5 rounded-md flex items-center justify-between cursor-pointer transition-colors group ${
                        isSelected
                          ? 'bg-blue-600/25 text-blue-300 font-semibold border-l-2 border-blue-500'
                          : 'text-gray-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <span className="truncate flex items-center gap-1.5">
                        <button
                          onClick={(e) => toggleTableExpansion(tbl.name, e)}
                          className="text-gray-400 hover:text-white p-0.5"
                        >
                          {tbl.isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </button>
                        <Table className="w-3 h-3 text-gray-400 group-hover:text-blue-400 shrink-0" />
                        <span className="truncate">{tbl.name}</span>
                      </span>

                      <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTable(tbl.name);
                            fetchTableStructure(tbl.name);
                            setMainView('structure');
                          }}
                          title="Inspect Structure"
                          className="p-0.5 hover:text-white"
                        >
                          <Layers className="w-3 h-3 text-purple-400" />
                        </button>
                      </div>
                    </div>

                    {/* Expandable Table Columns in Sidebar Tree */}
                    {tbl.isExpanded && (
                      <div className="pl-6 pr-1 py-1 space-y-0.5 text-[11px] text-gray-400 border-l border-white/5 ml-3">
                        {isLoadingCols ? (
                          <div className="py-1 text-[10px] text-gray-500 flex items-center gap-1">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin text-blue-400" />
                            <span>Loading columns...</span>
                          </div>
                        ) : tbl.columns && tbl.columns.length > 0 ? (
                          tbl.columns.map(col => (
                            <div
                              key={col.name}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                setContextMenu({
                                  x: e.clientX,
                                  y: e.clientY,
                                  type: 'sidebar-column',
                                  data: { table: tbl.name, column: col }
                                });
                              }}
                              className="flex items-center justify-between py-0.5 hover:text-white cursor-pointer"
                            >
                              <span className="flex items-center gap-1 truncate text-gray-300">
                                {col.isPrimaryKey ? (
                                  <Key className="w-2.5 h-2.5 text-amber-400 shrink-0" />
                                ) : col.isForeignKey ? (
                                  <Link className="w-2.5 h-2.5 text-blue-400 shrink-0" />
                                ) : (
                                  <span className="w-2.5 shrink-0" />
                                )}
                                <span className="truncate">{col.name}</span>
                              </span>
                              <span className="text-[9px] text-gray-500 truncate max-w-[80px]">{col.type}</span>
                            </div>
                          ))
                        ) : (
                          <div className="py-0.5 text-[10px] text-gray-500 italic">No columns found</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Views Section */}
          {viewsList.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1 flex items-center gap-1.5">
                <Eye className="w-3 h-3 text-purple-400" />
                <span>Views ({viewsList.length})</span>
              </div>
              <div className="space-y-0.5">
                {viewsList.map(v => (
                  <div
                    key={v.name}
                    onClick={() => handleSelectTable(v.name)}
                    className="px-2 py-1.5 rounded-md text-gray-300 hover:bg-white/5 cursor-pointer flex items-center gap-1.5 truncate"
                  >
                    <Eye className="w-3 h-3 text-purple-400 shrink-0" />
                    <span className="truncate">{v.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Stored Procedures & Functions Section */}
          <div>
            <div className="flex items-center justify-between text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1 mb-1">
              <span className="flex items-center gap-1.5">
                <Code2 className="w-3 h-3 text-emerald-400" />
                <span>Procedures ({routinesList.length})</span>
              </span>
              <button
                onClick={() => {
                  setRoutineModalError(null);
                  setShowRoutineModal('procedure');
                }}
                className="text-emerald-400 hover:underline text-[10px]"
                title="Create Stored Procedure"
              >
                + Create
              </button>
            </div>
            <div className="space-y-0.5">
              {routinesList.map(r => (
                <div
                  key={r.name}
                  onClick={() => {
                    const routineQuery = activeProfile?.engine === 'postgresql'
                      ? `SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname = '${r.name}';`
                      : `SHOW CREATE ${r.type.toUpperCase()} ${r.name};`;
                    setQueryTabs(prev =>
                      prev.map(t => t.id === activeTab.id ? { ...t, query: routineQuery } : t)
                    );
                    setMainView('editor');
                    executeActiveQuery(routineQuery);
                  }}
                  className="px-2 py-1.5 rounded-md text-gray-300 hover:bg-white/5 cursor-pointer flex items-center justify-between group truncate"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Code2 className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="truncate">{r.name}</span>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteRoutine(r.name, r.type as any);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-400 hover:text-rose-400"
                    title="Drop Procedure"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Resizable Splitter Handle for Left Sidebar */}
        <div
          onMouseDown={startSidebarResize}
          className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-20"
          title="Drag to resize sidebar width"
        />
      </div>

      {/* ─── Main Content Canvas ────────────────────────────────────── */}
      <div style={{ backgroundColor: currentTheme.bgMain }} className="flex-1 flex flex-col overflow-hidden">
        {/* Top View Selector & Action Bar */}
        <div
          style={{ backgroundColor: currentTheme.bgHeader, borderColor: currentTheme.border }}
          className="h-10 border-b px-3 flex items-center justify-between shrink-0"
        >
          <div className="flex items-center space-x-1">
            <button
              onClick={() => setMainView('editor')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                mainView === 'editor' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>SQL Editor</span>
            </button>
            <button
              onClick={() => setMainView('data-grid')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                mainView === 'data-grid' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Table className="w-3.5 h-3.5" />
              <span>Data Grid {dataGrid.rows.length > 0 && `(${dataGrid.rows.length})`}</span>
            </button>
            <button
              onClick={() => {
                if (selectedTable) fetchTableStructure(selectedTable);
                setMainView('structure');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                mainView === 'structure' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Structure & Indexes</span>
            </button>
            <button
              onClick={() => setMainView('er-diagram')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                mainView === 'er-diagram' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>ER Diagram</span>
            </button>
            <button
              onClick={() => {
                fetchProcesses();
                setMainView('activity');
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
                mainView === 'activity' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Threads</span>
            </button>
          </div>

          {/* Top Right Controls: Theme Selector & Execute */}
          <div className="flex items-center space-x-2">
            {/* Theme Selector */}
            <div className="flex items-center space-x-1 bg-black/20 rounded-lg p-0.5 border border-white/10">
              <span className="text-[10px] text-gray-400 px-1 font-mono">Theme:</span>
              <select
                value={selectedThemeKey}
                onChange={e => handleThemeChange(e.target.value)}
                style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                className="rounded px-2 py-0.5 text-[11px] text-white font-sans focus:outline-none cursor-pointer"
              >
                <option value="vs-dark">Visual Studio Dark (Default)</option>
                <option value="vs-light">Visual Studio Light</option>
                <option value="monokai">Monokai</option>
                <option value="darcula">Darcula</option>
                <option value="one-dark-pro">One Dark Pro</option>
                <option value="github-dark">GitHub Dark</option>
                <option value="catppuccin-mocha">Catppuccin Mocha</option>
              </select>
            </div>

            {/* Execute Button */}
            <button
              onClick={() => executeActiveQuery()}
              disabled={executing}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              title="Execute Query (Ctrl+Enter). If text is selected, executes selected lines only!"
            >
              {executing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
              <span>Execute</span>
              <kbd className="text-[10px] bg-black/30 px-1 py-0.5 rounded font-mono ml-0.5">Ctrl+↵</kbd>
            </button>
          </div>
        </div>

        {/* ─── TAB 1: Multi-Tab SQL Editor & Split Canvas ─────────────── */}
        {mainView === 'editor' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Multi-Tab Bar */}
            <div
              style={{ backgroundColor: currentTheme.bgSurface, borderColor: currentTheme.border }}
              className="h-8 border-b px-2 flex items-center justify-between shrink-0 select-none"
            >
              <div className="flex items-center space-x-1 overflow-x-auto scrollbar-none flex-1">
                {queryTabs.map(tab => (
                  <div
                    key={tab.id}
                    onClick={() => setActiveTabId(tab.id)}
                    className={`px-3 py-1 rounded-t-lg text-xs font-mono flex items-center space-x-2 cursor-pointer transition-colors ${
                      activeTabId === tab.id
                        ? 'bg-blue-600/20 text-blue-400 font-semibold border-t-2 border-blue-500'
                        : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                    }`}
                  >
                    <Code2 className="w-3 h-3 text-blue-400" />
                    <span>{tab.title}</span>
                    {queryTabs.length > 1 && (
                      <button
                        onClick={(e) => closeQueryTab(tab.id, e)}
                        className="p-0.5 rounded hover:bg-white/20 text-gray-400 hover:text-white"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={addNewQueryTab}
                  className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 ml-1"
                  title="New Query Tab (Ctrl+N)"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Editor Preferences Controls */}
              <div className="flex items-center space-x-1 shrink-0 ml-2">
                <button
                  onClick={() => setIsSplitQueryEditor(prev => !prev)}
                  className={`px-2 py-0.5 rounded text-xs flex items-center gap-1 ${isSplitQueryEditor ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                  title="Toggle Split Dual Editor"
                >
                  <Columns2 className="w-3.5 h-3.5" />
                  <span className="text-[10px] font-mono">Split</span>
                </button>
                <button
                  onClick={() => setMinimapEnabled(m => !m)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${minimapEnabled ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-white/10'}`}
                  title="Toggle Minimap"
                >
                  MAP
                </button>
                <button
                  onClick={() => setWordWrap(w => w === 'on' ? 'off' : 'on')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${wordWrap === 'on' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-white/10'}`}
                  title="Toggle Word Wrap (Alt+Z)"
                >
                  WRAP
                </button>
                <button
                  onClick={() => setFontSize(s => Math.min(30, s + 1))}
                  className="p-1 rounded text-gray-400 hover:text-white"
                  title="Increase font size (Ctrl++)"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setFontSize(s => Math.max(10, s - 1))}
                  className="p-1 rounded text-gray-400 hover:text-white"
                  title="Decrease font size (Ctrl+-)"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Monaco SQL Editor Canvas (Single or Split Dual Pane) */}
            <div className="flex-1 flex overflow-hidden">
              <div className="flex-1 h-full overflow-hidden">
                <Editor
                  height="100%"
                  language={activeProfile?.engine === 'mongodb' ? 'javascript' : activeProfile?.engine === 'redis' ? 'shell' : 'sql'}
                  value={activeTab.query}
                  theme={currentTheme.monacoTheme}
                  beforeMount={handleEditorBeforeMount}
                  onChange={(val) => {
                    setQueryTabs(prev =>
                      prev.map(t => t.id === activeTab.id ? { ...t, query: val || '' } : t)
                    );
                  }}
                  onMount={(editor, monaco) => {
                    monacoEditorRef.current = editor;
                    editor.addAction({
                      id: 'execute-sql-query-action',
                      label: 'Execute SQL Query',
                      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
                      run: () => {
                        executeActiveQueryRef.current();
                      }
                    });
                  }}
                  options={{
                    fontSize,
                    wordWrap,
                    minimap: { enabled: minimapEnabled, side: 'right', maxColumn: 100 },
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    bracketPairColorization: { enabled: true },
                  }}
                />
              </div>

              {/* Functional Secondary Split Pane */}
              {isSplitQueryEditor && (
                <div className="flex-1 h-full border-l border-white/10 flex flex-col overflow-hidden">
                  <div className="h-6 bg-black/30 border-b border-white/10 px-2 flex items-center justify-between text-[10px] text-gray-400">
                    <span>Secondary Query Pane</span>
                    <button
                      onClick={() => executeActiveQuery(secondaryQuery)}
                      disabled={secondaryExecuting}
                      className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold flex items-center gap-1"
                    >
                      <Play className="w-2.5 h-2.5 fill-current" /> Run Pane
                    </button>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <Editor
                      height="100%"
                      language="sql"
                      value={secondaryQuery}
                      theme={currentTheme.monacoTheme}
                      onChange={(val) => setSecondaryQuery(val || '')}
                      options={{
                        fontSize,
                        wordWrap,
                        minimap: { enabled: false },
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        automaticLayout: true,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Resizable Splitter between Editor and Console */}
            <div
              onMouseDown={startSplitterDrag}
              className="h-1.5 bg-black/40 hover:bg-blue-500/50 cursor-row-resize border-y border-white/[0.08] transition-colors relative z-20 flex items-center justify-center"
              title="Drag up or down to adjust console / results window"
            >
              <div className="w-8 h-0.5 bg-gray-500 rounded" />
            </div>

            {/* ─── Resizable & Minimizable Console Output Window ─────── */}
            <div
              style={{
                height: isOutputMinimized ? '28px' : `${outputHeight}px`,
                backgroundColor: currentTheme.bgSurface,
                borderColor: currentTheme.border
              }}
              className="border-t flex flex-col shrink-0 overflow-hidden transition-[height] duration-100"
            >
              <div className="h-7 bg-black/20 px-3 flex items-center justify-between text-xs text-gray-400 border-b border-white/[0.08] shrink-0 select-none">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-[10px] uppercase tracking-wider text-gray-300">
                    Console Output & Results
                  </span>
                  {activeTab.successInfo && (
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
                      {activeTab.successInfo}
                    </span>
                  )}
                  {activeTab.error && (
                    <span className="text-[10px] text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded">
                      Execution Error
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  {activeTab.results.length > 0 && (
                    <button
                      onClick={() => exportCSV(activeTab.results, activeTab.columns, 'query_result')}
                      className="text-[10px] text-blue-400 hover:underline flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" /> CSV
                    </button>
                  )}
                  <span className="text-[10px] text-gray-500 font-mono">
                    {activeTab.results.length} rows returned
                  </span>
                  <button
                    onClick={() => setIsOutputMinimized(m => !m)}
                    className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
                    title={isOutputMinimized ? "Restore Console Window" : "Minimize Console Window"}
                  >
                    {isOutputMinimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
                  </button>
                </div>
              </div>

              {/* Output Content */}
              {!isOutputMinimized && (
                <div className="flex-1 overflow-auto bg-black/10">
                  {activeTab.error ? (
                    <div className="p-3 text-xs font-mono text-rose-300 bg-rose-500/10 whitespace-pre-wrap select-text">
                      <div className="font-bold mb-1 text-rose-400">Database Engine Error:</div>
                      {activeTab.error}
                    </div>
                  ) : activeTab.results.length > 0 ? (
                    <table className="w-full text-left text-xs font-mono border-collapse">
                      <thead className="bg-black/30 text-gray-400 border-b border-white/[0.08] sticky top-0 z-10 shadow-sm">
                        <tr>
                          <th className="py-1.5 px-3 text-gray-500 w-10 text-center font-normal">#</th>
                          {activeTab.columns.map(col => (
                            <th
                              key={col}
                              onClick={() => {
                                setQueryTabs(prev =>
                                  prev.map(t => {
                                    if (t.id !== activeTab.id) return t;
                                    const nextDir = t.sortColumn === col ? (t.sortDirection === 'asc' ? 'desc' : null) : 'asc';
                                    return {
                                      ...t,
                                      sortColumn: nextDir ? col : null,
                                      sortDirection: nextDir,
                                    };
                                  })
                                );
                              }}
                              className="py-1.5 px-3 font-semibold text-gray-300 whitespace-nowrap bg-black/20 cursor-pointer hover:text-blue-300"
                            >
                              <span className="flex items-center gap-1">
                                {col}
                                {activeTab.sortColumn === col && (
                                  <span>{activeTab.sortDirection === 'asc' ? '▲' : '▼'}</span>
                                )}
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.04]">
                        {sortedConsoleRows.map((row, idx) => (
                          <tr key={idx} className="hover:bg-blue-500/[0.08] cursor-pointer">
                            <td className="py-1.5 px-3 text-gray-600 text-center text-[10px]">{idx + 1}</td>
                            {activeTab.columns.map(col => (
                              <td key={col} className="py-1.5 px-3 text-gray-200 truncate max-w-xs text-[11px]">
                                {row[col] === '' ? <span className="text-gray-600 italic">null</span> : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : activeTab.rawOutput ? (
                    <div className="p-3">
                      <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap select-text">
                        {activeTab.rawOutput}
                      </pre>
                    </div>
                  ) : (
                    <div className="flex-1 h-full flex items-center justify-center text-gray-500 text-xs p-8">
                      Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-300 font-mono mx-1">Ctrl+Enter</kbd> to run query. Select lines to execute selection only.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB 2: Table Data Grid with Clean Border & Keyboard Nav ─── */}
        {mainView === 'data-grid' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Data Grid Toolbar with Limit, Reload & Sort Reset */}
            <div
              style={{ backgroundColor: currentTheme.bgHeader, borderColor: currentTheme.border }}
              className="h-10 border-b px-4 flex items-center justify-between text-xs text-gray-300 shrink-0"
            >
              <div className="flex items-center space-x-3">
                <span className="font-bold text-white flex items-center gap-1.5">
                  <Table className="w-4 h-4 text-blue-400" />
                  <span>{dataGrid.table || 'No Table Selected'}</span>
                </span>

                <button
                  onClick={() => dataGrid.table && fetchTableDataGrid(dataGrid.table)}
                  className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 flex items-center gap-1 text-[11px]"
                  title="Reload Table Data"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${dataGrid.loading ? 'animate-spin' : ''}`} />
                  <span>Reload</span>
                </button>

                <span className="text-gray-500">|</span>

                {/* Filter Textbox */}
                <div className="relative">
                  <Search className="w-3 h-3 text-gray-400 absolute left-2 top-2" />
                  <input
                    type="text"
                    placeholder="Filter records..."
                    value={dataGridFilter}
                    onChange={e => setDataGridFilter(e.target.value)}
                    style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                    className="border rounded pl-6 pr-2 py-0.5 text-xs text-white w-40"
                  />
                </div>

                {/* Limit Dropdown */}
                <div className="flex items-center space-x-1.5">
                  <span className="text-[11px] text-gray-400">Limit:</span>
                  <select
                    value={dataGrid.pageSize}
                    onChange={e => {
                      const newLimit = parseInt(e.target.value, 10);
                      setDataGrid(prev => ({ ...prev, pageSize: newLimit }));
                      if (dataGrid.table) fetchTableDataGrid(dataGrid.table, newLimit);
                    }}
                    style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                    className="border rounded px-1.5 py-0.5 text-[11px] text-white"
                  >
                    <option value={25}>25 (Few)</option>
                    <option value={100}>100 (Medium)</option>
                    <option value={500}>500 (Large)</option>
                    <option value={1000}>1,000 (All)</option>
                  </select>
                </div>

                {/* Reset Sort Button when active */}
                {dataGrid.sortColumn && (
                  <button
                    onClick={() => {
                      if (dataGrid.table) fetchTableDataGrid(dataGrid.table);
                    }}
                    className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-mono flex items-center gap-1 border border-amber-500/30"
                    title="Reset sort order"
                  >
                    <span>Sorted by {dataGrid.sortColumn} ({dataGrid.sortDirection})</span>
                    <span className="font-bold hover:text-white">✕ Reset</span>
                  </button>
                )}
              </div>

              {/* Grid Action Buttons */}
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-gray-500 font-mono mr-2">
                  Use ↑/↓ keys to select row • Enter to edit • Del to delete
                </span>

                <button
                  onClick={() => {
                    setRowFormData({});
                    setRowModalError(null);
                    setShowAddRowModal(true);
                  }}
                  disabled={!dataGrid.table}
                  className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Insert Row</span>
                </button>

                <button
                  onClick={() => exportCSV(dataGrid.rows, dataGrid.columns, dataGrid.table || 'export')}
                  disabled={dataGrid.rows.length === 0}
                  className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/15 disabled:opacity-50 text-gray-300 text-xs flex items-center gap-1"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  <span>Export CSV</span>
                </button>
              </div>
            </div>

            {/* Grid Table with Clean Borders */}
            <div className="flex-1 overflow-auto bg-black/10 p-2">
              {dataGrid.loading ? (
                <div className="p-8 text-center text-gray-400 text-xs flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Loading table records...</span>
                </div>
              ) : dataGrid.error ? (
                <div className="p-4 m-4 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-mono">
                  {dataGrid.error}
                </div>
              ) : filteredGridRows.length > 0 ? (
                <div className="border border-white/10 rounded-lg overflow-hidden shadow-sm">
                  <table className="w-full text-left text-xs font-mono border-collapse">
                    <thead style={{ backgroundColor: currentTheme.bgHeader }} className="text-gray-300 sticky top-0 z-10">
                      <tr>
                        <th className="py-2 px-3 text-gray-500 w-10 text-center border-b border-r border-white/10 font-normal">#</th>
                        <th className="py-2 px-3 text-gray-500 w-16 text-center border-b border-r border-white/10 font-normal">Actions</th>
                        {dataGrid.columns.map(col => (
                          <th
                            key={col}
                            onClick={() => handleSortDataGrid(col)}
                            className="py-2 px-3 font-semibold text-gray-300 whitespace-nowrap border-b border-r border-white/10 cursor-pointer hover:text-blue-300 select-none"
                          >
                            <span className="flex items-center gap-1">
                              {col}
                              {dataGrid.sortColumn === col && (
                                <span className="text-blue-400">{dataGrid.sortDirection === 'asc' ? '▲' : '▼'}</span>
                              )}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {filteredGridRows.map((row, idx) => {
                        const isSelected = dataGrid.selectedRowIndex === idx;
                        return (
                          <tr
                            key={idx}
                            onClick={() => setDataGrid(prev => ({ ...prev, selectedRowIndex: idx }))}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setDataGrid(prev => ({ ...prev, selectedRowIndex: idx }));
                              setContextMenu({
                                x: e.clientX,
                                y: e.clientY,
                                type: 'data-grid-row',
                                data: { row, index: idx }
                              });
                            }}
                            style={{
                              backgroundColor: isSelected ? currentTheme.gridSelected : undefined,
                            }}
                            className={`transition-colors cursor-pointer ${
                              isSelected ? 'border-l-4 border-blue-500' : 'hover:bg-white/[0.04]'
                            }`}
                          >
                            <td className="py-1.5 px-3 text-gray-500 text-center text-[10px] border-r border-white/[0.06]">{idx + 1}</td>
                            <td className="py-1.5 px-3 text-center whitespace-nowrap border-r border-white/[0.06]">
                              <div className="flex items-center justify-center space-x-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDataGrid(prev => ({ ...prev, selectedRowIndex: idx }));
                                    setRowFormData(row);
                                    setRowModalError(null);
                                    setShowEditRowModal(true);
                                  }}
                                  className="p-1 hover:text-blue-400 text-gray-400"
                                  title="Edit Record (Enter)"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteRow(idx);
                                  }}
                                  className="p-1 hover:text-rose-400 text-gray-400"
                                  title="Delete Record (Del)"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                            {dataGrid.columns.map(col => (
                              <td key={col} className="py-1.5 px-3 text-gray-200 truncate max-w-xs text-[11px] border-r border-white/[0.06]">
                                {row[col] === '' ? <span className="text-gray-500 italic">null</span> : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="p-8 text-center text-gray-500 text-xs">
                  {dataGrid.table ? 'No records found in this table.' : 'Select a table from the sidebar to view records.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ─── TAB 3: Table Structure & Index Manager ────────────────── */}
        {mainView === 'structure' && (
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <Layers className="w-4 h-4 text-purple-400" />
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                    {selectedTable || 'No table selected'}
                  </h3>
                </div>

                {/* Sub Tabs: Columns vs Indexes */}
                <div className="flex items-center space-x-1 bg-black/20 rounded-lg p-0.5 border border-white/10">
                  <button
                    onClick={() => setStructureSubTab('columns')}
                    className={`px-3 py-1 rounded text-xs font-semibold ${structureSubTab === 'columns' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    Columns ({tableStructureColumns.length})
                  </button>
                  <button
                    onClick={() => setStructureSubTab('indexes')}
                    className={`px-3 py-1 rounded text-xs font-semibold ${structureSubTab === 'indexes' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                  >
                    Indexes & Keys ({indexesList.length})
                  </button>
                </div>

                <button
                  onClick={() => selectedTable && fetchTableStructure(selectedTable)}
                  className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 flex items-center gap-1 text-[11px]"
                  title="Reload Structure"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingStructure ? 'animate-spin' : ''}`} />
                  <span>Reload</span>
                </button>
              </div>

              {structureSubTab === 'columns' ? (
                <button
                  onClick={() => {
                    setColFormName('');
                    setColFormType('VARCHAR(255)');
                    setColFormNullable(true);
                    setColFormPK(false);
                    setColFormDefault('');
                    setColModalError(null);
                    setShowColumnModal('add');
                  }}
                  disabled={!selectedTable}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Column</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    setIndexFormName(`idx_${selectedTable}_`);
                    setIndexFormColumns([]);
                    setIndexFormUnique(false);
                    setIndexModalError(null);
                    setShowIndexModal(true);
                  }}
                  disabled={!selectedTable}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Index</span>
                </button>
              )}
            </div>

            {/* Sub Tab 1: Columns */}
            {structureSubTab === 'columns' && (
              <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-black/10">
                {loadingStructure ? (
                  <div className="p-8 text-center text-gray-400 text-xs">Loading column definitions...</div>
                ) : tableStructureColumns.length > 0 ? (
                  <table className="w-full text-left text-xs font-mono border-collapse">
                    <thead style={{ backgroundColor: currentTheme.bgHeader }} className="text-gray-300 border-b border-white/[0.08]">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">#</th>
                        <th className="py-2.5 px-3 font-semibold">Column Name</th>
                        <th className="py-2.5 px-3 font-semibold">Data Type</th>
                        <th className="py-2.5 px-3 font-semibold">Nullable</th>
                        <th className="py-2.5 px-3 font-semibold">Key Constraint</th>
                        <th className="py-2.5 px-3 font-semibold">Default Value</th>
                        <th className="py-2.5 px-3 font-semibold text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {tableStructureColumns.map((col, idx) => (
                        <tr
                          key={col.name}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu({
                              x: e.clientX,
                              y: e.clientY,
                              type: 'structure-column',
                              data: { column: col, index: idx }
                            });
                          }}
                          className="hover:bg-white/[0.04] cursor-pointer"
                        >
                          <td className="py-2 px-3 text-gray-500 text-[10px]">{idx + 1}</td>
                          <td className="py-2 px-3 font-bold text-white flex items-center gap-1.5">
                            {col.isPrimaryKey ? (
                              <Key className="w-3 h-3 text-amber-400 shrink-0" />
                            ) : col.isForeignKey ? (
                              <Link className="w-3 h-3 text-blue-400 shrink-0" />
                            ) : null}
                            <span>{col.name}</span>
                          </td>
                          <td className="py-2 px-3 text-blue-400">{col.type}</td>
                          <td className="py-2 px-3 text-gray-300">{col.nullable ? 'NULL' : 'NOT NULL'}</td>
                          <td className="py-2 px-3">
                            {col.isPrimaryKey ? (
                              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-bold text-[10px]">PRIMARY KEY</span>
                            ) : col.isForeignKey ? (
                              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono text-[10px]">
                                FK ➔ {col.referencedTable}.{col.referencedColumn}
                              </span>
                            ) : '—'}
                          </td>
                          <td className="py-2 px-3 text-gray-400">{col.defaultValue || '—'}</td>
                          <td className="py-2 px-3 text-center">
                            <div className="flex items-center justify-center space-x-1">
                              <button
                                onClick={() => handleMoveColumn(idx, 'up')}
                                disabled={idx === 0}
                                className="p-1 hover:text-white text-gray-400 disabled:opacity-20"
                                title="Move Column Up"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleMoveColumn(idx, 'down')}
                                disabled={idx === tableStructureColumns.length - 1}
                                className="p-1 hover:text-white text-gray-400 disabled:opacity-20"
                                title="Move Column Down"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => {
                                  setColFormOriginalName(col.name);
                                  setColFormName(col.name);
                                  setColFormType(col.type);
                                  setColFormNullable(col.nullable);
                                  setColFormPK(col.isPrimaryKey);
                                  setColFormDefault(col.defaultValue || '');
                                  setColModalError(null);
                                  setShowColumnModal('edit');
                                }}
                                className="p-1 hover:text-blue-400 text-gray-400"
                                title="Edit Column Definition"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleDropColumn(col.name)}
                                className="p-1 hover:text-rose-400 text-gray-400"
                                title="Drop Column"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-gray-500 text-xs">
                    Select a table from the sidebar to inspect and edit columns.
                  </div>
                )}
              </div>
            )}

            {/* Sub Tab 2: Indexes */}
            {structureSubTab === 'indexes' && (
              <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-black/10">
                {indexesList.length > 0 ? (
                  <table className="w-full text-left text-xs font-mono border-collapse">
                    <thead style={{ backgroundColor: currentTheme.bgHeader }} className="text-gray-300 border-b border-white/[0.08]">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Index Name</th>
                        <th className="py-2.5 px-3 font-semibold">Indexed Column(s)</th>
                        <th className="py-2.5 px-3 font-semibold">Unique Constraint</th>
                        <th className="py-2.5 px-3 font-semibold">Index Type</th>
                        <th className="py-2.5 px-3 font-semibold text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {indexesList.map((idxItem) => (
                        <tr key={idxItem.name} className="hover:bg-white/[0.04]">
                          <td className="py-2 px-3 font-bold text-white flex items-center gap-1.5">
                            <Key className="w-3 h-3 text-emerald-400 shrink-0" />
                            <span>{idxItem.name}</span>
                          </td>
                          <td className="py-2 px-3 text-blue-400">{idxItem.columnName}</td>
                          <td className="py-2 px-3">
                            {idxItem.isUnique ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">UNIQUE</span>
                            ) : (
                              <span className="text-gray-500">INDEX</span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-gray-400">{idxItem.type || 'BTREE'}</td>
                          <td className="py-2 px-3 text-center">
                            <button
                              onClick={() => handleDropIndex(idxItem.name)}
                              className="p-1 hover:text-rose-400 text-gray-400"
                              title="Drop Index"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8 text-center text-gray-500 text-xs">
                    No explicit indexes defined on this table. Use '+ Add Index' to create one.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ─── TAB 4: Real Reverse Engineering ER Diagram ────────────── */}
        {mainView === 'er-diagram' && (
          <div className="flex-1 flex flex-col overflow-hidden bg-black/20 relative">
            {/* Toolbar */}
            <div
              style={{ backgroundColor: currentTheme.bgHeader, borderColor: currentTheme.border }}
              className="h-10 border-b px-4 flex items-center justify-between text-xs text-gray-300 shrink-0 select-none"
            >
              <div className="flex items-center space-x-2">
                <Network className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-white">Reverse Engineer Schema Visualizer</span>
                <span className="text-gray-500">|</span>
                <span className="text-[11px] text-gray-400 font-mono">
                  {tablesList.length} Tables • {foreignKeysList.length} Relationships
                </span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setErZoom(z => Math.max(0.5, z - 0.1))}
                  className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-gray-300"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono w-10 text-center">{Math.round(erZoom * 100)}%</span>
                <button
                  onClick={() => setErZoom(z => Math.min(2, z + 0.1))}
                  className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-gray-300"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Diagram Canvas with Real Entities */}
            <div className="flex-1 overflow-auto p-8 relative">
              <div
                style={{ transform: `scale(${erZoom})`, transformOrigin: 'top left' }}
                className="grid grid-cols-3 gap-6 w-max transition-transform duration-100"
              >
                {tablesList.map(tbl => {
                  const relatedFKs = foreignKeysList.filter(fk => fk.tableName === tbl.name);
                  return (
                    <div
                      key={tbl.name}
                      style={{ backgroundColor: currentTheme.bgSurface, borderColor: currentTheme.border }}
                      className="w-72 rounded-xl border shadow-2xl overflow-hidden font-mono"
                    >
                      {/* Entity Header */}
                      <div className="bg-gradient-to-r from-blue-600/30 to-indigo-600/30 border-b border-white/10 p-2.5 flex items-center justify-between">
                        <span className="font-bold text-xs text-white flex items-center gap-1.5">
                          <Table className="w-3.5 h-3.5 text-blue-400" />
                          <span>{tbl.name}</span>
                        </span>
                        <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded text-gray-400 uppercase">
                          {tbl.type}
                        </span>
                      </div>

                      {/* Real Columns */}
                      <div className="p-2 space-y-1 text-[11px] max-h-56 overflow-y-auto">
                        {(tbl.columns && tbl.columns.length > 0) ? (
                          tbl.columns.map(col => {
                            const isRel = foreignKeysList.find(fk => fk.tableName === tbl.name && fk.columnName === col.name);
                            return (
                              <div
                                key={col.name}
                                onClick={() => isRel && setSelectedErRelation(isRel)}
                                className={`flex items-center justify-between py-0.5 px-1 rounded transition-colors ${
                                  col.isPrimaryKey ? 'text-amber-300 font-semibold' :
                                  col.isForeignKey ? 'text-blue-300 cursor-pointer hover:bg-blue-600/20' : 'text-gray-300'
                                }`}
                              >
                                <span className="flex items-center gap-1 truncate">
                                  {col.isPrimaryKey ? (
                                    <Key className="w-3 h-3 text-amber-400 shrink-0" />
                                  ) : col.isForeignKey ? (
                                    <Link className="w-3 h-3 text-blue-400 shrink-0" />
                                  ) : (
                                    <span className="w-3 shrink-0" />
                                  )}
                                  <span className="truncate">{col.name}</span>
                                </span>
                                <span className="text-[10px] text-gray-500 font-mono truncate max-w-[90px]">{col.type}</span>
                              </div>
                            );
                          })
                        ) : (
                          <div
                            onClick={() => fetchTableStructure(tbl.name)}
                            className="text-[10px] text-blue-400 cursor-pointer hover:underline py-2 text-center"
                          >
                            Click to inspect columns
                          </div>
                        )}
                      </div>

                      {/* Foreign Key Badges */}
                      {relatedFKs.length > 0 && (
                        <div className="bg-black/30 border-t border-white/10 p-2 text-[10px] space-y-1">
                          {relatedFKs.map((fk, i) => (
                            <div
                              key={i}
                              onClick={() => setSelectedErRelation(fk)}
                              className="text-blue-400 hover:underline cursor-pointer truncate flex items-center gap-1"
                            >
                              <Link className="w-2.5 h-2.5 shrink-0" />
                              <span className="truncate">{fk.tableName}.{fk.columnName} ➔ {fk.foreignTableName}.{fk.foreignColumnName}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ─── TAB 5: Active Threads & Server Processes ───────────────── */}
        {mainView === 'activity' && (
          <div className="flex-1 flex flex-col overflow-hidden p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400" />
                <span>Active Database Query Threads</span>
              </h3>
              <button
                onClick={fetchProcesses}
                disabled={loadingProcesses}
                className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white flex items-center gap-1"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingProcesses ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-black/10">
              {processes.length > 0 ? (
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead style={{ backgroundColor: currentTheme.bgHeader }} className="text-gray-300 border-b border-white/[0.08]">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Thread ID</th>
                      <th className="py-2.5 px-3 font-semibold">User</th>
                      <th className="py-2.5 px-3 font-semibold">Host</th>
                      <th className="py-2.5 px-3 font-semibold">DB</th>
                      <th className="py-2.5 px-3 font-semibold">Command / State</th>
                      <th className="py-2.5 px-3 font-semibold">Time</th>
                      <th className="py-2.5 px-3 font-semibold">Query Info</th>
                      <th className="py-2.5 px-3 font-semibold text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {processes.map((p, idx) => {
                      const idVal = p.Id || p.pid || p.session_id || String(idx);
                      const userVal = p.User || p.usename || activeProfile?.username;
                      const hostVal = p.Host || p.client_addr || '127.0.0.1';
                      const dbVal = p.db || p.datname || activeProfile?.database;
                      const cmdVal = p.Command || p.state || p.command || 'Query';
                      const timeVal = p.Time || p.duration || p.total_elapsed_time || '0s';
                      const infoVal = p.Info || p.query || p.text || 'SELECT ...';

                      return (
                        <tr key={idx} className="hover:bg-white/[0.04]">
                          <td className="py-2 px-3 font-bold text-white">{idVal}</td>
                          <td className="py-2 px-3 text-gray-300">{userVal}</td>
                          <td className="py-2 px-3 text-gray-400">{hostVal}</td>
                          <td className="py-2 px-3 text-blue-400">{dbVal}</td>
                          <td className="py-2 px-3">
                            <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 text-[10px]">
                              {cmdVal}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-amber-300">{timeVal}</td>
                          <td className="py-2 px-3 text-gray-300 truncate max-w-md">{infoVal}</td>
                          <td className="py-2 px-3 text-center">
                            <button
                              onClick={() => handleKillProcess(idVal)}
                              className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 text-[10px] font-bold"
                            >
                              Kill
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-gray-500 text-xs">
                  {loadingProcesses ? 'Scanning active query threads...' : 'No long-running query threads detected.'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── CONTEXT MENU ────────────────────────────────────────────── */}
      {contextMenu && (
        <div
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
            backgroundColor: currentTheme.bgSurface,
            borderColor: currentTheme.border
          }}
          className="fixed z-50 min-w-48 border rounded-xl shadow-2xl p-1 text-xs select-none backdrop-blur-md"
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === 'data-grid-row' && (
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  setRowFormData(contextMenu.data.row);
                  setRowModalError(null);
                  setShowEditRowModal(true);
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-blue-600 hover:text-white flex items-center gap-2"
              >
                <Edit3 className="w-3.5 h-3.5" /> Edit Record
              </button>
              <button
                onClick={() => {
                  setRowFormData({ ...contextMenu.data.row, id: undefined });
                  setShowAddRowModal(true);
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-blue-600 hover:text-white flex items-center gap-2"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicate Record
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(contextMenu.data.row, null, 2));
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-white/10 flex items-center gap-2"
              >
                <FileCode className="w-3.5 h-3.5" /> Copy Row as JSON
              </button>
              <div className="h-px bg-white/10 my-1" />
              <button
                onClick={() => {
                  handleDeleteRow(contextMenu.data.index);
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded text-rose-400 hover:bg-rose-500 hover:text-white flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete Record
              </button>
            </div>
          )}

          {contextMenu.type === 'structure-column' && (
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  const col = contextMenu.data.column;
                  setColFormOriginalName(col.name);
                  setColFormName(col.name);
                  setColFormType(col.type);
                  setColFormNullable(col.nullable);
                  setColFormPK(col.isPrimaryKey);
                  setColFormDefault(col.defaultValue || '');
                  setColModalError(null);
                  setShowColumnModal('edit');
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-blue-600 hover:text-white flex items-center gap-2"
              >
                <Edit3 className="w-3.5 h-3.5" /> Edit Column Definition
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.data.column.name);
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-white/10 flex items-center gap-2"
              >
                <Copy className="w-3.5 h-3.5" /> Copy Column Name
              </button>
              <div className="h-px bg-white/10 my-1" />
              <button
                onClick={() => {
                  handleDropColumn(contextMenu.data.column.name);
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded text-rose-400 hover:bg-rose-500 hover:text-white flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" /> Drop Column
              </button>
            </div>
          )}

          {contextMenu.type === 'sidebar-table' && (
            <div className="space-y-0.5">
              <button
                onClick={() => {
                  handleSelectTable(contextMenu.data.name);
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-blue-600 hover:text-white flex items-center gap-2"
              >
                <Table className="w-3.5 h-3.5" /> View Data Grid
              </button>
              <button
                onClick={() => {
                  setSelectedTable(contextMenu.data.name);
                  fetchTableStructure(contextMenu.data.name);
                  setMainView('structure');
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-blue-600 hover:text-white flex items-center gap-2"
              >
                <Layers className="w-3.5 h-3.5" /> View Structure
              </button>
              <button
                onClick={() => {
                  const q = `SELECT * FROM ${contextMenu.data.name} LIMIT 100;`;
                  setQueryTabs(prev =>
                    prev.map(t => t.id === activeTab.id ? { ...t, query: q } : t)
                  );
                  setMainView('editor');
                  executeActiveQuery(q);
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded hover:bg-white/10 flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5" /> Generate SELECT
              </button>
              <div className="h-px bg-white/10 my-1" />
              <button
                onClick={async () => {
                  if (confirm(`Truncate table '${contextMenu.data.name}' (permanently delete all rows)?`)) {
                    const truncSql = `TRUNCATE TABLE ${contextMenu.data.name};`;
                    if (isTauri()) {
                      try {
                        await dbExecuteQuery(activeProfile!.id, truncSql);
                      } catch (e: any) {
                        setGlobalError(String(e?.message || e));
                      }
                    } else {
                      const cmd = buildCommand(activeProfile!, truncSql, 'unaligned');
                      await sshExec(activeConnId, cmd);
                    }
                    fetchTableDataGrid(contextMenu.data.name);
                  }
                  setContextMenu(null);
                }}
                className="w-full text-left px-2.5 py-1.5 rounded text-amber-400 hover:bg-amber-500 hover:text-white flex items-center gap-2"
              >
                <Trash2 className="w-3.5 h-3.5" /> Truncate Table
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── MODAL: Add / Edit Row Form (Errors Shown Inside Modal) ──── */}
      {(showAddRowModal || showEditRowModal) && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            style={{ backgroundColor: currentTheme.bgSurface, borderColor: currentTheme.border }}
            className="border rounded-2xl p-5 max-w-lg w-full shadow-2xl flex flex-col max-h-[85vh]"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Table className="w-4 h-4 text-blue-400" />
                <span>{showAddRowModal ? 'Insert New Record' : 'Edit Record'} in {dataGrid.table}</span>
              </h3>
              <button
                onClick={() => {
                  setShowAddRowModal(false);
                  setShowEditRowModal(false);
                }}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {rowModalError && (
              <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs mb-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="font-mono break-all">{rowModalError}</span>
              </div>
            )}

            <div className="flex-1 overflow-y-auto space-y-3 pr-1 font-mono text-xs">
              {(dataGrid.columns.length > 0 ? dataGrid.columns : tableStructureColumns.map(c => c.name)).map(col => (
                <div key={col}>
                  <label className="text-gray-400 block mb-1 font-bold">{col}</label>
                  <input
                    type="text"
                    value={rowFormData[col] !== undefined ? String(rowFormData[col]) : ''}
                    onChange={e => setRowFormData({ ...rowFormData, [col]: e.target.value })}
                    placeholder="NULL or Value"
                    style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                    className="w-full border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end space-x-2 pt-4 border-t border-white/10 mt-4">
              <button
                onClick={() => {
                  setShowAddRowModal(false);
                  setShowEditRowModal(false);
                }}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRow}
                disabled={isMutatingRow}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md"
              >
                {isMutatingRow ? 'Saving...' : 'Save Record'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Add / Edit Column Designer (Supports Any Custom Data Type) ─ */}
      {showColumnModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            style={{ backgroundColor: currentTheme.bgSurface, borderColor: currentTheme.border }}
            className="border rounded-2xl p-5 max-w-md w-full shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-purple-400" />
                <span>{showColumnModal === 'add' ? 'Add Column' : 'Edit Column'} on {selectedTable}</span>
              </h3>
              <button onClick={() => setShowColumnModal(null)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {colModalError && (
              <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs mb-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="font-mono break-all">{colModalError}</span>
              </div>
            )}

            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="text-gray-400 block mb-1">Column Name</label>
                <input
                  type="text"
                  value={colFormName}
                  onChange={e => setColFormName(e.target.value)}
                  placeholder="e.g. phone_number, is_active"
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-gray-400 block mb-1">
                  Data Type (Pick or type ANY custom type e.g. VARCHAR(255), DECIMAL(10,2))
                </label>
                <input
                  type="text"
                  list="common-sql-types"
                  value={colFormType}
                  onChange={e => setColFormType(e.target.value)}
                  placeholder="e.g. VARCHAR(255), INT, DECIMAL(10,2), UUID"
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                />
                <datalist id="common-sql-types">
                  <option value="INT" />
                  <option value="BIGINT" />
                  <option value="TINYINT" />
                  <option value="VARCHAR(50)" />
                  <option value="VARCHAR(255)" />
                  <option value="VARCHAR(500)" />
                  <option value="TEXT" />
                  <option value="MEDIUMTEXT" />
                  <option value="LONGTEXT" />
                  <option value="BOOLEAN" />
                  <option value="TIMESTAMP" />
                  <option value="DATETIME" />
                  <option value="DATE" />
                  <option value="DECIMAL(10,2)" />
                  <option value="DECIMAL(18,4)" />
                  <option value="FLOAT" />
                  <option value="DOUBLE" />
                  <option value="JSON" />
                  <option value="UUID" />
                </datalist>
              </div>

              <div>
                <label className="text-gray-400 block mb-1">Default Value (optional)</label>
                <input
                  type="text"
                  value={colFormDefault}
                  onChange={e => setColFormDefault(e.target.value)}
                  placeholder="e.g. active, 0, CURRENT_TIMESTAMP"
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none"
                />
              </div>

              <div className="flex items-center space-x-4 pt-1">
                <label className="flex items-center space-x-1.5 cursor-pointer text-gray-300">
                  <input
                    type="checkbox"
                    checked={colFormNullable}
                    onChange={e => setColFormNullable(e.target.checked)}
                  />
                  <span>Nullable</span>
                </label>
                {showColumnModal === 'add' && (
                  <label className="flex items-center space-x-1.5 cursor-pointer text-gray-300">
                    <input
                      type="checkbox"
                      checked={colFormPK}
                      onChange={e => setColFormPK(e.target.checked)}
                    />
                    <span>Primary Key</span>
                  </label>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-4 border-t border-white/10 mt-4">
              <button
                onClick={() => setShowColumnModal(null)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveColumnDefinition}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md"
              >
                {showColumnModal === 'add' ? 'Add Column' : 'Update Column'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Visual Create Table Builder ──────────────────────── */}
      {showCreateTableModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            style={{ backgroundColor: currentTheme.bgSurface, borderColor: currentTheme.border }}
            className="border rounded-2xl p-5 max-w-2xl w-full shadow-2xl flex flex-col max-h-[85vh]"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Table className="w-4 h-4 text-blue-400" />
                <span>Create New Table in {activeProfile?.database}</span>
              </h3>
              <button onClick={() => setShowCreateTableModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {createTableModalError && (
              <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs mb-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="font-mono break-all">{createTableModalError}</span>
              </div>
            )}

            <div className="mb-4">
              <label className="text-gray-400 text-xs block mb-1 font-bold">Table Name</label>
              <input
                type="text"
                value={newTableName}
                onChange={e => setNewTableName(e.target.value)}
                placeholder="e.g. products, orders"
                style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                className="w-full border rounded px-2.5 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1 font-mono text-xs">
              <div className="flex items-center justify-between text-gray-400 text-[11px] mb-1 font-bold">
                <span>Columns Schema Definition</span>
                <button
                  type="button"
                  onClick={() => setNewTableCols(prev => [...prev, { name: 'col_' + (prev.length + 1), type: 'VARCHAR(255)', nullable: true, isPK: false, autoInc: false, defaultValue: '' }])}
                  className="text-blue-400 hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add Column
                </button>
              </div>

              {newTableCols.map((c, i) => (
                <div key={i} className="flex items-center space-x-2 bg-black/20 p-2 rounded border border-white/5">
                  <input
                    type="text"
                    value={c.name}
                    onChange={e => {
                      const updated = [...newTableCols];
                      updated[i].name = e.target.value;
                      setNewTableCols(updated);
                    }}
                    placeholder="column_name"
                    style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                    className="flex-1 border rounded px-2 py-1 text-xs text-white"
                  />
                  <input
                    type="text"
                    value={c.type}
                    onChange={e => {
                      const updated = [...newTableCols];
                      updated[i].type = e.target.value;
                      setNewTableCols(updated);
                    }}
                    placeholder="Type"
                    style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                    className="w-32 border rounded px-2 py-1 text-xs text-white"
                  />
                  <label className="flex items-center space-x-1 text-[11px] text-gray-300">
                    <input
                      type="checkbox"
                      checked={c.isPK}
                      onChange={e => {
                        const updated = [...newTableCols];
                        updated[i].isPK = e.target.checked;
                        if (e.target.checked) updated[i].nullable = false;
                        setNewTableCols(updated);
                      }}
                    />
                    <span>PK</span>
                  </label>
                  <label className="flex items-center space-x-1 text-[11px] text-gray-300">
                    <input
                      type="checkbox"
                      checked={c.autoInc}
                      onChange={e => {
                        const updated = [...newTableCols];
                        updated[i].autoInc = e.target.checked;
                        setNewTableCols(updated);
                      }}
                    />
                    <span>Auto</span>
                  </label>
                  <label className="flex items-center space-x-1 text-[11px] text-gray-300">
                    <input
                      type="checkbox"
                      checked={c.nullable}
                      onChange={e => {
                        const updated = [...newTableCols];
                        updated[i].nullable = e.target.checked;
                        setNewTableCols(updated);
                      }}
                    />
                    <span>Null</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setNewTableCols(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-gray-500 hover:text-rose-400 p-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-end space-x-2 pt-4 border-t border-white/10 mt-4">
              <button
                onClick={() => setShowCreateTableModal(false)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTable}
                disabled={!newTableName.trim()}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md"
              >
                Create Table
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Stored Procedure & Function Builder ──────────────── */}
      {showRoutineModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            style={{ backgroundColor: currentTheme.bgSurface, borderColor: currentTheme.border }}
            className="border rounded-2xl p-5 max-w-xl w-full shadow-2xl flex flex-col max-h-[85vh]"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Code2 className="w-4 h-4 text-emerald-400" />
                <span>Create New {showRoutineModal === 'procedure' ? 'Stored Procedure' : 'Function'}</span>
              </h3>
              <button onClick={() => setShowRoutineModal(null)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {routineModalError && (
              <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs mb-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="font-mono break-all">{routineModalError}</span>
              </div>
            )}

            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="text-gray-400 block mb-1">Routine Name</label>
                <input
                  type="text"
                  value={routineFormName}
                  onChange={e => setRoutineFormName(e.target.value)}
                  placeholder="e.g. sp_get_user_orders"
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded px-2.5 py-1.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-gray-400 block mb-1">Parameters</label>
                <input
                  type="text"
                  value={routineFormParams}
                  onChange={e => setRoutineFormParams(e.target.value)}
                  placeholder="e.g. IN user_id INT, OUT order_count INT"
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded px-2.5 py-1.5 text-xs text-white"
                />
              </div>

              {showRoutineModal === 'function' && (
                <div>
                  <label className="text-gray-400 block mb-1">Return Type</label>
                  <input
                    type="text"
                    value={routineFormReturnType}
                    onChange={e => setRoutineFormReturnType(e.target.value)}
                    placeholder="e.g. INT, VARCHAR(255)"
                    style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                    className="w-full border rounded px-2.5 py-1.5 text-xs text-white"
                  />
                </div>
              )}

              <div>
                <label className="text-gray-400 block mb-1">SQL Body</label>
                <textarea
                  value={routineFormBody}
                  onChange={e => setRoutineFormBody(e.target.value)}
                  rows={6}
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded p-2 text-xs text-white font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-4 border-t border-white/10 mt-4">
              <button
                onClick={() => setShowRoutineModal(null)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveRoutine}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md"
              >
                Create Routine
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MODAL: Add Index ────────────────────────────────────────── */}
      {showIndexModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            style={{ backgroundColor: currentTheme.bgSurface, borderColor: currentTheme.border }}
            className="border rounded-2xl p-5 max-w-md w-full shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-400" />
                <span>Add Index on {selectedTable}</span>
              </h3>
              <button onClick={() => setShowIndexModal(false)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {indexModalError && (
              <div className="p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs mb-3 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="font-mono break-all">{indexModalError}</span>
              </div>
            )}

            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="text-gray-400 block mb-1">Index Name</label>
                <input
                  type="text"
                  value={indexFormName}
                  onChange={e => setIndexFormName(e.target.value)}
                  placeholder="e.g. idx_email"
                  style={{ backgroundColor: currentTheme.bgInput, borderColor: currentTheme.border }}
                  className="w-full border rounded px-2.5 py-1.5 text-xs text-white"
                />
              </div>

              <div>
                <label className="text-gray-400 block mb-1">Select Columns to Index</label>
                <div className="max-h-36 overflow-y-auto border border-white/10 rounded p-2 space-y-1">
                  {tableStructureColumns.map(col => (
                    <label key={col.name} className="flex items-center space-x-2 text-gray-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={indexFormColumns.includes(col.name)}
                        onChange={e => {
                          if (e.target.checked) {
                            setIndexFormColumns([...indexFormColumns, col.name]);
                          } else {
                            setIndexFormColumns(indexFormColumns.filter(c => c !== col.name));
                          }
                        }}
                      />
                      <span>{col.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="flex items-center space-x-2 text-gray-300 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={indexFormUnique}
                  onChange={e => setIndexFormUnique(e.target.checked)}
                />
                <span>Unique Index</span>
              </label>
            </div>

            <div className="flex justify-end space-x-2 pt-4 border-t border-white/10 mt-4">
              <button
                onClick={() => setShowIndexModal(false)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveIndex}
                disabled={!indexFormName.trim() || indexFormColumns.length === 0}
                className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md"
              >
                Create Index
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
