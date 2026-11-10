import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BrowserBookmark, BrowserHistoryItem, BrowserRoutingMode } from './types';

const DEFAULT_BOOKMARKS: BrowserBookmark[] = [];

interface BrowserStoreState {
  bookmarks: BrowserBookmark[];
  history: BrowserHistoryItem[];
  defaultRoutingMode: BrowserRoutingMode;
  showBookmarksBar: boolean;
  showDevTools: boolean;
  userAgent: string;
  zoomLevel: number;

  setBookmarks: (bookmarks: BrowserBookmark[]) => void;
  addBookmark: (bm: BrowserBookmark) => void;
  removeBookmark: (id: string) => void;
  addHistoryItem: (item: Omit<BrowserHistoryItem, 'id' | 'timestamp'>) => void;
  clearHistory: () => void;
  setDefaultRoutingMode: (mode: BrowserRoutingMode) => void;
  setShowBookmarksBar: (show: boolean) => void;
  setShowDevTools: (show: boolean) => void;
  setZoomLevel: (zoom: number) => void;
}

// Fallback migrate legacy browser store
if (typeof localStorage !== 'undefined' && !localStorage.getItem('sshdesktop_browser_store') && localStorage.getItem('clouddesk_browser_store')) {
  try {
    localStorage.setItem('sshdesktop_browser_store', localStorage.getItem('clouddesk_browser_store')!);
  } catch {}
}

export const useBrowserStore = create<BrowserStoreState>()(
  persist(
    (set, get) => ({
      bookmarks: [],
      history: [],
      defaultRoutingMode: 'tunnel',
      showBookmarksBar: true,
      showDevTools: false,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 SSHDesktop/2.0',
      zoomLevel: 100,

      setBookmarks: (bookmarks) => set({ bookmarks }),

      addBookmark: (bm) => set((s) => ({
        bookmarks: [bm, ...s.bookmarks.filter(b => b.url !== bm.url)]
      })),

      removeBookmark: (id) => set((s) => ({
        bookmarks: s.bookmarks.filter(b => b.id !== id)
      })),

      addHistoryItem: (item) => set((s) => ({
        history: [
          {
            ...item,
            id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            timestamp: Date.now(),
          },
          ...s.history.slice(0, 199) // keep latest 200 items
        ]
      })),

      clearHistory: () => set({ history: [] }),
      setDefaultRoutingMode: (mode) => set({ defaultRoutingMode: mode }),
      setShowBookmarksBar: (show) => set({ showBookmarksBar: show }),
      setShowDevTools: (show) => set({ showDevTools: show }),
      setZoomLevel: (zoom) => set({ zoomLevel: Math.max(50, Math.min(200, zoom)) }),
    }),
    {
      name: 'sshdesktop_browser_store',
    }
  )
);
