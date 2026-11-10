import React from 'react';
import { AlertTriangle, Trash2, X, AlertCircle } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  details?: string;
  confirmText?: string;
  confirmLabel?: string;
  cancelText?: string;
  confirmStyle?: 'danger' | 'warning' | 'primary';
  danger?: boolean;
  isLoading?: boolean;
  onConfirm: () => void;
  onClose?: () => void;
  onCancel?: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  details,
  confirmText,
  confirmLabel,
  cancelText = 'Cancel',
  confirmStyle,
  danger,
  isLoading = false,
  onConfirm,
  onClose,
  onCancel,
}) => {
  if (!isOpen) return null;

  const handleClose = () => {
    if (onCancel) onCancel();
    else if (onClose) onClose();
  };

  const resolvedConfirmText = confirmLabel || confirmText || 'Delete';
  const resolvedStyle = danger ? 'danger' : (confirmStyle || 'danger');

  const getStyleClasses = () => {
    switch (resolvedStyle) {
      case 'warning':
        return 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30';
      case 'primary':
        return 'bg-blue-600 hover:bg-blue-500 shadow-blue-600/30';
      case 'danger':
      default:
        return 'bg-red-600 hover:bg-red-500 shadow-red-600/30';
    }
  };

  const getIcon = () => {
    switch (resolvedStyle) {
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-400" />;
      case 'primary':
        return <AlertCircle className="w-5 h-5 text-blue-400" />;
      case 'danger':
      default:
        return <Trash2 className="w-5 h-5 text-red-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#1e1e2e]/95 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col animate-in fade-in zoom-in duration-150">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-black/20">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
              resolvedStyle === 'warning'
                ? 'bg-amber-500/10 border-amber-500/20'
                : resolvedStyle === 'primary'
                  ? 'bg-blue-500/10 border-blue-500/20'
                  : 'bg-red-500/10 border-red-500/20'
            }`}>
              {getIcon()}
            </div>
            <h3 className="text-sm font-semibold text-white tracking-wide">{title}</h3>
          </div>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-300 leading-relaxed">{message}</p>

          {details && (
            <div className="p-3 bg-black/40 border border-white/10 rounded-xl overflow-x-auto">
              <pre className="text-[11px] font-mono text-amber-300/90 whitespace-pre-wrap break-all leading-tight">
                {details}
              </pre>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-6 py-3.5 border-t border-white/10 bg-black/20 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={handleClose}
            disabled={isLoading}
            className="px-4 py-2 rounded-xl text-xs font-medium text-gray-300 hover:text-white bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all shadow-md flex items-center gap-2 disabled:opacity-50 ${getStyleClasses()}`}
          >
            {isLoading ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Processing...</span>
              </>
            ) : (
              <span>{resolvedConfirmText}</span>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};

export default ConfirmModal;
