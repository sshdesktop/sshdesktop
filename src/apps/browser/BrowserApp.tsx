import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Globe, ArrowLeft, ArrowRight, RotateCw, Home, Lock, 
  ShieldCheck, Star, Plus, X, Search, Activity, Terminal, 
  Layers, Code2, Server, ExternalLink, ZoomIn, ZoomOut,
  AlertCircle, Check, Sparkles, ChevronDown, Radio, Bookmark as BookmarkIcon,
  Laptop, Compass, Copy, ArrowUpRight, Zap, RefreshCw, FileText
} from 'lucide-react';
import { BrowserTab, BrowserRoutingMode, BrowserBookmark, DevToolsPanel } from './types';
import { useBrowserStore } from './browserStore';
import { useConnectionStore } from '../../lib/store';
import { 
  sftpReadTextFile, 
  sftpWriteTextFile, 
  sftpMkdir,
  openExternalUrl
} from '../../lib/tauri-bridge';
import DiscoveredServicesBar from './components/DiscoveredServicesBar';
import BrowserDevTools from './components/BrowserDevTools';
import BrowserStartPage from './components/BrowserStartPage';
import { 
  fetchViaSshGateway, 
  prepareHtmlForSandbox, 
  normalizeTargetUrl 
} from './utils/sshHttpGateway';

function extractTitleFromHtml(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Extracts and formats YouTube URLs to official embed players
 */
function extractYouTubeEmbedInfo(input: string): { isYouTube: boolean; embedSrc: string; displayUrl: string; title: string } {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  const isYtDomain = lower.includes('youtube.com') || lower.includes('youtu.be');
  if (!isYtDomain) {
    return { isYouTube: false, embedSrc: '', displayUrl: '', title: '' };
  }

  const urlToParse = /^[a-zA-Z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(urlToParse);
    const host = parsed.hostname.toLowerCase();
    const subPath = (parsed.pathname || '/') + (parsed.search || '') + (parsed.hash || '');
    const cleanDisplay = `${parsed.protocol}//${parsed.host}${subPath}`;

    if (parsed.pathname.startsWith('/shorts/')) {
      const id = parsed.pathname.split('/shorts/')[1]?.split('/')[0]?.split('?')[0];
      if (id) {
        return {
          isYouTube: true,
          embedSrc: `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1`,
          displayUrl: cleanDisplay,
          title: 'YouTube Short',
        };
      }
    }

    if (parsed.searchParams.has('v')) {
      const id = parsed.searchParams.get('v');
      if (id) {
        return {
          isYouTube: true,
          embedSrc: `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1`,
          displayUrl: cleanDisplay,
          title: 'YouTube Video',
        };
      }
    }

    if (host.includes('youtu.be')) {
      const id = parsed.pathname.replace(/^\//, '').split('?')[0];
      if (id) {
        return {
          isYouTube: true,
          embedSrc: `https://www.youtube.com/embed/${id}?autoplay=1&enablejsapi=1`,
          displayUrl: cleanDisplay,
          title: 'YouTube Video',
        };
      }
    }

    if (parsed.pathname === '/playlist' && parsed.searchParams.has('list')) {
      const listId = parsed.searchParams.get('list');
      return {
        isYouTube: true,
        embedSrc: `https://www.youtube.com/embed/videoseries?list=${listId}`,
        displayUrl: cleanDisplay,
        title: 'YouTube Playlist',
      };
    }

    if (parsed.pathname.startsWith('/embed/')) {
      return {
        isYouTube: true,
        embedSrc: parsed.toString(),
        displayUrl: cleanDisplay,
        title: 'YouTube',
      };
    }

    return {
      isYouTube: true,
      embedSrc: 'https://www.youtube.com/embed?listType=search&list=trending',
      displayUrl: cleanDisplay,
      title: 'YouTube',
    };
  } catch {
    return {
      isYouTube: true,
      embedSrc: 'https://www.youtube.com/embed?listType=search&list=trending',
      displayUrl: 'https://www.youtube.com',
      title: 'YouTube',
    };
  }
}

/**
 * Extracts and formats Google URLs to interactive embed pages with igu=1
 */
function extractGoogleEmbedInfo(input: string): { isGoogle: boolean; embedSrc: string; displayUrl: string; title: string } {
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  const isGoogleDomain = lower.includes('google.');
  if (!isGoogleDomain) {
    return { isGoogle: false, embedSrc: '', displayUrl: '', title: '' };
  }

  const urlToParse = /^[a-zA-Z]+:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(urlToParse);
    const subPath = (parsed.pathname || '/') + (parsed.search || '') + (parsed.hash || '');
    const cleanDisplay = `${parsed.protocol}//${parsed.host}${subPath}`;

    parsed.searchParams.set('igu', '1');

    if (parsed.pathname === '/' || parsed.pathname === '' || parsed.pathname === '/webhp') {
      return {
        isGoogle: true,
        embedSrc: 'https://www.google.com/webhp?igu=1',
        displayUrl: cleanDisplay,
        title: 'Google',
      };
    }

    const query = parsed.searchParams.get('q');
    return {
      isGoogle: true,
      embedSrc: parsed.toString(),
      displayUrl: cleanDisplay,
      title: query ? `${query} - Google Search` : 'Google',
    };
  } catch {
    return {
      isGoogle: true,
      embedSrc: 'https://www.google.com/webhp?igu=1',
      displayUrl: 'https://www.google.com',
      title: 'Google',
    };
  }
}

export default function BrowserApp() {
  const { connections, activeConnectionId } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);
  const serverHost = activeServer ? `${activeServer.username}@${activeServer.host}` : 'remote-server';

  // Server bookmark path computation (~/.sshdesktop/browser_bookmarks.json)
  const username = activeServer?.username || 'root';
  const userHome = username === 'root' ? '/root' : `/home/${username}`;
  const bookmarksFilePath = `${userHome}/.sshdesktop/browser_bookmarks.json`;
  const legacyBookmarksFilePath = `${userHome}/.clouddesk/browser_bookmarks.json`;

  const { 
    bookmarks, setBookmarks, addBookmark, removeBookmark, 
    history, addHistoryItem,
    showBookmarksBar, setShowBookmarksBar,
    zoomLevel, setZoomLevel,
  } = useBrowserStore();

  // Tabs state - Start with clean New Tab in Server Network mode if connected
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
      userBrowserMode: 'embedded',
      routingMode: initialMode === 'server' ? 'ssh-gateway' : 'direct',
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

  // Load server bookmarks from ~/.sshdesktop/browser_bookmarks.json
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

  /**
   * Primary navigation function.
   * When networkMode is 'server' (SSH: ON):
   * Routes ANY public URL or private IP through the connected SSH server via fetchViaSshGateway.
   * The SSH server executes the request directly on its network interface and returns the response.
   */
  const navigateUrl = useCallback(async (
    targetInput: string, 
    tabIdOverride?: string, 
    networkModeOverride?: 'server' | 'user',
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: string
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
          htmlContent: undefined,
          jsonContent: undefined,
          textContent: undefined,
          statusCode: undefined,
          statusText: undefined,
          headers: {},
          latencyMs: undefined,
          bytesReceived: undefined,
          executedCommand: undefined,
          userBrowserMode: 'embedded',
        };
      }));
      if (currentTabId === activeTabId) {
        setUrlInput('');
      }
      return;
    }

    const resolvedUrl = normalizeTargetUrl(targetInput);

    // Update active tab loading state & history
    setTabs(prev => prev.map(t => {
      if (t.id !== currentTabId) return t;
      const newHistory = t.history.slice(0, t.historyIndex + 1);
      if (newHistory[newHistory.length - 1] !== resolvedUrl) {
        newHistory.push(resolvedUrl);
      }
      return {
        ...t,
        url: resolvedUrl,
        displayUrl: resolvedUrl,
        title: resolvedUrl,
        isLoading: true,
        error: null,
        history: newHistory,
        historyIndex: newHistory.length - 1,
        networkMode: effectiveNetworkMode,
        routingMode: effectiveNetworkMode === 'server' ? 'ssh-gateway' : 'direct',
        userBrowserMode: 'embedded',
      };
    }));

    if (currentTabId === activeTabId) {
      setUrlInput(resolvedUrl);
    }

    // -------------------------------------------------------------
    // Branch 1: Server Network Mode (SSH: ON)
    // Sends request through the remote SSH server to reach public URLs and IPs
    // -------------------------------------------------------------
    if (effectiveNetworkMode === 'server') {
      if (!activeConnectionId) {
        setTabs(prev => prev.map(t => {
          if (t.id !== currentTabId) return t;
          return {
            ...t,
            isLoading: false,
            statusCode: 503,
            statusText: 'No Server Connection',
            error: `Not connected to an SSH server. Server Network mode (SSH: ON) sends all requests through your remote Linux server. Please connect to a server in SSH Desktop, or toggle to "SSH: OFF" to browse directly from your PC.`,
            isTunneled: false,
          };
        }));
        return;
      }

      setTunnelStatusText(`Sending request to ${resolvedUrl} via SSH server...`);

      try {
        const response = await fetchViaSshGateway(
          activeConnectionId,
          resolvedUrl,
          method,
          {},
          body
        );

        let preparedHtml: string | undefined = undefined;
        let parsedJson: any = undefined;
        let textBody: string | undefined = undefined;
        let pageTitle = resolvedUrl;

        if (response.isHtml) {
          preparedHtml = prepareHtmlForSandbox(response.body, resolvedUrl);
          const extractedTitle = extractTitleFromHtml(response.body);
          if (extractedTitle) pageTitle = extractedTitle;
        } else if (response.isJson) {
          try {
            parsedJson = JSON.parse(response.body);
          } catch {
            textBody = response.body;
          }
          pageTitle = `${resolvedUrl} (JSON)`;
        } else {
          textBody = response.body;
          pageTitle = `${resolvedUrl} (${response.contentType || 'Text'})`;
        }

        setTabs(prev => prev.map(t => {
          if (t.id !== currentTabId) return t;
          return {
            ...t,
            url: resolvedUrl,
            displayUrl: resolvedUrl,
            title: pageTitle,
            isLoading: false,
            statusCode: response.statusCode,
            statusText: response.statusText,
            contentType: response.contentType,
            headers: response.headers,
            latencyMs: response.latencyMs,
            bytesReceived: response.bytesReceived,
            executedCommand: response.executedCommand,
            htmlContent: preparedHtml,
            jsonContent: parsedJson,
            textContent: textBody,
            routingMode: 'ssh-gateway',
            error: null,
          };
        }));

        setTunnelStatusText(`Reached ${resolvedUrl} via SSH (${response.statusCode} ${response.statusText} • ${response.latencyMs}ms)`);

        addHistoryItem({
          url: resolvedUrl,
          title: pageTitle,
          statusCode: response.statusCode,
          serverHost: serverHost,
        });
      } catch (err: any) {
        const errMsg = String(err?.message || err);
        setTabs(prev => prev.map(t => {
          if (t.id !== currentTabId) return t;
          return {
            ...t,
            isLoading: false,
            statusCode: 502,
            statusText: 'SSH Gateway Error',
            error: `Failed to reach ${resolvedUrl} via SSH server: ${errMsg}`,
            htmlContent: undefined,
            jsonContent: undefined,
            textContent: undefined,
          };
        }));
      }
    } else {
      // -------------------------------------------------------------
      // Branch 2: User Network Mode (SSH: OFF) - Direct Local PC
      // -------------------------------------------------------------
      let iframeDestination = resolvedUrl;
      const ytInfo = extractYouTubeEmbedInfo(resolvedUrl);
      const gInfo = extractGoogleEmbedInfo(resolvedUrl);
      if (ytInfo.isYouTube) iframeDestination = ytInfo.embedSrc;
      else if (gInfo.isGoogle) iframeDestination = gInfo.embedSrc;

      setTabs(prev => prev.map(t => {
        if (t.id !== currentTabId) return t;
        return {
          ...t,
          url: resolvedUrl,
          displayUrl: resolvedUrl,
          iframeSrc: iframeDestination,
          title: resolvedUrl,
          isLoading: false,
          statusCode: 200,
          statusText: 'PC Direct',
          error: null,
          htmlContent: undefined,
          jsonContent: undefined,
          textContent: undefined,
        };
      }));

      addHistoryItem({
        url: resolvedUrl,
        title: resolvedUrl,
        statusCode: 200,
        serverHost: 'PC Network',
      });
    }
  }, [activeTabId, tabs, activeTab, activeConnectionId, serverHost, addHistoryItem]);

  // Listen for iframe navigation events (link clicks, form submissions) to route through SSH server
  useEffect(() => {
    const handleIframeMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'sshdesktop-browser-navigate' && event.data.url) {
        navigateUrl(event.data.url);
      } else if (event.data.type === 'sshdesktop-browser-submit' && event.data.url) {
        navigateUrl(event.data.url, undefined, undefined, event.data.method || 'GET', event.data.body);
      }
    };
    window.addEventListener('message', handleIframeMessage);
    return () => window.removeEventListener('message', handleIframeMessage);
  }, [navigateUrl]);

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
        routingMode: newMode === 'server' ? 'ssh-gateway' : 'direct',
      };
    }));

    if (currentTab.displayUrl || currentTab.url) {
      await navigateUrl(currentTab.displayUrl || currentTab.url, tabId, newMode);
    }
  };

  // Add new tab with clean Start Page
  const handleAddNewTab = () => {
    const newId = `tab-${Date.now()}`;
    const defaultMode: 'server' | 'user' = activeTab ? activeTab.networkMode : (activeConnectionId ? 'server' : 'user');
    const newTab: BrowserTab = {
      id: newId,
      url: '',
      displayUrl: '',
      iframeSrc: '',
      title: 'New Tab',
      isLoading: false,
      headers: {},
      networkMode: defaultMode,
      userBrowserMode: 'embedded',
      routingMode: defaultMode === 'server' ? 'ssh-gateway' : 'direct',
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
      const nextTab = remaining[remaining.length - 1];
      setActiveTabId(nextTab.id);
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
        tag: activeTab.networkMode === 'server' ? 'dev' : 'public',
        icon: activeTab.networkMode === 'server' ? 'server' : 'globe',
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
                className={`flex items-center space-x-2 px-3 py-1.5 rounded-t-xl text-xs transition-all cursor-pointer group max-w-[220px] border-t border-x ${
                  isActive
                    ? 'bg-[#1e1e2e] text-white border-white/10 font-medium shadow-sm'
                    : 'bg-[#11111b] text-gray-400 hover:text-gray-200 border-transparent hover:bg-white/5'
                }`}
              >
                {tab.isLoading ? (
                  <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleNetworkMode(tab.id);
                    }}
                    className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-90 ${
                      tab.networkMode === 'server' ? 'text-emerald-400' : 'text-blue-400'
                    }`}
                    title={tab.networkMode === 'server' ? 'SSH Server Network' : 'PC Direct Network'}
                  >
                    {tab.networkMode === 'server' ? (
                      <Server className="w-3 h-3" />
                    ) : (
                      <Globe className="w-3 h-3" />
                    )}
                  </button>
                )}

                <span className="truncate flex-1 font-medium">{tab.title || tab.displayUrl || 'New Tab'}</span>

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
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
            title="New Tab"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Navigation Toolbar & Omnibox */}
      <div className="flex items-center space-x-2 px-3 py-2 bg-[#181825] border-b border-white/[0.08] shrink-0">
        <div className="flex items-center space-x-1 text-gray-400">
          <button
            onClick={handleGoBack}
            disabled={activeTab.historyIndex <= 0}
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 cursor-pointer transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleGoForward}
            disabled={activeTab.historyIndex >= activeTab.history.length - 1}
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400 cursor-pointer transition-colors"
            title="Forward"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              if (activeTab.displayUrl || activeTab.url) {
                navigateUrl(activeTab.displayUrl || activeTab.url);
              }
            }}
            className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white cursor-pointer transition-colors"
            title="Reload (Ctrl+R / F5)"
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
              ? 'SSH: ON (Server Network): All requests sent to remote SSH server to reach public URLs and private IPs. Click to switch to PC Network.'
              : 'SSH: OFF (PC Network): Direct local PC browsing. Click to route via SSH server.'
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
              <span className="text-[10px] text-blue-300/90 font-mono hidden md:inline">(PC Direct)</span>
            </>
          )}
        </button>

        {/* Address Omnibox */}
        <div className="flex-1 flex items-center bg-[#11111b] border border-white/10 rounded-2xl px-3 py-1.5 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20 shadow-inner transition-all">
          {/* Security / Server Status Badge */}
          <div className="flex items-center space-x-1.5 text-xs mr-2">
            {activeTab.networkMode === 'server' ? (
              <span 
                className="flex items-center space-x-1 text-emerald-400"
                title={`Routing through SSH Server: ${serverHost}`}
              >
                <Server className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold text-[10px] hidden sm:inline">SSH Server</span>
              </span>
            ) : activeTab.displayUrl?.startsWith('https://') ? (
              <span title="Direct PC HTTPS Connection">
                <Lock className="w-3.5 h-3.5 text-blue-400" />
              </span>
            ) : (
              <span title="Direct PC HTTP Connection">
                <Globe className="w-3.5 h-3.5 text-gray-400" />
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
            placeholder="Type any public URL or IP (e.g. google.com, 192.168.1.1, 10.0.0.1, localhost:8080)..."
            className="flex-1 bg-transparent border-none text-xs text-white font-mono focus:outline-none placeholder-gray-500 select-all"
          />

          {/* HTTP Status Code Badge (when SSH: ON) */}
          {activeTab.networkMode === 'server' && activeTab.statusCode && (
            <div 
              className={`flex items-center space-x-1 px-2 py-0.5 rounded-lg text-[10px] font-mono mr-1.5 shrink-0 border ${
                activeTab.statusCode >= 200 && activeTab.statusCode < 300
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
                  : activeTab.statusCode >= 300 && activeTab.statusCode < 400
                  ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                  : activeTab.statusCode >= 400 && activeTab.statusCode < 500
                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
                  : 'bg-rose-500/15 border-rose-500/30 text-rose-300'
              }`}
              title={`HTTP Response Status: ${activeTab.statusCode} ${activeTab.statusText || ''}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${
                activeTab.statusCode >= 200 && activeTab.statusCode < 300 ? 'bg-emerald-400' : 'bg-amber-400'
              }`} />
              <span>{activeTab.statusCode} {activeTab.statusText || 'OK'}</span>
            </div>
          )}

          {/* Latency Badge (when SSH: ON) */}
          {activeTab.networkMode === 'server' && activeTab.latencyMs !== undefined && (
            <div 
              className="flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-blue-500/10 border border-blue-500/30 text-[10px] font-mono text-blue-300 mr-1.5 shrink-0"
              title={`Roundtrip latency through SSH server: ${activeTab.latencyMs}ms`}
            >
              <Zap className="w-2.5 h-2.5 text-blue-400" />
              <span>{activeTab.latencyMs}ms</span>
            </div>
          )}

          {/* Data Received Badge */}
          {activeTab.networkMode === 'server' && activeTab.bytesReceived && (
            <div 
              className="hidden lg:flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-[10px] font-mono text-gray-300 mr-1.5 shrink-0"
              title={`Data received: ${formatBytes(activeTab.bytesReceived)}`}
            >
              <span>{formatBytes(activeTab.bytesReceived)}</span>
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

          {/* Open in Desktop PC Browser */}
          {Boolean(activeTab.displayUrl || activeTab.url) && (
            <button
              onClick={() => openExternalUrl(activeTab.displayUrl || activeTab.url)}
              className="p-1 rounded-lg ml-1 text-gray-400 hover:text-blue-300 hover:bg-white/10 transition-colors cursor-pointer flex items-center space-x-1"
              title="Open in your default external PC browser (Chrome/Edge/Firefox)"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Inspect / DevTools Toggle */}
        <button
          onClick={handleToggleDevTools}
          className={`flex items-center space-x-1 px-2.5 py-1.5 rounded-xl text-xs transition-colors cursor-pointer border ${
            activeTab.devToolsOpen 
              ? 'bg-blue-600/30 text-blue-300 border-blue-500/40 shadow-sm' 
              : 'bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white border-white/10'
          }`}
          title="Inspect Network, Headers & SSH Response (DevTools)"
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

      {/* Discovered Server Web Services Bar */}
      {activeConnectionId && (
        <DiscoveredServicesBar
          connId={activeConnectionId}
          onSelectService={(target) => navigateUrl(target)}
        />
      )}

      {/* Main Page Viewport - Active Tab Content */}
      <div className="flex-1 w-full h-full relative overflow-hidden bg-[#1e1e2e]">
        {/* Loading overlay bar */}
        {activeTab.isLoading && (
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-blue-500 animate-pulse z-20" />
        )}

        {/* Tab Viewports */}
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const isNewTab = !tab.url || tab.url === 'about:newtab';

          return (
            <div
              key={tab.id}
              style={{ display: isActive ? 'flex' : 'none' }}
              className="w-full h-full relative flex-col overflow-hidden bg-[#1e1e2e]"
            >
              {isNewTab ? (
                /* Clean Start Page */
                <BrowserStartPage
                  onNavigate={(target) => navigateUrl(target, tab.id, tab.networkMode)}
                  onLaunchNative={(url) => navigateUrl(url || 'https://google.com', tab.id, tab.networkMode)}
                  networkMode={tab.networkMode}
                  onToggleNetworkMode={() => handleToggleNetworkMode(tab.id)}
                  serverHost={serverHost}
                  isConnected={Boolean(activeConnectionId)}
                  bookmarks={bookmarks}
                  onSelectBookmark={(url) => navigateUrl(url, tab.id, tab.networkMode)}
                />
              ) : tab.error ? (
                /* Connection / Gateway Error Screen */
                <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#1e1e2e] text-center select-none overflow-y-auto">
                  <div className="p-4 rounded-3xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mb-4 shadow-xl">
                    <AlertCircle className="w-12 h-12" />
                  </div>
                  <h3 className="text-base font-bold text-white mb-1">
                    {tab.networkMode === 'server' ? 'Unable to reach destination via SSH Server' : 'Connection Notice'}
                  </h3>
                  <p className="text-xs text-gray-400 max-w-md mb-4 font-mono leading-relaxed">
                    {tab.error}
                  </p>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => navigateUrl(tab.displayUrl || tab.url, tab.id)}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center space-x-1.5"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Retry Request</span>
                    </button>
                    <button
                      onClick={() => openExternalUrl(tab.displayUrl || tab.url)}
                      className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white text-xs font-semibold border border-white/10 transition-colors cursor-pointer flex items-center space-x-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open in PC Browser</span>
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
                </div>
              ) : tab.networkMode === 'server' ? (
                /* Server Network (SSH: ON): Webpage / JSON / Text rendered through SSH Gateway */
                <div className="w-full h-full flex flex-col relative overflow-hidden bg-[#1e1e2e]">
                  {tab.jsonContent !== undefined ? (
                    <div className="w-full h-full flex flex-col p-4 bg-[#11111b] text-gray-200 overflow-auto font-mono text-xs select-text">
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 shrink-0">
                        <span className="text-cyan-400 font-semibold flex items-center space-x-1.5">
                          <Code2 className="w-4 h-4" />
                          <span>JSON Response ({formatBytes(tab.bytesReceived)})</span>
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(JSON.stringify(tab.jsonContent, null, 2));
                          }}
                          className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 flex items-center space-x-1 cursor-pointer transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy JSON</span>
                        </button>
                      </div>
                      <pre className="flex-1 overflow-auto leading-relaxed text-emerald-300">
                        {JSON.stringify(tab.jsonContent, null, 2)}
                      </pre>
                    </div>
                  ) : tab.textContent !== undefined ? (
                    <div className="w-full h-full flex flex-col p-4 bg-[#11111b] text-gray-200 overflow-auto font-mono text-xs select-text">
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/10 shrink-0">
                        <span className="text-cyan-400 font-semibold flex items-center space-x-1.5">
                          <FileText className="w-4 h-4" />
                          <span>Response ({tab.contentType || 'Text'} • {formatBytes(tab.bytesReceived)})</span>
                        </span>
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(tab.textContent || '');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 flex items-center space-x-1 cursor-pointer transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Text</span>
                        </button>
                      </div>
                      <pre className="flex-1 overflow-auto leading-relaxed text-gray-200 whitespace-pre-wrap">
                        {tab.textContent}
                      </pre>
                    </div>
                  ) : tab.htmlContent ? (
                    <iframe
                      srcDoc={tab.htmlContent}
                      sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                      allowFullScreen={true}
                      className="w-full h-full border-none bg-white"
                      style={{
                        transform: `scale(${zoomLevel / 100})`,
                        transformOrigin: 'top left',
                        width: `${100 * (100 / zoomLevel)}%`,
                        height: `${100 * (100 / zoomLevel)}%`
                      }}
                      title={tab.title}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#1e1e2e] text-center select-none">
                      <div className="w-10 h-10 border-3 border-emerald-400 border-t-transparent rounded-full animate-spin mb-3" />
                      <h4 className="text-sm font-semibold text-white mb-1">Connecting via SSH Server...</h4>
                      <p className="text-xs text-gray-400 font-mono max-w-sm">
                        Routing request to {tab.displayUrl || tab.url} through {serverHost}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                /* User Network (SSH: OFF): PC Direct Browser Iframe */
                <div className="w-full h-full flex flex-col relative overflow-hidden bg-[#1e1e2e]">
                  <iframe
                    src={tab.iframeSrc || tab.url}
                    sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
                    allowFullScreen={true}
                    className="w-full h-full border-none bg-white"
                    style={{
                      transform: `scale(${zoomLevel / 100})`,
                      transformOrigin: 'top left',
                      width: `${100 * (100 / zoomLevel)}%`,
                      height: `${100 * (100 / zoomLevel)}%`
                    }}
                    title={tab.title}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Developer Tools / Inspector Drawer */}
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
            <span className="flex items-center space-x-1.5 text-emerald-400 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <Server className="w-3 h-3 text-emerald-400" />
              <span>SSH Server Network Active</span>
              {activeTab.latencyMs !== undefined && (
                <span className="text-[10px] text-blue-300 font-mono ml-1.5 border-l border-white/10 pl-2">
                  {activeTab.latencyMs}ms
                </span>
              )}
              {activeTab.statusCode && (
                <span className="text-[10px] text-emerald-300 font-mono ml-1.5 border-l border-white/10 pl-2">
                  HTTP {activeTab.statusCode} {activeTab.statusText || 'OK'}
                </span>
              )}
              {activeTab.bytesReceived && (
                <span className="text-[10px] text-gray-400 font-mono ml-1.5 border-l border-white/10 pl-2 hidden sm:inline">
                  {formatBytes(activeTab.bytesReceived)}
                </span>
              )}
            </span>
          ) : (
            <span className="flex items-center space-x-1 text-blue-400 font-semibold">
              <Globe className="w-3 h-3 text-blue-400" />
              <span>User Network (SSH: OFF) ➔ Local PC Direct</span>
            </span>
          )}

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
            SSH Host: <strong className="text-gray-300">{serverHost}</strong>
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
