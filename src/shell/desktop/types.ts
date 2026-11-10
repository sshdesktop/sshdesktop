import React from 'react';

export interface WallpaperItem {
  id: string;
  name: string;
  subtitle: string;
  category: 'macOS Official' | 'Nature 4K' | 'Cyberpunk & Sci-Fi 4K' | 'Minimal & Dark 4K' | 'Anime & Artistic 4K';
  url: string;
  thumbnail: string;
}

export const WALLPAPERS: WallpaperItem[] = [
  // 1. macOS Official
  {
    id: 'sonoma',
    name: 'macOS Sonoma Horizon',
    subtitle: '4K Ultra-HD Organic Sunset Waves',
    category: 'macOS Official',
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'sequoia',
    name: 'macOS Sequoia Forest',
    subtitle: '4K Redwood Sunrise Mist',
    category: 'macOS Official',
    url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1448375240586-882707db888b?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'ventura',
    name: 'macOS Ventura Amber',
    subtitle: '4K Dunes & Desert Warmth',
    category: 'macOS Official',
    url: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'monterey',
    name: 'macOS Monterey Marine',
    subtitle: '4K Deep Sea Canyon & Coastal Waters',
    category: 'macOS Official',
    url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=600&q=80',
  },

  // 2. Nature 4K
  {
    id: 'swiss-alps',
    name: 'Swiss Alps Panorama',
    subtitle: '4K Snow-Capped Alpine Glaciers',
    category: 'Nature 4K',
    url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'yosemite-valley',
    name: 'Yosemite Valley Sunrise',
    subtitle: '4K El Capitan & Granite Wilderness',
    category: 'Nature 4K',
    url: 'https://images.unsplash.com/photo-1426604966848-d7adac402bff?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1426604966848-d7adac402bff?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'norway-aurora',
    name: 'Norway Fjords & Aurora',
    subtitle: '4K Emerald Northern Lights & Arctic Waters',
    category: 'Nature 4K',
    url: 'https://images.unsplash.com/photo-1517411032315-54ef2cb783bb?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1517411032315-54ef2cb783bb?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'autumn-redwood',
    name: 'Pacific Redwood Mist',
    subtitle: '4K Morning Rays Through Golden Canopy',
    category: 'Nature 4K',
    url: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1511497584788-87676104235f?auto=format&fit=crop&w=600&q=80',
  },

  // 3. Cyberpunk & Sci-Fi 4K
  {
    id: 'tokyo-cyberpunk',
    name: 'Neo Tokyo Rain',
    subtitle: '4K Neon Reflections & Cyber Alleys',
    category: 'Cyberpunk & Sci-Fi 4K',
    url: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'cyber-highway',
    name: 'Cyber Horizon 2077',
    subtitle: '4K Synthwave Grid & Violet Skies',
    category: 'Cyberpunk & Sci-Fi 4K',
    url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'deep-space-nebula',
    name: 'Orion Stellar Nebula',
    subtitle: '4K Deep Space Cosmic Dust & Starlight',
    category: 'Cyberpunk & Sci-Fi 4K',
    url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=600&q=80',
  },

  // 4. Minimal & Dark 4K
  {
    id: 'obsidian-waves',
    name: 'Obsidian Liquid Waves',
    subtitle: '4K OLED Pure Black Fluid Elegance',
    category: 'Minimal & Dark 4K',
    url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'dark-matter',
    name: 'Dark Matter Geometry',
    subtitle: '4K Architectural Polygons & Subtle Shadows',
    category: 'Minimal & Dark 4K',
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'matte-gradient',
    name: 'Midnight Slate Gradient',
    subtitle: '4K Ultra-Smooth Deep Charcoal',
    category: 'Minimal & Dark 4K',
    url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?auto=format&fit=crop&w=600&q=80',
  },

  // 5. Anime & Artistic 4K
  {
    id: 'shinkai-sunset',
    name: 'Twilight Cloudscape',
    subtitle: '4K Shinkai-Style Anime Sunset & Stars',
    category: 'Anime & Artistic 4K',
    url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'sakura-blossom',
    name: 'Mount Fuji Cherry Blossom',
    subtitle: '4K Pastel Spring Bloom & Snow Peak',
    category: 'Anime & Artistic 4K',
    url: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=3840&q=95',
    thumbnail: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=600&q=80',
  },
];

export const ICON_CONFIGS = {
  small: { w: 72, h: 72, iconSize: 22, colSpacing: 92, rowSpacing: 86, padding: 'p-1', labelText: 'text-[11px]' },
  medium: { w: 84, h: 86, iconSize: 28, colSpacing: 104, rowSpacing: 100, padding: 'p-1.5', labelText: 'text-xs' },
  large: { w: 98, h: 102, iconSize: 34, colSpacing: 122, rowSpacing: 118, padding: 'p-2', labelText: 'text-[13px]' },
};

export interface DesktopItem {
  id: string;
  label: string;
  icon: React.ElementType;
  tileBg: string;
  kind: 'system' | 'folder' | 'file';
  type: string;
  path?: string;
  size?: number;
  action: () => void;
}

export interface DesktopContextMenuState {
  x: number;
  y: number;
}

export interface DesktopItemMenuState {
  x: number;
  y: number;
  item: DesktopItem;
}

export interface DeleteConfirmModalState {
  isOpen: boolean;
  item: DesktopItem | null;
}
