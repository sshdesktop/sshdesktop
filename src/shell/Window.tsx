import React, { useState } from 'react';
import { Rnd } from 'react-rnd';
import { useWindowStore } from '../lib/store';
import { WindowState } from '../lib/types';
import { motion } from 'framer-motion';

export default function Window({ window, children }: { window: WindowState; children: React.ReactNode }) {
  const { focusWindow, closeWindow, minimizeWindow, maximizeWindow, updatePosition, updateSize, bringToFront } = useWindowStore();
  const [controlsHovered, setControlsHovered] = useState(false);

  if (window.minimized) return null;

  return (
    <Rnd
      size={window.maximized ? { width: '100%', height: '100%' } : { width: window.width, height: window.height }}
      position={window.maximized ? { x: 0, y: 0 } : { x: window.x, y: window.y }}
      onDragStop={(e, d) => !window.maximized && updatePosition(window.id, d.x, d.y)}
      onResizeStop={(e, direction, ref, delta, position) => {
        if (!window.maximized) {
          updateSize(window.id, parseInt(ref.style.width, 10), parseInt(ref.style.height, 10));
          updatePosition(window.id, position.x, position.y);
        }
      }}
      minWidth={360}
      minHeight={240}
      bounds="window"
      dragHandleClassName="drag-handle"
      disableDragging={window.maximized}
      onMouseDown={() => { focusWindow(window.id); bringToFront(window.id); }}
      className="absolute"
      style={{ zIndex: window.zIndex }}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className={`w-full h-full flex flex-col bg-[#1e1e2e]/95 backdrop-blur-3xl rounded-2xl overflow-hidden transition-all duration-200 border ${
          window.focused 
            ? 'border-white/15 shadow-[0_30px_80px_-15px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.15)] ring-1 ring-white/10' 
            : 'border-white/[0.08] shadow-[0_15px_40px_rgba(0,0,0,0.5)] opacity-95'
        }`}
      >
        {/* macOS Titlebar */}
        <div 
          onDoubleClick={() => maximizeWindow(window.id)}
          className="h-10 bg-[#181825]/90 border-b border-white/[0.08] flex items-center px-4 shrink-0 drag-handle cursor-move select-none"
        >
          {/* Authentic macOS Traffic Lights */}
          <div 
            className="flex items-center space-x-2 mr-4"
            onMouseEnter={() => setControlsHovered(true)}
            onMouseLeave={() => setControlsHovered(false)}
          >
            {/* Close */}
            <button 
              onClick={(e) => { e.stopPropagation(); closeWindow(window.id); }} 
              className={`w-3 h-3 rounded-full flex items-center justify-center transition-all border border-black/20 ${
                !window.focused && !controlsHovered 
                  ? 'bg-[#5a5a68]' 
                  : 'bg-[#FF5F56] hover:brightness-110 active:brightness-90'
              }`}
              title="Close (⌘W)"
            >
              <span className={`text-[9px] font-bold text-black/60 leading-none transition-opacity ${controlsHovered ? 'opacity-100' : 'opacity-0'}`}>
                ✕
              </span>
            </button>

            {/* Minimize */}
            <button 
              onClick={(e) => { e.stopPropagation(); minimizeWindow(window.id); }} 
              className={`w-3 h-3 rounded-full flex items-center justify-center transition-all border border-black/20 ${
                !window.focused && !controlsHovered 
                  ? 'bg-[#5a5a68]' 
                  : 'bg-[#FFBD2E] hover:brightness-110 active:brightness-90'
              }`}
              title="Minimize (⌘M)"
            >
              <span className={`text-[10px] font-bold text-black/60 leading-none transition-opacity pb-0.5 ${controlsHovered ? 'opacity-100' : 'opacity-0'}`}>
                −
              </span>
            </button>

            {/* Maximize */}
            <button 
              onClick={(e) => { e.stopPropagation(); maximizeWindow(window.id); }} 
              className={`w-3 h-3 rounded-full flex items-center justify-center transition-all border border-black/20 ${
                !window.focused && !controlsHovered 
                  ? 'bg-[#5a5a68]' 
                  : 'bg-[#27C93F] hover:brightness-110 active:brightness-90'
              }`}
              title="Zoom / Fullscreen (⌘F)"
            >
              <span className={`text-[8px] font-bold text-black/60 leading-none transition-opacity ${controlsHovered ? 'opacity-100' : 'opacity-0'}`}>
                +
              </span>
            </button>
          </div>

          {/* Window Title */}
          <div className="flex-1 text-center font-medium text-xs text-gray-200 tracking-tight truncate drop-shadow-sm">
            {window.title}
          </div>

          <div className="w-16" /> {/* Spacer for balance */}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative bg-[#181825]/90">
          {children}
        </div>
      </motion.div>
    </Rnd>
  );
}
