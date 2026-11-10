export type CertStatus = 'valid' | 'expiring_soon' | 'expired' | 'revoked' | 'unknown';

export interface SslCertificate {
  id: string;
  name: string;
  domains: string[];
  expiryDate: string;
  daysRemaining: number;
  status: CertStatus;
  certPath: string;
  keyPath: string;
  issuer?: string;
  serialNumber?: string;
  keyType?: string;
  signatureAlgorithm?: string;
  isCertbot: boolean;
  autoRenewal: boolean;
  renewalConfigPath?: string;
}

export interface CertbotStatus {
  installed: boolean;
  version?: string;
  autoRenewActive: boolean;
  timerStatusText?: string;
  osName?: string;
  osId?: string;
  packageManager?: string;
  suggestedCommand?: string;
  webServers: {
    nginx: boolean;
    apache: boolean;
    caddy: boolean;
    other?: string;
  };
  plugins: {
    nginx: boolean;
    apache: boolean;
    dns?: boolean;
  };
}

export interface IssueCertForm {
  domains: string;
  email: string;
  plugin: 'nginx' | 'apache' | 'standalone' | 'webroot' | 'dns';
  webrootPath: string;
  agreeTos: boolean;
  redirectHttps: boolean;
  dryRun: boolean;
  keyType: 'rsa' | 'ecdsa';
  rsaKeySize: 2048 | 4096;
}

export interface SelfSignedForm {
  domain: string;
  organization: string;
  country: string;
  validDays: number;
  outputDir: string;
}

export interface SslDiagnosticResult {
  domain: string;
  port: number;
  ipAddress?: string;
  connected: boolean;
  protocol?: string;
  cipher?: string;
  serverCertificate?: {
    subject: string;
    issuer: string;
    validFrom: string;
    validTo: string;
    daysRemaining: number;
  };
  rawOutput?: string;
  error?: string;
}
