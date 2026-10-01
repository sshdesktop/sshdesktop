import React from 'react';
import { useNotificationStore } from '../lib/store';
import { motion, AnimatePresence } from 'framer-motion';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

export default function NotificationCenter() {
  const { notifications, markRead } = useNotificationStore();
  const unread = notifications.filter(n => !n.read).slice(0, 3); // show latest 3 toasts

  return (
    <div className="absolute top-12 right-4 w-80 z-[150] space-y-2 pointer-events-none">
      <AnimatePresence>
        {unread.map(n => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, x: 100 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 100 }}
            className="p-4 rounded-xl bg-[var(--surface)]/90 backdrop-blur border border-white/10 shadow-2xl flex items-start space-x-3 pointer-events-auto"
          >
            {n.type === 'success' && <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />}
            {n.type === 'error' && <AlertCircle className="w-5 h-5 text-red-400 mt-0.5" />}
            {n.type === 'info' && <Info className="w-5 h-5 text-blue-400 mt-0.5" />}
            <div className="flex-1">
              <h4 className="font-semibold text-sm">{n.title}</h4>
              <p className="text-xs text-gray-400 mt-1">{n.message}</p>
            </div>
            <button onClick={() => markRead(n.id)} className="text-gray-500 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
