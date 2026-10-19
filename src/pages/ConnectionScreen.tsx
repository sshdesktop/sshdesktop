import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useConnectionStore, useSettingsStore } from '../lib/store';
import { 
  Cloud, Plus, Server, Key, Trash2, Check, 
  AlertCircle, Lock, Upload, FileCode, X,
  Eye, EyeOff, ArrowRight, RotateCcw, Power, Wifi,
  Palette, Terminal, CheckCircle2,
  Edit2, Laptop, Shield, Search, ChevronLeft, ChevronRight,
  ChevronDown, SlidersHorizontal, Copy, Download, LayoutGrid, List, Tag, Filter
} from 'lucide-react';
import { sshTestConnection, sshLaunchPutty, pickKeyFile, storeListConnections } from '../lib/tauri-bridge';
import { WALLPAPERS } from '../shell/Desktop';

interface UploadedKeyInfo {
  name: string;
  size: string;
  type: string;
  content: string;
}

interface ProfileFormData {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'key';
  password: string;
  privateKeyPath: string;
}

export default function ConnectionScreen() {
  const { connections, addConnection, updateConnection, removeConnection, connect } = useConnectionStore();
  const { wallpaper, updateSettings } = useSettingsStore();

  const [selectedId, setSelectedId] = useState<string | null>(connections[0]?.id || null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectingStep, setConnectingStep] = useState<string>('Initializing SSH Handshake...');
  const [connectingProgress, setConnectingProgress] = useState<number>(10);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [capsLockActive, setCapsLockActive] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Modals & Panels
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [modalForm, setModalForm] = useState<ProfileFormData>({
    id: '',
    name: '',
    host: '',
    port: 22,
    username: 'root',
    authMethod: 'password',
    password: '',
    privateKeyPath: '',
  });

  const [showImportModal, setShowImportModal] = useState(false);
  const [showAppleMenu, setShowAppleMenu] = useState(false);
  const [showWallpaperMenu, setShowWallpaperMenu] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);

  // Server Profile Manager & Switcher State
  const [showProfileManagerModal, setShowProfileManagerModal] = useState(false);
  const [profileSearch, setProfileSearch] = useState('');
  const [selectedGroupFilter, setSelectedGroupFilter] = useState('all');
  const [managerViewMode, setManagerViewMode] = useState<'grid' | 'table'>('grid');
  const [showQuickSwitchDropdown, setShowQuickSwitchDropdown] = useState(false);
  const quickSwitchRef = useRef<HTMLDivElement | null>(null);
  const carouselRef = useRef<HTMLDivElement | null>(null);
  const importJsonInputRef = useRef<HTMLInputElement | null>(null);

  // Pre-flight connection probe state
  const [isTestingProbe, setIsTestingProbe] = useState(false);
  const [probeResult, setProbeResult] = useState<{ status: 'idle' | 'success' | 'failed'; latency?: number; message?: string }>({ status: 'idle' });

  // Live Apple Clock & Date
  const [liveTime, setLiveTime] = useState('');
  const [liveDate, setLiveDate] = useState('');

  // SSH Config paste import state
  const [sshConfigInput, setSshConfigInput] = useState('');
  const [sshConfigImportCount, setSshConfigImportCount] = useState<number | null>(null);

  // Active server form states for login
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [serverName, setServerName] = useState('');
  const [authMethod, setAuthMethod] = useState<'password' | 'key'>('password');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [keyPassphrase, setKeyPassphrase] = useState('');
  const [uploadedKey, setUploadedKey] = useState<UploadedKeyInfo | null>(null);
  const [isDraggingKey, setIsDraggingKey] = useState(false);
  const [saveCredentials, setSaveCredentials] = useState(true);
  const keyFileInputRef = useRef<HTMLInputElement | null>(null);

  // Inline "Create First Profile" form state (when connections.length === 0)
  const [firstProfile, setFirstProfile] = useState<ProfileFormData>({
    id: '',
    name: '',
    host: '',
    port: 22,
    username: 'root',
    authMethod: 'password',
    password: '',
    privateKeyPath: '',
  });

  const selectedConn = connections.find(c => c.id === selectedId);

  // Live Clock
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setLiveTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
      setLiveDate(now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Sync saved server profiles from disk storage ~/.clouddesk/connections.json
  useEffect(() => {
    storeListConnections().then((saved) => {
      if (saved && Array.isArray(saved) && saved.length > 0) {
        saved.forEach((s: any) => {
          const formatted = {
            ...s,
            authMethod: s.auth_method || s.authMethod || (s.private_key_path ? 'key' : 'password'),
            privateKeyPath: s.private_key_path || s.privateKeyPath,
            created_at: s.created_at || Date.now(),
          };
          addConnection(formatted);
        });
      }
    }).catch(() => {});
  }, [addConnection]);

  // Caps Lock detection
  useEffect(() => {
    const handleKeyChange = (e: KeyboardEvent) => {
      setCapsLockActive(e.getModifierState('CapsLock'));
    };
    window.addEventListener('keydown', handleKeyChange);
    window.addEventListener('keyup', handleKeyChange);
    return () => {
      window.removeEventListener('keydown', handleKeyChange);
      window.removeEventListener('keyup', handleKeyChange);
    };
  }, []);

  // Quick Switcher outside click handler
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (quickSwitchRef.current && !quickSwitchRef.current.contains(e.target as Node)) {
        setShowQuickSwitchDropdown(false);
      }
    };
    if (showQuickSwitchDropdown) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showQuickSwitchDropdown]);

  // Unique server groups
  const profileGroups = useMemo(() => {
    const set = new Set<string>();
    connections.forEach(c => {
      if (c.group && c.group.trim()) set.add(c.group.trim());
    });
    return ['all', ...Array.from(set)];
  }, [connections]);

  // Filtered connections based on search & group
  const filteredConnections = useMemo(() => {
    const q = profileSearch.trim().toLowerCase();
    return connections.filter(conn => {
      const matchesGroup = selectedGroupFilter === 'all' || conn.group === selectedGroupFilter;
      if (!matchesGroup) return false;
      if (!q) return true;
      const nameMatch = (conn.name || '').toLowerCase().includes(q);
      const hostMatch = (conn.host || '').toLowerCase().includes(q);
      const userMatch = (conn.username || '').toLowerCase().includes(q);
      const tagMatch = Array.isArray(conn.tags) && conn.tags.some(t => t.toLowerCase().includes(q));
      const groupMatch = (conn.group || '').toLowerCase().includes(q);
      return nameMatch || hostMatch || userMatch || tagMatch || groupMatch;
    });
  }, [connections, profileSearch, selectedGroupFilter]);

  // Carousel smooth horizontal scroll
  const scrollCarousel = (direction: 'left' | 'right') => {
    if (carouselRef.current) {
      const scrollAmount = direction === 'left' ? -220 : 220;
      carouselRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  // Duplicate Profile
  const handleDuplicateProfile = (conn: any) => {
    const newId = `server-${Date.now()}`;
    const duplicate: any = {
      ...conn,
      id: newId,
      name: `${conn.name || 'Server'} (Copy)`,
      created_at: Date.now(),
    };
    addConnection(duplicate);
    setSelectedId(newId);
  };

  // Export Profiles to JSON Backup
  const handleExportProfilesJson = () => {
    try {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(connections, null, 2));
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `clouddesk_servers_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (e: any) {
      alert(`Export error: ${e?.message || e}`);
    }
  };

  // Import Profiles from JSON Backup
  const handleImportProfilesJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          let count = 0;
          parsed.forEach(item => {
            if (item.host) {
              const newConn = {
                ...item,
                id: item.id || `server-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
              };
              addConnection(newConn);
              count++;
            }
          });
          alert(`Successfully imported ${count} server profiles!`);
          if (parsed.length > 0) setSelectedId(parsed[0].id);
        } else {
          alert('Invalid backup file format: Expected JSON array of server profiles.');
        }
      } catch (err: any) {
        alert(`Failed to parse JSON file: ${err?.message || err}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Sync initial server credentials
  useEffect(() => {
    if (connections.length > 0) {
      if (!selectedId || !connections.some(c => c.id === selectedId)) {
        setSelectedId(connections[0].id);
      }
    } else {
      setSelectedId(null);
    }
  }, [connections, selectedId]);

  // Update form fields and AUTO-SELECT authentication method when active server selection changes
  useEffect(() => {
    if (selectedId && connections.length > 0) {
      const conn = connections.find(c => c.id === selectedId);
      if (conn) {
        setHost(conn.host || '');
        setPort(conn.port || 22);
        setUsername(conn.username || 'root');
        setPassword(conn.password || '');
        setServerName(conn.name || '');
        setProbeResult({ status: 'idle' });

        const connKeyPath = (conn as any).privateKeyPath || (conn as any).private_key_path;
        const connAuthMethod = (conn as any).authMethod || (conn as any).auth_method;

        // Auto-select SSH Key if privateKeyPath is present or authMethod is key
        if (connAuthMethod === 'key' || (connKeyPath && !conn.password)) {
          setAuthMethod('key');
          setPrivateKeyPath(connKeyPath || '');
          if (connKeyPath) {
            const fileName = connKeyPath.split(/[\\/]/).pop() || connKeyPath;
            setUploadedKey({
              name: fileName,
              size: 'Saved Key',
              type: 'OpenSSH Private Key (.pem)',
              content: connKeyPath,
            });
          } else {
            setUploadedKey(null);
          }
        } else {
          // Auto-select Password if password is saved or authMethod is password
          setAuthMethod('password');
          setPrivateKeyPath(connKeyPath || '');
          if (connKeyPath) {
            const fileName = connKeyPath.split(/[\\/]/).pop() || connKeyPath;
            setUploadedKey({
              name: fileName,
              size: 'Saved Key',
              type: 'OpenSSH Private Key (.pem)',
              content: connKeyPath,
            });
          } else {
            setUploadedKey(null);
          }
        }
      }
    }
  }, [selectedId, connections]);

  // Native file selection - points directly to existing file on disk (zero disk writes)
  const handleSelectKeyFile = async () => {
    const selectedPath = await pickKeyFile();
    if (selectedPath) {
      const fileName = selectedPath.split(/[\\/]/).pop() || selectedPath;
      setPrivateKeyPath(selectedPath);
      setUploadedKey({
        name: fileName,
        size: 'Local Key File',
        type: 'OpenSSH Private Key (.pem)',
        content: selectedPath,
      });
    } else {
      keyFileInputRef.current?.click();
    }
  };

  // Modal key picker for add/edit modal
  const handleSelectModalKeyFile = async () => {
    const selectedPath = await pickKeyFile();
    if (selectedPath) {
      setModalForm(f => ({ ...f, privateKeyPath: selectedPath }));
    }
  };

  // First profile key picker
  const handleSelectFirstProfileKeyFile = async () => {
    const selectedPath = await pickKeyFile();
    if (selectedPath) {
      setFirstProfile(f => ({ ...f, privateKeyPath: selectedPath }));
    }
  };

  // Handle uploaded SSH key files (drag & drop or input fallback)
  const handleKeyFileUpload = (file: File) => {
    const nativePath = (file as any).path;
    if (nativePath) {
      setPrivateKeyPath(nativePath);
      setUploadedKey({
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        type: 'OpenSSH Private Key (.pem)',
        content: nativePath,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      let detectedType = 'OpenSSH Private Key (.pem)';
      if (text.includes('OPENSSH PRIVATE KEY')) detectedType = 'OpenSSH Private Key (.pem)';
      else if (text.includes('RSA PRIVATE KEY')) detectedType = 'RSA Private Key (.pem)';
      else if (text.includes('EC PRIVATE KEY')) detectedType = 'ECDSA Private Key (.pem)';
      else if (text.includes('ENCRYPTED')) detectedType = 'Encrypted Key';
      else if (file.name.toLowerCase().endsWith('.pem')) detectedType = 'PEM Private Key (.pem)';

      setUploadedKey({
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        type: detectedType,
        content: text,
      });
      setPrivateKeyPath(text);
    };
    reader.readAsText(file);
  };

  const handleKeyDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingKey(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleKeyFileUpload(e.dataTransfer.files[0]);
    }
  };

  // Pre-flight connection test probe
  const handleTestProbe = async () => {
    const targetHost = host.trim() || selectedConn?.host;
    if (!targetHost) {
      setErrorMsg('Please enter a host IP or domain to test.');
      return;
    }
    setIsTestingProbe(true);
    setProbeResult({ status: 'idle' });
    const startTime = performance.now();
    try {
      const ok = await sshTestConnection({
        host: targetHost,
        port: Number(port) || 22,
        username: username.trim() || 'root',
      });
      const latency = Math.round(performance.now() - startTime);
      if (ok) {
        setProbeResult({ status: 'success', latency, message: `Port ${port || 22} reachable (${latency}ms)` });
      } else {
        setProbeResult({ status: 'failed', latency, message: `Host unreachable on port ${port || 22}` });
      }
    } catch (err: any) {
      const latency = Math.round(performance.now() - startTime);
      setProbeResult({ status: 'failed', latency, message: err?.message || 'Connection timed out' });
    } finally {
      setIsTestingProbe(false);
    }
  };

  // Helper to sanitize key file paths
  const sanitizeKeyPath = (str?: string) => {
    if (!str) return undefined;
    const trimmed = str.trim();
    if (!trimmed || trimmed.includes('\n') || trimmed.includes('-----BEGIN') || trimmed.includes('PuTTY-User-Key-File')) {
      return undefined;
    }
    return trimmed;
  };

  // Launch / Connect Handler with Apple-style progress
  const handleLaunch = async (connId?: string, overrideConn?: any) => {
    setIsConnecting(true);
    setErrorMsg(null);
    setConnectingStep('Resolving host address & routing network path...');
    setConnectingProgress(20);

    try {
      const conn = overrideConn || (connId ? connections.find(c => c.id === connId) : null);
      const targetHost = (host.trim() || conn?.host || '').trim();
      const targetPort = Number(port) || conn?.port || 22;
      const targetUsername = (username.trim() || conn?.username || 'root').trim();
      const effectivePassword = password || (conn as any)?.password;
      const effectiveKey = privateKeyPath || (conn as any)?.privateKeyPath || (conn as any)?.private_key_path || uploadedKey?.content;

      if (!targetHost) {
        setErrorMsg('Please provide a remote Linux server host IP or domain.');
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setIsConnecting(false);
        return;
      }

      if (authMethod === 'password' && !effectivePassword) {
        setErrorMsg('Please enter your SSH user password.');
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setIsConnecting(false);
        return;
      }

      if (authMethod === 'key' && !effectiveKey) {
        setErrorMsg('Please select or specify your SSH private key file.');
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setIsConnecting(false);
        return;
      }

      setTimeout(() => {
        setConnectingStep('Negotiating SSH2 cryptographic handshake (Curve25519-SHA256)...');
        setConnectingProgress(45);
      }, 400);

      setTimeout(() => {
        setConnectingStep(`Authenticating as ${targetUsername} (${authMethod === 'key' ? 'Public Key' : 'Password'})...`);
        setConnectingProgress(70);
      }, 800);

      setTimeout(() => {
        setConnectingStep('Allocating remote pseudo-terminal & SFTP filesystem channels...');
        setConnectingProgress(90);
      }, 1200);

      const targetId = connId || `server-${Date.now()}`;
      const targetConfig: any = {
        id: targetId,
        name: serverName.trim() || `${targetUsername}@${targetHost}`,
        host: targetHost,
        port: targetPort,
        username: targetUsername,
        authMethod,
        password: authMethod === 'password' ? effectivePassword : undefined,
        privateKeyPath: authMethod === 'key' ? effectiveKey : undefined,
        color: conn?.color || '#89b4fa',
        group: 'Servers',
        tags: ['Linux', 'SSH2 direct'],
        created_at: Date.now()
      };

      if (saveCredentials) {
        if (!connId) {
          const profileToSave = {
            ...targetConfig,
            privateKeyPath: sanitizeKeyPath(targetConfig.privateKeyPath),
            private_key_path: sanitizeKeyPath(targetConfig.privateKeyPath),
          };
          addConnection(profileToSave);
        } else if (conn) {
          const updatedProfile = {
            ...conn,
            name: serverName.trim() || conn.name,
            host: targetHost,
            port: targetPort,
            username: targetUsername,
            authMethod,
            auth_method: authMethod,
            password: authMethod === 'password' ? effectivePassword : undefined,
            privateKeyPath: authMethod === 'key' ? sanitizeKeyPath(effectiveKey) : undefined,
            private_key_path: authMethod === 'key' ? sanitizeKeyPath(effectiveKey) : undefined,
          };
          updateConnection(connId, updatedProfile);
        }
      } else {
        if (!connId) {
          const profileToSave = {
            ...targetConfig,
            password: undefined,
            privateKeyPath: undefined,
            private_key_path: undefined,
          };
          addConnection(profileToSave);
        }
      }

      await connect(targetId, targetConfig);
      setConnectingProgress(100);
      setConnectingStep('Welcome to CloudDesk. Launching desktop...');
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      setErrorMsg(msg || 'Authentication failed: Please verify host address, port, and credentials.');
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setIsConnecting(false);
      setConnectingProgress(10);
    }
  };

  // Open Edit Profile Modal
  const handleOpenEditModal = (targetConn?: any) => {
    // Ensure targetConn is an actual connection object, not a React SyntheticEvent
    const connToEdit = (targetConn && typeof targetConn === 'object' && ('host' in targetConn || 'id' in targetConn))
      ? targetConn
      : selectedConn;

    if (!connToEdit) return;

    const keyP = (connToEdit as any).privateKeyPath || (connToEdit as any).private_key_path || '';
    const isKey = (connToEdit as any).authMethod === 'key' || (connToEdit as any).auth_method === 'key' || (Boolean(keyP) && !connToEdit.password);

    setModalMode('edit');
    setModalForm({
      id: connToEdit.id,
      name: connToEdit.name || '',
      host: connToEdit.host || '',
      port: connToEdit.port || 22,
      username: connToEdit.username || 'root',
      authMethod: isKey ? 'key' : 'password',
      password: connToEdit.password || '',
      privateKeyPath: keyP,
    });
    setProfileModalOpen(true);
  };

  // Open Add Profile Modal
  const handleOpenAddModal = () => {
    setModalMode('add');
    setModalForm({
      id: '',
      name: '',
      host: '',
      port: 22,
      username: 'root',
      authMethod: 'password',
      password: '',
      privateKeyPath: '',
    });
    setProfileModalOpen(true);
  };

  // Save Add/Edit Profile Modal
  const handleSaveProfileModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalForm.host.trim()) return;

    const cleanName = modalForm.name.trim() || `${modalForm.username.trim()}@${modalForm.host.trim()}`;
    const cleanHost = modalForm.host.trim();
    const cleanPort = Number(modalForm.port) || 22;
    const cleanUser = modalForm.username.trim() || 'root';
    const keyPath = modalForm.authMethod === 'key' ? sanitizeKeyPath(modalForm.privateKeyPath) : undefined;
    const pass = modalForm.authMethod === 'password' ? (modalForm.password || undefined) : undefined;

    if (modalMode === 'edit') {
      const existing = connections.find(c => c.id === modalForm.id);
      const updatedConn: any = {
        ...existing,
        id: modalForm.id,
        name: cleanName,
        host: cleanHost,
        port: cleanPort,
        username: cleanUser,
        authMethod: modalForm.authMethod,
        auth_method: modalForm.authMethod,
        password: pass,
        privateKeyPath: keyPath,
        private_key_path: keyPath,
        color: existing?.color || '#89b4fa',
        group: existing?.group || 'Servers',
        tags: existing?.tags || ['Linux', 'CloudDesk'],
        created_at: existing?.created_at || Date.now(),
      };
      updateConnection(modalForm.id, updatedConn);
      setSelectedId(modalForm.id);

      // Synchronize active connection screen state
      setHost(cleanHost);
      setPort(cleanPort);
      setUsername(cleanUser);
      setServerName(cleanName);
      setPassword(pass || '');
      setPrivateKeyPath(keyPath || '');
      setAuthMethod(modalForm.authMethod);
      if (keyPath) {
        setUploadedKey({
          name: keyPath.split(/[\\/]/).pop() || keyPath,
          size: 'Saved Key',
          type: 'OpenSSH Private Key (.pem)',
          content: keyPath,
        });
      } else {
        setUploadedKey(null);
      }
      setProfileModalOpen(false);
    } else {
      const newId = `server-${Date.now()}`;
      const newConn: any = {
        id: newId,
        name: cleanName,
        host: cleanHost,
        port: cleanPort,
        username: cleanUser,
        authMethod: modalForm.authMethod,
        auth_method: modalForm.authMethod,
        password: pass,
        privateKeyPath: keyPath,
        private_key_path: keyPath,
        color: '#89b4fa',
        group: 'Servers',
        tags: ['Linux', 'CloudDesk'],
        created_at: Date.now()
      };
      addConnection(newConn);
      setSelectedId(newId);

      // Synchronize active connection screen state to new profile
      setHost(cleanHost);
      setPort(cleanPort);
      setUsername(cleanUser);
      setServerName(cleanName);
      setPassword(pass || '');
      setPrivateKeyPath(keyPath || '');
      setAuthMethod(modalForm.authMethod);
      if (keyPath) {
        setUploadedKey({
          name: keyPath.split(/[\\/]/).pop() || keyPath,
          size: 'Saved Key',
          type: 'OpenSSH Private Key (.pem)',
          content: keyPath,
        });
      } else {
        setUploadedKey(null);
      }
      setProfileModalOpen(false);
    }
  };

  // Handle First Profile Creation and Immediate Connection
  const handleCreateFirstProfileAndConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstProfile.host.trim()) return;
    const newId = `server-${Date.now()}`;
    const cleanName = firstProfile.name.trim() || `${firstProfile.username.trim()}@${firstProfile.host.trim()}`;
    const keyPath = firstProfile.authMethod === 'key' ? sanitizeKeyPath(firstProfile.privateKeyPath) : undefined;
    const pass = firstProfile.authMethod === 'password' ? firstProfile.password : undefined;

    const newConn: any = {
      id: newId,
      name: cleanName,
      host: firstProfile.host.trim(),
      port: Number(firstProfile.port) || 22,
      username: firstProfile.username.trim() || 'root',
      authMethod: firstProfile.authMethod,
      auth_method: firstProfile.authMethod,
      password: saveCredentials ? pass : undefined,
      privateKeyPath: saveCredentials ? keyPath : undefined,
      private_key_path: saveCredentials ? keyPath : undefined,
      color: '#89b4fa',
      group: 'Servers',
      tags: ['Linux', 'CloudDesk'],
      created_at: Date.now()
    };
    addConnection(newConn);
    setSelectedId(newId);
    setHost(newConn.host);
    setPort(newConn.port);
    setUsername(newConn.username);
    setPassword(pass || '');
    setPrivateKeyPath(keyPath || '');
    setAuthMethod(firstProfile.authMethod);
    await handleLaunch(newId, newConn);
  };

  // ~/.ssh/config Parser
  const handleImportSshConfig = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sshConfigInput.trim()) return;

    const lines = sshConfigInput.split(/\r?\n/);
    const parsedServers: any[] = [];
    let currentHost: any = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const [key, ...rest] = line.split(/\s+/);
      const val = rest.join(' ');
      const lowerKey = key.toLowerCase();

      if (lowerKey === 'host') {
        if (currentHost && currentHost.host) {
          parsedServers.push(currentHost);
        }
        currentHost = {
          id: `ssh-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          name: val,
          host: '',
          port: 22,
          username: 'root',
          authMethod: 'password',
          color: '#cba6f7',
          group: 'SSH Config',
          tags: ['Imported', 'SSH Config']
        };
      } else if (currentHost) {
        if (lowerKey === 'hostname') {
          currentHost.host = val;
        } else if (lowerKey === 'user') {
          currentHost.username = val;
        } else if (lowerKey === 'port') {
          currentHost.port = parseInt(val) || 22;
        } else if (lowerKey === 'identityfile') {
          currentHost.authMethod = 'key';
          currentHost.privateKeyPath = val;
        }
      }
    }

    if (currentHost && currentHost.host) {
      parsedServers.push(currentHost);
    }

    parsedServers.forEach(s => addConnection(s));
    setSshConfigImportCount(parsedServers.length);
    setTimeout(() => {
      if (parsedServers.length > 0) {
        setSelectedId(parsedServers[0].id);
      }
      setShowImportModal(false);
      setSshConfigImportCount(null);
      setSshConfigInput('');
    }, 1200);
  };

  // Active Wallpaper
  const isCustom = wallpaper?.startsWith('data:') || wallpaper?.startsWith('http') || wallpaper?.startsWith('blob:');
  const activeWallpaperItem = WALLPAPERS.find(w => w.id === wallpaper) || WALLPAPERS[0];
  const activeWallpaperUrl = isCustom ? wallpaper : activeWallpaperItem.url;

  return (
    <div 
      className="relative w-screen h-screen overflow-hidden select-none bg-[#0c0d14] text-white flex flex-col font-sans"
      style={{
        backgroundImage: `url("${activeWallpaperUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    >
      {/* Deep Frosted Acrylic Glass Layer */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-3xl" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />

      {/* Top macOS Menu Bar */}
      <div className="relative z-30 shrink-0 w-full h-8 bg-black/40 backdrop-blur-2xl border-b border-white/10 px-4 flex items-center justify-between text-xs text-white/90">
        {/* Left Apple Menu & App Identity */}
        <div className="flex items-center space-x-4">
          <div className="relative">
            <button
              onClick={() => setShowAppleMenu(!showAppleMenu)}
              className="p-1 hover:bg-white/10 rounded-md font-bold text-sm tracking-wide transition-colors"
              title="Apple Menu"
            >
              
            </button>

            {/* Apple Dropdown */}
            {showAppleMenu && (
              <div 
                className="absolute top-7 left-0 w-52 bg-[#181825]/95 backdrop-blur-2xl border border-white/15 rounded-xl shadow-2xl py-1 text-xs text-gray-200 z-50 animate-in fade-in duration-100"
                onClick={() => setShowAppleMenu(false)}
              >
                <div 
                  onClick={() => setShowAboutModal(true)}
                  className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-md mx-1 cursor-pointer font-medium"
                >
                  About This Cloud Mac
                </div>
                <div className="my-1 border-t border-white/10 mx-2" />
                <div 
                  onClick={() => setShowProfileManagerModal(true)}
                  className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-md mx-1 cursor-pointer flex items-center justify-between"
                >
                  <span>Server Profile Manager...</span>
                  <span className="text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full">{connections.length}</span>
                </div>
                <div 
                  onClick={handleOpenAddModal}
                  className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-md mx-1 cursor-pointer"
                >
                  Add Server Profile...
                </div>
                <div 
                  onClick={() => setShowImportModal(true)}
                  className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-md mx-1 cursor-pointer"
                >
                  Import ~/.ssh/config...
                </div>
                <div className="my-1 border-t border-white/10 mx-2" />
                <div 
                  onClick={() => {
                    const hostToLaunch = host || selectedConn?.host;
                    if (hostToLaunch) sshLaunchPutty(selectedConn?.id || 'default');
                  }}
                  className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-md mx-1 cursor-pointer flex items-center space-x-2"
                >
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Launch PuTTY Terminal</span>
                </div>
                <div className="my-1 border-t border-white/10 mx-2" />
                <div 
                  onClick={() => window.location.reload()}
                  className="px-3.5 py-1.5 hover:bg-blue-600 hover:text-white rounded-md mx-1 cursor-pointer"
                >
                  Restart Session
                </div>
              </div>
            )}
          </div>

          <span className="font-bold tracking-tight text-white flex items-center space-x-1.5">
            <span>CloudDesk</span>
            <span className="text-[10px] px-1.5 py-0.2 bg-blue-500/20 text-blue-300 rounded-full font-mono border border-blue-400/30">2.0</span>
          </span>

          <span className="text-white/40 hidden sm:inline">|</span>
          <span className="text-white/70 text-[11px] hidden sm:inline">Linux Remote Desktop</span>
        </div>

        {/* Right Status Controls */}
        <div className="flex items-center space-x-3.5 text-[11px] font-medium">
          {/* Probe Latency Badge */}
          {probeResult.status === 'success' && (
            <div className="hidden md:flex items-center space-x-1 text-emerald-400 font-mono bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{probeResult.latency}ms</span>
            </div>
          )}

          {/* Test Probe Action */}
          <button
            onClick={handleTestProbe}
            disabled={isTestingProbe}
            className="hidden sm:flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-white/10 hover:bg-white/20 border border-white/15 text-white/80 hover:text-white transition-colors"
            title="Probe host connectivity on port 22"
          >
            <Wifi className={`w-3 h-3 ${isTestingProbe ? 'animate-spin text-blue-400' : 'text-emerald-400'}`} />
            <span>{isTestingProbe ? 'Probing...' : 'Test Port 22'}</span>
          </button>

          {/* Wallpaper Quick Switcher Button */}
          <div className="relative">
            <button
              onClick={() => setShowWallpaperMenu(!showWallpaperMenu)}
              className="p-1 hover:bg-white/10 rounded-md text-white/70 hover:text-white transition-colors"
              title="Change 4K Wallpaper"
            >
              <Palette className="w-3.5 h-3.5" />
            </button>

            {showWallpaperMenu && (
              <div 
                className="absolute top-7 right-0 w-64 bg-[#181825]/95 backdrop-blur-2xl border border-white/15 rounded-2xl shadow-2xl p-2 z-50 animate-in fade-in duration-100"
                onClick={() => setShowWallpaperMenu(false)}
              >
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-2 py-1 mb-1">
                  macOS 4K Wallpapers
                </div>
                <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
                  {WALLPAPERS.map(w => (
                    <button
                      key={w.id}
                      onClick={() => updateSettings({ wallpaper: w.id })}
                      className={`relative rounded-xl overflow-hidden p-1 text-left border transition-all ${
                        wallpaper === w.id ? 'border-blue-400 ring-2 ring-blue-500/40 bg-blue-500/10' : 'border-white/10 hover:border-white/20'
                      }`}
                    >
                      <img src={w.thumbnail} alt={w.name} className="w-full h-12 object-cover rounded-lg mb-1" />
                      <div className="text-[10px] font-semibold text-white truncate px-0.5">{w.name}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Clock */}
          <div className="flex items-center space-x-1.5 pl-1">
            <span className="text-white/80">{liveDate}</span>
            <span className="font-bold text-white font-mono">{liveTime || '12:00'}</span>
          </div>
        </div>
      </div>

      {/* Main Center Canvas - Full Scrollable Viewport without clipping */}
      <div className="relative z-10 flex-1 overflow-y-auto overflow-x-hidden flex flex-col items-center justify-center p-3 sm:p-5 w-full">
        <div className="w-full max-w-md my-auto flex flex-col items-center space-y-3.5 sm:space-y-4">
          
          {/* Apple Display Clock Header */}
          <div className="text-center">
            <div className="text-4xl sm:text-5xl font-extralight tracking-tight text-white drop-shadow-[0_5px_20px_rgba(0,0,0,0.6)] font-sans">
              {liveTime || '12:00'}
            </div>
            <div className="text-xs sm:text-sm font-medium text-white/70 drop-shadow mt-0.5 tracking-wide font-sans">
              {liveDate}
            </div>
          </div>

          {/* SCENARIO A: 0 Profiles Saved -> Show "Create Server Profile" Directly */}
          {connections.length === 0 ? (
            <div className="w-full bg-[#161828]/90 backdrop-blur-2xl border border-white/20 rounded-3xl p-6 shadow-[0_20px_70px_rgba(0,0,0,0.7)] space-y-4 animate-in fade-in duration-200">
              <div className="flex flex-col items-center text-center space-y-1.5">
                <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-400/30 flex items-center justify-center shadow-lg">
                  <Server className="w-7 h-7 text-blue-400" />
                </div>
                <h2 className="text-base font-bold text-white">Welcome to CloudDesk</h2>
                <p className="text-xs text-gray-400 max-w-xs">
                  No server profiles configured. Enter your remote Linux server details to connect:
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-start space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                  <div className="flex-1 text-[11px] leading-relaxed break-words">{errorMsg}</div>
                </div>
              )}

              <form onSubmit={handleCreateFirstProfileAndConnect} className="space-y-3 text-xs">
                <div>
                  <label className="text-gray-300 block mb-1 font-medium">Server Profile Label</label>
                  <input
                    type="text"
                    placeholder="e.g. Production VPS, Ubuntu Node"
                    value={firstProfile.name}
                    onChange={e => setFirstProfile(f => ({ ...f, name: e.target.value }))}
                    className="w-full bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-gray-300 block mb-1 font-medium">Host IP / Domain</label>
                    <input
                      type="text"
                      required
                      placeholder="192.168.1.100 or server.com"
                      value={firstProfile.host}
                      onChange={e => setFirstProfile(f => ({ ...f, host: e.target.value }))}
                      className="w-full bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-gray-300 font-medium">Port</label>
                      <div className="flex items-center space-x-1">
                        <button type="button" onClick={() => setFirstProfile(f => ({ ...f, port: 22 }))} className={`px-1.5 py-0.5 rounded text-[10px] ${firstProfile.port === 22 ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-400 hover:text-white'}`}>22 (SSH)</button>
                      </div>
                    </div>
                    <input
                      type="number"
                      value={firstProfile.port || ''}
                      placeholder="22"
                      onChange={e => setFirstProfile(f => ({ ...f, port: e.target.value === '' ? ('' as any) : (parseInt(e.target.value) || 0) }))}
                      onBlur={() => setFirstProfile(f => ({ ...f, port: Number(f.port) || 22 }))}
                      className="w-full bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500 text-center"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-gray-300 block mb-1 font-medium">SSH Username</label>
                  <input
                    type="text"
                    required
                    placeholder="root or ubuntu"
                    value={firstProfile.username}
                    onChange={e => setFirstProfile(f => ({ ...f, username: e.target.value }))}
                    className="w-full bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>

                {/* Auth Method Switcher */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-gray-300 block font-medium">Authentication Method</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFirstProfile(f => ({ ...f, authMethod: 'password' }))}
                      className={`py-1.5 px-3 rounded-xl border flex items-center justify-center space-x-1.5 transition-all ${
                        firstProfile.authMethod === 'password'
                          ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                          : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                      }`}
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Password</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFirstProfile(f => ({ ...f, authMethod: 'key' }))}
                      className={`py-1.5 px-3 rounded-xl border flex items-center justify-center space-x-1.5 transition-all ${
                        firstProfile.authMethod === 'key'
                          ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                          : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                      }`}
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>SSH Key</span>
                    </button>
                  </div>
                </div>

                {firstProfile.authMethod === 'password' ? (
                  <div>
                    <label className="text-gray-300 block mb-1 font-medium">Password</label>
                    <input
                      type="password"
                      placeholder="Enter server password..."
                      value={firstProfile.password}
                      onChange={e => setFirstProfile(f => ({ ...f, password: e.target.value }))}
                      className="w-full bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-gray-300 block mb-1 font-medium">SSH Private Key</label>
                    <div 
                      onClick={handleSelectFirstProfileKeyFile}
                      className="cursor-pointer bg-[#10121d] border border-dashed border-white/20 hover:border-blue-500/60 rounded-xl p-3 flex items-center justify-between text-xs transition-colors"
                    >
                      <div className="flex items-center space-x-2 truncate">
                        <Key className="w-4 h-4 text-blue-400 shrink-0" />
                        <span className="text-gray-300 truncate">
                          {firstProfile.privateKeyPath || 'Click to select key (.pem, id_rsa, id_ed25519)...'}
                        </span>
                      </div>
                      <span className="text-[10px] text-blue-400 shrink-0 font-medium ml-2">Browse</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-2 pt-1 pb-1">
                  <input
                    type="checkbox"
                    id="save-creds-first"
                    checked={saveCredentials}
                    onChange={e => setSaveCredentials(e.target.checked)}
                    className="w-3.5 h-3.5 rounded border-white/20 bg-white/10 text-blue-600 focus:ring-0 cursor-pointer"
                  />
                  <label htmlFor="save-creds-first" className="text-[11px] text-gray-300 cursor-pointer select-none">
                    Save password / private key in server profile
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={isConnecting}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl py-2.5 text-xs flex items-center justify-center space-x-2 transition-all shadow-md active:scale-95 mt-2"
                >
                  <Server className="w-4 h-4" />
                  <span>Save Profile & Connect</span>
                </button>

                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => setShowImportModal(true)}
                    className="text-[11px] text-gray-400 hover:text-white transition-colors underline"
                  >
                    Or import existing ~/.ssh/config profiles
                  </button>
                </div>
              </form>
            </div>
          ) : (
            /* SCENARIO B: Profiles Exist -> Show Carousel & Login Card */
            <>
              {/* Server Profiles Bar: Search Filter, Manage Button, Left/Right Carousel Controls */}
              <div className="w-full flex flex-col space-y-2">
                {/* Carousel Top Controls */}
                <div className="flex items-center justify-between px-1 text-xs">
                  {/* Left: Quick Search Filter */}
                  <div className="relative flex-1 max-w-[200px]">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2" />
                    <input
                      type="text"
                      placeholder="Filter profiles..."
                      value={profileSearch}
                      onChange={(e) => setProfileSearch(e.target.value)}
                      className="w-full pl-8 pr-6 py-1 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    {profileSearch && (
                      <button
                        onClick={() => setProfileSearch('')}
                        className="absolute right-2 top-1.5 text-gray-400 hover:text-white text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Right: Manage All Profiles & Add New Profile Buttons */}
                  <div className="flex items-center space-x-1.5">
                    <button
                      type="button"
                      onClick={() => setShowProfileManagerModal(true)}
                      className="px-2.5 py-1 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-[11px] font-medium text-white flex items-center space-x-1.5 transition-all shadow-sm active:scale-95"
                      title="Open full Server Profile Manager"
                    >
                      <SlidersHorizontal className="w-3 h-3 text-blue-400" />
                      <span>Manage All ({connections.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenAddModal}
                      className="p-1 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 transition-all active:scale-95"
                      title="Add New Server Profile"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Profiles Carousel with Left/Right Smooth Navigation */}
                <div className="relative flex items-center w-full">
                  {connections.length > 4 && (
                    <button
                      type="button"
                      onClick={() => scrollCarousel('left')}
                      className="absolute -left-3 z-20 w-7 h-7 rounded-full bg-black/70 hover:bg-black/90 text-white/80 hover:text-white border border-white/20 shadow-lg flex items-center justify-center transition-all backdrop-blur-md active:scale-90"
                      title="Scroll Left"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  )}

                  <div 
                    ref={carouselRef}
                    className="flex items-center space-x-2.5 overflow-x-auto pb-1 max-w-full scrollbar-none px-2 scroll-smooth justify-start"
                  >
                    {filteredConnections.length === 0 ? (
                      <div className="py-2 px-4 text-center text-xs text-gray-400 italic w-full">
                        No profiles match "{profileSearch}"
                      </div>
                    ) : (
                      filteredConnections.map(conn => {
                        const isSelected = selectedId === conn.id;
                        return (
                          <div
                            key={conn.id}
                            onClick={() => setSelectedId(conn.id)}
                            className={`group flex flex-col items-center p-2 rounded-2xl cursor-pointer transition-all duration-200 text-center shrink-0 ${
                              isSelected
                                ? 'scale-105 bg-white/15 backdrop-blur-xl border border-white/30 shadow-[0_8px_20px_rgba(0,0,0,0.5)]'
                                : 'hover:bg-white/5 opacity-75 hover:opacity-100 border border-transparent'
                            }`}
                            title={`${conn.name} (${conn.username}@${conn.host}:${conn.port || 22})`}
                          >
                            <div className="relative">
                              <div 
                                className={`w-12 h-12 rounded-full flex items-center justify-center shadow-md border-2 transition-transform ${
                                  isSelected ? 'border-blue-400 scale-105' : 'border-white/20 group-hover:border-white/40'
                                }`}
                                style={{ backgroundColor: conn.color ? `${conn.color}25` : '#89b4fa25' }}
                              >
                                <span className="text-base font-bold text-white uppercase font-sans">
                                  {conn.name ? conn.name[0] : conn.username[0]}
                                </span>
                              </div>

                              {/* Status dot */}
                              <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-black flex items-center justify-center">
                                <span className="w-1 h-1 rounded-full bg-white" />
                              </span>

                              {/* Hover quick delete */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (confirm(`Delete saved profile "${conn.name || conn.host}"?`)) {
                                    removeConnection(conn.id);
                                    if (selectedId === conn.id) {
                                      const remaining = connections.filter(c => c.id !== conn.id);
                                      setSelectedId(remaining[0]?.id || null);
                                    }
                                  }
                                }}
                                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-20"
                                title="Delete profile"
                              >
                                <Trash2 className="w-2.5 h-2.5" />
                              </button>
                            </div>

                            <span className="text-[10px] font-semibold text-white mt-1 truncate max-w-[90px]" title={conn.name}>
                              {conn.name}
                            </span>
                          </div>
                        );
                      })
                    )}

                    {/* "+ New" Circle */}
                    <div
                      onClick={handleOpenAddModal}
                      className="flex flex-col items-center p-2 rounded-2xl cursor-pointer hover:bg-white/10 opacity-70 hover:opacity-100 border border-dashed border-white/20 transition-all text-center group shrink-0"
                      title="Add New Server Profile"
                    >
                      <div className="w-12 h-12 rounded-full bg-white/5 border border-dashed border-white/20 flex items-center justify-center text-white/60 group-hover:text-white group-hover:scale-105 transition-transform">
                        <Plus className="w-5 h-5" />
                      </div>
                      <span className="text-[10px] font-medium text-white/80 mt-1">New</span>
                    </div>
                  </div>

                  {connections.length > 4 && (
                    <button
                      type="button"
                      onClick={() => scrollCarousel('right')}
                      className="absolute -right-3 z-20 w-7 h-7 rounded-full bg-black/70 hover:bg-black/90 text-white/80 hover:text-white border border-white/20 shadow-lg flex items-center justify-center transition-all backdrop-blur-md active:scale-90"
                      title="Scroll Right"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Central Frosted Glass Login Card */}
              <div className={`w-full bg-[#161828]/90 backdrop-blur-2xl border ${
                shake ? 'border-red-500 animate-lock-shake' : 'border-white/20'
              } rounded-3xl p-5 shadow-[0_25px_80px_rgba(0,0,0,0.7)] space-y-3.5 relative transition-all`}>
                
                {/* User Profile Header with Searchable Quick Switcher Popover */}
                <div className="flex flex-col items-center text-center space-y-1.5 relative">
                  <div className="relative">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 p-0.5 shadow-xl border border-white/30 flex items-center justify-center">
                      <div className="w-full h-full rounded-full bg-[#1e1e2e]/90 flex items-center justify-center text-xl font-bold text-white uppercase font-sans">
                        {selectedConn?.name ? selectedConn.name[0] : username[0] || 'S'}
                      </div>
                    </div>
                    <span className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-emerald-500 border-2 border-black flex items-center justify-center">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </span>
                  </div>

                  {/* Server Profile Label with Switcher Trigger */}
                  <div className="relative" ref={quickSwitchRef}>
                    <button
                      type="button"
                      onClick={() => setShowQuickSwitchDropdown(!showQuickSwitchDropdown)}
                      className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 border border-white/15 transition-all text-center group cursor-pointer"
                      title="Click to search and quickly switch between server profiles"
                    >
                      <span className="text-sm font-bold text-white group-hover:text-blue-300 transition-colors truncate max-w-[220px]">
                        {selectedConn?.name || `${username}@${host || 'remote-node'}`}
                      </span>
                      <ChevronDown className="w-3.5 h-3.5 text-gray-400 group-hover:text-white transition-transform" />
                    </button>

                    {/* Quick Switch Dropdown Popover */}
                    {showQuickSwitchDropdown && (
                      <div className="absolute top-9 left-1/2 -translate-x-1/2 w-80 bg-[#161828]/95 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-2xl p-2.5 z-50 animate-in fade-in zoom-in-95 duration-100 text-left">
                        <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10">
                          <span className="text-[11px] font-bold text-white uppercase tracking-wider">Switch Server</span>
                          <button
                            type="button"
                            onClick={() => {
                              setShowQuickSwitchDropdown(false);
                              setShowProfileManagerModal(true);
                            }}
                            className="text-[10px] text-blue-400 hover:text-blue-300 font-medium"
                          >
                            Manage All ({connections.length}) →
                          </button>
                        </div>

                        {/* Search Input in Popover */}
                        <div className="relative mb-2">
                          <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2" />
                          <input
                            type="text"
                            autoFocus
                            placeholder="Search by name, IP, user..."
                            value={profileSearch}
                            onChange={(e) => setProfileSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                          />
                        </div>

                        {/* Profiles List */}
                        <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
                          {filteredConnections.length === 0 ? (
                            <div className="p-3 text-center text-xs text-gray-400">
                              No matching servers found
                            </div>
                          ) : (
                            filteredConnections.map(conn => {
                              const isCurr = conn.id === selectedId;
                              return (
                                <button
                                  key={conn.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedId(conn.id);
                                    setShowQuickSwitchDropdown(false);
                                  }}
                                  className={`w-full p-2 rounded-xl flex items-center justify-between text-left transition-all ${
                                    isCurr
                                      ? 'bg-blue-600/30 border border-blue-500/40 text-white'
                                      : 'hover:bg-white/5 border border-transparent text-gray-300 hover:text-white'
                                  }`}
                                >
                                  <div className="flex items-center space-x-2.5 truncate">
                                    <div 
                                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                                      style={{ backgroundColor: conn.color ? `${conn.color}30` : '#89b4fa30', color: conn.color || '#89b4fa' }}
                                    >
                                      {conn.name ? conn.name[0].toUpperCase() : conn.username[0].toUpperCase()}
                                    </div>
                                    <div className="truncate">
                                      <div className="text-xs font-semibold truncate leading-tight">{conn.name}</div>
                                      <div className="text-[10px] text-gray-400 font-mono truncate">
                                        {conn.username}@{conn.host}:{conn.port || 22}
                                      </div>
                                    </div>
                                  </div>
                                  {isCurr && <Check className="w-3.5 h-3.5 text-blue-400 shrink-0 ml-2" />}
                                </button>
                              );
                            })
                          )}
                        </div>

                        <div className="pt-2 mt-2 border-t border-white/10 flex justify-between items-center text-[10px]">
                          <span className="text-gray-400">{filteredConnections.length} of {connections.length} servers</span>
                          <button
                            type="button"
                            onClick={() => {
                              setShowQuickSwitchDropdown(false);
                              handleOpenAddModal();
                            }}
                            className="text-blue-400 hover:text-blue-300 font-medium flex items-center space-x-1"
                          >
                            <Plus className="w-3 h-3" />
                            <span>New Profile</span>
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-center space-x-2 text-[10px] text-white/70 font-mono mt-0.5">
                      <span>{username}@{host || 'localhost'}:{port}</span>
                      {probeResult.status === 'success' && (
                        <span className="text-emerald-400 flex items-center space-x-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                          <span>{probeResult.latency}ms</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Error Banner */}
                {errorMsg && (
                  <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-start space-x-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <div className="flex-1 text-[11px] leading-relaxed break-words">{errorMsg}</div>
                  </div>
                )}

                {/* Segmented Auth Switcher: [ Password | SSH Key ] */}
                <div className="flex bg-black/40 p-1 rounded-xl border border-white/10 text-xs">
                  <button
                    type="button"
                    onClick={() => setAuthMethod('password')}
                    className={`flex-1 py-1.5 rounded-lg flex items-center justify-center space-x-1.5 transition-all font-medium ${
                      authMethod === 'password'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Password</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAuthMethod('key')}
                    className={`flex-1 py-1.5 rounded-lg flex items-center justify-center space-x-1.5 transition-all font-medium ${
                      authMethod === 'key'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>SSH Private Key</span>
                  </button>
                </div>

                {/* Authentication Input Field */}
                {authMethod === 'password' ? (
                  <form onSubmit={(e) => { e.preventDefault(); handleLaunch(selectedConn?.id); }} className="space-y-2.5">
                    <div className="relative flex items-center bg-black/40 backdrop-blur-xl border border-white/20 rounded-full px-3.5 py-2 shadow-inner focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-500/30 transition-all">
                      <input
                        id="login-password-input"
                        type={showPassword ? 'text' : 'password'}
                        autoFocus
                        placeholder="Enter SSH password..."
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="bg-transparent text-white placeholder-white/40 text-xs flex-1 focus:outline-none pr-2 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="text-white/50 hover:text-white mr-1.5 transition-colors"
                        title={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        type="submit"
                        disabled={isConnecting}
                        className="w-6 h-6 rounded-full bg-white/20 hover:bg-blue-600 text-white flex items-center justify-center transition-colors shrink-0 shadow active:scale-95"
                        title="Connect to Server"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {selectedConn?.password && (
                      <div className="text-[10px] text-emerald-400 flex items-center justify-center space-x-1">
                        <Check className="w-3 h-3" />
                        <span>Saved password loaded</span>
                      </div>
                    )}

                    <div className="flex items-center justify-center px-1 pt-0.5 text-[11px] text-gray-300">
                      <label className="flex items-center space-x-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={saveCredentials}
                          onChange={e => setSaveCredentials(e.target.checked)}
                          className="w-3.5 h-3.5 rounded border-white/20 bg-white/10 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <span>Save password to server profile</span>
                      </label>
                    </div>

                    {capsLockActive && (
                      <div className="flex items-center justify-center space-x-1 text-[11px] text-amber-300 font-medium">
                        <span>⇪ Caps Lock is on</span>
                      </div>
                    )}
                  </form>
                ) : (
                  <div className="space-y-3">
                    <input
                      type="file"
                      ref={keyFileInputRef}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          handleKeyFileUpload(e.target.files[0]);
                        }
                      }}
                      className="hidden"
                    />

                    {/* Prominently show Key Location when available */}
                    {privateKeyPath ? (
                      <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/15 flex flex-col space-y-1.5 text-left">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">Key Location</span>
                          <span className="text-[10px] text-blue-400 font-mono font-medium">
                            OpenSSH (.pem)
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 bg-black/50 px-2.5 py-1.5 rounded-xl border border-white/10">
                          <Key className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                          <span className="text-xs text-white font-mono truncate flex-1" title={privateKeyPath}>
                            {privateKeyPath}
                          </span>
                          <button
                            type="button"
                            onClick={handleSelectKeyFile}
                            className="text-[11px] text-blue-400 hover:text-blue-300 font-medium shrink-0 ml-1 px-2 py-0.5 rounded bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 transition-colors"
                          >
                            Change
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Dropzone / Browse Button when no key is set */
                      <div
                        onDragOver={(e) => { e.preventDefault(); setIsDraggingKey(true); }}
                        onDragLeave={() => setIsDraggingKey(false)}
                        onDrop={handleKeyDrop}
                        onClick={handleSelectKeyFile}
                        className={`border-2 border-dashed rounded-2xl p-4 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-1.5 ${
                          isDraggingKey
                            ? 'border-blue-500 bg-blue-500/20 scale-[1.02]'
                            : 'border-white/15 bg-white/[0.02] hover:bg-white/[0.06] hover:border-blue-400/50'
                        }`}
                      >
                        <Upload className="w-5 h-5 text-blue-400" />
                        <div className="text-xs text-gray-300 font-medium">
                          Select or Drop Private Key (<span className="font-mono text-gray-400">.pem</span>, <span className="font-mono text-gray-400">id_rsa</span>, <span className="font-mono text-gray-400">id_ed25519</span>)
                        </div>
                        <div className="text-[10px] text-gray-500">Supports OpenSSH (.pem)</div>
                      </div>
                    )}

                    {/* Optional Passphrase input */}
                    <div className="relative flex items-center bg-black/40 border border-white/15 rounded-xl px-3 py-2 text-xs">
                      <input
                        type="password"
                        value={keyPassphrase}
                        onChange={e => setKeyPassphrase(e.target.value)}
                        placeholder="Key passphrase (if encrypted)..."
                        className="bg-transparent text-white placeholder-white/40 flex-1 focus:outline-none font-mono text-xs"
                      />
                    </div>

                    <div className="flex items-center justify-center px-1 pt-0.5 text-[11px] text-gray-300">
                      <label className="flex items-center space-x-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={saveCredentials}
                          onChange={e => setSaveCredentials(e.target.checked)}
                          className="w-3.5 h-3.5 rounded border-white/20 bg-white/10 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <span>Save private key to server profile</span>
                      </label>
                    </div>

                    <button
                      onClick={() => handleLaunch(selectedConn?.id)}
                      disabled={isConnecting}
                      className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl py-2.5 text-xs flex items-center justify-center space-x-2 transition-all shadow-md active:scale-95"
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>Unlock & Connect</span>
                    </button>
                  </div>
                )}

                {/* Edit Server Details & Import Links */}
                <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-gray-400">
                  <button
                    type="button"
                    onClick={() => handleOpenEditModal(selectedConn)}
                    className="hover:text-white transition-colors flex items-center space-x-1"
                  >
                    <Edit2 className="w-3 h-3 text-blue-400" />
                    <span>Edit Server Details</span>
                  </button>

                  <button
                    onClick={() => setShowImportModal(true)}
                    className="hover:text-white transition-colors flex items-center space-x-1"
                  >
                    <FileCode className="w-3 h-3 text-purple-400" />
                    <span>Import ~/.ssh/config</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Bottom Session Controls Bar */}
      <div className="relative z-30 shrink-0 w-full px-6 py-2 bg-black/30 backdrop-blur-xl border-t border-white/10 flex items-center justify-between text-[11px] text-white/70">
        <div className="flex items-center space-x-2">
          <Shield className="w-3.5 h-3.5 text-emerald-400" />
          <span>Direct SSH2 Transport · Agentless</span>
        </div>

        <div className="flex items-center space-x-5">
          <button
            onClick={() => {
              if (selectedConn?.host) {
                sshLaunchPutty(selectedConn.id);
              }
            }}
            className="flex items-center space-x-1 hover:text-white transition-colors"
            title="Open native PuTTY terminal"
          >
            <Terminal className="w-3 h-3 text-emerald-400" />
            <span>PuTTY Terminal</span>
          </button>

          <button
            onClick={() => window.location.reload()}
            className="flex items-center space-x-1 hover:text-white transition-colors"
          >
            <RotateCcw className="w-3 h-3 text-amber-400" />
            <span>Restart</span>
          </button>

          <button
            onClick={() => {
              if (confirm('Close CloudDesk?')) {
                window.close();
              }
            }}
            className="flex items-center space-x-1 hover:text-rose-400 transition-colors"
          >
            <Power className="w-3 h-3 text-rose-400" />
            <span>Quit</span>
          </button>
        </div>
      </div>

      {/* Fullscreen Boot / Connecting Overlay */}
      {isConnecting && (
        <div className="fixed inset-0 z-50 bg-[#0f111a]/95 backdrop-blur-3xl flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-200">
          <div className="w-full max-w-sm flex flex-col items-center space-y-5">
            <div className="w-18 h-18 rounded-3xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-[0_10px_40px_rgba(59,130,246,0.5)] border border-white/30 animate-pulse">
              <Cloud className="w-9 h-9 text-white drop-shadow" />
            </div>

            <div className="w-64 h-1.5 bg-white/10 rounded-full overflow-hidden shadow-inner">
              <div 
                className="h-full bg-white rounded-full transition-all duration-500 ease-out shadow-[0_0_12px_rgba(255,255,255,0.8)]"
                style={{ width: `${connectingProgress}%` }}
              />
            </div>

            <div className="space-y-1">
              <div className="text-sm font-semibold text-white tracking-wide">
                Connecting to {serverName || host}...
              </div>
              <div className="text-[11px] text-gray-400 font-mono">
                {connectingStep}
              </div>
            </div>

            <button
              onClick={() => {
                setIsConnecting(false);
                setErrorMsg('Connection cancelled by user.');
              }}
              className="px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white/80 hover:text-white text-xs font-medium border border-white/15 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Unified Add / Edit Server Profile Modal */}
      {profileModalOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[60] flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
          <form onSubmit={handleSaveProfileModal} className="bg-[#181a2c]/95 backdrop-blur-2xl border border-white/20 rounded-3xl w-full max-w-md p-6 space-y-3.5 shadow-2xl text-xs text-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <Server className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-sm text-white">
                  {modalMode === 'edit' ? 'Edit Server Profile' : 'New Server Profile'}
                </span>
              </div>
              <button 
                type="button" 
                onClick={() => setProfileModalOpen(false)}
                className="w-6 h-6 rounded-full hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-gray-300 block mb-1 font-medium">Profile Name (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Production Cluster, Database Node"
                  value={modalForm.name}
                  onChange={e => setModalForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-gray-300 block mb-1 font-medium">IP Address / Domain</label>
                  <input
                    type="text"
                    required
                    placeholder="192.168.1.100"
                    value={modalForm.host}
                    onChange={e => setModalForm(f => ({ ...f, host: e.target.value }))}
                    className="w-full bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-gray-300 font-medium">Port</label>
                    <div className="flex items-center space-x-1">
                      <button type="button" onClick={() => setModalForm(f => ({ ...f, port: 22 }))} className={`px-1.5 py-0.5 rounded text-[10px] ${modalForm.port === 22 ? 'bg-blue-600 text-white' : 'bg-white/10 text-gray-400 hover:text-white'}`}>22 (SSH)</button>
                    </div>
                  </div>
                  <input
                    type="number"
                    value={modalForm.port || ''}
                    placeholder="22"
                    onChange={e => setModalForm(f => ({ ...f, port: e.target.value === '' ? ('' as any) : (parseInt(e.target.value) || 0) }))}
                    onBlur={() => setModalForm(f => ({ ...f, port: Number(f.port) || 22 }))}
                    className="w-full bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500 text-center"
                  />
                </div>
              </div>

              <div>
                <label className="text-gray-300 block mb-1 font-medium">SSH Username</label>
                <input
                  type="text"
                  required
                  value={modalForm.username}
                  onChange={e => setModalForm(f => ({ ...f, username: e.target.value }))}
                  className="w-full bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Authentication Method Selector in Modal */}
              <div className="space-y-1 pt-1">
                <label className="text-gray-300 block font-medium">Authentication Method</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setModalForm(f => ({ ...f, authMethod: 'password' }))}
                    className={`py-1.5 px-3 rounded-xl border flex items-center justify-center space-x-1.5 transition-all ${
                      modalForm.authMethod === 'password'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                    }`}
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Password</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setModalForm(f => ({ ...f, authMethod: 'key' }))}
                    className={`py-1.5 px-3 rounded-xl border flex items-center justify-center space-x-1.5 transition-all ${
                      modalForm.authMethod === 'key'
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                    }`}
                  >
                    <Key className="w-3.5 h-3.5" />
                    <span>SSH Key</span>
                  </button>
                </div>
              </div>

              {modalForm.authMethod === 'password' ? (
                <div>
                  <label className="text-gray-300 block mb-1 font-medium">Password</label>
                  <input
                    type="password"
                    value={modalForm.password}
                    onChange={e => setModalForm(f => ({ ...f, password: e.target.value }))}
                    placeholder="Saved password..."
                    className="w-full bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              ) : (
                <div>
                  <label className="text-gray-300 block mb-1 font-medium">Private Key File (.pem, id_rsa, .ppk)</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="text"
                      value={modalForm.privateKeyPath}
                      onChange={e => setModalForm(f => ({ ...f, privateKeyPath: e.target.value }))}
                      placeholder="e.g. C:\Users\Sharuk\.ssh\id_rsa or /home/.../key.pem"
                      className="flex-1 bg-[#10121d] border border-white/10 rounded-xl px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                    />
                    <button
                      type="button"
                      onClick={handleSelectModalKeyFile}
                      className="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium transition-colors shrink-0 flex items-center space-x-1"
                    >
                      <Key className="w-3.5 h-3.5 text-blue-400" />
                      <span>Browse</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-3 border-t border-white/10">
              {modalMode === 'edit' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete profile "${modalForm.name}"?`)) {
                      removeConnection(modalForm.id);
                      setProfileModalOpen(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs text-rose-400 hover:bg-rose-500/20 transition-colors flex items-center space-x-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete</span>
                </button>
              ) : <div />}

              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={() => setProfileModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-xl text-xs bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-md transition-all active:scale-95"
                >
                  {modalMode === 'edit' ? 'Save Changes' : 'Create Profile'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Import from ~/.ssh/config Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
          <form onSubmit={handleImportSshConfig} className="bg-[#181a2c]/95 backdrop-blur-2xl border border-white/20 rounded-3xl w-full max-w-lg p-6 space-y-3.5 shadow-2xl text-xs text-gray-200">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <FileCode className="w-4 h-4 text-purple-400" />
                <h3 className="font-bold text-sm text-white">Import from ~/.ssh/config</h3>
              </div>
              <button 
                type="button" 
                onClick={() => setShowImportModal(false)}
                className="w-6 h-6 rounded-full hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors"
              >
                ✕
              </button>
            </div>

            <p className="text-gray-400 text-xs">
              Paste contents of your OpenSSH configuration file. CloudDesk will automatically extract and save host profiles:
            </p>

            <textarea
              rows={7}
              value={sshConfigInput}
              onChange={e => setSshConfigInput(e.target.value)}
              placeholder={`Host web-prod\n    HostName 192.168.1.50\n    User root\n    Port 22\n\nHost db-staging\n    HostName 10.0.0.8\n    User postgres\n    Port 5432`}
              className="w-full bg-[#10121d] border border-white/15 rounded-2xl p-3 text-white font-mono text-[11px] focus:outline-none focus:border-blue-400"
            />

            {sshConfigImportCount !== null && (
              <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4" />
                <span>Successfully imported {sshConfigImportCount} server profiles!</span>
              </div>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-xl text-xs bg-purple-600 hover:bg-purple-500 text-white font-semibold shadow-md transition-all active:scale-95"
              >
                Parse & Import Profiles
              </button>
            </div>
          </form>
        </div>
      )}

      {/* "About This Cloud Mac" Modal */}
      {showAboutModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-150">
          <div className="bg-[#181a2c]/95 backdrop-blur-2xl border border-white/20 rounded-3xl w-full max-w-sm p-6 text-center space-y-4 shadow-2xl text-xs text-gray-200">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-purple-600 flex items-center justify-center shadow-2xl mx-auto border border-white/30">
              <Laptop className="w-7 h-7 text-white" />
            </div>

            <div>
              <h2 className="text-base font-bold text-white tracking-wide">CloudDesk macOS Sequoia</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">Version 2.0 (Build 24A348)</p>
            </div>

            <div className="bg-white/5 border border-white/10 rounded-2xl p-3 text-left space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-gray-400">Architecture:</span>
                <span className="text-white font-mono">Tauri 2.0 + Rust Core</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Transport:</span>
                <span className="text-white font-mono">Pure SSH2 (russh/OpenSSH)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Memory Footprint:</span>
                <span className="text-emerald-400 font-mono font-bold">&lt; 30 MB RAM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Remote Daemon:</span>
                <span className="text-emerald-400 font-medium">Zero (Agentless)</span>
              </div>
            </div>

            <button
              onClick={() => setShowAboutModal(false)}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ================= SERVER PROFILE MANAGER MODAL ================= */}
      {showProfileManagerModal && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
          <div className="bg-[#181a2c]/95 backdrop-blur-2xl border border-white/20 rounded-3xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden text-xs text-gray-200">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-[#141524]">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-2xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center shadow">
                  <SlidersHorizontal className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Server Profile Manager</h3>
                  <p className="text-[11px] text-gray-400">
                    Manage, search, organize, and back up all {connections.length} remote servers
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {/* View Mode Toggle */}
                <div className="flex items-center p-0.5 rounded-xl bg-black/40 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setManagerViewMode('grid')}
                    className={`p-1.5 rounded-lg transition-colors ${managerViewMode === 'grid' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                    title="Grid Cards View"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setManagerViewMode('table')}
                    className={`p-1.5 rounded-lg transition-colors ${managerViewMode === 'table' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-white'}`}
                    title="Table List View"
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Export / Backup JSON */}
                <button
                  type="button"
                  onClick={handleExportProfilesJson}
                  className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-all flex items-center space-x-1"
                  title="Export all server profiles to a JSON backup file"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-[11px]">Export JSON</span>
                </button>

                {/* Import Backup JSON */}
                <input
                  type="file"
                  ref={importJsonInputRef}
                  accept=".json"
                  onChange={handleImportProfilesJson}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => importJsonInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-all flex items-center space-x-1"
                  title="Import server profiles from a JSON backup file"
                >
                  <Upload className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[11px]">Import JSON</span>
                </button>

                {/* Add New Profile */}
                <button
                  type="button"
                  onClick={() => {
                    handleOpenAddModal();
                  }}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-all flex items-center space-x-1 shadow"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span className="text-[11px]">New Server</span>
                </button>

                {/* Close */}
                <button
                  type="button"
                  onClick={() => setShowProfileManagerModal(false)}
                  className="w-7 h-7 rounded-full hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-colors ml-2"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="p-4 border-b border-white/10 bg-[#131422] flex items-center justify-between gap-4 flex-wrap shrink-0">
              {/* Search Bar */}
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search servers by name, IP, port, username, group or tags..."
                  value={profileSearch}
                  onChange={(e) => setProfileSearch(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 font-sans"
                />
                {profileSearch && (
                  <button
                    onClick={() => setProfileSearch('')}
                    className="absolute right-3 top-2 text-gray-400 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Group Filter Pills */}
              <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none">
                <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider shrink-0">Groups:</span>
                {profileGroups.map(grp => (
                  <button
                    key={grp}
                    type="button"
                    onClick={() => setSelectedGroupFilter(grp)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-medium transition-all capitalize shrink-0 ${
                      selectedGroupFilter === grp
                        ? 'bg-blue-600 text-white shadow'
                        : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {grp} {grp === 'all' ? `(${connections.length})` : ''}
                  </button>
                ))}
              </div>
            </div>

            {/* Profiles Container */}
            <div className="flex-1 overflow-y-auto p-5">
              {filteredConnections.length === 0 ? (
                <div className="py-16 text-center space-y-3">
                  <Server className="w-12 h-12 text-gray-600 mx-auto" />
                  <div className="text-gray-400 font-medium">No server profiles match your filter.</div>
                  <button
                    onClick={() => { setProfileSearch(''); setSelectedGroupFilter('all'); }}
                    className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs transition-colors"
                  >
                    Reset Filters
                  </button>
                </div>
              ) : managerViewMode === 'grid' ? (
                /* 1. GRID CARDS VIEW */
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {filteredConnections.map(conn => {
                    const isSelected = selectedId === conn.id;
                    return (
                      <div
                        key={conn.id}
                        className={`p-4 rounded-2xl border transition-all flex flex-col justify-between space-y-3 ${
                          isSelected
                            ? 'bg-blue-600/15 border-blue-500/50 shadow-lg'
                            : 'bg-black/30 border-white/10 hover:border-white/20 hover:bg-black/40'
                        }`}
                      >
                        <div className="space-y-2">
                          {/* Card Header: Avatar, Name, Group Badge */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center space-x-3 min-w-0">
                              <div
                                className="w-10 h-10 rounded-2xl flex items-center justify-center text-sm font-bold shadow-md shrink-0 border border-white/15"
                                style={{ backgroundColor: conn.color ? `${conn.color}30` : '#89b4fa30', color: conn.color || '#89b4fa' }}
                              >
                                {conn.name ? conn.name[0].toUpperCase() : conn.username[0].toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-white truncate" title={conn.name}>
                                  {conn.name}
                                </h4>
                                <div className="text-[10px] text-gray-400 font-mono truncate">
                                  {conn.username}@{conn.host}:{conn.port || 22}
                                </div>
                              </div>
                            </div>

                            {conn.group && (
                              <span className="px-2 py-0.5 rounded-full bg-white/10 text-[9px] font-semibold text-gray-300 shrink-0">
                                {conn.group}
                              </span>
                            )}
                          </div>

                          {/* Details Row: Auth Method, Tags */}
                          <div className="flex items-center space-x-2 text-[10px] text-gray-400 pt-1">
                            <span className="flex items-center space-x-1 bg-white/5 px-2 py-0.5 rounded-md">
                              {conn.authMethod === 'key' || conn.privateKeyPath ? <Key className="w-3 h-3 text-blue-400" /> : <Lock className="w-3 h-3 text-amber-400" />}
                              <span>{conn.authMethod === 'key' || conn.privateKeyPath ? 'SSH Key' : 'Password'}</span>
                            </span>
                            {conn.tags && conn.tags.length > 0 && (
                              <span className="truncate text-gray-500">
                                #{conn.tags.join(' #')}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Card Actions: Connect, Duplicate, Edit, Delete */}
                        <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedId(conn.id);
                              setShowProfileManagerModal(false);
                            }}
                            className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-sm ${
                              isSelected
                                ? 'bg-blue-600 text-white shadow-blue-500/30'
                                : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30'
                            }`}
                          >
                            <Server className="w-3 h-3" />
                            <span>{isSelected ? 'Active Profile' : 'Select & Connect'}</span>
                          </button>

                          <div className="flex items-center space-x-1">
                            <button
                              type="button"
                              onClick={() => handleDuplicateProfile(conn)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                              title="Duplicate Profile"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                handleOpenEditModal(conn);
                              }}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-white/10 transition-colors"
                              title="Edit Profile"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(`Permanently delete profile "${conn.name || conn.host}"?`)) {
                                  removeConnection(conn.id);
                                  if (selectedId === conn.id) {
                                    const remaining = connections.filter(c => c.id !== conn.id);
                                    setSelectedId(remaining[0]?.id || null);
                                  }
                                }
                              }}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-rose-400 hover:bg-white/10 transition-colors"
                              title="Delete Profile"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* 2. TABLE LIST VIEW */
                <div className="rounded-2xl border border-white/10 overflow-hidden bg-black/30">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-[#12131f] text-gray-400 border-b border-white/10 font-mono text-[10px] uppercase tracking-wider">
                      <tr>
                        <th className="py-3 px-4">Profile Name</th>
                        <th className="py-3 px-4">Host IP</th>
                        <th className="py-3 px-4 w-20">Port</th>
                        <th className="py-3 px-4">Username</th>
                        <th className="py-3 px-4">Auth Method</th>
                        <th className="py-3 px-4">Group</th>
                        <th className="py-3 px-4 text-right pr-6 w-44">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredConnections.map(conn => {
                        const isSelected = selectedId === conn.id;
                        return (
                          <tr
                            key={conn.id}
                            className={`transition-colors ${
                              isSelected ? 'bg-blue-600/15' : 'hover:bg-white/[0.03]'
                            }`}
                          >
                            <td className="py-3 px-4 font-semibold text-white flex items-center space-x-2.5">
                              <div
                                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                                style={{ backgroundColor: conn.color ? `${conn.color}30` : '#89b4fa30', color: conn.color || '#89b4fa' }}
                              >
                                {conn.name ? conn.name[0].toUpperCase() : conn.username[0].toUpperCase()}
                              </div>
                              <span className="truncate max-w-xs">{conn.name}</span>
                            </td>
                            <td className="py-3 px-4 font-mono text-gray-300">{conn.host}</td>
                            <td className="py-3 px-4 font-mono text-gray-400">{conn.port || 22}</td>
                            <td className="py-3 px-4 font-mono text-gray-300">{conn.username}</td>
                            <td className="py-3 px-4">
                              <span className="px-2 py-0.5 rounded bg-white/5 text-[10px] text-gray-300 inline-flex items-center space-x-1">
                                {conn.authMethod === 'key' || conn.privateKeyPath ? <Key className="w-3 h-3 text-blue-400" /> : <Lock className="w-3 h-3 text-amber-400" />}
                                <span>{conn.authMethod === 'key' || conn.privateKeyPath ? 'Key' : 'Password'}</span>
                              </span>
                            </td>
                            <td className="py-3 px-4 text-gray-400">{conn.group || '—'}</td>
                            <td className="py-3 px-4 text-right pr-6">
                              <div className="flex items-center justify-end space-x-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedId(conn.id);
                                    setShowProfileManagerModal(false);
                                  }}
                                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                                    isSelected
                                      ? 'bg-blue-600 text-white'
                                      : 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300'
                                  }`}
                                >
                                  {isSelected ? 'Active' : 'Select'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDuplicateProfile(conn)}
                                  className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10"
                                  title="Duplicate"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleOpenEditModal(conn);
                                  }}
                                  className="p-1 rounded text-gray-400 hover:text-blue-400 hover:bg-white/10"
                                  title="Edit"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (confirm(`Delete profile "${conn.name}"?`)) {
                                      removeConnection(conn.id);
                                    }
                                  }}
                                  className="p-1 rounded text-gray-400 hover:text-rose-400 hover:bg-white/10"
                                  title="Delete"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3 border-t border-white/10 bg-[#141524] flex items-center justify-between shrink-0">
              <span className="text-[11px] text-gray-400">
                Showing {filteredConnections.length} of {connections.length} saved profiles
              </span>
              <button
                type="button"
                onClick={() => setShowProfileManagerModal(false)}
                className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global CSS for Shake Animation */}
      <style>{`
        @keyframes lockShake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .animate-lock-shake {
          animation: lockShake 0.4s ease-in-out;
        }
      `}</style>
    </div>
  );
}
