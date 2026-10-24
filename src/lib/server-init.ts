import { sshExec, sftpMkdir } from './tauri-bridge';

/**
 * Ensures required user environment directories exist on the remote SSH server:
 * ~/.sshdesktop, ~/Desktop, ~/Downloads, ~/Documents
 * 
 * Note: Never creates ~/.sshdesktop/wallpapers or client appearance settings on the remote server.
 */
export async function ensureServerDirectories(connId: string, homeDir: string): Promise<void> {
  if (!connId || !homeDir) return;
  try {
    const cmd = `mkdir -p "${homeDir}/.sshdesktop" "${homeDir}/Desktop" "${homeDir}/Downloads" "${homeDir}/Documents"`;
    await sshExec(connId, cmd).catch(() => {});
    // SFTP fallback if shell command had issues
    await sftpMkdir(connId, `${homeDir}/.sshdesktop`).catch(() => {});
    await sftpMkdir(connId, `${homeDir}/Desktop`).catch(() => {});
    await sftpMkdir(connId, `${homeDir}/Downloads`).catch(() => {});
    await sftpMkdir(connId, `${homeDir}/Documents`).catch(() => {});
  } catch (err) {
    console.warn('ensureServerDirectories error:', err);
  }
}
