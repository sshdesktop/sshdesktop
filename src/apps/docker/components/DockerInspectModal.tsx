import React, { useState } from 'react';
import { Info, X, RefreshCw } from 'lucide-react';
import { ContainerItem, ContainerInspectData } from '../types';

interface DockerInspectModalProps {
  container: ContainerItem | null;
  inspectData: ContainerInspectData | null;
  isLoading: boolean;
  onClose: () => void;
}

export const DockerInspectModal: React.FC<DockerInspectModalProps> = ({
  container,
  inspectData,
  isLoading,
  onClose,
}) => {
  const [inspectTab, setInspectTab] = useState<'overview' | 'env' | 'ports' | 'mounts'>('overview');

  if (!container) return null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col h-[580px]">
        {/* Header */}
        <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-xl bg-purple-600/30 border border-purple-400/30 flex items-center justify-center">
              <Info className="w-4 h-4 text-purple-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center space-x-2">
                <span>{container.name}</span>
                <span className="font-mono text-xs text-gray-400 font-normal">({container.id})</span>
              </h3>
              <p className="text-[11px] text-gray-400">Detailed container inspection & metadata</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Inspector Navigation Tabs */}
        <div className="px-6 bg-[#161622] border-b border-white/10 flex items-center space-x-4">
          <button
            onClick={() => setInspectTab('overview')}
            className={`py-2.5 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              inspectTab === 'overview' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Overview & Network
          </button>
          <button
            onClick={() => setInspectTab('env')}
            className={`py-2.5 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              inspectTab === 'env' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Environment ({inspectData?.env.length || 0})
          </button>
          <button
            onClick={() => setInspectTab('ports')}
            className={`py-2.5 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              inspectTab === 'ports' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Port Bindings ({inspectData?.ports.length || 0})
          </button>
          <button
            onClick={() => setInspectTab('mounts')}
            className={`py-2.5 text-xs font-medium border-b-2 transition-all cursor-pointer ${
              inspectTab === 'mounts' ? 'border-blue-500 text-blue-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            Mounts & Volumes ({inspectData?.mounts.length || 0})
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 p-6 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-full space-x-2 text-gray-400 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
              <span>Loading container metadata...</span>
            </div>
          ) : inspectData ? (
            <>
              {inspectTab === 'overview' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#14141e] p-3.5 rounded-xl border border-white/10 space-y-2">
                      <span className="text-[11px] text-gray-400 block font-medium">Container Identity</span>
                      <div className="text-xs font-mono"><span className="text-gray-500">Image:</span> {inspectData.image}</div>
                      <div className="text-xs font-mono"><span className="text-gray-500">Status:</span> {inspectData.status}</div>
                      <div className="text-xs font-mono"><span className="text-gray-500">Restart:</span> {inspectData.restartPolicy}</div>
                      <div className="text-xs font-mono"><span className="text-gray-500">Started:</span> {inspectData.startedAt}</div>
                    </div>

                    <div className="bg-[#14141e] p-3.5 rounded-xl border border-white/10 space-y-2">
                      <span className="text-[11px] text-gray-400 block font-medium">Networking</span>
                      <div className="text-xs font-mono"><span className="text-gray-500">IP Address:</span> {inspectData.ipAddress}</div>
                      <div className="text-xs font-mono"><span className="text-gray-500">Gateway:</span> {inspectData.gateway}</div>
                      <div className="text-xs font-mono"><span className="text-gray-500">MAC Addr:</span> {inspectData.macAddress}</div>
                    </div>
                  </div>
                </div>
              )}

              {inspectTab === 'env' && (
                <div className="bg-[#14141e] rounded-xl border border-white/10 overflow-hidden">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                      <tr>
                        <th className="py-2.5 px-3 w-1/3">Key</th>
                        <th className="py-2.5 px-3">Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {inspectData.env.map((eStr, i) => {
                        const [k, ...v] = eStr.split('=');
                        return (
                          <tr key={i} className="hover:bg-white/[0.02]">
                            <td className="py-2 px-3 text-cyan-400 font-semibold">{k}</td>
                            <td className="py-2 px-3 text-gray-300 break-all select-text">{v.join('=')}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {inspectTab === 'ports' && (
                <div className="bg-[#14141e] rounded-xl border border-white/10 overflow-hidden">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Host Port</th>
                        <th className="py-2.5 px-3">Direction</th>
                        <th className="py-2.5 px-3">Container Port</th>
                        <th className="py-2.5 px-3">Protocol</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {inspectData.ports.map((p, i) => (
                        <tr key={i} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 px-3 text-emerald-400 font-bold">{p.hostPort}</td>
                          <td className="py-2.5 px-3 text-gray-500">→</td>
                          <td className="py-2.5 px-3 text-white font-bold">{p.containerPort}</td>
                          <td className="py-2.5 px-3 uppercase text-gray-400">{p.protocol}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {inspectTab === 'mounts' && (
                <div className="bg-[#14141e] rounded-xl border border-white/10 overflow-hidden">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#11111a] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Host Source</th>
                        <th className="py-2.5 px-3">Container Destination</th>
                        <th className="py-2.5 px-3 w-20">Mode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {inspectData.mounts.map((m, i) => (
                        <tr key={i} className="hover:bg-white/[0.02]">
                          <td className="py-2.5 px-3 text-gray-300 break-all">{m.source}</td>
                          <td className="py-2.5 px-3 text-blue-400 break-all">{m.destination}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                              m.mode.includes('rw') ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
                            }`}>
                              {m.mode}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
