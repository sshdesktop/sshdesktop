import React, { useState, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { 
  Terminal, Play, Copy, Check, Plus, Trash2, Edit2, 
  Sparkles, Layers, Radio, Globe, Container, Shield, Database,
  HardDrive, Cpu
} from 'lucide-react';
import { SshSnippet } from '../types';
import { useSshStore } from '../sshStore';

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  system: Cpu,
  docker: Container,
  network: Globe,
  storage: HardDrive,
  security: Shield,
  database: Database,
};

function HighlightedCommand({ code }: { code: string }) {
  // Tokenize bash command line into colorful tokens
  const tokens = useMemo(() => {
    const regex = /("[^"]*"|'[^']*'|\$[{]?[A-Za-z0-9_]+[}]?|--?[a-zA-Z0-9_-]+|\|{1,2}|&&|>>|>|;|sudo|doas|\b[a-zA-Z0-9_\-\./:]+\b|\s+)/g;
    const parts = code.match(regex) || [code];
    let isStartOfCmd = true;

    return parts.map((part, i) => {
      if (/^\s+$/.test(part)) return <span key={i}>{part}</span>;

      // Sudo / Doas in bold rose
      if (part === 'sudo' || part === 'doas') {
        isStartOfCmd = true;
        return <span key={i} className="text-rose-400 font-bold">{part}</span>;
      }

      // Operators: |, &&, ||, ;, >, >> in purple
      if (/^(\|{1,2}|&&|>>|>|;)$/.test(part)) {
        isStartOfCmd = true;
        return <span key={i} className="text-purple-400 font-bold mx-0.5">{part}</span>;
      }

      // Strings in soft amber
      if (/^("[^"]*"|'[^']*')$/.test(part)) {
        return <span key={i} className="text-amber-200">{part}</span>;
      }

      // Variables in bright cyan
      if (/^\$[{]?[A-Za-z0-9_]+[}]?$/.test(part)) {
        return <span key={i} className="text-cyan-300 font-bold">{part}</span>;
      }

      // Flags in amber/gold
      if (/^--?[a-zA-Z0-9_-]+$/.test(part)) {
        return <span key={i} className="text-amber-400 font-semibold">{part}</span>;
      }

      // Main commands in bright neon emerald
      const KNOWN_CMDS = new Set([
        'systemctl', 'docker', 'curl', 'apt', 'apt-get', 'yum', 'git', 'ssh', 'scp',
        'rsync', 'find', 'grep', 'awk', 'sed', 'chmod', 'chown', 'kill', 'pkill',
        'nginx', 'certbot', 'ufw', 'iptables', 'journalctl', 'htop', 'df', 'free',
        'ip', 'netstat', 'ss', 'tar', 'gzip', 'cat', 'ls', 'mkdir', 'rm', 'echo',
        'ps', 'uname', 'uptime', 'head', 'tail', 'less', 'nano', 'vim', 'which', 'su'
      ]);

      if (isStartOfCmd || KNOWN_CMDS.has(part.toLowerCase())) {
        isStartOfCmd = false;
        return <span key={i} className="text-emerald-400 font-bold">{part}</span>;
      }

      // Subcommands in vivid sky blue
      const SUB_CMDS = new Set([
        'restart', 'status', 'start', 'stop', 'enable', 'disable', 'reload',
        'compose', 'build', 'run', 'up', 'down', 'exec', 'logs', 'ps', 'images',
        'install', 'update', 'upgrade', 'clone', 'pull', 'push', 'checkout', 'commit',
        'prune', 'clean', 'system'
      ]);

      if (SUB_CMDS.has(part.toLowerCase())) {
        return <span key={i} className="text-sky-300 font-semibold">{part}</span>;
      }

      // Paths in indigo
      if (part.includes('/') || part.includes('.')) {
        return <span key={i} className="text-indigo-300">{part}</span>;
      }

      return <span key={i} className="text-gray-200">{part}</span>;
    });
  }, [code]);

  return <code className="leading-relaxed whitespace-pre-wrap select-all font-mono text-xs">{tokens}</code>;
}

interface SshSnippetsManagerProps {
  onExecuteInActive?: (cmd: string) => void;
  onBroadcast?: (cmd: string) => void;
  isLight?: boolean;
}

export default function SshSnippetsManager({
  onExecuteInActive,
  onBroadcast,
  isLight = false,
}: SshSnippetsManagerProps) {
  const { snippets, addSnippet, removeSnippet, updateSnippet, addAuditLog } = useSshStore();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // New / Edit modal
  const [editingSnippet, setEditingSnippet] = useState<SshSnippet | null>(null);
  const [isNew, setIsNew] = useState(false);

  const filteredSnippets = snippets.filter(s => {
    const matchesCategory = activeCategory === 'all' || s.category === activeCategory;
    const matchesSearch = s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.command.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.description && s.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  const handleCopy = (s: SshSnippet) => {
    navigator.clipboard.writeText(s.command);
    setCopiedId(s.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExecute = (s: SshSnippet) => {
    if (onExecuteInActive) {
      onExecuteInActive(s.command);
    }
    addAuditLog({
      action: 'Executed Snippet',
      host: 'Active Terminal',
      username: 'active',
      status: 'success',
      details: `Ran snippet "${s.title}": ${s.command.slice(0, 50)}...`,
    });
  };

  const handleBroadcast = (s: SshSnippet) => {
    if (onBroadcast) {
      onBroadcast(s.command);
    }
    addAuditLog({
      action: 'Broadcasted Snippet',
      host: 'All Open Terminals',
      username: 'broadcast',
      status: 'success',
      details: `Broadcasted command "${s.title}" to all sessions`,
    });
  };

  const handleSaveModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSnippet || !editingSnippet.title.trim() || !editingSnippet.command.trim()) return;

    if (isNew) {
      addSnippet(editingSnippet);
    } else {
      updateSnippet(editingSnippet.id, editingSnippet);
    }
    setEditingSnippet(null);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e2e]/90 text-gray-200 select-none overflow-hidden font-sans">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#181825] border-b border-white/[0.08]">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center space-x-2">
            <Terminal className="w-5 h-5 text-emerald-400" />
            <span>DevOps Command Snippets & Broadcaster</span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            1-click run common diagnostics or broadcast commands across open SSH sessions
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <input
            type="text"
            placeholder="Search commands..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-44"
          />

          <button
            onClick={() => {
              setIsNew(true);
              setEditingSnippet({
                id: `snip-${Date.now()}`,
                title: '',
                command: '',
                category: 'system',
                description: '',
              });
            }}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Snippet</span>
          </button>
        </div>
      </div>

      {/* Categories */}
      <div className="flex items-center space-x-1.5 px-6 py-2.5 bg-[#181825]/60 border-b border-white/[0.06] text-xs overflow-x-auto">
        <span className="text-gray-400 mr-1 font-medium">Category:</span>
        {['all', 'system', 'docker', 'network', 'storage', 'security', 'database'].map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer capitalize shrink-0 ${
              activeCategory === cat
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 font-semibold'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Snippets Grid */}
      <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredSnippets.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center h-64 text-center text-gray-400">
            <Terminal className="w-12 h-12 text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-300">No snippets found</p>
          </div>
        ) : (
          filteredSnippets.map(s => {
            const Icon = CATEGORY_ICONS[s.category] || Terminal;
            return (
              <div
                key={s.id}
                className="p-4 rounded-2xl bg-[#181825] border border-white/[0.08] hover:border-white/[0.15] transition-all flex flex-col justify-between space-y-3 shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400">
                        <Icon className="w-4 h-4" />
                      </div>
                      <h4 className="text-sm font-semibold text-white">{s.title}</h4>
                    </div>

                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => {
                          setIsNew(false);
                          setEditingSnippet({ ...s });
                        }}
                        className="p-1 rounded-lg hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                        title="Edit snippet"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => removeSnippet(s.id)}
                        className="p-1 rounded-lg hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 transition-colors cursor-pointer"
                        title="Delete snippet"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {s.description && (
                    <p className="text-xs text-gray-400 mt-1 line-clamp-2">{s.description}</p>
                  )}

                  <div className="mt-2.5 p-3 rounded-xl bg-[#0d0e17] border border-white/10 shadow-inner overflow-x-auto">
                    <HighlightedCommand code={s.command} />
                  </div>
                </div>

                {/* Bottom Action Buttons */}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <button
                    onClick={() => handleCopy(s)}
                    className="flex items-center space-x-1 text-xs text-gray-400 hover:text-white cursor-pointer"
                  >
                    {copiedId === s.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === s.id ? 'Copied' : 'Copy'}</span>
                  </button>

                  <div className="flex items-center space-x-2">
                    {onBroadcast && (
                      <button
                        onClick={() => handleBroadcast(s)}
                        className="flex items-center space-x-1 px-2.5 py-1 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 text-xs transition-colors cursor-pointer"
                        title="Broadcast command to all open SSH tabs"
                      >
                        <Radio className="w-3 h-3" />
                        <span>Broadcast All</span>
                      </button>
                    )}

                    {onExecuteInActive && (
                      <button
                        onClick={() => handleExecute(s)}
                        className="flex items-center space-x-1 px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-all shadow-sm cursor-pointer"
                        title="Execute immediately in active session"
                      >
                        <Play className="w-3 h-3" />
                        <span>Run</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Edit / Add Modal */}
      {editingSnippet && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setEditingSnippet(null)}
        >
          <div 
            className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                <Terminal className="w-5 h-5 text-emerald-400" />
                <span>{isNew ? 'Create New Snippet' : 'Edit Snippet'}</span>
              </h3>
              <button onClick={() => setEditingSnippet(null)} className="text-gray-400 hover:text-white cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Snippet Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Restart Docker Engine"
                  value={editingSnippet.title}
                  onChange={e => setEditingSnippet({ ...editingSnippet, title: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Category</label>
                <select
                  value={editingSnippet.category}
                  onChange={e => setEditingSnippet({ ...editingSnippet, category: e.target.value as any })}
                  className="w-full px-3 py-2 rounded-xl bg-[#11111b] border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="system">System (OS, Memory, CPU)</option>
                  <option value="docker">Docker Containers</option>
                  <option value="network">Network & Ports</option>
                  <option value="storage">Storage & Disks</option>
                  <option value="security">Security & Firewall</option>
                  <option value="database">Database Services</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-gray-300">Command String</label>
                  <span className="text-[10px] text-emerald-400 font-mono">Bash / Shell Syntax</span>
                </div>
                <div className="h-28 rounded-xl border border-white/10 overflow-hidden bg-[#0d0e17] shadow-inner">
                  <Editor
                    height="100%"
                    language="shell"
                    theme="vs-dark"
                    value={editingSnippet.command}
                    onChange={val => setEditingSnippet({ ...editingSnippet, command: val || '' })}
                    options={{
                      fontSize: 12,
                      wordWrap: 'on',
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace",
                      lineNumbers: 'off',
                      renderWhitespace: 'selection',
                      padding: { top: 8, bottom: 8 },
                    }}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="What does this command do?"
                  value={editingSnippet.description || ''}
                  onChange={e => setEditingSnippet({ ...editingSnippet, description: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setEditingSnippet(null)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium shadow-md transition-all cursor-pointer"
                >
                  Save Snippet
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
