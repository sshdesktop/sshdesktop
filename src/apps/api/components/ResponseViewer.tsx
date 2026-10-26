import React, { useState, useMemo, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { 
  Copy, Check, Download, AlertCircle, Clock, 
  HardDrive, Server, FileCode, CheckCircle2, Search, WrapText, Radio, Code2,
  Sparkles, ZoomIn, ZoomOut, Layers, Minimize2, Shield, Eye, RefreshCw, Filter
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
  const [headerSearch, setHeaderSearch] = useState('');
  const [copiedHeaderKey, setCopiedHeaderKey] = useState<string | null>(null);

  // Editor Preferences
  const [respFontSize, setRespFontSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('sshdesktop_api_resp_fontsize');
      return saved ? parseInt(saved, 10) : 13;
    } catch {
      return 13;
    }
  });
  const [isWordWrap, setIsWordWrap] = useState<boolean>(true);
  const [showMinimap, setShowMinimap] = useState<boolean>(false);
  const [manualLang, setManualLang] = useState<string>('auto');
  const editorRef = useRef<any>(null);

  const handleUpdateFontSize = (newSize: number) => {
    const clamped = Math.max(9, Math.min(32, newSize));
    setRespFontSize(clamped);
    try {
      localStorage.setItem('sshdesktop_api_resp_fontsize', String(clamped));
    } catch {}
  };

  const handleCopyBody = () => {
    if (!response?.body) return;
    navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!response) return;
    const isHtml = detectedLanguage === 'html';
    const isXml = detectedLanguage === 'xml';
    const ext = response.is_json ? 'json' : isHtml ? 'html' : isXml ? 'xml' : 'txt';
    const blob = new Blob([response.body], {
      type: response.is_json ? 'application/json' : isHtml ? 'text/html' : 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `response_${response.status}_${Date.now()}.${ext}`;
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

  // Detect content language
  const detectedLanguage = useMemo(() => {
    if (!response) return 'plaintext';
    if (response.is_json) return 'json';
    const ct = (response.headers['content-type'] || response.headers['Content-Type'] || '').toLowerCase();
    if (ct.includes('json')) return 'json';
    if (ct.includes('html')) return 'html';
    if (ct.includes('xml')) return 'xml';
    if (ct.includes('css')) return 'css';
    if (ct.includes('javascript') || ct.includes('ecmascript')) return 'javascript';
    if (ct.includes('yaml') || ct.includes('yml')) return 'yaml';
    const trimmed = (response.body || '').trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return 'html';
    if (trimmed.startsWith('<?xml') || (trimmed.startsWith('<') && trimmed.endsWith('>'))) return 'xml';
    return 'plaintext';
  }, [response]);

  const activeLanguage = manualLang === 'auto' ? detectedLanguage : manualLang;

  // Pretty formatted body
  const prettyBody = useMemo(() => {
    if (!response?.body) return '';
    if (response.is_json || activeLanguage === 'json') {
      try {
        return JSON.stringify(JSON.parse(response.body), null, 2);
      } catch {
        return response.body;
      }
    }
    return response.body;
  }, [response, activeLanguage]);

  // Formatted JSON line and character count
  const bodyStats = useMemo(() => {
    if (!response?.body) return { lines: 0, chars: 0 };
    const text = activeRespTab === 'pretty' ? prettyBody : response.body;
    return {
      lines: text.split('\n').length,
      chars: text.length,
    };
  }, [response, activeRespTab, prettyBody]);

  // Define Monaco vibrant theme on mount
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    try {
      monaco.editor.defineTheme('sshdesktop-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'string.key.json', foreground: '7aa2f7', fontStyle: 'bold' },
          { token: 'string.value.json', foreground: '9ece6a' },
          { token: 'number.json', foreground: 'ff9e64' },
          { token: 'keyword.json', foreground: 'bb9af7' },
          { token: 'delimiter.bracket.json', foreground: 'ffca5b' },
        ],
        colors: {
          'editor.background': '#0f111a',
          'editor.foreground': '#cdd6f4',
          'editorLineNumber.foreground': '#45475a',
          'editorLineNumber.activeForeground': '#89b4fa',
          'editor.selectionBackground': '#31324480',
          'editor.lineHighlightBackground': '#18182560',
        }
      });
      monaco.editor.setTheme('sshdesktop-dark');
    } catch {}
  };

  // Keyboard shortcuts (Ctrl++, Ctrl+-, Alt+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!response) return;
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        handleUpdateFontSize(respFontSize + 1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        handleUpdateFontSize(respFontSize - 1);
      } else if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setIsWordWrap(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [response, respFontSize]);

  // Parse Cookies from Set-Cookie headers
  const cookiesList = response?.headers
    ? Object.entries(response.headers)
        .filter(([k]) => k.toLowerCase() === 'set-cookie')
        .map(([_, v]) => v)
    : [];

  // Filtered Headers
  const filteredHeaders = useMemo(() => {
    if (!response?.headers) return [];
    const entries = Object.entries(response.headers);
    if (!headerSearch.trim()) return entries;
    const q = headerSearch.toLowerCase();
    return entries.filter(([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q));
  }, [response, headerSearch]);

  const copyHeaderRow = (key: string, val: string) => {
    navigator.clipboard.writeText(`${key}: ${val}`);
    setCopiedHeaderKey(key);
    setTimeout(() => setCopiedHeaderKey(null), 1500);
  };

  return (
    <div className="flex flex-col h-full bg-[#141624] border-t border-white/[0.08] select-none overflow-hidden">
      {/* Top Response Metadata Bar */}
      <div className="flex flex-wrap items-center justify-between px-4 py-2 border-b border-white/[0.08] bg-[#11121d] gap-2 shrink-0">
        <div className="flex items-center space-x-3">
          {response && (
            <div className={`px-2.5 py-0.5 rounded-lg text-xs font-mono font-bold border flex items-center space-x-1.5 shadow-sm ${getStatusBadge(response.status)}`}>
              <span>{response.status}</span>
              <span>{response.status_text || 'OK'}</span>
            </div>
          )}

          {response && (
            <div className="flex items-center space-x-3 text-xs font-mono text-gray-400">
              <span className="flex items-center space-x-1 text-emerald-400 font-semibold" title="Round-trip request latency">
                <Clock className="w-3.5 h-3.5" />
                <span>{response.duration_ms} ms</span>
              </span>

              <span className="flex items-center space-x-1 text-cyan-400 font-semibold" title="Response payload byte size">
                <HardDrive className="w-3.5 h-3.5" />
                <span>{formatBytes(response.size_bytes)}</span>
              </span>

              <span className="text-gray-500 hidden sm:inline" title="Line and Character metrics">
                {bodyStats.lines} lines, {bodyStats.chars.toLocaleString()} chars
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
            <span className="text-xs text-gray-500 font-medium flex items-center space-x-1.5">
              <Code2 className="w-3.5 h-3.5 text-blue-400" />
              <span>Response Inspector</span>
            </span>
          )}
        </div>

        {/* Response Sub-tabs and Actions */}
        {response && (
          <div className="flex items-center space-x-2">
            {/* View Mode Tabs */}
            <div className="flex items-center bg-white/[0.04] rounded-lg p-0.5 border border-white/10 text-xs">
              <button
                type="button"
                onClick={() => setActiveRespTab('pretty')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                  activeRespTab === 'pretty' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                }`}
              >
                Pretty
              </button>
              <button
                type="button"
                onClick={() => setActiveRespTab('raw')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                  activeRespTab === 'raw' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                }`}
              >
                Raw
              </button>
              {detectedLanguage === 'html' && (
                <button
                  type="button"
                  onClick={() => setActiveRespTab('preview')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                    activeRespTab === 'preview' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Preview (HTML)
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveRespTab('headers')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                  activeRespTab === 'headers' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                }`}
              >
                Headers ({Object.keys(response.headers).length})
              </button>
              {cookiesList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveRespTab('cookies')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                    activeRespTab === 'cookies' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Cookies ({cookiesList.length})
                </button>
              )}
            </div>

            {/* Language Picker */}
            {(activeRespTab === 'pretty' || activeRespTab === 'raw') && (
              <select
                value={manualLang}
                onChange={(e) => setManualLang(e.target.value)}
                className="bg-[#1e1e2e] border border-white/15 rounded-lg px-2 py-1 text-xs text-blue-300 font-mono focus:outline-none cursor-pointer"
                title="Override Syntax Highlighting Language"
              >
                <option value="auto">Auto ({detectedLanguage.toUpperCase()})</option>
                <option value="json">JSON</option>
                <option value="xml">XML</option>
                <option value="html">HTML</option>
                <option value="javascript">JavaScript</option>
                <option value="css">CSS</option>
                <option value="yaml">YAML</option>
                <option value="plaintext">Plain Text</option>
              </select>
            )}

            {/* Word Wrap Toggle */}
            {(activeRespTab === 'pretty' || activeRespTab === 'raw') && (
              <button
                type="button"
                onClick={() => setIsWordWrap(!isWordWrap)}
                className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer border ${
                  isWordWrap ? 'bg-blue-600/30 text-blue-300 border-blue-500/40' : 'bg-white/5 text-gray-400 hover:text-white border-white/10'
                }`}
                title="Toggle Word Wrap (Alt + Z)"
              >
                <WrapText className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Minimap Toggle */}
            {(activeRespTab === 'pretty' || activeRespTab === 'raw') && (
              <button
                type="button"
                onClick={() => setShowMinimap(!showMinimap)}
                className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer border ${
                  showMinimap ? 'bg-blue-600/30 text-blue-300 border-blue-500/40' : 'bg-white/5 text-gray-400 hover:text-white border-white/10'
                }`}
                title="Toggle Minimap"
              >
                <Layers className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Zoom In / Out Controls */}
            {(activeRespTab === 'pretty' || activeRespTab === 'raw') && (
              <div className="flex items-center bg-white/5 rounded-lg border border-white/10 px-1 py-0.5 space-x-1 text-gray-300">
                <button
                  type="button"
                  onClick={() => handleUpdateFontSize(respFontSize - 1)}
                  className="hover:text-white text-gray-400 p-0.5 cursor-pointer"
                  title="Zoom Out (Ctrl + -)"
                >
                  <ZoomOut className="w-3 h-3" />
                </button>
                <span className="text-[10px] font-mono px-0.5">{respFontSize}px</span>
                <button
                  type="button"
                  onClick={() => handleUpdateFontSize(respFontSize + 1)}
                  className="hover:text-white text-blue-400 p-0.5 cursor-pointer"
                  title="Zoom In (Ctrl + +)"
                >
                  <ZoomIn className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Copy Body */}
            <button
              type="button"
              onClick={handleCopyBody}
              className="p-1.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg text-xs transition-colors cursor-pointer border border-white/10"
              title="Copy Response Body"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>

            {/* Download File */}
            <button
              type="button"
              onClick={handleDownload}
              className="p-1.5 bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white rounded-lg text-xs transition-colors cursor-pointer border border-white/10"
              title="Download Response File"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Response Content Canvas */}
      <div className="flex-1 overflow-hidden relative font-mono text-xs">
        {/* Loading Spinner */}
        {isLoading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#141624]/90 backdrop-blur-sm z-20 space-y-3 select-none">
            <div className="w-9 h-9 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shadow-lg shadow-blue-500/20" />
            <div className="text-xs text-blue-400 font-semibold tracking-wide">
              Sending API request...
            </div>
            <div className="text-[11px] text-gray-500">
              Executing request via SSH connection stream
            </div>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="p-4 m-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300 space-y-2 select-text">
            <div className="flex items-center space-x-2 font-bold text-sm text-rose-400">
              <AlertCircle className="w-4 h-4" />
              <span>Request Execution Failed</span>
            </div>
            <div className="text-xs font-mono bg-black/40 p-3 rounded-xl border border-rose-500/20 whitespace-pre-wrap leading-relaxed">
              {error}
            </div>
            <div className="text-[11px] text-gray-400 pt-1 leading-relaxed">
              • If accessing private internal services (e.g. <code className="text-white font-mono">localhost:8080</code>), ensure the remote server is active and the port is listening.<br />
              • Check that the active SSH server session is connected.
            </div>
          </div>
        )}

        {/* Empty State */}
        {!response && !isLoading && !error && (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 space-y-3 py-16 select-none">
            <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-blue-400 shadow-xl">
              <Radio className="w-6 h-6 opacity-60" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold text-gray-300">No Response Yet</div>
              <div className="text-xs text-gray-500 max-w-sm leading-relaxed">
                Enter your target URL above and click <span className="text-blue-400 font-bold">Send</span> to inspect HTTP response status, formatted JSON payloads, headers, and round-trip latency.
              </div>
            </div>
          </div>
        )}

        {/* Pretty Code Output with Monaco VS Code Syntax Highlighting */}
        {response && activeRespTab === 'pretty' && (
          <div className="h-full w-full relative overflow-hidden bg-[#0f111a]">
            {response.is_binary ? (
              <div className="p-8 text-center space-y-3 bg-[#14141e] rounded-2xl border border-white/10 m-4">
                <FileCode className="w-10 h-10 text-blue-400 mx-auto" />
                <div className="text-sm font-semibold text-gray-200">Binary Response File</div>
                <div className="text-xs text-gray-400">
                  Received {formatBytes(response.size_bytes)} of raw binary stream data.
                </div>
                <button
                  type="button"
                  onClick={handleDownload}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold inline-flex items-center space-x-1.5 shadow-md transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Binary File</span>
                </button>
              </div>
            ) : (
              <Editor
                height="100%"
                language={activeLanguage}
                theme="sshdesktop-dark"
                value={prettyBody}
                onMount={handleEditorDidMount}
                options={{
                  readOnly: true,
                  domReadOnly: true,
                  fontSize: respFontSize,
                  wordWrap: isWordWrap ? 'on' : 'off',
                  minimap: { enabled: showMinimap },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace",
                  lineNumbers: 'on',
                  folding: true,
                  bracketPairColorization: { enabled: true },
                  renderWhitespace: 'selection',
                  padding: { top: 10, bottom: 10 },
                }}
                loading={
                  <div className="h-full flex items-center justify-center text-xs text-gray-500 font-mono">
                    Colorizing Response Code...
                  </div>
                }
              />
            )}
          </div>
        )}

        {/* Raw Code Output with Monaco VS Code Editor */}
        {response && activeRespTab === 'raw' && (
          <div className="h-full w-full relative overflow-hidden bg-[#0f111a]">
            <Editor
              height="100%"
              language={activeLanguage}
              theme="sshdesktop-dark"
              value={response.body}
              onMount={handleEditorDidMount}
              options={{
                readOnly: true,
                domReadOnly: true,
                fontSize: respFontSize,
                wordWrap: isWordWrap ? 'on' : 'off',
                minimap: { enabled: showMinimap },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace",
                lineNumbers: 'on',
                folding: true,
                renderWhitespace: 'selection',
                padding: { top: 10, bottom: 10 },
              }}
              loading={
                <div className="h-full flex items-center justify-center text-xs text-gray-500 font-mono">
                  Loading Raw Code Output...
                </div>
              }
            />
          </div>
        )}

        {/* Live HTML Preview Iframe */}
        {response && activeRespTab === 'preview' && (
          <div className="h-full w-full flex flex-col p-4 bg-[#0d0e17]">
            <div className="mb-2 text-xs text-gray-400 flex items-center space-x-2">
              <Eye className="w-3.5 h-3.5 text-blue-400" />
              <span>HTML Sandbox Render</span>
            </div>
            <iframe
              srcDoc={response.body}
              title="HTML Response Preview"
              className="w-full flex-1 bg-white rounded-xl border border-white/15 shadow-2xl"
              sandbox="allow-same-origin allow-scripts"
            />
          </div>
        )}

        {/* Categorized Headers Table with Search & 1-Click Copy */}
        {response && activeRespTab === 'headers' && (
          <div className="h-full overflow-y-auto p-4 space-y-3 scrollbar-thin">
            {/* Header Search Filter */}
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-500" />
                <input
                  type="text"
                  placeholder="Filter headers (e.g. content-type, cache)..."
                  value={headerSearch}
                  onChange={(e) => setHeaderSearch(e.target.value)}
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl pl-9 pr-3 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  const txt = Object.entries(response.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
                  navigator.clipboard.writeText(txt);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl text-xs flex items-center space-x-1.5 transition-colors cursor-pointer border border-white/10"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copy All Headers</span>
              </button>
            </div>

            <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#11111b]">
              <div className="grid grid-cols-12 bg-white/[0.04] text-[11px] font-semibold text-gray-400 border-b border-white/10 px-4 py-2 select-none">
                <span className="col-span-5">Header Key</span>
                <span className="col-span-6">Header Value</span>
                <span className="col-span-1 text-right">Copy</span>
              </div>
              {filteredHeaders.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-500">
                  No headers match "{headerSearch}".
                </div>
              ) : (
                filteredHeaders.map(([key, value], idx) => {
                  const lowerKey = key.toLowerCase();
                  const isSecurity = lowerKey.includes('security') || lowerKey.includes('x-frame') || lowerKey.includes('csp');
                  const isContent = lowerKey.includes('content') || lowerKey.includes('type');
                  const isCache = lowerKey.includes('cache') || lowerKey.includes('etag') || lowerKey.includes('expires');
                  const isAuth = lowerKey.includes('auth') || lowerKey.includes('cookie');

                  const keyColor = isSecurity ? 'text-purple-300' : isContent ? 'text-sky-300' : isCache ? 'text-emerald-300' : isAuth ? 'text-amber-300' : 'text-blue-300';

                  return (
                    <div key={idx} className="grid grid-cols-12 border-b border-white/[0.05] px-4 py-2 hover:bg-white/[0.02] text-xs items-center transition-colors">
                      <span className={`col-span-5 font-bold truncate flex items-center space-x-1.5 ${keyColor}`}>
                        {isSecurity && <Shield className="w-3 h-3 text-purple-400 shrink-0" />}
                        <span className="truncate">{key}</span>
                      </span>
                      <span className="col-span-6 text-gray-300 break-all select-all font-mono text-[11px] pr-2">
                        {value}
                      </span>
                      <div className="col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => copyHeaderRow(key, value)}
                          className="p-1 hover:text-white text-gray-500 hover:bg-white/10 rounded transition-colors cursor-pointer"
                          title="Copy this header"
                        >
                          {copiedHeaderKey === key ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Structured Cookies Table */}
        {response && activeRespTab === 'cookies' && (
          <div className="h-full overflow-y-auto p-4 space-y-3 scrollbar-thin">
            <div className="text-xs text-gray-400 font-semibold">
              Set-Cookie Directives ({cookiesList.length})
            </div>
            <div className="space-y-2">
              {cookiesList.map((c, idx) => (
                <div key={idx} className="p-3 bg-[#11111b] border border-white/10 rounded-2xl text-xs font-mono text-gray-200 select-all flex items-start justify-between gap-3 shadow-md">
                  <div className="break-all">{c}</div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(c);
                      setCopiedHeaderKey(`cookie_${idx}`);
                      setTimeout(() => setCopiedHeaderKey(null), 1500);
                    }}
                    className="p-1 hover:text-white text-gray-500 hover:bg-white/10 rounded transition-colors cursor-pointer shrink-0"
                    title="Copy cookie string"
                  >
                    {copiedHeaderKey === `cookie_${idx}` ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
