import React, { useState, useEffect, useRef } from 'react';
import { Rnd } from 'react-rnd';
import { useWindowStore } from '../lib/store';
import { WindowState } from '../lib/types';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  RefreshCw, Maximize2, Minimize2, SplitSquareVertical, 
  LayoutGrid, Columns, Monitor, X
} from 'lucide-react';

export default function Window({ window: win, children }: { window: WindowState; children: React.ReactNode }) {
  const { 
    focusWindow, closeWindow, minimizeWindow, maximizeWindow, 
    snapWindow, toggleFullscreen, updatePosition, updateSize, bringToFront 
  } = useWindowStore();
  const launchingAppId = useWindowStore((state) => state.launchingAppId);
  const [controlsHovered, setControlsHovered] = useState(false);
  const [showSnapMenu, setShowSnapMenu] = useState(false);
  const snapMenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Viewport tracking for precise pixel math
  const [viewport, setViewport] = useState({
    w: typeof window !== 'undefined' ? window.innerWidth : 1280,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const handleResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isBusy = launchingAppId === win.appId;
  const isFullScreen = !!win.fullscreen;
  const isMaximized = !!win.maximized || win.snapState === 'maximize';
  const isSnapped = !!win.snapState && win.snapState !== 'none';
  const isFixedLayout = isFullScreen || isMaximized || isSnapped;

  // Exact desktop boundary geometry:
  // Top Taskbar is 32px height.
  // Bottom Dock takes ~76px reservation.
  const topBarH = 32;
  const bottomDockH = 76;
  const usableH = Math.max(200, viewport.h - topBarH - bottomDockH);
  const halfW = Math.floor(viewport.w / 2);
  const halfH = Math.floor(usableH / 2);

  let currentSize = { width: win.width, height: win.height };
  let currentPos = { x: win.x, y: win.y };

  if (isFullScreen) {
    currentSize = { width: viewport.w, height: viewport.h };
    currentPos = { x: 0, y: 0 };
  } else if (win.snapState === 'left') {
    currentSize = { width: halfW, height: usableH };
    currentPos = { x: 0, y: topBarH };
  } else if (win.snapState === 'right') {
    currentSize = { width: viewport.w - halfW, height: usableH };
    currentPos = { x: halfW, y: topBarH };
  } else if (win.snapState === 'top-left') {
    currentSize = { width: halfW, height: halfH };
    currentPos = { x: 0, y: topBarH };
  } else if (win.snapState === 'top-right') {
    currentSize = { width: viewport.w - halfW, height: halfH };
    currentPos = { x: halfW, y: topBarH };
  } else if (win.snapState === 'bottom-left') {
    currentSize = { width: halfW, height: usableH - halfH };
    currentPos = { x: 0, y: topBarH + halfH };
  } else if (win.snapState === 'bottom-right') {
    currentSize = { width: viewport.w - halfW, height: usableH - halfH };
    currentPos = { x: halfW, y: topBarH + halfH };
  } else if (isMaximized) {
    currentSize = { width: viewport.w, height: usableH };
    currentPos = { x: 0, y: topBarH };
  }

  const [snapPreview, setSnapPreview] = useState<'none' | 'maximize' | 'left' | 'right' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'>('none');

  const handleGreenButtonHoverEnter = () => {
    if (snapMenuTimeoutRef.current) clearTimeout(snapMenuTimeoutRef.current);
    snapMenuTimeoutRef.current = setTimeout(() => {
      setShowSnapMenu(true);
    }, 280);
  };

  const handleGreenButtonHoverLeave = () => {
    if (snapMenuTimeoutRef.current) clearTimeout(snapMenuTimeoutRef.current);
    snapMenuTimeoutRef.current = setTimeout(() => {
      setShowSnapMenu(false);
    }, 350);
  };

  return (
    <>
      {/* Windows-style Aero Snap Preview Box on Screen Edges */}
      {snapPreview !== 'none' && (
        <div 
          className="fixed pointer-events-none z-[99990] bg-blue-500/25 border-2 border-blue-400 rounded-2xl shadow-[0_0_40px_rgba(59,130,246,0.3)] transition-all duration-100"
          style={
            snapPreview === 'maximize'
              ? { top: topBarH, left: 0, width: viewport.w, height: usableH }
              : snapPreview === 'left'
              ? { top: topBarH, left: 0, width: halfW, height: usableH }
              : snapPreview === 'right'
              ? { top: topBarH, left: halfW, width: viewport.w - halfW, height: usableH }
              : snapPreview === 'top-left'
              ? { top: topBarH, left: 0, width: halfW, height: halfH }
              : snapPreview === 'top-right'
              ? { top: topBarH, left: halfW, width: viewport.w - halfW, height: halfH }
              : snapPreview === 'bottom-left'
              ? { top: topBarH + halfH, left: 0, width: halfW, height: usableH - halfH }
              : { top: topBarH + halfH, left: halfW, width: viewport.w - halfW, height: usableH - halfH }
          }
        />
      )}

      <Rnd
        data-window="true"
        size={currentSize}
        position={currentPos}
        onDrag={(e: any, d) => {
          // If dragging a maximized or snapped window, instantly break out into floating normal size
          if (isMaximized || isSnapped) {
            snapWindow(win.id, 'none');
            if (win.maximized) maximizeWindow(win.id);
          }

          const mouseX = e.clientX ?? d.x;
          const mouseY = e.clientY ?? d.y;

          // Detect Aero Snap zones along edges
          if (mouseY <= 38) {
            setSnapPreview('maximize');
          } else if (mouseX <= 20) {
            if (mouseY <= topBarH + 65) setSnapPreview('top-left');
            else if (mouseY >= usableH - 45) setSnapPreview('bottom-left');
            else setSnapPreview('left');
          } else if (mouseX >= viewport.w - 20) {
            if (mouseY <= topBarH + 65) setSnapPreview('top-right');
            else if (mouseY >= usableH - 45) setSnapPreview('bottom-right');
            else setSnapPreview('right');
          } else {
            setSnapPreview('none');
          }
        }}
        onDragStop={(e: any, d) => {
          const preview = snapPreview;
          setSnapPreview('none');

          const mouseX = e.clientX ?? d.x;
          const mouseY = e.clientY ?? d.y;

          if (preview !== 'none') {
            snapWindow(win.id, preview);
            return;
          }

          if (mouseY <= 38) {
            snapWindow(win.id, 'maximize');
            return;
          } else if (mouseX <= 20) {
            if (mouseY <= topBarH + 65) snapWindow(win.id, 'top-left');
            else if (mouseY >= usableH - 45) snapWindow(win.id, 'bottom-left');
            else snapWindow(win.id, 'left');
            return;
          } else if (mouseX >= viewport.w - 20) {
            if (mouseY <= topBarH + 65) snapWindow(win.id, 'top-right');
            else if (mouseY >= usableH - 45) snapWindow(win.id, 'bottom-right');
            else snapWindow(win.id, 'right');
            return;
          }

          // Strict boundary limit: Titlebar MUST NOT go underneath the top Taskbar (start bar limit)
          const clampedY = Math.max(topBarH, Math.min(viewport.h - 90, d.y));
          const clampedX = Math.max(0, Math.min(viewport.w - 100, d.x));
          updatePosition(win.id, clampedX, clampedY);
        }}
        onResizeStop={(e, direction, ref, delta, position) => {
          if (!isFixedLayout) {
            updateSize(win.id, parseInt(ref.style.width, 10), parseInt(ref.style.height, 10));
            updatePosition(win.id, position.x, Math.max(topBarH, position.y));
          }
        }}
        minWidth={360}
        minHeight={240}
        dragHandleClassName="drag-handle"
        disableDragging={isFullScreen}
        enableResizing={!isFullScreen && !isMaximized}
        onMouseDown={() => { focusWindow(win.id); bringToFront(win.id); }}
        onContextMenu={(e: any) => e.stopPropagation()}
        className={`absolute window-shell select-none ${win.minimized ? 'pointer-events-none' : 'pointer-events-auto'}`}
        style={{ 
          zIndex: isFullScreen ? 99999 : win.zIndex,
          display: win.minimized ? 'none' : 'block'
        }}
      >
        <motion.div 
          onContextMenu={(e) => e.stopPropagation()}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className={`window-inner-frame w-full h-full flex flex-col bg-[#1e1e2e]/95 backdrop-blur-3xl overflow-hidden transition-all duration-200 border ${
            isFullScreen ? 'rounded-none border-none' : 'rounded-2xl'
          } ${
            win.focused 
              ? 'border-white/15 shadow-[0_30px_80px_-15px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.15)] ring-1 ring-white/10' 
              : 'border-white/[0.08] shadow-[0_15px_40px_rgba(0,0,0,0.5)] opacity-95'
          }`}
        >
          {/* Titlebar - Drag Handle Always Active */}
          <div 
            onDoubleClick={() => maximizeWindow(win.id)}
            className="window-titlebar h-10 bg-[#181825]/90 border-b border-white/[0.08] flex items-center px-4 shrink-0 select-none relative drag-handle cursor-move"
          >
          {/* Authentic macOS Traffic Lights */}
          <div 
            className="flex items-center space-x-2 mr-4 relative"
            onMouseEnter={() => setControlsHovered(true)}
            onMouseLeave={() => setControlsHovered(false)}
          >
            {/* Close */}
            <button 
              onClick={(e) => { e.stopPropagation(); closeWindow(win.id); }} 
              className={`mac-traffic-light w-3 h-3 rounded-full flex items-center justify-center transition-all border border-black/20 ${
                !win.focused && !controlsHovered 
                  ? 'bg-[#5a5a68]' 
                  : 'bg-[#FF5F56] hover:brightness-110 active:brightness-90 shadow-sm'
              }`}
              title="Close (⌘W)"
            >
              <span className={`text-[9px] font-bold text-black/60 leading-none transition-opacity ${controlsHovered ? 'opacity-100' : 'opacity-0'}`}>
                ✕
              </span>
            </button>

            {/* Minimize */}
            <button 
              onClick={(e) => { e.stopPropagation(); minimizeWindow(win.id); }} 
              className={`mac-traffic-light w-3 h-3 rounded-full flex items-center justify-center transition-all border border-black/20 ${
                !win.focused && !controlsHovered 
                  ? 'bg-[#5a5a68]' 
                  : 'bg-[#FFBD2E] hover:brightness-110 active:brightness-90 shadow-sm'
              }`}
              title="Minimize (⌘M)"
            >
              <span className={`text-[10px] font-bold text-black/60 leading-none transition-opacity pb-0.5 ${controlsHovered ? 'opacity-100' : 'opacity-0'}`}>
                −
              </span>
            </button>

            {/* Maximize / Zoom & Snap Controls Menu Trigger */}
            <div 
              className="relative"
              onMouseEnter={handleGreenButtonHoverEnter}
              onMouseLeave={handleGreenButtonHoverLeave}
            >
              <button 
                onClick={(e) => { 
                  e.stopPropagation(); 
                  setShowSnapMenu(false);
                  maximizeWindow(win.id); 
                }} 
                className={`mac-traffic-light w-3 h-3 rounded-full flex items-center justify-center transition-all border border-black/20 ${
                  !win.focused && !controlsHovered 
                    ? 'bg-[#5a5a68]' 
                    : 'bg-[#27C93F] hover:brightness-110 active:brightness-90 shadow-sm'
                }`}
                title="Hover for Split & Snapping Options | Click to Maximize"
              >
                <span className={`text-[8px] font-bold text-black/60 leading-none transition-opacity ${controlsHovered ? 'opacity-100' : 'opacity-0'}`}>
                  +
                </span>
              </button>

              {/* macOS Sonoma / Windows 11 Snap Assist Hover Menu */}
              <AnimatePresence>
                {showSnapMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 4, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute left-0 top-6 z-[99999] w-64 bg-[#1e1e2e]/98 backdrop-blur-2xl border border-white/20 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] p-3 text-white space-y-2.5 font-sans"
                    onMouseEnter={() => {
                      if (snapMenuTimeoutRef.current) clearTimeout(snapMenuTimeoutRef.current);
                      setShowSnapMenu(true);
                    }}
                    onMouseLeave={handleGreenButtonHoverLeave}
                  >
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-1">
                      Snap & Split Window
                    </div>

                    {/* 1. Left / Right Half Split (50% / 50%) */}
                    <div className="space-y-1">
                      <div className="text-[11px] text-gray-300 font-medium px-1 flex items-center space-x-1.5">
                        <Columns className="w-3.5 h-3.5 text-blue-400" />
                        <span>Half Screen (2 Apps)</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/30 rounded-xl border border-white/5">
                        <button
                          onClick={() => { snapWindow(win.id, 'left'); setShowSnapMenu(false); }}
                          className="h-10 rounded-lg bg-white/5 hover:bg-blue-600/50 border border-white/10 hover:border-blue-400 flex flex-col items-center justify-center text-[10px] transition-all group"
                          title="Snap Left Half (50%)"
                        >
                          <div className="w-5 h-3 border border-white/40 rounded-sm flex">
                            <span className="w-1/2 h-full bg-blue-500 rounded-l-[1px]" />
                          </div>
                          <span className="text-[9px] mt-0.5 text-gray-300 group-hover:text-white">Left 50%</span>
                        </button>
                        <button
                          onClick={() => { snapWindow(win.id, 'right'); setShowSnapMenu(false); }}
                          className="h-10 rounded-lg bg-white/5 hover:bg-blue-600/50 border border-white/10 hover:border-blue-400 flex flex-col items-center justify-center text-[10px] transition-all group"
                          title="Snap Right Half (50%)"
                        >
                          <div className="w-5 h-3 border border-white/40 rounded-sm flex">
                            <span className="w-1/2 h-full" />
                            <span className="w-1/2 h-full bg-blue-500 rounded-r-[1px]" />
                          </div>
                          <span className="text-[9px] mt-0.5 text-gray-300 group-hover:text-white">Right 50%</span>
                        </button>
                      </div>
                    </div>

                    {/* 2. 4-Way Quarter Split (4 Simultaneous Apps) */}
                    <div className="space-y-1">
                      <div className="text-[11px] text-gray-300 font-medium px-1 flex items-center space-x-1.5">
                        <LayoutGrid className="w-3.5 h-3.5 text-purple-400" />
                        <span>Quarter Split (4 Apps)</span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 p-1 bg-black/30 rounded-xl border border-white/5">
                        <button
                          onClick={() => { snapWindow(win.id, 'top-left'); setShowSnapMenu(false); }}
                          className="h-9 rounded-lg bg-white/5 hover:bg-purple-600/50 border border-white/10 hover:border-purple-400 flex items-center justify-center space-x-1.5 text-[9px] text-gray-300 hover:text-white transition-all"
                        >
                          <span className="w-2.5 h-2.5 bg-purple-500 rounded-[2px]" />
                          <span>Top Left</span>
                        </button>
                        <button
                          onClick={() => { snapWindow(win.id, 'top-right'); setShowSnapMenu(false); }}
                          className="h-9 rounded-lg bg-white/5 hover:bg-purple-600/50 border border-white/10 hover:border-purple-400 flex items-center justify-center space-x-1.5 text-[9px] text-gray-300 hover:text-white transition-all"
                        >
                          <span className="w-2.5 h-2.5 bg-purple-500 rounded-[2px]" />
                          <span>Top Right</span>
                        </button>
                        <button
                          onClick={() => { snapWindow(win.id, 'bottom-left'); setShowSnapMenu(false); }}
                          className="h-9 rounded-lg bg-white/5 hover:bg-purple-600/50 border border-white/10 hover:border-purple-400 flex items-center justify-center space-x-1.5 text-[9px] text-gray-300 hover:text-white transition-all"
                        >
                          <span className="w-2.5 h-2.5 bg-purple-500 rounded-[2px]" />
                          <span>Bottom Left</span>
                        </button>
                        <button
                          onClick={() => { snapWindow(win.id, 'bottom-right'); setShowSnapMenu(false); }}
                          className="h-9 rounded-lg bg-white/5 hover:bg-purple-600/50 border border-white/10 hover:border-purple-400 flex items-center justify-center space-x-1.5 text-[9px] text-gray-300 hover:text-white transition-all"
                        >
                          <span className="w-2.5 h-2.5 bg-purple-500 rounded-[2px]" />
                          <span>Bottom Right</span>
                        </button>
                      </div>
                    </div>

                    {/* 3. Maximize & Full Screen */}
                    <div className="pt-1 border-t border-white/10 space-y-1">
                      <button
                        onClick={() => { maximizeWindow(win.id); setShowSnapMenu(false); }}
                        className="w-full py-1.5 px-2 rounded-lg hover:bg-white/10 text-left text-xs flex items-center justify-between text-gray-200 hover:text-white transition-colors"
                      >
                        <div className="flex items-center space-x-2">
                          <Maximize2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{isMaximized ? 'Restore Window Size' : 'Maximize Workspace'}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 font-mono">⌘F</span>
                      </button>

                      <button
                        onClick={() => { toggleFullscreen(win.id); setShowSnapMenu(false); }}
                        className="w-full py-1.5 px-2 rounded-lg hover:bg-white/10 text-left text-xs flex items-center justify-between text-gray-200 hover:text-white transition-colors"
                      >
                        <div className="flex items-center space-x-2">
                          <Monitor className="w-3.5 h-3.5 text-blue-400" />
                          <span>{isFullScreen ? 'Exit Full Screen' : 'Enter Full Screen'}</span>
                        </div>
                        <span className="text-[10px] text-gray-400 font-mono">F11</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Window Title & Location Indicator */}
          <div className="window-title-text flex-1 flex items-center justify-center space-x-1.5 font-medium text-xs text-gray-200 tracking-tight truncate drop-shadow-sm select-none">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-location-pulse shrink-0" title="Active Server Process" />
            <span className="truncate">{win.title}</span>
            {isBusy && <RefreshCw className="w-3 h-3 text-blue-400 animate-spin ml-1 shrink-0" />}
          </div>

          {/* Window status indicators / Fullscreen button */}
          <div className="flex items-center space-x-1">
            {isFullScreen && (
              <button
                onClick={() => toggleFullscreen(win.id)}
                className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] text-white flex items-center space-x-1 transition-colors"
                title="Exit Full Screen (Esc / F11)"
              >
                <Minimize2 className="w-3 h-3" />
                <span>Exit Full Screen</span>
              </button>
            )}
            <div className="w-8" />
          </div>
        </div>

        {/* Content Area */}
        <div className="window-content-canvas flex-1 overflow-hidden relative bg-[#181825]/90">
          {children}
        </div>
      </motion.div>
      </Rnd>
    </>
  );
}
