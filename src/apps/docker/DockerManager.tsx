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

interface ContainerItem {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'paused' | 'stopped';
  statusText: string;
  ports: string;
  created: string;
  cpu: string;
  mem: string;
}

interface ImageItem {
  id: string;
  repository: string;
  tag: string;
  size: string;
  created: string;
}

interface VolumeItem {
  name: string;
  driver: string;
  scope: string;
  mountpoint?: string;
  size?: string;
}

interface NetworkItem {
  id: string;
  name: string;
  driver: string;
  scope: string;
  subnet?: string;
}

interface ContainerInspectData {
  id: string;
  name: string;
  image: string;
  status: string;
  startedAt: string;
  ipAddress: string;
  gateway: string;
  macAddress: string;
  restartPolicy: string;
  env: string[];
  ports: { hostPort: string; containerPort: string; protocol: string }[];
  mounts: { source: string; destination: string; mode: string; type: string }[];
}

export interface DockerAuthInfo {
  username: string;
  registry: string;
  loggedIn: boolean;
}

export interface SavedDockerCredential {
  id: string;
  registry: string;
  username: string;
  savedAt: string;
}

export const DOCKERFILE_TEMPLATES: Record<string, string> = {
  nodejs: `# Multi-stage Node.js & React Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]`,

  python: `# Lightweight Python FastAPI / Flask Application
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 \\
    PYTHONDONTWRITEBYTECODE=1

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
EXPOSE 8000
CMD ["python", "main.py"]`,

  golang: `# Go Alpine Microservice Builder
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/server .
EXPOSE 8080
CMD ["./server"]`,

  nginx: `# Nginx Web Server Static Site
FROM nginx:alpine
COPY ./html /usr/share/nginx/html
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]`,

  rust: `# Rust Musl Scratch Statically-Linked Binary
FROM rust:1.78-alpine AS builder
WORKDIR /usr/src/app
COPY . .
RUN cargo build --release

FROM alpine:latest
WORKDIR /app
COPY --from=builder /usr/src/app/target/release/app /app/
CMD ["./app"]`,

  blank: `# Custom Dockerfile
FROM ubuntu:22.04
WORKDIR /app
RUN apt-get update && apt-get install -y curl
CMD ["echo", "Hello from Docker!"]`
};

export const COMPOSE_TEMPLATES: Record<string, string> = {
  web_db_redis: `version: '3.8'

services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://postgres:secret@db:5432/app
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    restart: unless-stopped

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
    restart: unless-stopped

volumes:
  pgdata:`,

  lamp: `version: '3.8'

services:
  web:
    image: php:8.2-apache
    ports:
      - "8080:80"
    volumes:
      - ./src:/var/www/html
    depends_on:
      - db
    restart: always

  db:
    image: mariadb:11
    environment:
      MYSQL_ROOT_PASSWORD: root_secret
      MYSQL_DATABASE: app_db
      MYSQL_USER: app_user
      MYSQL_PASSWORD: app_secret
    volumes:
      - db_data:/var/lib/mysql
    restart: always

  phpmyadmin:
    image: phpmyadmin/phpmyadmin
    ports:
      - "8081:80"
    environment:
      PMA_HOST: db
    depends_on:
      - db

volumes:
  db_data:`,

  monitoring: `version: '3.8'

services:
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
    depends_on:
      - prometheus
    restart: unless-stopped`,

  blank: `version: '3.8'

services:
  app:
    image: alpine:latest
    command: ["sh", "-c", "echo 'Container is running...' && tail -f /dev/null"]
    restart: unless-stopped`
};

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
      const saved = localStorage.getItem('clouddesk_docker_credentials');
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
          const existing = JSON.parse(localStorage.getItem('clouddesk_docker_credentials') || '[]');
          const updated = [newCred, ...existing.filter((c: any) => c.id !== newCred.id)];
          localStorage.setItem('clouddesk_docker_credentials', JSON.stringify(updated));
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
      if (!confirm(`Are you sure you want to permanently delete ${selectedContainerIds.size} selected container(s)?`)) return;
    }

    setActionLoadingId('bulk');
    const ids = Array.from(selectedContainerIds);
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
      try {
        if (action === 'delete') {
          await dockerAction(activeConnId, id, 'rm -f');
        } else {
          await dockerAction(activeConnId, id, action);
        }
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
          mounts: parsedMounts
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

  // Delete Volume
  const handleDeleteVolume = async (volName: string) => {
    if (!confirm(`Are you sure you want to permanently delete volume "${volName}"?`)) return;
    try {
      const res = await sshExec(activeConnId, `docker volume rm ${volName}`);
      if (res.exit_code === 0) {
        showNotification(`Volume ${volName} removed`);
        await loadDockerData();
      } else {
        alert(`Failed to delete volume: ${res.stderr}`);
      }
    } catch (err: any) {
      alert(`Error: ${err?.message || err}`);
    }
  };

  // Delete Network
  const handleDeleteNetwork = async (netId: string, netName: string) => {
    if (!confirm(`Are you sure you want to delete network "${netName}"?`)) return;
    try {
      const res = await sshExec(activeConnId, `docker network rm ${netId}`);
      if (res.exit_code === 0) {
        showNotification(`Network ${netName} removed`);
        await loadDockerData();
      } else {
        alert(`Failed to delete network: ${res.stderr}`);
      }
    } catch (err: any) {
      alert(`Error: ${err?.message || err}`);
    }
  };

  // Delete Image - blocks deletion if any active or stopped container uses the image
  const handleDeleteImage = async (img: ImageItem) => {
    const usingContainers = getContainersUsingImage(img);
    if (usingContainers.length > 0) {
      alert(
        `Cannot delete Docker image "${img.repository}:${img.tag}":\n\n` +
        `It is currently being used by ${usingContainers.length} container(s):\n` +
        usingContainers.map(c => `• ${c.name} (${c.id}) [Status: ${c.status}]`).join('\n') +
        `\n\nPlease stop and remove these containers first before deleting the image.`
      );
      showNotification(`Image "${img.repository}" is protected: in use by containers`, 'error');
      return;
    }

    if (!confirm(`Are you sure you want to permanently delete image "${img.repository}:${img.tag}" (${img.id})?`)) return;

    setActionLoadingId(`img-del-${img.id}`);
    try {
      await dockerImageRemove(activeConnId, img.id);
      showNotification(`Image ${img.repository}:${img.tag} removed successfully`);
      await loadDockerData();
    } catch (err: any) {
      alert(`Failed to delete image:\n${err?.message || err}`);
      showNotification(`Error deleting image: ${err?.message || err}`, 'error');
    } finally {
      setActionLoadingId(null);
    }
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
  const popularImages = [
    { name: 'nginx:alpine', desc: 'Lightweight high-performance HTTP web server' },
    { name: 'redis:alpine', desc: 'In-memory fast key-value database & cache' },
    { name: 'postgres:16-alpine', desc: 'Advanced relational SQL database' },
    { name: 'node:20-alpine', desc: 'JavaScript runtime with lightweight Alpine base' },
    { name: 'python:3.11-slim', desc: 'Python 3.11 environment with pip' },
    { name: 'rabbitmq:3-management', desc: 'Messaging broker with web management UI' },
  ];

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
        <header className="px-5 py-3.5 bg-[#14141e]/90 backdrop-blur-xl border-b border-white/[0.08] flex items-center justify-between shrink-0 overflow-x-auto no-scrollbar gap-3">
          
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
      <div className="px-5 py-3 bg-[#161622] border-b border-white/[0.06] flex items-center justify-between shrink-0 gap-4">
        
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
                          <span className="font-mono text-xs text-gray-300 bg-white/5 px-2 py-0.5 rounded border border-white/5">
                            {c.image}
                          </span>
                        </td>

                        {/* Ports */}
                        <td className="py-3 px-4">
                          <span className="font-mono text-[11px] text-gray-400">
                            {c.ports || '—'}
                          </span>
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

                            {/* Force Delete */}
                            <button
                              onClick={() => {
                                if (confirm(`Force remove container "${c.name}"?`)) {
                                  handleAction(c.id, 'rm -f', c.name);
                                }
                              }}
                              disabled={actionLoadingId === `c-rm -f-${c.id}`}
                              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-400 transition-all border border-rose-500/20 active:scale-95"
                              title="Force Remove Container"
                            >
                              {actionLoadingId === `c-rm -f-${c.id}` ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
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
                            <span className="font-mono">{img.repository}</span>
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
                            <span className="font-mono text-[11px] bg-white/10 text-gray-300 px-2 py-0.5 rounded border border-white/10">
                              {img.tag}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-gray-400">{img.id}</td>
                          <td className="py-3 px-4 font-mono text-gray-300">{img.size}</td>
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
                          <span className="truncate max-w-md">{vol.name}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-gray-400">{vol.driver}</td>
                        <td className="py-3 px-4 font-mono text-gray-400">{vol.scope}</td>
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
                          <span>{net.name}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-gray-400">{net.id}</td>
                        <td className="py-3 px-4 font-mono text-gray-300">
                          <span className="px-2 py-0.5 rounded bg-white/5 border border-white/5">{net.driver}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-gray-400">{net.scope}</td>
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
                    theme="vs-dark"
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
                    {isEditorRunning && (
                      <button
                        onClick={handleCancelBuild}
                        className="px-2 py-1 rounded bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/30 text-[11px] flex items-center space-x-1 transition-colors"
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
                        className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-gray-300 flex items-center space-x-1 transition-colors"
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
                      className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-[11px] text-gray-400 hover:text-white transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <div className="flex-1 p-3 overflow-y-auto font-mono text-xs text-gray-300 whitespace-pre-wrap leading-relaxed select-text">
                  {editorOutput || (
                    <span className="text-gray-600 italic">No command output yet. Click "Build Image" or "Compose Up" to see live stdout/stderr here.</span>
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
      {showRunModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-blue-600/30 border border-blue-400/30 flex items-center justify-center">
                  <Play className="w-4 h-4 text-blue-400 fill-current" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Launch New Container</h3>
                  <p className="text-[11px] text-gray-400">Configure ports, environment variables, and volumes</p>
                </div>
              </div>
              <button 
                onClick={() => setShowRunModal(false)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleRunSubmit} className="p-6 space-y-4 overflow-y-auto max-h-[75vh]">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Docker Image <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. nginx:alpine, redis:latest, postgres:16"
                  value={runImage}
                  onChange={e => setRunImage(e.target.value)}
                  required
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Container Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. web-server-1"
                  value={runName}
                  onChange={e => setRunName(e.target.value)}
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Port Bindings (-p)</label>
                  <input
                    type="text"
                    placeholder="8080:80, 443:443"
                    value={runPorts}
                    onChange={e => setRunPorts(e.target.value)}
                    className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                  />
                  <span className="text-[10px] text-gray-500 mt-1 block">Format: hostPort:containerPort</span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">Restart Policy</label>
                  <select
                    value={runRestart}
                    onChange={e => setRunRestart(e.target.value)}
                    className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    <option value="unless-stopped">Unless Stopped</option>
                    <option value="always">Always</option>
                    <option value="on-failure">On Failure</option>
                    <option value="no">Never (no)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Volumes / Mounts (-v)</label>
                <input
                  type="text"
                  placeholder="/var/www/html:/usr/share/nginx/html, /host/data:/data"
                  value={runVolumes}
                  onChange={e => setRunVolumes(e.target.value)}
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">Comma separated list of hostPath:containerPath</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Environment Variables (-e)</label>
                <input
                  type="text"
                  placeholder="NODE_ENV=production, PORT=3000, DB_HOST=localhost"
                  value={runEnv}
                  onChange={e => setRunEnv(e.target.value)}
                  className="w-full bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>

              {runModalError && (
                <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-start space-x-2.5 animate-in fade-in duration-150">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1 font-mono text-[11px] leading-relaxed break-words">{runModalError}</div>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="pt-3 border-t border-white/10 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => { setShowRunModal(false); setRunModalError(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRun}
                  className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 active:scale-95 transition-all shadow-lg shadow-blue-600/30 flex items-center space-x-2"
                >
                  {isSubmittingRun && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isSubmittingRun ? 'Launching...' : 'Run Container'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: PULL IMAGE ================= */}
      {showPullModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-purple-600/30 border border-purple-400/30 flex items-center justify-center">
                  <Download className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Pull Docker Image</h3>
                  <p className="text-[11px] text-gray-400">Download from Docker Hub or private container registries</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPullModal(false)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex space-x-2">
                <input
                  type="text"
                  placeholder="e.g. nginx:latest, redis:alpine, ubuntu:22.04"
                  value={pullImageInput}
                  onChange={e => setPullImageInput(e.target.value)}
                  className="flex-1 bg-[#13131c] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                />
                <button
                  onClick={() => handlePullSubmit()}
                  disabled={isPulling || !pullImageInput.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md active:scale-95"
                >
                  {isPulling && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isPulling ? 'Pulling...' : 'Pull'}</span>
                </button>
              </div>

              {/* Popular Curated Images */}
              <div>
                <span className="text-[11px] text-gray-400 block mb-2 font-medium">Popular Docker Images:</span>
                <div className="grid grid-cols-2 gap-2">
                  {popularImages.map(item => (
                    <button
                      key={item.name}
                      onClick={() => {
                        setPullImageInput(item.name);
                        handlePullSubmit(item.name);
                      }}
                      disabled={isPulling}
                      className="p-2 bg-[#13131c] hover:bg-white/5 rounded-xl border border-white/5 text-left transition-all group flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-mono text-xs font-bold text-white group-hover:text-blue-400 transition-colors">
                          {item.name}
                        </span>
                        <ArrowDownToLine className="w-3.5 h-3.5 text-gray-500 group-hover:text-blue-400" />
                      </div>
                      <span className="text-[10px] text-gray-500 mt-1 line-clamp-1">{item.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Pull Logs Preview */}
              {pullLogs && (
                <div className="bg-[#11111a] border border-white/10 rounded-xl p-3 max-h-40 overflow-y-auto font-mono text-[11px] text-gray-300 whitespace-pre-wrap select-text">
                  {pullLogs}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: LIVE STREAMING LOGS ================= */}
      {selectedLogs && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col h-[600px]">
            {/* Terminal Window Header (macOS Traffic Lights) */}
            <div className="px-5 py-3.5 bg-[#12121a] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {/* Traffic lights */}
                <div className="flex items-center space-x-1.5">
                  <button onClick={() => setSelectedLogs(null)} className="w-3 h-3 rounded-full bg-[#ff5f56] hover:opacity-80 transition-opacity" />
                  <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
                </div>
                <div className="flex items-center space-x-2 pl-2">
                  <FileText className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-mono font-bold text-white">docker logs {selectedLogs.name}</span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center space-x-2">
                {/* Tail line count */}
                <select
                  value={logsLines}
                  onChange={e => {
                    setLogsLines(Number(e.target.value));
                    setTimeout(() => refreshCurrentLogs(), 50);
                  }}
                  className="bg-[#1e1e2e] border border-white/10 rounded-lg px-2 py-1 text-[11px] text-gray-300 focus:outline-none"
                >
                  <option value={50}>Tail 50</option>
                  <option value={100}>Tail 100</option>
                  <option value={250}>Tail 250</option>
                  <option value={500}>Tail 500</option>
                  <option value={1000}>Tail 1000</option>
                </select>

                {/* Auto Refresh Toggle */}
                <button
                  onClick={() => setLogsAutoRefresh(!logsAutoRefresh)}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium transition-all border ${
                    logsAutoRefresh 
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
                      : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                  }`}
                  title="Auto-refresh logs every 2.5 seconds"
                >
                  <Zap className={`w-3 h-3 inline mr-1 ${logsAutoRefresh ? 'animate-pulse text-emerald-400' : ''}`} />
                  Live (2.5s)
                </button>

                {/* Copy logs */}
                <button
                  onClick={copyLogsToClipboard}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-[11px] flex items-center space-x-1"
                >
                  {logsCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{logsCopied ? 'Copied' : 'Copy'}</span>
                </button>

                {/* Refresh */}
                <button
                  onClick={refreshCurrentLogs}
                  className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10"
                  title="Reload Logs Now"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Filter Sub-header */}
            <div className="px-4 py-2 bg-[#161622] border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center space-x-2 text-xs text-gray-400">
                <Search className="w-3.5 h-3.5" />
                <input
                  type="text"
                  placeholder="Grep / filter logs output..."
                  value={logsFilter}
                  onChange={e => setLogsFilter(e.target.value)}
                  className="bg-transparent border-none text-xs text-white placeholder-gray-500 focus:outline-none w-64"
                />
              </div>
              <span className="text-[11px] text-gray-500 font-mono">
                {logsText.split('\n').length} lines
              </span>
            </div>

            {/* Terminal Body */}
            <div className="flex-1 p-4 font-mono text-[11px] text-gray-300 bg-[#0d0e15] overflow-y-auto whitespace-pre-wrap leading-relaxed select-text">
              {logsText
                .split('\n')
                .filter(l => !logsFilter || l.toLowerCase().includes(logsFilter.toLowerCase()))
                .map((line, idx) => {
                  let colorClass = 'text-gray-300';
                  if (line.includes('ERROR') || line.includes('ERR') || line.includes('FATAL')) colorClass = 'text-rose-400 font-semibold';
                  else if (line.includes('WARN')) colorClass = 'text-amber-400';
                  else if (line.includes('INFO')) colorClass = 'text-cyan-300';
                  return (
                    <div key={idx} className={`${colorClass} hover:bg-white/[0.04] px-1 py-0.2 rounded transition-colors`}>
                      {line}
                    </div>
                  );
                })}
              <div ref={logsEndRef} />
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: CONTAINER INSPECTOR ================= */}
      {inspectTarget && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col h-[580px]">
            {/* Header */}
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-purple-600/30 border border-purple-400/30 flex items-center justify-center">
                  <Info className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                    <span>{inspectTarget.name}</span>
                    <span className="font-mono text-xs text-gray-400 font-normal">({inspectTarget.id})</span>
                  </h3>
                  <p className="text-[11px] text-gray-400">Detailed container inspection & metadata</p>
                </div>
              </div>
              <button 
                onClick={() => setInspectTarget(null)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Inspector Navigation Tabs */}
            <div className="px-6 bg-[#161622] border-b border-white/10 flex items-center space-x-4">
              <button
                onClick={() => setInspectTab('overview')}
                className={`py-2.5 text-xs font-medium border-b-2 transition-all ${
                  inspectTab === 'overview' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Overview & Network
              </button>
              <button
                onClick={() => setInspectTab('env')}
                className={`py-2.5 text-xs font-medium border-b-2 transition-all ${
                  inspectTab === 'env' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Environment ({inspectData?.env.length || 0})
              </button>
              <button
                onClick={() => setInspectTab('ports')}
                className={`py-2.5 text-xs font-medium border-b-2 transition-all ${
                  inspectTab === 'ports' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Port Bindings ({inspectData?.ports.length || 0})
              </button>
              <button
                onClick={() => setInspectTab('mounts')}
                className={`py-2.5 text-xs font-medium border-b-2 transition-all ${
                  inspectTab === 'mounts' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
                }`}
              >
                Mounts & Volumes ({inspectData?.mounts.length || 0})
              </button>
            </div>

            {/* Tab Contents */}
            <div className="flex-1 p-6 overflow-y-auto">
              {inspectLoading ? (
                <div className="flex items-center justify-center h-full space-x-2 text-gray-400 text-xs">
                  <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                  <span>Loading container metadata...</span>
                </div>
              ) : inspectData ? (
                <>
                  {inspectTab === 'overview' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-[#14141e] p-3.5 rounded-xl border border-white/10 space-y-2">
                          <span className="text-[11px] text-gray-400 block font-medium">Container Identity</span>
                          <div className="text-xs font-mono"><span className="text-gray-500">Image:</span> {inspectData.image}</div>
                          <div className="text-xs font-mono"><span className="text-gray-500">Status:</span> {inspectData.status}</div>
                          <div className="text-xs font-mono"><span className="text-gray-500">Restart:</span> {inspectData.restartPolicy}</div>
                          <div className="text-xs font-mono"><span className="text-gray-500">Started:</span> {inspectData.startedAt}</div>
                        </div>

                        <div className="bg-[#14141e] p-3.5 rounded-xl border border-white/10 space-y-2">
                          <span className="text-[11px] text-gray-400 block font-medium">Networking</span>
                          <div className="text-xs font-mono"><span className="text-gray-500">IP Address:</span> {inspectData.ipAddress}</div>
                          <div className="text-xs font-mono"><span className="text-gray-500">Gateway:</span> {inspectData.gateway}</div>
                          <div className="text-xs font-mono"><span className="text-gray-500">MAC Addr:</span> {inspectData.macAddress}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {inspectTab === 'env' && (
                    <div className="bg-[#14141e] rounded-xl border border-white/10 overflow-hidden">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                          <tr>
                            <th className="py-2.5 px-3 w-1/3">Key</th>
                            <th className="py-2.5 px-3">Value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {inspectData.env.map((eStr, i) => {
                            const [k, ...v] = eStr.split('=');
                            return (
                              <tr key={i} className="hover:bg-white/[0.02]">
                                <td className="py-2 px-3 text-cyan-400 font-semibold">{k}</td>
                                <td className="py-2 px-3 text-gray-300 break-all select-text">{v.join('=')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {inspectTab === 'ports' && (
                    <div className="bg-[#14141e] rounded-xl border border-white/10 overflow-hidden">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                          <tr>
                            <th className="py-2.5 px-3">Host Port</th>
                            <th className="py-2.5 px-3">Direction</th>
                            <th className="py-2.5 px-3">Container Port</th>
                            <th className="py-2.5 px-3">Protocol</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {inspectData.ports.map((p, i) => (
                            <tr key={i} className="hover:bg-white/[0.02]">
                              <td className="py-2.5 px-3 text-emerald-400 font-bold">{p.hostPort}</td>
                              <td className="py-2.5 px-3 text-gray-500">→</td>
                              <td className="py-2.5 px-3 text-white font-bold">{p.containerPort}</td>
                              <td className="py-2.5 px-3 uppercase text-gray-400">{p.protocol}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {inspectTab === 'mounts' && (
                    <div className="bg-[#14141e] rounded-xl border border-white/10 overflow-hidden">
                      <table className="w-full text-left text-xs font-mono">
                        <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                          <tr>
                            <th className="py-2.5 px-3">Host Source</th>
                            <th className="py-2.5 px-3">Container Destination</th>
                            <th className="py-2.5 px-3 w-20">Mode</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.05]">
                          {inspectData.mounts.map((m, i) => (
                            <tr key={i} className="hover:bg-white/[0.02]">
                              <td className="py-2.5 px-3 text-gray-300 break-all">{m.source}</td>
                              <td className="py-2.5 px-3 text-blue-400 break-all">{m.destination}</td>
                              <td className="py-2.5 px-3">
                                <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                  m.mode.includes('rw') ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                                }`}>
                                  {m.mode}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}

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
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md active:scale-95"
                >
                  {isExecRunning && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Run</span>
                </button>
              </div>

              {execOutput && (
                <div className="bg-[#0d0e15] border border-white/10 rounded-xl p-3.5 max-h-60 overflow-y-auto font-mono text-[11px] text-gray-300 whitespace-pre-wrap select-text leading-relaxed">
                  {execOutput}
                </div>
              )}
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: SYSTEM PRUNE ASSISTANT ================= */}
      {showPruneModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
          <div className="bg-[#1c1d2e] border border-white/20 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
            <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-xl bg-rose-600/30 border border-rose-400/30 flex items-center justify-center">
                  <Trash2 className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Docker Prune Assistant</h3>
                  <p className="text-[11px] text-gray-400">Reclaim wasted disk storage on your Linux host</p>
                </div>
              </div>
              <button 
                onClick={() => setShowPruneModal(false)}
                className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-[#13131c] p-3 rounded-xl border border-white/10 font-mono text-[11px] text-gray-300 whitespace-pre-wrap">
                {systemDfText}
              </div>

              <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-200 flex items-start space-x-2.5">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold block mb-0.5">Warning</span>
                  Pruning will permanently delete stopped containers, dangling images, and unreferenced build cache.
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  onClick={() => setShowPruneModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white bg-white/5"
                >
                  Cancel
                </button>
                <button
                  onClick={() => executePrune('all')}
                  disabled={isPruning}
                  className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 active:scale-95 transition-all shadow-lg shadow-rose-600/30 flex items-center space-x-2"
                >
                  {isPruning && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>{isPruning ? 'Pruning...' : 'Prune All Unused'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================= DOCKER LOGIN & ACCOUNT MODAL ================= */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                  <User className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Docker Registry Account</h3>
                  <p className="text-[11px] text-gray-400">Authenticate against Docker Hub or private registries</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowLoginModal(false);
                  setLoginError(null);
                }} 
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              {/* Active Logged-in Status Card */}
              {dockerAuth?.loggedIn ? (
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <div>
                      <div className="text-xs font-bold text-emerald-300">Active Account: {dockerAuth.username}</div>
                      <div className="text-[10px] text-emerald-400/80 font-mono mt-0.5">Registry: {dockerAuth.registry}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDockerLogout(dockerAuth.registry)}
                    className="px-3 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-xs font-semibold transition-all active:scale-95 flex items-center space-x-1"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Log Out</span>
                  </button>
                </div>
              ) : (
                <div className="p-3 bg-white/5 border border-white/10 rounded-2xl flex items-center space-x-2.5 text-xs text-gray-300">
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Not currently logged into any Docker registry on this server.</span>
                </div>
              )}

              {/* Login Form */}
              <form onSubmit={handleDockerLogin} className="space-y-3.5 pt-2 border-t border-white/10">
                <div className="text-xs font-semibold text-white">Log in to Registry</div>

                {loginError && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-start space-x-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <span className="whitespace-pre-wrap">{loginError}</span>
                  </div>
                )}

                {/* Popular Cloud & Git Registries */}
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1.5">Select Popular Registry</label>
                  <div className="grid grid-cols-4 gap-1.5 mb-2.5">
                    {[
                      { label: 'Docker Hub', reg: 'docker.io', user: '', hint: 'Docker Hub official cloud registry' },
                      { label: 'AWS ECR', reg: '<account-id>.dkr.ecr.<region>.amazonaws.com', user: 'AWS', hint: 'AWS Elastic Container Registry (Username must be AWS; Password from aws ecr get-login-password)' },
                      { label: 'Azure ACR', reg: '<name>.azurecr.io', user: '', hint: 'Azure Container Registry (Admin credentials or SP App ID)' },
                      { label: 'Google GCP', reg: 'gcr.io', user: '_json_key', hint: 'Google Cloud Registry (Username _json_key with JSON key file content)' },
                      { label: 'Google Artifact', reg: 'us-docker.pkg.dev', user: '_json_key', hint: 'Google Cloud Artifact Registry (*.pkg.dev)' },
                      { label: 'GitHub GHCR', reg: 'ghcr.io', user: '', hint: 'GitHub Container Registry (Use GitHub username & PAT)' },
                      { label: 'GitLab', reg: 'registry.gitlab.com', user: '', hint: 'GitLab Container Registry (PAT or Deploy Token)' },
                      { label: 'Quay.io', reg: 'quay.io', user: '', hint: 'Red Hat Quay Container Registry' },
                    ].map(p => (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          setLoginRegistry(p.reg);
                          if (p.user) setLoginUsername(p.user);
                        }}
                        className={`px-2 py-1.5 rounded-lg text-[10px] font-semibold border transition-all truncate text-center ${
                          loginRegistry === p.reg
                            ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                            : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10 hover:text-white'
                        }`}
                        title={p.hint}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Dynamic Cloud Provider Instruction Callout */}
                  {loginRegistry.includes('ecr.') && (
                    <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300 mb-2 leading-relaxed">
                      🟧 <strong>AWS ECR:</strong> Username is fixed to <code className="bg-black/30 px-1 rounded">AWS</code>. Generate the temporary password using the AWS CLI: <code className="bg-black/30 px-1 rounded">aws ecr get-login-password --region &lt;region&gt;</code>
                    </div>
                  )}
                  {loginRegistry.includes('azurecr.io') && (
                    <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-[11px] text-blue-300 mb-2 leading-relaxed">
                      🔷 <strong>Azure ACR:</strong> Replace <code className="bg-black/30 px-1 rounded">&lt;name&gt;</code> with your registry name. Username is your ACR admin username or Service Principal Client ID; Password is the access key or secret.
                    </div>
                  )}
                  {(loginRegistry.includes('gcr.io') || loginRegistry.includes('pkg.dev')) && (
                    <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-[11px] text-rose-300 mb-2 leading-relaxed">
                      🔴 <strong>Google Cloud (GCP):</strong> For service account key authentication, set username to <code className="bg-black/30 px-1 rounded">_json_key</code> and paste your downloaded JSON key directly into Password.
                    </div>
                  )}
                  {loginRegistry === 'ghcr.io' && (
                    <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-[11px] text-purple-300 mb-2 leading-relaxed">
                      🐙 <strong>GitHub (ghcr.io):</strong> Username is your GitHub handle. Password must be a Personal Access Token with <code className="bg-black/30 px-1 rounded">read:packages</code> and <code className="bg-black/30 px-1 rounded">write:packages</code> permissions.
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Registry Endpoint</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={loginRegistry}
                      onChange={(e) => setLoginRegistry(e.target.value)}
                      className="flex-1 px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                      placeholder="e.g. docker.io, 12345.dkr.ecr.us-east-1.amazonaws.com"
                    />
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          setLoginRegistry(e.target.value);
                          if (e.target.value.includes('ecr.')) setLoginUsername('AWS');
                          if (e.target.value.includes('gcr.io') || e.target.value.includes('pkg.dev')) setLoginUsername('_json_key');
                        }
                      }}
                      className="px-2 py-2 rounded-xl bg-[#14141e] border border-white/10 text-xs text-gray-300 focus:outline-none cursor-pointer max-w-[120px]"
                    >
                      <option value="">Presets</option>
                      <option value="docker.io">🐳 Docker Hub</option>
                      <option value="<account-id>.dkr.ecr.<region>.amazonaws.com">🟧 AWS ECR</option>
                      <option value="public.ecr.aws">🟧 AWS Public</option>
                      <option value="<name>.azurecr.io">🔷 Azure ACR</option>
                      <option value="gcr.io">🔴 GCP (gcr.io)</option>
                      <option value="us-docker.pkg.dev">🔴 GCP Artifact</option>
                      <option value="ghcr.io">🐙 GitHub GHCR</option>
                      <option value="registry.gitlab.com">🦊 GitLab</option>
                      <option value="quay.io">Quay.io</option>
                      <option value="registry.digitalocean.com">DigitalOcean</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Username</label>
                  <input
                    type="text"
                    value={loginUsername}
                    onChange={(e) => setLoginUsername(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    placeholder="Docker ID or username"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Password / Personal Access Token</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      className="w-full px-3 py-2 pr-10 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-mono"
                      placeholder="••••••••••••"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-white"
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center space-x-2 pt-1">
                  <input
                    type="checkbox"
                    id="saveDockerCreds"
                    checked={saveCredentials}
                    onChange={(e) => setSaveCredentials(e.target.checked)}
                    className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="saveDockerCreds" className="text-xs text-gray-300 cursor-pointer">
                    Save credential profile in CloudDesk
                  </label>
                </div>

                <div className="pt-3 flex items-center justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowLoginModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isLoggingIn}
                    className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
                  >
                    {isLoggingIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                    <span>{isLoggingIn ? 'Logging In...' : 'Log In'}</span>
                  </button>
                </div>
              </form>

              {/* Saved Profiles */}
              {savedCredentialsList.length > 0 && (
                <div className="pt-3 border-t border-white/10">
                  <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Saved Accounts</div>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {savedCredentialsList.map((cred) => (
                      <div key={cred.id} className="p-2.5 bg-black/20 border border-white/5 rounded-xl flex items-center justify-between text-xs">
                        <div>
                          <div className="font-semibold text-white">{cred.username}</div>
                          <div className="text-[10px] text-gray-400 font-mono">{cred.registry}</div>
                        </div>
                        <div className="flex items-center space-x-1">
                          <button
                            onClick={() => {
                              setLoginUsername(cred.username);
                              setLoginRegistry(cred.registry);
                            }}
                            className="px-2 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-[11px]"
                          >
                            Use
                          </button>
                          <button
                            onClick={() => {
                              const updated = savedCredentialsList.filter(c => c.id !== cred.id);
                              localStorage.setItem('clouddesk_docker_credentials', JSON.stringify(updated));
                              setSavedCredentialsList(updated);
                            }}
                            className="p-1 rounded text-gray-400 hover:text-rose-400 hover:bg-white/5"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================= CREATE VOLUME MODAL ================= */}
      {showCreateVolumeModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                  <HardDrive className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Create Docker Volume</h3>
                  <p className="text-[11px] text-gray-400">Initialize a persistent storage volume</p>
                </div>
              </div>
              <button onClick={() => setShowCreateVolumeModal(false)} className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateVolume} className="p-6 space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Volume Name *</label>
                <input
                  type="text"
                  required
                  value={volCreateName}
                  onChange={(e) => setVolCreateName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="e.g. pg_data_production"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Driver</label>
                <input
                  type="text"
                  value={volCreateDriver}
                  onChange={(e) => setVolCreateDriver(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="local"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Driver Options (comma separated key=value)</label>
                <input
                  type="text"
                  value={volCreateOpts}
                  onChange={(e) => setVolCreateOpts(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="type=tmpfs,device=tmpfs,o=size=100m"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Labels (comma separated key=value)</label>
                <input
                  type="text"
                  value={volCreateLabels}
                  onChange={(e) => setVolCreateLabels(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="env=prod,team=backend"
                />
              </div>

              <div className="pt-3 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateVolumeModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingVol}
                  className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
                >
                  {isSubmittingVol ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>{isSubmittingVol ? 'Creating...' : 'Create Volume'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= CREATE NETWORK MODAL ================= */}
      {showCreateNetworkModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
                  <Network className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Create Docker Network</h3>
                  <p className="text-[11px] text-gray-400">Configure bridge, overlay or custom container network</p>
                </div>
              </div>
              <button onClick={() => setShowCreateNetworkModal(false)} className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateNetwork} className="p-6 space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Network Name *</label>
                <input
                  type="text"
                  required
                  value={netCreateName}
                  onChange={(e) => setNetCreateName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="e.g. app_isolated_net"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Driver</label>
                <select
                  value={netCreateDriver}
                  onChange={(e) => setNetCreateDriver(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-[#14141e] border border-white/10 text-xs text-white focus:outline-none focus:border-blue-500 cursor-pointer"
                >
                  <option value="bridge">bridge (default standalone)</option>
                  <option value="overlay">overlay (swarm multi-host)</option>
                  <option value="macvlan">macvlan (physical MAC assignment)</option>
                  <option value="ipvlan">ipvlan (L2/L3 virtual LAN)</option>
                  <option value="host">host (native host interface)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Subnet (CIDR)</label>
                  <input
                    type="text"
                    value={netCreateSubnet}
                    onChange={(e) => setNetCreateSubnet(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    placeholder="172.28.0.0/16"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Gateway</label>
                  <input
                    type="text"
                    value={netCreateGateway}
                    onChange={(e) => setNetCreateGateway(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    placeholder="172.28.0.1"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">IP Range (Optional)</label>
                <input
                  type="text"
                  value={netCreateIpRange}
                  onChange={(e) => setNetCreateIpRange(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  placeholder="172.28.5.0/24"
                />
              </div>

              <div className="flex items-center space-x-4 pt-1">
                <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={netCreateInternal}
                    onChange={(e) => setNetCreateInternal(e.target.checked)}
                    className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Internal Network</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={netCreateAttachable}
                    onChange={(e) => setNetCreateAttachable(e.target.checked)}
                    className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 cursor-pointer"
                  />
                  <span>Attachable</span>
                </label>
                <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={netCreateIpv6}
                    onChange={(e) => setNetCreateIpv6(e.target.checked)}
                    className="rounded border-white/20 bg-white/10 text-blue-500 focus:ring-0 cursor-pointer"
                  />
                  <span>IPv6</span>
                </label>
              </div>

              <div className="pt-3 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateNetworkModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingNet}
                  className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
                >
                  {isSubmittingNet ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>{isSubmittingNet ? 'Creating...' : 'Create Network'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= DOCKER TAG IMAGE MODAL ================= */}
      {showTagModal && tagTargetImage && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
                  <Tag className="w-4 h-4 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Tag Docker Image</h3>
                  <p className="text-[11px] text-gray-400 font-mono truncate max-w-[260px]">
                    {tagTargetImage.repository === '<none>' ? tagTargetImage.id : `${tagTargetImage.repository}:${tagTargetImage.tag}`}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setShowTagModal(false); setTagTargetImage(null); }} 
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteTag} className="p-6 space-y-4">
              <div className="p-3 rounded-2xl bg-black/30 border border-white/10 space-y-1">
                <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Source Image</div>
                <div className="text-xs font-mono text-cyan-300 font-medium">
                  {tagTargetImage.repository === '<none>' ? tagTargetImage.id : `${tagTargetImage.repository}:${tagTargetImage.tag}`}
                </div>
                <div className="text-[10px] text-gray-500 font-mono">ID: {tagTargetImage.id} | Size: {tagTargetImage.size}</div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Target Repository *</label>
                <input
                  type="text"
                  required
                  value={tagNewRepo}
                  onChange={(e) => setTagNewRepo(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
                  placeholder="e.g. myregistry.azurecr.io/myapp or username/repo"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Target Tag</label>
                <input
                  type="text"
                  value={tagNewTag}
                  onChange={(e) => setTagNewTag(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
                  placeholder="latest or v1.0.0"
                />
              </div>

              <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-[11px] font-mono text-cyan-200">
                Command: docker tag {tagTargetImage.repository === '<none>' ? tagTargetImage.id : `${tagTargetImage.repository}:${tagTargetImage.tag}`} {tagNewRepo || '<repo>'}:{tagNewTag || 'latest'}
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => { setShowTagModal(false); setTagTargetImage(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isTagging || !tagNewRepo.trim()}
                  className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
                >
                  {isTagging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Tag className="w-3.5 h-3.5" />}
                  <span>{isTagging ? 'Tagging...' : 'Apply Tag'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= DOCKER COMMIT CONTAINER MODAL ================= */}
      {showCommitModal && commitTargetContainer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#1e1e2e] border border-white/15 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 bg-[#14141e] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
                  <GitCommit className="w-4 h-4 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Commit Container to Image</h3>
                  <p className="text-[11px] text-gray-400 font-mono truncate max-w-[260px]">
                    Container: {commitTargetContainer.name} ({commitTargetContainer.id.substring(0, 12)})
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setShowCommitModal(false); setCommitTargetContainer(null); }} 
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleExecuteCommit} className="p-6 space-y-3.5 max-h-[80vh] overflow-y-auto">
              <div className="p-3 rounded-2xl bg-black/30 border border-white/10 space-y-1">
                <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Source Container</div>
                <div className="text-xs font-mono text-indigo-300 font-medium">
                  {commitTargetContainer.name}
                </div>
                <div className="text-[10px] text-gray-500 font-mono">
                  Base Image: {commitTargetContainer.image} | Status: {commitTargetContainer.status}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">New Image Repository *</label>
                  <input
                    type="text"
                    required
                    value={commitRepo}
                    onChange={(e) => setCommitRepo(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                    placeholder="e.g. my-custom-image"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-gray-400 mb-1">Tag</label>
                  <input
                    type="text"
                    value={commitTag}
                    onChange={(e) => setCommitTag(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 text-center"
                    placeholder="latest"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Commit Message</label>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
                  placeholder="e.g. Installed dependencies and updated nginx config"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-gray-400 mb-1">Author</label>
                <input
                  type="text"
                  value={commitAuthor}
                  onChange={(e) => setCommitAuthor(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 font-mono"
                  placeholder="e.g. John Doe <john@example.com>"
                />
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="commitPauseCheck"
                  checked={commitPause}
                  onChange={(e) => setCommitPause(e.target.checked)}
                  className="rounded border-white/20 bg-white/10 text-indigo-500 focus:ring-0 cursor-pointer"
                />
                <label htmlFor="commitPauseCheck" className="text-xs text-gray-300 cursor-pointer">
                  Pause container during commit (recommended for data consistency)
                </label>
              </div>

              <div className="pt-2 flex items-center justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => { setShowCommitModal(false); setCommitTargetContainer(null); }}
                  className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCommitting || !commitRepo.trim()}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md active:scale-95 transition-all flex items-center space-x-1.5"
                >
                  {isCommitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCommit className="w-3.5 h-3.5" />}
                  <span>{isCommitting ? 'Committing...' : 'Commit Container'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
                CloudDesk exports this image with <code className="text-gray-200">docker save</code>, compresses it with gzip, and securely streams it via SFTP directly to your local computer's Downloads directory.
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
        <div
          ref={contextMenuRef}
          style={{ 
            top: `${Math.min(contextMenu.y, window.innerHeight - 340)}px`, 
            left: `${Math.min(contextMenu.x, window.innerWidth - 240)}px` 
          }}
          className="fixed z-50 min-w-[220px] bg-[#1a1b26]/95 border border-white/15 rounded-xl shadow-2xl backdrop-blur-xl py-1 text-xs text-gray-200 animate-in fade-in zoom-in-95 duration-100"
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
                  if (confirm(`Force remove container "${c.name}"?`)) {
                    handleAction(c.id, 'rm -f', c.name);
                  }
                }}
                className="w-full px-3 py-1.5 text-left flex items-center space-x-2 hover:bg-rose-500/20 text-rose-400 transition-colors"
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
        </div>
      )}

    </div>
  );
}

export { DockerManager };
