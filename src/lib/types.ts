export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'key';
  password?: string;
  keyPath?: string;
  privateKeyPath?: string;
  private_key_path?: string;
  color?: string;
  group?: string;
  tags?: string[];
  lastConnected?: number;
}

export interface WindowState {
  id: string;
  appId: string;
  title: string;
  icon?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
  maximized: boolean;
  focused: boolean;
  zIndex: number;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  timestamp: number;
  read: boolean;
}

// Add more types as needed for backend structs...
export interface SystemStats {
  cpu: number;
  memory: { total: number; used: number; free: number };
  uptime: number;
}
