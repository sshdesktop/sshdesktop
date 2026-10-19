import React, { useState, useEffect } from 'react';
import {
  Database,
  Plus,
  Play,
  Trash2,
  Edit2,
  Shield,
  Layers,
  ArrowRight,
  RefreshCw,
  Search,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Network,
  Loader2
} from 'lucide-react';
import { DbConnectionProfile, DbEngine } from './types';
import { ConnectModal } from './modals/ConnectModal';
import { PostgresStudio } from './engines/PostgresStudio';
import { MysqlStudio } from './engines/MysqlStudio';
import { MssqlStudio } from './engines/MssqlStudio';
import { SqliteStudio } from './engines/SqliteStudio';
import { MongoStudio } from './engines/MongoStudio';
import { RedisStudio } from './engines/RedisStudio';
import { OracleStudio } from './engines/OracleStudio';
import { DynamoStudio } from './engines/DynamoStudio';
import { CosmosStudio } from './engines/CosmosStudio';
import { CassandraStudio } from './engines/CassandraStudio';
import { Db2Studio } from './engines/Db2Studio';
import { DatabaseErrorBoundary } from './components';
import { dbConnect, sftpReadTextFile, sftpWriteTextFile } from '../../lib/tauri-bridge';
import { useConnectionStore } from '../../lib/store';

const ENGINE_BADGES: Record<DbEngine, { label: string; icon: string; color: string }> = {
  postgresql: { label: 'PostgreSQL', icon: '🐘', color: 'from-blue-600/20 to-blue-800/10 border-blue-500/30 text-blue-400' },
  mysql: { label: 'MySQL', icon: '🐬', color: 'from-cyan-600/20 to-cyan-800/10 border-cyan-500/30 text-cyan-400' },
  mariadb: { label: 'MariaDB', icon: '🦭', color: 'from-teal-600/20 to-teal-800/10 border-teal-500/30 text-teal-400' },
  sqlite: { label: 'SQLite', icon: '🪶', color: 'from-emerald-600/20 to-emerald-800/10 border-emerald-500/30 text-emerald-400' },
  mssql: { label: 'SQL Server', icon: '🏢', color: 'from-red-600/20 to-red-800/10 border-red-500/30 text-red-400' },
  mongodb: { label: 'MongoDB', icon: '🍃', color: 'from-green-600/20 to-green-800/10 border-green-500/30 text-green-400' },
  redis: { label: 'Redis', icon: '⚡', color: 'from-rose-600/20 to-rose-800/10 border-rose-500/30 text-rose-400' },
  oracle: { label: 'Oracle Database', icon: '🏛️', color: 'from-orange-600/20 to-orange-800/10 border-orange-500/30 text-orange-400' },
  dynamodb: { label: 'Amazon DynamoDB', icon: '📦', color: 'from-amber-600/20 to-amber-800/10 border-amber-500/30 text-amber-400' },
  cosmos: { label: 'Azure Cosmos DB', icon: '🪐', color: 'from-sky-600/20 to-sky-800/10 border-sky-500/30 text-sky-400' },
  cassandra: { label: 'Apache Cassandra', icon: '👁️', color: 'from-violet-600/20 to-violet-800/10 border-violet-500/30 text-violet-400' },
  db2: { label: 'IBM DB2', icon: '🔷', color: 'from-indigo-600/20 to-indigo-800/10 border-indigo-500/30 text-indigo-400' },
};

export const DatabaseHub: React.FC = () => {
  const activeSshId = useConnectionStore((s) => s.activeConnectionId);
  const activeSshServer = useConnectionStore((s) => s.connections.find(c => c.id === activeSshId));

  const [profiles, setProfiles] = useState<DbConnectionProfile[]>(() => {
    try {
      const saved = localStorage.getItem('clouddesk_db_profiles_v2');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      {
        id: 'prof-pg-default',
        name: 'PostgreSQL Server',
        engine: 'postgresql',
        host: '127.0.0.1',
        port: 5432,
        username: 'postgres',
        database: 'postgres',
        schema: 'public',
        useSsl: false,
        useSsh: true,
      },
      {
        id: 'prof-mysql-default',
        name: 'MySQL Server',
        engine: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        username: 'root',
        database: 'mysql',
        useSsl: false,
        useSsh: true,
      },
      {
        id: 'prof-redis-default',
        name: 'Redis Cache',
        engine: 'redis',
        host: '127.0.0.1',
        port: 6379,
        username: '',
        database: '0',
        useSsl: false,
        useSsh: true,
      },
      {
        id: 'prof-mongo-default',
        name: 'MongoDB Server',
        engine: 'mongodb',
        host: '127.0.0.1',
        port: 27017,
        username: 'admin',
        database: 'admin',
        useSsl: false,
        useSsh: true,
      }
    ];
  });

  const [activeProfile, setActiveProfile] = useState<DbConnectionProfile | null>(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<DbConnectionProfile | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<{ id: string; message: string } | null>(null);

  const username = activeSshServer?.username || 'root';
  const userHome = username === 'root' ? '/root' : `/home/${username}`;

  // Hydrate database profiles from server ~/.clouddesk/database_profiles.json
  useEffect(() => {
    if (!activeSshId) return;
    const loadServerDbProfiles = async () => {
      try {
        const text = await sftpReadTextFile(activeSshId, `${userHome}/.clouddesk/database_profiles.json`);
        if (text) {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setProfiles(prev => {
              const map = new Map(prev.map(p => [p.id, p]));
              parsed.forEach((p: DbConnectionProfile) => map.set(p.id, p));
              return Array.from(map.values());
            });
          }
        }
      } catch {}
    };
    loadServerDbProfiles();
  }, [activeSshId, userHome]);

  // Persist database profiles to localStorage and server ~/.clouddesk/database_profiles.json
  useEffect(() => {
    try {
      localStorage.setItem('clouddesk_db_profiles_v2', JSON.stringify(profiles));
    } catch {}

    if (activeSshId) {
      const toSave = profiles.map(p => {
        if (p.saveCredentials === false) {
          const { password, ...rest } = p;
          return rest;
        }
        return p;
      });
      sftpWriteTextFile(activeSshId, `${userHome}/.clouddesk/database_profiles.json`, JSON.stringify(toSave, null, 2)).catch(() => {});
    }
  }, [profiles, activeSshId, userHome]);

  const handleOpenStudio = async (p: DbConnectionProfile) => {
    if (connectingId) return;
    setConnectingId(p.id);
    setConnectionError(null);

    // Auto-detect if SSH tunnel is needed
    const currentActiveSshId = useConnectionStore.getState().activeConnectionId;
    const shouldTunnel = p.useSsh ?? (Boolean(currentActiveSshId) && (p.host === '127.0.0.1' || p.host === 'localhost' || !p.host));
    const effectiveProfile: DbConnectionProfile = {
      ...p,
      useSsh: shouldTunnel,
      sshConnectionId: p.sshConnectionId || (currentActiveSshId || undefined),
    };

    try {
      await dbConnect({
        id: effectiveProfile.id,
        name: effectiveProfile.name,
        engine: effectiveProfile.engine,
        host: effectiveProfile.host,
        port: effectiveProfile.port,
        username: effectiveProfile.username,
        password: effectiveProfile.password,
        database: effectiveProfile.database,
        schema: effectiveProfile.schema,
        use_ssl: effectiveProfile.useSsl ?? false,
        ssl_verify: effectiveProfile.sslVerify ?? false,
        use_ssh: effectiveProfile.useSsh ?? false,
        ssh_connection_id: effectiveProfile.sshConnectionId,
        sqlite_path: effectiveProfile.sqlitePath,
        access_key_id: effectiveProfile.accessKeyId,
        secret_access_key: effectiveProfile.secretAccessKey,
        region: effectiveProfile.region,
        endpoint_url: effectiveProfile.endpointUrl,
        keyspace: effectiveProfile.keyspace,
        sid: effectiveProfile.sid,
      });

      // Update stored profile with verified connection config
      setProfiles(prev => prev.map(item => item.id === p.id ? effectiveProfile : item));
      setActiveProfile(effectiveProfile);
    } catch (err: any) {
      console.error('Failed to connect to database:', err);
      const msg = String(err?.message || err);
      setConnectionError({ id: p.id, message: msg });
    } finally {
      setConnectingId(null);
    }
  };

  const handleConnected = (profile: DbConnectionProfile) => {
    setProfiles(prev => {
      const existing = prev.findIndex(p => p.id === profile.id);
      if (existing >= 0) {
        const copy = [...prev];
        copy[existing] = profile;
        return copy;
      }
      return [profile, ...prev];
    });

    // Auto-open dedicated studio window
    setActiveProfile(profile);
  };

  const handleDeleteProfile = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setProfiles(prev => prev.filter(p => p.id !== id));
    if (activeProfile?.id === id) {
      setActiveProfile(null);
    }
    if (connectionError?.id === id) {
      setConnectionError(null);
    }
  };

  const handleEditProfile = (p: DbConnectionProfile, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingProfile(p);
    setIsConnectModalOpen(true);
  };

  // If a dedicated engine studio is active, render that engine's dedicated window:
  if (activeProfile) {
    return (
      <div className="w-full h-full flex flex-col overflow-hidden relative">
        {/* Back / Switch Bar */}
        <div className="h-8 bg-black/40 border-b border-white/10 px-3 flex items-center justify-between text-xs shrink-0 z-10">
          <button
            onClick={() => setActiveProfile(null)}
            className="flex items-center gap-1.5 text-gray-400 hover:text-white transition-colors"
          >
            <span>← Database Studios Hub</span>
          </button>
          <div className="flex items-center gap-2">
            {activeProfile.useSsh && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-blue-500/20 text-blue-300 border border-blue-500/30 font-mono">
                <Network className="w-2.5 h-2.5" /> SSH Tunneled
              </span>
            )}
            <span className="text-[11px] text-gray-300 font-mono font-medium">{activeProfile.name}</span>
            <button
              onClick={() => setActiveProfile(null)}
              className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-gray-300 hover:text-white hover:bg-white/15 transition-colors"
            >
              Switch Database
            </button>
          </div>
        </div>

        {/* Studio Window Body */}
        <div className="flex-1 overflow-hidden bg-[#181825]">
          <DatabaseErrorBoundary onBackToHub={() => setActiveProfile(null)} engineName={activeProfile.engine}>
            {(activeProfile.engine === 'postgresql' || (activeProfile.engine as string) === 'postgres') && <PostgresStudio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {(activeProfile.engine === 'mysql' || activeProfile.engine === 'mariadb') && <MysqlStudio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {(activeProfile.engine === 'mssql' || (activeProfile.engine as string) === 'sqlserver') && <MssqlStudio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {(activeProfile.engine === 'sqlite' || (activeProfile.engine as string) === 'sqlite3') && <SqliteStudio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {(activeProfile.engine === 'mongodb' || (activeProfile.engine as string) === 'mongo') && <MongoStudio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {activeProfile.engine === 'redis' && <RedisStudio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {activeProfile.engine === 'oracle' && <OracleStudio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {(activeProfile.engine === 'dynamodb' || (activeProfile.engine as string) === 'dynamo') && <DynamoStudio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {(activeProfile.engine === 'cosmos' || (activeProfile.engine as string) === 'cosmosdb') && <CosmosStudio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {activeProfile.engine === 'cassandra' && <CassandraStudio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {activeProfile.engine === 'db2' && <Db2Studio profile={activeProfile} onDisconnect={() => setActiveProfile(null)} />}
            {!['postgresql', 'postgres', 'mysql', 'mariadb', 'mssql', 'sqlserver', 'sqlite', 'sqlite3', 'mongodb', 'mongo', 'redis', 'oracle', 'dynamodb', 'dynamo', 'cosmos', 'cosmosdb', 'cassandra', 'db2'].includes((activeProfile.engine as string).toLowerCase()) && (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center text-gray-400">
                <AlertCircle className="w-12 h-12 text-amber-400 mb-3" />
                <h3 className="text-sm font-bold text-white mb-1">Unsupported Database Engine</h3>
                <p className="text-xs text-gray-400 max-w-sm mb-4">
                  The engine &ldquo;{activeProfile.engine}&rdquo; is not recognized by CloudDesk Database Studios.
                </p>
                <button
                  onClick={() => setActiveProfile(null)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold shadow-lg transition-colors"
                >
                  Return to Database Studios Hub
                </button>
              </div>
            )}
          </DatabaseErrorBoundary>
        </div>
      </div>
    );
  }

  const filteredProfiles = profiles.filter(p =>
    p.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
    p.engine.toLowerCase().includes(searchFilter.toLowerCase()) ||
    p.host.toLowerCase().includes(searchFilter.toLowerCase()) ||
    p.database.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="w-full h-full bg-[#181825] flex flex-col overflow-hidden text-gray-200 select-none">
      {/* Top Banner & Header */}
      <div className="px-6 py-4 border-b border-white/10 bg-black/20 shrink-0">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center text-2xl shadow-lg shadow-blue-500/20">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-white tracking-wide">
                  Database Studios Hub
                </h1>
                {activeSshServer ? (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    SSH Active: {activeSshServer.name || activeSshServer.host}
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                    Direct Mode
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Connect and manage PostgreSQL, MySQL, Redis, MongoDB, SQLite, and enterprise database servers
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search database servers..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                className="pl-9 pr-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 w-60"
              />
            </div>
            <button
              onClick={() => {
                setEditingProfile(null);
                setIsConnectModalOpen(true);
              }}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30 transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Connect Database</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid of Database Profiles */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              Configured Database Servers ({filteredProfiles.length})
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredProfiles.map(p => {
              const badge = ENGINE_BADGES[p.engine] || { label: p.engine, icon: '🗄️', color: 'border-white/10 text-white' };
              const isConnectingThis = connectingId === p.id;
              const hasError = connectionError?.id === p.id;

              return (
                <div
                  key={p.id}
                  onClick={() => handleOpenStudio(p)}
                  className={`p-5 rounded-2xl border bg-gradient-to-br ${badge.color} hover:border-white/30 transition-all cursor-pointer shadow-xl flex flex-col justify-between group relative`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center text-xl shadow-inner">
                        {badge.icon}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {p.useSsh && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-blue-500/20 text-blue-300 border border-blue-500/30 flex items-center gap-1" title="Tunneled through remote SSH server">
                            <Network className="w-2.5 h-2.5" /> SSH
                          </span>
                        )}
                        {p.useSsl && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <Shield className="w-2.5 h-2.5" /> SSL
                          </span>
                        )}
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono bg-black/40 text-gray-300 border border-white/10">
                          {badge.label}
                        </span>
                      </div>
                    </div>

                    <h3 className="text-sm font-semibold text-white tracking-wide truncate group-hover:text-blue-400 transition-colors">
                      {p.name}
                    </h3>
                    <p className="text-xs text-gray-400 font-mono mt-0.5 truncate">
                      {p.engine === 'sqlite' ? (p.sqlitePath || p.database) : `${p.host || '127.0.0.1'}:${p.port}`}
                    </p>
                    <p className="text-[11px] text-gray-500 font-mono mt-0.5">
                      DB: {p.database} {p.schema ? `• Schema: ${p.schema}` : ''}
                    </p>

                    {/* Connection Error Message Alert */}
                    {hasError && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="mt-3 p-2.5 rounded-xl bg-red-500/20 border border-red-500/40 text-red-200 text-xs animate-in fade-in space-y-1.5"
                      >
                        <div className="flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                          <span className="leading-tight break-words">{connectionError.message}</span>
                        </div>
                        <div className="flex items-center gap-2 pt-1 border-t border-red-500/20">
                          <button
                            onClick={() => handleOpenStudio(p)}
                            className="text-[11px] px-2 py-0.5 rounded bg-red-500/30 hover:bg-red-500/40 text-white font-medium transition-colors"
                          >
                            Retry
                          </button>
                          <button
                            onClick={(e) => handleEditProfile(p, e)}
                            className="text-[11px] px-2 py-0.5 rounded bg-white/10 hover:bg-white/15 text-gray-300 transition-colors"
                          >
                            Edit Settings
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 mt-4 border-t border-white/10 flex items-center justify-between">
                    <span className="text-xs font-medium text-blue-400 group-hover:translate-x-1 transition-transform flex items-center gap-1.5">
                      {isConnectingThis ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Connecting...</span>
                        </>
                      ) : (
                        <>
                          <span>Open Studio</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => handleEditProfile(p, e)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                        title="Edit Connection Settings"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteProfile(p.id, e)}
                        className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors"
                        title="Remove Server"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Connect Modal */}
      {isConnectModalOpen && (
        <ConnectModal
          isOpen={isConnectModalOpen}
          onClose={() => setIsConnectModalOpen(false)}
          onConnected={handleConnected}
          initialProfile={editingProfile}
        />
      )}

    </div>
  );
};

export default DatabaseHub;
