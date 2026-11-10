import React, { useState } from 'react';
import { 
  Trash2, AlertTriangle, AlertCircle, Container, Layers, 
  HardDrive, Network, X, Loader2, ShieldAlert, CheckSquare, Square
} from 'lucide-react';
import { ResourceDeleteTarget } from '../types';
import { DockerCommandSnippet } from './DockerCodeViewer';

interface DockerDeleteModalProps {
  target: ResourceDeleteTarget | null;
  isDeleting: boolean;
  onClose: () => void;
  onConfirm: (target: ResourceDeleteTarget, force?: boolean) => Promise<void>;
}

export const DockerDeleteModal: React.FC<DockerDeleteModalProps> = ({
  target,
  isDeleting,
  onClose,
  onConfirm,
}) => {
  const [forceConfirmed, setForceConfirmed] = useState(false);

  if (!target) return null;

  const hasInUseDependencies = target.inUseBy && target.inUseBy.length > 0;
  const isRunningContainer = target.isRunning;
  const isBlocked = hasInUseDependencies && !target.allowForce && !forceConfirmed;

  const getIcon = () => {
    switch (target.type) {
      case 'container':
      case 'bulk-containers':
        return <Container className="w-5 h-5 text-rose-400" />;
      case 'image':
        return <Layers className="w-5 h-5 text-amber-400" />;
      case 'volume':
        return <HardDrive className="w-5 h-5 text-purple-400" />;
      case 'network':
        return <Network className="w-5 h-5 text-cyan-400" />;
      default:
        return <Trash2 className="w-5 h-5 text-rose-400" />;
    }
  };

  const getTitle = () => {
    switch (target.type) {
      case 'container':
        return isRunningContainer ? 'Force Delete Running Container' : 'Delete Container';
      case 'bulk-containers':
        return `Delete ${target.bulkIds?.length || ''} Selected Containers`;
      case 'image':
        return 'Delete Docker Image';
      case 'volume':
        return 'Delete Docker Volume';
      case 'network':
        return 'Delete Docker Network';
      default:
        return 'Delete Resource';
    }
  };

  const getTypeLabel = () => {
    switch (target.type) {
      case 'container':
        return 'Container';
      case 'bulk-containers':
        return 'Multiple Containers';
      case 'image':
        return 'Docker Image';
      case 'volume':
        return 'Storage Volume';
      case 'network':
        return 'Bridge/Overlay Network';
      default:
        return 'Resource';
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
      onClick={() => {
        if (!isDeleting) onClose();
      }}
    >
      <div 
        className="bg-[#181825] border border-rose-500/30 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/20">
              {getIcon()}
            </div>
            <div>
              <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                <span>{getTitle()}</span>
              </h3>
              <p className="text-xs text-gray-400">
                This action is permanent and cannot be undone.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isDeleting}
            className="text-gray-400 hover:text-white p-1 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Resource Details Summary */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/10 space-y-2 text-xs">
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Resource Type:</span>
            <span className="uppercase font-mono text-[11px] px-2 py-0.5 rounded bg-white/5 text-gray-300 border border-white/10">
              {getTypeLabel()}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-400">Name:</span>
            <span className="font-semibold text-white break-all text-right max-w-[260px]">{target.name}</span>
          </div>
          {target.id && (
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Identifier:</span>
              <span className="font-mono text-cyan-400 break-all text-right">{target.id}</span>
            </div>
          )}
          {target.subText && (
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Details:</span>
              <span className="text-gray-300 break-all text-right">{target.subText}</span>
            </div>
          )}
        </div>

        {/* Live CLI Command Snippet */}
        <div className="space-y-1">
          <DockerCommandSnippet 
            command={(() => {
              if (target.type === 'container') {
                return `docker rm ${isRunningContainer || forceConfirmed ? '-f ' : ''}${target.id || target.name}`;
              } else if (target.type === 'bulk-containers') {
                return `docker rm -f ${(target.bulkIds || []).join(' ')}`;
              } else if (target.type === 'image') {
                return `docker rmi ${forceConfirmed ? '-f ' : ''}${target.id || target.name}`;
              } else if (target.type === 'volume') {
                return `docker volume rm ${target.name}`;
              } else if (target.type === 'network') {
                return `docker network rm ${target.id || target.name}`;
              }
              return `docker rm ${target.id || target.name}`;
            })()}
            label="Delete CLI"
          />
        </div>

        {/* In-Use Alert: Running Container */}
        {isRunningContainer && (
          <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs space-y-1.5 animate-in fade-in">
            <div className="flex items-center space-x-2 font-semibold text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Container is Currently Running</span>
            </div>
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              This container is actively executing processes. Deleting it will immediately force-kill all active processes, terminate open socket connections, and release port bindings.
            </p>
          </div>
        )}

        {/* In-Use Alert: Dependent Containers Attached to Image/Volume/Network */}
        {hasInUseDependencies && (
          <div className="p-3.5 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs space-y-2 animate-in fade-in">
            <div className="flex items-center space-x-2 font-semibold text-rose-300">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>
                {target.type === 'image' && `Image is in use by ${target.inUseBy!.length} container(s)`}
                {target.type === 'volume' && `Volume is currently mounted by ${target.inUseBy!.length} container(s)`}
                {target.type === 'network' && `Network is currently connected to ${target.inUseBy!.length} container(s)`}
                {target.type !== 'image' && target.type !== 'volume' && target.type !== 'network' && `Resource is in use`}
              </span>
            </div>

            <p className="text-[11px] text-rose-200/90">
              {target.type === 'image' && 'The following containers were created from this image. Docker prevents removing images while containers depend on them:'}
              {target.type === 'volume' && 'The following containers have this volume mounted. Deleting it can cause storage corruption:'}
              {target.type === 'network' && 'The following containers are currently communicating on this network:'}
            </p>

            {/* List of dependent resources */}
            <div className="max-h-36 overflow-y-auto space-y-1 pr-1 bg-black/30 p-2 rounded-xl border border-rose-500/20">
              {target.inUseBy!.map((dep, idx) => (
                <div key={idx} className="flex items-center justify-between text-[11px] py-0.5 border-b border-white/5 last:border-0">
                  <span className="font-semibold text-white truncate max-w-[200px]">
                    • {dep.name}
                  </span>
                  <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono ${
                    (dep.status || '').toLowerCase().includes('running') || (dep.status || '').toLowerCase().includes('up')
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-white/10 text-gray-300'
                  }`}>
                    {dep.status || dep.id || 'Active'}
                  </span>
                </div>
              ))}
            </div>

            <p className="text-[10px] text-rose-300 italic pt-1">
              Please stop and remove the dependent container(s) above before deleting this resource.
            </p>

            {/* Force Removal Checkbox if allowed */}
            {target.allowForce && (
              <label className="flex items-center space-x-2 pt-2 cursor-pointer border-t border-rose-500/20 select-none">
                <input
                  type="checkbox"
                  checked={forceConfirmed}
                  onChange={e => setForceConfirmed(e.target.checked)}
                  className="rounded border-rose-500 text-rose-600 focus:ring-rose-500"
                />
                <span className="text-[11px] text-rose-200 font-medium">
                  I understand the risks and want to force remove this resource anyway
                </span>
              </label>
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>

          <button
            type="button"
            disabled={isDeleting || (hasInUseDependencies && !target.allowForce && !forceConfirmed)}
            onClick={() => onConfirm(target, isRunningContainer || forceConfirmed)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold shadow-lg transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              isRunningContainer
                ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/30'
                : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
            }`}
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Deleting...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {isRunningContainer 
                    ? 'Force Remove Container' 
                    : target.type === 'bulk-containers' 
                    ? `Delete ${target.bulkIds?.length} Containers`
                    : `Delete ${getTypeLabel()}`}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
