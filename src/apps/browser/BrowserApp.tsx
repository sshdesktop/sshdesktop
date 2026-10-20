import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Globe, ArrowLeft, ArrowRight, RotateCw, Home, Lock, 
  ShieldCheck, Star, Plus, X, Search, Activity, Terminal, 
  Layers, Code2, Server, ExternalLink, ZoomIn, ZoomOut,
  AlertCircle, Check, Sparkles, ChevronDown, Radio, Bookmark as BookmarkIcon
} from 'lucide-react';
import { BrowserTab, BrowserRoutingMode, BrowserBookmark } from './types';
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
}

/**
 * Resolves user typed text into logical URL, display URL, and iframe destination
 */
function resolveNavigationTarget(input: string): ResolvedTarget {
  const trimmed = input.trim();

  // 1. Default to Google if empty
  if (!trimmed || trimmed === 'google.com' || trimmed === 'https://www.google.com' || trimmed === 'http://www.google.com') {
    return {
      url: GOOGLE_HOME,
      displayUrl: GOOGLE_HOME,
      iframeSrc: GOOGLE_EMBED_HOME,
      title: 'Google',
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath: '',
    };
  }

  // 2. Check if this is a Google search query (multiple words, or no dots, and no protocol/port)
  const hasProtocol = /^[a-zA-Z]+:\/\//.test(trimmed);
  const isLocalHost = /^localhost(:\d+)?(\/.*)?$/i.test(trimmed) || 
                      /^127\.0\.0\.1(:\d+)?(\/.*)?$/.test(trimmed) || 
                      /^0\.0\.0\.0(:\d+)?(\/.*)?$/.test(trimmed);
  const hasDot = trimmed.includes('.');
  const hasSpace = /\s/.test(trimmed);

  if (!hasProtocol && !isLocalHost && (hasSpace || !hasDot)) {
    return {
      url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
      displayUrl: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
      iframeSrc: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}&igu=1`,
      title: `${trimmed} - Google Search`,
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath: '',
    };
  }

  // 3. Format URL with protocol if missing
  let formatted = trimmed;
  if (!hasProtocol) {
    formatted = isLocalHost ? `http://${trimmed}` : `https://${trimmed}`;
  }

  try {
    const parsed = new URL(formatted);
    const hostname = parsed.hostname.toLowerCase();
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    const subPath = (parsed.pathname || '/') + (parsed.search || '') + (parsed.hash || '');

    // Check if target is a server port requiring SSH tunnel (localhost or specific port)
    if (isLocal || (parsed.port && parsed.port !== '80' && parsed.port !== '443')) {
      const port = parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80);
      const targetHost = isLocal ? '127.0.0.1' : hostname;
      const cleanDisplay = `http://${hostname}${parsed.port ? `:${parsed.port}` : ''}${subPath}`;

      return {
        url: cleanDisplay,
        displayUrl: cleanDisplay,
        iframeSrc: '', // Will be assigned the tunneled 127.0.0.1:localPort upon tunnel startup
        title: `${hostname}:${port}`,
        isTunneled: true,
        remoteHost: targetHost,
        remotePort: port,
        subPath,
      };
    }

    // Google domain handler with igu=1 for iframe embedding
    if (hostname.includes('google.com')) {
      let iframeSrc = formatted;
      let displayUrl = formatted;
      if (parsed.pathname === '/' || parsed.pathname === '' || parsed.pathname === '/webhp') {
        iframeSrc = GOOGLE_EMBED_HOME;
        displayUrl = GOOGLE_HOME;
      } else if (!parsed.searchParams.has('igu')) {
        parsed.searchParams.set('igu', '1');
        iframeSrc = parsed.toString();
        parsed.searchParams.delete('igu');
        displayUrl = parsed.toString();
      }
      return {
        url: displayUrl,
        displayUrl,
        iframeSrc,
        title: 'Google',
        isTunneled: false,
        remoteHost: '',
        remotePort: 0,
        subPath: '',
      };
    }

    // Standard public web page
    return {
      url: formatted,
      displayUrl: formatted,
      iframeSrc: formatted,
      title: hostname,
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath: '',
    };
  } catch {
    // Fallback search
    return {
      url: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
      displayUrl: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`,
      iframeSrc: `https://www.google.com/search?q=${encodeURIComponent(trimmed)}&igu=1`,
      title: `${trimmed} - Google Search`,
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath: '',
    };
  }
}

export default function BrowserApp() {
  const { connections, activeConnectionId } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);
  const serverHost = activeServer ? `${activeServer.username}@${activeServer.host}` : 'remote-server';

  // Server bookmark path computation (~/.clouddesk/browser_bookmarks.json)
  const username = activeServer?.username || 'sharuk';
  const userHome = username === 'root' ? '/root' : `/home/${username}`;
  const bookmarksFilePath = `${userHome}/.clouddesk/browser_bookmarks.json`;

  const { 
    bookmarks, setBookmarks, addBookmark, removeBookmark, 
    history, addHistoryItem,
    showBookmarksBar, setShowBookmarksBar,
    showDevTools, setShowDevTools,
    zoomLevel, setZoomLevel,
  } = useBrowserStore();

  // Tabs state - Initial tab opens Google.com
  const [tabs, setTabs] = useState<BrowserTab[]>([
    {
      id: 'tab-1',
      url: GOOGLE_HOME,
      displayUrl: GOOGLE_HOME,
      iframeSrc: GOOGLE_EMBED_HOME,
      title: 'Google',
      isLoading: false,
      headers: {},
      routingMode: 'tunnel',
      history: [GOOGLE_HOME],
      historyIndex: 0,
      isTunneled: false,
    }
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');
  const [urlInput, setUrlInput] = useState(GOOGLE_HOME);
  const [tunnelStatusText, setTunnelStatusText] = useState<string | null>(null);

  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Sync url input with active tab displayUrl
  useEffect(() => {
    if (activeTab) {
      setUrlInput(activeTab.displayUrl || activeTab.url);
    }
  }, [activeTab?.id, activeTab?.displayUrl, activeTab?.url]);

  // Load server bookmarks from /home/sharuk/.clouddesk/browser_bookmarks.json
  useEffect(() => {
    if (!activeConnectionId) return;

    let isSubscribed = true;
    const hydrateServerBookmarks = async () => {
      try {
        const fileContent = await sftpReadTextFile(activeConnectionId, bookmarksFilePath);
        if (fileContent && fileContent.trim() && isSubscribed) {
          try {
            const parsed = JSON.parse(fileContent);
            if (Array.isArray(parsed)) {
              setBookmarks(parsed);
            }
          } catch (jsonErr) {
            console.warn('[CloudDesk Browser] Failed to parse bookmarks JSON:', jsonErr);
          }
        }
      } catch {
        // File does not exist yet on server; ensure ~/.clouddesk folder exists
        try {
          await sftpMkdir(activeConnectionId, `${userHome}/.clouddesk`).catch(() => {});
        } catch {}
      }
    };

    hydrateServerBookmarks();
    return () => {
      isSubscribed = false;
    };
  }, [activeConnectionId, bookmarksFilePath, userHome, setBookmarks]);

  // Helper to persist bookmarks to server file ~/.clouddesk/browser_bookmarks.json
  const persistBookmarksToServer = useCallback(async (updatedBookmarks: BrowserBookmark[]) => {
    if (!activeConnectionId) return;
    try {
      await sftpMkdir(activeConnectionId, `${userHome}/.clouddesk`).catch(() => {});
      await sftpWriteTextFile(
        activeConnectionId,
        bookmarksFilePath,
        JSON.stringify(updatedBookmarks, null, 2)
      );
    } catch (err) {
      console.warn('[CloudDesk Browser] Failed to save bookmarks to server:', err);
    }
  }, [activeConnectionId, bookmarksFilePath, userHome]);

  // Navigate to URL with SSH Port Forwarding Tunnel
  const navigateUrl = async (targetInput: string) => {
    if (!targetInput.trim()) return;

    const resolved = resolveNavigationTarget(targetInput);

    // Update active tab loading state
    setTabs(prev => prev.map(t => {
      if (t.id !== activeTabId) return t;
      const newHistory = t.history.slice(0, t.historyIndex + 1);
      newHistory.push(resolved.displayUrl);
      return {
        ...t,
        url: resolved.url,
        displayUrl: resolved.displayUrl,
        isLoading: true,
        error: null,
        history: newHistory,
        historyIndex: newHistory.length - 1,
      };
    }));

    if (resolved.isTunneled) {
      // ---------------------------------------------------------
      // Real SSH Local Port Forwarding Tunnel (Zero cURL commands!)
      // ---------------------------------------------------------
      if (!activeConnectionId) {
        setTabs(prev => prev.map(t => {
          if (t.id !== activeTabId) return t;
          return {
            ...t,
            isLoading: false,
            error: `Not connected to an SSH server. Please connect to a server first to access remote port ${resolved.remotePort}.`,
            isTunneled: false,
          };
        }));
        return;
      }

      setTunnelStatusText(`Establishing SSH Tunnel to ${resolved.remoteHost}:${resolved.remotePort}...`);

      try {
        const boundPort = await sshStartTunnel(
          activeConnectionId,
          resolved.remotePort,
          resolved.remoteHost || '127.0.0.1',
          resolved.remotePort
        );

        if (boundPort && boundPort > 0) {
          const tunnelIframeSrc = `http://127.0.0.1:${boundPort}${resolved.subPath}`;
          setTunnelStatusText(`SSH Tunnel active on 127.0.0.1:${boundPort}`);

          setTabs(prev => prev.map(t => {
            if (t.id !== activeTabId) return t;
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
          if (t.id !== activeTabId) return t;
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
    } else {
      // Direct Web Access (Google Search / Public URLs)
      setTunnelStatusText(null);
      setTabs(prev => prev.map(t => {
        if (t.id !== activeTabId) return t;
        return {
          ...t,
          title: resolved.title,
          iframeSrc: resolved.iframeSrc,
          isTunneled: false,
          tunnelPort: undefined,
          isLoading: false,
          statusCode: 200,
          statusText: 'Web Direct',
          error: null,
        };
      }));

      addHistoryItem({
        url: resolved.displayUrl,
        title: resolved.title,
        statusCode: 200,
        serverHost: 'Direct',
      });
    }
  };

  // Add new tab with Home page (google.com)
  const handleAddNewTab = () => {
    const newId = `tab-${Date.now()}`;
    const newTab: BrowserTab = {
      id: newId,
      url: GOOGLE_HOME,
      displayUrl: GOOGLE_HOME,
      iframeSrc: GOOGLE_EMBED_HOME,
      title: 'Google',
      isLoading: false,
      headers: {},
      routingMode: 'tunnel',
      history: [GOOGLE_HOME],
      historyIndex: 0,
      isTunneled: false,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
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

  // Bookmark toggling and auto-saving to server ~/.clouddesk/browser_bookmarks.json
  const isCurrentBookmarked = bookmarks.some(
    b => b.url === activeTab.displayUrl || b.url === activeTab.url
  );

  const handleToggleBookmark = () => {
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
        url: activeTab.displayUrl,
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

  // Listen for global Ctrl+R or F5 dispatched to active browser app
  useEffect(() => {
    const handleReloadEvent = () => {
      if (activeTab) {
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
          if (activeTab) {
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
                ) : tab.isTunneled ? (
                  <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                ) : (
                  <Globe className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-gray-500'}`} />
                )}
                <span className="truncate text-xs">{tab.title || tab.displayUrl || 'Google'}</span>
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
            title="New Tab (Google)"
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
            onClick={() => navigateUrl(GOOGLE_HOME)}
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white cursor-pointer transition-colors"
            title="Home (Google.com)"
          >
            <Home className="w-4 h-4" />
          </button>
        </div>

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
                <span className="font-semibold text-[10px]">SSH Tunnel</span>
              </span>
            ) : activeTab.displayUrl?.startsWith('https://') ? (
              <span title="Secure HTTPS Connection">
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
              </span>
            ) : (
              <span title="Google / Web Gateway">
                <Globe className="w-3.5 h-3.5 text-blue-400" />
              </span>
            )}
          </div>

          {/* URL Input Bar */}
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                navigateUrl(urlInput);
              }
            }}
            placeholder="Search Google or type a server address (e.g. localhost:8080, 127.0.0.1:3000)..."
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
          <button
            onClick={handleToggleBookmark}
            className={`p-1 rounded-lg ml-1 transition-colors cursor-pointer ${
              isCurrentBookmarked ? 'text-amber-400' : 'text-gray-400 hover:text-white'
            }`}
            title={
              isCurrentBookmarked
                ? 'Remove Bookmark (synced with /home/sharuk/.clouddesk)'
                : 'Bookmark to /home/sharuk/.clouddesk'
            }
          >
            <Star className={`w-3.5 h-3.5 ${isCurrentBookmarked ? 'fill-amber-400' : ''}`} />
          </button>

          {/* Open in Desktop Browser (Chrome/Edge) */}
          <button
            onClick={() => openExternalUrl(activeTab.displayUrl || activeTab.url)}
            className="p-1 rounded-lg ml-1 text-gray-400 hover:text-blue-300 hover:bg-white/10 transition-colors cursor-pointer"
            title="Open in Desktop Browser (Chrome/Edge/Firefox)"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Inspect / DevTools Toggle */}
        <button
          onClick={() => setShowDevTools(!showDevTools)}
          className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs transition-colors cursor-pointer border ${
            showDevTools 
              ? 'bg-blue-600/30 text-blue-300 border-blue-500/40' 
              : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border-white/10'
          }`}
          title="Inspect Network, Headers & SSH Tunnel State"
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>Inspect</span>
        </button>
      </div>

      {/* Bookmarks Bar - Synced to /home/sharuk/.clouddesk/browser_bookmarks.json */}
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

      {/* Main Page Viewport - Keeps all tab iframes mounted in DOM so switching tabs never restarts or loses state */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-white">
        {/* Loading overlay bar */}
        {activeTab.isLoading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 animate-pulse z-20" />
        )}

        {/* Tab Viewports */}
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              style={{ display: isActive ? 'block' : 'none' }}
              className="w-full h-full relative overflow-hidden bg-white"
            >
              {tab.error ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#1e1e2e] text-center select-none">
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
                      <span>Open in Desktop Browser</span>
                    </button>
                    <button
                      onClick={() => navigateUrl(GOOGLE_HOME)}
                      className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold border border-white/10 transition-colors cursor-pointer"
                    >
                      Return to Google
                    </button>
                  </div>
                  {!tab.isTunneled && (
                    <p className="text-[11px] text-gray-500 mt-6 max-w-sm">
                      Notice: Public websites like GitHub, Wikipedia, Reddit, and banking sites send security headers (X-Frame-Options) that prevent embedding inside applications. Click "Open in Desktop Browser" to view them directly without restrictions.
                    </p>
                  )}
                </div>
              ) : (
                <iframe
                  src={tab.iframeSrc || tab.url}
                  sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
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
              )}
            </div>
          );
        })}
      </div>

      {/* Developer Tools / Inspector Drawer */}
      {showDevTools && (
        <BrowserDevTools
          activeTab={activeTab}
          onClose={() => setShowDevTools(false)}
        />
      )}

      {/* Bottom Status Bar */}
      <div className="flex items-center justify-between px-3 py-1 bg-[#11111b] border-t border-white/[0.08] text-[11px] font-mono text-gray-400 shrink-0">
        <div className="flex items-center space-x-3">
          {activeTab.isTunneled ? (
            <span className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>SSH Port Tunnel: 127.0.0.1:{activeTab.tunnelPort} ➔ remote:{activeTab.url.split(':')[2]?.split('/')[0] || 'app'}</span>
            </span>
          ) : (
            <span className="flex items-center space-x-1 text-gray-400">
              <Globe className="w-3 h-3 text-blue-400" />
              <span>Direct Web: {activeTab.displayUrl}</span>
            </span>
          )}

          {/* Open in Desktop Browser link */}
          <button
            onClick={() => openExternalUrl(activeTab.displayUrl || activeTab.url)}
            className="flex items-center space-x-1 text-blue-400 hover:text-blue-300 transition-colors cursor-pointer ml-1"
            title="Open current page in your desktop Chrome/Edge browser"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Open in Desktop Browser</span>
          </button>

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
