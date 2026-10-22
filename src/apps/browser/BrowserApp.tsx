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
  sshStartSocks5,
  sshStopSocks5,
  sshGetSocks5,
  sftpReadTextFile, 
  sftpWriteTextFile, 
  sftpMkdir,
  openExternalUrl,
  openBrowserWindow,
  closeBrowserWindow,
  focusBrowserWindow
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
 * Extracts and formats YouTube URLs to official embed players
 * Handles youtube.com, youtu.be, /watch?v=, /shorts/, /results?search_query=, and /playlist?list=
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

    // 1. Shorts: /shorts/<id>
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

    // 2. Watch: /watch?v=<id>
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

    // 3. Short URL: youtu.be/<id>
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

    // 4. Playlist: /playlist?list=<id>
    if (parsed.pathname === '/playlist' && parsed.searchParams.has('list')) {
      const listId = parsed.searchParams.get('list');
      return {
        isYouTube: true,
        embedSrc: `https://www.youtube.com/embed/videoseries?list=${listId}`,
        displayUrl: cleanDisplay,
        title: 'YouTube Playlist',
      };
    }

    // 5. Already an embed URL: /embed/<id>
    if (parsed.pathname.startsWith('/embed/')) {
      return {
        isYouTube: true,
        embedSrc: parsed.toString(),
        displayUrl: cleanDisplay,
        title: 'YouTube',
      };
    }

    // 6. Search query on YouTube: /results?search_query=...
    if (parsed.pathname === '/results' && parsed.searchParams.has('search_query')) {
      const q = parsed.searchParams.get('search_query') || '';
      return {
        isYouTube: true,
        embedSrc: `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(q)}&autoplay=1`,
        displayUrl: cleanDisplay,
        title: `${q} - YouTube Search`,
      };
    }

    // 7. General root or channel: youtube.com
    // Uses YouTube official embed player to render directly inside the tab without X-Frame-Options blocking
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

    // Always inject igu=1 into Google URLs so X-Frame-Options is suppressed
    parsed.searchParams.set('igu', '1');

    if (parsed.pathname === '/' || parsed.pathname === '' || parsed.pathname === '/webhp') {
      return {
        isGoogle: true,
        embedSrc: GOOGLE_EMBED_HOME,
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
      embedSrc: GOOGLE_EMBED_HOME,
      displayUrl: 'https://www.google.com',
      title: 'Google',
    };
  }
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

  // 5. Check if it's YouTube
  const ytInfo = extractYouTubeEmbedInfo(formatted);
  if (ytInfo.isYouTube) {
    return {
      url: ytInfo.displayUrl,
      displayUrl: ytInfo.displayUrl,
      iframeSrc: ytInfo.embedSrc,
      title: ytInfo.title,
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath: '',
      isPublicHttps: true,
    };
  }

  // 6. Check if it's Google
  const gInfo = extractGoogleEmbedInfo(formatted);
  if (gInfo.isGoogle) {
    return {
      url: gInfo.displayUrl,
      displayUrl: gInfo.displayUrl,
      iframeSrc: gInfo.embedSrc,
      title: gInfo.title,
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath: '',
      isPublicHttps: true,
    };
  }

  try {
    const parsed = new URL(formatted);
    const hostname = parsed.hostname.toLowerCase();
    const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    const subPath = (parsed.pathname || '/') + (parsed.search || '') + (parsed.hash || '');
    const cleanDisplay = `${parsed.protocol}//${parsed.host}${subPath}`;
    const isCustomPort = Boolean(parsed.port && parsed.port !== '80' && parsed.port !== '443');

    // If Server Network mode (SSH: ON):
    if (networkMode === 'server') {
      const isPublicHttps = !isLocal && !isIpWithPort && !isCustomPort;
      const port = parsed.port 
        ? parseInt(parsed.port, 10) 
        : (parsed.protocol === 'https:' ? 443 : 80);
      const targetHost = isLocal ? '127.0.0.1' : hostname;

      return {
        url: cleanDisplay,
        displayUrl: cleanDisplay,
        iframeSrc: isPublicHttps ? formatted : '', // Assigned after sshStartTunnel if tunneled
        title: `${parsed.host}${parsed.pathname !== '/' ? parsed.pathname : ''}`,
        isTunneled: !isPublicHttps,
        remoteHost: targetHost,
        remotePort: port,
        subPath,
        isPublicHttps,
      };
    }

    // If User Network mode (SSH: OFF): PC Direct (no tunnel)
    return {
      url: cleanDisplay,
      displayUrl: cleanDisplay,
      iframeSrc: formatted,
      title: `${parsed.host}${parsed.pathname !== '/' ? parsed.pathname : ''}`,
      isTunneled: false,
      remoteHost: '',
      remotePort: 0,
      subPath,
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
      userBrowserMode: 'embedded',
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
          userBrowserMode: 'embedded',
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
        userBrowserMode: 'embedded',
      };
    }));

    if (currentTabId === activeTabId) {
      setUrlInput(resolved.displayUrl);
    }

    // -------------------------------------------------------------
    // Universal WebviewWindow Architecture (Every Tab) - ZERO IFRAMES
    // -------------------------------------------------------------
    const windowId = `browser-tab-${currentTabId}`;
    let targetUrlToLoad = resolved.displayUrl || resolved.url;
    let proxyUrl: string | undefined = undefined;

    if (effectiveNetworkMode === 'server') {
      let currentSocks5Port: number | undefined = undefined;
      if (activeConnectionId) {
        try {
          const sPort = await sshStartSocks5(activeConnectionId);
          if (sPort && sPort > 0) {
            currentSocks5Port = sPort;
          }
        } catch (sErr) {
          console.warn('[SSH Desktop] SOCKS5 dynamic proxy launch notice:', sErr);
        }
      }

      if (resolved.isTunneled) {
        if (!activeConnectionId) {
          setTabs(prev => prev.map(t => {
            if (t.id !== currentTabId) return t;
            return {
              ...t,
              isLoading: false,
              error: `Not connected to an SSH server. Server Network mode requires an active SSH connection to reach remote port ${resolved.remotePort} on ${serverHost}. Toggle to "SSH: OFF" to use your PC network, or connect to a server in SSH Desktop.`,
              isTunneled: false,
            };
          }));
          return;
        }

        setTunnelStatusText(`Establishing SSH Tunnel to ${resolved.remoteHost}:${resolved.remotePort}...`);

        try {
          const boundPort = await sshStartTunnel(
            activeConnectionId,
            0,
            resolved.remoteHost || '127.0.0.1',
            resolved.remotePort
          );

          if (boundPort && boundPort > 0) {
            targetUrlToLoad = `http://127.0.0.1:${boundPort}${resolved.subPath}`;
            setTunnelStatusText(`SSH Tunnel active on 127.0.0.1:${boundPort}`);
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
          return;
        }
      } else {
        if (currentSocks5Port) {
          proxyUrl = `socks5://127.0.0.1:${currentSocks5Port}`;
        }
      }
    }

    // Launch or navigate WebviewWindow for this tab (bypasses all iframe restrictions & preserves origin headers)
    openBrowserWindow(
      targetUrlToLoad,
      `CloudDesk Browser - ${resolved.title} (${effectiveNetworkMode === 'server' ? 'SSH: ON SOCKS5' : 'SSH: OFF Direct'})`,
      proxyUrl,
      windowId
    ).catch(err => {
      console.warn('[SSH Desktop] openBrowserWindow failed:', err);
    });

    setTabs(prev => prev.map(t => {
      if (t.id !== currentTabId) return t;
      return {
        ...t,
        url: targetUrlToLoad,
        displayUrl: resolved.displayUrl,
        title: resolved.title,
        userBrowserMode: 'native',
        nativeWindowId: windowId,
        isLoading: false,
        statusCode: 200,
        statusText: effectiveNetworkMode === 'server' ? 'SSH: ON (WebviewWindow SOCKS5)' : 'SSH: OFF (WebviewWindow Direct)',
        error: null,
      };
    }));

    addHistoryItem({
      url: resolved.displayUrl,
      title: resolved.title,
      statusCode: 200,
      serverHost: effectiveNetworkMode === 'server' ? serverHost : 'PC Network',
    });
  };

  // Toggle SSH Network mode (Server Network vs User Network) on specific tab
  const handleToggleNetworkMode = async (tabId: string) => {
    const currentTab = tabs.find(t => t.id === tabId);
    if (!currentTab) return;
    const newMode: 'server' | 'user' = currentTab.networkMode === 'server' ? 'user' : 'server';

    let socks5Port: number | undefined = undefined;
    if (newMode === 'server' && activeConnectionId) {
      try {
        const p = await sshStartSocks5(activeConnectionId);
        if (p && p > 0) socks5Port = p;
      } catch (err) {
        console.warn('[SSH Desktop] SOCKS5 dynamic proxy launch notice:', err);
      }
    }

    setTabs(prev => prev.map(t => {
      if (t.id !== tabId) return t;
      return {
        ...t,
        networkMode: newMode,
        socks5Port: newMode === 'server' ? socks5Port : undefined,
        routingMode: newMode === 'server' ? 'tunnel' : 'direct',
      };
    }));

    // If tab currently has an address loaded, re-navigate using the newly selected network mode
    if (currentTab.displayUrl || currentTab.url) {
      await navigateUrl(currentTab.displayUrl || currentTab.url, tabId, newMode);
    }
  };

  // Switch all open tabs to SSH: OFF or SSH: ON simultaneously
  const handleSetAllTabsNetworkMode = async (mode: 'server' | 'user') => {
    let socks5Port: number | undefined = undefined;
    if (mode === 'server' && activeConnectionId) {
      try {
        const p = await sshStartSocks5(activeConnectionId);
        if (p && p > 0) socks5Port = p;
      } catch (err) {
        console.warn('[SSH Desktop] SOCKS5 dynamic proxy launch notice:', err);
      }
    }

    setTabs(prev => prev.map(t => ({
      ...t,
      networkMode: mode,
      socks5Port: mode === 'server' ? socks5Port : undefined,
      routingMode: mode === 'server' ? 'tunnel' : 'direct',
    })));
  };

  // Add new tab with clean Start Page (Shows what user types, NO forced Google)
  // Inherits active tab's network mode (so if SSH: OFF, new tab stays SSH: OFF!)
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
    closeBrowserWindow(`browser-tab-${id}`).catch(() => {});
    if (tabs.length === 1) return;
    const remaining = tabs.filter(t => t.id !== id);
    setTabs(remaining);
    if (activeTabId === id) {
      const nextTab = remaining[remaining.length - 1];
      setActiveTabId(nextTab.id);
      if (nextTab.url && nextTab.url !== 'about:newtab') {
        focusBrowserWindow(`browser-tab-${nextTab.id}`).catch(() => {});
      }
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

  // Launch dedicated native WebView2 browser window (SSH: ON with SOCKS5 or SSH: OFF direct)
  const handleLaunchNativeBrowser = async (targetUrl?: string, tabId?: string) => {
    const targetTab = (tabId ? tabs.find(t => t.id === tabId) : null) || activeTab;
    const dest = targetUrl || targetTab.displayUrl || targetTab.url || 'https://www.google.com';
    const windowId = `browser-tab-${targetTab.id}`;
    let proxyUrl: string | undefined = undefined;

    if (targetTab.networkMode === 'server') {
      let socksPort = targetTab.socks5Port;
      if (!socksPort && activeConnectionId) {
        try {
          const p = await sshStartSocks5(activeConnectionId);
          if (p && p > 0) socksPort = p;
        } catch (err) {
          console.warn('[SSH Desktop] Failed to start SOCKS5 for native browser:', err);
        }
      }
      if (socksPort) {
        proxyUrl = `socks5://127.0.0.1:${socksPort}`;
      }
    }

    try {
      await openBrowserWindow(
        dest,
        `CloudDesk Browser - ${targetTab.networkMode === 'server' ? 'SSH: ON (SOCKS5)' : 'SSH: OFF (Direct)'}`,
        proxyUrl,
        windowId
      );

      // Update target tab to native mode so viewport displays the interactive session controller
      setTabs(prev => prev.map(t => {
        if (t.id !== targetTab.id) return t;
        return {
          ...t,
          userBrowserMode: 'native',
          nativeWindowId: windowId,
          isLoading: false,
          error: null,
        };
      }));
    } catch (err) {
      console.warn('Failed to open native WebView2 window, falling back to external browser:', err);
      openExternalUrl(dest);
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
                onClick={() => {
                  setActiveTabId(tab.id);
                  if (tab.url && tab.url !== 'about:newtab') {
                    focusBrowserWindow(`browser-tab-${tab.id}`).catch(() => {});
                  }
                }}
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
                    className="p-0.5 rounded hover:bg-white/15 transition-colors cursor-pointer"
                    title={
                      tab.networkMode === 'server'
                        ? 'Server Network (SSH: ON) - Click to toggle this tab to SSH: OFF (Direct PC)'
                        : 'User Network (SSH: OFF) - Click to toggle this tab to SSH: ON (Server Network)'
                    }
                  >
                    {tab.networkMode === 'server' ? (
                      <Server className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <Globe className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-blue-400' : 'text-gray-500'}`} />
                    )}
                  </button>
                )}
                <span className="truncate text-xs flex-1">{tab.title || tab.displayUrl || 'New Tab'}</span>

                {/* Pop out to native window button on each tab */}
                {Boolean(tab.displayUrl || tab.url) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleLaunchNativeBrowser(tab.displayUrl || tab.url, tab.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 hover:text-emerald-400 p-0.5 rounded transition-opacity"
                    title={`Launch in Native WebView2 Window (${tab.networkMode === 'server' ? 'SOCKS5' : 'Direct PC'}) - zero iframe blocks, full video & logins`}
                  >
                    <Compass className="w-3 h-3 text-emerald-400" />
                  </button>
                )}

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
            title="New Tab (inherits current network mode)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Global Network Mode Switcher for All Tabs */}
        <div className="flex items-center space-x-1.5 pb-1 pr-1 shrink-0">
          <button
            type="button"
            onClick={() => handleSetAllTabsNetworkMode(activeTab.networkMode === 'server' ? 'user' : 'server')}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-xl text-[10px] font-medium border transition-colors cursor-pointer shadow-sm ${
              activeTab.networkMode === 'server'
                ? 'bg-blue-500/10 hover:bg-blue-500/20 text-blue-300 border-blue-500/30'
                : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
            }`}
            title={`Set all open tabs to ${activeTab.networkMode === 'server' ? 'SSH: OFF (Direct PC)' : 'SSH: ON (Server Network)'}`}
          >
            <Laptop className="w-3 h-3" />
            <span>Set All: {activeTab.networkMode === 'server' ? 'SSH: OFF' : 'SSH: ON'}</span>
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
              {activeTab.socks5Port ? (
                <span className="text-[10px] text-emerald-300 font-mono hidden md:inline">(:{activeTab.socks5Port})</span>
              ) : (
                <span className="text-[10px] text-emerald-400/90 font-mono hidden md:inline">(Server)</span>
              )}
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

          {/* Active SOCKS5 / Tunnel Port Badge */}
          {activeTab.networkMode === 'server' && activeTab.socks5Port && (
            <div className="flex items-center space-x-1 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-mono text-emerald-300 mr-2 shrink-0" title={`SOCKS5 Dynamic Proxy: 127.0.0.1:${activeTab.socks5Port}`}>
              <Radio className="w-2.5 h-2.5 text-emerald-400 animate-pulse" />
              <span>SOCKS5 :{activeTab.socks5Port}</span>
            </div>
          )}
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

          {/* Launch Native WebView2 Window (Fixes 'Missing Origin Header' & Enables Full Logins) */}
          {Boolean(activeTab.displayUrl || activeTab.url) && (
            <button
              onClick={() => handleLaunchNativeBrowser()}
              className="px-2 py-0.5 rounded-lg ml-1 text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-[11px] font-medium transition-colors cursor-pointer flex items-center space-x-1 shrink-0"
              title={`Open in Native Window (${activeTab.networkMode === 'server' ? 'SSH SOCKS5 Proxy' : 'Direct PC'}) - Fixes 'missing origin header', enables session cookies & logins`}
            >
              <Compass className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden md:inline">Native Window (Login)</span>
            </button>
          )}

          {/* Open in Desktop PC Browser (Chrome/Edge/Firefox) */}
          {Boolean(activeTab.displayUrl || activeTab.url) && (
            <button
              onClick={() => openExternalUrl(activeTab.displayUrl || activeTab.url)}
              className="p-1 rounded-lg ml-1 text-gray-400 hover:text-blue-300 hover:bg-white/10 transition-colors cursor-pointer flex items-center space-x-1"
              title="Open in your default external browser (Chrome/Edge/Firefox)"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

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
          const isPublicOnSSH = tab.networkMode === 'server' && !tab.isTunneled && Boolean(tab.url);

          return (
            <div
              key={tab.id}
              style={{ display: isActive ? 'flex' : 'none' }}
              className="w-full h-full relative flex-col overflow-hidden bg-[#1e1e2e]"
            >
              {isNewTab ? (
                /* Clean Start / New Tab Page (NO forced Google!) */
                <BrowserStartPage
                  onNavigate={(target) => navigateUrl(target, tab.id, tab.networkMode)}
                  onLaunchNative={handleLaunchNativeBrowser}
                  networkMode={tab.networkMode}
                  onToggleNetworkMode={() => handleToggleNetworkMode(tab.id)}
                  serverHost={serverHost}
                  isConnected={Boolean(activeConnectionId)}
                  bookmarks={bookmarks}
                  onSelectBookmark={(url) => navigateUrl(url, tab.id, tab.networkMode)}
                />
              ) : tab.error ? (
                <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-[#1e1e2e] text-center select-none overflow-y-auto">
                  <div className="p-4 rounded-3xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mb-4 shadow-xl">
                    <AlertCircle className="w-12 h-12" />
                  </div>
                  <h3 className="text-base font-bold text-white mb-1">
                    {tab.isTunneled ? 'Unable to reach destination via SSH Tunnel' : 'Connection Notice'}
                  </h3>
                  <p className="text-xs text-gray-400 max-w-md mb-4 font-mono">
                    {tab.error}
                  </p>
                  <div className="flex items-center space-x-3">
                    <button
                      onClick={() => handleLaunchNativeBrowser(tab.displayUrl || tab.url)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center space-x-1.5"
                      title="Open in dedicated Native WebView2 Window (zero iframe restrictions, full video & logins)"
                    >
                      <Compass className="w-3.5 h-3.5" />
                      <span>Open in Native WebView2</span>
                    </button>
                    <button
                      onClick={() => openExternalUrl(tab.displayUrl || tab.url)}
                      className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all cursor-pointer flex items-center space-x-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open in External Browser</span>
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
              ) : (
                /* Native WebviewWindow Session Controller - ZERO IFRAMES */
                <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-gradient-to-b from-[#181825] via-[#1e1e2e] to-[#11111b] text-center select-none overflow-y-auto">
                  <div className="relative mb-5">
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-emerald-500 via-teal-500 to-cyan-400 p-0.5 shadow-2xl shadow-emerald-500/20">
                      <div className="w-full h-full bg-[#1e1e2e] rounded-3xl flex items-center justify-center">
                        <Compass className="w-10 h-10 text-emerald-400" />
                      </div>
                    </div>
                    <div className="absolute -bottom-1 -right-1 p-1 rounded-full bg-[#11111b] border border-emerald-500/30 shadow-md">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 block animate-pulse" />
                    </div>
                  </div>

                  <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold mb-3">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>WebviewWindow Active (Zero Iframes)</span>
                    <span className="text-[10px] text-emerald-400/80 font-mono">
                      ({tab.networkMode === 'server' ? 'SSH SOCKS5 Proxy' : 'Direct PC Internet'})
                    </span>
                  </div>

                  <h2 className="text-xl font-bold text-white mb-1 max-w-lg truncate">
                    {tab.title || tab.displayUrl || 'Web Page'}
                  </h2>

                  <div className="flex items-center space-x-2 bg-white/5 border border-white/10 px-3 py-1.5 rounded-xl font-mono text-xs text-gray-300 max-w-md truncate mb-6">
                    <Globe className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="truncate">{tab.displayUrl || tab.url}</span>
                  </div>

                  {/* Highlights Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mb-6 text-left">
                    <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5">
                      <div className="text-emerald-400 font-bold text-xs mb-0.5">Top-Level Origin</div>
                      <div className="text-[11px] text-gray-400">Solves 'missing origin header' on login</div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5">
                      <div className="text-emerald-400 font-bold text-xs mb-0.5">Session Cookies</div>
                      <div className="text-[11px] text-gray-400">First-party cookies & CSRF tokens allowed</div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5">
                      <div className="text-emerald-400 font-bold text-xs mb-0.5">Zero Iframe Blocks</div>
                      <div className="text-[11px] text-gray-400">X-Frame-Options & CSP bypassed</div>
                    </div>
                    <div className="p-3 rounded-2xl bg-white/[0.03] border border-white/5">
                      <div className="text-emerald-400 font-bold text-xs mb-0.5">Direct GPU Speed</div>
                      <div className="text-[11px] text-gray-400">4K 60fps YouTube, Netflix & PC audio</div>
                    </div>
                  </div>

                  {/* Action Controls */}
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      onClick={() => {
                        focusBrowserWindow(`browser-tab-${tab.id}`).catch(() => {
                          handleLaunchNativeBrowser(tab.displayUrl || tab.url, tab.id);
                        });
                      }}
                      className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer flex items-center space-x-2"
                      title="Bring this tab's dedicated WebviewWindow to the front"
                    >
                      <Compass className="w-4 h-4" />
                      <span>Bring WebviewWindow to Front</span>
                    </button>

                    <button
                      onClick={() => handleLaunchNativeBrowser(tab.displayUrl || tab.url, tab.id)}
                      className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-semibold border border-white/10 transition-colors cursor-pointer flex items-center space-x-1.5"
                      title="Relaunch / Reload WebviewWindow"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Reload Window</span>
                    </button>

                    <button
                      onClick={() => closeBrowserWindow(`browser-tab-${tab.id}`).catch(() => {})}
                      className="px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-semibold border border-rose-500/20 transition-colors cursor-pointer flex items-center space-x-1.5"
                      title="Close this WebviewWindow"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Close Window</span>
                    </button>

                    <button
                      onClick={() => openExternalUrl(tab.displayUrl || tab.url)}
                      className="px-4 py-2.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 text-xs font-semibold border border-blue-500/30 transition-colors cursor-pointer flex items-center space-x-1.5"
                      title="Open in your default external desktop browser (Chrome/Edge)"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Open in Chrome/Edge</span>
                    </button>

                    <button
                      onClick={() => navigateUrl('', tab.id)}
                      className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white text-xs font-semibold border border-white/5 transition-colors cursor-pointer"
                    >
                      Return to Start Page
                    </button>
                  </div>
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
                {activeTab.socks5Port && (
                  <span className="text-[10px] text-emerald-300/80 font-mono ml-2 border-l border-emerald-500/30 pl-2">
                    SOCKS5: 127.0.0.1:{activeTab.socks5Port}
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center space-x-1 text-emerald-400 font-semibold">
                <Server className="w-3 h-3 text-emerald-400" />
                <span>Server Network (SSH: ON)</span>
                {activeTab.socks5Port && (
                  <span className="text-[10px] text-emerald-300 font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 ml-1">
                    SOCKS5: 127.0.0.1:{activeTab.socks5Port}
                  </span>
                )}
                <span className="text-gray-400 text-[10px] hidden sm:inline ml-1">➔ {activeTab.displayUrl || 'Start Page'}</span>
              </span>
            )
          ) : (
            <span className="flex items-center space-x-1 text-blue-400 font-semibold">
              <Globe className="w-3 h-3 text-blue-400" />
              <span>User Network (SSH: OFF) ➔ PC Browser Mode (All Redirects & Features Active)</span>
            </span>
          )}

          {/* Launch Native WebView2 Window */}
          {Boolean(activeTab.displayUrl || activeTab.url) && (
            <button
              onClick={() => handleLaunchNativeBrowser()}
              className="flex items-center space-x-1 text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer ml-1"
              title={`Launch current destination in dedicated Native WebView2 window with ${activeTab.networkMode === 'server' ? 'SSH SOCKS5 Proxy' : 'PC Direct Network'}`}
            >
              <Compass className="w-3 h-3 text-emerald-400" />
              <span>Native Window ({activeTab.networkMode === 'server' ? 'SOCKS5' : 'Direct'})</span>
            </button>
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
