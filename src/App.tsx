import React, { useEffect } from 'react';
import { useConnectionStore } from './lib/store';
import { useSettingsStore } from './lib/store';
import ConnectionScreen from './pages/ConnectionScreen';
import Desktop from './shell/Desktop';

export default function App() {
  const activeConnectionId = useConnectionStore((state) => state.activeConnectionId);
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  return (
    <div className="w-screen h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      {activeConnectionId ? <Desktop /> : <ConnectionScreen />}
    </div>
  );
}
