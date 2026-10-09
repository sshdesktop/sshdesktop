import React, { useState, useEffect, useRef } from 'react';
import { useConnectionStore, useSettingsStore } from '../lib/store';
import { 
  Cloud, Plus, Server, Key, Trash2, Check, 
  AlertCircle, Lock, Upload, FileCode, X,
  Eye, EyeOff, ArrowRight, RotateCcw, Power, Wifi,
  Palette, Terminal, CheckCircle2,
  Edit2, Laptop, Shield
} from 'lucide-react';
import { sshTestConnection, sshLaunchPutty, pickKeyFile } from '../lib/tauri-bridge';
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
            const isPpk = connKeyPath.toLowerCase().endsWith('.ppk');
            setUploadedKey({
              name: fileName,
              size: 'Saved Key',
              type: isPpk ? 'PuTTY Private Key (.ppk)' : 'OpenSSH Private Key (.pem)',
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
            const isPpk = connKeyPath.toLowerCase().endsWith('.ppk');
            setUploadedKey({
              name: fileName,
              size: 'Saved Key',
              type: isPpk ? 'PuTTY Private Key (.ppk)' : 'OpenSSH Private Key (.pem)',
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
      const isPpk = selectedPath.toLowerCase().endsWith('.ppk');
      setPrivateKeyPath(selectedPath);
      setUploadedKey({
        name: fileName,
        size: 'Local Key File',
        type: isPpk ? 'PuTTY Private Key (.ppk)' : 'OpenSSH Private Key (.pem)',
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
      const isPpk = nativePath.toLowerCase().endsWith('.ppk');
      setPrivateKeyPath(nativePath);
      setUploadedKey({
        name: file.name,
        size: `${(file.size / 1024).toFixed(1)} KB`,
        type: isPpk ? 'PuTTY Private Key (.ppk)' : 'OpenSSH Private Key (.pem)',
        content: nativePath,
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = (e.target?.result as string) || '';
      let detectedType = 'SSH Private Key';
      if (text.includes('PuTTY-User-Key-File') || file.name.toLowerCase().endsWith('.ppk')) detectedType = 'PuTTY Private Key (.ppk)';
      else if (text.includes('OPENSSH PRIVATE KEY')) detectedType = 'OpenSSH Private Key (.pem)';
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

  // Launch / Connect Handler with Apple-style progress
  const handleLaunch = async (connId?: string) => {
    setIsConnecting(true);
    setErrorMsg(null);
    setConnectingStep('Resolving host address & routing network path...');
    setConnectingProgress(20);

    try {
      const conn = connId ? connections.find(c => c.id === connId) : null;
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

      const isFilePath = (str?: string) => str && !str.includes('\n') && (str.includes('/') || str.includes('\\') || str.endsWith('.pem') || str.endsWith('.ppk'));

      if (!connId) {
        const profileToSave = {
          ...targetConfig,
          privateKeyPath: isFilePath(targetConfig.privateKeyPath) ? targetConfig.privateKeyPath : undefined,
        };
        addConnection(profileToSave);
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
  const handleOpenEditModal = () => {
    if (!selectedConn) return;
    const keyP = (selectedConn as any).privateKeyPath || (selectedConn as any).private_key_path || '';
    const isKey = (selectedConn as any).authMethod === 'key' || (selectedConn as any).auth_method === 'key' || (keyP && !selectedConn.password);
    setModalMode('edit');
    setModalForm({
      id: selectedConn.id,
      name: selectedConn.name || '',
      host: selectedConn.host || '',
      port: selectedConn.port || 22,
      username: selectedConn.username || 'root',
      authMethod: isKey ? 'key' : 'password',
      password: selectedConn.password || '',
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
    const isFilePath = (str?: string) => str && !str.includes('\n') && (str.includes('/') || str.includes('\\') || str.endsWith('.pem') || str.endsWith('.ppk'));

    if (modalMode === 'edit') {
      const updatedConn: any = {
        id: modalForm.id,
        name: modalForm.name.trim() || `${modalForm.username.trim()}@${modalForm.host.trim()}`,
        host: modalForm.host.trim(),
        port: Number(modalForm.port) || 22,
        username: modalForm.username.trim() || 'root',
        authMethod: modalForm.authMethod,
        password: modalForm.authMethod === 'password' ? modalForm.password : undefined,
        privateKeyPath: modalForm.authMethod === 'key' && isFilePath(modalForm.privateKeyPath) ? modalForm.privateKeyPath : undefined,
      };
      updateConnection(modalForm.id, updatedConn);
      // Synchronize active connection screen state
      setHost(updatedConn.host);
      setPort(updatedConn.port);
      setUsername(updatedConn.username);
      setServerName(updatedConn.name);
      setPassword(updatedConn.password || '');
      setPrivateKeyPath(updatedConn.privateKeyPath || '');
      setAuthMethod(updatedConn.authMethod);
      setProfileModalOpen(false);
    } else {
      const newId = `server-${Date.now()}`;
      const newConn: any = {
        id: newId,
        name: modalForm.name.trim() || `${modalForm.username.trim()}@${modalForm.host.trim()}`,
        host: modalForm.host.trim(),
        port: Number(modalForm.port) || 22,
        username: modalForm.username.trim() || 'root',
        authMethod: modalForm.authMethod,
        password: modalForm.authMethod === 'password' ? modalForm.password : undefined,
        privateKeyPath: modalForm.authMethod === 'key' && isFilePath(modalForm.privateKeyPath) ? modalForm.privateKeyPath : undefined,
        color: '#89b4fa',
        group: 'Servers',
        tags: ['Linux', 'CloudDesk'],
        created_at: Date.now()
      };
      addConnection(newConn);
      setSelectedId(newId);
      setProfileModalOpen(false);
    }
  };

  // Handle First Profile Creation and Immediate Connection
  const handleCreateFirstProfileAndConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstProfile.host.trim()) return;
    const isFilePath = (str?: string) => str && !str.includes('\n') && (str.includes('/') || str.includes('\\') || str.endsWith('.pem') || str.endsWith('.ppk'));
    const newId = `server-${Date.now()}`;
    const newConn: any = {
      id: newId,
      name: firstProfile.name.trim() || `${firstProfile.username.trim()}@${firstProfile.host.trim()}`,
      host: firstProfile.host.trim(),
      port: Number(firstProfile.port) || 22,
      username: firstProfile.username.trim() || 'root',
      authMethod: firstProfile.authMethod,
      password: firstProfile.authMethod === 'password' ? firstProfile.password : undefined,
      privateKeyPath: firstProfile.authMethod === 'key' && isFilePath(firstProfile.privateKeyPath) ? firstProfile.privateKeyPath : undefined,
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
    setPassword(newConn.password || '');
    setPrivateKeyPath(newConn.privateKeyPath || '');
    setAuthMethod(newConn.authMethod);

    // Connect immediately
    await handleLaunch(newId);
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
                    <label className="text-gray-300 block mb-1 font-medium">Port</label>
                    <input
                      type="number"
                      value={firstProfile.port}
                      onChange={e => setFirstProfile(f => ({ ...f, port: parseInt(e.target.value) || 22 }))}
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
                          {firstProfile.privateKeyPath || 'Click to select key (.pem, .ppk, id_rsa)...'}
                        </span>
                      </div>
                      <span className="text-[10px] text-blue-400 shrink-0 font-medium ml-2">Browse</span>
                    </div>
                  </div>
                )}

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
              {/* Server Profiles Carousel */}
              <div className="flex items-center justify-center space-x-2.5 overflow-x-auto pb-1 max-w-full scrollbar-none px-2">
                {connections.map(conn => {
                  const isSelected = selectedId === conn.id;
                  return (
                    <div
                      key={conn.id}
                      onClick={() => setSelectedId(conn.id)}
                      className={`group flex flex-col items-center p-2 rounded-2xl cursor-pointer transition-all duration-200 text-center ${
                        isSelected
                          ? 'scale-105 bg-white/15 backdrop-blur-xl border border-white/30 shadow-[0_8px_20px_rgba(0,0,0,0.5)]'
                          : 'hover:bg-white/5 opacity-70 hover:opacity-100 border border-transparent'
                      }`}
                      title={`${conn.name} (${conn.username}@${conn.host})`}
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

                        {/* Online dot indicator */}
                        <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-black flex items-center justify-center">
                          <span className="w-1 h-1 rounded-full bg-white" />
                        </span>

                        {/* Delete profile button on hover */}
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

                      <span className="text-[10px] font-semibold text-white mt-1 truncate max-w-[75px]">
                        {conn.name}
                      </span>
                    </div>
                  );
                })}

                {/* "+ New Profile" Tile */}
                <div
                  onClick={handleOpenAddModal}
                  className="flex flex-col items-center p-2 rounded-2xl cursor-pointer hover:bg-white/10 opacity-70 hover:opacity-100 border border-dashed border-white/20 transition-all text-center group"
                  title="Add New Server Profile"
                >
                  <div className="w-12 h-12 rounded-full bg-white/5 border border-dashed border-white/20 flex items-center justify-center text-white/60 group-hover:text-white group-hover:scale-105 transition-transform">
                    <Plus className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-medium text-white/80 mt-1">New</span>
                </div>
              </div>

              {/* Central Frosted Glass Login Card */}
              <div className={`w-full bg-[#161828]/90 backdrop-blur-2xl border ${
                shake ? 'border-red-500 animate-lock-shake' : 'border-white/20'
              } rounded-3xl p-5 shadow-[0_25px_80px_rgba(0,0,0,0.7)] space-y-3.5 relative transition-all`}>
                
                {/* User Profile Header */}
                <div className="flex flex-col items-center text-center space-y-1.5">
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

                  <div>
                    <h2 className="text-sm font-bold text-white">
                      {selectedConn?.name || `${username}@${host || 'remote-node'}`}
                    </h2>
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
                            {privateKeyPath.toLowerCase().endsWith('.ppk') ? 'PuTTY (.ppk)' : 'OpenSSH (.pem)'}
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
                          Select or Drop Private Key (<span className="font-mono text-gray-400">.pem</span>, <span className="font-mono text-gray-400">.ppk</span>, <span className="font-mono text-gray-400">id_rsa</span>)
                        </div>
                        <div className="text-[10px] text-gray-500">Supports OpenSSH (.pem) & PuTTY (.ppk)</div>
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
                    onClick={handleOpenEditModal}
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-150">
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
                <label className="text-gray-300 block mb-1 font-medium">Profile Name</label>
                <input
                  type="text"
                  required
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
                  <label className="text-gray-300 block mb-1 font-medium">Port</label>
                  <input
                    type="number"
                    value={modalForm.port}
                    onChange={e => setModalForm(f => ({ ...f, port: parseInt(e.target.value) || 22 }))}
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
                  <label className="text-gray-300 block mb-1 font-medium">Private Key File</label>
                  <div 
                    onClick={handleSelectModalKeyFile}
                    className="cursor-pointer bg-[#10121d] border border-dashed border-white/20 hover:border-blue-500/60 rounded-xl p-3 flex items-center justify-between text-xs transition-colors"
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <Key className="w-4 h-4 text-blue-400 shrink-0" />
                      <span className="text-gray-300 truncate font-mono text-[11px]">
                        {modalForm.privateKeyPath || 'Select SSH Key file (.pem, .ppk)...'}
                      </span>
                    </div>
                    <span className="text-[10px] text-blue-400 shrink-0 font-medium ml-2">Browse</span>
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
