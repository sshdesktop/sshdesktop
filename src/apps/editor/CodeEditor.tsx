import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import {
  FileCode,
  Check,
  RefreshCw,
  X,
  Plus,
  AlertCircle,
  Upload,
  ChevronRight,
  ChevronDown,
  Folder,
  File,
  Terminal as TerminalIcon,
  Settings,
  Code2,
  GitBranch,
  Trash2,
  Edit3,
  Copy,
  Scissors,
  Clipboard,
  AlertTriangle,
  FolderPlus,
  FilePlus,
  ArrowRight,
  GitCommit,
  GitPullRequest,
  RotateCcw,
  CheckSquare,
  Command,
  FileSearch,
  TerminalSquare,
  Columns2,
  Download,
  Eye,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Save,
  ShieldAlert
} from 'lucide-react';
import {
  sftpReadTextFile,
  sftpWriteTextFile,
  sftpListDir,
  sftpMkdir,
  sftpDelete,
  sftpRename,
  sshExec,
  terminalCreate,
  terminalWrite,
  terminalResize,
  terminalClose
} from '../../lib/tauri-bridge';
import { listen } from '@tauri-apps/api/event';
import { useConnectionStore, useEditorStore, useSettingsStore, useWindowStore } from '../../lib/store';
import { LanguagePickerModal } from './LanguagePickerModal';
import { detectLanguage, getLanguageDisplayName } from './languages';

// ─── Types & Interfaces ─────────────────────────────────────────────
interface FileTab {
  id: string;
  name: string;
  remotePath: string;
  language: string;
  content: string;
  isModified: boolean;
  isMedia?: boolean;
  mediaType?: 'image' | 'video' | 'audio' | 'pdf';
  mediaUrl?: string;
  fileSize?: number;
}

interface TreeItem {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  isOpen?: boolean;
  children?: TreeItem[];
  loading?: boolean;
}

interface TreeContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  item: TreeItem | null;
}

interface TabContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  tabId: string;
}

interface TerminalTab {
  id: string;
  title: string;
  folder: string;
}

interface TabInstance {
  term: XTerm;
  fitAddon: FitAddon;
  disposed: boolean;
}

interface GitFileStatus {
  path: string;
  staged: boolean;
  status: string; // 'M' | 'A' | 'D' | '?'
}

interface GitDiffState {
  visible: boolean;
  filePath: string;
  diff: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|ico|bmp)$/i.test(filename);
}

function isVideoFile(filename: string): boolean {
  return /\.(mp4|webm|ogg|mov|mkv)$/i.test(filename);
}

function isAudioFile(filename: string): boolean {
  return /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(filename);
}

function isPdfFile(filename: string): boolean {
  return /\.pdf$/i.test(filename);
}

function isMediaFile(filename: string): boolean {
  return isImageFile(filename) || isVideoFile(filename) || isAudioFile(filename) || isPdfFile(filename);
}

function getMediaMime(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'ico') return 'image/x-icon';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (ext === 'ogg') return 'video/ogg';
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'flac') return 'audio/flac';
  if (ext === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

function isPermissionDenied(err: any): boolean {
  const msg = String(err?.message || err);
  return /permission denied|eacces|operation not permitted|not in sudoers|is not allowed to execute|password is required|authentication failure|sudoers|terminal is required|polkit|access denied/i.test(msg);
}

function parsePermissionError(err: any): string {
  const msg = String(err?.message || err);
  if (isPermissionDenied(msg)) {
    return 'Permission Denied: Administrator (sudo) privileges required on the server to perform this operation.';
  }
  return msg;
}

// ─── Main CodeEditor Component ───────────────────────────────────────
export default function CodeEditor() {
  const theme = useSettingsStore(s => s.theme);
  const isLight = theme === 'light' || (theme === 'auto' && typeof window !== 'undefined' && !window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Active Connection Info
  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const connections = useConnectionStore(s => s.connections);
  const activeConn = connections.find(c => c.id === activeConnId);
  const { pendingFilePath, clearPendingFile } = useEditorStore();

  // Compute default user home directory
  const defaultUserHome = useMemo(() => {
    if (!activeConn?.username || activeConn.username === 'root') {
      return '/root';
    }
    return `/home/${activeConn.username}`;
  }, [activeConn]);

  // Files and Editor State
  const [files, setFiles] = useState<FileTab[]>([]);
  const [activeFileId, setActiveFileId] = useState<string>('');
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [permissionAlert, setPermissionAlert] = useState<{ title: string; message: string; path?: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Editor Theme
  const [editorTheme, setEditorTheme] = useState<string>(() => {
    return localStorage.getItem('sshdesktop_editor_theme') || localStorage.getItem('clouddesk_editor_theme') || (isLight ? 'vs' : 'monokai');
  });

  // Editor ref for Monaco instance & latest callback refs to prevent stale closures
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const handleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const handleSaveAllRef = useRef<() => Promise<void>>(() => Promise.resolve());

  // VS Code Language Mode Selector State
  const [isLanguagePickerOpen, setIsLanguagePickerOpen] = useState<boolean>(false);
  const chordRef = useRef<{ key: string; time: number } | null>(null);

  // VS Code Activity Bar: 'explorer' | 'git' | 'settings'
  const [activeSidebarTab, setActiveSidebarTab] = useState<'explorer' | 'git' | 'settings'>('explorer');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('sshdesktop_editor_sidebar_width') || localStorage.getItem('clouddesk_editor_sidebar_width');
    return saved ? Math.max(180, Math.min(500, parseInt(saved, 10))) : 260;
  });
  const isResizingSidebar = useRef(false);

  // Workspace Root & Tree Items
  const [projectRoot, setProjectRoot] = useState<string>(defaultUserHome);
  const [workspaceInput, setWorkspaceInput] = useState<string>(defaultUserHome);
  const [treeItems, setTreeItems] = useState<TreeItem[]>([]);
  const [loadingTree, setLoadingTree] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string>(defaultUserHome);
  const [selectedTreePath, setSelectedTreePath] = useState<string>('');
  const [selectedTreePaths, setSelectedTreePaths] = useState<Set<string>>(new Set());
  const treeContainerRef = useRef<HTMLDivElement>(null);

  // Clipboard for copy / move
  const [clipboardItems, setClipboardItems] = useState<{ paths: string[]; mode: 'copy' | 'cut' } | null>(null);

  // Sync refs for global keyboard shortcut listeners
  const selectedTreePathsRef = useRef(selectedTreePaths);
  selectedTreePathsRef.current = selectedTreePaths;
  const selectedTreePathRef = useRef(selectedTreePath);
  selectedTreePathRef.current = selectedTreePath;
  const clipboardItemsRef = useRef(clipboardItems);
  clipboardItemsRef.current = clipboardItems;
  const selectedFolderRef = useRef(selectedFolder);
  selectedFolderRef.current = selectedFolder;
  const projectRootRef = useRef(projectRoot);
  projectRootRef.current = projectRoot;
  const activeSidebarTabRef = useRef(activeSidebarTab);
  activeSidebarTabRef.current = activeSidebarTab;
  const sidebarOpenRef = useRef(sidebarOpen);
  sidebarOpenRef.current = sidebarOpen;

  // Right-click Context Menus
  const [treeContextMenu, setTreeContextMenu] = useState<TreeContextMenuState>({ visible: false, x: 0, y: 0, item: null });
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState>({ visible: false, x: 0, y: 0, tabId: '' });
  const [termContextMenu, setTermContextMenu] = useState<{ x: number; y: number; tabId: string; hasSelection: boolean } | null>(null);
  const [copiedNotice, setCopiedNotice] = useState<boolean>(false);
  const [editorToast, setEditorToast] = useState<string | null>(null);

  const showEditorToast = useCallback((msg: string) => {
    setEditorToast(msg);
    setTimeout(() => {
      setEditorToast(curr => (curr === msg ? null : curr));
    }, 2500);
  }, []);

  // Creation Modals with In-Modal Error Display
  const [showCreateModal, setShowCreateModal] = useState<'file' | 'folder' | null>(null);
  const [createTargetFolder, setCreateTargetFolder] = useState<string>('');
  const [newItemName, setNewItemName] = useState<string>('');
  const [createModalError, setCreateModalError] = useState<string | null>(null);

  // Rename & Delete Modals with In-Modal Error Display
  const [showRenameModal, setShowRenameModal] = useState<TreeItem | null>(null);
  const [renameNewName, setRenameNewName] = useState<string>('');
  const [renameModalError, setRenameModalError] = useState<string | null>(null);

  const [showDeleteModal, setShowDeleteModal] = useState<{ items: string[] } | null>(null);
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);

  // Tab Close / Unsaved Confirmation
  const [closeConfirmTab, setCloseConfirmTab] = useState<FileTab | null>(null);
  const [showAppCloseAlert, setShowAppCloseAlert] = useState<boolean>(false);

  // Quick Open File Modal (Ctrl+P)
  const [showQuickOpen, setShowQuickOpen] = useState<boolean>(false);
  const [quickOpenFilter, setQuickOpenFilter] = useState<string>('');

  // VS Code Command Palette Modal (Ctrl+Shift+P / F1)
  const [showCommandPalette, setShowCommandPalette] = useState<boolean>(false);
  const [paletteFilter, setPaletteFilter] = useState<string>('');

  // Editor Settings
  const [fontSize, setFontSize] = useState<number>(() => {
    const saved = localStorage.getItem('sshdesktop_editor_fontsize') || localStorage.getItem('clouddesk_editor_fontsize');
    return saved ? parseInt(saved, 10) : 13;
  });
  const [tabSize, setTabSize] = useState<number>(2);
  const [wordWrap, setWordWrap] = useState<'on' | 'off'>('on');
  const [minimapEnabled, setMinimapEnabled] = useState<boolean>(true);
  const [lineNumbers, setLineNumbers] = useState<'on' | 'off'>('on');

  // Cursor Status
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  // ─── Split File Editor ──────────────────────────────────────────
  const [isSplitEditor, setIsSplitEditor] = useState<boolean>(false);
  const [splitActiveFileId, setSplitActiveFileId] = useState<string>('');

  // ─── Multiple Integrated Terminals (Pure PTY Bash, No CMD Runner) ─
  const [showTerminal, setShowTerminal] = useState(false);
  const [isSplitTerminal, setIsSplitTerminal] = useState(false);
  const [terminals, setTerminals] = useState<TerminalTab[]>([
    { id: 'editor-term-1', title: '1: bash', folder: defaultUserHome }
  ]);
  const [activeTermId, setActiveTermId] = useState<string>('editor-term-1');
  const [splitTermId, setSplitTermId] = useState<string>('');
  const tabInstances = useRef<Map<string, TabInstance>>(new Map());
  const terminalContainers = useRef<Map<string, HTMLDivElement>>(new Map());

  // ─── Git Source Control State ──────────────────────────────────
  const [isGitRepo, setIsGitRepo] = useState<boolean>(true);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [branchesList, setBranchesList] = useState<string[]>(['main']);
  const [showBranchMenu, setShowBranchMenu] = useState(false);
  const [newBranchInput, setNewBranchInput] = useState('');
  const [gitStatusFiles, setGitStatusFiles] = useState<GitFileStatus[]>([]);
  const [gitCommitMsg, setGitCommitMsg] = useState('');
  const [gitRunning, setGitRunning] = useState(false);
  const [gitLog, setGitLog] = useState<string[]>([]);
  const [gitSection, setGitSection] = useState<'status' | 'history'>('status');
  const [gitDiffModal, setGitDiffModal] = useState<GitDiffState>({ visible: false, filePath: '', diff: '' });

  // Image zoom preview state
  const [mediaZoom, setMediaZoom] = useState<number>(1);

  // Recent Files
  const [recentFiles, setRecentFiles] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('sshdesktop_recent_files') || localStorage.getItem('clouddesk_recent_files') || '[]');
    } catch {
      return [];
    }
  });

  const addRecentFile = useCallback((path: string) => {
    setRecentFiles(prev => {
      const filtered = prev.filter(p => p !== path);
      const updated = [path, ...filtered].slice(0, 20);
      try {
        localStorage.setItem('sshdesktop_recent_files', JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  // Guarantee activeFileId is set whenever files exist
  useEffect(() => {
    if ((!activeFileId || !files.some(f => f.id === activeFileId)) && files.length > 0) {
      setActiveFileId(files[0].id);
    }
  }, [files, activeFileId]);

  const activeFile = useMemo(() => {
    return files.find(f => f.id === activeFileId) || (files.length > 0 ? files[0] : null);
  }, [files, activeFileId]);

  const splitActiveFile = useMemo(() => {
    return files.find(f => f.id === splitActiveFileId) || (files.length > 1 ? files[1] : activeFile);
  }, [files, splitActiveFileId, activeFile]);

  // Compute active working directory
  const currentWorkingDir = useMemo(() => {
    if (activeFile?.remotePath) {
      const lastSlash = activeFile.remotePath.lastIndexOf('/');
      if (lastSlash > 0) return activeFile.remotePath.substring(0, lastSlash);
    }
    return selectedFolder || projectRoot || defaultUserHome;
  }, [activeFile, selectedFolder, projectRoot, defaultUserHome]);

  // Handle changing language mode for the active document
  const handleSelectLanguage = useCallback((newLangId: string) => {
    if (!activeFile) return;
    setFiles(prev =>
      prev.map(f => (f.id === activeFile.id ? { ...f, language: newLangId } : f))
    );
    // Dynamically update active Monaco model language
    if (editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        monacoRef.current.editor.setModelLanguage(model, newLangId);
      }
    }
  }, [activeFile]);

  // ─── Fetch real remote home directory on mount ──────────────────
  useEffect(() => {
    let isCancelled = false;
    const fetchRemoteHome = async () => {
      try {
        const res = await sshExec(activeConnId, 'echo "$HOME"');
        if (!isCancelled && res.exit_code === 0 && res.stdout.trim().startsWith('/')) {
          const home = res.stdout.trim();
          setProjectRoot(home);
          setWorkspaceInput(home);
          setSelectedFolder(home);
        }
      } catch {}
    };
    fetchRemoteHome();
    return () => { isCancelled = true; };
  }, [activeConnId]);

  // ─── Register Window Close Interceptor for Unsaved Files ─────────
  const registerCloseInterceptor = useWindowStore(s => s.registerCloseInterceptor);
  const unregisterCloseInterceptor = useWindowStore(s => s.unregisterCloseInterceptor);
  const windows = useWindowStore(s => s.windows);
  const closeWindow = useWindowStore(s => s.closeWindow);

  useEffect(() => {
    const editorWin = windows.find(w => w.appId === 'editor');
    if (!editorWin) return;

    registerCloseInterceptor(editorWin.id, () => {
      const modifiedFiles = files.filter(f => f.isModified);
      if (modifiedFiles.length > 0) {
        setShowAppCloseAlert(true);
        return false; // prevent closing immediately
      }
      return true; // safe to close
    });

    return () => {
      unregisterCloseInterceptor(editorWin.id);
    };
  }, [windows, files, registerCloseInterceptor, unregisterCloseInterceptor]);

  // ─── Define Custom Monaco Themes ─────────────────────────────────
  const handleMonacoMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // 1. Monokai
    monaco.editor.defineTheme('monokai', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '75715e', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'f92672', fontStyle: 'bold' },
        { token: 'string', foreground: 'e6db74' },
        { token: 'number', foreground: 'ae81ff' },
        { token: 'type', foreground: '66d9ef', fontStyle: 'italic' },
        { token: 'identifier.function', foreground: 'a6e22e' },
        { token: 'delimiter', foreground: 'f8f8f2' },
      ],
      colors: {
        'editor.background': '#272822',
        'editor.foreground': '#f8f8f2',
        'editorCursor.foreground': '#f8f8f0',
        'editor.lineHighlightBackground': '#3e3d32',
        'editorLineNumber.foreground': '#90908a',
        'editorLineNumber.activeForeground': '#c4c4b6',
        'editor.selectionBackground': '#49483e',
      }
    });

    // 2. Dracula
    monaco.editor.defineTheme('dracula', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'ff79c6' },
        { token: 'string', foreground: 'f1fa8c' },
        { token: 'number', foreground: 'bd93f9' },
        { token: 'type', foreground: '8be9fd' },
        { token: 'identifier.function', foreground: '50fa7b' },
      ],
      colors: {
        'editor.background': '#282a36',
        'editor.foreground': '#f8f8f2',
        'editorCursor.foreground': '#aeafad',
        'editor.lineHighlightBackground': '#44475a',
        'editorLineNumber.foreground': '#6272a4',
        'editor.selectionBackground': '#44475a',
      }
    });

    // 3. One Dark Pro
    monaco.editor.defineTheme('one-dark-pro', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '5c6370', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'c678dd' },
        { token: 'string', foreground: '98c379' },
        { token: 'number', foreground: 'd19a66' },
        { token: 'type', foreground: 'e5c07b' },
        { token: 'identifier.function', foreground: '61afef' },
      ],
      colors: {
        'editor.background': '#282c34',
        'editor.foreground': '#abb2bf',
        'editorCursor.foreground': '#528bff',
        'editor.lineHighlightBackground': '#2c313a',
        'editorLineNumber.foreground': '#4b5263',
        'editor.selectionBackground': '#3e4451',
      }
    });

    // 4. GitHub Dark
    monaco.editor.defineTheme('github-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'ff7b72' },
        { token: 'string', foreground: 'a5d6ff' },
        { token: 'number', foreground: '79c0ff' },
        { token: 'type', foreground: 'ffa657' },
        { token: 'identifier.function', foreground: 'd2a8ff' },
      ],
      colors: {
        'editor.background': '#0d1117',
        'editor.foreground': '#c9d1d9',
        'editorCursor.foreground': '#58a6ff',
        'editor.lineHighlightBackground': '#161b22',
        'editorLineNumber.foreground': '#484f58',
        'editor.selectionBackground': '#264f78',
      }
    });

    // 5. Catppuccin Mocha
    monaco.editor.defineTheme('catppuccin-mocha', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6c7086', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'cba6f7' },
        { token: 'string', foreground: 'a6e3a1' },
        { token: 'number', foreground: 'fab387' },
        { token: 'type', foreground: '89dceb' },
        { token: 'identifier.function', foreground: '89b4fa' },
      ],
      colors: {
        'editor.background': '#1e1e2e',
        'editor.foreground': '#cdd6f4',
        'editorCursor.foreground': '#f5e0dc',
        'editor.lineHighlightBackground': '#313244',
        'editorLineNumber.foreground': '#6c7086',
        'editor.selectionBackground': '#45475a',
      }
    });

    monaco.editor.setTheme(editorTheme);

    // Bind custom editor commands
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current?.();
    });

    editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () => {
      setWordWrap(prev => (prev === 'on' ? 'off' : 'on'));
    });

    // Select Language Mode chord: Ctrl+K M / Cmd+K M
    try {
      editor.addCommand(
        monaco.KeyMod.chord(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, monaco.KeyCode.KeyM),
        () => {
          setIsLanguagePickerOpen(true);
        }
      );
    } catch {}

    editor.onDidChangeCursorPosition((e: any) => {
      setCursorPos({ line: e.position.lineNumber, col: e.position.column });
    });
  };

  useEffect(() => {
    localStorage.setItem('sshdesktop_editor_theme', editorTheme);
  }, [editorTheme]);

  // ─── Listen to Tauri terminal output globally ───────────────────
  useEffect(() => {
    let isCancelled = false;
    let unlistenFn: (() => void) | undefined;
    listen<any>('terminal-output', (event) => {
      if (isCancelled) return;
      const payload = event.payload;
      if (!payload || !payload.terminal_id) return;
      const instance = tabInstances.current.get(payload.terminal_id);
      if (instance && !instance.disposed) {
        if (payload.text) {
          instance.term.write(payload.text);
        } else if (payload.data && Array.isArray(payload.data)) {
          const u8 = new Uint8Array(payload.data);
          instance.term.write(u8);
        }
      }
    }).then(fn => {
      if (isCancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      isCancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, []);

  // Mount real PTY instance into DOM element
  const mountPtyTerminal = useCallback(async (tabId: string, folder: string, el: HTMLDivElement) => {
    if (tabInstances.current.has(tabId)) {
      const inst = tabInstances.current.get(tabId);
      try { inst?.fitAddon.fit(); } catch {}
      return;
    }

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      theme: {
        background: '#11111b',
        foreground: '#cdd6f4',
        cursor: '#58a6ff',
        selectionBackground: 'rgba(88, 166, 255, 0.35)',
        black: '#303446',
        red: '#e78284',
        green: '#a6d189',
        yellow: '#e5c890',
        blue: '#8caaee',
        magenta: '#f4b8e4',
        cyan: '#81c8be',
        white: '#c6d0f5',
      },
      allowTransparency: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(el);
    setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 60);

    const instance: TabInstance = { term, fitAddon, disposed: false };
    tabInstances.current.set(tabId, instance);

    // Terminal contextmenu listener on the mounted DOM element
    const onContextMenuHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const sel = term.getSelection() || '';
      setTermContextMenu({
        x: Math.min(e.clientX, window.innerWidth - 230),
        y: Math.min(e.clientY, window.innerHeight - 280),
        tabId,
        hasSelection: Boolean(sel && sel.trim().length > 0),
      });
    };
    el.addEventListener('contextmenu', onContextMenuHandler);

    term.onData(data => {
      const encoder = new TextEncoder();
      const bytes = Array.from(encoder.encode(data));
      terminalWrite(tabId, bytes).catch(() => {});
    });

    term.onResize(({ cols, rows }) => {
      terminalResize(tabId, rows, cols).catch(() => {});
    });

    try {
      await terminalCreate(activeConnId, term.rows || 20, term.cols || 80, tabId);
      if (folder && folder !== '/') {
        const cdPayload = `cd '${folder.replace(/'/g, "'\\''")}' && clear\r\n`;
        const encoder = new TextEncoder();
        setTimeout(() => {
          terminalWrite(tabId, Array.from(encoder.encode(cdPayload))).catch(() => {});
        }, 300);
      }
    } catch (err: any) {
      term.writeln(`\r\n\x1b[31m[Failed to connect bash PTY: ${err?.message || err}]\x1b[0m\r\n`);
    }
  }, [activeConnId]);

  // Terminal Context Menu Handlers
  const handleTerminalContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const inst = tabInstances.current.get(tabId);
    const sel = inst?.term.getSelection() || '';
    setTermContextMenu({
      x: Math.min(e.clientX, window.innerWidth - 230),
      y: Math.min(e.clientY, window.innerHeight - 280),
      tabId,
      hasSelection: Boolean(sel && sel.trim().length > 0),
    });
  }, []);

  const handleTermCopy = useCallback(() => {
    if (!termContextMenu) return;
    const inst = tabInstances.current.get(termContextMenu.tabId);
    const sel = inst?.term.getSelection();
    if (sel) {
      navigator.clipboard.writeText(sel);
      setCopiedNotice(true);
      setTimeout(() => setCopiedNotice(false), 2000);
    }
    setTermContextMenu(null);
  }, [termContextMenu]);

  const handleTermPaste = useCallback(async () => {
    if (!termContextMenu) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const bytes = Array.from(new TextEncoder().encode(text));
        await terminalWrite(termContextMenu.tabId, bytes);
      }
    } catch (err) {
      console.warn('Terminal paste failed:', err);
    }
    setTermContextMenu(null);
  }, [termContextMenu]);

  const handleTermSelectAll = useCallback(() => {
    if (!termContextMenu) return;
    const inst = tabInstances.current.get(termContextMenu.tabId);
    inst?.term.selectAll();
    setTermContextMenu(null);
  }, [termContextMenu]);

  const handleTermClear = useCallback(() => {
    if (!termContextMenu) return;
    const inst = tabInstances.current.get(termContextMenu.tabId);
    inst?.term.clear();
    const bytes = Array.from(new TextEncoder().encode('clear\r'));
    terminalWrite(termContextMenu.tabId, bytes).catch(() => {});
    setTermContextMenu(null);
  }, [termContextMenu]);

  const handleTermReset = useCallback(() => {
    if (!termContextMenu) return;
    const inst = tabInstances.current.get(termContextMenu.tabId);
    inst?.term.reset();
    try { inst?.fitAddon.fit(); } catch {}
    setTermContextMenu(null);
  }, [termContextMenu]);

  // Fit terminal on toggle or tab switch without destroying canvas
  useEffect(() => {
    if (showTerminal) {
      const timer = setTimeout(() => {
        const activeInst = tabInstances.current.get(activeTermId);
        try {
          activeInst?.fitAddon.fit();
          activeInst?.term.focus();
        } catch {}
        if (isSplitTerminal && splitTermId) {
          const splitInst = tabInstances.current.get(splitTermId);
          try { splitInst?.fitAddon.fit(); } catch {}
        }
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [showTerminal, activeTermId, isSplitTerminal, splitTermId]);

  // Add new bash terminal tab in current folder or specific folder
  const addNewTerminal = useCallback((targetFolder?: string) => {
    const newId = `editor-term-${Date.now()}`;
    const ptyCount = terminals.length + 1;
    const folder = targetFolder || currentWorkingDir;
    const newTab: TerminalTab = {
      id: newId,
      title: `${ptyCount}: bash`,
      folder
    };
    setTerminals(prev => [...prev, newTab]);
    setActiveTermId(newId);
    setShowTerminal(true);
  }, [terminals.length, currentWorkingDir]);

  // Open Terminal specifically at folder (e.g. from context menu)
  const openTerminalAtFolder = useCallback((folder: string) => {
    setSelectedFolder(folder);
    setShowTerminal(true);
    // If we have an existing terminal, navigate it or spawn new
    addNewTerminal(folder);
  }, [addNewTerminal]);

  const closeTerminal = useCallback((id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (terminals.length <= 1) return;
    const inst = tabInstances.current.get(id);
    if (inst) {
      inst.disposed = true;
      try { inst.term.dispose(); } catch {}
      tabInstances.current.delete(id);
    }
    terminalClose(id).catch(() => {});
    const remaining = terminals.filter(t => t.id !== id);
    setTerminals(remaining);
    if (activeTermId === id) {
      const nextActive = remaining.find(t => t.id !== splitTermId) || remaining[0];
      setActiveTermId(nextActive.id);
    }
    if (splitTermId === id) {
      const nextSplit = remaining.find(t => t.id !== activeTermId);
      if (nextSplit && remaining.length >= 2) {
        setSplitTermId(nextSplit.id);
      } else {
        setIsSplitTerminal(false);
        setSplitTermId('');
      }
    }
  }, [terminals, activeTermId, splitTermId]);

  // Split Terminal handler: ensures dedicated terminal instance for right split pane and triggers re-fit
  const handleToggleSplitTerminal = useCallback(() => {
    if (isSplitTerminal) {
      setIsSplitTerminal(false);
      setSplitTermId('');
      setTimeout(() => {
        const inst = tabInstances.current.get(activeTermId);
        try { inst?.fitAddon.fit(); } catch {}
      }, 50);
      return;
    }

    // Toggle ON: If only 1 terminal exists, spawn a second bash terminal for the right split pane!
    if (terminals.length <= 1) {
      const newId = `editor-term-${Date.now()}`;
      const ptyCount = terminals.length + 1;
      const folder = currentWorkingDir;
      const newTab: TerminalTab = {
        id: newId,
        title: `${ptyCount}: bash`,
        folder
      };
      setTerminals(prev => [...prev, newTab]);
      setSplitTermId(newId);
      setIsSplitTerminal(true);
      setShowTerminal(true);
    } else {
      // Pick a terminal that is not the active one
      const other = terminals.find(t => t.id !== activeTermId) || terminals[0];
      setSplitTermId(other.id);
      setIsSplitTerminal(true);
      setShowTerminal(true);
    }

    setTimeout(() => {
      const leftInst = tabInstances.current.get(activeTermId);
      try { leftInst?.fitAddon.fit(); } catch {}
      if (splitTermId) {
        const rightInst = tabInstances.current.get(splitTermId);
        try { rightInst?.fitAddon.fit(); } catch {}
      }
    }, 100);
  }, [isSplitTerminal, terminals, activeTermId, currentWorkingDir, splitTermId]);

  // ─── Directory Loader with Safe Permission Handling ───────────────
  const loadDirectory = useCallback(async (dirPath: string): Promise<TreeItem[]> => {
    try {
      const items = await sftpListDir(activeConnId, dirPath);
      if (Array.isArray(items)) {
        return items.map((it: any) => {
          const cleanName = (it.name || '').replace(/^['"]|['"]$/g, '').trim();
          const cleanPath = (it.path || `${dirPath}/${cleanName}`)
            .replace(/'/g, '')
            .replace(/"/g, '')
            .replace(/\/+/g, '/');
          return {
            name: cleanName,
            path: cleanPath,
            isDir: Boolean(it.is_dir || it.isDir),
            size: it.size || 0,
            isOpen: false,
            children: it.is_dir ? [] : undefined
          };
        }).sort((a, b) => {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });
      }
    } catch (err: any) {
      setError(parsePermissionError(err));
    }
    return [];
  }, [activeConnId]);

  // Refresh Project Tree: Strictly verifies path exists BEFORE setting!
  const refreshProjectTree = useCallback(async (targetPath?: string) => {
    const rawPath = (targetPath || projectRoot).trim();
    if (!rawPath) {
      setError('Workspace root path cannot be empty.');
      return;
    }

    setLoadingTree(true);
    setLoadingAction('Scanning workspace...');
    setError(null);

    try {
      // 1. Strictly verify the directory exists using test -d on the server
      const checkRes = await sshExec(activeConnId, `[ -d '${rawPath.replace(/'/g, "'\\''")}' ] && echo "EXISTS" || echo "NOT_FOUND"`);
      if (checkRes.stdout.trim() !== 'EXISTS') {
        setError(`Path not found: '${rawPath}'. The directory does not exist on the remote server.`);
        setLoadingTree(false);
        setLoadingAction(null);
        return;
      }

      // 2. Directory exists: load contents
      const roots = await loadDirectory(rawPath);
      setTreeItems(roots);
      setProjectRoot(rawPath);
      setWorkspaceInput(rawPath);
      setSelectedFolder(rawPath);
    } catch (err: any) {
      setError(parsePermissionError(err));
    } finally {
      setLoadingTree(false);
      setLoadingAction(null);
    }
  }, [activeConnId, loadDirectory, projectRoot]);

  useEffect(() => {
    refreshProjectTree();
  }, [refreshProjectTree]);

  // Open file in Editor or Media Viewer
  const openPathInEditor = useCallback(async (targetPath: string) => {
    if (!targetPath.trim()) return;
    const clean = targetPath.trim();
    const existing = files.find(f => f.remotePath === clean);
    if (existing) {
      setActiveFileId(existing.id);
      return;
    }

    const fileName = clean.split('/').filter(Boolean).pop() || 'file.txt';
    const isMedia = isMediaFile(fileName);

    setLoading(true);
    setLoadingAction(`Loading ${fileName}...`);
    setError(null);

    try {
      if (isMedia) {
        // Fetch media file safely as Base64 to prevent binary text corruption
        const mime = getMediaMime(fileName);
        const b64Res = await sshExec(activeConnId, `base64 -w 0 '${clean.replace(/'/g, "'\\''")}' 2>/dev/null || base64 '${clean.replace(/'/g, "'\\''")}'`);
        
        let mediaType: 'image' | 'video' | 'audio' | 'pdf' = 'image';
        if (isVideoFile(fileName)) mediaType = 'video';
        else if (isAudioFile(fileName)) mediaType = 'audio';
        else if (isPdfFile(fileName)) mediaType = 'pdf';

        const rawB64 = b64Res.stdout.replace(/\s+/g, '');
        const dataUrl = rawB64 ? `data:${mime};base64,${rawB64}` : '';

        const newTab: FileTab = {
          id: String(Date.now()),
          name: fileName,
          remotePath: clean,
          language: 'media',
          content: '',
          isModified: false,
          isMedia: true,
          mediaType,
          mediaUrl: dataUrl,
        };

        setFiles(prev => [...prev, newTab]);
        setActiveFileId(newTab.id);
        addRecentFile(clean);
      } else {
        // Plaintext / Code File
        const content = await sftpReadTextFile(activeConnId, clean);
        const newTab: FileTab = {
          id: String(Date.now()),
          name: fileName,
          remotePath: clean,
          language: detectLanguage(fileName),
          content,
          isModified: false,
          isMedia: false,
        };
        setFiles(prev => [...prev, newTab]);
        setActiveFileId(newTab.id);
        addRecentFile(clean);
      }
    } catch (err: any) {
      setError(parsePermissionError(err));
    } finally {
      setLoading(false);
      setLoadingAction(null);
    }
  }, [activeConnId, files, addRecentFile]);

  // Handle external pending file requests (e.g. from Finder)
  useEffect(() => {
    if (pendingFilePath) {
      openPathInEditor(pendingFilePath);
      clearPendingFile();
    }
  }, [pendingFilePath, openPathInEditor, clearPendingFile]);

  // Helper to reliably save remote files with elevated sudo temp-file fallback
  const saveFileWithElevatedFallback = useCallback(async (connId: string, remotePath: string, content: string) => {
    const isProtectedSystemPath = /^\/(etc|var|usr|lib|boot|opt|root)(\/|$)/.test(remotePath);

    // If not a system path, try direct SFTP write first
    if (!isProtectedSystemPath) {
      try {
        await sftpWriteTextFile(connId, remotePath, content);
        return;
      } catch (err: any) {
        console.warn('Direct SFTP write failed, attempting elevated temp-file write:', err);
      }
    }

    // Elevated write via temporary file in /tmp/ (safe for any file size, no command-line length limits)
    const tempFile = `/tmp/.sshdesktop_edit_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.tmp`;
    await sftpWriteTextFile(connId, tempFile, content);

    const escapedTemp = tempFile.replace(/'/g, "'\\''");
    const escapedDest = remotePath.replace(/'/g, "'\\''");
    const elevatedCmd = `sudo cp -f '${escapedTemp}' '${escapedDest}' && sudo chmod 644 '${escapedDest}' && rm -f '${escapedTemp}' 2>/dev/null || true`;

    const res = await sshExec(connId, elevatedCmd);
    if (res.exit_code !== 0) {
      await sshExec(connId, `rm -f '${escapedTemp}' 2>/dev/null || true`).catch(() => {});
      throw new Error(res.stderr || res.stdout || 'Permission denied: Sudo privileges required to write to this file');
    }
  }, []);

  // Save active file
  const handleSave = useCallback(async () => {
    if (!activeFile || activeFile.isMedia) return;
    setLoading(true);
    setLoadingAction(`Saving ${activeFile.name}...`);
    setError(null);
    setPermissionAlert(null);

    try {
      // Guard with 15s timeout to prevent infinite loading spinners
      await Promise.race([
        saveFileWithElevatedFallback(activeConnId, activeFile.remotePath, activeFile.content),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Save operation timed out after 15 seconds. Please check server connection.')), 15000)
        ),
      ]);

      setFiles(prev =>
        prev.map(f => (f.id === activeFile.id ? { ...f, isModified: false } : f))
      );
      setSavedSuccess(true);
      showEditorToast(`Saved ${activeFile.name} successfully`);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      const isPerm = isPermissionDenied(errMsg);
      const userFacing = isPerm
        ? `Permission Denied: Administrator (sudo) privileges required to write to '${activeFile.remotePath}'.`
        : `Failed to save '${activeFile.name}': ${errMsg}`;
      
      setError(userFacing);
      if (isPerm) {
        setPermissionAlert({
          title: 'Permission Denied',
          message: `Administrator (sudo) privileges are required to save changes to this file.\n\nPlease verify that your user account has sudo privileges or connect with a root user session.\n\nServer response:\n${errMsg}`,
          path: activeFile.remotePath
        });
      }
    } finally {
      setLoading(false);
      setLoadingAction(null);
    }
  }, [activeConnId, activeFile, saveFileWithElevatedFallback, showEditorToast]);

  // Keep ref up to date to prevent stale closures in Monaco keybindings
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  const handleSaveAll = useCallback(async () => {
    const modified = files.filter(f => f.isModified && !f.isMedia);
    if (modified.length === 0) return;
    setLoading(true);
    setLoadingAction('Saving all modified files...');
    setError(null);
    setPermissionAlert(null);

    const successfullySavedIds = new Set<string>();
    let firstPermErr: { path: string; msg: string } | null = null;

    for (const f of modified) {
      try {
        await Promise.race([
          saveFileWithElevatedFallback(activeConnId, f.remotePath, f.content),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Save timed out for ${f.name}`)), 15000)
          ),
        ]);
        successfullySavedIds.add(f.id);
      } catch (err: any) {
        const errMsg = String(err?.message || err);
        if (isPermissionDenied(errMsg) && !firstPermErr) {
          firstPermErr = { path: f.remotePath, msg: errMsg };
        }
        setError(parsePermissionError(err));
      }
    }

    setFiles(prev => prev.map(f => successfullySavedIds.has(f.id) ? { ...f, isModified: false } : f));
    
    if (firstPermErr) {
      setPermissionAlert({
        title: 'Permission Denied',
        message: `Administrator (sudo) privileges are required to save changes to '${firstPermErr.path}'.\n\nServer response:\n${firstPermErr.msg}`,
        path: firstPermErr.path
      });
    }

    setLoading(false);
    setLoadingAction(null);
  }, [activeConnId, files, saveFileWithElevatedFallback]);

  useEffect(() => {
    handleSaveAllRef.current = handleSaveAll;
  }, [handleSaveAll]);

  // Tab Close Handling
  const requestCloseTab = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const targetTab = files.find(f => f.id === id);
    if (!targetTab) return;

    if (targetTab.isModified) {
      setCloseConfirmTab(targetTab);
    } else {
      performCloseTab(id);
    }
  };

  const performCloseTab = (id: string) => {
    const remaining = files.filter(f => f.id !== id);
    setFiles(remaining);
    if (activeFileId === id) {
      setActiveFileId(remaining.length > 0 ? remaining[remaining.length - 1].id : '');
    }
    if (splitActiveFileId === id) {
      setSplitActiveFileId(remaining.length > 0 ? remaining[0].id : '');
    }
    setCloseConfirmTab(null);
  };

  const handleConfirmSaveAndClose = async () => {
    if (!closeConfirmTab) return;
    try {
      try {
        await sftpWriteTextFile(activeConnId, closeConfirmTab.remotePath, closeConfirmTab.content);
      } catch (writeErr: any) {
        const b64 = btoa(unescape(encodeURIComponent(closeConfirmTab.content)));
        const privCmd = `sudo sh -c 'printf "%s" "${b64}" | base64 -d > "${closeConfirmTab.remotePath}"'`;
        const res = await sshExec(activeConnId, privCmd);
        if (res.exit_code !== 0) {
          throw new Error(res.stdout || res.stderr || writeErr?.message || 'Permission denied');
        }
      }
      performCloseTab(closeConfirmTab.id);
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      const isPerm = isPermissionDenied(errMsg);
      setError(parsePermissionError(err));
      if (isPerm) {
        setPermissionAlert({
          title: 'Permission Denied',
          message: `Administrator (sudo) privileges are required to save changes to '${closeConfirmTab.remotePath}'.\n\nServer response:\n${errMsg}`,
          path: closeConfirmTab.remotePath
        });
      }
      setCloseConfirmTab(null);
    }
  };

  // Close other tabs
  const handleCloseOtherTabs = (keepId: string) => {
    const modifiedOthers = files.filter(f => f.id !== keepId && f.isModified);
    if (modifiedOthers.length > 0) {
      if (!confirm(`You have ${modifiedOthers.length} unsaved file(s). Close and discard changes?`)) {
        return;
      }
    }
    setFiles(files.filter(f => f.id === keepId));
    setActiveFileId(keepId);
  };

  // Close tabs to the right
  const handleCloseTabsToRight = (targetId: string) => {
    const index = files.findIndex(f => f.id === targetId);
    if (index === -1) return;
    const toClose = files.slice(index + 1);
    const modified = toClose.filter(f => f.isModified);
    if (modified.length > 0) {
      if (!confirm(`You have ${modified.length} unsaved file(s) to the right. Discard and close?`)) {
        return;
      }
    }
    const remaining = files.slice(0, index + 1);
    setFiles(remaining);
    if (!remaining.some(f => f.id === activeFileId)) {
      setActiveFileId(targetId);
    }
  };

  // Close all tabs
  const handleCloseAllTabs = () => {
    const modified = files.filter(f => f.isModified);
    if (modified.length > 0) {
      if (!confirm(`You have ${modified.length} unsaved file(s). Discard changes and close all tabs?`)) {
        return;
      }
    }
    setFiles([]);
    setActiveFileId('');
  };

  // New Untitled File
  const newUntitledFile = () => {
    const id = String(Date.now());
    const folder = currentWorkingDir || '/tmp';
    const filename = `untitled-${files.length + 1}.txt`;
    const fullPath = `${folder.replace(/\/+$/, '')}/${filename}`;
    const nextFile: FileTab = {
      id,
      name: filename,
      remotePath: fullPath,
      language: 'plaintext',
      content: '// New document on Linux server\n',
      isModified: true,
      isMedia: false,
    };
    setFiles([...files, nextFile]);
    setActiveFileId(id);
  };

  // ─── Keyboard Shortcuts ──────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Alt + Z: Toggle Word Wrap
      if (e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setWordWrap(prev => (prev === 'on' ? 'off' : 'on'));
        return;
      }

      // Ctrl + K -> M chord: Select Language Mode
      if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'k') {
        chordRef.current = { key: 'k', time: Date.now() };
        return;
      }
      if (chordRef.current && chordRef.current.key === 'k' && Date.now() - chordRef.current.time < 1500) {
        if (e.key.toLowerCase() === 'm') {
          e.preventDefault();
          chordRef.current = null;
          setIsLanguagePickerOpen(true);
          return;
        }
      }
      if (e.key.toLowerCase() !== 'control' && e.key.toLowerCase() !== 'meta') {
        chordRef.current = null;
      }

      // Ctrl + + / Ctrl + =: Zoom font size in
      if (isCtrlOrCmd && (e.key === '=' || e.key === '+' || e.key === 'Add')) {
        e.preventDefault();
        setFontSize(prev => {
          const next = Math.min(32, prev + 1);
          localStorage.setItem('sshdesktop_editor_fontsize', String(next));
          return next;
        });
        return;
      }

      // Ctrl + -: Zoom font size out
      if (isCtrlOrCmd && (e.key === '-' || e.key === '_' || e.key === 'Subtract')) {
        e.preventDefault();
        setFontSize(prev => {
          const next = Math.max(9, prev - 1);
          localStorage.setItem('sshdesktop_editor_fontsize', String(next));
          return next;
        });
        return;
      }

      // Ctrl + S: Save
      if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveRef.current?.();
        return;
      }

      // Ctrl + Shift + S: Save All
      if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveAllRef.current?.();
        return;
      }

      // Ctrl + W: Close Active Tab
      if (isCtrlOrCmd && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (activeFileId) requestCloseTab(activeFileId);
        return;
      }

      // Ctrl + N: New File
      if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newUntitledFile();
        return;
      }

      // Ctrl + B: Toggle Primary Sidebar
      if (isCtrlOrCmd && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setSidebarOpen(prev => !prev);
        return;
      }

      // Ctrl + ` (backtick): Toggle Integrated Bash Terminal Drawer
      if (isCtrlOrCmd && e.key === '`') {
        e.preventDefault();
        setShowTerminal(prev => !prev);
        return;
      }

      // Ctrl + P: Quick Open File
      if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowQuickOpen(true);
        setQuickOpenFilter('');
        return;
      }

      // Ctrl + Shift + P / F1: Command Palette
      if ((isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'p') || e.key === 'F1') {
        e.preventDefault();
        setShowCommandPalette(true);
        setPaletteFilter('');
        return;
      }

      // Ctrl + Shift + E: Switch to Explorer
      if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setActiveSidebarTab('explorer');
        setSidebarOpen(true);
        return;
      }

      // Ctrl + Shift + G: Switch to Source Control
      if (isCtrlOrCmd && e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        setActiveSidebarTab('git');
        setSidebarOpen(true);
        fetchGitData();
        return;
      }

      // Explorer Left Sidebar shortcuts for Ctrl+C, Ctrl+X, Ctrl+V
      if (isCtrlOrCmd && !e.shiftKey && activeSidebarTabRef.current === 'explorer' && sidebarOpenRef.current) {
        const activeEl = document.activeElement;
        const isEditingInMonaco = activeEl?.classList.contains('inputarea') || activeEl?.closest('.monaco-editor');
        const isInputField = activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA';

        if (!isEditingInMonaco && !isInputField) {
          const key = e.key.toLowerCase();
          const paths = selectedTreePathsRef.current.size > 0
            ? Array.from(selectedTreePathsRef.current)
            : selectedTreePathRef.current
            ? [selectedTreePathRef.current]
            : [];

          if (key === 'c' && paths.length > 0) {
            e.preventDefault();
            handleCopyItems(paths);
            return;
          }
          if (key === 'x' && paths.length > 0) {
            e.preventDefault();
            handleCutItems(paths);
            return;
          }
          if (key === 'v' && clipboardItemsRef.current) {
            e.preventDefault();
            let targetDir = selectedFolderRef.current || projectRootRef.current;
            if (selectedTreePathRef.current) {
              const item = visibleItemsRef.current.find(it => it.path === selectedTreePathRef.current);
              if (item) {
                targetDir = item.isDir ? item.path : item.path.substring(0, item.path.lastIndexOf('/')) || targetDir;
              }
            }
            handlePasteItems(targetDir);
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeFileId, handleSave, handleSaveAll]);

  // ─── Resizable Left Sidebar ───────────────────────────────────────
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingSidebar.current = true;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingSidebar.current) return;
      // Activity bar width is 48px
      const newWidth = Math.max(180, Math.min(550, moveEvent.clientX - 48));
      setSidebarWidth(newWidth);
      localStorage.setItem('sshdesktop_editor_sidebar_width', String(newWidth));
    };

    const handleMouseUp = () => {
      isResizingSidebar.current = false;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // ─── File & Folder Creation (Shows Errors Inside Modal) ──────────
  const openCreateDialog = (type: 'file' | 'folder', targetDir?: string) => {
    const dest = targetDir || selectedFolder || projectRoot;
    setCreateTargetFolder(dest);
    setNewItemName('');
    setCreateModalError(null);
    setShowCreateModal(type);
  };

  const handleConfirmCreate = async () => {
    if (!newItemName.trim()) return;
    const cleanName = newItemName.trim();
    const targetDir = createTargetFolder.replace(/\/+$/, '');
    const fullPath = `${targetDir}/${cleanName}`;

    setLoading(true);
    setLoadingAction(`Creating ${cleanName}...`);
    setCreateModalError(null);

    try {
      if (showCreateModal === 'folder') {
        await sftpMkdir(activeConnId, fullPath);
      } else {
        await sftpWriteTextFile(activeConnId, fullPath, `// Created in SSH Desktop: ${cleanName}\n`);
        await openPathInEditor(fullPath);
      }
      setShowCreateModal(null);
      setNewItemName('');
      await refreshProjectTree();
    } catch (err: any) {
      setCreateModalError(parsePermissionError(err));
    } finally {
      setLoading(false);
      setLoadingAction(null);
    }
  };

  // ─── Rename Item (Shows Errors Inside Modal) ──────────────────────
  const handleConfirmRename = async () => {
    if (!showRenameModal || !renameNewName.trim()) return;
    const oldPath = showRenameModal.path;
    const parentDir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = `${parentDir}/${renameNewName.trim()}`;

    setLoading(true);
    setLoadingAction(`Renaming to ${renameNewName.trim()}...`);
    setRenameModalError(null);

    try {
      await sftpRename(activeConnId, oldPath, newPath);
      setFiles(prev => prev.map(f => f.remotePath === oldPath ? { ...f, name: renameNewName.trim(), remotePath: newPath } : f));
      setShowRenameModal(null);
      await refreshProjectTree();
    } catch (err: any) {
      setRenameModalError(parsePermissionError(err));
    } finally {
      setLoading(false);
      setLoadingAction(null);
    }
  };

  // ─── Multi-Item & Single Item Delete (Shows Errors Inside Modal) ──
  const openDeleteDialog = (paths: string[]) => {
    if (paths.length === 0) return;
    setShowDeleteModal({ items: paths });
    setDeleteModalError(null);
  };

  const handleConfirmDelete = async () => {
    if (!showDeleteModal || showDeleteModal.items.length === 0) return;
    setLoading(true);
    setLoadingAction(`Deleting ${showDeleteModal.items.length} item(s)...`);
    setDeleteModalError(null);

    try {
      for (const targetPath of showDeleteModal.items) {
        await sftpDelete(activeConnId, targetPath);
      }
      // Remove deleted tabs
      const remainingTabs = files.filter(f => !showDeleteModal.items.includes(f.remotePath));
      setFiles(remainingTabs);
      if (showDeleteModal.items.includes(activeFile?.remotePath || '')) {
        setActiveFileId(remainingTabs.length > 0 ? remainingTabs[0].id : '');
      }
      setSelectedTreePaths(new Set());
      setSelectedTreePath('');
      setShowDeleteModal(null);
      await refreshProjectTree();
    } catch (err: any) {
      setDeleteModalError(parsePermissionError(err));
    } finally {
      setLoading(false);
      setLoadingAction(null);
    }
  };

  // ─── File & Folder Copy / Cut / Paste ─────────────────────────────
  const handleCopyItems = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    setClipboardItems({ paths, mode: 'copy' });
    setTreeContextMenu(prev => ({ ...prev, visible: false }));
    const name = paths.length === 1 ? paths[0].split('/').pop() : `${paths.length} items`;
    showEditorToast(`Copied ${name} (Ctrl+V to paste)`);
  }, [showEditorToast]);

  const handleCutItems = useCallback((paths: string[]) => {
    if (paths.length === 0) return;
    setClipboardItems({ paths, mode: 'cut' });
    setTreeContextMenu(prev => ({ ...prev, visible: false }));
    const name = paths.length === 1 ? paths[0].split('/').pop() : `${paths.length} items`;
    showEditorToast(`Cut ${name} (Ctrl+V to paste)`);
  }, [showEditorToast]);

  // Generate duplicate naming pattern: 1.txt -> 1 - Copy.txt -> 1 - Copy(2).txt -> 1 - Copy(3).txt
  const generateDuplicateName = (rawOriginalName: string, existingNames: Set<string>): string => {
    // Strip any leading/trailing quotes
    const originalName = rawOriginalName.replace(/^['"]|['"]$/g, '').trim();
    const lastDot = originalName.lastIndexOf('.');
    const base = lastDot > 0 ? originalName.substring(0, lastDot) : originalName;
    const ext = lastDot > 0 ? originalName.substring(lastDot) : '';

    const copyNumRegex = /^(.*) - Copy\((\d+)\)$/;
    const copySingleRegex = /^(.*) - Copy$/;

    let stem = base;
    let nextNum = 1;

    const numMatch = base.match(copyNumRegex);
    if (numMatch) {
      stem = numMatch[1];
      nextNum = parseInt(numMatch[2], 10) + 1;
    } else {
      const singleMatch = base.match(copySingleRegex);
      if (singleMatch) {
        stem = singleMatch[1];
        nextNum = 2;
      }
    }

    while (true) {
      let candidate = '';
      if (nextNum === 1) {
        candidate = `${stem} - Copy${ext}`;
        nextNum = 2;
      } else {
        candidate = `${stem} - Copy(${nextNum})${ext}`;
        nextNum++;
      }

      if (!existingNames.has(candidate)) {
        existingNames.add(candidate);
        return candidate;
      }
    }
  };

  const handlePasteItems = useCallback(async (destFolder: string) => {
    if (!clipboardItems || clipboardItems.paths.length === 0) return;
    const targetDir = destFolder.replace(/\/+$/, '') || '/';
    setLoading(true);
    setLoadingAction(clipboardItems.mode === 'copy' ? 'Copying files...' : 'Moving files...');
    setError(null);

    try {
      // 1. Discover existing files in destination directory (normalized without quotes)
      let existingNames = new Set<string>();
      try {
        const entries = await sftpListDir(activeConnId, targetDir);
        existingNames = new Set(
          entries.map(e => (e.name || '').replace(/^['"]|['"]$/g, '').trim())
        );
      } catch (err) {
        console.warn('Could not list target directory before paste:', err);
      }

      let count = 0;

      for (const rawSrc of clipboardItems.paths) {
        // Strip any quotes that might exist on path or filename
        const src = rawSrc.replace(/'/g, '').replace(/"/g, '').trim();
        const srcFileName = (src.split('/').pop() || src).replace(/^['"]|['"]$/g, '').trim();
        const srcDir = src.substring(0, src.lastIndexOf('/')) || '/';
        const isSameDir = srcDir === targetDir;

        let targetFileName = srcFileName;
        // If copying into the same folder OR if target file already exists, create duplicate name
        if (clipboardItems.mode === 'copy' && (isSameDir || existingNames.has(srcFileName))) {
          targetFileName = generateDuplicateName(srcFileName, existingNames);
        } else {
          existingNames.add(targetFileName);
        }

        // Clean target filename strictly of any quotes
        targetFileName = targetFileName.replace(/^['"]|['"]$/g, '').trim();

        const targetFullPath = `${targetDir}/${targetFileName}`;
        const escapedSrc = src.replace(/'/g, "'\\''");
        const escapedDest = targetFullPath.replace(/'/g, "'\\''");

        const cmd = clipboardItems.mode === 'copy'
          ? `cp -r '${escapedSrc}' '${escapedDest}' 2>&1`
          : `mv '${escapedSrc}' '${escapedDest}' 2>&1`;

        let res = await sshExec(activeConnId, cmd);
        if (res.exit_code !== 0) {
          // Elevated fallback with sudo
          const sudoCmd = clipboardItems.mode === 'copy'
            ? `sudo cp -r '${escapedSrc}' '${escapedDest}' 2>&1`
            : `sudo mv '${escapedSrc}' '${escapedDest}' 2>&1`;
          res = await sshExec(activeConnId, sudoCmd);
          if (res.exit_code !== 0) {
            throw new Error(res.stderr || res.stdout || `Failed to ${clipboardItems.mode} ${srcFileName}`);
          }
        }
        count++;
      }

      if (clipboardItems.mode === 'cut') {
        setClipboardItems(null);
      }

      showEditorToast(
        clipboardItems.mode === 'copy'
          ? `Pasted ${count} item(s) as copy`
          : `Moved ${count} item(s) successfully`
      );

      await refreshProjectTree();
    } catch (err: any) {
      setError(parsePermissionError(err));
    } finally {
      setLoading(false);
      setLoadingAction(null);
      setTreeContextMenu(prev => ({ ...prev, visible: false }));
    }
  }, [activeConnId, clipboardItems, refreshProjectTree, showEditorToast]);

  // ─── Git Operations (Complete VS Code Git Engine) ─────────────────
  const fetchGitData = async () => {
    setGitRunning(true);
    setLoadingAction('Inspecting Git status...');
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");

      // Verify if directory is a git repository
      const checkRepo = await sshExec(activeConnId, `cd '${dir}' && git rev-parse --is-inside-work-tree 2>/dev/null`);
      if (checkRepo.exit_code !== 0 || checkRepo.stdout.trim() !== 'true') {
        setIsGitRepo(false);
        setGitStatusFiles([]);
        setGitLog([]);
        return;
      }
      setIsGitRepo(true);

      // Current branch
      const branchRes = await sshExec(activeConnId, `cd '${dir}' && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main"`);
      setCurrentBranch(branchRes.stdout.trim() || 'main');

      // All branches
      const allBranchesRes = await sshExec(activeConnId, `cd '${dir}' && git branch 2>/dev/null`);
      const branches = (allBranchesRes.stdout || '').split('\n')
        .map(b => b.replace('*', '').trim())
        .filter(Boolean);
      setBranchesList(branches.length > 0 ? branches : ['main']);

      // Status parse
      const statusRes = await sshExec(activeConnId, `cd '${dir}' && git status --porcelain 2>/dev/null`);
      const lines = (statusRes.stdout || '').split('\n').filter(Boolean);
      const parsedFiles: GitFileStatus[] = lines.map(line => {
        const x = line.substring(0, 1);
        const y = line.substring(1, 2);
        const path = line.substring(3).trim();
        const staged = x !== ' ' && x !== '?';
        const status = x !== ' ' ? x : y;
        return { path, staged, status };
      });
      setGitStatusFiles(parsedFiles);

      // Log History
      const logRes = await sshExec(activeConnId, `cd '${dir}' && git log -n 12 --pretty=format:"%h - %an, %ar : %s" 2>/dev/null`);
      setGitLog((logRes.stdout || '').split('\n').filter(Boolean));
    } catch (err: any) {
      setError(parsePermissionError(err));
    } finally {
      setGitRunning(false);
      setLoadingAction(null);
    }
  };

  const handleGitInit = async () => {
    setGitRunning(true);
    setLoadingAction('Initializing Git repository...');
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      const res = await sshExec(activeConnId, `cd '${dir}' && git init`);
      if (res.exit_code === 0) {
        setIsGitRepo(true);
        await fetchGitData();
        await refreshProjectTree();
      } else {
        setError(res.stderr || res.stdout);
      }
    } catch (err: any) {
      setError(parsePermissionError(err));
    } finally {
      setGitRunning(false);
      setLoadingAction(null);
    }
  };

  const stageGitFile = async (filePath: string) => {
    setGitRunning(true);
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      await sshExec(activeConnId, `cd '${dir}' && git add '${filePath.replace(/'/g, "'\\''")}'`);
      await fetchGitData();
    } finally {
      setGitRunning(false);
    }
  };

  const unstageGitFile = async (filePath: string) => {
    setGitRunning(true);
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      await sshExec(activeConnId, `cd '${dir}' && git reset HEAD '${filePath.replace(/'/g, "'\\''")}'`);
      await fetchGitData();
    } finally {
      setGitRunning(false);
    }
  };

  const discardGitFile = async (filePath: string) => {
    if (!confirm(`Discard all changes to '${filePath}'?`)) return;
    setGitRunning(true);
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      await sshExec(activeConnId, `cd '${dir}' && git checkout -- '${filePath.replace(/'/g, "'\\''")}' 2>/dev/null || git restore '${filePath.replace(/'/g, "'\\''")}'`);
      await fetchGitData();
      await refreshProjectTree();
    } finally {
      setGitRunning(false);
    }
  };

  const stageAllGitFiles = async () => {
    setGitRunning(true);
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      await sshExec(activeConnId, `cd '${dir}' && git add -A`);
      await fetchGitData();
    } finally {
      setGitRunning(false);
    }
  };

  const unstageAllGitFiles = async () => {
    setGitRunning(true);
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      await sshExec(activeConnId, `cd '${dir}' && git reset`);
      await fetchGitData();
    } finally {
      setGitRunning(false);
    }
  };

  const handleGitCommit = async (andPush = false) => {
    if (!gitCommitMsg.trim()) return;
    setGitRunning(true);
    setLoadingAction(andPush ? 'Committing & pushing...' : 'Committing changes...');
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      const msg = gitCommitMsg.replace(/'/g, "'\\''");
      const cmd = andPush
        ? `cd '${dir}' && git commit -m '${msg}' && git push`
        : `cd '${dir}' && git commit -m '${msg}'`;
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0) {
        setGitCommitMsg('');
        await fetchGitData();
      } else {
        setError(`Git commit notice: ${res.stderr || res.stdout}`);
      }
    } catch (err: any) {
      setError(parsePermissionError(err));
    } finally {
      setGitRunning(false);
      setLoadingAction(null);
    }
  };

  const handleGitPull = async () => {
    setGitRunning(true);
    setLoadingAction('Pulling changes from remote...');
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      const res = await sshExec(activeConnId, `cd '${dir}' && git pull`);
      if (res.exit_code === 0) {
        await fetchGitData();
        await refreshProjectTree();
      } else {
        setError(res.stderr || res.stdout);
      }
    } catch (err: any) {
      setError(parsePermissionError(err));
    } finally {
      setGitRunning(false);
      setLoadingAction(null);
    }
  };

  const openGitDiff = async (filePath: string) => {
    setGitRunning(true);
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      const res = await sshExec(activeConnId, `cd '${dir}' && git diff '${filePath.replace(/'/g, "'\\''")}'`);
      setGitDiffModal({
        visible: true,
        filePath,
        diff: res.stdout || 'No diff text or file is newly created.'
      });
    } finally {
      setGitRunning(false);
    }
  };

  const switchGitBranch = async (branch: string) => {
    setGitRunning(true);
    setLoadingAction(`Switching branch to '${branch}'...`);
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      const res = await sshExec(activeConnId, `cd '${dir}' && git checkout '${branch.replace(/'/g, "'\\''")}'`);
      if (res.exit_code === 0) {
        await fetchGitData();
        await refreshProjectTree();
      } else {
        setError(res.stderr || res.stdout);
      }
    } finally {
      setGitRunning(false);
      setLoadingAction(null);
      setShowBranchMenu(false);
    }
  };

  const createGitBranch = async () => {
    if (!newBranchInput.trim()) return;
    setGitRunning(true);
    setLoadingAction(`Creating branch '${newBranchInput.trim()}'...`);
    try {
      const dir = projectRoot.replace(/'/g, "'\\''");
      const branch = newBranchInput.trim().replace(/'/g, "'\\''");
      const res = await sshExec(activeConnId, `cd '${dir}' && git checkout -b '${branch}'`);
      if (res.exit_code === 0) {
        setNewBranchInput('');
        await fetchGitData();
      } else {
        setError(res.stderr || res.stdout);
      }
    } finally {
      setGitRunning(false);
      setLoadingAction(null);
      setShowBranchMenu(false);
    }
  };

  // ─── Flatten Visible Tree Items for Keyboard Navigation ───────────
  const getVisibleTreeItems = useCallback((items: TreeItem[]): TreeItem[] => {
    const list: TreeItem[] = [];
    const walk = (nodes: TreeItem[]) => {
      for (const node of nodes) {
        list.push(node);
        if (node.isDir && node.isOpen && node.children) {
          walk(node.children);
        }
      }
    };
    walk(items);
    return list;
  }, []);

  const visibleItems = useMemo(() => getVisibleTreeItems(treeItems), [getVisibleTreeItems, treeItems]);
  const visibleItemsRef = useRef(visibleItems);
  visibleItemsRef.current = visibleItems;

  // Tree click with Folder expansion & Multi-select handling
  const handleItemClick = async (item: TreeItem, e: React.MouseEvent) => {
    // Multi-selection handling (Ctrl or Shift key)
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      setSelectedTreePaths(prev => {
        const next = new Set(prev);
        if (next.has(item.path)) next.delete(item.path);
        else next.add(item.path);
        return next;
      });
      setSelectedTreePath(item.path);
      // "multiple section time do not open files" -> return immediately without opening
      return;
    }

    if (e.shiftKey && selectedTreePath) {
      e.stopPropagation();
      const startIdx = visibleItems.findIndex(it => it.path === selectedTreePath);
      const endIdx = visibleItems.findIndex(it => it.path === item.path);
      if (startIdx !== -1 && endIdx !== -1) {
        const [low, high] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const range = visibleItems.slice(low, high + 1).map(it => it.path);
        setSelectedTreePaths(new Set(range));
        setSelectedTreePath(item.path);
        return;
      }
    }

    // Normal Single Click
    setSelectedTreePaths(new Set([item.path]));
    setSelectedTreePath(item.path);

    if (item.isDir) {
      setSelectedFolder(item.path);
      setTreeItems(prev => {
        const updateChildren = (list: TreeItem[]): TreeItem[] => {
          return list.map(node => {
            if (node.path === item.path) {
              return { ...node, isOpen: !node.isOpen };
            }
            if (node.children) {
              return { ...node, children: updateChildren(node.children) };
            }
            return node;
          });
        };
        return updateChildren(prev);
      });

      if (!item.isOpen && (!item.children || item.children.length === 0)) {
        item.loading = true;
        setLoadingAction(`Opening folder ${item.name}...`);
        const children = await loadDirectory(item.path);
        setTreeItems(prev => {
          const updateChildren = (list: TreeItem[]): TreeItem[] => {
            return list.map(node => {
              if (node.path === item.path) {
                return { ...node, children, isOpen: true, loading: false };
              }
              if (node.children) {
                return { ...node, children: updateChildren(node.children) };
              }
              return node;
            });
          };
          return updateChildren(prev);
        });
        setLoadingAction(null);
      }
    } else {
      const parentDir = item.path.substring(0, item.path.lastIndexOf('/'));
      setSelectedFolder(parentDir || projectRoot);
      openPathInEditor(item.path);
    }
    // Maintain keyboard focus on tree container for instant shortcuts
    treeContainerRef.current?.focus();
  };

  // Tree Keyboard Navigation: Arrow Up, Arrow Down, Enter, Delete, Ctrl+C (Copy), Ctrl+X (Cut), Ctrl+V (Paste)
  const handleTreeKeyDown = (e: React.KeyboardEvent) => {
    if (visibleItems.length === 0) return;
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const currentIndex = visibleItems.findIndex(it => it.path === selectedTreePath);

    // Ctrl + C: Copy selected file(s)
    if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      const paths = selectedTreePaths.size > 0 ? Array.from(selectedTreePaths) : selectedTreePath ? [selectedTreePath] : [];
      if (paths.length > 0) {
        handleCopyItems(paths);
      }
      return;
    }

    // Ctrl + X: Cut selected file(s)
    if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      const paths = selectedTreePaths.size > 0 ? Array.from(selectedTreePaths) : selectedTreePath ? [selectedTreePath] : [];
      if (paths.length > 0) {
        handleCutItems(paths);
      }
      return;
    }

    // Ctrl + V: Paste file(s)
    if (isCtrlOrCmd && !e.shiftKey && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      let targetDir = selectedFolder || projectRoot;
      if (selectedTreePath) {
        const item = visibleItems.find(it => it.path === selectedTreePath);
        if (item) {
          targetDir = item.isDir ? item.path : item.path.substring(0, item.path.lastIndexOf('/')) || targetDir;
        }
      }
      handlePasteItems(targetDir);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = currentIndex < visibleItems.length - 1 ? currentIndex + 1 : 0;
      const nextItem = visibleItems[nextIdx];
      setSelectedTreePath(nextItem.path);
      setSelectedTreePaths(new Set([nextItem.path]));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = currentIndex > 0 ? currentIndex - 1 : visibleItems.length - 1;
      const prevItem = visibleItems[prevIdx];
      setSelectedTreePath(prevItem.path);
      setSelectedTreePaths(new Set([prevItem.path]));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = visibleItems[currentIndex];
      if (current) {
        if (current.isDir) {
          handleItemClick(current, e as any);
        } else {
          openPathInEditor(current.path);
        }
      }
    } else if (e.key === 'Delete') {
      e.preventDefault();
      const pathsToDelete = selectedTreePaths.size > 0 ? Array.from(selectedTreePaths) : selectedTreePath ? [selectedTreePath] : [];
      if (pathsToDelete.length > 0) {
        openDeleteDialog(pathsToDelete);
      }
    }
  };

  // Right-click context menu on tree item
  const handleTreeContextMenu = (e: React.MouseEvent, item: TreeItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedTreePaths.has(item.path)) {
      setSelectedTreePaths(new Set([item.path]));
      setSelectedTreePath(item.path);
    }
    setSelectedFolder(item.isDir ? item.path : item.path.substring(0, item.path.lastIndexOf('/')));
    setTreeContextMenu({
      visible: true,
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 300),
      item
    });
  };

  // Right-click context menu on file tab
  const handleTabContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu({
      visible: true,
      x: Math.min(e.clientX, window.innerWidth - 200),
      y: Math.min(e.clientY, window.innerHeight - 200),
      tabId
    });
  };

  useEffect(() => {
    const closeMenus = () => {
      setTreeContextMenu(prev => ({ ...prev, visible: false }));
      setTabContextMenu(prev => ({ ...prev, visible: false }));
      setTermContextMenu(null);
    };
    window.addEventListener('click', closeMenus);
    return () => window.removeEventListener('click', closeMenus);
  }, []);

  // Recursive Tree Component
  const renderTree = (items: TreeItem[], depth = 0) => {
    return items.map(item => {
      const isSelected = selectedTreePaths.has(item.path) || selectedTreePath === item.path || activeFile?.remotePath === item.path;
      return (
        <div key={item.path}>
          <div
            onClick={(e) => handleItemClick(item, e)}
            onContextMenu={(e) => handleTreeContextMenu(e, item)}
            style={{ paddingLeft: `${depth * 14 + 10}px` }}
            className={`py-1 pr-2 flex items-center justify-between text-xs cursor-pointer transition-colors group select-none ${
              item.loading ? 'cursor-mac-wait opacity-75' : ''
            } ${
              clipboardItems?.mode === 'cut' && clipboardItems.paths.includes(item.path)
                ? 'opacity-40 italic'
                : ''
            } ${
              isSelected
                ? 'bg-blue-600/30 text-blue-200 font-medium border-l-2 border-blue-500'
                : 'text-gray-300 hover:bg-white/5'
            }`}
          >
            <div className="flex items-center space-x-1.5 truncate">
              {item.isDir ? (
                <>
                  {item.loading ? (
                    <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
                  ) : item.isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  )}
                  <Folder className={`w-3.5 h-3.5 shrink-0 ${item.isOpen ? 'text-blue-400' : 'text-amber-400'}`} />
                </>
              ) : (
                <>
                  <span className="w-3.5 shrink-0" />
                  {isMediaFile(item.name) ? (
                    <Eye className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <File className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-400 shrink-0" />
                  )}
                </>
              )}
              <span className="truncate">{item.name}</span>
            </div>
          </div>
          {item.isDir && item.isOpen && item.children && (
            <div>{renderTree(item.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  const breadcrumbs = activeFile?.remotePath ? activeFile.remotePath.split('/').filter(Boolean) : [];

  // Command Palette Items
  const commandsList = useMemo(() => [
    { title: 'File: Save Active File', shortcut: '⌘S / Ctrl+S', action: () => handleSave() },
    { title: 'File: Save All Modified Files', shortcut: 'Ctrl+Shift+S', action: () => handleSaveAll() },
    { title: 'File: New Untitled Document', shortcut: 'Ctrl+N', action: () => newUntitledFile() },
    { title: 'File: Close Active Editor', shortcut: 'Ctrl+W', action: () => activeFile?.id && requestCloseTab(activeFile.id) },
    { title: 'View: Toggle Word Wrap', shortcut: 'Alt+Z', action: () => setWordWrap(w => w === 'on' ? 'off' : 'on') },
    { title: 'View: Zoom In Font Size', shortcut: 'Ctrl++', action: () => setFontSize(s => Math.min(32, s + 1)) },
    { title: 'View: Zoom Out Font Size', shortcut: 'Ctrl+-', action: () => setFontSize(s => Math.max(9, s - 1)) },
    { title: 'View: Toggle Integrated Terminal', shortcut: 'Ctrl+`', action: () => setShowTerminal(p => !p) },
    { title: 'View: Toggle Split Editor', shortcut: '', action: () => setIsSplitEditor(p => !p) },
    { title: 'View: Toggle Primary Sidebar', shortcut: 'Ctrl+B', action: () => setSidebarOpen(p => !p) },
    { title: 'View: Switch to Explorer', shortcut: 'Ctrl+Shift+E', action: () => { setActiveSidebarTab('explorer'); setSidebarOpen(true); } },
    { title: 'View: Switch to Source Control (Git)', shortcut: 'Ctrl+Shift+G', action: () => { setActiveSidebarTab('git'); setSidebarOpen(true); fetchGitData(); } },
    { title: 'Preferences: Monokai Theme', shortcut: '', action: () => setEditorTheme('monokai') },
    { title: 'Preferences: Dracula Theme', shortcut: '', action: () => setEditorTheme('dracula') },
    { title: 'Preferences: One Dark Pro Theme', shortcut: '', action: () => setEditorTheme('one-dark-pro') },
    { title: 'Preferences: GitHub Dark Theme', shortcut: '', action: () => setEditorTheme('github-dark') },
    { title: 'Preferences: Catppuccin Mocha Theme', shortcut: '', action: () => setEditorTheme('catppuccin-mocha') },
    { title: 'Change Language Mode (Syntax Highlighting)', shortcut: 'Ctrl+K M', action: () => setIsLanguagePickerOpen(true) },
    { title: 'Terminal: Add New Bash Terminal in Current Folder', shortcut: '', action: () => addNewTerminal() },
  ], [handleSave, handleSaveAll, activeFile, addNewTerminal]);

  return (
    <div className={`flex h-full bg-[#1e1e2e] text-[#cdd6f4] font-sans antialiased overflow-hidden select-none relative ${loading || loadingTree || loadingAction ? 'cursor-mac-wait' : ''}`}>
      {/* Top Animated Loading Bar */}
      {(loading || loadingTree || loadingAction) && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-50 pointer-events-none" />
      )}

      {/* ─── 1. VS Code Left Activity Bar ─────────────────────────────── */}
      <div className="w-12 bg-[#14141e] border-r border-white/[0.08] flex flex-col items-center py-2 shrink-0 select-none z-20">
        <div className="flex flex-col items-center space-y-1 w-full">
          {/* Explorer */}
          <button
            onClick={() => {
              if (activeSidebarTab === 'explorer' && sidebarOpen) {
                setSidebarOpen(false);
              } else {
                setActiveSidebarTab('explorer');
                setSidebarOpen(true);
              }
            }}
            title="Explorer (Ctrl+Shift+E)"
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
              sidebarOpen && activeSidebarTab === 'explorer'
                ? 'text-white border-l-2 border-blue-500 bg-white/10'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Folder className="w-5 h-5" />
          </button>

          {/* Source Control (Git) */}
          <button
            onClick={() => {
              if (activeSidebarTab === 'git' && sidebarOpen) {
                setSidebarOpen(false);
              } else {
                setActiveSidebarTab('git');
                setSidebarOpen(true);
                fetchGitData();
              }
            }}
            title="Source Control (Ctrl+Shift+G)"
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all relative ${
              sidebarOpen && activeSidebarTab === 'git'
                ? 'text-white border-l-2 border-blue-500 bg-white/10'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <GitBranch className="w-5 h-5" />
            {gitStatusFiles.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-blue-600 text-[10px] font-bold text-white flex items-center justify-center">
                {gitStatusFiles.length}
              </span>
            )}
          </button>

          {/* Integrated Bash Terminal Drawer Toggle */}
          <button
            onClick={() => setShowTerminal(prev => !prev)}
            title="Integrated Terminal (Ctrl+`)"
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
              showTerminal
                ? 'text-emerald-400 bg-emerald-500/20'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <TerminalSquare className="w-5 h-5" />
          </button>
        </div>

        {/* Bottom Activity Icons */}
        <div className="mt-auto flex flex-col items-center space-y-1 w-full">
          {/* Command Palette Trigger */}
          <button
            onClick={() => setShowCommandPalette(true)}
            title="Command Palette (F1 / Ctrl+Shift+P)"
            className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 transition-all"
          >
            <Command className="w-4 h-4" />
          </button>

          {/* Settings */}
          <button
            onClick={() => {
              if (activeSidebarTab === 'settings' && sidebarOpen) {
                setSidebarOpen(false);
              } else {
                setActiveSidebarTab('settings');
                setSidebarOpen(true);
              }
            }}
            title="Editor Preferences & Themes"
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
              sidebarOpen && activeSidebarTab === 'settings'
                ? 'text-white bg-white/10'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ─── 2. VS Code Primary Sidebar (Resizable Width) ─────────────── */}
      {sidebarOpen && (
        <div
          style={{ width: `${sidebarWidth}px` }}
          className="bg-[#181825] border-r border-white/[0.08] flex flex-col shrink-0 select-none z-10 relative"
        >
          {/* Sidebar: Explorer */}
          {activeSidebarTab === 'explorer' && (
            <>
              {/* Explorer Header */}
              <div className="p-3 border-b border-white/[0.08] flex items-center justify-between">
                <span className="font-bold text-xs uppercase tracking-wider text-gray-300">Explorer</span>
                <div className="flex items-center space-x-1">
                  <button
                    onClick={() => openCreateDialog('file')}
                    title={`New File in '${selectedFolder}'`}
                    className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
                  >
                    <FilePlus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => openCreateDialog('folder')}
                    title={`New Folder in '${selectedFolder}'`}
                    className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      const toDel = selectedTreePaths.size > 0 ? Array.from(selectedTreePaths) : selectedTreePath ? [selectedTreePath] : [];
                      if (toDel.length > 0) openDeleteDialog(toDel);
                    }}
                    disabled={selectedTreePaths.size === 0 && !selectedTreePath}
                    title="Delete Selected Item(s)"
                    className="p-1 rounded text-gray-400 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-30"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => refreshProjectTree()}
                    disabled={loadingTree}
                    title="Refresh Project Tree"
                    className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingTree ? 'animate-spin text-blue-400' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Workspace Root Directory Input */}
              <div className="p-2 border-b border-white/[0.08] bg-[#11111b]/40">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    Workspace Root
                  </label>
                  <button
                    onClick={() => refreshProjectTree(workspaceInput)}
                    className="text-[10px] text-blue-400 hover:underline"
                  >
                    Open
                  </button>
                </div>
                <input
                  type="text"
                  value={workspaceInput}
                  onChange={e => setWorkspaceInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && refreshProjectTree(workspaceInput)}
                  placeholder="e.g. /home/username or /var/www"
                  className="w-full bg-[#11111b] border border-white/10 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
                <div className="mt-1 text-[10px] text-gray-500 truncate">
                  Active folder: <strong className="text-gray-300">{selectedFolder.split('/').pop() || '/'}</strong>
                </div>
              </div>

              {/* Directory Tree with Arrow Keys Navigation */}
              <div
                ref={treeContainerRef}
                tabIndex={0}
                onKeyDown={handleTreeKeyDown}
                className="flex-1 overflow-y-auto py-1 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-blue-500/30"
              >
                {treeItems.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-xs">
                    {loadingTree ? 'Scanning workspace via SFTP...' : 'Folder empty or unreadable'}
                  </div>
                ) : (
                  renderTree(treeItems)
                )}
              </div>
            </>
          )}

          {/* Sidebar: Source Control (Git) */}
          {activeSidebarTab === 'git' && (
            <div className="flex-1 flex flex-col p-3 overflow-hidden text-xs">
              {/* Git Header */}
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold text-xs uppercase tracking-wider text-gray-300">Source Control</span>
                {isGitRepo && (
                  <div className="flex items-center space-x-1">
                    <button onClick={fetchGitData} disabled={gitRunning} title="Refresh Git Status" className="p-1 rounded text-gray-400 hover:text-white">
                      <RefreshCw className={`w-3.5 h-3.5 ${gitRunning ? 'animate-spin text-blue-400' : ''}`} />
                    </button>
                    <button onClick={handleGitPull} disabled={gitRunning} title="Pull Changes (git pull)" className="p-1 rounded text-gray-400 hover:text-white">
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={stageAllGitFiles} disabled={gitRunning} title="Stage All Changes" className="p-1 rounded text-gray-400 hover:text-white">
                      <CheckSquare className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={unstageAllGitFiles} disabled={gitRunning} title="Unstage All Changes" className="p-1 rounded text-gray-400 hover:text-white">
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {!isGitRepo ? (
                /* Not a Git Repository: Show Initialize Repo Button */
                <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                  <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-3">
                    <GitBranch className="w-6 h-6" />
                  </div>
                  <h4 className="text-xs font-bold text-white mb-1">No Git Repository</h4>
                  <p className="text-[11px] text-gray-400 mb-4 max-w-xs leading-relaxed">
                    The folder <strong className="text-gray-300 font-mono">{projectRoot}</strong> is not currently a Git repository.
                  </p>
                  <button
                    onClick={handleGitInit}
                    disabled={gitRunning}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md flex items-center justify-center gap-1.5 transition-all"
                  >
                    {gitRunning ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>Initialize Repository (git init)</span>
                  </button>
                </div>
              ) : (
                <>
                  {/* Branch Selector Dropdown */}
                  <div className="relative mb-3">
                    <button
                      onClick={() => setShowBranchMenu(prev => !prev)}
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#11111b] border border-white/10 flex items-center justify-between text-xs font-mono text-blue-400"
                    >
                      <div className="flex items-center space-x-1.5 truncate">
                        <GitBranch className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{currentBranch}</span>
                      </div>
                      <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                    </button>

                    {showBranchMenu && (
                      <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-[#14141e] border border-white/15 rounded-xl shadow-2xl p-2 font-mono">
                        <div className="text-[10px] uppercase font-bold text-gray-400 px-1 mb-1">Switch Branch</div>
                        <div className="max-h-32 overflow-y-auto space-y-1 mb-2">
                          {branchesList.map(b => (
                            <div
                              key={b}
                              onClick={() => switchGitBranch(b)}
                              className={`px-2 py-1 rounded text-xs cursor-pointer flex items-center justify-between ${b === currentBranch ? 'bg-blue-600/30 text-blue-400 font-bold' : 'hover:bg-white/5 text-gray-300'}`}
                            >
                              <span className="truncate">{b}</span>
                              {b === currentBranch && <Check className="w-3 h-3 text-blue-400" />}
                            </div>
                          ))}
                        </div>
                        <div className="pt-2 border-t border-white/10 flex gap-1">
                          <input
                            type="text"
                            placeholder="New branch..."
                            value={newBranchInput}
                            onChange={e => setNewBranchInput(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && createGitBranch()}
                            className="flex-1 bg-[#11111b] border border-white/10 rounded px-1.5 py-0.5 text-xs text-white"
                          />
                          <button onClick={createGitBranch} className="px-2 py-0.5 bg-blue-600 rounded text-xs text-white">Create</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Commit Input Area */}
                  <div className="mb-3 space-y-1.5">
                    <textarea
                      rows={2}
                      value={gitCommitMsg}
                      onChange={e => setGitCommitMsg(e.target.value)}
                      placeholder="Commit message (Enter to commit)..."
                      className="w-full bg-[#11111b] border border-white/10 rounded-lg p-2 text-xs text-white focus:outline-none focus:border-blue-500 resize-none font-mono"
                    />
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleGitCommit(false)}
                        disabled={gitRunning || !gitCommitMsg.trim()}
                        className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1"
                      >
                        <GitCommit className="w-3.5 h-3.5" />
                        <span>Commit</span>
                      </button>
                      <button
                        onClick={() => handleGitCommit(true)}
                        disabled={gitRunning || !gitCommitMsg.trim()}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1"
                        title="Commit & Push to Remote"
                      >
                        <GitPullRequest className="w-3.5 h-3.5" />
                        <span>Push</span>
                      </button>
                    </div>
                  </div>

                  {/* Toggle Git Section: Changes vs History */}
                  <div className="flex border-b border-white/10 mb-2">
                    <button
                      onClick={() => setGitSection('status')}
                      className={`flex-1 py-1 text-center font-bold text-[11px] uppercase tracking-wider ${gitSection === 'status' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}`}
                    >
                      Changes ({gitStatusFiles.length})
                    </button>
                    <button
                      onClick={() => setGitSection('history')}
                      className={`flex-1 py-1 text-center font-bold text-[11px] uppercase tracking-wider ${gitSection === 'history' ? 'text-blue-400 border-b-2 border-blue-500' : 'text-gray-400 hover:text-white'}`}
                    >
                      History
                    </button>
                  </div>

                  {/* Changes List */}
                  {gitSection === 'status' && (
                    <div className="flex-1 overflow-y-auto space-y-1 font-mono text-xs">
                      {gitStatusFiles.length === 0 ? (
                        <div className="text-gray-500 text-center py-6 text-xs">
                          Working tree is clean. No changed files.
                        </div>
                      ) : (
                        gitStatusFiles.map(gf => (
                          <div
                            key={gf.path}
                            className="p-1.5 rounded bg-white/[0.03] hover:bg-white/[0.08] flex items-center justify-between group"
                          >
                            <div
                              onClick={() => openGitDiff(gf.path)}
                              title="Click to view diff"
                              className="flex items-center space-x-1.5 truncate cursor-pointer flex-1"
                            >
                              <span className={`font-bold px-1 rounded text-[10px] ${
                                gf.status === 'M' ? 'bg-amber-500/20 text-amber-400' :
                                gf.status === 'A' || gf.status === '?' ? 'bg-emerald-500/20 text-emerald-400' :
                                'bg-rose-500/20 text-rose-400'
                              }`}>
                                {gf.status}
                              </span>
                              <span className="truncate text-gray-300">{gf.path}</span>
                            </div>
                            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => openPathInEditor(`${projectRoot}/${gf.path}`)}
                                title="Open file in editor"
                                className="p-0.5 rounded text-gray-400 hover:text-white"
                              >
                                <FileCode className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => discardGitFile(gf.path)}
                                title="Discard changes"
                                className="p-0.5 rounded text-gray-400 hover:text-rose-400"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                              {gf.staged ? (
                                <button
                                  onClick={() => unstageGitFile(gf.path)}
                                  title="Unstage change"
                                  className="p-0.5 rounded text-gray-400 hover:text-white"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => stageGitFile(gf.path)}
                                  title="Stage change"
                                  className="p-0.5 rounded text-gray-400 hover:text-white"
                                >
                                  <Plus className="w-3 h-3 text-emerald-400" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {/* History View */}
                  {gitSection === 'history' && (
                    <div className="flex-1 overflow-y-auto space-y-2 font-mono text-xs">
                      {gitLog.length === 0 ? (
                        <div className="text-gray-500 text-center py-6">No commit history found</div>
                      ) : (
                        gitLog.map((logLine, idx) => (
                          <div key={idx} className="p-2 rounded bg-white/[0.03] text-[11px] text-gray-300 leading-relaxed border border-white/5">
                            {logLine}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Sidebar: Preferences & Themes */}
          {activeSidebarTab === 'settings' && (
            <div className="flex-1 p-3 overflow-y-auto space-y-4 text-xs">
              <span className="font-bold text-xs uppercase tracking-wider text-gray-300 block mb-2">Editor Preferences</span>

              <div>
                <label className="text-gray-400 block mb-1">Color Theme</label>
                <select
                  value={editorTheme}
                  onChange={e => setEditorTheme(e.target.value)}
                  className="w-full bg-[#11111b] border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="monokai">Monokai (Classic)</option>
                  <option value="dracula">Dracula</option>
                  <option value="one-dark-pro">One Dark Pro</option>
                  <option value="github-dark">GitHub Dark</option>
                  <option value="catppuccin-mocha">Catppuccin Mocha</option>
                  <option value="vs-dark">Visual Studio Dark</option>
                  <option value="vs">Visual Studio Light</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-gray-400">Font Size ({fontSize}px)</label>
                  <span className="text-[10px] text-gray-500">Ctrl + / Ctrl -</span>
                </div>
                <input
                  type="range"
                  min="9"
                  max="32"
                  value={fontSize}
                  onChange={e => {
                    const next = parseInt(e.target.value, 10);
                    setFontSize(next);
                    localStorage.setItem('sshdesktop_editor_fontsize', String(next));
                  }}
                  className="w-full"
                />
              </div>

              <div>
                <label className="text-gray-400 block mb-1">Tab Size</label>
                <div className="flex gap-2">
                  {[2, 4, 8].map(sz => (
                    <button
                      key={sz}
                      onClick={() => setTabSize(sz)}
                      className={`px-3 py-1 rounded text-xs font-mono ${tabSize === sz ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400'}`}
                    >
                      {sz} spaces
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                <div>
                  <span className="text-gray-300 block">Word Wrap</span>
                  <span className="text-[10px] text-gray-500 font-mono">Alt + Z</span>
                </div>
                <button
                  onClick={() => setWordWrap(wordWrap === 'on' ? 'off' : 'on')}
                  className={`px-2 py-0.5 rounded text-xs font-mono ${wordWrap === 'on' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400'}`}
                >
                  {wordWrap.toUpperCase()}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-300">Minimap</span>
                <button
                  onClick={() => setMinimapEnabled(!minimapEnabled)}
                  className={`px-2 py-0.5 rounded text-xs font-mono ${minimapEnabled ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400'}`}
                >
                  {minimapEnabled ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-gray-300">Line Numbers</span>
                <button
                  onClick={() => setLineNumbers(lineNumbers === 'on' ? 'off' : 'on')}
                  className={`px-2 py-0.5 rounded text-xs font-mono ${lineNumbers === 'on' ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400'}`}
                >
                  {lineNumbers.toUpperCase()}
                </button>
              </div>
            </div>
          )}

          {/* Draggable Divider Handle between Sidebar and Editor */}
          <div
            onMouseDown={startSidebarResize}
            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-500/50 transition-colors z-30"
            title="Drag to resize sidebar width"
          />
        </div>
      )}

      {/* ─── 3. Main Editor Area & Split Canvas ───────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#1e1e2e]">
        {/* Tab Bar (Cleaned up VS Code style without save/lang dropdown/terminal buttons) */}
        <div className="h-9 bg-[#181825] border-b border-white/[0.08] px-2 flex items-center justify-between shrink-0 select-none overflow-x-auto no-scrollbar gap-2">
          {/* File Tabs */}
          <div className="flex items-center space-x-1 overflow-x-auto scrollbar-none flex-1">
            {files.map(file => (
              <div
                key={file.id}
                onClick={() => setActiveFileId(file.id)}
                onContextMenu={(e) => handleTabContextMenu(e, file.id)}
                className={`flex items-center space-x-2 px-3 py-1 rounded-t-md text-xs font-mono transition-colors cursor-pointer group shrink-0 ${
                  activeFile?.id === file.id
                    ? 'bg-[#1e1e2e] text-blue-400 font-medium border-t-2 border-blue-500'
                    : 'text-gray-400 hover:bg-white/5 hover:text-gray-200'
                }`}
              >
                {file.isMedia ? (
                  <Eye className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                )}
                <span className="truncate max-w-[130px]">{file.name}</span>
                {file.isModified && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />}
                
                {/* Close Tab Button */}
                <button
                  onClick={(e) => requestCloseTab(file.id, e)}
                  title="Close tab (Ctrl+W)"
                  className="p-0.5 rounded hover:bg-white/20 text-gray-400 hover:text-white transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}

            <button
              onClick={newUntitledFile}
              className="p-1 hover:bg-white/10 rounded text-gray-400 hover:text-white shrink-0 ml-1"
              title="New Tab (Ctrl+N)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Top Right Tools: Save & Split Editor */}
          <div className="flex items-center space-x-1.5 shrink-0 ml-2">
            {activeFile && !activeFile.isMedia && (
              <button
                onClick={() => handleSave()}
                disabled={loading || !activeFile.isModified}
                className={`px-2.5 py-1 rounded-md text-xs font-mono flex items-center space-x-1.5 transition-all shadow-sm ${
                  savedSuccess
                    ? 'bg-emerald-600/90 text-white font-medium'
                    : activeFile.isModified
                    ? 'bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer shadow-blue-500/20 shadow-md'
                    : 'bg-white/5 text-gray-400 hover:text-gray-200 hover:bg-white/10 opacity-70 cursor-default'
                }`}
                title={activeFile.isModified ? "Save File (Ctrl+S)" : "File is saved"}
              >
                {loading && loadingAction?.includes('Saving') ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />
                ) : savedSuccess ? (
                  <Check className="w-3.5 h-3.5 text-white" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span className="hidden sm:inline">
                  {savedSuccess ? 'Saved' : 'Save'}
                </span>
              </button>
            )}

            <button
              onClick={() => {
                setIsSplitEditor(prev => !prev);
                if (!isSplitEditor && files.length > 1 && !splitActiveFileId) {
                  setSplitActiveFileId(files[1].id);
                }
              }}
              className={`p-1.5 rounded text-xs transition-colors ${
                isSplitEditor ? 'bg-blue-600/30 text-blue-400' : 'text-gray-400 hover:text-white hover:bg-white/10'
              }`}
              title="Split Editor Right (Side by Side View)"
            >
              <Columns2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Breadcrumb Navigation Bar */}
        {activeFile && (
          <div className="h-6 bg-[#181825]/60 border-b border-white/[0.04] px-4 flex items-center space-x-1 text-[11px] font-mono text-gray-400 shrink-0">
            <span className="text-gray-500">{activeConn?.name || 'Remote Server'}</span>
            <span>›</span>
            {breadcrumbs.map((segment, idx) => (
              <React.Fragment key={idx}>
                <span className={idx === breadcrumbs.length - 1 ? 'text-gray-200 font-medium' : 'text-gray-400'}>
                  {segment}
                </span>
                {idx < breadcrumbs.length - 1 && <span className="text-gray-600">›</span>}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* Global Error Banner */}
        {error && (
          <div className="bg-rose-500/15 border-b border-rose-500/30 px-3 py-2 text-xs text-rose-300 flex items-center justify-between z-20">
            <div className="flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span className="font-mono">{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-gray-400 hover:text-white px-2 py-0.5">✕</button>
          </div>
        )}

        {/* Main Editor Canvas / Welcome Screen / Media Previewer */}
        <div
          className="flex-1 overflow-hidden relative flex"
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setIsDragOver(false);
            const rawText = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('application/sshdesktop-file') || e.dataTransfer.getData('application/clouddesk-file');
            if (rawText && rawText.startsWith('/')) {
              await openPathInEditor(rawText.trim());
            }
          }}
        >
          {isDragOver && (
            <div className="absolute inset-0 bg-blue-500/20 backdrop-blur-sm border-2 border-dashed border-blue-400 z-30 flex flex-col items-center justify-center pointer-events-none">
              <Upload className="w-10 h-10 text-blue-300 animate-bounce mb-2" />
              <span className="text-sm font-semibold text-white">Drop file to open in VS Code Studio</span>
            </div>
          )}

          {!activeFile ? (
            /* VS Code Welcome / Empty Screen */
            <div className="flex-1 h-full flex flex-col items-center justify-center p-8 bg-[#1e1e2e] text-center select-none">
              <div className="w-16 h-16 rounded-2xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center mb-4 text-blue-400 shadow-lg shadow-blue-500/5">
                <Code2 className="w-8 h-8" />
              </div>
              <h2 className="text-base font-bold text-white mb-1">Visual Studio Code Remote Studio</h2>
              <p className="text-xs text-gray-400 max-w-md mb-6">
                Connected to <strong className="text-blue-400 font-mono">{activeConn?.name || activeConn?.host || 'Linux Server'}</strong> via secure SFTP.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg w-full text-left">
                {/* Start Actions */}
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-3">Start</span>
                  <div className="space-y-2 text-xs">
                    <button
                      onClick={newUntitledFile}
                      className="flex items-center space-x-2 text-blue-400 hover:text-blue-300 transition-colors w-full text-left"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>New Document (Ctrl+N)</span>
                    </button>
                    <button
                      onClick={() => openCreateDialog('file')}
                      className="flex items-center space-x-2 text-blue-400 hover:text-blue-300 transition-colors w-full text-left"
                    >
                      <FilePlus className="w-3.5 h-3.5" />
                      <span>Create File in Folder</span>
                    </button>
                    <button
                      onClick={() => setShowQuickOpen(true)}
                      className="flex items-center space-x-2 text-blue-400 hover:text-blue-300 transition-colors w-full text-left"
                    >
                      <FileSearch className="w-3.5 h-3.5" />
                      <span>Quick Open (Ctrl+P)</span>
                    </button>
                    <button
                      onClick={() => setShowTerminal(true)}
                      className="flex items-center space-x-2 text-blue-400 hover:text-blue-300 transition-colors w-full text-left"
                    >
                      <TerminalSquare className="w-3.5 h-3.5" />
                      <span>Open Integrated Terminal (Ctrl+`)</span>
                    </button>
                  </div>
                </div>

                {/* Recent Files */}
                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-3">Recent Files</span>
                  {recentFiles.length === 0 ? (
                    <span className="text-xs text-gray-500">No recently opened files</span>
                  ) : (
                    <div className="space-y-1.5 text-xs font-mono max-h-36 overflow-y-auto">
                      {recentFiles.slice(0, 6).map((rf, idx) => (
                        <div
                          key={idx}
                          onClick={() => openPathInEditor(rf)}
                          className="text-gray-300 hover:text-blue-400 cursor-pointer truncate flex items-center space-x-1.5"
                        >
                          <FileCode className="w-3 h-3 text-gray-500 shrink-0" />
                          <span className="truncate">{rf.split('/').pop()}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Shortcuts Cheat Sheet */}
              <div className="mt-8 flex flex-wrap justify-center items-center gap-6 text-[11px] text-gray-500 font-mono">
                <span>Save: <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-300">Ctrl+S</kbd></span>
                <span>Wrap: <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-300">Alt+Z</kbd></span>
                <span>Terminal: <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-300">Ctrl+`</kbd></span>
                <span>Zoom: <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-300">Ctrl + / -</kbd></span>
              </div>
            </div>
          ) : (
            /* Left Editor (or Single Editor) */
            <div className="flex-1 flex flex-col h-full overflow-hidden border-r border-white/5">
              {activeFile.isMedia ? (
                /* Rich Media Viewer (Images, Video, Audio, PDF) */
                <div className="flex-1 h-full flex flex-col items-center justify-center bg-[#14141e] p-4 overflow-auto relative">
                  {activeFile.mediaType === 'image' && (
                    <div className="flex flex-col items-center justify-center max-w-full max-h-full">
                      {/* Image Zoom Toolbar */}
                      <div className="absolute top-3 right-3 flex items-center space-x-1 bg-black/60 backdrop-blur-md border border-white/10 rounded-lg p-1 z-10">
                        <button
                          onClick={() => setMediaZoom(z => Math.max(0.2, z - 0.2))}
                          className="p-1 hover:bg-white/10 rounded text-gray-300 hover:text-white"
                          title="Zoom Out"
                        >
                          <ZoomOut className="w-3.5 h-3.5" />
                        </button>
                        <span className="text-[10px] font-mono px-1.5 text-gray-400">{Math.round(mediaZoom * 100)}%</span>
                        <button
                          onClick={() => setMediaZoom(z => Math.min(4, z + 0.2))}
                          className="p-1 hover:bg-white/10 rounded text-gray-300 hover:text-white"
                          title="Zoom In"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setMediaZoom(1)}
                          className="p-1 hover:bg-white/10 rounded text-gray-300 hover:text-white"
                          title="Reset Zoom"
                        >
                          <Maximize2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {activeFile.mediaUrl ? (
                        <div className="p-4 bg-[radial-gradient(#2a2a3e_1px,transparent_1px)] [background-size:16px_16px] rounded-xl border border-white/10 max-h-[80vh] overflow-auto flex items-center justify-center">
                          <img
                            src={activeFile.mediaUrl}
                            alt={activeFile.name}
                            style={{ transform: `scale(${mediaZoom})`, transformOrigin: 'center center' }}
                            className="max-h-[70vh] max-w-[80vw] object-contain rounded transition-transform duration-100 shadow-2xl"
                          />
                        </div>
                      ) : (
                        <div className="text-gray-400 text-xs">Loading image from server...</div>
                      )}
                      <div className="mt-3 text-xs text-gray-400 font-mono">
                        {activeFile.remotePath}
                      </div>
                    </div>
                  )}

                  {activeFile.mediaType === 'video' && (
                    <div className="flex flex-col items-center justify-center w-full h-full p-4">
                      {activeFile.mediaUrl ? (
                        <video
                          controls
                          src={activeFile.mediaUrl}
                          className="max-h-[75vh] max-w-[85vw] rounded-xl shadow-2xl border border-white/10 bg-black"
                        />
                      ) : (
                        <div className="text-gray-400 text-xs">Loading video stream from server...</div>
                      )}
                      <div className="mt-3 text-xs text-gray-400 font-mono">{activeFile.name}</div>
                    </div>
                  )}

                  {activeFile.mediaType === 'audio' && (
                    <div className="flex flex-col items-center justify-center p-8 bg-white/[0.03] border border-white/10 rounded-2xl">
                      <div className="text-sm font-semibold text-white mb-4">{activeFile.name}</div>
                      {activeFile.mediaUrl ? (
                        <audio controls src={activeFile.mediaUrl} className="w-80" />
                      ) : (
                        <div className="text-gray-400 text-xs">Loading audio...</div>
                      )}
                    </div>
                  )}

                  {activeFile.mediaType === 'pdf' && (
                    <div className="w-full h-full flex flex-col p-2">
                      {activeFile.mediaUrl ? (
                        <iframe
                          src={activeFile.mediaUrl}
                          className="w-full flex-1 rounded-xl border border-white/10 bg-white"
                          title={activeFile.name}
                        />
                      ) : (
                        <div className="text-gray-400 text-xs text-center py-12">Loading PDF...</div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Monaco Code Editor */
                <Editor
                  height="100%"
                  language={activeFile.language || 'plaintext'}
                  value={activeFile.content || ''}
                  theme={editorTheme}
                  onChange={(val) => {
                    if (val === undefined) return;
                    setFiles(prev =>
                      prev.map(f =>
                        f.id === activeFile.id ? { ...f, content: val, isModified: true } : f
                      )
                    );
                  }}
                  onMount={handleMonacoMount}
                  options={{
                    fontSize,
                    tabSize,
                    wordWrap,
                    lineNumbers,
                    minimap: { enabled: minimapEnabled },
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    cursorBlinking: 'smooth',
                    renderWhitespace: 'selection',
                    bracketPairColorization: { enabled: true },
                  }}
                />
              )}
            </div>
          )}

          {/* Right Split Editor (Side by Side View) */}
          {isSplitEditor && splitActiveFile && (
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              <div className="h-7 bg-[#14141e] border-b border-white/[0.08] px-3 flex items-center justify-between text-xs text-gray-300 select-none">
                <span className="font-mono text-[11px] truncate">{splitActiveFile.name}</span>
                <select
                  value={splitActiveFile.id}
                  onChange={e => setSplitActiveFileId(e.target.value)}
                  className="bg-[#11111b] border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono"
                >
                  {files.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 overflow-hidden">
                <Editor
                  height="100%"
                  language={splitActiveFile.language || 'plaintext'}
                  value={splitActiveFile.content || ''}
                  theme={editorTheme}
                  onChange={(val) => {
                    if (val === undefined) return;
                    setFiles(prev =>
                      prev.map(f =>
                        f.id === splitActiveFile.id ? { ...f, content: val, isModified: true } : f
                      )
                    );
                  }}
                  options={{
                    fontSize,
                    tabSize,
                    wordWrap,
                    lineNumbers,
                    minimap: { enabled: false },
                    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ─── 4. VS Code Integrated Multiple Terminals Drawer ───────── */}
        {/* KEPT CONTINUOUSLY MOUNTED IN DOM: Eliminates empty window on Ctrl+` close/reopen */}
        <div
          style={{ display: showTerminal ? 'flex' : 'none', height: '240px' }}
          className="bg-[#11111b] border-t border-white/10 flex-col shrink-0 z-20"
        >
          {/* Terminal Tab Bar & Controls */}
          <div className="h-8 bg-[#181825] px-2 flex items-center justify-between border-b border-white/[0.08] text-xs select-none">
            {/* Terminal Tabs */}
            <div className="flex items-center space-x-1 overflow-x-auto scrollbar-none flex-1">
              {terminals.map(term => {
                const isLeftActive = activeTermId === term.id;
                const isRightSplit = isSplitTerminal && splitTermId === term.id;
                return (
                  <div
                    key={term.id}
                    onClick={() => {
                      if (isSplitTerminal && isRightSplit) {
                        const inst = tabInstances.current.get(term.id);
                        try { inst?.term.focus(); } catch {}
                      } else {
                        setActiveTermId(term.id);
                        const inst = tabInstances.current.get(term.id);
                        try { inst?.term.focus(); } catch {}
                      }
                    }}
                    className={`px-2.5 py-1 rounded text-xs font-mono flex items-center space-x-1.5 cursor-pointer transition-colors ${
                      isLeftActive
                        ? 'bg-[#11111b] text-emerald-400 font-bold border-b border-emerald-400'
                        : isRightSplit
                        ? 'bg-[#11111b] text-cyan-400 font-bold border-b border-cyan-400'
                        : 'text-gray-400 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <TerminalIcon className={`w-3 h-3 shrink-0 ${isRightSplit ? 'text-cyan-400' : 'text-emerald-400'}`} />
                    <span className="truncate max-w-[120px]">{term.title}</span>
                    {isRightSplit && (
                      <span className="text-[9px] bg-cyan-500/20 text-cyan-300 px-1 rounded">Right</span>
                    )}
                    {terminals.length > 1 && (
                      <button
                        onClick={(e) => closeTerminal(term.id, e)}
                        className="hover:bg-white/20 p-0.5 rounded text-gray-500 hover:text-white"
                        title="Kill Terminal"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Add Bash Terminal Button */}
              <button
                onClick={() => addNewTerminal()}
                className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 ml-1"
                title="New Bash Terminal in Current Folder"
              >
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
              </button>
            </div>

            {/* Split Terminal & Close Controls */}
            <div className="flex items-center space-x-2 shrink-0 ml-2">
              <span className="text-[10px] text-gray-400 font-mono bg-white/5 px-2 py-0.5 rounded truncate max-w-xs">
                📁 {currentWorkingDir}
              </span>
              <button
                onClick={handleToggleSplitTerminal}
                className={`p-1 rounded transition-colors ${isSplitTerminal ? 'bg-emerald-500/20 text-emerald-400' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
                title={isSplitTerminal ? "Unsplit Terminal (Merge Panes)" : "Split Terminal Side by Side"}
              >
                <Columns2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => closeTerminal(activeTermId)}
                className="p-1 text-gray-400 hover:text-rose-400 hover:bg-white/5 rounded"
                title="Kill Current Terminal"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setShowTerminal(false)}
                className="p-1 text-gray-400 hover:text-white hover:bg-white/5 rounded"
                title="Close Terminal Panel (Ctrl+`)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Terminal Panes */}
          <div className="flex-1 overflow-hidden relative bg-[#11111b] flex">
            {/* Primary / Left Terminal Pane */}
            <div className="flex-1 h-full relative overflow-hidden flex flex-col">
              {isSplitTerminal && (
                <div className="h-6 bg-[#181825] border-b border-white/[0.08] px-2 flex items-center justify-between text-[11px] font-mono text-gray-400 select-none shrink-0">
                  <span className="flex items-center gap-1.5 text-emerald-400 font-semibold truncate">
                    <TerminalIcon className="w-3 h-3 text-emerald-400" />
                    <span>{terminals.find(t => t.id === activeTermId)?.title || 'Left Terminal'}</span>
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Pane 1</span>
                </div>
              )}
              <div className="flex-1 h-full relative overflow-hidden">
                {terminals
                  .filter(term => !isSplitTerminal || term.id !== splitTermId)
                  .map(term => {
                    const isActive = term.id === activeTermId;
                    return (
                      <div
                        key={term.id}
                        style={{ display: isActive ? 'block' : 'none' }}
                        className="w-full h-full p-2"
                        onContextMenu={(e) => handleTerminalContextMenu(e, term.id)}
                        ref={el => {
                          if (el) {
                            terminalContainers.current.set(term.id, el);
                            mountPtyTerminal(term.id, term.folder, el);
                          }
                        }}
                      />
                    );
                  })}
              </div>
            </div>

            {/* Split Secondary / Right Terminal Pane */}
            {isSplitTerminal && splitTermId && (
              <div className="flex-1 h-full relative overflow-hidden border-l border-white/10 flex flex-col">
                <div className="h-6 bg-[#181825] border-b border-white/[0.08] px-2 flex items-center justify-between text-[11px] font-mono text-gray-400 select-none shrink-0">
                  <div className="flex items-center gap-1.5 truncate">
                    <TerminalIcon className="w-3 h-3 text-cyan-400" />
                    {terminals.length > 2 ? (
                      <select
                        value={splitTermId}
                        onChange={e => {
                          const newSplitId = e.target.value;
                          setSplitTermId(newSplitId);
                          setTimeout(() => {
                            const inst = tabInstances.current.get(newSplitId);
                            try { inst?.fitAddon.fit(); } catch {}
                          }, 50);
                        }}
                        className="bg-transparent border-none text-cyan-400 font-semibold text-[11px] font-mono focus:outline-none cursor-pointer"
                      >
                        {terminals
                          .filter(t => t.id !== activeTermId)
                          .map(t => (
                            <option key={t.id} value={t.id} className="bg-[#181825] text-white">
                              {t.title}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <span className="text-cyan-400 font-semibold truncate">
                        {terminals.find(t => t.id === splitTermId)?.title || 'Right Terminal'}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-gray-500 font-mono mr-1">Pane 2</span>
                    <button
                      onClick={handleToggleSplitTerminal}
                      className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                      title="Close Split Terminal"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 h-full relative overflow-hidden">
                  {terminals
                    .filter(term => term.id === splitTermId)
                    .map(term => (
                      <div
                        key={`split-${term.id}`}
                        className="w-full h-full p-2"
                        onContextMenu={(e) => handleTerminalContextMenu(e, term.id)}
                        ref={el => {
                          if (el) {
                            terminalContainers.current.set(term.id, el);
                            mountPtyTerminal(term.id, term.folder, el);
                          }
                        }}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── 5. VS Code Bottom Status Bar ────────────────────────────── */}
        <div className="h-6 bg-[#14141e] border-t border-white/[0.08] px-3 flex items-center justify-between text-[11px] font-mono text-gray-400 shrink-0 select-none">
          <div className="flex items-center space-x-3 truncate">
            {isGitRepo ? (
              <button
                onClick={() => { setActiveSidebarTab('git'); setSidebarOpen(true); fetchGitData(); }}
                className="flex items-center gap-1 text-blue-400 hover:underline"
              >
                <GitBranch className="w-3 h-3" />
                <span>{currentBranch}</span>
              </button>
            ) : (
              <span className="text-gray-500 flex items-center gap-1">
                <GitBranch className="w-3 h-3" />
                <span>No Git Repo</span>
              </span>
            )}
            <span className="text-gray-400 truncate max-w-xs">
              SFTP: {activeFile?.remotePath || selectedFolder || projectRoot}
            </span>
            {loadingAction && (
              <span className="text-blue-400 flex items-center gap-1 animate-pulse">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                <span>{loadingAction}</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-4">
            <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
            <span>Spaces: {tabSize}</span>
            <span>Font: {fontSize}px</span>
            <span>Wrap: {wordWrap.toUpperCase()}</span>
            {/* Language Mode Selector Button */}
            <button
              onClick={() => setIsLanguagePickerOpen(true)}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-sans font-medium text-blue-400 hover:text-white hover:bg-blue-600/25 transition-all border border-blue-500/20 hover:border-blue-400/50 cursor-pointer shadow-sm group select-none"
              title="Select Language Mode (Change syntax highlighting) [Ctrl+K M]"
            >
              <Code2 className="w-3 h-3 text-blue-400 group-hover:scale-110 transition-transform" />
              <span className="truncate max-w-[140px]">
                {getLanguageDisplayName(activeFile?.language || 'plaintext')}
              </span>
              <ChevronDown className="w-2.5 h-2.5 text-blue-400/60 group-hover:text-blue-300 transition-colors" />
            </button>
            <span className={activeFile?.isModified ? 'text-amber-400 font-semibold' : 'text-emerald-400'}>
              {activeFile?.isModified ? '● Modified' : '✓ Clean'}
            </span>
            <button
              onClick={() => setShowTerminal(prev => !prev)}
              className="text-gray-400 hover:text-white flex items-center gap-1"
            >
              <TerminalIcon className="w-3 h-3" />
              <span>Terminal ({terminals.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* ─── 6. Context Menu on File Tree Items ──────────────────────── */}
      {treeContextMenu.visible && treeContextMenu.item && (
        <div
          style={{ top: treeContextMenu.y, left: treeContextMenu.x }}
          className="fixed z-50 w-52 bg-[#181825] border border-white/10 rounded-lg shadow-2xl py-1 text-xs font-sans text-gray-200 backdrop-blur-xl animate-in fade-in duration-100"
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] text-gray-400 font-mono truncate border-b border-white/10">
            {treeContextMenu.item.name}
          </div>

          {treeContextMenu.item.isDir && (
            <>
              <button
                onClick={() => {
                  openCreateDialog('file', treeContextMenu.item!.path);
                  setTreeContextMenu(prev => ({ ...prev, visible: false }));
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left transition-colors"
              >
                <FilePlus className="w-3.5 h-3.5 text-blue-400" />
                <span>New File Here</span>
              </button>
              <button
                onClick={() => {
                  openCreateDialog('folder', treeContextMenu.item!.path);
                  setTreeContextMenu(prev => ({ ...prev, visible: false }));
                }}
                className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
                <span>New Folder Here</span>
              </button>
              <div className="h-px bg-white/10 my-1" />
            </>
          )}

          {/* Copy & Cut */}
          <button
            onClick={() => handleCopyItems(selectedTreePaths.size > 0 ? Array.from(selectedTreePaths) : [treeContextMenu.item!.path])}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Copy className="w-3.5 h-3.5 text-blue-400" />
              <span>Copy</span>
            </div>
            <kbd className="text-[10px] text-gray-400 font-mono">Ctrl+C</kbd>
          </button>
          <button
            onClick={() => handleCutItems(selectedTreePaths.size > 0 ? Array.from(selectedTreePaths) : [treeContextMenu.item!.path])}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Scissors className="w-3.5 h-3.5 text-amber-400" />
              <span>Cut</span>
            </div>
            <kbd className="text-[10px] text-gray-400 font-mono">Ctrl+X</kbd>
          </button>

          {/* Paste */}
          {clipboardItems && (
            <button
              onClick={() => {
                const targetDir = treeContextMenu.item!.isDir ? treeContextMenu.item!.path : treeContextMenu.item!.path.substring(0, treeContextMenu.item!.path.lastIndexOf('/'));
                handlePasteItems(targetDir);
              }}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left transition-colors text-emerald-400 cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <Clipboard className="w-3.5 h-3.5" />
                <span>Paste ({clipboardItems.paths.length} items)</span>
              </div>
              <kbd className="text-[10px] text-emerald-300 font-mono">Ctrl+V</kbd>
            </button>
          )}

          <div className="h-px bg-white/10 my-1" />

          {/* Open Terminal Here - Strictly Opens at This Folder Location */}
          <button
            onClick={() => {
              const dir = treeContextMenu.item!.isDir
                ? treeContextMenu.item!.path
                : treeContextMenu.item!.path.substring(0, treeContextMenu.item!.path.lastIndexOf('/'));
              openTerminalAtFolder(dir);
              setTreeContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left transition-colors"
          >
            <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />
            <span>Open in Terminal Here</span>
          </button>

          <button
            onClick={() => {
              setRenameNewName(treeContextMenu.item!.name);
              setRenameModalError(null);
              setShowRenameModal(treeContextMenu.item);
              setTreeContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5 text-gray-400" />
            <span>Rename...</span>
          </button>

          <button
            onClick={() => {
              navigator.clipboard.writeText(treeContextMenu.item!.path);
              setTreeContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-blue-600 hover:text-white text-left transition-colors"
          >
            <Copy className="w-3.5 h-3.5 text-gray-400" />
            <span>Copy Path</span>
          </button>

          <div className="h-px bg-white/10 my-1" />

          <button
            onClick={() => {
              const toDel = selectedTreePaths.size > 0 ? Array.from(selectedTreePaths) : [treeContextMenu.item!.path];
              openDeleteDialog(toDel);
              setTreeContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 flex items-center gap-2 hover:bg-rose-600 hover:text-white text-rose-400 text-left transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      )}

      {/* ─── 7. Context Menu on File Tabs ───────────────────────────── */}
      {tabContextMenu.visible && (
        <div
          style={{ top: tabContextMenu.y, left: tabContextMenu.x }}
          className="fixed z-50 w-48 bg-[#181825] border border-white/10 rounded-lg shadow-2xl py-1 text-xs font-sans text-gray-200 backdrop-blur-xl animate-in fade-in duration-100"
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => {
              requestCloseTab(tabContextMenu.tabId);
              setTabContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left"
          >
            <span>Close Tab</span>
            <kbd className="text-[10px] text-gray-400">Ctrl+W</kbd>
          </button>
          <button
            onClick={() => {
              handleCloseOtherTabs(tabContextMenu.tabId);
              setTabContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 hover:bg-blue-600 hover:text-white text-left"
          >
            Close Other Tabs
          </button>
          <button
            onClick={() => {
              handleCloseTabsToRight(tabContextMenu.tabId);
              setTabContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 hover:bg-blue-600 hover:text-white text-left"
          >
            Close Tabs to the Right
          </button>
          <div className="h-px bg-white/10 my-1" />
          <button
            onClick={() => {
              handleCloseAllTabs();
              setTabContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full px-3 py-1.5 hover:bg-rose-600 hover:text-white text-rose-400 text-left"
          >
            Close All Tabs
          </button>
        </div>
      )}

      {/* ─── 8. Unsaved File Close Confirmation Modal ───────────────── */}
      {closeConfirmTab && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#181825] border border-white/15 rounded-2xl shadow-2xl p-5 text-center animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1">
              Do you want to save the changes you made to "{closeConfirmTab.name}"?
            </h3>
            <p className="text-xs text-gray-400 mb-5">
              Your changes will be lost if you close without saving.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button
                onClick={handleConfirmSaveAndClose}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition-all"
              >
                Save
              </button>
              <button
                onClick={() => performCloseTab(closeConfirmTab.id)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-rose-600 hover:text-white text-gray-300 text-xs font-semibold transition-all"
              >
                Don't Save
              </button>
              <button
                onClick={() => setCloseConfirmTab(null)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 text-xs font-semibold transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 9. Unsaved Application Window Close Alert Modal ─────────── */}
      {showAppCloseAlert && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#181825] border border-amber-500/30 rounded-2xl shadow-2xl p-6 text-center animate-in zoom-in-95 duration-150">
            <div className="w-14 h-14 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">
              Unsaved Changes in Code Editor
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              You have {files.filter(f => f.isModified).length} file(s) with unsaved changes. Closing now will discard them:
            </p>
            <div className="max-h-32 overflow-y-auto bg-black/30 rounded-lg p-2 mb-5 font-mono text-xs text-amber-300 text-left space-y-1">
              {files.filter(f => f.isModified).map(f => (
                <div key={f.id} className="truncate">• {f.name}</div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-2 justify-center">
              <button
                onClick={async () => {
                  await handleSaveAll();
                  const editorWin = windows.find(w => w.appId === 'editor');
                  if (editorWin) {
                    unregisterCloseInterceptor(editorWin.id);
                    closeWindow(editorWin.id);
                  }
                  setShowAppCloseAlert(false);
                }}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md"
              >
                Save All & Close
              </button>
              <button
                onClick={() => {
                  const editorWin = windows.find(w => w.appId === 'editor');
                  if (editorWin) {
                    unregisterCloseInterceptor(editorWin.id);
                    closeWindow(editorWin.id);
                  }
                  setShowAppCloseAlert(false);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-semibold shadow-md"
              >
                Discard & Close
              </button>
              <button
                onClick={() => setShowAppCloseAlert(false)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-gray-300 text-xs font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 10. New File / Folder Modal (Errors Shown Inside Modal) ─── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#181825] border border-white/15 rounded-2xl shadow-2xl p-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center space-x-2 mb-3">
              {showCreateModal === 'folder' ? (
                <FolderPlus className="w-5 h-5 text-amber-400" />
              ) : (
                <FilePlus className="w-5 h-5 text-blue-400" />
              )}
              <h3 className="text-sm font-bold text-white">
                Create New {showCreateModal === 'folder' ? 'Folder' : 'File'}
              </h3>
            </div>
            <p className="text-xs text-gray-400 mb-2 truncate">
              In: <strong className="text-gray-200 font-mono">{createTargetFolder}</strong>
            </p>

            {createModalError && (
              <div className="mb-3 p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="font-mono">{createModalError}</span>
              </div>
            )}

            <input
              type="text"
              autoFocus
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConfirmCreate()}
              placeholder={showCreateModal === 'folder' ? 'e.g. components' : 'e.g. server.py, index.html'}
              className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-500 mb-4"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowCreateModal(null)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmCreate}
                disabled={!newItemName.trim()}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 11. Rename Modal (Errors Shown Inside Modal) ───────────── */}
      {showRenameModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#181825] border border-white/15 rounded-2xl shadow-2xl p-5 animate-in zoom-in-95 duration-150">
            <h3 className="text-sm font-bold text-white mb-2">Rename Item</h3>
            <p className="text-xs text-gray-400 mb-2 truncate font-mono">{showRenameModal.path}</p>

            {renameModalError && (
              <div className="mb-3 p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="font-mono">{renameModalError}</span>
              </div>
            )}

            <input
              type="text"
              autoFocus
              value={renameNewName}
              onChange={e => setRenameNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConfirmRename()}
              className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-500 mb-4"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowRenameModal(null)}
                className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRename}
                disabled={!renameNewName.trim()}
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold"
              >
                Rename
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 12. Delete Modal (Errors Shown Inside Modal) ───────────── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#181825] border border-rose-500/20 rounded-2xl shadow-2xl p-5 text-center animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-3">
              <Trash2 className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-white mb-1">
              Delete {showDeleteModal.items.length === 1 ? 'Item' : `${showDeleteModal.items.length} Items`}?
            </h3>

            {deleteModalError ? (
              <div className="mb-4 p-2.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-xs text-rose-300 flex items-start gap-2 text-left">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <span className="font-mono">{deleteModalError}</span>
              </div>
            ) : (
              <div className="max-h-28 overflow-y-auto text-xs text-gray-400 mb-3 font-mono text-left bg-black/20 p-2 rounded">
                {showDeleteModal.items.map(p => (
                  <div key={p} className="truncate">• {p.split('/').pop()}</div>
                ))}
              </div>
            )}

            <p className="text-xs text-gray-500 mb-4">This operation cannot be undone on the remote server.</p>
            <div className="flex justify-center space-x-2">
              <button
                onClick={() => setShowDeleteModal(null)}
                className="px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 13. Git Diff Viewer Modal ──────────────────────────────── */}
      {gitDiffModal.visible && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-6" onClick={() => setGitDiffModal(prev => ({ ...prev, visible: false }))}>
          <div className="w-full max-w-3xl h-[75vh] bg-[#181825] border border-white/15 rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="h-10 bg-[#14141e] px-4 flex items-center justify-between border-b border-white/10">
              <span className="font-mono text-xs font-bold text-blue-400">git diff: {gitDiffModal.filePath}</span>
              <button onClick={() => setGitDiffModal(prev => ({ ...prev, visible: false }))} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4 font-mono text-xs whitespace-pre bg-[#11111b] select-text">
              {gitDiffModal.diff.split('\n').map((line, i) => {
                let colorClass = 'text-gray-300';
                if (line.startsWith('+')) colorClass = 'text-emerald-400 bg-emerald-500/10';
                else if (line.startsWith('-')) colorClass = 'text-rose-400 bg-rose-500/10';
                else if (line.startsWith('@@')) colorClass = 'text-blue-400 font-bold';
                return (
                  <div key={i} className={`px-2 py-0.5 rounded-sm ${colorClass}`}>
                    {line}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── 14. Quick Open File Modal (Ctrl+P) ─────────────────────── */}
      {showQuickOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-20 p-4" onClick={() => setShowQuickOpen(false)}>
          <div className="w-full max-w-md bg-[#181825] border border-white/15 rounded-xl shadow-2xl p-3 animate-in zoom-in-95 duration-100" onClick={e => e.stopPropagation()}>
            <div className="flex items-center space-x-2 pb-2 border-b border-white/10">
              <FileSearch className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                type="text"
                autoFocus
                placeholder="Search file by name to open..."
                value={quickOpenFilter}
                onChange={e => setQuickOpenFilter(e.target.value)}
                className="w-full bg-transparent border-none text-xs text-white font-mono focus:outline-none"
              />
              <span className="text-[10px] text-gray-500 font-mono">ESC</span>
            </div>
            <div className="max-h-64 overflow-y-auto pt-2 space-y-1">
              {recentFiles
                .filter(rf => rf.toLowerCase().includes(quickOpenFilter.toLowerCase()))
                .map(rf => (
                  <div
                    key={rf}
                    onClick={() => { openPathInEditor(rf); setShowQuickOpen(false); }}
                    className="p-2 rounded bg-white/[0.03] hover:bg-blue-600/20 cursor-pointer flex items-center justify-between text-xs font-mono"
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                      <span className="text-white font-semibold truncate">{rf.split('/').pop()}</span>
                      <span className="text-[10px] text-gray-500 truncate">{rf}</span>
                    </div>
                    <ArrowRight className="w-3 h-3 text-gray-500 shrink-0" />
                  </div>
                ))}
              {recentFiles.filter(rf => rf.toLowerCase().includes(quickOpenFilter.toLowerCase())).length === 0 && (
                <div className="text-gray-500 text-center py-4 text-xs font-mono">No matching files found</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── 15. VS Code Command Palette Modal (F1 / Ctrl+Shift+P) ──── */}
      {showCommandPalette && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-20 p-4" onClick={() => setShowCommandPalette(false)}>
          <div className="w-full max-w-lg bg-[#181825] border border-white/15 rounded-xl shadow-2xl p-3 animate-in zoom-in-95 duration-100" onClick={e => e.stopPropagation()}>
            <div className="flex items-center space-x-2 pb-2 border-b border-white/10">
              <Command className="w-4 h-4 text-blue-400 shrink-0" />
              <input
                type="text"
                autoFocus
                placeholder="Type a command to run..."
                value={paletteFilter}
                onChange={e => setPaletteFilter(e.target.value)}
                className="w-full bg-transparent border-none text-xs text-white font-mono focus:outline-none"
              />
              <span className="text-[10px] text-gray-500 font-mono">ESC</span>
            </div>
            <div className="max-h-64 overflow-y-auto pt-2 space-y-1">
              {commandsList
                .filter(c => c.title.toLowerCase().includes(paletteFilter.toLowerCase()))
                .map((cmd, idx) => (
                  <div
                    key={idx}
                    onClick={() => { cmd.action(); setShowCommandPalette(false); }}
                    className="p-2 rounded bg-white/[0.03] hover:bg-blue-600/20 cursor-pointer flex items-center justify-between text-xs font-mono"
                  >
                    <span className="text-gray-200">{cmd.title}</span>
                    {cmd.shortcut && (
                      <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-400 text-[10px]">{cmd.shortcut}</kbd>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── 16. Permission Denied Alert Dialog ─────────────────────── */}
      {permissionAlert && (
        <div 
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 select-none"
          onClick={() => setPermissionAlert(null)}
        >
          <div 
            className="bg-[#181a28] border border-rose-500/30 rounded-2xl max-w-md w-full shadow-2xl p-5 text-gray-200 flex flex-col space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start space-x-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white mb-1">
                  {permissionAlert.title}
                </h3>
                <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-sans">
                  {permissionAlert.message}
                </p>
                {permissionAlert.path && (
                  <div className="mt-2 text-[11px] font-mono bg-black/40 px-2.5 py-1.5 rounded-lg border border-white/10 text-rose-300 break-all select-text">
                    {permissionAlert.path}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end pt-2 border-t border-white/10">
              <button
                onClick={() => setPermissionAlert(null)}
                className="px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg transition-colors cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ─── 17. VS Code Select Language Mode Modal (Ctrl+K M) ───────── */}
      <LanguagePickerModal
        isOpen={isLanguagePickerOpen}
        currentLanguage={activeFile?.language || 'plaintext'}
        fileName={activeFile?.name}
        onSelectLanguage={handleSelectLanguage}
        onClose={() => setIsLanguagePickerOpen(false)}
      />

      {/* ─── 18. Terminal Right-Click Context Menu ───────────────────── */}
      {termContextMenu && (
        <div
          style={{ top: termContextMenu.y, left: termContextMenu.x }}
          className="fixed z-50 w-56 bg-[#181825] border border-white/10 rounded-lg shadow-2xl py-1 text-xs font-sans text-gray-200 backdrop-blur-xl animate-in fade-in duration-100 select-none"
          onClick={e => e.stopPropagation()}
        >
          {termContextMenu.hasSelection ? (
            <button
              onClick={handleTermCopy}
              className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left transition-colors cursor-pointer"
            >
              <div className="flex items-center space-x-2">
                <Copy className="w-3.5 h-3.5 text-blue-400" />
                <span>Copy Selection</span>
              </div>
              <kbd className="text-[10px] text-gray-400 font-mono">Ctrl+C</kbd>
            </button>
          ) : (
            <button
              disabled
              className="w-full px-3 py-1.5 flex items-center justify-between text-gray-500 text-left cursor-not-allowed opacity-50"
            >
              <div className="flex items-center space-x-2">
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </div>
              <span className="text-[10px] font-mono">Ctrl+C</span>
            </button>
          )}

          <button
            onClick={handleTermPaste}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <Clipboard className="w-3.5 h-3.5 text-emerald-400" />
              <span>Paste into Terminal</span>
            </div>
            <kbd className="text-[10px] text-gray-400 font-mono">Ctrl+V</kbd>
          </button>

          <button
            onClick={handleTermSelectAll}
            className="w-full px-3 py-1.5 flex items-center justify-between hover:bg-blue-600 hover:text-white text-left transition-colors cursor-pointer"
          >
            <div className="flex items-center space-x-2">
              <CheckSquare className="w-3.5 h-3.5 text-indigo-400" />
              <span>Select All</span>
            </div>
            <kbd className="text-[10px] text-gray-400 font-mono">Ctrl+A</kbd>
          </button>

          <div className="my-1 border-t border-white/10 mx-2" />

          <button
            onClick={handleTermClear}
            className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-blue-600 hover:text-white text-left transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-amber-400" />
            <span>Clear Screen (clear)</span>
          </button>

          <button
            onClick={handleTermReset}
            className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-blue-600 hover:text-white text-left transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Reset & Redraw</span>
          </button>

          <div className="my-1 border-t border-white/10 mx-2" />

          <button
            onClick={() => { addNewTerminal(); setTermContextMenu(null); }}
            className="w-full px-3 py-1.5 flex items-center space-x-2 hover:bg-blue-600 hover:text-white text-left transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>New Terminal Tab</span>
          </button>
        </div>
      )}

      {/* Copied Notice Toast */}
      {copiedNotice && (
        <div className="fixed bottom-12 right-6 bg-emerald-600 text-white px-3 py-1.5 rounded-lg shadow-2xl text-xs flex items-center space-x-2 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 select-none z-50">
          <Check className="w-3.5 h-3.5" />
          <span>Copied to clipboard!</span>
        </div>
      )}

      {/* Editor Toast Notification */}
      {editorToast && (
        <div className="fixed bottom-12 right-6 bg-[#181825] border border-blue-500/40 text-blue-200 px-3.5 py-2 rounded-lg shadow-2xl text-xs flex items-center space-x-2 backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 select-none z-50">
          <Check className="w-3.5 h-3.5 text-blue-400" />
          <span>{editorToast}</span>
        </div>
      )}
    </div>
  );
}
