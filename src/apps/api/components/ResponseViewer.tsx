import React, { useState } from 'react';
import { 
  Copy, Check, Download, AlertCircle, Clock, 
  HardDrive, Server, FileCode, CheckCircle2, Search, WrapText, Radio, Code2 
} from 'lucide-react';
import { ApiResponsePayload } from '../../../lib/tauri-bridge';

interface ResponseViewerProps {
  response: ApiResponsePayload | null;
  isLoading: boolean;
  error: string | null;
}

export default function ResponseViewer({ response, isLoading, error }: ResponseViewerProps) {
  const [activeRespTab, setActiveRespTab] = useState<'pretty' | 'raw' | 'preview' | 'headers' | 'cookies'>('pretty');
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [wrapText, setWrapText] = useState(true);

  const handleCopyBody = () => {
    if (!response?.body) return;
    navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!response) return;
    const blob = new Blob([response.body], {
      type: response.is_json ? 'application/json' : 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response_${response.status}_${Date.now()}.${response.is_json ? 'json' : 'txt'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Status badge styling
  const getStatusBadge = (status: number) => {
    if (status >= 200 && status < 300) {
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    } else if (status >= 300 && status < 400) {
      return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    } else if (status >= 400 && status < 500) {
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    } else {
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Format JSON if valid
  let formattedJson = response?.body || '';
  if (response?.is_json) {
    try {
      formattedJson = JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      formattedJson = response.body;
    }
  }

  // Parse Cookies from Set-Cookie headers
  const cookiesList = response?.headers
    ? Object.entries(response.headers)
        .filter(([k]) => k.toLowerCase() === 'set-cookie')
        .map(([_, v]) => v)
    : [];

  return (
    <div className="flex flex-col h-full bg-[#181825] border-t border-white/[0.08] select-none overflow-hidden">
      {/* Top Response Metadata Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.08] bg-[#14141e]/80 shrink-0">
        <div className="flex items-center space-x-3">
          {response && (
            <div className={`px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold border flex items-center space-x-1.5 ${getStatusBadge(response.status)}`}>
              <span>{response.status}</span>
              <span>{response.status_text || 'OK'}</span>
            </div>
          )}

          {response && (
            <div className="flex items-center space-x-3 text-xs font-mono text-gray-400">
              <span className="flex items-center space-x-1 text-emerald-400">
                <Clock className="w-3.5 h-3.5" />
                <span>{response.duration_ms} ms</span>
              </span>

              <span className="flex items-center space-x-1 text-blue-400">
                <HardDrive className="w-3.5 h-3.5" />
                <span>{formatBytes(response.size_bytes)}</span>
              </span>

              {response.tunnel_used && (
                <span className="flex items-center space-x-1 text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-md border border-purple-500/20 text-[11px]" title={response.tunneled_target}>
                  <Server className="w-3 h-3" />
                  <span>SSH Tunnel Active</span>
                </span>
              )}
            </div>
          )}

          {!response && !isLoading && !error && (
            <span className="text-xs text-gray-500 font-medium">Response Inspector</span>
          )}
        </div>

        {/* Response Sub-tabs and Actions */}
        {response && (
          <div className="flex items-center space-x-2">
            <div className="flex items-center bg-white/[0.04] rounded-lg p-0.5 border border-white/10">
              <button
                type="button"
                onClick={() => setActiveRespTab('pretty')}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                  activeRespTab === 'pretty' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Pretty
              </button>
              <button
                type="button"
                onClick={() => setActiveRespTab('raw')}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                  activeRespTab === 'raw' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Raw
              </button>
              <button
                type="button"
                onClick={() => setActiveRespTab('headers')}
                className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                  activeRespTab === 'headers' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Headers ({Object.keys(response.headers).length})
              </button>
              {cookiesList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveRespTab('cookies')}
                  className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-all ${
                    activeRespTab === 'cookies' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Cookies ({cookiesList.length})
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={handleCopyBody}
              className="p-1.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg text-xs transition-colors cursor-pointer"
              title="Copy Response Body"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              className="p-1.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg text-xs transition-colors cursor-pointer"
              title="Download Response Body"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Response Body Area */}
      <div className="flex-1 overflow-y-auto p-4 relative font-mono text-xs scrollbar-thin">
        {/* Loading Spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#181825]/90 backdrop-blur-sm z-20 space-y-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <div className="text-xs text-blue-400 font-semibold tracking-wide">
              Sending API request...
            </div>
            <div className="text-[11px] text-gray-500">
              Executing request via SSH connection
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300 space-y-2">
            <div className="flex items-center space-x-2 font-bold text-sm">
              <AlertCircle className="w-4 h-4 text-rose-400" />
              <span>Request Failed</span>
            </div>
            <div className="text-xs font-mono bg-black/30 p-3 rounded-xl border border-rose-500/20 whitespace-pre-wrap">
              {error}
            </div>
            <div className="text-[11px] text-gray-400 pt-1">
              • If accessing private internal services (e.g. <code className="text-white">localhost:8080</code>), ensure the remote server is active and the port is listening.<br />
              • Check that the SSH connection is connected.
            </div>
          </div>
        )}

        {/* Empty State */}
        {!response && !isLoading && !error && (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 space-y-3 py-16">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-blue-400 shadow-lg">
              <Radio className="w-6 h-6 opacity-60" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-gray-300">No Response Yet</div>
              <div className="text-xs text-gray-500 max-w-sm">
                Enter your target URL above and click <span className="text-blue-400 font-bold">Send</span> to view HTTP response headers, JSON payloads, and round-trip latency.
              </div>
            </div>
          </div>
        )}

        {/* Pretty JSON Response */}
        {response && activeRespTab === 'pretty' && (
          <div className="relative">
            {response.is_binary ? (
              <div className="p-6 text-center space-y-2 bg-[#14141e] rounded-2xl border border-white/10">
                <FileCode className="w-8 h-8 text-blue-400 mx-auto" />
                <div className="text-sm font-semibold text-gray-200">Binary Response</div>
                <div className="text-xs text-gray-400">
                  Received {formatBytes(response.size_bytes)} of raw binary data.
                </div>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5 mt-2"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Binary File</span>
                </button>
              </div>
            ) : (
              <pre className="p-4 bg-[#11111b] rounded-2xl border border-white/10 text-gray-200 text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner">
                <code>{formattedJson}</code>
              </pre>
            )}
          </div>
        )}

        {/* Raw Response */}
        {response && activeRespTab === 'raw' && (
          <div className="relative">
            <pre className="p-4 bg-[#11111b] rounded-2xl border border-white/10 text-gray-200 text-xs overflow-x-auto whitespace-pre-wrap leading-relaxed shadow-inner">
              <code>{response.body}</code>
            </pre>
          </div>
        )}

        {/* Headers Table */}
        {response && activeRespTab === 'headers' && (
          <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#14141e]">
            <div className="grid grid-cols-12 bg-white/[0.04] text-[11px] font-semibold text-gray-400 border-b border-white/10 px-4 py-2">
              <span className="col-span-5">Header Key</span>
              <span className="col-span-7">Header Value</span>
            </div>
            {Object.entries(response.headers).map(([key, value], idx) => (
              <div key={idx} className="grid grid-cols-12 border-b border-white/[0.05] px-4 py-2 hover:bg-white/[0.02] text-xs">
                <span className="col-span-5 font-bold text-blue-300 truncate">{key}</span>
                <span className="col-span-7 text-gray-300 break-all select-all font-mono">{value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Cookies */}
        {response && activeRespTab === 'cookies' && (
          <div className="space-y-2">
            {cookiesList.map((c, idx) => (
              <div key={idx} className="p-3 bg-[#14141e] border border-white/10 rounded-xl text-xs font-mono text-gray-300 select-all">
                {c}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
