import React from 'react';
import { Rnd } from 'react-rnd';
import { useWindowStore } from '../lib/store';
import { WindowState } from '../lib/types';
import { motion, AnimatePresence } from 'framer-motion';

export default function Window({ window, children }: { window: WindowState; children: React.ReactNode }) {
  const { focusWindow, closeWindow, minimizeWindow, maximizeWindow, updatePosition, updateSize, bringToFront } = useWindowStore();

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
      minWidth={300}
      minHeight={200}
      bounds="parent"
      disableDragging={window.maximized}
      onMouseDown={() => { focusWindow(window.id); bringToFront(window.id); }}
      className="absolute"
      style={{ zIndex: window.zIndex }}
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className={`w-full h-full flex flex-col bg-[var(--bg)] rounded-xl overflow-hidden shadow-2xl border border-white/10 ${
          window.focused ? 'shadow-[0_0_20px_rgba(0,0,0,0.5)]' : 'opacity-95 blur-[0.5px]'
        }`}
      >
        {/* Titlebar */}
        <div className="h-10 bg-[var(--surface)] flex items-center px-4 shrink-0 drag-handle cursor-move select-none">
          <div className="flex space-x-2 mr-4">
            <button onClick={() => closeWindow(window.id)} className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center group"><span className="opacity-0 group-hover:opacity-100 text-[8px] text-black/50">×</span></button>
            <button onClick={() => minimizeWindow(window.id)} className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 flex items-center justify-center group"><span className="opacity-0 group-hover:opacity-100 text-[8px] text-black/50">−</span></button>
            <button onClick={() => maximizeWindow(window.id)} className="w-3 h-3 rounded-full bg-green-500 hover:bg-green-600 flex items-center justify-center group"><span className="opacity-0 group-hover:opacity-100 text-[8px] text-black/50">+</span></button>
          </div>
          <div className="flex-1 text-center font-medium text-sm text-gray-300">{window.title}</div>
          <div className="w-16" /> {/* Spacer for balance */}
        </div>
        {/* Content */}
        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>
      </motion.div>
    </Rnd>
  );
}
