import { sftpReadTextFile, sftpWriteTextFile, sshExec, sftpMkdir } from './tauri-bridge';
import { useSettingsStore } from './store';

export interface ServerSettingsPayload {
  user: string;
  theme: string;
  accentColor: string;
  wallpaper: string;
  dockPosition: 'left' | 'right' | 'bottom';
  autoHideDock: boolean;
  terminalFontSize: number;
  desktopIconSize: 'small' | 'medium' | 'large';
  showHiddenFiles: boolean;
  pollingInterval: number;
  autoFullScreen: boolean;
  sticky_notes?: string;
  icon_positions?: Record<string, { x: number; y: number }>;
  favorites?: string[];
  updated_at: string;
  client: string;
}

export function getServerSettingsFilePath(homeDir: string): string {
  const cleanHome = homeDir?.replace(/\/+$/, '') || '/root';
  return `${cleanHome}/.sshdesktop/settings.json`;
}

export function getLegacyServerSettingsFilePath(homeDir: string): string {
  const cleanHome = homeDir?.replace(/\/+$/, '') || '/root';
  return `${cleanHome}/.clouddesk/settings.json`;
}

/**
 * Saves active application settings to remote server at ~/.sshdesktop/settings.json
 */
export async function saveSettingsToServer(
  connId: string,
  homeDir: string,
  settings: any,
  options?: {
    username?: string;
    stickies?: string;
    iconPositions?: any;
  }
): Promise<{ success: boolean; path: string; error?: string; timestamp: string }> {
  const timestamp = new Date().toISOString();
  if (!connId || !homeDir) {
    return { success: false, path: '', error: 'No active connection or home directory', timestamp };
  }

  const settingsPath = getServerSettingsFilePath(homeDir);
  const dirPath = `${homeDir.replace(/\/+$/, '')}/.sshdesktop`;

  try {
    // 1. Ensure remote directory exists
    await sshExec(connId, `mkdir -p "${dirPath}"`).catch(() => {});
    await sftpMkdir(connId, dirPath).catch(() => {});

    // 2. Build complete payload
    const stickies = options?.stickies ?? (typeof window !== 'undefined' ? localStorage.getItem('sshdesktop_desktop_stickies') || '' : '');
    let iconPositions = options?.iconPositions;
    if (!iconPositions && typeof window !== 'undefined') {
      try {
        iconPositions = JSON.parse(localStorage.getItem('sshdesktop_desktop_icon_positions') || '{}');
      } catch {
        iconPositions = {};
      }
    }

    const payload: ServerSettingsPayload = {
      user: options?.username || 'user',
      theme: settings.theme || 'dark',
      accentColor: settings.accentColor || '#89B4FA',
      wallpaper: settings.wallpaper || 'sonoma',
      dockPosition: settings.dockPosition || 'bottom',
      autoHideDock: Boolean(settings.autoHideDock),
      terminalFontSize: Number(settings.terminalFontSize) || 14,
      desktopIconSize: settings.desktopIconSize || 'medium',
      showHiddenFiles: Boolean(settings.showHiddenFiles),
      pollingInterval: Number(settings.pollingInterval) || 15,
      autoFullScreen: Boolean(settings.autoFullScreen),
      sticky_notes: stickies,
      icon_positions: iconPositions,
      favorites: settings.favorites || ['/', '/home', '/etc', '/var/log', '/tmp'],
      updated_at: timestamp,
      client: 'SSH Desktop macOS Shell',
    };

    const jsonStr = JSON.stringify(payload, null, 2);

    // 3. Write file via SFTP or base64 sshExec fallback
    let wroteOk = false;
    try {
      await sftpWriteTextFile(connId, settingsPath, jsonStr);
      wroteOk = true;
    } catch (sftpErr) {
      console.warn('[Server Settings] SFTP write failed, trying sshExec fallback:', sftpErr);
    }

    if (!wroteOk) {
      const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
      const res = await sshExec(
        connId,
        `mkdir -p "${dirPath}" && printf '%s' '${b64}' | base64 -d > "${settingsPath}"`
      );
      wroteOk = res.exit_code === 0;
      if (!wroteOk) {
        throw new Error(res.stderr || 'Failed to write settings.json to remote server');
      }
    }

    return { success: true, path: settingsPath, timestamp };
  } catch (err: any) {
    return { success: false, path: settingsPath, error: String(err?.message || err), timestamp };
  }
}

/**
 * Loads and parses ~/.sshdesktop/settings.json from the remote server
 */
export async function loadSettingsFromServer(
  connId: string,
  homeDir: string
): Promise<{ success: boolean; data?: ServerSettingsPayload; path: string; rawJson?: string; error?: string }> {
  if (!connId || !homeDir) {
    return { success: false, path: '', error: 'No active connection or home directory' };
  }

  const primaryPath = getServerSettingsFilePath(homeDir);
  const legacyPath = getLegacyServerSettingsFilePath(homeDir);

  try {
    let content = await sftpReadTextFile(connId, primaryPath).catch(() => '');
    let resolvedPath = primaryPath;

    if (!content) {
      content = await sftpReadTextFile(connId, legacyPath).catch(() => '');
      if (content) resolvedPath = legacyPath;
    }

    if (!content) {
      const res = await sshExec(
        connId,
        `cat "${primaryPath}" 2>/dev/null || cat "${legacyPath}" 2>/dev/null`
      ).catch(() => null);
      if (res && res.exit_code === 0 && res.stdout.trim()) {
        content = res.stdout;
      }
    }

    if (!content || !content.trim().startsWith('{')) {
      return { success: false, path: primaryPath, error: `No settings file found at ${primaryPath}` };
    }

    const parsed = JSON.parse(content) as ServerSettingsPayload;
    return { success: true, data: parsed, path: resolvedPath, rawJson: content };
  } catch (err: any) {
    return { success: false, path: primaryPath, error: String(err?.message || err) };
  }
}

/**
 * Applies a loaded ServerSettingsPayload to the application settings store and local environment
 */
export function restoreSettingsToStore(payload: Partial<ServerSettingsPayload>): void {
  if (!payload || typeof payload !== 'object') return;

  const updates: any = {};
  if (payload.theme) updates.theme = payload.theme;
  if (payload.accentColor) updates.accentColor = payload.accentColor;
  if (payload.wallpaper) updates.wallpaper = payload.wallpaper;
  if (payload.dockPosition) updates.dockPosition = payload.dockPosition;
  if (payload.autoHideDock !== undefined) updates.autoHideDock = payload.autoHideDock;
  if (payload.terminalFontSize) updates.terminalFontSize = payload.terminalFontSize;
  if (payload.desktopIconSize) updates.desktopIconSize = payload.desktopIconSize;
  if (payload.showHiddenFiles !== undefined) updates.showHiddenFiles = payload.showHiddenFiles;
  if (payload.pollingInterval) updates.pollingInterval = payload.pollingInterval;
  if (payload.autoFullScreen !== undefined) updates.autoFullScreen = payload.autoFullScreen;
  if (payload.favorites) updates.favorites = payload.favorites;

  if (Object.keys(updates).length > 0) {
    useSettingsStore.getState().updateSettings(updates);
  }

  // Restore stickies
  if (payload.sticky_notes && typeof window !== 'undefined') {
    localStorage.setItem('sshdesktop_desktop_stickies', payload.sticky_notes);
    window.dispatchEvent(new CustomEvent('sshdesktop-stickies-updated', { detail: payload.sticky_notes }));
  }

  // Restore icon positions
  if (payload.icon_positions && typeof window !== 'undefined') {
    localStorage.setItem('sshdesktop_desktop_icon_positions', JSON.stringify(payload.icon_positions));
    window.dispatchEvent(new CustomEvent('sshdesktop-icons-updated', { detail: payload.icon_positions }));
  }
}

/**
 * Checks metadata of remote ~/.sshdesktop/settings.json
 */
export async function checkServerSettingsFile(
  connId: string,
  homeDir: string
): Promise<{ exists: boolean; size?: number; modified?: string; path: string; data?: ServerSettingsPayload; rawJson?: string }> {
  const path = getServerSettingsFilePath(homeDir);
  if (!connId || !homeDir) {
    return { exists: false, path };
  }

  try {
    const res = await loadSettingsFromServer(connId, homeDir);
    if (res.success && res.data) {
      const statRes = await sshExec(connId, `stat -c "%s %y" "${path}" 2>/dev/null || stat -f "%z %Sm" "${path}" 2>/dev/null`).catch(() => null);
      let size: number | undefined;
      let modified: string | undefined;

      if (statRes && statRes.exit_code === 0 && statRes.stdout.trim()) {
        const parts = statRes.stdout.trim().split(/\s+/);
        size = Number(parts[0]) || res.rawJson?.length;
        modified = parts.slice(1).join(' ') || res.data.updated_at;
      } else {
        size = res.rawJson?.length;
        modified = res.data.updated_at;
      }

      return {
        exists: true,
        size,
        modified,
        path: res.path,
        data: res.data,
        rawJson: res.rawJson,
      };
    }
  } catch {}

  return { exists: false, path };
}
