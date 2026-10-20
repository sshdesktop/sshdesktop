import React, { useState } from 'react';
import {
  Database,
  X,
  Lock,
  Server,
  Key,
  Shield,
  AlertCircle,
  CheckCircle2,
  Zap,
  Globe,
  Layers,
  FileCode2,
  HardDrive,
  Network
} from 'lucide-react';
import { DbEngine, DbConnectionProfile } from '../types';
import { dbConnect, dbTestConnection } from '../../../lib/tauri-bridge';
import { useConnectionStore } from '../../../lib/store';

interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected: (profile: DbConnectionProfile) => void;
  initialProfile?: DbConnectionProfile | null;
}

const ENGINE_DEFAULTS: Record<DbEngine, { port: number; user: string; db: string; label: string; icon: string }> = {
  postgresql: { port: 5432, user: 'postgres', db: 'postgres', label: 'PostgreSQL', icon: '🐘' },
  mysql: { port: 3306, user: 'root', db: 'mysql', label: 'MySQL', icon: '🐬' },
  mariadb: { port: 3306, user: 'root', db: 'mysql', label: 'MariaDB', icon: '🦭' },
  sqlite: { port: 0, user: '', db: '/var/lib/sqlite/data.db', label: 'SQLite', icon: '🪶' },
  mssql: { port: 1433, user: 'sa', db: 'master', label: 'SQL Server (MSSQL)', icon: '🏢' },
  mongodb: { port: 27017, user: 'admin', db: 'admin', label: 'MongoDB', icon: '🍃' },
  redis: { port: 6379, user: 'default', db: '0', label: 'Redis', icon: '⚡' },
  oracle: { port: 1521, user: 'SYSTEM', db: 'ORCL', label: 'Oracle Database', icon: '🏛️' },
  dynamodb: { port: 8000, user: '', db: 'default', label: 'Amazon DynamoDB', icon: '📦' },
  cosmos: { port: 443, user: '', db: 'cosmos-db', label: 'Azure Cosmos DB', icon: '🪐' },
  cassandra: { port: 9042, user: 'cassandra', db: 'system', label: 'Apache Cassandra', icon: '👁️' },
  db2: { port: 50000, user: 'db2inst1', db: 'SAMPLE', label: 'IBM DB2', icon: '🔷' },
};

export const ConnectModal: React.FC<ConnectModalProps> = ({
  isOpen,
  onClose,
  onConnected,
  initialProfile
}) => {
  const activeSshId = useConnectionStore((s) => s.activeConnectionId);
  const sshConnections = useConnectionStore((s) => s.connections);
  const activeServer = sshConnections.find(c => c.id === activeSshId);

  const [engine, setEngine] = useState<DbEngine>(initialProfile?.engine || 'postgresql');
  const [name, setName] = useState(initialProfile?.name || '');
  const [host, setHost] = useState(initialProfile?.host || '127.0.0.1');
  const [port, setPort] = useState<number>(initialProfile?.port || ENGINE_DEFAULTS.postgresql.port);
  const [username, setUsername] = useState(initialProfile?.username || ENGINE_DEFAULTS.postgresql.user);
  const [password, setPassword] = useState(initialProfile?.password || '');
  const [database, setDatabase] = useState(initialProfile?.database || ENGINE_DEFAULTS.postgresql.db);
  const [schema, setSchema] = useState(initialProfile?.schema || (engine === 'postgresql' ? 'public' : ''));
  const [useSsl, setUseSsl] = useState(initialProfile?.useSsl || false);
  const [sslVerify, setSslVerify] = useState(initialProfile?.sslVerify || false);
  const [useSsh, setUseSsh] = useState<boolean>(initialProfile?.useSsh ?? Boolean(activeSshId));
  const [sshConnectionId, setSshConnectionId] = useState<string>(
    initialProfile?.sshConnectionId || activeSshId || (sshConnections[0]?.id || 'default')
  );
  const [sqlitePath, setSqlitePath] = useState(initialProfile?.sqlitePath || '/var/lib/sqlite/data.db');
  
  // Cloud & NoSQL specific
  const [accessKeyId, setAccessKeyId] = useState(initialProfile?.accessKeyId || '');
  const [secretAccessKey, setSecretAccessKey] = useState(initialProfile?.secretAccessKey || '');
  const [region, setRegion] = useState(initialProfile?.region || 'us-east-1');
  const [endpointUrl, setEndpointUrl] = useState(initialProfile?.endpointUrl || '');
  const [keyspace, setKeyspace] = useState(initialProfile?.keyspace || 'system');
  const [sid, setSid] = useState(initialProfile?.sid || 'ORCL');
  const [saveCredentialsOnServer, setSaveCredentialsOnServer] = useState(initialProfile?.saveCredentials ?? true);

  // UI States
  const [isTesting, setIsTesting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleEngineChange = (newEngine: DbEngine) => {
    setEngine(newEngine);
    const def = ENGINE_DEFAULTS[newEngine];
    setPort(def.port);
    setUsername(def.user);
    setDatabase(def.db);
    if (newEngine === 'postgresql') setSchema('public');
    else if (newEngine === 'mssql') setSchema('dbo');
    else setSchema('');
    setErrorMessage(null);
    setTestSuccess(null);
  };

  const validateInputs = (): string | null => {
    if (!name.trim()) return 'Connection Profile Name is required.';
    
    if (engine === 'sqlite') {
      if (!sqlitePath.trim() && !database.trim()) return 'SQLite database file path is required.';
      return null;
    }

    if (engine === 'dynamodb') {
      if (!region.trim()) return 'AWS Region is required (e.g. us-east-1).';
      return null;
    }

    if (engine === 'cosmos') {
      if (!endpointUrl.trim() && !host.trim()) return 'Azure Cosmos DB Endpoint URL or Host is required.';
      if (!database.trim()) return 'Cosmos Database ID is required.';
      return null;
    }

    if (!host.trim()) return 'Host / IP address is required.';
    if (!port || port <= 0 || port > 65535) return 'A valid network port (1-65535) is required.';
    if (!database.trim() && engine !== 'redis') return 'Database / Schema name is required.';
    
    return null;
  };

  const buildProfile = (): DbConnectionProfile => {
    return {
      id: initialProfile?.id || `db-${Date.now()}`,
      name: name.trim() || `${ENGINE_DEFAULTS[engine].label} Server`,
      engine,
      host: host.trim(),
      port: Number(port),
      username: username.trim(),
      password,
      database: database.trim(),
      schema: schema.trim() || undefined,
      useSsl,
      sslVerify,
      useSsh,
      sshConnectionId: useSsh ? (sshConnectionId || activeSshId || undefined) : undefined,
      sqlitePath: engine === 'sqlite' ? (sqlitePath.trim() || database.trim()) : undefined,
      accessKeyId: accessKeyId.trim() || undefined,
      secretAccessKey: secretAccessKey.trim() || undefined,
      region: region.trim() || undefined,
      endpointUrl: endpointUrl.trim() || undefined,
      keyspace: keyspace.trim() || undefined,
      sid: sid.trim() || undefined,
      lastConnected: new Date().toISOString(),
      saveCredentials: saveCredentialsOnServer,
    };
  };

  const handleTest = async () => {
    const valErr = validateInputs();
    if (valErr) {
      setErrorMessage(valErr);
      return;
    }

    setErrorMessage(null);
    setTestSuccess(null);
    setIsTesting(true);

    const profile = buildProfile();
    try {
      const caps = await dbTestConnection({
        id: profile.id,
        name: profile.name,
        engine: profile.engine,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: profile.password,
        database: profile.database,
        schema: profile.schema,
        use_ssl: profile.useSsl ?? false,
        ssl_verify: profile.sslVerify ?? false,
        use_ssh: profile.useSsh ?? false,
        ssh_connection_id: profile.sshConnectionId,
        sqlite_path: profile.sqlitePath,
        access_key_id: profile.accessKeyId,
        secret_access_key: profile.secretAccessKey,
        region: profile.region,
        endpoint_url: profile.endpointUrl,
        keyspace: profile.keyspace,
        sid: profile.sid,
      });

      setTestSuccess(`Connection successful! Server: ${caps.server_version || profile.engine}`);
    } catch (err: any) {
      setErrorMessage(`Test Connection Failed: ${err?.message || err}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleConnectNow = async () => {
    const valErr = validateInputs();
    if (valErr) {
      setErrorMessage(valErr);
      return;
    }

    setErrorMessage(null);
    setIsConnecting(true);

    const profile = buildProfile();
    try {
      await dbConnect({
        id: profile.id,
        name: profile.name,
        engine: profile.engine,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: profile.password,
        database: profile.database,
        schema: profile.schema,
        use_ssl: profile.useSsl ?? false,
        ssl_verify: profile.sslVerify ?? false,
        use_ssh: profile.useSsh ?? false,
        ssh_connection_id: profile.sshConnectionId,
        sqlite_path: profile.sqlitePath,
        access_key_id: profile.accessKeyId,
        secret_access_key: profile.secretAccessKey,
        region: profile.region,
        endpoint_url: profile.endpointUrl,
        keyspace: profile.keyspace,
        sid: profile.sid,
      });

      // Auto-open dedicated studio window & pass profile
      onConnected(profile);
      onClose();
    } catch (err: any) {
      setErrorMessage(`Connect Failed: ${err?.message || err}`);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#1e1e2e]/95 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in fade-in zoom-in duration-150">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-black/20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center text-xl shadow-inner border border-blue-500/30">
              {ENGINE_DEFAULTS[engine].icon}
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-wide">
                Connect to Database
              </h2>
              <p className="text-xs text-gray-400">
                Select engine, configure credentials and open dedicated studio
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Engine Tabs Bar */}
        <div className="px-6 pt-3 pb-2 border-b border-white/5 bg-black/10 overflow-x-auto flex gap-1.5 scrollbar-thin">
          {(Object.keys(ENGINE_DEFAULTS) as DbEngine[]).map((eng) => (
            <button
              key={eng}
              onClick={() => handleEngineChange(eng)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 shrink-0 transition-all ${
                engine === eng
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20 ring-1 ring-blue-400/50'
                  : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <span>{ENGINE_DEFAULTS[eng].icon}</span>
              <span>{ENGINE_DEFAULTS[eng].label}</span>
            </button>
          ))}
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          {/* Alert / Errors */}
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-red-200 text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1">{errorMessage}</div>
            </div>
          )}

          {testSuccess && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2.5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="flex-1">{testSuccess}</div>
            </div>
          )}

          {/* Profile Name */}
          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1">
              Connection Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`e.g. Production ${ENGINE_DEFAULTS[engine].label}`}
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Engine Specific Fields */}
          {engine === 'sqlite' ? (
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">
                SQLite Database Path (Local or Remote Server) *
              </label>
              <input
                type="text"
                value={sqlitePath}
                onChange={(e) => {
                  setSqlitePath(e.target.value);
                  setDatabase(e.target.value);
                }}
                placeholder="/home/user/app.db or C:\data\database.db"
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          ) : engine === 'dynamodb' ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    AWS Region *
                  </label>
                  <input
                    type="text"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="us-east-1"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Local / Custom Endpoint (Optional)
                  </label>
                  <input
                    type="text"
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    placeholder="http://localhost:8000"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    AWS Access Key ID
                  </label>
                  <input
                    type="text"
                    value={accessKeyId}
                    onChange={(e) => setAccessKeyId(e.target.value)}
                    placeholder="AKIAIOSFODNN7EXAMPLE"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    AWS Secret Access Key
                  </label>
                  <input
                    type="password"
                    value={secretAccessKey}
                    onChange={(e) => setSecretAccessKey(e.target.value)}
                    placeholder="••••••••••••••••••••"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          ) : engine === 'cosmos' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Cosmos DB Endpoint URL *
                </label>
                <input
                  type="text"
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  placeholder="https://my-account.documents.azure.com:443/"
                  className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Cosmos Database ID *
                  </label>
                  <input
                    type="text"
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    placeholder="e.g. main-db"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Primary / Master Key
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Cosmos Primary Key"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Host and Port */}
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Host / IP Address *
                  </label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="127.0.0.1 or server.domain.com"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Port *
                  </label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(parseInt(e.target.value) || 0)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Database and Schema / SID / Keyspace */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    {engine === 'cassandra' ? 'Keyspace *' : engine === 'oracle' ? 'SID / Service Name *' : 'Database Name *'}
                  </label>
                  <input
                    type="text"
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    placeholder={engine === 'cassandra' ? 'my_keyspace' : engine === 'oracle' ? 'ORCL' : 'mydb'}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Default Schema
                  </label>
                  <input
                    type="text"
                    value={schema}
                    onChange={(e) => setSchema(e.target.value)}
                    placeholder={engine === 'postgresql' ? 'public' : engine === 'mssql' ? 'dbo' : 'optional'}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Username and Password */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* SSH Tunneling Section */}
          <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-blue-400" />
                <div>
                  <span className="text-xs font-medium text-white block">SSH Tunneling</span>
                  <span className="text-[11px] text-gray-400 block">
                    Tunnel connection securely through remote SSH server
                  </span>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useSsh}
                  onChange={(e) => setUseSsh(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>

            {useSsh && (
              <div className="pt-2.5 border-t border-white/5 space-y-2 text-xs">
                {activeServer ? (
                  <div className="flex items-center justify-between p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-200">
                    <div className="flex items-center gap-2 truncate">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
                      <span className="font-medium truncate">{activeServer.name || activeServer.host}</span>
                      <span className="text-[11px] text-blue-300 font-mono">({activeServer.host}:{activeServer.port})</span>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">Active SSH</span>
                  </div>
                ) : sshConnections.length > 0 ? (
                  <div>
                    <label className="block text-[11px] text-gray-400 mb-1">Select SSH Server:</label>
                    <select
                      value={sshConnectionId}
                      onChange={(e) => setSshConnectionId(e.target.value)}
                      className="w-full px-2.5 py-1.5 bg-black/40 border border-white/10 rounded-lg text-xs text-white"
                    >
                      {sshConnections.map(c => (
                        <option key={c.id} value={c.id}>{c.name || c.host} ({c.host}:{c.port})</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-[11px] flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>No active SSH connection. Connect to your Linux server via SSH first, or uncheck to connect directly.</span>
                  </div>
                )}
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  Target host <code className="text-blue-300 bg-white/5 px-1 py-0.5 rounded">{host || '127.0.0.1'}:{port}</code> will be connected from inside the remote server.
                </p>
              </div>
            )}
          </div>

          {/* SSL / TLS Encryption Section */}
          <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-medium text-white">SSL / TLS Encryption</span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={useSsl}
                  onChange={(e) => setUseSsl(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            {useSsl && (
              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs text-gray-400">
                <span>Strict Certificate Validation (Verify CA)</span>
                <input
                  type="checkbox"
                  checked={sslVerify}
                  onChange={(e) => setSslVerify(e.target.checked)}
                  className="rounded border-white/20 bg-white/10 text-blue-600 focus:ring-0"
                />
              </div>
            )}
          </div>

          {/* Save Credentials Checkbox */}
          <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-400" />
              <div>
                <span className="font-medium text-white block">Save Credentials on Server</span>
                <span className="text-[11px] text-gray-400 block">
                  Persist username & password securely in ~/.sshdesktop/database_profiles.json
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={saveCredentialsOnServer}
              onChange={(e) => setSaveCredentialsOnServer(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-white/10 text-blue-600 focus:ring-0 cursor-pointer"
            />
          </div>
        </div>

        {/* Modal Actions */}
        <div className="px-6 py-4 border-t border-white/10 bg-black/20 flex items-center justify-between">
          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting || isConnecting}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-white/10 text-white hover:bg-white/15 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isTesting && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            <span>Test Connection</span>
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConnectNow}
              disabled={isConnecting || isTesting}
              className="px-5 py-2 rounded-xl text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isConnecting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Connecting...</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5" />
                  <span>Connect Now</span>
                </>
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
