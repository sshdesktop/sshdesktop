import React from 'react';
import { 
  Folder, Image as ImageIcon, Video, Music, FileText, Terminal, 
  Archive, FileCode, Sliders 
} from 'lucide-react';
import { RemoteFile } from '../types';

interface FileIconProps {
  file: RemoteFile;
  className?: string;
}

export const FileIcon: React.FC<FileIconProps> = ({ file, className = "w-4 h-4" }) => {
  if (file.type === 'dir') {
    return <Folder className={`${className} text-white shrink-0 fill-white/20 drop-shadow-sm`} />;
  }
  const ext = file.extension?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp'].includes(ext)) {
    return <ImageIcon className={`${className} text-white shrink-0 drop-shadow-sm`} />;
  }
  if (['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(ext)) {
    return <Video className={`${className} text-white shrink-0 drop-shadow-sm`} />;
  }
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(ext)) {
    return <Music className={`${className} text-white shrink-0 drop-shadow-sm`} />;
  }
  if (ext === 'pdf') {
    return <FileText className={`${className} text-white shrink-0 font-bold drop-shadow-sm`} />;
  }
  if (['sh', 'bash', 'zsh', 'fish'].includes(ext) || file.permissions.includes('x')) {
    return <Terminal className={`${className} text-white shrink-0 drop-shadow-sm`} />;
  }
  if (['tar', 'gz', 'tgz', 'zip', 'bz2', 'xz', '7z', 'rar'].includes(ext)) {
    return <Archive className={`${className} text-white shrink-0 drop-shadow-sm`} />;
  }
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'html', 'css', 'vue'].includes(ext)) {
    return <FileCode className={`${className} text-white shrink-0 drop-shadow-sm`} />;
  }
  if (['json', 'yaml', 'yml', 'toml', 'xml', 'env', 'ini', 'conf'].includes(ext)) {
    return <Sliders className={`${className} text-white shrink-0 drop-shadow-sm`} />;
  }
  return <FileText className={`${className} text-white shrink-0 drop-shadow-sm`} />;
};
