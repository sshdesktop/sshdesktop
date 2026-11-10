import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import { 
  Info, X, RefreshCw, Copy, Check, FileCode,
  ZoomIn, ZoomOut, WrapText, Download
} from 'lucide-react';
import { ContainerItem, ContainerInspectData } from '../types';
import { DockerCommandSnippet } from './DockerCodeViewer';

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
  const [inspectTab, setInspectTab] = useState<'overview' | 'env' | 'ports' | 'mounts' | 'raw'>('overview');
  const [copiedJson, setCopiedJson] = useState(false);
  const [editorFontSize, setEditorFontSize] = useState<number>(12);
  const [isWordWrap, setIsWordWrap] = useState<boolean>(true);

  if (!container) return null;

  const rawJsonString = inspectData?.rawJson || JSON.stringify(inspectData, null, 2);

  const handleCopyJson = () => {
    navigator.clipboard.writeText(rawJsonString);
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
  };

  const handleDownloadJson = () => {
    const blob = new Blob([rawJsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docker-inspect-${container.name || container.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-50 flex items-center justify-center p-6 animate-in fade-in duration-200">
      <div className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col h-[620px]">
        {/* Header */}
        <div className="px-6 py-4 bg-[#141422] border-b border-white/10 flex items-center justify-between shrink-0">
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

        {/* CLI Command Preview Snippet */}
        <div className="px-6 py-2 bg-[#12131d] border-b border-white/10">
          <DockerCommandSnippet 
            command={`docker inspect ${container.id}`}
            label="CLI Command"
          />
        </div>

        {/* Inspector Navigation Tabs */}
        <div className="px-6 bg-[#161622] border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-4">
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
            <button
              onClick={() => setInspectTab('raw')}
              className={`py-2.5 text-xs font-medium border-b-2 transition-all cursor-pointer flex items-center space-x-1.5 ${
                inspectTab === 'raw' ? 'border-purple-500 text-purple-400 font-semibold' : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Raw JSON (Monaco)</span>
            </button>
          </div>

          {inspectTab === 'raw' && (
            <div className="flex items-center space-x-2 py-1.5">
              {/* Zoom controls */}
              <div className="flex items-center bg-white/5 rounded-lg border border-white/10 px-1 py-0.5 space-x-1 text-gray-300">
                <button
                  type="button"
                  onClick={() => setEditorFontSize(prev => Math.max(9, prev - 1))}
                  className="hover:text-white text-gray-400 p-0.5 cursor-pointer"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <span className="text-[10px] font-mono px-0.5">{editorFontSize}px</span>
                <button
                  type="button"
                  onClick={() => setEditorFontSize(prev => Math.min(22, prev + 1))}
                  className="hover:text-white text-purple-400 p-0.5 cursor-pointer"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
              </div>

              {/* Word wrap */}
              <button
                type="button"
                onClick={() => setIsWordWrap(!isWordWrap)}
                className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                  isWordWrap ? 'bg-purple-600/30 text-purple-300 border-purple-500/40' : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                }`}
                title="Toggle Word Wrap"
              >
                <WrapText className="w-3.5 h-3.5" />
              </button>

              {/* Download JSON */}
              <button
                type="button"
                onClick={handleDownloadJson}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 cursor-pointer"
                title="Download JSON File"
              >
                <Download className="w-3.5 h-3.5 text-amber-400" />
              </button>

              {/* Copy JSON */}
              <button
                type="button"
                onClick={handleCopyJson}
                className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs flex items-center space-x-1 cursor-pointer"
              >
                {copiedJson ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedJson ? 'Copied' : 'Copy JSON'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isLoading ? (
            <div className="flex items-center justify-center h-full space-x-2 text-gray-400 text-xs">
              <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
              <span>Loading container metadata...</span>
            </div>
          ) : inspectData ? (
            <>
              {inspectTab === 'overview' && (
                <div className="p-6 overflow-y-auto space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-[#14141e] p-4 rounded-2xl border border-white/10 space-y-2.5 shadow-sm">
                      <span className="text-[11px] text-gray-400 block font-medium uppercase tracking-wider">Container Identity</span>
                      <div className="text-xs font-mono"><span className="text-gray-500">Image:</span> <span className="text-purple-300 font-semibold">{inspectData.image}</span></div>
                      <div className="text-xs font-mono"><span className="text-gray-500">Status:</span> <span className="text-emerald-400 font-bold">{inspectData.status}</span></div>
                      <div className="text-xs font-mono"><span className="text-gray-500">Restart Policy:</span> <span className="text-amber-300">{inspectData.restartPolicy}</span></div>
                      <div className="text-xs font-mono"><span className="text-gray-500">Started:</span> <span className="text-gray-300">{inspectData.startedAt}</span></div>
                    </div>

                    <div className="bg-[#14141e] p-4 rounded-2xl border border-white/10 space-y-2.5 shadow-sm">
                      <span className="text-[11px] text-gray-400 block font-medium uppercase tracking-wider">Networking & Bridge</span>
                      <div className="text-xs font-mono"><span className="text-gray-500">IP Address:</span> <span className="text-cyan-300 font-bold">{inspectData.ipAddress}</span></div>
                      <div className="text-xs font-mono"><span className="text-gray-500">Gateway:</span> <span className="text-gray-300">{inspectData.gateway}</span></div>
                      <div className="text-xs font-mono"><span className="text-gray-500">MAC Address:</span> <span className="text-gray-400">{inspectData.macAddress}</span></div>
                    </div>
                  </div>
                </div>
              )}

              {inspectTab === 'env' && (
                <div className="p-6 overflow-y-auto">
                  <div className="bg-[#14141e] rounded-2xl border border-white/10 overflow-hidden shadow-sm">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[#101018] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                        <tr>
                          <th className="py-2.5 px-4 w-1/3">Key</th>
                          <th className="py-2.5 px-4">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {inspectData.env.map((eStr, i) => {
                          const [k, ...v] = eStr.split('=');
                          const val = v.join('=');
                          return (
                            <tr key={i} className="hover:bg-white/[0.03] transition-colors">
                              <td className="py-2 px-4 text-cyan-300 font-semibold">{k}</td>
                              <td className="py-2 px-4 text-amber-200 break-all select-text font-mono">{val}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {inspectTab === 'ports' && (
                <div className="p-6 overflow-y-auto">
                  <div className="bg-[#14141e] rounded-2xl border border-white/10 overflow-hidden shadow-sm">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[#101018] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                        <tr>
                          <th className="py-2.5 px-4">Host Port</th>
                          <th className="py-2.5 px-4">Direction</th>
                          <th className="py-2.5 px-4">Container Port</th>
                          <th className="py-2.5 px-4">Protocol</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {inspectData.ports.map((p, i) => (
                          <tr key={i} className="hover:bg-white/[0.03] transition-colors">
                            <td className="py-2.5 px-4 text-emerald-400 font-bold">{p.hostPort}</td>
                            <td className="py-2.5 px-4 text-purple-400">→</td>
                            <td className="py-2.5 px-4 text-sky-300 font-bold">{p.containerPort}</td>
                            <td className="py-2.5 px-4">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                {p.protocol}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {inspectTab === 'mounts' && (
                <div className="p-6 overflow-y-auto">
                  <div className="bg-[#14141e] rounded-2xl border border-white/10 overflow-hidden shadow-sm">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-[#101018] text-gray-400 border-b border-white/10 text-[10px] uppercase">
                        <tr>
                          <th className="py-2.5 px-4">Host Source</th>
                          <th className="py-2.5 px-4">Container Destination</th>
                          <th className="py-2.5 px-4 w-24">Mode</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {inspectData.mounts.map((m, i) => (
                          <tr key={i} className="hover:bg-white/[0.03] transition-colors">
                            <td className="py-2.5 px-4 text-gray-300 break-all">{m.source}</td>
                            <td className="py-2.5 px-4 text-sky-300 break-all font-semibold">{m.destination}</td>
                            <td className="py-2.5 px-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${
                                m.mode.includes('rw') ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                              }`}>
                                {m.mode}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {inspectTab === 'raw' && (
                <div className="flex-1 min-h-0 bg-[#0d0d17] relative">
                  <Editor
                    height="100%"
                    language="json"
                    theme="vs-dark"
                    value={rawJsonString}
                    options={{
                      readOnly: true,
                      domReadOnly: true,
                      fontSize: editorFontSize,
                      wordWrap: isWordWrap ? 'on' : 'off',
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace",
                      lineNumbers: 'on',
                      padding: { top: 10, bottom: 10 },
                    }}
                    loading={
                      <div className="h-full flex items-center justify-center text-xs text-gray-500 font-mono">
                        Loading Docker inspect JSON...
                      </div>
                    }
                  />
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
