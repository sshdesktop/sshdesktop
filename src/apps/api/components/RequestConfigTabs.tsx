import React, { useState, useRef, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { 
  Plus, Trash2, Key, Shield, Sliders, FileText, 
  Check, Eye, EyeOff, Sparkles, CheckCircle2, AlertCircle,
  ZoomIn, ZoomOut, WrapText, Copy, Minimize2, FileCode, Layers, RotateCcw
} from 'lucide-react';
import { ApiTabState, AuthType, BodyType } from '../types';
import { useApiStore } from '../apiStore';

interface RequestConfigTabsProps {
  activeTab: ApiTabState;
}

export default function RequestConfigTabs({ activeTab }: RequestConfigTabsProps) {
  const { updateActiveTab } = useApiStore();
  const currentSubTab = activeTab.activeSubTab || 'params';
  const setSubTab = (tab: 'params' | 'headers' | 'auth' | 'body' | 'settings') => {
    updateActiveTab({ activeSubTab: tab });
  };

  // Password visibility
  const [showToken, setShowToken] = useState(false);
  const [showBasicPass, setShowBasicPass] = useState(false);

  // Monaco Editor State for Request Body
  const [bodyFontSize, setBodyFontSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('sshdesktop_api_body_fontsize');
      return saved ? parseInt(saved, 10) : 13;
    } catch {
      return 13;
    }
  });
  const [isWordWrap, setIsWordWrap] = useState<boolean>(true);
  const [showMinimap, setShowMinimap] = useState<boolean>(false);
  const [rawLanguage, setRawLanguage] = useState<string>('json');
  const [copiedBody, setCopiedBody] = useState<boolean>(false);
  const editorRef = useRef<any>(null);

  const handleUpdateFontSize = (newSize: number) => {
    const clamped = Math.max(9, Math.min(32, newSize));
    setBodyFontSize(clamped);
    try {
      localStorage.setItem('sshdesktop_api_body_fontsize', String(clamped));
    } catch {}
  };

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

  // Keyboard Shortcuts for Monaco Body Editor (Ctrl++, Ctrl+-, Alt+Z)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (currentSubTab !== 'body') return;
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        handleUpdateFontSize(bodyFontSize + 1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        handleUpdateFontSize(bodyFontSize - 1);
      } else if (e.altKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        setIsWordWrap(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentSubTab, bodyFontSize]);

  // JSON Prettify
  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(activeTab.rawBody || '{}');
      updateActiveTab({ rawBody: JSON.stringify(parsed, null, 2) });
    } catch (e: any) {
      alert(`Invalid JSON: ${e?.message || e}`);
    }
  };

  // JSON Minify
  const handleMinifyJson = () => {
    try {
      const parsed = JSON.parse(activeTab.rawBody || '{}');
      updateActiveTab({ rawBody: JSON.stringify(parsed) });
    } catch (e: any) {
      alert(`Invalid JSON: ${e?.message || e}`);
    }
  };

  // Sample JSON Template
  const handleInsertSampleJson = () => {
    const sample = JSON.stringify({
      title: "Sample API Payload",
      active: true,
      count: 42,
      tags: ["production", "v2"],
      metadata: {
        author: "DevOps",
        created_at: new Date().toISOString()
      }
    }, null, 2);
    updateActiveTab({ rawBody: sample });
  };

  // 1. QUERY PARAMS
  const handleAddParam = () => {
    updateActiveTab({
      queryParams: [...activeTab.queryParams, { key: '', value: '', enabled: true }],
    });
  };

  const handleUpdateParam = (index: number, updates: { key?: string; value?: string; enabled?: boolean }) => {
    const updated = [...activeTab.queryParams];
    updated[index] = { ...updated[index], ...updates };
    updateActiveTab({ queryParams: updated });
  };

  const handleDeleteParam = (index: number) => {
    const p = activeTab.queryParams[index];
    const name = p?.key ? `parameter "${p.key}"` : 'this parameter';
    if (!window.confirm(`Are you sure you want to delete ${name}?`)) return;
    const updated = activeTab.queryParams.filter((_, i) => i !== index);
    updateActiveTab({ queryParams: updated });
  };

  // 2. HEADERS
  const handleAddHeader = () => {
    updateActiveTab({
      headers: [...activeTab.headers, { key: '', value: '', enabled: true }],
    });
  };

  const handleUpdateHeader = (index: number, updates: { key?: string; value?: string; enabled?: boolean }) => {
    const updated = [...activeTab.headers];
    updated[index] = { ...updated[index], ...updates };
    updateActiveTab({ headers: updated });
  };

  const handleDeleteHeader = (index: number) => {
    const h = activeTab.headers[index];
    const name = h?.key ? `header "${h.key}"` : 'this header';
    if (!window.confirm(`Are you sure you want to delete ${name}?`)) return;
    const updated = activeTab.headers.filter((_, i) => i !== index);
    updateActiveTab({ headers: updated });
  };

  // 3. FORM DATA
  const handleAddFormData = () => {
    updateActiveTab({
      formData: [...(activeTab.formData || []), { key: '', value: '', item_type: 'text', enabled: true }],
    });
  };

  const handleUpdateFormData = (index: number, updates: { key?: string; value?: string; enabled?: boolean }) => {
    const updated = [...(activeTab.formData || [])];
    updated[index] = { ...updated[index], ...updates };
    updateActiveTab({ formData: updated });
  };

  const handleDeleteFormData = (index: number) => {
    const f = (activeTab.formData || [])[index];
    const name = f?.key ? `field "${f.key}"` : 'this field';
    if (!window.confirm(`Are you sure you want to delete ${name}?`)) return;
    const updated = (activeTab.formData || []).filter((_, i) => i !== index);
    updateActiveTab({ formData: updated });
  };

  const activeHeadersCount = activeTab.headers.filter(h => h.enabled && h.key.trim()).length;
  const activeParamsCount = activeTab.queryParams.filter(p => p.enabled && p.key.trim()).length;

  return (
    <div className="flex flex-col h-full bg-[#181825] text-gray-200 select-none overflow-hidden">
      {/* Sub Tabs Bar */}
      <div className="flex items-center space-x-1 border-b border-white/[0.08] px-3 pt-2 bg-[#14141e]/70 shrink-0">
        <button
          type="button"
          onClick={() => setSubTab('params')}
          className={`px-3 py-1.5 rounded-t-lg text-xs font-medium flex items-center space-x-1.5 transition-all border-b-2 ${
            currentSubTab === 'params'
              ? 'border-blue-500 text-blue-400 bg-white/[0.04]'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <span>Params</span>
          {activeParamsCount > 0 && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('headers')}
          className={`px-3 py-1.5 rounded-t-lg text-xs font-medium flex items-center space-x-1.5 transition-all border-b-2 ${
            currentSubTab === 'headers'
              ? 'border-blue-500 text-blue-400 bg-white/[0.04]'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <span>Headers</span>
          {activeHeadersCount > 0 && (
            <span className="text-[10px] bg-white/10 px-1 rounded-full text-blue-300 font-mono">
              {activeHeadersCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('auth')}
          className={`px-3 py-1.5 rounded-t-lg text-xs font-medium flex items-center space-x-1.5 transition-all border-b-2 ${
            currentSubTab === 'auth'
              ? 'border-blue-500 text-blue-400 bg-white/[0.04]'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <span>Auth</span>
          {activeTab.auth.type !== 'none' && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('body')}
          className={`px-3 py-1.5 rounded-t-lg text-xs font-medium flex items-center space-x-1.5 transition-all border-b-2 ${
            currentSubTab === 'body'
              ? 'border-blue-500 text-blue-400 bg-white/[0.04]'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <span>Body</span>
          {activeTab.bodyType !== 'none' && (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setSubTab('settings')}
          className={`px-3 py-1.5 rounded-t-lg text-xs font-medium flex items-center space-x-1.5 transition-all border-b-2 ${
            currentSubTab === 'settings'
              ? 'border-blue-500 text-blue-400 bg-white/[0.04]'
              : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          <span>Settings</span>
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {/* 1. QUERY PARAMS TAB */}
        {currentSubTab === 'params' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Query Parameters</span>
              <button
                type="button"
                onClick={handleAddParam}
                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-blue-400 rounded-lg text-xs font-medium flex items-center space-x-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Param</span>
              </button>
            </div>

            <div className="border border-white/10 rounded-xl overflow-hidden bg-[#14141e]/60">
              <div className="grid grid-cols-12 bg-white/[0.03] text-[11px] font-semibold text-gray-400 border-b border-white/10 px-3 py-1.5">
                <span className="col-span-1 text-center">Use</span>
                <span className="col-span-5">Key</span>
                <span className="col-span-5">Value</span>
                <span className="col-span-1 text-center">Action</span>
              </div>

              {activeTab.queryParams.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-xs font-mono">
                  No query parameters added. Click "Add Param" or append ?key=value to the URL.
                </div>
              ) : (
                activeTab.queryParams.map((param, idx) => (
                  <div key={idx} className="grid grid-cols-12 border-b border-white/[0.05] items-center px-3 py-1 hover:bg-white/[0.02]">
                    <div className="col-span-1 flex justify-center">
                      <input
                        type="checkbox"
                        checked={param.enabled}
                        onChange={(e) => handleUpdateParam(idx, { enabled: e.target.checked })}
                        className="rounded border-white/20 text-blue-600 focus:ring-0 bg-transparent cursor-pointer"
                      />
                    </div>
                    <div className="col-span-5 px-1">
                      <input
                        type="text"
                        placeholder="Key"
                        value={param.key}
                        onChange={(e) => handleUpdateParam(idx, { key: e.target.value })}
                        className="w-full bg-transparent text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none"
                      />
                    </div>
                    <div className="col-span-5 px-1">
                      <input
                        type="text"
                        placeholder="Value"
                        value={param.value}
                        onChange={(e) => handleUpdateParam(idx, { value: e.target.value })}
                        className="w-full bg-transparent text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none"
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      <button
                        type="button"
                        onClick={() => handleDeleteParam(idx)}
                        className="text-gray-500 hover:text-rose-400 p-1 rounded transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* 2. HEADERS TAB */}
        {currentSubTab === 'headers' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-gray-400">
              <span>Request Headers</span>
              <button
                type="button"
                onClick={handleAddHeader}
                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-blue-400 rounded-lg text-xs font-medium flex items-center space-x-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Header</span>
              </button>
            </div>

            <div className="border border-white/10 rounded-xl overflow-hidden bg-[#14141e]/60">
              <div className="grid grid-cols-12 bg-white/[0.03] text-[11px] font-semibold text-gray-400 border-b border-white/10 px-3 py-1.5">
                <span className="col-span-1 text-center">Use</span>
                <span className="col-span-5">Header Key</span>
                <span className="col-span-5">Header Value</span>
                <span className="col-span-1 text-center">Action</span>
              </div>

              {activeTab.headers.map((h, idx) => (
                <div key={idx} className="grid grid-cols-12 border-b border-white/[0.05] items-center px-3 py-1 hover:bg-white/[0.02]">
                  <div className="col-span-1 flex justify-center">
                    <input
                      type="checkbox"
                      checked={h.enabled}
                      onChange={(e) => handleUpdateHeader(idx, { enabled: e.target.checked })}
                      className="rounded border-white/20 text-blue-600 focus:ring-0 bg-transparent cursor-pointer"
                    />
                  </div>
                  <div className="col-span-5 px-1">
                    <input
                      type="text"
                      placeholder="e.g. Content-Type"
                      value={h.key}
                      onChange={(e) => handleUpdateHeader(idx, { key: e.target.value })}
                      className="w-full bg-transparent text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none"
                    />
                  </div>
                  <div className="col-span-5 px-1">
                    <input
                      type="text"
                      placeholder="e.g. application/json"
                      value={h.value}
                      onChange={(e) => handleUpdateHeader(idx, { value: e.target.value })}
                      className="w-full bg-transparent text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none"
                    />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <button
                      type="button"
                      onClick={() => handleDeleteHeader(idx)}
                      className="text-gray-500 hover:text-rose-400 p-1 rounded transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. AUTH TAB */}
        {currentSubTab === 'auth' && (
          <div className="space-y-5 max-w-xl">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-300">Authentication Type</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {(['none', 'bearer', 'basic', 'apikey'] as AuthType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => updateActiveTab({ auth: { ...activeTab.auth, type } })}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all border ${
                      activeTab.auth.type === type
                        ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                        : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                    }`}
                  >
                    {type === 'none' && 'No Auth'}
                    {type === 'bearer' && 'Bearer Token'}
                    {type === 'basic' && 'Basic Auth'}
                    {type === 'apikey' && 'API Key'}
                  </button>
                ))}
              </div>
            </div>

            {/* Bearer Token Form */}
            {activeTab.auth.type === 'bearer' && (
              <div className="space-y-2 p-4 bg-[#14141e]/80 border border-white/10 rounded-2xl">
                <label className="text-xs font-semibold text-gray-300">Bearer Token</label>
                <div className="relative">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={activeTab.auth.bearerToken || ''}
                    onChange={(e) => updateActiveTab({ auth: { ...activeTab.auth, bearerToken: e.target.value } })}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                    className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3.5 py-2 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken(!showToken)}
                    className="absolute right-3 top-2.5 text-gray-400 hover:text-white"
                  >
                    {showToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[11px] text-gray-500">
                  Automatically attaches <code className="text-blue-300">Authorization: Bearer &lt;token&gt;</code> header.
                </p>
              </div>
            )}

            {/* Basic Auth Form */}
            {activeTab.auth.type === 'basic' && (
              <div className="space-y-3 p-4 bg-[#14141e]/80 border border-white/10 rounded-2xl">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Username</label>
                  <input
                    type="text"
                    value={activeTab.auth.basicUser || ''}
                    onChange={(e) => updateActiveTab({ auth: { ...activeTab.auth, basicUser: e.target.value } })}
                    placeholder="admin"
                    className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3.5 py-2 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Password</label>
                  <div className="relative">
                    <input
                      type={showBasicPass ? 'text' : 'password'}
                      value={activeTab.auth.basicPass || ''}
                      onChange={(e) => updateActiveTab({ auth: { ...activeTab.auth, basicPass: e.target.value } })}
                      placeholder="••••••••"
                      className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3.5 py-2 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBasicPass(!showBasicPass)}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-white"
                    >
                      {showBasicPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">
                  Generates <code className="text-blue-300">Authorization: Basic base64(user:pass)</code> header.
                </p>
              </div>
            )}

            {/* API Key Form */}
            {activeTab.auth.type === 'apikey' && (
              <div className="space-y-3 p-4 bg-[#14141e]/80 border border-white/10 rounded-2xl">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-300">Key Name</label>
                    <input
                      type="text"
                      value={activeTab.auth.apiKeyName || 'X-API-Key'}
                      onChange={(e) => updateActiveTab({ auth: { ...activeTab.auth, apiKeyName: e.target.value } })}
                      placeholder="X-API-Key"
                      className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3.5 py-2 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-300">Location</label>
                    <select
                      value={activeTab.auth.apiKeyLocation || 'header'}
                      onChange={(e) => updateActiveTab({ auth: { ...activeTab.auth, apiKeyLocation: e.target.value as any } })}
                      className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3 py-2 text-xs text-gray-200 focus:outline-none"
                    >
                      <option value="header">Header</option>
                      <option value="query">Query Parameter</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Key Value</label>
                  <input
                    type="text"
                    value={activeTab.auth.apiKeyValue || ''}
                    onChange={(e) => updateActiveTab({ auth: { ...activeTab.auth, apiKeyValue: e.target.value } })}
                    placeholder="key_live_..."
                    className="w-full bg-[#11111b] border border-white/15 rounded-xl px-3.5 py-2 text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 4. BODY TAB */}
        {currentSubTab === 'body' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                {(['none', 'json', 'form-data', 'x-www-form-urlencoded', 'raw'] as BodyType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => updateActiveTab({ bodyType: type })}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                      activeTab.bodyType === type
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    {type.toUpperCase()}
                  </button>
                ))}
              </div>

              {activeTab.bodyType === 'json' && (
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={handleFormatJson}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 hover:text-white text-blue-400 rounded-lg text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer"
                    title="Format & Beautify JSON Indentation"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Beautify JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleMinifyJson}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 hover:text-white text-gray-300 rounded-lg text-xs font-medium flex items-center space-x-1 transition-colors cursor-pointer"
                    title="Minify JSON (Compact whitespace)"
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span>Minify</span>
                  </button>
                </div>
              )}
            </div>

            {activeTab.bodyType === 'none' && (
              <div className="text-center py-12 text-gray-500 text-xs">
                This request does not have a body. Select JSON or Form Data above to add a payload.
              </div>
            )}

            {(activeTab.bodyType === 'json' || activeTab.bodyType === 'raw') && (
              <div className="border border-white/10 rounded-2xl overflow-hidden bg-[#0f111a] shadow-2xl flex flex-col">
                {/* Monaco Editor Header Toolbar */}
                <div className="px-3.5 py-2 bg-[#131522] border-b border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs select-none">
                  <div className="flex items-center space-x-2">
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">
                      Payload Editor
                    </span>

                    {/* Language selector for raw mode */}
                    {activeTab.bodyType === 'raw' ? (
                      <select
                        value={rawLanguage}
                        onChange={(e) => setRawLanguage(e.target.value)}
                        className="bg-[#1e1e2e] border border-white/15 rounded-lg px-2 py-0.5 text-xs text-blue-300 font-mono focus:outline-none cursor-pointer"
                      >
                        <option value="json">JSON</option>
                        <option value="xml">XML</option>
                        <option value="html">HTML</option>
                        <option value="javascript">JavaScript</option>
                        <option value="yaml">YAML</option>
                        <option value="plaintext">Plain Text</option>
                      </select>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[11px] bg-blue-500/20 text-blue-300 font-mono font-semibold border border-blue-500/30">
                        JSON (RFC 8259)
                      </span>
                    )}

                    <span className="text-gray-600">|</span>

                    {/* Beautify Button */}
                    <button
                      type="button"
                      onClick={handleFormatJson}
                      className="px-2 py-1 bg-white/5 hover:bg-white/10 hover:text-white text-blue-400 rounded-lg text-xs font-medium flex items-center space-x-1 transition-all cursor-pointer"
                      title="Beautify & Format JSON indentation"
                    >
                      <Sparkles className="w-3 h-3 text-blue-400" />
                      <span>Format</span>
                    </button>

                    {/* Minify Button */}
                    <button
                      type="button"
                      onClick={handleMinifyJson}
                      className="px-2 py-1 bg-white/5 hover:bg-white/10 hover:text-white text-gray-300 rounded-lg text-xs font-medium flex items-center space-x-1 transition-all cursor-pointer"
                      title="Minify JSON (compact whitespace)"
                    >
                      <Minimize2 className="w-3 h-3" />
                      <span>Minify</span>
                    </button>

                    {/* Sample Template */}
                    <button
                      type="button"
                      onClick={handleInsertSampleJson}
                      className="px-2 py-1 bg-white/5 hover:bg-white/10 hover:text-white text-gray-300 rounded-lg text-xs font-medium flex items-center space-x-1 transition-all cursor-pointer"
                      title="Insert Sample JSON Template"
                    >
                      <FileCode className="w-3 h-3 text-amber-400" />
                      <span>Sample</span>
                    </button>
                  </div>

                  {/* Right side tools */}
                  <div className="flex items-center space-x-2">
                    {/* Word Wrap Toggle */}
                    <button
                      type="button"
                      onClick={() => setIsWordWrap(!isWordWrap)}
                      className={`px-2 py-1 rounded-lg text-xs flex items-center space-x-1 transition-all cursor-pointer ${
                        isWordWrap ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40' : 'bg-white/5 text-gray-400 hover:text-white'
                      }`}
                      title="Toggle Word Wrap (Alt + Z)"
                    >
                      <WrapText className="w-3 h-3" />
                      <span className="text-[11px]">Wrap</span>
                    </button>

                    {/* Minimap Toggle */}
                    <button
                      type="button"
                      onClick={() => setShowMinimap(!showMinimap)}
                      className={`px-2 py-1 rounded-lg text-xs flex items-center space-x-1 transition-all cursor-pointer ${
                        showMinimap ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40' : 'bg-white/5 text-gray-400 hover:text-white'
                      }`}
                      title="Toggle Minimap"
                    >
                      <Layers className="w-3 h-3" />
                      <span className="text-[11px]">Map</span>
                    </button>

                    {/* Zoom In / Zoom Out Controls */}
                    <div className="flex items-center bg-white/5 rounded-lg border border-white/10 px-1 py-0.5 space-x-1 text-gray-300">
                      <button
                        type="button"
                        onClick={() => handleUpdateFontSize(bodyFontSize - 1)}
                        className="hover:text-white text-gray-400 p-0.5 cursor-pointer"
                        title="Zoom Out (Ctrl + -)"
                      >
                        <ZoomOut className="w-3 h-3" />
                      </button>
                      <span className="text-[10px] font-mono px-1">{bodyFontSize}px</span>
                      <button
                        type="button"
                        onClick={() => handleUpdateFontSize(bodyFontSize + 1)}
                        className="hover:text-white text-blue-400 p-0.5 cursor-pointer"
                        title="Zoom In (Ctrl + +)"
                      >
                        <ZoomIn className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Copy Body */}
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(activeTab.rawBody);
                        setCopiedBody(true);
                        setTimeout(() => setCopiedBody(false), 2000);
                      }}
                      className="p-1 hover:text-white text-gray-400 transition-colors cursor-pointer"
                      title="Copy Payload"
                    >
                      {copiedBody ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>

                    {/* Clear Body */}
                    <button
                      type="button"
                      onClick={() => {
                        if (activeTab.rawBody && window.confirm('Clear request body payload?')) {
                          updateActiveTab({ rawBody: '' });
                        }
                      }}
                      className="p-1 hover:text-rose-400 text-gray-400 transition-colors cursor-pointer"
                      title="Clear Body"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Monaco Editor Canvas */}
                <div className="h-64 relative overflow-hidden bg-[#0f111a]">
                  <Editor
                    height="100%"
                    language={activeTab.bodyType === 'json' ? 'json' : rawLanguage}
                    theme="sshdesktop-dark"
                    value={activeTab.rawBody}
                    onChange={(val) => updateActiveTab({ rawBody: val || '' })}
                    onMount={handleEditorDidMount}
                    options={{
                      fontSize: bodyFontSize,
                      wordWrap: isWordWrap ? 'on' : 'off',
                      minimap: { enabled: showMinimap },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace",
                      lineNumbers: 'on',
                      renderWhitespace: 'selection',
                      cursorBlinking: 'smooth',
                      tabSize: 2,
                      bracketPairColorization: { enabled: true },
                      formatOnPaste: true,
                      padding: { top: 8, bottom: 8 },
                    }}
                    loading={
                      <div className="h-full flex items-center justify-center text-xs text-gray-500 font-mono">
                        Loading Monaco Code Editor...
                      </div>
                    }
                  />
                </div>
              </div>
            )}

            {(activeTab.bodyType === 'form-data' || activeTab.bodyType === 'x-www-form-urlencoded') && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-gray-400">
                  <span>Form Fields ({activeTab.bodyType})</span>
                  <button
                    type="button"
                    onClick={handleAddFormData}
                    className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-blue-400 rounded-lg text-xs font-medium flex items-center space-x-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Field</span>
                  </button>
                </div>

                <div className="border border-white/10 rounded-xl overflow-hidden bg-[#14141e]/60">
                  <div className="grid grid-cols-12 bg-white/[0.03] text-[11px] font-semibold text-gray-400 border-b border-white/10 px-3 py-1.5">
                    <span className="col-span-1 text-center">Use</span>
                    <span className="col-span-5">Field Name</span>
                    <span className="col-span-5">Field Value</span>
                    <span className="col-span-1 text-center">Action</span>
                  </div>

                  {(activeTab.formData || []).map((item, idx) => (
                    <div key={idx} className="grid grid-cols-12 border-b border-white/[0.05] items-center px-3 py-1 hover:bg-white/[0.02]">
                      <div className="col-span-1 flex justify-center">
                        <input
                          type="checkbox"
                          checked={item.enabled}
                          onChange={(e) => handleUpdateFormData(idx, { enabled: e.target.checked })}
                          className="rounded border-white/20 text-blue-600 focus:ring-0 bg-transparent cursor-pointer"
                        />
                      </div>
                      <div className="col-span-5 px-1">
                        <input
                          type="text"
                          placeholder="Field Key"
                          value={item.key}
                          onChange={(e) => handleUpdateFormData(idx, { key: e.target.value })}
                          className="w-full bg-transparent text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none"
                        />
                      </div>
                      <div className="col-span-5 px-1">
                        <input
                          type="text"
                          placeholder="Field Value"
                          value={item.value}
                          onChange={(e) => handleUpdateFormData(idx, { value: e.target.value })}
                          className="w-full bg-transparent text-xs font-mono text-gray-200 placeholder-gray-600 focus:outline-none"
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteFormData(idx)}
                          className="text-gray-500 hover:text-rose-400 p-1 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 5. SETTINGS TAB */}
        {currentSubTab === 'settings' && (
          <div className="space-y-5 max-w-lg">
            <div className="flex items-center justify-between p-3.5 bg-[#14141e]/80 border border-white/10 rounded-2xl">
              <div>
                <div className="text-xs font-semibold text-gray-200">Follow HTTP Redirects</div>
                <div className="text-[11px] text-gray-400">Automatically follow 301, 302, 307 redirect status codes</div>
              </div>
              <input
                type="checkbox"
                checked={activeTab.followRedirects}
                onChange={(e) => updateActiveTab({ followRedirects: e.target.checked })}
                className="w-4 h-4 rounded border-white/20 text-blue-600 focus:ring-0 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between p-3.5 bg-[#14141e]/80 border border-white/10 rounded-2xl">
              <div>
                <div className="text-xs font-semibold text-gray-200">Accept Self-Signed SSL Certificates</div>
                <div className="text-[11px] text-gray-400">Ignore certificate errors for local development and private internal APIs</div>
              </div>
              <input
                type="checkbox"
                checked={!activeTab.verifySsl}
                onChange={(e) => updateActiveTab({ verifySsl: !e.target.checked })}
                className="w-4 h-4 rounded border-white/20 text-blue-600 focus:ring-0 cursor-pointer"
              />
            </div>

            <div className="space-y-1.5 p-3.5 bg-[#14141e]/80 border border-white/10 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-200">Request Timeout</span>
                <span className="text-xs font-mono text-blue-400">{activeTab.timeoutSeconds}s</span>
              </div>
              <input
                type="range"
                min="5"
                max="120"
                step="5"
                value={activeTab.timeoutSeconds}
                onChange={(e) => updateActiveTab({ timeoutSeconds: parseInt(e.target.value, 10) })}
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
