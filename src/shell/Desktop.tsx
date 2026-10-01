import React, { useState, useEffect } from 'react';
import Taskbar from './Taskbar';
import Dock from './Dock';
import WindowManager from './WindowManager';
import AppLauncher from './AppLauncher';
import NotificationCenter from './NotificationCenter';
import SpotlightSearch from './SpotlightSearch';
import ContextMenu from './ContextMenu';

export default function Desktop() {
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') {
        setShowSpotlight(s => !s);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="relative w-full h-full bg-gradient-to-br from-[#1E1E2E] to-[#11111B] overflow-hidden" 
         onContextMenu={(e) => e.preventDefault()}>
      <Taskbar />
      <div className="absolute inset-0 top-8 bottom-16 pt-8 pb-16">
        <WindowManager />
      </div>
      <Dock onToggleLauncher={() => setLauncherOpen(!launcherOpen)} />
      
      {launcherOpen && <AppLauncher onClose={() => setLauncherOpen(false)} />}
      <NotificationCenter />
      {showSpotlight && <SpotlightSearch onClose={() => setShowSpotlight(false)} />}
      <ContextMenu />
    </div>
  );
}
