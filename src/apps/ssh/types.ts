export type SshAuthMethod = 'password' | 'key' | 'agent';

export interface SshSessionTab {
  id: string;
  title: string;
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  connId: string;
  serverName: string;
  shell: string;
  connectedAt: number;
  terminalId: string;
  active: boolean;
  color?: string;
  cipher?: string;
  kex?: string;
  latencyMs?: number;
  splitWithId?: string;
  isRecording?: boolean;
  recordingLines?: string[];
}

export type TunnelType = 'local' | 'remote' | 'dynamic';

export interface SshTunnelRule {
  id: string;
  name: string;
  type: TunnelType;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  bindAddress?: string;
  description?: string;
  serverId?: string;
  serverName?: string;
  status: 'active' | 'inactive' | 'error';
  autoStart?: boolean;
  activeTunnelId?: string;
  activePort?: number;
  bytesIn?: number;
  bytesOut?: number;
  error?: string;
  createdAt: number;
}

export type SshKeyAlgorithm = 'ed25519' | 'rsa-4096' | 'ecdsa-p256' | 'ecdsa-p384';

export interface SshKeyItem {
  id: string;
  name: string;
  algorithm: SshKeyAlgorithm;
  fingerprint: string;
  publicKey: string;
  privateKey: string;
  comment: string;
  passphraseProtected: boolean;
  createdAt: number;
  pushedServers?: string[];
}

export interface RemoteAuthorizedKey {
  id: string;
  raw: string;
  keyType: string;
  publicKeyBase64: string;
  comment: string;
  fingerprint: string;
  options?: string;
  valid: boolean;
}

export interface RemoteKnownHost {
  id: string;
  raw: string;
  host: string;
  keyType: string;
  fingerprint: string;
}

export interface SshConfigEntry {
  id: string;
  hostPattern: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
  forwardAgent?: boolean;
  serverAliveInterval?: number;
  serverAliveCountMax?: number;
  compression?: boolean;
  extraDirectives?: Record<string, string>;
}

export interface SshSnippet {
  id: string;
  title: string;
  command: string;
  category: 'system' | 'docker' | 'network' | 'storage' | 'security' | 'database';
  description?: string;
  shortcut?: string;
}

export interface SshAuditLog {
  id: string;
  timestamp: number;
  action: string;
  host: string;
  username: string;
  status: 'success' | 'failed' | 'warning';
  details: string;
}

export interface SshdSecurityAudit {
  permitRootLogin: 'yes' | 'no' | 'prohibit-password' | 'unknown';
  passwordAuthentication: 'yes' | 'no' | 'unknown';
  pubkeyAuthentication: 'yes' | 'no' | 'unknown';
  port: number;
  maxAuthTries: number;
  x11Forwarding: 'yes' | 'no' | 'unknown';
  score: number;
  issues: string[];
  recommendations: string[];
}
