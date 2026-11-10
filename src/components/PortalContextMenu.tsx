import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

export interface PortalContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  zIndex?: number;
}

/**
 * Universal Portal-based Context Menu.
 * 
 * Attaches directly to document.body via createPortal so it is never trapped
 * or clipped by parent CSS transforms (react-rnd), backdrop-filters, or overflow:hidden.
 * Automatically measures its rendered dimensions and clamps coordinates to the viewport
 * so it is always 100% visible regardless of window size or position.
 */
export const PortalContextMenu: React.FC<PortalContextMenuProps> = ({
  x,
  y,
  onClose,
  children,
  className = '',
  zIndex = 999999,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ left: number; top: number }>({
    left: Math.max(10, Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 1000) - 240)),
    top: Math.max(10, Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 300)),
  });

  useLayoutEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const w = rect.width || 220;
      const h = rect.height || 260;
      const winW = window.innerWidth;
      const winH = window.innerHeight;

      // Clamp so the menu never exceeds viewport bounds
      const clampedX = Math.max(8, Math.min(x, winW - w - 8));
      const clampedY = Math.max(8, Math.min(y, winH - h - 8));

      setCoords({ left: clampedX, top: clampedY });
    }
  }, [x, y]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    // Close when the browser window is resized
    const handleResize = () => {
      onClose();
    };

    document.addEventListener('mousedown', handleOutside, true);
    window.addEventListener('keydown', handleKey, true);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('mousedown', handleOutside, true);
      window.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        zIndex,
      }}
      className={`portal-context-menu select-none animate-in fade-in zoom-in-95 duration-100 ${className}`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
};
