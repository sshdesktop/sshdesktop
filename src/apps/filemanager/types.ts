export interface RemoteFile {
  name: string;
  type: 'dir' | 'file';
  size: string;
  rawSize: number;
  permissions: string;
  owner: string;
  modified: string;
  extension?: string;
  tag?: string;
}

export interface ClipboardState {
  files: string[];
  isCut: boolean;
  sourceDir: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  file?: RemoteFile;
  isCanvas?: boolean;
}

export interface FinderTab {
  id: string;
  title: string;
  path: string;
  history: string[];
  historyIndex: number;
}

export interface UndoAction {
  type: 'delete' | 'rename' | 'move';
  originalPath: string;
  targetPath?: string;
  content?: string;
}

export interface TagInfo {
  id: string;
  name: string;
  color: string;
}

export const MACOS_TAGS: TagInfo[] = [
  { id: 'red', name: 'Red', color: '#ff453a' },
  { id: 'orange', name: 'Orange', color: '#ff9f0a' },
  { id: 'yellow', name: 'Yellow', color: '#ffd60a' },
  { id: 'green', name: 'Green', color: '#30d158' },
  { id: 'blue', name: 'Blue', color: '#0a84ff' },
  { id: 'purple', name: 'Purple', color: '#bf5af2' },
  { id: 'gray', name: 'Gray', color: '#8e8e93' },
];

export interface TransferState {
  isOpen: boolean;
  type: 'move' | 'copy' | 'upload' | 'download';
  title: string;
  items: string[];
  currentItemName: string;
  sourcePath: string;
  destPath: string;
  currentCount: number;
  totalCount: number;
  progressPercent: number;
  bytesTransferred?: number;
  totalBytes?: number;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  errorMessage?: string;
}

export function isMediaFile(file?: RemoteFile | null): boolean {
  if (!file || file.type === 'dir') return false;
  const ext = file.extension?.toLowerCase() || file.name.split('.').pop()?.toLowerCase() || '';
  return ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'tiff', 'mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'flac', 'aac', 'm4a', 'pdf'].includes(ext);
}

export function formatRawBytes(bytes: number): string {
  if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function getFileKind(file: RemoteFile): string {
  if (file.type === 'dir') return 'Folder';
  const ext = file.extension?.toLowerCase() || file.name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'pdf': return 'PDF Document';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'bmp':
    case 'ico': return 'Image';
    case 'mp4':
    case 'webm':
    case 'mov':
    case 'avi':
    case 'mkv': return 'Video';
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
    case 'm4a': return 'Audio';
    case 'zip':
    case 'tar':
    case 'gz':
    case 'tgz':
    case 'bz2':
    case 'xz': return 'Archive';
    case 'deb': return 'Debian Package';
    case 'rpm': return 'RPM Package';
    case 'sh':
    case 'bash': return 'Shell Script';
    case 'js':
    case 'ts':
    case 'tsx':
    case 'jsx': return 'JavaScript/TypeScript';
    case 'py': return 'Python Script';
    case 'json': return 'JSON Document';
    case 'txt':
    case 'md': return 'Text Document';
    case 'html':
    case 'css': return 'Web Document';
    default:
      return file.extension ? `${file.extension.toUpperCase()} File` : 'Document';
  }
}

export function getNextAvailableCopyName(originalName: string, existingNames: string[]): string {
  const existingSet = new Set(existingNames);
  const isHidden = originalName.startsWith('.');
  const cleanName = isHidden ? originalName.slice(1) : originalName;
  const dotIdx = cleanName.lastIndexOf('.');
  
  let stem = '';
  let ext = '';
  if (dotIdx > 0) {
    stem = (isHidden ? '.' : '') + cleanName.slice(0, dotIdx);
    ext = cleanName.slice(dotIdx);
  } else {
    stem = originalName;
    ext = '';
  }

  const match = stem.match(/^(.*?)(?: - Copy(?: \((\d+)\))?)?$/);
  const base = match ? match[1] : stem;

  const firstCopy = `${base} - Copy${ext}`;
  if (!existingSet.has(firstCopy)) {
    return firstCopy;
  }

  let i = 2;
  while (true) {
    const candidate = `${base} - Copy (${i})${ext}`;
    if (!existingSet.has(candidate)) {
      return candidate;
    }
    i++;
  }
}
