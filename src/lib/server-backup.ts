import { sshExec, sftpWriteFile, sftpDownloadToDownloads } from './tauri-bridge';
import { loadSettingsFromServer, restoreSettingsToStore } from './server-settings';

export interface SshDesktopFileEntry {
  name: string;
  size: string;
  modified: string;
  isDir: boolean;
  path: string;
}

export interface BackupArchiveEntry {
  name: string;
  path: string;
  size: string;
  modified: string;
  isGzip: boolean;
}

export interface TarArchiveContentItem {
  permissions: string;
  owner: string;
  size: string;
  date: string;
  name: string;
}

export function getSshDesktopDirPath(homeDir?: string): string {
  const cleanHome = homeDir?.replace(/\/+$/, '') || '/home/sharuk';
  return `${cleanHome}/.sshdesktop`;
}

export function getSshDesktopBackupsDirPath(homeDir?: string): string {
  const cleanHome = homeDir?.replace(/\/+$/, '') || '/home/sharuk';
  return `${cleanHome}/.sshdesktop_backups`;
}

/**
 * List all configuration and data files currently stored inside /home/<user>/.sshdesktop
 */
export async function listSshDesktopFiles(
  connId: string,
  homeDir: string
): Promise<{
  success: boolean;
  targetDir: string;
  files: SshDesktopFileEntry[];
  totalSize: string;
  totalFiles: number;
  error?: string;
}> {
  const targetDir = getSshDesktopDirPath(homeDir);
  try {
    // Ensure folder exists
    await sshExec(connId, `mkdir -p "${targetDir}" 2>/dev/null`).catch(() => {});

    // Get total size and count
    const sizeRes = await sshExec(connId, `du -sh "${targetDir}" 2>/dev/null | awk '{print $1}'`);
    const totalSize = sizeRes.stdout ? sizeRes.stdout.trim() : '0B';

    // List all files and directories inside .sshdesktop
    const listRes = await sshExec(
      connId,
      `find "${targetDir}" -mindepth 1 -maxdepth 2 -printf '%y|%s|%TY-%Tm-%Td %TH:%TM|%P\\n' 2>/dev/null || ls -la "${targetDir}"`
    );

    const files: SshDesktopFileEntry[] = [];
    if (listRes.stdout) {
      const lines = listRes.stdout.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.includes('|')) {
          const [type, sizeBytes, modTime, relPath] = trimmed.split('|');
          if (!relPath) continue;
          const isDir = type === 'd';
          const sizeNum = parseInt(sizeBytes, 10) || 0;
          const formattedSize = isDir
            ? 'DIR'
            : sizeNum > 1024 * 1024
            ? `${(sizeNum / (1024 * 1024)).toFixed(1)} MB`
            : sizeNum > 1024
            ? `${(sizeNum / 1024).toFixed(1)} KB`
            : `${sizeNum} B`;

          files.push({
            name: relPath,
            size: formattedSize,
            modified: modTime || '—',
            isDir,
            path: `${targetDir}/${relPath}`,
          });
        }
      }
    }

    return {
      success: true,
      targetDir,
      files,
      totalSize,
      totalFiles: files.filter(f => !f.isDir).length,
    };
  } catch (err: any) {
    return {
      success: false,
      targetDir,
      files: [],
      totalSize: '—',
      totalFiles: 0,
      error: err?.message || String(err),
    };
  }
}

/**
 * Creates a .tar or .tar.gz archive of all files inside /home/<user>/.sshdesktop
 */
export async function createTarBackup(
  connId: string,
  homeDir: string,
  options?: {
    format?: 'tar.gz' | 'tar';
    customPrefix?: string;
  }
): Promise<{
  success: boolean;
  archivePath: string;
  archiveName: string;
  size: string;
  error?: string;
}> {
  const targetDir = getSshDesktopDirPath(homeDir);
  const backupsDir = getSshDesktopBackupsDirPath(homeDir);
  const isGzip = options?.format !== 'tar';
  const ext = isGzip ? 'tar.gz' : 'tar';
  const tarFlags = isGzip ? '-czf' : '-cf';

  // Generate ISO timestamp without colons: YYYYMMDD_HHMMSS
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const prefix = options?.customPrefix ? options.customPrefix.replace(/[^a-zA-Z0-9_-]/g, '_') : 'sshdesktop_backup';
  const archiveName = `${prefix}_${timestamp}.${ext}`;
  const archivePath = `${backupsDir}/${archiveName}`;

  try {
    // 1. Ensure backup directory exists and target directory exists
    await sshExec(connId, `mkdir -p "${backupsDir}" "${targetDir}"`);

    // 2. Run tar command: archive everything inside targetDir into archivePath
    // Using -C "${targetDir}" . ensures inside paths are root-relative (no leading folder clutter)
    const cmd = `tar ${tarFlags} "${archivePath}" -C "${targetDir}" . 2>&1`;
    const res = await sshExec(connId, cmd);

    if (res.exit_code !== 0 && !res.stdout.includes('socket ignored')) {
      throw new Error(res.stderr || res.stdout || 'tar command failed to create archive');
    }

    // 3. Verify archive exists and get human-readable file size
    const checkRes = await sshExec(connId, `ls -lh "${archivePath}" 2>/dev/null | awk '{print $5}'`);
    const size = checkRes.stdout ? checkRes.stdout.trim() : 'Unknown';

    return {
      success: true,
      archivePath,
      archiveName,
      size,
    };
  } catch (err: any) {
    return {
      success: false,
      archivePath: '',
      archiveName: '',
      size: '0B',
      error: err?.message || String(err),
    };
  }
}

/**
 * List all available tar backup archives in ~/.sshdesktop_backups and home directory
 */
export async function listBackupArchives(
  connId: string,
  homeDir: string
): Promise<BackupArchiveEntry[]> {
  const backupsDir = getSshDesktopBackupsDirPath(homeDir);
  const cleanHome = homeDir?.replace(/\/+$/, '') || '/home/sharuk';

  try {
    // Ensure backups dir exists
    await sshExec(connId, `mkdir -p "${backupsDir}" 2>/dev/null`).catch(() => {});

    // Find all .tar, .tar.gz, .tgz archives in backupsDir and home dir
    const cmd = `ls -lh --time-style=long-iso "${backupsDir}"/*.tar* "${backupsDir}"/*.tgz "${cleanHome}"/*sshdesktop*.tar* 2>/dev/null | awk '{print $5 "|" $6 " " $7 "|" $8}'`;
    const res = await sshExec(connId, cmd);

    const archives: BackupArchiveEntry[] = [];
    if (res.stdout) {
      const lines = res.stdout.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.includes('|')) continue;
        const [size, dateStr, fullPath] = trimmed.split('|');
        if (!fullPath || fullPath.includes('*')) continue;
        const name = fullPath.split('/').pop() || fullPath;
        const isGzip = name.endsWith('.gz') || name.endsWith('.tgz');

        archives.push({
          name,
          path: fullPath,
          size: size || '—',
          modified: dateStr || '—',
          isGzip,
        });
      }
    }

    // Sort descending by modified date / name
    return archives.sort((a, b) => b.modified.localeCompare(a.modified));
  } catch {
    return [];
  }
}

/**
 * Inspect contents of a .tar or .tar.gz archive without extracting
 */
export async function inspectTarArchive(
  connId: string,
  archivePath: string
): Promise<{
  success: boolean;
  items: TarArchiveContentItem[];
  rawOutput: string;
  error?: string;
}> {
  try {
    const res = await sshExec(connId, `tar -tvf "${archivePath}" 2>&1`);
    if (res.exit_code !== 0) {
      throw new Error(res.stderr || res.stdout || 'Failed to inspect tar archive');
    }

    const items: TarArchiveContentItem[] = [];
    const lines = (res.stdout || '').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Typical format: -rw-r--r-- 0/0 1234 2026-10-26 12:00 ./settings.json
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 6) {
        const permissions = parts[0];
        const owner = parts[1];
        const size = parts[2];
        const date = `${parts[3]} ${parts[4]}`;
        const name = parts.slice(5).join(' ');
        items.push({ permissions, owner, size, date, name });
      } else {
        items.push({ permissions: '', owner: '', size: '', date: '', name: trimmed });
      }
    }

    return {
      success: true,
      items,
      rawOutput: res.stdout || '',
    };
  } catch (err: any) {
    return {
      success: false,
      items: [],
      rawOutput: '',
      error: err?.message || String(err),
    };
  }
}

/**
 * Restore / Recover all files inside /home/<user>/.sshdesktop from a tar archive
 */
export async function restoreTarBackup(
  connId: string,
  homeDir: string,
  archivePath: string
): Promise<{
  success: boolean;
  targetDir: string;
  restoredCount: number;
  error?: string;
}> {
  const targetDir = getSshDesktopDirPath(homeDir);

  try {
    // 1. Verify archive integrity
    const testRes = await sshExec(connId, `tar -tf "${archivePath}" >/dev/null 2>&1`);
    if (testRes.exit_code !== 0) {
      throw new Error(`Corrupted or invalid tar archive: ${archivePath}`);
    }

    // 2. Ensure targetDir exists
    await sshExec(connId, `mkdir -p "${targetDir}"`);

    // 3. Extract all files inside the tar archive into targetDir
    // GNU tar's -xf automatically handles both gzip-compressed and plain tar files!
    const extractCmd = `tar -xf "${archivePath}" -C "${targetDir}" 2>&1 && chmod -R u+rwX "${targetDir}" 2>/dev/null`;
    const extractRes = await sshExec(connId, extractCmd);

    if (extractRes.exit_code !== 0) {
      throw new Error(extractRes.stderr || extractRes.stdout || 'Extraction failed');
    }

    // 4. Count restored files
    const countRes = await sshExec(connId, `find "${targetDir}" -mindepth 1 -type f 2>/dev/null | wc -l`);
    const restoredCount = parseInt(countRes.stdout?.trim() || '0', 10);

    // 5. Re-hydrate client settings store if settings.json was restored
    try {
      const settingsRes = await loadSettingsFromServer(connId, homeDir);
      if (settingsRes.success && settingsRes.data) {
        restoreSettingsToStore(settingsRes.data);
      }
    } catch {}

    return {
      success: true,
      targetDir,
      restoredCount,
    };
  } catch (err: any) {
    return {
      success: false,
      targetDir,
      restoredCount: 0,
      error: err?.message || String(err),
    };
  }
}

/**
 * Upload a local .tar or .tar.gz file from local computer and restore into /home/<user>/.sshdesktop
 */
export async function uploadAndRestoreTarBackup(
  connId: string,
  homeDir: string,
  fileData: ArrayBuffer,
  fileName: string
): Promise<{
  success: boolean;
  targetDir: string;
  restoredCount: number;
  error?: string;
}> {
  const backupsDir = getSshDesktopBackupsDirPath(homeDir);
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tempRemotePath = `${backupsDir}/uploaded_${Date.now()}_${safeName}`;

  try {
    // 1. Ensure backups dir exists
    await sshExec(connId, `mkdir -p "${backupsDir}"`);

    // 2. Upload file via SFTP
    const uint8Arr = new Uint8Array(fileData);
    await sftpWriteFile(connId, tempRemotePath, Array.from(uint8Arr));

    // 3. Restore from the uploaded tar file
    const res = await restoreTarBackup(connId, homeDir, tempRemotePath);
    if (!res.success) {
      throw new Error(res.error || 'Failed to extract uploaded tar archive');
    }

    return res;
  } catch (err: any) {
    return {
      success: false,
      targetDir: getSshDesktopDirPath(homeDir),
      restoredCount: 0,
      error: err?.message || String(err),
    };
  }
}

/**
 * Download a tar backup from server to local computer Downloads folder
 */
export async function downloadTarBackup(
  connId: string,
  archivePath: string
): Promise<string> {
  return await sftpDownloadToDownloads(connId, archivePath);
}

/**
 * Delete a backup archive from server
 */
export async function deleteBackupArchive(
  connId: string,
  archivePath: string
): Promise<void> {
  await sshExec(connId, `rm -f "${archivePath}"`);
}
