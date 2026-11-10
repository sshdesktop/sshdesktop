import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useSettingsStore, useConnectionStore } from '../../lib/store';
import { 
  Palette, Terminal, FileCode, Sliders, Info, ShieldCheck, Check, 
  Upload, Plus, Image as ImageIcon, Clock, Globe2, Calendar, 
  RefreshCw, CheckCircle2, AlertCircle, Laptop, ArrowRight, 
  Monitor, Volume2, Bell, Cpu, HardDrive, Wifi, Lock, Moon, 
  Sun, Search, Sparkles, SlidersHorizontal, RotateCcw, ChevronRight, 
  User, CheckCheck, X, Archive, Download, FolderArchive, Trash2, Eye, FileArchive, Folder,
  ChevronDown, ChevronUp, FileText
} from 'lucide-react';
import { WALLPAPERS } from '../../shell/Desktop';
import { sshExec } from '../../lib/tauri-bridge';
import { useWindowManager } from '../../lib/hooks/useWindowManager';
import { SshDesktopLogo } from '../../components/SshDesktopLogo';
import { useUserPrivilege } from '../../lib/permissions';
import { 
  saveSettingsToServer, 
  loadSettingsFromServer, 
  restoreSettingsToStore, 
  checkServerSettingsFile,
  getServerSettingsFilePath
} from '../../lib/server-settings';
import {
  listSshDesktopFiles,
  createTarBackup,
  listBackupArchives,
  inspectTarArchive,
  restoreTarBackup,
  uploadAndRestoreTarBackup,
  downloadTarBackup,
  deleteBackupArchive,
  getSshDesktopDirPath,
  getSshDesktopBackupsDirPath,
  SshDesktopFileEntry,
  BackupArchiveEntry,
  TarArchiveContentItem
} from '../../lib/server-backup';

const ACCENT_COLORS = [
  { name: 'Sapphire Blue', value: '#89B4FA' },
  { name: 'Mauve Purple', value: '#CBA6F7' },
  { name: 'Emerald Green', value: '#A6E3A1' },
  { name: 'Flamingo Pink', value: '#F38BA8' },
  { name: 'Peach Orange', value: '#FAB387' },
  { name: 'Teal Cyan', value: '#94E2D5' }
];

const COMMON_TIMEZONES = [
  { label: 'UTC (Coordinated Universal Time)', value: 'UTC' },
  { label: 'America/New_York (Eastern)', value: 'America/New_York' },
  { label: 'America/Chicago (Central)', value: 'America/Chicago' },
  { label: 'America/Denver (Mountain)', value: 'America/Denver' },
  { label: 'America/Los_Angeles (Pacific)', value: 'America/Los_Angeles' },
  { label: 'Europe/London (GMT/BST)', value: 'Europe/London' },
  { label: 'Europe/Paris (CET)', value: 'Europe/Paris' },
  { label: 'Europe/Berlin (CET)', value: 'Europe/Berlin' },
  { label: 'Asia/Dubai (GST)', value: 'Asia/Dubai' },
  { label: 'Asia/Kolkata (IST)', value: 'Asia/Kolkata' },
  { label: 'Asia/Singapore (SGT)', value: 'Asia/Singapore' },
  { label: 'Asia/Tokyo (JST)', value: 'Asia/Tokyo' },
  { label: 'Australia/Sydney (AEST)', value: 'Australia/Sydney' },
];

export default function AppSettings() {
  const { 
    theme, updateSettings, terminalFontSize, accentColor, wallpaper, 
    dockPosition, showHiddenFiles, pollingInterval, autoHideDock 
  } = useSettingsStore();
  const { openApp } = useWindowManager();

  const [activeTab, setActiveTab] = useState<
    'appearance' | 'wallpaper' | 'backup' | 'datetime' | 'terminal' | 'editor' | 'dock' | 'ssh' | 'about'
  >('appearance');
  const [navSearch, setNavSearch] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Active server info for Date & Time & Backup
  const activeConnectionId = useConnectionStore(s => s.activeConnectionId);
  const activeServer = useConnectionStore(s => {
    const id = s.activeConnectionId;
    return id ? s.connections.find(c => c.id === id) : null;
  });
  const { username, homeDir: userHome } = useUserPrivilege();

  // Compute dynamic login user home directory based on authenticated user: e.g. /root or /home/<username>
  const effectiveUsername = username || activeServer?.username || 'root';
  const effectiveHome = userHome || (effectiveUsername === 'root' ? '/root' : `/home/${effectiveUsername}`);
  const sshDesktopPath = getSshDesktopDirPath(effectiveHome);
  const sshDesktopBackupsPath = getSshDesktopBackupsDirPath(effectiveHome);
  const serverSettingsPath = getServerSettingsFilePath(effectiveHome);

  // Server Backup & Restore States (~/.sshdesktop/settings.json)
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [backupMessage, setBackupMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [serverFileStatus, setServerFileStatus] = useState<{
    exists: boolean;
    size?: number;
    modified?: string;
    path: string;
    data?: any;
    rawJson?: string;
  } | null>(null);
  const [autoSyncServer, setAutoSyncServer] = useState<boolean>(() => {
    return localStorage.getItem('sshdesktop_auto_sync_server') !== 'false';
  });
  const [autoRestoreOnLogin, setAutoRestoreOnLogin] = useState<boolean>(() => {
    return localStorage.getItem('sshdesktop_auto_restore_on_login') !== 'false';
  });

  const refreshServerStatus = useCallback(async () => {
    if (!activeConnectionId) {
      setServerFileStatus(null);
      return;
    }
    const status = await checkServerSettingsFile(activeConnectionId, effectiveHome);
    setServerFileStatus(status);
  }, [activeConnectionId, effectiveHome]);

  useEffect(() => {
    if (activeTab === 'backup') {
      refreshServerStatus();
    }
  }, [activeTab, refreshServerStatus]);

  const handleBackupToServer = async () => {
    if (!activeConnectionId) {
      setBackupMessage({ text: 'No active SSH connection to server.', isError: true });
      return;
    }
    setIsBackingUp(true);
    setBackupMessage(null);
    try {
      const res = await saveSettingsToServer(
        activeConnectionId,
        effectiveHome,
        useSettingsStore.getState(),
        { username: effectiveUsername }
      );
      if (res.success) {
        setBackupMessage({ text: `Settings successfully backed up to ${res.path} for user ${effectiveUsername}!`, isError: false });
        await refreshServerStatus();
        await refreshTarBackupData();
      } else {
        throw new Error(res.error || 'Failed to save settings.json on server');
      }
    } catch (err: any) {
      setBackupMessage({ text: `Backup failed: ${err?.message || err}`, isError: true });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreFromServer = async () => {
    if (!activeConnectionId) {
      setBackupMessage({ text: 'No active SSH connection to server.', isError: true });
      return;
    }
    setIsRestoring(true);
    setBackupMessage(null);
    try {
      const res = await loadSettingsFromServer(activeConnectionId, effectiveHome);
      if (res.success && res.data) {
        restoreSettingsToStore(res.data);
        setBackupMessage({ text: `Settings successfully restored from ${res.path}!`, isError: false });
        await refreshServerStatus();
      } else {
        throw new Error(res.error || `No settings file found at ${serverSettingsPath}`);
      }
    } catch (err: any) {
      setBackupMessage({ text: `Restore failed: ${err?.message || err}`, isError: true });
    } finally {
      setIsRestoring(false);
    }
  };

  // .sshdesktop Full Directory Tar Backup & Recovery States
  const [sshDesktopFiles, setSshDesktopFiles] = useState<SshDesktopFileEntry[]>([]);
  const [sshDesktopTotalSize, setSshDesktopTotalSize] = useState<string>('—');
  const [sshDesktopFileCount, setSshDesktopFileCount] = useState<number>(0);
  const [backupArchives, setBackupArchives] = useState<BackupArchiveEntry[]>([]);
  const [isTarLoading, setIsTarLoading] = useState(false);
  const [isCreatingTar, setIsCreatingTar] = useState(false);
  const [isRestoringTar, setIsRestoringTar] = useState(false);
  const [tarBackupFormat, setTarBackupFormat] = useState<'tar.gz' | 'tar'>('tar.gz');
  const [autoDownloadAfterBackup, setAutoDownloadAfterBackup] = useState<boolean>(true);
  const [tarMessage, setTarMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [showFilesList, setShowFilesList] = useState<boolean>(true);
  const [showJsonSyncCard, setShowJsonSyncCard] = useState<boolean>(false);
  const [copiedTargetDir, setCopiedTargetDir] = useState(false);

  // Modals for Tar Inspect, Restore Confirmation & Delete Confirmation
  const [inspectModal, setInspectModal] = useState<{
    open: boolean;
    archiveName: string;
    archivePath: string;
    items: TarArchiveContentItem[];
    rawOutput: string;
    loading: boolean;
  } | null>(null);
  const [restoreConfirmModal, setRestoreConfirmModal] = useState<{
    open: boolean;
    archiveName: string;
    archivePath: string;
  } | null>(null);
  const [deleteArchiveConfirmModal, setDeleteArchiveConfirmModal] = useState<{
    open: boolean;
    archiveName: string;
    archivePath: string;
  } | null>(null);

  const tarUploadInputRef = useRef<HTMLInputElement | null>(null);

  const refreshTarBackupData = useCallback(async () => {
    if (!activeConnectionId) {
      setSshDesktopFiles([]);
      setBackupArchives([]);
      return;
    }
    setIsTarLoading(true);
    try {
      const [fileRes, archives] = await Promise.all([
        listSshDesktopFiles(activeConnectionId, effectiveHome),
        listBackupArchives(activeConnectionId, effectiveHome),
      ]);
      if (fileRes.success) {
        setSshDesktopFiles(fileRes.files);
        setSshDesktopTotalSize(fileRes.totalSize);
        setSshDesktopFileCount(fileRes.totalFiles);
      }
      setBackupArchives(archives);
    } catch (err: any) {
      console.warn('Error refreshing tar backup data:', err);
    } finally {
      setIsTarLoading(false);
    }
  }, [activeConnectionId, effectiveHome]);

  useEffect(() => {
    if (activeTab === 'backup') {
      refreshTarBackupData();
    }
  }, [activeTab, refreshTarBackupData]);

  const handleCreateTarBackup = async () => {
    if (!activeConnectionId) {
      setTarMessage({ text: 'No active SSH connection to server.', isError: true });
      return;
    }
    setIsCreatingTar(true);
    setTarMessage(null);
    try {
      const res = await createTarBackup(activeConnectionId, effectiveHome, {
        format: tarBackupFormat,
      });
      if (res.success) {
        let dlNotice = '';
        if (autoDownloadAfterBackup) {
          try {
            await downloadTarBackup(activeConnectionId, res.archivePath);
            dlNotice = ' and downloaded to your local Downloads folder!';
          } catch (dlErr: any) {
            dlNotice = ` (saved on server; local download note: ${dlErr?.message || dlErr})`;
          }
        }
        setTarMessage({
          text: `Backup created successfully: ${res.archiveName} (${res.size}) in ${sshDesktopBackupsPath}${dlNotice}`,
          isError: false,
        });
        await refreshTarBackupData();
      } else {
        throw new Error(res.error || 'Failed to create tar backup');
      }
    } catch (err: any) {
      setTarMessage({ text: `Backup creation failed: ${err?.message || err}`, isError: true });
    } finally {
      setIsCreatingTar(false);
    }
  };

  const handleConfirmRestoreTar = async () => {
    if (!restoreConfirmModal || !activeConnectionId) return;
    const { archivePath, archiveName } = restoreConfirmModal;
    setIsRestoringTar(true);
    setTarMessage(null);
    try {
      const res = await restoreTarBackup(activeConnectionId, effectiveHome, archivePath);
      if (res.success) {
        setTarMessage({
          text: `Recovery successful: All files inside ${res.targetDir} restored from ${archiveName} (${res.restoredCount} files recovered)!`,
          isError: false,
        });
        await Promise.all([refreshTarBackupData(), refreshServerStatus()]);
      } else {
        throw new Error(res.error || 'Failed to restore tar archive');
      }
    } catch (err: any) {
      setTarMessage({ text: `Restore failed: ${err?.message || err}`, isError: true });
    } finally {
      setIsRestoringTar(false);
      setRestoreConfirmModal(null);
    }
  };

  const handleUploadAndRestoreTar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConnectionId) return;

    if (!file.name.endsWith('.tar') && !file.name.endsWith('.tar.gz') && !file.name.endsWith('.tgz')) {
      setTarMessage({ text: 'Invalid file format: Please select a valid .tar or .tar.gz archive.', isError: true });
      if (tarUploadInputRef.current) tarUploadInputRef.current.value = '';
      return;
    }

    setIsRestoringTar(true);
    setTarMessage(null);
    try {
      const buf = await file.arrayBuffer();
      const res = await uploadAndRestoreTarBackup(activeConnectionId, effectiveHome, buf, file.name);
      if (res.success) {
        setTarMessage({
          text: `Uploaded & recovered ${file.name} into ${res.targetDir} (${res.restoredCount} files restored)!`,
          isError: false,
        });
        await Promise.all([refreshTarBackupData(), refreshServerStatus()]);
      } else {
        throw new Error(res.error || 'Upload and restore failed');
      }
    } catch (err: any) {
      setTarMessage({ text: `Restore failed: ${err?.message || err}`, isError: true });
    } finally {
      setIsRestoringTar(false);
      if (tarUploadInputRef.current) tarUploadInputRef.current.value = '';
    }
  };

  const handleDownloadArchive = async (archivePath: string, archiveName: string) => {
    if (!activeConnectionId) return;
    try {
      setTarMessage({ text: `Downloading ${archiveName} to your local PC...`, isError: false });
      await downloadTarBackup(activeConnectionId, archivePath);
      setTarMessage({ text: `Downloaded ${archiveName} to your local Downloads folder!`, isError: false });
    } catch (err: any) {
      setTarMessage({ text: `Download failed: ${err?.message || err}`, isError: true });
    }
  };

  const handleDeleteArchive = (archivePath: string, archiveName: string) => {
    if (!activeConnectionId) return;
    setDeleteArchiveConfirmModal({
      open: true,
      archiveName,
      archivePath,
    });
  };

  const handleConfirmDeleteArchive = async () => {
    if (!deleteArchiveConfirmModal || !activeConnectionId) return;
    const { archivePath, archiveName } = deleteArchiveConfirmModal;
    try {
      await deleteBackupArchive(activeConnectionId, archivePath);
      setTarMessage({ text: `Deleted archive "${archiveName}" from server.`, isError: false });
      setDeleteArchiveConfirmModal(null);
      await refreshTarBackupData();
    } catch (err: any) {
      setTarMessage({ text: `Delete failed: ${err?.message || err}`, isError: true });
    }
  };

  const handleInspectArchive = async (archivePath: string, archiveName: string) => {
    if (!activeConnectionId) return;
    setInspectModal({
      open: true,
      archiveName,
      archivePath,
      items: [],
      rawOutput: '',
      loading: true,
    });
    try {
      const res = await inspectTarArchive(activeConnectionId, archivePath);
      setInspectModal({
        open: true,
        archiveName,
        archivePath,
        items: res.items,
        rawOutput: res.rawOutput,
        loading: false,
      });
    } catch (err: any) {
      setInspectModal(prev => prev ? { ...prev, loading: false, rawOutput: String(err) } : null);
    }
  };

  // Auto-sync debounced when settings change in AppSettings if autoSyncServer is enabled
  const autoSyncTimerRef = useRef<any>(null);
  useEffect(() => {
    if (!autoSyncServer || !activeConnectionId || !userHome) return;
    if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    autoSyncTimerRef.current = setTimeout(() => {
      saveSettingsToServer(
        activeConnectionId,
        userHome,
        useSettingsStore.getState(),
        { username: username || activeServer?.username || 'user' }
      ).catch(() => {});
    }, 1500);
    return () => {
      if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current);
    };
  }, [theme, accentColor, wallpaper, dockPosition, autoHideDock, terminalFontSize, autoSyncServer, activeConnectionId, userHome, username, activeServer?.username]);

  // Server Date & Time States
  const [serverLocalTime, setServerLocalTime] = useState<string>('Loading...');
  const [serverTimezone, setServerTimezone] = useState<string>('UTC');
  const [selectedTz, setSelectedTz] = useState<string>('UTC');
  const [ntpActive, setNtpActive] = useState<boolean>(true);
  const [manualDate, setManualDate] = useState<string>('');
  const [manualTime, setManualTime] = useState<string>('');
  const [isTimeLoading, setIsTimeLoading] = useState(false);
  const [timeMessage, setTimeMessage] = useState<{ text: string; isError: boolean } | null>(null);

  // Terminal & Editor Preferences
  const [termCursor, setTermCursor] = useState<'block' | 'line' | 'underline'>('block');
  const [termScrollback, setTermScrollback] = useState<number>(5000);
  const [editorTabSize, setEditorTabSize] = useState<number>(2);
  const [editorMinimap, setEditorMinimap] = useState<boolean>(true);
  const [editorWordWrap, setEditorWordWrap] = useState<boolean>(true);
  const [editorLineNumbers, setEditorLineNumbers] = useState<boolean>(true);

  // Host Specs for "About" Tab
  const [hostUname, setHostUname] = useState<string>('—');
  const [hostUptime, setHostUptime] = useState<string>('—');
  const [hostMemory, setHostMemory] = useState<string>('—');

  const fetchServerTimeInfo = useCallback(async () => {
    if (!activeConnectionId) {
      setServerLocalTime('No active server connected');
      return;
    }
    setIsTimeLoading(true);
    try {
      const res = await sshExec(activeConnectionId, 'timedatectl status 2>/dev/null || date +"%Y-%m-%d %H:%M:%S %Z"');
      const out = res.stdout || '';

      const timeMatch = out.match(/Local time:\s*(.+)/i);
      if (timeMatch && timeMatch[1]) {
        setServerLocalTime(timeMatch[1].trim());
      } else {
        setServerLocalTime(out.split('\n')[0]?.trim() || new Date().toUTCString());
      }

      const tzMatch = out.match(/Time zone:\s*([^\s(]+)/i);
      if (tzMatch && tzMatch[1]) {
        setServerTimezone(tzMatch[1].trim());
        setSelectedTz(tzMatch[1].trim());
      }

      const ntpMatch = out.match(/NTP service:\s*(active|yes)/i);
      setNtpActive(!!ntpMatch);

      const now = new Date();
      setManualDate(now.toISOString().split('T')[0]);
      setManualTime(now.toTimeString().split(' ')[0]);

      // Also grab basic host info for About tab
      const unameRes = await sshExec(activeConnectionId, 'uname -srm 2>/dev/null || uname -a');
      if (unameRes.stdout) setHostUname(unameRes.stdout.trim());

      const upRes = await sshExec(activeConnectionId, 'uptime -p 2>/dev/null || uptime');
      if (upRes.stdout) setHostUptime(upRes.stdout.trim());

      const memRes = await sshExec(activeConnectionId, "free -h 2>/dev/null | awk '/Mem:/ {print $2}'");
      if (memRes.stdout) setHostMemory(`${memRes.stdout.trim()} Total RAM`);

    } catch (err: any) {
      console.warn('Error fetching server time:', err);
      setServerLocalTime('timedatectl not available');
    } finally {
      setIsTimeLoading(false);
    }
  }, [activeConnectionId]);

  useEffect(() => {
    if (['datetime', 'about'].includes(activeTab)) {
      fetchServerTimeInfo();
    }
  }, [activeTab, fetchServerTimeInfo]);

  // Set Timezone Handler
  const handleSetTimezone = async () => {
    if (!activeConnectionId || !selectedTz) return;
    setIsTimeLoading(true);
    setTimeMessage(null);
    try {
      const res = await sshExec(activeConnectionId, `sudo timedatectl set-timezone "${selectedTz}" || timedatectl set-timezone "${selectedTz}"`);
      if (res.exit_code === 0 || !res.stderr) {
        setTimeMessage({ text: `Timezone updated to ${selectedTz} successfully!`, isError: false });
        await fetchServerTimeInfo();
      } else {
        setTimeMessage({ text: res.stderr || 'Permission denied: Please grant sudo permissions.', isError: true });
      }
    } catch (err: any) {
      setTimeMessage({ text: err?.message || String(err), isError: true });
    } finally {
      setIsTimeLoading(false);
    }
  };

  // Set Manual Date & Time Handler
  const handleSetManualTime = async () => {
    if (!activeConnectionId || !manualDate || !manualTime) return;
    setIsTimeLoading(true);
    setTimeMessage(null);
    try {
      const formatted = `${manualDate} ${manualTime}`;
      const cmd = `sudo timedatectl set-ntp false; sudo timedatectl set-time "${formatted}" || timedatectl set-time "${formatted}"`;
      const res = await sshExec(activeConnectionId, cmd);
      if (res.exit_code === 0 || !res.stderr) {
        setTimeMessage({ text: `Server time successfully set to ${formatted}`, isError: false });
        await fetchServerTimeInfo();
      } else {
        setTimeMessage({ text: res.stderr || 'Failed to set time. Ensure sudo permissions are available.', isError: true });
      }
    } catch (err: any) {
      setTimeMessage({ text: err?.message || String(err), isError: true });
    } finally {
      setIsTimeLoading(false);
    }
  };

  // Toggle NTP Sync Handler
  const handleToggleNtp = async (enable: boolean) => {
    if (!activeConnectionId) return;
    setIsTimeLoading(true);
    setTimeMessage(null);
    try {
      const cmd = `sudo timedatectl set-ntp ${enable ? 'true' : 'false'} || timedatectl set-ntp ${enable ? 'true' : 'false'}`;
      await sshExec(activeConnectionId, cmd);
      setTimeMessage({ text: `Network Time Protocol (NTP) ${enable ? 'enabled' : 'disabled'}!`, isError: false });
      await fetchServerTimeInfo();
    } catch (err: any) {
      setTimeMessage({ text: err?.message || String(err), isError: true });
    } finally {
      setIsTimeLoading(false);
    }
  };

  // Sync with Local Computer (Browser) Time
  const handleSyncWithBrowserTime = async () => {
    if (!activeConnectionId) return;
    setIsTimeLoading(true);
    setTimeMessage(null);
    try {
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const formattedTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      const cmd = `sudo timedatectl set-timezone "${localTz}"; sudo timedatectl set-ntp false; sudo timedatectl set-time "${formattedTime}"`;
      await sshExec(activeConnectionId, cmd);
      setTimeMessage({ text: `Server synced with local computer time (${formattedTime} ${localTz})!`, isError: false });
      await fetchServerTimeInfo();
    } catch (err: any) {
      setTimeMessage({ text: err?.message || String(err), isError: true });
    } finally {
      setIsTimeLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        updateSettings({ wallpaper: event.target.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleApplyUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customUrl.trim()) return;
    updateSettings({ wallpaper: customUrl.trim() });
    setCustomUrl('');
  };

  // Sidebar navigation items
  const navItems = [
    { id: 'appearance', label: 'Appearance', icon: Palette, color: 'text-pink-400' },
    { id: 'wallpaper', label: 'Wallpaper (4K)', icon: ImageIcon, color: 'text-blue-400' },
    { id: 'backup', label: 'Backup & Restore', icon: FolderArchive, color: 'text-emerald-400' },
    { id: 'datetime', label: 'Date & Time (Server)', icon: Clock, color: 'text-teal-400' },
    { id: 'terminal', label: 'Terminal Emulator', icon: Terminal, color: 'text-sky-400' },
    { id: 'editor', label: 'Code Editor', icon: FileCode, color: 'text-purple-400' },
    { id: 'dock', label: 'Desktop & Dock', icon: Monitor, color: 'text-amber-400' },
    { id: 'ssh', label: 'SSH & Network', icon: Sliders, color: 'text-cyan-400' },
    { id: 'about', label: 'About SSH Desktop', icon: Info, color: 'text-gray-400' },
  ];

  const filteredNavItems = navItems.filter(item => 
    item.label.toLowerCase().includes(navSearch.toLowerCase())
  );

  return (
    <div className="flex h-full bg-[#181825] text-[#cdd6f4] select-none font-sans overflow-hidden">
      
      {/* 1. macOS System Settings Left Navigation Sidebar */}
      <aside className="w-64 bg-[#14141e]/90 backdrop-blur-2xl border-r border-white/[0.08] p-3 flex flex-col shrink-0">
        
        {/* User / Host Profile Card */}
        <div className="p-3 bg-[#1e1e2e]/70 rounded-2xl border border-white/10 mb-3 flex items-center space-x-3 shadow-inner">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-md text-sm border border-white/20">
            {activeServer?.username ? activeServer.username.slice(0, 2).toUpperCase() : 'CD'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold text-white truncate">
              {activeServer?.username || 'root'}@{activeServer?.host || 'localhost'}
            </div>
            <div className="text-[10px] text-emerald-400 flex items-center space-x-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Connected · SSH2</span>
            </div>
          </div>
        </div>

        {/* Search Settings Input */}
        <div className="relative mb-2 px-1">
          <Search className="w-3.5 h-3.5 absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search settings..."
            value={navSearch}
            onChange={e => setNavSearch(e.target.value)}
            className="w-full bg-[#1e1e2e] border border-white/10 rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-all font-sans"
          />
          {navSearch && (
            <button
              onClick={() => setNavSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <div className="flex-1 overflow-y-auto space-y-0.5">
          <div className="text-[10px] font-bold text-gray-500 uppercase px-3 py-1.5 tracking-wider">
            System Preferences
          </div>

          {filteredNavItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id as any)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium transition-all active:scale-95 ${
                  isActive 
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30 font-semibold' 
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : item.color}`} />
                  <span>{item.label}</span>
                </div>
                <ChevronRight className={`w-3.5 h-3.5 ${isActive ? 'text-white/80' : 'text-gray-600'}`} />
              </button>
            );
          })}
        </div>
      </aside>

      {/* 2. Main Settings Panel */}
      <main className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-2xl mx-auto space-y-6 animate-in fade-in duration-200">
          
          {/* TAB 1: APPEARANCE */}
          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Appearance</h2>
                <p className="text-xs text-gray-400">Choose your desktop look and customize accent highlights.</p>
              </div>

              {/* Theme Selector */}
              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl backdrop-blur-md">
                <span className="text-xs font-bold text-white block">Theme Mode</span>
                
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { id: 'dark', label: 'Dark Mode', desc: 'Catppuccin Mocha', icon: Moon },
                    { id: 'light', label: 'Light Mode', desc: 'Catppuccin Latte', icon: Sun },
                    { id: 'auto', label: 'Auto (System)', desc: 'Matches device setting', icon: Monitor },
                  ].map(t => {
                    const Icon = t.icon;
                    const isSelected = theme === t.id;
                    return (
                      <div
                        key={t.id}
                        onClick={() => updateSettings({ theme: t.id as any })}
                        className={`p-4 rounded-2xl border cursor-pointer transition-all active:scale-95 flex flex-col items-center text-center space-y-2 ${
                          isSelected
                            ? 'border-blue-500 bg-blue-600/15 text-white shadow-lg ring-1 ring-blue-500/50'
                            : 'border-white/10 hover:border-white/20 text-gray-400 bg-white/[0.02]'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSelected ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400'}`}>
                          <Icon className="w-5 h-5" />
                        </div>
                        <div className="font-bold text-xs text-white">{t.label}</div>
                        <div className="text-[10px] text-gray-500">{t.desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Accent Color Picker */}
              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-5 space-y-3 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-white block">Accent Highlight Color</span>
                    <p className="text-[11px] text-gray-400">Controls selection badges, active buttons, and focus rings.</p>
                  </div>
                  <div className="flex items-center space-x-2.5">
                    {ACCENT_COLORS.map(c => (
                      <button
                        key={c.name}
                        onClick={() => updateSettings({ accentColor: c.value })}
                        style={{ backgroundColor: c.value }}
                        className="w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-110 shadow-lg active:scale-95 ring-2 ring-white/10"
                        title={c.name}
                      >
                        {accentColor === c.value && <Check className="w-4 h-4 text-black stroke-[3]" />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: WALLPAPER (4K) */}
          {activeTab === 'wallpaper' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">Desktop Wallpaper</h2>
                  <p className="text-xs text-gray-400">Apple 4K dynamic desktop wallpapers and custom background images.</p>
                </div>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md active:scale-95"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Photo</span>
                </button>
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept="image/*"
                className="hidden"
              />

              {/* Direct Image URL Form */}
              <form onSubmit={handleApplyUrl} className="flex items-center space-x-2">
                <input
                  type="text"
                  placeholder="Or paste direct 4K image URL..."
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  className="bg-[#12121e] border border-white/10 rounded-xl px-3.5 py-2 text-xs text-white placeholder-gray-500 flex-1 focus:outline-none focus:border-blue-400 font-mono"
                />
                <button
                  type="submit"
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded-xl transition-all active:scale-95 shrink-0"
                >
                  Apply URL
                </button>
              </form>

              {/* Wallpaper Grid */}
              <div className="grid grid-cols-2 gap-3.5">
                {WALLPAPERS.map(w => {
                  const isSelected = wallpaper === w.id;
                  return (
                    <div
                      key={w.id}
                      onClick={() => updateSettings({ wallpaper: w.id })}
                      className={`group relative overflow-hidden rounded-2xl border p-2 cursor-pointer transition-all active:scale-95 ${
                        isSelected
                          ? 'border-blue-500 ring-2 ring-blue-500/40 bg-blue-500/10 shadow-lg'
                          : 'border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
                      }`}
                    >
                      <div className="relative h-24 w-full rounded-xl overflow-hidden mb-2 bg-black/40">
                        <img
                          src={w.thumbnail}
                          alt={w.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          loading="lazy"
                        />
                        <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur-md text-[9px] font-bold text-white tracking-wider border border-white/10">
                          4K
                        </span>
                        {isSelected && (
                          <span className="absolute bottom-1.5 right-1.5 p-1 rounded-full bg-blue-600 text-white shadow-md">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-bold text-white truncate px-1">{w.name}</div>
                      <div className="text-[10px] text-gray-400 truncate px-1">{w.subtitle}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB: SERVER BACKUP & RESTORE */}
          {activeTab === 'backup' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight flex items-center space-x-2">
                    <FolderArchive className="w-5 h-5 text-emerald-400" />
                    <span>Server Data Backup & Restore (~/.sshdesktop)</span>
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Backup and restore all settings, preferences, and data inside <code className="text-amber-300 font-mono text-[11px]">{sshDesktopPath}</code> for the login user.
                  </p>
                </div>
                <button
                  onClick={() => {
                    refreshTarBackupData();
                    refreshServerStatus();
                  }}
                  disabled={isTarLoading}
                  className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium flex items-center space-x-1.5 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                  title="Refresh status from server"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTarLoading ? 'animate-spin text-emerald-400' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {/* Status/Error Notification Banner */}
              {tarMessage && (
                <div className={`p-3.5 rounded-2xl text-xs flex items-center space-x-2.5 border animate-in fade-in duration-200 ${
                  tarMessage.isError 
                    ? 'bg-rose-500/15 border-rose-500/30 text-rose-300' 
                    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                }`}>
                  {tarMessage.isError ? <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
                  <span className="flex-1 font-mono">{tarMessage.text}</span>
                  <button onClick={() => setTarMessage(null)} className="text-gray-400 hover:text-white cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {backupMessage && (
                <div className={`p-3.5 rounded-2xl text-xs flex items-center space-x-2.5 border animate-in fade-in duration-200 ${
                  backupMessage.isError 
                    ? 'bg-rose-500/15 border-rose-500/30 text-rose-300' 
                    : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                }`}>
                  {backupMessage.isError ? <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" /> : <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />}
                  <span className="flex-1">{backupMessage.text}</span>
                  <button onClick={() => setBackupMessage(null)} className="text-gray-400 hover:text-white cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Server Target Directory Status Card */}
              <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-teal-950/30 to-blue-950/40 border border-emerald-500/30 space-y-3 shadow-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2 text-xs font-semibold text-emerald-300">
                    <FolderArchive className="w-4 h-4 text-emerald-400" />
                    <span>Target Directory for Backup & Restore</span>
                  </div>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium flex items-center space-x-1.5 ${
                    activeConnectionId 
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${activeConnectionId ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                    <span>{activeConnectionId ? `User Login OK (${effectiveUsername}@${activeServer?.name || activeServer?.host})` : 'Offline (No Connection)'}</span>
                  </span>
                </div>

                <div className="text-xs font-mono text-gray-300 bg-[#101018]/90 p-2.5 rounded-xl border border-white/10 break-all select-all flex items-center justify-between">
                  <div className="flex items-center space-x-2 truncate">
                    <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="text-amber-300 font-semibold">{sshDesktopPath}</span>
                  </div>
                  {copiedTargetDir ? (
                    <span className="text-[10px] text-emerald-400 flex items-center space-x-1 shrink-0 ml-2">
                      <Check className="w-3 h-3" />
                      <span>Copied</span>
                    </span>
                  ) : (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(sshDesktopPath);
                        setCopiedTargetDir(true);
                        setTimeout(() => setCopiedTargetDir(false), 2000);
                      }}
                      className="text-[10px] text-gray-400 hover:text-white transition-colors cursor-pointer shrink-0 ml-2 bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded border border-white/10"
                    >
                      Copy Path
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-4 gap-2 text-[11px] text-gray-400 pt-1">
                  <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                    <span className="text-gray-500 block text-[10px]">Login User</span>
                    <strong className="text-white font-mono text-xs">{effectiveUsername}</strong>
                  </div>
                  <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                    <span className="text-gray-500 block text-[10px]">Files Inside</span>
                    <span className="text-emerald-300 font-mono text-xs font-bold">{sshDesktopFileCount} items</span>
                  </div>
                  <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                    <span className="text-gray-500 block text-[10px]">Total Size</span>
                    <span className="text-cyan-300 font-mono text-xs font-bold">{sshDesktopTotalSize}</span>
                  </div>
                  <div className="bg-white/5 p-2 rounded-lg border border-white/5">
                    <span className="text-gray-500 block text-[10px]">Backups Folder</span>
                    <span className="text-gray-300 font-mono text-[10px] truncate block" title={sshDesktopBackupsPath}>{sshDesktopBackupsPath}</span>
                  </div>
                </div>
              </div>

              {/* Quick 1-Click Backup & Restore for User Environment Card */}
              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-5 shadow-xl backdrop-blur-md space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
                      <FolderArchive className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                        <span>Desktop Settings Backup & Restore</span>
                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono">
                          User Login OK
                        </span>
                      </h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        Backup and restore settings, wallpaper, dock preferences, notes, and icon layout to <code className="text-amber-300 font-mono text-[11px]">{serverSettingsPath}</code>
                      </p>
                    </div>
                  </div>
                </div>

                {/* 1-Click Backup and Restore Buttons */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <button
                    onClick={handleBackupToServer}
                    disabled={isBackingUp || !activeConnectionId}
                    className="flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isBackingUp ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    <span>{isBackingUp ? 'Backing Up to Server...' : 'Backup Now to ~/.sshdesktop'}</span>
                  </button>

                  <button
                    onClick={handleRestoreFromServer}
                    disabled={isRestoring || !activeConnectionId}
                    className="flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isRestoring ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    <span>{isRestoring ? 'Restoring from Server...' : 'Restore Now from ~/.sshdesktop'}</span>
                  </button>
                </div>

                {/* Auto-Restore on User Login Toggle Setting */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/5">
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-semibold text-white">Auto-Restore on User Login</span>
                      <span className="text-[9px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded font-mono">User Login OK</span>
                    </div>
                    <p className="text-[11px] text-gray-400">
                      Automatically restores your desktop layout, wallpaper, notes, and preferences whenever user <strong className="text-gray-300">{effectiveUsername}</strong> logs in.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const next = !autoRestoreOnLogin;
                      setAutoRestoreOnLogin(next);
                      localStorage.setItem('sshdesktop_auto_restore_on_login', String(next));
                    }}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${autoRestoreOnLogin ? 'bg-emerald-600' : 'bg-white/10'}`}
                    title={autoRestoreOnLogin ? 'Auto-restore active on user login' : 'Auto-restore disabled'}
                  >
                    <span className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${autoRestoreOnLogin ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>

              {/* Primary Backup & Restore Hero Cards */}
              <div className="grid grid-cols-2 gap-4">
                {/* 1. CREATE TAR BACKUP CARD */}
                <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl backdrop-blur-md flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-9 h-9 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30 shrink-0">
                        <Archive className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-white">Create Tar Backup</h3>
                        <span className="text-[10px] text-gray-400">All files in {sshDesktopPath}</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      Packages all files inside <code className="text-amber-300 font-mono text-[10px]">{sshDesktopPath}</code> into an archive on the server with optional instant PC download.
                    </p>

                    {/* Format Options */}
                    <div className="space-y-2 pt-1">
                      <label className="text-[10px] font-semibold text-gray-300 uppercase tracking-wider block">Archive Format</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setTarBackupFormat('tar.gz')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center justify-center space-x-1.5 border transition-all cursor-pointer ${
                            tarBackupFormat === 'tar.gz'
                              ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-bold'
                              : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                          <span>.tar.gz (Gzip)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTarBackupFormat('tar')}
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center justify-center space-x-1.5 border transition-all cursor-pointer ${
                            tarBackupFormat === 'tar'
                              ? 'bg-blue-600/20 border-blue-500 text-blue-300 font-bold'
                              : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                          }`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                          <span>.tar (POSIX)</span>
                        </button>
                      </div>

                      {/* Download Checkbox */}
                      <label className="flex items-center space-x-2 text-[11px] text-gray-300 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={autoDownloadAfterBackup}
                          onChange={(e) => setAutoDownloadAfterBackup(e.target.checked)}
                          className="rounded border-white/20 bg-white/5 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <span>Download tar archive to local PC Downloads folder</span>
                      </label>
                    </div>
                  </div>

                  <button
                    onClick={handleCreateTarBackup}
                    disabled={isCreatingTar || !activeConnectionId}
                    className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isCreatingTar ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Archive className="w-3.5 h-3.5" />
                    )}
                    <span>{isCreatingTar ? 'Creating Tar Archive...' : `Create Backup (${tarBackupFormat})`}</span>
                  </button>
                </div>

                {/* 2. RECOVER / RESTORE FROM TAR FILE CARD */}
                <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-5 space-y-4 shadow-xl backdrop-blur-md flex flex-col justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30 shrink-0">
                        <RotateCcw className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-white">Restore / Recover Tar File</h3>
                        <span className="text-[10px] text-gray-400">Restore into {sshDesktopPath}</span>
                      </div>
                    </div>

                    <p className="text-[11px] text-gray-400 leading-relaxed">
                      Upload a <code className="text-emerald-300 font-mono text-[10px]">.tar</code> or <code className="text-emerald-300 font-mono text-[10px]">.tar.gz</code> archive from your computer to unpack and restore all files into <code className="text-amber-300 font-mono text-[10px]">{sshDesktopPath}</code>.
                    </p>

                    {/* Hidden input for local tar upload */}
                    <input
                      type="file"
                      ref={tarUploadInputRef}
                      accept=".tar,.tar.gz,.tgz"
                      onChange={handleUploadAndRestoreTar}
                      className="hidden"
                    />

                    {/* Drag-and-Drop / Upload Box */}
                    <div 
                      onClick={() => !isRestoringTar && tarUploadInputRef.current?.click()}
                      className="border border-dashed border-emerald-500/30 hover:border-emerald-500/60 bg-emerald-500/5 hover:bg-emerald-500/10 p-3.5 rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-all group"
                    >
                      <Upload className="w-5 h-5 text-emerald-400 mb-1 group-hover:-translate-y-0.5 transition-transform" />
                      <span className="text-xs font-semibold text-emerald-300">Click to Select Local Tar Archive</span>
                      <span className="text-[10px] text-gray-400 mt-0.5">Supports .tar, .tar.gz, .tgz archives</span>
                    </div>
                  </div>

                  <button
                    onClick={() => tarUploadInputRef.current?.click()}
                    disabled={isRestoringTar || !activeConnectionId}
                    className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer disabled:opacity-50"
                  >
                    {isRestoringTar ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RotateCcw className="w-3.5 h-3.5" />
                    )}
                    <span>{isRestoringTar ? 'Unpacking & Restoring...' : 'Upload & Recover from PC Tar'}</span>
                  </button>
                </div>
              </div>

              {/* Server Backup Archives List */}
              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-4 shadow-xl backdrop-blur-md space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Archive className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-white">Server Backup Archives</span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded-full font-mono">
                      {backupArchives.length} archives
                    </span>
                  </div>
                  <span className="text-[10px] text-gray-400 font-mono">
                    Stored in: <span className="text-amber-300">{sshDesktopBackupsPath}</span>
                  </span>
                </div>

                {backupArchives.length === 0 ? (
                  <div className="bg-[#101018] p-6 rounded-xl border border-white/5 text-center space-y-2">
                    <FolderArchive className="w-8 h-8 text-gray-600 mx-auto" />
                    <p className="text-xs text-gray-400">No backup archives created on server yet.</p>
                    <p className="text-[11px] text-gray-500">Click <strong>Create Backup</strong> above to generate a .tar.gz archive of all files inside {sshDesktopPath}.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#101018]">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-[10px] text-gray-400 uppercase tracking-wider bg-white/[0.02]">
                          <th className="py-2.5 px-3">Archive File</th>
                          <th className="py-2.5 px-3">Type</th>
                          <th className="py-2.5 px-3">Size</th>
                          <th className="py-2.5 px-3">Created Date</th>
                          <th className="py-2.5 px-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                        {backupArchives.map((arc) => (
                          <tr key={arc.path} className="hover:bg-white/[0.03] transition-colors">
                            <td className="py-2.5 px-3 text-white font-medium flex items-center space-x-2 truncate max-w-xs">
                              <Archive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                              <span className="truncate" title={arc.name}>{arc.name}</span>
                            </td>
                            <td className="py-2.5 px-3">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                arc.isGzip 
                                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' 
                                  : 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                              }`}>
                                {arc.isGzip ? 'TAR.GZ' : 'TAR'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-cyan-300 font-semibold">{arc.size}</td>
                            <td className="py-2.5 px-3 text-gray-400">{arc.modified}</td>
                            <td className="py-2.5 px-3 text-right">
                              <div className="flex items-center justify-end space-x-1.5">
                                {/* Recover button */}
                                <button
                                  onClick={() => setRestoreConfirmModal({ open: true, archiveName: arc.name, archivePath: arc.path })}
                                  disabled={isRestoringTar}
                                  className="px-2 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white text-[10px] font-sans font-semibold border border-emerald-500/30 flex items-center space-x-1 transition-all cursor-pointer"
                                  title="Restore / Recover all files into .sshdesktop"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Recover</span>
                                </button>

                                {/* Download button */}
                                <button
                                  onClick={() => handleDownloadArchive(arc.path, arc.name)}
                                  className="px-2 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600 text-blue-300 hover:text-white text-[10px] font-sans font-semibold border border-blue-500/30 flex items-center space-x-1 transition-all cursor-pointer"
                                  title="Download tar archive to local PC"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>Download</span>
                                </button>

                                {/* Inspect button */}
                                <button
                                  onClick={() => handleInspectArchive(arc.path, arc.name)}
                                  className="p-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                                  title="Inspect files inside tar archive"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                </button>

                                {/* Delete button */}
                                <button
                                  onClick={() => handleDeleteArchive(arc.path, arc.name)}
                                  className="p-1 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white border border-rose-500/20 transition-colors cursor-pointer"
                                  title="Delete backup archive from server"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Collapsible Files Inside .sshdesktop */}
              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-4 shadow-xl backdrop-blur-md space-y-3">
                <div 
                  onClick={() => setShowFilesList(!showFilesList)}
                  className="flex items-center justify-between cursor-pointer select-none"
                >
                  <div className="flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-bold text-white">Files Inside {sshDesktopPath}</span>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono">
                      {sshDesktopFiles.length} files ({sshDesktopTotalSize})
                    </span>
                  </div>
                  <button className="text-gray-400 hover:text-white text-xs flex items-center space-x-1">
                    <span>{showFilesList ? 'Collapse' : 'Expand'}</span>
                    {showFilesList ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {showFilesList && (
                  <div className="space-y-2 pt-1 animate-in fade-in duration-200">
                    {sshDesktopFiles.length === 0 ? (
                      <div className="text-xs text-gray-500 p-3 bg-[#101018] rounded-xl text-center">
                        No files currently stored inside {sshDesktopPath}.
                      </div>
                    ) : (
                      <div className="max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-[#101018]">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr className="border-b border-white/10 text-[10px] text-gray-400 uppercase tracking-wider bg-white/[0.02]">
                              <th className="py-2 px-3">File Name</th>
                              <th className="py-2 px-3">Size</th>
                              <th className="py-2 px-3">Last Modified</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                            {sshDesktopFiles.map((f) => (
                              <tr key={f.path} className="hover:bg-white/[0.02]">
                                <td className="py-1.5 px-3 text-white flex items-center space-x-2">
                                  {f.isDir ? (
                                    <Folder className="w-3.5 h-3.5 text-blue-400" />
                                  ) : f.name.endsWith('.json') ? (
                                    <FileCode className="w-3.5 h-3.5 text-amber-400" />
                                  ) : (
                                    <FileText className="w-3.5 h-3.5 text-gray-400" />
                                  )}
                                  <span className="font-semibold">{f.name}</span>
                                </td>
                                <td className="py-1.5 px-3 text-cyan-300">{f.size}</td>
                                <td className="py-1.5 px-3 text-gray-400">{f.modified}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Collapsible Quick Settings Sync Card (Legacy settings.json sync) */}
              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-4 shadow-xl backdrop-blur-md space-y-3">
                <div 
                  onClick={() => setShowJsonSyncCard(!showJsonSyncCard)}
                  className="flex items-center justify-between cursor-pointer select-none"
                >
                  <div className="flex items-center space-x-2">
                    <FileCode className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-semibold text-white">Single Preferences Sync (settings.json only)</span>
                  </div>
                  <button className="text-gray-400 hover:text-white text-xs flex items-center space-x-1">
                    <span>{showJsonSyncCard ? 'Collapse' : 'Expand Preferences Sync'}</span>
                    {showJsonSyncCard ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {showJsonSyncCard && (
                  <div className="space-y-4 pt-2 animate-in fade-in duration-200">
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        onClick={handleBackupToServer}
                        disabled={isBackingUp || !activeConnectionId}
                        className="flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer disabled:opacity-50"
                      >
                        {isBackingUp ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                        <span>Save settings.json to Server</span>
                      </button>

                      <button
                        onClick={handleRestoreFromServer}
                        disabled={isRestoring || !activeConnectionId}
                        className="flex items-center justify-center space-x-2 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer disabled:opacity-50"
                      >
                        {isRestoring ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
                        <span>Load settings.json from Server</span>
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-white/5">
                      <div>
                        <span className="text-xs font-semibold text-white block">Auto-Sync Preferences</span>
                        <span className="text-[10px] text-gray-400">Auto-save changes to settings.json</span>
                      </div>
                      <button
                        onClick={() => {
                          const next = !autoSyncServer;
                          setAutoSyncServer(next);
                          localStorage.setItem('sshdesktop_auto_sync_server', String(next));
                        }}
                        className={`w-10 h-5.5 rounded-full transition-colors relative cursor-pointer ${autoSyncServer ? 'bg-blue-600' : 'bg-white/10'}`}
                      >
                        <span className={`w-4.5 h-4.5 rounded-full bg-white absolute top-0.5 transition-transform ${autoSyncServer ? 'left-5' : 'left-0.5'}`} />
                      </button>
                    </div>

                    <div className="max-h-48 overflow-y-auto bg-[#101018] p-3 rounded-xl border border-white/5 font-mono text-[11px] text-gray-300 select-text">
                      <pre>{serverFileStatus?.rawJson || '// No settings.json saved on server yet.'}</pre>
                    </div>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 3: SERVER DATE & TIME */}
          {activeTab === 'datetime' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white tracking-tight">Date & Time (Server)</h2>
                  <p className="text-xs text-gray-400">
                    Manage timezone, manual system clock, and NTP synchronization for {activeServer?.name || 'Remote Server'}.
                  </p>
                </div>
                <button
                  onClick={fetchServerTimeInfo}
                  disabled={isTimeLoading}
                  className="px-3.5 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-medium flex items-center space-x-1.5 transition-all active:scale-95 disabled:opacity-50"
                  title="Refresh from server"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isTimeLoading ? 'animate-spin text-blue-400' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {timeMessage && (
                <div className={`p-3.5 rounded-2xl text-xs flex items-start space-x-2.5 ${
                  timeMessage.isError 
                    ? 'bg-red-500/15 border border-red-500/30 text-red-300' 
                    : 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                }`}>
                  {timeMessage.isError ? (
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
                  )}
                  <span className="font-mono">{timeMessage.text}</span>
                </div>
              )}

              {/* Current Server Time Status Card */}
              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-5 space-y-3 shadow-xl backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-gray-300 flex items-center space-x-2">
                    <Clock className="w-4 h-4 text-blue-400" />
                    <span>Remote System Clock</span>
                  </span>
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                    ntpActive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  }`}>
                    {ntpActive ? 'NTP Synchronized' : 'Manual Clock Mode'}
                  </span>
                </div>

                <div className="font-mono text-xl font-bold text-white tracking-wide">
                  {serverLocalTime}
                </div>

                <div className="text-[11px] text-gray-400 flex items-center space-x-3 pt-2 border-t border-white/[0.06]">
                  <span>Active Timezone: <b className="text-blue-300 font-mono">{serverTimezone}</b></span>
                </div>
              </div>

              {/* Sync with Local Computer Time Action */}
              <div className="bg-gradient-to-r from-blue-600/15 via-indigo-600/15 to-purple-600/15 border border-blue-500/30 rounded-2xl p-5 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                    <Laptop className="w-4 h-4 text-blue-400" />
                    <span>Sync with My Local Computer Time</span>
                  </div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    Quickly sets Linux server timezone & time to match your computer clock.
                  </div>
                </div>
                <button
                  onClick={handleSyncWithBrowserTime}
                  disabled={isTimeLoading}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center space-x-1.5 shrink-0"
                >
                  <span>Sync Now</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Change Timezone Row */}
              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-5 space-y-3 shadow-xl backdrop-blur-md">
                <label className="block text-xs font-bold text-white flex items-center space-x-1.5">
                  <Globe2 className="w-4 h-4 text-blue-400" />
                  <span>Change Server Timezone</span>
                </label>

                <div className="flex items-center space-x-2">
                  <select
                    value={selectedTz}
                    onChange={e => setSelectedTz(e.target.value)}
                    className="bg-[#12121e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white flex-1 focus:outline-none focus:border-blue-400 font-mono"
                  >
                    {COMMON_TIMEZONES.map(tz => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                    {!COMMON_TIMEZONES.some(tz => tz.value === selectedTz) && (
                      <option value={selectedTz}>{selectedTz} (Current)</option>
                    )}
                  </select>

                  <button
                    onClick={handleSetTimezone}
                    disabled={isTimeLoading || selectedTz === serverTimezone}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40 shrink-0"
                  >
                    Apply
                  </button>
                </div>
              </div>

              {/* Manual Adjustment */}
              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl p-5 space-y-3 shadow-xl backdrop-blur-md">
                <label className="block text-xs font-bold text-white flex items-center space-x-1.5">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                  <span>Manual Date & Time Adjustment</span>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">Date (YYYY-MM-DD)</label>
                    <input
                      type="date"
                      value={manualDate}
                      onChange={e => setManualDate(e.target.value)}
                      className="w-full bg-[#12121e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-400"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">Time (HH:MM:SS)</label>
                    <input
                      type="time"
                      step="1"
                      value={manualTime}
                      onChange={e => setManualTime(e.target.value)}
                      className="w-full bg-[#12121e] border border-white/10 rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-blue-400"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => handleToggleNtp(!ntpActive)}
                    disabled={isTimeLoading}
                    className="text-xs text-gray-400 hover:text-white underline transition-colors"
                  >
                    {ntpActive ? 'Turn Off NTP Sync to allow manual edit' : 'Turn On Auto NTP Sync'}
                  </button>

                  <button
                    onClick={handleSetManualTime}
                    disabled={isTimeLoading}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40"
                  >
                    Save Time
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: TERMINAL EMULATOR */}
          {activeTab === 'terminal' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Terminal Preferences</h2>
                <p className="text-xs text-gray-400">Configure xterm terminal typography, cursor style, and buffer sizes.</p>
              </div>

              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl divide-y divide-white/5 shadow-xl backdrop-blur-md overflow-hidden">
                {/* Font Size Row */}
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">Font Size</span>
                    <span className="text-[11px] text-gray-400">Terminal typography size in pixels ({terminalFontSize || 14}px)</span>
                  </div>
                  <input
                    type="range"
                    min="11"
                    max="22"
                    value={terminalFontSize || 14}
                    onChange={e => updateSettings({ terminalFontSize: parseInt(e.target.value) })}
                    className="w-48 accent-blue-500 cursor-pointer"
                  />
                </div>

                {/* Cursor Style Row */}
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">Cursor Style</span>
                    <span className="text-[11px] text-gray-400">Visual presentation of the terminal prompt cursor</span>
                  </div>
                  <div className="flex bg-[#12121e] p-1 rounded-xl border border-white/10 text-xs">
                    {(['block', 'line', 'underline'] as const).map(style => (
                      <button
                        key={style}
                        onClick={() => setTermCursor(style)}
                        className={`px-3 py-1 rounded-lg capitalize transition-all ${
                          termCursor === style ? 'bg-blue-600 text-white font-semibold' : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Scrollback Buffer */}
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">Scrollback History Buffer</span>
                    <span className="text-[11px] text-gray-400">Number of lines preserved in memory per tab</span>
                  </div>
                  <select
                    value={termScrollback}
                    onChange={e => setTermScrollback(Number(e.target.value))}
                    className="bg-[#12121e] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value={1000}>1,000 lines</option>
                    <option value={5000}>5,000 lines</option>
                    <option value={10000}>10,000 lines</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: CODE EDITOR */}
          {activeTab === 'editor' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Code Editor Settings</h2>
                <p className="text-xs text-gray-400">Configure Monaco editor indentation, minimap, and word wrapping.</p>
              </div>

              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl divide-y divide-white/5 shadow-xl backdrop-blur-md overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">Tab Indentation</span>
                    <span className="text-[11px] text-gray-400">Spaces inserted per indentation tab</span>
                  </div>
                  <select
                    value={editorTabSize}
                    onChange={e => setEditorTabSize(Number(e.target.value))}
                    className="bg-[#12121e] border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value={2}>2 spaces</option>
                    <option value={4}>4 spaces</option>
                  </select>
                </div>

                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">Code Minimap</span>
                    <span className="text-[11px] text-gray-400">Display mini overview navigator on the right</span>
                  </div>
                  <button
                    onClick={() => setEditorMinimap(!editorMinimap)}
                    className={`w-11 h-6 rounded-full transition-colors relative ${editorMinimap ? 'bg-blue-600' : 'bg-white/10'}`}
                  >
                    <span className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${editorMinimap ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>

                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">Soft Word Wrap</span>
                    <span className="text-[11px] text-gray-400">Wrap long lines to fit editor viewport</span>
                  </div>
                  <button
                    onClick={() => setEditorWordWrap(!editorWordWrap)}
                    className={`w-11 h-6 rounded-full transition-colors relative ${editorWordWrap ? 'bg-blue-600' : 'bg-white/10'}`}
                  >
                    <span className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${editorWordWrap ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: DESKTOP & DOCK */}
          {activeTab === 'dock' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">Desktop & Dock</h2>
                <p className="text-xs text-gray-400">Configure dock position and file explorer viewing preferences.</p>
              </div>

              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl divide-y divide-white/5 shadow-xl backdrop-blur-md overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">Dock Screen Position</span>
                    <span className="text-[11px] text-gray-400">Screen edge where application dock is docked</span>
                  </div>
                  <div className="flex bg-[#12121e] p-1 rounded-xl border border-white/10 text-xs">
                    {(['bottom', 'left'] as const).map(pos => (
                      <button
                        key={pos}
                        onClick={() => updateSettings({ dockPosition: pos })}
                        className={`px-3 py-1 rounded-lg capitalize transition-all ${
                          dockPosition === pos ? 'bg-blue-600 text-white font-semibold' : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">Show Hidden Dotfiles</span>
                    <span className="text-[11px] text-gray-400">Show dotfiles (.bashrc, .ssh, .config) in Finder</span>
                  </div>
                  <button
                    onClick={() => updateSettings({ showHiddenFiles: !showHiddenFiles })}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${showHiddenFiles ? 'bg-blue-600' : 'bg-white/10'}`}
                  >
                    <span className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${showHiddenFiles ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>

                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">Auto-Hide Dock (Start Bar)</span>
                    <span className="text-[11px] text-gray-400">Automatically hide dock until mouse hovers bottom edge</span>
                  </div>
                  <button
                    onClick={() => updateSettings({ autoHideDock: !autoHideDock })}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${autoHideDock ? 'bg-blue-600' : 'bg-white/10'}`}
                  >
                    <span className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${autoHideDock ? 'left-5.5' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: SSH & NETWORK */}
          {activeTab === 'ssh' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">SSH & Network Engine</h2>
                <p className="text-xs text-gray-400">Default protocol timeouts and socket keepalive settings.</p>
              </div>

              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-2xl divide-y divide-white/5 shadow-xl backdrop-blur-md overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">TCP Keepalive Interval</span>
                    <span className="text-[11px] text-gray-400">Sends probe packets to prevent remote disconnection</span>
                  </div>
                  <span className="text-xs font-mono text-gray-300 bg-[#12121e] px-3 py-1.5 rounded-xl border border-white/10">
                    30 seconds
                  </span>
                </div>

                <div className="p-4 flex items-center justify-between">
                  <div>
                    <span className="text-xs font-semibold text-white block">Default SSH Port</span>
                    <span className="text-[11px] text-gray-400">Standard port for SSH server connections</span>
                  </div>
                  <span className="text-xs font-mono font-bold text-gray-300 bg-[#12121e] px-3 py-1.5 rounded-xl border border-white/10">
                    22
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: ABOUT SSH DESKTOP */}
          {activeTab === 'about' && (
            <div className="space-y-6">
              <div className="bg-[#1e1e2e]/90 border border-white/10 rounded-3xl p-6 shadow-2xl backdrop-blur-md flex flex-col items-center text-center space-y-4">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-500 via-indigo-600 to-purple-600 flex items-center justify-center shadow-2xl border border-white/20 p-2.5">
                  <SshDesktopLogo className="w-full h-full" />
                </div>

                <div>
                  <h2 className="text-xl font-bold text-white tracking-tight">SSH Desktop</h2>
                  <div className="text-xs text-gray-400 mt-1">macOS Edition for Linux Remote Administration</div>
                </div>

                <div className="w-full bg-[#14141e] p-4 rounded-2xl border border-white/10 text-xs text-gray-300 space-y-2 text-left font-mono">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Connected Server:</span>
                    <span className="text-white font-bold">{activeServer?.name || activeServer?.host || 'localhost'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Remote Kernel:</span>
                    <span className="text-sky-400">{hostUname}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Host Uptime:</span>
                    <span className="text-emerald-400">{hostUptime}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Memory Allocation:</span>
                    <span className="text-purple-400">{hostMemory}</span>
                  </div>
                </div>

                <div className="text-[11px] text-gray-500 leading-relaxed max-w-md">
                  Built with Tauri 2.0, Rust SSH2 Engine, and React 19. Designed with authentic macOS glassmorphism, micro-animations, and zero server agent requirements.
                </div>
              </div>
            </div>
          )}

        </div>
      </main>

      {/* 1. Modal: Inspect Tar Archive Contents (tar -tvf) */}
      {inspectModal?.open && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200 p-4">
          <div className="bg-[#181825] border border-white/20 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center border border-blue-500/30">
                  <Archive className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white truncate max-w-md">{inspectModal.archiveName}</h3>
                  <p className="text-[10px] text-gray-400 font-mono truncate">{inspectModal.archivePath}</p>
                </div>
              </div>
              <button
                onClick={() => setInspectModal(null)}
                className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 flex-1 overflow-y-auto space-y-4">
              {inspectModal.loading ? (
                <div className="p-12 flex flex-col items-center justify-center space-y-2 text-gray-400">
                  <RefreshCw className="w-6 h-6 animate-spin text-blue-400" />
                  <span className="text-xs">Reading archive contents (tar -tvf)...</span>
                </div>
              ) : inspectModal.items.length === 0 ? (
                <div className="bg-[#101018] p-4 rounded-xl font-mono text-xs text-gray-300 whitespace-pre-wrap">
                  {inspectModal.rawOutput || 'Empty archive or unable to read contents.'}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#101018]">
                  <table className="w-full text-left text-xs font-mono">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] text-gray-400 uppercase tracking-wider bg-white/[0.02]">
                        <th className="py-2 px-3">File / Path</th>
                        <th className="py-2 px-3">Size</th>
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-3">Permissions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-[11px]">
                      {inspectModal.items.map((item, idx) => (
                        <tr key={idx} className="hover:bg-white/[0.02]">
                          <td className="py-1.5 px-3 text-white truncate max-w-xs">{item.name}</td>
                          <td className="py-1.5 px-3 text-cyan-300">{item.size}</td>
                          <td className="py-1.5 px-3 text-gray-400">{item.date}</td>
                          <td className="py-1.5 px-3 text-gray-500">{item.permissions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between bg-white/[0.02]">
              <span className="text-xs text-gray-400">
                Total {inspectModal.items.length} items in archive
              </span>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setInspectModal(null)}
                  className="px-3.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition-colors cursor-pointer"
                >
                  Close
                </button>
                <button
                  onClick={() => {
                    const arc = { archiveName: inspectModal.archiveName, archivePath: inspectModal.archivePath };
                    setInspectModal(null);
                    setRestoreConfirmModal({ open: true, ...arc });
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer shadow-md shadow-emerald-600/30"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Recover This Archive</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Modal: Confirm Restore & Recovery */}
      {restoreConfirmModal?.open && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200 p-4">
          <div className="bg-[#181825] border border-amber-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30 mx-auto">
              <RotateCcw className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1.5">
              <h3 className="text-sm font-bold text-white">Confirm Recovery / Restore</h3>
              <p className="text-xs text-gray-300 leading-relaxed">
                Are you sure you want to restore all files inside <code className="text-amber-300 font-mono text-[11px]">{sshDesktopPath}</code> from:
              </p>
              <div className="p-2 bg-[#101018] rounded-xl border border-white/10 font-mono text-xs text-emerald-300 break-all select-all">
                {restoreConfirmModal.archiveName}
              </div>
              <p className="text-[11px] text-amber-300/80 pt-1">
                Any existing configuration files will be restored and overwritten with the archive contents.
              </p>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                onClick={() => setRestoreConfirmModal(null)}
                disabled={isRestoringTar}
                className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRestoreTar}
                disabled={isRestoringTar}
                className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-lg shadow-emerald-600/30 disabled:opacity-50"
              >
                {isRestoringTar ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>{isRestoringTar ? 'Restoring...' : 'Confirm & Recover'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Modal: Confirm Delete Archive */}
      {deleteArchiveConfirmModal?.open && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-200 p-4">
          <div className="bg-[#181825] border border-red-500/30 rounded-2xl w-full max-w-md p-6 shadow-2xl space-y-4 animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-2xl bg-red-500/20 text-red-400 flex items-center justify-center border border-red-500/30 mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1.5">
              <h3 className="text-sm font-bold text-white">Delete Backup Archive</h3>
              <p className="text-xs text-gray-300 leading-relaxed">
                Are you sure you want to delete this backup archive from the server?
              </p>
              <div className="p-2 bg-[#101018] rounded-xl border border-white/10 font-mono text-xs text-red-300 break-all select-all">
                {deleteArchiveConfirmModal.archiveName}
              </div>
              <p className="text-[11px] text-gray-400 pt-1">
                This file will be permanently removed from <code className="text-amber-300 font-mono text-[10px]">{sshDesktopBackupsPath}</code>.
              </p>
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <button
                onClick={() => setDeleteArchiveConfirmModal(null)}
                className="flex-1 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDeleteArchive}
                className="flex-1 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-lg shadow-red-600/30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Confirm Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { AppSettings };
