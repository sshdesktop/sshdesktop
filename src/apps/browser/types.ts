export type BrowserRoutingMode = 'ssh-gateway' | 'tunnel' | 'direct';
export type DevToolsPanel = 'network' | 'source' | 'ssh-command' | 'console';
export type NetworkMode = 'server' | 'user';

export interface BrowserTab {
  id: string;
  url: string;
  displayUrl: string;
  iframeSrc?: string;
  tunnelPort?: number;
  isTunneled?: boolean;
  networkMode: NetworkMode;
  userBrowserMode?: 'external' | 'embedded';
  devToolsOpen?: boolean;
  activeDevToolsPanel?: DevToolsPanel;
  title: string;
  favicon?: string;
  isLoading: boolean;
  statusCode?: number;
  statusText?: string;
  contentType?: string;
  headers: Record<string, string>;
  latencyMs?: number;
  routingMode: BrowserRoutingMode;
  history: string[];
  historyIndex: number;
  htmlContent?: string;
  jsonContent?: any;
  textContent?: string;
  error?: string | null;
  serverHost?: string;
  bytesReceived?: number;
}

export interface DiscoveredWebService {
  port: number;
  protocol: string;
  name: string;
  url: string;
  pid?: number;
  processName?: string;
  isPrivate: boolean;
}

export interface BrowserBookmark {
  id: string;
  title: string;
  url: string;
  tag: 'internal' | 'dashboard' | 'dev' | 'db' | 'public';
  icon?: string;
}

export interface BrowserHistoryItem {
  id: string;
  url: string;
  title: string;
  timestamp: number;
  statusCode?: number;
  serverHost?: string;
}

export interface NetworkLogEntry {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  contentType: string;
  sizeBytes: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
}
