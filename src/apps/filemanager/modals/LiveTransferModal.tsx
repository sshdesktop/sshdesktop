import React from 'react';
import { Copy, Move, Upload, Download, X, AlertCircle, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { TransferState, formatRawBytes } from '../types';

interface LiveTransferModalProps {
  transfer: TransferState | null;
  onCancel: () => void;
  onClose: () => void;
}

export const LiveTransferModal: React.FC<LiveTransferModalProps> = ({
  transfer,
  onCancel,
  onClose,
}) => {
  if (!transfer || !transfer.isOpen) return null;

  const isRunning = transfer.status === 'running';
  const isCompleted = transfer.status === 'completed';
  const isError = transfer.status === 'error';
  const isCancelled = transfer.status === 'cancelled';

  const getIcon = () => {
    switch (transfer.type) {
      case 'move':
        return <Move className="w-5 h-5 text-blue-400" />;
      case 'copy':
        return <Copy className="w-5 h-5 text-purple-400" />;
      case 'upload':
        return <Upload className="w-5 h-5 text-cyan-400" />;
      case 'download':
        return <Download className="w-5 h-5 text-emerald-400" />;
    }
  };

  const getBadgeColor = () => {
    switch (transfer.type) {
      case 'move': return 'bg-blue-500/20 text-blue-300';
      case 'copy': return 'bg-purple-500/20 text-purple-300';
      case 'upload': return 'bg-cyan-500/20 text-cyan-300';
      case 'download': return 'bg-emerald-500/20 text-emerald-300';
    }
  };

  const percent = Math.min(100, Math.max(0, Math.round(transfer.progressPercent || 0)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-150">
      <div className="bg-[#181825] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
          <div className="flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${getBadgeColor()}`}>
              {getIcon()}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white capitalize">
                {transfer.title || `${transfer.type} In Progress`}
              </h3>
              <p className="text-xs text-gray-400">
                {transfer.currentCount} of {transfer.totalCount} item{transfer.totalCount > 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <button
            onClick={isRunning ? onCancel : onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Active file indicator */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-400 truncate max-w-[280px]">
                {isRunning ? (
                  <span className="flex items-center space-x-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400 shrink-0" />
                    <span className="truncate">{transfer.currentItemName || 'Processing...'}</span>
                  </span>
                ) : isCompleted ? (
                  <span className="flex items-center space-x-1.5 text-emerald-400 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Transfer completed successfully</span>
                  </span>
                ) : isError ? (
                  <span className="flex items-center space-x-1.5 text-rose-400 font-medium">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Transfer encountered an error</span>
                  </span>
                ) : (
                  <span>Transfer cancelled</span>
                )}
              </span>
              <span className="font-mono text-gray-300 font-semibold">{percent}%</span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2 bg-[#11111b] rounded-full overflow-hidden border border-white/5">
              <div
                className={`h-full transition-all duration-300 ${
                  isError
                    ? 'bg-rose-500'
                    : isCompleted
                    ? 'bg-emerald-500'
                    : transfer.type === 'move'
                    ? 'bg-blue-500'
                    : transfer.type === 'copy'
                    ? 'bg-purple-500'
                    : transfer.type === 'upload'
                    ? 'bg-cyan-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* Transfer Details Card */}
          <div className="bg-[#11111b] border border-white/5 rounded-xl p-3 text-xs space-y-2">
            <div className="flex items-center justify-between text-gray-400">
              <span>Source:</span>
              <span className="font-mono text-gray-200 truncate max-w-[240px] text-right" title={transfer.sourcePath}>
                {transfer.sourcePath || '-'}
              </span>
            </div>
            <div className="flex items-center justify-between text-gray-400">
              <span>Destination:</span>
              <span className="font-mono text-gray-200 truncate max-w-[240px] text-right" title={transfer.destPath}>
                {transfer.destPath || '-'}
              </span>
            </div>
            {transfer.totalBytes && transfer.totalBytes > 0 ? (
              <div className="flex items-center justify-between text-gray-400 pt-1 border-t border-white/5">
                <span>Data Transferred:</span>
                <span className="font-mono text-gray-200">
                  {formatRawBytes(transfer.bytesTransferred || 0)} / {formatRawBytes(transfer.totalBytes)}
                </span>
              </div>
            ) : null}
          </div>

          {/* Error Message */}
          {transfer.errorMessage && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 flex items-start space-x-2 text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-rose-200">Transfer Failed</div>
                <div className="text-[11px] opacity-90 mt-0.5 break-all">{transfer.errorMessage}</div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/10 flex items-center justify-end space-x-2.5 bg-white/[0.02]">
          {isRunning ? (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl transition-colors font-medium"
            >
              Cancel Transfer
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-white bg-white/10 hover:bg-white/15 rounded-xl transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
