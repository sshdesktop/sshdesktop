import React, { useState } from 'react';
import { useConnectionStore } from '../lib/store';
import { Cloud, Plus, Server, ChevronRight, Key, Shield, Trash2, Globe, Check, AlertCircle, Play } from 'lucide-react';

export default function ConnectionScreen() {
  const { connections, addConnection, removeConnection, connect, setActive } = useConnectionStore();
  const [selectedId, setSelectedId] = useState<string | null>(connections[0]?.id || null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Quick connect form state
  const [host, setHost] = useState('');
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [serverName, setServerName] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');

  const selectedConn = connections.find(c => c.id === selectedId);

  const handleLaunch = async (connId?: string) => {
    setIsConnecting(true);
    setErrorMsg(null);
    try {
      if (connId) {
        const conn = connections.find(c => c.id === connId);
        const effectivePassword = password || (conn as any)?.password;
        const effectiveKey = privateKeyPath || (conn as any)?.privateKeyPath;
        if (!effectivePassword && !effectiveKey) {
          setErrorMsg('Please enter your SSH password or specify a private key path.');
          setIsConnecting(false);
          return;
        }
        await connect(connId, {
          password: effectivePassword,
          privateKeyPath: effectiveKey,
        });
      } else {
        if (!host.trim()) {
          setErrorMsg('Please enter a server host address or IP');
          setIsConnecting(false);
          return;
        }

        if (!password.trim() && !privateKeyPath.trim()) {
          setErrorMsg('Please enter your SSH password or specify a private key path.');
          setIsConnecting(false);
          return;
        }

        const newId = String(Date.now());
        const newConn: any = {
          id: newId,
          name: serverName.trim() || `${username}@${host.trim()}`,
          host: host.trim(),
          port: Number(port) || 22,
          username: username.trim() || 'root',
          authMethod: password ? 'password' : 'key',
          password: password || undefined,
          privateKeyPath: privateKeyPath || undefined,
          color: '#89b4fa',
          group: 'Servers',
          tags: ['Linux', 'SSH2'],
          created_at: Date.now()
        };
        addConnection(newConn);
        await connect(newId, newConn);
      }
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
      setErrorMsg(msg || 'Authentication failed: Please check server status and credentials.');
      setIsConnecting(false);
    }
  };

  const handleCreateServer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!host.trim()) return;
    const newId = String(Date.now());
    const newConn: any = {
      id: newId,
      name: serverName.trim() || `${username}@${host.trim()}`,
      host: host.trim(),
      port: Number(port) || 22,
      username: username.trim() || 'root',
      authMethod: password ? 'password' : 'key',
      password: password || undefined,
      privateKeyPath: privateKeyPath || undefined,
      color: '#cba6f7',
      group: 'Servers',
      tags: ['Ubuntu', 'Cloud'],
      created_at: Date.now()
    };
    addConnection(newConn);
    setSelectedId(newId);
    setShowAddModal(false);
  };

  return (
    <div className="w-full h-full flex bg-[#11111b] text-[#cdd6f4] select-none">
      {/* Left Sidebar: Saved Servers */}
      <div className="w-80 border-r border-white/[0.08] bg-[#181825] flex flex-col shrink-0">
        {/* Brand Header */}
        <div className="p-5 border-b border-white/[0.08] flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg">
            <Cloud className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-base text-white tracking-tight">CloudDesk</h1>
            <p className="text-[11px] text-gray-400">Agentless Linux Client</p>
          </div>
        </div>

        {/* Server List */}
        <div className="p-3 flex-1 overflow-y-auto space-y-1.5">
          <div className="text-[10px] font-bold text-gray-500 uppercase px-2 mb-2 tracking-wider">
            Saved Connections ({connections.length})
          </div>

          {connections.length === 0 ? (
            <div className="p-4 rounded-xl border border-dashed border-white/10 text-center text-xs text-gray-400">
              No saved servers yet. Enter your Linux server details to connect.
            </div>
          ) : (
            connections.map(conn => (
              <div
                key={conn.id}
                onClick={() => {
                  setSelectedId(conn.id);
                  setHost(conn.host);
                  setPort(conn.port);
                  setUsername(conn.username);
                  setPassword((conn as any).password || '');
                  setServerName(conn.name);
                }}
                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                  selectedId === conn.id
                    ? 'bg-[var(--accent)] text-black font-medium border-transparent shadow-lg'
                    : 'bg-[#1e1e2e] border-white/[0.06] hover:border-white/20 text-gray-200'
                }`}
              >
                <div className="flex items-center space-x-3 overflow-hidden">
                  <div
                    className="w-3 h-3 rounded-full shrink-0"
                    style={{ backgroundColor: conn.color || '#89b4fa' }}
                  />
                  <div className="truncate">
                    <div className="text-xs font-semibold truncate">{conn.name}</div>
                    <div className={`text-[11px] font-mono truncate ${selectedId === conn.id ? 'text-black/70' : 'text-gray-500'}`}>
                      {conn.username}@{conn.host}:{conn.port}
                    </div>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeConnection(conn.id);
                    if (selectedId === conn.id) setSelectedId(null);
                  }}
                  className={`opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-black/10 transition-opacity ${
                    selectedId === conn.id ? 'text-black' : 'text-gray-400 hover:text-red-400'
                  }`}
                  title="Remove Server"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))
          )}

          <button
            onClick={() => {
              setSelectedId(null);
              setHost('');
              setPort(22);
              setUsername('root');
              setPassword('');
              setServerName('');
              setShowAddModal(true);
            }}
            className="w-full mt-2 px-3 py-2.5 rounded-xl border border-dashed border-white/20 text-xs text-gray-400 hover:text-white hover:bg-white/5 flex items-center justify-center space-x-2 transition-colors font-medium"
          >
            <Plus className="w-4 h-4" />
            <span>Add Server Profile</span>
          </button>
        </div>

        {/* Footer info */}
        <div className="p-3 border-t border-white/[0.08] text-[11px] text-gray-500 text-center">
          Standard SSH (Port 22) · 100% Agentless
        </div>
      </div>

      {/* Main Connection Workspace */}
      <div className="flex-1 flex items-center justify-center p-8 bg-gradient-to-br from-[#181825] to-[#11111b] overflow-y-auto">
        <div className="w-full max-w-lg bg-[#1e1e2e] rounded-2xl p-7 border border-white/[0.08] shadow-2xl space-y-6">
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-red-500/15 border border-red-500/40 text-red-300 text-xs flex items-start space-x-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" />
              <div className="min-w-0">
                <div className="font-semibold text-red-200">Connection Failed</div>
                <div className="text-red-300/90 mt-0.5 break-words font-mono text-[11px] leading-relaxed">{errorMsg}</div>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white tracking-tight">
                {selectedConn ? `Connect to ${selectedConn.name}` : 'Quick Connect to Linux Server'}
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
                SSH2 Direct
              </span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Connect to your Linux server without installing any daemon or software on the server.
            </p>
          </div>

          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="text-gray-400 block mb-1 font-medium">IP Address / Hostname</label>
                <input
                  type="text"
                  value={host}
                  onChange={e => setHost(e.target.value)}
                  placeholder="e.g. 192.168.1.100 or server.com"
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="text-gray-400 block mb-1 font-medium">Port</label>
                <input
                  type="number"
                  value={port}
                  onChange={e => setPort(parseInt(e.target.value) || 22)}
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 block mb-1 font-medium">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="e.g. root or ubuntu"
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              <div>
                <label className="text-gray-400 block mb-1 font-medium">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter SSH password..."
                  className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            <div>
              <label className="text-gray-400 block mb-1 font-medium">SSH Key Path (Optional)</label>
              <input
                type="text"
                value={privateKeyPath}
                onChange={e => setPrivateKeyPath(e.target.value)}
                placeholder="e.g. C:\Users\Username\.ssh\id_rsa"
                className="w-full bg-[#11111b] border border-white/10 rounded-xl px-3 py-2 text-white font-mono focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <div className="pt-2">
            <button
              onClick={() => handleLaunch(selectedConn?.id)}
              disabled={isConnecting}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-bold rounded-xl py-3 flex items-center justify-center space-x-2 transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98] disabled:opacity-50"
            >
              <span>{isConnecting ? 'Establishing SSH Session...' : 'Launch CloudDesk Desktop'}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="border-t border-white/[0.05] pt-4 flex items-center justify-between text-[11px] text-gray-500">
            <span className="flex items-center space-x-1">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>Native SSH2 direct tunnel</span>
            </span>
            <span>Zero server installation</span>
          </div>
        </div>
      </div>

      {/* Add Server Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <form onSubmit={handleCreateServer} className="bg-[#1e1e2e] border border-white/10 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <h3 className="font-bold text-base text-white">Save Remote Server Profile</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-gray-400 block mb-1">Friendly Profile Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Production Web Node"
                  value={serverName}
                  onChange={e => setServerName(e.target.value)}
                  className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-gray-400 block mb-1">IP Address / Host</label>
                  <input
                    type="text"
                    required
                    placeholder="192.168.1.100"
                    value={host}
                    onChange={e => setHost(e.target.value)}
                    className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">Port</label>
                  <input
                    type="number"
                    value={port}
                    onChange={e => setPort(parseInt(e.target.value) || 22)}
                    className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-400 block mb-1">Username</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white font-mono focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-gray-400 block mb-1">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full bg-[#11111b] border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-xs bg-[var(--accent)] hover:bg-blue-600 text-white font-medium"
              >
                Save Profile
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
