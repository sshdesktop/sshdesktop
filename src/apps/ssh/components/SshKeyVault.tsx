import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import { 
  Key, Plus, Copy, Check, Download, Upload, Trash2, 
  ShieldCheck, Eye, EyeOff, Server, Terminal, AlertCircle,
  FileCode, Sparkles, RefreshCw
} from 'lucide-react';
import { SshKeyItem, SshKeyAlgorithm } from '../types';
import { useSshStore } from '../sshStore';
import { generateSshKeyPair, parseAuthorizedKeyLine } from '../utils/sshKeyCrypto';
import { useConnectionStore } from '../../../lib/store';
import { sshExec } from '../../../lib/tauri-bridge';

export default function SshKeyVault({ isLight = false }: { isLight?: boolean }) {
  const { keys, addKey, removeKey, markKeyPushedToServer, addAuditLog } = useSshStore();
  const { activeConnectionId, connections } = useConnectionStore();
  const activeServer = connections.find(c => c.id === activeConnectionId);

  const [searchQuery, setSearchQuery] = useState('');
  const [showGenModal, setShowGenModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [viewingKey, setViewingKey] = useState<SshKeyItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pushingKeyId, setPushingKeyId] = useState<string | null>(null);
  const [pushedSuccessId, setPushedSuccessId] = useState<string | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  // Key Generation State
  const [genName, setGenName] = useState('');
  const [genAlgorithm, setGenAlgorithm] = useState<SshKeyAlgorithm>('ed25519');
  const [genComment, setGenComment] = useState('user@sshdesktop');
  const [genPassphrase, setGenPassphrase] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Import Key State
  const [importName, setImportName] = useState('');
  const [importPublicKey, setImportPublicKey] = useState('');
  const [importPrivateKey, setImportPrivateKey] = useState('');

  const filteredKeys = keys.filter(k => 
    k.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    k.algorithm.toLowerCase().includes(searchQuery.toLowerCase()) ||
    k.comment.toLowerCase().includes(searchQuery.toLowerCase()) ||
    k.fingerprint.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleCopyPublicKey = (key: SshKeyItem) => {
    navigator.clipboard.writeText(key.publicKey);
    setCopiedId(key.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDownloadPrivateKey = (key: SshKeyItem) => {
    const blob = new Blob([key.privateKey], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${key.name || 'id_' + key.algorithm}.pem`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPublicKey = (key: SshKeyItem) => {
    const blob = new Blob([key.publicKey], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${key.name || 'id_' + key.algorithm}.pub`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Push public key directly to connected remote server's ~/.ssh/authorized_keys
  const handlePushToServer = async (key: SshKeyItem) => {
    if (!activeConnectionId || !activeServer) {
      setPushError('No active server connection. Connect to a server first.');
      return;
    }

    setPushingKeyId(key.id);
    setPushError(null);

    try {
      const sanitizedPub = key.publicKey.replace(/'/g, "'\\''").trim();
      const pushCmd = `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qF '${sanitizedPub}' ~/.ssh/authorized_keys || echo '${sanitizedPub}' >> ~/.ssh/authorized_keys`;

      const res = await sshExec(activeConnectionId, pushCmd);
      if (res.exit_code === 0) {
        markKeyPushedToServer(key.id, activeServer.host);
        setPushedSuccessId(key.id);
        setTimeout(() => setPushedSuccessId(null), 3000);

        addAuditLog({
          action: 'Authorized Key Pushed',
          host: activeServer.host,
          username: activeServer.username,
          status: 'success',
          details: `Appended ${key.name} (${key.algorithm}) to remote ~/.ssh/authorized_keys`,
        });
      } else {
        setPushError(res.stderr || 'Failed to append key to authorized_keys');
      }
    } catch (err: any) {
      setPushError(String(err?.message || err));
    } finally {
      setPushingKeyId(null);
    }
  };

  // Generate new SSH Keypair
  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!genName.trim()) return;

    setIsGenerating(true);
    try {
      const { publicKey, privateKey, fingerprint } = await generateSshKeyPair(
        genAlgorithm,
        genComment.trim() || 'sshdesktop-key',
        genPassphrase.trim() || undefined
      );

      const newKeyItem: SshKeyItem = {
        id: `key-${Date.now()}`,
        name: genName.trim(),
        algorithm: genAlgorithm,
        fingerprint,
        publicKey,
        privateKey,
        comment: genComment.trim() || 'sshdesktop-key',
        passphraseProtected: !!genPassphrase.trim(),
        createdAt: Date.now(),
      };

      addKey(newKeyItem);
      setShowGenModal(false);

      // Reset
      setGenName('');
      setGenPassphrase('');

      addAuditLog({
        action: 'Generated SSH Key',
        host: 'Local Vault',
        username: 'client',
        status: 'success',
        details: `Created new ${genAlgorithm.toUpperCase()} keypair: ${newKeyItem.name} (${fingerprint})`,
      });
    } catch (err: any) {
      alert(`Key generation error: ${err?.message || err}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Import Key
  const handleImportKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!importName.trim() || !importPublicKey.trim()) return;

    try {
      const parsed = await parseAuthorizedKeyLine(importPublicKey.trim(), 0);
      const fingerprint = parsed?.fingerprint || `SHA256:imported-${Math.random().toString(36).slice(2, 8)}`;
      let algo: SshKeyAlgorithm = 'ed25519';
      if (importPublicKey.includes('ssh-rsa')) algo = 'rsa-4096';
      else if (importPublicKey.includes('nistp384')) algo = 'ecdsa-p384';
      else if (importPublicKey.includes('nistp256')) algo = 'ecdsa-p256';

      const imported: SshKeyItem = {
        id: `key-import-${Date.now()}`,
        name: importName.trim(),
        algorithm: algo,
        fingerprint,
        publicKey: importPublicKey.trim(),
        privateKey: importPrivateKey.trim() || '# Private key not provided during import',
        comment: parsed?.comment || 'imported-key',
        passphraseProtected: false,
        createdAt: Date.now(),
      };

      addKey(imported);
      setShowImportModal(false);
      setImportName('');
      setImportPublicKey('');
      setImportPrivateKey('');

      addAuditLog({
        action: 'Imported SSH Key',
        host: 'Local Vault',
        username: 'client',
        status: 'success',
        details: `Imported ${algo.toUpperCase()} key: ${imported.name}`,
      });
    } catch (err: any) {
      alert(`Import error: ${err?.message || err}`);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#1e1e2e]/90 text-gray-200 select-none overflow-hidden font-sans">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-[#181825] border-b border-white/[0.08]">
        <div>
          <h2 className="text-base font-semibold text-white flex items-center space-x-2">
            <Key className="w-5 h-5 text-amber-400" />
            <span>SSH Key Vault & Generator</span>
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Generate Ed25519, RSA 4096, & ECDSA key pairs and push directly to remote servers
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          {/* Search box */}
          <input
            type="text"
            placeholder="Search keys..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 w-44"
          />

          {/* Import Button */}
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-medium transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Key</span>
          </button>

          {/* Generate Button */}
          <button
            onClick={() => {
              setGenName(`id_${genAlgorithm}_${Date.now().toString().slice(-4)}`);
              setShowGenModal(true);
            }}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generate New Key</span>
          </button>
        </div>
      </div>

      {/* Push Error Notification */}
      {pushError && (
        <div className="mx-6 mt-3 px-4 py-2 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs text-rose-300 flex items-center justify-between">
          <span>{pushError}</span>
          <button onClick={() => setPushError(null)} className="text-rose-300 hover:text-white">✕</button>
        </div>
      )}

      {/* Keys List */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {filteredKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center text-gray-400">
            <Key className="w-12 h-12 text-gray-600 mb-3" />
            <p className="text-sm font-medium text-gray-300">No SSH keys in vault</p>
            <p className="text-xs text-gray-500 mt-1 max-w-sm">
              Generate modern Ed25519 or 4096-bit RSA keys with instant 1-click deployment to your Linux servers.
            </p>
            <div className="flex items-center space-x-2 mt-4">
              <button
                onClick={() => {
                  setGenName('id_ed25519_production');
                  setShowGenModal(true);
                }}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium transition-all shadow-md cursor-pointer"
              >
                Generate Ed25519 Key
              </button>
              <button
                onClick={() => setShowImportModal(true)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium border border-white/10 transition-colors cursor-pointer"
              >
                Import Existing Key
              </button>
            </div>
          </div>
        ) : (
          filteredKeys.map(key => {
            const isPushedToActive = activeServer && key.pushedServers?.includes(activeServer.host);
            const isPushing = pushingKeyId === key.id;
            const isPushedSuccess = pushedSuccessId === key.id;

            return (
              <div
                key={key.id}
                className="p-4 rounded-2xl bg-[#181825] border border-white/[0.08] hover:border-white/[0.15] transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm"
              >
                {/* Left: Key Info */}
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center space-x-2.5">
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono uppercase font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      {key.algorithm}
                    </span>
                    <h3 className="text-sm font-semibold text-white truncate">{key.name}</h3>
                    {key.passphraseProtected && (
                      <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 text-[10px] font-medium border border-blue-500/30">
                        Passphrase Protected
                      </span>
                    )}
                    {isPushedToActive && (
                      <span className="flex items-center space-x-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-medium border border-emerald-500/30">
                        <Check className="w-3 h-3" />
                        <span>Authorized on Server</span>
                      </span>
                    )}
                  </div>

                  {/* Fingerprint */}
                  <div className="text-xs font-mono text-gray-400 truncate">
                    <span className="text-gray-500 mr-1.5">Fingerprint:</span>
                    <span className="text-cyan-300">{key.fingerprint}</span>
                  </div>

                  {/* Comment & Date */}
                  <div className="flex items-center space-x-3 text-[11px] text-gray-500">
                    <span>Comment: {key.comment}</span>
                    <span>•</span>
                    <span>Created: {new Date(key.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center space-x-2 shrink-0">
                  {/* Push to Active Server */}
                  <button
                    onClick={() => handlePushToServer(key)}
                    disabled={isPushing}
                    className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all cursor-pointer shadow-sm ${
                      isPushedSuccess
                        ? 'bg-emerald-600 text-white'
                        : isPushedToActive
                        ? 'bg-white/5 hover:bg-white/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                    title={activeServer ? `Push to ${activeServer.username}@${activeServer.host}` : 'Connect to a server to push this key'}
                  >
                    {isPushing ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : isPushedSuccess || isPushedToActive ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Server className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {isPushing ? 'Pushing...' : isPushedSuccess ? 'Authorized!' : isPushedToActive ? 'Re-push Key' : 'Push to Server'}
                    </span>
                  </button>

                  {/* Copy Public Key */}
                  <button
                    onClick={() => handleCopyPublicKey(key)}
                    className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs transition-colors cursor-pointer"
                    title="Copy OpenSSH public key to clipboard"
                  >
                    {copiedId === key.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === key.id ? 'Copied' : 'Copy Pub'}</span>
                  </button>

                  {/* View Details */}
                  <button
                    onClick={() => setViewingKey(key)}
                    className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                    title="View public & private key text"
                  >
                    <Eye className="w-4 h-4" />
                  </button>

                  {/* Download Private Key */}
                  <button
                    onClick={() => handleDownloadPrivateKey(key)}
                    className="p-1.5 rounded-xl hover:bg-white/10 text-gray-400 hover:text-cyan-300 transition-colors cursor-pointer"
                    title="Download private key (.pem)"
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  {/* Delete Key */}
                  <button
                    onClick={() => removeKey(key.id)}
                    className="p-1.5 rounded-xl hover:bg-rose-500/20 text-gray-400 hover:text-rose-300 transition-colors cursor-pointer"
                    title="Delete key from vault"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Generate Key Modal */}
      {showGenModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setShowGenModal(false)}
        >
          <div 
            className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <span>Generate Cryptographic SSH Key Pair</span>
              </h3>
              <button onClick={() => setShowGenModal(false)} className="text-gray-400 hover:text-white cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleGenerateKey} className="space-y-4">
              {/* Key Name */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Key Name / Identifier</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. id_ed25519_production"
                  value={genName}
                  onChange={e => setGenName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Algorithm */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1.5">Key Algorithm</label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'ed25519', name: 'Ed25519 (Recommended)', desc: '256-bit elliptic curve, high security & speed' },
                    { id: 'rsa-4096', name: 'RSA 4096-bit', desc: 'Maximum legacy SSH server compatibility' },
                    { id: 'ecdsa-p256', name: 'ECDSA P-256', desc: 'NIST standardized curve' },
                    { id: 'ecdsa-p384', name: 'ECDSA P-384', desc: 'Higher security NIST curve' },
                  ].map(algo => (
                    <button
                      key={algo.id}
                      type="button"
                      onClick={() => setGenAlgorithm(algo.id as SshKeyAlgorithm)}
                      className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all ${
                        genAlgorithm === algo.id
                          ? 'bg-amber-500/20 border-amber-500 text-white font-medium'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      <div className="text-xs font-semibold">{algo.name}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5 leading-tight">{algo.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Comment */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Key Comment</label>
                <input
                  type="text"
                  placeholder="user@sshdesktop"
                  value={genComment}
                  onChange={e => setGenComment(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Passphrase */}
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Passphrase (Optional)</label>
                <input
                  type="password"
                  placeholder="Leave empty for passwordless key"
                  value={genPassphrase}
                  onChange={e => setGenPassphrase(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowGenModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isGenerating}
                  className="flex items-center space-x-1.5 px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium shadow-md transition-all cursor-pointer"
                >
                  {isGenerating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  <span>{isGenerating ? 'Generating...' : 'Generate Key Pair'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import Key Modal */}
      {showImportModal && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setShowImportModal(false)}
        >
          <div 
            className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                <Upload className="w-5 h-5 text-blue-400" />
                <span>Import Existing SSH Key</span>
              </h3>
              <button onClick={() => setShowImportModal(false)} className="text-gray-400 hover:text-white cursor-pointer">✕</button>
            </div>

            <form onSubmit={handleImportKey} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Key Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. imported_rsa_server"
                  value={importName}
                  onChange={e => setImportName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Public Key (OpenSSH Format)</label>
                <textarea
                  rows={3}
                  required
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... user@host"
                  value={importPublicKey}
                  onChange={e => setImportPublicKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Private Key (Optional, PEM Format)</label>
                <textarea
                  rows={4}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                  value={importPrivateKey}
                  onChange={e => setImportPrivateKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-md transition-all cursor-pointer"
                >
                  Import Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Key Modal */}
      {viewingKey && (
        <div 
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setViewingKey(null)}
        >
          <div 
            className="bg-[#181825] border border-white/20 rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                <Key className="w-5 h-5 text-amber-400" />
                <span>{viewingKey.name}</span>
              </h3>
              <button onClick={() => setViewingKey(null)} className="text-gray-400 hover:text-white cursor-pointer">✕</button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-300">OpenSSH Public Key (.pub)</span>
                  <button
                    onClick={() => handleCopyPublicKey(viewingKey)}
                    className="text-xs text-blue-400 hover:text-blue-300 cursor-pointer flex items-center space-x-1"
                  >
                    <Copy className="w-3 h-3" />
                    <span>Copy Key</span>
                  </button>
                </div>
                {(() => {
                  const parts = (viewingKey.publicKey || '').trim().split(/\s+/);
                  const algo = parts[0] || 'ssh-key';
                  const payload = parts[1] || '';
                  const comment = parts.slice(2).join(' ');
                  return (
                    <div className="p-3 bg-[#0d0e17] border border-white/10 rounded-xl text-xs font-mono select-all leading-relaxed space-y-1.5 shadow-inner">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                          {algo}
                        </span>
                        {comment && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/25">
                            {comment}
                          </span>
                        )}
                      </div>
                      <div className="text-cyan-300 break-all text-[11px]">
                        {payload || viewingKey.publicKey}
                      </div>
                    </div>
                  );
                })()}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-gray-300">Private Key (.pem / OpenSSH Format)</span>
                  <button
                    onClick={() => handleDownloadPrivateKey(viewingKey)}
                    className="text-xs text-amber-400 hover:text-amber-300 cursor-pointer flex items-center space-x-1"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download .pem</span>
                  </button>
                </div>
                <div className="h-44 rounded-xl border border-white/10 overflow-hidden bg-[#0d0e17] shadow-inner">
                  <Editor
                    height="100%"
                    language="plaintext"
                    theme="vs-dark"
                    value={viewingKey.privateKey || 'No private key stored'}
                    options={{
                      readOnly: true,
                      domReadOnly: true,
                      fontSize: 11,
                      wordWrap: 'on',
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      fontFamily: "'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', monospace",
                      lineNumbers: 'on',
                      padding: { top: 8, bottom: 8 },
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setViewingKey(null)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-medium cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
