import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Globe, ArrowLeft, ArrowRight, RotateCw, Home, Lock, 
  ShieldCheck, Star, Plus, X, Search, Activity, Terminal, 
  Layers, Code2, Server, ExternalLink, ZoomIn, ZoomOut,
  AlertCircle, Check, Sparkles, ChevronDown, Radio, Bookmark as BookmarkIcon,
  Laptop, Compass, Copy, ArrowUpRight
} from 'lucide-react';
import { BrowserTab, BrowserRoutingMode, BrowserBookmark, DevToolsPanel } from './types';
import { useBrowserStore } from './browserStore';
import { useConnectionStore } from '../../lib/store';
import { 
  sshStartTunnel, 
  sshStopTunnel, 
  sftpReadTextFile, 
  sftpWriteTextFile, 
  sftpMkdir,
  openExternalUrl
} from '../../lib/tauri-bridge';
import DiscoveredServicesBar from './components/DiscoveredServicesBar';
import BrowserDevTools from './components/BrowserDevTools';
import BrowserStartPage from './components/BrowserStartPage';

const GOOGLE_HOME = 'https://www.google.com';
const GOOGLE_EMBED_HOME = 'https://www.google.com/webhp?igu=1';

interface ResolvedTarget {
  url: string;
  displayUrl: string;
  iframeSrc: string;
  title: string;
  isTunneled: boolean;
  remoteHost: string;
  remotePort: number;
  subPath: string;
  isPublicHttps?: boolean;
}

/**
 * Resolves user typed text into logical URL, display URL, and iframe destination based on network mode
 */
function resolveNavigationTarget(input: string, networkMode: 'server' | 'user'): ResolvedTarget {
  const trimmed = input.trim();

  // 1. Empty or newtab
  if (!trimmed || trimmed === 'about:newtab' || trimmed === 'newtab') {
    return {
      url: '',
      displayUrl: '',
      iframeSrc: '',
      title: 'New Tab',
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath: '',
    };
  }

  // 2. Pure port number like "8080" or ":8080"
  if (/^:?\d+$/.test(trimmed)) {
    const port = parseInt(trimmed.replace(':', ''), 10);
    const display = `http://localhost:${port}`;
    if (networkMode === 'server') {
      return {
        url: display,
        displayUrl: display,
        iframeSrc: '',
        title: `localhost:${port}`,
        isTunneled: true,
        remoteHost: '127.0.0.1',
        remotePort: port,
        subPath: '/',
      };
    } else {
      return {
        url: display,
        displayUrl: display,
        iframeSrc: display,
        title: `localhost:${port}`,
        isTunneled: false,
        remoteHost: '',
        remotePort: 0,
        subPath: '/',
      };
    }
  }

  const hasProtocol = /^[a-zA-Z]+:\/\//.test(trimmed);
  const isLocalHost = /^localhost(:\d+)?(\/.*)?$/i.test(trimmed) || 
                      /^127\.0\.0\.1(:\d+)?(\/.*)?$/.test(trimmed) || 
                      /^0\.0\.0\.0(:\d+)?(\/.*)?$/.test(trimmed);
  const hasDot = trimmed.includes('.');
  const hasSpace = /\s/.test(trimmed);
  const isIpWithPort = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(trimmed);

  // 3. Multi-word search or words without dot/colon/protocol -> Search query
  if (!hasProtocol && !isLocalHost && !isIpWithPort && (hasSpace || (!hasDot && !trimmed.includes(':')))) {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    return {
      url: searchUrl,
      displayUrl: searchUrl,
      iframeSrc: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}&igu=1`,
      title: `${trimmed} - Search`,
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath: '',
      isPublicHttps: true,
    };
  }

  // 4. Format URL with protocol
  let formatted = trimmed;
  if (!hasProtocol) {
    formatted = (isLocalHost || isIpWithPort) ? `http://${trimmed}` : `https://${trimmed}`;
  }

  try {
    const parsed = new URL(formatted);
    const hostname = parsed.hostname.toLowerCase();
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    const subPath = (parsed.pathname || '/') + (parsed.search || '') + (parsed.hash || '');
    const cleanDisplay = `${parsed.protocol}//${parsed.host}${subPath}`;
    const isCustomPort = parsed.port && parsed.port !== '80' && parsed.port !== '443';

    // If Server Network mode (SSH: ON):
    if (networkMode === 'server') {
      const isPublicHttps = !isLocal && !isIpWithPort && parsed.protocol === 'https:' && !isCustomPort;
      const port = parsed.port 
        ? parseInt(parsed.port, 10) 
        : (parsed.protocol === 'https:' ? 443 : 80);
      const targetHost = isLocal ? '127.0.0.1' : hostname;

      return {
        url: cleanDisplay,
        displayUrl: cleanDisplay,
        iframeSrc: '', // Assigned after sshStartTunnel
        title: `${parsed.host}${parsed.pathname !== '/' ? parsed.pathname : ''}`,
        isTunneled: !isPublicHttps,
        remoteHost: targetHost,
        remotePort: port,
        subPath,
        isPublicHttps,
      };
    }

    // If User Network mode (SSH: OFF): PC Browser Direct
    if (hostname.includes('google.com')) {
      let iframeSrc = formatted;
      if (parsed.pathname === '/' || parsed.pathname === '' || parsed.pathname === '/webhp') {
        iframeSrc = GOOGLE_EMBED_HOME;
      } else if (!parsed.searchParams.has('igu')) {
        parsed.searchParams.set('igu', '1');
        iframeSrc = parsed.toString();
      }
      return {
        url: cleanDisplay,
        displayUrl: cleanDisplay,
        iframeSrc,
        title: 'Google',
        isTunneled: false,
        remoteHost: '',
        remotePort: 0,
        subPath: '',
        isPublicHttps: true,
      };
    }

    return {
      url: cleanDisplay,
      displayUrl: cleanDisplay,
      iframeSrc: formatted,
      title: `${parsed.host}${parsed.pathname !== '/' ? parsed.pathname : ''}`,
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath: '',
      isPublicHttps: parsed.protocol === 'https:',
    };
  } catch {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    return {
      url: searchUrl,
      displayUrl: searchUrl,
      iframeSrc: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}&igu=1`,
      title: `${trimmed} - Search`,
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath: '',
      isPublicHttps: true,
    };
  }
}

export default function BrowserApp() {
  const { connections, activeConnectionId } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);
  const serverHost = activeServer ? `${activeServer.username}@${activeServer.host}` : 'remote-server';

  // Server bookmark path computation (~/.sshdesktop/browser_bookmarks.json)
  const username = activeServer?.username || 'sharuk';
  const userHome = username === 'root' ? '/root' : `/home/${username}`;
  const bookmarksFilePath = `${userHome}/.sshdesktop/browser_bookmarks.json`;
  const legacyBookmarksFilePath = `${userHome}/.clouddesk/browser_bookmarks.json`;

  const { 
    bookmarks, setBookmarks, addBookmark, removeBookmark, 
    history, addHistoryItem,
    showBookmarksBar, setShowBookmarksBar,
    zoomLevel, setZoomLevel,
  } = useBrowserStore();

  // Tabs state - Start with clean New Tab
  const initialMode = activeConnectionId ? 'server' : 'user';
  const [tabs, setTabs] = useState<BrowserTab[]>([
    {
      id: 'tab-1',
      url: '',
      displayUrl: '',
      iframeSrc: '',
      title: 'New Tab',
      isLoading: false,
      headers: {},
      networkMode: initialMode,
      userBrowserMode: 'external',
      routingMode: initialMode === 'server' ? 'tunnel' : 'direct',
      history: [],
      historyIndex: -1,
      isTunneled: false,
      devToolsOpen: false,
      activeDevToolsPanel: 'network',
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');
  const [urlInput, setUrlInput] = useState('');
  const [tunnelStatusText, setTunnelStatusText] = useState<string | null>(null);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

  // Sync url input with active tab displayUrl
  useEffect(() => {
    if (activeTab) {
      setUrlInput(activeTab.displayUrl || activeTab.url || '');
    }
  }, [activeTab?.id, activeTab?.displayUrl, activeTab?.url]);

  // Load server bookmarks from ~/.sshdesktop/browser_bookmarks.json (fallback ~/.clouddesk)
  useEffect(() => {
    if (!activeConnectionId) return;

    let isSubscribed = true;
    const hydrateServerBookmarks = async () => {
      try {
        let fileContent = await sftpReadTextFile(activeConnectionId, bookmarksFilePath).catch(() => '');
        if (!fileContent) {
          fileContent = await sftpReadTextFile(activeConnectionId, legacyBookmarksFilePath).catch(() => '');
        }
        if (fileContent && fileContent.trim() && isSubscribed) {
          try {
            const parsed = JSON.parse(fileContent);
            if (Array.isArray(parsed)) {
              setBookmarks(parsed);
            }
          } catch (jsonErr) {
            console.warn('[SSH Desktop Browser] Failed to parse bookmarks JSON:', jsonErr);
          }
        }
      } catch {
        // Ensure ~/.sshdesktop folder exists
        try {
          await sftpMkdir(activeConnectionId, `${userHome}/.sshdesktop`).catch(() => {});
        } catch {}
      }
    };

    hydrateServerBookmarks();
    return () => {
      isSubscribed = false;
    };
  }, [activeConnectionId, bookmarksFilePath, legacyBookmarksFilePath, userHome, setBookmarks]);

  // Helper to persist bookmarks to server file ~/.sshdesktop/browser_bookmarks.json
  const persistBookmarksToServer = useCallback(async (updatedBookmarks: BrowserBookmark[]) => {
    if (!activeConnectionId) return;
    try {
      await sftpMkdir(activeConnectionId, `${userHome}/.sshdesktop`).catch(() => {});
      await sftpWriteTextFile(
        activeConnectionId,
        bookmarksFilePath,
        JSON.stringify(updatedBookmarks, null, 2)
      );
    } catch (err) {
      console.warn('[SSH Desktop Browser] Failed to save bookmarks to server:', err);
    }
  }, [activeConnectionId, bookmarksFilePath, userHome]);

  // Navigate to URL respecting networkMode (SSH: ON Server Network vs SSH: OFF User Network)
  const navigateUrl = async (
    targetInput: string, 
    tabIdOverride?: string, 
    networkModeOverride?: 'server' | 'user'
  ) => {
    const currentTabId = tabIdOverride || activeTabId;
    const currentTab = tabs.find(t => t.id === currentTabId) || activeTab;
    const effectiveNetworkMode = networkModeOverride || currentTab.networkMode || 'server';

    if (!targetInput.trim() || targetInput.trim() === 'about:newtab') {
      // Reset to Start Page
      setTabs(prev => prev.map(t => {
        if (t.id !== currentTabId) return t;
        return {
          ...t,
          url: '',
          displayUrl: '',
          iframeSrc: '',
          title: 'New Tab',
          isLoading: false,
          error: null,
          isTunneled: false,
          tunnelPort: undefined,
          userBrowserMode: 'external',
        };
      }));
      if (currentTabId === activeTabId) {
        setUrlInput('');
      }
      return;
    }

    const resolved = resolveNavigationTarget(targetInput, effectiveNetworkMode);

    // Update active tab loading state & history
    setTabs(prev => prev.map(t => {
      if (t.id !== currentTabId) return t;
      const newHistory = t.history.slice(0, t.historyIndex + 1);
      newHistory.push(resolved.displayUrl);
      return {
        ...t,
        url: resolved.url,
        displayUrl: resolved.displayUrl,
        title: resolved.title,
        isLoading: true,
        error: null,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        networkMode: effectiveNetworkMode,
        routingMode: effectiveNetworkMode === 'server' ? 'tunnel' : 'direct',
      };
    }));

    if (currentTabId === activeTabId) {
      setUrlInput(resolved.displayUrl);
    }

    // -------------------------------------------------------------
    // Branch 1: Server Network Mode (SSH: ON) - Carefully Managed
    // -------------------------------------------------------------
    if (effectiveNetworkMode === 'server') {
      if (resolved.isPublicHttps) {
        // Public HTTPS sites require TLS & reject raw TCP port-forwarding in iframes
        setTabs(prev => prev.map(t => {
          if (t.id !== currentTabId) return t;
          return {
            ...t,
            isLoading: false,
            error: `Public HTTPS website (${resolved.displayUrl}) cannot be tunneled via raw TCP in an embedded window. Click "Open in PC Browser" or toggle to "SSH: OFF" for full redirect, login, and browser feature support.`,
            isTunneled: false,
            tunnelPort: undefined,
          };
        }));
        return;
      }

      if (resolved.isTunneled) {
        if (!activeConnectionId) {
          setTabs(prev => prev.map(t => {
            if (t.id !== currentTabId) return t;
            return {
              ...t,
              isLoading: false,
              error: `Not connected to an SSH server. Server Network mode requires an active SSH connection to reach remote port ${resolved.remotePort} on ${serverHost}. Toggle to "SSH: OFF" to use your PC browser, or connect to a server in SSH Desktop.`,
              isTunneled: false,
            };
          }));
          return;
        }

        setTunnelStatusText(`Establishing SSH Tunnel to ${resolved.remoteHost}:${resolved.remotePort}...`);

        try {
          // Starts tunnel with dynamic unprivileged port (>= 1024)
          const boundPort = await sshStartTunnel(
            activeConnectionId,
            0,
            resolved.remoteHost || '127.0.0.1',
            resolved.remotePort
          );

          if (boundPort && boundPort > 0) {
            const tunnelIframeSrc = `http://127.0.0.1:${boundPort}${resolved.subPath}`;
            setTunnelStatusText(`SSH Tunnel active on 127.0.0.1:${boundPort}`);

            setTabs(prev => prev.map(t => {
              if (t.id !== currentTabId) return t;
              return {
                ...t,
                title: `${resolved.displayUrl.replace(/^https?:\/\//, '')} (Tunnel)`,
                iframeSrc: tunnelIframeSrc,
                tunnelPort: boundPort,
                isTunneled: true,
                isLoading: false,
                statusCode: 200,
                statusText: 'SSH Tunnel Active',
                serverHost,
                error: null,
              };
            }));

            addHistoryItem({
              url: resolved.displayUrl,
              title: `${resolved.displayUrl.replace(/^https?:\/\//, '')} (Tunnel)`,
              statusCode: 200,
              serverHost,
            });
          } else {
            throw new Error(`Tunnel initialization failed. Remote port ${resolved.remotePort} might not be listening on server.`);
          }
        } catch (err: any) {
          const errMsg = String(err?.message || err);
          setTabs(prev => prev.map(t => {
            if (t.id !== currentTabId) return t;
            return {
              ...t,
              isLoading: false,
              statusCode: 502,
              statusText: 'SSH Tunnel Failed',
              error: `Failed to open SSH Tunnel to port ${resolved.remotePort} on ${serverHost}: ${errMsg}`,
              isTunneled: false,
              tunnelPort: undefined,
            };
          }));
        }
      }
    } 
    // -------------------------------------------------------------
    // Branch 2: User Network Mode (SSH: OFF) - PC Browser Mode
    // All redirects, logins, and web features work natively on PC!
    // -------------------------------------------------------------
    else {
      setTunnelStatusText(null);

      // Automatically launch in user's default PC desktop browser so all redirects and features work seamlessly
      openExternalUrl(resolved.displayUrl || resolved.url);

      setTabs(prev => prev.map(t => {
        if (t.id !== currentTabId) return t;
        return {
          ...t,
          title: resolved.title,
          iframeSrc: resolved.iframeSrc,
          isTunneled: false,
          tunnelPort: undefined,
          userBrowserMode: 'external',
          isLoading: false,
          statusCode: 200,
          statusText: 'PC Browser (Direct)',
          error: null,
        };
      }));

      addHistoryItem({
        url: resolved.displayUrl,
        title: resolved.title,
        statusCode: 200,
        serverHost: 'PC Browser',
      });
    }
  };

  // Toggle SSH Network mode (Server Network vs User Network) on specific tab
  const handleToggleNetworkMode = async (tabId: string) => {
    const currentTab = tabs.find(t => t.id === tabId);
    if (!currentTab) return;
    const newMode: 'server' | 'user' = currentTab.networkMode === 'server' ? 'user' : 'server';

    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      return {
        ...t,
        networkMode: newMode,
        routingMode: newMode === 'server' ? 'tunnel' : 'direct',
        userBrowserMode: newMode === 'user' ? 'external' : t.userBrowserMode,
      };
    }));

    // If tab currently has an address loaded, re-navigate using the newly selected network mode
    if (currentTab.displayUrl || currentTab.url) {
      await navigateUrl(currentTab.displayUrl || currentTab.url, tabId, newMode);
    }
  };

  // Add new tab with clean Start Page (Shows what user types, NO forced Google)
  const handleAddNewTab = () => {
    const newId = `tab-${Date.now()}`;
    const defaultMode: 'server' | 'user' = activeConnectionId ? 'server' : 'user';
    const newTab: BrowserTab = {
      id: newId,
      url: '',
      displayUrl: '',
      iframeSrc: '',
      title: 'New Tab',
      isLoading: false,
      headers: {},
      networkMode: defaultMode,
      userBrowserMode: 'external',
      routingMode: defaultMode === 'server' ? 'tunnel' : 'direct',
      history: [],
      historyIndex: -1,
      isTunneled: false,
      devToolsOpen: false,
      activeDevToolsPanel: 'network',
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
    setUrlInput('');
  };

  const handleCloseTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) return;
    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      setActiveTabId(remaining[remaining.length - 1].id);
    }
  };

  const handleGoBack = () => {
    if (activeTab.historyIndex > 0) {
      const prevUrl = activeTab.history[activeTab.historyIndex - 1];
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, historyIndex: t.historyIndex - 1 } : t));
      navigateUrl(prevUrl);
    }
  };

  const handleGoForward = () => {
    if (activeTab.historyIndex < activeTab.history.length - 1) {
      const nextUrl = activeTab.history[activeTab.historyIndex + 1];
      setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, historyIndex: t.historyIndex + 1 } : t));
      navigateUrl(nextUrl);
    }
  };

  // Bookmark toggling and auto-saving to server ~/.sshdesktop/browser_bookmarks.json
  const isCurrentBookmarked = bookmarks.some(
    b => (activeTab.displayUrl && b.url === activeTab.displayUrl) || (activeTab.url && b.url === activeTab.url)
  );

  const handleToggleBookmark = () => {
    if (!activeTab.displayUrl && !activeTab.url) return;
    let nextList: BrowserBookmark[];
    if (isCurrentBookmarked) {
      nextList = bookmarks.filter(
        b => b.url !== activeTab.displayUrl && b.url !== activeTab.url
      );
      const target = bookmarks.find(
        b => b.url === activeTab.displayUrl || b.url === activeTab.url
      );
      if (target) removeBookmark(target.id);
    } else {
      const newBm: BrowserBookmark = {
        id: `bm-${Date.now()}`,
        title: activeTab.title || activeTab.displayUrl,
        url: activeTab.displayUrl || activeTab.url,
        tag: activeTab.isTunneled ? 'dev' : 'public',
        icon: activeTab.isTunneled ? 'server' : 'globe',
      };
      nextList = [newBm, ...bookmarks];
      addBookmark(newBm);
    }
    persistBookmarksToServer(nextList);
  };

  const handleRemoveBookmark = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextList = bookmarks.filter(b => b.id !== id);
    removeBookmark(id);
    persistBookmarksToServer(nextList);
  };

  // Inspect panel switching per-tab
  const handlePanelChange = (panel: DevToolsPanel) => {
    setTabs(prev => prev.map(t => 
      t.id === activeTabId ? { ...t, activeDevToolsPanel: panel } : t
    ));
  };

  // Toggle Inspect panel on active tab
  const handleToggleDevTools = () => {
    setTabs(prev => prev.map(t => 
      t.id === activeTabId ? { ...t, devToolsOpen: !t.devToolsOpen } : t
    ));
  };

  // Listen for global Ctrl+R or F5 dispatched to active browser app
  useEffect(() => {
    const handleReloadEvent = () => {
      if (activeTab && (activeTab.displayUrl || activeTab.url)) {
        navigateUrl(activeTab.displayUrl || activeTab.url);
      }
    };
    window.addEventListener('sshdesktop:browser-reload', handleReloadEvent);
    return () => window.removeEventListener('sshdesktop:browser-reload', handleReloadEvent);
  }, [activeTab, navigateUrl]);

  return (
    <div 
      className="flex flex-col h-full w-full bg-[#1e1e2e] text-[#cdd6f4] select-none overflow-hidden font-sans browser-app"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R') || e.key === 'F5') {
          e.preventDefault();
          e.stopPropagation();
          if (activeTab && (activeTab.displayUrl || activeTab.url)) {
            navigateUrl(activeTab.displayUrl || activeTab.url);
          }
        }
      }}
    >
      {/* Top Tabs Bar */}
      <div className="flex items-center justify-between px-2 pt-1.5 bg-[#181825] border-b border-white/[0.08] shrink-0">
        <div className="flex items-center space-x-1 overflow-x-auto no-scrollbar">
          {tabs.map(tab => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-t-xl text-xs transition-all cursor-pointer group max-w-[210px] border-t border-x ${
                  isActive
                    ? 'bg-[#1e1e2e] text-white border-white/10 font-medium shadow-sm'
                    : 'bg-[#11111b] text-gray-400 hover:text-gray-200 border-transparent hover:bg-white/5'
                }`}
              >
                {tab.isLoading ? (
                  <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : tab.networkMode === 'server' ? (
                  <span title="Server Network (SSH: ON)">
                    <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  </span>
                ) : (
                  <span title="User Network (SSH: OFF - PC Browser)">
                    <Globe className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-gray-500'}`} />
                  </span>
                )}
                <span className="truncate text-xs">{tab.title || tab.displayUrl || 'New Tab'}</span>
                {tabs.length > 1 && (
                  <button
                    onClick={(e) => handleCloseTab(tab.id, e)}
                    className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 rounded transition-opacity"
                    title="Close tab"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          <button
            onClick={handleAddNewTab}
            className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
            title="New Tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Navigation Omnibox Toolbar */}
      <div className="flex items-center space-x-2 px-3 py-2 bg-[#1e1e2e] border-b border-white/[0.08] shrink-0">
        {/* Navigation Buttons */}
        <div className="flex items-center space-x-1 text-gray-400">
          <button
            onClick={handleGoBack}
            disabled={activeTab.historyIndex <= 0}
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title="Go Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleGoForward}
            disabled={activeTab.historyIndex >= activeTab.history.length - 1}
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            title="Go Forward"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigateUrl(activeTab.displayUrl || activeTab.url)}
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white cursor-pointer transition-colors"
            title="Reload"
          >
            <RotateCw className={`w-4 h-4 ${activeTab.isLoading ? 'animate-spin text-blue-400' : ''}`} />
          </button>
          <button
            onClick={() => navigateUrl('')}
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white cursor-pointer transition-colors"
            title="Home (Start Page)"
          >
            <Home className="w-4 h-4" />
          </button>
        </div>

        {/* Every Tab Network Toggle: SSH ON (Server Network) vs SSH OFF (User Network) */}
        <button
          type="button"
          onClick={() => handleToggleNetworkMode(activeTab.id)}
          className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer shadow-sm shrink-0 ${
            activeTab.networkMode === 'server'
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
              : 'bg-blue-500/15 border-blue-500/40 text-blue-300 hover:bg-blue-500/25'
          }`}
          title={
            activeTab.networkMode === 'server'
              ? 'Server Network (SSH: ON): Tunneled through remote SSH host. Click to switch to User Network (SSH: OFF).'
              : 'User Network (SSH: OFF): Native PC browser mode with all redirects, logins & features active. Click to switch to Server Network (SSH: ON).'
          }
        >
          {activeTab.networkMode === 'server' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <Server className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-bold">SSH: ON</span>
              <span className="text-[10px] text-emerald-400/90 font-mono hidden md:inline">(Server)</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-blue-400" />
              <Laptop className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-bold">SSH: OFF</span>
              <span className="text-[10px] text-blue-300/90 font-mono hidden md:inline">(PC Browser)</span>
            </>
          )}
        </button>

        {/* Address Omnibox */}
        <div className="flex-1 flex items-center bg-[#11111b] border border-white/10 rounded-2xl px-3 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 shadow-inner transition-all">
          {/* Security / Tunnel Status Badge */}
          <div className="flex items-center space-x-1.5 text-xs mr-2">
            {activeTab.isTunneled ? (
              <span 
                className="flex items-center space-x-1 text-emerald-400"
                title={`SSH Port Forwarding Tunnel: 127.0.0.1:${activeTab.tunnelPort} ➔ ${serverHost}`}
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-semibold text-[10px]">Tunnel</span>
              </span>
            ) : activeTab.displayUrl?.startsWith('https://') ? (
              <span title="Secure HTTPS Connection">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
              </span>
            ) : (
              <span title="Direct PC Browser Connection">
                <Globe className="w-3.5 h-3.5 text-blue-400" />
              </span>
            )}
          </div>

          {/* URL Input Bar - Displays EXACTLY what user typed */}
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                navigateUrl(urlInput);
              }
            }}
            placeholder="Type a URL or server address (e.g. localhost:8080, 192.168.74.43:3000, google.com)..."
            className="flex-1 bg-transparent border-none text-xs text-white font-mono focus:outline-none placeholder-gray-500 select-all"
          />

          {/* Active Tunnel Port Badge */}
          {activeTab.isTunneled && activeTab.tunnelPort && (
            <div className="flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-mono text-emerald-300 mr-2 shrink-0">
              <Radio className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
              <span>:{activeTab.tunnelPort} ➔ remote</span>
            </div>
          )}

          {/* Bookmark Star Button */}
          {Boolean(activeTab.displayUrl || activeTab.url) && (
            <button
              onClick={handleToggleBookmark}
              className={`p-1 rounded-lg ml-1 transition-colors cursor-pointer ${
                isCurrentBookmarked ? 'text-amber-400' : 'text-gray-400 hover:text-white'
              }`}
              title={
                isCurrentBookmarked
                  ? `Remove Bookmark (synced with ${userHome}/.sshdesktop)`
                  : `Bookmark to ${userHome}/.sshdesktop`
              }
            >
              <Star className={`w-3.5 h-3.5 ${isCurrentBookmarked ? 'fill-amber-400' : ''}`} />
            </button>
          )}

          {/* Open in Desktop PC Browser (Chrome/Edge/Firefox) */}
          {Boolean(activeTab.displayUrl || activeTab.url) && (
            <button
              onClick={() => openExternalUrl(activeTab.displayUrl || activeTab.url)}
              className="p-1 rounded-lg ml-1 text-gray-400 hover:text-blue-300 hover:bg-white/10 transition-colors cursor-pointer flex items-center space-x-1"
              title="Open in your PC Browser (Chrome/Edge/Firefox) - all redirects, logins, and web features work"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* View Mode Toggle when SSH is OFF and URL is active */}
        {activeTab.networkMode === 'user' && Boolean(activeTab.displayUrl || activeTab.url) && (
          <button
            onClick={() => {
              setTabs(prev => prev.map(t => 
                t.id === activeTab.id 
                  ? { ...t, userBrowserMode: t.userBrowserMode === 'embedded' ? 'external' : 'embedded' } 
                  : t
              ));
            }}
            className="px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 shrink-0 cursor-pointer flex items-center space-x-1.5"
            title="Toggle between PC Browser Hub and Embedded Frame"
          >
            {activeTab.userBrowserMode === 'embedded' ? (
              <>
                <Laptop className="w-3.5 h-3.5 text-blue-400" />
                <span className="hidden sm:inline">PC Mode</span>
              </>
            ) : (
              <>
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Frame Mode</span>
              </>
            )}
          </button>
        )}

        {/* Inspect / DevTools Toggle (Per Tab Isolation) */}
        <button
          onClick={handleToggleDevTools}
          className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs transition-colors cursor-pointer border ${
            activeTab.devToolsOpen 
              ? 'bg-blue-600/30 text-blue-300 border-blue-500/40 shadow-sm' 
              : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border-white/10'
          }`}
          title="Inspect Network, Headers & SSH Tunnel State (Per-Tab Isolated)"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Inspect</span>
        </button>
      </div>

      {/* Bookmarks Bar - Synced to ~/.sshdesktop/browser_bookmarks.json */}
      {showBookmarksBar && bookmarks.length > 0 && (
        <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-[#181825]/90 border-b border-white/[0.06] overflow-x-auto no-scrollbar shrink-0 text-xs">
          <div className="flex items-center space-x-1 text-gray-500 mr-1 shrink-0 text-[10px] uppercase font-semibold">
            <BookmarkIcon className="w-3 h-3 text-amber-400/80" />
            <span>Server:</span>
          </div>

          {bookmarks.map(bm => (
            <div
              key={bm.id}
              onClick={() => navigateUrl(bm.url)}
              className="group flex items-center space-x-1.5 px-2.5 py-1 rounded-xl bg-white/5 hover:bg-white/10 hover:text-white text-gray-300 border border-white/5 text-[11px] transition-colors cursor-pointer shrink-0"
              title={`Open ${bm.url}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${bm.tag === 'dev' ? 'bg-emerald-400' : 'bg-blue-400'}`} />
              <span className="truncate max-w-[140px]">{bm.title}</span>
              <button
                onClick={(e) => handleRemoveBookmark(bm.id, e)}
                className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 rounded transition-opacity"
                title="Remove bookmark from server"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Discovered Server Web Services Bar (1-Click SSH Tunnel) */}
      {activeConnectionId && (
        <DiscoveredServicesBar
          connId={activeConnectionId}
          onSelectService={(target) => navigateUrl(target)}
        />
      )}

      {/* Main Page Viewport - Keeps tabs mounted in DOM */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-[#1e1e2e]">
        {/* Loading overlay bar */}
        {activeTab.isLoading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 animate-pulse z-20" />
        )}

        {/* Tab Viewports */}
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isNewTab = !tab.url || tab.url === 'about:newtab';
          const isUserPcMode = tab.networkMode === 'user' && tab.userBrowserMode !== 'embedded';

          return (
            <div
              key={tab.id}
              style={{ display: isActive ? 'block' : 'none' }}
              className="w-full h-full relative overflow-hidden bg-[#1e1e2e]"
            >
              {isNewTab ? (
                /* Clean Start / New Tab Page (NO forced Google!) */
                <BrowserStartPage
                  onNavigate={(target) => navigateUrl(target, tab.id, tab.networkMode)}
                  networkMode={tab.networkMode}
                  onToggleNetworkMode={() => handleToggleNetworkMode(tab.id)}
                  serverHost={serverHost}
                  isConnected={Boolean(activeConnectionId)}
                  bookmarks={bookmarks}
                  onSelectBookmark={(url) => navigateUrl(url, tab.id, tab.networkMode)}
                />
              ) : isUserPcMode ? (
                /* PC Browser Mode: All redirects, SSO logins, and web features work natively on PC! */
                <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-gradient-to-b from-[#181825] via-[#1e1e2e] to-[#11111b] text-center select-none overflow-y-auto">
                  <div className="max-w-lg w-full flex flex-col items-center space-y-6">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-3xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center shadow-xl">
                        <Globe className="w-8 h-8 text-blue-400" />
                      </div>
                      <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-[#11111b] border border-blue-500/30 text-blue-300">
                        <Laptop className="w-3.5 h-3.5" />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-center space-x-2">
                        <h3 className="text-lg font-bold text-white">Opened in PC Browser</h3>
                        <span className="px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/30 text-blue-300 text-[10px] font-semibold">
                          SSH: OFF
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1 max-w-md leading-relaxed">
                        Redirects, OAuth logins, Google searches, cookies, and extensions run natively in your PC desktop browser without iframe restrictions.
                      </p>
                    </div>

                    {/* URL Card */}
                    <div className="w-full bg-[#11111b] border border-white/10 rounded-2xl p-3 flex items-center justify-between text-left shadow-lg">
                      <div className="min-w-0 flex-1 mr-3">
                        <div className="text-[10px] uppercase font-semibold text-gray-500 flex items-center space-x-1">
                          <Compass className="w-3 h-3 text-blue-400" />
                          <span>Destination URL</span>
                        </div>
                        <div className="text-xs text-blue-300 font-mono truncate select-all">{tab.displayUrl || tab.url}</div>
                      </div>
                      <button
                        onClick={() => openExternalUrl(tab.displayUrl || tab.url)}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center space-x-1.5 shrink-0"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open in PC</span>
                      </button>
                    </div>

                    {/* Controls & Options */}
                    <div className="flex items-center space-x-3 text-xs">
                      <button
                        onClick={() => {
                          setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, userBrowserMode: 'embedded' } : t));
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-colors cursor-pointer flex items-center space-x-1.5"
                        title="Try viewing in embedded window"
                      >
                        <Layers className="w-3.5 h-3.5 text-amber-400" />
                        <span>Try Embedded Frame</span>
                      </button>
                      <button
                        onClick={() => navigateUrl('', tab.id)}
                        className="px-3.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white transition-colors cursor-pointer"
                      >
                        Start Page
                      </button>
                    </div>

                    <div className="text-[11px] text-gray-500 max-w-sm pt-2">
                      💡 <strong>Tip:</strong> Need to access a service on the remote server (e.g. <code className="text-gray-300">localhost:8080</code>)? Toggle <span className="text-emerald-400 font-semibold">SSH: ON</span> above.
                    </div>
                  </div>
                </div>
              ) : tab.error ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#1e1e2e] text-center select-none overflow-y-auto">
                  <div className="p-4 rounded-3xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mb-4 shadow-xl">
                    <AlertCircle className="w-12 h-12" />
                  </div>
                  <h3 className="text-base font-bold text-white mb-1">
                    {tab.isTunneled ? 'Unable to reach destination via SSH Tunnel' : 'Website Refused to Connect in Embedded Window'}
                  </h3>
                  <p className="text-xs text-gray-400 max-w-md mb-4 font-mono">
                    {tab.error}
                  </p>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => openExternalUrl(tab.displayUrl || tab.url)}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center space-x-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open in PC Browser (Redirects Supported)</span>
                    </button>
                    {tab.networkMode === 'server' && (
                      <button
                        onClick={() => handleToggleNetworkMode(tab.id)}
                        className="px-4 py-2 rounded-xl bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 text-xs font-semibold border border-emerald-500/30 transition-colors cursor-pointer"
                      >
                        Switch to SSH: OFF
                      </button>
                    )}
                    <button
                      onClick={() => navigateUrl('', tab.id)}
                      className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold border border-white/10 transition-colors cursor-pointer"
                    >
                      Return to Start Page
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-6 max-w-sm">
                    Notice: Public websites like Google, GitHub, Wikipedia, and banking sites send security headers (X-Frame-Options) that prevent embedding. Click "Open in PC Browser" where all redirects and features work seamlessly.
                  </p>
                </div>
              ) : (
                <div className="w-full h-full relative">
                  {/* Floating Open in PC Browser Pill when in embedded frame */}
                  {tab.networkMode === 'user' && (
                    <div className="absolute top-2 right-2 z-10">
                      <button
                        onClick={() => openExternalUrl(tab.displayUrl || tab.url)}
                        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-[#181825]/90 hover:bg-[#11111b] border border-white/15 text-blue-300 hover:text-white text-xs font-medium shadow-2xl backdrop-blur-md transition-all cursor-pointer"
                        title="Open in your PC Browser (all redirects and features work)"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
                        <span>Open in PC Browser</span>
                      </button>
                    </div>
                  )}

                  <iframe
                    src={tab.iframeSrc || tab.url}
                    sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals allow-top-navigation-by-user-activation"
                    className="w-full h-full border-none bg-white"
                    style={{ 
                      transform: `scale(${zoomLevel / 100})`, 
                      transformOrigin: 'top left', 
                      width: `${100 * (100 / zoomLevel)}%`, 
                      height: `${100 * (100 / zoomLevel)}%` 
                    }}
                    title={tab.title}
                    onLoad={() => {
                      setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, isLoading: false } : t));
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Developer Tools / Inspector Drawer (Per Tab Isolation) */}
      {activeTab.devToolsOpen && (
        <BrowserDevTools
          key={activeTab.id}
          activeTab={activeTab}
          activePanel={activeTab.activeDevToolsPanel || 'network'}
          onPanelChange={handlePanelChange}
          onClose={() => {
            setTabs(prev => prev.map(t => 
              t.id === activeTab.id ? { ...t, devToolsOpen: false } : t
            ));
          }}
        />
      )}

      {/* Bottom Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[#11111b] border-t border-white/[0.08] text-[11px] font-mono text-gray-400 shrink-0">
        <div className="flex items-center space-x-3">
          {activeTab.networkMode === 'server' ? (
            activeTab.isTunneled ? (
              <span className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>SSH Port Tunnel: 127.0.0.1:{activeTab.tunnelPort} ➔ remote:{activeTab.url.split(':')[2]?.split('/')[0] || 'app'}</span>
              </span>
            ) : (
              <span className="flex items-center space-x-1 text-emerald-400/90 font-semibold">
                <Server className="w-3 h-3 text-emerald-400" />
                <span>Server Network (SSH: ON): {activeTab.displayUrl || 'Start Page'}</span>
              </span>
            )
          ) : (
            <span className="flex items-center space-x-1 text-blue-400 font-semibold">
              <Globe className="w-3 h-3 text-blue-400" />
              <span>User Network (SSH: OFF) ➔ PC Browser Mode (All Redirects & Features Active)</span>
            </span>
          )}

          {/* Open in PC Browser link */}
          {Boolean(activeTab.displayUrl || activeTab.url) && (
            <button
              onClick={() => openExternalUrl(activeTab.displayUrl || activeTab.url)}
              className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 transition-colors cursor-pointer ml-1"
              title="Open current page in your PC desktop browser (Chrome/Edge)"
            >
              <ExternalLink className="w-3 h-3" />
              <span>Open in PC Browser</span>
            </button>
          )}

          <span className="hidden md:inline text-gray-500">
            Server: <strong className="text-gray-300">{serverHost}</strong>
          </span>

          <span className="hidden sm:inline text-gray-500">
            Bookmarks: <strong className="text-amber-400">{bookmarksFilePath}</strong>
          </span>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setZoomLevel(zoomLevel - 10)}
            className="p-0.5 hover:text-white cursor-pointer"
            title="Zoom Out"
          >
            <ZoomOut className="w-3 h-3" />
          </button>
          <span className="w-10 text-center">{zoomLevel}%</span>
          <button
            onClick={() => setZoomLevel(zoomLevel + 10)}
            className="p-0.5 hover:text-white cursor-pointer"
            title="Zoom In"
          >
            <ZoomIn className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
