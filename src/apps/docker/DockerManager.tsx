import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  Container, Layers, Play, Square, RotateCw, Trash2, 
  Terminal, Search, Plus, RefreshCw, AlertCircle, FileText,
  Pause, HardDrive, Network, Info, Copy, Check, ExternalLink,
  Activity, Cpu, Server, X, Shield, Download, ChevronRight,
  Filter, PlayCircle, Eye, EyeOff, Settings, ArrowDownToLine, Zap,
  CheckCircle2, AlertTriangle, HelpCircle, TerminalSquare,
  Lock, CheckSquare, Loader2, StopCircle, User, LogIn, LogOut,
  FileCode, Code2, FolderOpen, Save, Hammer, Wrench, CheckCheck,
  Maximize2, Minimize2, Upload, Columns, Rows, Tag, GitCommit, ZoomIn, ZoomOut, WrapText
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { listen } from '@tauri-apps/api/event';
import { 
  dockerContainers, dockerAction, dockerLogs, dockerImages, dockerImageRemove, 
  sshExec, sshExecStream, sshExecStop, sftpDownloadToDownloads 
} from '../../lib/tauri-bridge';
import { useConnectionStore, useEditorStore } from '../../lib/store';
import { useWindowManager } from '../../lib/hooks/useWindowManager';
import { useUserPrivilege } from '../../lib/permissions';
import PermissionAlertBanner from '../../components/PermissionAlertBanner';
import PermissionAlertModal from '../../components/PermissionAlertModal';
import { PortalContextMenu } from '../../components/PortalContextMenu';

export * from './types';
export * from './templates';
import { 
  ContainerItem, ImageItem, VolumeItem, NetworkItem, ContainerInspectData,
  DockerAuthInfo, SavedDockerCredential, ResourceDeleteTarget, ResourceInUseItem
} from './types';
import { DOCKERFILE_TEMPLATES, COMPOSE_TEMPLATES, POPULAR_IMAGES } from './templates';
import { DockerDeleteModal } from './components/DockerDeleteModal';
import { DockerInspectModal } from './components/DockerInspectModal';
import { DockerPruneModal } from './components/DockerPruneModal';
import { DockerVolumeCreateModal } from './components/DockerVolumeCreateModal';
import { DockerNetworkCreateModal } from './components/DockerNetworkCreateModal';
import { DockerTagModal } from './components/DockerTagModal';
import { DockerCommitModal } from './components/DockerCommitModal';
import { DockerPullModal } from './components/DockerPullModal';
import { DockerLogsModal } from './components/DockerLogsModal';
import { DockerRunModal } from './components/DockerRunModal';
import { DockerAuthModal } from './components/DockerAuthModal';
import { DockerCommandSnippet, DockerBuildOutputLine } from './components/DockerCodeViewer';

export default function DockerManager() {
  const [activeTab, setActiveTab] = useState<'containers' | 'images' | 'volumes' | 'networks' | 'editor' | 'system'>('containers');
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [volumes, setVolumes] = useState<VolumeItem[]>([]);
  const [networks, setNetworks] = useState<NetworkItem[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Unified Resource Delete Confirmation State
  const [resourceToDelete, setResourceToDelete] = useState<ResourceDeleteTarget | null>(null);
  const [isDeletingResource, setIsDeletingResource] = useState(false);

  // Table Row Keyboard & Click Selection State
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);

  // Docker Registry Auth & User State
  const [dockerAuth, setDockerAuth] = useState<DockerAuthInfo | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loginRegistry, setLoginRegistry] = useState('docker.io');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saveCredentials, setSaveCredentials] = useState(true);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [savedCredentialsList, setSavedCredentialsList] = useState<SavedDockerCredential[]>([]);

  // Create Volume Modal State
  const [showCreateVolumeModal, setShowCreateVolumeModal] = useState(false);
  const [volCreateName, setVolCreateName] = useState('');
  const [volCreateDriver, setVolCreateDriver] = useState('local');
  const [volCreateOpts, setVolCreateOpts] = useState('');
  const [volCreateLabels, setVolCreateLabels] = useState('');
  const [isSubmittingVol, setIsSubmittingVol] = useState(false);

  // Create Network Modal State
  const [showCreateNetworkModal, setShowCreateNetworkModal] = useState(false);
  const [netCreateName, setNetCreateName] = useState('');
  const [netCreateDriver, setNetCreateDriver] = useState('bridge');
  const [netCreateSubnet, setNetCreateSubnet] = useState('');
  const [netCreateGateway, setNetCreateGateway] = useState('');
  const [netCreateIpRange, setNetCreateIpRange] = useState('');
  const [netCreateInternal, setNetCreateInternal] = useState(false);
  const [netCreateAttachable, setNetCreateAttachable] = useState(false);
  const [netCreateIpv6, setNetCreateIpv6] = useState(false);
  const [isSubmittingNet, setIsSubmittingNet] = useState(false);

  // Docker Daemon Lifecycle & Installation State
  const [dockerDaemonState, setDockerDaemonState] = useState<'running' | 'stopped' | 'not_installed' | 'checking'>('checking');
  const [serviceActionLoading, setServiceActionLoading] = useState<string | null>(null);

  // Docker Editor State (Dockerfile & Docker Compose)
  const [editorMode, setEditorMode] = useState<'dockerfile' | 'compose'>('dockerfile');
  const [editorContent, setEditorContent] = useState<string>(DOCKERFILE_TEMPLATES.nodejs);
  const [editorPath, setEditorPath] = useState<string>('/tmp/docker-build');
  const [editorImageTag, setEditorImageTag] = useState<string>('my-app:latest');
  const [editorOutput, setEditorOutput] = useState<string>('');
  const [isEditorRunning, setIsEditorRunning] = useState(false);
  const [editorExitCode, setEditorExitCode] = useState<number | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('nodejs');
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false);
  const [editorLayout, setEditorLayout] = useState<'side-by-side' | 'stacked'>('side-by-side');
  const [editorSplitRatio, setEditorSplitRatio] = useState<number>(55);
  const [currentStreamId, setCurrentStreamId] = useState<string | null>(null);
  const currentStreamIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const monacoRegisteredRef = useRef<boolean>(false);
  const consoleOutputEndRef = useRef<HTMLDivElement>(null);

  // Monaco Editor Zoom & Word Wrap State (VS Code shortcuts)
  const [editorFontSize, setEditorFontSize] = useState<number>(13);
  const [editorWordWrap, setEditorWordWrap] = useState<'on' | 'off'>('on');
  const [consoleFontSize, setConsoleFontSize] = useState<number>(12);
  const [consoleWordWrap, setConsoleWordWrap] = useState<boolean>(true);

  // Tag Image Modal State
  const [showTagModal, setShowTagModal] = useState(false);
  const [tagTargetImage, setTagTargetImage] = useState<ImageItem | null>(null);
  const [tagNewRepo, setTagNewRepo] = useState('');
  const [tagNewTag, setTagNewTag] = useState('latest');
  const [isTagging, setIsTagging] = useState(false);

  // Commit Container Modal State
  const [showCommitModal, setShowCommitModal] = useState(false);
  const [commitTargetContainer, setCommitTargetContainer] = useState<ContainerItem | null>(null);
  const [commitRepo, setCommitRepo] = useState('');
  const [commitTag, setCommitTag] = useState('latest');
  const [commitMessage, setCommitMessage] = useState('');
  const [commitAuthor, setCommitAuthor] = useState('');
  const [commitPause, setCommitPause] = useState(true);
  const [isCommitting, setIsCommitting] = useState(false);

  // Local Image Download (.tar.gz) State
  const [downloadTargetImage, setDownloadTargetImage] = useState<ImageItem | null>(null);
  const [isDownloadingImage, setIsDownloadingImage] = useState(false);
  const [downloadStatusText, setDownloadStatusText] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Inspector State
  const [inspectTarget, setInspectTarget] = useState<ContainerItem | null>(null);
  const [inspectData, setInspectData] = useState<ContainerInspectData | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectTab, setInspectTab] = useState<'overview' | 'env' | 'ports' | 'mounts'>('overview');

  // Logs Modal State
  const [selectedLogs, setSelectedLogs] = useState<ContainerItem | null>(null);
  const [logsText, setLogsText] = useState<string>('');
  const [logsLines, setLogsLines] = useState<number>(100);
  const [logsFilter, setLogsFilter] = useState<string>('');
  const [logsCopied, setLogsCopied] = useState(false);
  const [logsAutoRefresh, setLogsAutoRefresh] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Run Container Modal State
  const [showRunModal, setShowRunModal] = useState(false);
  const [runImage, setRunImage] = useState('');
  const [runName, setRunName] = useState('');
  const [runPorts, setRunPorts] = useState('');
  const [runVolumes, setRunVolumes] = useState('');
  const [runEnv, setRunEnv] = useState('');
  const [runRestart, setRunRestart] = useState('unless-stopped');
  const [isSubmittingRun, setIsSubmittingRun] = useState(false);
  const [runModalError, setRunModalError] = useState<string | null>(null);

  // Pull Image Modal State
  const [showPullModal, setShowPullModal] = useState(false);
  const [pullImageInput, setPullImageInput] = useState('');
  const [isPulling, setIsPulling] = useState(false);
  const [pullLogs, setPullLogs] = useState('');

  // Exec Modal State
  const [execTarget, setExecTarget] = useState<ContainerItem | null>(null);
  const [execCmd, setExecCmd] = useState('');
  const [execOutput, setExecOutput] = useState('');
  const [isExecRunning, setIsExecRunning] = useState(false);

  // System Prune Modal
  const [showPruneModal, setShowPruneModal] = useState(false);
  const [isPruning, setIsPruning] = useState(false);
  const [systemDfText, setSystemDfText] = useState('');

  const activeConnId = useConnectionStore(s => s.activeConnectionId) || 'default';
  const { hasSudo, isRoot, username, userPrivilege } = useUserPrivilege();
  const [restrictedAction, setRestrictedAction] = useState<string | null>(null);
  const isDockerPermitted = hasSudo || isRoot || (userPrivilege?.groups || []).includes('docker');
  const { openApp } = useWindowManager();
  const runTerminalCommand = useEditorStore(s => s.runTerminalCommand);
  const openDockerTerminalInApp = useEditorStore(s => s.openDockerTerminalInApp);

  // Selection & Bulk Actions State
  const [selectedContainerIds, setSelectedContainerIds] = useState<Set<string>>(new Set());

  // Action loading tracker (container action, bulk action, image deletion)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Row Right-Click Context Menu State (all tables)
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    type: 'container' | 'image' | 'volume' | 'network';
    container?: ContainerItem;
    image?: ImageItem;
    volume?: VolumeItem;
    network?: NetworkItem;
  } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Context Menu outside click & escape handler
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Exit editor full screen on Escape key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isEditorFullscreen) {
        setIsEditorFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isEditorFullscreen]);

  // VS Code Shortcuts for Monaco Editor: Zoom In (Ctrl++ / Ctrl+=), Zoom Out (Ctrl+-), Word Wrap (Alt+Z)
  useEffect(() => {
    if (activeTab !== 'editor') return;

    const handleEditorShortcuts = (e: KeyboardEvent) => {
      // Zoom In: Ctrl + = or Ctrl + +
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setEditorFontSize(prev => Math.min(32, prev + 1));
      }
      // Zoom Out: Ctrl + - or Ctrl + _
      else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        setEditorFontSize(prev => Math.max(9, prev - 1));
      }
      // Word Wrap: Alt + Z
      else if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setEditorWordWrap(prev => (prev === 'on' ? 'off' : 'on'));
      }
    };

    window.addEventListener('keydown', handleEditorShortcuts);
    return () => window.removeEventListener('keydown', handleEditorShortcuts);
  }, [activeTab]);

  // Auto-scroll execution stream output console
  useEffect(() => {
    if (consoleOutputEndRef.current) {
      consoleOutputEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [editorOutput]);

  // Clean up Tauri stream event listener on unmount
  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    };
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setActionFeedback({ message, type });
    setTimeout(() => setActionFeedback(null), 4000);
  };

  // Check Docker Registry Auth / Logged in User
  const checkDockerAuth = useCallback(async () => {
    try {
      // 1. Check ~/.docker/config.json
      const cfgRes = await sshExec(activeConnId, 'cat ~/.docker/config.json 2>/dev/null');
      if (cfgRes.exit_code === 0 && cfgRes.stdout.trim()) {
        try {
          const cfg = JSON.parse(cfgRes.stdout);
          const auths = cfg.auths || {};
          const entries = Object.entries(auths);
          if (entries.length > 0) {
            const [rawReg, authObj]: [string, any] = entries[0];
            let username = '';
            if (authObj?.auth) {
              try {
                // Base64 decode auth "username:password"
                const decoded = atob(authObj.auth);
                username = decoded.split(':')[0] || '';
              } catch {}
            }
            if (!username && authObj?.username) {
              username = authObj.username;
            }
            const cleanReg = rawReg.replace(/^https?:\/\//, '').replace(/\/v1\/?$/, '').replace(/\/$/, '');
            setDockerAuth({
              username: username || 'User',
              registry: cleanReg || 'docker.io',
              loggedIn: true,
            });
            return;
          }
        } catch {}
      }

      // 2. Fallback check: docker info | grep Username
      const infoRes = await sshExec(activeConnId, 'docker info 2>/dev/null | grep -i "Username:"');
      if (infoRes.exit_code === 0 && infoRes.stdout.trim()) {
        const match = infoRes.stdout.match(/Username:\s*(\S+)/i);
        if (match && match[1]) {
          setDockerAuth({
            username: match[1],
            registry: 'docker.io',
            loggedIn: true,
          });
          return;
        }
      }

      setDockerAuth(null);
    } catch {
      setDockerAuth(null);
    }
  }, [activeConnId]);

  // Check Docker Daemon & Installation Status
  const checkDaemonStatus = useCallback(async (): Promise<'running' | 'stopped' | 'not_installed'> => {
    try {
      // 1. Check if docker binary is present
      const binCheck = await sshExec(activeConnId, 'command -v docker');
      if (binCheck.exit_code !== 0 || !binCheck.stdout.trim()) {
        setDockerDaemonState('not_installed');
        return 'not_installed';
      }

      // 2. Check if docker daemon responds
      const infoCheck = await sshExec(activeConnId, 'docker info >/dev/null 2>&1');
      if (infoCheck.exit_code === 0) {
        setDockerDaemonState('running');
        return 'running';
      }

      // 3. Inspect systemd service state
      const svcCheck = await sshExec(activeConnId, 'systemctl is-active docker 2>/dev/null || service docker status 2>/dev/null');
      const svcOut = (svcCheck.stdout || '').toLowerCase();
      if (svcOut.includes('active') && !svcOut.includes('inactive')) {
        setDockerDaemonState('running');
        return 'running';
      } else {
        setDockerDaemonState('stopped');
        return 'stopped';
      }
    } catch {
      setDockerDaemonState('stopped');
      return 'stopped';
    }
  }, [activeConnId]);

  // Service Management Actions (Start, Enable, Install)
  const handleStartDockerService = async () => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction('Start Docker Daemon Service');
      return;
    }
    setServiceActionLoading('start');
    showNotification('Starting Docker daemon service...');
    try {
      const res = await sshExec(activeConnId, 'sudo systemctl start docker 2>&1 || sudo service docker start 2>&1');
      if (res.exit_code === 0) {
        showNotification('Docker service started successfully!');
        await checkDaemonStatus();
        await loadDockerData();
      } else {
        showNotification(`Failed to start Docker: ${res.stderr || res.stdout}`, 'error');
      }
    } catch (err: any) {
      showNotification(`Start failed: ${err?.message || err}`, 'error');
    } finally {
      setServiceActionLoading(null);
    }
  };

  const handleEnableDockerService = async () => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction('Enable Docker Service on Boot');
      return;
    }
    setServiceActionLoading('enable');
    showNotification('Enabling Docker on system boot...');
    try {
      const res = await sshExec(activeConnId, 'sudo systemctl enable docker 2>&1');
      if (res.exit_code === 0) {
        showNotification('Docker service enabled on boot successfully!');
      } else {
        showNotification(`Failed to enable Docker: ${res.stderr || res.stdout}`, 'error');
      }
    } catch (err: any) {
      showNotification(`Enable failed: ${err?.message || err}`, 'error');
    } finally {
      setServiceActionLoading(null);
    }
  };

  const handleInstallDocker = async () => {
    if (!hasSudo && !isRoot) {
      setRestrictedAction('Install Docker Engine');
      return;
    }
    setServiceActionLoading('install');
    showNotification('Installing Docker Engine (official convenience script)...');
    try {
      const cmd = 'curl -fsSL https://get.docker.com -o /tmp/get-docker.sh && sudo sh /tmp/get-docker.sh && sudo systemctl enable --now docker';
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0) {
        showNotification('Docker installed and started successfully!');
        await checkDaemonStatus();
        await loadDockerData();
      } else {
        showNotification(`Installation failed: ${res.stderr || res.stdout}`, 'error');
      }
    } catch (err: any) {
      showNotification(`Installation error: ${err?.message || err}`, 'error');
    } finally {
      setServiceActionLoading(null);
    }
  };

  // Push Image Action for Logged-in Users
  const handlePushImage = async (img: ImageItem) => {
    const targetTag = img.tag && img.tag !== '<none>' ? `${img.repository}:${img.tag}` : img.repository;
    if (!targetTag || targetTag === '<none>') {
      showNotification('Cannot push untagged image (<none>)', 'error');
      return;
    }
    const loadKey = `push-${img.id}`;
    setActionLoadingId(loadKey);
    showNotification(`Pushing ${targetTag} to ${dockerAuth?.registry || 'registry'}...`);
    try {
      const res = await sshExec(activeConnId, `docker push "${targetTag}"`);
      if (res.exit_code === 0) {
        showNotification(`Successfully pushed image ${targetTag}!`);
      } else {
        showNotification(`Push failed: ${res.stderr || res.stdout || 'Check authentication'}`, 'error');
      }
    } catch (err: any) {
      showNotification(`Push error: ${err?.message || err}`, 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Main DataLoader
  const loadDockerData = useCallback(async () => {
    setIsLoading(true);
    try {
      const daemonState = await checkDaemonStatus();
      if (daemonState !== 'running') {
        setContainers([]);
        setImages([]);
        setVolumes([]);
        setNetworks([]);
        await checkDockerAuth();
        return;
      }

      // 1. Containers
      const cList = await dockerContainers(activeConnId);
      if (cList && Array.isArray(cList)) {
        setContainers(cList.map((c: any) => {
          const rawStatus = (c.status || '').toLowerCase();
          const rawState = (c.state || '').toLowerCase();
          let st: 'running' | 'paused' | 'stopped' = 'stopped';
          if (rawState.includes('pause') || rawStatus.includes('paused')) {
            st = 'paused';
          } else if (rawState === 'running' || rawStatus.includes('up')) {
            st = 'running';
          }

          return {
            id: (c.id || '').slice(0, 12),
            name: (c.name || 'container').replace(/^\//, ''),
            image: c.image || '',
            status: st,
            statusText: c.status || 'Active',
            ports: c.ports || '—',
            created: c.created || 'Recently',
            cpu: c.cpu_percent ? `${c.cpu_percent}%` : '0.0%',
            mem: c.mem_usage || '—',
          };
        }));
      } else {
        setContainers([]);
      }

      // 2. Images
      const imgList = await dockerImages(activeConnId);
      if (imgList && Array.isArray(imgList)) {
        setImages(imgList.map((img: any) => ({
          id: (img.id || '').slice(0, 12),
          repository: img.repository || '<none>',
          tag: img.tag || '<none>',
          size: img.size || '—',
          created: img.created || '',
        })));
      } else {
        setImages([]);
      }

      // 3. Volumes via SSH exec
      try {
        const volRes = await sshExec(activeConnId, 'docker volume ls --format "{{.Name}}|{{.Driver}}|{{.Scope}}"');
        if (volRes.stdout) {
          const parsedVols: VolumeItem[] = volRes.stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => {
              const [name, driver, scope] = line.split('|');
              return { name: name?.trim() || '', driver: driver?.trim() || 'local', scope: scope?.trim() || 'local' };
            });
          setVolumes(parsedVols);
        }
      } catch (err) {
        console.warn('Failed to fetch volumes:', err);
      }

      // 4. Networks via SSH exec
      try {
        const netRes = await sshExec(activeConnId, 'docker network ls --format "{{.ID}}|{{.Name}}|{{.Driver}}|{{.Scope}}"');
        if (netRes.stdout) {
          const parsedNets: NetworkItem[] = netRes.stdout
            .trim()
            .split('\n')
            .filter(Boolean)
            .map(line => {
              const [id, name, driver, scope] = line.split('|');
              return { id: (id?.trim() || '').slice(0, 12), name: name?.trim() || '', driver: driver?.trim() || 'bridge', scope: scope?.trim() || 'local' };
            });
          setNetworks(parsedNets);
        }
      } catch (err) {
        console.warn('Failed to fetch networks:', err);
      }

      // Check Docker user authentication
      await checkDockerAuth();

    } catch (err) {
      console.warn('Docker load failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnId, checkDaemonStatus, checkDockerAuth]);

  useEffect(() => {
    loadDockerData();
  }, [loadDockerData]);

  // Load saved credentials from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sshdesktop_docker_credentials') || localStorage.getItem('clouddesk_docker_credentials');
      if (saved) {
        setSavedCredentialsList(JSON.parse(saved));
      }
    } catch {}
  }, []);

  const handleDockerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginUsername.trim() || !loginPassword.trim()) {
      setLoginError('Please enter both username and password/token.');
      return;
    }
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const reg = loginRegistry.trim() || 'docker.io';
      const escapedPwd = loginPassword.replace(/'/g, "'\\''");
      const cmd = `printf '%s\\n' '${escapedPwd}' | docker login -u '${loginUsername.trim()}' --password-stdin ${reg === 'docker.io' ? '' : `'${reg}'`}`.trim();
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0 && (res.stdout.toLowerCase().includes('succeeded') || !res.stderr)) {
        showNotification(`Logged in to Docker registry as ${loginUsername.trim()}`);
        if (saveCredentials) {
          const newCred: SavedDockerCredential = {
            id: `${reg}_${loginUsername.trim()}`,
            registry: reg,
            username: loginUsername.trim(),
            savedAt: new Date().toLocaleDateString(),
          };
          const existing = JSON.parse(
            localStorage.getItem('sshdesktop_docker_credentials') ||
            localStorage.getItem('clouddesk_docker_credentials') ||
            '[]'
          );
          const updated = [newCred, ...existing.filter((c: any) => c.id !== newCred.id)];
          localStorage.setItem('sshdesktop_docker_credentials', JSON.stringify(updated));
          setSavedCredentialsList(updated);
        }
        setShowLoginModal(false);
        setLoginPassword('');
        await checkDockerAuth();
      } else {
        setLoginError(res.stderr || res.stdout || 'Docker login failed.');
      }
    } catch (err: any) {
      setLoginError(err?.message || String(err));
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleDockerLogout = async (registryToLogout?: string) => {
    const reg = registryToLogout || dockerAuth?.registry || 'docker.io';
    try {
      const cmd = `docker logout ${reg === 'docker.io' ? '' : `'${reg}'`}`.trim();
      await sshExec(activeConnId, cmd);
      showNotification(`Logged out from ${reg}`);
      await checkDockerAuth();
    } catch (e: any) {
      showNotification(`Logout notice: ${e?.message || e}`, 'error');
    }
  };

  const runningCount = containers.filter(c => c.status === 'running').length;
  const pausedCount = containers.filter(c => c.status === 'paused').length;
  const stoppedCount = containers.filter(c => c.status === 'stopped').length;

  const filteredContainers = containers.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase()) || 
                          c.image.toLowerCase().includes(search.toLowerCase()) ||
                          c.id.toLowerCase().includes(search.toLowerCase());
    if (statusFilter === 'running') return matchesSearch && c.status === 'running';
    if (statusFilter === 'stopped') return matchesSearch && c.status !== 'running';
    return matchesSearch;
  });

  const filteredImages = images.filter(img => 
    img.repository.toLowerCase().includes(search.toLowerCase()) ||
    img.tag.toLowerCase().includes(search.toLowerCase()) ||
    img.id.toLowerCase().includes(search.toLowerCase())
  );

  const filteredVolumes = volumes.filter(v => 
    v.name.toLowerCase().includes(search.toLowerCase()) ||
    v.driver.toLowerCase().includes(search.toLowerCase())
  );

  const filteredNetworks = networks.filter(n => 
    n.name.toLowerCase().includes(search.toLowerCase()) ||
    n.driver.toLowerCase().includes(search.toLowerCase())
  );

  // Table Keyboard Navigation (ArrowUp, ArrowDown, Escape)
  useEffect(() => {
    const handleTableKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in form inputs, textareas or modals
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }
      if (showRunModal || showPullModal || showCreateVolumeModal || showCreateNetworkModal || showLoginModal || selectedLogs || inspectTarget || showPruneModal) {
        return;
      }

      let totalRows = 0;
      if (activeTab === 'containers') totalRows = filteredContainers.length;
      else if (activeTab === 'images') totalRows = filteredImages.length;
      else if (activeTab === 'volumes') totalRows = filteredVolumes.length;
      else if (activeTab === 'networks') totalRows = filteredNetworks.length;

      if (totalRows === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedRowIndex(prev => {
          const next = prev === null ? 0 : Math.min(prev + 1, totalRows - 1);
          const el = document.getElementById(`docker-row-${activeTab}-${next}`);
          el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedRowIndex(prev => {
          const next = prev === null ? 0 : Math.max(prev - 1, 0);
          const el = document.getElementById(`docker-row-${activeTab}-${next}`);
          el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          return next;
        });
      } else if (e.key === 'Escape') {
        setSelectedRowIndex(null);
      }
    };

    window.addEventListener('keydown', handleTableKeyDown);
    return () => window.removeEventListener('keydown', handleTableKeyDown);
  }, [activeTab, filteredContainers.length, filteredImages.length, filteredVolumes.length, filteredNetworks.length, showRunModal, showPullModal, showCreateVolumeModal, showCreateNetworkModal, showLoginModal, selectedLogs, inspectTarget, showPruneModal]);

  // Reset selected row when changing tabs
  useEffect(() => {
    setSelectedRowIndex(null);
  }, [activeTab]);

  // Create Volume Submit
  const handleCreateVolume = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!volCreateName.trim()) {
      alert('Volume name is required.');
      return;
    }
    setIsSubmittingVol(true);
    try {
      let cmd = 'docker volume create';
      if (volCreateDriver.trim()) cmd += ` --driver ${volCreateDriver.trim()}`;
      if (volCreateOpts.trim()) {
        volCreateOpts.split(',').forEach(o => {
          if (o.trim()) cmd += ` --opt ${o.trim()}`;
        });
      }
      if (volCreateLabels.trim()) {
        volCreateLabels.split(',').forEach(l => {
          if (l.trim()) cmd += ` --label ${l.trim()}`;
        });
      }
      cmd += ` ${volCreateName.trim()}`;
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0) {
        showNotification(`Volume "${volCreateName.trim()}" created successfully!`);
        setShowCreateVolumeModal(false);
        setVolCreateName('');
        setVolCreateOpts('');
        setVolCreateLabels('');
        await loadDockerData();
      } else {
        alert(`Failed to create volume:\n${res.stderr || res.stdout}`);
      }
    } catch (err: any) {
      alert(`Error creating volume: ${err?.message || err}`);
    } finally {
      setIsSubmittingVol(false);
    }
  };

  // Create Network Submit
  const handleCreateNetwork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!netCreateName.trim()) {
      alert('Network name is required.');
      return;
    }
    setIsSubmittingNet(true);
    try {
      let cmd = 'docker network create';
      if (netCreateDriver) cmd += ` --driver ${netCreateDriver}`;
      if (netCreateSubnet.trim()) cmd += ` --subnet ${netCreateSubnet.trim()}`;
      if (netCreateGateway.trim()) cmd += ` --gateway ${netCreateGateway.trim()}`;
      if (netCreateIpRange.trim()) cmd += ` --ip-range ${netCreateIpRange.trim()}`;
      if (netCreateInternal) cmd += ` --internal`;
      if (netCreateAttachable) cmd += ` --attachable`;
      if (netCreateIpv6) cmd += ` --ipv6`;
      cmd += ` ${netCreateName.trim()}`;
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0) {
        showNotification(`Network "${netCreateName.trim()}" created successfully!`);
        setShowCreateNetworkModal(false);
        setNetCreateName('');
        setNetCreateSubnet('');
        setNetCreateGateway('');
        setNetCreateIpRange('');
        setNetCreateInternal(false);
        setNetCreateAttachable(false);
        setNetCreateIpv6(false);
        await loadDockerData();
      } else {
        alert(`Failed to create network:\n${res.stderr || res.stdout}`);
      }
    } catch (err: any) {
      alert(`Error creating network: ${err?.message || err}`);
    } finally {
      setIsSubmittingNet(false);
    }
  };

  // Docker Editor Handlers
  const handleTemplateChange = (tmplKey: string) => {
    setSelectedTemplate(tmplKey);
    if (editorMode === 'dockerfile') {
      const tmpl = DOCKERFILE_TEMPLATES[tmplKey] || '';
      if (tmpl) setEditorContent(tmpl);
    } else {
      const tmpl = COMPOSE_TEMPLATES[tmplKey] || '';
      if (tmpl) setEditorContent(tmpl);
    }
  };

  const handleEditorModeSwitch = (mode: 'dockerfile' | 'compose') => {
    setEditorMode(mode);
    if (mode === 'dockerfile') {
      setSelectedTemplate('nodejs');
      setEditorContent(DOCKERFILE_TEMPLATES.nodejs);
    } else {
      setSelectedTemplate('web_db_redis');
      setEditorContent(COMPOSE_TEMPLATES.web_db_redis);
    }
  };

  const handleLoadEditorFile = async () => {
    const filename = editorMode === 'dockerfile' ? 'Dockerfile' : 'docker-compose.yml';
    const filePath = `${editorPath.replace(/\/$/, '')}/${filename}`;
    try {
      const res = await sshExec(activeConnId, `cat "${filePath}" 2>/dev/null`);
      if (res.exit_code === 0 && res.stdout) {
        setEditorContent(res.stdout);
        showNotification(`Loaded ${filename} from ${editorPath}`);
      } else {
        alert(`Could not load ${filename} at ${filePath}:\n${res.stderr || 'File does not exist'}`);
      }
    } catch (err: any) {
      alert(`Error loading file: ${err?.message || err}`);
    }
  };

  const handleSaveEditorFile = async () => {
    const filename = editorMode === 'dockerfile' ? 'Dockerfile' : 'docker-compose.yml';
    const filePath = `${editorPath.replace(/\/$/, '')}/${filename}`;
    try {
      const eofTag = `DOCKER_${Date.now()}_EOF`;
      const cmd = `mkdir -p "${editorPath}" && cat << '${eofTag}' > "${filePath}"\n${editorContent}\n${eofTag}`;
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0) {
        showNotification(`Saved ${filename} to ${editorPath}`);
      } else {
        alert(`Failed to save ${filename}:\n${res.stderr}`);
      }
    } catch (err: any) {
      alert(`Error saving file: ${err?.message || err}`);
    }
  };

  // Real-time Streaming Command Runner
  const runStreamingDockerCommand = async (command: string, bannerText: string) => {
    const streamId = `docker-stream-${Date.now()}`;
    setCurrentStreamId(streamId);
    currentStreamIdRef.current = streamId;
    setIsEditorRunning(true);
    setEditorExitCode(null);
    setEditorOutput(`[${new Date().toLocaleTimeString()}] ${bannerText}\n$ ${command}\n----------------------------------------\n`);

    if (unlistenRef.current) {
      unlistenRef.current();
      unlistenRef.current = null;
    }

    try {
      const unlisten = await listen<any>('exec-output', (event) => {
        const chunk = event.payload;
        if (chunk && chunk.stream_id === currentStreamIdRef.current) {
          if (chunk.data) {
            setEditorOutput(prev => prev + chunk.data);
          }
          if (chunk.is_done) {
            const exit = chunk.exit_code !== undefined && chunk.exit_code !== null ? chunk.exit_code : 0;
            setEditorExitCode(exit);
            setIsEditorRunning(false);
            setCurrentStreamId(null);
            currentStreamIdRef.current = null;
            if (exit === 0) {
              showNotification('Execution finished successfully!');
              loadDockerData();
            } else {
              showNotification(`Command ended with exit code ${exit}`, 'error');
            }
          }
        }
      });
      unlistenRef.current = unlisten;
    } catch (e) {
      console.warn('Live stream listen error:', e);
    }

    try {
      await sshExecStream(activeConnId, command, streamId);
    } catch (err: any) {
      setEditorOutput(prev => prev + `\nStreaming Error: ${err?.message || err}\n`);
      setIsEditorRunning(false);
      setCurrentStreamId(null);
      currentStreamIdRef.current = null;
      setEditorExitCode(1);
    }
  };

  // Cancel Image Build or Running Compose Operation
  const handleCancelBuild = async () => {
    if (currentStreamIdRef.current) {
      try {
        await sshExecStop(currentStreamIdRef.current);
      } catch {}
    }

    // Force kill remote docker build / compose process
    try {
      await sshExec(activeConnId, 'sudo pkill -f "docker build" 2>/dev/null || sudo pkill -f "docker-compose" 2>/dev/null || true');
    } catch {}

    setEditorOutput(prev => prev + '\n\n[🔴 Operation cancelled by user]\n');
    setEditorExitCode(130);
    setIsEditorRunning(false);
    setCurrentStreamId(null);
    currentStreamIdRef.current = null;
    showNotification('Build cancelled by user', 'error');
  };

  const handleBuildImage = async () => {
    await handleSaveEditorFile();
    const tag = editorImageTag.trim() || 'myapp:latest';
    const cmd = `cd "${editorPath}" && docker build -t "${tag}" .`;
    await runStreamingDockerCommand(cmd, `Building Docker image: ${tag} in ${editorPath}...`);
  };

  const handleBuildAndRun = async () => {
    await handleSaveEditorFile();
    const tag = editorImageTag.trim() || 'myapp:latest';
    const containerName = `app-${Date.now().toString().slice(-4)}`;
    const cmd = `cd "${editorPath}" && docker build -t "${tag}" . && echo "\n==> Starting container '${containerName}'..." && docker run -d --name "${containerName}" "${tag}"`;
    await runStreamingDockerCommand(cmd, `Building & Running Docker image: ${tag}...`);
  };

  const handleComposeCommand = async (action: 'up' | 'down' | 'restart' | 'logs' | 'ps') => {
    await handleSaveEditorFile();
    let composeActionCmd = '';
    if (action === 'up') composeActionCmd = 'docker compose up -d 2>&1 || docker-compose up -d 2>&1';
    else if (action === 'down') composeActionCmd = 'docker compose down 2>&1 || docker-compose down 2>&1';
    else if (action === 'restart') composeActionCmd = 'docker compose restart 2>&1 || docker-compose restart 2>&1';
    else if (action === 'logs') composeActionCmd = 'docker compose logs --tail=100 2>&1 || docker-compose logs --tail=100 2>&1';
    else if (action === 'ps') composeActionCmd = 'docker compose ps 2>&1 || docker-compose ps 2>&1';

    const cmd = `cd "${editorPath}" && (${composeActionCmd})`;
    await runStreamingDockerCommand(cmd, `Running Docker Compose ${action.toUpperCase()} in ${editorPath}...`);
  };

  // Monaco Editor Autocomplete & Configuration
  const handleEditorDidMount = (editor: any, monaco: any) => {
    // Bind VS Code shortcuts directly in Monaco editor instance
    try {
      monaco.editor.defineTheme('docker-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'keyword', foreground: '7aa2f7', fontStyle: 'bold' },
          { token: 'comment', foreground: '565f89', fontStyle: 'italic' },
          { token: 'string', foreground: '9ece6a' },
          { token: 'number', foreground: 'ff9e64' },
          { token: 'type', foreground: '2ac3de' },
          { token: 'identifier', foreground: 'cdd6f4' },
        ],
        colors: {
          'editor.background': '#13141f',
          'editor.foreground': '#cdd6f4',
          'editorLineNumber.foreground': '#45475a',
          'editorLineNumber.activeForeground': '#89b4fa',
          'editor.selectionBackground': '#31324480',
          'editor.lineHighlightBackground': '#1a1b2a60',
        }
      });
      monaco.editor.setTheme('docker-dark');
      
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => {
        setEditorFontSize((prev: number) => Math.min(32, prev + 1));
      });
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => {
        setEditorFontSize((prev: number) => Math.max(9, prev - 1));
      });
      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.KeyZ, () => {
        setEditorWordWrap((prev: string) => (prev === 'on' ? 'off' : 'on'));
      });
    } catch {}

    if (!monacoRegisteredRef.current) {
      monacoRegisteredRef.current = true;

      // Register Dockerfile keywords & snippets
      monaco.languages.registerCompletionItemProvider('dockerfile', {
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          const suggestions = [
            {
              label: 'FROM',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'FROM ${1:node:20-alpine}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Initializes a new build stage and sets the base image.',
              range,
            },
            {
              label: 'RUN',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'RUN ${1:command}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Executes commands in a new layer and commits the results.',
              range,
            },
            {
              label: 'CMD',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'CMD ["${1:executable}", "${2:param}"]',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Provides default execution parameters for container.',
              range,
            },
            {
              label: 'COPY',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'COPY ${1:source} ${2:destination}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Copies files from host filesystem into container.',
              range,
            },
            {
              label: 'ADD',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'ADD ${1:source} ${2:destination}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Copies files, directories or extracts tar archives.',
              range,
            },
            {
              label: 'WORKDIR',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'WORKDIR /${1:app}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Sets the working directory for subsequent instructions.',
              range,
            },
            {
              label: 'EXPOSE',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'EXPOSE ${1:80}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Informs Docker that the container listens on specified ports.',
              range,
            },
            {
              label: 'ENV',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'ENV ${1:KEY}=${2:value}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Sets environment variable inside image.',
              range,
            },
            {
              label: 'ENTRYPOINT',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'ENTRYPOINT ["${1:executable}", "${2:param}"]',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Configures container to run as an executable.',
              range,
            },
            {
              label: 'VOLUME',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'VOLUME ["/${1:data}"]',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Creates a mount point with the specified path.',
              range,
            },
            {
              label: 'USER',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'USER ${1:node}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Sets user name or UID to use when running image.',
              range,
            },
            {
              label: 'ARG',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'ARG ${1:NAME}=${2:default_value}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Defines build-time variable.',
              range,
            },
            {
              label: 'LABEL',
              kind: monaco.languages.CompletionItemKind.Keyword,
              insertText: 'LABEL ${1:maintainer}="${2:name}"',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Adds metadata labels to image.',
              range,
            },
            {
              label: 'HEALTHCHECK',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'HEALTHCHECK --interval=${1:30s} --timeout=${2:3s} \\\n  CMD curl -f http://localhost:${3:80}/ || exit 1',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Configures healthcheck command.',
              range,
            },
            {
              label: 'multi-stage-node',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: 'FROM node:20-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM nginx:alpine\nCOPY --from=builder /app/dist /usr/share/nginx/html\nEXPOSE 80\nCMD ["nginx", "-g", "daemon off;"]',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Production Multi-stage Node/Vite build with Nginx.',
              range,
            }
          ];
          return { suggestions };
        }
      });

      // Register Docker Compose YAML completions
      monaco.languages.registerCompletionItemProvider('yaml', {
        provideCompletionItems: (model: any, position: any) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          const suggestions = [
            {
              label: 'version',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: "version: '${1:3.8}'",
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Docker Compose file version.',
              range,
            },
            {
              label: 'services',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: 'services:\n  ${1:web}:\n    image: ${2:nginx:alpine}\n    ports:\n      - "${3:80:80}"',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Defines the services container stack.',
              range,
            },
            {
              label: 'service-definition',
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: '${1:app}:\n  image: ${2:alpine:latest}\n  container_name: ${3:my-container}\n  restart: ${4:unless-stopped}\n  ports:\n    - "${5:8080}:${6:80}"\n  environment:\n    - ${7:NODE_ENV=production}\n  volumes:\n    - ${8:data_volume}:/${9:data}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Complete service definition with ports, environment and volumes.',
              range,
            },
            {
              label: 'image',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: 'image: ${1:image:tag}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Image to start container from.',
              range,
            },
            {
              label: 'build',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: 'build:\n  context: ${1:.}\n  dockerfile: ${2:Dockerfile}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Build options for the container.',
              range,
            },
            {
              label: 'ports',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: 'ports:\n  - "${1:8080}:${2:80}"',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Expose ports to host.',
              range,
            },
            {
              label: 'volumes',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: 'volumes:\n  - ${1:./data}:/${2:app/data}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Mount paths or named volumes.',
              range,
            },
            {
              label: 'environment',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: 'environment:\n  - ${1:KEY}=${2:value}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Define environment variables.',
              range,
            },
            {
              label: 'depends_on',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: 'depends_on:\n  - ${1:db}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Express dependency between services.',
              range,
            },
            {
              label: 'restart',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: 'restart: ${1|unless-stopped,always,on-failure,no|}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Container restart policy.',
              range,
            },
            {
              label: 'networks',
              kind: monaco.languages.CompletionItemKind.Property,
              insertText: 'networks:\n  - ${1:app-network}',
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              documentation: 'Networks that containers join.',
              range,
            }
          ];
          return { suggestions };
        }
      });
    }
  };

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      loadDockerData();
    }, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh, loadDockerData]);

  // Helper to find which containers reference a given image
  const getContainersUsingImage = useCallback((img: ImageItem): ContainerItem[] => {
    return containers.filter(c => {
      const cImg = (c.image || '').trim();
      const repo = (img.repository || '').trim();
      const tag = (img.tag || '').trim();
      const fullTag = tag ? `${repo}:${tag}` : repo;
      const imgIdShort = (img.id || '').slice(0, 12);
      
      if (!cImg) return false;
      if (cImg === repo || cImg === fullTag) return true;
      if (imgIdShort && (cImg === imgIdShort || cImg === img.id || cImg.startsWith(imgIdShort))) return true;
      if (c.id && img.id.startsWith(cImg)) return true;
      if (repo !== '<none>' && (cImg.endsWith(`/${repo}`) || cImg.endsWith(`/${fullTag}`))) return true;
      return false;
    });
  }, [containers]);

  // Container Action Handler
  const handleAction = async (id: string, action: string, containerName?: string) => {
    if (!isDockerPermitted) {
      setRestrictedAction(`${action.toUpperCase()} Container '${containerName || id}'`);
      return;
    }
    const loadKey = `c-${action}-${id}`;
    setActionLoadingId(loadKey);
    try {
      await dockerAction(activeConnId, id, action);
      showNotification(`Container ${containerName || id} ${action} command sent successfully`);
      await loadDockerData();
    } catch (err: any) {
      showNotification(`Action failed: ${err?.message || err}`, 'error');
    } finally {
      setActionLoadingId(null);
    }
  };

  // Connect into container directly via native Terminal app (dedicated container tab & robust PTY handshake)
  const handleOpenInteractiveTerminal = (c: ContainerItem) => {
    const shellCmd = `docker exec -it ${c.id} sh -c "if command -v bash >/dev/null 2>&1; then exec bash; else exec sh; fi"\n`;
    openDockerTerminalInApp(c.id, c.name, shellCmd);
    openApp('terminal', 'Terminal');
    showNotification(`Connected interactive shell for container ${c.name}`);
  };

  // Toggle selection for a container
  const toggleSelectContainer = (id: string, e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setSelectedContainerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Toggle select all filtered containers
  const toggleSelectAllContainers = () => {
    const allFilteredIds = filteredContainers.map(c => c.id);
    const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selectedContainerIds.has(id));
    if (allSelected) {
      setSelectedContainerIds(new Set());
    } else {
      setSelectedContainerIds(new Set(allFilteredIds));
    }
  };

  // Bulk action on selected containers
  const handleBulkAction = async (action: 'start' | 'stop' | 'restart' | 'delete') => {
    if (selectedContainerIds.size === 0) return;
    if (action === 'delete') {
      promptDeleteBulkContainers();
      return;
    }

    setActionLoadingId('bulk');
    const ids = Array.from(selectedContainerIds);
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
      try {
        await dockerAction(activeConnId, id, action);
        successCount++;
      } catch (err) {
        console.warn(`Bulk action ${action} failed for ${id}:`, err);
        failCount++;
      }
    }

    if (failCount > 0) {
      showNotification(`Bulk ${action}: ${successCount} succeeded, ${failCount} failed`, 'error');
    } else {
      showNotification(`Bulk ${action} completed for ${successCount} container(s)`);
    }

    setSelectedContainerIds(new Set());
    await loadDockerData();
    setActionLoadingId(null);
  };

  // Global action on all containers
  const handleGlobalAction = async (action: 'start-all' | 'stop-all' | 'restart-all') => {
    let targets: ContainerItem[] = [];
    if (action === 'start-all') {
      targets = containers.filter(c => c.status !== 'running');
      if (targets.length === 0) {
        showNotification('All containers are already running');
        return;
      }
    } else if (action === 'stop-all') {
      targets = containers.filter(c => c.status === 'running');
      if (targets.length === 0) {
        showNotification('No running containers to stop');
        return;
      }
      if (!confirm(`Stop all ${targets.length} running container(s)?`)) return;
    } else if (action === 'restart-all') {
      targets = containers.filter(c => c.status === 'running');
      if (targets.length === 0) {
        showNotification('No running containers to restart');
        return;
      }
      if (!confirm(`Restart all ${targets.length} running container(s)?`)) return;
    }

    setActionLoadingId('global');
    let ok = 0;
    const act = action === 'start-all' ? 'start' : action === 'stop-all' ? 'stop' : 'restart';

    for (const c of targets) {
      try {
        await dockerAction(activeConnId, c.id, act);
        ok++;
      } catch (e) {
        console.warn(`Global action failed for ${c.name}:`, e);
      }
    }

    showNotification(`${act.toUpperCase()} executed on ${ok}/${targets.length} container(s)`);
    await loadDockerData();
    setActionLoadingId(null);
  };

  // Inspect Container
  const openInspector = async (container: ContainerItem) => {
    setInspectTarget(container);
    setInspectLoading(true);
    setInspectTab('overview');
    try {
      const inspectRes = await sshExec(activeConnId, `docker inspect ${container.id}`);
      if (inspectRes.stdout) {
        const rawArr = JSON.parse(inspectRes.stdout);
        const data = rawArr[0] || {};
        
        const envList: string[] = data.Config?.Env || [];
        const portObj = data.NetworkSettings?.Ports || {};
        const parsedPorts: { hostPort: string; containerPort: string; protocol: string }[] = [];
        
        Object.keys(portObj).forEach(cPort => {
          const bindings = portObj[cPort];
          const [cPortNum, proto] = cPort.split('/');
          if (bindings && Array.isArray(bindings) && bindings.length > 0) {
            bindings.forEach(b => {
              parsedPorts.push({
                hostPort: b.HostPort || '—',
                containerPort: cPortNum,
                protocol: proto || 'tcp'
              });
            });
          } else {
            parsedPorts.push({
              hostPort: 'unmapped',
              containerPort: cPortNum,
              protocol: proto || 'tcp'
            });
          }
        });

        const rawMounts = data.Mounts || [];
        const parsedMounts = rawMounts.map((m: any) => ({
          source: m.Source || '',
          destination: m.Destination || '',
          mode: m.Mode || (m.RW ? 'rw' : 'ro'),
          type: m.Type || 'bind'
        }));

        const netSettings = data.NetworkSettings || {};
        const firstNet = Object.values(netSettings.Networks || {})[0] as any;

        setInspectData({
          id: (data.Id || container.id).slice(0, 12),
          name: (data.Name || container.name).replace(/^\//, ''),
          image: data.Config?.Image || container.image,
          status: data.State?.Status || container.status,
          startedAt: data.State?.StartedAt ? new Date(data.State.StartedAt).toLocaleString() : '—',
          ipAddress: firstNet?.IPAddress || netSettings.IPAddress || 'None',
          gateway: firstNet?.Gateway || netSettings.Gateway || '—',
          macAddress: firstNet?.MacAddress || netSettings.MacAddress || '—',
          restartPolicy: data.HostConfig?.RestartPolicy?.Name || 'no',
          env: envList,
          ports: parsedPorts,
          mounts: parsedMounts,
          rawJson: JSON.stringify(rawArr, null, 2)
        });
      }
    } catch (err: any) {
      console.warn('Inspect parse error:', err);
    } finally {
      setInspectLoading(false);
    }
  };

  // Open Logs
  const openLogs = async (container: ContainerItem) => {
    setSelectedLogs(container);
    setLogsText('Fetching container logs from server...');
    try {
      const out = await dockerLogs(activeConnId, container.id, logsLines);
      setLogsText(out || 'No logs recorded for this container.');
    } catch (err: any) {
      setLogsText(`Error reading logs: ${err?.message || err}`);
    }
  };

  const refreshCurrentLogs = async () => {
    if (!selectedLogs) return;
    try {
      const out = await dockerLogs(activeConnId, selectedLogs.id, logsLines);
      setLogsText(out || 'No logs recorded for this container.');
    } catch (err: any) {
      setLogsText(`Error reading logs: ${err?.message || err}`);
    }
  };

  useEffect(() => {
    if (!logsAutoRefresh || !selectedLogs) return;
    const interval = setInterval(() => {
      refreshCurrentLogs();
    }, 2500);
    return () => clearInterval(interval);
  }, [logsAutoRefresh, selectedLogs, logsLines]);

  const copyLogsToClipboard = () => {
    navigator.clipboard.writeText(logsText);
    setLogsCopied(true);
    setTimeout(() => setLogsCopied(false), 2000);
  };

  // Run Container Submit
  const handleRunSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!runImage.trim()) {
      setRunModalError('Please specify a Docker image name.');
      return;
    }
    setIsSubmittingRun(true);
    setRunModalError(null);
    try {
      let cmd = `docker run -d`;
      if (runName.trim()) cmd += ` --name ${runName.trim()}`;
      if (runRestart) cmd += ` --restart ${runRestart}`;
      
      if (runPorts.trim()) {
        const portList = runPorts.split(',').map(p => p.trim()).filter(Boolean);
        portList.forEach(p => {
          cmd += ` -p ${p}`;
        });
      }

      if (runVolumes.trim()) {
        const volList = runVolumes.split(',').map(v => v.trim()).filter(Boolean);
        volList.forEach(v => {
          cmd += ` -v ${v}`;
        });
      }

      if (runEnv.trim()) {
        const envList = runEnv.split(',').map(e => e.trim()).filter(Boolean);
        envList.forEach(envItem => {
          cmd += ` -e ${envItem}`;
        });
      }

      cmd += ` ${runImage.trim()}`;

      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0) {
        showNotification(`Container started: ${res.stdout.slice(0, 12)}`);
        setShowRunModal(false);
        setRunModalError(null);
        setRunImage('');
        setRunName('');
        setRunPorts('');
        setRunVolumes('');
        setRunEnv('');
        await loadDockerData();
      } else {
        const errorMsg = res.stderr || res.stdout || 'Docker run failed';
        setRunModalError(errorMsg);
      }
    } catch (err: any) {
      setRunModalError(err?.message || String(err));
    } finally {
      setIsSubmittingRun(false);
    }
  };

  // Pull Image Submit
  const handlePullSubmit = async (imgName?: string) => {
    const target = (imgName || pullImageInput).trim();
    if (!target) return;
    setIsPulling(true);
    setPullLogs(`Pulling ${target} from Docker Hub registry...\nPlease wait, this may take a moment.`);
    try {
      const res = await sshExec(activeConnId, `docker pull ${target}`);
      if (res.exit_code === 0) {
        setPullLogs(`Successfully pulled ${target}!\n\n${res.stdout}`);
        showNotification(`Image ${target} pulled successfully`);
        await loadDockerData();
      } else {
        setPullLogs(`Failed to pull ${target}:\n${res.stderr || res.stdout}`);
      }
    } catch (err: any) {
      setPullLogs(`Error pulling image: ${err?.message || err}`);
    } finally {
      setIsPulling(false);
    }
  };

  // Quick Exec Command Submit
  const handleExecSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!execTarget || !execCmd.trim()) return;
    setIsExecRunning(true);
    setExecOutput('Executing inside container...');
    try {
      const res = await sshExec(activeConnId, `docker exec ${execTarget.id} ${execCmd.trim()}`);
      setExecOutput(res.stdout || res.stderr || 'Command executed with no output.');
    } catch (err: any) {
      setExecOutput(`Execution failed: ${err?.message || err}`);
    } finally {
      setIsExecRunning(false);
    }
  };

  // ================= UNIFIED DOCKER RESOURCE DELETION =================
  const promptDeleteContainer = (c: ContainerItem) => {
    setResourceToDelete({
      type: 'container',
      id: c.id,
      name: c.name,
      subText: `Image: ${c.image} • Status: ${c.statusText}`,
      isRunning: c.status === 'running' || c.status === 'paused',
      allowForce: true,
    });
  };

  const promptDeleteBulkContainers = () => {
    if (selectedContainerIds.size === 0) return;
    const selectedList = containers.filter(c => selectedContainerIds.has(c.id));
    const runningList = selectedList.filter(c => c.status === 'running' || c.status === 'paused');
    setResourceToDelete({
      type: 'bulk-containers',
      id: `${selectedContainerIds.size} containers`,
      name: `${selectedContainerIds.size} Selected Container(s)`,
      subText: runningList.length > 0 ? `${runningList.length} of ${selectedList.length} container(s) are currently running` : 'All selected containers are stopped',
      isRunning: runningList.length > 0,
      bulkIds: Array.from(selectedContainerIds),
      allowForce: true,
      inUseBy: runningList.map(c => ({
        name: c.name,
        id: c.id,
        status: c.statusText,
      })),
    });
  };

  const promptDeleteImage = (img: ImageItem) => {
    const usingContainers = getContainersUsingImage(img);
    setResourceToDelete({
      type: 'image',
      id: img.id,
      name: `${img.repository}:${img.tag}`,
      subText: `Size: ${img.size} • Created: ${img.created}`,
      inUseBy: usingContainers.map(c => ({
        name: c.name,
        id: c.id,
        status: c.statusText,
      })),
      allowForce: usingContainers.length === 0,
    });
  };

  const promptDeleteVolume = async (vol: VolumeItem) => {
    let usingContainers: ResourceInUseItem[] = [];
    try {
      const res = await sshExec(activeConnId, `docker ps -a --filter volume="${vol.name}" --format "{{.ID}}|{{.Names}}|{{.Status}}"`);
      if (res.stdout && res.stdout.trim()) {
        usingContainers = res.stdout.trim().split('\n').filter(Boolean).map(l => {
          const [id, name, status] = l.split('|');
          return { name: name || '', id: id?.slice(0, 12), status: status || 'Mounted' };
        });
      }
    } catch {}

    setResourceToDelete({
      type: 'volume',
      id: vol.name,
      name: vol.name,
      subText: `Driver: ${vol.driver} • Scope: ${vol.scope}`,
      inUseBy: usingContainers,
      allowForce: usingContainers.length === 0,
    });
  };

  const promptDeleteNetwork = async (net: NetworkItem) => {
    const isSystemNetwork = ['bridge', 'host', 'none'].includes(net.name.toLowerCase());
    let usingContainers: ResourceInUseItem[] = [];
    if (!isSystemNetwork) {
      try {
        const res = await sshExec(activeConnId, `docker network inspect ${net.id} --format "{{range .Containers}}{{.Name}}|{{.IPv4Address}},{{end}}"`);
        if (res.stdout && res.stdout.trim()) {
          const parts = res.stdout.trim().split(',').filter(Boolean);
          usingContainers = parts.map(p => {
            const [name, ip] = p.split('|');
            return { name: name?.trim() || '', status: ip?.trim() ? `IP: ${ip.trim()}` : 'Connected' };
          });
        }
      } catch {}
    }

    setResourceToDelete({
      type: 'network',
      id: net.id,
      name: net.name,
      subText: isSystemNetwork ? 'Default Docker Predefined Network' : `Driver: ${net.driver} • Scope: ${net.scope}`,
      inUseBy: isSystemNetwork 
        ? [{ name: 'Default system network (cannot be removed by Docker)', status: 'System' }]
        : usingContainers,
      allowForce: !isSystemNetwork && usingContainers.length === 0,
    });
  };

  const executeDeleteResource = async (target: ResourceDeleteTarget, force?: boolean) => {
    if (!isDockerPermitted) {
      setRestrictedAction(`Delete Docker ${target.type} '${target.name}'`);
      setResourceToDelete(null);
      return;
    }
    setIsDeletingResource(true);
    try {
      switch (target.type) {
        case 'container': {
          const act = force || target.isRunning ? 'rm -f' : 'rm';
          await dockerAction(activeConnId, target.id, act);
          showNotification(`Container "${target.name}" removed successfully`);
          break;
        }
        case 'bulk-containers': {
          if (target.bulkIds && target.bulkIds.length > 0) {
            let ok = 0;
            let failed = 0;
            for (const cid of target.bulkIds) {
              try {
                await dockerAction(activeConnId, cid, 'rm -f');
                ok++;
              } catch {
                failed++;
              }
            }
            setSelectedContainerIds(new Set());
            if (failed > 0) {
              showNotification(`Bulk remove: ${ok} succeeded, ${failed} failed`, 'error');
            } else {
              showNotification(`Successfully removed ${ok} container(s)`);
            }
          }
          break;
        }
        case 'image': {
          await dockerImageRemove(activeConnId, target.id);
          showNotification(`Image "${target.name}" removed successfully`);
          break;
        }
        case 'volume': {
          const res = await sshExec(activeConnId, `docker volume rm ${target.id}`);
          if (res.exit_code === 0) {
            showNotification(`Volume "${target.name}" removed successfully`);
          } else {
            showNotification(`Failed to delete volume: ${res.stderr || res.stdout}`, 'error');
          }
          break;
        }
        case 'network': {
          const res = await sshExec(activeConnId, `docker network rm ${target.id}`);
          if (res.exit_code === 0) {
            showNotification(`Network "${target.name}" removed successfully`);
          } else {
            showNotification(`Failed to delete network: ${res.stderr || res.stdout}`, 'error');
          }
          break;
        }
      }
      setResourceToDelete(null);
      await loadDockerData();
    } catch (err: any) {
      showNotification(`Failed to delete: ${err?.message || err}`, 'error');
    } finally {
      setIsDeletingResource(false);
    }
  };

  const handleDeleteVolume = (volName: string) => {
    const v = volumes.find(x => x.name === volName) || { name: volName, driver: 'local', scope: 'local' };
    promptDeleteVolume(v);
  };

  const handleDeleteNetwork = (netId: string, netName: string) => {
    const n = networks.find(x => x.id === netId) || { id: netId, name: netName, driver: 'bridge', scope: 'local' };
    promptDeleteNetwork(n);
  };

  const handleDeleteImage = (img: ImageItem) => {
    promptDeleteImage(img);
  };

  // Tag Image Handlers
  const handleOpenTagModal = (img: ImageItem) => {
    setTagTargetImage(img);
    setTagNewRepo(img.repository === '<none>' ? '' : img.repository);
    setTagNewTag(img.tag === '<none>' ? 'latest' : `${img.tag}-v2`);
    setShowTagModal(true);
  };

  const handleExecuteTag = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tagTargetImage || !tagNewRepo.trim()) return;
    setIsTagging(true);
    try {
      const sourceRef = tagTargetImage.repository === '<none>' ? tagTargetImage.id : `${tagTargetImage.repository}:${tagTargetImage.tag}`;
      const targetRef = `${tagNewRepo.trim()}:${tagNewTag.trim() || 'latest'}`;
      const res = await sshExec(activeConnId, `docker tag "${sourceRef}" "${targetRef}"`);
      if (res.exit_code === 0) {
        showNotification(`Successfully tagged image as ${targetRef}`);
        setShowTagModal(false);
        setTagTargetImage(null);
        await loadDockerData();
      } else {
        showNotification(`Failed to tag image: ${res.stderr || res.stdout}`, 'error');
      }
    } catch (err: any) {
      showNotification(`Tag error: ${err?.message || err}`, 'error');
    } finally {
      setIsTagging(false);
    }
  };

  // Commit Container Handlers
  const handleOpenCommitModal = (c: ContainerItem) => {
    setCommitTargetContainer(c);
    const cleanName = c.name.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
    setCommitRepo(cleanName ? `${cleanName}-backup` : 'my-committed-image');
    setCommitTag('latest');
    setCommitMessage(`Committed from container ${c.name} (${c.id.substring(0, 12)})`);
    setCommitAuthor(dockerAuth?.username || 'root');
    setCommitPause(true);
    setShowCommitModal(true);
  };

  const handleExecuteCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitTargetContainer || !commitRepo.trim()) return;
    setIsCommitting(true);
    try {
      const pauseFlag = commitPause ? '' : '--pause=false';
      const authorFlag = commitAuthor.trim() ? `-a "${commitAuthor.replace(/"/g, '\\"')}"` : '';
      const msgFlag = commitMessage.trim() ? `-m "${commitMessage.replace(/"/g, '\\"')}"` : '';
      const targetRef = `${commitRepo.trim()}:${commitTag.trim() || 'latest'}`;
      const cmd = `docker commit ${pauseFlag} ${authorFlag} ${msgFlag} ${commitTargetContainer.id} "${targetRef}"`.trim();
      const res = await sshExec(activeConnId, cmd);
      if (res.exit_code === 0) {
        showNotification(`Committed container ${commitTargetContainer.name} to ${targetRef}`);
        setShowCommitModal(false);
        setCommitTargetContainer(null);
        await loadDockerData();
      } else {
        showNotification(`Failed to commit container: ${res.stderr || res.stdout}`, 'error');
      }
    } catch (err: any) {
      showNotification(`Commit error: ${err?.message || err}`, 'error');
    } finally {
      setIsCommitting(false);
    }
  };

  // Download Docker Image to Local Machine (.tar.gz export & SFTP download)
  const handleDownloadImageLocal = async (img: ImageItem) => {
    setDownloadTargetImage(img);
    setIsDownloadingImage(true);
    setDownloadError(null);
    setDownloadStatusText('Exporting image on remote server (docker save | gzip)...');

    try {
      const imageRef = img.repository === '<none>' ? img.id : `${img.repository}:${img.tag}`;
      const safeName = (img.repository === '<none>' ? img.id.substring(0, 12) : `${img.repository}_${img.tag}`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const remoteArchive = `/tmp/docker_dl_${Date.now()}_${safeName}.tar.gz`;

      // 1. Export and compress image on remote host
      const exportRes = await sshExec(activeConnId, `docker save "${imageRef}" | gzip > "${remoteArchive}"`);
      if (exportRes.exit_code !== 0) {
        throw new Error(exportRes.stderr || exportRes.stdout || 'docker save failed on remote server');
      }

      // 2. Download via SFTP to local machine
      setDownloadStatusText('Downloading archive (.tar.gz) via SFTP to local machine...');
      const localSavedPath = await sftpDownloadToDownloads(activeConnId, remoteArchive);

      // 3. Remove remote temporary archive
      setDownloadStatusText('Cleaning up remote temporary file...');
      await sshExec(activeConnId, `rm -f "${remoteArchive}"`);

      setDownloadStatusText(`Saved to: ${localSavedPath || 'Downloads folder'}`);
      showNotification(`Image ${imageRef} downloaded to local machine!`);
      setTimeout(() => {
        setIsDownloadingImage(false);
        setDownloadTargetImage(null);
      }, 2500);
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      setDownloadError(errMsg);
      showNotification(`Download image failed: ${errMsg}`, 'error');
    }
  };

  // Open System Prune Modal
  const openPruneModal = async () => {
    setShowPruneModal(true);
    setSystemDfText('Calculating Docker disk usage...');
    try {
      const res = await sshExec(activeConnId, 'docker system df');
      setSystemDfText(res.stdout || 'Unable to retrieve disk usage.');
    } catch {
      setSystemDfText('docker system df command not available');
    }
  };

  const executePrune = async (type: 'all' | 'containers' | 'images' | 'volumes') => {
    setIsPruning(true);
    try {
      let cmd = 'docker system prune -f';
      if (type === 'all') cmd = 'docker system prune -a --volumes -f';
      else if (type === 'containers') cmd = 'docker container prune -f';
      else if (type === 'images') cmd = 'docker image prune -a -f';
      else if (type === 'volumes') cmd = 'docker volume prune -f';

      const res = await sshExec(activeConnId, cmd);
      alert(`Prune Result:\n${res.stdout || res.stderr || 'Cleanup complete'}`);
      await loadDockerData();
      setShowPruneModal(false);
    } catch (err: any) {
      alert(`Prune failed: ${err?.message || err}`);
    } finally {
      setIsPruning(false);
    }
  };

  // Common popular images catalog
  const popularImages = POPULAR_IMAGES;

  return (
    <div className={`flex flex-col h-full bg-[#181825] text-[#cdd6f4] select-none overflow-hidden font-sans ${(isLoading || !!actionLoadingId) ? 'cursor-wait' : ''}`}>
      
      {/* Toast Feedback Notification */}
      {actionFeedback && (
        <div className="fixed top-12 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className={`px-4 py-2.5 rounded-2xl shadow-2xl backdrop-blur-xl border flex items-center space-x-2.5 text-xs font-medium ${
            actionFeedback.type === 'success' 
              ? 'bg-emerald-950/85 border-emerald-500/40 text-emerald-200' 
              : 'bg-rose-950/85 border-rose-500/40 text-rose-200'
          }`}>
            {actionFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertTriangle className="w-4 h-4 text-rose-400" />}
            <span>{actionFeedback.message}</span>
          </div>
        </div>
      )}

      {/* macOS Top Header Toolbar (Hidden in Fullscreen Editor Mode) */}
      {!isEditorFullscreen && (
        <header className="px-5 py-3.5 bg-[#14141e]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between shrink-0 overflow-x-auto scrollbar-thin gap-3">
          
          {/* Left: App Identity & Server Status */}
          <div className="flex items-center space-x-3.5 shrink-0">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25 border border-white/20">
              <Container className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-semibold tracking-tight text-white">Docker Studio</span>
                {dockerDaemonState === 'running' && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Daemon Active</span>
                  </span>
                )}
                {dockerDaemonState === 'stopped' && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-[10px] text-rose-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                    <span>Daemon Stopped</span>
                  </span>
                )}
                {dockerDaemonState === 'not_installed' && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] text-amber-400 font-medium">
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                    <span>Not Installed</span>
                  </span>
                )}
                {dockerDaemonState === 'checking' && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-[10px] text-blue-400 font-medium">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    <span>Checking...</span>
                  </span>
                )}
                {dockerAuth?.loggedIn && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-[10px] text-blue-300 font-medium" title={`Docker Registry: ${dockerAuth.registry}`}>
                    <User className="w-3 h-3 text-blue-400" />
                    <span>{dockerAuth.username}</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-400 leading-none mt-0.5">
                {dockerAuth?.loggedIn 
                  ? `Logged in as ${dockerAuth.username} (${dockerAuth.registry})` 
                  : 'Container Engine & Cloud Deploy Studio'}
              </p>
            </div>
          </div>

        {/* Center: macOS Segmented Switcher */}
        <div className="mac-segmented-container shrink-0">
          <button
            onClick={() => setActiveTab('containers')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'containers' ? 'active' : ''}`}
          >
            <Container className="w-3.5 h-3.5" />
            <span>Containers</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'containers' ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}>
              {containers.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('images')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'images' ? 'active' : ''}`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Images</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'images' ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}>
              {images.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('volumes')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'volumes' ? 'active' : ''}`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>Volumes</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'volumes' ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}>
              {volumes.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('networks')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'networks' ? 'active' : ''}`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Networks</span>
            <span className={`ml-1 px-1.5 py-0.2 rounded-full text-[10px] ${activeTab === 'networks' ? 'bg-white/20 text-white' : 'bg-white/5 text-gray-400'}`}>
              {networks.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('editor')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'editor' ? 'active' : ''}`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>Docker Editor</span>
          </button>

          <button
            onClick={() => setActiveTab('system')}
            className={`mac-segmented-item flex items-center space-x-1.5 ${activeTab === 'system' ? 'active' : ''}`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>System & Prune</span>
          </button>
        </div>

        {/* Right: Quick Action Controls & User Auth */}
        <div className="flex items-center space-x-2 shrink-0">
          {/* Active Logged-in User Badge or Login Button */}
          {dockerAuth?.loggedIn ? (
            <div 
              onClick={() => setShowLoginModal(true)}
              className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-300 text-xs font-medium cursor-pointer hover:bg-blue-500/25 transition-all shadow-sm"
              title="Click to manage Docker account / Switch / Logout"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <User className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-semibold text-white">{dockerAuth.username}</span>
              <span className="text-[10px] text-blue-400 font-mono">({dockerAuth.registry})</span>
            </div>
          ) : (
            <button
              onClick={() => setShowLoginModal(true)}
              className="mac-btn mac-btn-secondary flex items-center space-x-1.5 text-xs text-gray-300 hover:text-white"
              title="Log in to Docker Registry"
            >
              <LogIn className="w-3.5 h-3.5 text-amber-400" />
              <span>Docker Login</span>
            </button>
          )}

          {/* Context-aware action buttons depending on active tab */}
          {activeTab === 'containers' && (
            <button
              onClick={() => setShowRunModal(true)}
              className="mac-btn mac-btn-primary mac-btn-sheen flex items-center space-x-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Run Container</span>
            </button>
          )}

          {activeTab === 'images' && (
            <button
              onClick={() => {
                setShowPullModal(true);
                setPullLogs('');
              }}
              className="mac-btn mac-btn-primary mac-btn-sheen flex items-center space-x-1.5"
            >
              <Download className="w-3.5 h-3.5 text-white" />
              <span>Pull Image</span>
            </button>
          )}

          {activeTab === 'volumes' && (
            <button
              onClick={() => setShowCreateVolumeModal(true)}
              className="mac-btn mac-btn-primary mac-btn-sheen flex items-center space-x-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Volume</span>
            </button>
          )}

          {activeTab === 'networks' && (
            <button
              onClick={() => setShowCreateNetworkModal(true)}
              className="mac-btn mac-btn-primary mac-btn-sheen flex items-center space-x-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Network</span>
            </button>
          )}

          {activeTab === 'editor' && (
            <>
              <button
                onClick={handleLoadEditorFile}
                className="mac-btn mac-btn-secondary flex items-center space-x-1.5 text-xs text-gray-200"
                title="Load file from remote server"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                <span>Load File</span>
              </button>
              <button
                onClick={handleSaveEditorFile}
                className="mac-btn mac-btn-secondary flex items-center space-x-1.5 text-xs text-gray-200"
                title="Save file to remote server"
              >
                <Save className="w-3.5 h-3.5 text-emerald-400" />
                <span>Save File</span>
              </button>
            </>
          )}

          {/* Live Auto-Refresh Toggle */}
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`mac-btn ${
              autoRefresh 
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm' 
                : 'mac-btn-secondary'
            }`}
            title="Auto-refresh every 5 seconds"
          >
            <Zap className={`w-3.5 h-3.5 inline mr-1 ${autoRefresh ? 'text-emerald-400 animate-pulse' : ''}`} />
            <span>5s</span>
          </button>

          {/* Manual Refresh */}
          <button
            onClick={loadDockerData}
            disabled={isLoading || !!actionLoadingId}
            className="mac-btn-icon"
            title="Refresh All Docker Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${(isLoading || !!actionLoadingId) ? 'animate-spin text-blue-400' : ''}`} />
          </button>
        </div>
      </header>
      )}
      {(isLoading || !!actionLoadingId) && (
        <div className="h-0.5 bg-gradient-to-r from-blue-500 via-indigo-400 to-blue-500 animate-top-progress z-30 shrink-0 pointer-events-none" />
      )}

      {/* Main Sub-Toolbar: Metrics & Filter Bar (Hidden in Fullscreen or Editor Mode) */}
      {!isEditorFullscreen && activeTab !== 'editor' && (
      <div className="px-5 py-3 bg-[#161622] border-b border-white/[0.06] flex items-center justify-between shrink-0 gap-4 overflow-x-auto scrollbar-thin">
        
        {/* 4 Metric Pill Cards */}
        <div className="flex items-center space-x-3 overflow-x-auto py-0.5">
          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] text-gray-400">Running:</span>
            <span className="text-xs font-bold text-white font-mono">{runningCount}</span>
            <span className="text-[10px] text-gray-500">/ {containers.length} total</span>
          </div>

          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[11px] text-gray-400">Images:</span>
            <span className="text-xs font-bold text-white font-mono">{images.length}</span>
          </div>

          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <HardDrive className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] text-gray-400">Volumes:</span>
            <span className="text-xs font-bold text-white font-mono">{volumes.length}</span>
          </div>

          <div className="flex items-center space-x-2.5 px-3 py-1.5 bg-[#1e1e2e] rounded-xl border border-white/10 shadow-sm">
            <Network className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] text-gray-400">Networks:</span>
            <span className="text-xs font-bold text-white font-mono">{networks.length}</span>
          </div>
        </div>

        {/* Search and Tab-Specific Filters */}
        <div className="flex items-center space-x-2.5">
          {activeTab === 'containers' && (
            <div className="flex items-center space-x-2">
              <div className="flex items-center bg-[#1e1e2e] p-0.5 rounded-xl border border-white/10 text-[11px]">
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${statusFilter === 'all' ? 'bg-white/15 text-white font-semibold' : 'text-gray-400 hover:text-white'}`}
                >
                  All
                </button>
                <button
                  onClick={() => setStatusFilter('running')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${statusFilter === 'running' ? 'bg-emerald-500/25 text-emerald-300 font-semibold' : 'text-gray-400 hover:text-white'}`}
                >
                  Running ({runningCount})
                </button>
                <button
                  onClick={() => setStatusFilter('stopped')}
                  className={`px-2.5 py-1 rounded-lg transition-all ${statusFilter === 'stopped' ? 'bg-rose-500/25 text-rose-300 font-semibold' : 'text-gray-400 hover:text-white'}`}
                >
                  Stopped ({stoppedCount + pausedCount})
                </button>
              </div>

              {/* Global Actions: Start All, Stop All, Restart All */}
              <div className="flex items-center space-x-1.5 border-l border-white/10 pl-2">
                <button
                  onClick={() => handleGlobalAction('start-all')}
                  disabled={!!actionLoadingId || stoppedCount + pausedCount === 0}
                  className="px-2 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-emerald-300 border border-emerald-500/20 text-[11px] font-medium flex items-center space-x-1 transition-all active:scale-95"
                  title="Start all stopped containers"
                >
                  {actionLoadingId === 'global' ? <Loader2 className="w-3 h-3 animate-spin text-emerald-400" /> : <PlayCircle className="w-3 h-3" />}
                  <span>Start All</span>
                </button>
                <button
                  onClick={() => handleGlobalAction('stop-all')}
                  disabled={!!actionLoadingId || runningCount === 0}
                  className="px-2 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-amber-300 border border-amber-500/20 text-[11px] font-medium flex items-center space-x-1 transition-all active:scale-95"
                  title="Stop all running containers"
                >
                  {actionLoadingId === 'global' ? <Loader2 className="w-3 h-3 animate-spin text-amber-400" /> : <StopCircle className="w-3 h-3" />}
                  <span>Stop All</span>
                </button>
                <button
                  onClick={() => handleGlobalAction('restart-all')}
                  disabled={!!actionLoadingId || runningCount === 0}
                  className="px-2 py-1 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 disabled:opacity-30 disabled:cursor-not-allowed text-cyan-300 border border-cyan-500/20 text-[11px] font-medium flex items-center space-x-1 transition-all active:scale-95"
                  title="Restart all running containers"
                >
                  {actionLoadingId === 'global' ? <Loader2 className="w-3 h-3 animate-spin text-cyan-400" /> : <RotateCw className="w-3 h-3" />}
                  <span>Restart All</span>
                </button>
              </div>
            </div>
          )}

          {/* Search Input Field */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder={`Filter ${activeTab}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-[#1e1e2e] border border-white/10 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all w-52"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Main Content Area */}
      <div className={`flex-1 min-h-0 ${isEditorFullscreen ? 'p-0' : 'p-5'} overflow-hidden flex flex-col`}>
        
        {/* Docker Daemon Inactive / Stopped Banner */}
        {dockerDaemonState === 'stopped' && (
          <div className="mb-4 p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-rose-500/10 to-amber-500/15 border border-amber-500/30 flex items-center justify-between gap-4 backdrop-blur-md shadow-xl animate-in fade-in shrink-0">
            <div className="flex items-center space-x-3.5">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <span>Docker Daemon is Inactive / Stopped</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">Service Down</span>
                </h4>
                <p className="text-xs text-gray-300 mt-0.5">The Docker service is installed on this host but not running. Start the service or enable it to run containers.</p>
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={handleStartDockerService}
                disabled={serviceActionLoading !== null}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold flex items-center space-x-2 shadow-lg active:scale-95 transition-all disabled:opacity-50"
              >
                {serviceActionLoading === 'start' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>Start Docker</span>
              </button>
              <button
                onClick={handleEnableDockerService}
                disabled={serviceActionLoading !== null}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white text-xs font-medium flex items-center space-x-1.5 active:scale-95 transition-all disabled:opacity-50"
                title="Enable Docker to start automatically on system boot"
              >
                {serviceActionLoading === 'enable' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5 text-amber-400" />}
                <span>Enable on Boot</span>
              </button>
              <button
                onClick={() => { checkDaemonStatus(); loadDockerData(); }}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-colors"
                title="Refresh Status"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Docker Engine Not Installed Banner */}
        {dockerDaemonState === 'not_installed' && (
          <div className="mb-4 p-4 rounded-2xl bg-gradient-to-r from-rose-500/15 via-purple-500/10 to-rose-500/15 border border-rose-500/30 flex items-center justify-between gap-4 backdrop-blur-md shadow-xl animate-in fade-in shrink-0">
            <div className="flex items-center space-x-3.5">
              <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-500/30 flex items-center justify-center shrink-0">
                <AlertCircle className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-white flex items-center space-x-2">
                  <span>Docker Engine is Not Installed</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">Binary Missing</span>
                </h4>
                <p className="text-xs text-gray-300 mt-0.5">The `docker` executable was not found on this server. Install the official Docker Community Edition package with 1 click.</p>
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={handleInstallDocker}
                disabled={serviceActionLoading !== null}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-semibold flex items-center space-x-2 shadow-lg active:scale-95 transition-all disabled:opacity-50"
              >
                {serviceActionLoading === 'install' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                <span>Install Docker Engine</span>
              </button>
              <button
                onClick={() => { checkDaemonStatus(); loadDockerData(); }}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-colors"
                title="Refresh Status"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Permission Alert Banner for Non-Sudo Users without Docker group */}
        {!isDockerPermitted && (
          <PermissionAlertBanner 
            appName="Docker Manager" 
            customMessage={`Logged in as standard user '${username}'. Accessing the Docker daemon requires administrator (sudo) privileges or membership in the 'docker' group. Ask your server administrator to run: sudo usermod -aG docker ${username}`}
          />
        )}

        {/* 1. CONTAINERS VIEW */}
        {activeTab === 'containers' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            
            {/* Bulk Actions Floating/Docked Toolbar */}
            {selectedContainerIds.size > 0 && (
              <div className="px-4 py-2 bg-gradient-to-r from-blue-900/40 via-indigo-900/40 to-blue-900/40 border-b border-blue-500/30 flex items-center justify-between shrink-0 animate-in fade-in slide-in-from-top-1">
                <div className="flex items-center space-x-2 text-xs text-blue-200">
                  <CheckSquare className="w-4 h-4 text-blue-400" />
                  <span className="font-semibold">{selectedContainerIds.size} container{selectedContainerIds.size > 1 ? 's' : ''} selected</span>
                </div>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleBulkAction('start')}
                    disabled={!!actionLoadingId}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 disabled:opacity-40 text-emerald-300 border border-emerald-500/30 text-xs font-medium flex items-center space-x-1.5 transition-all active:scale-95"
                    title="Start selected containers"
                  >
                    {actionLoadingId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin text-emerald-400" /> : <Play className="w-3 h-3 fill-current" />}
                    <span>Start Selected</span>
                  </button>
                  <button
                    onClick={() => handleBulkAction('stop')}
                    disabled={!!actionLoadingId}
                    className="px-2.5 py-1 rounded-lg bg-amber-600/30 hover:bg-amber-600/50 disabled:opacity-40 text-amber-300 border border-amber-500/30 text-xs font-medium flex items-center space-x-1.5 transition-all active:scale-95"
                    title="Stop selected containers"
                  >
                    {actionLoadingId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin text-amber-400" /> : <Square className="w-3 h-3 fill-current" />}
                    <span>Stop Selected</span>
                  </button>
                  <button
                    onClick={() => handleBulkAction('restart')}
                    disabled={!!actionLoadingId}
                    className="px-2.5 py-1 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 disabled:opacity-40 text-cyan-300 border border-cyan-500/30 text-xs font-medium flex items-center space-x-1.5 transition-all active:scale-95"
                    title="Restart selected containers"
                  >
                    {actionLoadingId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin text-cyan-400" /> : <RotateCw className="w-3 h-3" />}
                    <span>Restart Selected</span>
                  </button>
                  <button
                    onClick={() => handleBulkAction('delete')}
                    disabled={!!actionLoadingId}
                    className="px-2.5 py-1 rounded-lg bg-rose-600/30 hover:bg-rose-600/50 disabled:opacity-40 text-rose-300 border border-rose-500/30 text-xs font-medium flex items-center space-x-1.5 transition-all active:scale-95"
                    title="Force remove selected containers"
                  >
                    {actionLoadingId === 'bulk' ? <Loader2 className="w-3 h-3 animate-spin text-rose-400" /> : <Trash2 className="w-3 h-3" />}
                    <span>Delete Selected</span>
                  </button>
                  <button
                    onClick={() => setSelectedContainerIds(new Set())}
                    className="text-xs text-gray-400 hover:text-white px-2 py-1 transition-colors"
                  >
                    Deselect
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 sticky top-0 z-10 shadow-md uppercase tracking-wider font-mono text-[10px]">
                  <tr>
                    <th className="py-3 px-3 w-10 text-center">
                      <input 
                        type="checkbox"
                        aria-label="Select all containers"
                        checked={filteredContainers.length > 0 && filteredContainers.every(c => selectedContainerIds.has(c.id))}
                        onChange={toggleSelectAllContainers}
                        className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 focus:outline-none cursor-pointer"
                      />
                    </th>
                    <th className="py-3 px-3 w-28">Status</th>
                    <th className="py-3 px-4">Container</th>
                    <th className="py-3 px-4">Image</th>
                    <th className="py-3 px-4">Port Bindings</th>
                    <th className="py-3 px-4 w-32">Created</th>
                    <th className="py-3 px-4 text-right pr-6 w-52">Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredContainers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-20 text-center">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <Container className="w-10 h-10 text-gray-600 stroke-[1.5]" />
                          <div className="text-gray-400 font-medium">
                            {isLoading ? 'Querying local Docker daemon...' : 'No containers found matching criteria'}
                          </div>
                          <button
                            onClick={() => setShowRunModal(true)}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium shadow-md transition-all"
                          >
                            Launch First Container
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredContainers.map((c, idx) => (
                      <tr 
                        key={c.id} 
                        id={`docker-row-containers-${idx}`}
                        onClick={() => setSelectedRowIndex(idx)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSelectedRowIndex(idx);
                          setContextMenu({ x: e.clientX, y: e.clientY, type: 'container', container: c });
                        }}
                        className={`group transition-all ${
                          selectedRowIndex === idx
                            ? 'bg-blue-600/25 ring-1 ring-blue-500/40 text-white shadow-sm'
                            : selectedContainerIds.has(c.id) 
                            ? 'bg-blue-600/15 border-blue-500/30' 
                            : idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]'
                        } hover:bg-blue-500/10 cursor-pointer`}
                      >
                        {/* Checkbox */}
                        <td className="py-3 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox"
                            aria-label={`Select container ${c.name}`}
                            checked={selectedContainerIds.has(c.id)}
                            onChange={(e) => toggleSelectContainer(c.id, e)}
                            className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 focus:outline-none cursor-pointer"
                          />
                        </td>

                        {/* Status */}
                        <td className="py-3 px-3">
                          <span className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase border ${
                            c.status === 'running'
                              ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                              : c.status === 'paused'
                              ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                              : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              c.status === 'running' ? 'bg-emerald-400 animate-pulse' : c.status === 'paused' ? 'bg-amber-400' : 'bg-rose-400'
                            }`} />
                            <span>{c.status}</span>
                          </span>
                        </td>

                        {/* Container Name & ID */}
                        <td className="py-3 px-4">
                          <div className="flex items-center space-x-2">
                            <span 
                              onClick={() => openInspector(c)}
                              className="font-mono font-bold text-white hover:text-blue-400 cursor-pointer transition-colors"
                              title="Click to view Container Inspector (Right-click for options)"
                            >
                              {c.name}
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-gray-500 mt-0.5">
                            ID: {c.id}
                          </div>
                        </td>

                        {/* Image */}
                        <td className="py-3 px-4">
                          {c.image.includes(':') ? (
                            <span className="font-mono text-xs bg-[#13141f] px-2 py-0.5 rounded border border-white/10 inline-flex items-center space-x-0.5">
                              <span className="text-purple-300 font-semibold">{c.image.split(':')[0]}</span>
                              <span className="text-gray-500">:</span>
                              <span className="text-emerald-300 font-bold">{c.image.split(':')[1]}</span>
                            </span>
                          ) : (
                            <span className="font-mono text-xs text-purple-300 bg-[#13141f] px-2 py-0.5 rounded border border-white/10 font-semibold">
                              {c.image}
                            </span>
                          )}
                        </td>

                        {/* Ports */}
                        <td className="py-3 px-4">
                          {c.ports ? (
                            <span className="font-mono text-[11px] text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 px-2 py-0.5 rounded">
                              {c.ports}
                            </span>
                          ) : (
                            <span className="font-mono text-[11px] text-gray-500">—</span>
                          )}
                        </td>

                        {/* Created / Uptime */}
                        <td className="py-3 px-4 text-gray-400 text-xs">
                          {c.created}
                        </td>

                        {/* Controls */}
                        <td className="py-3 px-4 text-right pr-6">
                          <div className="flex items-center justify-end space-x-1">
                            {/* Start/Stop */}
                            {c.status === 'running' ? (
                              <button
                                onClick={() => handleAction(c.id, 'stop', c.name)}
                                disabled={actionLoadingId === `c-stop-${c.id}`}
                                className="p-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-50 text-amber-400 transition-all border border-amber-500/20 active:scale-95"
                                title="Stop Container"
                              >
                                {actionLoadingId === `c-stop-${c.id}` ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                                ) : (
                                  <Square className="w-3.5 h-3.5 fill-current" />
                                )}
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAction(c.id, 'start', c.name)}
                                disabled={actionLoadingId === `c-start-${c.id}`}
                                className="p-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 disabled:opacity-50 text-emerald-400 transition-all border border-emerald-500/20 active:scale-95"
                                title="Start Container"
                              >
                                {actionLoadingId === `c-start-${c.id}` ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                ) : (
                                  <Play className="w-3.5 h-3.5 fill-current" />
                                )}
                              </button>
                            )}

                            {/* Restart */}
                            <button
                              onClick={() => handleAction(c.id, 'restart', c.name)}
                              disabled={actionLoadingId === `c-restart-${c.id}`}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-50 text-cyan-400 transition-all border border-white/10 active:scale-95"
                              title="Restart Container"
                            >
                              {actionLoadingId === `c-restart-${c.id}` ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" />
                              ) : (
                                <RotateCw className="w-3.5 h-3.5" />
                              )}
                            </button>

                            {/* Logs */}
                            <button
                              onClick={() => openLogs(c)}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-blue-400 transition-all border border-white/10 active:scale-95"
                              title="Live Streaming Logs"
                            >
                              <FileText className="w-3.5 h-3.5" />
                            </button>

                            {/* Inspect */}
                            <button
                              onClick={() => openInspector(c)}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-purple-400 transition-all border border-white/10 active:scale-95"
                              title="Container Inspector"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>

                            {/* Terminal 1: Quick Exec (One-line cmd modal) */}
                            <button
                              onClick={() => {
                                setExecTarget(c);
                                setExecCmd('uptime');
                                setExecOutput('');
                              }}
                              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-blue-400 transition-all border border-white/10 active:scale-95"
                              title="Quick Exec (One-line command modal)"
                            >
                              <Terminal className="w-3.5 h-3.5" />
                            </button>

                            {/* Terminal 2: Interactive Terminal in Terminal App */}
                            <button
                              onClick={() => handleOpenInteractiveTerminal(c)}
                              className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-all border border-emerald-500/20 active:scale-95"
                              title="Interactive Terminal (Connect container in Terminal app)"
                            >
                              <TerminalSquare className="w-3.5 h-3.5" />
                            </button>

                            {/* Commit Container to Image */}
                            <button
                              onClick={() => handleOpenCommitModal(c)}
                              className="p-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 transition-all border border-indigo-500/20 active:scale-95"
                              title="Commit Container to Image (docker commit)"
                            >
                              <GitCommit className="w-3.5 h-3.5" />
                            </button>

                            {/* Delete Container */}
                            <button
                              onClick={() => promptDeleteContainer(c)}
                              disabled={actionLoadingId === `c-rm -f-${c.id}` || isDeletingResource}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-400 transition-all border border-rose-500/20 active:scale-95 cursor-pointer"
                              title="Delete Container"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 2. IMAGES VIEW */}
        {activeTab === 'images' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 sticky top-0 z-10 shadow-md uppercase tracking-wider font-mono text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Repository</th>
                    <th className="py-3 px-4 w-28">Tag</th>
                    <th className="py-3 px-4 w-36">Image ID</th>
                    <th className="py-3 px-4 w-28">Size</th>
                    <th className="py-3 px-4 w-36">Created</th>
                    <th className="py-3 px-4 text-right pr-6 w-36">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredImages.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-20 text-center">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <Layers className="w-10 h-10 text-gray-600 stroke-[1.5]" />
                          <div className="text-gray-400 font-medium">
                            {isLoading ? 'Querying local Docker images...' : 'No Docker images found'}
                          </div>
                          <button
                            onClick={() => setShowPullModal(true)}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium shadow-md transition-all"
                          >
                            Pull an Image
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredImages.map((img, idx) => {
                      const usingContainers = getContainersUsingImage(img);
                      const isUsed = usingContainers.length > 0;
                      return (
                        <tr 
                          key={img.id}
                          id={`docker-row-images-${idx}`}
                          onClick={() => setSelectedRowIndex(idx)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setSelectedRowIndex(idx);
                            setContextMenu({ x: e.clientX, y: e.clientY, type: 'image', image: img });
                          }}
                          className={`group transition-all ${
                            selectedRowIndex === idx
                              ? 'bg-blue-600/25 ring-1 ring-blue-500/40 text-white shadow-sm'
                              : idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]'
                          } hover:bg-blue-500/10 cursor-pointer`}
                        >
                          <td className="py-3 px-4 font-medium text-white flex items-center space-x-2">
                            <Layers className="w-4 h-4 text-purple-400 shrink-0" />
                            <span className="font-mono text-purple-300 font-semibold">{img.repository}</span>
                            {isUsed && (
                              <span 
                                className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] bg-amber-500/15 border border-amber-500/30 text-amber-300 font-normal shrink-0" 
                                title={`In use by ${usingContainers.length} container(s):\n${usingContainers.map(c => `• ${c.name} (${c.status})`).join('\n')}`}
                              >
                                <Lock className="w-2.5 h-2.5 text-amber-400" />
                                <span>In use ({usingContainers.length})</span>
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-mono text-[11px] bg-emerald-500/15 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30 font-bold">
                              {img.tag}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-cyan-300 text-[11px]">{img.id}</td>
                          <td className="py-3 px-4 font-mono text-amber-300 text-xs font-semibold">{img.size}</td>
                          <td className="py-3 px-4 text-gray-400">{img.created}</td>
                          <td className="py-3 px-4 text-right pr-6">
                            <div className="flex items-center justify-end space-x-1.5">
                              {/* Run this image */}
                              <button
                                onClick={() => {
                                  setRunImage(`${img.repository}:${img.tag}`);
                                  setShowRunModal(true);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-medium flex items-center space-x-1 active:scale-95 transition-all"
                                title="Run a new container from this image"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>Run</span>
                              </button>

                              {/* Push to Registry (if logged in) */}
                              {dockerAuth?.loggedIn && img.repository !== '<none>' && (
                                <button
                                  onClick={() => handlePushImage(img)}
                                  disabled={actionLoadingId === `push-${img.id}`}
                                  className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium flex items-center space-x-1 active:scale-95 transition-all disabled:opacity-50"
                                  title={`Push ${img.repository}:${img.tag} to registry (${dockerAuth.registry})`}
                                >
                                  {actionLoadingId === `push-${img.id}` ? (
                                    <Loader2 className="w-3 h-3 animate-spin text-indigo-400" />
                                  ) : (
                                    <Upload className="w-3 h-3 text-indigo-400" />
                                  )}
                                  <span>Push</span>
                                </button>
                              )}

                              {/* Tag Image (docker tag) */}
                              <button
                                onClick={() => handleOpenTagModal(img)}
                                className="p-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 transition-all border border-cyan-500/20 active:scale-95"
                                title="Tag Image (docker tag)"
                              >
                                <Tag className="w-3.5 h-3.5" />
                              </button>

                              {/* Download Image to Local Machine (.tar.gz via SFTP) */}
                              <button
                                onClick={() => handleDownloadImageLocal(img)}
                                disabled={isDownloadingImage && downloadTargetImage?.id === img.id}
                                className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-50 text-emerald-400 transition-all border border-emerald-500/20 active:scale-95"
                                title="Download Image to Local Machine (.tar.gz via SFTP)"
                              >
                                {isDownloadingImage && downloadTargetImage?.id === img.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                              </button>

                              {/* Delete image with in-use protection */}
                              {isUsed ? (
                                <button
                                  onClick={() => handleDeleteImage(img)}
                                  className="p-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 active:scale-95 transition-all"
                                  title={`Cannot delete: Image is currently in use by ${usingContainers.length} container(s). Click to view details.`}
                                >
                                  <Lock className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleDeleteImage(img)}
                                  disabled={actionLoadingId === `img-del-${img.id}`}
                                  className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-400 border border-rose-500/20 active:scale-95 transition-all"
                                  title="Delete Image"
                                >
                                  {actionLoadingId === `img-del-${img.id}` ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3. VOLUMES VIEW */}
        {activeTab === 'volumes' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 sticky top-0 z-10 shadow-md uppercase tracking-wider font-mono text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Volume Name</th>
                    <th className="py-3 px-4 w-32">Driver</th>
                    <th className="py-3 px-4 w-32">Scope</th>
                    <th className="py-3 px-4 text-right pr-6 w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredVolumes.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-20 text-center">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <HardDrive className="w-10 h-10 text-gray-600 stroke-[1.5]" />
                          <div className="text-gray-400 font-medium">No Docker storage volumes found</div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredVolumes.map((vol, idx) => (
                      <tr 
                        key={vol.name}
                        id={`docker-row-volumes-${idx}`}
                        onClick={() => setSelectedRowIndex(idx)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSelectedRowIndex(idx);
                          setContextMenu({ x: e.clientX, y: e.clientY, type: 'volume', volume: vol });
                        }}
                        className={`group transition-all ${
                          selectedRowIndex === idx
                            ? 'bg-blue-600/25 ring-1 ring-blue-500/40 text-white shadow-sm'
                            : idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]'
                        } hover:bg-blue-500/10 cursor-pointer`}
                      >
                        <td className="py-3 px-4 font-mono font-medium text-white flex items-center space-x-2">
                          <HardDrive className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="truncate max-w-md text-amber-300 font-semibold">{vol.name}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-emerald-300 text-[11px]">{vol.driver}</td>
                        <td className="py-3 px-4 font-mono text-cyan-300 text-[11px]">{vol.scope}</td>
                        <td className="py-3 px-4 text-right pr-6">
                          <button
                            onClick={() => handleDeleteVolume(vol.name)}
                            className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 active:scale-95 transition-all"
                            title="Remove Volume"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. NETWORKS VIEW */}
        {activeTab === 'networks' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            <div className="flex-1 overflow-y-auto overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 sticky top-0 z-10 shadow-md uppercase tracking-wider font-mono text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Network Name</th>
                    <th className="py-3 px-4 w-36">Network ID</th>
                    <th className="py-3 px-4 w-32">Driver</th>
                    <th className="py-3 px-4 w-32">Scope</th>
                    <th className="py-3 px-4 text-right pr-6 w-28">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {filteredNetworks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-20 text-center">
                        <div className="flex flex-col items-center justify-center space-y-3">
                          <Network className="w-10 h-10 text-gray-600 stroke-[1.5]" />
                          <div className="text-gray-400 font-medium">No Docker networks found</div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredNetworks.map((net, idx) => (
                      <tr 
                        key={net.id}
                        id={`docker-row-networks-${idx}`}
                        onClick={() => setSelectedRowIndex(idx)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setSelectedRowIndex(idx);
                          setContextMenu({ x: e.clientX, y: e.clientY, type: 'network', network: net });
                        }}
                        className={`group transition-all ${
                          selectedRowIndex === idx
                            ? 'bg-blue-600/25 ring-1 ring-blue-500/40 text-white shadow-sm'
                            : idx % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.015]'
                        } hover:bg-blue-500/10 cursor-pointer`}
                      >
                        <td className="py-3 px-4 font-mono font-medium text-white flex items-center space-x-2">
                          <Network className="w-4 h-4 text-cyan-400 shrink-0" />
                          <span className="text-cyan-300 font-semibold">{net.name}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-purple-300 text-[11px]">{net.id}</td>
                        <td className="py-3 px-4 font-mono text-gray-300">
                          <span className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 font-bold text-[11px]">{net.driver}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-gray-300 text-[11px]">{net.scope}</td>
                        <td className="py-3 px-4 text-right pr-6">
                          {['bridge', 'host', 'none'].includes(net.name) ? (
                            <span className="text-[10px] text-gray-500 uppercase tracking-wider">System</span>
                          ) : (
                            <button
                              onClick={() => handleDeleteNetwork(net.id, net.name)}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 active:scale-95 transition-all"
                              title="Delete Network"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 5. DOCKER EDITOR VIEW (Dockerfile & Docker Compose) */}
        {activeTab === 'editor' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden backdrop-blur-md">
            
            {/* Editor Sub-Header Toolbar */}
            <div className="px-5 py-3 bg-[#14141e]/80 border-b border-white/10 flex items-center justify-between shrink-0 gap-4 flex-wrap">
              {/* Left: Mode Switcher (Dockerfile vs Compose) */}
              <div className="flex items-center space-x-2">
                <div className="flex items-center p-0.5 rounded-xl bg-black/40 border border-white/10">
                  <button
                    onClick={() => handleEditorModeSwitch('dockerfile')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-all ${
                      editorMode === 'dockerfile'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <FileCode className="w-3.5 h-3.5" />
                    <span>Dockerfile</span>
                  </button>
                  <button
                    onClick={() => handleEditorModeSwitch('compose')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-all ${
                      editorMode === 'compose'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Docker Compose</span>
                  </button>
                </div>

                {/* Template Preset Dropdown */}
                <div className="flex items-center space-x-1.5 ml-2">
                  <span className="text-[11px] text-gray-400 font-medium">Template:</span>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl bg-[#1a1a28] border border-white/10 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                  >
                    {editorMode === 'dockerfile' ? (
                      <>
                        <option value="nodejs">Node.js (React / Vite Multi-Stage)</option>
                        <option value="python">Python (FastAPI / Flask Slim)</option>
                        <option value="golang">Go (Alpine Statically Linked)</option>
                        <option value="nginx">Nginx (Static Web Server)</option>
                        <option value="rust">Rust (Alpine Musl Binary)</option>
                        <option value="blank">Blank Dockerfile</option>
                      </>
                    ) : (
                      <>
                        <option value="web_db_redis">Full Stack (App + Postgres + Redis)</option>
                        <option value="lamp">LAMP Stack (Apache + PHP + MariaDB)</option>
                        <option value="monitoring">Monitoring (Prometheus + Grafana)</option>
                        <option value="blank">Blank Docker Compose</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {/* Center: Remote Working Directory */}
              <div className="flex items-center space-x-2 flex-1 max-w-md">
                <span className="text-[11px] text-gray-400 font-medium shrink-0">Working Dir:</span>
                <input
                  type="text"
                  value={editorPath}
                  onChange={(e) => setEditorPath(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="/tmp/docker-build"
                />
              </div>

              {/* Right: Actions */}
              <div className="flex items-center space-x-2">
                {/* Straight Split Adjuster Controls */}
                <div className="flex items-center space-x-1 px-2 py-1 rounded-xl bg-black/40 border border-white/10">
                  <button
                    onClick={() => setEditorLayout(l => l === 'side-by-side' ? 'stacked' : 'side-by-side')}
                    className="p-1 rounded text-gray-400 hover:text-white transition-colors"
                    title={editorLayout === 'side-by-side' ? "Switch to Stacked View" : "Switch to Side-by-Side Straight Split"}
                  >
                    {editorLayout === 'side-by-side' ? <Columns className="w-3.5 h-3.5 text-blue-400" /> : <Rows className="w-3.5 h-3.5 text-purple-400" />}
                  </button>
                  <span className="text-[10px] text-gray-400 font-mono">Split:</span>
                  <input
                    type="range"
                    min="25"
                    max="75"
                    value={editorSplitRatio}
                    onChange={(e) => setEditorSplitRatio(Number(e.target.value))}
                    className="w-16 h-1 bg-white/20 rounded appearance-none cursor-pointer accent-blue-500"
                    title={`Adjust straight split line: ${editorSplitRatio}% / ${100 - editorSplitRatio}%`}
                  />
                  <span className="text-[10px] text-gray-400 font-mono w-6 text-right">{editorSplitRatio}%</span>
                </div>

                {/* Monaco Zoom & Word Wrap Controls (VS Code Shortcuts) */}
                <div className="flex items-center space-x-1 px-2 py-1 rounded-xl bg-black/40 border border-white/10">
                  <button
                    onClick={() => setEditorFontSize(prev => Math.max(9, prev - 1))}
                    className="p-1 rounded text-gray-400 hover:text-white transition-colors"
                    title="Zoom Out (Ctrl + -)"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] text-blue-400 font-mono w-7 text-center">{editorFontSize}px</span>
                  <button
                    onClick={() => setEditorFontSize(prev => Math.min(32, prev + 1))}
                    className="p-1 rounded text-gray-400 hover:text-white transition-colors"
                    title="Zoom In (Ctrl + +)"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <div className="w-[1px] h-3 bg-white/20 mx-0.5" />
                  <button
                    onClick={() => setEditorWordWrap(prev => (prev === 'on' ? 'off' : 'on'))}
                    className={`p-1 rounded transition-colors ${
                      editorWordWrap === 'on' ? 'text-blue-400 bg-blue-500/20' : 'text-gray-400 hover:text-white'
                    }`}
                    title={`Toggle Word Wrap: ${editorWordWrap.toUpperCase()} (Alt + Z)`}
                  >
                    <WrapText className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Full Screen Editor Toggle */}
                <button
                  onClick={() => setIsEditorFullscreen(!isEditorFullscreen)}
                  className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center space-x-1.5 transition-all ${
                    isEditorFullscreen
                      ? 'bg-blue-600 border-blue-500 text-white shadow-md'
                      : 'bg-white/5 border-white/10 text-gray-300 hover:text-white hover:bg-white/10'
                  }`}
                  title={isEditorFullscreen ? "Exit Full Screen (Esc)" : "Full Screen Editor (Hide navigation)"}
                >
                  {isEditorFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  <span>{isEditorFullscreen ? 'Exit Full Screen' : 'Full Screen'}</span>
                </button>

                {/* Cancel Running Build / Command Button */}
                {isEditorRunning && (
                  <button
                    onClick={handleCancelBuild}
                    className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center space-x-1.5 shadow-md active:scale-95 transition-all animate-pulse"
                    title="Cancel running build or execution"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span>Cancel Build</span>
                  </button>
                )}

                {editorMode === 'dockerfile' ? (
                  <>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-[11px] text-gray-400 shrink-0">Tag:</span>
                      <input
                        type="text"
                        value={editorImageTag}
                        onChange={(e) => setEditorImageTag(e.target.value)}
                        className="w-32 px-2.5 py-1 rounded-lg bg-black/30 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-blue-500"
                        placeholder="myapp:latest"
                      />
                    </div>
                    <button
                      onClick={handleBuildImage}
                      disabled={isEditorRunning}
                      className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 text-white text-xs font-medium flex items-center space-x-1.5 shadow-md active:scale-95 transition-all"
                    >
                      {isEditorRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Hammer className="w-3.5 h-3.5" />}
                      <span>Build Image</span>
                    </button>
                    <button
                      onClick={handleBuildAndRun}
                      disabled={isEditorRunning}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 disabled:opacity-50 text-xs font-medium flex items-center space-x-1.5 active:scale-95 transition-all"
                      title="Build image and immediately run a container"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Build & Run</span>
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleComposeCommand('up')}
                      disabled={isEditorRunning}
                      className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 text-white text-xs font-medium flex items-center space-x-1.5 shadow-md active:scale-95 transition-all"
                    >
                      {isEditorRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      <span>Compose Up (-d)</span>
                    </button>
                    <button
                      onClick={() => handleComposeCommand('down')}
                      disabled={isEditorRunning}
                      className="px-3 py-1.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 disabled:opacity-50 text-xs font-medium flex items-center space-x-1.5 active:scale-95 transition-all"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                      <span>Down</span>
                    </button>
                    <button
                      onClick={() => handleComposeCommand('restart')}
                      disabled={isEditorRunning}
                      className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 text-xs font-medium flex items-center space-x-1 active:scale-95 transition-all"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Restart</span>
                    </button>
                    <button
                      onClick={() => handleComposeCommand('logs')}
                      disabled={isEditorRunning}
                      className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 text-xs font-medium flex items-center space-x-1 active:scale-95 transition-all"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Logs</span>
                    </button>
                    <button
                      onClick={() => handleComposeCommand('ps')}
                      disabled={isEditorRunning}
                      className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10 text-xs font-medium flex items-center space-x-1 active:scale-95 transition-all"
                    >
                      <Activity className="w-3.5 h-3.5" />
                      <span>PS</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Straight Line Split View: Monaco Editor on Left, Live Output Stream on Right (or Stacked) */}
            <div className={`flex-1 min-h-0 flex ${editorLayout === 'side-by-side' ? 'flex-row' : 'flex-col'} overflow-hidden`}>
              {/* Left / Top: Monaco Code Editor with VS Code Dark Colors & Autocomplete */}
              <div 
                style={{ 
                  flex: editorLayout === 'side-by-side' ? `0 0 ${editorSplitRatio}%` : undefined,
                  height: editorLayout === 'stacked' ? `${editorSplitRatio}%` : undefined 
                }}
                className="min-h-0 min-w-0 relative bg-[#1e1e2e] flex flex-col"
              >
                <div className="flex-1 min-h-0 relative">
                  <Editor
                    height="100%"
                    language={editorMode === 'dockerfile' ? 'dockerfile' : 'yaml'}
                    value={editorContent}
                    onChange={(val) => setEditorContent(val || '')}
                    onMount={handleEditorDidMount}
                    theme="docker-dark"
                    options={{
                      fontSize: editorFontSize,
                      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      lineNumbers: 'on',
                      wordWrap: editorWordWrap,
                      automaticLayout: true,
                      padding: { top: 8, bottom: 8 },
                      tabSize: 2,
                      renderLineHighlight: 'all',
                    }}
                  />
                </div>
              </div>

              {/* Straight line divider with drag/visual adjuster */}
              <div 
                className={`bg-white/10 hover:bg-blue-500/50 transition-colors flex items-center justify-center shrink-0 ${
                  editorLayout === 'side-by-side' ? 'w-1.5 cursor-col-resize hover:w-2' : 'h-1.5 cursor-row-resize hover:h-2'
                }`}
                title={`Straight divider line (${editorSplitRatio}% / ${100 - editorSplitRatio}%)`}
              >
                <div className={`rounded-full bg-white/30 ${editorLayout === 'side-by-side' ? 'w-0.5 h-6' : 'h-0.5 w-6'}`} />
              </div>

              {/* Right / Bottom: Live Streaming Execution Output Console */}
              <div className="flex-1 min-h-0 min-w-0 bg-[#0d0d15] flex flex-col border-white/10">
                <div className="px-4 py-2 bg-[#10101b] border-b border-white/10 flex items-center justify-between shrink-0">
                  <div className="flex items-center space-x-2">
                    <Terminal className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs font-mono font-bold text-gray-300">Live Execution Output</span>
                    {isEditorRunning && (
                      <span className="flex items-center space-x-1 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full font-mono animate-pulse">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        <span>Streaming Live...</span>
                      </span>
                    )}
                    {editorExitCode !== null && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                        editorExitCode === 0
                          ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                          : 'bg-rose-500/15 border-rose-500/30 text-rose-400'
                      }`}>
                        Exit Code: {editorExitCode}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {/* Console Zoom Controls */}
                    <div className="flex items-center bg-white/5 rounded-lg border border-white/10 px-1 py-0.5 space-x-1 text-gray-300">
                      <button
                        type="button"
                        onClick={() => setConsoleFontSize(prev => Math.max(9, prev - 1))}
                        className="hover:text-white text-gray-400 p-0.5 cursor-pointer"
                        title="Zoom Out Console"
                      >
                        <ZoomOut className="w-3 h-3" />
                      </button>
                      <span className="text-[10px] font-mono px-0.5">{consoleFontSize}px</span>
                      <button
                        type="button"
                        onClick={() => setConsoleFontSize(prev => Math.min(22, prev + 1))}
                        className="hover:text-white text-blue-400 p-0.5 cursor-pointer"
                        title="Zoom In Console"
                      >
                        <ZoomIn className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Word Wrap Toggle */}
                    <button
                      type="button"
                      onClick={() => setConsoleWordWrap(!consoleWordWrap)}
                      className={`p-1 rounded-lg border transition-all cursor-pointer ${
                        consoleWordWrap ? 'bg-blue-600/30 text-blue-300 border-blue-500/40' : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                      }`}
                      title="Toggle Word Wrap"
                    >
                      <WrapText className="w-3 h-3" />
                    </button>

                    {isEditorRunning && (
                      <button
                        onClick={handleCancelBuild}
                        className="px-2 py-1 rounded bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/30 text-[11px] flex items-center space-x-1 transition-colors cursor-pointer"
                        title="Cancel running operation"
                      >
                        <Square className="w-3 h-3 fill-current" />
                        <span>Stop</span>
                      </button>
                    )}
                    {editorOutput && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(editorOutput);
                          showNotification('Copied output to clipboard');
                        }}
                        className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-gray-300 flex items-center space-x-1 transition-colors cursor-pointer"
                      >
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setEditorOutput('');
                        setEditorExitCode(null);
                      }}
                      className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-gray-400 hover:text-white transition-colors cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {/* Live CLI Snippet Bar */}
                <div className="px-3 py-1.5 bg-[#0a0a12] border-b border-white/5">
                  <DockerCommandSnippet 
                    command={
                      editorMode === 'dockerfile'
                        ? `docker build -t ${editorImageTag} ${editorPath}`
                        : `docker compose -f ${editorPath}/docker-compose.yml up -d`
                    }
                    label={editorMode === 'dockerfile' ? 'Build CLI' : 'Compose CLI'}
                  />
                </div>

                <div 
                  style={{ fontSize: `${consoleFontSize}px` }}
                  className={`flex-1 p-3 overflow-y-auto font-mono text-gray-300 leading-relaxed select-text ${
                    consoleWordWrap ? 'whitespace-pre-wrap' : 'whitespace-pre overflow-x-auto'
                  }`}
                >
                  {editorOutput ? (
                    editorOutput.split('\n').map((line, idx) => (
                      <DockerBuildOutputLine key={idx} line={line} index={idx} />
                    ))
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-600 italic text-xs py-10 space-y-2">
                      <FileCode className="w-8 h-8 text-gray-700" />
                      <span>No command output yet. Click "Build Image" or "Compose Up" to see live stdout/stderr here.</span>
                    </div>
                  )}
                  <div ref={consoleOutputEndRef} />
                </div>
              </div>
            </div>

          </div>
        )}

        {/* 6. SYSTEM & PRUNE VIEW */}
        {activeTab === 'system' && (
          <div className="flex-1 min-h-0 bg-[#1e1e2e]/90 rounded-2xl border border-white/10 shadow-2xl p-6 overflow-y-auto backdrop-blur-md space-y-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Shield className="w-5 h-5 text-blue-400" />
                  <span>Docker System Maintenance & Prune</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">Clean up unused containers, dangling images, dangling networks, and build caches</p>
              </div>

              <button
                onClick={openPruneModal}
                className="px-4 py-2 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-medium text-xs rounded-xl shadow-lg shadow-rose-600/20 active:scale-95 transition-all flex items-center space-x-2"
              >
                <Trash2 className="w-4 h-4" />
                <span>Open Prune Assistant</span>
              </button>
            </div>

            {/* Disk Space & Resources Overview */}
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-[#14141e] p-4 rounded-xl border border-white/10">
                <div className="flex items-center justify-between text-gray-400 text-xs">
                  <span>Containers Footprint</span>
                  <Container className="w-4 h-4 text-blue-400" />
                </div>
                <div className="text-2xl font-bold mt-2 text-white font-mono">{containers.length}</div>
                <div className="text-xs text-gray-500 mt-1">{runningCount} active, {stoppedCount} stopped</div>
              </div>

              <div className="bg-[#14141e] p-4 rounded-xl border border-white/10">
                <div className="flex items-center justify-between text-gray-400 text-xs">
                  <span>Image Storage</span>
                  <Layers className="w-4 h-4 text-purple-400" />
                </div>
                <div className="text-2xl font-bold mt-2 text-white font-mono">{images.length}</div>
                <div className="text-xs text-gray-500 mt-1">Docker image cache entries</div>
              </div>

              <div className="bg-[#14141e] p-4 rounded-xl border border-white/10">
                <div className="flex items-center justify-between text-gray-400 text-xs">
                  <span>Persistent Volumes</span>
                  <HardDrive className="w-4 h-4 text-amber-400" />
                </div>
                <div className="text-2xl font-bold mt-2 text-white font-mono">{volumes.length}</div>
                <div className="text-xs text-gray-500 mt-1">Mounted stateful disk volumes</div>
              </div>
            </div>

            {/* Quick Actions Card */}
            <div className="bg-[#14141e] p-5 rounded-2xl border border-white/10 space-y-4">
              <h4 className="text-sm font-semibold text-white">One-Click Maintenance Actions</h4>
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => executePrune('containers')}
                  className="p-3 bg-[#1e1e2e] hover:bg-white/5 rounded-xl border border-white/10 text-left transition-all group flex items-start space-x-3"
                >
                  <Trash2 className="w-4 h-4 text-amber-400 mt-0.5 group-hover:scale-110 transition-transform" />
                  <div>
                    <div className="text-xs font-semibold text-white">Prune Stopped Containers</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">Removes all stopped containers safely</div>
                  </div>
                </button>

                <button
                  onClick={() => executePrune('images')}
                  className="p-3 bg-[#1e1e2e] hover:bg-white/5 rounded-xl border border-white/10 text-left transition-all group flex items-start space-x-3"
                >
                  <Layers className="w-4 h-4 text-purple-400 mt-0.5 group-hover:scale-110 transition-transform" />
                  <div>
                    <div className="text-xs font-semibold text-white">Prune Unused Images</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">Frees disk space from untagged / unused images</div>
                  </div>
                </button>

                <button
                  onClick={() => executePrune('volumes')}
                  className="p-3 bg-[#1e1e2e] hover:bg-white/5 rounded-xl border border-white/10 text-left transition-all group flex items-start space-x-3"
                >
                  <HardDrive className="w-4 h-4 text-rose-400 mt-0.5 group-hover:scale-110 transition-transform" />
                  <div>
                    <div className="text-xs font-semibold text-white">Prune Dangling Volumes</div>
                    <div className="text-[11px] text-gray-400 mt-0.5">Deletes volumes not attached to any container</div>
                  </div>
                </button>

                <button
                  onClick={() => executePrune('all')}
                  className="p-3 bg-rose-950/20 hover:bg-rose-950/40 rounded-xl border border-rose-500/30 text-left transition-all group flex items-start space-x-3"
                >
                  <AlertTriangle className="w-4 h-4 text-rose-400 mt-0.5 group-hover:scale-110 transition-transform" />
                  <div>
                    <div className="text-xs font-semibold text-rose-200">Full System Prune</div>
                    <div className="text-[11px] text-rose-300/70 mt-0.5">Reclaims maximum storage from all inactive assets</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ================= MODAL: RUN NEW CONTAINER ================= */}
      <DockerRunModal
        isOpen={showRunModal}
        image={runImage}
        name={runName}
        ports={runPorts}
        restart={runRestart}
        volumes={runVolumes}
        env={runEnv}
        error={runModalError}
        isSubmitting={isSubmittingRun}
        onImageChange={setRunImage}
        onNameChange={setRunName}
        onPortsChange={setRunPorts}
        onRestartChange={setRunRestart}
        onVolumesChange={setRunVolumes}
        onEnvChange={setRunEnv}
        onClose={() => { setShowRunModal(false); setRunModalError(null); }}
        onSubmit={handleRunSubmit}
      />

      {/* ================= MODAL: PULL IMAGE ================= */}
      <DockerPullModal
        isOpen={showPullModal}
        pullImageInput={pullImageInput}
        isPulling={isPulling}
        pullLogs={pullLogs}
        popularImages={popularImages}
        onInputChange={setPullImageInput}
        onPull={handlePullSubmit}
        onClose={() => setShowPullModal(false)}
      />

      {/* ================= MODAL: LIVE STREAMING LOGS ================= */}
      <DockerLogsModal
        container={selectedLogs}
        logsText={logsText}
        logsLines={logsLines}
        logsAutoRefresh={logsAutoRefresh}
        logsCopied={logsCopied}
        logsFilter={logsFilter}
        onClose={() => setSelectedLogs(null)}
        onLinesChange={l => {
          setLogsLines(l);
          setTimeout(() => refreshCurrentLogs(), 50);
        }}
        onToggleAutoRefresh={() => setLogsAutoRefresh(!logsAutoRefresh)}
        onCopyLogs={copyLogsToClipboard}
        onRefresh={refreshCurrentLogs}
        onFilterChange={setLogsFilter}
      />

      {/* ================= MODAL: CONTAINER INSPECTOR ================= */}
      <DockerInspectModal
        container={inspectTarget}
        inspectData={inspectData}
        isLoading={inspectLoading}
        onClose={() => setInspectTarget(null)}
      />

      {/* ================= MODAL: EXEC QUICK COMMAND ================= */}
      {execTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-emerald-600/30 border border-emerald-400/30 flex items-center justify-center">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Execute Command: {execTarget.name}</h3>
                  <p className="text-[11px] text-gray-400">Run a command directly inside the container namespace</p>
                </div>
              </div>
              <button 
                onClick={() => setExecTarget(null)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-gray-400 font-medium">Command:</span>
                  <div className="flex items-center space-x-1">
                    <span className="text-gray-500">Quick:</span>
                    {['uptime', 'env', 'ps aux', 'df -h', 'ls -la'].map(cmd => (
                      <button
                        key={cmd}
                        type="button"
                        onClick={() => setExecCmd(cmd)}
                        className="px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-emerald-300 font-mono text-[10px] cursor-pointer"
                      >
                        {cmd}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    placeholder="e.g. ls -la /app, env, ps aux, cat /etc/os-release"
                    value={execCmd}
                    onChange={e => setExecCmd(e.target.value)}
                    className="flex-1 bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 font-mono focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    disabled={isExecRunning || !execCmd.trim()}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50"
                  >
                    {isExecRunning && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>Run</span>
                  </button>
                </div>
              </div>

              {/* Live Exec Command Preview */}
              <div className="space-y-1">
                <DockerCommandSnippet 
                  command={`docker exec -it ${execTarget.name || execTarget.id} ${execCmd.trim() || 'sh'}`}
                  label="Exec CLI"
                />
              </div>

              {execOutput && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span className="font-mono">Output:</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(execOutput);
                        showNotification('Copied output to clipboard');
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer flex items-center space-x-1"
                    >
                      <Copy className="w-3 h-3" />
                      <span>Copy</span>
                    </button>
                  </div>
                  <div className="bg-[#0b0c14] border border-white/10 rounded-2xl p-3.5 max-h-64 overflow-y-auto font-mono text-xs text-gray-300 whitespace-pre-wrap select-text leading-relaxed shadow-inner">
                    {execOutput.split('\n').map((line, idx) => (
                      <div key={idx} className="hover:bg-white/[0.03] px-1 py-0.2 rounded flex items-start">
                        <span className="text-[10px] text-gray-600 w-7 text-right pr-2 select-none shrink-0 font-mono pt-0.5">
                          {idx + 1}
                        </span>
                        <span className="flex-1 text-gray-200">{line}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: SYSTEM PRUNE ASSISTANT ================= */}
      <DockerPruneModal
        isOpen={showPruneModal}
        systemDfText={systemDfText}
        isPruning={isPruning}
        onClose={() => setShowPruneModal(false)}
        onPrune={executePrune}
      />

      {/* ================= DOCKER LOGIN & ACCOUNT MODAL ================= */}
      <DockerAuthModal
        isOpen={showLoginModal}
        dockerAuth={dockerAuth}
        savedCredentialsList={savedCredentialsList}
        onClose={() => setShowLoginModal(false)}
        onLogin={async (reg: string, user: string, pwd: string, save: boolean) => {
          const escapedPwd = pwd.replace(/'/g, "'\\''");
          const cmd = `printf '%s\\n' '${escapedPwd}' | docker login -u '${user.trim()}' --password-stdin ${reg === 'docker.io' ? '' : `'${reg}'`}`.trim();
          const res = await sshExec(activeConnId, cmd);
          if (res.exit_code === 0 && (res.stdout.toLowerCase().includes('succeeded') || !res.stderr)) {
            showNotification(`Logged in to Docker registry as ${user.trim()}`);
            if (save) {
              const newCred: SavedDockerCredential = {
                id: `${reg}_${user.trim()}`,
                registry: reg,
                username: user.trim(),
                savedAt: new Date().toLocaleDateString(),
              };
              const existing = JSON.parse(
                localStorage.getItem('sshdesktop_docker_credentials') ||
                localStorage.getItem('clouddesk_docker_credentials') ||
                '[]'
              );
              const filtered = existing.filter((c: any) => c.id !== newCred.id);
              const updated = [newCred, ...filtered];
              localStorage.setItem('sshdesktop_docker_credentials', JSON.stringify(updated));
              setSavedCredentialsList(updated);
            }
            await checkDockerAuth();
          } else {
            throw new Error(res.stderr || res.stdout || 'Docker login failed. Please verify credentials.');
          }
        }}
        onLogout={handleDockerLogout}
        onDeleteCredential={(id: string) => {
          const updated = savedCredentialsList.filter(c => c.id !== id);
          localStorage.setItem('sshdesktop_docker_credentials', JSON.stringify(updated));
          setSavedCredentialsList(updated);
        }}
      />

      {/* ================= CREATE VOLUME MODAL ================= */}
      <DockerVolumeCreateModal
        isOpen={showCreateVolumeModal}
        isSubmitting={isSubmittingVol}
        onClose={() => setShowCreateVolumeModal(false)}
        onCreate={async (vName, vDriver, vOpts, vLabels) => {
          setIsSubmittingVol(true);
          try {
            const driverFlag = vDriver ? `-d ${vDriver}` : '';
            const optFlags = vOpts ? vOpts.split(',').map(o => `--opt ${o.trim()}`).join(' ') : '';
            const labelFlags = vLabels ? vLabels.split(',').map(l => `--label ${l.trim()}`).join(' ') : '';
            const cmd = `docker volume create ${driverFlag} ${optFlags} ${labelFlags} ${vName}`.trim().replace(/\s+/g, ' ');
            const res = await sshExec(activeConnId, cmd);
            if (res.exit_code === 0) {
              showNotification(`Volume ${vName} created successfully`);
              setShowCreateVolumeModal(false);
              await loadDockerData();
            } else {
              showNotification(`Failed to create volume: ${res.stderr || res.stdout}`, 'error');
            }
          } catch (err: any) {
            showNotification(`Error: ${err?.message || err}`, 'error');
          } finally {
            setIsSubmittingVol(false);
          }
        }}
      />

      {/* ================= CREATE NETWORK MODAL ================= */}
      <DockerNetworkCreateModal
        isOpen={showCreateNetworkModal}
        isSubmitting={isSubmittingNet}
        onClose={() => setShowCreateNetworkModal(false)}
        onCreate={async (netData) => {
          setIsSubmittingNet(true);
          try {
            const driverFlag = `-d ${netData.driver}`;
            const subnetFlag = netData.subnet ? `--subnet=${netData.subnet}` : '';
            const gatewayFlag = netData.gateway ? `--gateway=${netData.gateway}` : '';
            const ipRangeFlag = netData.ipRange ? `--ip-range=${netData.ipRange}` : '';
            const internalFlag = netData.internal ? '--internal' : '';
            const attachableFlag = netData.attachable ? '--attachable' : '';
            const ipv6Flag = netData.ipv6 ? '--ipv6' : '';
            const cmd = `docker network create ${driverFlag} ${subnetFlag} ${gatewayFlag} ${ipRangeFlag} ${internalFlag} ${attachableFlag} ${ipv6Flag} ${netData.name}`.trim().replace(/\s+/g, ' ');
            const res = await sshExec(activeConnId, cmd);
            if (res.exit_code === 0) {
              showNotification(`Network ${netData.name} created successfully`);
              setShowCreateNetworkModal(false);
              await loadDockerData();
            } else {
              showNotification(`Failed to create network: ${res.stderr || res.stdout}`, 'error');
            }
          } catch (err: any) {
            showNotification(`Error: ${err?.message || err}`, 'error');
          } finally {
            setIsSubmittingNet(false);
          }
        }}
      />

      {/* ================= DOCKER TAG IMAGE MODAL ================= */}
      <DockerTagModal
        image={showTagModal ? tagTargetImage : null}
        isTagging={isTagging}
        onClose={() => { setShowTagModal(false); setTagTargetImage(null); }}
        onTag={async (img, targetRepo, targetTag) => {
          setIsTagging(true);
          try {
            const src = img.repository === '<none>' ? img.id : `${img.repository}:${img.tag}`;
            const target = `${targetRepo}:${targetTag}`;
            const res = await sshExec(activeConnId, `docker tag ${src} ${target}`);
            if (res.exit_code === 0) {
              showNotification(`Tagged ${src} as ${target}`);
              setShowTagModal(false);
              setTagTargetImage(null);
              await loadDockerData();
            } else {
              showNotification(`Tag failed: ${res.stderr || res.stdout}`, 'error');
            }
          } catch (err: any) {
            showNotification(`Tag error: ${err?.message || err}`, 'error');
          } finally {
            setIsTagging(false);
          }
        }}
      />

      {/* ================= DOCKER COMMIT CONTAINER MODAL ================= */}
      <DockerCommitModal
        container={showCommitModal ? commitTargetContainer : null}
        isCommitting={isCommitting}
        onClose={() => { setShowCommitModal(false); setCommitTargetContainer(null); }}
        onCommit={async (c, targetRepo, targetTag, msg, author, pause) => {
          setIsCommitting(true);
          try {
            const pauseFlag = pause ? '' : '--pause=false';
            const authorFlag = author ? `-a "${author.replace(/"/g, '\\"')}"` : '';
            const msgFlag = msg ? `-m "${msg.replace(/"/g, '\\"')}"` : '';
            const targetRef = `${targetRepo}:${targetTag || 'latest'}`;
            const cmd = `docker commit ${pauseFlag} ${authorFlag} ${msgFlag} ${c.id} "${targetRef}"`.trim();
            const res = await sshExec(activeConnId, cmd);
            if (res.exit_code === 0) {
              showNotification(`Container committed to ${targetRef}`);
              setShowCommitModal(false);
              setCommitTargetContainer(null);
              await loadDockerData();
            } else {
              showNotification(`Commit failed: ${res.stderr || res.stdout}`, 'error');
            }
          } catch (err: any) {
            showNotification(`Commit error: ${err?.message || err}`, 'error');
          } finally {
            setIsCommitting(false);
          }
        }}
      />

      {/* ================= DOCKER RESOURCE DELETE & IN-USE CONFIRMATION MODAL ================= */}
      <DockerDeleteModal
        target={resourceToDelete}
        isDeleting={isDeletingResource}
        onClose={() => setResourceToDelete(null)}
        onConfirm={executeDeleteResource}
      />

      {/* ================= DOWNLOAD IMAGE LOCAL MODAL ================= */}
      {isDownloadingImage && downloadTargetImage && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl p-6 space-y-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center">
                <Download className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white">Downloading Docker Image to Local</h3>
                <p className="text-[11px] text-gray-400 font-mono truncate">
                  {downloadTargetImage.repository === '<none>' ? downloadTargetImage.id : `${downloadTargetImage.repository}:${downloadTargetImage.tag}`}
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-3">
              <div className="flex items-center space-x-2 text-xs text-white">
                <Loader2 className="w-4 h-4 animate-spin text-emerald-400 shrink-0" />
                <span className="font-medium">{downloadStatusText}</span>
              </div>

              {downloadError && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs">
                  {downloadError}
                </div>
              )}

              <div className="text-[10px] text-gray-400 leading-relaxed">
                SSH Desktop exports this image with <code className="text-gray-200">docker save</code>, compresses it with gzip, and securely streams it via SFTP directly to your local computer's Downloads directory.
              </div>
            </div>

            {downloadError && (
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => { setIsDownloadingImage(false); setDownloadTargetImage(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 text-white transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ================= CONTEXT MENU ================= */}
      {contextMenu && (
        <PortalContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          className="min-w-[220px] bg-[#1a1b26]/95 border border-white/15 rounded-xl shadow-2xl backdrop-blur-xl py-1 text-xs text-gray-200"
        >
          {contextMenu.container && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-white/10 flex items-center justify-between">
                <span className="truncate max-w-[130px] font-mono">{contextMenu.container.name}</span>
                <span className={`px-1.5 py-0.2 rounded text-[9px] uppercase font-bold ${
                  contextMenu.container.status === 'running' 
                    ? 'bg-emerald-500/20 text-emerald-300' 
                    : contextMenu.container.status === 'paused'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'bg-rose-500/20 text-rose-300'
                }`}>
                  {contextMenu.container.status}
                </span>
              </div>

              {contextMenu.container.status === 'running' ? (
                <button
                  onClick={() => {
                    const c = contextMenu.container!;
                    setContextMenu(null);
                    handleAction(c.id, 'stop', c.name);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-amber-500/20 text-amber-300 transition-colors"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop Container</span>
                </button>
              ) : (
                <button
                  onClick={() => {
                    const c = contextMenu.container!;
                    setContextMenu(null);
                    handleAction(c.id, 'start', c.name);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-emerald-500/20 text-emerald-300 transition-colors"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Container</span>
                </button>
              )}

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  handleAction(c.id, 'restart', c.name);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-cyan-300 transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>Restart Container</span>
              </button>

              <div className="my-1 border-t border-white/10" />

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  setExecTarget(c);
                  setExecCmd('uptime');
                  setExecOutput('');
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-blue-300 transition-colors"
              >
                <Terminal className="w-3.5 h-3.5" />
                <span>Quick Exec (One-Line)</span>
              </button>

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  handleOpenInteractiveTerminal(c);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-emerald-300 transition-colors"
              >
                <TerminalSquare className="w-3.5 h-3.5" />
                <span>Open Terminal Shell</span>
              </button>

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  openLogs(c);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-blue-300 transition-colors"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>View Container Logs</span>
              </button>

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  openInspector(c);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-purple-300 transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
                <span>Inspect Container</span>
              </button>

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  handleOpenCommitModal(c);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-indigo-300 transition-colors"
              >
                <GitCommit className="w-3.5 h-3.5" />
                <span>Commit Container to Image...</span>
              </button>

              <div className="my-1 border-t border-white/10" />

              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.container!.id);
                  setContextMenu(null);
                  showNotification(`Copied ID: ${contextMenu.container!.id}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Container ID</span>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.container!.name);
                  setContextMenu(null);
                  showNotification(`Copied Name: ${contextMenu.container!.name}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Container Name</span>
              </button>

              <div className="my-1 border-t border-white/10" />

              <button
                onClick={() => {
                  const c = contextMenu.container!;
                  setContextMenu(null);
                  promptDeleteContainer(c);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-rose-500/20 text-rose-400 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Container</span>
              </button>
            </>
          )}

          {contextMenu.image && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-white/10">
                <span className="truncate block max-w-[190px] font-mono">{contextMenu.image.repository}:{contextMenu.image.tag}</span>
              </div>

              <button
                onClick={() => {
                  const img = contextMenu.image!;
                  setContextMenu(null);
                  setRunImage(`${img.repository}:${img.tag}`);
                  setShowRunModal(true);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-blue-300 transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Run New Container</span>
              </button>

              <button
                onClick={() => {
                  const img = contextMenu.image!;
                  setContextMenu(null);
                  handleOpenTagModal(img);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-cyan-300 transition-colors"
              >
                <Tag className="w-3.5 h-3.5" />
                <span>Tag Image...</span>
              </button>

              <button
                onClick={() => {
                  const img = contextMenu.image!;
                  setContextMenu(null);
                  handleDownloadImageLocal(img);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-emerald-500/20 text-emerald-300 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download to Local Machine (.tar.gz)</span>
              </button>

              {dockerAuth?.loggedIn && contextMenu.image.repository !== '<none>' && (
                <button
                  onClick={() => {
                    const img = contextMenu.image!;
                    setContextMenu(null);
                    handlePushImage(img);
                  }}
                  className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-indigo-500/20 text-indigo-300 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Push to Registry ({dockerAuth.registry})</span>
                </button>
              )}

              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.image!.id);
                  setContextMenu(null);
                  showNotification(`Copied Image ID: ${contextMenu.image!.id}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Image ID</span>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${contextMenu.image!.repository}:${contextMenu.image!.tag}`);
                  setContextMenu(null);
                  showNotification(`Copied Tag: ${contextMenu.image!.repository}:${contextMenu.image!.tag}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Repository:Tag</span>
              </button>

              <div className="my-1 border-t border-white/10" />

              {(() => {
                const using = getContainersUsingImage(contextMenu.image!);
                const isLocked = using.length > 0;
                return (
                  <button
                    onClick={() => {
                      const img = contextMenu.image!;
                      setContextMenu(null);
                      handleDeleteImage(img);
                    }}
                    className={`w-full px-3 py-1.5 text-left flex items-center space-x-2 transition-colors ${
                      isLocked 
                        ? 'hover:bg-amber-500/20 text-amber-300' 
                        : 'hover:bg-rose-500/20 text-rose-400'
                    }`}
                    title={isLocked ? `Protected: In use by ${using.length} container(s)` : 'Delete Image'}
                  >
                    {isLocked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Trash2 className="w-3.5 h-3.5" />}
                    <span>{isLocked ? `In Use by Containers (${using.length})` : 'Delete Image'}</span>
                  </button>
                );
              })()}
            </>
          )}

          {contextMenu.type === 'volume' && contextMenu.volume && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-white/10">
                <span className="truncate block max-w-[190px] font-mono">{contextMenu.volume.name}</span>
              </div>

              <button
                onClick={async () => {
                  const vol = contextMenu.volume!;
                  setContextMenu(null);
                  try {
                    const res = await sshExec(activeConnId, `docker volume inspect ${vol.name}`);
                    alert(`Volume Inspect (${vol.name}):\n\n${res.stdout || res.stderr}`);
                  } catch (e: any) {
                    alert(`Inspect error: ${e?.message || e}`);
                  }
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-purple-300 transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
                <span>Inspect Volume</span>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.volume!.name);
                  setContextMenu(null);
                  showNotification(`Copied Volume Name: ${contextMenu.volume!.name}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Volume Name</span>
              </button>

              <div className="my-1 border-t border-white/10" />

              <button
                onClick={() => {
                  const vol = contextMenu.volume!;
                  setContextMenu(null);
                  handleDeleteVolume(vol.name);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-rose-500/20 text-rose-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Volume</span>
              </button>
            </>
          )}

          {contextMenu.type === 'network' && contextMenu.network && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-white/10">
                <span className="truncate block max-w-[190px] font-mono">{contextMenu.network.name}</span>
              </div>

              <button
                onClick={async () => {
                  const net = contextMenu.network!;
                  setContextMenu(null);
                  try {
                    const res = await sshExec(activeConnId, `docker network inspect ${net.id}`);
                    alert(`Network Inspect (${net.name}):\n\n${res.stdout || res.stderr}`);
                  } catch (e: any) {
                    alert(`Inspect error: ${e?.message || e}`);
                  }
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-cyan-300 transition-colors"
              >
                <Info className="w-3.5 h-3.5" />
                <span>Inspect Network</span>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.network!.id);
                  setContextMenu(null);
                  showNotification(`Copied Network ID: ${contextMenu.network!.id}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Network ID</span>
              </button>

              <button
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.network!.name);
                  setContextMenu(null);
                  showNotification(`Copied Network Name: ${contextMenu.network!.name}`);
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-white/10 text-gray-300 transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copy Network Name</span>
              </button>

              {!['bridge', 'host', 'none'].includes(contextMenu.network.name) && (
                <>
                  <div className="my-1 border-t border-white/10" />

                  <button
                    onClick={() => {
                      const net = contextMenu.network!;
                      setContextMenu(null);
                      handleDeleteNetwork(net.id, net.name);
                    }}
                    className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-rose-500/20 text-rose-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Network</span>
                  </button>
                </>
              )}
            </>
          )}
        </PortalContextMenu>
      )}

      {/* Permission Denied Alert Modal */}
      <PermissionAlertModal
        isOpen={!!restrictedAction}
        onClose={() => setRestrictedAction(null)}
        actionName={restrictedAction || ''}
        username={username}
        appName="Docker Manager"
      />

    </div>
  );
}

export { DockerManager };
